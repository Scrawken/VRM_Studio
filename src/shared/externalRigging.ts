import { BoneDef } from './anatomicalSculptor';
import {
  CharacterSpecification,
  ImportedMorphTargetData,
  ImportedSkinData,
  ParsedGlbAsset,
  VRM_EXPRESSION_PRESETS,
  VRM_REQUIRED_HUMANOID_BONES,
} from './types';

export interface JointDeformationAudit {
  joint: 'shoulder' | 'elbow' | 'hip' | 'knee' | 'neck';
  influencedVertices: number;
  blendedTransitionVertices: number;
  maxRotationTestDelta: number;
  passed: boolean;
}

export interface ExternalRiggingAudit {
  mode: 'preserved_existing_rig' | 'generated_humanoid_rig';
  weightsNormalized: boolean;
  maxWeightSumError: number;
  weightedVertices: number;
  totalVertices: number;
  mappedVrmBones: string[];
  missingVrmBones: string[];
  jointDeformations: JointDeformationAudit[];
  allJointDeformationsPassed: boolean;
  preservedMaterialCount: number;
  preservedTextureCount: number;
  preservedImageCount: number;
  preservedMorphCount: number;
  synthesizedMorphCount: number;
  activeNonEmptyExpressions: string[];
}

interface BoneSegmentDef {
  boneIndex: number;
  boneName: string;
  head: [number, number, number];
  tail: [number, number, number];
  radius: number;
  side: 'center' | 'left' | 'right';
  zone: 'spine' | 'neck_head' | 'arm' | 'hand' | 'leg' | 'foot';
}

const CANONICAL_BONE_ALIASES: Record<string, string[]> = {
  hips: ['hips', 'hip', 'pelvis', 'root_hips', 'mixamorighips', 'bip01pelvis', 'cog'],
  spine: ['spine', 'spine01', 'spine_01', 'spine1', 'abdomen', 'mixamorigspine', 'bip01spine'],
  chest: ['chest', 'spine02', 'spine_02', 'spine2', 'ribcage', 'thorax', 'mixamorigspine1', 'mixamorigspine2', 'bip01spine1'],
  upperChest: ['upperchest', 'upper_chest', 'spine03', 'spine_03', 'spine3', 'mixamorigspine2', 'bip01spine2'],
  neck: ['neck', 'neck01', 'neck_01', 'mixamorigneck', 'bip01neck'],
  head: ['head', 'headtop', 'mixamorighead', 'bip01head'],
  leftEye: ['lefteye', 'eye_l', 'eye.l', 'l_eye', 'mixamoriglefteye'],
  rightEye: ['righteye', 'eye_r', 'eye.r', 'r_eye', 'mixamorigrighteye'],
  jaw: ['jaw', 'chin', 'mixamorigjaw'],
  leftShoulder: ['leftshoulder', 'shoulder_l', 'shoulder.l', 'clavicle_l', 'clavicle.l', 'l_clavicle', 'mixamorigleftshoulder', 'bip01lclavicle'],
  leftUpperArm: ['leftupperarm', 'upperarm_l', 'upper_arm.l', 'upper_arm_l', 'arm_l', 'l_upperarm', 'mixamorigleftarm', 'bip01lupperarm'],
  leftLowerArm: ['leftlowerarm', 'lowerarm_l', 'forearm.l', 'forearm_l', 'lower_arm.l', 'l_forearm', 'mixamorigleftforearm', 'bip01lforearm'],
  leftHand: ['lefthand', 'hand_l', 'hand.l', 'wrist_l', 'l_hand', 'mixamoriglefthand', 'bip01lhand'],
  rightShoulder: ['rightshoulder', 'shoulder_r', 'shoulder.r', 'clavicle_r', 'clavicle.r', 'r_clavicle', 'mixamorigrightshoulder', 'bip01rclavicle'],
  rightUpperArm: ['rightupperarm', 'upperarm_r', 'upper_arm.r', 'upper_arm_r', 'arm_r', 'r_upperarm', 'mixamorigrightarm', 'bip01rupperarm'],
  rightLowerArm: ['rightlowerarm', 'lowerarm_r', 'forearm.r', 'forearm_r', 'lower_arm.r', 'r_forearm', 'mixamorigrightforearm', 'bip01rforearm'],
  rightHand: ['righthand', 'hand_r', 'hand.r', 'wrist_r', 'r_hand', 'mixamorigrighthand', 'bip01rhand'],
  leftUpperLeg: ['leftupperleg', 'upperleg_l', 'thigh.l', 'thigh_l', 'l_thigh', 'mixamorigleftupleg', 'bip01lthigh'],
  leftLowerLeg: ['leftlowerleg', 'lowerleg_l', 'shin.l', 'shin_l', 'calf_l', 'l_calf', 'mixamorigleftleg', 'bip01lcalf'],
  leftFoot: ['leftfoot', 'foot_l', 'foot.l', 'ankle_l', 'l_foot', 'mixamorigleftfoot', 'bip01lfoot'],
  leftToes: ['lefttoes', 'toe_l', 'toes.l', 'l_toe', 'mixamoriglefttoebase', 'bip01ltoe0'],
  rightUpperLeg: ['rightupperleg', 'upperleg_r', 'thigh.r', 'thigh_r', 'r_thigh', 'mixamorigrightupleg', 'bip01rthigh'],
  rightLowerLeg: ['rightlowerleg', 'lowerleg_r', 'shin.r', 'shin_r', 'calf_r', 'r_calf', 'mixamorigrightleg', 'bip01rcalf'],
  rightFoot: ['rightfoot', 'foot_r', 'foot.r', 'ankle_r', 'r_foot', 'mixamorigrightfoot', 'bip01rfoot'],
  rightToes: ['righttoes', 'toe_r', 'toes.r', 'r_toe', 'mixamorigrighttoebase', 'bip01rtoe0'],
};

function normalizeBoneToken(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._]/g, '').replace(/mixamorig:/g, 'mixamorig');
}

export function mapExistingSkinToVrmHumanoid(
  skin: ImportedSkinData,
  existingVrmHumanoid?: Record<string, string>
): {
  humanBoneToJointIndex: Record<string, number>;
  missingRequired: string[];
  allRequiredPresent: boolean;
} {
  const humanBoneToJointIndex: Record<string, number> = {};
  const usedJoints = new Set<number>();

  // 1. Honor explicit VRMC_vrm mapping if already encoded in source GLB
  if (existingVrmHumanoid) {
    for (const [vrmBone, nodeName] of Object.entries(existingVrmHumanoid)) {
      const idx = skin.joints.findIndex((j) => j.name === nodeName);
      if (idx >= 0 && !usedJoints.has(idx)) {
        humanBoneToJointIndex[vrmBone] = idx;
        usedJoints.add(idx);
      }
    }
  }

  // 2. Match canonical / Mixamo / Rigify / UE names for any unmapped bones
  const normalizedJointNames = skin.joints.map((j) => normalizeBoneToken(j.name));
  for (const [vrmBone, aliases] of Object.entries(CANONICAL_BONE_ALIASES)) {
    if (humanBoneToJointIndex[vrmBone] !== undefined) continue;
    let foundIdx = -1;
    // Exact normalized match first
    for (let j = 0; j < normalizedJointNames.length; j++) {
      if (usedJoints.has(j)) continue;
      const stripped = normalizedJointNames[j].replace(/[._]/g, '');
      if (aliases.some((a) => a.replace(/[._]/g, '') === stripped)) {
        foundIdx = j;
        break;
      }
    }
    if (foundIdx >= 0) {
      humanBoneToJointIndex[vrmBone] = foundIdx;
      usedJoints.add(foundIdx);
    }
  }

  const missingRequired = VRM_REQUIRED_HUMANOID_BONES.filter(
    (req) => humanBoneToJointIndex[req] === undefined
  );

  return {
    humanBoneToJointIndex,
    missingRequired,
    allRequiredPresent: missingRequired.length === 0,
  };
}

/**
 * Computes mesh-driven skeletal bone landmarks for unrigged external humanoid GLBs
 * (automatically adapts to both T-pose and A-pose arms as well as hip/leg proportions).
 */
export function fitArmatureToExternalGeometry(
  spec: CharacterSpecification,
  asset: ParsedGlbAsset,
  baseHumanoidBones: BoneDef[]
): {
  bones: BoneDef[];
  scale: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  headCenterY: number;
  faceForwardSign: 1 | -1;
} {
  const [minX, minY, minZ] = asset.boundsMin;
  const [maxX, maxY, maxZ] = asset.boundsMax;
  const srcHeight = Math.max(0.001, maxY - minY);
  const targetHeight = spec.proportions.heightMeters;
  const scale = targetHeight / srcHeight;
  const offsetX = -(minX + maxX) * 0.5;
  const offsetY = -minY;
  const offsetZ = -(minZ + maxZ) * 0.5;

  // Scan normalized vertex cloud to detect arm pose (T vs A pose), shoulder X, hip X, leg columns
  const pos = asset.positions;
  const totalVerts = Math.floor(pos.length / 3);
  const stride = Math.max(1, Math.floor(totalVerts / 4000));

  let maxAbsXMid = 0;
  let leftElbowY = 0, leftElbowCount = 0;
  let rightElbowY = 0, rightElbowCount = 0;
  let leftWristY = 0, leftWristCount = 0;
  let rightWristY = 0, rightWristCount = 0;
  let torsoHalfW = 0.16;
  let hipColXSum = 0, hipColCount = 0;
  let headFrontZSum = 0, headFrontCount = 0;
  let headBackZSum = 0, headBackCount = 0;

  for (let i = 0; i < totalVerts; i += stride) {
    const x = (pos[i * 3] + offsetX) * scale;
    const y = (pos[i * 3 + 1] + offsetY) * scale;
    const z = (pos[i * 3 + 2] + offsetZ) * scale;
    const hNorm = y / targetHeight;
    const ax = Math.abs(x);

    if (hNorm >= 0.45 && hNorm <= 0.86) {
      if (ax > maxAbsXMid) maxAbsXMid = ax;
    }
    if (hNorm >= 0.58 && hNorm <= 0.72 && ax < 0.25) {
      torsoHalfW = Math.max(torsoHalfW, Math.min(0.22, ax));
    }
    if (hNorm >= 0.22 && hNorm <= 0.46 && ax > 0.02 && ax < 0.22) {
      hipColXSum += ax;
      hipColCount++;
    }
    if (hNorm >= 0.87 && hNorm <= 0.96) {
      if (z > 0.02) {
        headFrontZSum += z;
        headFrontCount++;
      } else if (z < -0.02) {
        headBackZSum += Math.abs(z);
        headBackCount++;
      }
    }
  }

  // Detect elbow & wrist heights in the lateral arm band
  const armOuterStart = Math.max(torsoHalfW * 0.95, maxAbsXMid * 0.36);
  const elbowBandMin = armOuterStart;
  const elbowBandMax = maxAbsXMid * 0.72;
  const wristBandMin = maxAbsXMid * 0.72;

  if (maxAbsXMid > 0.28) {
    for (let i = 0; i < totalVerts; i += stride) {
      const x = (pos[i * 3] + offsetX) * scale;
      const y = (pos[i * 3 + 1] + offsetY) * scale;
      const hNorm = y / targetHeight;
      if (hNorm < 0.35 || hNorm > 0.88) continue;
      const ax = Math.abs(x);
      if (ax >= elbowBandMin && ax < elbowBandMax) {
        if (x > 0) {
          leftElbowY += y;
          leftElbowCount++;
        } else {
          rightElbowY += y;
          rightElbowCount++;
        }
      } else if (ax >= wristBandMin) {
        if (x > 0) {
          leftWristY += y;
          leftWristCount++;
        } else {
          rightWristY += y;
          rightWristCount++;
        }
      }
    }
  }

  const fitted = baseHumanoidBones.map((b) => ({
    ...b,
    localPos: [...b.localPos] as [number, number, number],
    worldPos: [...b.worldPos] as [number, number, number],
  }));

  const byName = new Map<string, number>();
  fitted.forEach((b, i) => byName.set(b.name, i));

  // Adapt arm joints to detected silhouette if arms extend laterally
  if (maxAbsXMid > 0.30) {
    const shIdx = byName.get('leftShoulder');
    const shoulderY = shIdx !== undefined ? fitted[shIdx].worldPos[1] : targetHeight * 0.81;
    const upperArmX = Math.max(0.14, Math.min(0.22, armOuterStart * 0.92));
    const elbowX = Math.max(upperArmX + 0.14, Math.min(maxAbsXMid * 0.62, upperArmX + 0.29));
    const wristX = Math.max(elbowX + 0.14, Math.min(maxAbsXMid * 0.86, elbowX + 0.28));

    const lElbY = leftElbowCount > 3 ? leftElbowY / leftElbowCount : shoulderY - 0.015;
    const rElbY = rightElbowCount > 3 ? rightElbowY / rightElbowCount : shoulderY - 0.015;
    const lWrY = leftWristCount > 3 ? leftWristY / leftWristCount : lElbY;
    const rWrY = rightWristCount > 3 ? rightWristY / rightWristCount : rElbY;

    const adjustArm = (side: 'left' | 'right', sign: 1 | -1, elbY: number, wrY: number) => {
      const ua = byName.get(`${side}UpperArm`);
      const la = byName.get(`${side}LowerArm`);
      const ha = byName.get(`${side}Hand`);
      if (ua !== undefined) fitted[ua].worldPos = [sign * upperArmX, shoulderY, 0];
      if (la !== undefined) fitted[la].worldPos = [sign * elbowX, elbY, 0];
      if (ha !== undefined) fitted[ha].worldPos = [sign * wristX, wrY, 0];

      // Reposition finger chains rigidly relative to fitted wrist
      const fingerNames = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
      for (const fn of fingerNames) {
        const subNames =
          fn === 'Thumb'
            ? [`${side}ThumbMetacarpal`, `${side}ThumbProximal`, `${side}ThumbDistal`]
            : [`${side}${fn}Proximal`, `${side}${fn}Intermediate`, `${side}${fn}Distal`];
        const origWristX = byName.get(`${side}Hand`) !== undefined
          ? baseHumanoidBones[byName.get(`${side}Hand`)!].worldPos[0]
          : sign * 0.64;
        const origWristY = byName.get(`${side}Hand`) !== undefined
          ? baseHumanoidBones[byName.get(`${side}Hand`)!].worldPos[1]
          : shoulderY;
        const dx = sign * wristX - origWristX;
        const dy = wrY - origWristY;
        for (const sn of subNames) {
          const idx = byName.get(sn);
          if (idx !== undefined) {
            fitted[idx].worldPos = [
              fitted[idx].worldPos[0] + dx,
              fitted[idx].worldPos[1] + dy,
              fitted[idx].worldPos[2],
            ];
          }
        }
      }
    };

    adjustArm('left', 1, lElbY, lWrY);
    adjustArm('right', -1, rElbY, rWrY);
  }

  // Adapt leg column X slightly if silhouette indicates wider/narrower stance
  if (hipColCount > 6) {
    const legX = Math.max(0.075, Math.min(0.145, hipColXSum / hipColCount));
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? 1 : -1;
      for (const part of ['UpperLeg', 'LowerLeg', 'Foot', 'Toes']) {
        const idx = byName.get(`${side}${part}`);
        if (idx !== undefined) {
          fitted[idx].worldPos[0] = sign * legX;
        }
      }
    }
  }

  // Recompute exact localPos from fitted worldPos & parent hierarchy
  for (let i = 0; i < fitted.length; i++) {
    const pIdx = fitted[i].parent;
    const pWorld = pIdx >= 0 ? fitted[pIdx].worldPos : [0, 0, 0];
    fitted[i].localPos = [
      fitted[i].worldPos[0] - pWorld[0],
      fitted[i].worldPos[1] - pWorld[1],
      fitted[i].worldPos[2] - pWorld[2],
    ];
  }

  const headBoneIdx = byName.get('head') ?? 0;
  const headCenterY = fitted[headBoneIdx].worldPos[1] + 0.08 * spec.proportions.headScale;
  const avgFrontZ = headFrontCount > 0 ? headFrontZSum / headFrontCount : 0;
  const avgBackZ = headBackCount > 0 ? headBackZSum / headBackCount : 0;
  const faceForwardSign: 1 | -1 = avgBackZ > avgFrontZ * 1.18 ? -1 : 1;

  return {
    bones: fitted,
    scale,
    offsetX,
    offsetY,
    offsetZ,
    headCenterY,
    faceForwardSign,
  };
}

function pointToSegmentDistSq(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const vz = bz - az;
  const wx = px - ax;
  const wy = py - ay;
  const wz = pz - az;
  const lenSq = vx * vx + vy * vy + vz * vz;
  if (lenSq < 1e-8) {
    return wx * wx + wy * wy + wz * wz;
  }
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy + wz * vz) / lenSq));
  const cx = ax + vx * t;
  const cy = ay + vy * t;
  const cz = az + vz * t;
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  return dx * dx + dy * dy + dz * dz;
}

function buildBoneSegments(bones: BoneDef[]): BoneSegmentDef[] {
  const byName = new Map<string, number>();
  bones.forEach((b, i) => byName.set(b.name, i));

  const segs: BoneSegmentDef[] = [];
  const pushSeg = (
    name: string,
    tailNameOrPoint: string | [number, number, number],
    radius: number,
    side: BoneSegmentDef['side'],
    zone: BoneSegmentDef['zone']
  ) => {
    const idx = byName.get(name);
    if (idx === undefined) return;
    const head = bones[idx].worldPos;
    let tail: [number, number, number];
    if (typeof tailNameOrPoint === 'string') {
      const tIdx = byName.get(tailNameOrPoint);
      tail = tIdx !== undefined ? bones[tIdx].worldPos : head;
    } else {
      tail = [
        head[0] + tailNameOrPoint[0],
        head[1] + tailNameOrPoint[1],
        head[2] + tailNameOrPoint[2],
      ];
    }
    segs.push({ boneIndex: idx, boneName: name, head, tail, radius, side, zone });
  };

  pushSeg('hips', 'spine', 0.14, 'center', 'spine');
  pushSeg('spine', 'chest', 0.13, 'center', 'spine');
  pushSeg('chest', 'upperChest', 0.14, 'center', 'spine');
  pushSeg('upperChest', 'neck', 0.13, 'center', 'spine');
  pushSeg('neck', 'head', 0.06, 'center', 'neck_head');
  pushSeg('head', [0, 0.18, 0], 0.11, 'center', 'neck_head');

  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? 1 : -1;
    pushSeg(`${side}Shoulder`, `${side}UpperArm`, 0.075, side, 'arm');
    pushSeg(`${side}UpperArm`, `${side}LowerArm`, 0.068, side, 'arm');
    pushSeg(`${side}LowerArm`, `${side}Hand`, 0.056, side, 'arm');
    pushSeg(`${side}Hand`, [sign * 0.09, 0, 0], 0.048, side, 'hand');

    pushSeg(`${side}UpperLeg`, `${side}LowerLeg`, 0.095, side, 'leg');
    pushSeg(`${side}LowerLeg`, `${side}Foot`, 0.072, side, 'leg');
    pushSeg(`${side}Foot`, `${side}Toes`, 0.06, side, 'foot');
    pushSeg(`${side}Toes`, [0, -0.01, 0.05], 0.045, side, 'foot');
  }

  return segs;
}

/**
 * Production skin weighting algorithm combining:
 * 1. Bone-segment capsule distances (rather than point-only bone centers).
 * 2. Anatomical lateral/vertical partitioning (prevents leg-to-leg and arm-to-torso bleeding).
 * 3. Multi-pass mesh-topology Laplacian weight smoothing across triangle edges & UV seams.
 * 4. Strict 4-bone top selection, normalization check, and 5-joint deformation audit.
 */
export function computeLaplacianCapsuleSkinWeights(
  positions: Float32Array,
  indices: Uint32Array,
  bones: BoneDef[],
  heightMeters: number
): {
  joints: Uint16Array;
  weights: Float32Array;
  maxWeightSumError: number;
  jointDeformations: JointDeformationAudit[];
} {
  const vertCount = Math.floor(positions.length / 3);
  const segs = buildBoneSegments(bones);
  const byName = new Map<string, number>();
  bones.forEach((b, i) => byName.set(b.name, i));

  const hipsIdx = byName.get('hips') ?? 0;
  const hipsY = bones[hipsIdx]?.worldPos[1] ?? heightMeters * 0.52;
  const neckIdx = byName.get('neck') ?? 0;
  const neckY = bones[neckIdx]?.worldPos[1] ?? heightMeters * 0.84;
  const lUpperArmPos = bones[byName.get('leftUpperArm') ?? 0]?.worldPos ?? [0.16, heightMeters * 0.8, 0];
  const shoulderXGate = Math.max(0.11, Math.abs(lUpperArmPos[0]) * 0.84);

  const jointSlot = new Uint16Array(vertCount * 4);
  const weightSlot = new Float32Array(vertCount * 4);

  // Step 1: Anatomical capsule affinity initialization
  const boneCount = bones.length;
  const rawScores = new Float32Array(boneCount);

  for (let v = 0; v < vertCount; v++) {
    const px = positions[v * 3];
    const py = positions[v * 3 + 1];
    const pz = positions[v * 3 + 2];

    const isLegRegion = py < hipsY - 0.025;
    const isArmLateral = Math.abs(px) > shoulderXGate && py > hipsY - 0.12 && py < neckY + 0.08;
    const isHeadNeckRegion = py >= neckY - 0.02;

    rawScores.fill(0);
    for (const seg of segs) {
      // Lateral limb isolation
      if (seg.side === 'left' && px < -0.028) continue;
      if (seg.side === 'right' && px > 0.028) continue;

      // Zone compatibility multipliers
      let zoneMult = 1.0;
      if (isLegRegion && (seg.zone === 'arm' || seg.zone === 'hand' || seg.zone === 'neck_head')) {
        zoneMult = 0.02;
      } else if (isArmLateral && (seg.zone === 'spine' || seg.zone === 'leg' || seg.zone === 'foot')) {
        zoneMult = 0.08;
      } else if (isHeadNeckRegion && (seg.zone === 'leg' || seg.zone === 'foot' || seg.zone === 'hand')) {
        zoneMult = 0.01;
      }

      const dSq = pointToSegmentDistSq(
        px,
        py,
        pz,
        seg.head[0],
        seg.head[1],
        seg.head[2],
        seg.tail[0],
        seg.tail[1],
        seg.tail[2]
      );
      const sigma = Math.max(0.035, seg.radius * 1.18);
      const score = zoneMult * Math.exp(-dSq / (sigma * sigma));
      if (score > rawScores[seg.boneIndex]) {
        rawScores[seg.boneIndex] = score;
      }
    }

    // Pick top 4 bone influences
    const topIdx = [0, 0, 0, 0];
    const topVal = [0, 0, 0, 0];
    for (let b = 0; b < boneCount; b++) {
      const s = rawScores[b];
      if (s <= 1e-7) continue;
      if (s > topVal[0]) {
        topVal[3] = topVal[2]; topIdx[3] = topIdx[2];
        topVal[2] = topVal[1]; topIdx[2] = topIdx[1];
        topVal[1] = topVal[0]; topIdx[1] = topIdx[0];
        topVal[0] = s; topIdx[0] = b;
      } else if (s > topVal[1]) {
        topVal[3] = topVal[2]; topIdx[3] = topIdx[2];
        topVal[2] = topVal[1]; topIdx[2] = topIdx[1];
        topVal[1] = s; topIdx[1] = b;
      } else if (s > topVal[2]) {
        topVal[3] = topVal[2]; topIdx[3] = topIdx[2];
        topVal[2] = s; topIdx[2] = b;
      } else if (s > topVal[3]) {
        topVal[3] = s; topIdx[3] = b;
      }
    }

    const sum = topVal[0] + topVal[1] + topVal[2] + topVal[3];
    if (sum > 1e-8) {
      for (let k = 0; k < 4; k++) {
        jointSlot[v * 4 + k] = topIdx[k];
        weightSlot[v * 4 + k] = topVal[k] / sum;
      }
    } else {
      // Fallback to nearest bone center cleanly
      let best = hipsIdx;
      let bestD = Infinity;
      for (const seg of segs) {
        const dSq = pointToSegmentDistSq(
          px, py, pz,
          seg.head[0], seg.head[1], seg.head[2],
          seg.tail[0], seg.tail[1], seg.tail[2]
        );
        if (dSq < bestD) {
          bestD = dSq;
          best = seg.boneIndex;
        }
      }
      jointSlot[v * 4] = best;
      weightSlot[v * 4] = 1.0;
    }
  }

  // Step 2: Build mesh-topology adjacency (edges + spatial UV seam weld)
  const neighbors: number[][] = Array.from({ length: vertCount }, () => []);
  const addEdge = (a: number, b: number) => {
    if (a === b || a >= vertCount || b >= vertCount) return;
    if (neighbors[a].length < 16 && !neighbors[a].includes(b)) neighbors[a].push(b);
    if (neighbors[b].length < 16 && !neighbors[b].includes(a)) neighbors[b].push(a);
  };
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  // Spatial weld across UV seams so split edges smooth uniformly
  const spatialMap = new Map<string, number>();
  for (let v = 0; v < vertCount; v++) {
    const key = `${Math.round(positions[v * 3] * 500)}:${Math.round(positions[v * 3 + 1] * 500)}:${Math.round(positions[v * 3 + 2] * 500)}`;
    const first = spatialMap.get(key);
    if (first !== undefined) {
      addEdge(v, first);
    } else {
      spatialMap.set(key, v);
    }
  }

  // Step 3: 3-pass Laplacian topology diffusion preserving top-4 normalized weights
  let curJ = jointSlot;
  let curW = weightSlot;
  const accum = new Float32Array(boneCount);

  for (let pass = 0; pass < 3; pass++) {
    const nextJ = new Uint16Array(vertCount * 4);
    const nextW = new Float32Array(vertCount * 4);
    for (let v = 0; v < vertCount; v++) {
      const nb = neighbors[v];
      if (nb.length === 0) {
        for (let k = 0; k < 4; k++) {
          nextJ[v * 4 + k] = curJ[v * 4 + k];
          nextW[v * 4 + k] = curW[v * 4 + k];
        }
        continue;
      }

      accum.fill(0);
      for (let k = 0; k < 4; k++) {
        const w = curW[v * 4 + k];
        if (w > 0) accum[curJ[v * 4 + k]] += w * 0.62;
      }
      const nbScale = 0.38 / nb.length;
      for (const u of nb) {
        for (let k = 0; k < 4; k++) {
          const w = curW[u * 4 + k];
          if (w > 0) accum[curJ[u * 4 + k]] += w * nbScale;
        }
      }

      // Extract top 4
      const topIdx = [0, 0, 0, 0];
      const topVal = [0, 0, 0, 0];
      for (let b = 0; b < boneCount; b++) {
        const s = accum[b];
        if (s <= 1e-6) continue;
        if (s > topVal[0]) {
          topVal[3] = topVal[2]; topIdx[3] = topIdx[2];
          topVal[2] = topVal[1]; topIdx[2] = topIdx[1];
          topVal[1] = topVal[0]; topIdx[1] = topIdx[0];
          topVal[0] = s; topIdx[0] = b;
        } else if (s > topVal[1]) {
          topVal[3] = topVal[2]; topIdx[3] = topIdx[2];
          topVal[2] = topVal[1]; topIdx[2] = topIdx[1];
          topVal[1] = s; topIdx[1] = b;
        } else if (s > topVal[2]) {
          topVal[3] = topVal[2]; topIdx[3] = topIdx[2];
          topVal[2] = s; topIdx[2] = b;
        } else if (s > topVal[3]) {
          topVal[3] = s; topIdx[3] = b;
        }
      }

      const sum = topVal[0] + topVal[1] + topVal[2] + topVal[3];
      if (sum > 1e-8) {
        for (let k = 0; k < 4; k++) {
          nextJ[v * 4 + k] = topIdx[k];
          nextW[v * 4 + k] = topVal[k] / sum;
        }
      } else {
        for (let k = 0; k < 4; k++) {
          nextJ[v * 4 + k] = curJ[v * 4 + k];
          nextW[v * 4 + k] = curW[v * 4 + k];
        }
      }
    }
    curJ = nextJ;
    curW = nextW;
  }

  // Step 4: Final normalization error check + joint deformation audit
  let maxWeightSumError = 0;
  for (let v = 0; v < vertCount; v++) {
    const sum = curW[v * 4] + curW[v * 4 + 1] + curW[v * 4 + 2] + curW[v * 4 + 3];
    const err = Math.abs(sum - 1.0);
    if (err > maxWeightSumError) maxWeightSumError = err;
  }

  const jointDeformations = auditJointDeformations(positions, curJ, curW, (jointName) =>
    byName.get(jointName)
  );

  return {
    joints: curJ,
    weights: curW,
    maxWeightSumError,
    jointDeformations,
  };
}

export function auditJointDeformations(
  positions: Float32Array,
  joints: ArrayLike<number>,
  weights: Float32Array,
  resolveJointIndex: (vrmBoneName: string) => number | undefined,
  boneWorldPosResolver?: (jointIdx: number) => [number, number, number]
): JointDeformationAudit[] {
  const vertCount = Math.floor(positions.length / 3);
  const targets: Array<{ joint: JointDeformationAudit['joint']; boneNames: string[] }> = [
    { joint: 'shoulder', boneNames: ['leftUpperArm', 'rightUpperArm', 'leftShoulder', 'rightShoulder'] },
    { joint: 'elbow', boneNames: ['leftLowerArm', 'rightLowerArm'] },
    { joint: 'hip', boneNames: ['leftUpperLeg', 'rightUpperLeg', 'hips'] },
    { joint: 'knee', boneNames: ['leftLowerLeg', 'rightLowerLeg'] },
    { joint: 'neck', boneNames: ['neck', 'head'] },
  ];

  const angle = 0.35; // radians test rotation
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  return targets.map((t) => {
    const resolvedIndices = t.boneNames
      .map((n) => resolveJointIndex(n))
      .filter((idx): idx is number => idx !== undefined);
    const idxSet = new Set(resolvedIndices);

    let influencedVertices = 0;
    let blendedTransitionVertices = 0;
    let maxRotationTestDelta = 0;

    if (idxSet.size > 0) {
      const pivotIdx = resolvedIndices[0];
      const pivot = boneWorldPosResolver ? boneWorldPosResolver(pivotIdx) : [0, 1.0, 0];
      for (let v = 0; v < vertCount; v++) {
        let jointWeight = 0;
        let maxW = 0;
        for (let k = 0; k < 4; k++) {
          const j = joints[v * 4 + k];
          const w = weights[v * 4 + k];
          if (w > maxW) maxW = w;
          if (idxSet.has(j)) jointWeight += w;
        }
        if (jointWeight > 0.02) {
          influencedVertices++;
          if (jointWeight > 0.05 && jointWeight < 0.95) {
            blendedTransitionVertices++;
          }
          // Compute simulated LBS linear displacement under a test Z-axis rotation around joint pivot
          const rx = positions[v * 3] - pivot[0];
          const ry = positions[v * 3 + 1] - pivot[1];
          const dx = (rx * cosA - ry * sinA - rx) * jointWeight;
          const dy = (rx * sinA + ry * cosA - ry) * jointWeight;
          const d = Math.hypot(dx, dy);
          if (d > maxRotationTestDelta) maxRotationTestDelta = d;
        }
      }
    }

    return {
      joint: t.joint,
      influencedVertices,
      blendedTransitionVertices,
      maxRotationTestDelta: Number(maxRotationTestDelta.toFixed(5)),
      passed: influencedVertices > 0 && maxRotationTestDelta > 0.0005,
    };
  });
}

const MORPH_PRESET_SYNONYMS: Record<string, string[]> = {
  blink: ['blink', 'eyeblink', 'eye_blink', 'eyes_closed', 'blink_both'],
  blinkLeft: ['blinkleft', 'eyeblinkleft', 'eye_blink_l', 'blink_l', 'wink_l', 'winkleft'],
  blinkRight: ['blinkright', 'eyeblinkright', 'eye_blink_r', 'blink_r', 'wink_r', 'winkright'],
  happy: ['happy', 'smile', 'joy', 'fun', 'mouthsmile'],
  angry: ['angry', 'anger', 'mad', 'browdown'],
  sad: ['sad', 'sorrow', 'frown'],
  relaxed: ['relaxed', 'calm', 'soft'],
  surprised: ['surprised', 'surprise', 'shock', 'jawopen'],
  aa: ['aa', 'vrc.v_aa', 'viseme_aa', 'a', 'mouth_a'],
  ih: ['ih', 'vrc.v_ih', 'viseme_ih', 'i', 'mouth_i'],
  ou: ['ou', 'vrc.v_ou', 'viseme_ou', 'u', 'mouth_u'],
  ee: ['ee', 'vrc.v_ee', 'viseme_ee', 'e', 'mouth_e'],
  oh: ['oh', 'vrc.v_oh', 'viseme_oh', 'o', 'mouth_o'],
  lookUp: ['lookup', 'look_up'],
  lookDown: ['lookdown', 'look_down'],
  lookLeft: ['lookleft', 'look_left'],
  lookRight: ['lookright', 'look_right'],
};

function matchMorphTargetToPreset(morphName: string): string | null {
  const norm = morphName.toLowerCase().replace(/[^a-z0-9._]/g, '');
  for (const [preset, syns] of Object.entries(MORPH_PRESET_SYNONYMS)) {
    if (syns.some((s) => norm === s || norm.includes(s))) {
      return preset;
    }
  }
  return null;
}

function morphTargetMagnitude(deltas: Float32Array): number {
  let maxMag = 0;
  for (let i = 0; i < deltas.length; i += 3) {
    const m = Math.abs(deltas[i]) + Math.abs(deltas[i + 1]) + Math.abs(deltas[i + 2]);
    if (m > maxMag) maxMag = m;
  }
  return maxMag;
}

/**
 * Preserves existing non-zero facial morph targets from external GLBs and synthesizes
 * localized cranial/facial expression vertex deltas for missing required VRM presets
 * (`blink`, `blinkLeft`, `blinkRight`, `happy`, `angry`, `sad`, `surprised`, etc.).
 */
export function buildOrPreserveMorphTargetsForExternalPrimitive(
  positions: Float32Array,
  existingMorphs: ImportedMorphTargetData[],
  morphDeltaScale: number,
  headBoneY: number,
  headCenterY: number,
  headScale: number,
  faceForwardSign: 1 | -1
): {
  targets: Array<{ name: string; deltas: Float32Array; wasPreserved: boolean }>;
  presetToTargetIndex: Record<string, number>;
  preservedCount: number;
  synthesizedCount: number;
} {
  const vertCount = Math.floor(positions.length / 3);
  const targets: Array<{ name: string; deltas: Float32Array; wasPreserved: boolean }> = [];
  const presetToTargetIndex: Record<string, number> = {};

  let preservedCount = 0;
  let synthesizedCount = 0;

  // 1. Preserve existing morph targets verbatim (scaled consistently if whole mesh was unit-scaled)
  for (const m of existingMorphs) {
    if (m.positions.length < vertCount * 3) continue;
    const scaledDeltas = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount * 3; i++) {
      scaledDeltas[i] = m.positions[i] * morphDeltaScale;
    }
    const tIdx = targets.length;
    targets.push({ name: m.name, deltas: scaledDeltas, wasPreserved: true });
    const matchedPreset = matchMorphTargetToPreset(m.name);
    if (matchedPreset && morphTargetMagnitude(scaledDeltas) > 1e-4) {
      presetToTargetIndex[matchedPreset] = tIdx;
      preservedCount++;
    }
  }

  // Determine whether this primitive intersects the head/face bounding region
  let headFrontVerts = 0;
  const headRadiusX = 0.125 * headScale;
  const headRadiusY = 0.145 * headScale;
  const headRadiusZ = 0.125 * headScale;
  const headMinY = Math.min(headBoneY - 0.06 * headScale, headCenterY - headRadiusY * 0.98);

  let hMaxZ = -Infinity;
  let hMinYObserved = Infinity;
  let hMaxYObserved = -Infinity;
  for (let i = 0; i < vertCount; i++) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2] * faceForwardSign;
    if (py >= headMinY && Math.abs(px) <= headRadiusX * 1.45 && pz > 0.0) {
      headFrontVerts++;
      if (pz > hMaxZ) hMaxZ = pz;
      if (py < hMinYObserved) hMinYObserved = py;
      if (py > hMaxYObserved) hMaxYObserved = py;
    }
  }

  if (headFrontVerts === 0) {
    return { targets, presetToTargetIndex, preservedCount, synthesizedCount };
  }

  const effectiveCenterY =
    Number.isFinite(hMinYObserved) && Number.isFinite(hMaxYObserved) && hMaxYObserved - hMinYObserved > 0.06
      ? 0.5 * (hMinYObserved + hMaxYObserved)
      : headCenterY;
  const effectiveRadiusY = Math.max(
    0.09 * headScale,
    Math.min(headRadiusY, 0.55 * (hMaxYObserved - hMinYObserved || headRadiusY * 2))
  );
  const effectiveRadiusZ = Math.max(0.06 * headScale, Math.min(headRadiusZ, hMaxZ));

  // 2. Synthesize localized facial morph deltas for any missing VRM presets
  const gauss = (v: number, c: number, s: number) => Math.exp(-Math.pow((v - c) / s, 2));
  const targetPresets = VRM_EXPRESSION_PRESETS.filter((n) => n !== 'neutral');

  for (const expr of targetPresets) {
    if (presetToTargetIndex[expr] !== undefined) continue;

    const deltas = new Float32Array(vertCount * 3);
    let maxMag = 0;

    for (let i = 0; i < vertCount; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      if (py < headMinY) continue;

      const nx = px / headRadiusX;
      const ny = (py - effectiveCenterY) / effectiveRadiusY;
      const nz = (pz * faceForwardSign) / effectiveRadiusZ;
      if (nz <= 0.15 || Math.abs(nx) > 1.35 || Math.abs(ny) > 1.35) continue;

      const front = Math.min(1, (nz - 0.15) / 0.45);
      const eyeL = gauss(nx, 0.34, 0.24) * front;
      const eyeR = gauss(nx, -0.34, 0.24) * front;
      const upperLidL = eyeL * gauss(ny, 0.16, 0.20);
      const lowerLidL = eyeL * gauss(ny, -0.02, 0.18);
      const upperLidR = eyeR * gauss(ny, 0.16, 0.20);
      const lowerLidR = eyeR * gauss(ny, -0.02, 0.18);

      const browBand = gauss(ny, 0.32, 0.22) * front;
      const browInL = browBand * gauss(nx, 0.18, 0.22);
      const browOutL = browBand * gauss(nx, 0.44, 0.22);
      const browInR = browBand * gauss(nx, -0.18, 0.22);
      const browOutR = browBand * gauss(nx, -0.44, 0.22);

      const mouthWidth = gauss(nx, 0, 0.38) * front;
      const cornerL = gauss(nx, 0.28, 0.22) * gauss(ny, -0.38, 0.22) * front;
      const cornerR = gauss(nx, -0.28, 0.22) * gauss(ny, -0.38, 0.22) * front;
      const upperLip = mouthWidth * gauss(ny, -0.32, 0.20);
      const lowerLip = mouthWidth * gauss(ny, -0.46, 0.22);
      const jawArea = gauss(nx, 0, 0.42) * gauss(ny, -0.64, 0.28) * front;
      const cheekLift =
        (gauss(nx, 0.44, 0.26) + gauss(nx, -0.44, 0.26)) * gauss(ny, -0.14, 0.24) * front;

      let dx = 0;
      let dy = 0;
      let dz = 0;

      if (expr === 'blink' || expr === 'blinkLeft') {
        dy += -0.014 * upperLidL + 0.005 * lowerLidL;
        dz += 0.003 * upperLidL * faceForwardSign;
      }
      if (expr === 'blink' || expr === 'blinkRight') {
        dy += -0.014 * upperLidR + 0.005 * lowerLidR;
        dz += 0.003 * upperLidR * faceForwardSign;
      }
      if (expr === 'happy') {
        dy += (cornerL + cornerR) * 0.012 + cheekLift * 0.007 + upperLip * 0.003;
        dx += cornerL * 0.007 - cornerR * 0.007;
        dz += (cheekLift * 0.004 + upperLip * 0.002) * faceForwardSign;
      }
      if (expr === 'angry') {
        dy += -(browInL + browInR) * 0.013 + (browOutL + browOutR) * 0.005 - (upperLidL + upperLidR) * 0.006 - (cornerL + cornerR) * 0.007;
        dz += (browInL + browInR) * 0.004 * faceForwardSign;
      }
      if (expr === 'sad') {
        dy += (browInL + browInR) * 0.011 - (browOutL + browOutR) * 0.006 - (cornerL + cornerR) * 0.011;
      }
      if (expr === 'relaxed') {
        dy += -(upperLidL + upperLidR) * 0.006 + (cornerL + cornerR) * 0.005;
      }
      if (expr === 'surprised') {
        dy += (browInL + browInR + browOutL + browOutR) * 0.013 + (upperLidL + upperLidR) * 0.007 - (lowerLip + jawArea) * 0.017;
        dz += -(lowerLip + jawArea) * 0.004 * faceForwardSign;
      }
      if (expr === 'aa') {
        dy += upperLip * 0.006 - (lowerLip * 0.02 + jawArea * 0.022);
      }
      if (expr === 'ih') {
        dx += cornerL * 0.008 - cornerR * 0.008;
        dy += -lowerLip * 0.008;
      }
      if (expr === 'ou') {
        dx += -cornerL * 0.008 + cornerR * 0.008;
        dz += (upperLip + lowerLip) * 0.009 * faceForwardSign;
        dy += -lowerLip * 0.008;
      }
      if (expr === 'ee') {
        dx += cornerL * 0.007 - cornerR * 0.007;
        dy += (cornerL + cornerR) * 0.003 - lowerLip * 0.008;
      }
      if (expr === 'oh') {
        dy += upperLip * 0.005 - (lowerLip * 0.016 + jawArea * 0.016);
        dz += (upperLip + lowerLip) * 0.005 * faceForwardSign;
      }
      if (expr === 'lookUp') {
        dy += (upperLidL + upperLidR) * 0.004;
      }
      if (expr === 'lookDown') {
        dy -= (upperLidL + upperLidR) * 0.004;
      }
      if (expr === 'lookLeft') {
        dx += (eyeL + eyeR) * 0.004;
      }
      if (expr === 'lookRight') {
        dx -= (eyeL + eyeR) * 0.004;
      }

      deltas[i * 3] = dx;
      deltas[i * 3 + 1] = dy;
      deltas[i * 3 + 2] = dz;
      const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
      if (m > maxMag) maxMag = m;
    }

    if (maxMag <= 1e-4) {
      // Sparse-mesh fallback: bind the closest front-cranial vertices matching the expression region
      let bestLeft = -1;
      let bestRight = -1;
      let bestJaw = -1;
      let bestScoreL = -Infinity;
      let bestScoreR = -Infinity;
      let bestScoreJaw = -Infinity;
      for (let i = 0; i < vertCount; i++) {
        const px = positions[i * 3];
        const py = positions[i * 3 + 1];
        const pz = positions[i * 3 + 2];
        if (py < headMinY) continue;
        const nx = px / headRadiusX;
        const ny = (py - effectiveCenterY) / effectiveRadiusY;
        const nz = (pz * faceForwardSign) / effectiveRadiusZ;
        if (nz <= 0.1 || Math.abs(nx) > 1.4 || Math.abs(ny) > 1.4) continue;
        const scoreL = nz * 2.0 + (nx >= -0.05 ? 1.0 : -1.0) - Math.abs(ny - 0.15);
        const scoreR = nz * 2.0 + (nx <= 0.05 ? 1.0 : -1.0) - Math.abs(ny - 0.15);
        const scoreJaw = nz * 2.0 - Math.abs(ny + 0.4) - Math.abs(nx) * 0.5;
        if (scoreL > bestScoreL) { bestScoreL = scoreL; bestLeft = i; }
        if (scoreR > bestScoreR) { bestScoreR = scoreR; bestRight = i; }
        if (scoreJaw > bestScoreJaw) { bestScoreJaw = scoreJaw; bestJaw = i; }
      }
      const bump = (vi: number, dx: number, dy: number, dz: number) => {
        if (vi < 0) return;
        deltas[vi * 3] += dx;
        deltas[vi * 3 + 1] += dy;
        deltas[vi * 3 + 2] += dz;
        maxMag = Math.max(maxMag, Math.abs(deltas[vi * 3]) + Math.abs(deltas[vi * 3 + 1]) + Math.abs(deltas[vi * 3 + 2]));
      };
      if (expr === 'blink' || expr === 'blinkLeft') bump(bestLeft, 0, -0.012, 0.003 * faceForwardSign);
      if (expr === 'blink' || expr === 'blinkRight') bump(bestRight, 0, -0.012, 0.003 * faceForwardSign);
      if (expr === 'happy' || expr === 'relaxed') {
        bump(bestLeft, 0.004, 0.008, 0.002 * faceForwardSign);
        bump(bestRight, -0.004, 0.008, 0.002 * faceForwardSign);
        bump(bestJaw, 0, 0.006, 0.003 * faceForwardSign);
      }
      if (expr === 'angry') {
        bump(bestLeft, -0.003, -0.01, 0.003 * faceForwardSign);
        bump(bestRight, 0.003, -0.01, 0.003 * faceForwardSign);
      }
      if (expr === 'sad') {
        bump(bestLeft, 0, 0.008, 0);
        bump(bestRight, 0, 0.008, 0);
        bump(bestJaw, 0, -0.008, 0);
      }
      if (expr === 'surprised' || expr === 'aa' || expr === 'oh' || expr === 'ih' || expr === 'ee' || expr === 'ou') {
        bump(bestJaw, 0, -0.014, 0.004 * faceForwardSign);
      }
      if (expr === 'lookUp') { bump(bestLeft, 0, 0.004, 0); bump(bestRight, 0, 0.004, 0); }
      if (expr === 'lookDown') { bump(bestLeft, 0, -0.004, 0); bump(bestRight, 0, -0.004, 0); }
      if (expr === 'lookLeft') { bump(bestLeft, 0.004, 0, 0); bump(bestRight, 0.004, 0, 0); }
      if (expr === 'lookRight') { bump(bestLeft, -0.004, 0, 0); bump(bestRight, -0.004, 0, 0); }
    }

    if (maxMag > 1e-4) {
      const tIdx = targets.length;
      targets.push({ name: expr, deltas, wasPreserved: false });
      presetToTargetIndex[expr] = tIdx;
      synthesizedCount++;
    }
  }

  return { targets, presetToTargetIndex, preservedCount, synthesizedCount };
}
