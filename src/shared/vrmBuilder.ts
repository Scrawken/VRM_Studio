import {
  BoneDef,
  PrimitiveBuild,
  buildHighDetailCharacterGeometry,
  getOptimizedBudget,
  getQualityBudget,
} from './anatomicalSculptor';
import {
  ExternalRiggingAudit,
  auditJointDeformations,
  buildOrPreserveMorphTargetsForExternalPrimitive,
  computeLaplacianCapsuleSkinWeights,
  fitArmatureToExternalGeometry,
  mapExistingSkinToVrmHumanoid,
} from './externalRigging';
import {
  generateProceduralTexturePng,
  resolvePackedTextureSize,
  textureResolutionToTargetPx,
} from './pngEncoder';
import {
  CharacterSpecification,
  ExportEstimates,
  ImportedPrimitiveData,
  ParsedGlbAsset,
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

export interface BuiltTimingsMs {
  geometryMs: number;
  retopologyMs: number;
  materialsMs: number;
  riggingMs: number;
  facialMs: number;
  packageMs: number;
}

export interface BuiltVrmResult {
  vrmBuffer: Uint8Array;
  glbBuffer: Uint8Array;
  sourceGlbBuffer: Uint8Array;
  stats: BuiltStats;
  sourceStats: BuiltStats;
  estimates: ExportEstimates;
  timingsMs: BuiltTimingsMs;
  externalAudit?: ExternalRiggingAudit;
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
  const tRig0 = performance.now();
  const bones = buildHumanoidSkeleton(spec);
  const riggingMs = Math.max(1, Math.round(performance.now() - tRig0));

  const sourceBudget = getQualityBudget(spec.qualityConfig.geometryQuality);
  const vrmBudget = getOptimizedBudget(spec.qualityConfig);

  const tGeom0 = performance.now();
  const sourcePrimitives = buildHighDetailCharacterGeometry(spec, bones, sourceBudget);
  const geometryMs = Math.max(1, Math.round(performance.now() - tGeom0));

  const isUnoptimized = spec.qualityConfig.vrmOptimization === 'unoptimized';
  const tRetopo0 = performance.now();
  const vrmPrimitives = isUnoptimized
    ? sourcePrimitives
    : buildHighDetailCharacterGeometry(spec, bones, vrmBudget);
  const retopologyMs = isUnoptimized ? 0 : Math.max(1, Math.round(performance.now() - tRetopo0));

  const packedTexturePx = resolvePackedTextureSize(spec.qualityConfig);
  const sourceTexPx = Math.max(
    packedTexturePx,
    Math.min(512, textureResolutionToTargetPx(spec.qualityConfig.textureResolution))
  );

  const tPkg0 = performance.now();
  const vrmPackage = assembleGltfPackage(spec, bones, vrmPrimitives, packedTexturePx, true);
  const sourcePackage = isUnoptimized
    ? vrmPackage
    : assembleGltfPackage(spec, bones, sourcePrimitives, sourceTexPx, true);
  const totalPkgMs = Math.max(1, Math.round(performance.now() - tPkg0));
  const materialsMs = Math.max(1, Math.round(totalPkgMs * 0.45));
  const facialMs = Math.max(1, Math.round(totalPkgMs * 0.35));
  const packageMs = Math.max(1, totalPkgMs - materialsMs - facialMs);

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
    timingsMs: {
      geometryMs,
      retopologyMs,
      materialsMs,
      riggingMs,
      facialMs,
      packageMs,
    },
  };
}

/**
 * Milestone 3 Production External GLB -> VRM 1.0 Converter:
 * - Preserves ALL meshes, primitives, PBR materials, embedded images/textures, samplers,
 *   UVs (TEXCOORD_0/1), vertex colors (COLOR_0), node transforms, and existing morph targets.
 * - Supports BOTH already-rigged humanoid GLBs (preserving existing skeleton & weights)
 *   AND unrigged external GLBs (fitting humanoid armature + Laplacian-smoothed bone-capsule weighting).
 * - Never replaces external PBR textures with procedural placeholder textures.
 */
export function buildRiggedVrmFromExternalMesh(
  spec: CharacterSpecification,
  externalAsset: ParsedGlbAsset,
  rawExternalGlbBuffer: Uint8Array
): BuiltVrmResult {
  const flatPrims: ImportedPrimitiveData[] = [];
  if (externalAsset.meshes && externalAsset.meshes.length > 0) {
    for (const m of externalAsset.meshes) {
      for (const p of m.primitives) {
        flatPrims.push(p);
      }
    }
  } else if (externalAsset.positions.length >= 9 && externalAsset.indices.length >= 3) {
    flatPrims.push({
      meshIndex: 0,
      meshName: 'External_Imported_Humanoid',
      primitiveIndex: 0,
      name: 'External_Imported_Humanoid',
      materialIndex: 0,
      hasNormals: externalAsset.normals.length > 0,
      hasUvs: externalAsset.uvs.length > 0,
      hasUvs1: false,
      hasColors: false,
      hasSkinning: false,
      positions: externalAsset.positions,
      normals: externalAsset.normals,
      uvs: externalAsset.uvs,
      indices: externalAsset.indices,
      morphTargets: [],
    });
  }

  if (flatPrims.length === 0 || externalAsset.vertexCount === 0 || externalAsset.triangleCount === 0) {
    throw new Error('Imported external GLB contains empty geometry.');
  }

  const [minX, minY, minZ] = externalAsset.boundsMin;
  const [maxX, maxY, maxZ] = externalAsset.boundsMax;
  const srcHeight = Math.max(0.001, maxY - minY);
  const targetHeight = spec.proportions.heightMeters;

  // Determine whether we can preserve an existing humanoid skeleton cleanly
  const primarySkin =
    externalAsset.hasExistingSkin && externalAsset.skins.length > 0
      ? externalAsset.skins[0]
      : undefined;
  const allPrimsSkinned =
    Boolean(primarySkin) && flatPrims.every((p) => p.hasSkinning && p.joints && p.weights);
  const skinMapping =
    primarySkin && allPrimsSkinned
      ? mapExistingSkinToVrmHumanoid(primarySkin, externalAsset.existingVrmHumanoid)
      : null;

  const preserveExistingRig = Boolean(skinMapping && skinMapping.allRequiredPresent && primarySkin);

  const tRig0 = performance.now();

  let scale = 1.0;
  let offsetX = 0;
  let offsetY = 0;
  let offsetZ = 0;
  let headBoneY = targetHeight * 0.88;
  let headCenterY = targetHeight * 0.92;
  let faceForwardSign: 1 | -1 = 1;

  // Build output joint nodes & VRM humanBones map
  const jointNodes: Array<{
    name: string;
    parent: number;
    translation: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    worldPos: [number, number, number];
  }> = [];
  let humanBones: Record<string, { node: number }> = {};
  let ibmBytes: Float32Array;
  let skeletonRootLocalIdx = 0;

  // Per-primitive joints/weights arrays
  const primPositions: Float32Array[] = [];
  const primJoints: Uint16Array[] = [];
  const primWeights: Float32Array[] = [];
  let maxWeightSumError = 0;
  let jointDeformations = [];
  let weightedVerticesTotal = 0;
  let totalVertices = 0;

  if (preserveExistingRig && primarySkin && skinMapping) {
    const needsUnitScale = srcHeight > 4.0 || srcHeight < 0.4;
    const needsFloorAlign = Math.abs(minY) > 0.12 || Math.abs((minX + maxX) * 0.5) > 0.25;
    if (needsUnitScale || needsFloorAlign) {
      scale = needsUnitScale ? targetHeight / srcHeight : 1.0;
      offsetX = -(minX + maxX) * 0.5;
      offsetY = -minY;
      offsetZ = -(minZ + maxZ) * 0.5;
    }

    const roots: number[] = [];
    primarySkin.joints.forEach((j, idx) => {
      const isRoot = j.parentJointIndex < 0;
      if (isRoot) roots.push(idx);
      const t: [number, number, number] = isRoot
        ? [
            (j.localTranslation[0] + offsetX) * scale,
            (j.localTranslation[1] + offsetY) * scale,
            (j.localTranslation[2] + offsetZ) * scale,
          ]
        : [
            j.localTranslation[0] * scale,
            j.localTranslation[1] * scale,
            j.localTranslation[2] * scale,
          ];
      const isNonDefaultRot =
        Math.abs(j.localRotation[0]) > 1e-5 ||
        Math.abs(j.localRotation[1]) > 1e-5 ||
        Math.abs(j.localRotation[2]) > 1e-5 ||
        Math.abs(j.localRotation[3] - 1) > 1e-5;
      const isNonDefaultScale =
        Math.abs(j.localScale[0] - 1) > 1e-5 ||
        Math.abs(j.localScale[1] - 1) > 1e-5 ||
        Math.abs(j.localScale[2] - 1) > 1e-5;

      jointNodes.push({
        name: j.name,
        parent: j.parentJointIndex,
        translation: t,
        rotation: isNonDefaultRot ? j.localRotation : undefined,
        scale: isNonDefaultScale ? j.localScale : undefined,
        worldPos: [
          (j.worldPos[0] + offsetX) * scale,
          (j.worldPos[1] + offsetY) * scale,
          (j.worldPos[2] + offsetZ) * scale,
        ],
      });
    });
    skeletonRootLocalIdx = roots[0] ?? 0;

    for (const [vrmBone, jIdx] of Object.entries(skinMapping.humanBoneToJointIndex)) {
      humanBones[vrmBone] = { node: jIdx + 1 };
    }

    const headJointIdx = skinMapping.humanBoneToJointIndex['head'];
    if (headJointIdx !== undefined && jointNodes[headJointIdx]) {
      headBoneY = jointNodes[headJointIdx].worldPos[1];
      const topY = (maxY + offsetY) * scale;
      headCenterY = Math.min(topY - 0.085 * spec.proportions.headScale, headBoneY + 0.04 * spec.proportions.headScale);
      headBoneY = Math.min(headBoneY, headCenterY - 0.08 * spec.proportions.headScale);
    }

    // Preserve inverseBindMatrices (adjusted only if whole-model offset/scale was applied)
    ibmBytes = new Float32Array(jointNodes.length * 16);
    if (primarySkin.inverseBindMatrices && primarySkin.inverseBindMatrices.length >= jointNodes.length * 16) {
      ibmBytes.set(primarySkin.inverseBindMatrices.subarray(0, jointNodes.length * 16));
      if (scale !== 1.0 || offsetX !== 0 || offsetY !== 0 || offsetZ !== 0) {
        const dx = offsetX * scale;
        const dy = offsetY * scale;
        const dz = offsetZ * scale;
        for (let i = 0; i < jointNodes.length; i++) {
          const b = i * 16;
          const m0 = ibmBytes[b], m1 = ibmBytes[b + 1], m2 = ibmBytes[b + 2];
          const m4 = ibmBytes[b + 4], m5 = ibmBytes[b + 5], m6 = ibmBytes[b + 6];
          const m8 = ibmBytes[b + 8], m9 = ibmBytes[b + 9], m10 = ibmBytes[b + 10];
          const tx = ibmBytes[b + 12] * scale - (m0 * dx + m4 * dy + m8 * dz);
          const ty = ibmBytes[b + 13] * scale - (m1 * dx + m5 * dy + m9 * dz);
          const tz = ibmBytes[b + 14] * scale - (m2 * dx + m6 * dy + m10 * dz);
          ibmBytes[b + 12] = tx;
          ibmBytes[b + 13] = ty;
          ibmBytes[b + 14] = tz;
        }
      }
    } else {
      for (let i = 0; i < jointNodes.length; i++) {
        const wp = jointNodes[i].worldPos;
        const b = i * 16;
        ibmBytes[b] = 1; ibmBytes[b + 5] = 1; ibmBytes[b + 10] = 1; ibmBytes[b + 15] = 1;
        ibmBytes[b + 12] = -wp[0]; ibmBytes[b + 13] = -wp[1]; ibmBytes[b + 14] = -wp[2];
      }
    }

    // Transform & validate weights per primitive
    const concatPos: number[] = [];
    const concatJ: number[] = [];
    const concatW: number[] = [];
    for (const p of flatPrims) {
      const vc = Math.floor(p.positions.length / 3);
      totalVertices += vc;
      const posOut = new Float32Array(vc * 3);
      const jOut = new Uint16Array(vc * 4);
      const wOut = new Float32Array(vc * 4);
      for (let i = 0; i < vc; i++) {
        const px = (p.positions[i * 3] + offsetX) * scale;
        const py = (p.positions[i * 3 + 1] + offsetY) * scale;
        const pz = (p.positions[i * 3 + 2] + offsetZ) * scale;
        posOut[i * 3] = px; posOut[i * 3 + 1] = py; posOut[i * 3 + 2] = pz;
        concatPos.push(px, py, pz);

        const j0 = Math.min(jointNodes.length - 1, p.joints![i * 4]);
        const j1 = Math.min(jointNodes.length - 1, p.joints![i * 4 + 1]);
        const j2 = Math.min(jointNodes.length - 1, p.joints![i * 4 + 2]);
        const j3 = Math.min(jointNodes.length - 1, p.joints![i * 4 + 3]);
        const rawW0 = Math.max(0, p.weights![i * 4]);
        const rawW1 = Math.max(0, p.weights![i * 4 + 1]);
        const rawW2 = Math.max(0, p.weights![i * 4 + 2]);
        const rawW3 = Math.max(0, p.weights![i * 4 + 3]);
        const sum = rawW0 + rawW1 + rawW2 + rawW3 || 1;
        jOut[i * 4] = j0; jOut[i * 4 + 1] = j1; jOut[i * 4 + 2] = j2; jOut[i * 4 + 3] = j3;
        wOut[i * 4] = rawW0 / sum;
        wOut[i * 4 + 1] = rawW1 / sum;
        wOut[i * 4 + 2] = rawW2 / sum;
        wOut[i * 4 + 3] = rawW3 / sum;
        const err = Math.abs(wOut[i * 4] + wOut[i * 4 + 1] + wOut[i * 4 + 2] + wOut[i * 4 + 3] - 1.0);
        if (err > maxWeightSumError) maxWeightSumError = err;
        weightedVerticesTotal++;
        concatJ.push(j0, j1, j2, j3);
        concatW.push(wOut[i * 4], wOut[i * 4 + 1], wOut[i * 4 + 2], wOut[i * 4 + 3]);
      }
      primPositions.push(posOut);
      primJoints.push(jOut);
      primWeights.push(wOut);
    }

    jointDeformations = auditJointDeformations(
      new Float32Array(concatPos),
      concatJ,
      new Float32Array(concatW),
      (vrmBoneName) => skinMapping.humanBoneToJointIndex[vrmBoneName],
      (jIdx) => jointNodes[jIdx]?.worldPos ?? [0, 1, 0]
    );
  } else {
    // Unrigged GLB path: fit silhouette-aware VRM armature + Laplacian-smoothed capsule weights
    const baseBones = buildHumanoidSkeleton(spec);
    const fit = fitArmatureToExternalGeometry(spec, externalAsset, baseBones);
    scale = fit.scale;
    offsetX = fit.offsetX;
    offsetY = fit.offsetY;
    offsetZ = fit.offsetZ;
    headCenterY = fit.headCenterY;
    faceForwardSign = fit.faceForwardSign;

    const fittedBones = fit.bones;
    const headIdx = fittedBones.findIndex((b) => b.name === 'head');
    headBoneY = headIdx >= 0 ? fittedBones[headIdx].worldPos[1] : targetHeight * 0.88;

    fittedBones.forEach((b, i) => {
      jointNodes.push({
        name: b.name,
        parent: b.parent,
        translation: b.localPos,
        worldPos: b.worldPos,
      });
      if (b.vrmName) {
        humanBones[b.vrmName] = { node: i + 1 };
      }
    });

    ibmBytes = new Float32Array(fittedBones.length * 16);
    for (let i = 0; i < fittedBones.length; i++) {
      const wp = fittedBones[i].worldPos;
      const base = i * 16;
      ibmBytes[base] = 1; ibmBytes[base + 5] = 1; ibmBytes[base + 10] = 1; ibmBytes[base + 15] = 1;
      ibmBytes[base + 12] = -wp[0]; ibmBytes[base + 13] = -wp[1]; ibmBytes[base + 14] = -wp[2];
    }

    // Concatenate scaled positions & indices so Laplacian smoothing bridges UV/material seams across primitives
    const vertCounts = flatPrims.map((p) => Math.floor(p.positions.length / 3));
    totalVertices = vertCounts.reduce((acc, c) => acc + c, 0);
    const mergedScaledPos = new Float32Array(totalVertices * 3);
    const mergedIndices: number[] = [];

    let vCursor = 0;
    for (let pIdx = 0; pIdx < flatPrims.length; pIdx++) {
      const p = flatPrims[pIdx];
      const vc = vertCounts[pIdx];
      const posOut = new Float32Array(vc * 3);
      for (let i = 0; i < vc; i++) {
        const px = (p.positions[i * 3] + offsetX) * scale;
        const py = (p.positions[i * 3 + 1] + offsetY) * scale;
        const pz = (p.positions[i * 3 + 2] + offsetZ) * scale;
        posOut[i * 3] = px; posOut[i * 3 + 1] = py; posOut[i * 3 + 2] = pz;
        mergedScaledPos[(vCursor + i) * 3] = px;
        mergedScaledPos[(vCursor + i) * 3 + 1] = py;
        mergedScaledPos[(vCursor + i) * 3 + 2] = pz;
      }
      primPositions.push(posOut);
      for (let k = 0; k < p.indices.length; k++) {
        mergedIndices.push(vCursor + p.indices[k]);
      }
      vCursor += vc;
    }

    const skinRes = computeLaplacianCapsuleSkinWeights(
      mergedScaledPos,
      new Uint32Array(mergedIndices),
      fittedBones,
      targetHeight
    );
    maxWeightSumError = skinRes.maxWeightSumError;
    jointDeformations = skinRes.jointDeformations;
    weightedVerticesTotal = totalVertices;

    vCursor = 0;
    for (let pIdx = 0; pIdx < flatPrims.length; pIdx++) {
      const vc = vertCounts[pIdx];
      primJoints.push(skinRes.joints.slice(vCursor * 4, (vCursor + vc) * 4));
      primWeights.push(skinRes.weights.slice(vCursor * 4, (vCursor + vc) * 4));
      vCursor += vc;
    }
  }

  for (const req of VRM_REQUIRED_HUMANOID_BONES) {
    if (!humanBones[req]) {
      throw new Error(`External GLB humanoid mapping error: missing required VRM bone ${req}`);
    }
  }
  const riggingMs = Math.max(1, Math.round(performance.now() - tRig0));

  // Assemble multi-primitive, multi-material, texture-preserving binary chunks
  const tMat0 = performance.now();
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

  // Preserve original embedded images, samplers, textures, and PBR materials verbatim
  const imagesOut: Array<Record<string, unknown>> = [];
  for (const img of externalAsset.images || []) {
    if (img.bytes.byteLength === 0) continue;
    const bvIdx = pushBufferSlice(img.bytes);
    imagesOut.push({
      name: img.name || `image_${imagesOut.length}`,
      mimeType: img.mimeType || 'image/png',
      bufferView: bvIdx,
    });
  }

  const samplersOut =
    externalAsset.samplers && externalAsset.samplers.length > 0
      ? externalAsset.samplers.map((s) => ({
          ...(s.magFilter !== undefined ? { magFilter: s.magFilter } : { magFilter: 9729 }),
          ...(s.minFilter !== undefined ? { minFilter: s.minFilter } : { minFilter: 9987 }),
          ...(s.wrapS !== undefined ? { wrapS: s.wrapS } : { wrapS: 10497 }),
          ...(s.wrapT !== undefined ? { wrapT: s.wrapT } : { wrapT: 10497 }),
        }))
      : [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];

  const texturesOut: Array<Record<string, unknown>> = (externalAsset.textures || []).map((t) => ({
    ...(t.name ? { name: t.name } : {}),
    ...(t.sampler !== undefined ? { sampler: Math.min(t.sampler, samplersOut.length - 1) } : { sampler: 0 }),
    ...(t.source !== undefined ? { source: t.source } : {}),
  }));

  const materialsOut: Array<Record<string, unknown>> =
    externalAsset.materials && externalAsset.materials.length > 0
      ? externalAsset.materials.map((m) => {
          const outMat: Record<string, unknown> = { name: m.name };
          if (m.pbrMetallicRoughness) {
            outMat.pbrMetallicRoughness = {
              ...(m.pbrMetallicRoughness.baseColorFactor
                ? { baseColorFactor: m.pbrMetallicRoughness.baseColorFactor }
                : {}),
              ...(m.pbrMetallicRoughness.baseColorTexture
                ? { baseColorTexture: m.pbrMetallicRoughness.baseColorTexture }
                : {}),
              ...(m.pbrMetallicRoughness.metallicFactor !== undefined
                ? { metallicFactor: m.pbrMetallicRoughness.metallicFactor }
                : {}),
              ...(m.pbrMetallicRoughness.roughnessFactor !== undefined
                ? { roughnessFactor: m.pbrMetallicRoughness.roughnessFactor }
                : {}),
              ...(m.pbrMetallicRoughness.metallicRoughnessTexture
                ? { metallicRoughnessTexture: m.pbrMetallicRoughness.metallicRoughnessTexture }
                : {}),
            };
          }
          if (m.normalTexture) outMat.normalTexture = m.normalTexture;
          if (m.occlusionTexture) outMat.occlusionTexture = m.occlusionTexture;
          if (m.emissiveTexture) outMat.emissiveTexture = m.emissiveTexture;
          if (m.emissiveFactor) outMat.emissiveFactor = m.emissiveFactor;
          if (m.alphaMode && m.alphaMode !== 'OPAQUE') outMat.alphaMode = m.alphaMode;
          if (m.alphaCutoff !== undefined) outMat.alphaCutoff = m.alphaCutoff;
          if (m.doubleSided) outMat.doubleSided = true;
          if (m.extensions) outMat.extensions = m.extensions;
          return outMat;
        })
      : [
          {
            name: 'External_Default_PBR',
            pbrMetallicRoughness: {
              baseColorFactor: [0.85, 0.85, 0.88, 1.0],
              metallicFactor: 0.05,
              roughnessFactor: 0.65,
            },
          },
        ];

  const ibmBv = pushBufferSlice(new Uint8Array(ibmBytes.buffer));
  const ibmAccessorIdx = accessors.length;
  accessors.push({ bufferView: ibmBv, componentType: 5126, count: jointNodes.length, type: 'MAT4' });
  const materialsMs = Math.max(1, Math.round(performance.now() - tMat0));

  // Build primitives & morph targets preserving separate materials & existing attributes
  const tFace0 = performance.now();
  const useUint16Joints = jointNodes.length > 255;
  const gltfMeshes: Array<Record<string, unknown>> = [];
  const expressionPresetBinds: Record<string, Array<{ node: number; index: number; weight: number }>> = {};
  let totalTriangles = 0;
  let preservedMorphCount = 0;
  let synthesizedMorphCount = 0;

  // Group output primitives cleanly by source meshGroup or one mesh node per primitive to preserve node mapping & morphs
  const meshNodeFirstIndex = 1 + jointNodes.length;

  for (let pIdx = 0; pIdx < flatPrims.length; pIdx++) {
    const srcPrim = flatPrims[pIdx];
    const scaledPos = primPositions[pIdx];
    const vertCount = Math.floor(scaledPos.length / 3);
    totalTriangles += Math.floor(srcPrim.indices.length / 3);

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < scaledPos.length; i += 3) {
      min[0] = Math.min(min[0], scaledPos[i]);
      min[1] = Math.min(min[1], scaledPos[i + 1]);
      min[2] = Math.min(min[2], scaledPos[i + 2]);
      max[0] = Math.max(max[0], scaledPos[i]);
      max[1] = Math.max(max[1], scaledPos[i + 1]);
      max[2] = Math.max(max[2], scaledPos[i + 2]);
    }
    const posBv = pushBufferSlice(new Uint8Array(scaledPos.buffer), 34962);
    const posAcc = accessors.length;
    accessors.push({ bufferView: posBv, componentType: 5126, count: vertCount, type: 'VEC3', min, max });

    const normArr =
      srcPrim.normals.length >= vertCount * 3
        ? new Float32Array(srcPrim.normals.subarray(0, vertCount * 3))
        : new Float32Array(vertCount * 3);
    const normBv = pushBufferSlice(new Uint8Array(normArr.buffer), 34962);
    const normAcc = accessors.length;
    accessors.push({ bufferView: normBv, componentType: 5126, count: vertCount, type: 'VEC3' });

    const uvArr =
      srcPrim.uvs.length >= vertCount * 2
        ? new Float32Array(srcPrim.uvs.subarray(0, vertCount * 2))
        : new Float32Array(vertCount * 2);
    const uvBv = pushBufferSlice(new Uint8Array(uvArr.buffer), 34962);
    const uvAcc = accessors.length;
    accessors.push({ bufferView: uvBv, componentType: 5126, count: vertCount, type: 'VEC2' });

    const primAttributes: Record<string, number> = {
      POSITION: posAcc,
      NORMAL: normAcc,
      TEXCOORD_0: uvAcc,
    };

    if (srcPrim.uvs1 && srcPrim.uvs1.length >= vertCount * 2) {
      const uv1Arr = new Float32Array(srcPrim.uvs1.subarray(0, vertCount * 2));
      const uv1Bv = pushBufferSlice(new Uint8Array(uv1Arr.buffer), 34962);
      const uv1Acc = accessors.length;
      accessors.push({ bufferView: uv1Bv, componentType: 5126, count: vertCount, type: 'VEC2' });
      primAttributes.TEXCOORD_1 = uv1Acc;
    }

    if (srcPrim.colors && srcPrim.colors.length >= vertCount * 4) {
      const colArr = new Float32Array(srcPrim.colors.subarray(0, vertCount * 4));
      const colBv = pushBufferSlice(new Uint8Array(colArr.buffer), 34962);
      const colAcc = accessors.length;
      accessors.push({ bufferView: colBv, componentType: 5126, count: vertCount, type: 'VEC4' });
      primAttributes.COLOR_0 = colAcc;
    }

    const jSrc = primJoints[pIdx];
    if (useUint16Joints) {
      const jBv = pushBufferSlice(new Uint8Array(jSrc.buffer.slice(0)), 34962);
      const jAcc = accessors.length;
      accessors.push({ bufferView: jBv, componentType: 5123, count: vertCount, type: 'VEC4' });
      primAttributes.JOINTS_0 = jAcc;
    } else {
      const jBytes = new Uint8Array(vertCount * 4);
      for (let i = 0; i < vertCount * 4; i++) jBytes[i] = jSrc[i];
      const jBv = pushBufferSlice(jBytes, 34962);
      const jAcc = accessors.length;
      accessors.push({ bufferView: jBv, componentType: 5121, count: vertCount, type: 'VEC4' });
      primAttributes.JOINTS_0 = jAcc;
    }

    const wArr = primWeights[pIdx];
    const wBv = pushBufferSlice(new Uint8Array(wArr.buffer.slice(0)), 34962);
    const wAcc = accessors.length;
    accessors.push({ bufferView: wBv, componentType: 5126, count: vertCount, type: 'VEC4' });
    primAttributes.WEIGHTS_0 = wAcc;

    const indexArr = new Uint32Array(srcPrim.indices);
    const indexBv = pushBufferSlice(new Uint8Array(indexArr.buffer), 34963);
    const indexAcc = accessors.length;
    accessors.push({ bufferView: indexBv, componentType: 5125, count: indexArr.length, type: 'SCALAR' });

    const primEntry: Record<string, unknown> = {
      attributes: primAttributes,
      indices: indexAcc,
      material: Math.min(srcPrim.materialIndex, materialsOut.length - 1),
    };

    const morphBuild = buildOrPreserveMorphTargetsForExternalPrimitive(
      scaledPos,
      srcPrim.morphTargets,
      scale,
      headBoneY,
      headCenterY,
      spec.proportions.headScale,
      faceForwardSign
    );
    preservedMorphCount += morphBuild.preservedCount;
    synthesizedMorphCount += morphBuild.synthesizedCount;

    if (morphBuild.targets.length > 0) {
      const targetsArray: Array<Record<string, number>> = [];
      for (const m of morphBuild.targets) {
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

      const nodeIdx = meshNodeFirstIndex + pIdx;
      for (const [presetName, targetIdx] of Object.entries(morphBuild.presetToTargetIndex)) {
        const arr = expressionPresetBinds[presetName] ?? [];
        arr.push({ node: nodeIdx, index: targetIdx, weight: 1.0 });
        expressionPresetBinds[presetName] = arr;
      }
    }

    const meshObj: Record<string, unknown> = {
      name: srcPrim.name,
      primitives: [primEntry],
    };
    if (morphBuild.targets.length > 0) {
      meshObj.extras = { targetNames: morphBuild.targets.map((t) => t.name) };
    }
    gltfMeshes.push(meshObj);
  }
  const facialMs = Math.max(1, Math.round(performance.now() - tFace0));

  const tPkg0 = performance.now();
  // Assemble glTF nodes hierarchy
  const nodes: Array<Record<string, unknown>> = [];
  const boneChildrenMap = new Map<number, number[]>();
  jointNodes.forEach((b, i) => {
    if (b.parent >= 0) {
      const ch = boneChildrenMap.get(b.parent) ?? [];
      ch.push(i + 1);
      boneChildrenMap.set(b.parent, ch);
    }
  });

  const rootJointChildren: number[] = [];
  jointNodes.forEach((b, i) => {
    if (b.parent < 0) rootJointChildren.push(i + 1);
  });
  const meshNodeIndices = flatPrims.map((_, idx) => meshNodeFirstIndex + idx);
  nodes.push({
    name: `${spec.name.replace(/\s+/g, '_')}_Root`,
    children: [...rootJointChildren, ...meshNodeIndices],
  });

  for (let i = 0; i < jointNodes.length; i++) {
    const b = jointNodes[i];
    const nodeObj: Record<string, unknown> = {
      name: b.name,
      translation: b.translation,
    };
    if (b.rotation) nodeObj.rotation = b.rotation;
    if (b.scale) nodeObj.scale = b.scale;
    const ch = boneChildrenMap.get(i);
    if (ch && ch.length > 0) nodeObj.children = ch;
    nodes.push(nodeObj);
  }

  for (let mIdx = 0; mIdx < flatPrims.length; mIdx++) {
    nodes.push({
      name: flatPrims[mIdx].name,
      mesh: mIdx,
      skin: 0,
    });
  }

  const jointNodeIndices = jointNodes.map((_, i) => i + 1);

  const expressionPresetMap: Record<string, Record<string, unknown>> = {
    neutral: { isBinary: false, morphTargetBinds: [] },
  };
  for (const presetName of VRM_EXPRESSION_PRESETS) {
    if (presetName === 'neutral') continue;
    const binds = expressionPresetBinds[presetName];
    if (binds && binds.length > 0) {
      expressionPresetMap[presetName] = {
        isBinary:
          presetName === 'blink' || presetName === 'blinkLeft' || presetName === 'blinkRight',
        morphTargetBinds: binds,
      };
    }
  }

  const binBytes = new Uint8Array(byteOffset);
  let writePtr = 0;
  for (const ch of chunks) {
    binBytes.set(ch, writePtr);
    writePtr += ch.length;
  }

  const baseGltf: Record<string, unknown> = {
    asset: {
      version: '2.0',
      generator: 'VRM Forge Studio External GLB -> VRM 1.0 Rigging Pipeline',
    },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes,
    meshes: gltfMeshes,
    skins: [
      {
        name: primarySkin?.name || 'HumanoidArmature',
        inverseBindMatrices: ibmAccessorIdx,
        skeleton: skeletonRootLocalIdx + 1,
        joints: jointNodeIndices,
      },
    ],
    materials: materialsOut,
    ...(texturesOut.length > 0 ? { textures: texturesOut } : {}),
    ...(imagesOut.length > 0 ? { images: imagesOut } : {}),
    samplers: samplersOut,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binBytes.length }],
  };

  const glbBuffer = packGlbBinary(baseGltf, binBytes);

  // Spring bones only if internal secondary hair/cloak bones exist in the skeleton
  const springBoneJointNames = [
    'hairBackRoot',
    'hairBackMid',
    'hairBackTip',
    'hairLeftRoot',
    'hairLeftTip',
    'hairRightRoot',
    'hairRightTip',
  ];
  const jointIdxByName = new Map<string, number>();
  jointNodes.forEach((b, i) => jointIdxByName.set(b.name, i + 1));
  const springJointDefs = springBoneJointNames
    .map((n) => jointIdxByName.get(n))
    .filter((n): n is number => n !== undefined)
    .map((node) => ({
      node,
      hitRadius: 0.03,
      stiffness: 0.65,
      gravityPower: 0.35,
      gravityDir: [0, -1, 0],
      dragForce: 0.4,
    }));

  const vrmGltf: Record<string, unknown> = {
    ...baseGltf,
    extensionsUsed: ['VRMC_vrm', ...(springJointDefs.length > 0 ? ['VRMC_springBone'] : [])],
    extensions: {
      VRMC_vrm: {
        specVersion: '1.0',
        meta: {
          name: spec.name,
          version: `1.${spec.version}.0`,
          authors: ['VRM Forge Studio'],
          copyrightInformation: 'Converted with VRM Forge Studio',
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
      ...(springJointDefs.length > 0
        ? {
            VRMC_springBone: {
              specVersion: '1.0',
              springs: [{ name: 'ExternalSecondarySpring', joints: springJointDefs }],
            },
          }
        : {}),
    },
  };

  const vrmBuffer = packGlbBinary(vrmGltf, binBytes);
  const packageMs = Math.max(1, Math.round(performance.now() - tPkg0));

  const stats: BuiltStats = {
    vertexCount: totalVertices,
    triangleCount: totalTriangles,
    boneCount: jointNodes.length,
    materialCount: materialsOut.length,
    textureCount: texturesOut.length,
    expressionCount: Object.keys(expressionPresetBinds).length,
    springBoneJointCount: springJointDefs.length,
  };

  const textureTargetPx = textureResolutionToTargetPx(spec.qualityConfig.textureResolution);
  const packedTexturePx = resolvePackedTextureSize(spec.qualityConfig);
  const estimatedTextureMemoryMb = Number(
    (
      imagesOut.reduce((acc, im) => acc + ((im.bufferView !== undefined ? 4 : 0)), 0) ||
      ((12 * textureTargetPx * textureTargetPx * 4) / (1024 * 1024))
    ).toFixed(1)
  );

  const mappedBonesList = Object.keys(humanBones);
  const missingVrmBones = VRM_REQUIRED_HUMANOID_BONES.filter((b) => !(b in humanBones));

  const externalAudit: ExternalRiggingAudit = {
    mode: preserveExistingRig ? 'preserved_existing_rig' : 'generated_humanoid_rig',
    weightsNormalized: maxWeightSumError <= 0.02,
    maxWeightSumError: Number(maxWeightSumError.toFixed(6)),
    weightedVertices: weightedVerticesTotal,
    totalVertices,
    mappedVrmBones: mappedBonesList,
    missingVrmBones,
    jointDeformations,
    allJointDeformationsPassed: jointDeformations.every((j) => j.passed),
    preservedMaterialCount: externalAsset.materials.length,
    preservedTextureCount: texturesOut.length,
    preservedImageCount: imagesOut.length,
    preservedMorphCount,
    synthesizedMorphCount,
    activeNonEmptyExpressions: Object.keys(expressionPresetBinds),
  };

  return {
    vrmBuffer,
    glbBuffer,
    sourceGlbBuffer: rawExternalGlbBuffer,
    stats,
    sourceStats: stats,
    estimates: {
      sourceTriangles: stats.triangleCount,
      sourceVertices: stats.vertexCount,
      optimizedTriangles: stats.triangleCount,
      optimizedVertices: stats.vertexCount,
      textureTargetPx,
      packedTexturePx,
      estimatedTextureMemoryMb,
      estimatedVrmSizeKb: Math.round(vrmBuffer.byteLength / 1024),
      estimatedSourceGlbSizeKb: Math.round(rawExternalGlbBuffer.byteLength / 1024),
    },
    timingsMs: {
      geometryMs: 0,
      retopologyMs: 0,
      materialsMs,
      riggingMs,
      facialMs,
      packageMs,
    },
    externalAudit,
  };
}

