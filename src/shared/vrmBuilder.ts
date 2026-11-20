import {
  BoneDef,
  PrimitiveBuild,
  buildHighDetailCharacterGeometry,
  getOptimizedBudget,
  getQualityBudget,
} from './anatomicalSculptor';
import {
  ExternalRiggingAudit,
  auditJointDeformations,
  buildOrPreserveMorphTargetsForExternalPrimitive,
  computeLaplacianCapsuleSkinWeights,
  fitArmatureToExternalGeometry,
  mapExistingSkinToVrmHumanoid,
} from './externalRigging';
import {
  generateProceduralTexturePng,
  resolvePackedTextureSize,
  textureResolutionToTargetPx,
} from './pngEncoder';
import {
  clampMetadataToSourceRestrictions,
  createDefaultVrmMetadata,
} from './characterParser';
import {
  CharacterSpecification,
  ExportEstimates,
  ImportedPrimitiveData,
  ParsedGlbAsset,
  RigReport,
  VRM0_BLEND_SHAPE_PRESETS,
  VRM0_HUMANOID_BONES,
  VRM_EXPRESSION_PRESETS,
  VRM_REQUIRED_HUMANOID_BONES,
  VrmExportVersion,
  VrmMetadataConfig,
} from './types';

const VRM0_BONE_SET = new Set<string>(VRM0_HUMANOID_BONES);
const VRM0_PRESET_SET = new Set<string>(VRM0_BLEND_SHAPE_PRESETS);

const VRM1_TO_VRM0_PRESET: Record<string, string> = {
  neutral: 'neutral',
  happy: 'joy',
  angry: 'angry',
  sad: 'sorrow',
  relaxed: 'fun',
  surprised: 'unknown',
  blink: 'blink',
  blinkLeft: 'blink_l',
  blinkRight: 'blink_r',
  lookUp: 'lookup',
  lookDown: 'lookdown',
  lookLeft: 'lookleft',
  lookRight: 'lookright',
  aa: 'a',
  ih: 'i',
  ou: 'u',
  ee: 'e',
  oh: 'o',
};

const VRM0_DISPLAY_NAMES: Record<string, string> = {
  neutral: 'Neutral',
  joy: 'Joy',
  angry: 'Angry',
  sorrow: 'Sorrow',
  fun: 'Fun',
  unknown: 'Surprised',
  blink: 'Blink',
  blink_l: 'Blink_L',
  blink_r: 'Blink_R',
  lookup: 'LookUp',
  lookdown: 'LookDown',
  lookleft: 'LookLeft',
  lookright: 'LookRight',
  a: 'A',
  i: 'I',
  u: 'U',
  e: 'E',
  o: 'O',
};

function resolveEffectiveVrmMetadata(
  spec: CharacterSpecification,
  sourceMeta?: Partial<VrmMetadataConfig>
): VrmMetadataConfig {
  const mergedInput: Partial<VrmMetadataConfig> = {
    ...(sourceMeta || {}),
    ...(spec.vrmMetadata || {}),
    author: spec.vrmMetadata?.author || sourceMeta?.author || '',
    version: spec.vrmMetadata?.version || sourceMeta?.version || '1.0',
    contactInformation: spec.vrmMetadata?.contactInformation || sourceMeta?.contactInformation || '',
    reference: spec.vrmMetadata?.reference || sourceMeta?.reference || '',
    licenseName: spec.vrmMetadata?.licenseName || sourceMeta?.licenseName || 'Other',
    otherLicenseUrl: spec.vrmMetadata?.otherLicenseUrl || sourceMeta?.otherLicenseUrl || '',
    otherPermissionUrl: spec.vrmMetadata?.otherPermissionUrl || sourceMeta?.otherPermissionUrl || '',
    allowedUserName: spec.vrmMetadata?.allowedUserName || sourceMeta?.allowedUserName || 'OnlyAuthor',
    violentUsage: spec.vrmMetadata?.violentUsage || sourceMeta?.violentUsage || 'Disallow',
    sexualUsage: spec.vrmMetadata?.sexualUsage || sourceMeta?.sexualUsage || 'Disallow',
    commercialUsage: spec.vrmMetadata?.commercialUsage || sourceMeta?.commercialUsage || 'Disallow',
    allowRedistribution:
      spec.vrmMetadata?.allowRedistribution ?? sourceMeta?.allowRedistribution ?? false,
    modification: spec.vrmMetadata?.modification || sourceMeta?.modification || 'prohibited',
    sourceAttribution:
      spec.vrmMetadata?.sourceAttribution ||
      sourceMeta?.sourceAttribution ||
      'Created with VRM Forge Studio',
    sourceRestrictions: spec.vrmMetadata?.sourceRestrictions ?? sourceMeta?.sourceRestrictions,
  };
  const base = createDefaultVrmMetadata(spec.name, mergedInput);
  return clampMetadataToSourceRestrictions(base, mergedInput.sourceRestrictions);
}

function buildVrm0MetaBlock(meta: VrmMetadataConfig): Record<string, unknown> {
  return {
    title: meta.title,
    version: meta.version,
    author: meta.author || 'Unspecified Author',
    contactInformation: meta.contactInformation,
    reference: meta.reference || meta.sourceAttribution || '',
    allowedUserName: meta.allowedUserName,
    violentUssageName: meta.violentUsage,
    sexualUssageName: meta.sexualUsage,
    commercialUssageName: meta.commercialUsage,
    otherPermissionUrl: meta.otherPermissionUrl || '',
    licenseName: meta.licenseName || 'Other',
    otherLicenseUrl: meta.otherLicenseUrl || '',
  };
}

function buildVrm1MetaBlock(meta: VrmMetadataConfig): Record<string, unknown> {
  return {
    name: meta.title,
    version: meta.version,
    authors: [meta.author || 'Unspecified Author'],
    copyrightInformation: meta.sourceAttribution || 'Created with VRM Forge Studio',
    contactInformation: meta.contactInformation,
    references: meta.reference ? [meta.reference] : [],
    licenseUrl: meta.otherLicenseUrl || 'https://vrm.dev/licenses/1.0/',
    avatarPermission:
      meta.allowedUserName === 'Everyone'
        ? 'everyone'
        : meta.allowedUserName === 'ExplicitlyLicensedPerson'
          ? 'onlySeparatelyLicensedPerson'
          : 'onlyAuthor',
    allowExcessivelyViolentUsage: meta.violentUsage === 'Allow',
    allowExcessivelySexualUsage: meta.sexualUsage === 'Allow',
    commercialUsage: meta.commercialUsage === 'Allow' ? 'corporation' : 'personalNonProfit',
    allowPoliticalOrReligiousUsage: false,
    allowAntisocialOrHateUsage: false,
    creditNotation: 'required',
    allowRedistribution: meta.allowRedistribution,
    modification: meta.modification,
  };
}

function buildVrm0Extension(options: {
  meta: VrmMetadataConfig;
  humanBones: Record<string, { node: number }>;
  headScale: number;
  meshNodes: Array<{ meshIndex: number; nodeIndex: number }>;
  expressionPresetBinds: Record<string, Array<{ node: number; index: number; weight: number }>>;
  colliderGroups: Array<{ node: number; colliders: Array<{ offset: { x: number; y: number; z: number }; radius: number }> }>;
  boneGroups: Array<{
    comment?: string;
    stiffiness: number;
    gravityPower: number;
    gravityDir: { x: number; y: number; z: number };
    dragForce: number;
    center: number;
    hitRadius: number;
    bones: number[];
    colliderGroups: number[];
  }>;
}): Record<string, unknown> {
  const nodeToMesh = new Map<number, number>();
  for (const mn of options.meshNodes) {
    nodeToMesh.set(mn.nodeIndex, mn.meshIndex);
  }

  const VRM1_TO_VRM0_BONE_NAME: Record<string, string> = {
    leftThumbMetacarpal: 'leftThumbProximal',
    leftThumbProximal: 'leftThumbIntermediate',
    rightThumbMetacarpal: 'rightThumbProximal',
    rightThumbProximal: 'rightThumbIntermediate',
  };
  const seenVrm0Bones = new Set<string>();
  const seenVrm0Nodes = new Set<number>();
  const humanBonesArr: Array<{ bone: string; node: number; useDefaultValues: boolean }> = [];
  for (const [bone, ref] of Object.entries(options.humanBones)) {
    const vrm0Bone = VRM1_TO_VRM0_BONE_NAME[bone] ?? bone;
    if (!VRM0_BONE_SET.has(vrm0Bone)) continue;
    if (seenVrm0Bones.has(vrm0Bone) || seenVrm0Nodes.has(ref.node)) continue;
    seenVrm0Bones.add(vrm0Bone);
    seenVrm0Nodes.add(ref.node);
    humanBonesArr.push({
      bone: vrm0Bone,
      node: ref.node,
      useDefaultValues: true,
    });
  }

  const blendShapeGroups: Array<Record<string, unknown>> = [
    {
      name: 'Neutral',
      presetName: 'neutral',
      binds: [],
      isBinary: false,
      materialValues: [],
    },
  ];

  for (const [vrm1Name, binds] of Object.entries(options.expressionPresetBinds)) {
    if (vrm1Name === 'neutral' || !binds || binds.length === 0) continue;
    const rawPreset0 = VRM1_TO_VRM0_PRESET[vrm1Name] ?? 'unknown';
    const preset0 = VRM0_PRESET_SET.has(rawPreset0) ? rawPreset0 : 'unknown';
    const vrm0Binds: Array<{ mesh: number; index: number; weight: number }> = [];
    for (const b of binds) {
      const meshIdx = nodeToMesh.get(b.node);
      if (meshIdx !== undefined) {
        vrm0Binds.push({
          mesh: meshIdx,
          index: b.index,
          weight: Math.round(Math.max(0, Math.min(1, b.weight)) * 100),
        });
      }
    }
    if (vrm0Binds.length > 0) {
      blendShapeGroups.push({
        name: VRM0_DISPLAY_NAMES[preset0] || (preset0 === 'unknown' ? vrm1Name : preset0),
        presetName: preset0,
        binds: vrm0Binds,
        isBinary: preset0 === 'blink' || preset0 === 'blink_l' || preset0 === 'blink_r',
        materialValues: [],
      });
    }
  }

  const headNode = options.humanBones.head?.node ?? 1;
  return {
    exporterVersion: 'VRMForgeStudio-2.0',
    specVersion: '0.0',
    meta: buildVrm0MetaBlock(options.meta),
    humanoid: {
      humanBones: humanBonesArr,
      armStretch: 0.05,
      legStretch: 0.05,
      upperArmTwist: 0.5,
      lowerArmTwist: 0.5,
      upperLegTwist: 0.5,
      lowerLegTwist: 0.5,
      feetSpacing: 0,
      hasTranslationDoF: false,
    },
    firstPerson: {
      firstPersonBone: headNode,
      firstPersonBoneOffset: { x: 0, y: 0.06 * options.headScale, z: 0 },
      meshAnnotations: [],
      lookAtTypeName: 'Bone',
      lookAtHorizontalInner: { curve: [0, 0, 0, 1, 1, 1, 1, 0], xRange: 90, yRange: 10 },
      lookAtHorizontalOuter: { curve: [0, 0, 0, 1, 1, 1, 1, 0], xRange: 90, yRange: 10 },
      lookAtVerticalDown: { curve: [0, 0, 0, 1, 1, 1, 1, 0], xRange: 90, yRange: 10 },
      lookAtVerticalUp: { curve: [0, 0, 0, 1, 1, 1, 1, 0], xRange: 90, yRange: 10 },
    },
    blendShapeMaster: {
      blendShapeGroups,
    },
    secondaryAnimation: {
      boneGroups: options.boneGroups,
      colliderGroups: options.colliderGroups,
    },
    materialProperties: [],
  };
}

export interface BuiltStats {
  vertexCount: number;
  triangleCount: number;
  boneCount: number;
  materialCount: number;
  textureCount: number;
  expressionCount: number;
  springBoneJointCount: number;
}

export interface BuiltTimingsMs {
  geometryMs: number;
  retopologyMs: number;
  materialsMs: number;
  riggingMs: number;
  facialMs: number;
  packageMs: number;
}

export interface BuiltVrmResult {
  vrmBuffer: Uint8Array;
  glbBuffer: Uint8Array;
  sourceGlbBuffer: Uint8Array;
  vrmVersion: VrmExportVersion;
  stats: BuiltStats;
  sourceStats: BuiltStats;
  estimates: ExportEstimates;
  timingsMs: BuiltTimingsMs;
  externalAudit?: ExternalRiggingAudit;
  rigReport?: RigReport;
}

export function buildHumanoidSkeleton(spec: CharacterSpecification): BoneDef[] {
  const hScale = spec.proportions.heightMeters / 1.7;
  const sW = spec.proportions.shoulderWidthScale;
  const hW = spec.proportions.hipWidthScale;
  const limb = spec.proportions.limbLengthScale;
  const headS = spec.proportions.headScale;

  const bones: BoneDef[] = [];
  const addBone = (
    name: string,
    parent: number,
    worldPos: [number, number, number],
    vrmName?: string
  ): number => {
    const parentWorld = parent >= 0 ? bones[parent].worldPos : [0, 0, 0];
    const localPos: [number, number, number] = [
      worldPos[0] - parentWorld[0],
      worldPos[1] - parentWorld[1],
      worldPos[2] - parentWorld[2],
    ];
    const idx = bones.length;
    bones.push({ name, vrmName, parent, localPos, worldPos });
    return idx;
  };

  // Central Spine
  const hipsY = 0.94 * hScale * limb;
  const hips = addBone('hips', -1, [0, hipsY, 0], 'hips');
  const spine = addBone('spine', hips, [0, hipsY + 0.12 * hScale, 0], 'spine');
  const chest = addBone('chest', spine, [0, hipsY + 0.25 * hScale, 0], 'chest');
  const upperChest = addBone('upperChest', chest, [0, hipsY + 0.39 * hScale, 0], 'upperChest');
  const neck = addBone('neck', upperChest, [0, hipsY + 0.49 * hScale, 0], 'neck');
  const headY = hipsY + 0.58 * hScale;
  const head = addBone('head', neck, [0, headY, 0], 'head');

  // Face bones aligned to recessed eye sockets and jaw
  addBone('leftEye', head, [0.0315 * headS, headY + 0.103 * headS, 0.084 * headS], 'leftEye');
  addBone('rightEye', head, [-0.0315 * headS, headY + 0.103 * headS, 0.084 * headS], 'rightEye');
  addBone('jaw', head, [0, headY + 0.018 * headS, 0.025 * headS], 'jaw');

  // Arms (VRM 1.0: +X = Left, -X = Right)
  const shoulderY = hipsY + 0.43 * hScale;
  const shoulderX = 0.07 * sW;
  const upperArmX = 0.165 * sW;
  const elbowX = upperArmX + 0.25 * hScale * limb;
  const wristX = elbowX + 0.23 * hScale * limb;

  const addArm = (side: 'left' | 'right', sign: 1 | -1) => {
    const sh = addBone(`${side}Shoulder`, upperChest, [sign * shoulderX, shoulderY, 0], `${side}Shoulder`);
    const ua = addBone(`${side}UpperArm`, sh, [sign * upperArmX, shoulderY - 0.01 * hScale, 0], `${side}UpperArm`);
    const la = addBone(`${side}LowerArm`, ua, [sign * elbowX, shoulderY - 0.015 * hScale, 0], `${side}LowerArm`);
    const hand = addBone(`${side}Hand`, la, [sign * wristX, shoulderY - 0.015 * hScale, 0], `${side}Hand`);

    const fingerSpecs: Array<{
      key: string;
      zOffset: number;
      proxLen: number;
      intLen: number;
      distLen: number;
      isThumb?: boolean;
    }> = [
      { key: 'Thumb', zOffset: 0.026, proxLen: 0.028, intLen: 0.022, distLen: 0.018, isThumb: true },
      { key: 'Index', zOffset: 0.022, proxLen: 0.034, intLen: 0.022, distLen: 0.016 },
      { key: 'Middle', zOffset: 0.008, proxLen: 0.038, intLen: 0.025, distLen: 0.017 },
      { key: 'Ring', zOffset: -0.008, proxLen: 0.035, intLen: 0.022, distLen: 0.016 },
      { key: 'Little', zOffset: -0.022, proxLen: 0.028, intLen: 0.018, distLen: 0.014 },
    ];

    for (const f of fingerSpecs) {
      const baseX = wristX + (f.isThumb ? 0.022 : 0.065);
      const baseY = shoulderY - 0.015 * hScale + (f.isThumb ? -0.01 : 0);
      if (f.isThumb) {
        const meta = addBone(
          `${side}ThumbMetacarpal`,
          hand,
          [sign * baseX, baseY, f.zOffset],
          `${side}ThumbMetacarpal`
        );
        const prox = addBone(
          `${side}ThumbProximal`,
          meta,
          [sign * (baseX + f.proxLen), baseY - 0.008, f.zOffset + 0.012],
          `${side}ThumbProximal`
        );
        addBone(
          `${side}ThumbDistal`,
          prox,
          [sign * (baseX + f.proxLen + f.intLen), baseY - 0.012, f.zOffset + 0.02],
          `${side}ThumbDistal`
        );
      } else {
        const prox = addBone(
          `${side}${f.key}Proximal`,
          hand,
          [sign * baseX, baseY, f.zOffset],
          `${side}${f.key}Proximal`
        );
        const inter = addBone(
          `${side}${f.key}Intermediate`,
          prox,
          [sign * (baseX + f.proxLen), baseY, f.zOffset],
          `${side}${f.key}Intermediate`
        );
        addBone(
          `${side}${f.key}Distal`,
          inter,
          [sign * (baseX + f.proxLen + f.intLen), baseY, f.zOffset],
          `${side}${f.key}Distal`
        );
      }
    }
  };

  addArm('left', 1);
  addArm('right', -1);

  // Legs
  const hipJointX = 0.092 * hW;
  const kneeY = hipsY * 0.52;
  const ankleY = 0.08 * hScale;
  const addLeg = (side: 'left' | 'right', sign: 1 | -1) => {
    const ul = addBone(`${side}UpperLeg`, hips, [sign * hipJointX, hipsY - 0.04 * hScale, 0], `${side}UpperLeg`);
    const ll = addBone(`${side}LowerLeg`, ul, [sign * hipJointX, kneeY, 0.01], `${side}LowerLeg`);
    const ft = addBone(`${side}Foot`, ll, [sign * hipJointX, ankleY, -0.01], `${side}Foot`);
    addBone(`${side}Toes`, ft, [sign * hipJointX, 0.02, 0.11], `${side}Toes`);
  };
  addLeg('left', 1);
  addLeg('right', -1);

  // Secondary Spring Bones (Hair & Cloak)
  const hairBackRoot = addBone('hairBackRoot', head, [0, headY + 0.05 * headS, -0.095 * headS]);
  const hairBackMid = addBone('hairBackMid', hairBackRoot, [0, headY - 0.16 * hScale, -0.135]);
  addBone('hairBackTip', hairBackMid, [0, headY - 0.38 * hScale, -0.15]);

  const hairLeftRoot = addBone('hairLeftRoot', head, [0.085 * headS, headY + 0.04 * headS, 0.02]);
  addBone('hairLeftTip', hairLeftRoot, [0.105 * headS, headY - 0.18 * hScale, 0.03]);

  const hairRightRoot = addBone('hairRightRoot', head, [-0.085 * headS, headY + 0.04 * headS, 0.02]);
  addBone('hairRightTip', hairRightRoot, [-0.105 * headS, headY - 0.18 * hScale, 0.03]);

  const cloakTop = addBone('cloakTop', upperChest, [0, shoulderY, -0.09]);
  const cloakMid = addBone('cloakMid', cloakTop, [0, hipsY + 0.05 * hScale, -0.16]);
  addBone('cloakHem', cloakMid, [0, 0.25 * hScale, -0.22]);

  return bones;
}

const MORPH_EXPRESSION_NAMES = VRM_EXPRESSION_PRESETS.filter((n) => n !== 'neutral');

function computeMorphTargetsForPrimitive(
  prim: PrimitiveBuild
): Array<{ name: string; deltas: Float32Array }> {
  const vertCount = prim.positions.length / 3;
  const tags = prim.faceTags || [];
  const fl = prim.faceLocal;
  const targets: Array<{ name: string; deltas: Float32Array }> = [];
  const gauss = (v: number, c: number, s: number) => Math.exp(-Math.pow((v - c) / s, 2));

  for (const expr of MORPH_EXPRESSION_NAMES) {
    const deltas = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount; i++) {
      const region = tags[i]?.region ?? 'none';
      let dx = 0;
      let dy = 0;
      let dz = 0;

      if (fl && fl.length === vertCount * 3) {
        const nx = fl[i * 3];
        const ny = fl[i * 3 + 1];
        const nz = fl[i * 3 + 2];
        if (nz > 0.25) {
          const front = Math.min(1, (nz - 0.25) / 0.45);
          const eyeL = gauss(nx, 0.34, 0.13) * front;
          const eyeR = gauss(nx, -0.34, 0.13) * front;
          const upperLidL = eyeL * gauss(ny, 0.125, 0.045);
          const lowerLidL = eyeL * gauss(ny, 0.02, 0.042);
          const upperLidR = eyeR * gauss(ny, 0.125, 0.045);
          const lowerLidR = eyeR * gauss(ny, 0.02, 0.042);

          const browBand = gauss(ny, 0.24, 0.065) * front;
          const browInL = browBand * gauss(nx, 0.16, 0.12);
          const browOutL = browBand * gauss(nx, 0.4, 0.14);
          const browInR = browBand * gauss(nx, -0.16, 0.12);
          const browOutR = browBand * gauss(nx, -0.4, 0.14);

          const mouthWidth = gauss(nx, 0, 0.28) * front;
          const cornerL = gauss(nx, 0.24, 0.1) * gauss(ny, -0.386, 0.065) * front;
          const cornerR = gauss(nx, -0.24, 0.1) * gauss(ny, -0.386, 0.065) * front;
          const upperLip = mouthWidth * gauss(ny, -0.352, 0.042);
          const lowerLip = mouthWidth * gauss(ny, -0.42, 0.05);
          const mouthCavity = gauss(nx, 0, 0.2) * gauss(ny, -0.386, 0.026) * front;
          const jawArea = gauss(nx, 0, 0.34) * gauss(ny, -0.66, 0.22) * front;
          const cheekLift =
            (gauss(nx, 0.44, 0.18) + gauss(nx, -0.44, 0.18)) * gauss(ny, -0.14, 0.14) * front;

          if (expr === 'blink' || expr === 'blinkLeft') {
            dy += -0.0135 * upperLidL + 0.0055 * lowerLidL;
            dz += 0.003 * upperLidL;
          }
          if (expr === 'blink' || expr === 'blinkRight') {
            dy += -0.0135 * upperLidR + 0.0055 * lowerLidR;
            dz += 0.003 * upperLidR;
          }
          if (expr === 'happy') {
            dy += (cornerL + cornerR) * 0.011 + upperLip * 0.002 + cheekLift * 0.006 + (lowerLidL + lowerLidR) * 0.0035;
            dx += cornerL * 0.006 - cornerR * 0.006;
            dz += cheekLift * 0.004 + upperLip * 0.0015;
          }
          if (expr === 'angry') {
            dy += -(browInL + browInR) * 0.012 + (browOutL + browOutR) * 0.005 - (upperLidL + upperLidR) * 0.005 - (cornerL + cornerR) * 0.006;
            dz += (browInL + browInR) * 0.004;
          }
          if (expr === 'sad') {
            dy += (browInL + browInR) * 0.01 - (browOutL + browOutR) * 0.006 - (cornerL + cornerR) * 0.011;
          }
          if (expr === 'relaxed') {
            dy += -(upperLidL + upperLidR) * 0.005 + (cornerL + cornerR) * 0.005;
          }
          if (expr === 'surprised') {
            dy += (browInL + browInR + browOutL + browOutR) * 0.012 + (upperLidL + upperLidR) * 0.006 - (lowerLip + jawArea) * 0.016;
            dz += -(lowerLip + jawArea) * 0.003 - mouthCavity * 0.014;
          }
          if (expr === 'aa') {
            dy += upperLip * 0.006 - (lowerLip * 0.02 + jawArea * 0.021);
            dz += -(lowerLip + jawArea) * 0.003 - mouthCavity * 0.016;
          }
          if (expr === 'ih') {
            dx += cornerL * 0.008 - cornerR * 0.008;
            dy += -lowerLip * 0.007;
            dz += -mouthCavity * 0.007;
          }
          if (expr === 'ou') {
            dx += -cornerL * 0.007 + cornerR * 0.007;
            dz += (upperLip + lowerLip) * 0.009 - mouthCavity * 0.012;
            dy += -lowerLip * 0.008;
          }
          if (expr === 'ee') {
            dx += cornerL * 0.007 - cornerR * 0.007;
            dy += (cornerL + cornerR) * 0.003 - lowerLip * 0.008;
            dz += -mouthCavity * 0.006;
          }
          if (expr === 'oh') {
            dy += upperLip * 0.005 - (lowerLip * 0.015 + jawArea * 0.016);
            dz += upperLip * 0.005 + lowerLip * 0.004 - mouthCavity * 0.015;
          }
        }
      } else if (region !== 'none') {
        if (expr === 'lookUp' && (region === 'iris_l' || region === 'iris_r')) dy = 0.006;
        if (expr === 'lookDown' && (region === 'iris_l' || region === 'iris_r')) dy = -0.006;
        if (expr === 'lookLeft' && (region === 'iris_l' || region === 'iris_r')) dx = 0.006;
        if (expr === 'lookRight' && (region === 'iris_l' || region === 'iris_r')) dx = -0.006;
      }

      deltas[i * 3] = dx;
      deltas[i * 3 + 1] = dy;
      deltas[i * 3 + 2] = dz;
    }
    targets.push({ name: expr, deltas });
  }

  return targets;
}

function packGlbBinary(gltfJson: Record<string, unknown>, binBytes: Uint8Array): Uint8Array {
  const jsonStr = JSON.stringify(gltfJson);
  const rawJsonBytes = new TextEncoder().encode(jsonStr);
  const jsonPad = (4 - (rawJsonBytes.length % 4)) % 4;
  const jsonChunkLen = rawJsonBytes.length + jsonPad;

  const binPad = (4 - (binBytes.length % 4)) % 4;
  const binChunkLen = binBytes.length + binPad;

  const totalLen = 12 + 8 + jsonChunkLen + 8 + binChunkLen;
  const out = new Uint8Array(totalLen);
  const view = new DataView(out.buffer);

  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLen, true);

  view.setUint32(12, jsonChunkLen, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(rawJsonBytes, 20);
  for (let i = 0; i < jsonPad; i++) {
    out[20 + rawJsonBytes.length + i] = 0x20;
  }

  const binHeaderOffset = 20 + jsonChunkLen;
  view.setUint32(binHeaderOffset, binChunkLen, true);
  view.setUint32(binHeaderOffset + 4, 0x004e4942, true);
  out.set(binBytes, binHeaderOffset + 8);

  return out;
}

function assembleGltfPackage(
  spec: CharacterSpecification,
  bones: BoneDef[],
  primitives: PrimitiveBuild[],
  texPx: number,
  includeNormalMaps: boolean,
  mode: 'both' | 'glb_only' = 'both'
): {
  glbBuffer: Uint8Array;
  vrmBuffer: Uint8Array;
  stats: BuiltStats;
} {
  // 1. High-Detail PBR Albedo + Tangent-Space Normal Map PNG Textures (encoded once, shared across GLB & VRM)
  const normalPx = Math.max(128, Math.min(256, texPx));
  const textureDefs: Array<{ name: string; bytes: Uint8Array }> = [
    { name: 'skin_albedo', bytes: generateProceduralTexturePng('skin', spec.palette.skinColor, spec.palette.skinColor, texPx) },
    { name: 'iris_albedo', bytes: generateProceduralTexturePng('iris', spec.palette.eyeColor, spec.palette.eyeColor, texPx) },
    { name: 'hair_albedo', bytes: generateProceduralTexturePng('hair', spec.palette.hairColor, spec.palette.hairColor, texPx) },
    { name: 'armor_albedo', bytes: generateProceduralTexturePng('armor', spec.palette.primaryOutfitColor, spec.palette.secondaryOutfitColor, texPx) },
    { name: 'trim_albedo', bytes: generateProceduralTexturePng('armor', spec.palette.accentMetallicColor, spec.palette.secondaryOutfitColor, texPx) },
    { name: 'cloak_albedo', bytes: generateProceduralTexturePng('cloak', spec.palette.cloakColor, spec.palette.secondaryOutfitColor, texPx) },
    { name: 'secondary_albedo', bytes: generateProceduralTexturePng('armor', spec.palette.secondaryOutfitColor, spec.palette.accentMetallicColor, texPx) },
  ];

  const irisEmissiveTexIdx = textureDefs.length;
  textureDefs.push({
    name: 'iris_emissive',
    bytes: generateProceduralTexturePng('iris_emissive', spec.palette.eyeColor, spec.palette.eyeColor, texPx),
  });

  const normalStartIdx = textureDefs.length;
  if (includeNormalMaps) {
    textureDefs.push(
      { name: 'skin_normal', bytes: generateProceduralTexturePng('skin_normal', '#8080ff', '#8080ff', normalPx) },
      { name: 'hair_normal', bytes: generateProceduralTexturePng('hair_normal', '#8080ff', '#8080ff', normalPx) },
      { name: 'armor_normal', bytes: generateProceduralTexturePng('armor_normal', '#8080ff', '#8080ff', normalPx) },
      { name: 'cloak_normal', bytes: generateProceduralTexturePng('cloak_normal', '#8080ff', '#8080ff', normalPx) }
    );
  }

  // Compute morph deltas BEFORE applying VRM 0.0 Ry(pi) rotation, since faceLocal assumes +Z front
  const precomputedMorphs = primitives.map((prim) =>
    prim.hasMorphTargets ? computeMorphTargetsForPrimitive(prim) : []
  );

  // Calibrate PBR materials by art style
  const isAnime = spec.artStyle === 'stylized_anime';
  const isRealistic = spec.artStyle === 'realistic_human';
  const normalScale = isAnime ? 0.35 : isRealistic ? 0.85 : 0.65;

  const materials: Array<Record<string, unknown>> = [
    {
      name: 'Skin_Material',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0.0,
        roughnessFactor: isAnime ? 0.72 : isRealistic ? 0.54 : 0.6,
      },
      ...(includeNormalMaps ? { normalTexture: { index: normalStartIdx, scale: normalScale * 0.42 } } : {}),
    },
    {
      name: 'Eyes_Material',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 1 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0.02,
        roughnessFactor: 0.14,
      },
      ...(spec.palette.eyeEmissive
        ? {
            emissiveTexture: { index: irisEmissiveTexIdx },
            emissiveFactor: [0.85, 0.85, 0.85],
          }
        : { emissiveFactor: [0, 0, 0] }),
    },
    {
      name: 'Hair_Material',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 2 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: isAnime ? 0.04 : 0.1,
        roughnessFactor: isAnime ? 0.46 : 0.36,
      },
      ...(includeNormalMaps ? { normalTexture: { index: normalStartIdx + 1, scale: normalScale * 0.75 } } : {}),
      doubleSided: true,
    },
    {
      name: 'Armor_Outfit_Material',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 3 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: spec.features.hasArmor ? 0.48 : 0.04,
        roughnessFactor: spec.features.hasArmor ? 0.38 : 0.72,
      },
      ...(includeNormalMaps ? { normalTexture: { index: normalStartIdx + 2, scale: normalScale * 0.85 } } : {}),
    },
    {
      name: 'Metallic_Trim_Material',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 4 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: spec.features.hasArmor ? 0.78 : 0.18,
        roughnessFactor: spec.features.hasArmor ? 0.28 : 0.56,
      },
      ...(includeNormalMaps ? { normalTexture: { index: normalStartIdx + 2, scale: normalScale * 0.8 } } : {}),
    },
    {
      name: 'Cloak_Fabric_Material',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 5 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0.03,
        roughnessFactor: 0.84,
      },
      ...(includeNormalMaps ? { normalTexture: { index: normalStartIdx + 3, scale: normalScale * 0.75 } } : {}),
      doubleSided: true,
    },
    {
      name: 'Secondary_Accent_Material',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 6 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: spec.features.hasArmor ? 0.36 : 0.08,
        roughnessFactor: spec.features.hasArmor ? 0.4 : 0.68,
      },
      ...(includeNormalMaps ? { normalTexture: { index: normalStartIdx + 2, scale: normalScale * 0.8 } } : {}),
    },
  ];

  const targetVrmVersion: VrmExportVersion =
    spec.riggingRequirements.vrmVersion === '1.0' ? '1.0' : '0.0';
  const effectiveMeta = resolveEffectiveVrmMetadata(spec);

  const springBoneJointNames = [
    'hairBackRoot',
    'hairBackMid',
    'hairBackTip',
    'hairLeftRoot',
    'hairLeftTip',
    'hairRightRoot',
    'hairRightTip',
    'cloakTop',
    'cloakMid',
    'cloakHem',
  ];
  const boneNodeByName = new Map<string, number>();
  bones.forEach((b, i) => boneNodeByName.set(b.name, i + 1));

  const humanBones: Record<string, { node: number }> = {};
  bones.forEach((b, i) => {
    if (b.vrmName) {
      humanBones[b.vrmName] = { node: i + 1 };
    }
  });

  for (const req of VRM_REQUIRED_HUMANOID_BONES) {
    if (!humanBones[req]) {
      throw new Error(`Internal builder error: missing required VRM bone ${req}`);
    }
  }

  const firstMeshNodeIdx = 1 + bones.length;
  let skinMeshNodeIdx = -1;
  let eyeMeshNodeIdx = -1;
  for (let mIdx = 0; mIdx < primitives.length; mIdx++) {
    const prim = primitives[mIdx];
    const nodeIdx = firstMeshNodeIdx + mIdx;
    if (prim.materialIndex === 0) skinMeshNodeIdx = nodeIdx;
    if (prim.materialIndex === 1) eyeMeshNodeIdx = nodeIdx;
  }

  const expressionPresetMap: Record<string, Record<string, unknown>> = {
    neutral: { isBinary: false, morphTargetBinds: [] },
  };
  const expressionPresetBinds: Record<string, Array<{ node: number; index: number; weight: number }>> = {};
  MORPH_EXPRESSION_NAMES.forEach((exprName, mIdx) => {
    const binds: Array<{ node: number; index: number; weight: number }> = [];
    if (skinMeshNodeIdx >= 0) {
      binds.push({ node: skinMeshNodeIdx, index: mIdx, weight: 1.0 });
    }
    if (
      eyeMeshNodeIdx >= 0 &&
      (exprName === 'lookUp' ||
        exprName === 'lookDown' ||
        exprName === 'lookLeft' ||
        exprName === 'lookRight')
    ) {
      binds.push({ node: eyeMeshNodeIdx, index: mIdx, weight: 1.0 });
    }
    expressionPresetBinds[exprName] = binds;
    expressionPresetMap[exprName] = {
      isBinary: exprName === 'blink' || exprName === 'blinkLeft' || exprName === 'blinkRight',
      morphTargetBinds: binds,
    };
  });

  const springJointDefs = springBoneJointNames.map((n) => ({
    node: boneNodeByName.get(n) ?? 1,
    hitRadius: 0.03,
    stiffness: n.startsWith('hair') ? 0.65 : 0.45,
    gravityPower: 0.35,
    gravityDir: [0, -1, 0],
    dragForce: 0.4,
  }));

  const springs = [
    { name: 'HairBackSpring', joints: springJointDefs.slice(0, 3) },
    { name: 'HairLeftSpring', joints: springJointDefs.slice(3, 5) },
    { name: 'HairRightSpring', joints: springJointDefs.slice(5, 7) },
    ...(spec.features.hasCloak ? [{ name: 'CloakSpring', joints: springJointDefs.slice(7, 10) }] : []),
  ];

  const vrm0ColliderGroups = [
    {
      node: humanBones.head?.node ?? 1,
      colliders: [{ offset: { x: 0, y: 0.06 * spec.proportions.headScale, z: 0 }, radius: 0.085 }],
    },
    {
      node: humanBones.upperChest?.node ?? humanBones.chest?.node ?? 1,
      colliders: [{ offset: { x: 0, y: 0.03, z: 0 }, radius: 0.10 }],
    },
  ];
  const vrm0BoneGroups = [
    {
      comment: 'HairBackSpring',
      stiffiness: 0.65,
      gravityPower: 0.25,
      gravityDir: { x: 0, y: -1, z: 0 },
      dragForce: 0.4,
      center: -1,
      hitRadius: 0.025,
      bones: [boneNodeByName.get('hairBackRoot')!].filter(Boolean),
      colliderGroups: [0, 1],
    },
    {
      comment: 'HairLeftSpring',
      stiffiness: 0.65,
      gravityPower: 0.25,
      gravityDir: { x: 0, y: -1, z: 0 },
      dragForce: 0.4,
      center: -1,
      hitRadius: 0.02,
      bones: [boneNodeByName.get('hairLeftRoot')!].filter(Boolean),
      colliderGroups: [0],
    },
    {
      comment: 'HairRightSpring',
      stiffiness: 0.65,
      gravityPower: 0.25,
      gravityDir: { x: 0, y: -1, z: 0 },
      dragForce: 0.4,
      center: -1,
      hitRadius: 0.02,
      bones: [boneNodeByName.get('hairRightRoot')!].filter(Boolean),
      colliderGroups: [0],
    },
    ...(spec.features.hasCloak
      ? [
          {
            comment: 'CloakSpring',
            stiffiness: 0.45,
            gravityPower: 0.35,
            gravityDir: { x: 0, y: -1, z: 0 },
            dragForce: 0.45,
            center: -1,
            hitRadius: 0.03,
            bones: [boneNodeByName.get('cloakTop')!].filter(Boolean),
            colliderGroups: [1],
          },
        ]
      : []),
  ];

  const negZeroClean = (v: number) => (v === 0 ? 0 : -v);

  const packScene = (rotateY180: boolean) => {
    const chunks: Uint8Array[] = [];
    let byteOffset = 0;
    const bufferViews: Array<Record<string, unknown>> = [];
    const accessors: Array<Record<string, unknown>> = [];

    const pushBufferSlice = (bytes: Uint8Array, target?: number): number => {
      const pad = (4 - (byteOffset % 4)) % 4;
      if (pad > 0) {
        chunks.push(new Uint8Array(pad));
        byteOffset += pad;
      }
      const bvIdx = bufferViews.length;
      const bv: Record<string, unknown> = {
        buffer: 0,
        byteOffset,
        byteLength: bytes.length,
      };
      if (target) bv.target = target;
      bufferViews.push(bv);
      chunks.push(bytes);
      byteOffset += bytes.length;
      return bvIdx;
    };

    const images: Array<Record<string, unknown>> = [];
    const textures: Array<Record<string, unknown>> = [];
    for (const td of textureDefs) {
      const bvIdx = pushBufferSlice(td.bytes);
      const imgIdx = images.length;
      images.push({ name: td.name, mimeType: 'image/png', bufferView: bvIdx });
      textures.push({ sampler: 0, source: imgIdx });
    }

    const ibmArray = new Float32Array(bones.length * 16);
    for (let i = 0; i < bones.length; i++) {
      const wp = bones[i].worldPos;
      const wx = rotateY180 ? negZeroClean(wp[0]) : wp[0];
      const wy = wp[1];
      const wz = rotateY180 ? negZeroClean(wp[2]) : wp[2];
      const base = i * 16;
      ibmArray[base + 0] = 1;
      ibmArray[base + 5] = 1;
      ibmArray[base + 10] = 1;
      ibmArray[base + 12] = -wx;
      ibmArray[base + 13] = -wy;
      ibmArray[base + 14] = -wz;
      ibmArray[base + 15] = 1;
    }
    const ibmBv = pushBufferSlice(new Uint8Array(ibmArray.buffer));
    const ibmAccessorIdx = accessors.length;
    accessors.push({ bufferView: ibmBv, componentType: 5126, count: bones.length, type: 'MAT4' });

    let totalVertices = 0;
    let totalTriangles = 0;
    const gltfMeshes: Array<Record<string, unknown>> = [];

    for (let pIdx = 0; pIdx < primitives.length; pIdx++) {
      const prim = primitives[pIdx];
      const vertCount = prim.positions.length / 3;
      totalVertices += vertCount;
      totalTriangles += prim.indices.length / 3;

      const posArr = new Float32Array(prim.positions);
      if (rotateY180) {
        for (let i = 0; i < posArr.length; i += 3) {
          posArr[i] = negZeroClean(posArr[i]);
          posArr[i + 2] = negZeroClean(posArr[i + 2]);
        }
      }
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < posArr.length; i += 3) {
        min[0] = Math.min(min[0], posArr[i]);
        min[1] = Math.min(min[1], posArr[i + 1]);
        min[2] = Math.min(min[2], posArr[i + 2]);
        max[0] = Math.max(max[0], posArr[i]);
        max[1] = Math.max(max[1], posArr[i + 1]);
        max[2] = Math.max(max[2], posArr[i + 2]);
      }
      const posBv = pushBufferSlice(new Uint8Array(posArr.buffer), 34962);
      const posAcc = accessors.length;
      accessors.push({ bufferView: posBv, componentType: 5126, count: vertCount, type: 'VEC3', min, max });

      const normArr = new Float32Array(prim.normals);
      if (rotateY180) {
        for (let i = 0; i < normArr.length; i += 3) {
          normArr[i] = negZeroClean(normArr[i]);
          normArr[i + 2] = negZeroClean(normArr[i + 2]);
        }
      }
      const normBv = pushBufferSlice(new Uint8Array(normArr.buffer), 34962);
      const normAcc = accessors.length;
      accessors.push({ bufferView: normBv, componentType: 5126, count: vertCount, type: 'VEC3' });

      const uvBv = pushBufferSlice(new Uint8Array(new Float32Array(prim.uvs).buffer), 34962);
      const uvAcc = accessors.length;
      accessors.push({ bufferView: uvBv, componentType: 5126, count: vertCount, type: 'VEC2' });

      const jointsBv = pushBufferSlice(new Uint8Array(prim.joints), 34962);
      const jointsAcc = accessors.length;
      accessors.push({ bufferView: jointsBv, componentType: 5121, count: vertCount, type: 'VEC4' });

      const weightsBv = pushBufferSlice(new Uint8Array(new Float32Array(prim.weights).buffer), 34962);
      const weightsAcc = accessors.length;
      accessors.push({ bufferView: weightsBv, componentType: 5126, count: vertCount, type: 'VEC4' });

      const indexArr = new Uint32Array(prim.indices);
      const indexBv = pushBufferSlice(new Uint8Array(indexArr.buffer), 34963);
      const indexAcc = accessors.length;
      accessors.push({ bufferView: indexBv, componentType: 5125, count: indexArr.length, type: 'SCALAR' });

      const primAttributes: Record<string, number> = {
        POSITION: posAcc,
        NORMAL: normAcc,
        TEXCOORD_0: uvAcc,
        JOINTS_0: jointsAcc,
        WEIGHTS_0: weightsAcc,
      };

      if (prim.colors && prim.colors.length === vertCount * 4) {
        const colBv = pushBufferSlice(new Uint8Array(new Float32Array(prim.colors).buffer), 34962);
        const colAcc = accessors.length;
        accessors.push({ bufferView: colBv, componentType: 5126, count: vertCount, type: 'VEC4' });
        primAttributes.COLOR_0 = colAcc;
      }

      const primEntry: Record<string, unknown> = {
        attributes: primAttributes,
        indices: indexAcc,
        material: prim.materialIndex,
      };

      const morphs = precomputedMorphs[pIdx];
      if (prim.hasMorphTargets && morphs.length > 0) {
        const targetsArray: Array<Record<string, number>> = [];
        for (const m of morphs) {
          const deltas = rotateY180 ? new Float32Array(m.deltas) : m.deltas;
          if (rotateY180) {
            for (let i = 0; i < deltas.length; i += 3) {
              deltas[i] = negZeroClean(deltas[i]);
              deltas[i + 2] = negZeroClean(deltas[i + 2]);
            }
          }
          const mMin = [Infinity, Infinity, Infinity];
          const mMax = [-Infinity, -Infinity, -Infinity];
          for (let i = 0; i < deltas.length; i += 3) {
            mMin[0] = Math.min(mMin[0], deltas[i]);
            mMin[1] = Math.min(mMin[1], deltas[i + 1]);
            mMin[2] = Math.min(mMin[2], deltas[i + 2]);
            mMax[0] = Math.max(mMax[0], deltas[i]);
            mMax[1] = Math.max(mMax[1], deltas[i + 1]);
            mMax[2] = Math.max(mMax[2], deltas[i + 2]);
          }
          const mBv = pushBufferSlice(new Uint8Array(deltas.buffer), 34962);
          const mAcc = accessors.length;
          accessors.push({
            bufferView: mBv,
            componentType: 5126,
            count: vertCount,
            type: 'VEC3',
            min: mMin,
            max: mMax,
          });
          targetsArray.push({ POSITION: mAcc });
        }
        primEntry.targets = targetsArray;
      }

      const meshObj: Record<string, unknown> = {
        name: prim.name,
        primitives: [primEntry],
      };
      if (prim.hasMorphTargets) {
        meshObj.extras = { targetNames: MORPH_EXPRESSION_NAMES };
      }
      gltfMeshes.push(meshObj);
    }

    const nodes: Array<Record<string, unknown>> = [];
    const boneChildrenMap = new Map<number, number[]>();
    bones.forEach((b, i) => {
      if (b.parent >= 0) {
        const list = boneChildrenMap.get(b.parent) ?? [];
        list.push(i + 1);
        boneChildrenMap.set(b.parent, list);
      }
    });

    const meshNodeIndices = primitives.map((_, idx) => firstMeshNodeIdx + idx);
    nodes.push({
      name: `${spec.name.replace(/\s+/g, '_')}_Root`,
      children: [1, ...meshNodeIndices],
    });

    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      const tr: [number, number, number] = rotateY180
        ? [negZeroClean(b.localPos[0]), b.localPos[1], negZeroClean(b.localPos[2])]
        : b.localPos;
      const nodeObj: Record<string, unknown> = {
        name: b.name,
        translation: tr,
      };
      const ch = boneChildrenMap.get(i);
      if (ch && ch.length > 0) {
        nodeObj.children = ch;
      }
      nodes.push(nodeObj);
    }

    for (let mIdx = 0; mIdx < primitives.length; mIdx++) {
      nodes.push({
        name: primitives[mIdx].name,
        mesh: mIdx,
        skin: 0,
      });
    }

    const jointNodeIndices = bones.map((_, i) => i + 1);
    const binBytes = new Uint8Array(byteOffset);
    let writePtr = 0;
    for (const ch of chunks) {
      binBytes.set(ch, writePtr);
      writePtr += ch.length;
    }

    const baseGltf: Record<string, unknown> = {
      asset: {
        version: '2.0',
        generator: `VRM Forge Studio High-Detail Anatomical Sculptor (glTF 2.0 + VRM ${targetVrmVersion})`,
      },
      scene: 0,
      scenes: [{ name: 'Scene', nodes: [0] }],
      nodes,
      meshes: gltfMeshes,
      skins: [
        {
          name: 'HumanoidArmature',
          inverseBindMatrices: ibmAccessorIdx,
          skeleton: 1,
          joints: jointNodeIndices,
        },
      ],
      materials,
      textures,
      images,
      samplers: [
        {
          magFilter: 9729,
          minFilter: 9987,
          wrapS: 10497,
          wrapT: 10497,
        },
      ],
      accessors,
      bufferViews,
      buffers: [{ byteLength: binBytes.length }],
    };

    return { baseGltf, binBytes, totalVertices, totalTriangles, texturesCount: textures.length };
  };

  // Standard glTF 2.0 (+Z forward) package for character.glb / source_high.glb
  const glbPack = packScene(false);
  const glbBuffer = packGlbBinary(glbPack.baseGltf, glbPack.binBytes);

  if (mode === 'glb_only') {
    return {
      vrmBuffer: glbBuffer,
      glbBuffer,
      stats: {
        vertexCount: glbPack.totalVertices,
        triangleCount: glbPack.totalTriangles,
        boneCount: bones.length,
        materialCount: materials.length,
        textureCount: glbPack.texturesCount,
        expressionCount: Object.keys(expressionPresetMap).length,
        springBoneJointCount: springJointDefs.length,
      },
    };
  }

  // Official VRM 0.0 requires -Z forward (Ry(pi) from +Z); VRM 1.0 uses +Z forward
  const vrmPack = targetVrmVersion === '0.0' ? packScene(true) : glbPack;
  const meshNodesMap = primitives.map((_, idx) => ({
    meshIndex: idx,
    nodeIndex: firstMeshNodeIdx + idx,
  }));

  const vrmGltf: Record<string, unknown> =
    targetVrmVersion === '0.0'
      ? {
          ...vrmPack.baseGltf,
          extensionsUsed: ['VRM'],
          extensions: {
            VRM: buildVrm0Extension({
              meta: effectiveMeta,
              humanBones,
              headScale: spec.proportions.headScale,
              meshNodes: meshNodesMap,
              expressionPresetBinds,
              colliderGroups: vrm0ColliderGroups,
              boneGroups: vrm0BoneGroups,
            }),
          },
        }
      : {
          ...vrmPack.baseGltf,
          extensionsUsed: ['VRMC_vrm', 'VRMC_springBone'],
          extensions: {
            VRMC_vrm: {
              specVersion: '1.0',
              meta: buildVrm1MetaBlock(effectiveMeta),
              humanoid: { humanBones },
              firstPerson: { meshAnnotations: [] },
              lookAt: {
                offsetFromHeadBone: [0, 0.08 * spec.proportions.headScale, 0],
                type: 'bone',
                rangeMapHorizontalInner: { inputMaxValue: 90, outputScale: 10 },
                rangeMapHorizontalOuter: { inputMaxValue: 90, outputScale: 10 },
                rangeMapVerticalDown: { inputMaxValue: 90, outputScale: 10 },
                rangeMapVerticalUp: { inputMaxValue: 90, outputScale: 10 },
              },
              expressions: { preset: expressionPresetMap },
            },
            VRMC_springBone: {
              specVersion: '1.0',
              springs,
            },
          },
        };

  const vrmBuffer = packGlbBinary(vrmGltf, vrmPack.binBytes);

  return {
    vrmBuffer,
    glbBuffer,
    stats: {
      vertexCount: vrmPack.totalVertices,
      triangleCount: vrmPack.totalTriangles,
      boneCount: bones.length,
      materialCount: materials.length,
      textureCount: vrmPack.texturesCount,
      expressionCount: Object.keys(expressionPresetMap).length,
      springBoneJointCount: springJointDefs.length,
    },
  };
}

/**
 * Fast analytical pre-export metric estimator used in UI & /api/characters/estimate
 * matching actual sculpted mesh and texture budgets.
 */
export function estimateCharacterMetrics(spec: CharacterSpecification): ExportEstimates {
  const srcB = getQualityBudget(spec.qualityConfig.geometryQuality);
  const optB = getOptimizedBudget(spec.qualityConfig);

  const countFromBudget = (b: ReturnType<typeof getQualityBudget>) => {
    const headTris = b.headLat * b.headLon * 2 + 16 * 20 * 4 + 640;
    const torsoTris = b.torsoRadial * b.torsoRings * 2.1 + (spec.features.hasArmor ? 1650 : 620);
    const limbTris = b.limbRadial * 46 + b.fingerRadial * 40;
    const hairTris = b.hairStrands * b.hairSegments * 16 + 1850;
    const cloakTris = (spec.features.hasCloak ? b.cloakCols * b.cloakRows * 4 : 0) + (spec.features.hasWings ? 760 : 0);
    const tris = Math.round(headTris + torsoTris + limbTris + hairTris + cloakTris);
    const verts = Math.round(tris * 0.62);
    return { tris, verts };
  };

  const src = countFromBudget(srcB);
  const opt =
    spec.qualityConfig.vrmOptimization === 'unoptimized' ? src : countFromBudget(optB);

  const textureTargetPx = textureResolutionToTargetPx(spec.qualityConfig.textureResolution);
  const packedTexturePx = resolvePackedTextureSize(spec.qualityConfig);
  // 7 RGBA albedo + 1 iris emissive + 4 RGBA normal maps uncompressed VRAM footprint at target bake resolution
  const estimatedTextureMemoryMb = Number(
    ((12 * textureTargetPx * textureTargetPx * 4) / (1024 * 1024)).toFixed(1)
  );
  const packedTexKb = Math.round((packedTexturePx * packedTexturePx * 0.65 * 12) / 1024);
  const estimatedVrmSizeKb = Math.round((opt.verts * 96) / 1024 + packedTexKb);
  const estimatedSourceGlbSizeKb = Math.round((src.verts * 96) / 1024 + packedTexKb * 1.35);

  return {
    sourceTriangles: src.tris,
    sourceVertices: src.verts,
    optimizedTriangles: opt.tris,
    optimizedVertices: opt.verts,
    textureTargetPx,
    packedTexturePx,
    estimatedTextureMemoryMb,
    estimatedVrmSizeKb,
    estimatedSourceGlbSizeKb,
  };
}

export function buildCharacterVrmAndGlb(spec: CharacterSpecification): BuiltVrmResult {
  const tRig0 = performance.now();
  const bones = buildHumanoidSkeleton(spec);
  const riggingMs = Math.max(1, Math.round(performance.now() - tRig0));

  const sourceBudget = getQualityBudget(spec.qualityConfig.geometryQuality);
  const vrmBudget = getOptimizedBudget(spec.qualityConfig);

  const tGeom0 = performance.now();
  const sourcePrimitives = buildHighDetailCharacterGeometry(spec, bones, sourceBudget);
  const geometryMs = Math.max(1, Math.round(performance.now() - tGeom0));

  const isUnoptimized = spec.qualityConfig.vrmOptimization === 'unoptimized';
  const tRetopo0 = performance.now();
  const vrmPrimitives = isUnoptimized
    ? sourcePrimitives
    : buildHighDetailCharacterGeometry(spec, bones, vrmBudget);
  const retopologyMs = isUnoptimized ? 0 : Math.max(1, Math.round(performance.now() - tRetopo0));

  const packedTexturePx = resolvePackedTextureSize(spec.qualityConfig);
  const sourceTexPx = Math.max(
    packedTexturePx,
    Math.min(512, textureResolutionToTargetPx(spec.qualityConfig.textureResolution))
  );

  const tPkg0 = performance.now();
  const vrmPackage = assembleGltfPackage(spec, bones, vrmPrimitives, packedTexturePx, true, 'both');
  const sourcePackage = isUnoptimized
    ? vrmPackage
    : assembleGltfPackage(spec, bones, sourcePrimitives, sourceTexPx, true, 'glb_only');
  const totalPkgMs = Math.max(1, Math.round(performance.now() - tPkg0));
  const materialsMs = Math.max(1, Math.round(totalPkgMs * 0.45));
  const facialMs = Math.max(1, Math.round(totalPkgMs * 0.35));
  const packageMs = Math.max(1, totalPkgMs - materialsMs - facialMs);

  const textureTargetPx = textureResolutionToTargetPx(spec.qualityConfig.textureResolution);
  const estimatedTextureMemoryMb = Number(
    ((12 * textureTargetPx * textureTargetPx * 4) / (1024 * 1024)).toFixed(1)
  );

  const estimates: ExportEstimates = {
    sourceTriangles: sourcePackage.stats.triangleCount,
    sourceVertices: sourcePackage.stats.vertexCount,
    optimizedTriangles: vrmPackage.stats.triangleCount,
    optimizedVertices: vrmPackage.stats.vertexCount,
    textureTargetPx,
    packedTexturePx,
    estimatedTextureMemoryMb,
    estimatedVrmSizeKb: Math.round(vrmPackage.vrmBuffer.byteLength / 1024),
    estimatedSourceGlbSizeKb: Math.round(sourcePackage.glbBuffer.byteLength / 1024),
  };

  const targetVrmVersion: VrmExportVersion =
    spec.riggingRequirements.vrmVersion === '1.0' ? '1.0' : '0.0';

  return {
    vrmBuffer: vrmPackage.vrmBuffer,
    glbBuffer: vrmPackage.glbBuffer,
    sourceGlbBuffer: sourcePackage.glbBuffer,
    vrmVersion: targetVrmVersion,
    stats: vrmPackage.stats,
    sourceStats: sourcePackage.stats,
    estimates,
    timingsMs: {
      geometryMs,
      retopologyMs,
      materialsMs,
      riggingMs,
      facialMs,
      packageMs,
    },
    rigReport: {
      sourceState: 'unrigged',
      mappingSource: 'generated',
      mappedCount: bones.filter((b) => Boolean(b.vrmName)).length,
      missingBones: [],
      secondaryBoneCount: bones.filter((b) => !b.vrmName).length,
      detail: `Generated sculpted 65-bone humanoid + secondary spring skeleton (${targetVrmVersion})`,
    },
  };
}

/**
 * Milestone 3 Production External GLB -> VRM 1.0 Converter:
 * - Preserves ALL meshes, primitives, PBR materials, embedded images/textures, samplers,
 *   UVs (TEXCOORD_0/1), vertex colors (COLOR_0), node transforms, and existing morph targets.
 * - Supports BOTH already-rigged humanoid GLBs (preserving existing skeleton & weights)
 *   AND unrigged external GLBs (fitting humanoid armature + Laplacian-smoothed bone-capsule weighting).
 * - Never replaces external PBR textures with procedural placeholder textures.
 */
export function buildRiggedVrmFromExternalMesh(
  spec: CharacterSpecification,
  externalAsset: ParsedGlbAsset,
  rawExternalGlbBuffer: Uint8Array
): BuiltVrmResult {
  const flatPrims: ImportedPrimitiveData[] = [];
  if (externalAsset.meshes && externalAsset.meshes.length > 0) {
    for (const m of externalAsset.meshes) {
      for (const p of m.primitives) {
        flatPrims.push(p);
      }
    }
  } else if (externalAsset.positions.length >= 9 && externalAsset.indices.length >= 3) {
    flatPrims.push({
      meshIndex: 0,
      meshName: 'External_Imported_Humanoid',
      primitiveIndex: 0,
      name: 'External_Imported_Humanoid',
      materialIndex: 0,
      hasNormals: externalAsset.normals.length > 0,
      hasUvs: externalAsset.uvs.length > 0,
      hasUvs1: false,
      hasColors: false,
      hasSkinning: false,
      positions: externalAsset.positions,
      normals: externalAsset.normals,
      uvs: externalAsset.uvs,
      indices: externalAsset.indices,
      morphTargets: [],
    });
  }

  if (flatPrims.length === 0 || externalAsset.vertexCount === 0 || externalAsset.triangleCount === 0) {
    throw new Error('Imported external GLB contains empty geometry.');
  }

  const [minX, minY, minZ] = externalAsset.boundsMin;
  const [maxX, maxY, maxZ] = externalAsset.boundsMax;
  const srcHeight = Math.max(0.001, maxY - minY);
  const targetHeight = spec.proportions.heightMeters;

  // Determine whether we can preserve an existing humanoid skeleton cleanly
  const primarySkin =
    externalAsset.hasExistingSkin && externalAsset.skins.length > 0
      ? externalAsset.skins[0]
      : undefined;
  const allPrimsSkinned =
    Boolean(primarySkin) && flatPrims.every((p) => p.hasSkinning && p.joints && p.weights);
  const skinMapping =
    primarySkin && allPrimsSkinned
      ? mapExistingSkinToVrmHumanoid(
          primarySkin,
          externalAsset.existingVrmHumanoid,
          externalAsset.sourceVrmVersion
        )
      : null;

  const rigWarnings: string[] = [...(externalAsset.unsupportedFeatures ?? [])];
  if (externalAsset.multiSkinAudit && !externalAsset.multiSkinAudit.allSkinsCompatible) {
    for (const w of externalAsset.multiSkinAudit.warnings) {
      if (!rigWarnings.includes(w)) rigWarnings.push(w);
    }
  }
  const hasLossyMultiSkin = Boolean(
    externalAsset.multiSkinAudit && !externalAsset.multiSkinAudit.allSkinsCompatible
  );

  const preserveExistingRig = Boolean(skinMapping && skinMapping.allRequiredPresent && primarySkin);
  const rigReport: RigReport = preserveExistingRig && skinMapping && primarySkin
    ? {
        sourceState: 'valid_preserved',
        mappingSource: skinMapping.mappingSource,
        mappedCount: Object.keys(skinMapping.humanBoneToJointIndex).length,
        missingBones: [],
        secondaryBoneCount: skinMapping.secondaryJointIndices.length,
        lossyConversion: hasLossyMultiSkin || undefined,
        warnings: rigWarnings.length > 0 ? rigWarnings : undefined,
        detail: `Preserved existing skeleton (${primarySkin.joints.length} joints) via ${skinMapping.mappingSource} mapping with ${skinMapping.secondaryJointIndices.length} secondary/accessory bones`,
      }
    : primarySkin
      ? {
          sourceState: 'replaced',
          mappingSource: 'generated',
          mappedCount: 55,
          missingBones: skinMapping?.missingRequired ?? [...VRM_REQUIRED_HUMANOID_BONES],
          secondaryBoneCount: 10,
          lossyConversion: true,
          warnings: rigWarnings.length > 0 ? rigWarnings : undefined,
          detail: `Replaced incomplete/unskinned source rig (missing: ${(skinMapping?.missingRequired ?? []).join(', ') || 'skinning weights'}) with silhouette-fitted humanoid armature`,
        }
      : {
          sourceState: 'unrigged',
          mappingSource: 'generated',
          mappedCount: 55,
          missingBones: [],
          secondaryBoneCount: 10,
          warnings: rigWarnings.length > 0 ? rigWarnings : undefined,
          detail: 'Fitted 65-bone humanoid armature & Laplacian-smoothed capsule skin weights onto unrigged GLB',
        };

  const tRig0 = performance.now();

  let scale = 1.0;
  let offsetX = 0;
  let offsetY = 0;
  let offsetZ = 0;
  let headBoneY = targetHeight * 0.88;
  let headCenterY = targetHeight * 0.92;
  let faceForwardSign: 1 | -1 = 1;

  // Build output joint nodes & VRM humanBones map
  const jointNodes: Array<{
    name: string;
    parent: number;
    translation: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    worldPos: [number, number, number];
  }> = [];
  let humanBones: Record<string, { node: number }> = {};
  let ibmBytes: Float32Array;
  let skeletonRootLocalIdx = 0;

  // Per-primitive joints/weights arrays (supporting up to 8 influences via JOINTS_1/WEIGHTS_1)
  const primPositions: Float32Array[] = [];
  const primJoints: Uint16Array[] = [];
  const primWeights: Float32Array[] = [];
  const primJoints1: Array<Uint16Array | undefined> = [];
  const primWeights1: Array<Float32Array | undefined> = [];
  let maxWeightSumError = 0;
  let jointDeformations = [];
  let weightedVerticesTotal = 0;
  let totalVertices = 0;

  if (preserveExistingRig && primarySkin && skinMapping) {
    const needsUnitScale = srcHeight > 4.0 || srcHeight < 0.4;
    const needsFloorAlign = Math.abs(minY) > 0.12 || Math.abs((minX + maxX) * 0.5) > 0.25;
    if (needsUnitScale || needsFloorAlign) {
      scale = needsUnitScale ? targetHeight / srcHeight : 1.0;
      offsetX = -(minX + maxX) * 0.5;
      offsetY = -minY;
      offsetZ = -(minZ + maxZ) * 0.5;
    }

    const roots: number[] = [];
    primarySkin.joints.forEach((j, idx) => {
      const isRoot = j.parentJointIndex < 0;
      if (isRoot) roots.push(idx);
      const t: [number, number, number] = isRoot
        ? [
            (j.localTranslation[0] + offsetX) * scale,
            (j.localTranslation[1] + offsetY) * scale,
            (j.localTranslation[2] + offsetZ) * scale,
          ]
        : [
            j.localTranslation[0] * scale,
            j.localTranslation[1] * scale,
            j.localTranslation[2] * scale,
          ];
      const isNonDefaultRot =
        Math.abs(j.localRotation[0]) > 1e-5 ||
        Math.abs(j.localRotation[1]) > 1e-5 ||
        Math.abs(j.localRotation[2]) > 1e-5 ||
        Math.abs(j.localRotation[3] - 1) > 1e-5;
      const isNonDefaultScale =
        Math.abs(j.localScale[0] - 1) > 1e-5 ||
        Math.abs(j.localScale[1] - 1) > 1e-5 ||
        Math.abs(j.localScale[2] - 1) > 1e-5;

      jointNodes.push({
        name: j.name,
        parent: j.parentJointIndex,
        translation: t,
        rotation: isNonDefaultRot ? j.localRotation : undefined,
        scale: isNonDefaultScale ? j.localScale : undefined,
        worldPos: [
          (j.worldPos[0] + offsetX) * scale,
          (j.worldPos[1] + offsetY) * scale,
          (j.worldPos[2] + offsetZ) * scale,
        ],
      });
    });
    skeletonRootLocalIdx = roots[0] ?? 0;

    for (const [vrmBone, jIdx] of Object.entries(skinMapping.humanBoneToJointIndex)) {
      humanBones[vrmBone] = { node: jIdx + 1 };
    }

    const headJointIdx = skinMapping.humanBoneToJointIndex['head'];
    if (headJointIdx !== undefined && jointNodes[headJointIdx]) {
      headBoneY = jointNodes[headJointIdx].worldPos[1];
      const topY = (maxY + offsetY) * scale;
      headCenterY = Math.min(topY - 0.085 * spec.proportions.headScale, headBoneY + 0.04 * spec.proportions.headScale);
      headBoneY = Math.min(headBoneY, headCenterY - 0.08 * spec.proportions.headScale);
    }

    // Preserve inverseBindMatrices (adjusted only if whole-model offset/scale was applied)
    ibmBytes = new Float32Array(jointNodes.length * 16);
    if (primarySkin.inverseBindMatrices && primarySkin.inverseBindMatrices.length >= jointNodes.length * 16) {
      ibmBytes.set(primarySkin.inverseBindMatrices.subarray(0, jointNodes.length * 16));
      if (scale !== 1.0 || offsetX !== 0 || offsetY !== 0 || offsetZ !== 0) {
        const dx = offsetX * scale;
        const dy = offsetY * scale;
        const dz = offsetZ * scale;
        for (let i = 0; i < jointNodes.length; i++) {
          const b = i * 16;
          const m0 = ibmBytes[b], m1 = ibmBytes[b + 1], m2 = ibmBytes[b + 2];
          const m4 = ibmBytes[b + 4], m5 = ibmBytes[b + 5], m6 = ibmBytes[b + 6];
          const m8 = ibmBytes[b + 8], m9 = ibmBytes[b + 9], m10 = ibmBytes[b + 10];
          const tx = ibmBytes[b + 12] * scale - (m0 * dx + m4 * dy + m8 * dz);
          const ty = ibmBytes[b + 13] * scale - (m1 * dx + m5 * dy + m9 * dz);
          const tz = ibmBytes[b + 14] * scale - (m2 * dx + m6 * dy + m10 * dz);
          ibmBytes[b + 12] = tx;
          ibmBytes[b + 13] = ty;
          ibmBytes[b + 14] = tz;
        }
      }
    } else {
      for (let i = 0; i < jointNodes.length; i++) {
        const wp = jointNodes[i].worldPos;
        const b = i * 16;
        ibmBytes[b] = 1; ibmBytes[b + 5] = 1; ibmBytes[b + 10] = 1; ibmBytes[b + 15] = 1;
        ibmBytes[b + 12] = -wp[0]; ibmBytes[b + 13] = -wp[1]; ibmBytes[b + 14] = -wp[2];
      }
    }

    // Transform & validate weights per primitive
    const concatPos: number[] = [];
    const concatJ: number[] = [];
    const concatW: number[] = [];
    for (const p of flatPrims) {
      const vc = Math.floor(p.positions.length / 3);
      totalVertices += vc;
      const posOut = new Float32Array(vc * 3);
      const jOut = new Uint16Array(vc * 4);
      const wOut = new Float32Array(vc * 4);
      const hasEightInf = Boolean(
        p.joints1 && p.weights1 && p.joints1.length >= vc * 4 && p.weights1.length >= vc * 4
      );
      const j1Out = hasEightInf ? new Uint16Array(vc * 4) : undefined;
      const w1Out = hasEightInf ? new Float32Array(vc * 4) : undefined;
      for (let i = 0; i < vc; i++) {
        const px = (p.positions[i * 3] + offsetX) * scale;
        const py = (p.positions[i * 3 + 1] + offsetY) * scale;
        const pz = (p.positions[i * 3 + 2] + offsetZ) * scale;
        posOut[i * 3] = px; posOut[i * 3 + 1] = py; posOut[i * 3 + 2] = pz;
        concatPos.push(px, py, pz);

        const j0 = Math.min(jointNodes.length - 1, p.joints![i * 4]);
        const j1 = Math.min(jointNodes.length - 1, p.joints![i * 4 + 1]);
        const j2 = Math.min(jointNodes.length - 1, p.joints![i * 4 + 2]);
        const j3 = Math.min(jointNodes.length - 1, p.joints![i * 4 + 3]);
        const rawW0 = Math.max(0, p.weights![i * 4]);
        const rawW1 = Math.max(0, p.weights![i * 4 + 1]);
        const rawW2 = Math.max(0, p.weights![i * 4 + 2]);
        const rawW3 = Math.max(0, p.weights![i * 4 + 3]);

        let rawW4 = 0, rawW5 = 0, rawW6 = 0, rawW7 = 0;
        let j4 = 0, j5 = 0, j6 = 0, j7 = 0;
        if (hasEightInf && j1Out && w1Out) {
          j4 = Math.min(jointNodes.length - 1, p.joints1![i * 4]);
          j5 = Math.min(jointNodes.length - 1, p.joints1![i * 4 + 1]);
          j6 = Math.min(jointNodes.length - 1, p.joints1![i * 4 + 2]);
          j7 = Math.min(jointNodes.length - 1, p.joints1![i * 4 + 3]);
          rawW4 = Math.max(0, p.weights1![i * 4]);
          rawW5 = Math.max(0, p.weights1![i * 4 + 1]);
          rawW6 = Math.max(0, p.weights1![i * 4 + 2]);
          rawW7 = Math.max(0, p.weights1![i * 4 + 3]);
        }

        const sum = rawW0 + rawW1 + rawW2 + rawW3 + rawW4 + rawW5 + rawW6 + rawW7 || 1;
        jOut[i * 4] = j0; jOut[i * 4 + 1] = j1; jOut[i * 4 + 2] = j2; jOut[i * 4 + 3] = j3;
        wOut[i * 4] = rawW0 / sum;
        wOut[i * 4 + 1] = rawW1 / sum;
        wOut[i * 4 + 2] = rawW2 / sum;
        wOut[i * 4 + 3] = rawW3 / sum;
        let totalSum = wOut[i * 4] + wOut[i * 4 + 1] + wOut[i * 4 + 2] + wOut[i * 4 + 3];
        if (hasEightInf && j1Out && w1Out) {
          j1Out[i * 4] = j4; j1Out[i * 4 + 1] = j5; j1Out[i * 4 + 2] = j6; j1Out[i * 4 + 3] = j7;
          w1Out[i * 4] = rawW4 / sum;
          w1Out[i * 4 + 1] = rawW5 / sum;
          w1Out[i * 4 + 2] = rawW6 / sum;
          w1Out[i * 4 + 3] = rawW7 / sum;
          totalSum += w1Out[i * 4] + w1Out[i * 4 + 1] + w1Out[i * 4 + 2] + w1Out[i * 4 + 3];
        }
        const err = Math.abs(totalSum - 1.0);
        if (err > maxWeightSumError) maxWeightSumError = err;
        weightedVerticesTotal++;
        concatJ.push(j0, j1, j2, j3);
        concatW.push(wOut[i * 4], wOut[i * 4 + 1], wOut[i * 4 + 2], wOut[i * 4 + 3]);
      }
      primPositions.push(posOut);
      primJoints.push(jOut);
      primWeights.push(wOut);
      primJoints1.push(j1Out);
      primWeights1.push(w1Out);
    }

    jointDeformations = auditJointDeformations(
      new Float32Array(concatPos),
      concatJ,
      new Float32Array(concatW),
      (vrmBoneName) => skinMapping.humanBoneToJointIndex[vrmBoneName],
      (jIdx) => jointNodes[jIdx]?.worldPos ?? [0, 1, 0]
    );
  } else {
    // Unrigged GLB path: fit silhouette-aware VRM armature + Laplacian-smoothed capsule weights
    const baseBones = buildHumanoidSkeleton(spec);
    const fit = fitArmatureToExternalGeometry(spec, externalAsset, baseBones);
    scale = fit.scale;
    offsetX = fit.offsetX;
    offsetY = fit.offsetY;
    offsetZ = fit.offsetZ;
    headCenterY = fit.headCenterY;
    faceForwardSign = fit.faceForwardSign;

    const fittedBones = fit.bones;
    const headIdx = fittedBones.findIndex((b) => b.name === 'head');
    headBoneY = headIdx >= 0 ? fittedBones[headIdx].worldPos[1] : targetHeight * 0.88;

    fittedBones.forEach((b, i) => {
      jointNodes.push({
        name: b.name,
        parent: b.parent,
        translation: b.localPos,
        worldPos: b.worldPos,
      });
      if (b.vrmName) {
        humanBones[b.vrmName] = { node: i + 1 };
      }
    });

    ibmBytes = new Float32Array(fittedBones.length * 16);
    for (let i = 0; i < fittedBones.length; i++) {
      const wp = fittedBones[i].worldPos;
      const base = i * 16;
      ibmBytes[base] = 1; ibmBytes[base + 5] = 1; ibmBytes[base + 10] = 1; ibmBytes[base + 15] = 1;
      ibmBytes[base + 12] = -wp[0]; ibmBytes[base + 13] = -wp[1]; ibmBytes[base + 14] = -wp[2];
    }

    // Concatenate scaled positions & indices so Laplacian smoothing bridges UV/material seams across primitives
    const vertCounts = flatPrims.map((p) => Math.floor(p.positions.length / 3));
    totalVertices = vertCounts.reduce((acc, c) => acc + c, 0);
    const mergedScaledPos = new Float32Array(totalVertices * 3);
    const mergedIndices: number[] = [];

    let vCursor = 0;
    for (let pIdx = 0; pIdx < flatPrims.length; pIdx++) {
      const p = flatPrims[pIdx];
      const vc = vertCounts[pIdx];
      const posOut = new Float32Array(vc * 3);
      for (let i = 0; i < vc; i++) {
        const px = (p.positions[i * 3] + offsetX) * scale;
        const py = (p.positions[i * 3 + 1] + offsetY) * scale;
        const pz = (p.positions[i * 3 + 2] + offsetZ) * scale;
        posOut[i * 3] = px; posOut[i * 3 + 1] = py; posOut[i * 3 + 2] = pz;
        mergedScaledPos[(vCursor + i) * 3] = px;
        mergedScaledPos[(vCursor + i) * 3 + 1] = py;
        mergedScaledPos[(vCursor + i) * 3 + 2] = pz;
      }
      primPositions.push(posOut);
      for (let k = 0; k < p.indices.length; k++) {
        mergedIndices.push(vCursor + p.indices[k]);
      }
      vCursor += vc;
    }

    const skinRes = computeLaplacianCapsuleSkinWeights(
      mergedScaledPos,
      new Uint32Array(mergedIndices),
      fittedBones,
      targetHeight
    );
    maxWeightSumError = skinRes.maxWeightSumError;
    jointDeformations = skinRes.jointDeformations;
    weightedVerticesTotal = totalVertices;

    vCursor = 0;
    for (let pIdx = 0; pIdx < flatPrims.length; pIdx++) {
      const vc = vertCounts[pIdx];
      primJoints.push(skinRes.joints.slice(vCursor * 4, (vCursor + vc) * 4));
      primWeights.push(skinRes.weights.slice(vCursor * 4, (vCursor + vc) * 4));
      vCursor += vc;
    }
  }

  for (const req of VRM_REQUIRED_HUMANOID_BONES) {
    if (!humanBones[req]) {
      throw new Error(`External GLB humanoid mapping error: missing required VRM bone ${req}`);
    }
  }
  const riggingMs = Math.max(1, Math.round(performance.now() - tRig0));

  const targetVrmVersion: VrmExportVersion =
    spec.riggingRequirements.vrmVersion === '1.0' ? '1.0' : '0.0';
  const lArmNodeIdx = humanBones['leftUpperArm']?.node ? humanBones['leftUpperArm'].node - 1 : -1;
  const rArmNodeIdx = humanBones['rightUpperArm']?.node ? humanBones['rightUpperArm'].node - 1 : -1;
  const lArmX = lArmNodeIdx >= 0 ? (jointNodes[lArmNodeIdx]?.worldPos[0] ?? 0.15) : 0.15;
  const rArmX = rArmNodeIdx >= 0 ? (jointNodes[rArmNodeIdx]?.worldPos[0] ?? -0.15) : -0.15;
  const currentlyFacesPlusZ =
    Math.abs(lArmX - rArmX) > 1e-4 ? lArmX > rArmX : faceForwardSign === 1;
  const rotateVrmY180 =
    (targetVrmVersion === '0.0' && currentlyFacesPlusZ) ||
    (targetVrmVersion === '1.0' && !currentlyFacesPlusZ);

  // Assemble multi-primitive, multi-material, texture-preserving binary chunks
  const tMat0 = performance.now();
  const samplersOut =
    externalAsset.samplers && externalAsset.samplers.length > 0
      ? externalAsset.samplers.map((s) => ({
          ...(s.magFilter !== undefined ? { magFilter: s.magFilter } : { magFilter: 9729 }),
          ...(s.minFilter !== undefined ? { minFilter: s.minFilter } : { minFilter: 9987 }),
          ...(s.wrapS !== undefined ? { wrapS: s.wrapS } : { wrapS: 10497 }),
          ...(s.wrapT !== undefined ? { wrapT: s.wrapT } : { wrapT: 10497 }),
        }))
      : [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];

  const texturesOut: Array<Record<string, unknown>> = (externalAsset.textures || []).map((t) => ({
    ...(t.name ? { name: t.name } : {}),
    ...(t.sampler !== undefined ? { sampler: Math.min(t.sampler, samplersOut.length - 1) } : { sampler: 0 }),
    ...(t.source !== undefined ? { source: t.source } : {}),
  }));

  const materialsOut: Array<Record<string, unknown>> =
    externalAsset.materials && externalAsset.materials.length > 0
      ? externalAsset.materials.map((m) => {
          const outMat: Record<string, unknown> = { name: m.name };
          if (m.pbrMetallicRoughness) {
            outMat.pbrMetallicRoughness = {
              ...(m.pbrMetallicRoughness.baseColorFactor
                ? { baseColorFactor: m.pbrMetallicRoughness.baseColorFactor }
                : {}),
              ...(m.pbrMetallicRoughness.baseColorTexture
                ? { baseColorTexture: m.pbrMetallicRoughness.baseColorTexture }
                : {}),
              ...(m.pbrMetallicRoughness.metallicFactor !== undefined
                ? { metallicFactor: m.pbrMetallicRoughness.metallicFactor }
                : {}),
              ...(m.pbrMetallicRoughness.roughnessFactor !== undefined
                ? { roughnessFactor: m.pbrMetallicRoughness.roughnessFactor }
                : {}),
              ...(m.pbrMetallicRoughness.metallicRoughnessTexture
                ? { metallicRoughnessTexture: m.pbrMetallicRoughness.metallicRoughnessTexture }
                : {}),
            };
          }
          if (m.normalTexture) outMat.normalTexture = m.normalTexture;
          if (m.occlusionTexture) outMat.occlusionTexture = m.occlusionTexture;
          if (m.emissiveTexture) outMat.emissiveTexture = m.emissiveTexture;
          if (m.emissiveFactor) outMat.emissiveFactor = m.emissiveFactor;
          if (m.alphaMode && m.alphaMode !== 'OPAQUE') outMat.alphaMode = m.alphaMode;
          if (m.alphaCutoff !== undefined) outMat.alphaCutoff = m.alphaCutoff;
          if (m.doubleSided) outMat.doubleSided = true;
          if (m.extensions) outMat.extensions = m.extensions;
          return outMat;
        })
      : [
          {
            name: 'External_Default_PBR',
            pbrMetallicRoughness: {
              baseColorFactor: [0.85, 0.85, 0.88, 1.0],
              metallicFactor: 0.05,
              roughnessFactor: 0.65,
            },
          },
        ];
  const materialsMs = Math.max(1, Math.round(performance.now() - tMat0));

  // Build morph targets once in input coordinate space
  const tFace0 = performance.now();
  const useUint16Joints = jointNodes.length > 255;
  const expressionPresetBinds: Record<string, Array<{ node: number; index: number; weight: number }>> = {};
  let totalTriangles = 0;
  let preservedMorphCount = 0;
  let synthesizedMorphCount = 0;
  const meshNodeFirstIndex = 1 + jointNodes.length;

  const primMorphBuilds = flatPrims.map((srcPrim, pIdx) => {
    totalTriangles += Math.floor(srcPrim.indices.length / 3);
    const morphBuild = buildOrPreserveMorphTargetsForExternalPrimitive(
      primPositions[pIdx],
      srcPrim.morphTargets,
      scale,
      headBoneY,
      headCenterY,
      spec.proportions.headScale,
      faceForwardSign
    );
    preservedMorphCount += morphBuild.preservedCount;
    synthesizedMorphCount += morphBuild.synthesizedCount;
    if (morphBuild.targets.length > 0) {
      const nodeIdx = meshNodeFirstIndex + pIdx;
      for (const [presetName, targetIdx] of Object.entries(morphBuild.presetToTargetIndex)) {
        const arr = expressionPresetBinds[presetName] ?? [];
        arr.push({ node: nodeIdx, index: targetIdx, weight: 1.0 });
        expressionPresetBinds[presetName] = arr;
      }
    }
    return morphBuild;
  });
  const facialMs = Math.max(1, Math.round(performance.now() - tFace0));

  const tPkg0 = performance.now();
  const negZeroClean = (v: number) => (v === 0 ? 0 : -v);

  const packExternalScene = (rotateY180: boolean) => {
    const chunks: Uint8Array[] = [];
    let byteOffset = 0;
    const bufferViews: Array<Record<string, unknown>> = [];
    const accessors: Array<Record<string, unknown>> = [];

    const pushBufferSlice = (bytes: Uint8Array, target?: number): number => {
      const pad = (4 - (byteOffset % 4)) % 4;
      if (pad > 0) {
        chunks.push(new Uint8Array(pad));
        byteOffset += pad;
      }
      const bvIdx = bufferViews.length;
      const bv: Record<string, unknown> = {
        buffer: 0,
        byteOffset,
        byteLength: bytes.length,
      };
      if (target) bv.target = target;
      bufferViews.push(bv);
      chunks.push(bytes);
      byteOffset += bytes.length;
      return bvIdx;
    };

    // Preserve original embedded images verbatim
    const imagesOut: Array<Record<string, unknown>> = [];
    for (const img of externalAsset.images || []) {
      if (img.bytes.byteLength === 0) continue;
      const bvIdx = pushBufferSlice(img.bytes);
      imagesOut.push({
        name: img.name || `image_${imagesOut.length}`,
        mimeType: img.mimeType || 'image/png',
        bufferView: bvIdx,
      });
    }

    // Conjugate IBMs by Ry(pi): R * M * R flips rows {0,2} XOR cols {0,2}
    const ibmCopy = new Float32Array(ibmBytes);
    if (rotateY180) {
      for (let i = 0; i < jointNodes.length; i++) {
        const b = i * 16;
        ibmCopy[b + 1] = negZeroClean(ibmCopy[b + 1]);
        ibmCopy[b + 3] = negZeroClean(ibmCopy[b + 3]);
        ibmCopy[b + 4] = negZeroClean(ibmCopy[b + 4]);
        ibmCopy[b + 6] = negZeroClean(ibmCopy[b + 6]);
        ibmCopy[b + 9] = negZeroClean(ibmCopy[b + 9]);
        ibmCopy[b + 11] = negZeroClean(ibmCopy[b + 11]);
        ibmCopy[b + 12] = negZeroClean(ibmCopy[b + 12]);
        ibmCopy[b + 14] = negZeroClean(ibmCopy[b + 14]);
      }
    }
    const ibmBv = pushBufferSlice(new Uint8Array(ibmCopy.buffer));
    const ibmAccessorIdx = accessors.length;
    accessors.push({ bufferView: ibmBv, componentType: 5126, count: jointNodes.length, type: 'MAT4' });

    const gltfMeshes: Array<Record<string, unknown>> = [];
    for (let pIdx = 0; pIdx < flatPrims.length; pIdx++) {
      const srcPrim = flatPrims[pIdx];
      const scaledPos = new Float32Array(primPositions[pIdx]);
      if (rotateY180) {
        for (let i = 0; i < scaledPos.length; i += 3) {
          scaledPos[i] = negZeroClean(scaledPos[i]);
          scaledPos[i + 2] = negZeroClean(scaledPos[i + 2]);
        }
      }
      const vertCount = Math.floor(scaledPos.length / 3);

      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < scaledPos.length; i += 3) {
        min[0] = Math.min(min[0], scaledPos[i]);
        min[1] = Math.min(min[1], scaledPos[i + 1]);
        min[2] = Math.min(min[2], scaledPos[i + 2]);
        max[0] = Math.max(max[0], scaledPos[i]);
        max[1] = Math.max(max[1], scaledPos[i + 1]);
        max[2] = Math.max(max[2], scaledPos[i + 2]);
      }
      const posBv = pushBufferSlice(new Uint8Array(scaledPos.buffer), 34962);
      const posAcc = accessors.length;
      accessors.push({ bufferView: posBv, componentType: 5126, count: vertCount, type: 'VEC3', min, max });

      const normArr =
        srcPrim.normals.length >= vertCount * 3
          ? new Float32Array(srcPrim.normals.subarray(0, vertCount * 3))
          : new Float32Array(vertCount * 3);
      if (rotateY180) {
        for (let i = 0; i < normArr.length; i += 3) {
          normArr[i] = negZeroClean(normArr[i]);
          normArr[i + 2] = negZeroClean(normArr[i + 2]);
        }
      }
      const normBv = pushBufferSlice(new Uint8Array(normArr.buffer), 34962);
      const normAcc = accessors.length;
      accessors.push({ bufferView: normBv, componentType: 5126, count: vertCount, type: 'VEC3' });

      const uvArr =
        srcPrim.uvs.length >= vertCount * 2
          ? new Float32Array(srcPrim.uvs.subarray(0, vertCount * 2))
          : new Float32Array(vertCount * 2);
      const uvBv = pushBufferSlice(new Uint8Array(uvArr.buffer), 34962);
      const uvAcc = accessors.length;
      accessors.push({ bufferView: uvBv, componentType: 5126, count: vertCount, type: 'VEC2' });

      const primAttributes: Record<string, number> = {
        POSITION: posAcc,
        NORMAL: normAcc,
        TEXCOORD_0: uvAcc,
      };

      if (srcPrim.uvs1 && srcPrim.uvs1.length >= vertCount * 2) {
        const uv1Arr = new Float32Array(srcPrim.uvs1.subarray(0, vertCount * 2));
        const uv1Bv = pushBufferSlice(new Uint8Array(uv1Arr.buffer), 34962);
        const uv1Acc = accessors.length;
        accessors.push({ bufferView: uv1Bv, componentType: 5126, count: vertCount, type: 'VEC2' });
        primAttributes.TEXCOORD_1 = uv1Acc;
      }

      if (srcPrim.colors && srcPrim.colors.length >= vertCount * 4) {
        const colArr = new Float32Array(srcPrim.colors.subarray(0, vertCount * 4));
        const colBv = pushBufferSlice(new Uint8Array(colArr.buffer), 34962);
        const colAcc = accessors.length;
        accessors.push({ bufferView: colBv, componentType: 5126, count: vertCount, type: 'VEC4' });
        primAttributes.COLOR_0 = colAcc;
      }

      const jSrc = primJoints[pIdx];
      if (useUint16Joints) {
        const jBv = pushBufferSlice(new Uint8Array(jSrc.buffer.slice(0)), 34962);
        const jAcc = accessors.length;
        accessors.push({ bufferView: jBv, componentType: 5123, count: vertCount, type: 'VEC4' });
        primAttributes.JOINTS_0 = jAcc;
      } else {
        const jBytes = new Uint8Array(vertCount * 4);
        for (let i = 0; i < vertCount * 4; i++) jBytes[i] = jSrc[i];
        const jBv = pushBufferSlice(jBytes, 34962);
        const jAcc = accessors.length;
        accessors.push({ bufferView: jBv, componentType: 5121, count: vertCount, type: 'VEC4' });
        primAttributes.JOINTS_0 = jAcc;
      }

      const wArr = primWeights[pIdx];
      const wBv = pushBufferSlice(new Uint8Array(wArr.buffer.slice(0)), 34962);
      const wAcc = accessors.length;
      accessors.push({ bufferView: wBv, componentType: 5126, count: vertCount, type: 'VEC4' });
      primAttributes.WEIGHTS_0 = wAcc;

      const j1Src = primJoints1[pIdx];
      const w1Src = primWeights1[pIdx];
      if (j1Src && w1Src) {
        if (useUint16Joints) {
          const j1Bv = pushBufferSlice(new Uint8Array(j1Src.buffer.slice(0)), 34962);
          const j1Acc = accessors.length;
          accessors.push({ bufferView: j1Bv, componentType: 5123, count: vertCount, type: 'VEC4' });
          primAttributes.JOINTS_1 = j1Acc;
        } else {
          const j1Bytes = new Uint8Array(vertCount * 4);
          for (let i = 0; i < vertCount * 4; i++) j1Bytes[i] = j1Src[i];
          const j1Bv = pushBufferSlice(j1Bytes, 34962);
          const j1Acc = accessors.length;
          accessors.push({ bufferView: j1Bv, componentType: 5121, count: vertCount, type: 'VEC4' });
          primAttributes.JOINTS_1 = j1Acc;
        }
        const w1Bv = pushBufferSlice(new Uint8Array(w1Src.buffer.slice(0)), 34962);
        const w1Acc = accessors.length;
        accessors.push({ bufferView: w1Bv, componentType: 5126, count: vertCount, type: 'VEC4' });
        primAttributes.WEIGHTS_1 = w1Acc;
      }

      const indexArr = new Uint32Array(srcPrim.indices);
      const indexBv = pushBufferSlice(new Uint8Array(indexArr.buffer), 34963);
      const indexAcc = accessors.length;
      accessors.push({ bufferView: indexBv, componentType: 5125, count: indexArr.length, type: 'SCALAR' });

      const primEntry: Record<string, unknown> = {
        attributes: primAttributes,
        indices: indexAcc,
        material: Math.min(srcPrim.materialIndex, materialsOut.length - 1),
      };

      const morphBuild = primMorphBuilds[pIdx];
      if (morphBuild.targets.length > 0) {
        const targetsArray: Array<Record<string, number>> = [];
        for (const m of morphBuild.targets) {
          const deltas = rotateY180 ? new Float32Array(m.deltas) : m.deltas;
          if (rotateY180) {
            for (let i = 0; i < deltas.length; i += 3) {
              deltas[i] = negZeroClean(deltas[i]);
              deltas[i + 2] = negZeroClean(deltas[i + 2]);
            }
          }
          const mMin = [Infinity, Infinity, Infinity];
          const mMax = [-Infinity, -Infinity, -Infinity];
          for (let i = 0; i < deltas.length; i += 3) {
            mMin[0] = Math.min(mMin[0], deltas[i]);
            mMin[1] = Math.min(mMin[1], deltas[i + 1]);
            mMin[2] = Math.min(mMin[2], deltas[i + 2]);
            mMax[0] = Math.max(mMax[0], deltas[i]);
            mMax[1] = Math.max(mMax[1], deltas[i + 1]);
            mMax[2] = Math.max(mMax[2], deltas[i + 2]);
          }
          const mBv = pushBufferSlice(new Uint8Array(deltas.buffer.slice(0)), 34962);
          const mAcc = accessors.length;
          accessors.push({
            bufferView: mBv,
            componentType: 5126,
            count: vertCount,
            type: 'VEC3',
            min: mMin,
            max: mMax,
          });
          const targetObj: Record<string, number> = { POSITION: mAcc };
          if (m.normalDeltas && m.normalDeltas.length >= vertCount * 3) {
            const nDeltas = rotateY180 ? new Float32Array(m.normalDeltas) : m.normalDeltas;
            if (rotateY180) {
              for (let i = 0; i < nDeltas.length; i += 3) {
                nDeltas[i] = negZeroClean(nDeltas[i]);
                nDeltas[i + 2] = negZeroClean(nDeltas[i + 2]);
              }
            }
            const nBv = pushBufferSlice(new Uint8Array(nDeltas.buffer.slice(0)), 34962);
            const nAcc = accessors.length;
            accessors.push({
              bufferView: nBv,
              componentType: 5126,
              count: vertCount,
              type: 'VEC3',
            });
            targetObj.NORMAL = nAcc;
          }
          targetsArray.push(targetObj);
        }
        primEntry.targets = targetsArray;
      }

      const meshObj: Record<string, unknown> = {
        name: srcPrim.name,
        primitives: [primEntry],
      };
      if (morphBuild.targets.length > 0) {
        meshObj.extras = { targetNames: morphBuild.targets.map((t) => t.name) };
      }
      gltfMeshes.push(meshObj);
    }

    const nodes: Array<Record<string, unknown>> = [];
    const boneChildrenMap = new Map<number, number[]>();
    jointNodes.forEach((b, i) => {
      if (b.parent >= 0) {
        const ch = boneChildrenMap.get(b.parent) ?? [];
        ch.push(i + 1);
        boneChildrenMap.set(b.parent, ch);
      }
    });

    const rootJointChildren: number[] = [];
    jointNodes.forEach((b, i) => {
      if (b.parent < 0) rootJointChildren.push(i + 1);
    });
    const meshNodeIndices = flatPrims.map((_, idx) => meshNodeFirstIndex + idx);
    nodes.push({
      name: `${spec.name.replace(/\s+/g, '_')}_Root`,
      children: [...rootJointChildren, ...meshNodeIndices],
    });

    for (let i = 0; i < jointNodes.length; i++) {
      const b = jointNodes[i];
      const tr: [number, number, number] = rotateY180
        ? [negZeroClean(b.translation[0]), b.translation[1], negZeroClean(b.translation[2])]
        : b.translation;
      const nodeObj: Record<string, unknown> = {
        name: b.name,
        translation: tr,
      };
      if (b.rotation) {
        nodeObj.rotation = rotateY180
          ? [negZeroClean(b.rotation[0]), b.rotation[1], negZeroClean(b.rotation[2]), b.rotation[3]]
          : b.rotation;
      }
      if (b.scale) nodeObj.scale = b.scale;
      const ch = boneChildrenMap.get(i);
      if (ch && ch.length > 0) nodeObj.children = ch;
      nodes.push(nodeObj);
    }

    for (let mIdx = 0; mIdx < flatPrims.length; mIdx++) {
      nodes.push({
        name: flatPrims[mIdx].name,
        mesh: mIdx,
        skin: 0,
      });
    }

    const jointNodeIndices = jointNodes.map((_, i) => i + 1);
    const binBytes = new Uint8Array(byteOffset);
    let writePtr = 0;
    for (const ch of chunks) {
      binBytes.set(ch, writePtr);
      writePtr += ch.length;
    }

    const baseGltf: Record<string, unknown> = {
      asset: {
        version: '2.0',
        generator: `VRM Forge Studio External GLB -> VRM ${targetVrmVersion} Rigging Pipeline`,
      },
      scene: 0,
      scenes: [{ name: 'Scene', nodes: [0] }],
      nodes,
      meshes: gltfMeshes,
      skins: [
        {
          name: primarySkin?.name || 'HumanoidArmature',
          inverseBindMatrices: ibmAccessorIdx,
          skeleton: skeletonRootLocalIdx + 1,
          joints: jointNodeIndices,
        },
      ],
      materials: materialsOut,
      ...(texturesOut.length > 0 ? { textures: texturesOut } : {}),
      ...(imagesOut.length > 0 ? { images: imagesOut } : {}),
      samplers: samplersOut,
      accessors,
      bufferViews,
      buffers: [{ byteLength: binBytes.length }],
    };

    return { baseGltf, binBytes, imagesOut };
  };

  const glbPack = packExternalScene(false);
  const glbBuffer = packGlbBinary(glbPack.baseGltf, glbPack.binBytes);
  const vrmPack = rotateVrmY180 ? packExternalScene(true) : glbPack;
  const imagesOut = vrmPack.imagesOut;

  const expressionPresetMap: Record<string, Record<string, unknown>> = {
    neutral: { isBinary: false, morphTargetBinds: [] },
  };
  for (const presetName of VRM_EXPRESSION_PRESETS) {
    if (presetName === 'neutral') continue;
    const binds = expressionPresetBinds[presetName];
    if (binds && binds.length > 0) {
      expressionPresetMap[presetName] = {
        isBinary:
          presetName === 'blink' || presetName === 'blinkLeft' || presetName === 'blinkRight',
        morphTargetBinds: binds,
      };
    }
  }

  const effectiveMeta = resolveEffectiveVrmMetadata(spec, externalAsset.sourceVrmMeta);

  const jointIdxByName = new Map<string, number>();
  jointNodes.forEach((b, i) => jointIdxByName.set(b.name, i + 1));
  const mappedNodeSet = new Set<number>(Object.values(humanBones).map((r) => r.node));

  const childrenByLocalJoint = new Map<number, number[]>();
  jointNodes.forEach((b, i) => {
    if (b.parent >= 0) {
      const ch = childrenByLocalJoint.get(b.parent) ?? [];
      ch.push(i);
      childrenByLocalJoint.set(b.parent, ch);
    }
  });
  const collectChainNodes = (rootGlftNodeIdx: number): number[] => {
    const out: number[] = [];
    const queue = [rootGlftNodeIdx - 1];
    const visited = new Set<number>();
    while (queue.length > 0) {
      const localIdx = queue.shift()!;
      if (visited.has(localIdx) || localIdx < 0 || localIdx >= jointNodes.length) continue;
      visited.add(localIdx);
      const gltfNode = localIdx + 1;
      if (!mappedNodeSet.has(gltfNode)) {
        out.push(gltfNode);
      }
      for (const ch of childrenByLocalJoint.get(localIdx) ?? []) {
        queue.push(ch);
      }
    }
    return out;
  };

  // Derive genuine secondary colliders & springs:
  // 1) Preserve imported VRM colliderGroups & boneGroups cleanly (excluding humanoid bones)
  // 2) Or generate sensible head/chest colliders + detect J_Sec_* / hair* / cloak* roots
  const vrm0ColliderGroups: Array<{
    node: number;
    colliders: Array<{ offset: { x: number; y: number; z: number }; radius: number }>;
  }> = [];
  const vrm1Colliders: Array<{
    node: number;
    shape: { sphere: { offset: [number, number, number]; radius: number } };
  }> = [];
  const vrm1ColliderGroups: Array<{ name: string; colliders: number[] }> = [];

  if (externalAsset.existingVrmColliderGroups && externalAsset.existingVrmColliderGroups.length > 0) {
    externalAsset.existingVrmColliderGroups.forEach((cg, idx) => {
      const targetNode = jointIdxByName.get(cg.nodeName);
      if (targetNode === undefined) {
        rigWarnings.push(`Skipped imported collider group on unresolved node "${cg.nodeName}".`);
        return;
      }
      const mappedCols = cg.colliders
        .filter((c) => Number.isFinite(c.radius) && c.radius >= 0)
        .map((c) => {
          const ox = rotateVrmY180 ? negZeroClean(c.offset[0]) : c.offset[0];
          const oy = c.offset[1];
          const oz = rotateVrmY180 ? negZeroClean(c.offset[2]) : c.offset[2];
          return {
            offset: { x: ox, y: oy, z: oz },
            radius: Math.max(0, c.radius),
          };
        });
      vrm0ColliderGroups.push({ node: targetNode, colliders: mappedCols });

      const v1Indices: number[] = [];
      for (const mc of mappedCols) {
        v1Indices.push(vrm1Colliders.length);
        vrm1Colliders.push({
          node: targetNode,
          shape: {
            sphere: {
              offset: [mc.offset.x, mc.offset.y, mc.offset.z],
              radius: mc.radius,
            },
          },
        });
      }
      vrm1ColliderGroups.push({
        name: `${cg.nodeName}_ColliderGroup_${idx}`,
        colliders: v1Indices,
      });
    });
  }

  if (vrm0ColliderGroups.length === 0) {
    const defaultDefs = [
      {
        node: humanBones.head?.node ?? 1,
        offset: [0, 0.06 * spec.proportions.headScale, 0] as [number, number, number],
        radius: 0.085,
        name: 'HeadCollider',
      },
      {
        node: humanBones.upperChest?.node ?? humanBones.chest?.node ?? 1,
        offset: [0, 0.03, 0] as [number, number, number],
        radius: 0.1,
        name: 'ChestCollider',
      },
    ];
    for (const d of defaultDefs) {
      vrm0ColliderGroups.push({
        node: d.node,
        colliders: [{ offset: { x: d.offset[0], y: d.offset[1], z: d.offset[2] }, radius: d.radius }],
      });
      const cIdx = vrm1Colliders.length;
      vrm1Colliders.push({
        node: d.node,
        shape: { sphere: { offset: d.offset, radius: d.radius } },
      });
      vrm1ColliderGroups.push({ name: d.name, colliders: [cIdx] });
    }
  }

  const vrm0BoneGroups: Array<{
    comment?: string;
    stiffiness: number;
    gravityPower: number;
    gravityDir: { x: number; y: number; z: number };
    dragForce: number;
    center: number;
    hitRadius: number;
    bones: number[];
    colliderGroups: number[];
  }> = [];
  const vrm1Springs: Array<{
    name: string;
    center?: number;
    colliderGroups?: number[];
    joints: Array<Record<string, unknown>>;
  }> = [];
  let springJointCount = 0;

  if (externalAsset.existingVrmSprings && externalAsset.existingVrmSprings.length > 0) {
    for (const sp of externalAsset.existingVrmSprings) {
      const rootNodes: number[] = [];
      for (const bn of sp.boneNames) {
        const nodeIdx = jointIdxByName.get(bn);
        if (nodeIdx === undefined) continue;
        if (mappedNodeSet.has(nodeIdx)) {
          rigWarnings.push(
            `Removed humanoid bone "${bn}" from secondary spring group "${sp.comment || 'Spring'}".`
          );
          continue;
        }
        if (!rootNodes.includes(nodeIdx)) rootNodes.push(nodeIdx);
      }
      if (rootNodes.length === 0) continue;
      springJointCount += rootNodes.length;
      const centerNode = sp.centerNodeName ? (jointIdxByName.get(sp.centerNodeName) ?? -1) : -1;
      const gDir = rotateVrmY180
        ? [negZeroClean(sp.gravityDir[0]), sp.gravityDir[1], negZeroClean(sp.gravityDir[2])]
        : sp.gravityDir;

      const resolvedCgIndices = (sp.colliderGroupIndices ?? [])
        .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < vrm0ColliderGroups.length);
      const effectiveCgIndices =
        resolvedCgIndices.length > 0
          ? resolvedCgIndices
          : sp.colliderGroupNodeNames && sp.colliderGroupNodeNames.length > 0
            ? sp.colliderGroupNodeNames
                .map((nName) => {
                  const nIdx = jointIdxByName.get(nName);
                  return nIdx !== undefined
                    ? vrm0ColliderGroups.findIndex((cg) => cg.node === nIdx)
                    : -1;
                })
                .filter((idx) => idx >= 0)
            : vrm0ColliderGroups.map((_, i) => i).slice(0, 2);

      vrm0BoneGroups.push({
        comment: sp.comment || 'PreservedSpring',
        stiffiness: Math.max(0, sp.stiffiness),
        gravityPower: sp.gravityPower,
        gravityDir: { x: gDir[0], y: gDir[1], z: gDir[2] },
        dragForce: Math.max(0, sp.dragForce),
        center: centerNode,
        hitRadius: Math.max(0, sp.hitRadius),
        bones: rootNodes,
        colliderGroups: effectiveCgIndices,
      });

      const chainNodes: number[] = [];
      if (sp.chainBoneNames && sp.chainBoneNames.length > 0) {
        for (const cbn of sp.chainBoneNames) {
          const nIdx = jointIdxByName.get(cbn);
          if (nIdx !== undefined && !mappedNodeSet.has(nIdx) && !chainNodes.includes(nIdx)) {
            chainNodes.push(nIdx);
          }
        }
      } else {
        for (const rn of rootNodes) {
          for (const cn of collectChainNodes(rn)) {
            if (!chainNodes.includes(cn)) chainNodes.push(cn);
          }
        }
      }
      const effectiveChain = chainNodes.length > 0 ? chainNodes : rootNodes;

      vrm1Springs.push({
        name: sp.comment || 'PreservedSpring',
        ...(centerNode >= 0 ? { center: centerNode } : {}),
        ...(effectiveCgIndices.length > 0 ? { colliderGroups: effectiveCgIndices } : {}),
        joints: effectiveChain.map((node) => ({
          node,
          hitRadius: Math.max(0, sp.hitRadius),
          stiffness: Math.max(0, sp.stiffiness),
          gravityPower: sp.gravityPower,
          gravityDir: gDir,
          dragForce: Math.max(0, sp.dragForce),
        })),
      });
    }
  } else {
    // Detect genuine secondary chains by bone naming (J_Sec_*, hair*, cloak*, skirt*, tail*)
    const secRoots = jointNodes
      .map((b, idx) => ({ bone: b, nodeIdx: idx + 1 }))
      .filter(({ bone, nodeIdx }) => {
        if (mappedNodeSet.has(nodeIdx)) return false;
        const isSecName = /^(?:j_sec_|hair|cloak|cape|skirt|ribbon|tail|ear)/i.test(bone.name);
        if (!isSecName) return false;
        const parentMapped = bone.parent >= 0 && mappedNodeSet.has(bone.parent + 1);
        const parentIsSecRoot = bone.parent < 0 || parentMapped;
        return parentIsSecRoot;
      });
    if (secRoots.length > 0) {
      const rootIndices = secRoots.map((s) => s.nodeIdx);
      springJointCount += rootIndices.length;
      const defaultCgIndices = vrm0ColliderGroups.map((_, i) => i).slice(0, 2);
      vrm0BoneGroups.push({
        comment: 'SecondaryHairCloakSpring',
        stiffiness: 0.6,
        gravityPower: 0.25,
        gravityDir: { x: 0, y: -1, z: 0 },
        dragForce: 0.4,
        center: -1,
        hitRadius: 0.025,
        bones: rootIndices,
        colliderGroups: defaultCgIndices,
      });
      vrm1Springs.push({
        name: 'ExternalSecondarySpring',
        colliderGroups: defaultCgIndices,
        joints: rootIndices.map((node) => ({
          node,
          hitRadius: 0.025,
          stiffness: 0.6,
          gravityPower: 0.25,
          gravityDir: [0, -1, 0],
          dragForce: 0.4,
        })),
      });
    }
  }

  if (rigWarnings.length > 0) {
    rigReport.warnings = rigWarnings;
  }

  const meshNodesMap = flatPrims.map((_, idx) => ({
    meshIndex: idx,
    nodeIndex: meshNodeFirstIndex + idx,
  }));

  const vrmGltf: Record<string, unknown> =
    targetVrmVersion === '0.0'
      ? {
          ...vrmPack.baseGltf,
          extensionsUsed: ['VRM'],
          extensions: {
            VRM: buildVrm0Extension({
              meta: effectiveMeta,
              humanBones,
              headScale: spec.proportions.headScale,
              meshNodes: meshNodesMap,
              expressionPresetBinds,
              colliderGroups: vrm0ColliderGroups,
              boneGroups: vrm0BoneGroups,
            }),
          },
        }
      : {
          ...vrmPack.baseGltf,
          extensionsUsed: ['VRMC_vrm', ...(vrm1Springs.length > 0 ? ['VRMC_springBone'] : [])],
          extensions: {
            VRMC_vrm: {
              specVersion: '1.0',
              meta: buildVrm1MetaBlock(effectiveMeta),
              humanoid: { humanBones },
              firstPerson: { meshAnnotations: [] },
              lookAt: {
                offsetFromHeadBone: [0, 0.08 * spec.proportions.headScale, 0],
                type: 'bone',
                rangeMapHorizontalInner: { inputMaxValue: 90, outputScale: 10 },
                rangeMapHorizontalOuter: { inputMaxValue: 90, outputScale: 10 },
                rangeMapVerticalDown: { inputMaxValue: 90, outputScale: 10 },
                rangeMapVerticalUp: { inputMaxValue: 90, outputScale: 10 },
              },
              expressions: { preset: expressionPresetMap },
            },
            ...(vrm1Springs.length > 0
              ? {
                  VRMC_springBone: {
                    specVersion: '1.0',
                    colliders: vrm1Colliders,
                    colliderGroups: vrm1ColliderGroups,
                    springs: vrm1Springs,
                  },
                }
              : {}),
          },
        };

  const vrmBuffer = packGlbBinary(vrmGltf, vrmPack.binBytes);
  const packageMs = Math.max(1, Math.round(performance.now() - tPkg0));

  const stats: BuiltStats = {
    vertexCount: totalVertices,
    triangleCount: totalTriangles,
    boneCount: jointNodes.length,
    materialCount: materialsOut.length,
    textureCount: texturesOut.length,
    expressionCount: Object.keys(expressionPresetBinds).length,
    springBoneJointCount: springJointCount,
  };

  const textureTargetPx = textureResolutionToTargetPx(spec.qualityConfig.textureResolution);
  const packedTexturePx = resolvePackedTextureSize(spec.qualityConfig);
  const estimatedTextureMemoryMb = Number(
    (
      imagesOut.reduce((acc, im) => acc + ((im.bufferView !== undefined ? 4 : 0)), 0) ||
      ((12 * textureTargetPx * textureTargetPx * 4) / (1024 * 1024))
    ).toFixed(1)
  );

  const mappedBonesList = Object.keys(humanBones);
  const missingVrmBones = VRM_REQUIRED_HUMANOID_BONES.filter((b) => !(b in humanBones));

  const externalAudit: ExternalRiggingAudit = {
    mode: preserveExistingRig ? 'preserved_existing_rig' : 'generated_humanoid_rig',
    weightsNormalized: maxWeightSumError <= 0.02,
    maxWeightSumError: Number(maxWeightSumError.toFixed(6)),
    weightedVertices: weightedVerticesTotal,
    totalVertices,
    mappedVrmBones: mappedBonesList,
    missingVrmBones,
    jointDeformations,
    allJointDeformationsPassed: jointDeformations.every((j) => j.passed),
    preservedMaterialCount: externalAsset.materials.length,
    preservedTextureCount: texturesOut.length,
    preservedImageCount: imagesOut.length,
    preservedMorphCount,
    synthesizedMorphCount,
    activeNonEmptyExpressions: Object.keys(expressionPresetBinds),
  };

  return {
    vrmBuffer,
    glbBuffer,
    sourceGlbBuffer: rawExternalGlbBuffer,
    vrmVersion: targetVrmVersion,
    stats,
    sourceStats: stats,
    estimates: {
      sourceTriangles: stats.triangleCount,
      sourceVertices: stats.vertexCount,
      optimizedTriangles: stats.triangleCount,
      optimizedVertices: stats.vertexCount,
      textureTargetPx,
      packedTexturePx,
      estimatedTextureMemoryMb,
      estimatedVrmSizeKb: Math.round(vrmBuffer.byteLength / 1024),
      estimatedSourceGlbSizeKb: Math.round(rawExternalGlbBuffer.byteLength / 1024),
    },
    timingsMs: {
      geometryMs: 0,
      retopologyMs: 0,
      materialsMs,
      riggingMs,
      facialMs,
      packageMs,
    },
    externalAudit,
    rigReport,
  };
}

