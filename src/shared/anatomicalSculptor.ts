import { CharacterSpecification, GeometryQuality, QualityConfig } from './types';
import {
  appendAnatomicalLoft,
  appendCurvedHairStrand,
  createPrimitive,
} from './sculptors/meshOps';
import { sculptAnatomicalHeadAndFace } from './sculptors/faceSculptor';
import { sculptLayeredHairSystem } from './sculptors/hairSculptor';
import { sculptLayeredClothingAndArmor } from './sculptors/armorGarmentSculptor';

export {
  appendAnatomicalLoft,
  appendCurvedArmorPlate,
  appendCurvedHairStrand,
  appendThickenedShellLoft,
  appendVertex,
  createPrimitive,
  evalCatmullRom,
  recomputeNormalsRange,
} from './sculptors/meshOps';
export type { AnatomicalRing, HairControlPoint } from './sculptors/meshOps';

export interface BoneDef {
  name: string;
  vrmName?: string;
  parent: number;
  localPos: [number, number, number];
  worldPos: [number, number, number];
}

export type FaceRegionTag =
  | 'none'
  | 'eyelid_upper_l'
  | 'eyelid_lower_l'
  | 'eyelid_upper_r'
  | 'eyelid_lower_r'
  | 'brow_inner_l'
  | 'brow_outer_l'
  | 'brow_inner_r'
  | 'brow_outer_r'
  | 'lip_upper'
  | 'lip_lower'
  | 'mouth_corner_l'
  | 'mouth_corner_r'
  | 'jaw_chin'
  | 'cheek_l'
  | 'cheek_r'
  | 'iris_l'
  | 'iris_r';

export interface PrimitiveBuild {
  name: string;
  materialIndex: number;
  positions: number[];
  normals: number[];
  uvs: number[];
  colors?: number[];
  faceLocal?: number[];
  joints: number[];
  weights: number[];
  indices: number[];
  hasMorphTargets?: boolean;
  isFacialOrHair?: boolean;
  faceTags?: Array<{ region: FaceRegionTag }>;
}

export interface QualitySegmentBudget {
  headLat: number;
  headLon: number;
  torsoRadial: number;
  torsoRings: number;
  limbRadial: number;
  fingerRadial: number;
  hairStrands: number;
  hairSegments: number;
  cloakCols: number;
  cloakRows: number;
}

export function getQualityBudget(quality: GeometryQuality): QualitySegmentBudget {
  switch (quality) {
    case 'performance':
      return {
        headLat: 24,
        headLon: 32,
        torsoRadial: 20,
        torsoRings: 14,
        limbRadial: 12,
        fingerRadial: 6,
        hairStrands: 9,
        hairSegments: 6,
        cloakCols: 12,
        cloakRows: 7,
      };
    case 'standard':
      return {
        headLat: 36,
        headLon: 48,
        torsoRadial: 30,
        torsoRings: 20,
        limbRadial: 18,
        fingerRadial: 8,
        hairStrands: 14,
        hairSegments: 10,
        cloakCols: 18,
        cloakRows: 10,
      };
    case 'high':
      return {
        headLat: 48,
        headLon: 64,
        torsoRadial: 38,
        torsoRings: 26,
        limbRadial: 22,
        fingerRadial: 10,
        hairStrands: 21,
        hairSegments: 12,
        cloakCols: 24,
        cloakRows: 13,
      };
    case 'ultra':
      return {
        headLat: 70,
        headLon: 90,
        torsoRadial: 54,
        torsoRings: 38,
        limbRadial: 32,
        fingerRadial: 12,
        hairStrands: 33,
        hairSegments: 17,
        cloakCols: 34,
        cloakRows: 19,
      };
  }
}

export function getOptimizedBudget(config: QualityConfig): QualitySegmentBudget {
  const base = getQualityBudget(config.geometryQuality);
  if (config.vrmOptimization === 'unoptimized') {
    return base;
  }

  let bodyRet = 1.0;
  let faceRet = 1.0;
  let hairRet = 1.0;

  if (config.vrmOptimization === 'balanced') {
    bodyRet = 0.74;
    faceRet = 1.0;
    hairRet = 1.0;
  } else if (config.vrmOptimization === 'optimized') {
    bodyRet = 0.54;
    faceRet = 0.9;
    hairRet = 0.76;
  } else {
    const r = Math.max(0.35, Math.min(1.0, config.customOptimization.geometryRetention));
    bodyRet = r;
    faceRet = config.customOptimization.preserveFacialDetail ? 1.0 : Math.max(0.55, r);
    hairRet = config.customOptimization.preserveHairDetail ? 1.0 : Math.max(0.5, r);
  }

  const scale = (val: number, factor: number, minVal: number) =>
    Math.max(minVal, Math.round(val * factor));

  return {
    headLat: scale(base.headLat, faceRet, 22),
    headLon: scale(base.headLon, faceRet, 28),
    torsoRadial: scale(base.torsoRadial, bodyRet, 14),
    torsoRings: scale(base.torsoRings, bodyRet, 10),
    limbRadial: scale(base.limbRadial, bodyRet, 10),
    fingerRadial: scale(base.fingerRadial, bodyRet, 5),
    hairStrands: scale(base.hairStrands, hairRet, 8),
    hairSegments: scale(base.hairSegments, hairRet, 6),
    cloakCols: scale(base.cloakCols, bodyRet, 10),
    cloakRows: scale(base.cloakRows, bodyRet, 6),
  };
}

/**
 * Generates high-detail sculpted cranio-facial anatomy, layered volumetric hair,
 * anatomical musculature, sculpted palms with naturally curled fingers,
 * thickened layered garments/armor plates, and optional fantasy appendages.
 */
export function buildHighDetailCharacterGeometry(
  spec: CharacterSpecification,
  bones: BoneDef[],
  budgetOverride?: QualitySegmentBudget
): PrimitiveBuild[] {
  const boneMap = new Map<string, number>();
  bones.forEach((b, i) => boneMap.set(b.name, i));
  const B = (name: string) => boneMap.get(name) ?? 0;

  const budget = budgetOverride ?? getQualityBudget(spec.qualityConfig.geometryQuality);

  // Single-primitive meshes mapped 1:1 to glTF nodes for VRMExpressionLoaderPlugin compatibility
  const skinPrim = createPrimitive('FaceAndBodyMesh', 0, true, true, true, true);
  const eyePrim = createPrimitive('EyesMesh', 1, true, true, false, false);
  const hairPrim = createPrimitive('HairMesh', 2, false, true, true, false);
  const outfitPrim = createPrimitive('ArmorAndOutfitMesh', 3, false, false, true, false);
  const trimPrim = createPrimitive('MetallicTrimMesh', 4, false, false, false, false);
  const cloakPrim = createPrimitive('CloakAndFabricMesh', 5, false, false, true, false);
  const secondaryPrim = createPrimitive('SecondaryAccentMesh', 6, false, false, true, false);

  const buildFactor =
    spec.build === 'slender'
      ? 0.89
      : spec.build === 'athletic'
        ? 0.99
        : spec.build === 'muscular'
          ? 1.15
          : spec.build === 'heavy'
            ? 1.24
            : 1.0;

  const isFem = spec.genderPresentation === 'feminine';
  const hScale = spec.proportions.heightMeters / 1.7;
  const sW = spec.proportions.shoulderWidthScale;
  const hW = spec.proportions.hipWidthScale;

  const hipsPos = bones[B('hips')].worldPos;
  const uChestPos = bones[B('upperChest')].worldPos;

  // 1. Cranium, Facial Anatomy, 3D Folded Eyelids, Nose/Lips/Mouth Cavity & Neck Blend
  const headCenter = sculptAnatomicalHeadAndFace(
    skinPrim,
    eyePrim,
    hairPrim,
    trimPrim,
    spec,
    bones,
    B,
    budget
  );

  // 2. Layered Parted Hair System
  sculptLayeredHairSystem(hairPrim, trimPrim, spec, bones, B, headCenter, budget);

  // 3. Layered Clothing, Thickened Armor Plates, Tassets, Pauldrons, Boots & Cloak
  const waistRx = (isFem ? 0.098 : 0.118) * buildFactor;
  const chestRx = (isFem ? 0.132 : 0.154) * buildFactor * sW;
  const hipRx = (isFem ? 0.146 : 0.132) * buildFactor * hW;
  const bustBoost = isFem ? 0.032 * buildFactor : 0.014 * buildFactor;
  const beltY = hipsPos[1] + 0.055 * hScale;

  sculptLayeredClothingAndArmor(
    outfitPrim,
    secondaryPrim,
    trimPrim,
    cloakPrim,
    spec,
    bones,
    B,
    budget,
    { waistRx, chestRx, hipRx, bustBoost, beltY, buildFactor }
  );

  // 4. Sculpted Anatomical Arms, Deltoids, Elbows, Wrists, Contoured Palms & Relaxed-Curl Fingers
  const buildArmAndHand = (side: 'left' | 'right', sign: 1 | -1) => {
    const sh = bones[B(`${side}Shoulder`)].worldPos;
    const ua = bones[B(`${side}UpperArm`)].worldPos;
    const la = bones[B(`${side}LowerArm`)].worldPos;
    const hd = bones[B(`${side}Hand`)].worldPos;

    const armPrim =
      spec.features.hasArmor || spec.outfitStyle !== 'casual_modern' ? outfitPrim : skinPrim;
    const armLen = Math.abs(hd[0] - ua[0]);
    const bicepX = ua[0] + sign * armLen * 0.27;
    const forearmBulgeX = la[0] + sign * armLen * 0.18;

    // Arm musculature: sculpted deltoid cap -> bicep/tricep swell -> elbow olecranon -> brachioradialis -> slender wrist
    appendAnatomicalLoft(
      armPrim,
      [
        {
          center: [sh[0] - sign * 0.018, sh[1] - 0.005, 0],
          rx: 0.064 * buildFactor,
          rz: 0.062 * buildFactor,
          boneA: B('upperChest'),
          boneB: B(`${side}Shoulder`),
          weightA: 0.6,
          axis: 'x',
        },
        {
          center: [ua[0], ua[1] + 0.003, 0],
          rx: 0.053 * buildFactor,
          rz: 0.051 * buildFactor,
          boneA: B(`${side}Shoulder`),
          boneB: B(`${side}UpperArm`),
          weightA: 0.35,
          axis: 'x',
          contourFn: (cosT) => ({ scaleR: cosT > 0 ? 1.07 : 0.96 }), // Deltoid cap
        },
        {
          center: [bicepX, ua[1] - 0.003, 0.002],
          rx: 0.044 * buildFactor,
          rz: 0.047 * buildFactor,
          boneA: B(`${side}UpperArm`),
          boneB: B(`${side}LowerArm`),
          weightA: 0.9,
          axis: 'x',
          contourFn: (cosT, sinT) => ({
            dz: sinT > 0 ? 0.004 * buildFactor * sinT : 0, // Subtle anterior bicep
            dy: cosT < 0 ? -0.002 * buildFactor : 0,
          }),
        },
        {
          center: [la[0] - sign * 0.014, la[1], -0.002],
          rx: 0.036 * buildFactor,
          rz: 0.037 * buildFactor,
          boneA: B(`${side}UpperArm`),
          boneB: B(`${side}LowerArm`),
          weightA: 0.65,
          axis: 'x',
          contourFn: (_c, sinT) => ({ dz: sinT < 0 ? 0.0045 * sinT : 0 }), // Elbow olecranon tip
        },
        {
          center: [la[0] + sign * 0.014, la[1], 0],
          rx: 0.037 * buildFactor,
          rz: 0.037 * buildFactor,
          boneA: B(`${side}UpperArm`),
          boneB: B(`${side}LowerArm`),
          weightA: 0.32,
          axis: 'x',
        },
        {
          center: [forearmBulgeX, la[1], 0.003],
          rx: 0.039 * buildFactor,
          rz: 0.037 * buildFactor,
          boneA: B(`${side}LowerArm`),
          boneB: B(`${side}Hand`),
          weightA: 0.92,
          axis: 'x',
        },
        {
          center: [hd[0] - sign * 0.018, hd[1], 0],
          rx: 0.025 * buildFactor,
          rz: 0.021 * buildFactor,
          boneA: B(`${side}LowerArm`),
          boneB: B(`${side}Hand`),
          weightA: 0.55,
          axis: 'x',
        },
        {
          center: [hd[0], hd[1], 0],
          rx: 0.024 * buildFactor,
          rz: 0.02 * buildFactor,
          boneA: B(`${side}LowerArm`),
          boneB: B(`${side}Hand`),
          weightA: 0.25,
          axis: 'x',
        },
      ],
      budget.limbRadial
    );

    // Sculpted Anatomical Palm with Thenar Thumb Mount, Metacarpal Arch & Knuckles
    const handPrim = spec.features.hasArmor ? outfitPrim : skinPrim;
    appendAnatomicalLoft(
      handPrim,
      [
        {
          center: [hd[0] - sign * 0.004, hd[1], 0],
          rx: 0.016,
          rz: 0.023,
          boneA: B(`${side}LowerArm`),
          boneB: B(`${side}Hand`),
          weightA: 0.2,
          axis: 'x',
        },
        {
          center: [hd[0] + sign * 0.024, hd[1] - 0.003, 0.004],
          rx: 0.0155,
          rz: 0.034,
          boneA: B(`${side}Hand`),
          boneB: B(`${side}Hand`),
          weightA: 1.0,
          axis: 'x',
          // Thenar muscle swell on thumb (+Z) side and arched back of hand
          contourFn: (cosT, sinT) => ({
            dy: sinT > 0.35 ? -0.004 * sinT : cosT > 0 ? 0.002 : 0,
            dz: sinT > 0.5 ? 0.004 : 0,
          }),
        },
        {
          center: [hd[0] + sign * 0.06, hd[1] - 0.006, 0.001],
          rx: 0.0115,
          rz: 0.034,
          boneA: B(`${side}Hand`),
          boneB: B(`${side}Hand`),
          weightA: 1.0,
          axis: 'x',
          contourFn: (cosT, sinT) => ({
            dy: cosT > 0 ? 0.002 * Math.cos(sinT * 2.2) : 0,
          }),
        },
      ],
      14,
      true
    );

    // 5 Articulated Tapered Fingers with Relaxed Natural Anatomical Curl
    const fingerKeys = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
    for (const fk of fingerKeys) {
      const b1 = fk === 'Thumb' ? B(`${side}ThumbMetacarpal`) : B(`${side}${fk}Proximal`);
      const b2 = fk === 'Thumb' ? B(`${side}ThumbProximal`) : B(`${side}${fk}Intermediate`);
      const b3 = fk === 'Thumb' ? B(`${side}ThumbDistal`) : B(`${side}${fk}Distal`);
      const p1 = bones[b1].worldPos;
      const p2 = bones[b2].worldPos;
      const p3 = bones[b3].worldPos;
      const rScale = fk === 'Thumb' ? 1.15 : fk === 'Little' ? 0.82 : 0.96;
      const isThumb = fk === 'Thumb';
      const curlDrop2 = isThumb ? -0.004 : -0.004;
      const curlDrop3 = isThumb ? -0.011 : -0.013;
      const curlZ2 = isThumb ? 0.004 : 0.0015;
      const curlZ3 = isThumb ? 0.007 : 0.0025;
      const tip: [number, number, number] = [
        p3[0] + sign * (isThumb ? 0.011 : 0.012),
        p3[1] + curlDrop3 - 0.009,
        p3[2] + curlZ3,
      ];
      appendAnatomicalLoft(
        handPrim,
        [
          {
            center: p1,
            rx: 0.0085 * rScale,
            rz: 0.0086 * rScale,
            boneA: B(`${side}Hand`),
            boneB: b1,
            weightA: 0.4,
            axis: 'x',
          },
          {
            center: [p2[0] - sign * 0.002, p2[1] + curlDrop2, p2[2] + curlZ2],
            rx: 0.0076 * rScale,
            rz: 0.0078 * rScale,
            boneA: b1,
            boneB: b2,
            weightA: 0.5,
            axis: 'x',
          },
          {
            center: [p3[0] - sign * 0.004, p3[1] + curlDrop3, p3[2] + curlZ3],
            rx: 0.0064 * rScale,
            rz: 0.0066 * rScale,
            boneA: b2,
            boneB: b3,
            weightA: 0.5,
            axis: 'x',
          },
          {
            center: tip,
            rx: 0.0036 * rScale,
            rz: 0.004 * rScale,
            boneA: b3,
            boneB: b3,
            weightA: 1.0,
            axis: 'x',
          },
        ],
        budget.fingerRadial,
        true
      );
    }
  };
  buildArmAndHand('left', 1);
  buildArmAndHand('right', -1);

  // 5. Sculpted Thighs, Quadriceps, Patella Kneecap, Gastrocnemius Calves & Ankles
  const buildLegAnatomy = (side: 'left' | 'right') => {
    const ul = bones[B(`${side}UpperLeg`)].worldPos;
    const ll = bones[B(`${side}LowerLeg`)].worldPos;
    const ft = bones[B(`${side}Foot`)].worldPos;

    const thighMidY = ul[1] * 0.52 + ll[1] * 0.48;
    const calfMaxY = ll[1] * 0.68 + ft[1] * 0.32;

    appendAnatomicalLoft(
      outfitPrim,
      [
        {
          center: [ul[0], ul[1] + 0.025, 0],
          rx: 0.086 * buildFactor,
          rz: 0.09 * buildFactor,
          boneA: B('hips'),
          boneB: B(`${side}UpperLeg`),
          weightA: 0.55,
        },
        {
          center: [ul[0], thighMidY, 0.009],
          rx: 0.068 * buildFactor,
          rz: 0.075 * buildFactor,
          boneA: B(`${side}UpperLeg`),
          boneB: B(`${side}LowerLeg`),
          weightA: 0.92,
          contourFn: (_c, sinT) => ({ dz: sinT > 0 ? 0.005 * buildFactor * sinT : 0 }), // Quadriceps curve
        },
        {
          center: [ll[0], ll[1] + 0.02, 0.013],
          rx: 0.052 * buildFactor,
          rz: 0.056 * buildFactor,
          boneA: B(`${side}UpperLeg`),
          boneB: B(`${side}LowerLeg`),
          weightA: 0.62,
          contourFn: (cosT, sinT) => ({
            dz: sinT > 0.5 && Math.abs(cosT) < 0.6 ? 0.005 * buildFactor : 0, // Patella kneecap
          }),
        },
        {
          center: [ll[0], ll[1] - 0.018, 0.006],
          rx: 0.05 * buildFactor,
          rz: 0.053 * buildFactor,
          boneA: B(`${side}UpperLeg`),
          boneB: B(`${side}LowerLeg`),
          weightA: 0.35,
        },
        {
          center: [ll[0], calfMaxY, -0.012],
          rx: 0.054 * buildFactor,
          rz: 0.063 * buildFactor,
          boneA: B(`${side}LowerLeg`),
          boneB: B(`${side}Foot`),
          weightA: 0.9,
          contourFn: (_c, s) => ({ dz: s < 0 ? -0.012 * buildFactor : 0 }), // Gastrocnemius calf belly
        },
        {
          center: [ft[0], ft[1] + 0.03, -0.005],
          rx: 0.038 * buildFactor,
          rz: 0.042 * buildFactor,
          boneA: B(`${side}LowerLeg`),
          boneB: B(`${side}Foot`),
          weightA: 0.5,
        },
        {
          center: [ft[0], ft[1], -0.005],
          rx: 0.041 * buildFactor,
          rz: 0.046 * buildFactor,
          boneA: B(`${side}LowerLeg`),
          boneB: B(`${side}Foot`),
          weightA: 0.25,
        },
      ],
      budget.limbRadial
    );
  };
  buildLegAnatomy('left');
  buildLegAnatomy('right');

  // 6. Optional Fantasy Features (STRICTLY gated by spec.features flags)
  if (spec.features.hasHorns) {
    for (const sign of [1, -1] as const) {
      const headS = spec.proportions.headScale;
      appendAnatomicalLoft(
        trimPrim,
        [
          { center: [sign * 0.052 * headS, headCenter[1] + 0.088 * headS, headCenter[2] + 0.025], rx: 0.02 * headS, rz: 0.02 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
          { center: [sign * 0.086 * headS, headCenter[1] + 0.145 * headS, headCenter[2] + 0.005], rx: 0.015 * headS, rz: 0.015 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
          { center: [sign * 0.106 * headS, headCenter[1] + 0.2 * headS, headCenter[2] - 0.028], rx: 0.01 * headS, rz: 0.01 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
          { center: [sign * 0.095 * headS, headCenter[1] + 0.245 * headS, headCenter[2] - 0.055], rx: 0.003 * headS, rz: 0.003 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
        ],
        10,
        true
      );
    }
  }

  if (spec.features.hasWings) {
    for (const sign of [1, -1] as const) {
      const rootX = sign * 0.065;
      const rootY = uChestPos[1] + 0.025;
      const rootZ = -0.095;
      const wristX = sign * 0.34;
      const wristY = rootY + 0.24;
      const wristZ = rootZ - 0.14;
      const tipX = sign * 0.64;
      const tipY = rootY + 0.14;
      const tipZ = rootZ - 0.21;

      appendCurvedHairStrand(
        trimPrim,
        [
          { pos: [rootX, rootY, rootZ], width: 0.016, thickness: 0.014, boneA: B('upperChest'), boneB: B('chest'), weightA: 0.85 },
          { pos: [wristX, wristY, wristZ], width: 0.014, thickness: 0.012, boneA: B('upperChest'), boneB: B('chest'), weightA: 0.85 },
          { pos: [tipX, tipY, tipZ], width: 0.006, thickness: 0.005, boneA: B('upperChest'), boneB: B('chest'), weightA: 0.85 },
        ],
        10
      );

      const wingLight: [number, number, number] = [0.96, 0.95, 0.98];
      const wingTipShade: [number, number, number] = [0.82, 0.8, 0.86];
      for (let f = 0; f < 8; f++) {
        const ft = f / 7;
        const sx = sign * (0.11 + ft * 0.5);
        const sy = rootY + 0.12 + Math.sin(ft * Math.PI * 0.85) * 0.11;
        const sz = rootZ - 0.08 - ft * 0.12;
        const outReach = 0.08 + ft * 0.26;
        const dropLen = 0.24 + (1 - Math.abs(ft - 0.45)) * 0.26;
        appendCurvedHairStrand(
          cloakPrim,
          [
            { pos: [sx, sy, sz], width: 0.032, thickness: 0.007, boneA: B('upperChest'), boneB: B('chest'), weightA: 0.85 },
            { pos: [sx + sign * outReach * 0.6, sy - dropLen * 0.48, sz - 0.035], width: 0.028, thickness: 0.005, boneA: B('upperChest'), boneB: B('chest'), weightA: 0.85 },
            { pos: [sx + sign * outReach, sy - dropLen, sz - 0.055], width: 0.005, thickness: 0.002, boneA: B('upperChest'), boneB: B('chest'), weightA: 0.85 },
          ],
          8,
          sign * 0.18,
          wingLight,
          wingTipShade
        );
      }

      for (let f = 0; f < 6; f++) {
        const ft = f / 5;
        const sx = sign * (0.1 + ft * 0.36);
        const sy = rootY + 0.11 + Math.sin(ft * Math.PI * 0.9) * 0.1;
        const sz = rootZ - 0.065 - ft * 0.095;
        appendCurvedHairStrand(
          cloakPrim,
          [
            { pos: [sx, sy, sz], width: 0.034, thickness: 0.008, boneA: B('upperChest'), boneB: B('chest'), weightA: 0.85 },
            { pos: [sx + sign * (0.04 + ft * 0.12), sy - 0.14 - ft * 0.04, sz - 0.02], width: 0.026, thickness: 0.005, boneA: B('upperChest'), boneB: B('chest'), weightA: 0.85 },
            { pos: [sx + sign * (0.07 + ft * 0.16), sy - 0.24 - ft * 0.04, sz - 0.03], width: 0.006, thickness: 0.002, boneA: B('upperChest'), boneB: B('chest'), weightA: 0.85 },
          ],
          6,
          sign * 0.12,
          [0.98, 0.96, 0.99],
          [0.88, 0.86, 0.92]
        );
      }
    }
  }

  if (spec.features.hasTail) {
    appendCurvedHairStrand(
      skinPrim,
      [
        { pos: [0, hipsPos[1] - 0.02, -0.095], width: 0.022, thickness: 0.02, boneA: B('hips'), boneB: B('hips'), weightA: 1 },
        { pos: [0.02, hipsPos[1] - 0.14, -0.25], width: 0.016, thickness: 0.015, boneA: B('hips'), boneB: B('spine'), weightA: 0.88 },
        { pos: [0.09, hipsPos[1] - 0.08, -0.44], width: 0.01, thickness: 0.01, boneA: B('hips'), boneB: B('spine'), weightA: 0.92 },
        { pos: [0.14, hipsPos[1] + 0.03, -0.54], width: 0.004, thickness: 0.004, boneA: B('hips'), boneB: B('spine'), weightA: 0.95 },
      ],
      10
    );
  }

  return [
    skinPrim,
    eyePrim,
    hairPrim,
    outfitPrim,
    trimPrim,
    cloakPrim,
    secondaryPrim,
  ].filter((p) => p.positions.length > 0 && p.indices.length > 0);
}
