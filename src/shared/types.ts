export type GenerationMode = 'hybrid' | 'local' | 'cloud';

export type BodyBuild = 'slender' | 'athletic' | 'average' | 'muscular' | 'heavy';

export type HairStyle = 'long_flowing' | 'bob' | 'short_crop' | 'ponytail' | 'braided' | 'spiky';

export type OutfitStyle =
  | 'ornate_armor_cloak'
  | 'fantasy_robe'
  | 'cyber_tactical'
  | 'casual_modern'
  | 'royal_regalia';

export type CharacterArtStyle = 'semi_realistic' | 'stylized_anime' | 'realistic_human';

export type GeometryQuality = 'performance' | 'standard' | 'high' | 'ultra';

export type TextureResolution = '1k' | '2k' | '4k' | '8k';

export type VrmOptimizationMode = 'unoptimized' | 'balanced' | 'optimized' | 'custom';

export interface CustomOptimizationSettings {
  geometryRetention: number; // 0.35 to 1.0
  maxVrmTexturePx: 256 | 512 | 1024 | 2048;
  preserveFacialDetail: boolean;
  preserveHairDetail: boolean;
  mergeStaticClothing: boolean;
  generateLod: boolean;
}

export interface QualityConfig {
  geometryQuality: GeometryQuality;
  textureResolution: TextureResolution;
  vrmOptimization: VrmOptimizationMode;
  customOptimization: CustomOptimizationSettings;
}

export interface ExportEstimates {
  sourceTriangles: number;
  sourceVertices: number;
  optimizedTriangles: number;
  optimizedVertices: number;
  textureTargetPx: number;
  packedTexturePx: number;
  estimatedTextureMemoryMb: number;
  estimatedVrmSizeKb: number;
  estimatedSourceGlbSizeKb: number;
}

export interface CharacterProportions {
  heightMeters: number;
  shoulderWidthScale: number;
  hipWidthScale: number;
  limbLengthScale: number;
  headScale: number;
}

export interface CharacterPalette {
  skinColor: string;
  hairColor: string;
  eyeColor: string;
  eyeEmissive: boolean;
  primaryOutfitColor: string;
  secondaryOutfitColor: string;
  accentMetallicColor: string;
  cloakColor: string;
}

export interface AnatomicalFeatures {
  earStyle: 'human' | 'pointed_elf' | 'long_elf';
  hasCloak: boolean;
  hasArmor: boolean;
  hasWings: boolean;
  hasTail: boolean;
  hasHorns: boolean;
}

export interface CharacterConstraints {
  requiredFeatures: string[];
  optionalFeatures: string[];
  forbiddenFeatures: string[];
  requiredPalette: Partial<Record<keyof CharacterPalette, string>>;
}

export type VrmExportVersion = '0.0' | '1.0';

export type VrmAllowedUser = 'OnlyAuthor' | 'ExplicitlyLicensedPerson' | 'Everyone';
export type VrmAllowance = 'Disallow' | 'Allow';

export type Vrm0LicenseName =
  | 'Redistribution_Prohibited'
  | 'CC0'
  | 'CC_BY'
  | 'CC_BY_NC'
  | 'CC_BY_SA'
  | 'CC_BY_NC_SA'
  | 'CC_BY_ND'
  | 'CC_BY_NC_ND'
  | 'Other';

export interface VrmSourceLicenseRestrictions {
  allowedUserName?: VrmAllowedUser;
  violentUsage?: VrmAllowance;
  sexualUsage?: VrmAllowance;
  commercialUsage?: VrmAllowance;
  allowRedistribution?: boolean;
  modification?: 'prohibited' | 'allowModification' | 'allowModificationRedistribution';
  licenseName?: string;
}

export interface VrmMetadataConfig {
  title: string;
  author: string;
  version: string;
  contactInformation: string;
  reference: string;
  licenseName: string;
  otherLicenseUrl: string;
  otherPermissionUrl?: string;
  allowedUserName: VrmAllowedUser;
  violentUsage: VrmAllowance;
  sexualUsage: VrmAllowance;
  commercialUsage: VrmAllowance;
  allowRedistribution: boolean;
  modification: 'prohibited' | 'allowModification' | 'allowModificationRedistribution';
  sourceAttribution?: string;
  sourceRestrictions?: VrmSourceLicenseRestrictions;
}

export interface RigReport {
  sourceState: 'unrigged' | 'valid_preserved' | 'repaired' | 'replaced';
  mappingSource: 'vrm0' | 'vrm1' | 'name_heuristic' | 'generated';
  mappedCount: number;
  missingBones: string[];
  secondaryBoneCount: number;
  detail: string;
  lossyConversion?: boolean;
  warnings?: string[];
}

export interface CharacterSpecification {
  id: string;
  name: string;
  version: number;
  sourcePrompt: string;
  species: string;
  genderPresentation: 'feminine' | 'masculine' | 'androgynous';
  ageAppearance: 'young_adult' | 'adult' | 'mature';
  build: BodyBuild;
  artStyle: CharacterArtStyle;
  aesthetic: string;
  hairStyle: HairStyle;
  outfitStyle: OutfitStyle;
  proportions: CharacterProportions;
  palette: CharacterPalette;
  features: AnatomicalFeatures;
  constraints?: CharacterConstraints;
  qualityConfig: QualityConfig;
  riggingRequirements: {
    vrmVersion: VrmExportVersion;
    includeFingerBones: boolean;
    includeFaceRig: boolean;
    includeSpringBones: boolean;
    targetPolygonBudget: number;
  };
  vrmMetadata?: VrmMetadataConfig;
  interpreterProvider: string;
  geometryProvider: string;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_CUSTOM_OPTIMIZATION: CustomOptimizationSettings = {
  geometryRetention: 0.78,
  maxVrmTexturePx: 512,
  preserveFacialDetail: true,
  preserveHairDetail: true,
  mergeStaticClothing: false,
  generateLod: true,
};

export const DEFAULT_QUALITY_CONFIG: QualityConfig = {
  geometryQuality: 'high',
  textureResolution: '2k',
  vrmOptimization: 'balanced',
  customOptimization: { ...DEFAULT_CUSTOM_OPTIMIZATION },
};

export const VRM_REQUIRED_HUMANOID_BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
] as const;

export const VRM_OPTIONAL_HUMANOID_BONES = [
  'upperChest',
  'leftShoulder',
  'rightShoulder',
  'leftToes',
  'rightToes',
  'leftEye',
  'rightEye',
  'jaw',
  'leftThumbMetacarpal',
  'leftThumbProximal',
  'leftThumbDistal',
  'leftIndexProximal',
  'leftIndexIntermediate',
  'leftIndexDistal',
  'leftMiddleProximal',
  'leftMiddleIntermediate',
  'leftMiddleDistal',
  'leftRingProximal',
  'leftRingIntermediate',
  'leftRingDistal',
  'leftLittleProximal',
  'leftLittleIntermediate',
  'leftLittleDistal',
  'rightThumbMetacarpal',
  'rightThumbProximal',
  'rightThumbDistal',
  'rightIndexProximal',
  'rightIndexIntermediate',
  'rightIndexDistal',
  'rightMiddleProximal',
  'rightMiddleIntermediate',
  'rightMiddleDistal',
  'rightRingProximal',
  'rightRingIntermediate',
  'rightRingDistal',
  'rightLittleProximal',
  'rightLittleIntermediate',
  'rightLittleDistal',
] as const;

export const VRM_EXPRESSION_PRESETS = [
  'neutral',
  'happy',
  'angry',
  'sad',
  'relaxed',
  'surprised',
  'blink',
  'blinkLeft',
  'blinkRight',
  'lookUp',
  'lookDown',
  'lookLeft',
  'lookRight',
  'aa',
  'ih',
  'ou',
  'ee',
  'oh',
] as const;

export type VrmExpressionName = (typeof VRM_EXPRESSION_PRESETS)[number];

export const VRM0_REQUIRED_HUMANOID_BONES = VRM_REQUIRED_HUMANOID_BONES;

export const VRM0_HUMANOID_BONES = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftEye',
  'rightEye',
  'jaw',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
  'leftThumbProximal',
  'leftThumbIntermediate',
  'leftThumbDistal',
  'leftIndexProximal',
  'leftIndexIntermediate',
  'leftIndexDistal',
  'leftMiddleProximal',
  'leftMiddleIntermediate',
  'leftMiddleDistal',
  'leftRingProximal',
  'leftRingIntermediate',
  'leftRingDistal',
  'leftLittleProximal',
  'leftLittleIntermediate',
  'leftLittleDistal',
  'rightThumbProximal',
  'rightThumbIntermediate',
  'rightThumbDistal',
  'rightIndexProximal',
  'rightIndexIntermediate',
  'rightIndexDistal',
  'rightMiddleProximal',
  'rightMiddleIntermediate',
  'rightMiddleDistal',
  'rightRingProximal',
  'rightRingIntermediate',
  'rightRingDistal',
  'rightLittleProximal',
  'rightLittleIntermediate',
  'rightLittleDistal',
] as const;

export const VRM0_BLEND_SHAPE_PRESETS = [
  'unknown',
  'neutral',
  'a',
  'i',
  'u',
  'e',
  'o',
  'blink',
  'joy',
  'angry',
  'sorrow',
  'fun',
  'lookup',
  'lookdown',
  'lookleft',
  'lookright',
  'blink_l',
  'blink_r',
] as const;

export const VRM0_ALLOWED_USERS = [
  'OnlyAuthor',
  'ExplicitlyLicensedPerson',
  'Everyone',
] as const;

export const VRM0_ALLOWANCES = ['Allow', 'Disallow'] as const;

export const VRM0_LICENSE_NAMES = [
  'Redistribution_Prohibited',
  'CC0',
  'CC_BY',
  'CC_BY_NC',
  'CC_BY_SA',
  'CC_BY_NC_SA',
  'CC_BY_ND',
  'CC_BY_NC_ND',
  'Other',
] as const;

export interface ValidationCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface VrmValidationReport {
  valid: boolean;
  vrmVersion: string;
  expectedVersion?: VrmExportVersion;
  fileSizeBytes: number;
  meshCount: number;
  primitiveCount: number;
  vertexCount: number;
  triangleCount: number;
  materialCount: number;
  textureCount: number;
  boneCount: number;
  mappedHumanoidBones: string[];
  missingRequiredBones: string[];
  expressionCount: number;
  nonEmptyExpressions: string[];
  springBoneJointCount: number;
  blendShapeGroupCount?: number;
  secondaryBoneGroupCount?: number;
  colliderGroupCount?: number;
  metaSummary?: {
    title?: string;
    author?: string;
    licenseName?: string;
    commercialUsage?: string;
  };
  skinWeightsValid: boolean;
  checks: ValidationCheck[];
  validatedAt: string;
}

export type PipelineStageStatus =
  | 'pending'
  | 'prepared'
  | 'running'
  | 'completed'
  | 'validated'
  | 'skipped'
  | 'fallback'
  | 'warning'
  | 'error';

export interface PipelineStageResult {
  id: string;
  label: string;
  status: PipelineStageStatus;
  durationMs: number;
  detail: string;
  artifact?: string;
  validationStatus?: 'pass' | 'warn' | 'fail';
}

export interface ProjectRevision {
  version: number;
  timestamp: string;
  summary: string;
  spec: CharacterSpecification;
}

export interface ProjectRecord {
  id: string;
  name: string;
  mode: GenerationMode;
  vrmVersion?: VrmExportVersion;
  productionPath?: 'blender_live' | 'typescript_fallback';
  spec: CharacterSpecification;
  validation: VrmValidationReport;
  estimates: ExportEstimates;
  rigReport?: RigReport;
  stages: PipelineStageResult[];
  revisions: ProjectRevision[];
  vrmUrl: string;
  glbUrl: string;
  sourceGlbUrl: string;
  blenderScriptUrl: string;
  blenderReportUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BlenderDetectionResult {
  installed: boolean;
  executablePath: string | null;
  version: string | null;
  vrmAddonDetected: boolean;
  platform: string;
  searchedPaths: string[];
  statusMessage: string;
}

export interface HardwareCapabilities {
  os: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalRamGb: number;
  freeRamGb: number;
  gpuSummary: string;
  recommendedMode: GenerationMode;
  recommendedLocalLlm: string;
  local3dFeasibility: 'recommended' | 'limited' | 'cloud_preferred';
  notes: string[];
}

export interface ProviderStatus {
  id: string;
  name: string;
  category: 'interpreter' | 'geometry' | 'local_runtime';
  modeSupport: GenerationMode[];
  configured: boolean;
  available: boolean;
  capabilityState: 'ready' | 'unverified_key' | 'verified_live' | 'failed' | 'unconfigured';
  verificationNote?: string;
  costModel: string;
  description: string;
}

export type ViewportViewMode = 'appearance' | 'wireframe' | 'skeleton' | 'weights';
export type ViewportCameraPreset = 'full' | 'portrait' | 'side' | 'back';
export type ViewportAnimationMode = 'idle' | 'walk' | 'wave' | 'rest';
export type ViewportLightingPreset = 'studio' | 'dramatic' | 'daylight';

export interface ImportedImageData {
  index: number;
  name?: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ImportedTextureData {
  index: number;
  name?: string;
  source?: number;
  sampler?: number;
}

export interface ImportedSamplerData {
  magFilter?: number;
  minFilter?: number;
  wrapS?: number;
  wrapT?: number;
}

export interface ImportedTextureInfo {
  index: number;
  texCoord?: number;
  scale?: number;
  strength?: number;
}

export interface ImportedMaterialData {
  index: number;
  name: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number];
    baseColorTexture?: ImportedTextureInfo;
    metallicFactor?: number;
    roughnessFactor?: number;
    metallicRoughnessTexture?: ImportedTextureInfo;
  };
  normalTexture?: ImportedTextureInfo;
  occlusionTexture?: ImportedTextureInfo;
  emissiveTexture?: ImportedTextureInfo;
  emissiveFactor?: [number, number, number];
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
  doubleSided?: boolean;
  extensions?: Record<string, unknown>;
}

export interface ImportedMorphTargetData {
  name: string;
  positions: Float32Array;
  normals?: Float32Array;
}

export interface ImportedPrimitiveData {
  meshIndex: number;
  meshName: string;
  primitiveIndex: number;
  name: string;
  materialIndex: number;
  hasNormals: boolean;
  hasUvs: boolean;
  hasUvs1: boolean;
  hasColors: boolean;
  hasSkinning: boolean;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  uvs1?: Float32Array;
  colors?: Float32Array;
  joints?: Uint16Array;
  weights?: Float32Array;
  joints1?: Uint16Array;
  weights1?: Float32Array;
  indices: Uint32Array;
  morphTargets: ImportedMorphTargetData[];
}

export interface ImportedSkinJointData {
  jointNodeIndex: number;
  name: string;
  parentJointIndex: number;
  localTranslation: [number, number, number];
  localRotation: [number, number, number, number];
  localScale: [number, number, number];
  worldPos: [number, number, number];
  worldMatrix: number[];
}

export interface ImportedSkinData {
  index: number;
  name: string;
  skeletonRootNodeIndex?: number;
  joints: ImportedSkinJointData[];
  inverseBindMatrices?: Float32Array;
}

export interface ImportedMeshGroup {
  meshIndex: number;
  name: string;
  nodeIndex: number;
  skinIndex?: number;
  worldMatrix: number[];
  targetNames: string[];
  primitives: ImportedPrimitiveData[];
}

export interface ImportedColliderDef {
  offset: [number, number, number];
  radius: number;
}

export interface ImportedColliderGroup {
  nodeName: string;
  colliders: ImportedColliderDef[];
}

export interface ImportedSpringGroup {
  comment?: string;
  stiffiness: number;
  gravityPower: number;
  gravityDir: [number, number, number];
  dragForce: number;
  hitRadius: number;
  centerNodeName?: string;
  boneNames: string[];
  chainBoneNames?: string[];
  colliderGroupIndices?: number[];
  colliderGroupNodeNames?: string[];
}

export interface ParsedGlbAsset {
  valid: boolean;
  error?: string;
  meshCount: number;
  primitiveCount: number;
  materialCount: number;
  textureCount: number;
  imageCount: number;
  vertexCount: number;
  triangleCount: number;
  hasExistingSkin: boolean;
  hasMorphTargets: boolean;
  hasVertexColors: boolean;
  hasNodeTransforms: boolean;
  hasMultiInfluenceSkin?: boolean;
  unsupportedFeatures?: string[];
  multiSkinAudit?: {
    skinCount: number;
    allSkinsCompatible: boolean;
    incompatibleSkins: number[];
    warnings: string[];
  };
  sourceVrmVersion?: VrmExportVersion;
  sourceVrmMeta?: Partial<VrmMetadataConfig>;
  existingVrmHumanoid?: Record<string, string>;
  existingVrmSprings?: ImportedSpringGroup[];
  existingVrmColliderGroups?: ImportedColliderGroup[];
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  meshes: ImportedMeshGroup[];
  materials: ImportedMaterialData[];
  textures: ImportedTextureData[];
  samplers: ImportedSamplerData[];
  images: ImportedImageData[];
  skins: ImportedSkinData[];
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}


