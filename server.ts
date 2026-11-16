import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import {
  applyCharacterEdits,
  normalizeCharacterSpec,
  parseCharacterPromptFallback,
  validateCharacterSpecification,
} from './src/shared/characterParser';
import {
  CharacterArtStyle,
  CharacterSpecification,
  DEFAULT_CUSTOM_OPTIMIZATION,
  DEFAULT_QUALITY_CONFIG,
  GenerationMode,
  QualityConfig,
} from './src/shared/types';
import { estimateCharacterMetrics } from './src/shared/vrmBuilder';
import { validateVrmBinary } from './src/shared/vrmValidator';
import { interpretCharacterDescription } from './server/geminiInterpreter';
import { resolveGeometryProviderExecution } from './server/generationProviders';
import {
  duplicateProject,
  getProject,
  getProjectFilePath,
  getProjectsRoot,
  listProjects,
  saveProjectArtifacts,
  seedInitialProjectsIfEmpty,
} from './server/projectStore';
import {
  SecurityValidationError,
  isLoopbackOrigin,
  resolveLoopbackHost,
  resolveSafePathWithinRoot,
  sanitizeDownloadFilename,
} from './server/security';
import {
  configureBlenderExecutablePath,
  detectBlenderInstallation,
  listProviderStatuses,
  probeHardwareCapabilities,
} from './server/systemProbe';

const DEFAULT_PORT = 3000;

function parseListenPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
    return parsed;
  }
  return DEFAULT_PORT;
}

function resolveBlenderScriptsDir(): string {
  return path.resolve(
    process.env.VRM_FORGE_BLENDER_SCRIPTS_DIR || path.join(process.cwd(), 'blender_scripts')
  );
}

function resolveBackendDir(): string {
  return path.resolve(
    process.env.VRM_FORGE_BACKEND_DIR || path.join(process.cwd(), 'backend')
  );
}

function handleRouteError(res: Response, err: unknown) {
  if (err instanceof SecurityValidationError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  const msg = err instanceof Error ? err.message : 'Unexpected server error';
  return res.status(500).json({ error: msg });
}

async function startServer() {
  seedInitialProjectsIfEmpty();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));

  // Loopback & Security Hardening Middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store');
      const origin = req.headers.origin;
      // Only enforce loopback Origin when a desktop client or browser sends an Origin header,
      // unless explicitly overridden for hosted reverse proxies via VRM_FORGE_ALLOW_ANY_ORIGIN=1
      if (
        origin &&
        process.env.VRM_FORGE_ALLOW_ANY_ORIGIN !== '1' &&
        !isLoopbackOrigin(origin) &&
        req.headers.host &&
        (req.headers.host.startsWith('127.0.0.1') || req.headers.host.startsWith('localhost'))
      ) {
        return res.status(403).json({ error: 'Cross-origin request from non-loopback origin rejected.' });
      }
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'vrm-forge-studio',
      host: resolveLoopbackHost(),
      timestamp: new Date().toISOString(),
    });
  });

  // Security remediation: NEVER accept executable path from query string
  app.get('/api/system/capabilities', (_req, res) => {
    const blender = detectBlenderInstallation();
    const hardware = probeHardwareCapabilities();
    const providers = listProviderStatuses(blender);
    res.json({ blender, hardware, providers });
  });

  app.post('/api/blender/detect', (_req, res) => {
    const blender = detectBlenderInstallation();
    res.json({ blender });
  });

  app.post('/api/blender/configure', (req, res) => {
    const candidatePath = typeof req.body?.executablePath === 'string' ? req.body.executablePath : '';
    const fromDesktopPicker = req.body?.fromDesktopPicker === true;
    const blender = configureBlenderExecutablePath(candidatePath, {
      allowCustomFolderFromDesktopPicker: fromDesktopPicker,
    });
    if (!blender.installed) {
      return res.status(400).json({ blender, error: blender.statusMessage });
    }
    return res.json({ blender });
  });

  // Security & Priority 4: Never take executable paths from HTTP; verify real exported humanoid GLB in Blender
  app.post('/api/blender/run-test', (req, res) => {
    const blender = detectBlenderInstallation();
    const scriptsDir = resolveBlenderScriptsDir();
    const testScriptPath = resolveSafePathWithinRoot(scriptsDir, 'test_milestone2_blender.py');
    const backendDir = resolveBackendDir();

    const requestedProjectId =
      typeof req.body?.projectId === 'string' && req.body.projectId.trim()
        ? req.body.projectId.trim()
        : 'armored_paladin_aurelia';

    let glbPath: string | null = null;
    try {
      glbPath = getProjectFilePath(requestedProjectId, 'source_high.glb');
    } catch {
      glbPath = null;
    }
    if (!glbPath) {
      const firstProj = listProjects()[0];
      if (firstProj) {
        glbPath = getProjectFilePath(firstProj.id, 'source_high.glb');
      }
    }

    if (blender.installed && blender.executablePath) {
      if (!glbPath) {
        return res.status(400).json({
          executed: false,
          mode: 'missing_glb',
          error: 'No generated humanoid GLB available to import into Blender.',
        });
      }
      const outDir = resolveSafePathWithinRoot(getProjectsRoot(), '_blender_test');
      fs.mkdirSync(outDir, { recursive: true });
      const reportPath = resolveSafePathWithinRoot(outDir, 'milestone2_report.json');
      try {
        const stdout = execFileSync(
          blender.executablePath,
          [
            '--background',
            '--python',
            testScriptPath,
            '--',
            '--out-dir',
            outDir,
            '--glb-path',
            glbPath,
          ],
          { timeout: 60000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        );
        const report = fs.existsSync(reportPath)
          ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
          : null;
        return res.json({
          executed: Boolean(report?.status === 'ok'),
          mode: 'blender_live',
          blenderVersion: blender.version,
          riggingSuccess: Boolean(report?.rigging_success),
          materialPreserved: Boolean(report?.material_preserved),
          texturePreserved: Boolean(report?.texture_preserved),
          vrmAddonInstalled: Boolean(report?.vrm_addon_installed),
          vrmExported: Boolean(report?.vrm_export_success ?? report?.vrm_exported),
          vrmReloadValid: Boolean(report?.vrm_reload_success ?? report?.vrm_reload_valid),
          deformationMaxDelta: report?.deformation_max_delta ?? null,
          report,
          stdout,
          blendFileExists: fs.existsSync(resolveSafePathWithinRoot(outDir, 'milestone2_test.blend')),
        });
      } catch (err) {
        const report = fs.existsSync(reportPath)
          ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
          : null;
        const e = err as { stdout?: string; stderr?: string; message: string };
        return res.status(report ? 200 : 500).json({
          executed: false,
          mode: 'blender_live',
          blenderVersion: blender.version,
          riggingSuccess: Boolean(report?.rigging_success),
          materialPreserved: Boolean(report?.material_preserved),
          texturePreserved: Boolean(report?.texture_preserved),
          vrmAddonInstalled: Boolean(report?.vrm_addon_installed),
          vrmExported: Boolean(report?.vrm_export_success ?? report?.vrm_exported),
          vrmReloadValid: Boolean(report?.vrm_reload_success ?? report?.vrm_reload_valid),
          deformationMaxDelta: report?.deformation_max_delta ?? null,
          report,
          stdout: e.stdout || e.stderr || '',
          error: report?.vrm_note || e.message,
          blendFileExists: fs.existsSync(resolveSafePathWithinRoot(outDir, 'milestone2_test.blend')),
        });
      }
    }

    // Honest reporting when Blender binary is absent: run Python validator unit suite cleanly
    try {
      const pyExec = process.platform === 'win32' ? 'python' : 'python3';
      const pyTestOut = execFileSync(
        pyExec,
        ['-m', 'unittest', 'discover', '-s', backendDir, '-p', 'test_*.py', '-v'],
        { timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      return res.json({
        executed: false,
        mode: 'blender_not_installed',
        blenderInstalled: false,
        note: 'Blender executable is not installed on this host, so live bpy humanoid import/deformation/VRM export did NOT run. Executed Python binary validator unit checks only.',
        stdout: pyTestOut,
      });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      return res.json({
        executed: false,
        mode: 'blender_not_installed',
        blenderInstalled: false,
        note: `Blender executable is not installed on this host (${e.message}).`,
        stdout: (e.stdout || '') + '\n' + (e.stderr || ''),
      });
    }
  });

  app.post('/api/characters/estimate', (req, res) => {
    try {
      const prompt = String(req.body?.prompt ?? 'Human warrior').trim() || 'Human warrior';
      const rawQ = (req.body?.qualityConfig ?? {}) as Partial<QualityConfig>;
      const qualityConfig: QualityConfig = {
        geometryQuality: rawQ.geometryQuality ?? DEFAULT_QUALITY_CONFIG.geometryQuality,
        textureResolution: rawQ.textureResolution ?? DEFAULT_QUALITY_CONFIG.textureResolution,
        vrmOptimization: rawQ.vrmOptimization ?? DEFAULT_QUALITY_CONFIG.vrmOptimization,
        customOptimization: {
          ...DEFAULT_CUSTOM_OPTIMIZATION,
          ...(rawQ.customOptimization || {}),
        },
      };
      const spec = parseCharacterPromptFallback(prompt, { qualityConfig });
      const estimates = estimateCharacterMetrics(spec);
      res.json({ estimates });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  app.post('/api/characters/generate', async (req, res) => {
    try {
      const prompt = String(req.body?.prompt ?? '').trim();
      if (!prompt) {
        return res.status(400).json({ error: 'Please provide a natural-language character description.' });
      }
      const mode: GenerationMode =
        req.body?.mode === 'local' || req.body?.mode === 'cloud' ? req.body.mode : 'hybrid';
      const interpreterProvider =
        typeof req.body?.interpreterProvider === 'string'
          ? req.body.interpreterProvider
          : undefined;
      const geometryProvider =
        typeof req.body?.geometryProvider === 'string'
          ? req.body.geometryProvider
          : 'sculpted-anatomical-vrm';
      const artStyle: CharacterArtStyle | undefined =
        req.body?.artStyle === 'stylized_anime' ||
        req.body?.artStyle === 'realistic_human' ||
        req.body?.artStyle === 'semi_realistic'
          ? req.body.artStyle
          : undefined;
      const qualityConfig = req.body?.qualityConfig as Partial<QualityConfig> | undefined;

      const tInterp0 = performance.now();
      const interpreted = await interpretCharacterDescription(prompt, {
        mode,
        interpreterProvider,
        geometryProvider,
        artStyle,
        qualityConfig,
      });
      const interpretMs = Math.max(1, Math.round(performance.now() - tInterp0));

      // Priority 3: Pre-geometry fidelity gate before calling 3D provider / synthesis
      const tGate0 = performance.now();
      const specValidation = validateCharacterSpecification(interpreted.spec);
      const designValidationMs = Math.max(1, Math.round(performance.now() - tGate0));
      if (!specValidation.valid) {
        return res.status(422).json({
          error: `Specification fidelity gate rejected generation: ${specValidation.violations.join('; ')}`,
          violations: specValidation.violations,
        });
      }

      const tGeom0 = performance.now();
      const adapterExec = await resolveGeometryProviderExecution(
        interpreted.spec,
        geometryProvider
      );
      const geometryResolveMs = Math.max(1, Math.round(performance.now() - tGeom0));
      interpreted.spec.geometryProvider = adapterExec.executedProvider;

      const externalGeom =
        adapterExec.externalGenerationSucceeded &&
        adapterExec.externalGlbBuffer &&
        adapterExec.externalParsedMesh
          ? {
              glbBuffer: adapterExec.externalGlbBuffer,
              parsedMesh: adapterExec.externalParsedMesh,
            }
          : undefined;

      const project = saveProjectArtifacts(
        interpreted.spec,
        mode,
        {
          interpretMs,
          interpretUsedFallback: interpreted.usedFallback,
          interpreterNote: `${interpreted.providerUsed}: ${interpreted.note}`,
          designValidationMs,
          geometryResolveMs,
          geometryUsedFallback: adapterExec.usedFallback,
          externalGenerationSucceeded: adapterExec.externalGenerationSucceeded,
          adapterDetail: adapterExec.detail,
        },
        `Generated in ${mode} mode via ${adapterExec.executedProvider} (${interpreted.spec.qualityConfig.geometryQuality} / ${interpreted.spec.qualityConfig.textureResolution})`,
        externalGeom
      );

      res.json({
        project,
        usedFallback: interpreted.usedFallback || adapterExec.usedFallback,
        externalGenerationSucceeded: adapterExec.externalGenerationSucceeded,
        fallbackReason: adapterExec.fallbackReason,
        requestedGeometryProvider: adapterExec.requestedProvider,
        executedGeometryProvider: adapterExec.executedProvider,
        note: `${interpreted.note} ${adapterExec.detail}`,
      });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  app.post('/api/projects/:id/customize', (req, res) => {
    try {
      const existing = getProject(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'Project not found' });
      }
      const tPatch0 = performance.now();
      const updatedSpec = applyCharacterEdits(existing.spec, req.body || {});
      const specValidation = validateCharacterSpecification(updatedSpec);
      const patchMs = Math.max(1, Math.round(performance.now() - tPatch0));
      if (!specValidation.valid) {
        return res.status(422).json({
          error: `Customization rejected by fidelity gate: ${specValidation.violations.join('; ')}`,
          violations: specValidation.violations,
        });
      }
      const project = saveProjectArtifacts(
        updatedSpec,
        existing.mode,
        {
          interpretMs: patchMs,
          interpretUsedFallback: false,
          interpreterNote: `Non-destructive patch applied (v${updatedSpec.version})`,
          designValidationMs: 1,
          geometryResolveMs: 0,
          geometryUsedFallback: false,
          externalGenerationSucceeded: false,
          adapterDetail: `Sculpted Anatomical VRM Engine (${updatedSpec.qualityConfig.geometryQuality})`,
        },
        `Customized traits & quality (v${updatedSpec.version})`
      );
      res.json({ project });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  app.post('/api/projects/:id/spec', (req, res) => {
    try {
      const existing = getProject(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Project not found' });
      const rawSpec = req.body?.spec as Partial<CharacterSpecification>;
      const tSpec0 = performance.now();
      const normalized = normalizeCharacterSpec(
        { ...rawSpec, id: existing.id, version: existing.spec.version + 1 },
        existing.spec.sourcePrompt
      );
      const specValidation = validateCharacterSpecification(normalized);
      const specMs = Math.max(1, Math.round(performance.now() - tSpec0));
      if (!specValidation.valid) {
        return res.status(422).json({
          error: `Specification update failed validation: ${specValidation.violations.join('; ')}`,
          violations: specValidation.violations,
        });
      }
      const project = saveProjectArtifacts(
        normalized,
        existing.mode,
        {
          interpretMs: specMs,
          interpretUsedFallback: false,
          interpreterNote: `Direct CharacterSpecification JSON edit (v${normalized.version})`,
          designValidationMs: 1,
          geometryResolveMs: 0,
          geometryUsedFallback: false,
          externalGenerationSucceeded: false,
          adapterDetail: `Sculpted Anatomical VRM Engine (${normalized.qualityConfig.geometryQuality})`,
        },
        `Updated character spec JSON (v${normalized.version})`
      );
      res.json({ project });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  app.post(
    '/api/characters/validate-upload',
    express.raw({ type: '*/*', limit: '50mb' }),
    (req, res) => {
      const buf = req.body as Buffer;
      if (!buf || !Buffer.isBuffer(buf)) {
        return res.status(400).json({ error: 'Expected binary VRM/GLB payload.' });
      }
      const report = validateVrmBinary(new Uint8Array(buf));
      res.json({ report });
    }
  );

  app.get('/api/projects', (_req, res) => {
    res.json({ projects: listProjects() });
  });

  app.get('/api/projects/:id', (req, res) => {
    try {
      const project = getProject(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      res.json({ project });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  app.post('/api/projects/:id/duplicate', (req, res) => {
    try {
      const copy = duplicateProject(req.params.id);
      if (!copy) return res.status(404).json({ error: 'Source project not found' });
      res.json({ project: copy });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  app.get('/api/projects/:id/files/:filename', (req, res) => {
    try {
      const filePath = getProjectFilePath(req.params.id, req.params.filename);
      if (!filePath) return res.status(404).json({ error: 'Artifact file not found' });

      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.vrm' || ext === '.glb') {
        res.setHeader('Content-Type', 'model/gltf-binary');
      } else if (ext === '.py') {
        res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
      } else {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      if (req.query.download === '1') {
        const safeDownload = sanitizeDownloadFilename(req.params.id, req.params.filename);
        res.setHeader('Content-Disposition', `attachment; filename="${safeDownload}"`);
      }
      res.sendFile(filePath);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // Frontend Vite Dev Middleware OR Bundled Production Static Routing
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.env.VRM_FORGE_PUBLIC_DIR || path.join(process.cwd(), 'dist'));
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const host = resolveLoopbackHost();
  const port = parseListenPort();
  const server = app.listen(port, host, () => {
    const addr = server.address() as AddressInfo | null;
    const actualPort = addr?.port ?? port;
    console.log(`VRM_FORGE_READY:${actualPort}`);
    console.log(`VRM Forge Studio server listening on http://${host}:${actualPort}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
