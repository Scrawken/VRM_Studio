import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { generateBlenderCharacterScript } from '../src/shared/blenderScriptGen';
import {
  parseCharacterPromptFallback,
  validateCharacterSpecification,
} from '../src/shared/characterParser';
import { registerPngCompressor } from '../src/shared/pngEncoder';
import {
  BlenderDetectionResult,
  CharacterSpecification,
  GenerationMode,
  PipelineStageResult,
  ProjectRecord,
  VrmExportVersion,
  VrmValidationReport,
} from '../src/shared/types';
import {
  buildCharacterVrmAndGlb,
  buildRiggedVrmFromExternalMesh,
} from '../src/shared/vrmBuilder';
import { validateVrmBinary } from '../src/shared/vrmValidator';
import { BlenderExecutionOutcome, runHeadlessBlenderPipeline } from './blenderExecutor';
import { buildVisualDesignPlan } from './generationProviders';
import { ParsedGlbAsset } from './glbImporter';
import {
  SecurityValidationError,
  assertAllowedArtifactFileName,
  assertValidProjectId,
  resolveSafePathWithinRoot,
} from './security';

// Register native Node zlib deflate compressor so 256px-1024px embedded PNGs encode compactly
registerPngCompressor((raw) => new Uint8Array(zlib.deflateSync(raw, { level: 6 })));

export function getProjectsRoot(): string {
  return path.resolve(process.env.VRM_FORGE_PROJECTS_DIR || path.join(process.cwd(), 'projects'));
}

function ensureRoot(): string {
  const root = getProjectsRoot();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  return root;
}

export function getSafeProjectDir(id: string): string {
  const safeId = assertValidProjectId(id);
  const root = ensureRoot();
  return resolveSafePathWithinRoot(root, safeId);
}

export interface PipelineExecutionContext {
  interpretMs: number;
  interpretUsedFallback: boolean;
  interpreterNote: string;
  designValidationMs: number;
  geometryResolveMs: number;
  geometryUsedFallback: boolean;
  externalGenerationSucceeded: boolean;
  adapterDetail: string;
}

export function buildMeasuredPipelineStages(
  spec: CharacterSpecification,
  ctx: PipelineExecutionContext,
  built: ReturnType<typeof buildCharacterVrmAndGlb>,
  validation: VrmValidationReport,
  timings: { validateMs: number; blenderPrepMs: number },
  blenderOutcome?: BlenderExecutionOutcome
): PipelineStageResult[] {
  const design = buildVisualDesignPlan(spec);
  const extAudit = built.externalAudit;
  const isExternal = Boolean(extAudit);
  const unoptimized = spec.qualityConfig.vrmOptimization === 'unoptimized';
  const targetVrmVersion: VrmExportVersion =
    spec.riggingRequirements.vrmVersion === '1.0' ? '1.0' : '0.0';

  const blenderLiveSucceeded = Boolean(blenderOutcome?.succeeded);
  const blenderStatus: PipelineStageResult['status'] = blenderLiveSucceeded
    ? 'validated'
    : blenderOutcome?.attempted
      ? 'fallback'
      : 'prepared';
  const blenderDetail = blenderLiveSucceeded
    ? `Blender ${blenderOutcome?.blenderVersion} imported GLB, verified deformation & exported valid VRM ${targetVrmVersion}`
    : blenderOutcome?.attempted
      ? `Live Blender failed (${blenderOutcome.reason || 'unknown error'}); fell back to TypeScript VRM ${targetVrmVersion} synthesis`
      : blenderOutcome?.reason
        ? `Wrote source_high.glb + blender_build.py (${blenderOutcome.reason}); using TypeScript VRM ${targetVrmVersion} fallback`
        : `Wrote source_high.glb + blender_build.py (live Blender bpy execution not run here; TypeScript VRM ${targetVrmVersion} fallback active)`;

  return [
    {
      id: 'interpret',
      label: '1. Character Interpretation',
      status: ctx.interpretUsedFallback ? 'fallback' : 'completed',
      durationMs: ctx.interpretMs,
      detail: ctx.interpreterNote,
    },
    {
      id: 'visual_design',
      label: '2. Visual Design & Spec Fidelity',
      status: 'completed',
      durationMs: ctx.designValidationMs,
      detail: `${design.artStyleLabel} — ${design.facialSculptNote}`,
    },
    {
      id: 'geometry_3d',
      label: '3. High-Detail 3D Geometry',
      status: ctx.geometryUsedFallback ? 'fallback' : 'completed',
      durationMs: ctx.geometryResolveMs + (isExternal ? 0 : built.timingsMs.geometryMs),
      detail: `${ctx.adapterDetail} (${built.estimates.sourceTriangles.toLocaleString()} source triangles)`,
    },
    {
      id: 'mesh_refinement',
      label: '4. Anatomical & Surface Preservation',
      status: isExternal ? 'skipped' : 'completed',
      durationMs: isExternal ? 0 : built.timingsMs.geometryMs,
      detail: isExternal
        ? 'Preserved external GLB geometry & node hierarchy verbatim without procedural replacement'
        : 'Sculpted orbital eye sockets, nose/lips, Catmull-Rom hair ribbons, and layered clothing folds',
    },
    {
      id: 'retopology',
      label: '5. Deformation-Safe Retopology',
      status: isExternal || unoptimized ? 'skipped' : 'completed',
      durationMs: isExternal || unoptimized ? 0 : built.timingsMs.retopologyMs,
      detail: isExternal
        ? 'Skipped destructive decimation to preserve original external UV seams and materials'
        : unoptimized
          ? `Skipped (${built.estimates.optimizedTriangles.toLocaleString()} tris retained at Max Detail)`
          : `VRM ${spec.qualityConfig.vrmOptimization} pass: ${built.estimates.optimizedTriangles.toLocaleString()} tris`,
    },
    {
      id: 'uv_textures',
      label: '6. Materials, UVs & Embedded Textures',
      status: 'completed',
      durationMs: built.timingsMs.materialsMs,
      detail: extAudit
        ? `Preserved ${extAudit.preservedMaterialCount} PBR materials, ${extAudit.preservedTextureCount} textures & ${extAudit.preservedImageCount} embedded images`
        : `Target ${built.estimates.textureTargetPx}px · Embedded ${built.estimates.packedTexturePx}px PNG albedo + tangent normal maps (${built.stats.textureCount} textures)`,
    },
    {
      id: 'rigging',
      label: '7. Humanoid Rigging & Weights',
      status: extAudit
        ? extAudit.weightsNormalized &&
          extAudit.allJointDeformationsPassed &&
          extAudit.missingVrmBones.length === 0
          ? 'validated'
          : 'warning'
        : validation.skinWeightsValid
          ? 'validated'
          : 'error',
      durationMs: built.timingsMs.riggingMs,
      detail: extAudit
        ? `${extAudit.mode === 'preserved_existing_rig' ? 'Preserved existing rig' : 'Fitted humanoid rig'} (${built.rigReport?.mappingSource || 'heuristic'}) · ${built.stats.boneCount} bones · max weight error ${extAudit.maxWeightSumError} · ${extAudit.jointDeformations.filter((j) => j.passed).length}/${extAudit.jointDeformations.length} joint deformations verified`
        : `Bound ${built.stats.boneCount} VRM humanoid, finger & eye bones with normalized skin weights`,
      validationStatus: validation.skinWeightsValid ? 'pass' : 'fail',
    },
    {
      id: 'facial_rigging',
      label: '8. Facial Rigging & Spring Physics',
      status:
        validation.nonEmptyExpressions.length >= 7
          ? 'completed'
          : validation.nonEmptyExpressions.length > 0
            ? 'warning'
            : 'error',
      durationMs: built.timingsMs.facialMs,
      detail: extAudit
        ? `${validation.nonEmptyExpressions.length} active non-zero expressions (${extAudit.preservedMorphCount} preserved, ${extAudit.synthesizedMorphCount} synthesized) + ${validation.springBoneJointCount} spring joints`
        : `Generated ${validation.nonEmptyExpressions.length} verified facial morph targets + ${validation.springBoneJointCount} hair/cloak spring joints`,
    },
    {
      id: 'blender_prep',
      label: '9. Blender Production & bpy Export',
      status: blenderStatus,
      durationMs: timings.blenderPrepMs + (blenderOutcome?.durationMs ?? 0),
      detail: blenderDetail,
      artifact: blenderLiveSucceeded ? 'character_blender.vrm' : 'blender_build.py',
      validationStatus: blenderLiveSucceeded ? 'pass' : blenderOutcome?.attempted ? 'warn' : undefined,
    },
    {
      id: 'vrm_export',
      label: `10. VRM ${targetVrmVersion} Export & Audit`,
      status: validation.valid ? 'validated' : 'error',
      durationMs: built.timingsMs.packageMs + timings.validateMs,
      detail: `Independently validated VRM ${validation.vrmVersion} binary (${(validation.fileSizeBytes / 1024).toFixed(1)} KB · ${blenderLiveSucceeded ? 'Blender Verified' : 'TypeScript Synthesis'})`,
      artifact: 'character.vrm',
      validationStatus: validation.valid ? 'pass' : 'fail',
    },
  ];
}

function finalizeProjectRecord(params: {
  dir: string;
  spec: CharacterSpecification;
  mode: GenerationMode;
  targetVrmVersion: VrmExportVersion;
  productionPath: 'blender_live' | 'typescript_fallback';
  execContext: PipelineExecutionContext;
  summary: string;
  built: ReturnType<typeof buildCharacterVrmAndGlb>;
  validation: VrmValidationReport;
  timings: { validateMs: number; blenderPrepMs: number };
  blenderOutcome?: BlenderExecutionOutcome;
}): ProjectRecord {
  const { dir, spec, mode, targetVrmVersion, productionPath, execContext, summary, built, validation, timings, blenderOutcome } = params;

  const stages = buildMeasuredPipelineStages(
    spec,
    execContext,
    built,
    validation,
    timings,
    blenderOutcome
  );

  const metaPath = resolveSafePathWithinRoot(dir, 'meta.json');
  let existingRevisions: ProjectRecord['revisions'] = [];
  let createdAt = spec.createdAt;
  if (fs.existsSync(metaPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ProjectRecord;
      existingRevisions = prev.revisions || [];
      createdAt = prev.createdAt || createdAt;
    } catch {
      existingRevisions = [];
    }
  }

  const hasBlenderReport = fs.existsSync(resolveSafePathWithinRoot(dir, 'blender_report.json'));

  const record: ProjectRecord = {
    id: spec.id,
    name: spec.name,
    mode,
    vrmVersion: targetVrmVersion,
    productionPath,
    spec,
    validation,
    estimates: built.estimates,
    rigReport: built.rigReport,
    stages,
    revisions: [
      {
        version: spec.version,
        timestamp: new Date().toISOString(),
        summary,
        spec,
      },
      ...existingRevisions.slice(0, 19),
    ],
    vrmUrl: `/api/projects/${spec.id}/files/character.vrm?v=${spec.version}`,
    glbUrl: `/api/projects/${spec.id}/files/character.glb?v=${spec.version}`,
    sourceGlbUrl: `/api/projects/${spec.id}/files/source_high.glb?v=${spec.version}`,
    blenderScriptUrl: `/api/projects/${spec.id}/files/blender_build.py?v=${spec.version}`,
    ...(hasBlenderReport
      ? { blenderReportUrl: `/api/projects/${spec.id}/files/blender_report.json?v=${spec.version}` }
      : {}),
    createdAt,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(metaPath, JSON.stringify(record, null, 2));
  return record;
}

function prepareSpecAndBaseBuild(
  spec: CharacterSpecification,
  externalGeometry?: {
    glbBuffer: Uint8Array;
    parsedMesh: ParsedGlbAsset;
  }
) {
  const tGate0 = performance.now();
  const specValidation = validateCharacterSpecification(spec);
  if (!specValidation.valid) {
    throw new SecurityValidationError(
      `Character specification failed fidelity audit: ${specValidation.violations.join('; ')}`,
      422
    );
  }
  const designGateMs = Math.max(1, Math.round(performance.now() - tGate0));

  ensureRoot();
  const dir = getSafeProjectDir(spec.id);
  fs.mkdirSync(dir, { recursive: true });

  const built =
    externalGeometry && externalGeometry.parsedMesh.valid
      ? buildRiggedVrmFromExternalMesh(
          spec,
          externalGeometry.parsedMesh,
          externalGeometry.glbBuffer
        )
      : buildCharacterVrmAndGlb(spec);

  const tPrep0 = performance.now();
  const blenderScript = generateBlenderCharacterScript(spec, dir);
  const specJsonPath = resolveSafePathWithinRoot(dir, 'spec.json');
  const sourceGlbPath = resolveSafePathWithinRoot(dir, 'source_high.glb');
  const externalGlbPath = resolveSafePathWithinRoot(dir, 'external_source.glb');

  fs.writeFileSync(resolveSafePathWithinRoot(dir, 'character.glb'), built.glbBuffer);
  fs.writeFileSync(sourceGlbPath, built.sourceGlbBuffer);
  if (externalGeometry) {
    fs.writeFileSync(externalGlbPath, externalGeometry.glbBuffer);
  }
  fs.writeFileSync(specJsonPath, JSON.stringify(spec, null, 2));
  fs.writeFileSync(resolveSafePathWithinRoot(dir, 'blender_build.py'), blenderScript);
  const blenderPrepMs = Math.max(1, Math.round(performance.now() - tPrep0));

  return {
    dir,
    designGateMs,
    built,
    blenderPrepMs,
    specJsonPath,
    sourceGlbPath,
    externalGlbPath,
  };
}

export function saveProjectArtifacts(
  spec: CharacterSpecification,
  mode: GenerationMode,
  execContext: PipelineExecutionContext,
  summary = 'Initial character generation',
  externalGeometry?: {
    glbBuffer: Uint8Array;
    parsedMesh: ParsedGlbAsset;
  }
): ProjectRecord {
  const prep = prepareSpecAndBaseBuild(spec, externalGeometry);
  const targetVrmVersion: VrmExportVersion =
    spec.riggingRequirements.vrmVersion === '1.0' ? '1.0' : '0.0';

  const tVal0 = performance.now();
  const validation = validateVrmBinary(prep.built.vrmBuffer, targetVrmVersion);
  const validateMs = Math.max(1, Math.round(performance.now() - tVal0));
  if (!validation.valid) {
    throw new Error(
      `Independent VRM ${targetVrmVersion} validation failed: ${validation.checks
        .filter((c) => c.status === 'fail')
        .map((c) => c.detail)
        .join('; ')}`
    );
  }

  fs.writeFileSync(resolveSafePathWithinRoot(prep.dir, 'character.vrm'), prep.built.vrmBuffer);
  fs.writeFileSync(
    resolveSafePathWithinRoot(prep.dir, 'validation.json'),
    JSON.stringify(validation, null, 2)
  );

  return finalizeProjectRecord({
    dir: prep.dir,
    spec,
    mode,
    targetVrmVersion,
    productionPath: 'typescript_fallback',
    execContext: {
      ...execContext,
      designValidationMs: execContext.designValidationMs || prep.designGateMs,
    },
    summary,
    built: prep.built,
    validation,
    timings: { validateMs, blenderPrepMs: prep.blenderPrepMs },
  });
}

export async function executeCharacterPipeline(
  spec: CharacterSpecification,
  mode: GenerationMode,
  execContext: PipelineExecutionContext,
  summary = 'Initial character generation',
  externalGeometry?: {
    glbBuffer: Uint8Array;
    parsedMesh: ParsedGlbAsset;
  },
  options?: {
    skipLiveBlender?: boolean;
    blenderOverride?: BlenderDetectionResult;
    signal?: AbortSignal;
  }
): Promise<{ record: ProjectRecord; blenderOutcome?: BlenderExecutionOutcome }> {
  const prep = prepareSpecAndBaseBuild(spec, externalGeometry);
  const targetVrmVersion: VrmExportVersion =
    spec.riggingRequirements.vrmVersion === '1.0' ? '1.0' : '0.0';

  let blenderOutcome: BlenderExecutionOutcome | undefined;
  let finalVrmBuffer = prep.built.vrmBuffer;
  let productionPath: 'blender_live' | 'typescript_fallback' = 'typescript_fallback';

  if (!options?.skipLiveBlender) {
    const glbForBlender = externalGeometry ? prep.externalGlbPath : prep.sourceGlbPath;
    blenderOutcome = await runHeadlessBlenderPipeline({
      glbPath: glbForBlender,
      outDir: prep.dir,
      specJsonPath: prep.specJsonPath,
      vrmVersion: targetVrmVersion,
      blenderOverride: options?.blenderOverride,
      signal: options?.signal,
    });

    if (blenderOutcome.succeeded && blenderOutcome.vrmBuffer) {
      const blenderCheck = validateVrmBinary(blenderOutcome.vrmBuffer, targetVrmVersion);
      if (blenderCheck.valid) {
        finalVrmBuffer = blenderOutcome.vrmBuffer;
        productionPath = 'blender_live';
      } else {
        blenderOutcome = {
          ...blenderOutcome,
          succeeded: false,
          reason: `Blender exported VRM ${targetVrmVersion} failed independent TypeScript validation: ${blenderCheck.checks
            .filter((c) => c.status === 'fail')
            .map((c) => c.detail)
            .join('; ')}`,
        };
      }
    }
  }

  const tVal0 = performance.now();
  const validation = validateVrmBinary(finalVrmBuffer, targetVrmVersion);
  const validateMs = Math.max(1, Math.round(performance.now() - tVal0));
  if (!validation.valid) {
    throw new Error(
      `Independent VRM ${targetVrmVersion} validation failed: ${validation.checks
        .filter((c) => c.status === 'fail')
        .map((c) => c.detail)
        .join('; ')}`
    );
  }

  fs.writeFileSync(resolveSafePathWithinRoot(prep.dir, 'character.vrm'), finalVrmBuffer);
  fs.writeFileSync(
    resolveSafePathWithinRoot(prep.dir, 'validation.json'),
    JSON.stringify(validation, null, 2)
  );

  const record = finalizeProjectRecord({
    dir: prep.dir,
    spec,
    mode,
    targetVrmVersion,
    productionPath,
    execContext: {
      ...execContext,
      designValidationMs: execContext.designValidationMs || prep.designGateMs,
    },
    summary,
    built: prep.built,
    validation,
    timings: { validateMs, blenderPrepMs: prep.blenderPrepMs },
    blenderOutcome,
  });

  return { record, blenderOutcome };
}

export function listProjects(): ProjectRecord[] {
  const root = ensureRoot();
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const list: ProjectRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const metaPath = path.join(root, entry.name, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ProjectRecord;
      list.push(parsed);
    } catch {
      // Skip corrupt metadata
    }
  }
  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(id: string): ProjectRecord | null {
  const dir = getSafeProjectDir(id);
  const metaPath = resolveSafePathWithinRoot(dir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ProjectRecord;
}

export function getProjectFilePath(id: string, fileName: string): string | null {
  const safeFile = assertAllowedArtifactFileName(fileName);
  const dir = getSafeProjectDir(id);
  const full = resolveSafePathWithinRoot(dir, safeFile);
  return fs.existsSync(full) ? full : null;
}

export function duplicateProject(id: string): ProjectRecord | null {
  const source = getProject(id);
  if (!source) return null;
  const newId = `char_${Date.now().toString(36)}`;
  const copySpec: CharacterSpecification = {
    ...source.spec,
    id: newId,
    name: `${source.spec.name} (Copy)`,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return saveProjectArtifacts(
    copySpec,
    source.mode,
    {
      interpretMs: 0,
      interpretUsedFallback: false,
      interpreterNote: `Cloned specification from ${source.name}`,
      designValidationMs: 1,
      geometryResolveMs: 0,
      geometryUsedFallback: false,
      externalGenerationSucceeded: false,
      adapterDetail: `Cloned build via ${source.spec.geometryProvider}`,
    },
    `Duplicated from ${source.name}`
  );
}

export function seedInitialProjectsIfEmpty(): void {
  ensureRoot();
  const existing = listProjects();
  const hasCurrentSeed =
    existing.length >= 3 &&
    existing.every(
      (p) =>
        p.vrmVersion === '0.0' &&
        p.validation?.vrmVersion === '0.0' &&
        Boolean(p.estimates && p.sourceGlbUrl && p.spec.qualityConfig && p.spec.constraints && p.rigReport && p.productionPath) &&
        !p.stages.some(
          (s) =>
            (s.id === 'visual_design' && s.durationMs === 14) ||
            (s.id === 'geometry_3d' && s.durationMs === 68)
        )
    );
  if (hasCurrentSeed) return;

  const seedSpecs: Array<{
    prompt: string;
    overrides: Parameters<typeof parseCharacterPromptFallback>[1];
    mode: GenerationMode;
    summary: string;
  }> = [
    {
      prompt:
        'Create a heroic female celestial paladin with porcelain skin, long braided golden hair, glowing amber eyes, silver-and-ivory ornate armor, layered pauldrons, winged mantle, and flowing royal cloak.',
      overrides: {
        id: 'armored_paladin_aurelia',
        name: 'Aurelia Seraphis',
        artStyle: 'semi_realistic',
        interpreterProvider: 'local-semantic-parser',
        geometryProvider: 'sculpted-anatomical-vrm',
        qualityConfig: {
          geometryQuality: 'high',
          textureResolution: '4k',
          vrmOptimization: 'balanced',
        },
      },
      mode: 'hybrid',
      summary: 'High-detail Armored Fantasy Paladin with wings & cloak (VRM 0.0 Primary)',
    },
    {
      prompt:
        'Create an anatomically realistic human male ranger with tan skin, short brown hair, emerald eyes, dark brown tactical leather coat and boots, athletic muscular build, and realistic humanoid proportions.',
      overrides: {
        id: 'realistic_human_marcus',
        name: 'Marcus Vance',
        artStyle: 'realistic_human',
        interpreterProvider: 'local-semantic-parser',
        geometryProvider: 'sculpted-anatomical-vrm',
        qualityConfig: {
          geometryQuality: 'high',
          textureResolution: '2k',
          vrmOptimization: 'balanced',
        },
      },
      mode: 'local',
      summary: 'High-detail Realistic Human Ranger showcase (VRM 0.0 Primary)',
    },
    {
      prompt:
        'Create a tall, slender female dark elf with pale lavender skin, long silver hair, glowing violet eyes, pointed ears, ornate black-and-purple armor, a detailed fantasy cloak, and an athletic physique. Give her realistic humanoid proportions and a mysterious appearance.',
      overrides: {
        id: 'dark_elf_vaelith',
        name: 'Vaelith Nightshade',
        artStyle: 'semi_realistic',
        interpreterProvider: 'local-semantic-parser',
        geometryProvider: 'sculpted-anatomical-vrm',
        qualityConfig: {
          geometryQuality: 'high',
          textureResolution: '2k',
          vrmOptimization: 'balanced',
        },
      },
      mode: 'hybrid',
      summary: 'High-detail Stylized Fantasy Dark Elf showcase (VRM 0.0 Primary)',
    },
  ];

  for (const item of seedSpecs) {
    const tInterp0 = performance.now();
    const spec = parseCharacterPromptFallback(item.prompt, item.overrides);
    const interpretMs = Math.max(1, Math.round(performance.now() - tInterp0));
    saveProjectArtifacts(
      spec,
      item.mode,
      {
        interpretMs,
        interpretUsedFallback: false,
        interpreterNote: 'Structured CharacterSpecification parsed via local semantic engine',
        designValidationMs: 0,
        geometryResolveMs: 0,
        geometryUsedFallback: false,
        externalGenerationSucceeded: false,
        adapterDetail: 'High-Detail Sculpted Anatomical VRM Engine',
      },
      item.summary
    );
  }
}
