import {
  BoneDef,
  PrimitiveBuild,
  QualitySegmentBudget,
} from '../anatomicalSculptor';
import { CharacterSpecification } from '../types';
import {
  AnatomicalRing,
  BoneLookup,
  appendAnatomicalLoft,
  appendCurvedArmorPlate,
  appendCurvedHairStrand,
  appendThickenedShellLoft,
  appendVertex,
  recomputeNormalsRange,
} from './meshOps';

export interface TorsoDimensions {
  waistRx: number;
  chestRx: number;
  hipRx: number;
  bustBoost: number;
  beltY: number;
  buildFactor: number;
}

/**
 * Generates layered, thickened, beveled clothing, articulated armor plates,
 * segmented hip tassets, chest harness straps, multi-part boots, and draped cloak.
 */
export function sculptLayeredClothingAndArmor(
  outfitPrim: PrimitiveBuild,
  secondaryPrim: PrimitiveBuild,
  trimPrim: PrimitiveBuild,
  cloakPrim: PrimitiveBuild,
  spec: CharacterSpecification,
  bones: BoneDef[],
  B: BoneLookup,
  budget: QualitySegmentBudget,
  dims: TorsoDimensions
) {
  const isFem = spec.genderPresentation === 'feminine';
  const hScale = spec.proportions.heightMeters / 1.7;
  const sW = spec.proportions.shoulderWidthScale;
  const { waistRx, chestRx, hipRx, bustBoost, beltY, buildFactor } = dims;

  const hipsPos = bones[B('hips')].worldPos;
  const spinePos = bones[B('spine')].worldPos;
  const chestPos = bones[B('chest')].worldPos;
  const uChestPos = bones[B('upperChest')].worldPos;
  const neckPos = bones[B('neck')].worldPos;

  const makeTorsoContour =
    (
      chestAmt: number,
      waistPinch: number,
      gluteAmt: number,
      spineGroove: number,
      garmentFoldAmt: number,
      keelSharpness = 0
    ): AnatomicalRing['contourFn'] =>
    (cosT, sinT, theta) => {
      const isFront = sinT > 0;
      const isBack = sinT < 0;
      const pecX = Math.exp(-Math.pow((Math.abs(cosT) - 0.42) / 0.28, 2));
      const sternum = Math.exp(-Math.pow(cosT / 0.14, 2));
      const keel = isFront && keelSharpness > 0 ? Math.exp(-Math.pow(cosT / 0.11, 2)) * keelSharpness * sinT : 0;
      const frontPec = isFront ? (pecX * chestAmt - sternum * chestAmt * 0.3) * sinT + keel : 0;
      const backGlute = isBack ? pecX * gluteAmt * (-sinT) : 0;
      const spineDip = isBack ? sternum * spineGroove * (-sinT) : 0;
      const fold = garmentFoldAmt > 0 ? Math.sin(theta * 12) * garmentFoldAmt : 0;
      return {
        scaleR: 1 - waistPinch * Math.pow(cosT, 2) + fold,
        dz: frontPec - backGlute + spineDip,
      };
    };

  // 1. Fitted Under-Tunic / Base Garment Layer (dark shaded seams & anatomical fit)
  const underShade: [number, number, number, number] = spec.features.hasArmor
    ? [0.76, 0.76, 0.8, 1]
    : [0.95, 0.95, 0.95, 1];
  const torsoRings: AnatomicalRing[] = [
    {
      center: [0, hipsPos[1] - 0.115 * hScale, -0.005],
      rx: hipRx * 0.78,
      rz: 0.088 * buildFactor,
      boneA: B('hips'),
      boneB: B('hips'),
      weightA: 1.0,
      color: underShade,
      contourFn: makeTorsoContour(0, 0, 0.022, 0.008, 0.008),
    },
    {
      center: [0, hipsPos[1] - 0.04 * hScale, -0.004],
      rx: hipRx * 0.98,
      rz: 0.104 * buildFactor,
      boneA: B('hips'),
      boneB: B('spine'),
      weightA: 0.88,
      color: underShade,
      contourFn: makeTorsoContour(0, 0, 0.028, 0.01, 0.008),
    },
    {
      center: [0, hipsPos[1] + 0.04 * hScale, 0],
      rx: hipRx * 0.92,
      rz: 0.102 * buildFactor,
      boneA: B('hips'),
      boneB: B('spine'),
      weightA: 0.65,
      color: underShade,
      contourFn: makeTorsoContour(0, 0.03, 0.016, 0.01, 0.01),
    },
    {
      center: [0, spinePos[1] + 0.03 * hScale, 0.005],
      rx: waistRx,
      rz: 0.088 * buildFactor,
      boneA: B('spine'),
      boneB: B('chest'),
      weightA: 0.72,
      color: underShade,
      contourFn: makeTorsoContour(0.005, 0.05, 0.006, 0.012, 0.012),
    },
    {
      center: [0, chestPos[1] - 0.01 * hScale, 0.008],
      rx: chestRx * 0.92,
      rz: 0.106 * buildFactor,
      boneA: B('chest'),
      boneB: B('spine'),
      weightA: 0.78,
      color: underShade,
      contourFn: makeTorsoContour(bustBoost * 0.55, 0, 0, 0.01, 0.008),
    },
    {
      center: [0, chestPos[1] + 0.055 * hScale, 0.011],
      rx: chestRx,
      rz: 0.114 * buildFactor,
      boneA: B('chest'),
      boneB: B('upperChest'),
      weightA: 0.58,
      color: underShade,
      contourFn: makeTorsoContour(bustBoost, 0, 0, 0.008, 0.006),
    },
    {
      center: [0, uChestPos[1] + 0.035 * hScale, 0.004],
      rx: chestRx * 0.94,
      rz: 0.098 * buildFactor,
      boneA: B('upperChest'),
      boneB: B('neck'),
      weightA: 0.86,
      color: underShade,
      contourFn: makeTorsoContour(bustBoost * 0.35, 0.04, 0, 0.006, 0.004),
    },
    {
      center: [0, neckPos[1] - 0.015 * hScale, 0],
      rx: 0.068 * buildFactor,
      rz: 0.064 * buildFactor,
      boneA: B('upperChest'),
      boneB: B('neck'),
      weightA: 0.55,
      color: underShade,
    },
  ];
  appendAnatomicalLoft(outfitPrim, torsoRings, budget.torsoRadial, true);

  // Slim hip socket cuffs
  for (const side of ['left', 'right'] as const) {
    const ul = bones[B(`${side}UpperLeg`)].worldPos;
    appendAnatomicalLoft(
      outfitPrim,
      [
        { center: [ul[0] * 0.78, hipsPos[1] + 0.005, 0], rx: 0.072 * buildFactor, rz: 0.078 * buildFactor, boneA: B('hips'), boneB: B(`${side}UpperLeg`), weightA: 0.8, color: underShade },
        { center: [ul[0], ul[1] + 0.015, 0], rx: 0.072 * buildFactor, rz: 0.078 * buildFactor, boneA: B('hips'), boneB: B(`${side}UpperLeg`), weightA: 0.6, color: underShade },
        { center: [ul[0], ul[1] - 0.03, 0], rx: 0.071 * buildFactor, rz: 0.076 * buildFactor, boneA: B(`${side}UpperLeg`), boneB: B('hips'), weightA: 0.7, color: underShade },
      ],
      budget.limbRadial
    );
  }

  // 2. Thickened Waist Belt + Ornate Faceted Buckle + Layered Sash
  appendThickenedShellLoft(
    secondaryPrim,
    [
      { center: [0, beltY - 0.016, 0.004], rx: waistRx * 1.09, rz: 0.095 * buildFactor, boneA: B('hips'), boneB: B('spine'), weightA: 0.65 },
      { center: [0, beltY, 0.005], rx: waistRx * 1.11, rz: 0.098 * buildFactor, boneA: B('hips'), boneB: B('spine'), weightA: 0.6 },
      { center: [0, beltY + 0.016, 0.004], rx: waistRx * 1.09, rz: 0.095 * buildFactor, boneA: B('spine'), boneB: B('hips'), weightA: 0.65 },
    ],
    Math.max(18, budget.torsoRadial),
    0.005
  );

  // Metallic rimmed belt strap & faceted front buckle
  appendAnatomicalLoft(
    trimPrim,
    [
      { center: [0, beltY - 0.006, 0.005], rx: waistRx * 1.125, rz: 0.1 * buildFactor, boneA: B('hips'), boneB: B('spine'), weightA: 0.6 },
      { center: [0, beltY + 0.006, 0.005], rx: waistRx * 1.125, rz: 0.1 * buildFactor, boneA: B('hips'), boneB: B('spine'), weightA: 0.6 },
    ],
    Math.max(16, budget.torsoRadial),
    true
  );
  appendAnatomicalLoft(
    trimPrim,
    [
      { center: [0, beltY - 0.017, 0.098 * buildFactor], rx: 0.024, rz: 0.006, boneA: B('hips'), boneB: B('spine'), weightA: 0.6 },
      { center: [0, beltY, 0.102 * buildFactor], rx: 0.028, rz: 0.008, boneA: B('hips'), boneB: B('spine'), weightA: 0.6 },
      { center: [0, beltY + 0.017, 0.098 * buildFactor], rx: 0.024, rz: 0.006, boneA: B('hips'), boneB: B('spine'), weightA: 0.6 },
    ],
    8,
    true
  );

  // 3. Thickened Sculpted Collar / Lapel
  appendThickenedShellLoft(
    spec.features.hasArmor ? secondaryPrim : outfitPrim,
    [
      { center: [0, neckPos[1] - 0.032 * hScale, 0.002], rx: 0.072 * buildFactor, rz: 0.068 * buildFactor, boneA: B('upperChest'), boneB: B('neck'), weightA: 0.8, tiltX: -0.012 },
      { center: [0, neckPos[1] - 0.006 * hScale, 0.002], rx: 0.058 * buildFactor, rz: 0.056 * buildFactor, boneA: B('upperChest'), boneB: B('neck'), weightA: 0.65, tiltX: -0.008 },
    ],
    20,
    0.0045
  );

  // 4. Lower Pleated Skirt / Coat Tails / Robe (with thickened hem)
  const isLongCoat = spec.outfitStyle === 'cyber_tactical' && !spec.features.hasArmor;
  const hasLowerGarment =
    spec.outfitStyle === 'fantasy_robe' ||
    spec.outfitStyle === 'royal_regalia' ||
    spec.outfitStyle === 'cyber_tactical' ||
    spec.features.hasArmor;

  if (hasLowerGarment) {
    const skirtLen =
      spec.outfitStyle === 'fantasy_robe' || spec.outfitStyle === 'royal_regalia'
        ? 0.58 * hScale
        : isLongCoat
          ? 0.39 * hScale
          : 0.27 * hScale;
    const foldAmp = spec.outfitStyle === 'fantasy_robe' ? 0.022 : 0.013;
    const pleatFn =
      (depthScale: number): AnatomicalRing['contourFn'] =>
      (_c, s, theta) => {
        const frontNotch =
          s > 0.65 && (spec.features.hasArmor || isLongCoat)
            ? -0.026 * depthScale * (s - 0.65)
            : 0;
        return {
          scaleR: 1 + Math.sin(theta * 14) * foldAmp * depthScale,
          dz: frontNotch,
        };
      };
    appendThickenedShellLoft(
      isLongCoat ? outfitPrim : cloakPrim,
      [
        { center: [0, beltY - skirtLen, -0.008], rx: hipRx * 1.44, rz: 0.144 * buildFactor, boneA: B('hips'), boneB: B('spine'), weightA: 0.95, contourFn: pleatFn(1.0) },
        { center: [0, beltY - skirtLen * 0.45, -0.003], rx: hipRx * 1.32, rz: 0.128 * buildFactor, boneA: B('hips'), boneB: B('spine'), weightA: 0.9, contourFn: pleatFn(0.55) },
        { center: [0, beltY - 0.005, 0.002], rx: waistRx * 1.18, rz: 0.104 * buildFactor, boneA: B('hips'), boneB: B('spine'), weightA: 0.85, contourFn: pleatFn(0.15) },
      ],
      budget.torsoRadial,
      0.0045
    );
  }

  // 5. Articulated Layered Armor System (uses PRIMARY armor color on outfitPrim + SECONDARY purple/accent trim on secondaryPrim + small hardware on trimPrim!)
  if (spec.features.hasArmor) {
    // 5a. Thickened Beveled Chest Cuirass with Sternum Keel Ridge (Primary Outfit/Armor Color)
    appendThickenedShellLoft(
      outfitPrim,
      [
        {
          center: [0, spinePos[1] + 0.055 * hScale, 0.008],
          rx: waistRx * 1.07,
          rz: 0.097 * buildFactor,
          boneA: B('spine'),
          boneB: B('chest'),
          weightA: 0.62,
          contourFn: makeTorsoContour(bustBoost * 0.3, 0.03, 0, 0.006, 0, 0.006),
        },
        {
          center: [0, chestPos[1] + 0.005 * hScale, 0.011],
          rx: chestRx * 1.03,
          rz: 0.114 * buildFactor,
          boneA: B('chest'),
          boneB: B('spine'),
          weightA: 0.72,
          contourFn: makeTorsoContour(bustBoost * 0.85, 0.01, 0, 0.005, 0, 0.01),
        },
        {
          center: [0, chestPos[1] + 0.058 * hScale, 0.015],
          rx: chestRx * 1.08,
          rz: 0.124 * buildFactor,
          boneA: B('chest'),
          boneB: B('upperChest'),
          weightA: 0.58,
          contourFn: makeTorsoContour(bustBoost * 1.18, 0, 0, 0.005, 0, 0.011),
        },
        {
          center: [0, uChestPos[1] + 0.034 * hScale, 0.008],
          rx: chestRx * 0.99,
          rz: 0.105 * buildFactor,
          boneA: B('upperChest'),
          boneB: B('neck'),
          weightA: 0.88,
          tiltX: -0.012,
          contourFn: makeTorsoContour(bustBoost * 0.4, 0.02, 0, 0.004, 0, 0.006),
        },
      ],
      budget.torsoRadial,
      0.0065
    );

    // 5b. Overlapping Beveled Waist Plackart / Fauld Lames (bridging cuirass to belt)
    for (let lame = 0; lame < 2; lame++) {
      const lyBottom = beltY + 0.014 * hScale + lame * 0.038 * hScale;
      const lyTop = lyBottom + 0.044 * hScale;
      const rxScale = 1.09 + lame * 0.015;
      appendThickenedShellLoft(
        outfitPrim,
        [
          { center: [0, lyBottom, 0.007], rx: waistRx * rxScale, rz: (0.098 + lame * 0.004) * buildFactor, boneA: B('hips'), boneB: B('spine'), weightA: 0.5, contourFn: makeTorsoContour(0, 0.025, 0, 0.004, 0, 0.007) },
          { center: [0, lyTop, 0.009], rx: waistRx * (rxScale - 0.02), rz: (0.096 + lame * 0.004) * buildFactor, boneA: B('spine'), boneB: B('chest'), weightA: 0.72, contourFn: makeTorsoContour(0, 0.025, 0, 0.004, 0, 0.007) },
        ],
        Math.max(18, budget.torsoRadial),
        0.0055
      );
      // Crisp Secondary (Purple/Accent) Beveled Edge Trim along bottom of each lame
      appendAnatomicalLoft(
        secondaryPrim,
        [
          { center: [0, lyBottom - 0.002, 0.008], rx: waistRx * (rxScale + 0.018), rz: (0.1 + lame * 0.004) * buildFactor, boneA: B('hips'), boneB: B('spine'), weightA: 0.5 },
          { center: [0, lyBottom + 0.007, 0.008], rx: waistRx * (rxScale + 0.016), rz: (0.1 + lame * 0.004) * buildFactor, boneA: B('hips'), boneB: B('spine'), weightA: 0.5 },
        ],
        Math.max(16, budget.torsoRadial),
        true
      );
    }

    // 5c. Ornate Secondary (Purple/Accent) V-Filigree Chest Border seated flush on cuirass contour
    for (const sign of [1, -1] as const) {
      appendCurvedHairStrand(
        secondaryPrim,
        [
          { pos: [0, chestPos[1] + 0.025 * hScale, (0.123 + bustBoost * 0.52) * buildFactor], width: 0.0085 * buildFactor, thickness: 0.004, boneA: B('chest'), boneB: B('upperChest'), weightA: 0.65 },
          { pos: [sign * chestRx * 0.38, chestPos[1] + 0.066 * hScale, (0.114 + bustBoost * 0.45) * buildFactor], width: 0.008 * buildFactor, thickness: 0.004, boneA: B('chest'), boneB: B('upperChest'), weightA: 0.45 },
          { pos: [sign * chestRx * 0.64, uChestPos[1] + 0.032 * hScale, 0.086 * buildFactor], width: 0.0075 * buildFactor, thickness: 0.004, boneA: B('upperChest'), boneB: B('neck'), weightA: 0.85 },
        ],
        8,
        0,
        [0.95, 0.92, 1],
        [1, 1, 1],
        [sign * 0.25, 0.2, 0.9]
      );

      // Shoulder Harness Strap + Metallic Buckle
      appendCurvedHairStrand(
        trimPrim,
        [
          { pos: [sign * chestRx * 0.56, chestPos[1] + 0.07 * hScale, (0.112 + bustBoost * 0.5) * buildFactor], width: 0.009 * buildFactor, thickness: 0.0045, boneA: B('chest'), boneB: B('upperChest'), weightA: 0.5 },
          { pos: [sign * chestRx * 0.62, uChestPos[1] + 0.05 * hScale, 0.04 * buildFactor], width: 0.009 * buildFactor, thickness: 0.0045, boneA: B('upperChest'), boneB: B('neck'), weightA: 0.85 },
          { pos: [sign * chestRx * 0.58, uChestPos[1] + 0.03 * hScale, -0.078 * buildFactor], width: 0.009 * buildFactor, thickness: 0.0045, boneA: B('upperChest'), boneB: B('chest'), weightA: 0.8 },
        ],
        8
      );
    }

    // 5d. Segmented Individual Curved Hip Tassets (4 beveled armored lappets around hips!)
    const tassetAngles = [-1.18, -0.58, 0.58, 1.18];
    for (const centerAng of tassetAngles) {
      const angSpan = 0.46;
      const tassetH = 0.21 * hScale;
      // Primary obsidian beveled tasset plate
      appendCurvedArmorPlate(outfitPrim, 6, 6, 0.007, (u, v) => {
        const ang = centerAng + (u - 0.5) * angSpan;
        const flare = 1.16 + v * 0.22;
        const rX = hipRx * flare;
        const rZ = 0.112 * buildFactor * flare;
        // Pointed gothic tip silhouette at bottom
        const tipDrop = (1 - Math.abs(u - 0.5) * 2) * 0.028 * hScale * v;
        const ridge = (1 - Math.abs(u - 0.5) * 2) * 0.008 * buildFactor;
        const px = Math.sin(ang) * (rX + ridge);
        const pz = Math.cos(ang) * (rZ + ridge);
        const py = beltY - 0.015 * hScale - v * tassetH - tipDrop;
        return {
          pos: [px, py, pz],
          normal: [Math.sin(ang), 0.14, Math.cos(ang)],
          boneA: B('hips'),
          boneB: B('spine'),
          weightA: 0.88,
          color: [1 - v * 0.12, 1 - v * 0.12, 1.02 - v * 0.1, 1],
        };
      });
      // Purple/Secondary Accent Trim Rim hugging bottom edge of each tasset
      appendCurvedHairStrand(
        secondaryPrim,
        [0, 0.5, 1].map((u) => {
          const ang = centerAng + (u - 0.5) * angSpan;
          const flare = 1.38;
          const rX = hipRx * flare + 0.003;
          const rZ = 0.112 * buildFactor * flare + 0.003;
          const tipDrop = (1 - Math.abs(u - 0.5) * 2) * 0.028 * hScale;
          const ridge = (1 - Math.abs(u - 0.5) * 2) * 0.009 * buildFactor;
          return {
            pos: [
              Math.sin(ang) * (rX + ridge),
              beltY - 0.015 * hScale - tassetH - tipDrop,
              Math.cos(ang) * (rZ + ridge),
            ] as [number, number, number],
            width: 0.006,
            thickness: 0.0045,
            boneA: B('hips'),
            boneB: B('spine'),
            weightA: 0.88,
          };
        }),
        6,
        0,
        [0.95, 0.92, 1],
        [1, 1, 1],
        [Math.sin(centerAng), 0.1, Math.cos(centerAng)]
      );
    }

    // 5e. 3-Lame Articulated Shoulder Pauldrons (Armored Shoulder Plates + Beveled Trim)
    for (const sign of [1, -1] as const) {
      const ua = bones[B(`${sign > 0 ? 'left' : 'right'}UpperArm`)].worldPos;
      const shBone = B(`${sign > 0 ? 'left' : 'right'}Shoulder`);
      const uaBone = B(`${sign > 0 ? 'left' : 'right'}UpperArm`);

      for (let lame = 0; lame < 3; lame++) {
        const xBase = ua[0] + sign * (-0.018 + lame * 0.036) * buildFactor;
        const yTop = ua[1] + (0.064 - lame * 0.016) * buildFactor;
        const archR = (0.062 - lame * 0.004) * buildFactor;
        const archW = (0.036 - lame * 0.003) * buildFactor;
        const boneA = lame === 0 ? shBone : uaBone;
        const boneB = lame === 0 ? uaBone : shBone;

        // Primary curved armored pauldron lame
        appendCurvedArmorPlate(outfitPrim, 8, 5, 0.0075, (u, v) => {
          const arcAng = (u - 0.5) * Math.PI * 1.15;
          const x = xBase + sign * v * archW;
          const y = yTop - Math.pow(Math.abs(u - 0.5) * 2, 1.65) * 0.056 * buildFactor - v * 0.015 * buildFactor;
          const z = Math.sin(arcAng) * archR * (1.06 + (1 - v) * 0.06);
          const ridgeY = (1 - Math.abs(v - 0.5) * 2) * 0.005;
          return {
            pos: [x, y + ridgeY, z],
            normal: [sign * 0.55, 0.65, Math.sin(arcAng)],
            boneA,
            boneB,
            weightA: lame === 0 ? 0.65 : 0.85,
          };
        });

        // Secondary purple/accent rim along outer edge of each pauldron lame
        appendCurvedHairStrand(
          lame === 0 ? trimPrim : secondaryPrim,
          [0, 0.5, 1].map((u) => {
            const arcAng = (u - 0.5) * Math.PI * 1.15;
            return {
              pos: [
                xBase + sign * archW,
                yTop - Math.pow(Math.abs(u - 0.5) * 2, 1.65) * 0.056 * buildFactor - 0.015 * buildFactor,
                Math.sin(arcAng) * archR * 1.07,
              ] as [number, number, number],
              width: 0.0055 * buildFactor,
              thickness: 0.004 * buildFactor,
              boneA,
              boneB,
              weightA: 0.82,
            };
          }),
          6,
          0,
          [0.95, 0.95, 1],
          [1, 1, 1],
          [sign * 0.6, 0.7, 0]
        );
      }
    }
  } else if (spec.outfitStyle === 'cyber_tactical') {
    // Layered Tactical / Ranger Coat with Open-Front Lapels & Diagonal Harness
    for (const sign of [1, -1] as const) {
      appendCurvedArmorPlate(outfitPrim, 4, 8, 0.006, (u, v) => {
        const y = beltY + 0.01 + v * (uChestPos[1] + 0.03 * hScale - beltY);
        const x = sign * (0.025 + u * 0.052) * buildFactor;
        const z = (0.098 + bustBoost * 0.4 + (1 - u) * 0.012) * buildFactor;
        return {
          pos: [x, y, z],
          normal: [sign * 0.35, 0.1, 0.92],
          boneA: v > 0.5 ? B('chest') : B('spine'),
          boneB: B('upperChest'),
          weightA: 0.75,
        };
      });
    }
    // Diagonal Tactical Cross-Body Strap & Metallic Buckle
    appendCurvedHairStrand(
      secondaryPrim,
      [
        { pos: [-chestRx * 0.62, uChestPos[1] + 0.04 * hScale, 0.08 * buildFactor], width: 0.014 * buildFactor, thickness: 0.005, boneA: B('upperChest'), boneB: B('chest'), weightA: 0.7 },
        { pos: [0, chestPos[1] + 0.01 * hScale, (0.12 + bustBoost * 0.5) * buildFactor], width: 0.014 * buildFactor, thickness: 0.005, boneA: B('chest'), boneB: B('spine'), weightA: 0.7 },
        { pos: [waistRx * 0.85, beltY + 0.01, 0.075 * buildFactor], width: 0.014 * buildFactor, thickness: 0.005, boneA: B('spine'), boneB: B('hips'), weightA: 0.7 },
      ],
      10
    );
    appendAnatomicalLoft(
      trimPrim,
      [
        { center: [0, chestPos[1] + 0.005 * hScale, (0.123 + bustBoost * 0.5) * buildFactor], rx: 0.018, rz: 0.007, boneA: B('chest'), boneB: B('chest'), weightA: 1 },
        { center: [0, chestPos[1] + 0.028 * hScale, (0.123 + bustBoost * 0.5) * buildFactor], rx: 0.018, rz: 0.007, boneA: B('chest'), boneB: B('chest'), weightA: 1 },
      ],
      6,
      true
    );
  } else if (spec.outfitStyle === 'fantasy_robe' || spec.outfitStyle === 'royal_regalia') {
    // Embroidered Diagonal Mage Stole / Regal Sash
    for (const sign of [1, -1] as const) {
      appendCurvedArmorPlate(secondaryPrim, 4, 8, 0.005, (u, v) => {
        const y = beltY + v * (uChestPos[1] + 0.035 * hScale - beltY);
        const x = sign * (0.032 + u * 0.045) * buildFactor;
        const z = (0.098 + bustBoost * 0.75 + v * 0.014) * buildFactor;
        return {
          pos: [x, y, z],
          normal: [sign * 0.25, 0.1, 0.96],
          boneA: v > 0.5 ? B('chest') : B('spine'),
          boneB: B('upperChest'),
          weightA: 0.7,
        };
      });
    }
  }

  // 6. Forearm Vambraces / Cuffs & Multi-Part Sculpted Boots
  for (const side of ['left', 'right'] as const) {
    const sign: 1 | -1 = side === 'left' ? 1 : -1;
    const la = bones[B(`${side}LowerArm`)].worldPos;
    const hd = bones[B(`${side}Hand`)].worldPos;

    if (spec.features.hasArmor) {
      // Thickened Beveled Forearm Vambrace (Primary Black/Outfit Color + Secondary Purple Cuff Rim)
      appendThickenedShellLoft(
        outfitPrim,
        [
          { center: [la[0] + sign * 0.032, la[1], 0], rx: 0.045 * buildFactor, rz: 0.044 * buildFactor, boneA: B(`${side}LowerArm`), boneB: B(`${side}Hand`), weightA: 0.92, axis: 'x' },
          { center: [hd[0] - sign * 0.012, hd[1], 0], rx: 0.036 * buildFactor, rz: 0.033 * buildFactor, boneA: B(`${side}LowerArm`), boneB: B(`${side}Hand`), weightA: 0.5, axis: 'x' },
        ],
        14,
        0.0045
      );
      appendAnatomicalLoft(
        secondaryPrim,
        [
          { center: [hd[0] - sign * 0.022, hd[1], 0], rx: 0.038 * buildFactor, rz: 0.035 * buildFactor, boneA: B(`${side}LowerArm`), boneB: B(`${side}Hand`), weightA: 0.5, axis: 'x' },
          { center: [hd[0] - sign * 0.008, hd[1], 0], rx: 0.038 * buildFactor, rz: 0.035 * buildFactor, boneA: B(`${side}LowerArm`), boneB: B(`${side}Hand`), weightA: 0.35, axis: 'x' },
        ],
        12,
        true
      );
    } else if (spec.outfitStyle === 'fantasy_robe' || spec.outfitStyle === 'royal_regalia') {
      // Flared Robe Sleeve Cuffs
      appendThickenedShellLoft(
        secondaryPrim,
        [
          { center: [la[0] + sign * 0.09, la[1], 0], rx: 0.045 * buildFactor, rz: 0.045 * buildFactor, boneA: B(`${side}LowerArm`), boneB: B(`${side}Hand`), weightA: 0.85, axis: 'x' },
          { center: [hd[0] - sign * 0.01, hd[1], 0], rx: 0.056 * buildFactor, rz: 0.056 * buildFactor, boneA: B(`${side}LowerArm`), boneB: B(`${side}Hand`), weightA: 0.5, axis: 'x' },
        ],
        14,
        0.004
      );
    }

    // Multi-Part Sculpted Boots (Shaft + Beveled Cuff + Knee Poleyn + Thickened Sole/Heel + Toe Cap)
    const ll = bones[B(`${side}LowerLeg`)].worldPos;
    const ft = bones[B(`${side}Foot`)].worldPos;
    const toes = bones[B(`${side}Toes`)].worldPos;
    const calfMaxY = ll[1] * 0.68 + ft[1] * 0.32;
    const bootCuffY = ll[1] + (spec.features.hasArmor ? 0.095 : 0.04) * hScale;

    // Thickened Boot Shaft & Greave (uses PRIMARY armor/leather color, NOT bright silver!)
    appendThickenedShellLoft(
      outfitPrim,
      [
        { center: [ft[0], ft[1] - 0.005, -0.004], rx: 0.045 * buildFactor, rz: 0.05 * buildFactor, boneA: B(`${side}LowerLeg`), boneB: B(`${side}Foot`), weightA: 0.35 },
        { center: [ll[0], calfMaxY, -0.012], rx: 0.059 * buildFactor, rz: 0.067 * buildFactor, boneA: B(`${side}LowerLeg`), boneB: B(`${side}Foot`), weightA: 0.9 },
        { center: [ll[0], bootCuffY, 0.008], rx: 0.065 * buildFactor, rz: 0.069 * buildFactor, boneA: B(`${side}UpperLeg`), boneB: B(`${side}LowerLeg`), weightA: 0.55 },
        { center: [ll[0], bootCuffY + 0.025, 0.012], rx: 0.07 * buildFactor, rz: 0.073 * buildFactor, boneA: B(`${side}UpperLeg`), boneB: B(`${side}LowerLeg`), weightA: 0.6 },
      ],
      budget.limbRadial,
      0.005
    );

    // Boot Top Cuff Trim & Ankle Strap/Buckle
    appendAnatomicalLoft(
      secondaryPrim,
      [
        { center: [ll[0], bootCuffY + 0.012, 0.011], rx: 0.071 * buildFactor, rz: 0.074 * buildFactor, boneA: B(`${side}UpperLeg`), boneB: B(`${side}LowerLeg`), weightA: 0.58 },
        { center: [ll[0], bootCuffY + 0.028, 0.013], rx: 0.073 * buildFactor, rz: 0.076 * buildFactor, boneA: B(`${side}UpperLeg`), boneB: B(`${side}LowerLeg`), weightA: 0.6 },
      ],
      14,
      true
    );
    appendAnatomicalLoft(
      trimPrim,
      [
        { center: [ft[0], ft[1] + 0.015, 0], rx: 0.047 * buildFactor, rz: 0.053 * buildFactor, boneA: B(`${side}Foot`), boneB: B(`${side}LowerLeg`), weightA: 0.7 },
        { center: [ft[0], ft[1] + 0.028, 0], rx: 0.047 * buildFactor, rz: 0.053 * buildFactor, boneA: B(`${side}Foot`), boneB: B(`${side}LowerLeg`), weightA: 0.7 },
      ],
      12,
      true
    );

    // Winged Knee Poleyn Plate (for armored characters)
    if (spec.features.hasArmor) {
      appendCurvedArmorPlate(outfitPrim, 6, 5, 0.006, (u, v) => {
        const ang = (u - 0.5) * 1.65;
        const r = 0.068 * buildFactor;
        const keel = (1 - Math.abs(u - 0.5) * 2) * 0.012;
        return {
          pos: [
            ll[0] + Math.sin(ang) * r,
            ll[1] - 0.02 + v * 0.075,
            0.012 + Math.cos(ang) * r + keel,
          ],
          normal: [Math.sin(ang), 0.1, Math.cos(ang)],
          boneA: B(`${side}LowerLeg`),
          boneB: B(`${side}UpperLeg`),
          weightA: 0.65,
        };
      });
    }

    // Boot Upper Shell (Primary Color)
    appendAnatomicalLoft(
      outfitPrim,
      [
        { center: [ft[0], 0.044, ft[2] - 0.032], rx: 0.042 * buildFactor, rz: 0.03, boneA: B(`${side}Foot`), boneB: B(`${side}LowerLeg`), weightA: 0.9 },
        { center: [ft[0], 0.042, ft[2] + 0.035], rx: 0.045 * buildFactor, rz: 0.028, boneA: B(`${side}Foot`), boneB: B(`${side}Toes`), weightA: 0.7 },
        { center: [toes[0], 0.032, toes[2] - 0.01], rx: 0.047 * buildFactor, rz: 0.021, boneA: B(`${side}Toes`), boneB: B(`${side}Foot`), weightA: 0.75 },
        { center: [toes[0], 0.022, toes[2] + 0.044], rx: 0.035 * buildFactor, rz: 0.014, boneA: B(`${side}Toes`), boneB: B(`${side}Toes`), weightA: 1.0 },
      ],
      14,
      true
    );

    // Distinct Thickened Boot Sole & Sculpted Heel Block (Dark Grounding Rubber/Metal Sole)
    appendAnatomicalLoft(
      secondaryPrim,
      [
        { center: [ft[0], 0.014, ft[2] - 0.034], rx: 0.043 * buildFactor, rz: 0.014, boneA: B(`${side}Foot`), boneB: B(`${side}LowerLeg`), weightA: 0.95 },
        { center: [ft[0], 0.013, ft[2] + 0.034], rx: 0.045 * buildFactor, rz: 0.011, boneA: B(`${side}Foot`), boneB: B(`${side}Toes`), weightA: 0.7 },
        { center: [toes[0], 0.009, toes[2] - 0.008], rx: 0.048 * buildFactor, rz: 0.009, boneA: B(`${side}Toes`), boneB: B(`${side}Foot`), weightA: 0.8 },
        { center: [toes[0], 0.008, toes[2] + 0.046], rx: 0.036 * buildFactor, rz: 0.007, boneA: B(`${side}Toes`), boneB: B(`${side}Toes`), weightA: 1.0 },
      ],
      12,
      true
    );
  }

  // 7. Layered Thickened Flowing Cloak + Folded Mantle Collar + Dual Shoulder Brooch Clasps
  if (spec.features.hasCloak) {
    const cTop = bones[B('cloakTop')].worldPos;
    const cMid = bones[B('cloakMid')].worldPos;
    const cHem = bones[B('cloakHem')].worldPos;

    const rows = budget.cloakRows;
    const cols = budget.cloakCols;
    const rowStarts: number[] = [];
    const backRowStarts: number[] = [];
    const startVert = cloakPrim.positions.length / 3;
    const startIdx = cloakPrim.indices.length;
    const thickness = 0.005;

    for (const isInner of [false, true]) {
      const targetStarts = isInner ? backRowStarts : rowStarts;
      for (let r = 0; r <= rows; r++) {
        const v = r / rows;
        const y =
          v < 0.5
            ? cTop[1] * (1 - v * 2) + cMid[1] * (v * 2)
            : cMid[1] * (1 - (v - 0.5) * 2) + cHem[1] * ((v - 0.5) * 2);
        const baseZ = -0.085 - v * 0.148 + (isInner ? thickness : 0);
        const halfW = (0.205 + v * 0.255) * sW;
        const bA = v < 0.35 ? B('upperChest') : v < 0.7 ? B('cloakTop') : B('cloakMid');
        const bB = v < 0.35 ? B('cloakTop') : v < 0.7 ? B('cloakMid') : B('cloakHem');
        const wA = 0.65;
        const shade = isInner ? 0.68 : 1.0;

        targetStarts.push(cloakPrim.positions.length / 3);
        for (let c = 0; c <= cols; c++) {
          const u = c / cols;
          const t = (u - 0.5) * 2;
          const px = t * halfW;
          const wrapZ = baseZ + Math.pow(t, 2) * 0.075;
          const pleats = Math.sin(u * Math.PI * 10) * (0.008 + v * 0.022);
          const hemLift = Math.pow(t, 2) * 0.032 * v;
          const ao = shade * (0.9 + 0.1 * Math.cos(u * Math.PI * 10));
          appendVertex(
            cloakPrim,
            [px, y + hemLift, wrapZ + pleats],
            [t * 0.3, 0.15, isInner ? 1 : -1],
            [u, v],
            [bA, bB, 0, 0],
            [wA, 1 - wA, 0, 0],
            'none',
            [ao, ao, ao, 1]
          );
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Outer face
        const i0 = rowStarts[r] + c;
        const i1 = rowStarts[r] + c + 1;
        const i2 = rowStarts[r + 1] + c;
        const i3 = rowStarts[r + 1] + c + 1;
        cloakPrim.indices.push(i0, i2, i1, i1, i2, i3);
        // Inner face
        const b0 = backRowStarts[r] + c;
        const b1 = backRowStarts[r] + c + 1;
        const b2 = backRowStarts[r + 1] + c;
        const b3 = backRowStarts[r + 1] + c + 1;
        cloakPrim.indices.push(b0, b1, b2, b1, b3, b2);
      }
    }
    // Stitch side & bottom hem walls so cloak edge reads as thick folded cloth
    for (let c = 0; c < cols; c++) {
      cloakPrim.indices.push(rowStarts[rows] + c, backRowStarts[rows] + c, rowStarts[rows] + c + 1);
      cloakPrim.indices.push(rowStarts[rows] + c + 1, backRowStarts[rows] + c, backRowStarts[rows] + c + 1);
    }
    for (let r = 0; r < rows; r++) {
      cloakPrim.indices.push(rowStarts[r], rowStarts[r + 1], backRowStarts[r]);
      cloakPrim.indices.push(rowStarts[r + 1], backRowStarts[r + 1], backRowStarts[r]);
      cloakPrim.indices.push(rowStarts[r] + cols, backRowStarts[r] + cols, rowStarts[r + 1] + cols);
      cloakPrim.indices.push(rowStarts[r + 1] + cols, backRowStarts[r] + cols, backRowStarts[r + 1] + cols);
    }
    recomputeNormalsRange(cloakPrim, startVert, startIdx);

    // Sculpted Shoulder Mantle Clasps / Brooches on Clavicles (connecting cloak naturally to front)
    for (const sign of [1, -1] as const) {
      const claspX = sign * chestRx * 0.64;
      const claspY = uChestPos[1] + 0.036 * hScale;
      const claspZ = 0.088 * buildFactor;
      appendAnatomicalLoft(
        trimPrim,
        [
          { center: [claspX, claspY - 0.011, claspZ - 0.004], rx: 0.013, rz: 0.006, boneA: B('upperChest'), boneB: B('upperChest'), weightA: 1 },
          { center: [claspX, claspY, claspZ + 0.004], rx: 0.016, rz: 0.008, boneA: B('upperChest'), boneB: B('upperChest'), weightA: 1 },
          { center: [claspX, claspY + 0.011, claspZ - 0.004], rx: 0.013, rz: 0.006, boneA: B('upperChest'), boneB: B('upperChest'), weightA: 1 },
        ],
        8,
        true
      );
    }
  }
}
