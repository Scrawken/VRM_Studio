import React, { useEffect, useState } from 'react';
import {
  Terminal,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Play,
} from 'lucide-react';
import {
  BlenderDetectionResult,
  HardwareCapabilities,
  ProjectRecord,
  ProviderStatus,
} from '../shared/types';
import { generateBlenderCharacterScript } from '../shared/blenderScriptGen';

interface BlenderWorkspaceProps {
  activeProject: ProjectRecord | null;
}

export const BlenderWorkspace: React.FC<BlenderWorkspaceProps> = ({ activeProject }) => {
  const [blender, setBlender] = useState<BlenderDetectionResult | null>(null);
  const [hardware, setHardware] = useState<HardwareCapabilities | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [customPath, setCustomPath] = useState('');
  const [loadingProbe, setLoadingProbe] = useState(true);
  const [runningTest, setRunningTest] = useState(false);
  const [testResult, setTestResult] = useState<{
    executed: boolean;
    mode: string;
    note?: string;
    stdout?: string;
    error?: string;
  } | null>(null);

  const loadCapabilities = async (overridePath?: string) => {
    setLoadingProbe(true);
    try {
      const q = overridePath ? `?blenderPath=${encodeURIComponent(overridePath)}` : '';
      const res = await fetch(`/api/system/capabilities${q}`);
      const data = await res.json();
      setBlender(data.blender);
      setHardware(data.hardware);
      setProviders(data.providers || []);
    } finally {
      setLoadingProbe(false);
    }
  };

  useEffect(() => {
    loadCapabilities();
  }, []);

  const handleProbePath = async (e: React.FormEvent) => {
    e.preventDefault();
    await loadCapabilities(customPath.trim() || undefined);
  };

  const handleRunTest = async () => {
    setRunningTest(true);
    try {
      const res = await fetch('/api/blender/run-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPath: customPath.trim() || undefined }),
      });
      const data = await res.json();
      setTestResult(data);
    } finally {
      setRunningTest(false);
    }
  };

  const bpyScript = activeProject
    ? generateBlenderCharacterScript(activeProject.spec)
    : '# Select or generate a character in Studio to view its Blender Python build script.';

  const handleDownloadScript = () => {
    if (!activeProject) return;
    window.location.href = `${activeProject.blenderScriptUrl}&download=1`;
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#0e1116] p-6">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#262d38] pb-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-[#f0f4f8]">
              Blender & Desktop Runtime
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Blender executable detection, hardware capability assessment, provider routing, and bpy automation scripts.
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadCapabilities(customPath.trim() || undefined)}
            disabled={loadingProbe}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[#262d38] bg-[#161b22] hover:border-slate-500 text-xs font-medium text-slate-200 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingProbe ? 'animate-spin' : ''}`} aria-hidden="true" />
            Re-scan Host
          </button>
        </div>

        {/* Top 2-Column Grid: Blender Detection + Hardware Assessment */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="rounded-lg border border-[#262d38] bg-[#12161f] p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">
                Blender Executable Detection
              </h2>
              {blender && (
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                    blender.installed ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {blender.installed ? (
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  {blender.installed ? blender.version : 'Not Found on Host'}
                </span>
              )}
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              {blender?.statusMessage || 'Scanning local Blender installation paths...'}
            </p>

            <form onSubmit={handleProbePath} className="flex gap-2">
              <label htmlFor="blender-path-input" className="sr-only">
                Custom Blender Executable Path
              </label>
              <input
                id="blender-path-input"
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="C:\Program Files\Blender Foundation\Blender 4.2\blender.exe"
                className="flex-1 rounded-md border border-[#262d38] bg-[#0b0e13] px-3 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
              />
              <button
                type="submit"
                className="px-3.5 py-2 rounded-md border border-[#262d38] bg-[#161b22] hover:border-sky-500 text-xs font-medium text-slate-200 whitespace-nowrap cursor-pointer"
              >
                Verify Path
              </button>
            </form>

            <div className="border-t border-[#262d38] pt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-400">
                Milestone 2 Mesh + Armature Verification
              </span>
              <button
                type="button"
                onClick={handleRunTest}
                disabled={runningTest}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 text-xs font-semibold text-white whitespace-nowrap cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                {runningTest ? 'Running Test...' : 'Run Verification Test'}
              </button>
            </div>

            {testResult && (
              <div className="rounded-md border border-[#262d38] bg-[#0b0e13] p-3 text-xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-slate-200">
                    Result: {testResult.mode}
                  </span>
                  <span className={testResult.executed ? 'text-emerald-400' : 'text-red-400'}>
                    {testResult.executed ? 'PASSED' : 'ERROR'}
                  </span>
                </div>
                {testResult.note && <p className="text-slate-400 mb-2">{testResult.note}</p>}
                {testResult.stdout && (
                  <pre className="font-mono text-[11px] text-slate-300 overflow-x-auto max-h-36 whitespace-pre-wrap">
                    {testResult.stdout}
                  </pre>
                )}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[#262d38] bg-[#12161f] p-5 flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-100">
              Hardware Capability Assessment
            </h2>
            {hardware ? (
              <>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500">Host OS / Arch</span>
                    <div className="font-mono text-slate-200 mt-0.5">
                      {hardware.os} ({hardware.arch})
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">CPU Cores</span>
                    <div className="font-mono text-slate-200 tabular-nums mt-0.5">
                      {hardware.cpuCores} cores
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">System RAM</span>
                    <div className="font-mono text-slate-200 tabular-nums mt-0.5">
                      {hardware.totalRamGb} GB ({hardware.freeRamGb} GB free)
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Recommended Mode</span>
                    <div className="font-mono text-sky-400 uppercase mt-0.5">
                      {hardware.recommendedMode}
                    </div>
                  </div>
                </div>
                <div className="text-xs border-t border-[#262d38] pt-3">
                  <span className="text-slate-500">Recommended Local Model Stack</span>
                  <div className="font-mono text-slate-200 mt-0.5">
                    {hardware.recommendedLocalLlm}
                  </div>
                </div>
                <ul className="text-xs text-slate-400 list-disc pl-4 flex flex-col gap-1">
                  {hardware.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-xs text-slate-400">Assessing hardware...</p>
            )}
          </section>
        </div>

        {/* Provider Registry Table */}
        <section className="rounded-lg border border-[#262d38] bg-[#12161f] p-5">
          <h2 className="text-sm font-semibold text-slate-100 mb-3">
            Modular AI & 3D Generation Providers
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#262d38] text-slate-400">
                  <th className="py-2 pr-4 font-medium">Provider</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Modes</th>
                  <th className="py-2 pr-4 font-medium">Cost / Licensing</th>
                  <th className="py-2 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.id} className="border-b border-[#1c222d] last:border-0">
                    <td className="py-2.5 pr-4">
                      <div className="font-medium text-slate-200">{p.name}</div>
                      <div className="text-[11px] text-slate-500">{p.description}</div>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-slate-300">{p.category}</td>
                    <td className="py-2.5 pr-4 text-slate-300">{p.modeSupport.join(' / ')}</td>
                    <td className="py-2.5 pr-4 text-slate-400">{p.costModel}</td>
                    <td className="py-2.5 text-right font-mono">
                      <span className={p.available ? 'text-emerald-400' : 'text-slate-500'}>
                        {p.available ? 'READY' : 'UNCONFIGURED'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Generated Blender Python Script */}
        <section className="rounded-lg border border-[#262d38] bg-[#12161f] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-sky-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-slate-100">
                Generated Blender Python (bpy) Script
              </h2>
              {activeProject && (
                <span className="text-xs text-slate-400">
                  · {activeProject.spec.name} (v{activeProject.spec.version})
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleDownloadScript}
              disabled={!activeProject}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#262d38] bg-[#161b22] hover:border-sky-500 disabled:opacity-40 text-xs font-medium text-slate-200 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Download .py
            </button>
          </div>
          <pre className="rounded-md border border-[#262d38] bg-[#0b0e13] p-4 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-80">
            {bpyScript}
          </pre>
        </section>
      </div>
    </div>
  );
};
