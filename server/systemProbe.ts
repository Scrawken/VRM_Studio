import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BlenderDetectionResult,
  HardwareCapabilities,
  ProviderStatus,
} from '../src/shared/types';

function getCandidateBlenderPaths(): string[] {
  const platform = os.platform();
  if (platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const versions = ['4.3', '4.2', '4.1', '4.0', '3.6'];
    const paths = versions.map((v) =>
      path.join(pf, 'Blender Foundation', `Blender ${v}`, 'blender.exe')
    );
    return [...paths, 'blender.exe'];
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Blender.app/Contents/MacOS/Blender',
      '/usr/local/bin/blender',
      'blender',
    ];
  }
  return [
    '/usr/bin/blender',
    '/usr/local/bin/blender',
    '/snap/bin/blender',
    'blender',
  ];
}

export function detectBlenderInstallation(customPath?: string): BlenderDetectionResult {
  const platform = `${os.platform()} ${os.arch()}`;
  const candidates = customPath?.trim()
    ? [customPath.trim(), ...getCandidateBlenderPaths()]
    : getCandidateBlenderPaths();
  const searchedPaths: string[] = [];

  for (const candidate of candidates) {
    searchedPaths.push(candidate);
    try {
      const isBareCommand = !path.isAbsolute(candidate);
      if (!isBareCommand && !fs.existsSync(candidate)) {
        continue;
      }
      const output = execFileSync(candidate, ['--version'], {
        timeout: 4000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const versionLine = output.split(/\r?\n/)[0]?.trim() || 'Blender Detected';
      return {
        installed: true,
        executablePath: candidate,
        version: versionLine,
        vrmAddonDetected: false,
        platform,
        searchedPaths,
        statusMessage: `Detected ${versionLine} at ${candidate}`,
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
      'Blender executable not found on this host. Script generation & standalone VRM 1.0 synthesis remain active; configure a local Windows/Linux Blender 3.6–4.3 path for bpy execution.',
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

  notes.push('Dedicated CUDA/DirectX GPU telemetry is queried via Windows Electron WMI/nvidia-smi on desktop launch.');

  return {
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() || 'Unknown CPU',
    cpuCores: cpus.length,
    totalRamGb,
    freeRamGb,
    gpuSummary: 'Host Sandbox / Software WebGL (Windows desktop queries DXGI/CUDA VRAM)',
    recommendedMode: totalRamGb >= 24 ? 'hybrid' : 'hybrid',
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

  return [
    {
      id: 'gemini-4-hydrogen',
      name: 'Gemini 4 Hydrogen (Structured JSON)',
      category: 'interpreter',
      modeSupport: ['hybrid', 'cloud'],
      configured: hasGemini,
      available: hasGemini,
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
      costModel: 'Free / 100% Offline',
      description: 'Deterministic zero-latency trait, palette, proportion, art-style, and anatomy extractor.',
    },
    {
      id: 'ollama-local-llm',
      name: 'Ollama Local LLM Adapter',
      category: 'interpreter',
      modeSupport: ['local', 'hybrid'],
      configured: Boolean(process.env.OLLAMA_HOST),
      available: Boolean(process.env.OLLAMA_HOST),
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
      costModel: 'Free / Built-in Engine',
      description: 'Synthesizes sculpted cranio-facial topology, recessed eye sockets, Catmull-Rom curved hair ribbons, contoured armor/clothing, PBR normal maps, 65 VRM bones, and 17 morph targets.',
    },
    {
      id: 'tripo-ai-adapter',
      name: 'Tripo AI Text-to-3D Adapter',
      category: 'geometry',
      modeSupport: ['cloud', 'hybrid'],
      configured: hasTripo,
      available: hasTripo,
      costModel: 'Commercial Credit API (TRIPO_API_KEY)',
      description: 'Modular cloud text-to-3D/image-to-3D GLB generator routed into deformation-safe VRM rigging.',
    },
    {
      id: 'meshy-ai-adapter',
      name: 'Meshy AI Text-to-3D Adapter',
      category: 'geometry',
      modeSupport: ['cloud', 'hybrid'],
      configured: hasMeshy,
      available: hasMeshy,
      costModel: 'Commercial Credit API (MESHY_API_KEY)',
      description: 'High-detail cloud character mesh adapter paired with automated VRM retopology & facial blendshapes.',
    },
    {
      id: 'local-triposr-instantmesh',
      name: 'Local TripoSR / InstantMesh Daemon',
      category: 'geometry',
      modeSupport: ['local', 'hybrid'],
      configured: hasLocal3d,
      available: hasLocal3d,
      costModel: 'Free / Local GPU (LOCAL_3D_URL)',
      description: 'Connects to a local GPU TripoSR or InstantMesh inference server for offline sculpted meshes.',
    },
    {
      id: 'blender-bpy-bridge',
      name: 'Blender Background bpy Pipeline',
      category: 'local_runtime',
      modeSupport: ['local', 'hybrid', 'cloud'],
      configured: blender.installed,
      available: blender.installed,
      costModel: 'Free / GPL Local Blender',
      description: 'Executes Subsurf, Weighted Normals, Smart UV, 1K-8K texture bake prep, .blend save, and VRM Add-on exports.',
    },
  ];
}
