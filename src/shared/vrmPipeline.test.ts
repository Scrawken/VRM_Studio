import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  applyCharacterEdits,
  normalizeCharacterSpec,
  parseCharacterPromptFallback,
} from './characterParser';
import { registerPngCompressor } from './pngEncoder';
import {
  buildCharacterVrmAndGlb,
  estimateCharacterMetrics,
} from './vrmBuilder';
import { validateVrmBinary } from './vrmValidator';
import { generateBlenderCharacterScript } from './blenderScriptGen';
import { VRM_REQUIRED_HUMANOID_BONES } from './types';

registerPngCompressor((raw) => new Uint8Array(zlib.deflateSync(raw, { level: 6 })));

const DARK_ELF_PROMPT =
  'Create a tall, slender female dark elf with pale lavender skin, long silver hair, glowing violet eyes, pointed ears, ornate black-and-purple armor, a detailed fantasy cloak, and an athletic physique. Give her realistic humanoid proportions and a mysterious appearance.';

const REALISTIC_HUMAN_PROMPT =
  'Create an anatomically realistic human male ranger with tan skin, short brown hair, emerald eyes, dark brown tactical leather coat and boots, athletic muscular build, and realistic humanoid proportions.';

const ARMORED_PALADIN_PROMPT =
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

test('normalizeCharacterSpec blocks hallucinated wings/horns/tail and preserves explicit prompt colors', () => {
  const guarded = normalizeCharacterSpec(
    {
      features: { earStyle: 'human', hasCloak: false, hasArmor: false, hasWings: true, hasHorns: true, hasTail: true },
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

test('applyCharacterEdits preserves base identity, artStyle, and increments version', () => {
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
  assert.equal(edited.qualityConfig.geometryQuality, 'ultra');
  assert.equal(edited.qualityConfig.textureResolution, '4k');
  assert.equal(edited.sourcePrompt, DARK_ELF_PROMPT);
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

  assert.ok(perf.stats.triangleCount >= 6000, `Expected high-detail perf mesh >= 6k tris, got ${perf.stats.triangleCount}`);
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
  assert.equal(built.stats.textureCount, 12, 'Expected 7 albedo + 1 iris emissive + 4 tangent normal maps');
});

test('3-character quality assessment (Dark Elf, Realistic Human, Armored Paladin) all pass independent VRM 1.0 audit', () => {
  const prompts = [
    { label: 'Dark Elf', prompt: DARK_ELF_PROMPT, artStyle: 'semi_realistic' as const },
    { label: 'Realistic Human', prompt: REALISTIC_HUMAN_PROMPT, artStyle: 'realistic_human' as const },
    { label: 'Armored Paladin', prompt: ARMORED_PALADIN_PROMPT, artStyle: 'semi_realistic' as const },
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
    assert.ok(report.triangleCount >= 10000, `${item.label} expected >= 10k tris, got ${report.triangleCount}`);
  }
});

test('vrmValidator rejects corrupted binary payloads', () => {
  const badBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
  const report = validateVrmBinary(badBytes);
  assert.equal(report.valid, false);
  assert.ok(report.checks.some((c) => c.status === 'fail'));
});

test('blenderScriptGen outputs sculpted anatomical bpy pipeline without primitive cube/uvsphere calls', () => {
  const spec = parseCharacterPromptFallback(DARK_ELF_PROMPT, {
    qualityConfig: { geometryQuality: 'high', textureResolution: '4k', vrmOptimization: 'balanced' },
  });
  const py = generateBlenderCharacterScript(spec);
  assert.ok(py.includes('import bpy'));
  assert.ok(py.includes('create_humanoid_armature'));
  assert.ok(py.includes('append_anatomical_loft'));
  assert.ok(py.includes('build_sculpted_hair_curves'));
  assert.ok(py.includes('WEIGHTED_NORMAL'));
  assert.ok(py.includes('TARGET_TEXTURE_PX = 4096'));
  assert.ok(py.includes('export_scene.vrm'));
  assert.ok(!py.includes('create_uvsphere'), 'Must not contain primitive create_uvsphere');
  assert.ok(!py.includes('create_cube'), 'Must not contain primitive create_cube');
});
