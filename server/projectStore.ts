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
  CharacterSpecification,
  GenerationMode,
  PipelineStageResult,
  ProjectRecord,
} from '../src/shared/types';
import {
  buildCharacterVrmAndGlb,
  buildRiggedVrmFromExternalMesh,
} from '../src/shared/vrmBuilder';
import { validateVrmBinary } from '../src/shared/vrmValidator';
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
  validation: ReturnType<typeof validateVrmBinary>,
  timings: { validateMs: number; blenderPrepMs: number }
): PipelineStageResult[] {
  const design = buildVisualDesignPlan(spec);
  const extAudit = built.externalAudit;
  const isExternal = Boolean(extAudit);
  const unoptimized = spec.qualityConfig.vrmOptimization === 'unoptimized';

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
          ? 'completed'
          : 'warning'
        : validation.skinWeightsValid
          ? 'completed'
          : 'error',
      durationMs: built.timingsMs.riggingMs,
      detail: extAudit
        ? `${extAudit.mode === 'preserved_existing_rig' ? 'Preserved existing rig' : 'Fitted humanoid rig'} · ${built.stats.boneCount} bones · max weight error ${extAudit.maxWeightSumError} · ${extAudit.jointDeformations.filter((j) => j.passed).length}/${extAudit.jointDeformations.length} joint deformations verified`
        : `Bound ${built.stats.boneCount} VRM humanoid, finger & eye bones with normalized skin weights`,
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
      label: '9. Blender Script & GLB Artifact Prep',
      status: 'completed',
      durationMs: timings.blenderPrepMs,
      detail: 'Wrote source_high.glb + blender_build.py (live Blender bpy execution not run here)',
    },
    {
      id: 'vrm_export',
      label: '10. VRM 1.0 Export & Audit',
      status: validation.valid ? 'completed' : 'error',
      durationMs: built.timingsMs.packageMs + timings.validateMs,
      detail: `Independently validated glTF 2.0 + VRMC_vrm ${validation.vrmVersion} binary (${(validation.fileSizeBytes / 1024).toFixed(1)} KB)`,
    },
  ];
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
  const tGate0 = performance.now();
  // Pre-geometry Character Specification Fidelity Gate
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

  const tVal0 = performance.now();
  const validation = validateVrmBinary(built.vrmBuffer);
  const validateMs = Math.max(1, Math.round(performance.now() - tVal0));
  if (!validation.valid) {
    throw new Error(
      `Independent VRM validation failed: ${validation.checks
        .filter((c) => c.status === 'fail')
        .map((c) => c.detail)
        .join('; ')}`
    );
  }

  const tPrep0 = performance.now();
  const blenderScript = generateBlenderCharacterScript(spec, dir);

  fs.writeFileSync(resolveSafePathWithinRoot(dir, 'character.vrm'), built.vrmBuffer);
  fs.writeFileSync(resolveSafePathWithinRoot(dir, 'character.glb'), built.glbBuffer);
  fs.writeFileSync(resolveSafePathWithinRoot(dir, 'source_high.glb'), built.sourceGlbBuffer);
  if (externalGeometry) {
    fs.writeFileSync(
      resolveSafePathWithinRoot(dir, 'external_source.glb'),
      externalGeometry.glbBuffer
    );
  }
  fs.writeFileSync(resolveSafePathWithinRoot(dir, 'spec.json'), JSON.stringify(spec, null, 2));
  fs.writeFileSync(
    resolveSafePathWithinRoot(dir, 'validation.json'),
    JSON.stringify(validation, null, 2)
  );
  fs.writeFileSync(resolveSafePathWithinRoot(dir, 'blender_build.py'), blenderScript);
  const blenderPrepMs = Math.max(1, Math.round(performance.now() - tPrep0));

  const stages = buildMeasuredPipelineStages(
    spec,
    {
      ...execContext,
      designValidationMs: execContext.designValidationMs || designGateMs,
    },
    built,
    validation,
    { validateMs, blenderPrepMs }
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

  const record: ProjectRecord = {
    id: spec.id,
    name: spec.name,
    mode,
    spec,
    validation,
    estimates: built.estimates,
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
    createdAt,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(metaPath, JSON.stringify(record, null, 2));
  return record;
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
        Boolean(p.estimates && p.sourceGlbUrl && p.spec.qualityConfig && p.spec.constraints) &&
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
      summary: 'High-detail Armored Fantasy Paladin with wings & cloak',
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
      summary: 'High-detail Realistic Human Ranger showcase',
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
      summary: 'High-detail Stylized Fantasy Dark Elf showcase',
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
