import {
  BoneDef,
  PrimitiveBuild,
  buildHighDetailCharacterGeometry,
  getOptimizedBudget,
  getQualityBudget,
} from './anatomicalSculptor';
import {
  generateProceduralTexturePng,
  parseHexRgb,
  resolvePackedTextureSize,
  textureResolutionToTargetPx,
} from './pngEncoder';
import {
  CharacterSpecification,
  ExportEstimates,
  VRM_EXPRESSION_PRESETS,
  VRM_REQUIRED_HUMANOID_BONES,
} from './types';

export interface BuiltStats {
  vertexCount: number;
  triangleCount: number;
  boneCount: number;
  materialCount: number;
  textureCount: number;
  expressionCount: number;
  springBoneJointCount: number;
}

export interface BuiltVrmResult {
  vrmBuffer: Uint8Array;
  glbBuffer: Uint8Array;
  sourceGlbBuffer: Uint8Array;
  stats: BuiltStats;
  sourceStats: BuiltStats;
  estimates: ExportEstimates;
}

export function buildHumanoidSkeleton(spec: CharacterSpecification): BoneDef[] {
  const hScale = spec.proportions.heightMeters / 1.7;
  const sW = spec.proportions.shoulderWidthScale;
  const hW = spec.proportions.hipWidthScale;
  const limb = spec.proportions.limbLengthScale;
  const headS = spec.proportions.headScale;

  const bones: BoneDef[] = [];
  const addBone = (
    name: string,
    parent: number,
    worldPos: [number, number, number],
    vrmName?: string
  ): number => {
    const parentWorld = parent >= 0 ? bones[parent].worldPos : [0, 0, 0];
    const localPos: [number, number, number] = [
      worldPos[0] - parentWorld[0],
      worldPos[1] - parentWorld[1],
      worldPos[2] - parentWorld[2],
    ];
    const idx = bones.length;
    bones.push({ name, vrmName, parent, localPos, worldPos });
    return idx;
  };

  // Central Spine
  const hipsY = 0.94 * hScale * limb;
  const hips = addBone('hips', -1, [0, hipsY, 0], 'hips');
  const spine = addBone('spine', hips, [0, hipsY + 0.12 * hScale, 0], 'spine');
  const chest = addBone('chest', spine, [0, hipsY + 0.25 * hScale, 0], 'chest');
  const upperChest = addBone('upperChest', chest, [0, hipsY + 0.39 * hScale, 0], 'upperChest');
  const neck = addBone('neck', upperChest, [0, hipsY + 0.49 * hScale, 0], 'neck');
  const headY = hipsY + 0.58 * hScale;
  const head = addBone('head', neck, [0, headY, 0], 'head');

  // Face bones aligned to recessed eye sockets and jaw
  addBone('leftEye', head, [0.0315 * headS, headY + 0.103 * headS, 0.084 * headS], 'leftEye');
  addBone('rightEye', head, [-0.0315 * headS, headY + 0.103 * headS, 0.084 * headS], 'rightEye');
  addBone('jaw', head, [0, headY + 0.018 * headS, 0.025 * headS], 'jaw');

  // Arms (VRM 1.0: +X = Left, -X = Right)
  const shoulderY = hipsY + 0.43 * hScale;
  const shoulderX = 0.07 * sW;
  const upperArmX = 0.165 * sW;
  const elbowX = upperArmX + 0.25 * hScale * limb;
  const wristX = elbowX + 0.23 * hScale * limb;

  const addArm = (side: 'left' | 'right', sign: 1 | -1) => {
    const sh = addBone(`${side}Shoulder`, upperChest, [sign * shoulderX, shoulderY, 0], `${side}Shoulder`);
    const ua = addBone(`${side}UpperArm`, sh, [sign * upperArmX, shoulderY - 0.01 * hScale, 0], `${side}UpperArm`);
    const la = addBone(`${side}LowerArm`, ua, [sign * elbowX, shoulderY - 0.015 * hScale, 0], `${side}LowerArm`);
    const hand = addBone(`${side}Hand`, la, [sign * wristX, shoulderY - 0.015 * hScale, 0], `${side}Hand`);

    const fingerSpecs: Array<{
      key: string;
      zOffset: number;
      proxLen: number;
      intLen: number;
      distLen: number;
      isThumb?: boolean;
    }> = [
      { key: 'Thumb', zOffset: 0.026, proxLen: 0.028, intLen: 0.022, distLen: 0.018, isThumb: true },
      { key: 'Index', zOffset: 0.022, proxLen: 0.034, intLen: 0.022, distLen: 0.016 },
      { key: 'Middle', zOffset: 0.008, proxLen: 0.038, intLen: 0.025, distLen: 0.017 },
      { key: 'Ring', zOffset: -0.008, proxLen: 0.035, intLen: 0.022, distLen: 0.016 },
      { key: 'Little', zOffset: -0.022, proxLen: 0.028, intLen: 0.018, distLen: 0.014 },
    ];

    for (const f of fingerSpecs) {
      const baseX = wristX + (f.isThumb ? 0.022 : 0.065);
      const baseY = shoulderY - 0.015 * hScale + (f.isThumb ? -0.01 : 0);
      if (f.isThumb) {
        const meta = addBone(
          `${side}ThumbMetacarpal`,
          hand,
          [sign * baseX, baseY, f.zOffset],
          `${side}ThumbMetacarpal`
        );
        const prox = addBone(
          `${side}ThumbProximal`,
          meta,
          [sign * (baseX + f.proxLen), baseY - 0.008, f.zOffset + 0.012],
          `${side}ThumbProximal`
        );
        addBone(
          `${side}ThumbDistal`,
          prox,
          [sign * (baseX + f.proxLen + f.intLen), baseY - 0.012, f.zOffset + 0.02],
          `${side}ThumbDistal`
        );
      } else {
        const prox = addBone(
          `${side}${f.key}Proximal`,
          hand,
          [sign * baseX, baseY, f.zOffset],
          `${side}${f.key}Proximal`
        );
        const inter = addBone(
          `${side}${f.key}Intermediate`,
          prox,
          [sign * (baseX + f.proxLen), baseY, f.zOffset],
          `${side}${f.key}Intermediate`
        );
        addBone(
          `${side}${f.key}Distal`,
          inter,
          [sign * (baseX + f.proxLen + f.intLen), baseY, f.zOffset],
          `${side}${f.key}Distal`
        );
      }
    }
  };

  addArm('left', 1);
  addArm('right', -1);

  // Legs
  const hipJointX = 0.092 * hW;
  const kneeY = hipsY * 0.52;
  const ankleY = 0.08 * hScale;
  const addLeg = (side: 'left' | 'right', sign: 1 | -1) => {
    const ul = addBone(`${side}UpperLeg`, hips, [sign * hipJointX, hipsY - 0.04 * hScale, 0], `${side}UpperLeg`);
    const ll = addBone(`${side}LowerLeg`, ul, [sign * hipJointX, kneeY, 0.01], `${side}LowerLeg`);
    const ft = addBone(`${side}Foot`, ll, [sign * hipJointX, ankleY, -0.01], `${side}Foot`);
    addBone(`${side}Toes`, ft, [sign * hipJointX, 0.02, 0.11], `${side}Toes`);
  };
  addLeg('left', 1);
  addLeg('right', -1);

  // Secondary Spring Bones (Hair & Cloak)
  const hairBackRoot = addBone('hairBackRoot', head, [0, headY + 0.05 * headS, -0.095 * headS]);
  const hairBackMid = addBone('hairBackMid', hairBackRoot, [0, headY - 0.16 * hScale, -0.135]);
  addBone('hairBackTip', hairBackMid, [0, headY - 0.38 * hScale, -0.15]);

  const hairLeftRoot = addBone('hairLeftRoot', head, [0.085 * headS, headY + 0.04 * headS, 0.02]);
  addBone('hairLeftTip', hairLeftRoot, [0.105 * headS, headY - 0.18 * hScale, 0.03]);

  const hairRightRoot = addBone('hairRightRoot', head, [-0.085 * headS, headY + 0.04 * headS, 0.02]);
  addBone('hairRightTip', hairRightRoot, [-0.105 * headS, headY - 0.18 * hScale, 0.03]);

  const cloakTop = addBone('cloakTop', upperChest, [0, shoulderY, -0.09]);
  const cloakMid = addBone('cloakMid', cloakTop, [0, hipsY + 0.05 * hScale, -0.16]);
  addBone('cloakHem', cloakMid, [0, 0.25 * hScale, -0.22]);

  return bones;
}

const MORPH_EXPRESSION_NAMES = VRM_EXPRESSION_PRESETS.filter((n) => n !== 'neutral');

function computeMorphTargetsForPrimitive(
  prim: PrimitiveBuild
): Array<{ name: string; deltas: Float32Array }> {
  const vertCount = prim.positions.length / 3;
  const tags = prim.faceTags || [];
  const fl = prim.faceLocal;
  const targets: Array<{ name: string; deltas: Float32Array }> = [];
  const gauss = (v: number, c: number, s: number) => Math.exp(-Math.pow((v - c) / s, 2));

  for (const expr of MORPH_EXPRESSION_NAMES) {
    const deltas = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount; i++) {
      const region = tags[i]?.region ?? 'none';
      let dx = 0;
      let dy = 0;
      let dz = 0;

      if (fl && fl.length === vertCount * 3) {
        const nx = fl[i * 3];
        const ny = fl[i * 3 + 1];
        const nz = fl[i * 3 + 2];
        if (nz > 0.25) {
          const front = Math.min(1, (nz - 0.25) / 0.45);
          const eyeL = gauss(nx, 0.34, 0.13) * front;
          const eyeR = gauss(nx, -0.34, 0.13) * front;
          const upperLidL = eyeL * gauss(ny, 0.125, 0.045);
          const lowerLidL = eyeL * gauss(ny, 0.02, 0.042);
          const upperLidR = eyeR * gauss(ny, 0.125, 0.045);
          const lowerLidR = eyeR * gauss(ny, 0.02, 0.042);

          const browBand = gauss(ny, 0.24, 0.065) * front;
          const browInL = browBand * gauss(nx, 0.16, 0.12);
          const browOutL = browBand * gauss(nx, 0.4, 0.14);
          const browInR = browBand * gauss(nx, -0.16, 0.12);
          const browOutR = browBand * gauss(nx, -0.4, 0.14);

          const mouthWidth = gauss(nx, 0, 0.28) * front;
          const cornerL = gauss(nx, 0.24, 0.1) * gauss(ny, -0.386, 0.065) * front;
          const cornerR = gauss(nx, -0.24, 0.1) * gauss(ny, -0.386, 0.065) * front;
          const upperLip = mouthWidth * gauss(ny, -0.352, 0.042);
          const lowerLip = mouthWidth * gauss(ny, -0.42, 0.05);
          const mouthCavity = gauss(nx, 0, 0.2) * gauss(ny, -0.386, 0.026) * front;
          const jawArea = gauss(nx, 0, 0.34) * gauss(ny, -0.66, 0.22) * front;
          const cheekLift =
            (gauss(nx, 0.44, 0.18) + gauss(nx, -0.44, 0.18)) * gauss(ny, -0.14, 0.14) * front;

          if (expr === 'blink' || expr === 'blinkLeft') {
            dy += -0.0135 * upperLidL + 0.0055 * lowerLidL;
            dz += 0.003 * upperLidL;
          }
          if (expr === 'blink' || expr === 'blinkRight') {
            dy += -0.0135 * upperLidR + 0.0055 * lowerLidR;
            dz += 0.003 * upperLidR;
          }
          if (expr === 'happy') {
            dy += (cornerL + cornerR) * 0.011 + upperLip * 0.002 + cheekLift * 0.006 + (lowerLidL + lowerLidR) * 0.0035;
            dx += cornerL * 0.006 - cornerR * 0.006;
            dz += cheekLift * 0.004 + upperLip * 0.0015;
          }
          if (expr === 'angry') {
            dy += -(browInL + browInR) * 0.012 + (browOutL + browOutR) * 0.005 - (upperLidL + upperLidR) * 0.005 - (cornerL + cornerR) * 0.006;
            dz += (browInL + browInR) * 0.004;
          }
          if (expr === 'sad') {
            dy += (browInL + browInR) * 0.01 - (browOutL + browOutR) * 0.006 - (cornerL + cornerR) * 0.011;
          }
          if (expr === 'relaxed') {
            dy += -(upperLidL + upperLidR) * 0.005 + (cornerL + cornerR) * 0.005;
          }
          if (expr === 'surprised') {
            dy += (browInL + browInR + browOutL + browOutR) * 0.012 + (upperLidL + upperLidR) * 0.006 - (lowerLip + jawArea) * 0.016;
            dz += -(lowerLip + jawArea) * 0.003 - mouthCavity * 0.014;
          }
          if (expr === 'aa') {
            dy += upperLip * 0.006 - (lowerLip * 0.02 + jawArea * 0.021);
            dz += -(lowerLip + jawArea) * 0.003 - mouthCavity * 0.016;
          }
          if (expr === 'ih') {
            dx += cornerL * 0.008 - cornerR * 0.008;
            dy += -lowerLip * 0.007;
            dz += -mouthCavity * 0.007;
          }
          if (expr === 'ou') {
            dx += -cornerL * 0.007 + cornerR * 0.007;
            dz += (upperLip + lowerLip) * 0.009 - mouthCavity * 0.012;
            dy += -lowerLip * 0.008;
          }
          if (expr === 'ee') {
            dx += cornerL * 0.007 - cornerR * 0.007;
            dy += (cornerL + cornerR) * 0.003 - lowerLip * 0.008;
            dz += -mouthCavity * 0.006;
          }
          if (expr === 'oh') {
            dy += upperLip * 0.005 - (lowerLip * 0.015 + jawArea * 0.016);
            dz += upperLip * 0.005 + lowerLip * 0.004 - mouthCavity * 0.015;
          }
        }
      } else if (region !== 'none') {
        if (expr === 'lookUp' && (region === 'iris_l' || region === 'iris_r')) dy = 0.006;
        if (expr === 'lookDown' && (region === 'iris_l' || region === 'iris_r')) dy = -0.006;
        if (expr === 'lookLeft' && (region === 'iris_l' || region === 'iris_r')) dx = 0.006;
        if (expr === 'lookRight' && (region === 'iris_l' || region === 'iris_r')) dx = -0.006;
      }

      deltas[i * 3] = dx;
      deltas[i * 3 + 1] = dy;
      deltas[i * 3 + 2] = dz;
    }
    targets.push({ name: expr, deltas });
  }

  return targets;
}

function packGlbBinary(gltfJson: Record<string, unknown>, binBytes: Uint8Array): Uint8Array {
  const jsonStr = JSON.stringify(gltfJson);
  const rawJsonBytes = new TextEncoder().encode(jsonStr);
  const jsonPad = (4 - (rawJsonBytes.length % 4)) % 4;
  const jsonChunkLen = rawJsonBytes.length + jsonPad;

  const binPad = (4 - (binBytes.length % 4)) % 4;
  const binChunkLen = binBytes.length + binPad;

  const totalLen = 12 + 8 + jsonChunkLen + 8 + binChunkLen;
  const out = new Uint8Array(totalLen);
  const view = new DataView(out.buffer);

  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLen, true);

  view.setUint32(12, jsonChunkLen, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(rawJsonBytes, 20);
  for (let i = 0; i < jsonPad; i++) {
    out[20 + rawJsonBytes.length + i] = 0x20;
  }

  const binHeaderOffset = 20 + jsonChunkLen;
  view.setUint32(binHeaderOffset, binChunkLen, true);
  view.setUint32(binHeaderOffset + 4, 0x004e4942, true);
  out.set(binBytes, binHeaderOffset + 8);

  return out;
}

function assembleGltfPackage(
  spec: CharacterSpecification,
  bones: BoneDef[],
  primitives: PrimitiveBuild[],
  texPx: number,
  includeNormalMaps: boolean
): {
  glbBuffer: Uint8Array;
  vrmBuffer: Uint8Array;
  stats: BuiltStats;
} {
  const chunks: Uint8Array[] = [];
  let byteOffset = 0;
  const bufferViews: Array<Record<string, unknown>> = [];
  const accessors: Array<Record<string, unknown>> = [];

  const pushBufferSlice = (bytes: Uint8Array, target?: number): number => {
    const pad = (4 - (byteOffset % 4)) % 4;
    if (pad > 0) {
      chunks.push(new Uint8Array(pad));
      byteOffset += pad;
    }
    const bvIdx = bufferViews.length;
    const bv: Record<string, unknown> = {
      buffer: 0,
      byteOffset,
      byteLength: bytes.length,
    };
    if (target) bv.target = target;
    bufferViews.push(bv);
    chunks.push(bytes);
    byteOffset += bytes.length;
    return bvIdx;
  };

  // 1. High-Detail PBR Albedo + Tangent-Space Normal Map PNG Textures
  const normalPx = Math.max(128, Math.min(256, texPx));
  const textureDefs: Array<{ name: string; bytes: Uint8Array }> = [
    { name: 'skin_albedo', bytes: generateProceduralTexturePng('skin', spec.palette.skinColor, spec.palette.skinColor, texPx) },
    { name: 'iris_albedo', bytes: generateProceduralTexturePng('iris', spec.palette.eyeColor, spec.palette.eyeColor, texPx) },
    { name: 'hair_albedo', bytes: generateProceduralTexturePng('hair', spec.palette.hairColor, spec.palette.hairColor, texPx) },
    { name: 'armor_albedo', bytes: generateProceduralTexturePng('armor', spec.palette.primaryOutfitColor, spec.palette.secondaryOutfitColor, texPx) },
    { name: 'trim_albedo', bytes: generateProceduralTexturePng('armor', spec.palette.accentMetallicColor, spec.palette.secondaryOutfitColor, texPx) },
    { name: 'cloak_albedo', bytes: generateProceduralTexturePng('cloak', spec.palette.cloakColor, spec.palette.secondaryOutfitColor, texPx) },
    { name: 'secondary_albedo', bytes: generateProceduralTexturePng('armor', spec.palette.secondaryOutfitColor, spec.palette.accentMetallicColor, texPx) },
  ];

  const irisEmissiveTexIdx = textureDefs.length;
  textureDefs.push({
    name: 'iris_emissive',
    bytes: generateProceduralTexturePng('iris_emissive', spec.palette.eyeColor, spec.palette.eyeColor, texPx),
  });

  const normalStartIdx = textureDefs.length;
  if (includeNormalMaps) {
    textureDefs.push(
      { name: 'skin_normal', bytes: generateProceduralTexturePng('skin_normal', '#8080ff', '#8080ff', normalPx) },
      { name: 'hair_normal', bytes: generateProceduralTexturePng('hair_normal', '#8080ff', '#8080ff', normalPx) },
      { name: 'armor_normal', bytes: generateProceduralTexturePng('armor_normal', '#8080ff', '#8080ff', normalPx) },
      { name: 'cloak_normal', bytes: generateProceduralTexturePng('cloak_normal', '#8080ff', '#8080ff', normalPx) }
    );
  }

  const images: Array<Record<string, unknown>> = [];
  const textures: Array<Record<string, unknown>> = [];
  for (const td of textureDefs) {
    const bvIdx = pushBufferSlice(td.bytes);
    const imgIdx = images.length;
    images.push({ name: td.name, mimeType: 'image/png', bufferView: bvIdx });
    textures.push({ sampler: 0, source: imgIdx });
  }

  // 2. Inverse Bind Matrices
  const ibmArray = new Float32Array(bones.length * 16);
  for (let i = 0; i < bones.length; i++) {
    const wp = bones[i].worldPos;
    const base = i * 16;
    ibmArray[base + 0] = 1;
    ibmArray[base + 5] = 1;
    ibmArray[base + 10] = 1;
    ibmArray[base + 12] = -wp[0];
    ibmArray[base + 13] = -wp[1];
    ibmArray[base + 14] = -wp[2];
    ibmArray[base + 15] = 1;
  }
  const ibmBv = pushBufferSlice(new Uint8Array(ibmArray.buffer));
  const ibmAccessorIdx = accessors.length;
  accessors.push({ bufferView: ibmBv, componentType: 5126, count: bones.length, type: 'MAT4' });

  // 3. Single-Primitive Meshes
  let totalVertices = 0;
  let totalTriangles = 0;
  const gltfMeshes: Array<Record<string, unknown>> = [];
  let skinMeshNodeIdx = -1;
  let eyeMeshNodeIdx = -1;

  for (let pIdx = 0; pIdx < primitives.length; pIdx++) {
    const prim = primitives[pIdx];
    const vertCount = prim.positions.length / 3;
    totalVertices += vertCount;
    totalTriangles += prim.indices.length / 3;

    const posArr = new Float32Array(prim.positions);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < posArr.length; i += 3) {
      min[0] = Math.min(min[0], posArr[i]);
      min[1] = Math.min(min[1], posArr[i + 1]);
      min[2] = Math.min(min[2], posArr[i + 2]);
      max[0] = Math.max(max[0], posArr[i]);
      max[1] = Math.max(max[1], posArr[i + 1]);
      max[2] = Math.max(max[2], posArr[i + 2]);
    }
    const posBv = pushBufferSlice(new Uint8Array(posArr.buffer), 34962);
    const posAcc = accessors.length;
    accessors.push({ bufferView: posBv, componentType: 5126, count: vertCount, type: 'VEC3', min, max });

    const normBv = pushBufferSlice(new Uint8Array(new Float32Array(prim.normals).buffer), 34962);
    const normAcc = accessors.length;
    accessors.push({ bufferView: normBv, componentType: 5126, count: vertCount, type: 'VEC3' });

    const uvBv = pushBufferSlice(new Uint8Array(new Float32Array(prim.uvs).buffer), 34962);
    const uvAcc = accessors.length;
    accessors.push({ bufferView: uvBv, componentType: 5126, count: vertCount, type: 'VEC2' });

    const jointsBv = pushBufferSlice(new Uint8Array(prim.joints), 34962);
    const jointsAcc = accessors.length;
    accessors.push({ bufferView: jointsBv, componentType: 5121, count: vertCount, type: 'VEC4' });

    const weightsBv = pushBufferSlice(new Uint8Array(new Float32Array(prim.weights).buffer), 34962);
    const weightsAcc = accessors.length;
    accessors.push({ bufferView: weightsBv, componentType: 5126, count: vertCount, type: 'VEC4' });

    const indexArr = new Uint32Array(prim.indices);
    const indexBv = pushBufferSlice(new Uint8Array(indexArr.buffer), 34963);
    const indexAcc = accessors.length;
    accessors.push({ bufferView: indexBv, componentType: 5125, count: indexArr.length, type: 'SCALAR' });

    const primAttributes: Record<string, number> = {
      POSITION: posAcc,
      NORMAL: normAcc,
      TEXCOORD_0: uvAcc,
      JOINTS_0: jointsAcc,
      WEIGHTS_0: weightsAcc,
    };

    if (prim.colors && prim.colors.length === vertCount * 4) {
      const colBv = pushBufferSlice(new Uint8Array(new Float32Array(prim.colors).buffer), 34962);
      const colAcc = accessors.length;
      accessors.push({ bufferView: colBv, componentType: 5126, count: vertCount, type: 'VEC4' });
      primAttributes.COLOR_0 = colAcc;
    }

    const primEntry: Record<string, unknown> = {
      attributes: primAttributes,
      indices: indexAcc,
      material: prim.materialIndex,
    };

    if (prim.hasMorphTargets) {
      const morphs = computeMorphTargetsForPrimitive(prim);
      const targetsArray: Array<Record<string, number>> = [];
      for (const m of morphs) {
        const mMin = [Infinity, Infinity, Infinity];
        const mMax = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < m.deltas.length; i += 3) {
          mMin[0] = Math.min(mMin[0], m.deltas[i]);
          mMin[1] = Math.min(mMin[1], m.deltas[i + 1]);
          mMin[2] = Math.min(mMin[2], m.deltas[i + 2]);
          mMax[0] = Math.max(mMax[0], m.deltas[i]);
          mMax[1] = Math.max(mMax[1], m.deltas[i + 1]);
          mMax[2] = Math.max(mMax[2], m.deltas[i + 2]);
        }
        const mBv = pushBufferSlice(new Uint8Array(m.deltas.buffer), 34962);
        const mAcc = accessors.length;
        accessors.push({
          bufferView: mBv,
          componentType: 5126,
          count: vertCount,
          type: 'VEC3',
          min: mMin,
          max: mMax,
        });
        targetsArray.push({ POSITION: mAcc });
      }
      primEntry.targets = targetsArray;
    }

    const meshObj: Record<string, unknown> = {
      name: prim.name,
      primitives: [primEntry],
    };
    if (prim.hasMorphTargets) {
      meshObj.extras = { targetNames: MORPH_EXPRESSION_NAMES };
    }
    gltfMeshes.push(meshObj);
  }

  // Calibrate PBR materials by art style
  const isAnime = spec.artStyle === 'stylized_anime';
  const isRealistic = spec.artStyle === 'realistic_human';
  const normalScale = isAnime ? 0.35 : isRealistic ? 0.85 : 0.65;

  const materials: Array<Record<string, unknown>> = [
    {
      name: 'Skin_Material',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0.0,
        roughnessFactor: isAnime ? 0.72 : isRealistic ? 0.54 : 0.6,
      },
      ...(includeNormalMaps ? { normalTexture: { index: normalStartIdx, scale: normalScale * 0.42 } } : {}),
    },
    {
      name: 'Eyes_Material',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 1 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0.02,
        roughnessFactor: 0.14,
      },
      ...(spec.palette.eyeEmissive
        ? {
            emissiveTexture: { index: irisEmissiveTexIdx },
            emissiveFactor: [0.85, 0.85, 0.85],
          }
        : { emissiveFactor: [0, 0, 0] }),
    },
    {
      name: 'Hair_Material',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 2 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: isAnime ? 0.04 : 0.1,
        roughnessFactor: isAnime ? 0.46 : 0.36,
      },
      ...(includeNormalMaps ? { normalTexture: { index: normalStartIdx + 1, scale: normalScale * 0.75 } } : {}),
      doubleSided: true,
    },
    {
      name: 'Armor_Outfit_Material',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 3 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: spec.features.hasArmor ? 0.48 : 0.04,
        roughnessFactor: spec.features.hasArmor ? 0.38 : 0.72,
      },
      ...(includeNormalMaps ? { normalTexture: { index: normalStartIdx + 2, scale: normalScale * 0.85 } } : {}),
    },
    {
      name: 'Metallic_Trim_Material',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 4 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: spec.features.hasArmor ? 0.78 : 0.18,
        roughnessFactor: spec.features.hasArmor ? 0.28 : 0.56,
      },
      ...(includeNormalMaps ? { normalTexture: { index: normalStartIdx + 2, scale: normalScale * 0.8 } } : {}),
    },
    {
      name: 'Cloak_Fabric_Material',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 5 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0.03,
        roughnessFactor: 0.84,
      },
      ...(includeNormalMaps ? { normalTexture: { index: normalStartIdx + 3, scale: normalScale * 0.75 } } : {}),
      doubleSided: true,
    },
    {
      name: 'Secondary_Accent_Material',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 6 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: spec.features.hasArmor ? 0.36 : 0.08,
        roughnessFactor: spec.features.hasArmor ? 0.4 : 0.68,
      },
      ...(includeNormalMaps ? { normalTexture: { index: normalStartIdx + 2, scale: normalScale * 0.8 } } : {}),
    },
  ];

  // Nodes
  const nodes: Array<Record<string, unknown>> = [];
  const boneChildrenMap = new Map<number, number[]>();
  bones.forEach((b, i) => {
    if (b.parent >= 0) {
      const list = boneChildrenMap.get(b.parent) ?? [];
      list.push(i + 1);
      boneChildrenMap.set(b.parent, list);
    }
  });

  const firstMeshNodeIdx = 1 + bones.length;
  const meshNodeIndices = primitives.map((_, idx) => firstMeshNodeIdx + idx);
  nodes.push({
    name: `${spec.name.replace(/\s+/g, '_')}_Root`,
    children: [1, ...meshNodeIndices],
  });

  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    const nodeObj: Record<string, unknown> = {
      name: b.name,
      translation: b.localPos,
    };
    const ch = boneChildrenMap.get(i);
    if (ch && ch.length > 0) {
      nodeObj.children = ch;
    }
    nodes.push(nodeObj);
  }

  for (let mIdx = 0; mIdx < primitives.length; mIdx++) {
    const prim = primitives[mIdx];
    const nodeIdx = nodes.length;
    if (prim.materialIndex === 0) skinMeshNodeIdx = nodeIdx;
    if (prim.materialIndex === 1) eyeMeshNodeIdx = nodeIdx;
    nodes.push({
      name: prim.name,
      mesh: mIdx,
      skin: 0,
    });
  }

  const jointNodeIndices = bones.map((_, i) => i + 1);
  const humanBones: Record<string, { node: number }> = {};
  bones.forEach((b, i) => {
    if (b.vrmName) {
      humanBones[b.vrmName] = { node: i + 1 };
    }
  });

  const expressionPresetMap: Record<string, Record<string, unknown>> = {
    neutral: { isBinary: false, morphTargetBinds: [] },
  };
  MORPH_EXPRESSION_NAMES.forEach((exprName, mIdx) => {
    const binds: Array<{ node: number; index: number; weight: number }> = [];
    if (skinMeshNodeIdx >= 0) {
      binds.push({ node: skinMeshNodeIdx, index: mIdx, weight: 1.0 });
    }
    if (
      eyeMeshNodeIdx >= 0 &&
      (exprName === 'lookUp' ||
        exprName === 'lookDown' ||
        exprName === 'lookLeft' ||
        exprName === 'lookRight')
    ) {
      binds.push({ node: eyeMeshNodeIdx, index: mIdx, weight: 1.0 });
    }
    expressionPresetMap[exprName] = {
      isBinary: exprName === 'blink' || exprName === 'blinkLeft' || exprName === 'blinkRight',
      morphTargetBinds: binds,
    };
  });

  const springBoneJointNames = [
    'hairBackRoot',
    'hairBackMid',
    'hairBackTip',
    'hairLeftRoot',
    'hairLeftTip',
    'hairRightRoot',
    'hairRightTip',
    'cloakTop',
    'cloakMid',
    'cloakHem',
  ];
  const boneNodeByName = new Map<string, number>();
  bones.forEach((b, i) => boneNodeByName.set(b.name, i + 1));

  const springJointDefs = springBoneJointNames.map((n) => ({
    node: boneNodeByName.get(n) ?? 1,
    hitRadius: 0.03,
    stiffness: n.startsWith('hair') ? 0.65 : 0.45,
    gravityPower: 0.35,
    gravityDir: [0, -1, 0],
    dragForce: 0.4,
  }));

  const springs = [
    { name: 'HairBackSpring', joints: springJointDefs.slice(0, 3) },
    { name: 'HairLeftSpring', joints: springJointDefs.slice(3, 5) },
    { name: 'HairRightSpring', joints: springJointDefs.slice(5, 7) },
    ...(spec.features.hasCloak ? [{ name: 'CloakSpring', joints: springJointDefs.slice(7, 10) }] : []),
  ];

  const binBytes = new Uint8Array(byteOffset);
  let writePtr = 0;
  for (const ch of chunks) {
    binBytes.set(ch, writePtr);
    writePtr += ch.length;
  }

  const baseGltf: Record<string, unknown> = {
    asset: {
      version: '2.0',
      generator: 'VRM Forge Studio High-Detail Anatomical Sculptor (glTF 2.0 + VRMC_vrm 1.0)',
    },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes,
    meshes: gltfMeshes,
    skins: [
      {
        name: 'HumanoidArmature',
        inverseBindMatrices: ibmAccessorIdx,
        skeleton: 1,
        joints: jointNodeIndices,
      },
    ],
    materials,
    textures,
    images,
    samplers: [
      {
        magFilter: 9729,
        minFilter: 9987,
        wrapS: 10497,
        wrapT: 10497,
      },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binBytes.length }],
  };

  const glbBuffer = packGlbBinary(baseGltf, binBytes);

  const vrmGltf: Record<string, unknown> = {
    ...baseGltf,
    extensionsUsed: ['VRMC_vrm', 'VRMC_springBone'],
    extensions: {
      VRMC_vrm: {
        specVersion: '1.0',
        meta: {
          name: spec.name,
          version: `1.${spec.version}.0`,
          authors: ['VRM Forge Studio'],
          copyrightInformation: 'Generated with VRM Forge Studio',
          contactInformation: '',
          references: [],
          licenseUrl: 'https://vrm.dev/licenses/1.0/',
          avatarPermission: 'everyone',
          allowExcessivelyViolentUsage: false,
          allowExcessivelySexualUsage: false,
          commercialUsage: 'personalNonProfit',
          allowPoliticalOrReligiousUsage: false,
          allowAntisocialOrHateUsage: false,
          creditNotation: 'unnecessary',
          allowRedistribution: true,
          modification: 'allowModificationRedistribution',
        },
        humanoid: { humanBones },
        firstPerson: { meshAnnotations: [] },
        lookAt: {
          offsetFromHeadBone: [0, 0.08 * spec.proportions.headScale, 0],
          type: 'bone',
          rangeMapHorizontalInner: { inputMaxValue: 90, outputScale: 10 },
          rangeMapHorizontalOuter: { inputMaxValue: 90, outputScale: 10 },
          rangeMapVerticalDown: { inputMaxValue: 90, outputScale: 10 },
          rangeMapVerticalUp: { inputMaxValue: 90, outputScale: 10 },
        },
        expressions: { preset: expressionPresetMap },
      },
      VRMC_springBone: {
        specVersion: '1.0',
        springs,
      },
    },
  };

  for (const req of VRM_REQUIRED_HUMANOID_BONES) {
    if (!humanBones[req]) {
      throw new Error(`Internal builder error: missing required VRM bone ${req}`);
    }
  }

  const vrmBuffer = packGlbBinary(vrmGltf, binBytes);

  return {
    vrmBuffer,
    glbBuffer,
    stats: {
      vertexCount: totalVertices,
      triangleCount: totalTriangles,
      boneCount: bones.length,
      materialCount: materials.length,
      textureCount: textures.length,
      expressionCount: Object.keys(expressionPresetMap).length,
      springBoneJointCount: springJointDefs.length,
    },
  };
}

/**
 * Fast analytical pre-export metric estimator used in UI & /api/characters/estimate
 * matching actual sculpted mesh and texture budgets.
 */
export function estimateCharacterMetrics(spec: CharacterSpecification): ExportEstimates {
  const srcB = getQualityBudget(spec.qualityConfig.geometryQuality);
  const optB = getOptimizedBudget(spec.qualityConfig);

  const countFromBudget = (b: ReturnType<typeof getQualityBudget>) => {
    const headTris = b.headLat * b.headLon * 2 + 16 * 20 * 4 + 640;
    const torsoTris = b.torsoRadial * b.torsoRings * 2.1 + (spec.features.hasArmor ? 1650 : 620);
    const limbTris = b.limbRadial * 46 + b.fingerRadial * 40;
    const hairTris = b.hairStrands * b.hairSegments * 16 + 1850;
    const cloakTris = (spec.features.hasCloak ? b.cloakCols * b.cloakRows * 4 : 0) + (spec.features.hasWings ? 760 : 0);
    const tris = Math.round(headTris + torsoTris + limbTris + hairTris + cloakTris);
    const verts = Math.round(tris * 0.62);
    return { tris, verts };
  };

  const src = countFromBudget(srcB);
  const opt =
    spec.qualityConfig.vrmOptimization === 'unoptimized' ? src : countFromBudget(optB);

  const textureTargetPx = textureResolutionToTargetPx(spec.qualityConfig.textureResolution);
  const packedTexturePx = resolvePackedTextureSize(spec.qualityConfig);
  // 7 RGBA albedo + 1 iris emissive + 4 RGBA normal maps uncompressed VRAM footprint at target bake resolution
  const estimatedTextureMemoryMb = Number(
    ((12 * textureTargetPx * textureTargetPx * 4) / (1024 * 1024)).toFixed(1)
  );
  const packedTexKb = Math.round((packedTexturePx * packedTexturePx * 0.65 * 12) / 1024);
  const estimatedVrmSizeKb = Math.round((opt.verts * 96) / 1024 + packedTexKb);
  const estimatedSourceGlbSizeKb = Math.round((src.verts * 96) / 1024 + packedTexKb * 1.35);

  return {
    sourceTriangles: src.tris,
    sourceVertices: src.verts,
    optimizedTriangles: opt.tris,
    optimizedVertices: opt.verts,
    textureTargetPx,
    packedTexturePx,
    estimatedTextureMemoryMb,
    estimatedVrmSizeKb,
    estimatedSourceGlbSizeKb,
  };
}

export function buildCharacterVrmAndGlb(spec: CharacterSpecification): BuiltVrmResult {
  const bones = buildHumanoidSkeleton(spec);
  const sourceBudget = getQualityBudget(spec.qualityConfig.geometryQuality);
  const vrmBudget = getOptimizedBudget(spec.qualityConfig);

  const sourcePrimitives = buildHighDetailCharacterGeometry(spec, bones, sourceBudget);
  const isUnoptimized = spec.qualityConfig.vrmOptimization === 'unoptimized';
  const vrmPrimitives = isUnoptimized
    ? sourcePrimitives
    : buildHighDetailCharacterGeometry(spec, bones, vrmBudget);

  const packedTexturePx = resolvePackedTextureSize(spec.qualityConfig);
  const sourceTexPx = Math.max(packedTexturePx, Math.min(512, textureResolutionToTargetPx(spec.qualityConfig.textureResolution)));

  const vrmPackage = assembleGltfPackage(spec, bones, vrmPrimitives, packedTexturePx, true);
  const sourcePackage = isUnoptimized
    ? vrmPackage
    : assembleGltfPackage(spec, bones, sourcePrimitives, sourceTexPx, true);

  const textureTargetPx = textureResolutionToTargetPx(spec.qualityConfig.textureResolution);
  const estimatedTextureMemoryMb = Number(
    ((12 * textureTargetPx * textureTargetPx * 4) / (1024 * 1024)).toFixed(1)
  );

  const estimates: ExportEstimates = {
    sourceTriangles: sourcePackage.stats.triangleCount,
    sourceVertices: sourcePackage.stats.vertexCount,
    optimizedTriangles: vrmPackage.stats.triangleCount,
    optimizedVertices: vrmPackage.stats.vertexCount,
    textureTargetPx,
    packedTexturePx,
    estimatedTextureMemoryMb,
    estimatedVrmSizeKb: Math.round(vrmPackage.vrmBuffer.byteLength / 1024),
    estimatedSourceGlbSizeKb: Math.round(sourcePackage.glbBuffer.byteLength / 1024),
  };

  return {
    vrmBuffer: vrmPackage.vrmBuffer,
    glbBuffer: vrmPackage.glbBuffer,
    sourceGlbBuffer: sourcePackage.glbBuffer,
    stats: vrmPackage.stats,
    sourceStats: sourcePackage.stats,
    estimates,
  };
}
