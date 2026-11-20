import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  applyCharacterEdits,
  checkSourceLicenseViolations,
  clampMetadataToSourceRestrictions,
  createDefaultVrmMetadata,
  normalizeCharacterSpec,
  parseCharacterPromptFallback,
  validateCharacterSpecification,
} from './characterParser';
import { registerPngCompressor } from './pngEncoder';
import {
  buildCharacterVrmAndGlb,
  buildRiggedVrmFromExternalMesh,
  estimateCharacterMetrics,
} from './vrmBuilder';
import { validateVrmBinary } from './vrmValidator';
import { generateBlenderCharacterScript } from './blenderScriptGen';
import { VRM_REQUIRED_HUMANOID_BONES } from './types';
import {
  assertAllowedArtifactFileName,
  assertValidProjectId,
  isLoopbackOrigin,
  resolveLoopbackHost,
  resolveSafePathWithinRoot,
  sanitizeDownloadFilename,
  validateBlenderExecutablePath,
} from '../../server/security';
import { parseAndValidateGlbAsset } from '../../server/glbImporter';
import {
  getProviderRuntimeRecord,
  resolveGeometryProviderExecution,
} from '../../server/generationProviders';
import {
  buildMeasuredPipelineStages,
  executeCharacterPipeline,
} from '../../server/projectStore';
import { runHeadlessBlenderPipeline } from '../../server/blenderExecutor';

registerPngCompressor((raw) => new Uint8Array(zlib.deflateSync(raw, { level: 6 })));

function packTestGlb(gltf: Record<string, unknown>, binBytes: Uint8Array): Uint8Array {
  const jsonText = JSON.stringify(gltf);
  const rawJson = new TextEncoder().encode(jsonText);
  const jsonPad = (4 - (rawJson.length % 4)) % 4;
  const jsonChunk = new Uint8Array(rawJson.length + jsonPad);
  jsonChunk.set(rawJson, 0);
  jsonChunk.fill(0x20, rawJson.length);

  const binPad = (4 - (binBytes.length % 4)) % 4;
  const binChunk = new Uint8Array(binBytes.length + binPad);
  binChunk.set(binBytes, 0);

  const totalLen = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = new Uint8Array(totalLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, totalLen, true);
  dv.setUint32(12, jsonChunk.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonChunk, 20);
  const binHeaderOff = 20 + jsonChunk.length;
  dv.setUint32(binHeaderOff, binChunk.length, true);
  dv.setUint32(binHeaderOff + 4, 0x004e4942, true);
  out.set(binChunk, binHeaderOff + 8);
  return out;
}

function readGlbJson(bytes: Uint8Array): Record<string, any> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkLen = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + chunkLen;
    if (chunkType === 0x4e4f534a) {
      return JSON.parse(new TextDecoder().decode(bytes.subarray(start, end)));
    }
    offset = end;
  }
  throw new Error('No JSON chunk found in GLB');
}

function computeGltfNodeWorldPositions(gltf: Record<string, any>): Map<number, [number, number, number]> {
  const nodes = (gltf.nodes ?? []) as Array<{ translation?: number[]; children?: number[] }>;
  const world = new Map<number, [number, number, number]>();
  const hasParent = new Set<number>();
  for (const n of nodes) {
    for (const c of n.children ?? []) hasParent.add(c);
  }
  const visit = (idx: number, parentPos: [number, number, number]) => {
    const n = nodes[idx];
    if (!n) return;
    const t = n.translation ?? [0, 0, 0];
    const wp: [number, number, number] = [
      parentPos[0] + (t[0] ?? 0),
      parentPos[1] + (t[1] ?? 0),
      parentPos[2] + (t[2] ?? 0),
    ];
    world.set(idx, wp);
    for (const ch of n.children ?? []) visit(ch, wp);
  };
  for (let i = 0; i < nodes.length; i++) {
    if (!hasParent.has(i)) visit(i, [0, 0, 0]);
  }
  return world;
}

function makeSolidPngBytes(r: number, g: number, b: number): Uint8Array {
  // Minimal valid 1x1 RGB PNG signature + chunks (exact byte identity test)
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    r & 0xff, g & 0xff, b & 0xff, 0xff,
  ]);
}

function makeBoxPart(
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number
): { positions: number[]; uvs: number[]; colors: number[]; indices: number[] } {
  const verts = [
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz],
    [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
    [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz],
    [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < verts.length; i++) {
    positions.push(...verts[i]);
    uvs.push((i % 2) * 0.8 + 0.1, (Math.floor(i / 2) % 2) * 0.8 + 0.1);
    colors.push(0.9, 0.75, 0.95, 1.0);
  }
  const indices = [
    0, 1, 2, 0, 2, 3,
    1, 5, 6, 1, 6, 2,
    5, 4, 7, 5, 7, 6,
    4, 0, 3, 4, 3, 7,
    3, 2, 6, 3, 6, 7,
    4, 5, 1, 4, 1, 0,
  ];
  return { positions, uvs, colors, indices };
}

function buildSyntheticExternalHumanoidGlb(options: { includeExistingRig: boolean }) {
  const headPart = makeBoxPart(0, 1.56, 0, 0.09, 0.11, 0.095);
  const torsoPart = makeBoxPart(0, 1.15, 0, 0.16, 0.25, 0.10);
  const lLegPart = makeBoxPart(0.10, 0.45, 0, 0.06, 0.43, 0.06);
  const rLegPart = makeBoxPart(-0.10, 0.45, 0, 0.06, 0.43, 0.06);
  // A-pose arms sloped gently downward
  const lArmPart = makeBoxPart(0.36, 1.24, 0, 0.20, 0.05, 0.05);
  const rArmPart = makeBoxPart(-0.36, 1.24, 0, 0.20, 0.05, 0.05);

  const combine = (parts: Array<ReturnType<typeof makeBoxPart>>) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (const p of parts) {
      const base = pos.length / 3;
      pos.push(...p.positions);
      uv.push(...p.uvs);
      col.push(...p.colors);
      for (const k of p.indices) idx.push(base + k);
    }
    return {
      pos: new Float32Array(pos),
      uv: new Float32Array(uv),
      uv1: new Float32Array(uv.map((x) => x * 0.5)),
      col: new Float32Array(col),
      idx: new Uint32Array(idx),
    };
  };

  // Two meshes with distinct materials: Mesh 0 = Body/Head (Skin mat), Mesh 1 = Armor/Arms (Armor mat)
  const bodyGeom = combine([headPart, torsoPart, lLegPart, rLegPart]);
  const armorGeom = combine([lArmPart, rArmPart]);

  const imgSkinAlbedo = makeSolidPngBytes(210, 185, 235);
  const imgArmorAlbedo = makeSolidPngBytes(45, 35, 70);
  const imgArmorMR = makeSolidPngBytes(200, 90, 0);
  const imgArmorNormal = makeSolidPngBytes(128, 128, 255);

  const chunks: Uint8Array[] = [];
  const bufferViews: Array<Record<string, unknown>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  let offset = 0;

  const pushSlice = (data: Uint8Array, target?: number) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad > 0) {
      chunks.push(new Uint8Array(pad));
      offset += pad;
    }
    const bvIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, ...(target ? { target } : {}) });
    chunks.push(data);
    offset += data.length;
    return bvIdx;
  };

  const img0Bv = pushSlice(imgSkinAlbedo);
  const img1Bv = pushSlice(imgArmorAlbedo);
  const img2Bv = pushSlice(imgArmorMR);
  const img3Bv = pushSlice(imgArmorNormal);

  const addVecAcc = (arr: Float32Array, type: string, minMax = false) => {
    const bv = pushSlice(new Uint8Array(arr.buffer.slice(0)), 34962);
    const acc: Record<string, unknown> = {
      bufferView: bv,
      componentType: 5126,
      count: arr.length / (type === 'VEC4' ? 4 : type === 'VEC3' ? 3 : 2),
      type,
    };
    if (minMax && type === 'VEC3') {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < arr.length; i += 3) {
        min[0] = Math.min(min[0], arr[i]);
        min[1] = Math.min(min[1], arr[i + 1]);
        min[2] = Math.min(min[2], arr[i + 2]);
        max[0] = Math.max(max[0], arr[i]);
        max[1] = Math.max(max[1], arr[i + 1]);
        max[2] = Math.max(max[2], arr[i + 2]);
      }
      acc.min = min;
      acc.max = max;
    }
    const idx = accessors.length;
    accessors.push(acc);
    return idx;
  };

  const addIdxAcc = (arr: Uint32Array) => {
    const bv = pushSlice(new Uint8Array(arr.buffer.slice(0)), 34963);
    const idx = accessors.length;
    accessors.push({ bufferView: bv, componentType: 5125, count: arr.length, type: 'SCALAR' });
    return idx;
  };

  const bPos = addVecAcc(bodyGeom.pos, 'VEC3', true);
  const bUv0 = addVecAcc(bodyGeom.uv, 'VEC2');
  const bUv1 = addVecAcc(bodyGeom.uv1, 'VEC2');
  const bCol = addVecAcc(bodyGeom.col, 'VEC4');
  const bIdx = addIdxAcc(bodyGeom.idx);

  // Morph target on head vertices for existing rig preservation test
  const morphPos = new Float32Array(bodyGeom.pos.length);
  for (let v = 0; v < 8; v++) {
    morphPos[v * 3 + 1] = 0.015;
  }
  const bMorphAcc = addVecAcc(morphPos, 'VEC3', true);

  const aPos = addVecAcc(armorGeom.pos, 'VEC3', true);
  const aUv0 = addVecAcc(armorGeom.uv, 'VEC2');
  const aCol = addVecAcc(armorGeom.col, 'VEC4');
  const aIdx = addIdxAcc(armorGeom.idx);

  const bodyAttrs: Record<string, number> = {
    POSITION: bPos,
    TEXCOORD_0: bUv0,
    TEXCOORD_1: bUv1,
    COLOR_0: bCol,
  };
  const armorAttrs: Record<string, number> = {
    POSITION: aPos,
    TEXCOORD_0: aUv0,
    COLOR_0: aCol,
  };

  const nodes: Array<Record<string, unknown>> = [];
  const skins: Array<Record<string, unknown>> = [];

  if (options.includeExistingRig) {
    // 19-joint standard Mixamo-named skeleton
    const rigDefs: Array<[string, number, [number, number, number]]> = [
      ['mixamorig:Hips', -1, [0, 0.90, 0]],
      ['mixamorig:Spine', 0, [0, 0.14, 0]],
      ['mixamorig:Spine2', 1, [0, 0.22, 0]],
      ['mixamorig:Neck', 2, [0, 0.18, 0]],
      ['mixamorig:Head', 3, [0, 0.12, 0]],
      ['mixamorig:LeftShoulder', 2, [0.06, 0.14, 0]],
      ['mixamorig:LeftArm', 5, [0.12, 0, 0]],
      ['mixamorig:LeftForeArm', 6, [0.24, -0.05, 0]],
      ['mixamorig:LeftHand', 7, [0.22, -0.04, 0]],
      ['mixamorig:RightShoulder', 2, [-0.06, 0.14, 0]],
      ['mixamorig:RightArm', 9, [-0.12, 0, 0]],
      ['mixamorig:RightForeArm', 10, [-0.24, -0.05, 0]],
      ['mixamorig:RightHand', 11, [-0.22, -0.04, 0]],
      ['mixamorig:LeftUpLeg', 0, [0.10, -0.04, 0]],
      ['mixamorig:LeftLeg', 13, [0, -0.40, 0]],
      ['mixamorig:LeftFoot', 14, [0, -0.40, 0]],
      ['mixamorig:RightUpLeg', 0, [-0.10, -0.04, 0]],
      ['mixamorig:RightLeg', 16, [0, -0.40, 0]],
      ['mixamorig:RightFoot', 17, [0, -0.40, 0]],
    ];
    const jointBaseNode = 2; // nodes 0 & 1 are meshes
    const ibm = new Float32Array(rigDefs.length * 16);
    const worldPos: Array<[number, number, number]> = [];
    for (let j = 0; j < rigDefs.length; j++) {
      const [, pIdx, tr] = rigDefs[j];
      const wp: [number, number, number] =
        pIdx >= 0
          ? [worldPos[pIdx][0] + tr[0], worldPos[pIdx][1] + tr[1], worldPos[pIdx][2] + tr[2]]
          : tr;
      worldPos.push(wp);
      ibm[j * 16 + 0] = 1; ibm[j * 16 + 5] = 1; ibm[j * 16 + 10] = 1; ibm[j * 16 + 15] = 1;
      ibm[j * 16 + 12] = -wp[0]; ibm[j * 16 + 13] = -wp[1]; ibm[j * 16 + 14] = -wp[2];
    }
    const ibmBv = pushSlice(new Uint8Array(ibm.buffer));
    const ibmAcc = accessors.length;
    accessors.push({ bufferView: ibmBv, componentType: 5126, count: rigDefs.length, type: 'MAT4' });

    const makeSkinAttrs = (vc: number, jointIdx: number) => {
      const jBytes = new Uint8Array(vc * 4);
      const wFloats = new Float32Array(vc * 4);
      for (let v = 0; v < vc; v++) {
        jBytes[v * 4] = jointIdx;
        wFloats[v * 4] = 1.0;
      }
      const jBv = pushSlice(jBytes, 34962);
      const jAcc = accessors.length;
      accessors.push({ bufferView: jBv, componentType: 5121, count: vc, type: 'VEC4' });
      const wBv = pushSlice(new Uint8Array(wFloats.buffer), 34962);
      const wAcc = accessors.length;
      accessors.push({ bufferView: wBv, componentType: 5126, count: vc, type: 'VEC4' });
      return { jAcc, wAcc };
    };

    const bSkin = makeSkinAttrs(bodyGeom.pos.length / 3, 2);
    bodyAttrs.JOINTS_0 = bSkin.jAcc;
    bodyAttrs.WEIGHTS_0 = bSkin.wAcc;
    const aSkin = makeSkinAttrs(armorGeom.pos.length / 3, 6);
    armorAttrs.JOINTS_0 = aSkin.jAcc;
    armorAttrs.WEIGHTS_0 = aSkin.wAcc;

    nodes.push({ name: 'BodyMeshNode', mesh: 0, skin: 0 });
    nodes.push({ name: 'ArmorMeshNode', mesh: 1, skin: 0 });
    const childMap = new Map<number, number[]>();
    rigDefs.forEach(([, p], i) => {
      if (p >= 0) {
        const arr = childMap.get(p) ?? [];
        arr.push(jointBaseNode + i);
        childMap.set(p, arr);
      }
    });
    rigDefs.forEach(([name, , tr], i) => {
      const n: Record<string, unknown> = { name, translation: tr };
      const ch = childMap.get(i);
      if (ch && ch.length > 0) n.children = ch;
      nodes.push(n);
    });
    skins.push({
      name: 'MixamoArmature',
      inverseBindMatrices: ibmAcc,
      skeleton: jointBaseNode,
      joints: rigDefs.map((_, i) => jointBaseNode + i),
    });
  } else {
    // Non-identity node transform (scaled slightly in GLB hierarchy to test node world matrix application)
    nodes.push({ name: 'BodyNode', mesh: 0, translation: [0, 0.02, 0] });
    nodes.push({ name: 'ArmorNode', mesh: 1, translation: [0, 0.02, 0] });
  }

  const totalBin = new Uint8Array(offset);
  let wp = 0;
  for (const ch of chunks) {
    totalBin.set(ch, wp);
    wp += ch.length;
  }

  const gltf: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'Milestone3TestFixture' },
    scene: 0,
    scenes: [{ nodes: options.includeExistingRig ? [0, 1, 2] : [0, 1] }],
    nodes,
    ...(skins.length > 0 ? { skins } : {}),
    meshes: [
      {
        name: 'BodyHeadMesh',
        extras: { targetNames: ['Fcl_ALL_Joy'] },
        primitives: [
          {
            attributes: bodyAttrs,
            indices: bIdx,
            material: 0,
            targets: [{ POSITION: bMorphAcc }],
          },
        ],
      },
      {
        name: 'ArmorMesh',
        primitives: [{ attributes: armorAttrs, indices: aIdx, material: 1 }],
      },
    ],
    materials: [
      {
        name: 'Mat_Skin',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          baseColorTexture: { index: 0, texCoord: 0 },
          metallicFactor: 0.0,
          roughnessFactor: 0.72,
        },
      },
      {
        name: 'Mat_Armor',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          baseColorTexture: { index: 1, texCoord: 0 },
          metallicFactor: 0.85,
          roughnessFactor: 0.35,
          metallicRoughnessTexture: { index: 2 },
        },
        normalTexture: { index: 3, scale: 1.0 },
        doubleSided: true,
      },
    ],
    textures: [
      { source: 0, sampler: 0 },
      { source: 1, sampler: 0 },
      { source: 2, sampler: 0 },
      { source: 3, sampler: 0 },
    ],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    images: [
      { name: 'skin_albedo', mimeType: 'image/png', bufferView: img0Bv },
      { name: 'armor_albedo', mimeType: 'image/png', bufferView: img1Bv },
      { name: 'armor_mr', mimeType: 'image/png', bufferView: img2Bv },
      { name: 'armor_normal', mimeType: 'image/png', bufferView: img3Bv },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: totalBin.length }],
  };

  return {
    glb: packTestGlb(gltf, totalBin),
    expectedImages: [imgSkinAlbedo, imgArmorAlbedo, imgArmorMR, imgArmorNormal],
  };
}

const DARK_ELF_PROMPT =
  'Create a tall, slender female dark elf with pale lavender skin, long silver hair, glowing violet eyes, pointed ears, ornate black-and-purple armor, a detailed fantasy cloak, and an athletic physique. Give her realistic humanoid proportions and a mysterious appearance.';

const REALISTIC_HUMAN_PROMPT =
  'Create an anatomically realistic human male ranger with tan skin, short brown hair, emerald eyes, dark brown tactical leather coat and boots, athletic muscular build, and realistic humanoid proportions.';

const AURELIA_SERAPHIS_PROMPT =
  'Create a heroic female celestial paladin with porcelain skin, long braided golden hair, glowing amber eyes, silver-and-ivory ornate armor, layered pauldrons, winged mantle, and flowing royal cloak.';

test('characterParser extracts Dark Elf traits, black-and-purple armor, and zero unrequested appendages', () => {
  const spec = parseCharacterPromptFallback(DARK_ELF_PROMPT);
  assert.equal(spec.species, 'Dark Elf');
  assert.equal(spec.genderPresentation, 'feminine');
  assert.equal(spec.features.earStyle, 'long_elf');
  assert.equal(spec.features.hasCloak, true);
  assert.equal(spec.features.hasArmor, true);
  assert.equal(spec.features.hasWings, false, 'Wings must NOT be added unless explicitly requested');
  assert.equal(spec.features.hasHorns, false, 'Horns must NOT be added unless explicitly requested');
  assert.equal(spec.features.hasTail, false, 'Tail must NOT be added unless explicitly requested');
  assert.equal(spec.palette.eyeEmissive, true);
  assert.equal(spec.palette.skinColor, '#cbb8e6');
  assert.equal(spec.palette.hairColor, '#dfe5f2');
  assert.equal(spec.palette.eyeColor, '#a855f7');
  assert.equal(spec.palette.primaryOutfitColor, '#1c1b24');
  assert.equal(spec.palette.secondaryOutfitColor, '#6d28d9');
  assert.equal(spec.artStyle, 'semi_realistic');
  assert.ok(spec.proportions.heightMeters >= 1.75);
});

test('Priority 3: Aurelia Seraphis regression character preserves exact colors, winged mantle, armor, cloak, and forbidden traits', () => {
  const aurelia = parseCharacterPromptFallback(AURELIA_SERAPHIS_PROMPT, {
    id: 'armored_paladin_aurelia',
    name: 'Aurelia Seraphis',
    artStyle: 'semi_realistic',
  });
  assert.equal(aurelia.palette.skinColor, '#f3dfd4');
  assert.equal(aurelia.palette.hairColor, '#e2c06b');
  assert.equal(aurelia.palette.eyeColor, '#f59e0b');
  assert.equal(aurelia.hairStyle, 'braided');
  assert.equal(aurelia.features.hasArmor, true);
  assert.equal(aurelia.features.hasWings, true);
  assert.equal(aurelia.features.hasCloak, true);
  assert.equal(aurelia.features.hasHorns, false);
  assert.equal(aurelia.features.hasTail, false);
  assert.ok(aurelia.constraints?.requiredFeatures.includes('wings'));
  assert.ok(aurelia.constraints?.requiredFeatures.includes('armor'));
  assert.ok(aurelia.constraints?.requiredFeatures.includes('cloak'));
  assert.ok(aurelia.constraints?.forbiddenFeatures.includes('horns'));
  assert.ok(aurelia.constraints?.forbiddenFeatures.includes('tail'));

  const validation = validateCharacterSpecification(aurelia);
  assert.equal(validation.valid, true);
  assert.equal(validation.violations.length, 0);
});

test('Priority 3: Negative clauses ("no wings, without horns, no tail") exclude features and pre-geometry gate blocks drift', () => {
  const prompt =
    'Create a female dark elf knight with pale lavender skin, silver hair, violet eyes, ornate black-and-purple armor, no wings, without horns, no tail.';
  const spec = parseCharacterPromptFallback(prompt);
  assert.equal(spec.features.hasWings, false);
  assert.equal(spec.features.hasHorns, false);
  assert.equal(spec.features.hasTail, false);
  assert.ok(spec.constraints?.forbiddenFeatures.includes('wings'));
  assert.ok(spec.constraints?.forbiddenFeatures.includes('horns'));
  assert.ok(spec.constraints?.forbiddenFeatures.includes('tail'));
  assert.equal(validateCharacterSpecification(spec).valid, true);

  // Inject forbidden wings directly to verify pre-geometry gate blocks it
  const corrupted = {
    ...spec,
    features: { ...spec.features, hasWings: true },
  };
  const rejected = validateCharacterSpecification(corrupted);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.violations.some((v) => v.includes('wings')));
});

test('normalizeCharacterSpec blocks hallucinated wings/horns/tail and preserves explicit prompt colors', () => {
  const guarded = normalizeCharacterSpec(
    {
      features: {
        earStyle: 'human',
        hasCloak: false,
        hasArmor: false,
        hasWings: true,
        hasHorns: true,
        hasTail: true,
      },
      palette: {
        skinColor: '#ffccb3',
        hairColor: '#111111',
        eyeColor: '#22c55e',
        eyeEmissive: false,
        primaryOutfitColor: '#cccccc',
        secondaryOutfitColor: '#ff0000',
        accentMetallicColor: '#ffffff',
        cloakColor: '#0000ff',
      },
    },
    DARK_ELF_PROMPT,
    false
  );
  assert.equal(guarded.features.hasWings, false);
  assert.equal(guarded.features.hasHorns, false);
  assert.equal(guarded.features.hasTail, false);
  assert.equal(guarded.features.hasCloak, true);
  assert.equal(guarded.features.hasArmor, true);
  assert.equal(guarded.features.earStyle, 'long_elf');
  assert.equal(guarded.palette.skinColor, '#cbb8e6');
  assert.equal(guarded.palette.hairColor, '#dfe5f2');
  assert.equal(guarded.palette.eyeColor, '#a855f7');
  assert.equal(guarded.palette.primaryOutfitColor, '#1c1b24');
  assert.equal(guarded.palette.secondaryOutfitColor, '#6d28d9');
});

test('applyCharacterEdits preserves base identity, updates constraints cleanly, and increments version', () => {
  const spec = parseCharacterPromptFallback(DARK_ELF_PROMPT);
  const edited = applyCharacterEdits(spec, {
    name: 'Vaelith Custom',
    artStyle: 'stylized_anime',
    palette: { hairColor: '#38bdf8' },
    features: { hasWings: true },
    qualityConfig: { geometryQuality: 'ultra', textureResolution: '4k' },
  });
  assert.equal(edited.version, 2);
  assert.equal(edited.name, 'Vaelith Custom');
  assert.equal(edited.artStyle, 'stylized_anime');
  assert.equal(edited.palette.hairColor, '#38bdf8');
  assert.equal(edited.palette.skinColor, spec.palette.skinColor);
  assert.equal(edited.features.hasWings, true);
  assert.equal(validateCharacterSpecification(edited).valid, true);
});

test('Priority 0: security helpers enforce loopback host, safe project IDs, path containment, and strict Blender paths', () => {
  assert.equal(resolveLoopbackHost('0.0.0.0'), '127.0.0.1');
  assert.equal(resolveLoopbackHost('localhost'), '127.0.0.1');
  assert.equal(isLoopbackOrigin('http://127.0.0.1:3000'), true);
  assert.equal(isLoopbackOrigin('http://localhost:5173'), true);
  assert.equal(isLoopbackOrigin('https://evil.example.com'), false);

  assert.equal(assertValidProjectId('armored_paladin_aurelia'), 'armored_paladin_aurelia');
  assert.throws(() => assertValidProjectId('../etc/passwd'));
  assert.throws(() => assertValidProjectId('foo/bar'));

  assert.equal(assertAllowedArtifactFileName('character.vrm'), 'character.vrm');
  assert.throws(() => assertAllowedArtifactFileName('../../secret.json'));
  assert.equal(sanitizeDownloadFilename('char_1', 'character.vrm'), 'char_1_character.vrm');

  const root = path.resolve(process.cwd(), 'projects');
  assert.ok(resolveSafePathWithinRoot(root, 'char_1', 'meta.json').startsWith(root));
  assert.throws(() => resolveSafePathWithinRoot(root, '..', 'package.json'));

  const badShell = validateBlenderExecutablePath('/usr/bin/blender;whoami', {
    platform: 'linux',
    requireExistingFile: false,
  });
  assert.equal(badShell.valid, false);
  const badBin = validateBlenderExecutablePath('/bin/sh', {
    platform: 'linux',
    requireExistingFile: false,
  });
  assert.equal(badBin.valid, false);
  const badWin = validateBlenderExecutablePath('C:\\Temp\\evil.exe', {
    platform: 'win32',
    requireExistingFile: false,
  });
  assert.equal(badWin.valid, false);
  const goodWin = validateBlenderExecutablePath(
    'C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe',
    { platform: 'win32', requireExistingFile: false }
  );
  assert.equal(goodWin.valid, true);
});

test('Priority 2: Tripo, Meshy, and Local 3D execute real create->poll->download GLB->VRM rigging flows and report failures honestly', async () => {
  const sampleSpec = parseCharacterPromptFallback(AURELIA_SERAPHIS_PROMPT, {
    qualityConfig: { geometryQuality: 'performance', vrmOptimization: 'unoptimized' },
  });
  const sampleBuilt = buildCharacterVrmAndGlb(sampleSpec);
  const sampleGlb = Buffer.from(sampleBuilt.sourceGlbBuffer);

  // Start a local HTTP server speaking Tripo v2, Meshy v2, and Local 3D protocols
  let pollCounter = 0;
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (req.method === 'POST' && url === '/tripo/task') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 0, data: { task_id: 'tripo_test_123' } }));
      return;
    }
    if (req.method === 'GET' && url === '/tripo/task/tripo_test_123') {
      pollCounter++;
      const status = pollCounter >= 2 ? 'success' : 'running';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          code: 0,
          data: {
            status,
            output: status === 'success' ? { pbr_model: `${baseUrl}/assets/model.glb` } : {},
          },
        })
      );
      return;
    }
    if (req.method === 'POST' && url === '/meshy/text-to-3d') {
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: 'meshy_test_456' }));
      return;
    }
    if (req.method === 'GET' && url === '/meshy/text-to-3d/meshy_test_456') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'SUCCEEDED',
          model_urls: { glb: `${baseUrl}/assets/model.glb` },
        })
      );
      return;
    }
    if (req.method === 'POST' && url === '/local3d/generate') {
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobId: 'local_job_789' }));
      return;
    }
    if (req.method === 'GET' && url === '/local3d/jobs/local_job_789') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'completed',
          downloadUrl: '/assets/model.glb',
        })
      );
      return;
    }
    if (req.method === 'GET' && url.endsWith('/assets/model.glb')) {
      res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
      res.end(sampleGlb);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const prevTripoKey = process.env.TRIPO_API_KEY;
  const prevMeshyKey = process.env.MESHY_API_KEY;
  const prevLocalUrl = process.env.LOCAL_3D_URL;

  try {
    process.env.TRIPO_API_KEY = 'test-tripo-key';
    process.env.MESHY_API_KEY = 'test-meshy-key';
    process.env.LOCAL_3D_URL = `${baseUrl}/local3d`;

    // 1. Tripo live task -> poll -> download -> VRM build
    const tripoRes = await resolveGeometryProviderExecution(sampleSpec, 'tripo-ai-adapter', {
      tripoBaseUrl: `${baseUrl}/tripo`,
      pollIntervalMs: 10,
      maxPollAttempts: 5,
    });
    assert.equal(tripoRes.usedFallback, false);
    assert.equal(tripoRes.externalGenerationSucceeded, true);
    assert.equal(tripoRes.executedProvider, 'tripo-ai-adapter');
    assert.ok(tripoRes.externalGlbBuffer);
    assert.ok(tripoRes.externalParsedMesh?.valid);
    assert.equal(getProviderRuntimeRecord('tripo-ai-adapter')?.state, 'verified_live');

    // Rig downloaded GLB into valid VRM 1.0
    const parsed = parseAndValidateGlbAsset(tripoRes.externalGlbBuffer);
    assert.equal(parsed.valid, true);
    const riggedFromExt = buildRiggedVrmFromExternalMesh(
      sampleSpec,
      parsed,
      tripoRes.externalGlbBuffer
    );
    const vrmCheck = validateVrmBinary(riggedFromExt.vrmBuffer);
    assert.equal(vrmCheck.valid, true);
    assert.equal(vrmCheck.missingRequiredBones.length, 0);
    assert.equal(vrmCheck.skinWeightsValid, true);

    // 2. Meshy live task -> poll -> download
    const meshyRes = await resolveGeometryProviderExecution(sampleSpec, 'meshy-ai-adapter', {
      meshyBaseUrl: `${baseUrl}/meshy`,
      pollIntervalMs: 10,
      maxPollAttempts: 5,
    });
    assert.equal(meshyRes.usedFallback, false);
    assert.equal(meshyRes.externalGenerationSucceeded, true);
    assert.equal(meshyRes.executedProvider, 'meshy-ai-adapter');
    assert.equal(getProviderRuntimeRecord('meshy-ai-adapter')?.state, 'verified_live');

    // 3. Local 3D job -> poll -> download
    const localRes = await resolveGeometryProviderExecution(
      sampleSpec,
      'local-triposr-instantmesh',
      {
        local3dUrl: `${baseUrl}/local3d`,
        pollIntervalMs: 10,
        maxPollAttempts: 5,
      }
    );
    assert.equal(localRes.usedFallback, false);
    assert.equal(localRes.externalGenerationSucceeded, true);
    assert.equal(localRes.executedProvider, 'local-triposr-instantmesh');

    // 4. Missing API key NEVER reports externalGenerationSucceeded
    delete process.env.TRIPO_API_KEY;
    const unconfiguredTripo = await resolveGeometryProviderExecution(
      sampleSpec,
      'tripo-ai-adapter'
    );
    assert.equal(unconfiguredTripo.usedFallback, true);
    assert.equal(unconfiguredTripo.externalGenerationSucceeded, false);
    assert.equal(unconfiguredTripo.executedProvider, 'sculpted-anatomical-vrm');
    assert.equal(getProviderRuntimeRecord('tripo-ai-adapter')?.state, 'unconfigured');
  } finally {
    if (prevTripoKey !== undefined) process.env.TRIPO_API_KEY = prevTripoKey;
    else delete process.env.TRIPO_API_KEY;
    if (prevMeshyKey !== undefined) process.env.MESHY_API_KEY = prevMeshyKey;
    else delete process.env.MESHY_API_KEY;
    if (prevLocalUrl !== undefined) process.env.LOCAL_3D_URL = prevLocalUrl;
    else delete process.env.LOCAL_3D_URL;
    server.close();
  }
});

test('Milestone 3 (Priorities 1, 2A, 3, 4): Multi-material unrigged GLB preserves materials, exact embedded PNG textures, UVs, vertex colors, weights, 5-joint deformations & core facial expressions', () => {
  const { glb, expectedImages } = buildSyntheticExternalHumanoidGlb({ includeExistingRig: false });
  const parsed = parseAndValidateGlbAsset(glb);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.meshCount, 2);
  assert.equal(parsed.materialCount, 2);
  assert.equal(parsed.textureCount, 4);
  assert.equal(parsed.imageCount, 4);
  assert.equal(parsed.hasVertexColors, true);
  assert.equal(parsed.hasNodeTransforms, true);
  assert.equal(parsed.hasMorphTargets, true);
  assert.equal(parsed.hasExistingSkin, false);
  assert.ok(parsed.meshes[0].primitives[0].uvs1);

  const vaelith = parseCharacterPromptFallback(DARK_ELF_PROMPT, {
    id: 'dark_elf_vaelith_ext',
    name: 'Vaelith Nightshade',
  });
  const built = buildRiggedVrmFromExternalMesh(vaelith, parsed, glb);
  assert.ok(built.externalAudit);
  assert.equal(built.externalAudit.mode, 'generated_humanoid_rig');
  assert.equal(built.externalAudit.weightsNormalized, true);
  assert.ok(built.externalAudit.maxWeightSumError < 0.001);
  assert.equal(built.externalAudit.allJointDeformationsPassed, true);
  for (const jName of ['shoulder', 'elbow', 'hip', 'knee', 'neck'] as const) {
    const jAudit = built.externalAudit.jointDeformations.find((j) => j.joint === jName);
    assert.ok(jAudit?.passed, `Expected ${jName} deformation check to pass`);
    assert.ok((jAudit?.maxRotationTestDelta ?? 0) > 0.01);
  }

  // Reload exported VRM 0.0 (primary default) independently & verify exact materials, PNG bytes, UVs, colors, bones, and expressions
  const vrmReport = validateVrmBinary(built.vrmBuffer, '0.0');
  assert.equal(vrmReport.valid, true, `VRM 0.0 audit failed: ${JSON.stringify(vrmReport.checks)}`);
  assert.equal(vrmReport.vrmVersion, '0.0');
  assert.equal(vrmReport.materialCount, 2);
  assert.equal(vrmReport.textureCount, 4);
  assert.equal(vrmReport.skinWeightsValid, true);
  assert.equal(vrmReport.missingRequiredBones.length, 0);
  for (const coreExpr of ['blink', 'blink_l', 'blink_r', 'joy', 'angry', 'sorrow', 'a']) {
    assert.ok(
      vrmReport.nonEmptyExpressions.includes(coreExpr),
      `Expected core VRM 0.0 expression '${coreExpr}' to have verified non-zero morph deltas`
    );
  }

  // Also verify optional VRM 1.0 export from the same external mesh
  const vaelithV1 = parseCharacterPromptFallback(DARK_ELF_PROMPT, {
    id: 'dark_elf_vaelith_ext_v1',
    name: 'Vaelith Nightshade V1',
    vrmVersion: '1.0',
  });
  const builtV1 = buildRiggedVrmFromExternalMesh(vaelithV1, parsed, glb);
  const vrm1Report = validateVrmBinary(builtV1.vrmBuffer, '1.0');
  assert.equal(vrm1Report.valid, true, `VRM 1.0 audit failed: ${JSON.stringify(vrm1Report.checks)}`);
  assert.equal(vrm1Report.vrmVersion, '1.0');
  for (const coreExpr of ['blink', 'blinkLeft', 'blinkRight', 'happy', 'angry', 'sad', 'surprised']) {
    assert.ok(
      vrm1Report.nonEmptyExpressions.includes(coreExpr),
      `Expected core VRM 1.0 expression '${coreExpr}' to have verified non-zero morph deltas`
    );
  }

  const reloaded = parseAndValidateGlbAsset(built.vrmBuffer);
  assert.equal(reloaded.valid, true);
  assert.equal(reloaded.materialCount, 2);
  assert.equal(reloaded.textureCount, 4);
  assert.equal(reloaded.imageCount, 4);
  assert.equal(reloaded.hasVertexColors, true);
  for (let i = 0; i < expectedImages.length; i++) {
    assert.deepEqual(
      Buffer.from(reloaded.images[i].bytes),
      Buffer.from(expectedImages[i]),
      `Embedded texture image ${i} was mutated or replaced`
    );
  }
});

test('Milestone 3 (Priority 2B): Already-rigged external humanoid GLB preserves existing skeleton, IBMs, and morph targets', () => {
  const { glb } = buildSyntheticExternalHumanoidGlb({ includeExistingRig: true });
  const parsed = parseAndValidateGlbAsset(glb);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.hasExistingSkin, true);
  assert.equal(parsed.skins[0].joints.length, 19);

  const aurelia = parseCharacterPromptFallback(AURELIA_SERAPHIS_PROMPT, {
    id: 'armored_paladin_aurelia_ext',
    name: 'Aurelia Seraphis',
  });
  const built = buildRiggedVrmFromExternalMesh(aurelia, parsed, glb);
  assert.ok(built.externalAudit);
  assert.equal(built.externalAudit.mode, 'preserved_existing_rig');
  assert.equal(built.stats.boneCount, 19);
  assert.ok(built.externalAudit.preservedMorphCount >= 1);
  assert.ok(built.externalAudit.synthesizedMorphCount >= 6);

  const vrmReport = validateVrmBinary(built.vrmBuffer);
  assert.equal(vrmReport.valid, true);
  assert.equal(vrmReport.boneCount, 19);
  assert.equal(vrmReport.missingRequiredBones.length, 0);
  assert.equal(vrmReport.skinWeightsValid, true);
});

test('Milestone 3 (Priority 6): Pipeline stages report actual measured timings and honest fallback/skipped statuses without fake constants', () => {
  const spec = parseCharacterPromptFallback(DARK_ELF_PROMPT, {
    qualityConfig: { geometryQuality: 'performance', vrmOptimization: 'unoptimized' },
  });
  const { glb } = buildSyntheticExternalHumanoidGlb({ includeExistingRig: false });
  const parsed = parseAndValidateGlbAsset(glb);
  const built = buildRiggedVrmFromExternalMesh(spec, parsed, glb);
  const validation = validateVrmBinary(built.vrmBuffer);

  const stages = buildMeasuredPipelineStages(
    spec,
    {
      interpretMs: 11,
      interpretUsedFallback: true,
      interpreterNote: 'Fallback semantic parser used',
      designValidationMs: 2,
      geometryResolveMs: 49,
      geometryUsedFallback: true,
      externalGenerationSucceeded: false,
      adapterDetail: 'External GLB test',
    },
    built,
    validation,
    { validateMs: 3, blenderPrepMs: 5 }
  );

  assert.equal(stages.find((s) => s.id === 'interpret')?.status, 'fallback');
  assert.equal(stages.find((s) => s.id === 'geometry_3d')?.status, 'fallback');
  assert.equal(stages.find((s) => s.id === 'mesh_refinement')?.status, 'skipped');
  assert.equal(stages.find((s) => s.id === 'retopology')?.status, 'skipped');
  assert.equal(stages.find((s) => s.id === 'interpret')?.durationMs, 11);
  assert.equal(stages.find((s) => s.id === 'visual_design')?.durationMs, 2);
  assert.ok(
    stages
      .find((s) => s.id === 'blender_prep')
      ?.detail.includes('live Blender bpy execution not run')
  );
});

test('geometry quality scales triangle counts upward from performance -> standard -> high -> ultra', () => {
  const perf = buildCharacterVrmAndGlb(
    parseCharacterPromptFallback(DARK_ELF_PROMPT, {
      qualityConfig: { geometryQuality: 'performance', vrmOptimization: 'unoptimized' },
    })
  );
  const high = buildCharacterVrmAndGlb(
    parseCharacterPromptFallback(DARK_ELF_PROMPT, {
      qualityConfig: { geometryQuality: 'high', vrmOptimization: 'unoptimized' },
    })
  );
  const ultra = buildCharacterVrmAndGlb(
    parseCharacterPromptFallback(DARK_ELF_PROMPT, {
      qualityConfig: { geometryQuality: 'ultra', vrmOptimization: 'unoptimized' },
    })
  );

  assert.ok(perf.stats.triangleCount >= 6000);
  assert.ok(high.stats.triangleCount > perf.stats.triangleCount * 1.6);
  assert.ok(ultra.stats.triangleCount > high.stats.triangleCount * 1.4);
});

test('dual source GLB and optimized VRM preserve source detail independently of export optimization', () => {
  const spec = parseCharacterPromptFallback(DARK_ELF_PROMPT, {
    qualityConfig: {
      geometryQuality: 'high',
      textureResolution: '4k',
      vrmOptimization: 'optimized',
    },
  });
  const preEst = estimateCharacterMetrics(spec);
  assert.ok(preEst.sourceTriangles > preEst.optimizedTriangles);

  const built = buildCharacterVrmAndGlb(spec);
  assert.ok(built.sourceStats.triangleCount > built.stats.triangleCount);
  assert.ok(built.sourceGlbBuffer.byteLength > 0);
  assert.ok(built.vrmBuffer.byteLength > 0);
  assert.equal(built.estimates.textureTargetPx, 4096);
  assert.equal(built.stats.textureCount, 12);
});

test('3-character quality assessment (Dark Elf, Realistic Human, Aurelia Seraphis) pass VRM 0.0 (primary) & VRM 1.0 (optional) audits with strict version separation', () => {
  const prompts = [
    { label: 'Dark Elf', prompt: DARK_ELF_PROMPT, artStyle: 'semi_realistic' as const },
    { label: 'Realistic Human', prompt: REALISTIC_HUMAN_PROMPT, artStyle: 'realistic_human' as const },
    { label: 'Aurelia Seraphis', prompt: AURELIA_SERAPHIS_PROMPT, artStyle: 'semi_realistic' as const },
  ];

  for (const item of prompts) {
    // Primary VRM 0.0 default
    const spec0 = parseCharacterPromptFallback(item.prompt, { artStyle: item.artStyle });
    assert.equal(spec0.riggingRequirements.vrmVersion, '0.0');
    const built0 = buildCharacterVrmAndGlb(spec0);
    assert.equal(built0.vrmVersion, '0.0');
    const report0 = validateVrmBinary(built0.vrmBuffer, '0.0');

    assert.equal(report0.valid, true, `${item.label} VRM 0.0 failed validation: ${JSON.stringify(report0.checks)}`);
    assert.equal(report0.vrmVersion, '0.0');
    assert.equal(report0.missingRequiredBones.length, 0);
    for (const reqBone of VRM_REQUIRED_HUMANOID_BONES) {
      assert.ok(report0.mappedHumanoidBones.includes(reqBone), `${item.label} VRM 0.0 missing ${reqBone}`);
    }
    assert.ok(report0.boneCount >= 55);
    assert.equal(report0.skinWeightsValid, true);
    assert.ok(report0.nonEmptyExpressions.length >= 15);
    assert.ok((report0.blendShapeGroupCount ?? 0) >= 16);
    assert.ok((report0.secondaryBoneGroupCount ?? 0) >= 1);
    assert.equal(report0.metaSummary?.commercialUsage, 'Disallow');
    assert.equal(report0.textureCount, 12);
    assert.ok(report0.triangleCount >= 10000);

    // Verify official VRM 0.0 (-Z forward) orientation while glbBuffer retains standard glTF 2.0 (+Z)
    const v0Gltf = readGlbJson(built0.vrmBuffer);
    const v0Bones = new Map<string, number>(
      ((v0Gltf.extensions?.VRM?.humanoid?.humanBones ?? []) as Array<{ bone: string; node: number }>).map(
        (b) => [b.bone, b.node]
      )
    );
    const v0World = computeGltfNodeWorldPositions(v0Gltf);
    assert.ok(
      (v0World.get(v0Bones.get('leftUpperArm')!)?.[0] ?? 0) < 0,
      `${item.label} VRM 0.0 leftUpperArm must be at -X (-Z forward convention)`
    );
    assert.ok(
      (v0World.get(v0Bones.get('rightUpperArm')!)?.[0] ?? 0) > 0,
      `${item.label} VRM 0.0 rightUpperArm must be at +X (-Z forward convention)`
    );
    assert.ok(
      (v0World.get(v0Bones.get('leftEye')!)?.[2] ?? 0) < (v0World.get(v0Bones.get('head')!)?.[2] ?? 0),
      `${item.label} VRM 0.0 eyes must point toward -Z`
    );
    assert.ok(!v0Bones.has('leftThumbMetacarpal'), 'VRM 0.0 must use leftThumbProximal/Intermediate');
    assert.ok(v0Bones.has('leftThumbProximal') && v0Bones.has('leftThumbIntermediate'));

    const glbWorld = computeGltfNodeWorldPositions(readGlbJson(built0.glbBuffer));
    assert.ok(
      (glbWorld.get(v0Bones.get('leftUpperArm')!)?.[0] ?? 0) > 0,
      `${item.label} character.glb must remain standard glTF 2.0 (+Z forward)`
    );

    // Cross-version rejection: VRM 0.0 binary MUST fail when validated against expectedVersion='1.0'
    const mismatch0As1 = validateVrmBinary(built0.vrmBuffer, '1.0');
    assert.equal(mismatch0As1.valid, false);

    // Optional VRM 1.0 format
    const spec1 = parseCharacterPromptFallback(item.prompt, {
      artStyle: item.artStyle,
      vrmVersion: '1.0',
    });
    const built1 = buildCharacterVrmAndGlb(spec1);
    assert.equal(built1.vrmVersion, '1.0');
    const report1 = validateVrmBinary(built1.vrmBuffer, '1.0');
    assert.equal(report1.valid, true, `${item.label} VRM 1.0 failed validation: ${JSON.stringify(report1.checks)}`);
    assert.equal(report1.vrmVersion, '1.0');
    assert.ok(report1.nonEmptyExpressions.length >= 16);

    const v1Gltf = readGlbJson(built1.vrmBuffer);
    const v1World = computeGltfNodeWorldPositions(v1Gltf);
    const v1Bones = v1Gltf.extensions?.VRMC_vrm?.humanoid?.humanBones ?? {};
    assert.ok(
      (v1World.get(v1Bones.leftUpperArm?.node)?.[0] ?? 0) > 0,
      `${item.label} VRM 1.0 leftUpperArm must be at +X (+Z forward convention)`
    );
    assert.ok(
      (v1World.get(v1Bones.leftEye?.node)?.[2] ?? 0) > (v1World.get(v1Bones.head?.node)?.[2] ?? 0),
      `${item.label} VRM 1.0 eyes must point toward +Z`
    );

    // Cross-version rejection: VRM 1.0 binary MUST fail when validated against expectedVersion='0.0'
    const mismatch1As0 = validateVrmBinary(built1.vrmBuffer, '0.0');
    assert.equal(mismatch1As0.valid, false);
  }
});

test('vrmValidator rejects corrupted binary payloads', () => {
  const badBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
  const report = validateVrmBinary(badBytes);
  assert.equal(report.valid, false);
  assert.ok(report.checks.some((c) => c.status === 'fail'));
});

test('Metadata policy: conservative non-commercial defaults and zero sample attribution contamination', () => {
  const meta = createDefaultVrmMetadata('Aether Knight');
  assert.equal(meta.title, 'Aether Knight');
  assert.equal(meta.commercialUsage, 'Disallow');
  assert.equal(meta.allowedUserName, 'OnlyAuthor');
  assert.equal(meta.violentUsage, 'Disallow');
  assert.equal(meta.sexualUsage, 'Disallow');

  const spec = parseCharacterPromptFallback(AURELIA_SERAPHIS_PROMPT, {
    id: 'meta_clean_test',
    name: 'Aurelia Seraphis',
  });
  const built = buildCharacterVrmAndGlb(spec);
  const outGltf = readGlbJson(built.vrmBuffer);
  const vrm0 = outGltf.extensions?.VRM as { meta?: Record<string, unknown> } | undefined;
  assert.ok(vrm0?.meta);
  assert.equal(vrm0.meta.commercialUssageName, 'Disallow');
  assert.equal(vrm0.meta.allowedUserName, 'OnlyAuthor');
  const serializedMeta = JSON.stringify(vrm0.meta);
  assert.ok(!serializedMeta.includes('VRoid'));
  assert.ok(!serializedMeta.includes('"Ren"'));
});

test('VRoid J_Bip_* + finger + J_Sec_* hair spring rigged GLB maps full humanoid, fingers, and spring roots into VRM 0.0', () => {
  const { pos, uv, col, idx } = (() => {
    const parts = [
      makeBoxPart(0, 1.56, 0, 0.09, 0.11, 0.095),
      makeBoxPart(0, 1.15, 0, 0.16, 0.25, 0.10),
      makeBoxPart(0.36, 1.24, 0, 0.20, 0.05, 0.05),
      makeBoxPart(-0.36, 1.24, 0, 0.20, 0.05, 0.05),
      makeBoxPart(0.10, 0.45, 0, 0.06, 0.43, 0.06),
      makeBoxPart(-0.10, 0.45, 0, 0.06, 0.43, 0.06),
    ];
    const pArr: number[] = [];
    const uArr: number[] = [];
    const cArr: number[] = [];
    const iArr: number[] = [];
    for (const p of parts) {
      const base = pArr.length / 3;
      pArr.push(...p.positions);
      uArr.push(...p.uvs);
      cArr.push(...p.colors);
      for (const k of p.indices) iArr.push(base + k);
    }
    return {
      pos: new Float32Array(pArr),
      uv: new Float32Array(uArr),
      col: new Float32Array(cArr),
      idx: new Uint32Array(iArr),
    };
  })();

  const jointDefs: Array<[string, number, [number, number, number]]> = [
    ['J_Bip_C_Hips', -1, [0, 0.9, 0]],
    ['J_Bip_C_Spine', 0, [0, 0.14, 0]],
    ['J_Bip_C_Chest', 1, [0, 0.18, 0]],
    ['J_Bip_C_UpperChest', 2, [0, 0.12, 0]],
    ['J_Bip_C_Neck', 3, [0, 0.12, 0]],
    ['J_Bip_C_Head', 4, [0, 0.12, 0]],
    ['J_Adj_L_FaceEye', 5, [0.03, 0.08, 0.07]],
    ['J_Adj_R_FaceEye', 5, [-0.03, 0.08, 0.07]],
    ['J_Sec_Hair1_01', 5, [0, 0.1, -0.09]],
    ['J_Sec_Hair1_02', 8, [0, -0.15, -0.02]],
    ['J_Bip_L_Shoulder', 3, [0.06, 0.1, 0]],
    ['J_Bip_L_UpperArm', 10, [0.12, 0, 0]],
    ['J_Bip_L_LowerArm', 11, [0.24, 0, 0]],
    ['J_Bip_L_Hand', 12, [0.22, 0, 0]],
    ['J_Bip_L_Thumb1', 13, [0.02, -0.01, 0.02]],
    ['J_Bip_L_Thumb2', 14, [0.02, 0, 0.02]],
    ['J_Bip_L_Thumb3', 15, [0.02, 0, 0.01]],
    ['J_Bip_L_Index1', 13, [0.06, 0, 0.02]],
    ['J_Bip_L_Index2', 17, [0.03, 0, 0]],
    ['J_Bip_L_Index3', 18, [0.02, 0, 0]],
    ['J_Bip_R_Shoulder', 3, [-0.06, 0.1, 0]],
    ['J_Bip_R_UpperArm', 20, [-0.12, 0, 0]],
    ['J_Bip_R_LowerArm', 21, [-0.24, 0, 0]],
    ['J_Bip_R_Hand', 22, [-0.22, 0, 0]],
    ['J_Bip_R_Index1', 23, [-0.06, 0, 0.02]],
    ['J_Bip_R_Index2', 24, [-0.03, 0, 0]],
    ['J_Bip_R_Index3', 25, [-0.02, 0, 0]],
    ['J_Bip_L_UpperLeg', 0, [0.1, -0.05, 0]],
    ['J_Bip_L_LowerLeg', 27, [0, -0.4, 0]],
    ['J_Bip_L_Foot', 28, [0, -0.4, 0]],
    ['J_Bip_R_UpperLeg', 0, [-0.1, -0.05, 0]],
    ['J_Bip_R_LowerLeg', 30, [0, -0.4, 0]],
    ['J_Bip_R_Foot', 31, [0, -0.4, 0]],
  ];

  const chunks: Uint8Array[] = [];
  const bufferViews: Array<Record<string, unknown>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  let off = 0;
  const push = (bytes: Uint8Array, target?: number) => {
    const pad = (4 - (off % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      off += pad;
    }
    const idxBv = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes);
    off += bytes.length;
    return idxBv;
  };

  const posAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(pos.buffer), 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min: [-0.25, 0.25, -0.12], max: [0.25, 1.75, 0.12] });
  const uvAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(uv.buffer), 34962), componentType: 5126, count: uv.length / 2, type: 'VEC2' });
  const colAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(col.buffer), 34962), componentType: 5126, count: col.length / 4, type: 'VEC4' });
  const idxAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(idx.buffer), 34963), componentType: 5125, count: idx.length, type: 'SCALAR' });

  const vc = pos.length / 3;
  const jBytes = new Uint8Array(vc * 4);
  const wFloats = new Float32Array(vc * 4);
  for (let v = 0; v < vc; v++) {
    jBytes[v * 4] = v < 4 ? 5 : 2;
    wFloats[v * 4] = 1.0;
  }
  const jAcc = accessors.length;
  accessors.push({ bufferView: push(jBytes, 34962), componentType: 5121, count: vc, type: 'VEC4' });
  const wAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(wFloats.buffer), 34962), componentType: 5126, count: vc, type: 'VEC4' });

  const ibm = new Float32Array(jointDefs.length * 16);
  const worldPos: Array<[number, number, number]> = [];
  for (let i = 0; i < jointDefs.length; i++) {
    const [, pIdx, tr] = jointDefs[i];
    const wp: [number, number, number] =
      pIdx >= 0
        ? [worldPos[pIdx][0] + tr[0], worldPos[pIdx][1] + tr[1], worldPos[pIdx][2] + tr[2]]
        : tr;
    worldPos.push(wp);
    ibm[i * 16] = 1; ibm[i * 16 + 5] = 1; ibm[i * 16 + 10] = 1; ibm[i * 16 + 15] = 1;
    ibm[i * 16 + 12] = -wp[0]; ibm[i * 16 + 13] = -wp[1]; ibm[i * 16 + 14] = -wp[2];
  }
  const ibmAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(ibm.buffer)), componentType: 5126, count: jointDefs.length, type: 'MAT4' });

  const nodes: Array<Record<string, unknown>> = [{ name: 'VRoidBodyNode', mesh: 0, skin: 0 }];
  const jointBase = 1;
  const childMap = new Map<number, number[]>();
  jointDefs.forEach(([, p], i) => {
    if (p >= 0) {
      const list = childMap.get(p) ?? [];
      list.push(jointBase + i);
      childMap.set(p, list);
    }
  });
  jointDefs.forEach(([name, , tr], i) => {
    const n: Record<string, unknown> = { name, translation: tr };
    const ch = childMap.get(i);
    if (ch && ch.length > 0) n.children = ch;
    nodes.push(n);
  });

  const bin = new Uint8Array(off);
  let wp = 0;
  for (const ch of chunks) {
    bin.set(ch, wp);
    wp += ch.length;
  }

  const vroidGlb = packTestGlb(
    {
      asset: { version: '2.0', generator: 'VRoidTestFixture' },
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes,
      skins: [{
        name: 'VRoidSkin',
        inverseBindMatrices: ibmAcc,
        skeleton: 1,
        joints: jointDefs.map((_, i) => jointBase + i),
      }],
      meshes: [{
        name: 'Body',
        primitives: [{
          attributes: { POSITION: posAcc, TEXCOORD_0: uvAcc, COLOR_0: colAcc, JOINTS_0: jAcc, WEIGHTS_0: wAcc },
          indices: idxAcc,
          material: 0,
        }],
      }],
      materials: [{ name: 'VRoidSkinMat', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
      accessors,
      bufferViews,
      buffers: [{ byteLength: bin.length }],
    },
    bin
  );

  const parsed = parseAndValidateGlbAsset(vroidGlb);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.hasExistingSkin, true);
  const spec = parseCharacterPromptFallback('VRoid character import test', {
    id: 'vroid_jbip_test',
    name: 'VRoid Test Avatar',
    vrmVersion: '0.0',
  });
  const built = buildRiggedVrmFromExternalMesh(spec, parsed, vroidGlb);
  assert.equal(built.vrmVersion, '0.0');
  assert.equal(built.rigReport?.sourceState, 'valid_preserved');
  assert.equal(built.rigReport?.mappingSource, 'name_heuristic');
  assert.ok((built.rigReport?.mappedCount ?? 0) >= 24);

  const report = validateVrmBinary(built.vrmBuffer, '0.0');
  assert.equal(report.valid, true, `VRoid VRM 0.0 audit failed: ${JSON.stringify(report.checks)}`);
  assert.equal(report.missingRequiredBones.length, 0);
  assert.ok(report.mappedHumanoidBones.includes('leftEye'));
  assert.ok(report.mappedHumanoidBones.includes('leftThumbProximal'));
  assert.ok(report.mappedHumanoidBones.includes('leftThumbIntermediate'));
  assert.ok(!report.mappedHumanoidBones.includes('leftThumbMetacarpal'));
  assert.ok(report.mappedHumanoidBones.includes('rightIndexDistal'));
  assert.ok((report.secondaryBoneGroupCount ?? 0) >= 1, 'Expected J_Sec_Hair1_01 to populate secondaryAnimation.boneGroups');

  const outGltf = readGlbJson(built.vrmBuffer);
  const vroidWorld = computeGltfNodeWorldPositions(outGltf);
  const vroidBones = new Map<string, number>(
    ((outGltf.extensions?.VRM?.humanoid?.humanBones ?? []) as Array<{ bone: string; node: number }>).map(
      (b) => [b.bone, b.node]
    )
  );
  assert.ok(
    (vroidWorld.get(vroidBones.get('leftUpperArm')!)?.[0] ?? 0) < 0,
    'Exported VRM 0.0 from VRoid GLB must face -Z (leftUpperArm at -X)'
  );
  assert.ok(
    (vroidWorld.get(vroidBones.get('leftEye')!)?.[2] ?? 0) < (vroidWorld.get(vroidBones.get('head')!)?.[2] ?? 0),
    'Exported VRM 0.0 from VRoid GLB must orient eyes toward -Z'
  );
  const sec = (outGltf.extensions?.VRM as {
    secondaryAnimation?: { boneGroups?: Array<{ bones?: number[] }> };
  } | undefined)?.secondaryAnimation;
  const springBoneNodeIndices = new Set((sec?.boneGroups ?? []).flatMap((g) => g.bones ?? []));
  assert.ok(springBoneNodeIndices.has(jointBase + 8), 'J_Sec_Hair1_01 must be in boneGroups');
  assert.ok(!springBoneNodeIndices.has(jointBase + 0), 'hips must NOT be added to spring boneGroups');
});

test('glbImporter decodes glTF 2.0 sparse POSITION morph target accessors', () => {
  const basePos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const idxArr = new Uint16Array([0, 1, 2]);
  const sparseIdx = new Uint16Array([2]);
  const sparseVals = new Float32Array([0, 0.25, 0]);

  const chunks: Uint8Array[] = [];
  const bufferViews: Array<Record<string, unknown>> = [];
  let off = 0;
  const push = (bytes: Uint8Array, target?: number) => {
    const pad = (4 - (off % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      off += pad;
    }
    const bv = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes);
    off += bytes.length;
    return bv;
  };
  const posBv = push(new Uint8Array(basePos.buffer), 34962);
  const idxBv = push(new Uint8Array(idxArr.buffer), 34963);
  const spIdxBv = push(new Uint8Array(sparseIdx.buffer));
  const spValBv = push(new Uint8Array(sparseVals.buffer));

  const bin = new Uint8Array(off);
  let wp = 0;
  for (const ch of chunks) {
    bin.set(ch, wp);
    wp += ch.length;
  }

  const sparseGlb = packTestGlb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'SparseNode', mesh: 0 }],
      meshes: [{
        name: 'SparseMesh',
        extras: { targetNames: ['Smile'] },
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, targets: [{ POSITION: 2 }] }],
      }],
      accessors: [
        { bufferView: posBv, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
        { bufferView: idxBv, componentType: 5123, count: 3, type: 'SCALAR' },
        {
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          sparse: {
            count: 1,
            indices: { bufferView: spIdxBv, componentType: 5123 },
            values: { bufferView: spValBv },
          },
        },
      ],
      bufferViews,
      buffers: [{ byteLength: bin.length }],
    },
    bin
  );

  const parsed = parseAndValidateGlbAsset(sparseGlb);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.hasMorphTargets, true);
  const target = parsed.meshes[0].primitives[0].morphTargets[0];
  assert.equal(target.name, 'Smile');
  assert.ok(Math.abs(target.positions[2 * 3 + 1] - 0.25) < 1e-5);
  assert.equal(target.positions[0], 0);
});

test('Honest pipeline telemetry: blender-bpy-bridge reports unavailable when binary absent and executeCharacterPipeline marks typescript_fallback', async () => {
  const prevDir = process.env.VRM_FORGE_PROJECTS_DIR;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrm-studio-test-'));
  process.env.VRM_FORGE_PROJECTS_DIR = tmpDir;

  try {
    const spec = parseCharacterPromptFallback(AURELIA_SERAPHIS_PROMPT, {
      id: 'honest_fallback_check',
      name: 'Honest Check Avatar',
      vrmVersion: '0.0',
      qualityConfig: { geometryQuality: 'performance', vrmOptimization: 'unoptimized' },
    });

    const bridgeExec = await resolveGeometryProviderExecution(spec, 'blender-bpy-bridge');
    assert.equal(bridgeExec.externalGenerationSucceeded, false);
    assert.equal(bridgeExec.usedFallback, true);

    const { record } = await executeCharacterPipeline(
      spec,
      'local',
      {
        interpretMs: 1,
        interpretUsedFallback: false,
        interpreterNote: 'Test semantic spec',
        designValidationMs: 1,
        geometryResolveMs: 1,
        geometryUsedFallback: false,
        externalGenerationSucceeded: false,
        adapterDetail: 'Local test GLB',
      },
      'Test fallback status',
      undefined,
      { skipLiveBlender: true }
    );

    assert.equal(record.vrmVersion, '0.0');
    assert.equal(record.productionPath, 'typescript_fallback');
    assert.equal(record.blenderReportUrl, undefined);
    assert.equal(record.stages.find((s) => s.id === 'blender_prep')?.status, 'prepared');
    assert.equal(record.validation.valid, true);
    assert.equal(record.validation.vrmVersion, '0.0');
  } finally {
    if (prevDir !== undefined) process.env.VRM_FORGE_PROJECTS_DIR = prevDir;
    else delete process.env.VRM_FORGE_PROJECTS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Priority 4 & Milestone 3: blenderScriptGen (VRM 0.0 + py_compile), blender_production_pipeline.py & test_milestone2_blender.py are valid Python and complete', () => {
  const spec = parseCharacterPromptFallback(AURELIA_SERAPHIS_PROMPT, {
    qualityConfig: { geometryQuality: 'high', textureResolution: '4k', vrmOptimization: 'balanced' },
  });
  const py = generateBlenderCharacterScript(spec);
  assert.ok(py.includes('import bpy'));
  assert.ok(py.includes('TARGET_VRM_VERSION = "0.0"'));
  assert.ok(py.includes('VROID_AND_CANONICAL_ALIASES'));
  assert.ok(py.includes('create_humanoid_armature'));
  assert.ok(py.includes('evaluated_depsgraph_get'));
  assert.ok(py.includes('REQUIRED_VRM_HUMANOID_BONES'));
  assert.ok(py.includes('WEIGHTED_NORMAL'));
  assert.ok(py.includes('TARGET_TEXTURE_PX = 4096'));
  assert.ok(py.includes('export_scene.vrm'));
  assert.ok(!py.includes('create_uvsphere'));
  assert.ok(!py.includes('create_cube'));

  // Verify generated Python script parses & compiles cleanly without syntax errors
  const tmpPy = path.join(os.tmpdir(), `vrm_gen_check_${Date.now()}.py`);
  fs.writeFileSync(tmpPy, py, 'utf8');
  try {
    execFileSync('python3', ['-m', 'py_compile', tmpPy], { stdio: 'pipe' });
  } finally {
    fs.rmSync(tmpPy, { force: true });
  }

  const m2Path = path.resolve(process.cwd(), 'blender_scripts', 'test_milestone2_blender.py');
  const prodPath = path.resolve(process.cwd(), 'blender_scripts', 'blender_production_pipeline.py');
  const m2 = fs.readFileSync(m2Path, 'utf8');
  const prod = fs.readFileSync(prodPath, 'utf8');
  assert.ok(prod.includes('run_production_pipeline'));
  assert.ok(prod.includes('ext.vrm0.meta'));
  assert.ok(m2.includes('--glb-path'));
  assert.ok(m2.includes('ARMATURE_AUTO'));
  assert.ok(m2.includes('vertex_group_normalize_all'));
  assert.ok(m2.includes('material_preserved'));
  assert.ok(m2.includes('texture_preserved'));
  assert.ok(m2.includes('rigging_success'));
  assert.ok(m2.includes('vrm_export_success'));
  assert.ok(m2.includes('vrm_reload_success'));
  assert.ok(m2.includes('bpy.ops.import_scene.gltf'));
  assert.ok(m2.includes('evaluated_depsgraph_get'));
  assert.ok(m2.includes('validate_vrm_bytes'));
  assert.ok(!m2.includes('create_icosphere'));
  assert.ok(!m2.includes('create_cube'));
});

function buildMinimalConformanceVrm0(
  mutator?: (gltf: Record<string, any>, binBytes: Uint8Array) => void
): Uint8Array {
  const nodes: Array<Record<string, any>> = VRM_REQUIRED_HUMANOID_BONES.map((b) => ({ name: b }));
  nodes[4].children = [17];
  nodes.push({ name: 'hairRoot' }); // 17: non-humanoid spring root
  nodes.push({ name: 'BodyMesh', mesh: 0, skin: 0 }); // 18

  const chunks: Uint8Array[] = [];
  const bufferViews: Array<Record<string, any>> = [];
  const accessors: Array<Record<string, any>> = [];
  let off = 0;
  const push = (bytes: Uint8Array, target?: number) => {
    const pad = (4 - (off % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      off += pad;
    }
    const bv = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes);
    off += bytes.length;
    return bv;
  };

  const pos = new Float32Array([0, 0, 0, 0.3, 0, 0, 0, 0.5, 0]);
  const j0 = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0]);
  const w0 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const idx = new Uint16Array([0, 1, 2]);
  const morphPos = new Float32Array([0, 0, 0, 0, 0.025, 0, 0, 0, 0]);
  const ibm = new Float32Array(18 * 16);
  for (let i = 0; i < 18; i++) {
    ibm[i * 16] = 1;
    ibm[i * 16 + 5] = 1;
    ibm[i * 16 + 10] = 1;
    ibm[i * 16 + 15] = 1;
  }

  const posAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(pos.buffer), 34962), componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [0.3, 0.5, 0] });
  const j0Acc = accessors.length;
  accessors.push({ bufferView: push(j0, 34962), componentType: 5121, count: 3, type: 'VEC4' });
  const w0Acc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(w0.buffer), 34962), componentType: 5126, count: 3, type: 'VEC4' });
  const idxAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(idx.buffer), 34963), componentType: 5123, count: 3, type: 'SCALAR' });
  const morphAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(morphPos.buffer), 34962), componentType: 5126, count: 3, type: 'VEC3' });
  const ibmAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(ibm.buffer)), componentType: 5126, count: 18, type: 'MAT4' });

  const bin = new Uint8Array(off);
  let wp = 0;
  for (const ch of chunks) {
    bin.set(ch, wp);
    wp += ch.length;
  }

  const gltf: Record<string, any> = {
    asset: { version: '2.0' },
    extensionsUsed: ['VRM'],
    nodes,
    skins: [{ joints: Array.from({ length: 18 }, (_, i) => i), inverseBindMatrices: ibmAcc }],
    meshes: [{
      name: 'Body',
      primitives: [{
        attributes: { POSITION: posAcc, JOINTS_0: j0Acc, WEIGHTS_0: w0Acc },
        indices: idxAcc,
        material: 0,
        targets: [{ POSITION: morphAcc }],
      }],
    }],
    materials: [{ name: 'DefaultMat', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
    extensions: {
      VRM: {
        specVersion: '0.0',
        meta: {
          title: 'TS Conformance Avatar',
          author: 'Test Author',
          licenseName: 'Other',
          allowedUserName: 'OnlyAuthor',
          violentUssageName: 'Disallow',
          sexualUssageName: 'Disallow',
          commercialUssageName: 'Disallow',
        },
        humanoid: {
          humanBones: VRM_REQUIRED_HUMANOID_BONES.map((bone, node) => ({ bone, node, useDefaultValues: true })),
        },
        firstPerson: { firstPersonBone: 4, meshAnnotations: [{ mesh: 0, firstPersonFlag: 'Auto' }] },
        blendShapeMaster: {
          blendShapeGroups: [
            { name: 'Neutral', presetName: 'neutral', binds: [] },
            { name: 'Joy', presetName: 'joy', binds: [{ mesh: 0, index: 0, weight: 100 }] },
          ],
        },
        secondaryAnimation: {
          boneGroups: [{ comment: 'Hair', stiffiness: 0.6, bones: [17], colliderGroups: [0] }],
          colliderGroups: [{ node: 4, colliders: [{ offset: { x: 0, y: 0.08, z: 0 }, radius: 0.1 }] }],
        },
      },
    },
  };

  if (mutator) mutator(gltf, bin);
  gltf.buffers[0].byteLength = bin.length;
  return packTestGlb(gltf, bin);
}

test('VRM 0.0 Conformance Suite (10 Fixtures): parity enforcement in TypeScript validator', () => {
  // 1. Valid minimal humanoid
  const f1 = buildMinimalConformanceVrm0();
  const r1 = validateVrmBinary(f1, '0.0');
  assert.equal(r1.valid, true, `Fixture 1 failed: ${JSON.stringify(r1.checks)}`);
  assert.equal(validateVrmBinary(f1, '1.0').valid, false);

  // 2. Valid VRoid J_Bip humanoid
  const f2 = buildMinimalConformanceVrm0((gltf) => {
    gltf.nodes[0].name = 'J_Bip_C_Hips';
    gltf.nodes[4].name = 'J_Bip_C_Head';
    gltf.nodes[17].name = 'J_Sec_Hair1_01';
    gltf.nodes.push({ name: 'J_Bip_L_Thumb1' }, { name: 'J_Bip_L_Thumb2' });
    gltf.extensions.VRM.humanoid.humanBones.push(
      { bone: 'leftThumbProximal', node: 19, useDefaultValues: true },
      { bone: 'leftThumbIntermediate', node: 20, useDefaultValues: true }
    );
  });
  assert.equal(validateVrmBinary(f2, '0.0').valid, true);

  // 3. Invalid preset names
  for (const badPreset of ['Joy', 'Blink', 'invalidPreset']) {
    const f3 = buildMinimalConformanceVrm0((gltf) => {
      gltf.extensions.VRM.blendShapeMaster.blendShapeGroups[1].presetName = badPreset;
    });
    assert.equal(validateVrmBinary(f3, '0.0').valid, false, `Expected presetName ${badPreset} to fail`);
  }

  // 4. Invalid snake_case bone names
  const f4 = buildMinimalConformanceVrm0((gltf) => {
    gltf.extensions.VRM.humanoid.humanBones[5].bone = 'left_upper_arm';
  });
  assert.equal(validateVrmBinary(f4, '0.0').valid, false);

  // 5. Invalid morph-target binds (bad mesh, bad target index, zero delta)
  assert.equal(
    validateVrmBinary(buildMinimalConformanceVrm0((g) => { g.extensions.VRM.blendShapeMaster.blendShapeGroups[1].binds[0].mesh = 99; }), '0.0').valid,
    false
  );
  assert.equal(
    validateVrmBinary(buildMinimalConformanceVrm0((g) => { g.extensions.VRM.blendShapeMaster.blendShapeGroups[1].binds[0].index = 7; }), '0.0').valid,
    false
  );
  assert.equal(
    validateVrmBinary(buildMinimalConformanceVrm0((g, bin) => {
      const acc = g.accessors[4];
      const bv = g.bufferViews[acc.bufferView];
      bin.fill(0, bv.byteOffset, bv.byteOffset + bv.byteLength);
    }), '0.0').valid,
    false
  );

  // 6. Invalid spring references (out-of-range node, humanoid bone in spring, bad colliderGroup)
  assert.equal(
    validateVrmBinary(buildMinimalConformanceVrm0((g) => { g.extensions.VRM.secondaryAnimation.boneGroups[0].bones = [999]; }), '0.0').valid,
    false
  );
  assert.equal(
    validateVrmBinary(buildMinimalConformanceVrm0((g) => { g.extensions.VRM.secondaryAnimation.boneGroups[0].bones = [4]; }), '0.0').valid,
    false
  );
  assert.equal(
    validateVrmBinary(buildMinimalConformanceVrm0((g) => { g.extensions.VRM.secondaryAnimation.boneGroups[0].colliderGroups = [9]; }), '0.0').valid,
    false
  );

  // 7. Invalid collider references (bad node, negative radius, invalid offset)
  assert.equal(
    validateVrmBinary(buildMinimalConformanceVrm0((g) => { g.extensions.VRM.secondaryAnimation.colliderGroups[0].node = 999; }), '0.0').valid,
    false
  );
  assert.equal(
    validateVrmBinary(buildMinimalConformanceVrm0((g) => { g.extensions.VRM.secondaryAnimation.colliderGroups[0].colliders[0].radius = -0.5; }), '0.0').valid,
    false
  );
  assert.equal(
    validateVrmBinary(buildMinimalConformanceVrm0((g) => { g.extensions.VRM.secondaryAnimation.colliderGroups[0].colliders[0].offset = { x: 0 }; }), '0.0').valid,
    false
  );

  // 8. Invalid metadata permission values
  assert.equal(
    validateVrmBinary(buildMinimalConformanceVrm0((g) => { g.extensions.VRM.meta.commercialUssageName = 'Yes'; }), '0.0').valid,
    false
  );
  assert.equal(
    validateVrmBinary(buildMinimalConformanceVrm0((g) => { g.extensions.VRM.meta.allowedUserName = 'Public'; }), '0.0').valid,
    false
  );
  assert.equal(
    validateVrmBinary(buildMinimalConformanceVrm0((g) => { g.extensions.VRM.meta.licenseName = 'MIT'; }), '0.0').valid,
    false
  );

  // 9. Missing or duplicate humanoid bones / duplicate node mappings
  assert.equal(
    validateVrmBinary(buildMinimalConformanceVrm0((g) => {
      g.extensions.VRM.humanoid.humanBones = g.extensions.VRM.humanoid.humanBones.filter((b: any) => b.bone !== 'hips');
    }), '0.0').valid,
    false
  );
  assert.equal(
    validateVrmBinary(buildMinimalConformanceVrm0((g) => {
      g.extensions.VRM.humanoid.humanBones.push({ bone: 'head', node: 17, useDefaultValues: true });
    }), '0.0').valid,
    false
  );
  assert.equal(
    validateVrmBinary(buildMinimalConformanceVrm0((g) => {
      g.extensions.VRM.humanoid.humanBones.push({ bone: 'jaw', node: 4, useDefaultValues: true });
    }), '0.0').valid,
    false
  );

  // 10. Malformed GLB containers
  assert.equal(validateVrmBinary(f1.subarray(0, f1.length - 8), '0.0').valid, false);
  const badLen = new Uint8Array(f1);
  new DataView(badLen.buffer).setUint32(8, 1234, true);
  assert.equal(validateVrmBinary(badLen, '0.0').valid, false);
});

test('blenderExecutor: isolation, stale report cleanup, abort/timeout handling, and run_id/hash verification', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrm-blender-exec-test-'));
  const glbPath = path.join(tmpDir, 'input.glb');
  const outDir = path.join(tmpDir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const sampleVrm = buildMinimalConformanceVrm0();
  fs.writeFileSync(glbPath, sampleVrm);

  try {
    // 1. Missing Blender reports attempted=false
    const noBlender = await runHeadlessBlenderPipeline({
      glbPath,
      outDir,
      vrmVersion: '0.0',
      blenderOverride: {
        installed: false,
        executablePath: null,
        version: null,
        vrmAddonDetected: false,
        platform: process.platform,
        searchedPaths: [],
        statusMessage: 'Not installed',
      },
    });
    assert.equal(noBlender.attempted, false);
    assert.equal(noBlender.succeeded, false);

    // 2. Missing VRM addon reports attempted=false
    const noAddon = await runHeadlessBlenderPipeline({
      glbPath,
      outDir,
      vrmVersion: '0.0',
      blenderOverride: {
        installed: true,
        executablePath: process.platform === 'win32' ? 'C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe' : '/usr/bin/blender',
        version: 'Blender 4.2.0',
        vrmAddonDetected: false,
        platform: process.platform,
        searchedPaths: [],
        statusMessage: 'Missing addon',
      },
    });
    assert.equal(noAddon.attempted, false);
    assert.equal(noAddon.succeeded, false);

    // 3. Pre-aborted signal returns attempted=false cleanly
    const preAbort = new AbortController();
    preAbort.abort();
    const abortedPre = await runHeadlessBlenderPipeline({
      glbPath,
      outDir,
      vrmVersion: '0.0',
      signal: preAbort.signal,
      blenderOverride: {
        installed: true,
        executablePath: '/usr/bin/blender',
        version: 'Blender 4.2.0',
        vrmAddonDetected: true,
        platform: 'linux',
        searchedPaths: [],
        statusMessage: 'ok',
      },
    });
    assert.equal(abortedPre.attempted, false);
    assert.equal(abortedPre.succeeded, false);
    assert.ok(abortedPre.reason?.toLowerCase().includes('aborted'));

    if (process.platform !== 'win32') {
      const fakeBinDir = path.join(tmpDir, 'fake_bin');
      fs.mkdirSync(fakeBinDir, { recursive: true });
      const fakeBlender = path.join(fakeBinDir, 'blender');
      const vrmSha = (await import('node:crypto')).createHash('sha256').update(sampleVrm).digest('hex');

      const writeFakeBlenderScript = (mode: 'mismatch_run' | 'no_py_val' | 'sleep_timeout' | 'valid') => {
        const script = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out-dir');
const runIdx = args.indexOf('--run-id');
const outDir = outIdx >= 0 ? args[outIdx + 1] : process.cwd();
const runId = runIdx >= 0 ? args[runIdx + 1] : '';
const mode = ${JSON.stringify(mode)};
if (mode === 'sleep_timeout') {
  setTimeout(() => process.exit(0), 5000);
  return;
}
fs.writeFileSync(path.join(outDir, 'character_blender.vrm'), Buffer.from(${JSON.stringify(Buffer.from(sampleVrm).toString('base64'))}, 'base64'));
fs.writeFileSync(path.join(outDir, 'character_blender.blend'), 'FAKEBLEND');
fs.writeFileSync(path.join(outDir, 'blender_report.json'), JSON.stringify({
  status: 'ok',
  run_id: mode === 'mismatch_run' ? 'stale-wrong-run-id' : runId,
  vrm_version: '0.0',
  vrm_export_success: true,
  vrm_reload_success: true,
  python_validator_available: mode !== 'no_py_val',
  output_vrm_sha256: ${JSON.stringify(vrmSha)},
  output_vrm_size: ${sampleVrm.byteLength},
}));
`;
        fs.writeFileSync(fakeBlender, script, 'utf8');
        fs.chmodSync(fakeBlender, 0o755);
      };

      const fakeDetection = {
        installed: true,
        executablePath: fakeBlender,
        version: 'Blender 4.2.0',
        vrmAddonDetected: true,
        platform: process.platform,
        searchedPaths: [],
        statusMessage: 'Mock Blender',
      };

      // Pre-seed stale report in outDir & test run_id mismatch rejection
      fs.writeFileSync(path.join(outDir, 'blender_report.json'), JSON.stringify({ status: 'ok', stale: true }));
      writeFakeBlenderScript('mismatch_run');
      const mismatchRes = await runHeadlessBlenderPipeline({
        glbPath,
        outDir,
        vrmVersion: '0.0',
        blenderOverride: fakeDetection,
      });
      assert.equal(mismatchRes.attempted, true);
      assert.equal(mismatchRes.succeeded, false);
      assert.ok(mismatchRes.reason?.toLowerCase().includes('run_id'));
      assert.equal(fs.existsSync(path.join(outDir, 'blender_report.json')), false);
      assert.equal(fs.existsSync(path.join(outDir, '_blender_runs')), false);

      // Missing Python validator flag must fail
      writeFakeBlenderScript('no_py_val');
      const noPyRes = await runHeadlessBlenderPipeline({
        glbPath,
        outDir,
        vrmVersion: '0.0',
        blenderOverride: fakeDetection,
      });
      assert.equal(noPyRes.succeeded, false);
      assert.ok(noPyRes.reason?.toLowerCase().includes('validator'));

      // Timeout handling & cleanup
      writeFakeBlenderScript('sleep_timeout');
      const timeoutRes = await runHeadlessBlenderPipeline({
        glbPath,
        outDir,
        vrmVersion: '0.0',
        timeoutMs: 80,
        blenderOverride: fakeDetection,
      });
      assert.equal(timeoutRes.succeeded, false);
      assert.ok(timeoutRes.reason?.toLowerCase().includes('timed out'));
      assert.equal(fs.existsSync(path.join(outDir, '_blender_runs')), false);

      // Valid isolated execution promotes outputs and cleans _blender_runs
      writeFakeBlenderScript('valid');
      const okRes = await runHeadlessBlenderPipeline({
        glbPath,
        outDir,
        vrmVersion: '0.0',
        blenderOverride: fakeDetection,
      });
      assert.equal(okRes.succeeded, true, `Expected valid mock Blender run to succeed: ${okRes.reason}`);
      assert.ok(okRes.vrmBuffer && okRes.vrmBuffer.byteLength === sampleVrm.byteLength);
      assert.equal(fs.existsSync(path.join(outDir, 'character_blender.vrm')), true);
      assert.equal(fs.existsSync(path.join(outDir, 'blender_report.json')), true);
      assert.equal(fs.existsSync(path.join(outDir, '_blender_runs')), false);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Production Acceptance 3: Custom VRM 0.0 spring physics, colliders, Ry(pi) collider offset, & humanoid spring stripping', () => {
  const { pos, uv, col, idx } = (() => {
    const parts = [
      makeBoxPart(0, 1.56, 0, 0.09, 0.11, 0.095),
      makeBoxPart(0, 1.15, 0, 0.16, 0.25, 0.10),
      makeBoxPart(0.36, 1.24, 0, 0.20, 0.05, 0.05),
      makeBoxPart(-0.36, 1.24, 0, 0.20, 0.05, 0.05),
      makeBoxPart(0.10, 0.45, 0, 0.06, 0.43, 0.06),
      makeBoxPart(-0.10, 0.45, 0, 0.06, 0.43, 0.06),
    ];
    const pArr: number[] = [];
    const uArr: number[] = [];
    const cArr: number[] = [];
    const iArr: number[] = [];
    for (const p of parts) {
      const base = pArr.length / 3;
      pArr.push(...p.positions);
      uArr.push(...p.uvs);
      cArr.push(...p.colors);
      for (const k of p.indices) iArr.push(base + k);
    }
    return {
      pos: new Float32Array(pArr),
      uv: new Float32Array(uArr),
      col: new Float32Array(cArr),
      idx: new Uint32Array(iArr),
    };
  })();

  const joints: Array<[string, number, [number, number, number]]> = [
    ['J_Bip_C_Hips', -1, [0, 0.9, 0]],
    ['J_Bip_C_Spine', 0, [0, 0.14, 0]],
    ['J_Bip_C_Chest', 1, [0, 0.18, 0]],
    ['J_Bip_C_UpperChest', 2, [0, 0.12, 0]],
    ['J_Bip_C_Neck', 3, [0, 0.12, 0]],
    ['J_Bip_C_Head', 4, [0, 0.12, 0]],
    ['CustomCape_01', 3, [0, 0.05, -0.11]],
    ['CustomCape_02', 6, [0, -0.25, -0.05]],
    ['J_Bip_L_UpperArm', 3, [0.18, 0.1, 0]],
    ['J_Bip_L_LowerArm', 8, [0.24, 0, 0]],
    ['J_Bip_L_Hand', 9, [0.22, 0, 0]],
    ['J_Bip_R_UpperArm', 3, [-0.18, 0.1, 0]],
    ['J_Bip_R_LowerArm', 11, [-0.24, 0, 0]],
    ['J_Bip_R_Hand', 12, [-0.22, 0, 0]],
    ['J_Bip_L_UpperLeg', 0, [0.1, -0.05, 0]],
    ['J_Bip_L_LowerLeg', 14, [0, -0.4, 0]],
    ['J_Bip_L_Foot', 15, [0, -0.4, 0]],
    ['J_Bip_R_UpperLeg', 0, [-0.1, -0.05, 0]],
    ['J_Bip_R_LowerLeg', 17, [0, -0.4, 0]],
    ['J_Bip_R_Foot', 18, [0, -0.4, 0]],
  ];

  const chunks: Uint8Array[] = [];
  const bufferViews: Array<Record<string, any>> = [];
  const accessors: Array<Record<string, any>> = [];
  let off = 0;
  const push = (bytes: Uint8Array, target?: number) => {
    const pad = (4 - (off % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      off += pad;
    }
    const bv = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes);
    off += bytes.length;
    return bv;
  };
  const posAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(pos.buffer), 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min: [-0.6, 0, -0.2], max: [0.6, 1.7, 0.2] });
  const uvAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(uv.buffer), 34962), componentType: 5126, count: uv.length / 2, type: 'VEC2' });
  const colAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(col.buffer), 34962), componentType: 5126, count: col.length / 4, type: 'VEC4' });
  const idxAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(idx.buffer), 34963), componentType: 5125, count: idx.length, type: 'SCALAR' });

  const vc = pos.length / 3;
  const jBytes = new Uint8Array(vc * 4);
  const wFloats = new Float32Array(vc * 4);
  for (let v = 0; v < vc; v++) {
    jBytes[v * 4] = 0;
    wFloats[v * 4] = 1.0;
  }
  const jAcc = accessors.length;
  accessors.push({ bufferView: push(jBytes, 34962), componentType: 5121, count: vc, type: 'VEC4' });
  const wAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(wFloats.buffer), 34962), componentType: 5126, count: vc, type: 'VEC4' });
  const ibm = new Float32Array(joints.length * 16);
  const worldPos: Array<[number, number, number]> = [];
  for (let i = 0; i < joints.length; i++) {
    const [, p, tr] = joints[i];
    const wp: [number, number, number] = p >= 0 ? [worldPos[p][0] + tr[0], worldPos[p][1] + tr[1], worldPos[p][2] + tr[2]] : tr;
    worldPos.push(wp);
    ibm[i * 16] = 1; ibm[i * 16 + 5] = 1; ibm[i * 16 + 10] = 1; ibm[i * 16 + 15] = 1;
    ibm[i * 16 + 12] = -wp[0]; ibm[i * 16 + 13] = -wp[1]; ibm[i * 16 + 14] = -wp[2];
  }
  const ibmAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(ibm.buffer)), componentType: 5126, count: joints.length, type: 'MAT4' });

  const nodes: Array<Record<string, any>> = [{ name: 'MeshNode', mesh: 0, skin: 0 }];
  const jointBase = 1;
  const childMap = new Map<number, number[]>();
  joints.forEach(([, p], i) => {
    if (p >= 0) {
      const list = childMap.get(p) ?? [];
      list.push(jointBase + i);
      childMap.set(p, list);
    }
  });
  joints.forEach(([name, , tr], i) => {
    const n: Record<string, any> = { name, translation: tr };
    const ch = childMap.get(i);
    if (ch?.length) n.children = ch;
    nodes.push(n);
  });

  const bin = new Uint8Array(off);
  let wp = 0;
  for (const ch of chunks) {
    bin.set(ch, wp);
    wp += ch.length;
  }

  const srcVrm0 = packTestGlb({
    asset: { version: '2.0' },
    extensionsUsed: ['VRM'],
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes,
    skins: [{ inverseBindMatrices: ibmAcc, skeleton: 1, joints: joints.map((_, i) => jointBase + i) }],
    meshes: [{
      name: 'Body',
      primitives: [{ attributes: { POSITION: posAcc, TEXCOORD_0: uvAcc, COLOR_0: colAcc, JOINTS_0: jAcc, WEIGHTS_0: wAcc }, indices: idxAcc, material: 0 }],
    }],
    materials: [{ name: 'Mat', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
    extensions: {
      VRM: {
        specVersion: '0.0',
        meta: {
          title: 'Locked Source Avatar',
          author: 'Original Artist',
          licenseName: 'Redistribution_Prohibited',
          allowedUserName: 'OnlyAuthor',
          violentUssageName: 'Disallow',
          sexualUssageName: 'Disallow',
          commercialUssageName: 'Disallow',
        },
        humanoid: {
          humanBones: [
            { bone: 'hips', node: jointBase + 0 },
            { bone: 'spine', node: jointBase + 1 },
            { bone: 'chest', node: jointBase + 2 },
            { bone: 'upperChest', node: jointBase + 3 },
            { bone: 'neck', node: jointBase + 4 },
            { bone: 'head', node: jointBase + 5 },
            { bone: 'leftUpperArm', node: jointBase + 8 },
            { bone: 'leftLowerArm', node: jointBase + 9 },
            { bone: 'leftHand', node: jointBase + 10 },
            { bone: 'rightUpperArm', node: jointBase + 11 },
            { bone: 'rightLowerArm', node: jointBase + 12 },
            { bone: 'rightHand', node: jointBase + 13 },
            { bone: 'leftUpperLeg', node: jointBase + 14 },
            { bone: 'leftLowerLeg', node: jointBase + 15 },
            { bone: 'leftFoot', node: jointBase + 16 },
            { bone: 'rightUpperLeg', node: jointBase + 17 },
            { bone: 'rightLowerLeg', node: jointBase + 18 },
            { bone: 'rightFoot', node: jointBase + 19 },
          ],
        },
        secondaryAnimation: {
          colliderGroups: [{ node: jointBase + 5, colliders: [{ offset: { x: 0.02, y: 0.09, z: 0.04 }, radius: 0.11 }] }],
          boneGroups: [
            {
              comment: 'RoyalCapePhysics',
              stiffiness: 0.88,
              gravityPower: 0.42,
              gravityDir: { x: 0, y: -1, z: 0 },
              dragForce: 0.31,
              hitRadius: 0.045,
              center: jointBase + 3,
              bones: [jointBase + 6, jointBase + 5], // Includes CustomCape_01 (valid) AND head (humanoid - must be stripped!)
              colliderGroups: [0],
            },
          ],
        },
      },
    },
  }, bin);

  const parsed = parseAndValidateGlbAsset(srcVrm0);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.existingVrmColliderGroups?.length, 1);
  assert.equal(parsed.existingVrmSprings?.[0]?.stiffiness, 0.88);
  assert.equal(parsed.sourceVrmMeta?.commercialUsage, 'Disallow');
  assert.equal(parsed.sourceVrmMeta?.licenseName, 'Redistribution_Prohibited');

  // Re-export VRM 0.0 (rotated Ry(pi) relative to unrotated glTF? Note source is VRM 0.0 so source nodes ALREADY are preserved/rotated per builder rules)
  const spec0 = parseCharacterPromptFallback(DARK_ELF_PROMPT, {
    vrmVersion: '0.0',
    vrmMetadata: createDefaultVrmMetadata(parsed.sourceVrmMeta?.title || 'Locked', parsed.sourceVrmMeta),
  });
  const built0 = buildRiggedVrmFromExternalMesh(spec0, parsed, srcVrm0);
  const v0Report = validateVrmBinary(built0.vrmBuffer, '0.0');
  assert.equal(v0Report.valid, true, `Spring VRM 0.0 invalid: ${JSON.stringify(v0Report.checks)}`);
  assert.equal(v0Report.colliderGroupCount, 1);
  assert.equal(v0Report.secondaryBoneGroupCount, 1);
  assert.ok(built0.rigReport?.warnings?.some((w) => w.includes('J_Bip_C_Head') || w.includes('humanoid')));

  const outGltf0 = readGlbJson(built0.vrmBuffer);
  const bg0 = outGltf0.extensions.VRM.secondaryAnimation.boneGroups[0];
  assert.ok(Math.abs(bg0.stiffiness - 0.88) < 1e-5);
  assert.ok(Math.abs(bg0.gravityPower - 0.42) < 1e-5);
  assert.ok(Math.abs(bg0.dragForce - 0.31) < 1e-5);
  assert.ok(Math.abs(bg0.hitRadius - 0.045) < 1e-5);
  assert.deepEqual(bg0.colliderGroups, [0]);
  assert.equal(bg0.bones.length, 1);
  assert.equal(outGltf0.nodes[bg0.bones[0]].name, 'CustomCape_01');
  const cg0 = outGltf0.extensions.VRM.secondaryAnimation.colliderGroups[0];
  assert.ok(Math.abs(cg0.colliders[0].radius - 0.11) < 1e-5);
  // rotateVrmY180 negates X and Z on collider offset
  assert.ok(Math.abs(cg0.colliders[0].offset.x - -0.02) < 1e-5);
  assert.ok(Math.abs(cg0.colliders[0].offset.z - -0.04) < 1e-5);

  // Also verify VRM 1.0 export converts boneGroups -> VRMC_springBone with chain joints & colliders
  const spec1 = parseCharacterPromptFallback(DARK_ELF_PROMPT, {
    vrmVersion: '1.0',
    vrmMetadata: createDefaultVrmMetadata(parsed.sourceVrmMeta?.title || 'Locked', parsed.sourceVrmMeta),
  });
  const built1 = buildRiggedVrmFromExternalMesh(spec1, parsed, srcVrm0);
  const v1Report = validateVrmBinary(built1.vrmBuffer, '1.0');
  assert.equal(v1Report.valid, true, `Spring VRM 1.0 invalid: ${JSON.stringify(v1Report.checks)}`);
  assert.equal(v1Report.colliderGroupCount, 1);
  const outGltf1 = readGlbJson(built1.vrmBuffer);
  const sb1 = outGltf1.extensions.VRMC_springBone;
  assert.equal(sb1.springs[0].joints.length, 2); // CustomCape_01 -> CustomCape_02 chain
  assert.equal(sb1.springs[0].joints[0].stiffness, 0.88);
  assert.deepEqual(sb1.springs[0].colliderGroups, [0]);
});

test('Production Acceptance 5 & 6: Morph NORMAL deltas inverse-transpose transform under non-uniform scale + multi-mesh hierarchy preservation', () => {
  const pos = new Float32Array([0, 1.5, 0, 1, 1.5, 0, 0, 1.6, 0]);
  const nrm = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const idx = new Uint16Array([0, 1, 2]);
  // Morph normal delta tilted at (1, 1, 0); tangent along surface is (1, -1, 0) (dot=0). Under scale (3, 1, 1), tangent -> (3, -1, 0) & inverse-transpose normal -> (1/3, 1, 0) (normalized), dot=0!
  const morphPos = new Float32Array([0, 0.02, 0, 0, 0.02, 0, 0, 0.02, 0]);
  const morphNrm = new Float32Array([1, 1, 0, 1, 1, 0, 1, 1, 0]);

  const chunks: Uint8Array[] = [];
  const bufferViews: Array<Record<string, any>> = [];
  const accessors: Array<Record<string, any>> = [];
  let off = 0;
  const push = (bytes: Uint8Array, target?: number) => {
    const pad = (4 - (off % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      off += pad;
    }
    const bv = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes);
    off += bytes.length;
    return bv;
  };
  accessors.push({ bufferView: push(new Uint8Array(pos.buffer), 34962), componentType: 5126, count: 3, type: 'VEC3', min: [0, 1.5, 0], max: [1, 1.6, 0] });
  accessors.push({ bufferView: push(new Uint8Array(nrm.buffer), 34962), componentType: 5126, count: 3, type: 'VEC3' });
  accessors.push({ bufferView: push(new Uint8Array(idx.buffer), 34963), componentType: 5123, count: 3, type: 'SCALAR' });
  accessors.push({ bufferView: push(new Uint8Array(morphPos.buffer), 34962), componentType: 5126, count: 3, type: 'VEC3' });
  accessors.push({ bufferView: push(new Uint8Array(morphNrm.buffer), 34962), componentType: 5126, count: 3, type: 'VEC3' });
  const bin = new Uint8Array(off);
  let wp = 0;
  for (const ch of chunks) {
    bin.set(ch, wp);
    wp += ch.length;
  }

  const nonUniformGlb = packTestGlb({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'ParentScaleNode', scale: [3, 1, 1], translation: [0, 0.1, 0], children: [1] },
      { name: 'ChildMeshNode', mesh: 0, translation: [0, -0.1, 0] },
    ],
    meshes: [{
      name: 'FaceMesh',
      extras: { targetNames: ['Fcl_MTH_A'] },
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1 },
        indices: 2,
        material: 0,
        targets: [{ POSITION: 3, NORMAL: 4 }],
      }],
    }],
    materials: [{ name: 'SkinMat', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  }, bin);

  const parsed = parseAndValidateGlbAsset(nonUniformGlb);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.hasNodeTransforms, true);
  const mTarget = parsed.meshes[0].primitives[0].morphTargets[0];
  assert.ok(mTarget.normals && mTarget.normals.length === 9);
  // Check perpendicularity to scaled tangent (3, -1, 0)
  const nx = mTarget.normals[0];
  const ny = mTarget.normals[1];
  assert.ok(nx > 0 && ny > nx * 2.5, `Expected inverse-transpose X shrink relative to Y: nx=${nx}, ny=${ny}`);
  const dot = 3 * nx + -1 * ny;
  assert.ok(Math.abs(dot) < 1e-4, `Expected transformed morph NORMAL perpendicular to scaled tangent, got dot=${dot}`);

  // Also ensure full VRM build preserves targets[].NORMAL in output VRM binary
  const spec = parseCharacterPromptFallback(AURELIA_SERAPHIS_PROMPT);
  const built = buildRiggedVrmFromExternalMesh(spec, parsed, nonUniformGlb);
  assert.equal(validateVrmBinary(built.vrmBuffer, '0.0').valid, true);
  const outGltf = readGlbJson(built.vrmBuffer);
  const outTargets = outGltf.meshes[0].primitives[0].targets;
  assert.ok(outTargets.some((t: any) => typeof t.NORMAL === 'number'), 'Expected NORMAL delta accessor preserved in VRM');
});

test('Production Acceptance 7: 8-influence JOINTS_1/WEIGHTS_1 preservation, incompatible multi-skin audit, license non-relaxation, & regression baselines', () => {
  const { pos, uv, col, idx } = (() => {
    const parts = [
      makeBoxPart(0, 1.56, 0, 0.09, 0.11, 0.095),
      makeBoxPart(0, 1.0, 0, 0.16, 0.35, 0.10),
    ];
    const pArr: number[] = [];
    const uArr: number[] = [];
    const cArr: number[] = [];
    const iArr: number[] = [];
    for (const p of parts) {
      const base = pArr.length / 3;
      pArr.push(...p.positions);
      uArr.push(...p.uvs);
      cArr.push(...p.colors);
      for (const k of p.indices) iArr.push(base + k);
    }
    return {
      pos: new Float32Array(pArr),
      uv: new Float32Array(uArr),
      col: new Float32Array(cArr),
      idx: new Uint32Array(iArr),
    };
  })();
  const joints: Array<[string, number, [number, number, number]]> = [
    ['Hips', -1, [0, 0.9, 0]],
    ['Spine', 0, [0, 0.14, 0]],
    ['Chest', 1, [0, 0.18, 0]],
    ['Neck', 2, [0, 0.18, 0]],
    ['Head', 3, [0, 0.12, 0]],
    ['LeftUpperArm', 2, [0.18, 0.12, 0]],
    ['LeftLowerArm', 5, [0.24, 0, 0]],
    ['LeftHand', 6, [0.22, 0, 0]],
    ['RightUpperArm', 2, [-0.18, 0.12, 0]],
    ['RightLowerArm', 8, [-0.24, 0, 0]],
    ['RightHand', 9, [-0.22, 0, 0]],
    ['LeftUpperLeg', 0, [0.1, -0.05, 0]],
    ['LeftLowerLeg', 11, [0, -0.4, 0]],
    ['LeftFoot', 12, [0, -0.4, 0]],
    ['RightUpperLeg', 0, [-0.1, -0.05, 0]],
    ['RightLowerLeg', 14, [0, -0.4, 0]],
    ['RightFoot', 15, [0, -0.4, 0]],
  ];

  const vc = pos.length / 3;
  const j0 = new Uint8Array(vc * 4);
  const w0 = new Float32Array(vc * 4);
  const j1 = new Uint8Array(vc * 4);
  const w1 = new Float32Array(vc * 4);
  for (let v = 0; v < vc; v++) {
    // Spread non-trivial weights across all 8 influences (sum = 1.0)
    j0.set([0, 1, 2, 3], v * 4);
    w0.set([0.2, 0.15, 0.15, 0.1], v * 4);
    j1.set([4, 5, 8, 11], v * 4);
    w1.set([0.1, 0.1, 0.1, 0.1], v * 4);
  }

  const chunks: Uint8Array[] = [];
  const bufferViews: Array<Record<string, any>> = [];
  const accessors: Array<Record<string, any>> = [];
  let off = 0;
  const push = (bytes: Uint8Array, target?: number) => {
    const pad = (4 - (off % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      off += pad;
    }
    const bv = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes);
    off += bytes.length;
    return bv;
  };
  const posAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(pos.buffer), 34962), componentType: 5126, count: vc, type: 'VEC3', min: [-0.2, 0.4, -0.15], max: [0.2, 1.6, 0.15] });
  const uvAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(uv.buffer), 34962), componentType: 5126, count: vc, type: 'VEC2' });
  const colAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(col.buffer), 34962), componentType: 5126, count: vc, type: 'VEC4' });
  const idxAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(idx.buffer), 34963), componentType: 5125, count: idx.length, type: 'SCALAR' });
  const j0Acc = accessors.length;
  accessors.push({ bufferView: push(j0, 34962), componentType: 5121, count: vc, type: 'VEC4' });
  const w0Acc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(w0.buffer), 34962), componentType: 5126, count: vc, type: 'VEC4' });
  const j1Acc = accessors.length;
  accessors.push({ bufferView: push(j1, 34962), componentType: 5121, count: vc, type: 'VEC4' });
  const w1Acc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(w1.buffer), 34962), componentType: 5126, count: vc, type: 'VEC4' });

  const ibm = new Float32Array(joints.length * 16);
  for (let i = 0; i < joints.length; i++) {
    ibm[i * 16] = 1; ibm[i * 16 + 5] = 1; ibm[i * 16 + 10] = 1; ibm[i * 16 + 15] = 1;
  }
  const ibmAcc = accessors.length;
  accessors.push({ bufferView: push(new Uint8Array(ibm.buffer)), componentType: 5126, count: joints.length, type: 'MAT4' });

  const nodes: Array<Record<string, any>> = [
    { name: 'BodyMeshNode', mesh: 0, skin: 0 },
    { name: 'AccessoryMeshNode', mesh: 0, skin: 1 },
  ];
  const jointBase = 2;
  joints.forEach(([name, , tr]) => nodes.push({ name, translation: tr }));
  nodes.push({ name: 'ExtraUnsharedPropBone', translation: [0, 0.3, 0] }); // 19: incompatible secondary skin joint
  const bin = new Uint8Array(off);
  let wp = 0;
  for (const ch of chunks) {
    bin.set(ch, wp);
    wp += ch.length;
  }

  const eightInflGlb = packTestGlb({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2, 19] }],
    nodes,
    skins: [
      { name: 'MainHumanoidSkin', inverseBindMatrices: ibmAcc, joints: joints.map((_, i) => jointBase + i) },
      { name: 'IncompatiblePropSkin', joints: [19] },
    ],
    meshes: [{
      name: 'OctaWeightedMesh',
      primitives: [{
        attributes: {
          POSITION: posAcc, TEXCOORD_0: uvAcc, COLOR_0: colAcc,
          JOINTS_0: j0Acc, WEIGHTS_0: w0Acc,
          JOINTS_1: j1Acc, WEIGHTS_1: w1Acc,
        },
        indices: idxAcc,
        material: 0,
      }],
    }],
    materials: [{ name: 'Mat', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  }, bin);

  const parsed = parseAndValidateGlbAsset(eightInflGlb);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.hasMultiInfluenceSkin, true);
  assert.equal(parsed.multiSkinAudit?.allSkinsCompatible, false);
  assert.deepEqual(parsed.multiSkinAudit?.incompatibleSkins, [1]);

  const spec = parseCharacterPromptFallback(DARK_ELF_PROMPT, { id: 'vaelith_8infl', name: 'Vaelith Nightshade' });
  const built = buildRiggedVrmFromExternalMesh(spec, parsed, eightInflGlb);
  assert.equal(built.rigReport?.lossyConversion, true);
  assert.ok((built.rigReport?.warnings?.length ?? 0) >= 1);

  const rep = validateVrmBinary(built.vrmBuffer, '0.0');
  assert.equal(rep.valid, true, `8-influence VRM failed validation: ${JSON.stringify(rep.checks)}`);
  assert.equal(rep.skinWeightsValid, true);
  const outGltf = readGlbJson(built.vrmBuffer);
  const primAttrs = outGltf.meshes[0].primitives[0].attributes;
  assert.ok(typeof primAttrs.JOINTS_1 === 'number' && typeof primAttrs.WEIGHTS_1 === 'number', 'Expected JOINTS_1 & WEIGHTS_1 in exported VRM');

  // Source metadata & licensing non-relaxation guarantees
  const restrictions = {
    allowedUserName: 'OnlyAuthor' as const,
    commercialUsage: 'Disallow' as const,
    violentUsage: 'Disallow' as const,
    sexualUsage: 'Disallow' as const,
    allowRedistribution: false,
    modification: 'prohibited' as const,
    licenseName: 'Redistribution_Prohibited' as const,
  };
  const violations = checkSourceLicenseViolations(
    { commercialUsage: 'Allow', allowedUserName: 'Everyone', licenseName: 'CC0' },
    restrictions
  );
  assert.ok(violations.length >= 3);

  const clamped = clampMetadataToSourceRestrictions(
    createDefaultVrmMetadata('Test', {
      commercialUsage: 'Allow',
      allowedUserName: 'Everyone',
      licenseName: 'CC0',
      allowRedistribution: true,
      modification: 'allowModificationRedistribution',
    }),
    restrictions
  );
  assert.equal(clamped.commercialUsage, 'Disallow');
  assert.equal(clamped.allowedUserName, 'OnlyAuthor');
  assert.equal(clamped.licenseName, 'Redistribution_Prohibited');
  assert.equal(clamped.allowRedistribution, false);
  assert.equal(clamped.modification, 'prohibited');

  // Spec validation gate blocks license widening
  const lockedSpec = parseCharacterPromptFallback(AURELIA_SERAPHIS_PROMPT, {
    vrmMetadata: createDefaultVrmMetadata('Aurelia Locked', {
      ...restrictions,
      sourceRestrictions: restrictions,
    }),
  });
  const widenedSpec = {
    ...lockedSpec,
    vrmMetadata: { ...lockedSpec.vrmMetadata!, commercialUsage: 'Allow' as const },
  };
  const specCheck = validateCharacterSpecification(widenedSpec);
  assert.equal(specCheck.valid, false);
  assert.ok(specCheck.violations.some((v) => v.toLowerCase().includes('commercial')));
});


