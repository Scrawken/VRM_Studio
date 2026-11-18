import {
  VRM_REQUIRED_HUMANOID_BONES,
  ValidationCheck,
  VrmExportVersion,
  VrmValidationReport,
} from './types';

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
  sparse?: {
    count: number;
    indices: { bufferView: number; byteOffset?: number; componentType: number };
    values: { bufferView: number; byteOffset?: number };
  };
}

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
  accessors?: GltfAccessor[];
  bufferViews?: Array<{
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }>;
  extensionsUsed?: string[];
  extensions?: {
    VRM?: {
      specVersion?: string;
      exporterVersion?: string;
      meta?: {
        title?: string;
        version?: string;
        author?: string;
        licenseName?: string;
        allowedUserName?: string;
        violentUssageName?: string;
        sexualUssageName?: string;
        commercialUssageName?: string;
      };
      humanoid?: {
        humanBones?: Array<{ bone: string; node: number; useDefaultValues?: boolean }>;
      };
      firstPerson?: {
        firstPersonBone?: number;
      };
      blendShapeMaster?: {
        blendShapeGroups?: Array<{
          name?: string;
          presetName?: string;
          isBinary?: boolean;
          binds?: Array<{ mesh: number; index: number; weight: number }>;
        }>;
      };
      secondaryAnimation?: {
        boneGroups?: Array<{
          comment?: string;
          stiffiness?: number;
          gravityPower?: number;
          dragForce?: number;
          hitRadius?: number;
          center?: number;
          bones?: number[];
          colliderGroups?: number[];
        }>;
        colliderGroups?: Array<{
          node: number;
          colliders?: Array<{ offset?: { x: number; y: number; z: number }; radius?: number }>;
        }>;
      };
    };
    VRMC_vrm?: {
      specVersion?: string;
      meta?: {
        name?: string;
        version?: string;
        authors?: string[];
        licenseUrl?: string;
        commercialUsage?: string;
      };
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

const CORE_VRM1_EXPRESSION_PRESETS = [
  'blink',
  'blinkLeft',
  'blinkRight',
  'happy',
  'angry',
  'sad',
  'surprised',
] as const;

const CORE_VRM0_EXPRESSION_PRESETS = [
  'blink',
  'blink_l',
  'blink_r',
  'joy',
  'angry',
  'sorrow',
  'a',
] as const;

function hasNonZeroMorphDelta(
  acc: GltfAccessor | undefined,
  bufferViews: NonNullable<GltfJson['bufferViews']>,
  binChunk: Uint8Array,
  binView: DataView
): boolean {
  if (!acc) return false;
  if (acc.min && acc.max && acc.min.length >= 3 && acc.max.length >= 3) {
    const mag =
      Math.max(Math.abs(acc.min[0]), Math.abs(acc.max[0])) +
      Math.max(Math.abs(acc.min[1]), Math.abs(acc.max[1])) +
      Math.max(Math.abs(acc.min[2]), Math.abs(acc.max[2]));
    if (mag > 0.0001) return true;
  }
  if (acc.sparse && acc.sparse.count > 0 && bufferViews[acc.sparse.values.bufferView]) {
    const bv = bufferViews[acc.sparse.values.bufferView];
    const base = (bv.byteOffset ?? 0) + (acc.sparse.values.byteOffset ?? 0);
    for (let i = 0; i < acc.sparse.count; i++) {
      const p = base + i * 12;
      if (p + 12 > binChunk.byteLength) break;
      const mag =
        Math.abs(binView.getFloat32(p, true)) +
        Math.abs(binView.getFloat32(p + 4, true)) +
        Math.abs(binView.getFloat32(p + 8, true));
      if (mag > 0.0001) return true;
    }
  }
  if (acc.bufferView !== undefined && bufferViews[acc.bufferView]) {
    const bv = bufferViews[acc.bufferView];
    const stride = bv.byteStride && bv.byteStride >= 12 ? bv.byteStride : 12;
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    for (let i = 0; i < acc.count; i++) {
      const p = base + i * stride;
      if (p + 12 > binChunk.byteLength) break;
      const mag =
        Math.abs(binView.getFloat32(p, true)) +
        Math.abs(binView.getFloat32(p + 4, true)) +
        Math.abs(binView.getFloat32(p + 8, true));
      if (mag > 0.0001) return true;
    }
  }
  return false;
}

export function validateVrmBinary(
  bytes: Uint8Array,
  expectedVersion?: VrmExportVersion
): VrmValidationReport {
  const checks: ValidationCheck[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const failReport = (reason: string): VrmValidationReport => ({
    valid: false,
    vrmVersion: 'unknown',
    expectedVersion,
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
    return failReport(
      `GLB declared length (${declaredLen}) does not match actual buffer (${bytes.byteLength}).`
    );
  }
  checks.push({
    id: 'glb_header',
    label: 'glTF 2.0 Binary Header',
    status: 'pass',
    detail: `Valid glTF v2 container (${(bytes.byteLength / 1024).toFixed(1)} KB)`,
  });

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
  const vrm0Ext = gltf.extensions?.VRM;
  const vrm1Ext = gltf.extensions?.VRMC_vrm;

  // Determine detected VRM format & enforce strict version separation
  let detectedVersion = 'missing';
  if (vrm0Ext && vrm1Ext) {
    detectedVersion = 'ambiguous';
  } else if (vrm0Ext) {
    detectedVersion = vrm0Ext.specVersion === '0.0' || !vrm0Ext.specVersion ? '0.0' : String(vrm0Ext.specVersion);
  } else if (vrm1Ext) {
    detectedVersion = vrm1Ext.specVersion ?? 'unknown';
  }

  const isVrm0 = Boolean(vrm0Ext && !vrm1Ext && (vrm0Ext.specVersion === '0.0' || !vrm0Ext.specVersion));
  const isVrm1 = Boolean(vrm1Ext && !vrm0Ext && vrm1Ext.specVersion === '1.0');

  let versionCheckPass = isVrm0 || isVrm1;
  if (expectedVersion === '0.0') {
    versionCheckPass = isVrm0;
  } else if (expectedVersion === '1.0') {
    versionCheckPass = isVrm1;
  }

  const metaSummary: VrmValidationReport['metaSummary'] = isVrm0
    ? {
        title: vrm0Ext?.meta?.title || 'Unnamed',
        author: vrm0Ext?.meta?.author || 'Unspecified',
        licenseName: vrm0Ext?.meta?.licenseName || 'Other',
        commercialUsage: vrm0Ext?.meta?.commercialUssageName || 'Disallow',
      }
    : isVrm1
      ? {
          title: vrm1Ext?.meta?.name || 'Unnamed',
          author: vrm1Ext?.meta?.authors?.join(', ') || 'Unspecified',
          licenseName: vrm1Ext?.meta?.licenseUrl || 'VRM 1.0',
          commercialUsage: vrm1Ext?.meta?.commercialUsage || 'personalNonProfit',
        }
      : undefined;

  checks.push({
    id: 'vrm_extension',
    label: expectedVersion ? `VRM ${expectedVersion} Extension` : 'VRM Extension (0.0 / 1.0)',
    status: versionCheckPass ? 'pass' : 'fail',
    detail: versionCheckPass
      ? isVrm0
        ? `VRM 0.0 (extensions.VRM, specVersion=${detectedVersion}) · Title: "${metaSummary?.title}" · Commercial: ${metaSummary?.commercialUsage}`
        : `VRMC_vrm specVersion ${detectedVersion} · Title: "${metaSummary?.title}"`
      : expectedVersion
        ? `Expected VRM ${expectedVersion}, but found "${detectedVersion}"`
        : `Missing or ambiguous VRM extension (found "${detectedVersion}")`,
  });

  // Humanoid bone mapping validation
  const nodeCount = gltf.nodes?.length ?? 0;
  const boneMap = new Map<string, number>();
  let invalidHumanoidFormat = false;

  if (isVrm0) {
    const rawBones = vrm0Ext?.humanoid?.humanBones;
    if (!Array.isArray(rawBones)) {
      invalidHumanoidFormat = true;
    } else {
      for (const entry of rawBones) {
        if (entry && typeof entry.bone === 'string' && typeof entry.node === 'number') {
          boneMap.set(entry.bone, entry.node);
        }
      }
    }
  } else if (isVrm1) {
    const rawBones = vrm1Ext?.humanoid?.humanBones ?? {};
    for (const [bName, ref] of Object.entries(rawBones)) {
      if (ref && typeof ref.node === 'number') {
        boneMap.set(bName, ref.node);
      }
    }
  }

  const mappedHumanoidBones = Array.from(boneMap.keys());
  const missingRequiredBones = VRM_REQUIRED_HUMANOID_BONES.filter((b) => !boneMap.has(b));
  const invalidBoneNodes = mappedHumanoidBones.filter((b) => {
    const idx = boneMap.get(b);
    return typeof idx !== 'number' || idx < 0 || idx >= nodeCount;
  });

  if (isVrm0 && vrm0Ext?.firstPerson?.firstPersonBone !== undefined) {
    const fpIdx = vrm0Ext.firstPerson.firstPersonBone;
    if (typeof fpIdx !== 'number' || fpIdx < 0 || fpIdx >= nodeCount) {
      invalidBoneNodes.push('firstPersonBone');
    }
  }

  checks.push({
    id: 'humanoid_bones',
    label: 'VRM Humanoid Bone Mapping',
    status:
      !invalidHumanoidFormat && missingRequiredBones.length === 0 && invalidBoneNodes.length === 0
        ? 'pass'
        : 'fail',
    detail: invalidHumanoidFormat
      ? 'VRM 0.0 humanoid.humanBones must be an array of { bone, node } entries'
      : missingRequiredBones.length === 0 && invalidBoneNodes.length === 0
        ? `All ${VRM_REQUIRED_HUMANOID_BONES.length} required bones + ${Math.max(0, mappedHumanoidBones.length - VRM_REQUIRED_HUMANOID_BONES.length)} optional/finger bones mapped`
        : invalidBoneNodes.length > 0
          ? `Invalid node indices for bones: ${invalidBoneNodes.join(', ')}`
          : `Missing required bones: ${missingRequiredBones.join(', ')}`,
  });

  // Mesh Geometry, Skinning & Weight Normalization
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
      } else if (posAcc) {
        triangleCount += Math.floor(posAcc.count / 3);
      }

      if (wAcc && wAcc.bufferView !== undefined && bufferViews[wAcc.bufferView]) {
        const bv = bufferViews[wAcc.bufferView];
        const compBytes = wAcc.componentType === 5126 ? 4 : wAcc.componentType === 5123 ? 2 : 1;
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
          if (!Number.isFinite(sum) || Math.abs(sum - 1.0) > 0.025) {
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

  // Expression / BlendShape Validation (VRM 0.0 vs VRM 1.0)
  const nonEmptyExpressions: string[] = [];
  let expressionCount = 0;
  let blendShapeGroupCount = 0;
  let invalidBindCount = 0;
  let exprDetail = '';
  let exprStatus: 'pass' | 'warn' | 'fail' = 'fail';

  if (isVrm0) {
    const groups = vrm0Ext?.blendShapeMaster?.blendShapeGroups ?? [];
    blendShapeGroupCount = groups.length;
    expressionCount = groups.length;
    const seenPresets = new Set<string>();

    for (const grp of groups) {
      const presetKey = (grp.presetName && grp.presetName !== 'unknown'
        ? grp.presetName
        : grp.name || 'unknown'
      ).toLowerCase();
      seenPresets.add(presetKey);
      const binds = grp.binds ?? [];
      if (binds.length === 0) continue;

      let hasDelta = false;
      for (const b of binds) {
        const targetMesh = meshes[b.mesh];
        if (!targetMesh || b.mesh < 0 || b.mesh >= meshes.length) {
          invalidBindCount++;
          continue;
        }
        for (const prim of targetMesh.primitives ?? []) {
          const targetEntry = prim.targets?.[b.index];
          const posAccIdx = targetEntry?.POSITION;
          if (posAccIdx !== undefined && hasNonZeroMorphDelta(accessors[posAccIdx], bufferViews, binChunk, binView)) {
            hasDelta = true;
            break;
          }
        }
        if (hasDelta) break;
      }
      if (hasDelta && !nonEmptyExpressions.includes(presetKey)) {
        nonEmptyExpressions.push(presetKey);
      }
    }

    const missingCore0 = CORE_VRM0_EXPRESSION_PRESETS.filter(
      (p) => !nonEmptyExpressions.includes(p)
    );
    const hasNeutral0 = seenPresets.has('neutral');
    exprStatus =
      invalidBindCount > 0 || nonEmptyExpressions.length === 0
        ? 'fail'
        : missingCore0.length === 0 && hasNeutral0
          ? 'pass'
          : 'warn';
    exprDetail =
      invalidBindCount > 0
        ? `${invalidBindCount} invalid VRM 0.0 blendShapeMaster mesh/target binds`
        : missingCore0.length === 0
          ? `${nonEmptyExpressions.length} non-empty VRM 0.0 blendShapeGroups (${blendShapeGroupCount} total incl. neutral)`
          : `${nonEmptyExpressions.length} non-empty VRM 0.0 groups · missing core: ${missingCore0.join(', ')}`;
  } else {
    const presets = vrm1Ext?.expressions?.preset ?? {};
    const expressionNames = Object.keys(presets);
    expressionCount = expressionNames.length;
    blendShapeGroupCount = expressionCount;

    for (const exprName of expressionNames) {
      const preset = presets[exprName];
      const binds = preset?.morphTargetBinds ?? [];
      if (binds.length === 0) continue;
      let hasDelta = false;
      for (const bind of binds) {
        const targetNode = gltf.nodes?.[bind.node];
        const targetMesh = targetNode?.mesh !== undefined ? meshes[targetNode.mesh] : meshes[0];
        for (const prim of targetMesh?.primitives ?? []) {
          const targetEntry = prim.targets?.[bind.index];
          const posAccIdx = targetEntry?.POSITION;
          if (posAccIdx !== undefined && hasNonZeroMorphDelta(accessors[posAccIdx], bufferViews, binChunk, binView)) {
            hasDelta = true;
            break;
          }
        }
        if (hasDelta) break;
      }
      if (hasDelta) {
        nonEmptyExpressions.push(exprName);
      }
    }

    const missingCore1 = CORE_VRM1_EXPRESSION_PRESETS.filter(
      (name) => !nonEmptyExpressions.includes(name)
    );
    const hasNeutralPreset = 'neutral' in presets;
    exprStatus =
      nonEmptyExpressions.length === 0
        ? 'fail'
        : missingCore1.length === 0 && hasNeutralPreset
          ? 'pass'
          : 'warn';
    exprDetail =
      missingCore1.length === 0
        ? `${nonEmptyExpressions.length} non-empty facial morph expressions (${expressionNames.length} presets incl. neutral & core set)`
        : `${nonEmptyExpressions.length} non-empty expressions · missing core presets: ${missingCore1.join(', ')}`;
  }

  checks.push({
    id: 'facial_expressions',
    label: isVrm0 ? 'VRM 0.0 BlendShapeMaster' : 'Facial Morph Targets & Expressions',
    status: exprStatus,
    detail: exprDetail,
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

  // Secondary Animation / Spring Bone Physics
  let springBoneJointCount = 0;
  let secondaryBoneGroupCount = 0;
  let colliderGroupCount = 0;
  let springStatus: 'pass' | 'warn' | 'fail' = 'warn';
  let springDetail = '';

  if (isVrm0) {
    const boneGroups = vrm0Ext?.secondaryAnimation?.boneGroups ?? [];
    const colliderGroups = vrm0Ext?.secondaryAnimation?.colliderGroups ?? [];
    secondaryBoneGroupCount = boneGroups.length;
    colliderGroupCount = colliderGroups.length;

    let badSpringRefs = 0;
    for (const bg of boneGroups) {
      if ((bg.stiffiness ?? 0) < 0 || (bg.hitRadius ?? 0) < 0) badSpringRefs++;
      for (const bNode of bg.bones ?? []) {
        if (typeof bNode !== 'number' || bNode < 0 || bNode >= nodeCount) {
          badSpringRefs++;
        } else {
          springBoneJointCount++;
        }
      }
      for (const cgIdx of bg.colliderGroups ?? []) {
        if (typeof cgIdx !== 'number' || cgIdx < 0 || cgIdx >= colliderGroups.length) {
          badSpringRefs++;
        }
      }
    }
    for (const cg of colliderGroups) {
      if (typeof cg.node !== 'number' || cg.node < 0 || cg.node >= nodeCount) {
        badSpringRefs++;
      }
    }

    springStatus =
      badSpringRefs > 0
        ? 'fail'
        : springBoneJointCount > 0 || secondaryBoneGroupCount === 0
          ? 'pass'
          : 'warn';
    springDetail =
      badSpringRefs > 0
        ? `${badSpringRefs} invalid VRM 0.0 secondaryAnimation node or colliderGroup references`
        : `${secondaryBoneGroupCount} boneGroups (${springBoneJointCount} physics roots) · ${colliderGroupCount} colliderGroups`;
  } else {
    const springs = gltf.extensions?.VRMC_springBone?.springs ?? [];
    secondaryBoneGroupCount = springs.length;
    springBoneJointCount = springs.reduce((acc, s) => acc + (s.joints?.length ?? 0), 0);
    springStatus = springBoneJointCount > 0 ? 'pass' : 'warn';
    springDetail = `${springs.length} spring chains · ${springBoneJointCount} physics joints`;
  }

  checks.push({
    id: 'spring_bones',
    label: isVrm0 ? 'VRM 0.0 SecondaryAnimation' : 'VRMC_springBone Physics',
    status: springStatus,
    detail: springDetail,
  });

  const valid = checks.every((c) => c.status !== 'fail');

  return {
    valid,
    vrmVersion: isVrm0 ? '0.0' : isVrm1 ? '1.0' : detectedVersion,
    expectedVersion,
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
    expressionCount,
    nonEmptyExpressions,
    springBoneJointCount,
    blendShapeGroupCount,
    secondaryBoneGroupCount,
    colliderGroupCount,
    metaSummary,
    skinWeightsValid,
    checks,
    validatedAt: new Date().toISOString(),
  };
}
