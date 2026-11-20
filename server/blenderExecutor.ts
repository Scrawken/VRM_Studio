import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BlenderDetectionResult, VrmExportVersion } from '../src/shared/types';
import { validateVrmBinary } from '../src/shared/vrmValidator';
import { resolveSafePathWithinRoot, validateBlenderExecutablePath } from './security';
import { detectBlenderInstallation } from './systemProbe';

export interface BlenderReportJson {
  status: string;
  run_id?: string;
  vrm_version?: string;
  blender_version?: string;
  blend_path?: string;
  vrm_path?: string | null;
  vrm_addon_installed?: boolean;
  vrm_exported?: boolean;
  vrm_export_success?: boolean;
  vrm_reload_valid?: boolean;
  vrm_reload_success?: boolean;
  python_validator_available?: boolean;
  output_vrm_sha256?: string | null;
  output_vrm_size?: number;
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
  runId?: string;
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

  if (params.signal?.aborted) {
    return {
      attempted: false,
      succeeded: false,
      durationMs: Math.max(1, Math.round(performance.now() - t0)),
      blenderVersion: detection.installed ? detection.version : null,
      vrmAddonInstalled: detection.installed ? detection.vrmAddonDetected : false,
      stdout: '',
      stderr: '',
      reason: 'Blender pipeline aborted before launch by caller signal.',
    };
  }

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

  const runId = crypto.randomUUID();
  const isolatedRunDir = resolveSafePathWithinRoot(
    params.outDir,
    path.join('_blender_runs', runId)
  );
  fs.mkdirSync(isolatedRunDir, { recursive: true });

  // Remove any stale blender_report.json in outDir before launching so failed runs cannot look valid
  const finalReportPath = resolveSafePathWithinRoot(params.outDir, 'blender_report.json');
  const finalVrmPath = resolveSafePathWithinRoot(params.outDir, 'character_blender.vrm');
  const finalBlendPath = resolveSafePathWithinRoot(params.outDir, 'character_blender.blend');
  fs.rmSync(finalReportPath, { force: true });

  const args = [
    '--background',
    '--python',
    pipelineScript,
    '--',
    '--glb-path',
    params.glbPath,
    '--out-dir',
    isolatedRunDir,
    '--vrm-version',
    params.vrmVersion,
    '--run-id',
    runId,
  ];
  if (params.specJsonPath) {
    args.push('--spec-json', params.specJsonPath);
  }

  const timeoutMs = params.timeoutMs ?? 120000;

  try {
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
          runId,
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
          runId,
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
          runId,
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
        const runReportPath = resolveSafePathWithinRoot(isolatedRunDir, 'blender_report.json');
        const runVrmPath = resolveSafePathWithinRoot(isolatedRunDir, 'character_blender.vrm');
        const runBlendPath = resolveSafePathWithinRoot(isolatedRunDir, 'character_blender.blend');

        let report: BlenderReportJson | undefined;
        if (fs.existsSync(runReportPath)) {
          try {
            report = JSON.parse(fs.readFileSync(runReportPath, 'utf8')) as BlenderReportJson;
          } catch {
            report = undefined;
          }
        }

        const vrmExists = fs.existsSync(runVrmPath) && fs.statSync(runVrmPath).size > 0;
        let vrmBuffer: Uint8Array | undefined;
        let verifyError: string | undefined;

        if (code !== 0) {
          verifyError =
            report?.vrm_note ||
            `Blender exited with code ${code}${stderr ? `: ${stderr.slice(0, 220)}` : ''}`;
        } else if (!report || report.status !== 'ok') {
          verifyError = report?.vrm_note || 'Blender report missing or status != ok.';
        } else if (report.run_id !== runId) {
          verifyError = `Stale or mismatched Blender report run_id (expected ${runId}, got ${report.run_id ?? 'none'}).`;
        } else if (!report.python_validator_available) {
          verifyError = report.vrm_note || 'Independent Python vrm_validator was not executed.';
        } else if (!report.vrm_export_success || !report.vrm_reload_success || !vrmExists) {
          verifyError = report.vrm_note || 'Blender did not complete VRM export & reload verification.';
        } else {
          const rawBuf = new Uint8Array(fs.readFileSync(runVrmPath));
          const actualSha = crypto.createHash('sha256').update(rawBuf).digest('hex');
          if (report.output_vrm_size !== undefined && report.output_vrm_size !== rawBuf.byteLength) {
            verifyError = `Exported VRM size mismatch (report=${report.output_vrm_size}, actual=${rawBuf.byteLength}).`;
          } else if (report.output_vrm_sha256 && report.output_vrm_sha256 !== actualSha) {
            verifyError = `Exported VRM SHA-256 mismatch (report=${report.output_vrm_sha256}, actual=${actualSha}).`;
          } else {
            const tsValidation = validateVrmBinary(rawBuf, params.vrmVersion);
            if (!tsValidation.valid) {
              verifyError = `Exported VRM failed independent TS validation: ${tsValidation.checks
                .filter((c) => c.status === 'fail')
                .map((c) => c.detail)
                .join('; ')}`;
            } else {
              vrmBuffer = rawBuf;
            }
          }
        }

        const succeeded = Boolean(!verifyError && vrmBuffer);
        if (succeeded && vrmBuffer) {
          fs.writeFileSync(finalVrmPath, vrmBuffer);
          if (fs.existsSync(runBlendPath)) {
            fs.copyFileSync(runBlendPath, finalBlendPath);
          }
          if (fs.existsSync(runReportPath)) {
            fs.copyFileSync(runReportPath, finalReportPath);
          }
        }

        finish({
          attempted: true,
          succeeded,
          runId,
          durationMs,
          blenderVersion: detection.version,
          vrmAddonInstalled: detection.vrmAddonDetected,
          vrmBuffer,
          report,
          stdout,
          stderr,
          reason: verifyError,
        });
      });
    });
  } finally {
    fs.rmSync(isolatedRunDir, { recursive: true, force: true });
    const runsParent = resolveSafePathWithinRoot(params.outDir, '_blender_runs');
    try {
      if (fs.existsSync(runsParent) && fs.readdirSync(runsParent).length === 0) {
        fs.rmdirSync(runsParent);
      }
    } catch {
      // Ignore cleanup race
    }
  }
}
