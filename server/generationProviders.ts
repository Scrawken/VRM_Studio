import { CharacterSpecification } from '../src/shared/types';
import { ParsedGlbAsset, parseAndValidateGlbAsset } from './glbImporter';
import { detectBlenderInstallation } from './systemProbe';

export interface VisualDesignPlan {
  artStyleLabel: string;
  silhouetteNote: string;
  facialSculptNote: string;
  hairLayeringNote: string;
  clothingAndArmorNote: string;
  materialCalibrationNote: string;
}

export function buildVisualDesignPlan(spec: CharacterSpecification): VisualDesignPlan {
  const artStyleLabel =
    spec.artStyle === 'stylized_anime'
      ? 'Stylized Anime Proportions & Clean Shading'
      : spec.artStyle === 'realistic_human'
        ? 'Anatomically Realistic Humanoid Proportions'
        : 'Semi-Realistic Fantasy Character Design';

  const silhouetteNote = `${spec.build} physique (${spec.proportions.heightMeters.toFixed(2)}m, shoulder ${spec.proportions.shoulderWidthScale.toFixed(2)}x, hip ${spec.proportions.hipWidthScale.toFixed(2)}x) with spinal S-curve, pectoral/clavicle contours, and anatomical calf/quad musculature.`;

  const facialSculptNote = `Recessed orbital sockets, sculpted brow ridge, zygomatic cheekbones, nose bridge & nostrils, philtrum, dual-contour lips, tapered jawline, and ${spec.features.earStyle.replace(/_/g, ' ')} ears.`;

  const hairLayeringNote = `Fitted cranial scalp cap + parted forehead sweeps, cheekbone-framing side locks, and Catmull-Rom V-profile ${spec.hairStyle.replace(/_/g, ' ')} strands.`;

  const layers: string[] = [spec.outfitStyle.replace(/_/g, ' ')];
  if (spec.features.hasArmor) layers.push('contoured cuirass + layered pauldrons + vambraces');
  if (spec.features.hasCloak) layers.push('pleated shoulder-mantle cloak');
  if (spec.features.hasWings) layers.push('7-feather articulated wings');
  if (spec.features.hasHorns) layers.push('swept cranial horns');
  const clothingAndArmorNote = layers.join(' · ');

  const materialCalibrationNote =
    spec.artStyle === 'stylized_anime'
      ? 'Soft skin roughness (0.74), low-amplitude facial normal map, crisp anisotropic hair sheen.'
      : spec.artStyle === 'realistic_human'
        ? 'Micro-pore skin normal map (0.56 roughness), subtle subsurface warmth, calibrated metallic/cloth weave.'
        : 'Balanced semi-realistic PBR roughness with normal-mapped armor seams, hair strands, and herringbone fabric.';

  return {
    artStyleLabel,
    silhouetteNote,
    facialSculptNote,
    hairLayeringNote,
    clothingAndArmorNote,
    materialCalibrationNote,
  };
}

export interface ProviderRuntimeRecord {
  state: 'ready' | 'unverified_key' | 'verified_live' | 'failed' | 'unconfigured';
  lastCheckedAt: string;
  lastError?: string;
}

const providerTelemetry = new Map<string, ProviderRuntimeRecord>();

export function getProviderRuntimeRecord(providerId: string): ProviderRuntimeRecord | undefined {
  return providerTelemetry.get(providerId);
}

function recordProviderOutcome(
  providerId: string,
  state: ProviderRuntimeRecord['state'],
  lastError?: string
) {
  providerTelemetry.set(providerId, {
    state,
    lastCheckedAt: new Date().toISOString(),
    lastError,
  });
}

export function buildExternalGenerationPrompt(spec: CharacterSpecification): string {
  const excluded = spec.constraints?.forbiddenFeatures.length
    ? ` Strictly exclude: ${spec.constraints.forbiddenFeatures.join(', ')}.`
    : '';
  return `${spec.sourcePrompt} (A-pose/T-pose full-body humanoid 3D character, ${spec.artStyle.replace(/_/g, ' ')} style, single cohesive character mesh).${excluded}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadAndValidateGlb(
  assetUrl: string,
  headers?: Record<string, string>,
  timeoutMs = 30000
): Promise<{ glbBuffer: Uint8Array; parsed: ParsedGlbAsset }> {
  const res = await fetch(assetUrl, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Asset download failed with HTTP ${res.status}`);
  }
  const arr = await res.arrayBuffer();
  const glbBuffer = new Uint8Array(arr);
  const parsed = parseAndValidateGlbAsset(glbBuffer);
  if (!parsed.valid) {
    throw new Error(`Downloaded asset is not a valid GLB mesh: ${parsed.error}`);
  }
  return { glbBuffer, parsed };
}

export interface ExternalProviderOptions {
  tripoBaseUrl?: string;
  meshyBaseUrl?: string;
  local3dUrl?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

export interface GeometryAdapterResult {
  requestedProvider: string;
  executedProvider: string;
  usedFallback: boolean;
  externalGenerationSucceeded: boolean;
  fallbackReason?: string;
  externalTaskId?: string;
  externalGlbBuffer?: Uint8Array;
  externalParsedMesh?: ParsedGlbAsset;
  detail: string;
}

async function runTripoTextTo3D(
  spec: CharacterSpecification,
  apiKey: string,
  opts?: ExternalProviderOptions
): Promise<{ taskId: string; glbBuffer: Uint8Array; parsed: ParsedGlbAsset }> {
  const baseUrl = (opts?.tripoBaseUrl || process.env.TRIPO_API_BASE_URL || 'https://api.tripo3d.ai/v2/openapi').replace(/\/$/, '');
  const pollMs = opts?.pollIntervalMs ?? 2500;
  const maxPolls = opts?.maxPollAttempts ?? 40;

  const createRes = await fetch(`${baseUrl}/task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      type: 'text_to_model',
      prompt: buildExternalGenerationPrompt(spec),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '');
    throw new Error(`Tripo task creation failed (HTTP ${createRes.status}): ${errText.slice(0, 180)}`);
  }
  const createJson = (await createRes.json()) as {
    code?: number;
    data?: { task_id?: string };
    message?: string;
  };
  const taskId = createJson.data?.task_id;
  if (!taskId) {
    throw new Error(`Tripo API did not return a task_id (${createJson.message || 'unknown error'}).`);
  }

  let glbUrl: string | undefined;
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    if (attempt > 0) await sleep(pollMs);
    const pollRes = await fetch(`${baseUrl}/task/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!pollRes.ok) {
      throw new Error(`Tripo task polling failed (HTTP ${pollRes.status}).`);
    }
    const pollJson = (await pollRes.json()) as {
      data?: {
        status?: string;
        output?: { pbr_model?: string; model?: string; base_model?: string };
      };
    };
    const status = pollJson.data?.status;
    if (status === 'success') {
      glbUrl =
        pollJson.data?.output?.pbr_model ||
        pollJson.data?.output?.model ||
        pollJson.data?.output?.base_model;
      if (!glbUrl) {
        throw new Error('Tripo task succeeded but output contained no GLB model URL.');
      }
      break;
    }
    if (status === 'failed' || status === 'cancelled' || status === 'banned' || status === 'expired') {
      throw new Error(`Tripo generation task ended with status "${status}".`);
    }
  }

  if (!glbUrl) {
    throw new Error(`Tripo task ${taskId} timed out before producing a GLB asset.`);
  }

  const downloaded = await downloadAndValidateGlb(glbUrl);
  return { taskId, ...downloaded };
}

async function runMeshyTextTo3D(
  spec: CharacterSpecification,
  apiKey: string,
  opts?: ExternalProviderOptions
): Promise<{ taskId: string; glbBuffer: Uint8Array; parsed: ParsedGlbAsset }> {
  const baseUrl = (opts?.meshyBaseUrl || process.env.MESHY_API_BASE_URL || 'https://api.meshy.ai/openapi/v2').replace(/\/$/, '');
  const pollMs = opts?.pollIntervalMs ?? 2500;
  const maxPolls = opts?.maxPollAttempts ?? 40;

  const createRes = await fetch(`${baseUrl}/text-to-3d`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      mode: 'preview',
      prompt: buildExternalGenerationPrompt(spec),
      art_style: spec.artStyle === 'stylized_anime' ? 'sculpture' : 'realistic',
      should_remesh: true,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '');
    throw new Error(`Meshy task creation failed (HTTP ${createRes.status}): ${errText.slice(0, 180)}`);
  }
  const createJson = (await createRes.json()) as { result?: string; id?: string; message?: string };
  const taskId = createJson.result || createJson.id;
  if (!taskId) {
    throw new Error(`Meshy API did not return a task ID (${createJson.message || 'unknown error'}).`);
  }

  let glbUrl: string | undefined;
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    if (attempt > 0) await sleep(pollMs);
    const pollRes = await fetch(`${baseUrl}/text-to-3d/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!pollRes.ok) {
      throw new Error(`Meshy task polling failed (HTTP ${pollRes.status}).`);
    }
    const pollJson = (await pollRes.json()) as {
      status?: string;
      model_urls?: { glb?: string };
      task_error?: { message?: string };
    };
    if (pollJson.status === 'SUCCEEDED') {
      glbUrl = pollJson.model_urls?.glb;
      if (!glbUrl) {
        throw new Error('Meshy task succeeded but model_urls.glb was missing.');
      }
      break;
    }
    if (pollJson.status === 'FAILED' || pollJson.status === 'EXPIRED') {
      throw new Error(
        `Meshy task ended with status "${pollJson.status}": ${pollJson.task_error?.message || 'no error detail'}`
      );
    }
  }

  if (!glbUrl) {
    throw new Error(`Meshy task ${taskId} timed out before producing a GLB asset.`);
  }

  const downloaded = await downloadAndValidateGlb(glbUrl);
  return { taskId, ...downloaded };
}

async function runLocal3dGeneration(
  spec: CharacterSpecification,
  localUrl: string,
  opts?: ExternalProviderOptions
): Promise<{ taskId: string; glbBuffer: Uint8Array; parsed: ParsedGlbAsset }> {
  const baseUrl = localUrl.replace(/\/$/, '');
  const pollMs = opts?.pollIntervalMs ?? 1500;
  const maxPolls = opts?.maxPollAttempts ?? 30;

  const genRes = await fetch(`${baseUrl}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: buildExternalGenerationPrompt(spec),
      artStyle: spec.artStyle,
      heightMeters: spec.proportions.heightMeters,
      format: 'glb',
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!genRes.ok) {
    const errText = await genRes.text().catch(() => '');
    throw new Error(`Local 3D /generate failed (HTTP ${genRes.status}): ${errText.slice(0, 180)}`);
  }

  const contentType = (genRes.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('model/gltf-binary') || contentType.includes('application/octet-stream')) {
    const glbBuffer = new Uint8Array(await genRes.arrayBuffer());
    const parsed = parseAndValidateGlbAsset(glbBuffer);
    if (!parsed.valid) {
      throw new Error(`Local 3D returned invalid GLB binary: ${parsed.error}`);
    }
    return { taskId: `local_sync_${Date.now().toString(36)}`, glbBuffer, parsed };
  }

  const payload = (await genRes.json()) as {
    jobId?: string;
    task_id?: string;
    glbBase64?: string;
    downloadUrl?: string;
    glbUrl?: string;
  };

  if (payload.glbBase64) {
    const glbBuffer = new Uint8Array(Buffer.from(payload.glbBase64, 'base64'));
    const parsed = parseAndValidateGlbAsset(glbBuffer);
    if (!parsed.valid) {
      throw new Error(`Local 3D base64 payload invalid: ${parsed.error}`);
    }
    return { taskId: payload.jobId || 'local_b64', glbBuffer, parsed };
  }

  const directUrl = payload.downloadUrl || payload.glbUrl;
  if (directUrl) {
    const resolved = directUrl.startsWith('http') ? directUrl : `${baseUrl}${directUrl.startsWith('/') ? '' : '/'}${directUrl}`;
    const downloaded = await downloadAndValidateGlb(resolved);
    return { taskId: payload.jobId || 'local_url', ...downloaded };
  }

  const jobId = payload.jobId || payload.task_id;
  if (!jobId) {
    throw new Error('Local 3D /generate returned neither GLB data nor a jobId to poll.');
  }

  for (let attempt = 0; attempt < maxPolls; attempt++) {
    if (attempt > 0) await sleep(pollMs);
    const statusRes = await fetch(`${baseUrl}/jobs/${encodeURIComponent(jobId)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!statusRes.ok) {
      throw new Error(`Local 3D job poll failed (HTTP ${statusRes.status}).`);
    }
    const statusJson = (await statusRes.json()) as {
      status?: string;
      downloadUrl?: string;
      glbUrl?: string;
      error?: string;
    };
    const st = (statusJson.status || '').toLowerCase();
    if (st === 'completed' || st === 'succeeded' || st === 'success') {
      const url = statusJson.downloadUrl || statusJson.glbUrl;
      if (!url) {
        throw new Error('Local 3D job completed without a downloadUrl.');
      }
      const resolved = url.startsWith('http') ? url : `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
      const downloaded = await downloadAndValidateGlb(resolved);
      return { taskId: jobId, ...downloaded };
    }
    if (st === 'failed' || st === 'error') {
      throw new Error(`Local 3D job failed: ${statusJson.error || 'unknown error'}`);
    }
  }

  throw new Error(`Local 3D job ${jobId} timed out.`);
}

export async function resolveGeometryProviderExecution(
  spec: CharacterSpecification,
  requestedProvider: string,
  opts?: ExternalProviderOptions
): Promise<GeometryAdapterResult> {
  const provider = requestedProvider || 'sculpted-anatomical-vrm';

  if (provider === 'tripo-ai-adapter') {
    const key = process.env.TRIPO_API_KEY;
    if (!key) {
      const reason = 'TRIPO_API_KEY not configured.';
      recordProviderOutcome(provider, 'unconfigured', reason);
      return {
        requestedProvider: provider,
        executedProvider: 'sculpted-anatomical-vrm',
        usedFallback: true,
        externalGenerationSucceeded: false,
        fallbackReason: reason,
        detail: `${reason} Fell back to High-Detail Sculpted Anatomical VRM Engine.`,
      };
    }
    try {
      const result = await runTripoTextTo3D(spec, key, opts);
      recordProviderOutcome(provider, 'verified_live');
      return {
        requestedProvider: provider,
        executedProvider: 'tripo-ai-adapter',
        usedFallback: false,
        externalGenerationSucceeded: true,
        externalTaskId: result.taskId,
        externalGlbBuffer: result.glbBuffer,
        externalParsedMesh: result.parsed,
        detail: `Tripo AI task ${result.taskId} succeeded; imported ${result.parsed.triangleCount.toLocaleString()}-tri GLB into VRM 1.0 humanoid rig.`,
      };
    } catch (err) {
      const reason = (err as Error).message;
      recordProviderOutcome(provider, 'failed', reason);
      return {
        requestedProvider: provider,
        executedProvider: 'sculpted-anatomical-vrm',
        usedFallback: true,
        externalGenerationSucceeded: false,
        fallbackReason: reason,
        detail: `Tripo AI generation failed (${reason}). Fell back to High-Detail Sculpted Anatomical VRM Engine.`,
      };
    }
  }

  if (provider === 'meshy-ai-adapter') {
    const key = process.env.MESHY_API_KEY;
    if (!key) {
      const reason = 'MESHY_API_KEY not configured.';
      recordProviderOutcome(provider, 'unconfigured', reason);
      return {
        requestedProvider: provider,
        executedProvider: 'sculpted-anatomical-vrm',
        usedFallback: true,
        externalGenerationSucceeded: false,
        fallbackReason: reason,
        detail: `${reason} Fell back to High-Detail Sculpted Anatomical VRM Engine.`,
      };
    }
    try {
      const result = await runMeshyTextTo3D(spec, key, opts);
      recordProviderOutcome(provider, 'verified_live');
      return {
        requestedProvider: provider,
        executedProvider: 'meshy-ai-adapter',
        usedFallback: false,
        externalGenerationSucceeded: true,
        externalTaskId: result.taskId,
        externalGlbBuffer: result.glbBuffer,
        externalParsedMesh: result.parsed,
        detail: `Meshy AI task ${result.taskId} succeeded; imported ${result.parsed.triangleCount.toLocaleString()}-tri GLB into VRM 1.0 humanoid rig.`,
      };
    } catch (err) {
      const reason = (err as Error).message;
      recordProviderOutcome(provider, 'failed', reason);
      return {
        requestedProvider: provider,
        executedProvider: 'sculpted-anatomical-vrm',
        usedFallback: true,
        externalGenerationSucceeded: false,
        fallbackReason: reason,
        detail: `Meshy AI generation failed (${reason}). Fell back to High-Detail Sculpted Anatomical VRM Engine.`,
      };
    }
  }

  if (provider === 'local-triposr-instantmesh') {
    const localUrl = opts?.local3dUrl || process.env.LOCAL_3D_URL;
    if (!localUrl) {
      const reason = 'LOCAL_3D_URL is not configured.';
      recordProviderOutcome(provider, 'unconfigured', reason);
      return {
        requestedProvider: provider,
        executedProvider: 'sculpted-anatomical-vrm',
        usedFallback: true,
        externalGenerationSucceeded: false,
        fallbackReason: reason,
        detail: `${reason} Fell back to High-Detail Sculpted Anatomical VRM Engine.`,
      };
    }
    try {
      const result = await runLocal3dGeneration(spec, localUrl, opts);
      recordProviderOutcome(provider, 'verified_live');
      return {
        requestedProvider: provider,
        executedProvider: 'local-triposr-instantmesh',
        usedFallback: false,
        externalGenerationSucceeded: true,
        externalTaskId: result.taskId,
        externalGlbBuffer: result.glbBuffer,
        externalParsedMesh: result.parsed,
        detail: `Local TripoSR/InstantMesh job ${result.taskId} succeeded; imported ${result.parsed.triangleCount.toLocaleString()}-tri GLB into VRM 1.0 humanoid rig.`,
      };
    } catch (err) {
      const reason = (err as Error).message;
      recordProviderOutcome(provider, 'failed', reason);
      return {
        requestedProvider: provider,
        executedProvider: 'sculpted-anatomical-vrm',
        usedFallback: true,
        externalGenerationSucceeded: false,
        fallbackReason: reason,
        detail: `Local 3D generation failed (${reason}). Fell back to High-Detail Sculpted Anatomical VRM Engine.`,
      };
    }
  }

  if (provider === 'blender-bpy-bridge') {
    const blender = detectBlenderInstallation();
    const eligible = blender.installed && blender.vrmAddonDetected;
    return {
      requestedProvider: provider,
      executedProvider: eligible ? 'blender-bpy-bridge' : 'sculpted-anatomical-vrm',
      usedFallback: !eligible,
      externalGenerationSucceeded: false,
      fallbackReason: eligible
        ? undefined
        : blender.installed
          ? `${blender.version} detected without VRM_Addon_for_Blender; falling back to TypeScript VRM synthesis.`
          : 'Blender executable not detected on host; using TypeScript VRM synthesis + generated bpy script.',
      detail: eligible
        ? `${blender.version} + VRM Add-on detected; base geometry prepared for live headless Blender execution.`
        : blender.installed
          ? `${blender.version} detected without VRM Add-on; using TypeScript VRM synthesis + generated bpy script.`
          : 'Blender executable not detected on host; using TypeScript VRM synthesis + generated bpy script.',
    };
  }

  return {
    requestedProvider: provider,
    executedProvider: 'sculpted-anatomical-vrm',
    usedFallback: false,
    externalGenerationSucceeded: false,
    detail: `High-Detail Sculpted Anatomical VRM Engine (${spec.qualityConfig.geometryQuality} quality, ${spec.artStyle.replace(/_/g, ' ')}).`,
  };
}
