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
    vrmVersion: '1.0' | '0.x';
    includeFingerBones: boolean;
    includeFaceRig: boolean;
    includeSpringBones: boolean;
    targetPolygonBudget: number;
  };
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

export interface ValidationCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface VrmValidationReport {
  valid: boolean;
  vrmVersion: string;
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
  skinWeightsValid: boolean;
  checks: ValidationCheck[];
  validatedAt: string;
}

export interface PipelineStageResult {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'warning' | 'error';
  durationMs: number;
  detail: string;
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
  spec: CharacterSpecification;
  validation: VrmValidationReport;
  estimates: ExportEstimates;
  stages: PipelineStageResult[];
  revisions: ProjectRevision[];
  vrmUrl: string;
  glbUrl: string;
  sourceGlbUrl: string;
  blenderScriptUrl: string;
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
