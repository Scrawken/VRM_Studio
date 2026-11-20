import { spawnSync } from 'node:child_process';

export interface PythonInterpreter {
  command: string;
  prefixArgs: string[];
}

function works(c: PythonInterpreter): boolean {
  try {
    const r = spawnSync(c.command, [...c.prefixArgs, '-c', 'import sys'], { stdio: 'ignore', timeout: 5000 });
    return r.status === 0 && !r.error;
  } catch {
    return false;
  }
}

/**
 * One place that picks the Python interpreter.
 * Order: VRM_FORGE_PYTHON override, then python (win32) / python3 (others), then the cross
 * fallbacks (python3/python, plus `py -3` on Windows). Returns the first that actually runs.
 */
export function candidatePythonInterpreters(): PythonInterpreter[] {
  const out: PythonInterpreter[] = [];
  const override = process.env.VRM_FORGE_PYTHON?.trim();
  if (override) out.push({ command: override, prefixArgs: [] });
  const win = process.platform === 'win32';
  out.push({ command: win ? 'python' : 'python3', prefixArgs: [] });
  out.push({ command: win ? 'python3' : 'python', prefixArgs: [] });
  if (win) out.push({ command: 'py', prefixArgs: ['-3'] });
  return out;
}

export function resolvePythonInterpreter(): PythonInterpreter {
  const candidates = candidatePythonInterpreters();
  for (const c of candidates) if (works(c)) return c;
  throw new Error(
    `No working Python interpreter found (tried: ${candidates.map((c) => [c.command, ...c.prefixArgs].join(' ')).join(', ')}). Set VRM_FORGE_PYTHON.`
  );
}
