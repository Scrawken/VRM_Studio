import {
  VRM0_ALLOWANCES,
  VRM0_ALLOWED_USERS,
  VRM0_BLEND_SHAPE_PRESETS,
  VRM0_HUMANOID_BONES,
  VRM0_LICENSE_NAMES,
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
  normalized?: boolean;
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
  nodes?: Array<{
    name?: string;
    children?: number[];
    mesh?: number;
    skin?: number;
  }>;
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
  textures?: Array<{ source?: number; sampler?: number }>;
  samplers?: Array<Record<string, unknown>>;
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
        meshAnnotations?: Array<{ mesh?: number; firstPersonFlag?: string }>;
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
          gravityDir?: unknown;
          bones?: number[];
          colliderGroups?: number[];
        }>;
        colliderGroups?: Array<{
          node: number;
          colliders?: Array<{ offset?: { x?: number; y?: number; z?: number }; radius?: number }>;
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
      colliders?: Array<{
        node?: number;
        shape?: { sphere?: { offset?: number[]; radius?: number } };
      }>;
      colliderGroups?: Array<{ name?: string; colliders?: number[] }>;
      springs?: Array<{
        name?: string;
        center?: number;
        colliderGroups?: number[];
        joints?: Array<{ node: number; hitRadius?: number; stiffness?: number; dragForce?: number }>;
      }>;
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

const VRM0_BONE_SET = new Set<string>(VRM0_HUMANOID_BONES);
const VRM0_PRESET_SET = new Set<string>(VRM0_BLEND_SHAPE_PRESETS);
const VRM0_ALLOWED_USER_SET = new Set<string>(VRM0_ALLOWED_USERS);
const VRM0_ALLOWANCE_SET = new Set<string>(VRM0_ALLOWANCES);
const VRM0_LICENSE_SET = new Set<string>(VRM0_LICENSE_NAMES);

const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

function componentByteSize(componentType: number): number {
  switch (componentType) {
    case 5120:
    case 5121:
      return 1;
    case 5122:
    case 5123:
      return 2;
    case 5125:
    case 5126:
      return 4;
    default:
      return 0;
  }
}

function isAccessorInBounds(
  accIdx: number | undefined,
  accessors: GltfAccessor[],
  bufferViews: NonNullable<GltfJson['bufferViews']>,
  binByteLength: number
): boolean {
  if (accIdx === undefined || !Number.isInteger(accIdx) || accIdx < 0 || accIdx >= accessors.length) {
    return false;
  }
  const acc = accessors[accIdx];
  const comps = TYPE_COMPONENTS[acc.type];
  const compBytes = componentByteSize(acc.componentType);
  if (!comps || !compBytes || !Number.isInteger(acc.count) || acc.count < 0) return false;
  if (acc.bufferView === undefined) {
    return Boolean(acc.sparse && acc.sparse.count >= 0);
  }
  const bv = bufferViews[acc.bufferView];
  if (!bv) return false;
  const elemSize = comps * compBytes;
  const stride = bv.byteStride && bv.byteStride >= elemSize ? bv.byteStride : elemSize;
  const bvStart = bv.byteOffset ?? 0;
  const bvEnd = bvStart + bv.byteLength;
  if (bvStart < 0 || bvEnd > binByteLength) return false;
  if (acc.count === 0) return true;
  const accStart = bvStart + (acc.byteOffset ?? 0);
  const accEnd = accStart + (acc.count - 1) * stride + elemSize;
  return accStart >= bvStart && accEnd <= bvEnd && accEnd <= binByteLength;
}

function readNormalizedWeightComponents(
  acc: GltfAccessor,
  v: number,
  bufferViews: NonNullable<GltfJson['bufferViews']>,
  binChunk: Uint8Array,
  binView: DataView
): number | null {
  if (acc.bufferView === undefined) return null;
  const bv = bufferViews[acc.bufferView];
  if (!bv) return null;
  const compBytes = componentByteSize(acc.componentType);
  if (!compBytes) return null;
  const stride = bv.byteStride && bv.byteStride >= compBytes * 4 ? bv.byteStride : compBytes * 4;
  const ptr = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + v * stride;
  if (ptr < 0 || ptr + compBytes * 4 > binChunk.byteLength) return null;
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    const cOff = ptr + k * compBytes;
    let w: number;
    if (acc.componentType === 5126) {
      w = binView.getFloat32(cOff, true);
    } else if (acc.componentType === 5123) {
      w = binView.getUint16(cOff, true) / 65535;
    } else if (acc.componentType === 5121) {
      w = binView.getUint8(cOff) / 255;
    } else {
      return null;
    }
    if (!Number.isFinite(w) || w < -0.001) return null;
    sum += w;
  }
  return sum;
}

function hasNonZeroMorphDelta(
  acc: GltfAccessor | undefined,
  bufferViews: NonNullable<GltfJson['bufferViews']>,
  binChunk: Uint8Array,
  binView: DataView
): boolean {
  if (!acc || acc.type !== 'VEC3' || acc.componentType !== 5126) return false;
  if (acc.sparse && acc.sparse.count > 0 && bufferViews[acc.sparse.values.bufferView]) {
    const bv = bufferViews[acc.sparse.values.bufferView];
    const base = (bv.byteOffset ?? 0) + (acc.sparse.values.byteOffset ?? 0);
    for (let i = 0; i < acc.sparse.count; i++) {
      const p = base + i * 12;
      if (p + 12 > binChunk.byteLength) break;
      const dx = binView.getFloat32(p, true);
      const dy = binView.getFloat32(p + 4, true);
      const dz = binView.getFloat32(p + 8, true);
      if (Number.isFinite(dx) && Number.isFinite(dy) && Number.isFinite(dz)) {
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 0.0001) return true;
      }
    }
  }
  if (acc.bufferView !== undefined && bufferViews[acc.bufferView]) {
    const bv = bufferViews[acc.bufferView];
    const stride = bv.byteStride && bv.byteStride >= 12 ? bv.byteStride : 12;
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    for (let i = 0; i < acc.count; i++) {
      const p = base + i * stride;
      if (p + 12 > binChunk.byteLength) break;
      const dx = binView.getFloat32(p, true);
      const dy = binView.getFloat32(p + 4, true);
      const dz = binView.getFloat32(p + 8, true);
      if (Number.isFinite(dx) && Number.isFinite(dy) && Number.isFinite(dz)) {
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 0.0001) return true;
      }
    }
  }
  return false;
}

const VRM0_FIRST_PERSON_FLAGS = new Set(['Auto', 'Both', 'ThirdPersonOnly', 'FirstPersonOnly']);
const VRM0_LOOK_AT_TYPES = new Set(['None', 'Bone', 'BlendShape']);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** VRM 0.0 checks beyond the permission enums: meta types, firstPerson enums, blendShape and material schema. */
function validateVrm0Extras(
  vrm0: Record<string, unknown>,
  textureCount: number,
  materialNames: string[] = [],
  warnings: string[] = []
): string[] {
  const errs: string[] = [];
  const meta = vrm0.meta;
  if (isPlainObject(meta)) {
    for (const key of ['title', 'version', 'author', 'contactInformation', 'reference', 'otherPermissionUrl', 'otherLicenseUrl']) {
      if (meta[key] !== undefined && typeof meta[key] !== 'string') errs.push(`meta.${key} must be a string`);
    }
    const tex = meta.texture;
    if (tex !== undefined && (!Number.isInteger(tex) || (tex as number) < -1 || (tex as number) >= textureCount)) {
      errs.push(`meta.texture ${String(tex)} is not -1 or a valid texture index`);
    }
  }

  const fp = vrm0.firstPerson;
  if (isPlainObject(fp)) {
    if (fp.lookAtTypeName !== undefined && !VRM0_LOOK_AT_TYPES.has(String(fp.lookAtTypeName))) {
      errs.push(`Invalid firstPerson.lookAtTypeName "${String(fp.lookAtTypeName)}"`);
    }
    if (Array.isArray(fp.meshAnnotations)) {
      for (const ma of fp.meshAnnotations) {
        const flag = isPlainObject(ma) ? ma.firstPersonFlag : undefined;
        if (flag !== undefined && !VRM0_FIRST_PERSON_FLAGS.has(String(flag))) {
          errs.push(`Invalid firstPersonFlag "${String(flag)}"`);
        }
      }
    }
  }

  const groups = isPlainObject(vrm0.blendShapeMaster) ? vrm0.blendShapeMaster.blendShapeGroups : undefined;
  if (Array.isArray(groups)) {
    const seen = new Set<string>();
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (!isPlainObject(g)) {
        errs.push(`blendShapeGroups[${i}] is not an object`);
        continue;
      }
      if (g.isBinary !== undefined && typeof g.isBinary !== 'boolean') {
        errs.push(`blendShapeGroups[${i}].isBinary must be boolean`);
      }
      if (typeof g.presetName === 'string' && g.presetName !== 'unknown') {
        if (seen.has(g.presetName)) errs.push(`Duplicate blendShapeGroup presetName "${g.presetName}"`);
        seen.add(g.presetName);
      }
      if (g.materialValues !== undefined) {
        if (!Array.isArray(g.materialValues)) {
          errs.push(`blendShapeGroups[${i}].materialValues must be an array`);
        } else {
          for (const mv of g.materialValues) {
            if (
              !isPlainObject(mv) ||
              typeof mv.materialName !== 'string' ||
              typeof mv.propertyName !== 'string' ||
              !Array.isArray(mv.targetValue) ||
              !mv.targetValue.every(isFiniteNumber)
            ) {
              errs.push(`blendShapeGroups[${i}].materialValues has a malformed entry`);
              break;
            }
            if (!materialNames.includes(mv.materialName)) {
              errs.push(
                `blendShapeGroups[${i}].materialValues references unknown material "${mv.materialName}"`
              );
            }
          }
        }
      }
    }
  }

  const mps = vrm0.materialProperties;
  if (mps !== undefined) {
    if (!Array.isArray(mps)) {
      errs.push('materialProperties must be an array');
    } else {
      if (mps.length !== materialNames.length) {
        warnings.push(
          `materialProperties has ${mps.length} entries but the glTF has ${materialNames.length} materials`
        );
      }
      mps.forEach((mp, i) => {
        if (!isPlainObject(mp)) {
          errs.push(`materialProperties[${i}] is not an object`);
          return;
        }
        if (mp.name !== undefined && typeof mp.name !== 'string') errs.push(`materialProperties[${i}].name must be a string`);
        if (mp.shader !== undefined && typeof mp.shader !== 'string') errs.push(`materialProperties[${i}].shader must be a string`);
        if (mp.renderQueue !== undefined && !Number.isInteger(mp.renderQueue)) {
          errs.push(`materialProperties[${i}].renderQueue must be an integer`);
        }
        const mapOf = (key: string, ok: (v: unknown) => boolean, what: string) => {
          const m = mp[key];
          if (m === undefined) return;
          if (!isPlainObject(m) || !Object.values(m).every(ok)) errs.push(`materialProperties[${i}].${key} must map to ${what}`);
        };
        mapOf('floatProperties', isFiniteNumber, 'finite numbers');
        mapOf('vectorProperties', (v) => Array.isArray(v) && v.every(isFiniteNumber), 'number arrays');
        mapOf(
          'textureProperties',
          (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < textureCount,
          'valid texture indices'
        );
        mapOf('keywordMap', (v) => typeof v === 'boolean', 'booleans');
        mapOf('tagMap', (v) => typeof v === 'string', 'strings');
      });
    }
  }
  return errs;
}

/** Nearest mapped humanoid ancestors allowed for each bone (optional bones may be skipped). */
const HUMANOID_ALLOWED_PARENTS: Record<string, string[]> = {
  spine: ['hips'],
  chest: ['spine', 'hips'],
  upperChest: ['chest', 'spine'],
  neck: ['upperChest', 'chest', 'spine'],
  head: ['neck'],
  leftEye: ['head'],
  rightEye: ['head'],
  jaw: ['head'],
  leftShoulder: ['upperChest', 'chest', 'spine'],
  rightShoulder: ['upperChest', 'chest', 'spine'],
  leftUpperArm: ['leftShoulder', 'upperChest', 'chest', 'spine'],
  rightUpperArm: ['rightShoulder', 'upperChest', 'chest', 'spine'],
  leftLowerArm: ['leftUpperArm'],
  rightLowerArm: ['rightUpperArm'],
  leftHand: ['leftLowerArm'],
  rightHand: ['rightLowerArm'],
  leftUpperLeg: ['hips'],
  rightUpperLeg: ['hips'],
  leftLowerLeg: ['leftUpperLeg'],
  rightLowerLeg: ['rightUpperLeg'],
  leftFoot: ['leftLowerLeg'],
  rightFoot: ['rightLowerLeg'],
  leftToes: ['leftFoot'],
  rightToes: ['rightFoot'],
};
for (const side of ['left', 'right']) {
  for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
    const hand = `${side}Hand`;
    const prox = `${side}${finger}Proximal`;
    const inter = `${side}${finger}Intermediate`;
    const dist = `${side}${finger}Distal`;
    HUMANOID_ALLOWED_PARENTS[prox] = [hand];
    HUMANOID_ALLOWED_PARENTS[inter] = [prox, hand];
    HUMANOID_ALLOWED_PARENTS[dist] = [inter, prox, hand];
  }
}

function humanoidHierarchyWarnings(
  boneMap: Map<string, number>,
  nodes: NonNullable<GltfJson['nodes']>
): string[] {
  const parentOf = new Map<number, number>();
  nodes.forEach((n, i) => {
    for (const ch of Array.isArray(n?.children) ? n.children : []) {
      if (Number.isInteger(ch) && !parentOf.has(ch)) parentOf.set(ch, i);
    }
  });
  const nodeToBone = new Map<number, string>();
  for (const [b, n] of boneMap) nodeToBone.set(n, b);
  const warnings: string[] = [];
  for (const [bone, node] of boneMap) {
    if (!Number.isInteger(node) || node < 0 || node >= nodes.length) continue;
    const allowed = HUMANOID_ALLOWED_PARENTS[bone];
    if (!allowed) continue;
    let cur = parentOf.get(node);
    let guard = 0;
    while (cur !== undefined && !nodeToBone.has(cur) && guard++ <= nodes.length) cur = parentOf.get(cur);
    const ancestor = cur !== undefined ? nodeToBone.get(cur) : undefined;
    if (ancestor === undefined || !allowed.includes(ancestor)) {
      warnings.push(`"${bone}" nearest humanoid ancestor is ${ancestor ? `"${ancestor}"` : 'none'} (expected ${allowed.join(' / ')})`);
    }
  }
  return warnings;
}

const MORPH_DELTA_ATTRIBUTES = ['POSITION', 'NORMAL', 'TANGENT'] as const;

/** A morph target is non-empty when any of POSITION / NORMAL / TANGENT carries a non-zero delta. */
function morphTargetHasDelta(
  targetEntry: Record<string, number>,
  accessors: GltfAccessor[],
  bufferViews: NonNullable<GltfJson['bufferViews']>,
  binChunk: Uint8Array,
  binView: DataView
): boolean {
  for (const attr of MORPH_DELTA_ATTRIBUTES) {
    const accIdx = targetEntry[attr];
    if (
      accIdx !== undefined &&
      isAccessorInBounds(accIdx, accessors, bufferViews, binChunk.byteLength) &&
      hasNonZeroMorphDelta(accessors[accIdx], bufferViews, binChunk, binView)
    ) {
      return true;
    }
  }
  return false;
}

export function validateVrmBinary(
  bytes: Uint8Array,
  expectedVersion?: VrmExportVersion
): VrmValidationReport {
  const checks: ValidationCheck[] = [];
  const vrm0MaterialWarnings: string[] = [];
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

  const extensionsUsed = Array.isArray(gltf.extensionsUsed) ? gltf.extensionsUsed : [];
  const hasRequiredExtUsed = isVrm0
    ? extensionsUsed.includes('VRM')
    : isVrm1
      ? extensionsUsed.includes('VRMC_vrm')
      : false;

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
    status: versionCheckPass && hasRequiredExtUsed ? 'pass' : 'fail',
    detail: !versionCheckPass
      ? expectedVersion
        ? `Expected VRM ${expectedVersion}, but found "${detectedVersion}"`
        : `Missing or ambiguous VRM extension (found "${detectedVersion}")`
      : !hasRequiredExtUsed
        ? `extensionsUsed is missing required "${isVrm0 ? 'VRM' : 'VRMC_vrm'}" entry`
        : isVrm0
          ? `VRM 0.0 (extensions.VRM, specVersion=${detectedVersion}) · Title: "${metaSummary?.title}" · Commercial: ${metaSummary?.commercialUsage}`
          : `VRMC_vrm specVersion ${detectedVersion} · Title: "${metaSummary?.title}"`,
  });

  // Metadata permission enum audit for VRM 0.0
  if (isVrm0) {
    const metaErrors: string[] = [];
    const m0 = vrm0Ext?.meta;
    if (!m0) {
      metaErrors.push('VRM.meta is missing');
    } else {
      if (m0.allowedUserName !== undefined && !VRM0_ALLOWED_USER_SET.has(m0.allowedUserName)) {
        metaErrors.push(`Invalid allowedUserName "${m0.allowedUserName}"`);
      }
      if (m0.violentUssageName !== undefined && !VRM0_ALLOWANCE_SET.has(m0.violentUssageName)) {
        metaErrors.push(`Invalid violentUssageName "${m0.violentUssageName}"`);
      }
      if (m0.sexualUssageName !== undefined && !VRM0_ALLOWANCE_SET.has(m0.sexualUssageName)) {
        metaErrors.push(`Invalid sexualUssageName "${m0.sexualUssageName}"`);
      }
      if (m0.commercialUssageName !== undefined && !VRM0_ALLOWANCE_SET.has(m0.commercialUssageName)) {
        metaErrors.push(`Invalid commercialUssageName "${m0.commercialUssageName}"`);
      }
      if (m0.licenseName !== undefined && !VRM0_LICENSE_SET.has(m0.licenseName)) {
        metaErrors.push(`Invalid licenseName "${m0.licenseName}"`);
      }
      metaErrors.push(
        ...validateVrm0Extras(
          vrm0Ext as unknown as Record<string, unknown>,
          (gltf.textures ?? []).length,
          (gltf.materials ?? []).map((m: { name?: string }) => m?.name ?? ''),
          vrm0MaterialWarnings
        )
      );
    }
    checks.push({
      id: 'vrm_metadata',
      label: 'VRM 0.0 Metadata & Permission Enums',
      status: metaErrors.length === 0 ? 'pass' : 'fail',
      detail:
        metaErrors.length === 0
          ? `Valid VRM 0.0 license (${m0?.licenseName || 'Other'}, Commercial=${m0?.commercialUssageName || 'Disallow'})`
          : metaErrors.join('; '),
    });
  }

  // Node hierarchy bounds & acyclicity check
  const nodes = gltf.nodes ?? [];
  const nodeCount = nodes.length;
  const meshes = gltf.meshes ?? [];
  const skins = gltf.skins ?? [];
  const hierarchyErrors: string[] = [];
  const visitState = new Uint8Array(nodeCount);

  const dfsNode = (idx: number) => {
    if (visitState[idx] === 1) {
      hierarchyErrors.push(`Cycle detected at node ${idx}`);
      return;
    }
    if (visitState[idx] === 2) return;
    visitState[idx] = 1;
    const node = nodes[idx];
    if (node.mesh !== undefined && (!Number.isInteger(node.mesh) || node.mesh < 0 || node.mesh >= meshes.length)) {
      hierarchyErrors.push(`Node ${idx} references out-of-range mesh ${node.mesh}`);
    }
    if (node.skin !== undefined && (!Number.isInteger(node.skin) || node.skin < 0 || node.skin >= skins.length)) {
      hierarchyErrors.push(`Node ${idx} references out-of-range skin ${node.skin}`);
    }
    for (const ch of node.children ?? []) {
      if (!Number.isInteger(ch) || ch < 0 || ch >= nodeCount) {
        hierarchyErrors.push(`Node ${idx} has out-of-range child ${ch}`);
      } else {
        dfsNode(ch);
      }
    }
    visitState[idx] = 2;
  };
  for (let i = 0; i < nodeCount; i++) {
    if (visitState[i] === 0) dfsNode(i);
  }
  checks.push({
    id: 'node_hierarchy',
    label: 'Scene Node Hierarchy',
    status: nodeCount > 0 && hierarchyErrors.length === 0 ? 'pass' : 'fail',
    detail:
      nodeCount === 0
        ? 'glTF contains zero nodes'
        : hierarchyErrors.length === 0
          ? `${nodeCount} acyclic scene nodes verified`
          : hierarchyErrors.slice(0, 3).join('; '),
  });

  // Humanoid bone mapping validation
  const boneMap = new Map<string, number>();
  const humanoidErrors: string[] = [];

  if (isVrm0) {
    const rawBones = vrm0Ext?.humanoid?.humanBones;
    if (!Array.isArray(rawBones)) {
      humanoidErrors.push('VRM 0.0 humanoid.humanBones must be an array');
    } else {
      const seenNodes = new Map<number, string>();
      for (const entry of rawBones) {
        if (!entry || typeof entry.bone !== 'string' || !Number.isInteger(entry.node)) {
          humanoidErrors.push('Malformed humanBones entry');
          continue;
        }
        if (!VRM0_BONE_SET.has(entry.bone)) {
          humanoidErrors.push(`Non-conformant VRM 0.0 bone name "${entry.bone}"`);
          continue;
        }
        if (boneMap.has(entry.bone)) {
          humanoidErrors.push(`Duplicate humanoid bone "${entry.bone}"`);
          continue;
        }
        if (seenNodes.has(entry.node)) {
          humanoidErrors.push(
            `Node ${entry.node} mapped to multiple bones ("${seenNodes.get(entry.node)}" and "${entry.bone}")`
          );
          continue;
        }
        seenNodes.set(entry.node, entry.bone);
        boneMap.set(entry.bone, entry.node);
      }
    }
  } else if (isVrm1) {
    const rawBones = vrm1Ext?.humanoid?.humanBones ?? {};
    const seenNodes = new Map<number, string>();
    for (const [bName, ref] of Object.entries(rawBones)) {
      if (ref && Number.isInteger(ref.node)) {
        if (seenNodes.has(ref.node)) {
          humanoidErrors.push(`Node ${ref.node} mapped to multiple bones ("${seenNodes.get(ref.node)}" and "${bName}")`);
        } else {
          seenNodes.set(ref.node, bName);
          boneMap.set(bName, ref.node);
        }
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
    if (!Number.isInteger(fpIdx) || fpIdx < -1 || fpIdx >= nodeCount) {
      invalidBoneNodes.push(`firstPersonBone(${fpIdx})`);
    }
  }
  if (isVrm0 && Array.isArray(vrm0Ext?.firstPerson?.meshAnnotations)) {
    for (const ma of vrm0Ext.firstPerson.meshAnnotations) {
      if (ma.mesh === undefined || !Number.isInteger(ma.mesh) || ma.mesh < 0 || ma.mesh >= meshes.length) {
        humanoidErrors.push(`firstPerson.meshAnnotations references invalid mesh ${String(ma.mesh)}`);
      }
    }
  }

  checks.push({
    id: 'humanoid_bones',
    label: 'VRM Humanoid Bone Mapping',
    status:
      humanoidErrors.length === 0 && missingRequiredBones.length === 0 && invalidBoneNodes.length === 0
        ? 'pass'
        : 'fail',
    detail:
      humanoidErrors.length > 0
        ? humanoidErrors.slice(0, 3).join('; ')
        : invalidBoneNodes.length > 0
          ? `Invalid node indices for bones: ${invalidBoneNodes.join(', ')}`
          : missingRequiredBones.length > 0
            ? `Missing required bones: ${missingRequiredBones.join(', ')}`
            : `All ${VRM_REQUIRED_HUMANOID_BONES.length} required bones + ${Math.max(0, mappedHumanoidBones.length - VRM_REQUIRED_HUMANOID_BONES.length)} optional/finger bones mapped`,
  });

  if (vrm0MaterialWarnings.length > 0) {
    checks.push({
      id: 'vrm0_material_properties',
      label: 'VRM 0.0 materialProperties vs glTF materials',
      status: 'warn',
      detail: vrm0MaterialWarnings.join('; '),
    });
  }

  const hierarchyWarnings = humanoidHierarchyWarnings(boneMap, nodes);
  if (hierarchyWarnings.length > 0) {
    checks.push({
      id: 'humanoid_hierarchy',
      label: 'VRM Humanoid Parent/Child Hierarchy',
      status: 'warn',
      detail: hierarchyWarnings.slice(0, 3).join('; '),
    });
  }

  // Mesh Geometry, Accessor Bounds, Skinning & 4/8-Influence Weight Normalization
  const accessors = gltf.accessors ?? [];
  const bufferViews = gltf.bufferViews ?? [];
  let primitiveCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  let skinWeightsValid = true;
  let weightCheckDetail = 'Verified normalized vertex weights across primitives';
  let geometryError: string | null = null;

  const skin0 = skins[0];
  const boneCount = skin0?.joints?.length ?? 0;

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
      if (!isAccessorInBounds(posIdx, accessors, bufferViews, binChunk.byteLength)) {
        geometryError = `POSITION accessor ${posIdx} is out of BIN bounds`;
        continue;
      }
      if (prim.indices !== undefined && !isAccessorInBounds(prim.indices, accessors, bufferViews, binChunk.byteLength)) {
        geometryError = `Indices accessor ${prim.indices} is out of BIN bounds`;
        continue;
      }

      const posAcc = accessors[posIdx];
      const wAcc = accessors[wIdx];
      const jAcc = accessors[jIdx];
      const w1Idx = prim.attributes?.WEIGHTS_1;
      const j1Idx = prim.attributes?.JOINTS_1;
      const w1Acc = w1Idx !== undefined ? accessors[w1Idx] : undefined;
      const j1Acc = j1Idx !== undefined ? accessors[j1Idx] : undefined;

      vertexCount += posAcc?.count ?? 0;

      if (prim.indices !== undefined && accessors[prim.indices]) {
        triangleCount += Math.floor(accessors[prim.indices].count / 3);
      } else if (posAcc) {
        triangleCount += Math.floor(posAcc.count / 3);
      }

      if (
        !isAccessorInBounds(wIdx, accessors, bufferViews, binChunk.byteLength) ||
        !isAccessorInBounds(jIdx, accessors, bufferViews, binChunk.byteLength)
      ) {
        skinWeightsValid = false;
        weightCheckDetail = 'JOINTS_0 or WEIGHTS_0 accessor exceeds BIN buffer length';
        continue;
      }
      if ((w1Idx !== undefined || j1Idx !== undefined) && (w1Idx === undefined || j1Idx === undefined)) {
        skinWeightsValid = false;
        weightCheckDetail = 'Primitive defines only one of JOINTS_1 / WEIGHTS_1';
        continue;
      }
      if (
        w1Idx !== undefined &&
        j1Idx !== undefined &&
        (!isAccessorInBounds(w1Idx, accessors, bufferViews, binChunk.byteLength) ||
          !isAccessorInBounds(j1Idx, accessors, bufferViews, binChunk.byteLength))
      ) {
        skinWeightsValid = false;
        weightCheckDetail = 'JOINTS_1 or WEIGHTS_1 accessor exceeds BIN buffer length';
        continue;
      }

      // Check JOINTS_0 (and JOINTS_1) indices < boneCount
      const checkJointAcc = (acc: GltfAccessor, label: string): boolean => {
        if (acc.bufferView === undefined || !bufferViews[acc.bufferView]) return false;
        const bv = bufferViews[acc.bufferView];
        const compBytes = componentByteSize(acc.componentType);
        const stride = bv.byteStride && bv.byteStride >= compBytes * 4 ? bv.byteStride : compBytes * 4;
        const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
        for (let v = 0; v < acc.count; v++) {
          const ptr = base + v * stride;
          for (let k = 0; k < 4; k++) {
            const cOff = ptr + k * compBytes;
            const jVal =
              acc.componentType === 5123
                ? binView.getUint16(cOff, true)
                : acc.componentType === 5121
                  ? binView.getUint8(cOff)
                  : -1;
            if (jVal < 0 || (boneCount > 0 && jVal >= boneCount)) {
              skinWeightsValid = false;
              weightCheckDetail = `${label} index ${jVal} out of skin joint bounds (${boneCount}) at vertex ${v}`;
              return false;
            }
          }
        }
        return true;
      };

      if (!checkJointAcc(jAcc, 'JOINTS_0')) continue;
      if (j1Acc && !checkJointAcc(j1Acc, 'JOINTS_1')) continue;

      for (let v = 0; v < wAcc.count; v++) {
        const sum0 = readNormalizedWeightComponents(wAcc, v, bufferViews, binChunk, binView);
        if (sum0 === null) {
          skinWeightsValid = false;
          weightCheckDetail = `Invalid WEIGHTS_0 data at vertex ${v}`;
          break;
        }
        let sumTotal = sum0;
        if (w1Acc) {
          const sum1 = readNormalizedWeightComponents(w1Acc, v, bufferViews, binChunk, binView);
          if (sum1 === null) {
            skinWeightsValid = false;
            weightCheckDetail = `Invalid WEIGHTS_1 data at vertex ${v}`;
            break;
          }
          sumTotal += sum1;
        }
        if (!Number.isFinite(sumTotal) || Math.abs(sumTotal - 1.0) > 0.025) {
          skinWeightsValid = false;
          weightCheckDetail = `Unnormalized skin weights detected at vertex ${v} (sum=${sumTotal.toFixed(3)})`;
          break;
        }
      }
    }
  }

  let ibmValid = false;
  let ibmFailReason = 'Missing or undersized skin inverseBindMatrices';
  if (skin0 && boneCount > 0) {
    const jointsInBounds = (skin0.joints ?? []).every(
      (jNode) => Number.isInteger(jNode) && jNode >= 0 && jNode < nodeCount
    );
    const ibmAccIdx = skin0.inverseBindMatrices;
    const ibmAcc = ibmAccIdx !== undefined ? accessors[ibmAccIdx] : undefined;
    if (!jointsInBounds) {
      ibmFailReason = 'Skin joints contain out-of-range node index';
    } else if (
      ibmAcc &&
      ibmAcc.type === 'MAT4' &&
      ibmAcc.componentType === 5126 &&
      ibmAcc.count >= boneCount &&
      isAccessorInBounds(ibmAccIdx, accessors, bufferViews, binChunk.byteLength)
    ) {
      const bv = bufferViews[ibmAcc.bufferView!];
      const base = (bv.byteOffset ?? 0) + (ibmAcc.byteOffset ?? 0);
      let allFinite = true;
      for (let f = 0; f < boneCount * 16; f++) {
        if (!Number.isFinite(binView.getFloat32(base + f * 4, true))) {
          allFinite = false;
          break;
        }
      }
      ibmValid = allFinite;
      if (!allFinite) ibmFailReason = 'Skin inverseBindMatrices contains non-finite values';
    }
  }

  checks.push({
    id: 'geometry_topology',
    label: 'Mesh & Topology Integrity',
    status: !geometryError && vertexCount > 0 && triangleCount > 0 ? 'pass' : 'fail',
    detail:
      geometryError ||
      `${vertexCount.toLocaleString()} vertices · ${triangleCount.toLocaleString()} triangles across ${primitiveCount} primitives`,
  });

  checks.push({
    id: 'skinning_weights',
    label: 'Armature Skinning & Weights',
    status: skinWeightsValid && ibmValid && boneCount > 0 ? 'pass' : 'fail',
    detail: ibmValid ? `${boneCount} skin joints · ${weightCheckDetail}` : ibmFailReason,
  });

  // Expression / BlendShape Validation (VRM 0.0 vs VRM 1.0)
  const nonEmptyExpressions: string[] = [];
  let expressionCount = 0;
  let blendShapeGroupCount = 0;
  let invalidBindCount = 0;
  let invalidPresetCount = 0;
  let emptyBoundGroupCount = 0;
  let exprDetail = '';
  let exprStatus: 'pass' | 'warn' | 'fail' = 'fail';

  if (isVrm0) {
    const groups = vrm0Ext?.blendShapeMaster?.blendShapeGroups ?? [];
    blendShapeGroupCount = groups.length;
    expressionCount = groups.length;
    const seenPresets = new Set<string>();

    for (const grp of groups) {
      if (grp.presetName !== undefined && !VRM0_PRESET_SET.has(grp.presetName)) {
        invalidPresetCount++;
      }
      const presetKey = (
        grp.presetName && grp.presetName !== 'unknown'
          ? grp.presetName
          : grp.name || 'unknown'
      ).toLowerCase();
      seenPresets.add(presetKey);
      const binds = grp.binds ?? [];
      if (binds.length === 0) continue;

      let hasDelta = false;
      for (const b of binds) {
        if (
          !b ||
          !Number.isInteger(b.mesh) ||
          b.mesh < 0 ||
          b.mesh >= meshes.length ||
          !Number.isInteger(b.index) ||
          b.index < 0 ||
          typeof b.weight !== 'number' ||
          !Number.isFinite(b.weight) ||
          b.weight < 0 ||
          b.weight > 100
        ) {
          invalidBindCount++;
          continue;
        }
        const targetMesh = meshes[b.mesh];
        let matchedTargetSlot = false;
        for (const prim of targetMesh.primitives ?? []) {
          const targetEntry = prim.targets?.[b.index];
          if (!targetEntry) continue;
          matchedTargetSlot = true;
          if (morphTargetHasDelta(targetEntry, accessors, bufferViews, binChunk, binView)) {
            hasDelta = true;
          }
        }
        if (!matchedTargetSlot) {
          invalidBindCount++;
        }
      }
      if (!hasDelta) {
        emptyBoundGroupCount++;
      } else if (!nonEmptyExpressions.includes(presetKey)) {
        nonEmptyExpressions.push(presetKey);
      }
    }

    const missingCore0 = CORE_VRM0_EXPRESSION_PRESETS.filter(
      (p) => !nonEmptyExpressions.includes(p)
    );
    const hasNeutral0 = seenPresets.has('neutral');
    const hasExprError = invalidPresetCount > 0 || invalidBindCount > 0 || emptyBoundGroupCount > 0;
    exprStatus =
      hasExprError || nonEmptyExpressions.length === 0
        ? 'fail'
        : missingCore0.length === 0 && hasNeutral0
          ? 'pass'
          : 'warn';
    exprDetail =
      invalidPresetCount > 0
        ? `${invalidPresetCount} invalid VRM 0.0 blendShapeGroup presetName values (must match official lowercase enum)`
        : invalidBindCount > 0
          ? `${invalidBindCount} invalid VRM 0.0 blendShapeMaster mesh/target binds`
          : emptyBoundGroupCount > 0
            ? `${emptyBoundGroupCount} blendShapeGroups bind to empty/zero morph targets`
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
        const targetNode = nodes[bind.node];
        if (
          !targetNode ||
          targetNode.mesh === undefined ||
          !meshes[targetNode.mesh] ||
          !Number.isInteger(bind.index) ||
          bind.index < 0
        ) {
          invalidBindCount++;
          continue;
        }
        const targetMesh = meshes[targetNode.mesh];
        let matchedTargetSlot = false;
        for (const prim of targetMesh.primitives ?? []) {
          const targetEntry = prim.targets?.[bind.index];
          if (!targetEntry) continue;
          matchedTargetSlot = true;
          if (morphTargetHasDelta(targetEntry, accessors, bufferViews, binChunk, binView)) {
            hasDelta = true;
          }
        }
        if (!matchedTargetSlot) invalidBindCount++;
      }
      if (!hasDelta) {
        emptyBoundGroupCount++;
      } else {
        nonEmptyExpressions.push(exprName);
      }
    }

    const missingCore1 = CORE_VRM1_EXPRESSION_PRESETS.filter(
      (name) => !nonEmptyExpressions.includes(name)
    );
    const hasNeutralPreset = 'neutral' in presets;
    const hasExprError = invalidBindCount > 0 || emptyBoundGroupCount > 0;
    exprStatus =
      hasExprError || nonEmptyExpressions.length === 0
        ? 'fail'
        : missingCore1.length === 0 && hasNeutralPreset
          ? 'pass'
          : 'warn';
    exprDetail =
      invalidBindCount > 0
        ? `${invalidBindCount} invalid VRM 1.0 morphTargetBinds references`
        : emptyBoundGroupCount > 0
          ? `${emptyBoundGroupCount} VRM 1.0 expressions bind to empty/zero morph targets`
          : missingCore1.length === 0
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
    if (tex.source !== undefined && (!Number.isInteger(tex.source) || tex.source < 0 || tex.source >= imageCount)) {
      brokenRefs++;
    }
  }
  for (const img of images) {
    if (img.bufferView !== undefined) {
      if (!Number.isInteger(img.bufferView) || img.bufferView < 0 || img.bufferView >= bufferViews.length) {
        brokenRefs++;
      } else {
        const bv = bufferViews[img.bufferView];
        const start = bv.byteOffset ?? 0;
        if (start < 0 || start + bv.byteLength > binChunk.byteLength) {
          brokenRefs++;
        }
      }
    }
  }

  checks.push({
    id: 'materials_textures',
    label: 'PBR Materials & Embedded Textures',
    status: brokenRefs > 0 || materialCount === 0 ? 'fail' : 'pass',
    detail:
      brokenRefs > 0
        ? `${brokenRefs} invalid texture/image buffer references`
        : materialCount === 0
          ? 'glTF contains zero PBR materials'
          : textureCount > 0
            ? `${materialCount} PBR materials · ${textureCount} textures · ${imageCount} embedded images`
            : `${materialCount} PBR materials (factor-based, 0 embedded textures)`,
  });

  // Secondary Animation / Spring Bone Physics & Colliders
  const humanoidNodeSet = new Set<number>(boneMap.values());
  let springBoneJointCount = 0;
  let secondaryBoneGroupCount = 0;
  let colliderGroupCount = 0;
  let springStatus: 'pass' | 'warn' | 'fail' = 'warn';
  let springDetail = '';
  const springErrors: string[] = [];
  const springWarnings: string[] = [];

  if (isVrm0) {
    const boneGroups = vrm0Ext?.secondaryAnimation?.boneGroups ?? [];
    const colliderGroups = vrm0Ext?.secondaryAnimation?.colliderGroups ?? [];
    secondaryBoneGroupCount = boneGroups.length;
    colliderGroupCount = colliderGroups.length;

    for (let gIdx = 0; gIdx < colliderGroups.length; gIdx++) {
      const cg = colliderGroups[gIdx];
      if (!Number.isInteger(cg.node) || cg.node < 0 || cg.node >= nodeCount) {
        springErrors.push(`colliderGroups[${gIdx}] references invalid node ${cg.node}`);
      }
      for (let cIdx = 0; cIdx < (cg.colliders ?? []).length; cIdx++) {
        const col = cg.colliders![cIdx];
        const off = col?.offset;
        if (
          !off ||
          typeof off.x !== 'number' ||
          typeof off.y !== 'number' ||
          typeof off.z !== 'number' ||
          !Number.isFinite(off.x) ||
          !Number.isFinite(off.y) ||
          !Number.isFinite(off.z)
        ) {
          springErrors.push(`colliderGroups[${gIdx}].colliders[${cIdx}] has invalid offset`);
        }
        if (typeof col?.radius !== 'number' || !Number.isFinite(col.radius) || col.radius < 0) {
          springErrors.push(`colliderGroups[${gIdx}].colliders[${cIdx}] has negative or invalid radius`);
        }
      }
    }

    for (let bIdx = 0; bIdx < boneGroups.length; bIdx++) {
      const bg = boneGroups[bIdx];
      for (const key of ['stiffiness', 'gravityPower', 'dragForce', 'hitRadius'] as const) {
        const val: unknown = bg[key];
        if (val !== undefined && (!isFiniteNumber(val) || val < 0)) {
          springErrors.push(`boneGroups[${bIdx}].${key} must be a finite non-negative number`);
        }
      }
      if (isFiniteNumber(bg.dragForce) && bg.dragForce > 1) {
        springErrors.push(`boneGroups[${bIdx}].dragForce must be within 0..1`);
      }
      const gd: unknown = bg.gravityDir;
      if (gd !== undefined) {
        const g = gd as { x?: unknown; y?: unknown; z?: unknown };
        if (!isPlainObject(gd) || !isFiniteNumber(g.x) || !isFiniteNumber(g.y) || !isFiniteNumber(g.z)) {
          springErrors.push(`boneGroups[${bIdx}].gravityDir must be an object {x,y,z} of finite numbers`);
        } else if (
          Math.hypot(g.x, g.y, g.z) === 0 &&
          isFiniteNumber(bg.gravityPower) &&
          bg.gravityPower !== 0
        ) {
          springWarnings.push(`boneGroups[${bIdx}].gravityDir has zero length but gravityPower is ${bg.gravityPower}`);
        }
      }
      if (bg.center !== undefined && (!Number.isInteger(bg.center) || bg.center < -1 || bg.center >= nodeCount)) {
        springErrors.push(`boneGroups[${bIdx}] has out-of-range center node ${bg.center}`);
      }
      for (const bNode of bg.bones ?? []) {
        if (!Number.isInteger(bNode) || bNode < 0 || bNode >= nodeCount) {
          springErrors.push(`boneGroups[${bIdx}] references out-of-range node ${bNode}`);
        } else if (humanoidNodeSet.has(bNode)) {
          springErrors.push(`boneGroups[${bIdx}] illegally binds mapped humanoid bone node ${bNode}`);
        } else {
          springBoneJointCount++;
        }
      }
      for (const cgIdx of bg.colliderGroups ?? []) {
        if (!Number.isInteger(cgIdx) || cgIdx < 0 || cgIdx >= colliderGroups.length) {
          springErrors.push(`boneGroups[${bIdx}] references out-of-range colliderGroup ${cgIdx}`);
        }
      }
    }

    springStatus =
      springErrors.length > 0
        ? 'fail'
        : springWarnings.length > 0
          ? 'warn'
          : springBoneJointCount > 0 || secondaryBoneGroupCount === 0
            ? 'pass'
            : 'warn';
    springDetail =
      springErrors.length > 0
        ? springErrors.slice(0, 3).join('; ')
        : springWarnings.length > 0
          ? springWarnings.slice(0, 3).join('; ')
          : `${secondaryBoneGroupCount} boneGroups (${springBoneJointCount} physics roots) · ${colliderGroupCount} colliderGroups`;
  } else {
    const sb = gltf.extensions?.VRMC_springBone;
    const springs = sb?.springs ?? [];
    const colliders1 = sb?.colliders ?? [];
    const colliderGroups1 = sb?.colliderGroups ?? [];
    secondaryBoneGroupCount = springs.length;
    colliderGroupCount = colliderGroups1.length;

    for (let cIdx = 0; cIdx < colliders1.length; cIdx++) {
      const col = colliders1[cIdx];
      if (col.node === undefined || !Number.isInteger(col.node) || col.node < 0 || col.node >= nodeCount) {
        springErrors.push(`VRMC_springBone.colliders[${cIdx}] invalid node`);
      }
      const sp = col.shape?.sphere;
      if (sp) {
        if (typeof sp.radius !== 'number' || !Number.isFinite(sp.radius) || sp.radius < 0) {
          springErrors.push(`VRMC_springBone.colliders[${cIdx}] negative/invalid radius`);
        }
        if (!Array.isArray(sp.offset) || sp.offset.length < 3 || !sp.offset.every(Number.isFinite)) {
          springErrors.push(`VRMC_springBone.colliders[${cIdx}] invalid offset`);
        }
      }
    }
    for (let sIdx = 0; sIdx < springs.length; sIdx++) {
      const sp = springs[sIdx];
      for (const cgIdx of sp.colliderGroups ?? []) {
        if (!Number.isInteger(cgIdx) || cgIdx < 0 || cgIdx >= colliderGroups1.length) {
          springErrors.push(`VRMC_springBone.springs[${sIdx}] out-of-range colliderGroup ${cgIdx}`);
        }
      }
      for (const j of sp.joints ?? []) {
        if (!Number.isInteger(j.node) || j.node < 0 || j.node >= nodeCount) {
          springErrors.push(`VRMC_springBone.springs[${sIdx}] out-of-range node ${j.node}`);
        } else if (humanoidNodeSet.has(j.node)) {
          springErrors.push(`VRMC_springBone.springs[${sIdx}] binds humanoid node ${j.node}`);
        } else {
          springBoneJointCount++;
        }
      }
    }
    springStatus =
      springErrors.length > 0
        ? 'fail'
        : springBoneJointCount > 0 || springs.length === 0
          ? 'pass'
          : 'warn';
    springDetail =
      springErrors.length > 0
        ? springErrors.slice(0, 3).join('; ')
        : `${springs.length} spring chains · ${springBoneJointCount} physics joints · ${colliderGroups1.length} colliderGroups`;
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
