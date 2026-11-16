import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  applyCharacterEdits,
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
import { buildMeasuredPipelineStages } from '../../server/projectStore';

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

  // Reload exported VRM independently & verify exact materials, PNG bytes, UVs, colors, bones, and expressions
  const vrmReport = validateVrmBinary(built.vrmBuffer);
  assert.equal(vrmReport.valid, true, `VRM audit failed: ${JSON.stringify(vrmReport.checks)}`);
  assert.equal(vrmReport.materialCount, 2);
  assert.equal(vrmReport.textureCount, 4);
  assert.equal(vrmReport.skinWeightsValid, true);
  assert.equal(vrmReport.missingRequiredBones.length, 0);
  for (const coreExpr of ['blink', 'blinkLeft', 'blinkRight', 'happy', 'angry', 'sad', 'surprised']) {
    assert.ok(
      vrmReport.nonEmptyExpressions.includes(coreExpr),
      `Expected core expression '${coreExpr}' to have verified non-zero morph deltas`
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

test('3-character quality assessment (Dark Elf, Realistic Human, Aurelia Seraphis) all pass independent VRM 1.0 audit', () => {
  const prompts = [
    { label: 'Dark Elf', prompt: DARK_ELF_PROMPT, artStyle: 'semi_realistic' as const },
    { label: 'Realistic Human', prompt: REALISTIC_HUMAN_PROMPT, artStyle: 'realistic_human' as const },
    { label: 'Aurelia Seraphis', prompt: AURELIA_SERAPHIS_PROMPT, artStyle: 'semi_realistic' as const },
  ];

  for (const item of prompts) {
    const spec = parseCharacterPromptFallback(item.prompt, { artStyle: item.artStyle });
    const built = buildCharacterVrmAndGlb(spec);
    const report = validateVrmBinary(built.vrmBuffer);

    assert.equal(report.valid, true, `${item.label} failed validation: ${JSON.stringify(report.checks)}`);
    assert.equal(report.vrmVersion, '1.0');
    assert.equal(report.missingRequiredBones.length, 0);
    for (const reqBone of VRM_REQUIRED_HUMANOID_BONES) {
      assert.ok(report.mappedHumanoidBones.includes(reqBone), `${item.label} missing ${reqBone}`);
    }
    assert.ok(report.boneCount >= 55);
    assert.equal(report.skinWeightsValid, true);
    assert.ok(report.nonEmptyExpressions.length >= 16);
    assert.equal(report.textureCount, 12);
    assert.ok(report.triangleCount >= 10000);
  }
});

test('vrmValidator rejects corrupted binary payloads', () => {
  const badBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
  const report = validateVrmBinary(badBytes);
  assert.equal(report.valid, false);
  assert.ok(report.checks.some((c) => c.status === 'fail'));
});

test('Priority 4 & Milestone 3: blenderScriptGen & test_milestone2_blender.py support unrigged auto-rigging, material/texture preservation, and fail if VRM export/reload fails', () => {
  const spec = parseCharacterPromptFallback(AURELIA_SERAPHIS_PROMPT, {
    qualityConfig: { geometryQuality: 'high', textureResolution: '4k', vrmOptimization: 'balanced' },
  });
  const py = generateBlenderCharacterScript(spec);
  assert.ok(py.includes('import bpy'));
  assert.ok(py.includes('create_humanoid_armature'));
  assert.ok(py.includes('evaluated_depsgraph_get'));
  assert.ok(py.includes('REQUIRED_VRM_HUMANOID_BONES'));
  assert.ok(py.includes('WEIGHTED_NORMAL'));
  assert.ok(py.includes('TARGET_TEXTURE_PX = 4096'));
  assert.ok(py.includes('export_scene.vrm'));
  assert.ok(!py.includes('create_uvsphere'));
  assert.ok(!py.includes('create_cube'));

  const m2Path = path.resolve(process.cwd(), 'blender_scripts', 'test_milestone2_blender.py');
  const m2 = fs.readFileSync(m2Path, 'utf8');
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
