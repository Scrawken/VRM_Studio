import React from 'react';
import { Download } from 'lucide-react';

export type WorkspaceTab = 'studio' | 'inspector' | 'blender' | 'projects';

interface TopNavProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onExportVrm: () => void;
  canExport: boolean;
}

const NAV_ITEMS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'studio', label: 'Studio' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'blender', label: 'Blender' },
  { id: 'projects', label: 'Projects' },
];

export const TopNav: React.FC<TopNavProps> = ({
  activeTab,
  onSelectTab,
  onExportVrm,
  canExport,
}) => {
  return (
    <header className="h-14 shrink-0 border-b border-[#262d38] bg-[#12161f] px-6 flex items-center justify-between gap-8">
      <button
        type="button"
        onClick={() => onSelectTab('studio')}
        className="font-display text-lg font-semibold tracking-tight text-[#f0f4f8] whitespace-nowrap shrink-0 hover:text-sky-300 transition-colors cursor-pointer"
      >
        VRM Forge Studio
      </button>

      <nav aria-label="Primary workspaces" className="flex items-center gap-6 overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative py-4 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                isActive
                  ? 'text-sky-400'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {item.label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-sky-400"
                />
              )}
            </button>
          );
        })}
      </nav>

      <div className="shrink-0">
        <button
          type="button"
          onClick={onExportVrm}
          disabled={!canExport}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-500 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          Export VRM
        </button>
      </div>
    </header>
  );
};
