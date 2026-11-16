import {
  BoneDef,
  FaceRegionTag,
  PrimitiveBuild,
} from '../anatomicalSculptor';

export function createPrimitive(
  name: string,
  materialIndex: number,
  hasMorphTargets = false,
  isFacialOrHair = false,
  hasVertexColors = false,
  hasFaceLocal = false
): PrimitiveBuild {
  return {
    name,
    materialIndex,
    positions: [],
    normals: [],
    uvs: [],
    ...(hasVertexColors ? { colors: [] } : {}),
    ...(hasFaceLocal ? { faceLocal: [] } : {}),
    joints: [],
    weights: [],
    indices: [],
    hasMorphTargets,
    isFacialOrHair,
    faceTags: [],
  };
}

export function appendVertex(
  prim: PrimitiveBuild,
  pos: [number, number, number],
  norm: [number, number, number],
  uv: [number, number],
  j: [number, number, number, number],
  w: [number, number, number, number],
  faceTag: FaceRegionTag = 'none',
  color: [number, number, number, number] = [1, 1, 1, 1],
  faceLocal: [number, number, number] = [0, 0, 0]
): number {
  const idx = prim.positions.length / 3;
  const nLen = Math.hypot(norm[0], norm[1], norm[2]) || 1;
  prim.positions.push(pos[0], pos[1], pos[2]);
  prim.normals.push(norm[0] / nLen, norm[1] / nLen, norm[2] / nLen);
  prim.uvs.push(uv[0], uv[1]);
  if (prim.colors) {
    prim.colors.push(color[0], color[1], color[2], color[3]);
  }
  if (prim.faceLocal) {
    prim.faceLocal.push(faceLocal[0], faceLocal[1], faceLocal[2]);
  }

  const wSum = w[0] + w[1] + w[2] + w[3];
  const inv = wSum > 0 ? 1 / wSum : 1;
  prim.joints.push(j[0], j[1], j[2], j[3]);
  prim.weights.push(
    wSum > 0 ? w[0] * inv : 1,
    wSum > 0 ? w[1] * inv : 0,
    wSum > 0 ? w[2] * inv : 0,
    wSum > 0 ? w[3] * inv : 0
  );
  if (prim.faceTags) {
    prim.faceTags.push({ region: faceTag });
  }
  return idx;
}

export function recomputeNormalsRange(
  prim: PrimitiveBuild,
  startVert: number,
  startIdx: number
) {
  const vertCount = prim.positions.length / 3;
  for (let v = startVert; v < vertCount; v++) {
    prim.normals[v * 3] = 0;
    prim.normals[v * 3 + 1] = 0;
    prim.normals[v * 3 + 2] = 0;
  }
  for (let i = startIdx; i < prim.indices.length; i += 3) {
    const ia = prim.indices[i];
    const ib = prim.indices[i + 1];
    const ic = prim.indices[i + 2];
    const ax = prim.positions[ia * 3];
    const ay = prim.positions[ia * 3 + 1];
    const az = prim.positions[ia * 3 + 2];
    const abx = prim.positions[ib * 3] - ax;
    const aby = prim.positions[ib * 3 + 1] - ay;
    const abz = prim.positions[ib * 3 + 2] - az;
    const acx = prim.positions[ic * 3] - ax;
    const acy = prim.positions[ic * 3 + 1] - ay;
    const acz = prim.positions[ic * 3 + 2] - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const v of [ia, ib, ic]) {
      prim.normals[v * 3] += nx;
      prim.normals[v * 3 + 1] += ny;
      prim.normals[v * 3 + 2] += nz;
    }
  }
  for (let v = startVert; v < vertCount; v++) {
    const nx = prim.normals[v * 3];
    const ny = prim.normals[v * 3 + 1];
    const nz = prim.normals[v * 3 + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    prim.normals[v * 3] = nx / len;
    prim.normals[v * 3 + 1] = ny / len;
    prim.normals[v * 3 + 2] = nz / len;
  }
}

export interface AnatomicalRing {
  center: [number, number, number];
  rx: number;
  rz: number;
  boneA: number;
  boneB: number;
  weightA: number;
  axis?: 'y' | 'x';
  tiltX?: number;
  color?: [number, number, number, number];
  contourFn?: (
    cosT: number,
    sinT: number,
    theta: number
  ) => { scaleR?: number; dx?: number; dy?: number; dz?: number };
}

export function appendAnatomicalLoft(
  prim: PrimitiveBuild,
  rings: AnatomicalRing[],
  radialSegments: number,
  capEnds = false
) {
  if (rings.length < 2) return;
  const startVert = prim.positions.length / 3;
  const startIdx = prim.indices.length;

  const first = rings[0].center;
  const last = rings[rings.length - 1].center;
  const isX = rings[0].axis === 'x';
  const progressingPositive = isX ? last[0] >= first[0] : last[1] >= first[1];
  const flipWinding = isX ? progressingPositive : !progressingPositive;

  const ringStarts: number[] = [];
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    const v = r / Math.max(1, rings.length - 1);
    ringStarts.push(prim.positions.length / 3);
    const wA = Math.max(0, Math.min(1, ring.weightA));
    const wB = 1 - wA;
    const col: [number, number, number, number] = ring.color ?? [1, 1, 1, 1];

    for (let s = 0; s <= radialSegments; s++) {
      const u = s / radialSegments;
      const theta = u * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const mod = ring.contourFn ? ring.contourFn(cosT, sinT, theta) : {};
      const scaleR = mod.scaleR ?? 1;

      let px: number;
      let py: number;
      let pz: number;
      if (ring.axis === 'x') {
        px = ring.center[0] + (mod.dx ?? 0);
        py = ring.center[1] + cosT * ring.rx * scaleR + (mod.dy ?? 0);
        pz = ring.center[2] + sinT * ring.rz * scaleR + (mod.dz ?? 0);
      } else {
        px = ring.center[0] + cosT * ring.rx * scaleR + (mod.dx ?? 0);
        py = ring.center[1] + (ring.tiltX ? sinT * ring.tiltX : 0) + (mod.dy ?? 0);
        pz = ring.center[2] + sinT * ring.rz * scaleR + (mod.dz ?? 0);
      }

      appendVertex(
        prim,
        [px, py, pz],
        [0, 1, 0],
        [u, v],
        [ring.boneA, ring.boneB, 0, 0],
        [wA, wB, 0, 0],
        'none',
        col
      );
    }
  }

  for (let r = 0; r < rings.length - 1; r++) {
    const a0 = ringStarts[r];
    const b0 = ringStarts[r + 1];
    for (let s = 0; s < radialSegments; s++) {
      const i0 = a0 + s;
      const i1 = a0 + s + 1;
      const i2 = b0 + s;
      const i3 = b0 + s + 1;
      if (!flipWinding) {
        prim.indices.push(i0, i2, i1, i1, i2, i3);
      } else {
        prim.indices.push(i0, i1, i2, i1, i3, i2);
      }
    }
  }

  if (capEnds) {
    const firstRing = rings[0];
    const lastRing = rings[rings.length - 1];
    const startCenter = appendVertex(
      prim,
      firstRing.center,
      [0, -1, 0],
      [0.5, 0],
      [firstRing.boneA, firstRing.boneB, 0, 0],
      [firstRing.weightA, 1 - firstRing.weightA, 0, 0],
      'none',
      firstRing.color ?? [1, 1, 1, 1]
    );
    const endCenter = appendVertex(
      prim,
      lastRing.center,
      [0, 1, 0],
      [0.5, 1],
      [lastRing.boneA, lastRing.boneB, 0, 0],
      [lastRing.weightA, 1 - lastRing.weightA, 0, 0],
      'none',
      lastRing.color ?? [1, 1, 1, 1]
    );
    const r0 = ringStarts[0];
    const rN = ringStarts[rings.length - 1];
    for (let s = 0; s < radialSegments; s++) {
      if (!flipWinding) {
        prim.indices.push(startCenter, r0 + s, r0 + s + 1);
        prim.indices.push(endCenter, rN + s + 1, rN + s);
      } else {
        prim.indices.push(startCenter, r0 + s + 1, r0 + s);
        prim.indices.push(endCenter, rN + s, rN + s + 1);
      }
    }
  }

  recomputeNormalsRange(prim, startVert, startIdx);
}

/**
 * Builds a thickened double-walled anatomical shell (outer + inner + beveled edge lips)
 * so armor plates, collars, cuffs, belts, and boot shafts have real 3D wall thickness
 * instead of paper-thin single-sided geometry.
 */
export function appendThickenedShellLoft(
  prim: PrimitiveBuild,
  rings: AnatomicalRing[],
  radialSegments: number,
  wallThickness: number
) {
  if (rings.length < 2) return;
  const t = Math.max(0.0015, wallThickness);
  const first = rings[0];
  const last = rings[rings.length - 1];
  const isX = first.axis === 'x';
  const dir = isX
    ? last.center[0] >= first.center[0]
      ? 1
      : -1
    : last.center[1] >= first.center[1]
      ? 1
      : -1;

  // Inner surface -> bottom bevel rim -> outer surface -> top bevel rim
  const innerRings: AnatomicalRing[] = [...rings]
    .reverse()
    .map((r) => ({
      ...r,
      rx: Math.max(0.004, r.rx - t),
      rz: Math.max(0.004, r.rz - t),
      color: r.color
        ? [r.color[0] * 0.72, r.color[1] * 0.72, r.color[2] * 0.72, 1]
        : [0.72, 0.72, 0.72, 1],
    }));

  const bottomBevel: AnatomicalRing = {
    ...first,
    center: isX
      ? [first.center[0] - dir * t * 0.45, first.center[1], first.center[2]]
      : [first.center[0], first.center[1] - dir * t * 0.45, first.center[2]],
    rx: Math.max(0.004, first.rx - t * 0.45),
    rz: Math.max(0.004, first.rz - t * 0.45),
  };

  const topBevel: AnatomicalRing = {
    ...last,
    center: isX
      ? [last.center[0] + dir * t * 0.45, last.center[1], last.center[2]]
      : [last.center[0], last.center[1] + dir * t * 0.45, last.center[2]],
    rx: Math.max(0.004, last.rx - t * 0.45),
    rz: Math.max(0.004, last.rz - t * 0.45),
  };

  const closedLoop = [
    ...innerRings,
    bottomBevel,
    ...rings,
    topBevel,
    innerRings[0],
  ];

  const startVert = prim.positions.length / 3;
  const startIdx = prim.indices.length;
  const ringStarts: number[] = [];

  for (let r = 0; r < closedLoop.length; r++) {
    const ring = closedLoop[r];
    const v = r / Math.max(1, closedLoop.length - 1);
    ringStarts.push(prim.positions.length / 3);
    const wA = Math.max(0, Math.min(1, ring.weightA));
    const wB = 1 - wA;
    const col: [number, number, number, number] = ring.color ?? [1, 1, 1, 1];

    for (let s = 0; s <= radialSegments; s++) {
      const u = s / radialSegments;
      const theta = u * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const mod = ring.contourFn ? ring.contourFn(cosT, sinT, theta) : {};
      const scaleR = mod.scaleR ?? 1;

      let px: number;
      let py: number;
      let pz: number;
      if (ring.axis === 'x') {
        px = ring.center[0] + (mod.dx ?? 0);
        py = ring.center[1] + cosT * ring.rx * scaleR + (mod.dy ?? 0);
        pz = ring.center[2] + sinT * ring.rz * scaleR + (mod.dz ?? 0);
      } else {
        px = ring.center[0] + cosT * ring.rx * scaleR + (mod.dx ?? 0);
        py = ring.center[1] + (ring.tiltX ? sinT * ring.tiltX : 0) + (mod.dy ?? 0);
        pz = ring.center[2] + sinT * ring.rz * scaleR + (mod.dz ?? 0);
      }

      appendVertex(
        prim,
        [px, py, pz],
        [0, 1, 0],
        [u, v],
        [ring.boneA, ring.boneB, 0, 0],
        [wA, wB, 0, 0],
        'none',
        col
      );
    }
  }

  const flipWinding = isX ? dir > 0 : dir <= 0;
  for (let r = 0; r < closedLoop.length - 1; r++) {
    const a0 = ringStarts[r];
    const b0 = ringStarts[r + 1];
    for (let s = 0; s < radialSegments; s++) {
      const i0 = a0 + s;
      const i1 = a0 + s + 1;
      const i2 = b0 + s;
      const i3 = b0 + s + 1;
      if (!flipWinding) {
        prim.indices.push(i0, i2, i1, i1, i2, i3);
      } else {
        prim.indices.push(i0, i1, i2, i1, i3, i2);
      }
    }
  }

  recomputeNormalsRange(prim, startVert, startIdx);
}

/**
 * Generates an open curved 3D beveled plate (solid front + back + 4 beveled side edges)
 * ideal for articulated tassets, knee poleyns, shin greaves, pauldron lames, and chest armor plates.
 */
export function appendCurvedArmorPlate(
  prim: PrimitiveBuild,
  cols: number,
  rows: number,
  thickness: number,
  evalSurface: (
    u: number,
    v: number
  ) => {
    pos: [number, number, number];
    normal: [number, number, number];
    boneA: number;
    boneB: number;
    weightA: number;
    color?: [number, number, number, number];
  }
) {
  const startVert = prim.positions.length / 3;
  const startIdx = prim.indices.length;

  const frontGrid: number[][] = [];
  const backGrid: number[][] = [];

  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const fRow: number[] = [];
    const bRow: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const s = evalSurface(u, v);
      const nLen = Math.hypot(s.normal[0], s.normal[1], s.normal[2]) || 1;
      const nx = s.normal[0] / nLen;
      const ny = s.normal[1] / nLen;
      const nz = s.normal[2] / nLen;

      // Taper thickness gently right at perimeter for crisp beveled edge feel
      const edgeU = Math.min(u, 1 - u);
      const edgeV = Math.min(v, 1 - v);
      const bevelFactor = Math.min(1, Math.min(edgeU, edgeV) * 8 + 0.35);
      const halfT = thickness * 0.5 * bevelFactor;
      const col: [number, number, number, number] = s.color ?? [1, 1, 1, 1];
      const backCol: [number, number, number, number] = [
        col[0] * 0.65,
        col[1] * 0.65,
        col[2] * 0.65,
        1,
      ];

      fRow.push(
        appendVertex(
          prim,
          [s.pos[0] + nx * halfT, s.pos[1] + ny * halfT, s.pos[2] + nz * halfT],
          [nx, ny, nz],
          [u, v],
          [s.boneA, s.boneB, 0, 0],
          [s.weightA, 1 - s.weightA, 0, 0],
          'none',
          col
        )
      );
      bRow.push(
        appendVertex(
          prim,
          [s.pos[0] - nx * halfT, s.pos[1] - ny * halfT, s.pos[2] - nz * halfT],
          [-nx, -ny, -nz],
          [u, v],
          [s.boneA, s.boneB, 0, 0],
          [s.weightA, 1 - s.weightA, 0, 0],
          'none',
          backCol
        )
      );
    }
    frontGrid.push(fRow);
    backGrid.push(bRow);
  }

  // Front and back faces
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const f00 = frontGrid[r][c];
      const f10 = frontGrid[r][c + 1];
      const f01 = frontGrid[r + 1][c];
      const f11 = frontGrid[r + 1][c + 1];
      prim.indices.push(f00, f10, f01, f10, f11, f01);

      const b00 = backGrid[r][c];
      const b10 = backGrid[r][c + 1];
      const b01 = backGrid[r + 1][c];
      const b11 = backGrid[r + 1][c + 1];
      prim.indices.push(b00, b01, b10, b10, b01, b11);
    }
  }

  // Stitch all 4 beveled perimeter edges
  for (let c = 0; c < cols; c++) {
    // Top (r=0)
    prim.indices.push(frontGrid[0][c], backGrid[0][c], frontGrid[0][c + 1]);
    prim.indices.push(frontGrid[0][c + 1], backGrid[0][c], backGrid[0][c + 1]);
    // Bottom (r=rows)
    prim.indices.push(frontGrid[rows][c], frontGrid[rows][c + 1], backGrid[rows][c]);
    prim.indices.push(frontGrid[rows][c + 1], backGrid[rows][c + 1], backGrid[rows][c]);
  }
  for (let r = 0; r < rows; r++) {
    // Left (c=0)
    prim.indices.push(frontGrid[r][0], frontGrid[r + 1][0], backGrid[r][0]);
    prim.indices.push(frontGrid[r + 1][0], backGrid[r + 1][0], backGrid[r][0]);
    // Right (c=cols)
    prim.indices.push(frontGrid[r][cols], backGrid[r][cols], frontGrid[r + 1][cols]);
    prim.indices.push(frontGrid[r + 1][cols], backGrid[r][cols], backGrid[r + 1][cols]);
  }

  recomputeNormalsRange(prim, startVert, startIdx);
}

/** Smooth Catmull-Rom 3D spline evaluation */
export function evalCatmullRom(
  pts: [number, number, number][],
  t: number
): [number, number, number] {
  const n = pts.length - 1;
  const f = Math.max(0, Math.min(n - 0.0001, t * n));
  const i = Math.floor(f);
  const u = f - i;
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[Math.min(n, i + 1)];
  const p3 = pts[Math.min(n, i + 2)];

  const u2 = u * u;
  const u3 = u2 * u;
  const interp = (a: number, b: number, c: number, d: number) =>
    0.5 *
    (2 * b +
      (-a + c) * u +
      (2 * a - 5 * b + 4 * c - d) * u2 +
      (-a + 3 * b - 3 * c + d) * u3);

  return [
    interp(p0[0], p1[0], p2[0], p3[0]),
    interp(p0[1], p1[1], p2[1], p3[1]),
    interp(p0[2], p1[2], p2[2], p3[2]),
  ];
}

export interface HairControlPoint {
  pos: [number, number, number];
  width: number;
  thickness: number;
  boneA: number;
  boneB: number;
  weightA: number;
}

/**
 * Generates an arched volumetric curved hair lock / trim tube along a Catmull-Rom spline
 * with an 8-point sculpted beveled crescent profile and closed tapered root & tip caps.
 */
export function appendCurvedHairStrand(
  prim: PrimitiveBuild,
  controlPoints: HairControlPoint[],
  segments = 10,
  twistRad = 0,
  colorRoot: [number, number, number] = [0.78, 0.78, 0.8],
  colorTip: [number, number, number] = [0.98, 0.98, 1.0],
  outwardBias?: [number, number, number]
) {
  if (controlPoints.length < 2) return;
  const startVert = prim.positions.length / 3;
  const startIdx = prim.indices.length;
  const posList = controlPoints.map((c) => c.pos);

  // 8-vertex sculpted crescent profile: crisp center specular ridge + soft rounded edges
  const profileTemplate: Array<[number, number]> = [
    [-1.0, -0.1],
    [-0.65, 0.42],
    [-0.25, 0.78],
    [0.0, 0.92],
    [0.25, 0.78],
    [0.65, 0.42],
    [1.0, -0.1],
    [0.0, -0.58],
  ];
  const profLen = profileTemplate.length;
  const ringStarts: number[] = [];

  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const pt = evalCatmullRom(posList, t);
    const ptNext = evalCatmullRom(posList, Math.min(1, t + 0.02));
    const ptPrev = evalCatmullRom(posList, Math.max(0, t - 0.02));

    let tx = ptNext[0] - ptPrev[0];
    let ty = ptNext[1] - ptPrev[1];
    let tz = ptNext[2] - ptPrev[2];
    const tLen = Math.hypot(tx, ty, tz) || 1;
    tx /= tLen;
    ty /= tLen;
    tz /= tLen;

    let out: [number, number, number];
    if (outwardBias) {
      out = outwardBias;
    } else {
      let outX = pt[0];
      let outZ = pt[2] >= -0.02 ? Math.max(0.15, pt[2]) : pt[2];
      const outLen = Math.hypot(outX, outZ) || 1;
      outX /= outLen;
      outZ /= outLen;
      out = [outX, 0.1, outZ];
    }

    // Orthogonalize out relative to tangent so cross-section never collapses
    const dot = out[0] * tx + out[1] * ty + out[2] * tz;
    let ox = out[0] - dot * tx;
    let oy = out[1] - dot * ty;
    let oz = out[2] - dot * tz;
    const oLen = Math.hypot(ox, oy, oz) || 1;
    ox /= oLen;
    oy /= oLen;
    oz /= oLen;

    let bx = ty * oz - tz * oy;
    let by = tz * ox - tx * oz;
    let bz = tx * oy - ty * ox;
    const bLen = Math.hypot(bx, by, bz) || 1;
    bx /= bLen;
    by /= bLen;
    bz /= bLen;

    const f = Math.min(controlPoints.length - 1.0001, t * (controlPoints.length - 1));
    const cIdx = Math.floor(f);
    const cFrac = f - cIdx;
    const cpA = controlPoints[cIdx];
    const cpB = controlPoints[cIdx + 1];
    const width = cpA.width * (1 - cFrac) + cpB.width * cFrac;
    const thick = cpA.thickness * (1 - cFrac) + cpB.thickness * cFrac;
    const bA = cFrac < 0.5 ? cpA.boneA : cpB.boneA;
    const bB = cFrac < 0.5 ? cpA.boneB : cpB.boneB;
    const wA = cFrac < 0.5 ? cpA.weightA : cpB.weightA;
    const tw = twistRad * t;
    const cosTw = Math.cos(tw);
    const sinTw = Math.sin(tw);
    const cr = colorRoot[0] * (1 - t) + colorTip[0] * t;
    const cg = colorRoot[1] * (1 - t) + colorTip[1] * t;
    const cb = colorRoot[2] * (1 - t) + colorTip[2] * t;

    ringStarts.push(prim.positions.length / 3);
    for (let k = 0; k <= profLen; k++) {
      const [pu, pv] = profileTemplate[k % profLen];
      const ru = (pu * cosTw - pv * sinTw) * width;
      const rv = (pu * sinTw + pv * cosTw) * thick;
      const vx = pt[0] + bx * ru + ox * rv;
      const vy = pt[1] + by * ru + oy * rv;
      const vz = pt[2] + bz * ru + oz * rv;
      appendVertex(
        prim,
        [vx, vy, vz],
        [ox, oy, oz],
        [k / profLen, t],
        [bA, bB, 0, 0],
        [wA, 1 - wA, 0, 0],
        'none',
        [cr, cg, cb, 1]
      );
    }
  }

  for (let s = 0; s < segments; s++) {
    const a0 = ringStarts[s];
    const b0 = ringStarts[s + 1];
    for (let k = 0; k < profLen; k++) {
      const i0 = a0 + k;
      const i1 = a0 + k + 1;
      const i2 = b0 + k;
      const i3 = b0 + k + 1;
      prim.indices.push(i0, i1, i2, i1, i3, i2);
    }
  }

  // Cap root and tip cleanly
  const firstRing = ringStarts[0];
  const lastRing = ringStarts[segments];
  const rootCp = controlPoints[0];
  const tipCp = controlPoints[controlPoints.length - 1];
  const rootCenter = appendVertex(
    prim,
    rootCp.pos,
    [0, 1, 0],
    [0.5, 0],
    [rootCp.boneA, rootCp.boneB, 0, 0],
    [rootCp.weightA, 1 - rootCp.weightA, 0, 0],
    'none',
    [colorRoot[0], colorRoot[1], colorRoot[2], 1]
  );
  const tipCenter = appendVertex(
    prim,
    tipCp.pos,
    [0, -1, 0],
    [0.5, 1],
    [tipCp.boneA, tipCp.boneB, 0, 0],
    [tipCp.weightA, 1 - tipCp.weightA, 0, 0],
    'none',
    [colorTip[0], colorTip[1], colorTip[2], 1]
  );
  for (let k = 0; k < profLen; k++) {
    prim.indices.push(rootCenter, firstRing + k + 1, firstRing + k);
    prim.indices.push(tipCenter, lastRing + k, lastRing + k + 1);
  }

  recomputeNormalsRange(prim, startVert, startIdx);
}

/** Smooth bone lookup helper type */
export type BoneLookup = (name: string) => number;
export type BoneList = BoneDef[];
