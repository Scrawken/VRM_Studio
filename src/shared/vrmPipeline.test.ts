import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  applyCharacterEdits,
  normalizeCharacterSpec,
  parseCharacterPromptFallback,
  validateCharacterSpecification,
} from './characterParser';
import { registerPngCompressor } from './pngEncoder';
import {
  buildCharacterVrmAndGlb,
  buildRiggedVrmFromExternalMesh,
  estimateCharacterMetrics,
} from './vrmBuilder';
import { validateVrmBinary } from './vrmValidator';
import { generateBlenderCharacterScript } from './blenderScriptGen';
import { VRM_REQUIRED_HUMANOID_BONES } from './types';
import {
  assertAllowedArtifactFileName,
  assertValidProjectId,
  isLoopbackOrigin,
  resolveLoopbackHost,
  resolveSafePathWithinRoot,
  sanitizeDownloadFilename,
  validateBlenderExecutablePath,
} from '../../server/security';
import { parseAndValidateGlbAsset } from '../../server/glbImporter';
import {
  getProviderRuntimeRecord,
  resolveGeometryProviderExecution,
} from '../../server/generationProviders';

registerPngCompressor((raw) => new Uint8Array(zlib.deflateSync(raw, { level: 6 })));

const DARK_ELF_PROMPT =
  'Create a tall, slender female dark elf with pale lavender skin, long silver hair, glowing violet eyes, pointed ears, ornate black-and-purple armor, a detailed fantasy cloak, and an athletic physique. Give her realistic humanoid proportions and a mysterious appearance.';

const REALISTIC_HUMAN_PROMPT =
  'Create an anatomically realistic human male ranger with tan skin, short brown hair, emerald eyes, dark brown tactical leather coat and boots, athletic muscular build, and realistic humanoid proportions.';

const AURELIA_SERAPHIS_PROMPT =
  'Create a heroic female celestial paladin with porcelain skin, long braided golden hair, glowing amber eyes, silver-and-ivory ornate armor, layered pauldrons, winged mantle, and flowing royal cloak.';

test('characterParser extracts Dark Elf traits, black-and-purple armor, and zero unrequested appendages', () => {
  const spec = parseCharacterPromptFallback(DARK_ELF_PROMPT);
  assert.equal(spec.species, 'Dark Elf');
  assert.equal(spec.genderPresentation, 'feminine');
  assert.equal(spec.features.earStyle, 'long_elf');
  assert.equal(spec.features.hasCloak, true);
  assert.equal(spec.features.hasArmor, true);
  assert.equal(spec.features.hasWings, false, 'Wings must NOT be added unless explicitly requested');
  assert.equal(spec.features.hasHorns, false, 'Horns must NOT be added unless explicitly requested');
  assert.equal(spec.features.hasTail, false, 'Tail must NOT be added unless explicitly requested');
  assert.equal(spec.palette.eyeEmissive, true);
  assert.equal(spec.palette.skinColor, '#cbb8e6');
  assert.equal(spec.palette.hairColor, '#dfe5f2');
  assert.equal(spec.palette.eyeColor, '#a855f7');
  assert.equal(spec.palette.primaryOutfitColor, '#1c1b24');
  assert.equal(spec.palette.secondaryOutfitColor, '#6d28d9');
  assert.equal(spec.artStyle, 'semi_realistic');
  assert.ok(spec.proportions.heightMeters >= 1.75);
});

test('Priority 3: Aurelia Seraphis regression character preserves exact colors, winged mantle, armor, cloak, and forbidden traits', () => {
  const aurelia = parseCharacterPromptFallback(AURELIA_SERAPHIS_PROMPT, {
    id: 'armored_paladin_aurelia',
    name: 'Aurelia Seraphis',
    artStyle: 'semi_realistic',
  });
  assert.equal(aurelia.palette.skinColor, '#f3dfd4');
  assert.equal(aurelia.palette.hairColor, '#e2c06b');
  assert.equal(aurelia.palette.eyeColor, '#f59e0b');
  assert.equal(aurelia.hairStyle, 'braided');
  assert.equal(aurelia.features.hasArmor, true);
  assert.equal(aurelia.features.hasWings, true);
  assert.equal(aurelia.features.hasCloak, true);
  assert.equal(aurelia.features.hasHorns, false);
  assert.equal(aurelia.features.hasTail, false);
  assert.ok(aurelia.constraints?.requiredFeatures.includes('wings'));
  assert.ok(aurelia.constraints?.requiredFeatures.includes('armor'));
  assert.ok(aurelia.constraints?.requiredFeatures.includes('cloak'));
  assert.ok(aurelia.constraints?.forbiddenFeatures.includes('horns'));
  assert.ok(aurelia.constraints?.forbiddenFeatures.includes('tail'));

  const validation = validateCharacterSpecification(aurelia);
  assert.equal(validation.valid, true);
  assert.equal(validation.violations.length, 0);
});

test('Priority 3: Negative clauses ("no wings, without horns, no tail") exclude features and pre-geometry gate blocks drift', () => {
  const prompt =
    'Create a female dark elf knight with pale lavender skin, silver hair, violet eyes, ornate black-and-purple armor, no wings, without horns, no tail.';
  const spec = parseCharacterPromptFallback(prompt);
  assert.equal(spec.features.hasWings, false);
  assert.equal(spec.features.hasHorns, false);
  assert.equal(spec.features.hasTail, false);
  assert.ok(spec.constraints?.forbiddenFeatures.includes('wings'));
  assert.ok(spec.constraints?.forbiddenFeatures.includes('horns'));
  assert.ok(spec.constraints?.forbiddenFeatures.includes('tail'));
  assert.equal(validateCharacterSpecification(spec).valid, true);

  // Inject forbidden wings directly to verify pre-geometry gate blocks it
  const corrupted = {
    ...spec,
    features: { ...spec.features, hasWings: true },
  };
  const rejected = validateCharacterSpecification(corrupted);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.violations.some((v) => v.includes('wings')));
});

test('normalizeCharacterSpec blocks hallucinated wings/horns/tail and preserves explicit prompt colors', () => {
  const guarded = normalizeCharacterSpec(
    {
      features: {
        earStyle: 'human',
        hasCloak: false,
        hasArmor: false,
        hasWings: true,
        hasHorns: true,
        hasTail: true,
      },
      palette: {
        skinColor: '#ffccb3',
        hairColor: '#111111',
        eyeColor: '#22c55e',
        eyeEmissive: false,
        primaryOutfitColor: '#cccccc',
        secondaryOutfitColor: '#ff0000',
        accentMetallicColor: '#ffffff',
        cloakColor: '#0000ff',
      },
    },
    DARK_ELF_PROMPT,
    false
  );
  assert.equal(guarded.features.hasWings, false);
  assert.equal(guarded.features.hasHorns, false);
  assert.equal(guarded.features.hasTail, false);
  assert.equal(guarded.features.hasCloak, true);
  assert.equal(guarded.features.hasArmor, true);
  assert.equal(guarded.features.earStyle, 'long_elf');
  assert.equal(guarded.palette.skinColor, '#cbb8e6');
  assert.equal(guarded.palette.hairColor, '#dfe5f2');
  assert.equal(guarded.palette.eyeColor, '#a855f7');
  assert.equal(guarded.palette.primaryOutfitColor, '#1c1b24');
  assert.equal(guarded.palette.secondaryOutfitColor, '#6d28d9');
});

test('applyCharacterEdits preserves base identity, updates constraints cleanly, and increments version', () => {
  const spec = parseCharacterPromptFallback(DARK_ELF_PROMPT);
  const edited = applyCharacterEdits(spec, {
    name: 'Vaelith Custom',
    artStyle: 'stylized_anime',
    palette: { hairColor: '#38bdf8' },
    features: { hasWings: true },
    qualityConfig: { geometryQuality: 'ultra', textureResolution: '4k' },
  });
  assert.equal(edited.version, 2);
  assert.equal(edited.name, 'Vaelith Custom');
  assert.equal(edited.artStyle, 'stylized_anime');
  assert.equal(edited.palette.hairColor, '#38bdf8');
  assert.equal(edited.palette.skinColor, spec.palette.skinColor);
  assert.equal(edited.features.hasWings, true);
  assert.equal(validateCharacterSpecification(edited).valid, true);
});

test('Priority 0: security helpers enforce loopback host, safe project IDs, path containment, and strict Blender paths', () => {
  assert.equal(resolveLoopbackHost('0.0.0.0'), '127.0.0.1');
  assert.equal(resolveLoopbackHost('localhost'), '127.0.0.1');
  assert.equal(isLoopbackOrigin('http://127.0.0.1:3000'), true);
  assert.equal(isLoopbackOrigin('http://localhost:5173'), true);
  assert.equal(isLoopbackOrigin('https://evil.example.com'), false);

  assert.equal(assertValidProjectId('armored_paladin_aurelia'), 'armored_paladin_aurelia');
  assert.throws(() => assertValidProjectId('../etc/passwd'));
  assert.throws(() => assertValidProjectId('foo/bar'));

  assert.equal(assertAllowedArtifactFileName('character.vrm'), 'character.vrm');
  assert.throws(() => assertAllowedArtifactFileName('../../secret.json'));
  assert.equal(sanitizeDownloadFilename('char_1', 'character.vrm'), 'char_1_character.vrm');

  const root = path.resolve(process.cwd(), 'projects');
  assert.ok(resolveSafePathWithinRoot(root, 'char_1', 'meta.json').startsWith(root));
  assert.throws(() => resolveSafePathWithinRoot(root, '..', 'package.json'));

  const badShell = validateBlenderExecutablePath('/usr/bin/blender;whoami', {
    platform: 'linux',
    requireExistingFile: false,
  });
  assert.equal(badShell.valid, false);
  const badBin = validateBlenderExecutablePath('/bin/sh', {
    platform: 'linux',
    requireExistingFile: false,
  });
  assert.equal(badBin.valid, false);
  const badWin = validateBlenderExecutablePath('C:\\Temp\\evil.exe', {
    platform: 'win32',
    requireExistingFile: false,
  });
  assert.equal(badWin.valid, false);
  const goodWin = validateBlenderExecutablePath(
    'C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe',
    { platform: 'win32', requireExistingFile: false }
  );
  assert.equal(goodWin.valid, true);
});

test('Priority 2: Tripo, Meshy, and Local 3D execute real create->poll->download GLB->VRM rigging flows and report failures honestly', async () => {
  const sampleSpec = parseCharacterPromptFallback(AURELIA_SERAPHIS_PROMPT, {
    qualityConfig: { geometryQuality: 'performance', vrmOptimization: 'unoptimized' },
  });
  const sampleBuilt = buildCharacterVrmAndGlb(sampleSpec);
  const sampleGlb = Buffer.from(sampleBuilt.sourceGlbBuffer);

  // Start a local HTTP server speaking Tripo v2, Meshy v2, and Local 3D protocols
  let pollCounter = 0;
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (req.method === 'POST' && url === '/tripo/task') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 0, data: { task_id: 'tripo_test_123' } }));
      return;
    }
    if (req.method === 'GET' && url === '/tripo/task/tripo_test_123') {
      pollCounter++;
      const status = pollCounter >= 2 ? 'success' : 'running';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          code: 0,
          data: {
            status,
            output: status === 'success' ? { pbr_model: `${baseUrl}/assets/model.glb` } : {},
          },
        })
      );
      return;
    }
    if (req.method === 'POST' && url === '/meshy/text-to-3d') {
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: 'meshy_test_456' }));
      return;
    }
    if (req.method === 'GET' && url === '/meshy/text-to-3d/meshy_test_456') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'SUCCEEDED',
          model_urls: { glb: `${baseUrl}/assets/model.glb` },
        })
      );
      return;
    }
    if (req.method === 'POST' && url === '/local3d/generate') {
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobId: 'local_job_789' }));
      return;
    }
    if (req.method === 'GET' && url === '/local3d/jobs/local_job_789') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'completed',
          downloadUrl: '/assets/model.glb',
        })
      );
      return;
    }
    if (req.method === 'GET' && url.endsWith('/assets/model.glb')) {
      res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
      res.end(sampleGlb);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const prevTripoKey = process.env.TRIPO_API_KEY;
  const prevMeshyKey = process.env.MESHY_API_KEY;
  const prevLocalUrl = process.env.LOCAL_3D_URL;

  try {
    process.env.TRIPO_API_KEY = 'test-tripo-key';
    process.env.MESHY_API_KEY = 'test-meshy-key';
    process.env.LOCAL_3D_URL = `${baseUrl}/local3d`;

    // 1. Tripo live task -> poll -> download -> VRM build
    const tripoRes = await resolveGeometryProviderExecution(sampleSpec, 'tripo-ai-adapter', {
      tripoBaseUrl: `${baseUrl}/tripo`,
      pollIntervalMs: 10,
      maxPollAttempts: 5,
    });
    assert.equal(tripoRes.usedFallback, false);
    assert.equal(tripoRes.externalGenerationSucceeded, true);
    assert.equal(tripoRes.executedProvider, 'tripo-ai-adapter');
    assert.ok(tripoRes.externalGlbBuffer);
    assert.ok(tripoRes.externalParsedMesh?.valid);
    assert.equal(getProviderRuntimeRecord('tripo-ai-adapter')?.state, 'verified_live');

    // Rig downloaded GLB into valid VRM 1.0
    const parsed = parseAndValidateGlbAsset(tripoRes.externalGlbBuffer);
    assert.equal(parsed.valid, true);
    const riggedFromExt = buildRiggedVrmFromExternalMesh(
      sampleSpec,
      parsed,
      tripoRes.externalGlbBuffer
    );
    const vrmCheck = validateVrmBinary(riggedFromExt.vrmBuffer);
    assert.equal(vrmCheck.valid, true);
    assert.equal(vrmCheck.missingRequiredBones.length, 0);
    assert.equal(vrmCheck.skinWeightsValid, true);

    // 2. Meshy live task -> poll -> download
    const meshyRes = await resolveGeometryProviderExecution(sampleSpec, 'meshy-ai-adapter', {
      meshyBaseUrl: `${baseUrl}/meshy`,
      pollIntervalMs: 10,
      maxPollAttempts: 5,
    });
    assert.equal(meshyRes.usedFallback, false);
    assert.equal(meshyRes.externalGenerationSucceeded, true);
    assert.equal(meshyRes.executedProvider, 'meshy-ai-adapter');
    assert.equal(getProviderRuntimeRecord('meshy-ai-adapter')?.state, 'verified_live');

    // 3. Local 3D job -> poll -> download
    const localRes = await resolveGeometryProviderExecution(
      sampleSpec,
      'local-triposr-instantmesh',
      {
        local3dUrl: `${baseUrl}/local3d`,
        pollIntervalMs: 10,
        maxPollAttempts: 5,
      }
    );
    assert.equal(localRes.usedFallback, false);
    assert.equal(localRes.externalGenerationSucceeded, true);
    assert.equal(localRes.executedProvider, 'local-triposr-instantmesh');

    // 4. Missing API key NEVER reports externalGenerationSucceeded
    delete process.env.TRIPO_API_KEY;
    const unconfiguredTripo = await resolveGeometryProviderExecution(
      sampleSpec,
      'tripo-ai-adapter'
    );
    assert.equal(unconfiguredTripo.usedFallback, true);
    assert.equal(unconfiguredTripo.externalGenerationSucceeded, false);
    assert.equal(unconfiguredTripo.executedProvider, 'sculpted-anatomical-vrm');
    assert.equal(getProviderRuntimeRecord('tripo-ai-adapter')?.state, 'unconfigured');
  } finally {
    if (prevTripoKey !== undefined) process.env.TRIPO_API_KEY = prevTripoKey;
    else delete process.env.TRIPO_API_KEY;
    if (prevMeshyKey !== undefined) process.env.MESHY_API_KEY = prevMeshyKey;
    else delete process.env.MESHY_API_KEY;
    if (prevLocalUrl !== undefined) process.env.LOCAL_3D_URL = prevLocalUrl;
    else delete process.env.LOCAL_3D_URL;
    server.close();
  }
});

test('geometry quality scales triangle counts upward from performance -> standard -> high -> ultra', () => {
  const perf = buildCharacterVrmAndGlb(
    parseCharacterPromptFallback(DARK_ELF_PROMPT, {
      qualityConfig: { geometryQuality: 'performance', vrmOptimization: 'unoptimized' },
    })
  );
  const high = buildCharacterVrmAndGlb(
    parseCharacterPromptFallback(DARK_ELF_PROMPT, {
      qualityConfig: { geometryQuality: 'high', vrmOptimization: 'unoptimized' },
    })
  );
  const ultra = buildCharacterVrmAndGlb(
    parseCharacterPromptFallback(DARK_ELF_PROMPT, {
      qualityConfig: { geometryQuality: 'ultra', vrmOptimization: 'unoptimized' },
    })
  );

  assert.ok(perf.stats.triangleCount >= 6000);
  assert.ok(high.stats.triangleCount > perf.stats.triangleCount * 1.6);
  assert.ok(ultra.stats.triangleCount > high.stats.triangleCount * 1.4);
});

test('dual source GLB and optimized VRM preserve source detail independently of export optimization', () => {
  const spec = parseCharacterPromptFallback(DARK_ELF_PROMPT, {
    qualityConfig: {
      geometryQuality: 'high',
      textureResolution: '4k',
      vrmOptimization: 'optimized',
    },
  });
  const preEst = estimateCharacterMetrics(spec);
  assert.ok(preEst.sourceTriangles > preEst.optimizedTriangles);

  const built = buildCharacterVrmAndGlb(spec);
  assert.ok(built.sourceStats.triangleCount > built.stats.triangleCount);
  assert.ok(built.sourceGlbBuffer.byteLength > 0);
  assert.ok(built.vrmBuffer.byteLength > 0);
  assert.equal(built.estimates.textureTargetPx, 4096);
  assert.equal(built.stats.textureCount, 12);
});

test('3-character quality assessment (Dark Elf, Realistic Human, Aurelia Seraphis) all pass independent VRM 1.0 audit', () => {
  const prompts = [
    { label: 'Dark Elf', prompt: DARK_ELF_PROMPT, artStyle: 'semi_realistic' as const },
    { label: 'Realistic Human', prompt: REALISTIC_HUMAN_PROMPT, artStyle: 'realistic_human' as const },
    { label: 'Aurelia Seraphis', prompt: AURELIA_SERAPHIS_PROMPT, artStyle: 'semi_realistic' as const },
  ];

  for (const item of prompts) {
    const spec = parseCharacterPromptFallback(item.prompt, { artStyle: item.artStyle });
    const built = buildCharacterVrmAndGlb(spec);
    const report = validateVrmBinary(built.vrmBuffer);

    assert.equal(report.valid, true, `${item.label} failed validation: ${JSON.stringify(report.checks)}`);
    assert.equal(report.vrmVersion, '1.0');
    assert.equal(report.missingRequiredBones.length, 0);
    for (const reqBone of VRM_REQUIRED_HUMANOID_BONES) {
      assert.ok(report.mappedHumanoidBones.includes(reqBone), `${item.label} missing ${reqBone}`);
    }
    assert.ok(report.boneCount >= 55);
    assert.equal(report.skinWeightsValid, true);
    assert.ok(report.nonEmptyExpressions.length >= 16);
    assert.equal(report.textureCount, 12);
    assert.ok(report.triangleCount >= 10000);
  }
});

test('vrmValidator rejects corrupted binary payloads', () => {
  const badBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
  const report = validateVrmBinary(badBytes);
  assert.equal(report.valid, false);
  assert.ok(report.checks.some((c) => c.status === 'fail'));
});

test('Priority 4: blenderScriptGen & test_milestone2_blender.py enforce humanoid GLB import, depsgraph deformation, and VRM export verification', () => {
  const spec = parseCharacterPromptFallback(AURELIA_SERAPHIS_PROMPT, {
    qualityConfig: { geometryQuality: 'high', textureResolution: '4k', vrmOptimization: 'balanced' },
  });
  const py = generateBlenderCharacterScript(spec);
  assert.ok(py.includes('import bpy'));
  assert.ok(py.includes('create_humanoid_armature'));
  assert.ok(py.includes('evaluated_depsgraph_get'));
  assert.ok(py.includes('REQUIRED_VRM_HUMANOID_BONES'));
  assert.ok(py.includes('WEIGHTED_NORMAL'));
  assert.ok(py.includes('TARGET_TEXTURE_PX = 4096'));
  assert.ok(py.includes('export_scene.vrm'));
  assert.ok(!py.includes('create_uvsphere'));
  assert.ok(!py.includes('create_cube'));

  const m2Path = path.resolve(process.cwd(), 'blender_scripts', 'test_milestone2_blender.py');
  const m2 = fs.readFileSync(m2Path, 'utf8');
  assert.ok(m2.includes('--glb-path'));
  assert.ok(m2.includes('bpy.ops.import_scene.gltf'));
  assert.ok(m2.includes('evaluated_depsgraph_get'));
  assert.ok(m2.includes('validate_vrm_bytes'));
  assert.ok(!m2.includes('create_icosphere'));
  assert.ok(!m2.includes('create_cube'));
});
