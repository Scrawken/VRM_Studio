import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BlenderDetectionResult,
  HardwareCapabilities,
  ProviderStatus,
} from '../src/shared/types';
import { getProviderRuntimeRecord } from './generationProviders';
import { validateBlenderExecutablePath } from './security';

function getProjectsRootDir(): string {
  return path.resolve(process.env.VRM_FORGE_PROJECTS_DIR || path.join(process.cwd(), 'projects'));
}

function getBlenderConfigPath(): string {
  return path.join(getProjectsRootDir(), '_blender_config.json');
}

export function getSavedBlenderExecutablePath(): string | null {
  try {
    const cfgPath = getBlenderConfigPath();
    if (!fs.existsSync(cfgPath)) return null;
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { executablePath?: string };
    if (!raw.executablePath) return null;
    const check = validateBlenderExecutablePath(raw.executablePath, {
      allowCustomFolderIfVerified: true,
      requireExistingFile: true,
    });
    return check.valid && check.normalizedPath ? check.normalizedPath : null;
  } catch {
    return null;
  }
}

export function configureBlenderExecutablePath(
  candidatePath: string,
  options?: { allowCustomFolderFromDesktopPicker?: boolean }
): BlenderDetectionResult {
  const check = validateBlenderExecutablePath(candidatePath, {
    allowCustomFolderIfVerified: Boolean(options?.allowCustomFolderFromDesktopPicker),
    requireExistingFile: true,
  });
  if (!check.valid || !check.normalizedPath) {
    return {
      installed: false,
      executablePath: null,
      version: null,
      vrmAddonDetected: false,
      platform: `${os.platform()} ${os.arch()}`,
      searchedPaths: [],
      statusMessage: check.reason || 'Blender executable path rejected by security policy.',
    };
  }

  try {
    const output = execFileSync(check.normalizedPath, ['--version'], {
      timeout: 5000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const firstLine = output.split(/\r?\n/)[0]?.trim() || '';
    if (!/^Blender\s+\d+\.\d+/i.test(firstLine)) {
      return {
        installed: false,
        executablePath: null,
        version: null,
        vrmAddonDetected: false,
        platform: `${os.platform()} ${os.arch()}`,
        searchedPaths: [check.normalizedPath],
        statusMessage: 'Selected binary did not identify itself as Blender via --version.',
      };
    }

    const root = getProjectsRootDir();
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      getBlenderConfigPath(),
      JSON.stringify(
        {
          executablePath: check.normalizedPath,
          version: firstLine,
          verifiedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    const vrmAddonDetected = probeBlenderVrmAddon(check.normalizedPath);
    return {
      installed: true,
      executablePath: check.normalizedPath,
      version: firstLine,
      vrmAddonDetected,
      platform: `${os.platform()} ${os.arch()}`,
      searchedPaths: [check.normalizedPath],
      statusMessage: `Verified ${firstLine} at ${check.normalizedPath}${vrmAddonDetected ? ' (VRM Add-on detected)' : ' (VRM Add-on not detected)'}`,
    };
  } catch (err) {
    return {
      installed: false,
      executablePath: null,
      version: null,
      vrmAddonDetected: false,
      platform: `${os.platform()} ${os.arch()}`,
      searchedPaths: [check.normalizedPath],
      statusMessage: `Failed to verify Blender executable: ${(err as Error).message}`,
    };
  }
}

function getCandidateBlenderPaths(): string[] {
  const candidates: string[] = [];
  const saved = getSavedBlenderExecutablePath();
  if (saved) candidates.push(saved);

  const envExec = process.env.BLENDER_EXECUTABLE?.trim();
  if (envExec) {
    const check = validateBlenderExecutablePath(envExec, {
      allowCustomFolderIfVerified: true,
      requireExistingFile: true,
    });
    if (check.valid && check.normalizedPath) {
      candidates.push(check.normalizedPath);
    }
  }

  const platform = os.platform();
  if (platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    // 4.2 is the acceptance target; newer builds work via BLENDER_EXECUTABLE or the desktop picker.
    const versions = ['4.2', '5.2', '5.1', '5.0', '4.5', '4.4', '4.3', '4.1', '4.0', '3.6'];
    for (const v of versions) {
      candidates.push(path.join(pf, 'Blender Foundation', `Blender ${v}`, 'blender.exe'));
      candidates.push(path.join(pf86, 'Blender Foundation', `Blender ${v}`, 'blender.exe'));
    }
    return Array.from(new Set(candidates));
  }
  if (platform === 'darwin') {
    return Array.from(
      new Set([
        ...candidates,
        '/Applications/Blender.app/Contents/MacOS/Blender',
        '/usr/local/bin/blender',
      ])
    );
  }
  return Array.from(
    new Set([...candidates, '/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender'])
  );
}

function probeBlenderVrmAddon(executablePath: string): boolean {
  // Registration check lives in blender_scripts/vrm_addon_probe.py. hasattr(bpy.ops.export_scene, "vrm")
  // is always true (bpy.ops resolves names lazily), so only a registered Armature
  // `vrm_addon_extension` property counts. The add-on is enabled non-persistently, as the pipeline does.
  const scriptsDir = path.resolve(
    process.env.VRM_FORGE_BLENDER_SCRIPTS_DIR || path.join(process.cwd(), 'blender_scripts')
  );
  const probeScript = path.join(scriptsDir, 'vrm_addon_probe.py');
  if (!fs.existsSync(probeScript)) return false;
  try {
    const out = execFileSync(
      executablePath,
      ['--background', '--python', probeScript],
      { timeout: 30000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return out.includes('VRM_ADDON=True');
  } catch {
    return false;
  }
}

export function detectBlenderInstallation(): BlenderDetectionResult {
  const platform = `${os.platform()} ${os.arch()}`;
  const candidates = getCandidateBlenderPaths();
  const searchedPaths: string[] = [];

  for (const candidate of candidates) {
    searchedPaths.push(candidate);
    try {
      if (!fs.existsSync(candidate)) {
        continue;
      }
      const output = execFileSync(candidate, ['--version'], {
        timeout: 4000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const versionLine = output.split(/\r?\n/)[0]?.trim() || '';
      if (!/^Blender\s+\d+\.\d+/i.test(versionLine)) {
        continue;
      }
      const vrmAddonDetected = probeBlenderVrmAddon(candidate);
      return {
        installed: true,
        executablePath: candidate,
        version: versionLine,
        vrmAddonDetected,
        platform,
        searchedPaths,
        statusMessage: `Detected ${versionLine} at ${candidate}${vrmAddonDetected ? ' (VRM Add-on detected)' : ' (VRM Add-on not detected)'}`,
      };
    } catch {
      // Continue checking remaining candidate paths
    }
  }

  return {
    installed: false,
    executablePath: null,
    version: null,
    vrmAddonDetected: false,
    platform,
    searchedPaths,
    statusMessage:
      'Blender executable not found on this host. Generated bpy scripts & TypeScript VRM 0.0/1.0 synthesis remain active as fallback; install Blender 4.2 (supported target), or set BLENDER_EXECUTABLE / choose blender.exe via the desktop picker to use a newer build.',
  };
}

export function probeHardwareCapabilities(): HardwareCapabilities {
  const cpus = os.cpus();
  const totalRamGb = Number((os.totalmem() / 1024 ** 3).toFixed(1));
  const freeRamGb = Number((os.freemem() / 1024 ** 3).toFixed(1));

  const notes: string[] = [];
  let local3dFeasibility: HardwareCapabilities['local3dFeasibility'] = 'cloud_preferred';
  let recommendedLocalLlm = 'Ollama llama3.2:3b / qwen2.5:7b (CPU/8GB+)';

  if (totalRamGb >= 32) {
    local3dFeasibility = 'recommended';
    recommendedLocalLlm = 'Ollama qwen2.5:14b + Local TripoSR / InstantMesh';
    notes.push('System RAM >= 32 GB supports local LLM interpretation and Blender background builds.');
  } else if (totalRamGb >= 16) {
    local3dFeasibility = 'limited';
    recommendedLocalLlm = 'Ollama qwen2.5:7b (4-bit quantized)';
    notes.push('16 GB RAM supports local LLM + procedural Blender rigging; cloud text-to-3D recommended for heavy sculpting.');
  } else {
    local3dFeasibility = 'cloud_preferred';
    recommendedLocalLlm = 'Ollama llama3.2:3b or Hybrid Cloud Gemini';
    notes.push('Host RAM below 16 GB; Hybrid Mode (Cloud AI + Local Blender/VRM assembly) gives the fastest turnaround.');
  }

  notes.push('Express backend binds strictly to 127.0.0.1 loopback for desktop and web security.');

  return {
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() || 'Unknown CPU',
    cpuCores: cpus.length,
    totalRamGb,
    freeRamGb,
    gpuSummary: 'Host Sandbox / Software WebGL (Windows desktop queries DXGI/CUDA VRAM)',
    recommendedMode: 'hybrid',
    recommendedLocalLlm,
    local3dFeasibility,
    notes,
  };
}

export function listProviderStatuses(blender: BlenderDetectionResult): ProviderStatus[] {
  const hasGemini = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
  );
  const hasTripo = Boolean(process.env.TRIPO_API_KEY);
  const hasMeshy = Boolean(process.env.MESHY_API_KEY);
  const hasLocal3d = Boolean(process.env.LOCAL_3D_URL);
  const hasOllama = Boolean(process.env.OLLAMA_HOST);

  const tripoRec = getProviderRuntimeRecord('tripo-ai-adapter');
  const meshyRec = getProviderRuntimeRecord('meshy-ai-adapter');
  const local3dRec = getProviderRuntimeRecord('local-triposr-instantmesh');

  const resolveExternalState = (
    configured: boolean,
    rec: ReturnType<typeof getProviderRuntimeRecord>
  ): {
    available: boolean;
    capabilityState: ProviderStatus['capabilityState'];
    verificationNote: string;
  } => {
    if (!configured) {
      return {
        available: false,
        capabilityState: 'unconfigured',
        verificationNote: 'Credentials / endpoint URL not configured.',
      };
    }
    if (rec?.state === 'verified_live') {
      return {
        available: true,
        capabilityState: 'verified_live',
        verificationNote: `Verified via live 3D generation & GLB download at ${rec.lastCheckedAt}.`,
      };
    }
    if (rec?.state === 'failed') {
      return {
        available: false,
        capabilityState: 'failed',
        verificationNote: `Last generation attempt failed: ${rec.lastError || 'unknown error'}`,
      };
    }
    return {
      available: false,
      capabilityState: 'unverified_key',
      verificationNote:
        'Credentials or URL present; live task creation & GLB download not yet verified in this session.',
    };
  };

  const tripoState = resolveExternalState(hasTripo, tripoRec);
  const meshyState = resolveExternalState(hasMeshy, meshyRec);
  const local3dState = resolveExternalState(hasLocal3d, local3dRec);

  return [
    {
      id: 'gemini-4-hydrogen',
      name: 'Gemini 4 Hydrogen (Structured JSON)',
      category: 'interpreter',
      modeSupport: ['hybrid', 'cloud'],
      configured: hasGemini,
      available: hasGemini,
      capabilityState: hasGemini ? 'ready' : 'unconfigured',
      verificationNote: hasGemini
        ? 'API key configured for structured CharacterSpecification extraction.'
        : 'Set GEMINI_API_KEY in environment to enable Gemini interpretation.',
      costModel: 'Pay-per-token API (AI Studio / Google Cloud)',
      description: 'Converts natural-language character prompts into strict CharacterSpecification JSON.',
    },
    {
      id: 'local-semantic-parser',
      name: 'Local Semantic Character Parser',
      category: 'interpreter',
      modeSupport: ['local', 'hybrid', 'cloud'],
      configured: true,
      available: true,
      capabilityState: 'verified_live',
      verificationNote: 'Built-in deterministic constraint & trait parser active.',
      costModel: 'Free / 100% Offline',
      description: 'Deterministic zero-latency trait, palette, proportion, art-style, and negative-constraint extractor.',
    },
    {
      id: 'ollama-local-llm',
      name: 'Ollama Local LLM Adapter',
      category: 'interpreter',
      modeSupport: ['local', 'hybrid'],
      configured: hasOllama,
      available: hasOllama,
      capabilityState: hasOllama ? 'unverified_key' : 'unconfigured',
      verificationNote: hasOllama
        ? `Endpoint set (${process.env.OLLAMA_HOST}); verified on first generation.`
        : 'Set OLLAMA_HOST to enable local Ollama JSON extraction.',
      costModel: 'Free / Local Hardware',
      description: 'Connects to http://127.0.0.1:11434 for offline Qwen/Llama structured JSON specs.',
    },
    {
      id: 'sculpted-anatomical-vrm',
      name: 'High-Detail Sculpted Anatomical VRM Engine',
      category: 'geometry',
      modeSupport: ['local', 'hybrid', 'cloud'],
      configured: true,
      available: true,
      capabilityState: 'verified_live',
      verificationNote: 'Built-in sculpted anatomical mesh & VRM 0.0 / 1.0 synthesis verified.',
      costModel: 'Free / Built-in Engine',
      description: 'Synthesizes sculpted cranio-facial topology, recessed eye sockets, Catmull-Rom curved hair ribbons, contoured armor/clothing, PBR normal maps, 65 VRM bones, and 17 morph targets.',
    },
    {
      id: 'tripo-ai-adapter',
      name: 'Tripo AI Text-to-3D Adapter',
      category: 'geometry',
      modeSupport: ['cloud', 'hybrid'],
      configured: hasTripo,
      available: tripoState.available,
      capabilityState: tripoState.capabilityState,
      verificationNote: tripoState.verificationNote,
      costModel: 'Commercial Credit API (TRIPO_API_KEY)',
      description: 'Submits real text-to-3D tasks, polls completion, downloads GLB, and binds into a VRM 0.0/1.0 humanoid rig.',
    },
    {
      id: 'meshy-ai-adapter',
      name: 'Meshy AI Text-to-3D Adapter',
      category: 'geometry',
      modeSupport: ['cloud', 'hybrid'],
      configured: hasMeshy,
      available: meshyState.available,
      capabilityState: meshyState.capabilityState,
      verificationNote: meshyState.verificationNote,
      costModel: 'Commercial Credit API (MESHY_API_KEY)',
      description: 'Submits real Meshy preview tasks, polls completion, downloads GLB, and binds into a VRM 0.0/1.0 humanoid rig.',
    },
    {
      id: 'local-triposr-instantmesh',
      name: 'Local TripoSR / InstantMesh Daemon',
      category: 'geometry',
      modeSupport: ['local', 'hybrid'],
      configured: hasLocal3d,
      available: local3dState.available,
      capabilityState: local3dState.capabilityState,
      verificationNote: local3dState.verificationNote,
      costModel: 'Free / Local GPU (LOCAL_3D_URL)',
      description: 'Submits POST /generate requests to a local TripoSR/InstantMesh daemon and imports returned GLB geometry.',
    },
    {
      id: 'blender-bpy-bridge',
      name: 'Blender Background bpy Pipeline',
      category: 'local_runtime',
      modeSupport: ['local', 'hybrid', 'cloud'],
      configured: blender.installed,
      available: blender.installed && blender.vrmAddonDetected,
      capabilityState:
        blender.installed && blender.vrmAddonDetected
          ? 'ready'
          : blender.installed
            ? 'unverified_key'
            : 'unconfigured',
      verificationNote: blender.statusMessage,
      costModel: 'Free / GPL Local Blender',
      description: 'Imports humanoid source GLB, validates bone mapping & depsgraph deformation, and runs VRM Add-on export (VRM 0.0 primary / 1.0 optional).',
    },
  ];
}
