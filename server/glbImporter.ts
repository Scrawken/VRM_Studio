import {
  ImportedColliderDef,
  ImportedColliderGroup,
  ImportedImageData,
  ImportedMaterialData,
  ImportedMeshGroup,
  ImportedMorphTargetData,
  ImportedPrimitiveData,
  ImportedSamplerData,
  ImportedSkinData,
  ImportedSkinJointData,
  ImportedSpringGroup,
  ImportedTextureData,
  ImportedTextureInfo,
  ParsedGlbAsset,
  VrmAllowance,
  VrmAllowedUser,
  VrmExportVersion,
  VrmMetadataConfig,
  VrmSourceLicenseRestrictions,
} from '../src/shared/types';

export type {
  ImportedColliderDef,
  ImportedColliderGroup,
  ImportedImageData,
  ImportedMaterialData,
  ImportedMeshGroup,
  ImportedMorphTargetData,
  ImportedPrimitiveData,
  ImportedSamplerData,
  ImportedSkinData,
  ImportedSkinJointData,
  ImportedSpringGroup,
  ImportedTextureData,
  ImportedTextureInfo,
  ParsedGlbAsset,
};

interface GltfAccessorSparse {
  count: number;
  indices: {
    bufferView: number;
    byteOffset?: number;
    componentType: number;
  };
  values: {
    bufferView: number;
    byteOffset?: number;
  };
}

interface GltfAccessorMeta {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';
  sparse?: GltfAccessorSparse;
}

interface GltfBufferViewMeta {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfNodeMeta {
  name?: string;
  children?: number[];
  mesh?: number;
  skin?: number;
  matrix?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

function componentSize(componentType: number): number {
  switch (componentType) {
    case 5120: // BYTE
    case 5121: // UNSIGNED_BYTE
      return 1;
    case 5122: // SHORT
    case 5123: // UNSIGNED_SHORT
      return 2;
    case 5125: // UNSIGNED_INT
    case 5126: // FLOAT
      return 4;
    default:
      return 0;
  }
}

function typeElementCount(type: string): number {
  switch (type) {
    case 'SCALAR':
      return 1;
    case 'VEC2':
      return 2;
    case 'VEC3':
      return 3;
    case 'VEC4':
      return 4;
    case 'MAT4':
      return 16;
    default:
      return 1;
  }
}

function readScalar(
  view: DataView,
  byteOffset: number,
  componentType: number,
  normalized = false
): number {
  let raw = 0;
  switch (componentType) {
    case 5120:
      raw = view.getInt8(byteOffset);
      return normalized ? Math.max(-1, raw / 127) : raw;
    case 5121:
      raw = view.getUint8(byteOffset);
      return normalized ? raw / 255 : raw;
    case 5122:
      raw = view.getInt16(byteOffset, true);
      return normalized ? Math.max(-1, raw / 32767) : raw;
    case 5123:
      raw = view.getUint16(byteOffset, true);
      return normalized ? raw / 65535 : raw;
    case 5125:
      return view.getUint32(byteOffset, true);
    case 5126:
      return view.getFloat32(byteOffset, true);
    default:
      return 0;
  }
}

function readAccessorArray(
  binBytes: Uint8Array,
  accessors: GltfAccessorMeta[],
  bufferViews: GltfBufferViewMeta[],
  accessorIdx: number
): Float32Array {
  const acc = accessors[accessorIdx];
  if (!acc) return new Float32Array(0);

  const elems = typeElementCount(acc.type);
  const compBytes = componentSize(acc.componentType);
  if (!compBytes) return new Float32Array(0);

  const out = new Float32Array(acc.count * elems);
  const view = new DataView(binBytes.buffer, binBytes.byteOffset, binBytes.byteLength);

  if (acc.bufferView !== undefined) {
    const bv = bufferViews[acc.bufferView];
    if (!bv) return new Float32Array(0);
    const stride = bv.byteStride && bv.byteStride > 0 ? bv.byteStride : elems * compBytes;
    const baseOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);

    for (let i = 0; i < acc.count; i++) {
      const elemStart = baseOffset + i * stride;
      if (elemStart + elems * compBytes > binBytes.byteLength) break;
      for (let k = 0; k < elems; k++) {
        out[i * elems + k] = readScalar(
          view,
          elemStart + k * compBytes,
          acc.componentType,
          Boolean(acc.normalized)
        );
      }
    }
  } else if (!acc.sparse) {
    // Per glTF 2.0 spec, bufferView omitted without sparse means zero-initialized
    return out;
  }

  // Apply glTF 2.0 sparse accessor overrides when present
  if (acc.sparse && acc.sparse.count > 0) {
    const idxMeta = acc.sparse.indices;
    const valMeta = acc.sparse.values;
    const idxBv = bufferViews[idxMeta.bufferView];
    const valBv = bufferViews[valMeta.bufferView];
    const idxCompBytes = componentSize(idxMeta.componentType);
    if (idxBv && valBv && idxCompBytes > 0) {
      const idxBase = (idxBv.byteOffset ?? 0) + (idxMeta.byteOffset ?? 0);
      const valBase = (valBv.byteOffset ?? 0) + (valMeta.byteOffset ?? 0);
      const idxStride = idxBv.byteStride && idxBv.byteStride >= idxCompBytes ? idxBv.byteStride : idxCompBytes;
      const valStride =
        valBv.byteStride && valBv.byteStride >= elems * compBytes
          ? valBv.byteStride
          : elems * compBytes;

      for (let s = 0; s < acc.sparse.count; s++) {
        const iOff = idxBase + s * idxStride;
        const vOff = valBase + s * valStride;
        if (iOff + idxCompBytes > binBytes.byteLength || vOff + elems * compBytes > binBytes.byteLength) {
          break;
        }
        const targetVertexIdx = Math.floor(readScalar(view, iOff, idxMeta.componentType, false));
        if (targetVertexIdx >= 0 && targetVertexIdx < acc.count) {
          for (let k = 0; k < elems; k++) {
            out[targetVertexIdx * elems + k] = readScalar(
              view,
              vOff + k * compBytes,
              acc.componentType,
              Boolean(acc.normalized)
            );
          }
        }
      }
    }
  }

  return out;
}

function readAccessorUint16Array(
  binBytes: Uint8Array,
  accessors: GltfAccessorMeta[],
  bufferViews: GltfBufferViewMeta[],
  accessorIdx: number
): Uint16Array {
  const acc = accessors[accessorIdx];
  if (!acc || acc.bufferView === undefined) return new Uint16Array(0);
  const bv = bufferViews[acc.bufferView];
  if (!bv) return new Uint16Array(0);

  const elems = typeElementCount(acc.type);
  const compBytes = componentSize(acc.componentType);
  if (!compBytes) return new Uint16Array(0);

  const stride = bv.byteStride && bv.byteStride > 0 ? bv.byteStride : elems * compBytes;
  const baseOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Uint16Array(acc.count * elems);
  const view = new DataView(binBytes.buffer, binBytes.byteOffset, binBytes.byteLength);

  for (let i = 0; i < acc.count; i++) {
    const elemStart = baseOffset + i * stride;
    if (elemStart + elems * compBytes > binBytes.byteLength) break;
    for (let k = 0; k < elems; k++) {
      const v = Math.round(readScalar(view, elemStart + k * compBytes, acc.componentType, false));
      out[i * elems + k] = Math.max(0, Math.min(65535, v));
    }
  }
  return out;
}

function identityMat4(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function mulMat4(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function composeTrsMat4(
  t: [number, number, number] = [0, 0, 0],
  q: [number, number, number, number] = [0, 0, 0, 1],
  s: [number, number, number] = [1, 1, 1]
): number[] {
  const [x, y, z, w] = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  return [
    (1 - (yy + zz)) * s[0],
    (xy + wz) * s[0],
    (xz - wy) * s[0],
    0,
    (xy - wz) * s[1],
    (1 - (xx + zz)) * s[1],
    (yz + wx) * s[1],
    0,
    (xz + wy) * s[2],
    (yz - wx) * s[2],
    (1 - (xx + yy)) * s[2],
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
}

function getNodeLocalMatrix(node: GltfNodeMeta): number[] {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return node.matrix.slice();
  }
  return composeTrsMat4(node.translation, node.rotation, node.scale);
}

function isIdentityMatrix(m: number[]): boolean {
  const id = identityMat4();
  for (let i = 0; i < 16; i++) {
    if (Math.abs(m[i] - id[i]) > 1e-5) return false;
  }
  return true;
}

function transformPointMat4(m: number[], x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function transformVectorMat4(m: number[], x: number, y: number, z: number): [number, number, number] {
  const [nx, ny, nz] = transformNormalUnnormalizedMat4(m, x, y, z);
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function transformNormalUnnormalizedMat4(m: number[], x: number, y: number, z: number): [number, number, number] {
  // Exact inverse-transpose 3x3 cofactor transformation: (M^-1)^T * v = cofactor(M) * v / det(M)
  const a00 = m[0], a01 = m[4], a02 = m[8];
  const a10 = m[1], a11 = m[5], a12 = m[9];
  const a20 = m[2], a21 = m[6], a22 = m[10];
  const det =
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20);
  if (Math.abs(det) > 1e-12) {
    const c00 = a11 * a22 - a12 * a21;
    const c01 = -(a10 * a22 - a12 * a20);
    const c02 = a10 * a21 - a11 * a20;
    const c10 = -(a01 * a22 - a02 * a21);
    const c11 = a00 * a22 - a02 * a20;
    const c12 = -(a00 * a21 - a01 * a20);
    const c20 = a01 * a12 - a02 * a11;
    const c21 = -(a00 * a12 - a02 * a10);
    const c22 = a00 * a11 - a01 * a10;
    const invDet = 1 / det;
    return [
      (c00 * x + c01 * y + c02 * z) * invDet,
      (c10 * x + c11 * y + c12 * z) * invDet,
      (c20 * x + c21 * y + c22 * z) * invDet,
    ];
  }
  return [
    a00 * x + a01 * y + a02 * z,
    a10 * x + a11 * y + a12 * z,
    a20 * x + a21 * y + a22 * z,
  ];
}

function transformMorphNormalDelta(
  m: number[],
  baseNormal: [number, number, number],
  dx: number,
  dy: number,
  dz: number
): [number, number, number] {
  const deltaLen = Math.hypot(dx, dy, dz);
  if (deltaLen < 1e-7) return [0, 0, 0];
  const [n0x, n0y, n0z] = transformVectorMat4(m, baseNormal[0], baseNormal[1], baseNormal[2]);
  const [m1x, m1y, m1z] = transformNormalUnnormalizedMat4(
    m,
    baseNormal[0] + dx,
    baseNormal[1] + dy,
    baseNormal[2] + dz
  );
  const m1Len = Math.hypot(m1x, m1y, m1z);
  if (m1Len < 1e-9) return [0, 0, 0];
  return [m1x / m1Len - n0x, m1y / m1Len - n0y, m1z / m1Len - n0z];
}

function computeSmoothNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const vertCount = Math.floor(positions.length / 3);
  const normals = new Float32Array(vertCount * 3);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    if (a >= vertCount || b >= vertCount || c >= vertCount) continue;
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    normals[a * 3] += nx; normals[a * 3 + 1] += ny; normals[a * 3 + 2] += nz;
    normals[b * 3] += nx; normals[b * 3 + 1] += ny; normals[b * 3 + 2] += nz;
    normals[c * 3] += nx; normals[c * 3 + 1] += ny; normals[c * 3 + 2] += nz;
  }
  for (let v = 0; v < vertCount; v++) {
    const x = normals[v * 3];
    const y = normals[v * 3 + 1];
    const z = normals[v * 3 + 2];
    const len = Math.hypot(x, y, z);
    if (len > 1e-8) {
      normals[v * 3] = x / len;
      normals[v * 3 + 1] = y / len;
      normals[v * 3 + 2] = z / len;
    } else {
      normals[v * 3] = 0;
      normals[v * 3 + 1] = 1;
      normals[v * 3 + 2] = 0;
    }
  }
  return normals;
}

function decodeImageDataUri(uri: string): { mimeType: string; bytes: Uint8Array } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(uri);
  if (!match) return null;
  try {
    const raw = Buffer.from(match[2], 'base64');
    return { mimeType: match[1] || 'image/png', bytes: new Uint8Array(raw) };
  } catch {
    return null;
  }
}

export function parseAndValidateGlbAsset(payload: Uint8Array): ParsedGlbAsset {
  const emptyResult = (error: string): ParsedGlbAsset => ({
    valid: false,
    error,
    meshCount: 0,
    primitiveCount: 0,
    materialCount: 0,
    textureCount: 0,
    imageCount: 0,
    vertexCount: 0,
    triangleCount: 0,
    hasExistingSkin: false,
    hasMorphTargets: false,
    hasVertexColors: false,
    hasNodeTransforms: false,
    boundsMin: [0, 0, 0],
    boundsMax: [0, 0, 0],
    meshes: [],
    materials: [],
    textures: [],
    samplers: [],
    images: [],
    skins: [],
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    indices: new Uint32Array(0),
  });

  if (payload.byteLength < 20) {
    return emptyResult('GLB payload is smaller than the 20-byte header.');
  }

  const headerView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const magic = headerView.getUint32(0, true);
  const version = headerView.getUint32(4, true);
  const totalLen = headerView.getUint32(8, true);

  if (magic !== 0x46546c67 || version !== 2) {
    return emptyResult(`Invalid GLB header (magic=0x${magic.toString(16)}, version=${version}).`);
  }
  if (totalLen !== payload.byteLength) {
    return emptyResult(`GLB length mismatch (declared=${totalLen}, actual=${payload.byteLength}).`);
  }

  let offset = 12;
  let gltfJson: {
    scene?: number;
    scenes?: Array<{ nodes?: number[] }>;
    nodes?: GltfNodeMeta[];
    meshes?: Array<{
      name?: string;
      extras?: { targetNames?: string[] };
      primitives?: Array<{
        attributes?: Record<string, number>;
        indices?: number;
        material?: number;
        mode?: number;
        targets?: Array<Record<string, number>>;
      }>;
    }>;
    skins?: Array<{
      name?: string;
      skeleton?: number;
      joints?: number[];
      inverseBindMatrices?: number;
    }>;
    materials?: Array<Record<string, unknown>>;
    textures?: Array<{ name?: string; source?: number; sampler?: number }>;
    samplers?: ImportedSamplerData[];
    images?: Array<{ name?: string; mimeType?: string; bufferView?: number; uri?: string }>;
    accessors?: GltfAccessorMeta[];
    bufferViews?: GltfBufferViewMeta[];
    extensions?: {
      VRMC_vrm?: {
        specVersion?: string;
        meta?: {
          name?: string;
          version?: string;
          authors?: string[];
          copyrightInformation?: string;
          contactInformation?: string;
          references?: string[];
          licenseUrl?: string;
          avatarPermission?: string;
          allowExcessivelyViolentUsage?: boolean;
          allowExcessivelySexualUsage?: boolean;
          commercialUsage?: string;
          allowRedistribution?: boolean;
          modification?: string;
        };
        humanoid?: { humanBones?: Record<string, { node?: number }> };
      };
      VRMC_springBone?: {
        specVersion?: string;
        colliders?: Array<{
          node?: number;
          shape?: {
            sphere?: { offset?: [number, number, number]; radius?: number };
            capsule?: {
              offset?: [number, number, number];
              radius?: number;
              tail?: [number, number, number];
            };
          };
        }>;
        colliderGroups?: Array<{
          name?: string;
          colliders?: number[];
        }>;
        springs?: Array<{
          name?: string;
          center?: number;
          colliderGroups?: number[];
          joints?: Array<{
            node?: number;
            hitRadius?: number;
            stiffness?: number;
            gravityPower?: number;
            gravityDir?: [number, number, number];
            dragForce?: number;
          }>;
        }>;
      };
      VRM?: {
        specVersion?: string;
        meta?: {
          title?: string;
          author?: string;
          version?: string;
          contactInformation?: string;
          reference?: string;
          licenseName?: string;
          otherLicenseUrl?: string;
          otherPermissionUrl?: string;
          allowedUserName?: string;
          violentUssageName?: string;
          sexualUssageName?: string;
          commercialUssageName?: string;
        };
        humanoid?: {
          humanBones?: Array<{ bone?: string; node?: number }>;
        };
        secondaryAnimation?: {
          boneGroups?: Array<{
            comment?: string;
            stiffiness?: number;
            gravityPower?: number;
            gravityDir?: { x?: number; y?: number; z?: number };
            dragForce?: number;
            hitRadius?: number;
            center?: number;
            bones?: number[];
            colliderGroups?: number[];
          }>;
          colliderGroups?: Array<{
            node?: number;
            colliders?: Array<{
              offset?: { x?: number; y?: number; z?: number };
              radius?: number;
            }>;
          }>;
        };
      };
    };
  } | null = null;
  let binChunk: Uint8Array | null = null;

  while (offset + 8 <= payload.byteLength) {
    const chunkLen = headerView.getUint32(offset, true);
    const chunkType = headerView.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + chunkLen;
    if (end > payload.byteLength) {
      return emptyResult('Truncated GLB chunk.');
    }
    if (chunkType === 0x4e4f534a) {
      try {
        gltfJson = JSON.parse(new TextDecoder().decode(payload.subarray(start, end)));
      } catch {
        return emptyResult('Corrupt JSON chunk inside GLB.');
      }
    } else if (chunkType === 0x004e4942) {
      binChunk = payload.subarray(start, end);
    }
    offset = end;
  }

  if (!gltfJson || !binChunk) {
    return emptyResult('GLB is missing required JSON or BIN chunk.');
  }

  const meshes = gltfJson.meshes || [];
  const accessors = gltfJson.accessors || [];
  const bufferViews = gltfJson.bufferViews || [];
  const gltfNodes = gltfJson.nodes || [];
  if (meshes.length === 0) {
    return emptyResult('GLB contains zero meshes.');
  }

  // 1. Compute full scene-graph world matrices and parent indices for every node
  const nodeParent = new Array<number>(gltfNodes.length).fill(-1);
  const nodeWorldMatrices = new Array<number[]>(gltfNodes.length);
  for (let i = 0; i < gltfNodes.length; i++) {
    nodeWorldMatrices[i] = identityMat4();
    for (const ch of gltfNodes[i].children || []) {
      if (ch >= 0 && ch < gltfNodes.length) {
        nodeParent[ch] = i;
      }
    }
  }

  const visitNode = (nodeIdx: number, parentWorld: number[], visited = new Set<number>()) => {
    if (nodeIdx < 0 || nodeIdx >= gltfNodes.length || visited.has(nodeIdx)) return;
    visited.add(nodeIdx);
    const world = mulMat4(parentWorld, getNodeLocalMatrix(gltfNodes[nodeIdx]));
    nodeWorldMatrices[nodeIdx] = world;
    for (const ch of gltfNodes[nodeIdx].children || []) {
      visitNode(ch, world, visited);
    }
  };

  const defaultSceneIdx = gltfJson.scene ?? 0;
  const sceneRoots = gltfJson.scenes?.[defaultSceneIdx]?.nodes;
  if (sceneRoots && sceneRoots.length > 0) {
    for (const rootIdx of sceneRoots) {
      visitNode(rootIdx, identityMat4());
    }
  } else {
    for (let i = 0; i < gltfNodes.length; i++) {
      if (nodeParent[i] === -1) {
        visitNode(i, identityMat4());
      }
    }
  }

  let hasNodeTransforms = false;
  for (let i = 0; i < gltfNodes.length; i++) {
    if (!isIdentityMatrix(nodeWorldMatrices[i])) {
      hasNodeTransforms = true;
      break;
    }
  }

  // 2. Preserve embedded images, textures, samplers, and PBR materials
  const images: ImportedImageData[] = [];
  for (let i = 0; i < (gltfJson.images || []).length; i++) {
    const img = gltfJson.images![i];
    let bytes = new Uint8Array(0);
    let mimeType = img.mimeType || 'image/png';
    if (img.bufferView !== undefined && bufferViews[img.bufferView]) {
      const bv = bufferViews[img.bufferView];
      const bvStart = bv.byteOffset ?? 0;
      const bvEnd = Math.min(binChunk.byteLength, bvStart + bv.byteLength);
      if (bvEnd > bvStart) {
        bytes = new Uint8Array(binChunk.slice(bvStart, bvEnd));
      }
    } else if (img.uri) {
      const decoded = decodeImageDataUri(img.uri);
      if (decoded) {
        bytes = new Uint8Array(decoded.bytes);
        mimeType = decoded.mimeType;
      }
    }
    images.push({
      index: i,
      name: img.name || `image_${i}`,
      mimeType,
      bytes,
    });
  }

  const textures: ImportedTextureData[] = (gltfJson.textures || []).map((t, idx) => ({
    index: idx,
    name: t.name,
    source: t.source,
    sampler: t.sampler,
  }));

  const samplers: ImportedSamplerData[] = (gltfJson.samplers || []).map((s) => ({
    magFilter: s.magFilter,
    minFilter: s.minFilter,
    wrapS: s.wrapS,
    wrapT: s.wrapT,
  }));

  const materials: ImportedMaterialData[] = (gltfJson.materials || []).map((raw, idx) => {
    const pbrRaw = raw.pbrMetallicRoughness as Record<string, unknown> | undefined;
    return {
      index: idx,
      name: typeof raw.name === 'string' && raw.name ? raw.name : `Material_${idx}`,
      pbrMetallicRoughness: pbrRaw
        ? {
            baseColorFactor: Array.isArray(pbrRaw.baseColorFactor)
              ? (pbrRaw.baseColorFactor as [number, number, number, number])
              : undefined,
            baseColorTexture: pbrRaw.baseColorTexture as ImportedTextureInfo | undefined,
            metallicFactor:
              typeof pbrRaw.metallicFactor === 'number' ? pbrRaw.metallicFactor : undefined,
            roughnessFactor:
              typeof pbrRaw.roughnessFactor === 'number' ? pbrRaw.roughnessFactor : undefined,
            metallicRoughnessTexture: pbrRaw.metallicRoughnessTexture as
              | ImportedTextureInfo
              | undefined,
          }
        : undefined,
      normalTexture: raw.normalTexture as ImportedTextureInfo | undefined,
      occlusionTexture: raw.occlusionTexture as ImportedTextureInfo | undefined,
      emissiveTexture: raw.emissiveTexture as ImportedTextureInfo | undefined,
      emissiveFactor: Array.isArray(raw.emissiveFactor)
        ? (raw.emissiveFactor as [number, number, number])
        : undefined,
      alphaMode:
        raw.alphaMode === 'MASK' || raw.alphaMode === 'BLEND' ? raw.alphaMode : 'OPAQUE',
      alphaCutoff: typeof raw.alphaCutoff === 'number' ? raw.alphaCutoff : undefined,
      doubleSided: typeof raw.doubleSided === 'boolean' ? raw.doubleSided : undefined,
      extensions:
        raw.extensions && typeof raw.extensions === 'object'
          ? (raw.extensions as Record<string, unknown>)
          : undefined,
    };
  });

  // 3. Preserve existing skins & hierarchy
  const skins: ImportedSkinData[] = (gltfJson.skins || []).map((rawSkin, sIdx) => {
    const jointNodes = rawSkin.joints || [];
    const jointIndexByNode = new Map<number, number>();
    jointNodes.forEach((nodeIdx, jIdx) => jointIndexByNode.set(nodeIdx, jIdx));

    const joints: ImportedSkinJointData[] = jointNodes.map((nodeIdx) => {
      const node = gltfNodes[nodeIdx] || {};
      const parentNode = nodeIdx >= 0 && nodeIdx < nodeParent.length ? nodeParent[nodeIdx] : -1;
      const parentJointIndex = parentNode >= 0 ? (jointIndexByNode.get(parentNode) ?? -1) : -1;
      const worldMat = nodeWorldMatrices[nodeIdx] || identityMat4();
      return {
        jointNodeIndex: nodeIdx,
        name: node.name || `joint_${nodeIdx}`,
        parentJointIndex,
        localTranslation: node.translation
          ? [node.translation[0], node.translation[1], node.translation[2]]
          : [worldMat[12], worldMat[13], worldMat[14]],
        localRotation: node.rotation ? [...node.rotation] : [0, 0, 0, 1],
        localScale: node.scale ? [...node.scale] : [1, 1, 1],
        worldPos: [worldMat[12], worldMat[13], worldMat[14]],
        worldMatrix: worldMat,
      };
    });

    const ibm =
      rawSkin.inverseBindMatrices !== undefined
        ? readAccessorArray(binChunk!, accessors, bufferViews, rawSkin.inverseBindMatrices)
        : undefined;

    return {
      index: sIdx,
      name: rawSkin.name || `Skin_${sIdx}`,
      skeletonRootNodeIndex: rawSkin.skeleton,
      joints,
      inverseBindMatrices: ibm && ibm.length >= joints.length * 16 ? ibm : undefined,
    };
  });

  // Extract VRM 0.0 (`extensions.VRM`) or VRM 1.0 (`extensions.VRMC_vrm`) humanoid mapping, metadata, license restrictions & spring chains
  let existingVrmHumanoid: Record<string, string> | undefined;
  let sourceVrmVersion: VrmExportVersion | undefined;
  let sourceVrmMeta: Partial<VrmMetadataConfig> | undefined;
  let existingVrmSprings: ImportedSpringGroup[] | undefined;
  let existingVrmColliderGroups: ImportedColliderGroup[] | undefined;

  const vrm0Ext = gltfJson.extensions?.VRM;
  const vrm1Ext = gltfJson.extensions?.VRMC_vrm;
  const vrm1SpringExt = gltfJson.extensions?.VRMC_springBone;

  const toVrmAllowedUser = (raw?: string): VrmAllowedUser | undefined => {
    if (raw === 'OnlyAuthor' || raw === 'ExplicitlyLicensedPerson' || raw === 'Everyone') return raw;
    if (raw === 'onlyAuthor') return 'OnlyAuthor';
    if (raw === 'onlySeparatelyLicensedPerson') return 'ExplicitlyLicensedPerson';
    if (raw === 'everyone') return 'Everyone';
    return undefined;
  };
  const toAllowance = (raw?: string | boolean): VrmAllowance | undefined => {
    if (raw === 'Allow' || raw === true) return 'Allow';
    if (raw === 'Disallow' || raw === false) return 'Disallow';
    return undefined;
  };

  if (vrm0Ext && typeof vrm0Ext === 'object') {
    sourceVrmVersion = '0.0';
    if (Array.isArray(vrm0Ext.humanoid?.humanBones)) {
      existingVrmHumanoid = {};
      for (const hb of vrm0Ext.humanoid!.humanBones) {
        if (hb && typeof hb.bone === 'string' && typeof hb.node === 'number' && gltfNodes[hb.node]) {
          existingVrmHumanoid[hb.bone] = gltfNodes[hb.node].name || `node_${hb.node}`;
        }
      }
    }
    if (vrm0Ext.meta) {
      const m0 = vrm0Ext.meta;
      const allowedUserName = toVrmAllowedUser(m0.allowedUserName) ?? 'OnlyAuthor';
      const violentUsage = toAllowance(m0.violentUssageName) ?? 'Disallow';
      const sexualUsage = toAllowance(m0.sexualUssageName) ?? 'Disallow';
      const commercialUsage = toAllowance(m0.commercialUssageName) ?? 'Disallow';
      const licenseName = typeof m0.licenseName === 'string' && m0.licenseName.trim() ? m0.licenseName.trim() : 'Other';
      const allowRedistribution =
        licenseName === 'Redistribution_Prohibited' || licenseName === 'Other' ? false : true;
      const modification: VrmMetadataConfig['modification'] =
        licenseName === 'Redistribution_Prohibited' || licenseName.endsWith('_ND')
          ? 'prohibited'
          : licenseName === 'Other'
            ? 'allowModification'
            : 'allowModificationRedistribution';
      const sourceRestrictions: VrmSourceLicenseRestrictions = {
        ...(m0.allowedUserName ? { allowedUserName } : {}),
        ...(m0.violentUssageName ? { violentUsage } : {}),
        ...(m0.sexualUssageName ? { sexualUsage } : {}),
        ...(m0.commercialUssageName ? { commercialUsage } : {}),
        ...(licenseName === 'Redistribution_Prohibited' ? { allowRedistribution: false } : {}),
        ...(m0.licenseName ? { licenseName } : {}),
      };
      sourceVrmMeta = {
        title: m0.title,
        author: m0.author,
        version: m0.version,
        contactInformation: m0.contactInformation,
        reference: m0.reference,
        licenseName,
        otherLicenseUrl: m0.otherLicenseUrl,
        otherPermissionUrl: m0.otherPermissionUrl,
        allowedUserName,
        violentUsage,
        sexualUsage,
        commercialUsage,
        allowRedistribution,
        modification,
        sourceAttribution: [m0.author, m0.reference].filter(Boolean).join(' · ') || undefined,
        sourceRestrictions,
      };
    }
    const cgGroups = vrm0Ext.secondaryAnimation?.colliderGroups || [];
    if (cgGroups.length > 0) {
      existingVrmColliderGroups = cgGroups
        .map((cg) => {
          const cgNode = typeof cg.node === 'number' ? gltfNodes[cg.node] : undefined;
          if (!cgNode || typeof cg.node !== 'number') return null;
          const colliders: ImportedColliderDef[] = (cg.colliders || []).map((col) => ({
            offset: [
              Number.isFinite(col?.offset?.x) ? Number(col!.offset!.x) : 0,
              Number.isFinite(col?.offset?.y) ? Number(col!.offset!.y) : 0,
              Number.isFinite(col?.offset?.z) ? Number(col!.offset!.z) : 0,
            ],
            radius: Number.isFinite(col?.radius) ? Math.max(0, Number(col!.radius)) : 0.05,
          }));
          return {
            nodeName: cgNode.name || `node_${cg.node}`,
            colliders,
          };
        })
        .filter((cg): cg is ImportedColliderGroup => Boolean(cg));
    }
    if (Array.isArray(vrm0Ext.secondaryAnimation?.boneGroups)) {
      existingVrmSprings = vrm0Ext.secondaryAnimation!.boneGroups
        .map((bg) => {
          const boneNames = (bg.bones || [])
            .map((nodeIdx) => (gltfNodes[nodeIdx] ? gltfNodes[nodeIdx].name || `node_${nodeIdx}` : null))
            .filter((n): n is string => Boolean(n));
          const colliderGroupIndices = (bg.colliderGroups || []).filter(
            (cgIdx): cgIdx is number => typeof cgIdx === 'number' && cgIdx >= 0 && cgIdx < cgGroups.length
          );
          const colliderGroupNodeNames = colliderGroupIndices
            .map((cgIdx) => {
              const cgNodeIdx = cgGroups[cgIdx]?.node;
              return cgNodeIdx !== undefined && gltfNodes[cgNodeIdx]
                ? gltfNodes[cgNodeIdx].name || `node_${cgNodeIdx}`
                : null;
            })
            .filter((n): n is string => Boolean(n));
          return {
            comment: bg.comment,
            stiffiness: typeof bg.stiffiness === 'number' ? bg.stiffiness : 0.65,
            gravityPower: typeof bg.gravityPower === 'number' ? bg.gravityPower : 0.25,
            gravityDir: [
              bg.gravityDir?.x ?? 0,
              bg.gravityDir?.y ?? -1,
              bg.gravityDir?.z ?? 0,
            ] as [number, number, number],
            dragForce: typeof bg.dragForce === 'number' ? bg.dragForce : 0.4,
            hitRadius: typeof bg.hitRadius === 'number' ? bg.hitRadius : 0.02,
            centerNodeName:
              typeof bg.center === 'number' && bg.center >= 0 && gltfNodes[bg.center]
                ? gltfNodes[bg.center].name || `node_${bg.center}`
                : undefined,
            boneNames,
            colliderGroupIndices,
            colliderGroupNodeNames,
          };
        })
        .filter((s) => s.boneNames.length > 0);
    }
  } else if (vrm1Ext && typeof vrm1Ext === 'object') {
    sourceVrmVersion = '1.0';
    const vrmBonesRaw = vrm1Ext.humanoid?.humanBones;
    if (vrmBonesRaw && typeof vrmBonesRaw === 'object') {
      existingVrmHumanoid = {};
      for (const [vrmBone, ref] of Object.entries(vrmBonesRaw)) {
        if (ref && typeof ref.node === 'number' && gltfNodes[ref.node]) {
          existingVrmHumanoid[vrmBone] = gltfNodes[ref.node].name || `node_${ref.node}`;
        }
      }
    }
    if (vrm1Ext.meta) {
      const m1 = vrm1Ext.meta;
      const allowedUserName = toVrmAllowedUser(m1.avatarPermission) ?? 'OnlyAuthor';
      const violentUsage = toAllowance(m1.allowExcessivelyViolentUsage) ?? 'Disallow';
      const sexualUsage = toAllowance(m1.allowExcessivelySexualUsage) ?? 'Disallow';
      const commercialUsage: VrmAllowance =
        m1.commercialUsage === 'corporation' || m1.commercialUsage === 'personalProfit'
          ? 'Allow'
          : 'Disallow';
      const allowRedistribution = typeof m1.allowRedistribution === 'boolean' ? m1.allowRedistribution : false;
      const modification: VrmMetadataConfig['modification'] =
        m1.modification === 'allowModification' || m1.modification === 'allowModificationRedistribution'
          ? m1.modification
          : 'prohibited';
      const sourceRestrictions: VrmSourceLicenseRestrictions = {
        ...(m1.avatarPermission ? { allowedUserName } : {}),
        ...(typeof m1.allowExcessivelyViolentUsage === 'boolean' ? { violentUsage } : {}),
        ...(typeof m1.allowExcessivelySexualUsage === 'boolean' ? { sexualUsage } : {}),
        ...(m1.commercialUsage ? { commercialUsage } : {}),
        ...(typeof m1.allowRedistribution === 'boolean' ? { allowRedistribution } : {}),
        ...(m1.modification ? { modification } : {}),
      };
      sourceVrmMeta = {
        title: m1.name,
        author: Array.isArray(m1.authors) ? m1.authors.join(', ') : undefined,
        version: m1.version,
        contactInformation: m1.contactInformation,
        reference: Array.isArray(m1.references) ? m1.references[0] : undefined,
        licenseName: 'Other',
        otherLicenseUrl: m1.licenseUrl,
        allowedUserName,
        violentUsage,
        sexualUsage,
        commercialUsage,
        allowRedistribution,
        modification,
        sourceAttribution:
          [Array.isArray(m1.authors) ? m1.authors.join(', ') : undefined, m1.copyrightInformation]
            .filter(Boolean)
            .join(' · ') || undefined,
        sourceRestrictions,
      };
    }

    if (vrm1SpringExt && typeof vrm1SpringExt === 'object') {
      const flatColliders = vrm1SpringExt.colliders || [];
      const cgList = vrm1SpringExt.colliderGroups || [];
      if (cgList.length > 0 && flatColliders.length > 0) {
        const mappedGroups: ImportedColliderGroup[] = [];
        cgList.forEach((cg) => {
          const colIndices = cg.colliders || [];
          const byNode = new Map<number, ImportedColliderDef[]>();
          for (const ci of colIndices) {
            const c = flatColliders[ci];
            if (!c || typeof c.node !== 'number' || !gltfNodes[c.node]) continue;
            const sph = c.shape?.sphere;
            const cap = c.shape?.capsule;
            const off = sph?.offset ?? cap?.offset ?? [0, 0, 0];
            const rad = sph?.radius ?? cap?.radius ?? 0.05;
            const list = byNode.get(c.node) ?? [];
            list.push({
              offset: [Number(off[0] ?? 0), Number(off[1] ?? 0), Number(off[2] ?? 0)],
              radius: Math.max(0, Number(rad ?? 0.05)),
            });
            byNode.set(c.node, list);
          }
          for (const [nodeIdx, cols] of byNode.entries()) {
            mappedGroups.push({
              nodeName: gltfNodes[nodeIdx].name || `node_${nodeIdx}`,
              colliders: cols,
            });
          }
        });
        if (mappedGroups.length > 0) {
          existingVrmColliderGroups = mappedGroups;
        }
      }

      if (Array.isArray(vrm1SpringExt.springs)) {
        existingVrmSprings = vrm1SpringExt.springs
          .map((sp): ImportedSpringGroup | null => {
            const joints = (sp.joints || []).filter(
              (j) => typeof j.node === 'number' && gltfNodes[j.node]
            );
            if (joints.length === 0) return null;
            const chainBoneNames = joints.map((j) => gltfNodes[j.node!].name || `node_${j.node}`);
            const j0 = joints[0];
            const cgIndices = (sp.colliderGroups || []).filter(
              (idx): idx is number =>
                typeof idx === 'number' &&
                idx >= 0 &&
                idx < (existingVrmColliderGroups?.length ?? 0)
            );
            return {
              comment: sp.name,
              stiffiness: typeof j0.stiffness === 'number' ? j0.stiffness : 0.65,
              gravityPower: typeof j0.gravityPower === 'number' ? j0.gravityPower : 0.25,
              gravityDir: [
                j0.gravityDir?.[0] ?? 0,
                j0.gravityDir?.[1] ?? -1,
                j0.gravityDir?.[2] ?? 0,
              ] as [number, number, number],
              dragForce: typeof j0.dragForce === 'number' ? j0.dragForce : 0.4,
              hitRadius: typeof j0.hitRadius === 'number' ? j0.hitRadius : 0.025,
              centerNodeName:
                typeof sp.center === 'number' && sp.center >= 0 && gltfNodes[sp.center]
                  ? gltfNodes[sp.center].name || `node_${sp.center}`
                  : undefined,
              boneNames: [chainBoneNames[0]],
              chainBoneNames,
              colliderGroupIndices: cgIndices,
              colliderGroupNodeNames: cgIndices
                .map((idx) => existingVrmColliderGroups?.[idx]?.nodeName)
                .filter((n): n is string => Boolean(n)),
            };
          })
          .filter((s): s is ImportedSpringGroup => Boolean(s));
      }
    }
  }

  // 4. Map meshes to nodes (or traverse all meshes preserving multi-mesh hierarchy)
  const meshInstances: Array<{ meshIndex: number; nodeIndex: number; skinIndex?: number }> = [];
  for (let nIdx = 0; nIdx < gltfNodes.length; nIdx++) {
    const node = gltfNodes[nIdx];
    if (node.mesh !== undefined && meshes[node.mesh]) {
      meshInstances.push({
        meshIndex: node.mesh,
        nodeIndex: nIdx,
        skinIndex: node.skin,
      });
    }
  }
  if (meshInstances.length === 0) {
    meshes.forEach((_m, idx) => {
      meshInstances.push({ meshIndex: idx, nodeIndex: -1, skinIndex: undefined });
    });
  }

  const importedMeshes: ImportedMeshGroup[] = [];
  const mergedPos: number[] = [];
  const mergedNorm: number[] = [];
  const mergedUv: number[] = [];
  const mergedIdx: number[] = [];

  let primitiveCount = 0;
  let hasExistingSkin = false;
  let hasMorphTargets = false;
  let hasVertexColors = false;
  let hasMultiInfluenceSkin = false;
  const unsupportedFeatures = new Set<string>();
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const inst of meshInstances) {
    const mesh = meshes[inst.meshIndex];
    const worldMat =
      inst.nodeIndex >= 0 && nodeWorldMatrices[inst.nodeIndex]
        ? nodeWorldMatrices[inst.nodeIndex]
        : identityMat4();
    // Per glTF 2.0 spec, if node has a skin, skin matrices replace node transform; otherwise apply worldMat
    const applyWorldTransform = inst.skinIndex === undefined && !isIdentityMatrix(worldMat);
    const meshName = mesh.name || `Mesh_${inst.meshIndex}`;
    const targetNames = mesh.extras?.targetNames || [];
    const primitivesOut: ImportedPrimitiveData[] = [];

    const prims = mesh.primitives || [];
    for (let pIdx = 0; pIdx < prims.length; pIdx++) {
      const prim = prims[pIdx];
      if (prim.mode !== undefined && prim.mode !== 4) continue;
      const posIdx = prim.attributes?.POSITION;
      if (posIdx === undefined) continue;

      const rawPos = readAccessorArray(binChunk, accessors, bufferViews, posIdx);
      const vertCount = Math.floor(rawPos.length / 3);
      if (vertCount === 0) continue;

      const hasNormalsAttr = prim.attributes?.NORMAL !== undefined;
      const rawNorm = hasNormalsAttr
        ? readAccessorArray(binChunk, accessors, bufferViews, prim.attributes!.NORMAL)
        : new Float32Array(0);
      const hasUvsAttr = prim.attributes?.TEXCOORD_0 !== undefined;
      const rawUv = hasUvsAttr
        ? readAccessorArray(binChunk, accessors, bufferViews, prim.attributes!.TEXCOORD_0)
        : new Float32Array(0);
      const hasUvs1Attr = prim.attributes?.TEXCOORD_1 !== undefined;
      const rawUv1 = hasUvs1Attr
        ? readAccessorArray(binChunk, accessors, bufferViews, prim.attributes!.TEXCOORD_1)
        : undefined;

      const hasColAttr = prim.attributes?.COLOR_0 !== undefined;
      let colors: Float32Array | undefined;
      if (hasColAttr) {
        const colAccIdx = prim.attributes!.COLOR_0;
        const colAcc = accessors[colAccIdx];
        const rawCol = readAccessorArray(binChunk, accessors, bufferViews, colAccIdx);
        const elems = colAcc?.type === 'VEC3' ? 3 : 4;
        if (rawCol.length >= vertCount * elems) {
          colors = new Float32Array(vertCount * 4);
          for (let i = 0; i < vertCount; i++) {
            colors[i * 4] = rawCol[i * elems];
            colors[i * 4 + 1] = rawCol[i * elems + 1];
            colors[i * 4 + 2] = rawCol[i * elems + 2];
            colors[i * 4 + 3] = elems === 4 ? rawCol[i * 4 + 3] : 1.0;
          }
          hasVertexColors = true;
        }
      }

      if (prim.attributes?.JOINTS_1 !== undefined || prim.attributes?.WEIGHTS_1 !== undefined) {
        hasMultiInfluenceSkin = true;
      }

      const hasJointsAttr =
        prim.attributes?.JOINTS_0 !== undefined && prim.attributes?.WEIGHTS_0 !== undefined;
      const hasJoints1Attr =
        prim.attributes?.JOINTS_1 !== undefined && prim.attributes?.WEIGHTS_1 !== undefined;
      let joints: Uint16Array | undefined;
      let weights: Float32Array | undefined;
      let joints1: Uint16Array | undefined;
      let weights1: Float32Array | undefined;

      // Multi-skin remapping: if primitive binds to a secondary compatible skin, remap joint indices onto skins[0]
      const activeSkinIdx = inst.skinIndex ?? 0;
      const primarySkinObj = skins[0];
      const activeSkinObj = skins[activeSkinIdx];
      let jointRemap: number[] | null = null;
      if (activeSkinIdx > 0 && primarySkinObj && activeSkinObj) {
        const primaryByNode = new Map<number, number>();
        const primaryByName = new Map<string, number>();
        primarySkinObj.joints.forEach((pj, jIdx) => {
          primaryByNode.set(pj.jointNodeIndex, jIdx);
          primaryByName.set(pj.name, jIdx);
        });
        jointRemap = activeSkinObj.joints.map(
          (sj) => primaryByNode.get(sj.jointNodeIndex) ?? primaryByName.get(sj.name) ?? -1
        );
      }

      if (hasJointsAttr) {
        const rawJoints = readAccessorUint16Array(
          binChunk,
          accessors,
          bufferViews,
          prim.attributes!.JOINTS_0
        );
        const rawWeights = readAccessorArray(
          binChunk,
          accessors,
          bufferViews,
          prim.attributes!.WEIGHTS_0
        );
        const rawJoints1 = hasJoints1Attr
          ? readAccessorUint16Array(binChunk, accessors, bufferViews, prim.attributes!.JOINTS_1)
          : undefined;
        const rawWeights1 = hasJoints1Attr
          ? readAccessorArray(binChunk, accessors, bufferViews, prim.attributes!.WEIGHTS_1)
          : undefined;

        if (rawJoints.length >= vertCount * 4 && rawWeights.length >= vertCount * 4) {
          joints = new Uint16Array(rawJoints.subarray(0, vertCount * 4));
          weights = new Float32Array(vertCount * 4);
          const useSecondSet = Boolean(
            rawJoints1 &&
              rawWeights1 &&
              rawJoints1.length >= vertCount * 4 &&
              rawWeights1.length >= vertCount * 4
          );
          if (useSecondSet) {
            joints1 = new Uint16Array(rawJoints1!.subarray(0, vertCount * 4));
            weights1 = new Float32Array(vertCount * 4);
          }

          const mapJoint = (rawJ: number) => {
            if (!jointRemap) return rawJ;
            const mapped = jointRemap[rawJ];
            return mapped !== undefined && mapped >= 0 ? mapped : 0;
          };

          for (let i = 0; i < vertCount; i++) {
            const w0 = Math.max(0, rawWeights[i * 4]);
            const w1 = Math.max(0, rawWeights[i * 4 + 1]);
            const w2 = Math.max(0, rawWeights[i * 4 + 2]);
            const w3 = Math.max(0, rawWeights[i * 4 + 3]);
            joints[i * 4] = mapJoint(joints[i * 4]);
            joints[i * 4 + 1] = mapJoint(joints[i * 4 + 1]);
            joints[i * 4 + 2] = mapJoint(joints[i * 4 + 2]);
            joints[i * 4 + 3] = mapJoint(joints[i * 4 + 3]);

            let w4 = 0, w5 = 0, w6 = 0, w7 = 0;
            if (useSecondSet && rawWeights1 && joints1) {
              w4 = Math.max(0, rawWeights1[i * 4]);
              w5 = Math.max(0, rawWeights1[i * 4 + 1]);
              w6 = Math.max(0, rawWeights1[i * 4 + 2]);
              w7 = Math.max(0, rawWeights1[i * 4 + 3]);
              joints1[i * 4] = mapJoint(joints1[i * 4]);
              joints1[i * 4 + 1] = mapJoint(joints1[i * 4 + 1]);
              joints1[i * 4 + 2] = mapJoint(joints1[i * 4 + 2]);
              joints1[i * 4 + 3] = mapJoint(joints1[i * 4 + 3]);
            }

            const sum = w0 + w1 + w2 + w3 + w4 + w5 + w6 + w7;
            if (sum > 1e-6) {
              weights[i * 4] = w0 / sum;
              weights[i * 4 + 1] = w1 / sum;
              weights[i * 4 + 2] = w2 / sum;
              weights[i * 4 + 3] = w3 / sum;
              if (weights1) {
                weights1[i * 4] = w4 / sum;
                weights1[i * 4 + 1] = w5 / sum;
                weights1[i * 4 + 2] = w6 / sum;
                weights1[i * 4 + 3] = w7 / sum;
              }
            } else {
              weights[i * 4] = 1;
              weights[i * 4 + 1] = 0;
              weights[i * 4 + 2] = 0;
              weights[i * 4 + 3] = 0;
              if (weights1) {
                weights1[i * 4] = 0;
                weights1[i * 4 + 1] = 0;
                weights1[i * 4 + 2] = 0;
                weights1[i * 4 + 3] = 0;
              }
            }
          }
          hasExistingSkin = true;
        }
      }

      // Read indices
      let indices: Uint32Array;
      if (prim.indices !== undefined) {
        const idxArr = readAccessorArray(binChunk, accessors, bufferViews, prim.indices);
        const triIdx: number[] = [];
        for (let k = 0; k + 2 < idxArr.length; k += 3) {
          const a = Math.floor(idxArr[k]);
          const b = Math.floor(idxArr[k + 1]);
          const c = Math.floor(idxArr[k + 2]);
          if (a < vertCount && b < vertCount && c < vertCount) {
            triIdx.push(a, b, c);
          }
        }
        indices = new Uint32Array(triIdx);
      } else {
        const triIdx: number[] = [];
        for (let k = 0; k + 2 < vertCount; k += 3) {
          triIdx.push(k, k + 1, k + 2);
        }
        indices = new Uint32Array(triIdx);
      }
      if (indices.length < 3) continue;

      primitiveCount++;
      const positions = new Float32Array(vertCount * 3);
      const uvs = new Float32Array(vertCount * 2);

      const baseVertex = mergedPos.length / 3;
      for (let i = 0; i < vertCount; i++) {
        let x = Number.isFinite(rawPos[i * 3]) ? rawPos[i * 3] : 0;
        let y = Number.isFinite(rawPos[i * 3 + 1]) ? rawPos[i * 3 + 1] : 0;
        let z = Number.isFinite(rawPos[i * 3 + 2]) ? rawPos[i * 3 + 2] : 0;
        if (applyWorldTransform) {
          [x, y, z] = transformPointMat4(worldMat, x, y, z);
        }
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        mergedPos.push(x, y, z);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;

        if (rawUv.length >= (i + 1) * 2) {
          uvs[i * 2] = rawUv[i * 2];
          uvs[i * 2 + 1] = rawUv[i * 2 + 1];
        } else {
          uvs[i * 2] = 0.5;
          uvs[i * 2 + 1] = 0.5;
        }
        mergedUv.push(uvs[i * 2], uvs[i * 2 + 1]);
      }

      let normals: Float32Array;
      if (rawNorm.length >= vertCount * 3) {
        normals = new Float32Array(vertCount * 3);
        for (let i = 0; i < vertCount; i++) {
          let nx = rawNorm[i * 3];
          let ny = rawNorm[i * 3 + 1];
          let nz = rawNorm[i * 3 + 2];
          if (applyWorldTransform) {
            [nx, ny, nz] = transformVectorMat4(worldMat, nx, ny, nz);
          } else {
            const l = Math.hypot(nx, ny, nz) || 1;
            nx /= l;
            ny /= l;
            nz /= l;
          }
          normals[i * 3] = nx;
          normals[i * 3 + 1] = ny;
          normals[i * 3 + 2] = nz;
        }
      } else {
        normals = computeSmoothNormals(positions, indices);
      }
      for (let i = 0; i < vertCount * 3; i++) {
        mergedNorm.push(normals[i]);
      }

      for (let k = 0; k < indices.length; k++) {
        mergedIdx.push(baseVertex + indices[k]);
      }

      // Preserve existing morph targets
      const morphTargets: ImportedMorphTargetData[] = [];
      if (Array.isArray(prim.targets) && prim.targets.length > 0) {
        prim.targets.forEach((target, tIdx) => {
          if (target.POSITION === undefined) return;
          const tPos = readAccessorArray(binChunk!, accessors, bufferViews, target.POSITION);
          if (tPos.length < vertCount * 3) return;
          const deltas = new Float32Array(vertCount * 3);
          for (let i = 0; i < vertCount; i++) {
            let dx = tPos[i * 3];
            let dy = tPos[i * 3 + 1];
            let dz = tPos[i * 3 + 2];
            if (applyWorldTransform) {
              // Scale/rotate delta vector without translation
              deltas[i * 3] = worldMat[0] * dx + worldMat[4] * dy + worldMat[8] * dz;
              deltas[i * 3 + 1] = worldMat[1] * dx + worldMat[5] * dy + worldMat[9] * dz;
              deltas[i * 3 + 2] = worldMat[2] * dx + worldMat[6] * dy + worldMat[10] * dz;
            } else {
              deltas[i * 3] = dx;
              deltas[i * 3 + 1] = dy;
              deltas[i * 3 + 2] = dz;
            }
          }
          let tNormals: Float32Array | undefined;
          if (target.NORMAL !== undefined) {
            const rawTN = readAccessorArray(binChunk!, accessors, bufferViews, target.NORMAL);
            if (rawTN.length >= vertCount * 3) {
              if (applyWorldTransform) {
                tNormals = new Float32Array(vertCount * 3);
                for (let i = 0; i < vertCount; i++) {
                  const baseNorm: [number, number, number] =
                    rawNorm.length >= vertCount * 3
                      ? [rawNorm[i * 3], rawNorm[i * 3 + 1], rawNorm[i * 3 + 2]]
                      : [0, 1, 0];
                  const [dnx, dny, dnz] = transformMorphNormalDelta(
                    worldMat,
                    baseNorm,
                    rawTN[i * 3],
                    rawTN[i * 3 + 1],
                    rawTN[i * 3 + 2]
                  );
                  tNormals[i * 3] = dnx;
                  tNormals[i * 3 + 1] = dny;
                  tNormals[i * 3 + 2] = dnz;
                }
              } else {
                tNormals = new Float32Array(rawTN.subarray(0, vertCount * 3));
              }
            }
          }
          morphTargets.push({
            name: targetNames[tIdx] || `morph_${tIdx}`,
            positions: deltas,
            normals: tNormals,
          });
          hasMorphTargets = true;
        });
      }

      primitivesOut.push({
        meshIndex: inst.meshIndex,
        meshName,
        primitiveIndex: pIdx,
        name: prims.length > 1 ? `${meshName}_prim_${pIdx}` : meshName,
        materialIndex: prim.material !== undefined ? prim.material : 0,
        hasNormals: hasNormalsAttr,
        hasUvs: hasUvsAttr,
        hasUvs1: hasUvs1Attr,
        hasColors: Boolean(colors),
        hasSkinning: Boolean(joints && weights),
        positions,
        normals,
        uvs,
        uvs1: rawUv1 && rawUv1.length >= vertCount * 2 ? rawUv1.subarray(0, vertCount * 2) : undefined,
        colors,
        joints,
        weights,
        joints1,
        weights1,
        indices,
        morphTargets,
      });
    }

    if (primitivesOut.length > 0) {
      importedMeshes.push({
        meshIndex: inst.meshIndex,
        name: meshName,
        nodeIndex: inst.nodeIndex,
        skinIndex: inst.skinIndex,
        worldMatrix: worldMat,
        targetNames,
        primitives: primitivesOut,
      });
    }
  }

  if (mergedPos.length === 0 || mergedIdx.length === 0) {
    return emptyResult('GLB has no valid triangulated mesh geometry.');
  }

  // 5. Audit multiple skins / disjoint armatures so incompatible skeletons are flagged explicitly rather than silently dropped
  let multiSkinAudit: ParsedGlbAsset['multiSkinAudit'];
  if (skins.length > 1) {
    const primaryNodes = new Set(skins[0].joints.map((j) => j.jointNodeIndex));
    const primaryNames = new Set(skins[0].joints.map((j) => j.name));
    const incompatibleSkins: number[] = [];
    const warnings: string[] = [];
    for (let sIdx = 1; sIdx < skins.length; sIdx++) {
      const missingJoints = skins[sIdx].joints.filter(
        (j) => !primaryNodes.has(j.jointNodeIndex) && !primaryNames.has(j.name)
      );
      if (missingJoints.length > 0) {
        incompatibleSkins.push(sIdx);
        warnings.push(
          `Skin[${sIdx}] ("${skins[sIdx].name}") defines ${missingJoints.length} joint(s) not present in primary Skin[0]; cross-armature weights cannot merge without lossy rebinding.`
        );
        unsupportedFeatures.add(warnings[warnings.length - 1]);
      }
    }
    multiSkinAudit = {
      skinCount: skins.length,
      allSkinsCompatible: incompatibleSkins.length === 0,
      incompatibleSkins,
      warnings,
    };
  }

  return {
    valid: true,
    meshCount: importedMeshes.length,
    primitiveCount,
    materialCount: materials.length,
    textureCount: textures.length,
    imageCount: images.length,
    vertexCount: mergedPos.length / 3,
    triangleCount: mergedIdx.length / 3,
    hasExistingSkin: hasExistingSkin && skins.length > 0,
    hasMorphTargets,
    hasVertexColors,
    hasNodeTransforms,
    hasMultiInfluenceSkin,
    unsupportedFeatures: unsupportedFeatures.size > 0 ? Array.from(unsupportedFeatures) : undefined,
    multiSkinAudit,
    sourceVrmVersion,
    sourceVrmMeta,
    existingVrmHumanoid,
    existingVrmSprings,
    existingVrmColliderGroups,
    boundsMin: [minX, minY, minZ],
    boundsMax: [maxX, maxY, maxZ],
    meshes: importedMeshes,
    materials,
    textures,
    samplers,
    images,
    skins,
    positions: new Float32Array(mergedPos),
    normals: new Float32Array(mergedNorm),
    uvs: new Float32Array(mergedUv),
    indices: new Uint32Array(mergedIdx),
  };
}
