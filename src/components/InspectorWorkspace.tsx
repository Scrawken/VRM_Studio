import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  RotateCcw,
  Download,
} from 'lucide-react';
import {
  BodyBuild,
  CharacterArtStyle,
  CustomOptimizationSettings,
  DEFAULT_CUSTOM_OPTIMIZATION,
  DEFAULT_QUALITY_CONFIG,
  GeometryQuality,
  HairStyle,
  ProjectRecord,
  TextureResolution,
  VRM_EXPRESSION_PRESETS,
  VRM_REQUIRED_HUMANOID_BONES,
  ViewportAnimationMode,
  ViewportViewMode,
  VrmAllowance,
  VrmAllowedUser,
  VrmExportVersion,
  VrmOptimizationMode,
} from '../shared/types';

interface InspectorWorkspaceProps {
  project: ProjectRecord | null;
  expressionWeights: Record<string, number>;
  onChangeExpression: (name: string, value: number) => void;
  onResetExpressions: () => void;
  onChangeViewMode: (mode: ViewportViewMode) => void;
  onChangeAnimationMode: (mode: ViewportAnimationMode) => void;
  boneHighlight: string | null;
  onSelectBone: (bone: string | null) => void;
  onCustomizeRebuild: (patch: Record<string, unknown>) => Promise<void>;
  isRebuilding: boolean;
  viewportNode: React.ReactNode;
}

type InspectorSubTab = 'expressions' | 'skeleton' | 'customize' | 'validation';

export const InspectorWorkspace: React.FC<InspectorWorkspaceProps> = ({
  project,
  expressionWeights,
  onChangeExpression,
  onResetExpressions,
  onChangeViewMode,
  onChangeAnimationMode,
  boneHighlight,
  onSelectBone,
  onCustomizeRebuild,
  isRebuilding,
  viewportNode,
}) => {
  const [subTab, setSubTab] = useState<InspectorSubTab>('expressions');

  const [draftName, setDraftName] = useState(project?.spec.name || '');
  const [draftBuild, setDraftBuild] = useState<BodyBuild>(project?.spec.build || 'athletic');
  const [draftHairStyle, setDraftHairStyle] = useState<HairStyle>(
    project?.spec.hairStyle || 'long_flowing'
  );
  const [draftHeight, setDraftHeight] = useState(project?.spec.proportions.heightMeters || 1.75);
  const [draftSkin, setDraftSkin] = useState(project?.spec.palette.skinColor || '#cbb8e6');
  const [draftHair, setDraftHair] = useState(project?.spec.palette.hairColor || '#dfe5f2');
  const [draftEye, setDraftEye] = useState(project?.spec.palette.eyeColor || '#a855f7');
  const [draftEyeGlow, setDraftEyeGlow] = useState(project?.spec.palette.eyeEmissive ?? true);
  const [draftArmor, setDraftArmor] = useState(
    project?.spec.palette.primaryOutfitColor || '#1c1b24'
  );
  const [draftCloak, setDraftCloak] = useState(project?.spec.palette.cloakColor || '#2e1b4b');
  const [draftHasCloak, setDraftHasCloak] = useState(project?.spec.features.hasCloak ?? true);
  const [draftHasArmor, setDraftHasArmor] = useState(project?.spec.features.hasArmor ?? true);
  const [draftHasWings, setDraftHasWings] = useState(project?.spec.features.hasWings ?? false);
  const [draftHasHorns, setDraftHasHorns] = useState(project?.spec.features.hasHorns ?? false);
  const [draftEarStyle, setDraftEarStyle] = useState(
    project?.spec.features.earStyle || 'long_elf'
  );
  const [draftArtStyle, setDraftArtStyle] = useState<CharacterArtStyle>(
    project?.spec.artStyle || 'semi_realistic'
  );
  const [draftVrmVersion, setDraftVrmVersion] = useState<VrmExportVersion>(
    project?.spec.riggingRequirements?.vrmVersion || '0.0'
  );
  const [draftAuthor, setDraftAuthor] = useState(project?.spec.vrmMetadata?.author || '');
  const [draftCommercial, setDraftCommercial] = useState<VrmAllowance>(
    project?.spec.vrmMetadata?.commercialUsage || 'Disallow'
  );
  const [draftAllowedUser, setDraftAllowedUser] = useState<VrmAllowedUser>(
    project?.spec.vrmMetadata?.allowedUserName || 'OnlyAuthor'
  );
  const [draftLicenseName, setDraftLicenseName] = useState(
    project?.spec.vrmMetadata?.licenseName || 'Other'
  );
  const [draftGeometryQuality, setDraftGeometryQuality] = useState<GeometryQuality>(
    project?.spec.qualityConfig?.geometryQuality ?? DEFAULT_QUALITY_CONFIG.geometryQuality
  );
  const [draftTextureResolution, setDraftTextureResolution] = useState<TextureResolution>(
    project?.spec.qualityConfig?.textureResolution ?? DEFAULT_QUALITY_CONFIG.textureResolution
  );
  const [draftVrmOptimization, setDraftVrmOptimization] = useState<VrmOptimizationMode>(
    project?.spec.qualityConfig?.vrmOptimization ?? DEFAULT_QUALITY_CONFIG.vrmOptimization
  );
  const [draftCustomOpt, setDraftCustomOpt] = useState<CustomOptimizationSettings>(
    project?.spec.qualityConfig?.customOptimization ?? { ...DEFAULT_CUSTOM_OPTIMIZATION }
  );

  React.useEffect(() => {
    if (!project) return;
    setDraftName(project.spec.name);
    setDraftBuild(project.spec.build);
    setDraftHairStyle(project.spec.hairStyle);
    setDraftHeight(project.spec.proportions.heightMeters);
    setDraftSkin(project.spec.palette.skinColor);
    setDraftHair(project.spec.palette.hairColor);
    setDraftEye(project.spec.palette.eyeColor);
    setDraftEyeGlow(project.spec.palette.eyeEmissive);
    setDraftArmor(project.spec.palette.primaryOutfitColor);
    setDraftCloak(project.spec.palette.cloakColor);
    setDraftHasCloak(project.spec.features.hasCloak);
    setDraftHasArmor(project.spec.features.hasArmor);
    setDraftHasWings(project.spec.features.hasWings);
    setDraftHasHorns(project.spec.features.hasHorns);
    setDraftEarStyle(project.spec.features.earStyle);
    setDraftArtStyle(project.spec.artStyle || 'semi_realistic');
    setDraftVrmVersion(project.spec.riggingRequirements?.vrmVersion || '0.0');
    setDraftAuthor(project.spec.vrmMetadata?.author || '');
    setDraftCommercial(project.spec.vrmMetadata?.commercialUsage || 'Disallow');
    setDraftAllowedUser(project.spec.vrmMetadata?.allowedUserName || 'OnlyAuthor');
    setDraftLicenseName(project.spec.vrmMetadata?.licenseName || 'Other');
    setDraftGeometryQuality(project.spec.qualityConfig?.geometryQuality ?? DEFAULT_QUALITY_CONFIG.geometryQuality);
    setDraftTextureResolution(project.spec.qualityConfig?.textureResolution ?? DEFAULT_QUALITY_CONFIG.textureResolution);
    setDraftVrmOptimization(project.spec.qualityConfig?.vrmOptimization ?? DEFAULT_QUALITY_CONFIG.vrmOptimization);
    setDraftCustomOpt(project.spec.qualityConfig?.customOptimization ?? { ...DEFAULT_CUSTOM_OPTIMIZATION });
  }, [project?.id, project?.spec.version]);

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-sm text-slate-400">
        Generate or import a character in Studio to inspect its VRM rig, blendshapes, and materials.
      </div>
    );
  }

  const vrmVer = project.vrmVersion || project.validation.vrmVersion || '0.0';

  const handleApplyCustomization = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCustomizeRebuild({
      name: draftName,
      build: draftBuild,
      artStyle: draftArtStyle,
      hairStyle: draftHairStyle,
      vrmVersion: draftVrmVersion,
      vrmMetadata: {
        title: draftName,
        author: draftAuthor,
        commercialUsage: draftCommercial,
        allowedUserName: draftAllowedUser,
        licenseName: draftLicenseName,
      },
      proportions: { heightMeters: draftHeight },
      palette: {
        skinColor: draftSkin,
        hairColor: draftHair,
        eyeColor: draftEye,
        eyeEmissive: draftEyeGlow,
        primaryOutfitColor: draftArmor,
        cloakColor: draftCloak,
      },
      features: {
        earStyle: draftEarStyle,
        hasCloak: draftHasCloak,
        hasArmor: draftHasArmor,
        hasWings: draftHasWings,
        hasHorns: draftHasHorns,
      },
      qualityConfig: {
        geometryQuality: draftGeometryQuality,
        textureResolution: draftTextureResolution,
        vrmOptimization: draftVrmOptimization,
        customOptimization: draftCustomOpt,
      },
    });
  };

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_410px]">
      <main className="min-h-[480px] h-full relative">{viewportNode}</main>

      <aside className="border-t lg:border-t-0 lg:border-l border-[#262d38] bg-[#12161f] flex flex-col min-h-0">
        {/* Inspector Sub-Tabs */}
        <div className="p-2 border-b border-[#262d38] grid grid-cols-4 gap-1 bg-[#0b0e13]">
          {(
            [
              { id: 'expressions', label: 'Face' },
              { id: 'skeleton', label: 'Skeleton' },
              { id: 'customize', label: 'Customize' },
              { id: 'validation', label: 'Audit' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setSubTab(t.id);
                if (t.id === 'skeleton') {
                  onChangeViewMode('skeleton');
                } else if (t.id === 'expressions') {
                  onChangeViewMode('appearance');
                }
              }}
              className={`py-1.5 px-2 rounded text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                subTab === t.id
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {subTab === 'expressions' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    Facial Morph Targets
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Real-time VRM {vrmVer} blendshape vertex deformation.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onResetExpressions}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#262d38] text-xs text-slate-300 hover:text-white cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" aria-hidden="true" />
                  Reset
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(['happy', 'angry', 'sad', 'surprised', 'blink', 'aa', 'oh'] as const).map(
                  (preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        onResetExpressions();
                        onChangeExpression(preset, 1.0);
                      }}
                      className="px-2.5 py-1 rounded border border-[#262d38] bg-[#161b22] hover:border-sky-500 text-xs text-slate-200 capitalize cursor-pointer"
                    >
                      {preset}
                    </button>
                  )
                )}
              </div>

              <div className="flex flex-col gap-3 border-t border-[#262d38] pt-4">
                {VRM_EXPRESSION_PRESETS.filter((n) => n !== 'neutral').map((name) => {
                  const val = expressionWeights[name] ?? 0;
                  return (
                    <div key={name} className="flex items-center gap-3">
                      <label
                        htmlFor={`expr-${name}`}
                        className="w-24 text-xs text-slate-300 capitalize shrink-0"
                      >
                        {name}
                      </label>
                      <input
                        id={`expr-${name}`}
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={val}
                        onChange={(e) => onChangeExpression(name, Number(e.target.value))}
                        className="flex-1 accent-sky-500 cursor-pointer"
                      />
                      <span className="w-10 text-right font-mono text-xs text-slate-400 tabular-nums">
                        {val.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {subTab === 'skeleton' && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  Humanoid Armature & Weights
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {project.validation.boneCount} total joints · {project.validation.springBoneJointCount} spring bone joints
                </p>
                {project.rigReport && (
                  <p className="text-[11px] text-sky-300 mt-1">
                    {project.rigReport.detail}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onChangeViewMode('skeleton')}
                  className="py-1.5 px-3 rounded border border-[#262d38] bg-[#161b22] hover:border-sky-500 text-xs text-slate-200 cursor-pointer"
                >
                  Show Rig Overlay
                </button>
                <button
                  type="button"
                  onClick={() => onChangeViewMode('weights')}
                  className="py-1.5 px-3 rounded border border-[#262d38] bg-[#161b22] hover:border-sky-500 text-xs text-slate-200 cursor-pointer"
                >
                  Show Weight Heatmap
                </button>
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-300 mb-1.5">
                  Deformation Pose Test
                </span>
                <div className="grid grid-cols-4 gap-1 p-1 rounded bg-[#0b0e13] border border-[#262d38]">
                  {(['rest', 'idle', 'walk', 'wave'] as ViewportAnimationMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => onChangeAnimationMode(m)}
                      className="py-1 text-xs capitalize text-slate-300 hover:text-white rounded hover:bg-[#1e2530] cursor-pointer"
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-[#262d38] pt-3">
                <h3 className="text-xs font-semibold text-slate-300 mb-2">
                  Required VRM {vrmVer} Humanoid Bones ({VRM_REQUIRED_HUMANOID_BONES.length})
                </h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {VRM_REQUIRED_HUMANOID_BONES.map((bone) => {
                    const mapped = project.validation.mappedHumanoidBones.includes(bone);
                    const active = boneHighlight === bone;
                    return (
                      <button
                        key={bone}
                        type="button"
                        onClick={() => {
                          onChangeAnimationMode('rest');
                          onSelectBone(active ? null : bone);
                        }}
                        className={`px-2.5 py-1.5 rounded border text-left text-xs font-mono flex items-center justify-between cursor-pointer ${
                          active
                            ? 'border-sky-500 bg-sky-950/40 text-sky-200'
                            : 'border-[#262d38] bg-[#0b0e13] text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <span className="truncate">{bone}</span>
                        <span className={mapped ? 'text-emerald-400' : 'text-red-400'}>
                          {mapped ? 'OK' : 'MISS'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {subTab === 'customize' && (
            <form onSubmit={handleApplyCustomization} className="flex flex-col gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  Non-Destructive Customization
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Switch export format, update metadata rights, or adjust character build (v{project.spec.version}).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cust-name" className="block text-xs text-slate-300 mb-1">
                    Character Name
                  </label>
                  <input
                    id="cust-name"
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    className="w-full rounded border border-[#262d38] bg-[#0b0e13] px-2.5 py-1.5 text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="cust-vrm-ver" className="block text-xs text-slate-300 mb-1">
                    Export VRM Format
                  </label>
                  <select
                    id="cust-vrm-ver"
                    value={draftVrmVersion}
                    onChange={(e) => setDraftVrmVersion(e.target.value as VrmExportVersion)}
                    className="w-full rounded border border-[#262d38] bg-[#0b0e13] px-2 py-1.5 text-xs text-slate-100"
                  >
                    <option value="0.0">VRM 0.0 (UE5 VRM4U Primary)</option>
                    <option value="1.0">VRM 1.0 (Optional)</option>
                  </select>
                </div>
              </div>

              {/* VRM Metadata Rights */}
              <div className="rounded border border-[#262d38] bg-[#0b0e13] p-3 grid grid-cols-2 gap-2.5 text-xs">
                <div>
                  <label htmlFor="cust-author" className="block text-[11px] text-slate-400 mb-1">
                    Author
                  </label>
                  <input
                    id="cust-author"
                    type="text"
                    value={draftAuthor}
                    onChange={(e) => setDraftAuthor(e.target.value)}
                    placeholder="Unspecified Author"
                    className="w-full rounded border border-[#262d38] bg-[#12161f] px-2 py-1 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <label htmlFor="cust-license" className="block text-[11px] text-slate-400 mb-1">
                    License
                  </label>
                  <input
                    id="cust-license"
                    type="text"
                    value={draftLicenseName}
                    onChange={(e) => setDraftLicenseName(e.target.value)}
                    className="w-full rounded border border-[#262d38] bg-[#12161f] px-2 py-1 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <label htmlFor="cust-commercial" className="block text-[11px] text-slate-400 mb-1">
                    Commercial Usage
                  </label>
                  <select
                    id="cust-commercial"
                    value={draftCommercial}
                    onChange={(e) => setDraftCommercial(e.target.value as VrmAllowance)}
                    className="w-full rounded border border-[#262d38] bg-[#12161f] px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="Disallow">Disallow</option>
                    <option value="Allow">Allow</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cust-allowed-user" className="block text-[11px] text-slate-400 mb-1">
                    Allowed User
                  </label>
                  <select
                    id="cust-allowed-user"
                    value={draftAllowedUser}
                    onChange={(e) => setDraftAllowedUser(e.target.value as VrmAllowedUser)}
                    className="w-full rounded border border-[#262d38] bg-[#12161f] px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="OnlyAuthor">OnlyAuthor</option>
                    <option value="ExplicitlyLicensedPerson">ExplicitlyLicensedPerson</option>
                    <option value="Everyone">Everyone</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cust-build" className="block text-xs text-slate-300 mb-1">
                    Physique
                  </label>
                  <select
                    id="cust-build"
                    value={draftBuild}
                    onChange={(e) => setDraftBuild(e.target.value as BodyBuild)}
                    className="w-full rounded border border-[#262d38] bg-[#0b0e13] px-2 py-1.5 text-xs text-slate-100"
                  >
                    <option value="slender">Slender</option>
                    <option value="athletic">Athletic</option>
                    <option value="average">Average</option>
                    <option value="muscular">Muscular</option>
                    <option value="heavy">Heavy</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="cust-hairstyle" className="block text-xs text-slate-300 mb-1">
                    Hair Style
                  </label>
                  <select
                    id="cust-hairstyle"
                    value={draftHairStyle}
                    onChange={(e) => setDraftHairStyle(e.target.value as HairStyle)}
                    className="w-full rounded border border-[#262d38] bg-[#0b0e13] px-2 py-1.5 text-xs text-slate-100"
                  >
                    <option value="long_flowing">Long Flowing</option>
                    <option value="ponytail">Ponytail</option>
                    <option value="braided">Braided</option>
                    <option value="bob">Bob Cut</option>
                    <option value="short_crop">Short Crop</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <label htmlFor="cust-height" className="text-slate-300">
                    Height
                  </label>
                  <span className="font-mono text-slate-400 tabular-nums">
                    {draftHeight.toFixed(2)} m
                  </span>
                </div>
                <input
                  id="cust-height"
                  type="range"
                  min={1.45}
                  max={2.1}
                  step={0.01}
                  value={draftHeight}
                  onChange={(e) => setDraftHeight(Number(e.target.value))}
                  className="w-full accent-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: 'skin', label: 'Skin Tone', val: draftSkin, set: setDraftSkin },
                  { id: 'hair', label: 'Hair Color', val: draftHair, set: setDraftHair },
                  { id: 'eye', label: 'Eye Color', val: draftEye, set: setDraftEye },
                  { id: 'armor', label: 'Primary Outfit', val: draftArmor, set: setDraftArmor },
                  { id: 'cloak', label: 'Cloak / Mantle', val: draftCloak, set: setDraftCloak },
                ].map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded border border-[#262d38] bg-[#0b0e13] px-2.5 py-1.5 text-xs text-slate-300"
                  >
                    <span>{c.label}</span>
                    <input
                      type="color"
                      value={c.val}
                      onChange={(e) => c.set(e.target.value)}
                      className="w-6 h-5 bg-transparent border-0 cursor-pointer"
                    />
                  </label>
                ))}
                <div>
                  <label htmlFor="cust-ears" className="sr-only">
                    Ear Style
                  </label>
                  <select
                    id="cust-ears"
                    value={draftEarStyle}
                    onChange={(e) =>
                      setDraftEarStyle(e.target.value as 'human' | 'pointed_elf' | 'long_elf')
                    }
                    className="w-full h-full rounded border border-[#262d38] bg-[#0b0e13] px-2 py-1.5 text-xs text-slate-200"
                  >
                    <option value="human">Human Ears</option>
                    <option value="pointed_elf">Pointed Elf Ears</option>
                    <option value="long_elf">Long Elven Ears</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                {[
                  { label: 'Glowing Eyes', checked: draftEyeGlow, set: setDraftEyeGlow },
                  { label: 'Armor Plates', checked: draftHasArmor, set: setDraftHasArmor },
                  { label: 'Fantasy Cloak', checked: draftHasCloak, set: setDraftHasCloak },
                  { label: 'Wings', checked: draftHasWings, set: setDraftHasWings },
                  { label: 'Horns', checked: draftHasHorns, set: setDraftHasHorns },
                ].map((opt) => (
                  <label key={opt.label} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={opt.checked}
                      onChange={(e) => opt.set(e.target.checked)}
                      className="accent-sky-500"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cust-artstyle" className="block text-xs text-slate-300 mb-1">
                    Art Style
                  </label>
                  <select
                    id="cust-artstyle"
                    value={draftArtStyle}
                    onChange={(e) => setDraftArtStyle(e.target.value as CharacterArtStyle)}
                    className="w-full rounded border border-[#262d38] bg-[#0b0e13] px-2 py-1.5 text-xs text-slate-100"
                  >
                    <option value="semi_realistic">Semi-Realistic Fantasy</option>
                    <option value="stylized_anime">Stylized Anime</option>
                    <option value="realistic_human">Realistic Human</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="cust-geom-quality" className="block text-xs text-slate-300 mb-1">
                    Geometry Detail
                  </label>
                  <select
                    id="cust-geom-quality"
                    value={draftGeometryQuality}
                    onChange={(e) => setDraftGeometryQuality(e.target.value as GeometryQuality)}
                    className="w-full rounded border border-[#262d38] bg-[#0b0e13] px-2 py-1.5 text-xs text-slate-100"
                  >
                    <option value="performance">Performance</option>
                    <option value="standard">Standard</option>
                    <option value="high">High</option>
                    <option value="ultra">Ultra</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cust-tex-res" className="block text-xs text-slate-300 mb-1">
                    Texture Resolution
                  </label>
                  <select
                    id="cust-tex-res"
                    value={draftTextureResolution}
                    onChange={(e) => setDraftTextureResolution(e.target.value as TextureResolution)}
                    className="w-full rounded border border-[#262d38] bg-[#0b0e13] px-2 py-1.5 text-xs text-slate-100"
                  >
                    <option value="1k">1K (1024px)</option>
                    <option value="2k">2K (2048px)</option>
                    <option value="4k">4K (4096px)</option>
                    <option value="8k">8K (8192px)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="cust-vrm-opt" className="block text-xs text-slate-300 mb-1">
                    VRM Optimization
                  </label>
                  <select
                    id="cust-vrm-opt"
                    value={draftVrmOptimization}
                    onChange={(e) => setDraftVrmOptimization(e.target.value as VrmOptimizationMode)}
                    className="w-full rounded border border-[#262d38] bg-[#0b0e13] px-2 py-1.5 text-xs text-slate-100"
                  >
                    <option value="unoptimized">Unoptimized (Max Detail)</option>
                    <option value="balanced">Balanced</option>
                    <option value="optimized">Optimized</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={isRebuilding}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 text-xs font-semibold text-white cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isRebuilding ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {isRebuilding ? `Rebuilding VRM ${draftVrmVersion}...` : `Apply & Rebuild VRM ${draftVrmVersion}`}
              </button>
            </form>
          )}

          {subTab === 'validation' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    Independent VRM {vrmVer} Audit
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {project.productionPath === 'blender_live'
                      ? 'Built via Blender VRM Add-on'
                      : 'Built via TypeScript Synthesis Fallback'}
                  </p>
                </div>
                <span
                  className={`text-xs font-semibold ${
                    project.validation.valid ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {project.validation.valid ? 'PASSED' : 'FAILED'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 border-y border-[#262d38] py-3 text-xs">
                <div>
                  <span className="text-slate-500">VRM Size / Source GLB</span>
                  <div className="font-mono text-slate-200 tabular-nums mt-0.5">
                    {(project.validation.fileSizeBytes / 1024).toFixed(1)} KB /{' '}
                    {project.estimates?.estimatedSourceGlbSizeKb ?? '—'} KB
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Source → VRM Tris</span>
                  <div className="font-mono text-slate-200 tabular-nums mt-0.5">
                    {(project.estimates?.sourceTriangles ?? project.validation.triangleCount).toLocaleString()} →{' '}
                    {project.validation.triangleCount.toLocaleString()}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Materials / Textures</span>
                  <div className="font-mono text-slate-200 tabular-nums mt-0.5">
                    {project.validation.materialCount} mats / {project.validation.textureCount} textures
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">BlendShapes / Springs</span>
                  <div className="font-mono text-slate-200 tabular-nums mt-0.5">
                    {project.validation.blendShapeGroupCount ?? project.validation.expressionCount} groups ·{' '}
                    {project.validation.secondaryBoneGroupCount ?? 0} springs
                  </div>
                </div>
                {project.validation.metaSummary && (
                  <div className="col-span-2 pt-1 border-t border-[#1e2530] flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                    <span>Author: <strong className="text-slate-200">{project.validation.metaSummary.author}</strong></span>
                    <span>Commercial: <strong className="text-slate-200">{project.validation.metaSummary.commercialUsage}</strong></span>
                    <span>License: <strong className="text-slate-200">{project.validation.metaSummary.licenseName}</strong></span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <a
                  href={`${project.vrmUrl}&download=1`}
                  className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-[11px] font-semibold text-white"
                >
                  <Download className="w-3 h-3" aria-hidden="true" />
                  VRM {vrmVer}
                </a>
                <a
                  href={`${project.sourceGlbUrl}&download=1`}
                  className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded border border-[#262d38] bg-[#0b0e13] hover:border-emerald-500 text-[11px] font-medium text-slate-200"
                >
                  <Download className="w-3 h-3 text-emerald-400" aria-hidden="true" />
                  Source GLB
                </a>
                <a
                  href={`${project.blenderScriptUrl}&download=1`}
                  className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded border border-[#262d38] bg-[#0b0e13] hover:border-slate-500 text-[11px] font-medium text-slate-200"
                >
                  <Download className="w-3 h-3 text-amber-400" aria-hidden="true" />
                  Blender .py
                </a>
              </div>

              <ul className="flex flex-col gap-2.5">
                {project.validation.checks.map((chk) => (
                  <li
                    key={chk.id}
                    className="rounded-md border border-[#262d38] bg-[#0b0e13] p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-200">{chk.label}</span>
                      <span
                        className={`inline-flex items-center gap-1 font-mono uppercase text-[11px] ${
                          chk.status === 'pass'
                            ? 'text-emerald-400'
                            : chk.status === 'warn'
                              ? 'text-amber-400'
                              : 'text-red-400'
                        }`}
                      >
                        {chk.status === 'pass' && <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />}
                        {chk.status === 'warn' && <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />}
                        {chk.status === 'fail' && <XCircle className="w-3.5 h-3.5" aria-hidden="true" />}
                        {chk.status}
                      </span>
                    </div>
                    <p className="text-slate-400 mt-1 leading-relaxed">{chk.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
