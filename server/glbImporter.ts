export interface ParsedGlbAsset {
  valid: boolean;
  error?: string;
  meshCount: number;
  primitiveCount: number;
  vertexCount: number;
  triangleCount: number;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

interface GltfAccessorMeta {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';
}

interface GltfBufferViewMeta {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
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
  componentType: number
): number {
  switch (componentType) {
    case 5120:
      return view.getInt8(byteOffset);
    case 5121:
      return view.getUint8(byteOffset);
    case 5122:
      return view.getInt16(byteOffset, true);
    case 5123:
      return view.getUint16(byteOffset, true);
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
  if (!acc || acc.bufferView === undefined) {
    return new Float32Array(0);
  }
  const bv = bufferViews[acc.bufferView];
  if (!bv) return new Float32Array(0);

  const elems = typeElementCount(acc.type);
  const compBytes = componentSize(acc.componentType);
  if (!compBytes) return new Float32Array(0);

  const stride = bv.byteStride && bv.byteStride > 0 ? bv.byteStride : elems * compBytes;
  const baseOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Float32Array(acc.count * elems);
  const view = new DataView(binBytes.buffer, binBytes.byteOffset, binBytes.byteLength);

  for (let i = 0; i < acc.count; i++) {
    const elemStart = baseOffset + i * stride;
    if (elemStart + elems * compBytes > binBytes.byteLength) break;
    for (let k = 0; k < elems; k++) {
      out[i * elems + k] = readScalar(view, elemStart + k * compBytes, acc.componentType);
    }
  }
  return out;
}

export function parseAndValidateGlbAsset(payload: Uint8Array): ParsedGlbAsset {
  const emptyResult = (error: string): ParsedGlbAsset => ({
    valid: false,
    error,
    meshCount: 0,
    primitiveCount: 0,
    vertexCount: 0,
    triangleCount: 0,
    boundsMin: [0, 0, 0],
    boundsMax: [0, 0, 0],
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
    meshes?: Array<{ primitives?: Array<{ attributes?: Record<string, number>; indices?: number; mode?: number }> }>;
    accessors?: GltfAccessorMeta[];
    bufferViews?: GltfBufferViewMeta[];
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
  if (meshes.length === 0) {
    return emptyResult('GLB contains zero meshes.');
  }

  const mergedPos: number[] = [];
  const mergedNorm: number[] = [];
  const mergedUv: number[] = [];
  const mergedIdx: number[] = [];

  let primitiveCount = 0;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const mesh of meshes) {
    for (const prim of mesh.primitives || []) {
      if (prim.mode !== undefined && prim.mode !== 4) continue;
      const posIdx = prim.attributes?.POSITION;
      if (posIdx === undefined) continue;
      const pos = readAccessorArray(binChunk, accessors, bufferViews, posIdx);
      const vertCount = Math.floor(pos.length / 3);
      if (vertCount === 0) continue;

      primitiveCount++;
      const baseVertex = mergedPos.length / 3;
      const norm =
        prim.attributes?.NORMAL !== undefined
          ? readAccessorArray(binChunk, accessors, bufferViews, prim.attributes.NORMAL)
          : new Float32Array(0);
      const uv =
        prim.attributes?.TEXCOORD_0 !== undefined
          ? readAccessorArray(binChunk, accessors, bufferViews, prim.attributes.TEXCOORD_0)
          : new Float32Array(0);

      for (let i = 0; i < vertCount; i++) {
        const x = Number.isFinite(pos[i * 3]) ? pos[i * 3] : 0;
        const y = Number.isFinite(pos[i * 3 + 1]) ? pos[i * 3 + 1] : 0;
        const z = Number.isFinite(pos[i * 3 + 2]) ? pos[i * 3 + 2] : 0;
        mergedPos.push(x, y, z);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;

        if (norm.length >= (i + 1) * 3) {
          mergedNorm.push(norm[i * 3], norm[i * 3 + 1], norm[i * 3 + 2]);
        } else {
          mergedNorm.push(0, 1, 0);
        }

        if (uv.length >= (i + 1) * 2) {
          mergedUv.push(uv[i * 2], uv[i * 2 + 1]);
        } else {
          mergedUv.push(0.5, 0.5);
        }
      }

      if (prim.indices !== undefined) {
        const idxArr = readAccessorArray(binChunk, accessors, bufferViews, prim.indices);
        for (let k = 0; k + 2 < idxArr.length; k += 3) {
          const a = Math.floor(idxArr[k]);
          const b = Math.floor(idxArr[k + 1]);
          const c = Math.floor(idxArr[k + 2]);
          if (a < vertCount && b < vertCount && c < vertCount) {
            mergedIdx.push(baseVertex + a, baseVertex + b, baseVertex + c);
          }
        }
      } else {
        for (let k = 0; k + 2 < vertCount; k += 3) {
          mergedIdx.push(baseVertex + k, baseVertex + k + 1, baseVertex + k + 2);
        }
      }
    }
  }

  if (mergedPos.length === 0 || mergedIdx.length === 0) {
    return emptyResult('GLB has no valid triangulated mesh geometry.');
  }

  return {
    valid: true,
    meshCount: meshes.length,
    primitiveCount,
    vertexCount: mergedPos.length / 3,
    triangleCount: mergedIdx.length / 3,
    boundsMin: [minX, minY, minZ],
    boundsMax: [maxX, maxY, maxZ],
    positions: new Float32Array(mergedPos),
    normals: new Float32Array(mergedNorm),
    uvs: new Float32Array(mergedUv),
    indices: new Uint32Array(mergedIdx),
  };
}
