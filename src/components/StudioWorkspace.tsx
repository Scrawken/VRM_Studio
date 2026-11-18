import React, { useMemo, useRef, useState } from 'react';
import {
  Play,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowRight,
  Download,
  Sliders,
  Upload,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { parseCharacterPromptFallback } from '../shared/characterParser';
import {
  CharacterArtStyle,
  CustomOptimizationSettings,
  DEFAULT_CUSTOM_OPTIMIZATION,
  DEFAULT_QUALITY_CONFIG,
  GenerationMode,
  GeometryQuality,
  PipelineStageResult,
  ProjectRecord,
  QualityConfig,
  TextureResolution,
  VrmAllowance,
  VrmAllowedUser,
  VrmExportVersion,
  VrmMetadataConfig,
  VrmOptimizationMode,
} from '../shared/types';
import { estimateCharacterMetrics } from '../shared/vrmBuilder';

interface StudioWorkspaceProps {
  activeProject: ProjectRecord | null;
  isGenerating: boolean;
  generationError: string | null;
  generationNotice?: { usedFallback: boolean; text: string } | null;
  liveStages: PipelineStageResult[];
  onGenerate: (params: {
    prompt: string;
    mode: GenerationMode;
    interpreterProvider: string;
    geometryProvider: string;
    artStyle?: CharacterArtStyle;
    vrmVersion: VrmExportVersion;
    vrmMetadata?: Partial<VrmMetadataConfig>;
    qualityConfig?: QualityConfig;
  }) => Promise<void>;
  onImportGlb: (params: {
    file: File;
    name?: string;
    vrmVersion: VrmExportVersion;
    vrmMetadata?: Partial<VrmMetadataConfig>;
  }) => Promise<void>;
  onOpenInspector: () => void;
  viewportNode: React.ReactNode;
}

const ARCHETYPE_PRESETS = [
  {
    label: 'Dark Elf Paladin',
    artStyle: 'semi_realistic' as CharacterArtStyle,
    prompt:
      'Create a tall, slender female dark elf with pale lavender skin, long silver hair, glowing violet eyes, pointed ears, ornate black-and-purple armor, a detailed fantasy cloak, and an athletic physique. Give her realistic humanoid proportions and a mysterious appearance.',
  },
  {
    label: 'Realistic Human',
    artStyle: 'realistic_human' as CharacterArtStyle,
    prompt:
      'Create an anatomically realistic human male ranger with tan skin, short brown hair, emerald eyes, dark brown tactical leather coat and boots, athletic muscular build, and realistic humanoid proportions.',
  },
  {
    label: 'Armored Paladin',
    artStyle: 'semi_realistic' as CharacterArtStyle,
    prompt:
      'Create a heroic female celestial paladin with porcelain skin, long braided golden hair, glowing amber eyes, silver-and-ivory ornate armor, layered pauldrons, winged mantle, and flowing royal cloak.',
  },
  {
    label: 'Anime Mage',
    artStyle: 'stylized_anime' as CharacterArtStyle,
    prompt:
      'Create a stylized anime female celestial archmage with fair skin, long flowing pink hair, glowing ice blue eyes, royal navy-and-gold robes, and a flowing cape.',
  },
];

export const StudioWorkspace: React.FC<StudioWorkspaceProps> = ({
  activeProject,
  isGenerating,
  generationError,
  generationNotice,
  liveStages,
  onGenerate,
  onImportGlb,
  onOpenInspector,
  viewportNode,
}) => {
  const [prompt, setPrompt] = useState(
    activeProject?.spec.sourcePrompt || ARCHETYPE_PRESETS[0].prompt
  );
  const [mode, setMode] = useState<GenerationMode>(activeProject?.mode || 'hybrid');
  const [vrmVersion, setVrmVersion] = useState<VrmExportVersion>(
    activeProject?.spec.riggingRequirements?.vrmVersion || '0.0'
  );
  const [artStyleChoice, setArtStyleChoice] = useState<'auto' | CharacterArtStyle>('auto');
  const [interpreterProvider, setInterpreterProvider] = useState<string>('auto');
  const [geometryProvider, setGeometryProvider] = useState<string>('sculpted-anatomical-vrm');

  // Local AURA / GLB Direct Import State
  const glbInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedGlbFile, setSelectedGlbFile] = useState<File | null>(null);
  const [importCharName, setImportCharName] = useState('');

  // Conservative Avatar Metadata & Rights Defaults
  const [metaOpen, setMetaOpen] = useState(false);
  const [metaAuthor, setMetaAuthor] = useState(activeProject?.spec.vrmMetadata?.author || '');
  const [metaCommercial, setMetaCommercial] = useState<VrmAllowance>(
    activeProject?.spec.vrmMetadata?.commercialUsage || 'Disallow'
  );
  const [metaAllowedUser, setMetaAllowedUser] = useState<VrmAllowedUser>(
    activeProject?.spec.vrmMetadata?.allowedUserName || 'OnlyAuthor'
  );
  const [metaLicenseName, setMetaLicenseName] = useState(
    activeProject?.spec.vrmMetadata?.licenseName || 'Other'
  );

  // Independent Quality, Texture & Optimization Controls
  const [geometryQuality, setGeometryQuality] = useState<GeometryQuality>(
    activeProject?.spec.qualityConfig?.geometryQuality ?? DEFAULT_QUALITY_CONFIG.geometryQuality
  );
  const [textureResolution, setTextureResolution] = useState<TextureResolution>(
    activeProject?.spec.qualityConfig?.textureResolution ?? DEFAULT_QUALITY_CONFIG.textureResolution
  );
  const [vrmOptimization, setVrmOptimization] = useState<VrmOptimizationMode>(
    activeProject?.spec.qualityConfig?.vrmOptimization ?? DEFAULT_QUALITY_CONFIG.vrmOptimization
  );
  const [customOpt, setCustomOpt] = useState<CustomOptimizationSettings>(
    activeProject?.spec.qualityConfig?.customOptimization ?? { ...DEFAULT_CUSTOM_OPTIMIZATION }
  );

  const [formError, setFormError] = useState<string | null>(null);

  const qualityConfig: QualityConfig = useMemo(
    () => ({
      geometryQuality,
      textureResolution,
      vrmOptimization,
      customOptimization: customOpt,
    }),
    [geometryQuality, textureResolution, vrmOptimization, customOpt]
  );

  const liveEstimates = useMemo(() => {
    const previewSpec = parseCharacterPromptFallback(prompt || 'Human character', {
      artStyle: artStyleChoice === 'auto' ? undefined : artStyleChoice,
      vrmVersion,
      qualityConfig,
    });
    return estimateCharacterMetrics(previewSpec);
  }, [prompt, artStyleChoice, vrmVersion, qualityConfig]);

  const vrmMetadataPayload: Partial<VrmMetadataConfig> = {
    author: metaAuthor,
    commercialUsage: metaCommercial,
    allowedUserName: metaAllowedUser,
    licenseName: metaLicenseName,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setFormError('Enter a natural-language character description before generating.');
      return;
    }
    setFormError(null);
    await onGenerate({
      prompt: prompt.trim(),
      mode,
      interpreterProvider:
        interpreterProvider === 'auto'
          ? mode === 'local'
            ? 'local-semantic-parser'
            : 'gemini-4-hydrogen'
          : interpreterProvider,
      geometryProvider,
      artStyle: artStyleChoice === 'auto' ? undefined : artStyleChoice,
      vrmVersion,
      vrmMetadata: vrmMetadataPayload,
      qualityConfig,
    });
  };

  const handleImportSubmit = async () => {
    if (!selectedGlbFile) {
      setFormError('Choose a local .glb file (e.g., from AURA or VRoid) before importing.');
      return;
    }
    setFormError(null);
    await onImportGlb({
      file: selectedGlbFile,
      name: importCharName.trim() || undefined,
      vrmVersion,
      vrmMetadata: vrmMetadataPayload,
    });
  };

  const stagesToShow = liveStages.length > 0 ? liveStages : activeProject?.stages || [];
  const activeVrmVersion =
    activeProject?.vrmVersion || activeProject?.validation.vrmVersion || vrmVersion;

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[430px_1fr]">
      {/* Left Creation & Pipeline Panel */}
      <aside className="border-b lg:border-b-0 lg:border-r border-[#262d38] bg-[#12161f] flex flex-col min-h-0 overflow-y-auto p-5 gap-5">
        <div>
          <h1 className="font-display text-lg font-semibold text-[#f0f4f8]">
            VRM Character Pipeline
          </h1>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Import a local AURA/GLB character or synthesize from prompt to export a rigged VRM 0.0 (UE5 / VRM4U) or VRM 1.0 avatar.
          </p>
        </div>

        {/* Target Export Format Selector (VRM 0.0 Primary vs VRM 1.0 Optional) */}
        <div className="rounded-lg border border-[#262d38] bg-[#0b0e13] p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-200">Target Export Format</span>
            <span className="text-[11px] text-slate-500">UE5 VRM4U uses VRM 0.0</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              data-testid="vrm-version-00"
              onClick={() => setVrmVersion('0.0')}
              className={`py-1.5 px-2.5 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
                vrmVersion === '0.0'
                  ? 'border-sky-500 bg-sky-600/20 text-sky-200'
                  : 'border-[#262d38] bg-[#12161f] text-slate-400 hover:text-slate-200'
              }`}
            >
              VRM 0.0 (UE5 Primary)
            </button>
            <button
              type="button"
              data-testid="vrm-version-10"
              onClick={() => setVrmVersion('1.0')}
              className={`py-1.5 px-2.5 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
                vrmVersion === '1.0'
                  ? 'border-sky-500 bg-sky-600/20 text-sky-200'
                  : 'border-[#262d38] bg-[#12161f] text-slate-400 hover:text-slate-200'
              }`}
            >
              VRM 1.0 (Optional)
            </button>
          </div>
        </div>

        {/* Direct Local / AURA GLB Import (Zero Paid API Required) */}
        <section className="rounded-lg border border-[#262d38] bg-[#0b0e13] p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-200">
              Import Local AURA / Humanoid GLB
            </h2>
            <span className="text-[11px] text-emerald-400 font-mono">100% Local</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Accepts unrigged or rigged .glb meshes (incl. VRoid J_Bip_* bones), preserves PBR materials & textures, and exports VRM {vrmVersion}.
          </p>
          <input
            ref={glbInputRef}
            id="local-glb-file-input"
            type="file"
            accept=".glb"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              setSelectedGlbFile(file);
              if (file && !importCharName) {
                setImportCharName(file.name.replace(/\.(glb|gltf)$/i, ''));
              }
            }}
            className="text-xs text-slate-300 file:mr-2.5 file:py-1 file:px-2.5 file:rounded file:border file:border-[#262d38] file:bg-[#161b22] file:text-xs file:font-medium file:text-slate-200 hover:file:border-sky-500 cursor-pointer"
          />
          <div className="flex gap-2">
            <label htmlFor="import-char-name" className="sr-only">
              Imported Character Name
            </label>
            <input
              id="import-char-name"
              type="text"
              value={importCharName}
              onChange={(e) => setImportCharName(e.target.value)}
              placeholder="Avatar title (optional)..."
              className="flex-1 rounded-md border border-[#262d38] bg-[#12161f] px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
            />
            <button
              type="button"
              data-testid="import-glb-submit"
              onClick={handleImportSubmit}
              disabled={isGenerating || !selectedGlbFile}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-xs font-semibold text-white whitespace-nowrap cursor-pointer disabled:cursor-not-allowed"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              Import → VRM {vrmVersion}
            </button>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 border-t border-[#262d38] pt-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="character-prompt-input"
                className="text-xs font-medium text-slate-300"
              >
                Or Describe Character to Synthesize
              </label>
              <span className="text-[11px] text-slate-500 tabular-nums">
                {prompt.length} chars
              </span>
            </div>
            <textarea
              id="character-prompt-input"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe species, skin tone, hair, eyes, armor, cloak, and proportions..."
              className="w-full rounded-lg border border-[#262d38] bg-[#0b0e13] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500 transition-colors resize-y"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ARCHETYPE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setPrompt(preset.prompt);
                    setArtStyleChoice(preset.artStyle);
                    setFormError(null);
                  }}
                  className="px-2.5 py-1 rounded border border-[#262d38] bg-[#161b22] hover:border-slate-500 text-xs text-slate-300 hover:text-white transition-colors whitespace-nowrap cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Execution Mode & Art Style */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="block text-xs font-medium text-slate-300 mb-1">
                Execution Mode
              </span>
              <div className="grid grid-cols-3 gap-0.5 p-0.5 rounded-md bg-[#0b0e13] border border-[#262d38]">
                {(
                  [
                    { id: 'hybrid', label: 'Hybrid' },
                    { id: 'local', label: 'Local' },
                    { id: 'cloud', label: 'Cloud' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    className={`py-1.5 px-1.5 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      mode === m.id
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="artstyle-select"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Visual Art Style
              </label>
              <select
                id="artstyle-select"
                value={artStyleChoice}
                onChange={(e) => setArtStyleChoice(e.target.value as 'auto' | CharacterArtStyle)}
                className="w-full rounded-md border border-[#262d38] bg-[#0b0e13] px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
              >
                <option value="auto">Auto (From Prompt)</option>
                <option value="semi_realistic">Semi-Realistic Fantasy</option>
                <option value="stylized_anime">Stylized Anime</option>
                <option value="realistic_human">Realistic Human</option>
              </select>
            </div>
          </div>

          {/* Provider Selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="interpreter-select"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                AI Interpreter
              </label>
              <select
                id="interpreter-select"
                value={interpreterProvider}
                onChange={(e) => setInterpreterProvider(e.target.value)}
                className="w-full rounded-md border border-[#262d38] bg-[#0b0e13] px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
              >
                <option value="auto">Auto ({mode === 'local' ? 'Local' : 'Gemini 4'})</option>
                <option value="gemini-4-hydrogen">Gemini 4 Hydrogen</option>
                <option value="local-semantic-parser">Local Semantic Parser</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="geometry-select"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                3D Generation Engine
              </label>
              <select
                id="geometry-select"
                value={geometryProvider}
                onChange={(e) => setGeometryProvider(e.target.value)}
                className="w-full rounded-md border border-[#262d38] bg-[#0b0e13] px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
              >
                <option value="sculpted-anatomical-vrm">Sculpted Anatomical VRM</option>
                <option value="blender-bpy-bridge">Blender bpy Refinement</option>
                <option value="local-triposr-instantmesh">Local TripoSR / InstantMesh</option>
                <option value="tripo-ai-adapter">Tripo AI Adapter (Optional)</option>
                <option value="meshy-ai-adapter">Meshy AI Adapter (Optional)</option>
              </select>
            </div>
          </div>

          {/* Collapsible Avatar Metadata & Rights (Conservative Non-Commercial Defaults) */}
          <div className="rounded-lg border border-[#262d38] bg-[#0b0e13]">
            <button
              type="button"
              onClick={() => setMetaOpen((v) => !v)}
              className="w-full px-3 py-2 flex items-center justify-between text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
            >
              <span>Avatar Metadata & Rights ({metaCommercial === 'Disallow' ? 'Non-Commercial Default' : 'Commercial Allowed'})</span>
              {metaOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {metaOpen && (
              <div className="px-3 pb-3 pt-1 border-t border-[#1e2530] grid grid-cols-2 gap-2.5 text-xs">
                <div>
                  <label htmlFor="meta-author" className="block text-[11px] text-slate-400 mb-1">
                    Author
                  </label>
                  <input
                    id="meta-author"
                    type="text"
                    value={metaAuthor}
                    onChange={(e) => setMetaAuthor(e.target.value)}
                    placeholder="Unspecified Author"
                    className="w-full rounded border border-[#262d38] bg-[#12161f] px-2 py-1 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <label htmlFor="meta-license" className="block text-[11px] text-slate-400 mb-1">
                    License
                  </label>
                  <input
                    id="meta-license"
                    type="text"
                    value={metaLicenseName}
                    onChange={(e) => setMetaLicenseName(e.target.value)}
                    className="w-full rounded border border-[#262d38] bg-[#12161f] px-2 py-1 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <label htmlFor="meta-commercial" className="block text-[11px] text-slate-400 mb-1">
                    Commercial Usage
                  </label>
                  <select
                    id="meta-commercial"
                    value={metaCommercial}
                    onChange={(e) => setMetaCommercial(e.target.value as VrmAllowance)}
                    className="w-full rounded border border-[#262d38] bg-[#12161f] px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="Disallow">Disallow (Default)</option>
                    <option value="Allow">Allow</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="meta-allowed-user" className="block text-[11px] text-slate-400 mb-1">
                    Allowed User
                  </label>
                  <select
                    id="meta-allowed-user"
                    value={metaAllowedUser}
                    onChange={(e) => setMetaAllowedUser(e.target.value as VrmAllowedUser)}
                    className="w-full rounded border border-[#262d38] bg-[#12161f] px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="OnlyAuthor">OnlyAuthor</option>
                    <option value="ExplicitlyLicensedPerson">ExplicitlyLicensedPerson</option>
                    <option value="Everyone">Everyone</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Independent Quality, Texture & Optimization Settings */}
          <div className="rounded-lg border border-[#262d38] bg-[#0b0e13] p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <Sliders className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                Quality & VRM Optimization
              </span>
              <span className="text-[11px] text-slate-500">Source preserved separately</span>
            </div>

            <div>
              <span className="block text-[11px] font-medium text-slate-400 mb-1">
                Geometry Detail (Source & Rigged Base)
              </span>
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    { id: 'performance', label: 'Perf' },
                    { id: 'standard', label: 'Standard' },
                    { id: 'high', label: 'High' },
                    { id: 'ultra', label: 'Ultra' },
                  ] as const
                ).map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setGeometryQuality(q.id)}
                    className={`py-1 px-1.5 rounded text-[11px] font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                      geometryQuality === q.id
                        ? 'border-sky-500 bg-sky-600/20 text-sky-200'
                        : 'border-[#262d38] bg-[#12161f] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="block text-[11px] font-medium text-slate-400 mb-1">
                Texture Bake Target (Independent of Poly Count)
              </span>
              <div className="grid grid-cols-4 gap-1">
                {(['1k', '2k', '4k', '8k'] as TextureResolution[]).map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() => setTextureResolution(res)}
                    className={`py-1 px-1.5 rounded text-[11px] font-medium uppercase border transition-colors cursor-pointer whitespace-nowrap ${
                      textureResolution === res
                        ? 'border-sky-500 bg-sky-600/20 text-sky-200'
                        : 'border-[#262d38] bg-[#12161f] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="block text-[11px] font-medium text-slate-400 mb-1">
                VRM Export Optimization
              </span>
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    { id: 'unoptimized', label: 'Max Detail' },
                    { id: 'balanced', label: 'Balanced' },
                    { id: 'optimized', label: 'Optimized' },
                    { id: 'custom', label: 'Custom' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setVrmOptimization(opt.id)}
                    className={`py-1 px-1 rounded text-[11px] font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                      vrmOptimization === opt.id
                        ? 'border-emerald-500 bg-emerald-600/20 text-emerald-200'
                        : 'border-[#262d38] bg-[#12161f] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {vrmOptimization === 'custom' && (
              <div className="border-t border-[#1e2530] pt-2.5 flex flex-col gap-2.5 text-[11px]">
                <div>
                  <div className="flex justify-between text-slate-300 mb-1">
                    <label htmlFor="studio-opt-retention">Body Polygon Retention</label>
                    <span className="font-mono text-sky-300 tabular-nums">
                      {Math.round(customOpt.geometryRetention * 100)}%
                    </span>
                  </div>
                  <input
                    id="studio-opt-retention"
                    type="range"
                    min={0.35}
                    max={1}
                    step={0.05}
                    value={customOpt.geometryRetention}
                    onChange={(e) =>
                      setCustomOpt((prev) => ({
                        ...prev,
                        geometryRetention: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-sky-500"
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="studio-opt-texcap" className="text-slate-300">
                    Packed VRM Texture Cap
                  </label>
                  <select
                    id="studio-opt-texcap"
                    value={customOpt.maxVrmTexturePx}
                    onChange={(e) =>
                      setCustomOpt((prev) => ({
                        ...prev,
                        maxVrmTexturePx: Number(e.target.value) as 256 | 512 | 1024 | 2048,
                      }))
                    }
                    className="rounded border border-[#262d38] bg-[#12161f] px-2 py-1 text-[11px] text-slate-200"
                  >
                    <option value={256}>256 px</option>
                    <option value={512}>512 px</option>
                    <option value={1024}>1024 px</option>
                    <option value={2048}>2048 px (Blender)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-1.5 text-slate-300">
                  {[
                    { key: 'preserveFacialDetail', label: 'Preserve Face' },
                    { key: 'preserveHairDetail', label: 'Preserve Hair' },
                    { key: 'mergeStaticClothing', label: 'Merge Static Gear' },
                    { key: 'generateLod', label: 'Generate LOD' },
                  ].map((item) => (
                    <label key={item.key} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(customOpt[item.key as keyof CustomOptimizationSettings])}
                        onChange={(e) =>
                          setCustomOpt((prev) => ({
                            ...prev,
                            [item.key]: e.target.checked,
                          }))
                        }
                        className="accent-sky-500"
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-[#1e2530] pt-2 grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <div className="text-slate-500">Source → VRM Tris</div>
                <div className="font-mono text-slate-200 tabular-nums mt-0.5">
                  {(liveEstimates.sourceTriangles / 1000).toFixed(1)}k →{' '}
                  <span className="text-emerald-400">
                    {(liveEstimates.optimizedTriangles / 1000).toFixed(1)}k
                  </span>
                </div>
              </div>
              <div>
                <div className="text-slate-500">Texture Bake / VRAM</div>
                <div className="font-mono text-slate-200 tabular-nums mt-0.5">
                  {textureResolution.toUpperCase()} · {liveEstimates.estimatedTextureMemoryMb} MB
                </div>
              </div>
              <div>
                <div className="text-slate-500">Est. VRM Size</div>
                <div className="font-mono text-slate-200 tabular-nums mt-0.5">
                  ~{liveEstimates.estimatedVrmSizeKb} KB
                </div>
              </div>
            </div>
          </div>

          {(formError || generationError) && (
            <div
              role="alert"
              className="rounded-md border border-red-900/70 bg-red-950/30 px-3 py-2 text-xs text-red-200 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{formError || generationError}</span>
            </div>
          )}

          {generationNotice?.usedFallback && (
            <div
              role="status"
              className="rounded-md border border-amber-800/70 bg-amber-950/30 px-3 py-2 text-xs text-amber-200 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{generationNotice.text}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isGenerating}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-400 text-sm font-semibold text-white transition-colors cursor-pointer disabled:cursor-wait"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Building & Validating VRM {vrmVersion}...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" aria-hidden="true" />
                Generate High-Detail VRM {vrmVersion}
              </>
            )}
          </button>
        </form>

        {/* Active Specification Summary & Dual Export Links */}
        {activeProject && (
          <div className="border-t border-[#262d38] pt-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-200">Active Specification</h2>
              <button
                type="button"
                onClick={onOpenInspector}
                className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300 cursor-pointer"
              >
                Inspect & Customize
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-slate-100 font-medium">{activeProject.spec.name}</span>
              <span aria-hidden="true">·</span>
              <span>{activeProject.spec.species}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-sky-300">VRM {activeVrmVersion}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{activeProject.spec.proportions.heightMeters.toFixed(2)}m</span>
            </div>

            <div className="grid grid-cols-4 gap-2 py-2 border-y border-[#262d38] text-xs">
              <div>
                <div className="text-slate-500">Tris</div>
                <div className="font-mono text-slate-200 tabular-nums mt-0.5">
                  {activeProject.validation.triangleCount.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Bones</div>
                <div className="font-mono text-slate-200 tabular-nums mt-0.5">
                  {activeProject.validation.boneCount}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Expr</div>
                <div className="font-mono text-slate-200 tabular-nums mt-0.5">
                  {activeProject.validation.nonEmptyExpressions.length}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Mats/Tex</div>
                <div className="font-mono text-slate-200 tabular-nums mt-0.5">
                  {activeProject.validation.materialCount}/{activeProject.validation.textureCount}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <a
                href={`${activeProject.vrmUrl}&download=1`}
                className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded border border-[#262d38] bg-[#161b22] hover:border-sky-500 text-xs font-medium text-slate-200"
              >
                <Download className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                Export VRM {activeVrmVersion}
              </a>
              <a
                href={`${activeProject.sourceGlbUrl}&download=1`}
                className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded border border-[#262d38] bg-[#161b22] hover:border-emerald-500 text-xs font-medium text-slate-200"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                Source GLB
              </a>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">
                {activeProject.productionPath === 'blender_live'
                  ? 'Production: Blender Verified'
                  : 'Production: TS Fallback (No Host Blender)'}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 font-medium ${
                  activeProject.validation.valid ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                {activeProject.validation.valid
                  ? `Valid VRM ${activeProject.validation.vrmVersion}`
                  : 'Validation Failed'}
              </span>
            </div>
          </div>
        )}

        {/* 10-Stage Pipeline Log */}
        {stagesToShow.length > 0 && (
          <div className="border-t border-[#262d38] pt-4">
            <h2 className="text-xs font-semibold text-slate-200 mb-2.5">
              10-Stage Pipeline Execution
            </h2>
            <ol className="flex flex-col gap-2">
              {stagesToShow.map((st) => {
                const badgeClass =
                  st.status === 'completed' || st.status === 'validated'
                    ? 'text-emerald-400'
                    : st.status === 'fallback' || st.status === 'warning'
                      ? 'text-amber-400'
                      : st.status === 'error'
                        ? 'text-red-400'
                        : st.status === 'running' || st.status === 'prepared'
                          ? 'text-sky-400'
                          : 'text-slate-500';
                const badgeText =
                  st.status === 'skipped'
                    ? 'SKIPPED'
                    : st.status === 'prepared'
                      ? `PREP · ${st.durationMs}ms`
                      : st.status === 'validated'
                        ? `VERIFIED · ${st.durationMs}ms`
                        : st.status === 'fallback'
                          ? `FALLBACK · ${st.durationMs}ms`
                          : st.status === 'warning'
                            ? `WARN · ${st.durationMs}ms`
                            : st.status === 'error'
                              ? 'FAILED'
                              : st.status === 'running'
                                ? 'RUNNING'
                                : st.status === 'pending'
                                  ? 'PENDING'
                                  : `${st.durationMs}ms`;
                return (
                  <li key={st.id} className="text-xs flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-slate-200 font-medium truncate">{st.label}</div>
                      <div className="text-slate-500 text-[11px] truncate">{st.detail}</div>
                    </div>
                    <span className={`font-mono text-[11px] tabular-nums shrink-0 ${badgeClass}`}>
                      {badgeText}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </aside>

      {/* Main 3D VRM Viewport */}
      <main className="min-h-[500px] h-full relative">{viewportNode}</main>
    </div>
  );
};
