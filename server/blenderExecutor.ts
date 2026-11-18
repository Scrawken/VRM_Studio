import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BlenderDetectionResult, VrmExportVersion } from '../src/shared/types';
import { resolveSafePathWithinRoot, validateBlenderExecutablePath } from './security';
import { detectBlenderInstallation } from './systemProbe';

export interface BlenderReportJson {
  status: string;
  vrm_version?: string;
  blender_version?: string;
  blend_path?: string;
  vrm_path?: string | null;
  vrm_addon_installed?: boolean;
  vrm_exported?: boolean;
  vrm_export_success?: boolean;
  vrm_reload_valid?: boolean;
  vrm_reload_success?: boolean;
  rigging_success?: boolean;
  material_preserved?: boolean;
  texture_preserved?: boolean;
  weights_normalized?: boolean;
  deformation_verified?: boolean;
  deformation_max_delta?: number;
  missing_required_bones?: string[];
  vrm_note?: string | null;
}

export interface BlenderExecutionOutcome {
  attempted: boolean;
  succeeded: boolean;
  durationMs: number;
  blenderVersion: string | null;
  vrmAddonInstalled: boolean;
  vrmBuffer?: Uint8Array;
  report?: BlenderReportJson;
  stdout: string;
  stderr: string;
  reason?: string;
}

export function resolveBlenderScriptsDir(): string {
  return path.resolve(
    process.env.VRM_FORGE_BLENDER_SCRIPTS_DIR || path.join(process.cwd(), 'blender_scripts')
  );
}

export async function runHeadlessBlenderPipeline(params: {
  glbPath: string;
  outDir: string;
  specJsonPath?: string;
  vrmVersion: VrmExportVersion;
  timeoutMs?: number;
  signal?: AbortSignal;
  blenderOverride?: BlenderDetectionResult;
}): Promise<BlenderExecutionOutcome> {
  const t0 = performance.now();
  const detection = params.blenderOverride ?? detectBlenderInstallation();

  if (!detection.installed || !detection.executablePath) {
    return {
      attempted: false,
      succeeded: false,
      durationMs: Math.max(1, Math.round(performance.now() - t0)),
      blenderVersion: null,
      vrmAddonInstalled: false,
      stdout: '',
      stderr: '',
      reason: detection.statusMessage || 'Blender executable not found on this host.',
    };
  }

  if (!detection.vrmAddonDetected) {
    return {
      attempted: false,
      succeeded: false,
      durationMs: Math.max(1, Math.round(performance.now() - t0)),
      blenderVersion: detection.version,
      vrmAddonInstalled: false,
      stdout: '',
      stderr: '',
      reason: `${detection.version} found, but VRM_Addon_for_Blender is not installed.`,
    };
  }

  // Re-verify executable against security allowlist right before spawn
  const pathCheck = validateBlenderExecutablePath(detection.executablePath, {
    allowCustomFolderIfVerified: true,
    requireExistingFile: true,
  });
  if (!pathCheck.valid || !pathCheck.normalizedPath) {
    return {
      attempted: false,
      succeeded: false,
      durationMs: Math.max(1, Math.round(performance.now() - t0)),
      blenderVersion: detection.version,
      vrmAddonInstalled: detection.vrmAddonDetected,
      stdout: '',
      stderr: '',
      reason: pathCheck.reason || 'Blender executable path rejected by security policy.',
    };
  }

  const scriptsDir = resolveBlenderScriptsDir();
  const pipelineScript = resolveSafePathWithinRoot(scriptsDir, 'blender_production_pipeline.py');
  if (!fs.existsSync(pipelineScript)) {
    return {
      attempted: false,
      succeeded: false,
      durationMs: Math.max(1, Math.round(performance.now() - t0)),
      blenderVersion: detection.version,
      vrmAddonInstalled: detection.vrmAddonDetected,
      stdout: '',
      stderr: '',
      reason: `Production Blender script missing at ${pipelineScript}`,
    };
  }

  const args = [
    '--background',
    '--python',
    pipelineScript,
    '--',
    '--glb-path',
    params.glbPath,
    '--out-dir',
    params.outDir,
    '--vrm-version',
    params.vrmVersion,
  ];
  if (params.specJsonPath) {
    args.push('--spec-json', params.specJsonPath);
  }

  const timeoutMs = params.timeoutMs ?? 120000;

  return await new Promise<BlenderExecutionOutcome>((resolve) => {
    const child = spawn(pathCheck.normalizedPath!, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (outcome: BlenderExecutionOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (params.signal) {
        params.signal.removeEventListener('abort', onAbort);
      }
      resolve(outcome);
    };

    const onAbort = () => {
      child.kill('SIGTERM');
      finish({
        attempted: true,
        succeeded: false,
        durationMs: Math.max(1, Math.round(performance.now() - t0)),
        blenderVersion: detection.version,
        vrmAddonInstalled: detection.vrmAddonDetected,
        stdout,
        stderr,
        reason: 'Blender pipeline aborted by caller signal.',
      });
    };

    if (params.signal) {
      if (params.signal.aborted) {
        onAbort();
        return;
      }
      params.signal.addEventListener('abort', onAbort, { once: true });
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({
        attempted: true,
        succeeded: false,
        durationMs: Math.max(1, Math.round(performance.now() - t0)),
        blenderVersion: detection.version,
        vrmAddonInstalled: detection.vrmAddonDetected,
        stdout,
        stderr,
        reason: `Blender pipeline timed out after ${timeoutMs}ms.`,
      });
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 32768) {
        stdout += chunk.toString('utf8');
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 32768) {
        stderr += chunk.toString('utf8');
      }
    });

    child.on('error', (err) => {
      finish({
        attempted: true,
        succeeded: false,
        durationMs: Math.max(1, Math.round(performance.now() - t0)),
        blenderVersion: detection.version,
        vrmAddonInstalled: detection.vrmAddonDetected,
        stdout,
        stderr,
        reason: `Failed to launch Blender process: ${err.message}`,
      });
    });

    child.on('close', (code) => {
      const durationMs = Math.max(1, Math.round(performance.now() - t0));
      const reportPath = resolveSafePathWithinRoot(params.outDir, 'blender_report.json');
      const vrmPath = resolveSafePathWithinRoot(params.outDir, 'character_blender.vrm');

      let report: BlenderReportJson | undefined;
      if (fs.existsSync(reportPath)) {
        try {
          report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as BlenderReportJson;
        } catch {
          report = undefined;
        }
      }

      const vrmExists = fs.existsSync(vrmPath) && fs.statSync(vrmPath).size > 0;
      const succeeded =
        code === 0 &&
        report?.status === 'ok' &&
        Boolean(report?.vrm_export_success) &&
        Boolean(report?.vrm_reload_success) &&
        vrmExists;

      const vrmBuffer = succeeded ? new Uint8Array(fs.readFileSync(vrmPath)) : undefined;

      finish({
        attempted: true,
        succeeded,
        durationMs,
        blenderVersion: detection.version,
        vrmAddonInstalled: detection.vrmAddonDetected,
        vrmBuffer,
        report,
        stdout,
        stderr,
        reason: succeeded
          ? undefined
          : report?.vrm_note ||
            (code !== 0
              ? `Blender exited with code ${code}${stderr ? `: ${stderr.slice(0, 220)}` : ''}`
              : 'Blender did not produce a verified .vrm file.'),
      });
    });
  });
}
