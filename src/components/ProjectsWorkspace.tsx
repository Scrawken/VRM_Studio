import React, { useState } from 'react';
import {
  Copy,
  Download,
  FolderOpen,
  Search,
  Sliders,
  CheckCircle2,
} from 'lucide-react';
import { GenerationMode, ProjectRecord } from '../shared/types';

interface ProjectsWorkspaceProps {
  projects: ProjectRecord[];
  activeProjectId: string | null;
  onSelectProject: (project: ProjectRecord, targetTab: 'studio' | 'inspector') => void;
  onDuplicateProject: (id: string) => Promise<void>;
}

export const ProjectsWorkspace: React.FC<ProjectsWorkspaceProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onDuplicateProject,
}) => {
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | GenerationMode>('all');

  const filtered = projects.filter((p) => {
    if (modeFilter !== 'all' && p.mode !== modeFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.spec.species.toLowerCase().includes(q) ||
      p.spec.sourcePrompt.toLowerCase().includes(q)
    );
  });

  const active = projects.find((p) => p.id === activeProjectId) || filtered[0] || null;

  return (
    <div className="flex-1 overflow-y-auto bg-[#0e1116] p-6">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#262d38] pb-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-[#f0f4f8]">
              Projects & Export Center
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Manage locally persisted VRM characters, inspect revision history, and download VRM 0.0 / 1.0, GLB, Blender scripts, or specs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Search saved characters"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search characters..."
                className="pl-8 pr-3 py-1.5 rounded-md border border-[#262d38] bg-[#12161f] text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="flex items-center gap-1 p-1 rounded-md bg-[#12161f] border border-[#262d38]">
              {(['all', 'hybrid', 'local', 'cloud'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModeFilter(m)}
                  className={`px-2.5 py-1 rounded text-xs font-medium capitalize whitespace-nowrap cursor-pointer ${
                    modeFilter === m
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          {/* Project List */}
          <section className="flex flex-col gap-3">
            {filtered.length === 0 ? (
              <div className="rounded-lg border border-[#262d38] bg-[#12161f] p-8 text-center text-sm text-slate-400">
                No matching characters found. Create a new character in Studio.
              </div>
            ) : (
              filtered.map((proj) => {
                const isSelected = proj.id === active?.id;
                return (
                  <article
                    key={proj.id}
                    className={`rounded-lg border p-4 transition-colors ${
                      isSelected
                        ? 'border-sky-500 bg-[#141a24]'
                        : 'border-[#262d38] bg-[#12161f] hover:border-slate-600'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="font-semibold text-base text-slate-100 font-display">
                            {proj.name}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{proj.spec.species}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">v{proj.spec.version}</span>
                          <span aria-hidden="true">·</span>
                          <span className="capitalize">{proj.mode}</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">
                          {proj.spec.sourcePrompt}
                        </p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-slate-400 tabular-nums">
                          <span>{proj.validation.triangleCount.toLocaleString()} tris</span>
                          <span aria-hidden="true">·</span>
                          <span>{proj.validation.boneCount} bones</span>
                          <span aria-hidden="true">·</span>
                          <span className="capitalize">{proj.spec.artStyle?.replace('_', ' ') ?? 'semi realistic'}</span>
                          <span aria-hidden="true">·</span>
                          <span>{(proj.validation.fileSizeBytes / 1024).toFixed(1)} KB</span>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                            VRM {proj.vrmVersion || proj.validation.vrmVersion} {proj.validation.valid ? 'Valid' : 'Invalid'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-500">
                            {proj.productionPath === 'blender_live' ? 'Blender Verified' : 'TS Fallback'}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onSelectProject(proj, 'studio')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white whitespace-nowrap cursor-pointer"
                        >
                          <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectProject(proj, 'inspector')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#262d38] bg-[#161b22] hover:border-slate-500 text-xs font-medium text-slate-200 whitespace-nowrap cursor-pointer"
                        >
                          <Sliders className="w-3.5 h-3.5" aria-hidden="true" />
                          Inspect
                        </button>
                        <button
                          type="button"
                          onClick={() => onDuplicateProject(proj.id)}
                          aria-label={`Duplicate ${proj.name}`}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[#262d38] bg-[#161b22] hover:border-slate-500 text-xs font-medium text-slate-300 whitespace-nowrap cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                          Clone
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </section>

          {/* Export & Revision History Drawer */}
          {active && (
            <aside className="rounded-lg border border-[#262d38] bg-[#12161f] p-5 flex flex-col gap-5 h-fit">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  Export Artifacts: {active.name}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Local path: <span className="font-mono">projects/{active.id}/</span>
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <a
                  href={`${active.vrmUrl}&download=1`}
                  className="w-full inline-flex items-center justify-between px-3.5 py-2 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white transition-colors"
                >
                  <span>Download VRM {active.vrmVersion || active.validation.vrmVersion} (.vrm)</span>
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
                <a
                  href={`${active.glbUrl}&download=1`}
                  className="w-full inline-flex items-center justify-between px-3.5 py-2 rounded-md border border-[#262d38] bg-[#0b0e13] hover:border-slate-500 text-xs font-medium text-slate-200 transition-colors"
                >
                  <span>Download Optimized GLB (.glb)</span>
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
                {active.sourceGlbUrl && (
                  <a
                    href={`${active.sourceGlbUrl}&download=1`}
                    className="w-full inline-flex items-center justify-between px-3.5 py-2 rounded-md border border-[#262d38] bg-[#0b0e13] hover:border-emerald-500 text-xs font-medium text-emerald-200 transition-colors"
                  >
                    <span>Download High-Detail Source (.glb)</span>
                    <Download className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  </a>
                )}
                <a
                  href={`${active.blenderScriptUrl}&download=1`}
                  className="w-full inline-flex items-center justify-between px-3.5 py-2 rounded-md border border-[#262d38] bg-[#0b0e13] hover:border-slate-500 text-xs font-medium text-slate-200 transition-colors"
                >
                  <span>Download Blender Script (.py)</span>
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
                <a
                  href={`/api/projects/${active.id}/files/spec.json?download=1`}
                  className="w-full inline-flex items-center justify-between px-3.5 py-2 rounded-md border border-[#262d38] bg-[#0b0e13] hover:border-slate-500 text-xs font-medium text-slate-200 transition-colors"
                >
                  <span>Download Character Spec (.json)</span>
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
                {active.blenderReportUrl && (
                  <a
                    href={`${active.blenderReportUrl}&download=1`}
                    className="w-full inline-flex items-center justify-between px-3.5 py-2 rounded-md border border-[#262d38] bg-[#0b0e13] hover:border-sky-500 text-xs font-medium text-sky-200 transition-colors"
                  >
                    <span>Download Blender Report (.json)</span>
                    <Download className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                  </a>
                )}
              </div>

              <div className="border-t border-[#262d38] pt-4">
                <h3 className="text-xs font-semibold text-slate-200 mb-2.5">
                  Revision History ({active.revisions.length})
                </h3>
                <ul className="flex flex-col gap-2 max-h-56 overflow-y-auto">
                  {active.revisions.map((rev) => (
                    <li
                      key={`${rev.version}-${rev.timestamp}`}
                      className="text-xs border-b border-[#1c222d] pb-2 last:border-0"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-sky-400">v{rev.version}</span>
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {new Date(rev.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-slate-300 mt-0.5">{rev.summary}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
};
