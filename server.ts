import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { applyCharacterEdits, normalizeCharacterSpec, parseCharacterPromptFallback } from './src/shared/characterParser';
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
  buildTenStagePipelineSummary,
  duplicateProject,
  getProject,
  getProjectFilePath,
  listProjects,
  saveProjectArtifacts,
  seedInitialProjectsIfEmpty,
} from './server/projectStore';
import {
  detectBlenderInstallation,
  listProviderStatuses,
  probeHardwareCapabilities,
} from './server/systemProbe';

const PORT = 3000;

async function startServer() {
  seedInitialProjectsIfEmpty();

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'vrm-forge-studio', timestamp: new Date().toISOString() });
  });

  app.get('/api/system/capabilities', (req, res) => {
    const customPath = typeof req.query.blenderPath === 'string' ? req.query.blenderPath : undefined;
    const blender = detectBlenderInstallation(customPath);
    const hardware = probeHardwareCapabilities();
    const providers = listProviderStatuses(blender);
    res.json({ blender, hardware, providers });
  });

  app.post('/api/blender/detect', (req, res) => {
    const customPath = typeof req.body?.customPath === 'string' ? req.body.customPath : undefined;
    const blender = detectBlenderInstallation(customPath);
    res.json({ blender });
  });

  app.post('/api/blender/run-test', (req, res) => {
    const customPath = typeof req.body?.customPath === 'string' ? req.body.customPath : undefined;
    const blender = detectBlenderInstallation(customPath);
    const testScriptPath = path.resolve(process.cwd(), 'blender_scripts/test_milestone2_blender.py');

    if (blender.installed && blender.executablePath) {
      try {
        const outDir = path.resolve(process.cwd(), 'projects/_blender_test');
        fs.mkdirSync(outDir, { recursive: true });
        const stdout = execFileSync(
          blender.executablePath,
          ['--background', '--python', testScriptPath, '--', '--out-dir', outDir],
          { timeout: 25000, encoding: 'utf8' }
        );
        return res.json({
          executed: true,
          mode: 'blender_live',
          blenderVersion: blender.version,
          stdout,
          blendFileExists: fs.existsSync(path.join(outDir, 'milestone2_test.blend')),
        });
      } catch (err) {
        return res.status(500).json({
          executed: false,
          mode: 'blender_error',
          error: (err as Error).message,
        });
      }
    }

    // Run the Python backend verification suite when Blender binary isn't present on the container host
    try {
      const pyTestOut = execFileSync(
        'python3',
        ['-m', 'unittest', 'discover', '-s', 'backend', '-p', 'test_*.py', '-v'],
        { timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      return res.json({
        executed: true,
        mode: 'python_backend_verified',
        blenderInstalled: false,
        note: 'Blender binary not installed in container sandbox; executed and verified Python backend + Blender runner unit suite.',
        stdout: pyTestOut,
      });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      return res.json({
        executed: false,
        mode: 'python_backend_check',
        blenderInstalled: false,
        note: e.message,
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
      res.status(400).json({ error: (err as Error).message });
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

      const t0 = Date.now();
      const interpreted = await interpretCharacterDescription(prompt, {
        mode,
        interpreterProvider,
        geometryProvider,
        artStyle,
        qualityConfig,
      });
      const tInterpret = Math.max(8, Date.now() - t0);

      const adapterExec = await resolveGeometryProviderExecution(
        interpreted.spec,
        geometryProvider
      );
      interpreted.spec.geometryProvider = adapterExec.executedProvider;

      const preEstimates = estimateCharacterMetrics(interpreted.spec);
      const initialStages = buildTenStagePipelineSummary(
        interpreted.spec,
        `${interpreted.providerUsed}: ${interpreted.note}`,
        adapterExec.detail,
        {
          sourceTriangles: preEstimates.sourceTriangles,
          optimizedTriangles: preEstimates.optimizedTriangles,
          textureTargetPx: preEstimates.textureTargetPx,
          packedTexturePx: preEstimates.packedTexturePx,
          boneCount: 65,
          expressionCount: 17,
          springBoneJointCount: 10,
        },
        tInterpret
      );

      const project = saveProjectArtifacts(
        interpreted.spec,
        mode,
        initialStages,
        `Generated in ${mode} mode via ${interpreted.providerUsed} (${interpreted.spec.qualityConfig.geometryQuality} / ${interpreted.spec.qualityConfig.textureResolution})`
      );

      // Update stage metrics with exact built binary counts
      project.stages = buildTenStagePipelineSummary(
        project.spec,
        `${interpreted.providerUsed}: ${interpreted.note}`,
        adapterExec.detail,
        {
          sourceTriangles: project.estimates.sourceTriangles,
          optimizedTriangles: project.estimates.optimizedTriangles,
          textureTargetPx: project.estimates.textureTargetPx,
          packedTexturePx: project.estimates.packedTexturePx,
          boneCount: project.validation.boneCount,
          expressionCount: project.validation.nonEmptyExpressions.length,
          springBoneJointCount: project.validation.springBoneJointCount,
        },
        tInterpret
      );
      fs.writeFileSync(
        path.join(path.resolve(process.cwd(), 'projects'), project.id, 'meta.json'),
        JSON.stringify(project, null, 2)
      );

      res.json({
        project,
        usedFallback: interpreted.usedFallback || adapterExec.usedFallback,
        note: `${interpreted.note} ${adapterExec.detail}`,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/projects/:id/customize', (req, res) => {
    try {
      const existing = getProject(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'Project not found' });
      }
      const updatedSpec = applyCharacterEdits(existing.spec, req.body || {});
      const preEstimates = estimateCharacterMetrics(updatedSpec);
      const stages = buildTenStagePipelineSummary(
        updatedSpec,
        `Non-destructive patch applied (v${updatedSpec.version})`,
        `Sculpted Anatomical VRM Engine (${updatedSpec.qualityConfig.geometryQuality})`,
        {
          sourceTriangles: preEstimates.sourceTriangles,
          optimizedTriangles: preEstimates.optimizedTriangles,
          textureTargetPx: preEstimates.textureTargetPx,
          packedTexturePx: preEstimates.packedTexturePx,
          boneCount: existing.validation.boneCount,
          expressionCount: existing.validation.nonEmptyExpressions.length,
          springBoneJointCount: existing.validation.springBoneJointCount,
        },
        8
      );
      const project = saveProjectArtifacts(
        updatedSpec,
        existing.mode,
        stages,
        `Customized traits & quality (v${updatedSpec.version})`
      );
      res.json({ project });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/projects/:id/spec', (req, res) => {
    try {
      const existing = getProject(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Project not found' });
      const rawSpec = req.body?.spec as Partial<CharacterSpecification>;
      const normalized = normalizeCharacterSpec(
        { ...rawSpec, id: existing.id, version: existing.spec.version + 1 },
        existing.spec.sourcePrompt
      );
      const project = saveProjectArtifacts(
        normalized,
        existing.mode,
        existing.stages,
        `Updated character spec JSON (v${normalized.version})`
      );
      res.json({ project });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/characters/validate-upload', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
    const buf = req.body as Buffer;
    if (!buf || !Buffer.isBuffer(buf)) {
      return res.status(400).json({ error: 'Expected binary VRM/GLB payload.' });
    }
    const report = validateVrmBinary(new Uint8Array(buf));
    res.json({ report });
  });

  app.get('/api/projects', (_req, res) => {
    res.json({ projects: listProjects() });
  });

  app.get('/api/projects/:id', (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ project });
  });

  app.post('/api/projects/:id/duplicate', (req, res) => {
    const copy = duplicateProject(req.params.id);
    if (!copy) return res.status(404).json({ error: 'Source project not found' });
    res.json({ project: copy });
  });

  app.get('/api/projects/:id/files/:filename', (req, res) => {
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
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}_${req.params.filename}"`);
    }
    res.sendFile(filePath);
  });

  // Frontend Vite / Production Static Routing
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VRM Forge Studio server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
