import {
  VRM_REQUIRED_HUMANOID_BONES,
  ValidationCheck,
  VrmValidationReport,
} from './types';

interface GltfJson {
  asset?: { version?: string; generator?: string };
  nodes?: Array<{ name?: string; children?: number[]; mesh?: number; skin?: number }>;
  meshes?: Array<{
    name?: string;
    extras?: { targetNames?: string[] };
    primitives?: Array<{
      attributes?: Record<string, number>;
      indices?: number;
      material?: number;
      targets?: Array<Record<string, number>>;
    }>;
  }>;
  skins?: Array<{
    name?: string;
    inverseBindMatrices?: number;
    skeleton?: number;
    joints?: number[];
  }>;
  materials?: Array<{ name?: string }>;
  textures?: Array<{ source?: number }>;
  images?: Array<{ name?: string; mimeType?: string; bufferView?: number }>;
  accessors?: Array<{
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
  }>;
  bufferViews?: Array<{
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }>;
  extensionsUsed?: string[];
  extensions?: {
    VRMC_vrm?: {
      specVersion?: string;
      meta?: { name?: string; version?: string; authors?: string[] };
      humanoid?: { humanBones?: Record<string, { node: number }> };
      expressions?: {
        preset?: Record<
          string,
          {
            isBinary?: boolean;
            morphTargetBinds?: Array<{ node: number; index: number; weight: number }>;
          }
        >;
      };
    };
    VRMC_springBone?: {
      specVersion?: string;
      springs?: Array<{ name?: string; joints?: Array<{ node: number }> }>;
    };
  };
}

const CORE_FACIAL_EXPRESSION_PRESETS = [
  'blink',
  'blinkLeft',
  'blinkRight',
  'happy',
  'angry',
  'sad',
  'surprised',
] as const;

export function validateVrmBinary(bytes: Uint8Array): VrmValidationReport {
  const checks: ValidationCheck[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const failReport = (reason: string): VrmValidationReport => ({
    valid: false,
    vrmVersion: 'unknown',
    fileSizeBytes: bytes.byteLength,
    meshCount: 0,
    primitiveCount: 0,
    vertexCount: 0,
    triangleCount: 0,
    materialCount: 0,
    textureCount: 0,
    boneCount: 0,
    mappedHumanoidBones: [],
    missingRequiredBones: [...VRM_REQUIRED_HUMANOID_BONES],
    expressionCount: 0,
    nonEmptyExpressions: [],
    springBoneJointCount: 0,
    skinWeightsValid: false,
    checks: [...checks, { id: 'fatal', label: 'Binary Container', status: 'fail', detail: reason }],
    validatedAt: new Date().toISOString(),
  });

  if (bytes.byteLength < 20) {
    return failReport('File smaller than 20-byte GLB header.');
  }

  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const declaredLen = view.getUint32(8, true);

  if (magic !== 0x46546c67 || version !== 2) {
    return failReport(`Invalid GLB header: magic=0x${magic.toString(16)}, version=${version}`);
  }
  if (declaredLen !== bytes.byteLength) {
    return failReport(`GLB declared length (${declaredLen}) does not match actual buffer (${bytes.byteLength}).`);
  }
  checks.push({
    id: 'glb_header',
    label: 'glTF 2.0 Binary Header',
    status: 'pass',
    detail: `Valid glTF v2 container (${(bytes.byteLength / 1024).toFixed(1)} KB)`,
  });

  // Parse chunks
  let offset = 12;
  let gltf: GltfJson | null = null;
  let binChunk: Uint8Array | null = null;

  while (offset + 8 <= bytes.byteLength) {
    const chunkLen = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLen;
    if (chunkEnd > bytes.byteLength) {
      return failReport('Chunk length exceeds GLB file boundary.');
    }
    if (chunkType === 0x4e4f534a) {
      const jsonText = new TextDecoder().decode(bytes.subarray(chunkStart, chunkEnd));
      try {
        gltf = JSON.parse(jsonText) as GltfJson;
      } catch (err) {
        return failReport(`Invalid JSON chunk: ${(err as Error).message}`);
      }
    } else if (chunkType === 0x004e4942) {
      binChunk = bytes.subarray(chunkStart, chunkEnd);
    }
    offset = chunkEnd;
  }

  if (!gltf || !binChunk) {
    return failReport('Missing required JSON or BIN chunk inside GLB.');
  }

  const binView = new DataView(binChunk.buffer, binChunk.byteOffset, binChunk.byteLength);

  // Validate VRMC_vrm 1.0 extension
  const vrmExt = gltf.extensions?.VRMC_vrm;
  const specVersion = vrmExt?.specVersion ?? 'missing';
  const hasVrm = Boolean(vrmExt && specVersion === '1.0');
  checks.push({
    id: 'vrmc_vrm',
    label: 'VRMC_vrm 1.0 Extension',
    status: hasVrm ? 'pass' : 'fail',
    detail: hasVrm
      ? `VRMC_vrm specVersion ${specVersion} · Meta: "${vrmExt?.meta?.name || 'Unnamed'}"`
      : `Expected VRMC_vrm specVersion 1.0, found "${specVersion}"`,
  });

  // Validate Humanoid Bones
  const humanBonesObj = vrmExt?.humanoid?.humanBones ?? {};
  const mappedHumanoidBones = Object.keys(humanBonesObj);
  const missingRequiredBones = VRM_REQUIRED_HUMANOID_BONES.filter((b) => !(b in humanBonesObj));
  const nodeCount = gltf.nodes?.length ?? 0;
  const invalidBoneNodes = mappedHumanoidBones.filter((b) => {
    const idx = humanBonesObj[b]?.node;
    return typeof idx !== 'number' || idx < 0 || idx >= nodeCount;
  });

  checks.push({
    id: 'humanoid_bones',
    label: 'VRM Humanoid Bone Mapping',
    status: missingRequiredBones.length === 0 && invalidBoneNodes.length === 0 ? 'pass' : 'fail',
    detail:
      missingRequiredBones.length === 0 && invalidBoneNodes.length === 0
        ? `All ${VRM_REQUIRED_HUMANOID_BONES.length} required bones + ${mappedHumanoidBones.length - VRM_REQUIRED_HUMANOID_BONES.length} optional bones mapped`
        : invalidBoneNodes.length > 0
          ? `Invalid node indices for bones: ${invalidBoneNodes.join(', ')}`
          : `Missing required bones: ${missingRequiredBones.join(', ')}`,
  });

  // Validate Mesh Geometry, Skinning & Weight Normalization
  const meshes = gltf.meshes ?? [];
  const accessors = gltf.accessors ?? [];
  const bufferViews = gltf.bufferViews ?? [];
  let primitiveCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  let skinWeightsValid = true;
  let weightCheckDetail = 'Verified normalized vertex weights across primitives';

  for (const mesh of meshes) {
    for (const prim of mesh.primitives ?? []) {
      primitiveCount++;
      const posIdx = prim.attributes?.POSITION;
      const wIdx = prim.attributes?.WEIGHTS_0;
      const jIdx = prim.attributes?.JOINTS_0;
      if (posIdx === undefined || wIdx === undefined || jIdx === undefined) {
        skinWeightsValid = false;
        weightCheckDetail = 'Primitive missing POSITION, JOINTS_0, or WEIGHTS_0 attribute';
        continue;
      }
      const posAcc = accessors[posIdx];
      const wAcc = accessors[wIdx];
      vertexCount += posAcc?.count ?? 0;

      if (prim.indices !== undefined && accessors[prim.indices]) {
        triangleCount += Math.floor(accessors[prim.indices].count / 3);
      }

      // Verify normalized weights in BIN chunk (handles FLOAT, UBYTE, USHORT, byteOffset, byteStride)
      if (wAcc && wAcc.bufferView !== undefined && bufferViews[wAcc.bufferView]) {
        const bv = bufferViews[wAcc.bufferView];
        const compBytes =
          wAcc.componentType === 5126 ? 4 : wAcc.componentType === 5123 ? 2 : 1;
        const stride = bv.byteStride && bv.byteStride >= compBytes * 4 ? bv.byteStride : compBytes * 4;
        const base = (bv.byteOffset ?? 0) + (wAcc.byteOffset ?? 0);

        for (let v = 0; v < wAcc.count; v++) {
          const ptr = base + v * stride;
          if (ptr + compBytes * 4 > binChunk.byteLength) {
            skinWeightsValid = false;
            weightCheckDetail = `WEIGHTS_0 accessor exceeds BIN buffer length at vertex ${v}`;
            break;
          }
          let sum = 0;
          for (let k = 0; k < 4; k++) {
            const cOff = ptr + k * compBytes;
            if (wAcc.componentType === 5126) {
              sum += binView.getFloat32(cOff, true);
            } else if (wAcc.componentType === 5123) {
              sum += binView.getUint16(cOff, true) / 65535;
            } else {
              sum += binView.getUint8(cOff) / 255;
            }
          }
          if (!Number.isFinite(sum) || Math.abs(sum - 1.0) > 0.02) {
            skinWeightsValid = false;
            weightCheckDetail = `Unnormalized skin weights detected at vertex ${v} (sum=${sum.toFixed(3)})`;
            break;
          }
        }
      }
    }
  }

  const skins = gltf.skins ?? [];
  const boneCount = skins[0]?.joints?.length ?? 0;
  const hasIbm =
    skins.length > 0 &&
    skins[0].inverseBindMatrices !== undefined &&
    (accessors[skins[0].inverseBindMatrices]?.count ?? 0) >= boneCount;

  checks.push({
    id: 'geometry_topology',
    label: 'Mesh & Topology Integrity',
    status: vertexCount > 0 && triangleCount > 0 ? 'pass' : 'fail',
    detail: `${vertexCount.toLocaleString()} vertices · ${triangleCount.toLocaleString()} triangles across ${primitiveCount} primitives`,
  });

  checks.push({
    id: 'skinning_weights',
    label: 'Armature Skinning & Weights',
    status: skinWeightsValid && hasIbm && boneCount > 0 ? 'pass' : 'fail',
    detail: hasIbm
      ? `${boneCount} skin joints · ${weightCheckDetail}`
      : 'Missing or undersized skin inverseBindMatrices',
  });

  // Verify non-empty facial morph targets for expressions
  const presets = vrmExt?.expressions?.preset ?? {};
  const expressionNames = Object.keys(presets);
  const nonEmptyExpressions: string[] = [];

  for (const exprName of expressionNames) {
    const preset = presets[exprName];
    const binds = preset?.morphTargetBinds ?? [];
    if (binds.length === 0) continue;
    let hasNonZeroDelta = false;
    for (const bind of binds) {
      const targetNode = gltf.nodes?.[bind.node];
      const targetMesh = targetNode?.mesh !== undefined ? meshes[targetNode.mesh] : meshes[0];
      for (const prim of targetMesh?.primitives ?? []) {
        const targetEntry = prim.targets?.[bind.index];
        const posAccIdx = targetEntry?.POSITION;
        if (posAccIdx === undefined) continue;
        const acc = accessors[posAccIdx];
        if (!acc) continue;
        if (acc.min && acc.max && acc.min.length >= 3 && acc.max.length >= 3) {
          const mag =
            Math.max(Math.abs(acc.min[0]), Math.abs(acc.max[0])) +
            Math.max(Math.abs(acc.min[1]), Math.abs(acc.max[1])) +
            Math.max(Math.abs(acc.min[2]), Math.abs(acc.max[2]));
          if (mag > 0.0001) {
            hasNonZeroDelta = true;
            break;
          }
        } else if (acc.bufferView !== undefined && bufferViews[acc.bufferView]) {
          const bv = bufferViews[acc.bufferView];
          const stride = bv.byteStride && bv.byteStride >= 12 ? bv.byteStride : 12;
          const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
          let maxMag = 0;
          for (let i = 0; i < acc.count; i++) {
            const p = base + i * stride;
            if (p + 12 > binChunk.byteLength) break;
            const dx = Math.abs(binView.getFloat32(p, true));
            const dy = Math.abs(binView.getFloat32(p + 4, true));
            const dz = Math.abs(binView.getFloat32(p + 8, true));
            maxMag = Math.max(maxMag, dx + dy + dz);
            if (maxMag > 0.0001) {
              hasNonZeroDelta = true;
              break;
            }
          }
          if (hasNonZeroDelta) break;
        }
      }
      if (hasNonZeroDelta) break;
    }
    if (hasNonZeroDelta) {
      nonEmptyExpressions.push(exprName);
    }
  }

  const missingCoreExpr = CORE_FACIAL_EXPRESSION_PRESETS.filter(
    (name) => !nonEmptyExpressions.includes(name)
  );
  const hasNeutralPreset = 'neutral' in presets;
  const exprStatus: 'pass' | 'warn' | 'fail' =
    nonEmptyExpressions.length === 0
      ? 'fail'
      : missingCoreExpr.length === 0 && hasNeutralPreset
        ? 'pass'
        : 'warn';

  checks.push({
    id: 'facial_expressions',
    label: 'Facial Morph Targets & Expressions',
    status: exprStatus,
    detail:
      missingCoreExpr.length === 0
        ? `${nonEmptyExpressions.length} non-empty facial morph expressions (${expressionNames.length} presets incl. neutral & core set)`
        : `${nonEmptyExpressions.length} non-empty expressions · missing core presets: ${missingCoreExpr.join(', ')}`,
  });

  // Materials, Textures & Image Reference Integrity
  const materialCount = gltf.materials?.length ?? 0;
  const textures = gltf.textures ?? [];
  const images = gltf.images ?? [];
  const textureCount = textures.length;
  const imageCount = images.length;

  let brokenRefs = 0;
  for (const tex of textures) {
    if (tex.source !== undefined && (tex.source < 0 || tex.source >= imageCount)) {
      brokenRefs++;
    }
  }
  for (const img of images) {
    if (img.bufferView !== undefined && (img.bufferView < 0 || img.bufferView >= bufferViews.length)) {
      brokenRefs++;
    }
  }

  checks.push({
    id: 'materials_textures',
    label: 'PBR Materials & Embedded Textures',
    status: brokenRefs > 0 || materialCount === 0 ? 'fail' : 'pass',
    detail:
      brokenRefs > 0
        ? `${brokenRefs} invalid texture/image buffer references`
        : textureCount > 0
          ? `${materialCount} PBR materials · ${textureCount} textures · ${imageCount} embedded images`
          : `${materialCount} PBR materials (factor-based, 0 embedded textures)`,
  });

  const springs = gltf.extensions?.VRMC_springBone?.springs ?? [];
  const springBoneJointCount = springs.reduce((acc, s) => acc + (s.joints?.length ?? 0), 0);
  checks.push({
    id: 'spring_bones',
    label: 'VRMC_springBone Physics',
    status: springBoneJointCount > 0 ? 'pass' : 'warn',
    detail: `${springs.length} spring chains · ${springBoneJointCount} physics joints`,
  });

  const valid = checks.every((c) => c.status !== 'fail');

  return {
    valid,
    vrmVersion: specVersion,
    fileSizeBytes: bytes.byteLength,
    meshCount: meshes.length,
    primitiveCount,
    vertexCount,
    triangleCount,
    materialCount,
    textureCount,
    boneCount,
    mappedHumanoidBones,
    missingRequiredBones,
    expressionCount: expressionNames.length,
    nonEmptyExpressions,
    springBoneJointCount,
    skinWeightsValid,
    checks,
    validatedAt: new Date().toISOString(),
  };
}
