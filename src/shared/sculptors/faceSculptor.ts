import {
  BoneDef,
  FaceRegionTag,
  PrimitiveBuild,
  QualitySegmentBudget,
} from '../anatomicalSculptor';
import { CharacterArtStyle, CharacterSpecification } from '../types';
import {
  BoneLookup,
  appendAnatomicalLoft,
  appendCurvedHairStrand,
  appendVertex,
  recomputeNormalsRange,
} from './meshOps';

const gaussian = (x: number, cx: number, sx: number) =>
  Math.exp(-Math.pow((x - cx) / sx, 2));

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Generates sculpted 3D folded upper and lower eyelids proud of the eyeball surface
 * forming an almond/anime eye aperture with medial & lateral canthus corners,
 * eyelid crease fold, and flush upper lash flange.
 */
function appendSculpted3DEyelids(
  skinPrim: PrimitiveBuild,
  hairPrim: PrimitiveBuild,
  headCenter: [number, number, number],
  eyeCenter: [number, number, number],
  eyeR: number,
  side: 1 | -1,
  headS: number,
  animeFactor: number,
  headBoneIdx: number
) {
  const cols = 16;
  const rows = 4;
  const eyeW = eyeR * (1.34 - animeFactor * 0.06);
  // Relaxed upper lid gently hoods top ~22-26% of iris; lower lid frames bottom rim
  const upperArchH = eyeR * (0.35 + animeFactor * 0.1);
  const lowerArchH = eyeR * (0.38 + animeFactor * 0.08);

  const buildLidStrip = (isUpper: boolean) => {
    const startVert = skinPrim.positions.length / 3;
    const startIdx = skinPrim.indices.length;
    const grid: number[][] = [];
    const tag: FaceRegionTag = isUpper
      ? side > 0
        ? 'eyelid_upper_l'
        : 'eyelid_upper_r'
      : side > 0
        ? 'eyelid_lower_l'
        : 'eyelid_lower_r';

    for (let r = 0; r <= rows; r++) {
      const rv = r / rows;
      const rowVerts: number[] = [];
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const s = u * 2 - 1;
        const arch = Math.sqrt(Math.max(0, 1 - s * s));
        const canthusTilt = (u - 0.5) * (isUpper ? 0.0028 : 0.002) * headS;
        const px = eyeCenter[0] + side * s * eyeW;

        const baseArchY = isUpper
          ? eyeCenter[1] + arch * upperArchH + canthusTilt
          : eyeCenter[1] - arch * lowerArchH + canthusTilt;
        const blendOffsetY = isUpper
          ? rv * (0.0052 + arch * 0.0058) * headS
          : -rv * (0.0036 + arch * 0.0044) * headS;
        const py = baseArchY + blendOffsetY;

        // Project onto eyeball front + proud 3D lid thickness so skin never z-fights sclera
        const dxEye = (px - eyeCenter[0]) / (eyeR * 1.18);
        const dyEye = (py - eyeCenter[1]) / (eyeR * 1.05);
        const sphereProj = Math.sqrt(
          Math.max(0.12, 1 - dxEye * dxEye * 0.65 - dyEye * dyEye * 0.52)
        );
        const lidThickness =
          r === 0
            ? 0.0022 * headS
            : r === 1
              ? 0.0042 * headS
              : r === 2
                ? 0.0024 * headS
                : 0.0005 * headS;
        const pz =
          eyeCenter[2] +
          sphereProj * eyeR * 0.96 +
          lidThickness * (0.35 + 0.65 * arch) +
          0.0014 * headS;

        const flx = (px - headCenter[0]) / (0.09 * headS);
        const fly = (py - headCenter[1]) / (0.112 * headS);
        const flz = Math.max(0.55, (pz - headCenter[2]) / (0.104 * headS));

        const creaseAo = r === 2 ? 0.14 : r === 0 ? 0.12 : 0.02;
        const col: [number, number, number, number] = [
          0.95 - creaseAo,
          0.92 - creaseAo * 1.15,
          0.93 - creaseAo * 1.05,
          1,
        ];

        rowVerts.push(
          appendVertex(
            skinPrim,
            [px, py, pz],
            [side * s * 0.2, isUpper ? 0.28 : -0.28, 0.94],
            [0.45 + s * 0.05, 0.45 + rv * 0.05],
            [headBoneIdx, headBoneIdx, 0, 0],
            [1, 0, 0, 0],
            tag,
            col,
            [flx, fly, flz]
          )
        );
      }
      grid.push(rowVerts);
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = grid[r][c];
        const b = grid[r][c + 1];
        const d = grid[r + 1][c];
        const e = grid[r + 1][c + 1];
        const flip = (side > 0) === isUpper;
        if (flip) {
          skinPrim.indices.push(a, d, b, b, d, e);
        } else {
          skinPrim.indices.push(a, b, d, b, e, d);
        }
      }
    }
    recomputeNormalsRange(skinPrim, startVert, startIdx);
  };

  buildLidStrip(true);
  buildLidStrip(false);

  // Flush Sculpted Upper Lash Flange anchored along row 0 of upper eyelid
  const lashColor: [number, number, number] = [0.09, 0.07, 0.1];
  const lashPts = [0.06, 0.34, 0.66, 0.97].map((u, idx) => {
    const s = u * 2 - 1;
    const arch = Math.sqrt(Math.max(0, 1 - s * s));
    const canthusTilt = (u - 0.5) * 0.0028 * headS;
    const px = eyeCenter[0] + side * s * eyeW * (idx === 3 ? 1.07 : 1.0);
    const py =
      eyeCenter[1] + arch * upperArchH + canthusTilt + (idx === 3 ? 0.0014 * headS : 0);
    const dxEye = (px - eyeCenter[0]) / (eyeR * 1.18);
    const dyEye = (py - eyeCenter[1]) / (eyeR * 1.05);
    const sphereProj = Math.sqrt(
      Math.max(0.12, 1 - dxEye * dxEye * 0.65 - dyEye * dyEye * 0.52)
    );
    const pz =
      eyeCenter[2] +
      sphereProj * eyeR * 0.96 +
      0.0036 * headS * (0.35 + 0.65 * arch) +
      0.0016 * headS;
    const w =
      idx === 0
        ? 0.0009 * headS
        : idx === 3
          ? 0.0011 * headS
          : (0.0017 + animeFactor * 0.0007) * headS;
    return {
      pos: [px, py, pz] as [number, number, number],
      width: w,
      thickness: w * 0.85,
      boneA: headBoneIdx,
      boneB: headBoneIdx,
      weightA: 1,
    };
  });
  appendCurvedHairStrand(hairPrim, lashPts, 10, 0, lashColor, lashColor, [0, 0.15, 1]);
}

/**
 * High-resolution anatomical cranio-facial sculpt with recessed orbital sockets,
 * 3D folded eyelids, sculpted brow ridge, cheekbones, nose bridge/tip/nostril alae,
 * philtrum, sculpted vermilion lips + directly-recessed openable mouth cavity,
 * smooth C1 jawline/chin, sculpted concha ears, and clavicle/SCM neck blend.
 */
export function sculptAnatomicalHeadAndFace(
  skinPrim: PrimitiveBuild,
  eyePrim: PrimitiveBuild,
  hairPrim: PrimitiveBuild,
  _trimPrim: PrimitiveBuild,
  spec: CharacterSpecification,
  bones: BoneDef[],
  B: BoneLookup,
  budget: QualitySegmentBudget
): [number, number, number] {
  const headS = spec.proportions.headScale;
  const hScale = spec.proportions.heightMeters / 1.7;
  const headPos = bones[B('head')].worldPos;
  const neckPos = bones[B('neck')].worldPos;
  const headCenter: [number, number, number] = [
    headPos[0],
    headPos[1] + 0.084 * headS,
    headPos[2] + 0.005 * headS,
  ];
  const isFem = spec.genderPresentation === 'feminine';
  const isDarkElf = spec.species === 'Dark Elf';
  const art: CharacterArtStyle = spec.artStyle;
  const animeFactor =
    art === 'stylized_anime' ? 1.0 : art === 'semi_realistic' ? 0.42 : 0.0;

  // 1. Sculpted Anatomical Neck with Sternocleidomastoid V-Tendons & Clavicle Collar Transition
  const neckBaseR = (isFem ? 0.044 : 0.052) * headS;
  const neckMidR = (isFem ? 0.039 : 0.047) * headS;
  appendAnatomicalLoft(
    skinPrim,
    [
      {
        center: [0, neckPos[1] - 0.038 * hScale, -0.005],
        rx: neckBaseR * 1.38,
        rz: neckBaseR * 1.18,
        boneA: B('upperChest'),
        boneB: B('neck'),
        weightA: 0.65,
        contourFn: (cosT, sinT) => {
          const scm =
            Math.exp(-Math.pow((Math.abs(cosT) - 0.36) / 0.2, 2)) * (sinT > 0 ? sinT : 0);
          const notch = Math.exp(-Math.pow(cosT / 0.16, 2)) * (sinT > 0 ? sinT : 0);
          const trap = Math.abs(cosT) * (sinT < 0.2 ? 0.012 : 0);
          return {
            scaleR: 1 + trap * 2.5,
            dz: scm * 0.006 - notch * 0.005,
            dy: -Math.abs(cosT) * 0.012,
          };
        },
      },
      {
        center: [0, neckPos[1] + 0.012 * hScale, 0.0],
        rx: neckMidR * 1.04,
        rz: neckMidR * 1.03,
        boneA: B('neck'),
        boneB: B('head'),
        weightA: 0.72,
        contourFn: (cosT, sinT) => {
          const scm =
            Math.exp(-Math.pow((Math.abs(cosT) - 0.42) / 0.2, 2)) * (sinT > 0 ? sinT : 0);
          return { dz: scm * 0.0035 };
        },
      },
      {
        center: [0, neckPos[1] + 0.05 * hScale, 0.003],
        rx: neckMidR,
        rz: neckMidR * 1.05,
        boneA: B('neck'),
        boneB: B('head'),
        weightA: 0.45,
      },
      {
        center: [0, headPos[1] + 0.036 * headS, 0.002],
        rx: neckMidR * 1.08,
        rz: neckMidR * 1.14,
        boneA: B('head'),
        boneB: B('neck'),
        weightA: 0.85,
      },
    ],
    Math.max(16, Math.round(budget.limbRadial * 0.95))
  );

  // 2. Sculpted Cranium + High-Detail Facial Anatomy with Directly-Recessed Openable Mouth Cavity
  const lat = budget.headLat;
  const lon = budget.headLon;
  const rxBase = (isFem ? 0.087 : 0.094) * headS;
  const ryBase = 0.112 * headS;
  const rzBase = 0.104 * headS;
  const startVert = skinPrim.positions.length / 3;
  const startIdx = skinPrim.indices.length;

  for (let i = 0; i <= lat; i++) {
    const v = i / lat;
    const phi = v * Math.PI;
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);

    for (let j = 0; j <= lon; j++) {
      const u = j / lon;
      const theta = u * Math.PI * 2 + Math.PI;
      const nx = sinP * Math.sin(theta);
      const ny = cosP;
      const nz = sinP * Math.cos(theta);

      let px = nx * rxBase;
      let py = ny * ryBase;
      let pz = nz * rzBase;

      // Cranial occiput curve at back of skull
      if (nz < 0 && ny > -0.25) {
        const backCurve = gaussian(ny, 0.25, 0.55) * (-nz);
        pz -= backCurve * 0.015 * headS;
        px *= 1 + backCurve * 0.06;
      }

      // Temple slight inward taper
      if (Math.abs(nx) > 0.62 && ny > 0.06 && ny < 0.56 && nz > -0.1) {
        px -= Math.sign(nx) * gaussian(ny, 0.3, 0.2) * 0.0045 * headS;
      }

      let mouthInteriorMask = 0;

      if (nz > 0.14) {
        const frontMask = clamp01((nz - 0.14) / 0.54);

        if (ny > 0.23) {
          pz -= gaussian(ny, 0.45, 0.28) * frontMask * 0.0045 * headS;
        }

        // Superciliary Brow Ridge & Glabella
        const browMask =
          gaussian(ny, 0.205, 0.068) *
          gaussian(Math.abs(nx), 0.27, 0.24) *
          frontMask;
        pz += browMask * (0.0095 - animeFactor * 0.003) * headS;

        // Deepened Recessed Orbital Sockets so face mesh frames eyeballs cleanly
        const eyeY = 0.072;
        const eyeX = 0.345;
        const leftSocket = gaussian(nx, eyeX, 0.165) * gaussian(ny, eyeY, 0.11);
        const rightSocket = gaussian(nx, -eyeX, 0.165) * gaussian(ny, eyeY, 0.11);
        const socket = (leftSocket + rightSocket) * frontMask;
        pz -= socket * (0.028 - animeFactor * 0.002) * headS;

        // Sculpted Nose Bridge, Dorsal Plane, Rounded Tip & Distinct Lateral Nostril Alae
        const noseBridge =
          gaussian(nx, 0, 0.092) *
          (ny > -0.175 && ny < 0.21
            ? Math.sin(((ny + 0.175) / 0.385) * Math.PI)
            : 0) *
          frontMask;
        const noseTip = gaussian(nx, 0, 0.082) * gaussian(ny, -0.132, 0.062) * frontMask;
        const nostrilL = gaussian(nx, 0.112, 0.05) * gaussian(ny, -0.165, 0.045) * frontMask;
        const nostrilR = gaussian(nx, -0.112, 0.05) * gaussian(ny, -0.165, 0.045) * frontMask;
        const nostrilDimple =
          (gaussian(nx, 0.08, 0.034) + gaussian(nx, -0.08, 0.034)) *
          gaussian(ny, -0.195, 0.028) *
          frontMask;
        const noseAmp = 1.0 - animeFactor * 0.24;
        pz +=
          (noseBridge * 0.0165 +
            noseTip * 0.0255 +
            (nostrilL + nostrilR) * 0.0105 -
            nostrilDimple * 0.0065) *
          noseAmp *
          headS;
        py -= noseTip * 0.004 * headS;

        // Zygomatic Cheekbones & Soft Malar Fullness (gentle lateral contour, zero hard pinch!)
        const cheekMask =
          gaussian(Math.abs(nx), 0.45, 0.24) *
          gaussian(ny, -0.09, 0.18) *
          frontMask;
        pz += cheekMask * (0.011 - animeFactor * 0.003) * headS;
        px += Math.sign(nx) * cheekMask * 0.0035 * headS;

        // Relaxed Sculpted Vermilion Lips + Thin Horizontal Parting Seam (opens cleanly on aa/oh/ou!)
        const mouthSpan = gaussian(nx, 0, 0.27) * frontMask;
        const cupidsBow = Math.exp(-Math.pow((Math.abs(nx) - 0.068) / 0.045, 2));
        const philtrum = gaussian(nx, 0, 0.036) * gaussian(ny, -0.272, 0.038) * frontMask;
        const cornerDimple =
          (gaussian(nx, 0.265, 0.048) + gaussian(nx, -0.265, 0.048)) *
          gaussian(ny, -0.386, 0.03) *
          frontMask;
        const upperLip =
          mouthSpan *
          gaussian(ny, -0.352 + cupidsBow * 0.008, 0.026) *
          (0.9 + 0.2 * cupidsBow);
        const lowerLip =
          gaussian(nx, 0, 0.235) * frontMask * gaussian(ny, -0.42, 0.032);

        // Thin horizontal lip seam at rest (deepens smoothly under aa/oh/ou/surprised morphs)
        mouthInteriorMask =
          gaussian(nx, 0, 0.22) * gaussian(ny, -0.386, 0.0105) * frontMask;

        pz -= philtrum * 0.0025 * headS;
        pz -= cornerDimple * 0.0038 * headS;
        pz += (upperLip * 0.0068 + lowerLip * 0.0074) * headS;
        pz -= mouthInteriorMask * 0.006 * headS;

        const chin = gaussian(nx, 0, 0.24) * gaussian(ny, -0.78, 0.17) * frontMask;
        pz += chin * 0.013 * headS;
        py -= chin * 0.004 * headS;
      }

      // Smooth C1 Tapered Jawline across side-to-front transition (zero hard discontinuity at nz=0.14!)
      const jawFrontBlend = smoothstep(-0.22, 0.36, nz);
      const jawT = smoothstep(-0.02, -0.84, ny) * jawFrontBlend;
      const taper = isFem ? 0.27 : 0.18;
      px *= 1 - jawT * (taper + animeFactor * 0.06);
      pz *= 1 - jawT * 0.14;

      const underChinBlend = smoothstep(0.32, -0.25, nz) * smoothstep(-0.66, -0.95, ny);
      if (underChinBlend > 0) {
        py += 0.009 * underChinBlend * headS;
      }

      // Morph-target region tagging
      let tag: FaceRegionTag = 'none';
      if (nz > 0.35) {
        if (ny >= 0.17 && ny <= 0.34 && Math.abs(nx) <= 0.56) {
          if (nx > 0.05 && nx < 0.28) tag = 'brow_inner_l';
          else if (nx >= 0.28) tag = 'brow_outer_l';
          else if (nx < -0.05 && nx > -0.28) tag = 'brow_inner_r';
          else if (nx <= -0.28) tag = 'brow_outer_r';
        } else if (ny > -0.04 && ny < 0.18 && Math.abs(nx) > 0.14 && Math.abs(nx) < 0.54) {
          if (nx > 0) tag = ny > 0.07 ? 'eyelid_upper_l' : 'eyelid_lower_l';
          else tag = ny > 0.07 ? 'eyelid_upper_r' : 'eyelid_lower_r';
        } else if (ny >= -0.28 && ny <= -0.02 && Math.abs(nx) > 0.26 && Math.abs(nx) < 0.64) {
          tag = nx > 0 ? 'cheek_l' : 'cheek_r';
        } else if (ny <= -0.28 && ny >= -0.54 && Math.abs(nx) <= 0.36) {
          if (nx > 0.17) tag = 'mouth_corner_l';
          else if (nx < -0.17) tag = 'mouth_corner_r';
          else tag = ny > -0.392 ? 'lip_upper' : 'lip_lower';
        } else if (ny < -0.54 && nz > 0.2) {
          tag = 'jaw_chin';
        }
      }

      // Rich facial vertex coloration: socket AO, cheek warmth, sculpted lips, dark recessed mouth cavity
      let vColor: [number, number, number, number] = [0.95, 0.94, 0.94, 1];
      if (nz > 0.24) {
        const socketAo =
          (gaussian(nx, 0.345, 0.16) * gaussian(ny, 0.072, 0.11) +
            gaussian(nx, -0.345, 0.16) * gaussian(ny, 0.072, 0.11)) *
          clamp01((nz - 0.24) / 0.45);
        const blush =
          gaussian(Math.abs(nx), 0.45, 0.2) *
          gaussian(ny, -0.1, 0.14) *
          clamp01((nz - 0.3) / 0.5);
        const lipMask =
          gaussian(nx, 0, 0.245) *
          (gaussian(ny, -0.352, 0.024) + gaussian(ny, -0.42, 0.029)) *
          clamp01((nz - 0.35) / 0.4);
        const noseShadow =
          (gaussian(nx, 0, 0.11) * gaussian(ny, -0.188, 0.042) +
            (gaussian(nx, 0.08, 0.033) + gaussian(nx, -0.08, 0.033)) *
              gaussian(ny, -0.195, 0.028)) *
          clamp01((nz - 0.35) / 0.4);
        const chinAo = ny < -0.58 ? clamp01((-ny - 0.58) / 0.3) * 0.13 : 0;

        let cr = 0.95 - socketAo * 0.12 + blush * 0.045 - noseShadow * 0.1 - chinAo;
        let cg = 0.94 - socketAo * 0.15 - blush * 0.04 - noseShadow * 0.12 - chinAo;
        let cb = 0.94 - socketAo * 0.13 - blush * 0.03 - noseShadow * 0.11 - chinAo;

        const lipStrength = clamp01(lipMask) * (isFem ? 0.62 : 0.34);
        if (lipStrength > 0.01) {
          const lipR = isDarkElf ? 0.66 : 0.82;
          const lipG = isDarkElf ? 0.42 : 0.52;
          const lipB = isDarkElf ? 0.6 : 0.54;
          cr = cr * (1 - lipStrength) + lipR * lipStrength;
          cg = cg * (1 - lipStrength) + lipG * lipStrength;
          cb = cb * (1 - lipStrength) + lipB * lipStrength;
        }

        // Subtle dark lip parting line at rest (widens cleanly when open morphs lift upper/drop lower lips)
        const cavityAmt = clamp01(mouthInteriorMask * 1.15) * 0.72;
        if (cavityAmt > 0.01) {
          cr = cr * (1 - cavityAmt) + 0.25 * cavityAmt;
          cg = cg * (1 - cavityAmt) + 0.12 * cavityAmt;
          cb = cb * (1 - cavityAmt) + 0.15 * cavityAmt;
        }

        vColor = [
          Math.max(0.14, Math.min(1, cr)),
          Math.max(0.08, Math.min(1, cg)),
          Math.max(0.1, Math.min(1, cb)),
          1,
        ];
      }

      const jawWeight = ny < -0.38 && nz > 0.15 ? 0.55 : 0.0;
      appendVertex(
        skinPrim,
        [headCenter[0] + px, headCenter[1] + py, headCenter[2] + pz],
        [nx, ny, nz],
        [u, v],
        [B('head'), B('jaw'), 0, 0],
        [1 - jawWeight, jawWeight, 0, 0],
        tag,
        vColor,
        [nx, ny, nz]
      );
    }
  }

  const stride = lon + 1;
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const a = startVert + i * stride + j;
      const b = a + stride;
      if (i > 0) skinPrim.indices.push(a, b, a + 1);
      if (i < lat - 1) skinPrim.indices.push(a + 1, b, b + 1);
    }
  }
  recomputeNormalsRange(skinPrim, startVert, startIdx);

  // Weld normals along back-of-head seam
  for (let i = 0; i <= lat; i++) {
    const v0 = startVert + i * stride;
    const vN = v0 + lon;
    const ax = skinPrim.normals[v0 * 3] + skinPrim.normals[vN * 3];
    const ay = skinPrim.normals[v0 * 3 + 1] + skinPrim.normals[vN * 3 + 1];
    const az = skinPrim.normals[v0 * 3 + 2] + skinPrim.normals[vN * 3 + 2];
    const len = Math.hypot(ax, ay, az) || 1;
    skinPrim.normals[v0 * 3] = ax / len;
    skinPrim.normals[v0 * 3 + 1] = ay / len;
    skinPrim.normals[v0 * 3 + 2] = az / len;
    skinPrim.normals[vN * 3] = ax / len;
    skinPrim.normals[vN * 3 + 1] = ay / len;
    skinPrim.normals[vN * 3 + 2] = az / len;
  }

  // 3. Recessed Eyeballs, 3D Folded Upper/Lower Eyelids & Coordinated Eyebrows
  const eyeScale = (1.0 + animeFactor * 0.22) * headS;
  const eyeR = 0.016 * eyeScale;
  for (const side of [1, -1] as const) {
    const eyeBoneName = side > 0 ? 'leftEye' : 'rightEye';
    const eyeX = side * 0.0315 * headS;
    const eyeY = headCenter[1] + 0.0085 * headS;
    const eyeZ = headCenter[2] + 0.0745 * headS;

    const eLat = 16;
    const eLon = 20;
    const eStart = eyePrim.positions.length / 3;
    const eIdxStart = eyePrim.indices.length;
    for (let i = 0; i <= eLat; i++) {
      const ev = i / eLat;
      const phi = ev * Math.PI;
      for (let j = 0; j <= eLon; j++) {
        const eu = j / eLon;
        const theta = eu * Math.PI * 2;
        const enx = Math.sin(phi) * Math.sin(theta);
        const eny = Math.cos(phi);
        const enz = Math.sin(phi) * Math.cos(theta);
        const flatZ = enz > 0.4 ? enz * eyeR * 0.88 : enz * eyeR;
        const uvScale = 0.64 - animeFactor * 0.07;
        const irisUvU = 0.5 + enx * uvScale;
        const irisUvV = 0.5 - eny * uvScale;
        appendVertex(
          eyePrim,
          [eyeX + enx * eyeR, eyeY + eny * eyeR * 0.94, eyeZ + flatZ],
          [enx, eny, enz],
          enz > 0 ? [irisUvU, irisUvV] : [0.05, 0.05],
          [B(eyeBoneName), B('head'), 0, 0],
          [0.95, 0.05, 0, 0],
          enz > 0.35 ? (side > 0 ? 'iris_l' : 'iris_r') : 'none'
        );
      }
    }
    const eStride = eLon + 1;
    for (let i = 0; i < eLat; i++) {
      for (let j = 0; j < eLon; j++) {
        const a = eStart + i * eStride + j;
        const b = a + eStride;
        if (i > 0) eyePrim.indices.push(a, b, a + 1);
        if (i < eLat - 1) eyePrim.indices.push(a + 1, b, b + 1);
      }
    }
    recomputeNormalsRange(eyePrim, eStart, eIdxStart);

    appendSculpted3DEyelids(
      skinPrim,
      hairPrim,
      headCenter,
      [eyeX, eyeY, eyeZ],
      eyeR,
      side,
      headS,
      animeFactor,
      B('head')
    );

    // Sculpted Eyebrow Arch harmonized softly with character hair color
    const browColor: [number, number, number] = isDarkElf
      ? [0.58, 0.56, 0.66]
      : spec.hairStyle === 'short_crop' && !isFem
        ? [0.42, 0.38, 0.36]
        : [0.64, 0.6, 0.62];
    appendCurvedHairStrand(
      hairPrim,
      [
        { pos: [eyeX - side * 0.016 * headS, eyeY + 0.0175 * headS, eyeZ + 0.0165 * headS], width: 0.0024 * headS, thickness: 0.0014 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
        { pos: [eyeX + side * 0.003 * headS, eyeY + 0.0215 * headS, eyeZ + 0.0175 * headS], width: 0.0022 * headS, thickness: 0.0013 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
        { pos: [eyeX + side * 0.022 * headS, eyeY + 0.017 * headS, eyeZ + 0.0075 * headS], width: 0.0009 * headS, thickness: 0.0007 * headS, boneA: B('head'), boneB: B('head'), weightA: 1 },
      ],
      8,
      0,
      browColor,
      browColor,
      [0, 0.2, 1]
    );
  }

  // 4. Sculpted Ears (Concave Concha Pinna & Helix for Human or Swept Sculpted Elven Ears)
  for (const sign of [1, -1] as const) {
    const earBaseX = sign * rxBase * 0.94;
    const earBaseY = headCenter[1] - 0.005 * headS;
    const earBaseZ = headCenter[2] - 0.009 * headS;

    if (spec.features.earStyle === 'pointed_elf' || spec.features.earStyle === 'long_elf') {
      const earLen = spec.features.earStyle === 'long_elf' ? 0.105 : 0.07;
      appendAnatomicalLoft(
        skinPrim,
        [
          {
            center: [earBaseX, earBaseY, earBaseZ],
            rx: 0.013 * headS,
            rz: 0.016 * headS,
            boneA: B('head'),
            boneB: B('head'),
            weightA: 1,
            axis: 'x',
            color: [0.88, 0.85, 0.87, 1],
          },
          {
            center: [earBaseX + sign * earLen * 0.36 * headS, earBaseY + 0.013 * headS, earBaseZ - 0.015 * headS],
            rx: 0.0105 * headS,
            rz: 0.0145 * headS,
            boneA: B('head'),
            boneB: B('head'),
            weightA: 1,
            axis: 'x',
            color: [0.91, 0.88, 0.9, 1],
            contourFn: (c, s) => ({
              dx: s > 0.2 ? -sign * 0.004 * s : 0,
              dy: c > 0.4 ? 0.002 : 0,
            }),
          },
          {
            center: [earBaseX + sign * earLen * 0.74 * headS, earBaseY + 0.031 * headS, earBaseZ - 0.031 * headS],
            rx: 0.0058 * headS,
            rz: 0.0075 * headS,
            boneA: B('head'),
            boneB: B('head'),
            weightA: 1,
            axis: 'x',
            color: [0.94, 0.91, 0.93, 1],
          },
          {
            center: [earBaseX + sign * earLen * headS, earBaseY + 0.047 * headS, earBaseZ - 0.044 * headS],
            rx: 0.0014 * headS,
            rz: 0.0018 * headS,
            boneA: B('head'),
            boneB: B('head'),
            weightA: 1,
            axis: 'x',
            color: [0.96, 0.92, 0.95, 1],
          },
        ],
        12,
        true
      );
    } else {
      appendAnatomicalLoft(
        skinPrim,
        [
          { center: [earBaseX - sign * 0.003, earBaseY - 0.014 * headS, earBaseZ], rx: 0.011 * headS, rz: 0.0085 * headS, boneA: B('head'), boneB: B('head'), weightA: 1, axis: 'x', color: [0.9, 0.87, 0.87, 1] },
          {
            center: [earBaseX + sign * 0.007 * headS, earBaseY, earBaseZ - 0.003],
            rx: 0.019 * headS,
            rz: 0.0135 * headS,
            boneA: B('head'),
            boneB: B('head'),
            weightA: 1,
            axis: 'x',
            color: [0.93, 0.9, 0.9, 1],
            contourFn: (_c, s) => ({ dx: s > 0.25 ? -sign * 0.0035 * s : 0 }),
          },
          { center: [earBaseX + sign * 0.011 * headS, earBaseY + 0.014 * headS, earBaseZ - 0.005], rx: 0.015 * headS, rz: 0.0105 * headS, boneA: B('head'), boneB: B('head'), weightA: 1, axis: 'x', color: [0.95, 0.92, 0.92, 1] },
          { center: [earBaseX + sign * 0.003 * headS, earBaseY + 0.022 * headS, earBaseZ - 0.003], rx: 0.0055 * headS, rz: 0.0045 * headS, boneA: B('head'), boneB: B('head'), weightA: 1, axis: 'x', color: [0.95, 0.92, 0.92, 1] },
        ],
        12,
        true
      );
    }
  }

  return headCenter;
}
