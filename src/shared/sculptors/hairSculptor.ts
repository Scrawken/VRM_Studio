import {
  BoneDef,
  PrimitiveBuild,
  QualitySegmentBudget,
} from '../anatomicalSculptor';
import { CharacterSpecification } from '../types';
import {
  BoneLookup,
  appendAnatomicalLoft,
  appendCurvedHairStrand,
  appendVertex,
  recomputeNormalsRange,
} from './meshOps';

/**
 * Multi-layered procedural hair system replacing helmet-like shell caps with
 * organic crown parting, multi-tier overlapping sculpted hair clumps, asymmetrical
 * swept bangs, S-curved cheek/jawline side locks, and style-specific back flow.
 */
export function sculptLayeredHairSystem(
  hairPrim: PrimitiveBuild,
  trimPrim: PrimitiveBuild,
  spec: CharacterSpecification,
  _bones: BoneDef[],
  B: BoneLookup,
  headCenter: [number, number, number],
  budget: QualitySegmentBudget
) {
  const headS = spec.proportions.headScale;
  const hScale = spec.proportions.heightMeters / 1.7;
  const isFem = spec.genderPresentation === 'feminine';

  // 1. Snug Cranial Under-Scalp Base (tucked gently inside outer locks so zero bald gaps appear)
  const capLat = 16;
  const capLon = 24;
  const cStart = hairPrim.positions.length / 3;
  const cIdx = hairPrim.indices.length;
  for (let i = 0; i <= capLat; i++) {
    const v = i / capLat;
    const phi = v * Math.PI * 0.66;
    for (let j = 0; j <= capLon; j++) {
      const u = j / capLon;
      const theta = u * Math.PI * 2 + Math.PI;
      const nx = Math.sin(phi) * Math.sin(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.cos(theta);
      const frontTuck = nz > -0.1 ? Math.max(0, 0.48 - ny) * (nz + 0.1) : 0;
      const rx = 0.086 * headS;
      const ry = 0.11 * headS;
      const rz = 0.097 * headS;
      const shade = 0.66 + 0.2 * v;
      appendVertex(
        hairPrim,
        [
          headCenter[0] + nx * rx,
          headCenter[1] + 0.008 * headS + ny * ry + frontTuck * 0.052 * headS,
          headCenter[2] - 0.006 * headS + nz * rz - frontTuck * 0.042 * headS,
        ],
        [nx, ny, nz],
        [u, v],
        [B('head'), 0, 0, 0],
        [1, 0, 0, 0],
        'none',
        [shade, shade, shade * 1.03, 1]
      );
    }
  }
  const cStride = capLon + 1;
  for (let i = 0; i < capLat; i++) {
    for (let j = 0; j < capLon; j++) {
      const a = cStart + i * cStride + j;
      const b = a + cStride;
      hairPrim.indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  recomputeNormalsRange(hairPrim, cStart, cIdx);

  // Crown parting origin (slightly off-center for organic natural silhouette)
  const partX = (spec.hairStyle === 'braided' ? 0.0 : 0.014) * headS;
  const crownY = headCenter[1] + 0.123 * headS;
  const crownZ = headCenter[2] + 0.002 * headS;

  const darkRoot: [number, number, number] = [0.64, 0.65, 0.7];
  const brightTip: [number, number, number] = [0.98, 0.99, 1.0];
  const innerShadeRoot: [number, number, number] = [0.54, 0.55, 0.62];
  const innerShadeTip: [number, number, number] = [0.84, 0.86, 0.92];

  // 2. Crown Top Overlapping Layer Clumps (replaces smooth sphere top silhouette with natural hair volume)
  const crownStrands = Math.max(10, Math.round(budget.hairStrands * 0.65));
  for (let c = 0; c < crownStrands; c++) {
    const ang = (c / crownStrands) * Math.PI * 2;
    const isFrontHalf = Math.cos(ang) > 0.2;
    if (isFrontHalf && spec.hairStyle !== 'short_crop') continue; // Forehead handled by parted bangs below
    const dirX = Math.sin(ang);
    const dirZ = Math.cos(ang);
    const rMid = 0.088 * headS;
    const rLow = 0.097 * headS;
    appendCurvedHairStrand(
      hairPrim,
      [
        { pos: [partX + dirX * 0.012 * headS, crownY, crownZ + dirZ * 0.012 * headS], width: 0.018 * headS, thickness: 0.0075 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
        { pos: [partX * 0.4 + dirX * rMid * 0.72, headCenter[1] + 0.096 * headS, headCenter[2] + dirZ * rMid * 0.78], width: 0.022 * headS, thickness: 0.009 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
        { pos: [dirX * rLow, headCenter[1] + 0.036 * headS, headCenter[2] + dirZ * rLow * 1.05], width: 0.018 * headS, thickness: 0.007 * headS, boneA: B('head'), boneB: B('hairBackRoot'), weightA: 0.85 },
      ],
      7,
      dirX * 0.1,
      darkRoot,
      brightTip
    );
  }

  // 3. Layered Parted Bangs & Delicate Forehead Wisps (Asymmetric & Tapered; zero flat bowl-cut curtain!)
  if (spec.hairStyle === 'short_crop') {
    // Layered textured men's/ranger crop with feathered diagonal sweeps & clean temple sideburns
    const tuftCount = 14;
    for (let b = 0; b < tuftCount; b++) {
      const frac = (b / (tuftCount - 1)) * 2 - 1;
      const stagger = ((b * 47) % 10) / 10;
      const layer = b % 2;
      const rootX = (frac * 0.058 - 0.01) * headS;
      const sweepDx = (0.022 + stagger * 0.014) * headS;
      const tipY =
        headCenter[1] +
        (0.072 - Math.abs(frac) * 0.028 + (layer === 0 ? 0.012 : -0.006)) * headS;
      const baseW = (0.0085 + stagger * 0.0025) * headS;
      appendCurvedHairStrand(
        hairPrim,
        [
          { pos: [rootX * 0.6, crownY - 0.002 * headS, crownZ + 0.008 * headS], width: baseW, thickness: 0.005 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
          { pos: [rootX + sweepDx * 0.48, headCenter[1] + (0.105 + layer * 0.003) * headS, headCenter[2] + (0.084 - Math.abs(frac) * 0.016) * headS], width: baseW * 0.85, thickness: 0.0044 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
          { pos: [rootX + sweepDx, tipY, headCenter[2] + (0.091 - Math.abs(frac) * 0.024) * headS], width: 0.0014 * headS, thickness: 0.0012 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
        ],
        7,
        0.24,
        darkRoot,
        brightTip
      );
    }
    for (const sign of [1, -1] as const) {
      appendCurvedHairStrand(
        hairPrim,
        [
          { pos: [sign * 0.077 * headS, headCenter[1] + 0.075 * headS, headCenter[2] + 0.025 * headS], width: 0.009 * headS, thickness: 0.0045 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
          { pos: [sign * 0.084 * headS, headCenter[1] + 0.012 * headS, headCenter[2] + 0.024 * headS], width: 0.0065 * headS, thickness: 0.0035 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
          { pos: [sign * 0.079 * headS, headCenter[1] - 0.028 * headS, headCenter[2] + 0.018 * headS], width: 0.0014 * headS, thickness: 0.0012 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
        ],
        6,
        0,
        darkRoot,
        brightTip
      );
    }
  } else {
    const bangCount = 12;
    for (let b = 0; b < bangCount; b++) {
      const frac = (b / (bangCount - 1)) * 2 - 1; // -1..+1
      const partDelta = frac - 0.16;
      const sweepSide = partDelta >= 0 ? 1 : -1;
      const absF = Math.abs(frac);
      const stagger = ((b * 43) % 10) / 10;

      // Center bangs curve gently aside so eyes & brows remain clearly readable
      const centerPush = Math.max(0, 0.35 - Math.abs(partDelta)) * sweepSide * 0.036;
      const rootX = partX + frac * 0.026 * headS;
      const browX = (frac * 0.068 + sweepSide * (0.013 + stagger * 0.007) + centerPush) * headS;
      const tipX = (frac * 0.088 + sweepSide * (0.022 + stagger * 0.01) + centerPush * 1.4) * headS;
      const tipY =
        spec.hairStyle === 'spiky'
          ? headCenter[1] + (0.056 - absF * 0.02) * headS
          : headCenter[1] + (0.036 - absF * 0.038 + (b % 2 === 0 ? 0.012 : -0.006)) * headS;
      const baseW = 0.0115 * (0.82 + stagger * 0.32) * headS;
      const liftZ = (b % 2 === 0 ? 0.0045 : 0.0) * headS;

      appendCurvedHairStrand(
        hairPrim,
        [
          { pos: [rootX, crownY, crownZ + 0.012 * headS], width: baseW * 1.05, thickness: 0.006 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
          { pos: [browX * 0.78, headCenter[1] + 0.102 * headS, headCenter[2] + (0.09 - absF * 0.014) * headS + liftZ], width: baseW * 0.92, thickness: 0.0052 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
          { pos: [browX, headCenter[1] + 0.068 * headS, headCenter[2] + (0.105 - absF * 0.022) * headS + liftZ], width: baseW * 0.68, thickness: 0.004 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
          { pos: [tipX, tipY, headCenter[2] + (0.098 - absF * 0.028) * headS + liftZ * 0.5], width: 0.0012 * headS, thickness: 0.001 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
        ],
        Math.max(8, budget.hairSegments),
        frac * 0.18,
        darkRoot,
        brightTip
      );
    }
  }

  // 4. Cheek & Shoulder Framing Side Locks (Natural S-curved layered locks tucking gently inward)
  if (spec.hairStyle !== 'short_crop') {
    for (const sign of [1, -1] as const) {
      const rootB = sign > 0 ? B('hairLeftRoot') : B('hairRightRoot');
      const tipB = sign > 0 ? B('hairLeftTip') : B('hairRightTip');
      const lockLen =
        spec.hairStyle === 'long_flowing' || spec.hairStyle === 'braided'
          ? 0.31 * hScale
          : 0.165 * hScale;

      for (const layer of [0, 1, 2, 3]) {
        const zOff = layer === 0 ? 0.056 : layer === 1 ? 0.036 : layer === 2 ? 0.014 : -0.01;
        const xSpread = layer === 0 ? 0.082 : layer === 1 ? 0.094 : layer === 2 ? 0.102 : 0.106;
        const subLen = lockLen * (layer === 0 ? 0.5 : layer === 1 ? 0.72 : layer === 2 ? 1.0 : 0.94);
        const w = (layer === 0 ? 0.0095 : 0.0135) * headS;
        appendCurvedHairStrand(
          hairPrim,
          [
            { pos: [sign * xSpread * 0.72 * headS, headCenter[1] + 0.098 * headS, headCenter[2] + zOff * 0.5 * headS], width: w, thickness: w * 0.55, boneA: B('head'), boneB: rootB, weightA: 0.78 },
            { pos: [sign * (xSpread + 0.008) * headS, headCenter[1] + 0.006 * headS, headCenter[2] + zOff * headS], width: w * 0.95, thickness: w * 0.52, boneA: rootB, boneB: tipB, weightA: 0.65 },
            { pos: [sign * (xSpread + 0.016) * headS, headCenter[1] - subLen * 0.54, headCenter[2] + (zOff + 0.014) * headS], width: w * 0.68, thickness: w * 0.38, boneA: tipB, boneB: rootB, weightA: 0.75 },
            { pos: [sign * (xSpread + 0.002) * headS, headCenter[1] - subLen, headCenter[2] + (zOff + 0.018) * headS], width: 0.0014 * headS, thickness: 0.0011 * headS, boneA: tipB, boneB: rootB, weightA: 0.9 },
          ],
          budget.hairSegments,
          sign * (0.2 + layer * 0.06),
          layer === 0 ? brightTip : darkRoot,
          brightTip
        );
      }
    }
  }

  // 5. Style-Specific Back Layered Clumps & Flow
  if (spec.hairStyle === 'long_flowing') {
    const numStrands = budget.hairStrands;
    // Inner shadowed drape layer + outer sweeping sculpted wave layer
    for (let s = 0; s < numStrands; s++) {
      const tier = s % 3; // 0 = inner drape, 1 = mid body, 2 = outer highlight locks
      const frac = (s / (numStrands - 1)) * 2 - 1;
      const arcAngle = frac * 1.48;
      const xRoot = Math.sin(arcAngle) * (0.086 + tier * 0.004) * headS;
      const zRoot = -Math.cos(arcAngle) * (0.086 + tier * 0.005) * headS;
      const waveA = 0.014 * (tier === 1 ? 1 : tier === 2 ? -1 : 0.4);
      const waveB = -0.012 * (tier === 1 ? 1 : tier === 2 ? -1 : 0.3);
      const len = (0.54 + (1 - Math.abs(frac) * 0.2) * 0.15 - tier * 0.035) * hScale;
      const rFlare = 0.96 + tier * 0.14;
      const wScale = tier === 0 ? 1.15 : tier === 1 ? 0.98 : 0.78;

      appendCurvedHairStrand(
        hairPrim,
        [
          { pos: [xRoot, headCenter[1] + 0.09 * headS, headCenter[2] + zRoot], width: 0.022 * wScale * headS, thickness: 0.01 * headS, boneA: B('head'), boneB: B('hairBackRoot'), weightA: 0.76 },
          { pos: [xRoot * 1.2 * rFlare + waveA, headCenter[1] - len * 0.28, headCenter[2] + zRoot * 1.28 * rFlare - 0.02], width: 0.02 * wScale * headS, thickness: 0.0095 * headS, boneA: B('hairBackRoot'), boneB: B('hairBackMid'), weightA: 0.65 },
          { pos: [xRoot * 1.38 * rFlare + waveB, headCenter[1] - len * 0.65, headCenter[2] + zRoot * 1.46 * rFlare - 0.034], width: 0.015 * wScale * headS, thickness: 0.0075 * headS, boneA: B('hairBackMid'), boneB: B('hairBackTip'), weightA: 0.55 },
          { pos: [xRoot * 1.46 * rFlare + waveA * 0.6, headCenter[1] - len, headCenter[2] + zRoot * 1.56 * rFlare - 0.04], width: 0.002 * headS, thickness: 0.0016 * headS, boneA: B('hairBackTip'), boneB: B('hairBackMid'), weightA: 0.85 },
        ],
        budget.hairSegments,
        frac * 0.25 + (tier - 1) * 0.12,
        tier === 0 ? innerShadeRoot : darkRoot,
        tier === 0 ? innerShadeTip : brightTip
      );
    }
  } else if (spec.hairStyle === 'ponytail') {
    const tieY = headCenter[1] + 0.035 * headS;
    const tieZ = headCenter[2] - 0.106 * headS;
    appendAnatomicalLoft(
      trimPrim,
      [
        { center: [0, tieY - 0.008, tieZ], rx: 0.023 * headS, rz: 0.021 * headS, boneA: B('head'), boneB: B('hairBackRoot'), weightA: 0.8 },
        { center: [0, tieY + 0.008, tieZ], rx: 0.023 * headS, rz: 0.021 * headS, boneA: B('head'), boneB: B('hairBackRoot'), weightA: 0.8 },
      ],
      12,
      true
    );
    const ponyStrands = Math.max(12, Math.round(budget.hairStrands * 0.75));
    for (let s = 0; s < ponyStrands; s++) {
      const ang = (s / ponyStrands) * Math.PI * 2;
      const ox = Math.cos(ang) * 0.017 * headS;
      const oz = Math.sin(ang) * 0.015 * headS;
      appendCurvedHairStrand(
        hairPrim,
        [
          { pos: [ox * 0.6, tieY, tieZ], width: 0.013 * headS, thickness: 0.008 * headS, boneA: B('head'), boneB: B('hairBackRoot'), weightA: 0.6 },
          { pos: [ox * 1.8, tieY - 0.06 * hScale, tieZ - 0.088], width: 0.017 * headS, thickness: 0.01 * headS, boneA: B('hairBackRoot'), boneB: B('hairBackMid'), weightA: 0.6 },
          { pos: [ox * 2.2, tieY - 0.26 * hScale, tieZ - 0.118], width: 0.014 * headS, thickness: 0.007 * headS, boneA: B('hairBackMid'), boneB: B('hairBackTip'), weightA: 0.5 },
          { pos: [ox * 1.5, tieY - 0.5 * hScale, tieZ - 0.095], width: 0.0018 * headS, thickness: 0.0014 * headS, boneA: B('hairBackTip'), boneB: B('hairBackMid'), weightA: 0.85 },
        ],
        budget.hairSegments,
        0,
        darkRoot,
        brightTip
      );
    }
  } else if (spec.hairStyle === 'braided') {
    const tieY = headCenter[1] - 0.012 * headS;
    const tieZ = headCenter[2] - 0.102 * headS;
    // Authentic 3-strand woven braid down back + loose tapered tail
    for (const phase of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
      const pts: Parameters<typeof appendCurvedHairStrand>[1] = [];
      const steps = 13;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const wv = Math.sin(t * Math.PI * 5.5 + phase) * 0.014 * (1 - t * 0.45);
        const wd = Math.cos(t * Math.PI * 5.5 + phase) * 0.008 * (1 - t * 0.45);
        const w = (0.015 - t * 0.0125) * headS;
        const bA = t < 0.35 ? B('hairBackRoot') : t < 0.7 ? B('hairBackMid') : B('hairBackTip');
        pts.push({
          pos: [wv, tieY - t * 0.5 * hScale, tieZ - 0.02 - t * 0.055 + wd],
          width: w,
          thickness: w * 0.72,
          boneA: bA,
          boneB: B('head'),
          weightA: 0.86,
        });
      }
      appendCurvedHairStrand(hairPrim, pts, 15, phase > 2 ? -1.4 : 1.4, darkRoot, brightTip);
    }
    appendAnatomicalLoft(
      trimPrim,
      [
        { center: [0, tieY - 0.018, tieZ - 0.022], rx: 0.022 * headS, rz: 0.016 * headS, boneA: B('hairBackRoot'), boneB: B('head'), weightA: 0.7 },
        { center: [0, tieY + 0.006, tieZ - 0.02], rx: 0.024 * headS, rz: 0.018 * headS, boneA: B('hairBackRoot'), boneB: B('head'), weightA: 0.7 },
      ],
      12,
      true
    );
  } else if (spec.hairStyle === 'bob') {
    const numStrands = Math.max(14, Math.round(budget.hairStrands * 0.9));
    for (let s = 0; s < numStrands; s++) {
      const frac = (s / (numStrands - 1)) * 2 - 1;
      const arcAngle = frac * 1.48;
      const xRoot = Math.sin(arcAngle) * 0.088 * headS;
      const zRoot = -Math.cos(arcAngle) * 0.088 * headS;
      appendCurvedHairStrand(
        hairPrim,
        [
          { pos: [xRoot, headCenter[1] + 0.092 * headS, headCenter[2] + zRoot], width: 0.02 * headS, thickness: 0.01 * headS, boneA: B('head'), boneB: B('hairBackRoot'), weightA: 0.8 },
          { pos: [xRoot * 1.24, headCenter[1] - 0.025 * hScale, headCenter[2] + zRoot * 1.26], width: 0.019 * headS, thickness: 0.009 * headS, boneA: B('hairBackRoot'), boneB: B('head'), weightA: 0.6 },
          { pos: [xRoot * 1.0, headCenter[1] - 0.145 * hScale, headCenter[2] + zRoot * 1.0], width: 0.004 * headS, thickness: 0.0025 * headS, boneA: B('hairBackRoot'), boneB: B('head'), weightA: 0.65 },
        ],
        Math.max(7, Math.round(budget.hairSegments * 0.75)),
        frac * 0.12,
        darkRoot,
        brightTip
      );
    }
  } else if (spec.hairStyle === 'spiky') {
    const tuftCount = 18;
    for (let s = 0; s < tuftCount; s++) {
      const ang = (s / tuftCount) * Math.PI * 2;
      const r0 = 0.068 * headS;
      const r1 = (0.148 + (s % 3) * 0.014) * headS;
      const yBase = headCenter[1] + 0.064 * headS;
      appendCurvedHairStrand(
        hairPrim,
        [
          { pos: [Math.sin(ang) * r0, yBase, headCenter[2] + Math.cos(ang) * r0], width: 0.018 * headS, thickness: 0.01 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
          { pos: [Math.sin(ang) * r1, yBase + 0.048 * headS, headCenter[2] + Math.cos(ang) * r1], width: 0.0022 * headS, thickness: 0.0018 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
        ],
        6,
        0,
        darkRoot,
        brightTip
      );
    }
  } else {
    // short_crop: tailored layered masculine/ranger cut with textured top sweeps, temple tapers & feathered nape
    const topStrands = 14;
    for (let s = 0; s < topStrands; s++) {
      const frac = (s / (topStrands - 1)) * 2 - 1;
      const xOff = frac * 0.064 * headS;
      const yCrown = headCenter[1] + (0.115 - Math.abs(frac) * 0.024) * headS;
      const sweep = isFem ? 0.008 : 0.012;
      appendCurvedHairStrand(
        hairPrim,
        [
          { pos: [xOff * 0.72, yCrown - 0.02 * headS, headCenter[2] - 0.088 * headS], width: 0.017 * headS, thickness: 0.0068 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
          { pos: [xOff + sweep * headS, yCrown, headCenter[2] + 0.008 * headS], width: 0.016 * headS, thickness: 0.0068 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
          { pos: [xOff + sweep * 1.4 * headS, yCrown - 0.036 * headS, headCenter[2] + (0.088 - Math.abs(frac) * 0.018) * headS], width: 0.0038 * headS, thickness: 0.0024 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
        ],
        7,
        frac * 0.14,
        darkRoot,
        brightTip
      );
    }
    const backStrands = 12;
    for (let s = 0; s < backStrands; s++) {
      const frac = (s / (backStrands - 1)) * 2 - 1;
      const arcAngle = frac * 1.32;
      const xRoot = Math.sin(arcAngle) * 0.087 * headS;
      const zRoot = -Math.cos(arcAngle) * 0.091 * headS;
      appendCurvedHairStrand(
        hairPrim,
        [
          { pos: [xRoot * 0.9, headCenter[1] + 0.078 * headS, headCenter[2] + zRoot * 0.9], width: 0.019 * headS, thickness: 0.008 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
          { pos: [xRoot * 1.02, headCenter[1] + 0.006 * headS, headCenter[2] + zRoot * 1.05], width: 0.015 * headS, thickness: 0.006 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
          { pos: [xRoot * 0.82, headCenter[1] - 0.064 * headS, headCenter[2] + zRoot * 0.86], width: 0.0035 * headS, thickness: 0.002 * headS, boneA: B('head'), boneB: B('neck'), weightA: 0.8 },
        ],
        6,
        0,
        innerShadeRoot,
        brightTip
      );
    }
  }
}
