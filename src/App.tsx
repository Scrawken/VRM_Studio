import { useCallback, useEffect, useState } from 'react';
import { BlenderWorkspace } from './components/BlenderWorkspace';
import { InspectorWorkspace } from './components/InspectorWorkspace';
import { ProjectsWorkspace } from './components/ProjectsWorkspace';
import { StudioWorkspace } from './components/StudioWorkspace';
import { TopNav, WorkspaceTab } from './components/TopNav';
import { VrmViewport } from './components/VrmViewport';
import {
  CharacterArtStyle,
  GenerationMode,
  PipelineStageResult,
  ProjectRecord,
  QualityConfig,
  ViewportAnimationMode,
  ViewportCameraPreset,
  ViewportLightingPreset,
  ViewportViewMode,
} from './shared/types';

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('studio');
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [liveStages, setLiveStages] = useState<PipelineStageResult[]>([]);

  // 3D Viewport State
  const [viewMode, setViewMode] = useState<ViewportViewMode>('appearance');
  const [animationMode, setAnimationMode] = useState<ViewportAnimationMode>('idle');
  const [cameraPreset, setCameraPreset] = useState<ViewportCameraPreset>('full');
  const [lightingPreset, setLightingPreset] = useState<ViewportLightingPreset>('studio');
  const [expressionWeights, setExpressionWeights] = useState<Record<string, number>>({});
  const [boneHighlight, setBoneHighlight] = useState<string | null>(null);

  const loadProjects = useCallback(async (preferId?: string) => {
    const res = await fetch('/api/projects');
    if (!res.ok) return;
    const data = (await res.json()) as { projects: ProjectRecord[] };
    setProjects(data.projects);
    if (preferId) {
      setActiveProjectId(preferId);
    } else if (data.projects.length > 0) {
      setActiveProjectId((prev) =>
        prev && data.projects.some((p) => p.id === prev) ? prev : data.projects[0].id
      );
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const activeProject = projects.find((p) => p.id === activeProjectId) || null;

  const handleGenerate = async (params: {
    prompt: string;
    mode: GenerationMode;
    interpreterProvider: string;
    geometryProvider: string;
    artStyle?: CharacterArtStyle;
    qualityConfig?: QualityConfig;
  }) => {
    setIsGenerating(true);
    setGenerationError(null);
    setLiveStages([
      {
        id: 'interpret',
        label: '1. Character Interpretation',
        status: 'running',
        durationMs: 0,
        detail: `Invoking ${params.interpreterProvider} in ${params.mode} mode...`,
      },
      {
        id: 'visual_design',
        label: '2. Visual Design & Art Direction',
        status: 'pending',
        durationMs: 0,
        detail: 'Preparing anatomy, hair & garment specification',
      },
      {
        id: 'geometry_3d',
        label: '3. High-Detail 3D Geometry',
        status: 'pending',
        durationMs: 0,
        detail: `Using ${params.geometryProvider}`,
      },
      {
        id: 'rigging',
        label: '7. Humanoid Rigging & Weights',
        status: 'pending',
        durationMs: 0,
        detail: '65-bone VRM 1.0 armature + 17 morph targets',
      },
      {
        id: 'vrm_export',
        label: '10. VRM 1.0 Export & Audit',
        status: 'pending',
        durationMs: 0,
        detail: 'Independent glTF/VRMC_vrm validation',
      },
    ]);

    try {
      const res = await fetch('/api/characters/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Generation request failed');
      }
      const created = data.project as ProjectRecord;
      setLiveStages(created.stages);
      setExpressionWeights({});
      setCameraPreset('full');
      await loadProjects(created.id);
    } catch (err) {
      setGenerationError((err as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCustomizeRebuild = async (patch: Record<string, unknown>) => {
    if (!activeProject) return;
    setIsRebuilding(true);
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/customize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (res.ok && data.project) {
        await loadProjects(data.project.id);
      }
    } finally {
      setIsRebuilding(false);
    }
  };

  const handleDuplicateProject = async (id: string) => {
    const res = await fetch(`/api/projects/${id}/duplicate`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.project) {
      await loadProjects(data.project.id);
    }
  };

  const handleExportVrm = () => {
    if (!activeProject) return;
    window.location.href = `${activeProject.vrmUrl}&download=1`;
  };

  const handleChangeExpression = (name: string, value: number) => {
    setExpressionWeights((prev) => ({ ...prev, [name]: value }));
  };

  const handleResetExpressions = () => {
    setExpressionWeights({});
  };

  const viewportElement = (
    <VrmViewport
      vrmUrl={activeProject?.vrmUrl ?? null}
      characterName={activeProject?.name ?? 'No Character Selected'}
      viewMode={viewMode}
      onChangeViewMode={setViewMode}
      animationMode={animationMode}
      onChangeAnimationMode={setAnimationMode}
      cameraPreset={cameraPreset}
      onChangeCameraPreset={setCameraPreset}
      lightingPreset={lightingPreset}
      onChangeLightingPreset={setLightingPreset}
      expressionWeights={expressionWeights}
      boneHighlight={boneHighlight}
    />
  );

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0e1116] text-[#f0f4f8] overflow-hidden">
      <TopNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onExportVrm={handleExportVrm}
        canExport={Boolean(activeProject)}
      />

      {activeTab === 'studio' && (
        <StudioWorkspace
          activeProject={activeProject}
          isGenerating={isGenerating}
          generationError={generationError}
          liveStages={liveStages}
          onGenerate={handleGenerate}
          onOpenInspector={() => setActiveTab('inspector')}
          viewportNode={viewportElement}
        />
      )}

      {activeTab === 'inspector' && (
        <InspectorWorkspace
          project={activeProject}
          expressionWeights={expressionWeights}
          onChangeExpression={handleChangeExpression}
          onResetExpressions={handleResetExpressions}
          onChangeViewMode={setViewMode}
          onChangeAnimationMode={setAnimationMode}
          boneHighlight={boneHighlight}
          onSelectBone={setBoneHighlight}
          onCustomizeRebuild={handleCustomizeRebuild}
          isRebuilding={isRebuilding}
          viewportNode={viewportElement}
        />
      )}

      {activeTab === 'blender' && <BlenderWorkspace activeProject={activeProject} />}

      {activeTab === 'projects' && (
        <ProjectsWorkspace
          projects={projects}
          activeProjectId={activeProject?.id ?? null}
          onSelectProject={(proj, targetTab) => {
            setActiveProjectId(proj.id);
            setExpressionWeights({});
            setActiveTab(targetTab);
          }}
          onDuplicateProject={handleDuplicateProject}
        />
      )}
    </div>
  );
}
