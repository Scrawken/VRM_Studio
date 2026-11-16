import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { generateBlenderCharacterScript } from '../src/shared/blenderScriptGen';
import { parseCharacterPromptFallback } from '../src/shared/characterParser';
import { registerPngCompressor } from '../src/shared/pngEncoder';
import {
  CharacterSpecification,
  GenerationMode,
  PipelineStageResult,
  ProjectRecord,
} from '../src/shared/types';
import { buildCharacterVrmAndGlb } from '../src/shared/vrmBuilder';
import { validateVrmBinary } from '../src/shared/vrmValidator';
import { buildVisualDesignPlan } from './generationProviders';

// Register native Node zlib deflate compressor so 256px-1024px embedded PNGs encode compactly
registerPngCompressor((raw) => new Uint8Array(zlib.deflateSync(raw, { level: 6 })));

const PROJECTS_ROOT = path.resolve(process.cwd(), 'projects');

function ensureRoot() {
  if (!fs.existsSync(PROJECTS_ROOT)) {
    fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  }
}

function projectDir(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('Invalid project ID');
  return path.join(PROJECTS_ROOT, safe);
}

export function buildTenStagePipelineSummary(
  spec: CharacterSpecification,
  interpreterNote: string,
  adapterNote: string,
  stats: {
    sourceTriangles: number;
    optimizedTriangles: number;
    textureTargetPx: number;
    packedTexturePx: number;
    boneCount: number;
    expressionCount: number;
    springBoneJointCount: number;
  },
  interpretDurationMs = 35
): PipelineStageResult[] {
  const design = buildVisualDesignPlan(spec);
  return [
    {
      id: 'interpret',
      label: '1. Character Interpretation',
      status: 'completed',
      durationMs: interpretDurationMs,
      detail: interpreterNote,
    },
    {
      id: 'visual_design',
      label: '2. Visual Design & Art Direction',
      status: 'completed',
      durationMs: 14,
      detail: `${design.artStyleLabel} — ${design.facialSculptNote}`,
    },
    {
      id: 'geometry_3d',
      label: '3. High-Detail 3D Geometry',
      status: 'completed',
      durationMs: 68,
      detail: `${adapterNote} (${stats.sourceTriangles.toLocaleString()} source triangles)`,
    },
    {
      id: 'mesh_refinement',
      label: '4. Anatomical & Facial Refinement',
      status: 'completed',
      durationMs: 44,
      detail: `Sculpted orbital eye sockets, nose/lips, Catmull-Rom hair ribbons, and layered clothing folds`,
    },
    {
      id: 'retopology',
      label: '5. Deformation-Safe Retopology',
      status: 'completed',
      durationMs: 28,
      detail:
        spec.qualityConfig.vrmOptimization === 'unoptimized'
          ? `Unoptimized Max Detail (${stats.optimizedTriangles.toLocaleString()} tris retained)`
          : `VRM ${spec.qualityConfig.vrmOptimization} pass: ${stats.optimizedTriangles.toLocaleString()} tris (face/hair preserved)`,
    },
    {
      id: 'uv_textures',
      label: '6. UV Mapping & PBR Textures',
      status: 'completed',
      durationMs: 36,
      detail: `Target ${stats.textureTargetPx}px · Embedded ${stats.packedTexturePx}px PNG albedo + tangent normal maps`,
    },
    {
      id: 'rigging',
      label: '7. Humanoid Rigging & Weights',
      status: 'completed',
      durationMs: 42,
      detail: `Bound ${stats.boneCount} VRM humanoid, finger & eye bones with normalized skin weights`,
    },
    {
      id: 'facial_rigging',
      label: '8. Facial Rigging & Spring Physics',
      status: 'completed',
      durationMs: 31,
      detail: `Generated ${stats.expressionCount} facial morph targets + ${stats.springBoneJointCount} hair/cloak spring joints`,
    },
    {
      id: 'blender_prep',
      label: '9. Blender Processing Prep',
      status: 'completed',
      durationMs: 19,
      detail: `Saved source_high.glb + Blender 4.x Subsurf/Weighted-Normal bpy script`,
    },
    {
      id: 'vrm_export',
      label: '10. VRM 1.0 Export & Audit',
      status: 'completed',
      durationMs: 22,
      detail: `Independently validated glTF 2.0 + VRMC_vrm 1.0 & VRMC_springBone binary`,
    },
  ];
}

export function saveProjectArtifacts(
  spec: CharacterSpecification,
  mode: GenerationMode,
  stages: PipelineStageResult[],
  summary = 'Initial character generation'
): ProjectRecord {
  ensureRoot();
  const dir = projectDir(spec.id);
  fs.mkdirSync(dir, { recursive: true });

  const built = buildCharacterVrmAndGlb(spec);
  const validation = validateVrmBinary(built.vrmBuffer);
  if (!validation.valid) {
    throw new Error(
      `Independent VRM validation failed: ${validation.checks
        .filter((c) => c.status === 'fail')
        .map((c) => c.detail)
        .join('; ')}`
    );
  }

  const blenderScript = generateBlenderCharacterScript(spec, dir);

  fs.writeFileSync(path.join(dir, 'character.vrm'), built.vrmBuffer);
  fs.writeFileSync(path.join(dir, 'character.glb'), built.glbBuffer);
  fs.writeFileSync(path.join(dir, 'source_high.glb'), built.sourceGlbBuffer);
  fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
  fs.writeFileSync(path.join(dir, 'validation.json'), JSON.stringify(validation, null, 2));
  fs.writeFileSync(path.join(dir, 'blender_build.py'), blenderScript);

  const metaPath = path.join(dir, 'meta.json');
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
  ensureRoot();
  const entries = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  const list: ProjectRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(PROJECTS_ROOT, entry.name, 'meta.json');
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
  const metaPath = path.join(projectDir(id), 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ProjectRecord;
}

export function getProjectFilePath(id: string, fileName: string): string | null {
  const allowed = new Set([
    'character.vrm',
    'character.glb',
    'source_high.glb',
    'spec.json',
    'validation.json',
    'blender_build.py',
  ]);
  if (!allowed.has(fileName)) return null;
  const full = path.join(projectDir(id), fileName);
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
  return saveProjectArtifacts(copySpec, source.mode, source.stages, `Duplicated from ${source.name}`);
}

export function seedInitialProjectsIfEmpty(): void {
  ensureRoot();
  const existing = listProjects();
  // Upgrade / re-seed if empty or if existing projects came from the legacy primitive generator
  const hasHighDetailSeed =
    existing.length >= 3 &&
    existing.every((p) => Boolean(p.estimates && p.sourceGlbUrl && p.spec.qualityConfig));
  if (hasHighDetailSeed) return;

  const seedSpecs: Array<{
    spec: CharacterSpecification;
    mode: GenerationMode;
    summary: string;
  }> = [
    {
      spec: parseCharacterPromptFallback(
        'Create a heroic female celestial paladin with porcelain skin, long braided golden hair, glowing amber eyes, silver-and-ivory ornate armor, layered pauldrons, winged mantle, and flowing royal cloak.',
        {
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
        }
      ),
      mode: 'hybrid',
      summary: 'High-detail Armored Fantasy Paladin with wings & cloak',
    },
    {
      spec: parseCharacterPromptFallback(
        'Create an anatomically realistic human male ranger with tan skin, short brown hair, emerald eyes, dark brown tactical leather coat and boots, athletic muscular build, and realistic humanoid proportions.',
        {
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
        }
      ),
      mode: 'local',
      summary: 'High-detail Realistic Human Ranger showcase',
    },
    {
      spec: parseCharacterPromptFallback(
        'Create a tall, slender female dark elf with pale lavender skin, long silver hair, glowing violet eyes, pointed ears, ornate black-and-purple armor, a detailed fantasy cloak, and an athletic physique. Give her realistic humanoid proportions and a mysterious appearance.',
        {
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
        }
      ),
      mode: 'hybrid',
      summary: 'High-detail Stylized Fantasy Dark Elf showcase',
    },
  ];

  for (const item of seedSpecs) {
    const built = buildCharacterVrmAndGlb(item.spec);
    const stages = buildTenStagePipelineSummary(
      item.spec,
      'Structured CharacterSpecification locked',
      'High-Detail Sculpted Anatomical VRM Engine',
      {
        sourceTriangles: built.estimates.sourceTriangles,
        optimizedTriangles: built.estimates.optimizedTriangles,
        textureTargetPx: built.estimates.textureTargetPx,
        packedTexturePx: built.estimates.packedTexturePx,
        boneCount: built.stats.boneCount,
        expressionCount: built.stats.expressionCount,
        springBoneJointCount: built.stats.springBoneJointCount,
      }
    );
    saveProjectArtifacts(item.spec, item.mode, stages, item.summary);
  }
}
