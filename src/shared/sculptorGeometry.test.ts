import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHighDetailCharacterGeometry } from './anatomicalSculptor';
import { buildHumanoidSkeleton } from './vrmBuilder';
import { parseCharacterPromptFallback } from './characterParser';

const CASES = [
  ['aurelia', 'Create a heroic female celestial paladin with porcelain skin, long braided golden hair, glowing amber eyes, silver-and-ivory ornate armor, layered pauldrons, winged mantle, and flowing royal cloak.'],
  ['vaelith', 'Create a tall, slender female dark elf with pale lavender skin, long silver hair, glowing violet eyes, ornate black-and-purple armor, a detailed fantasy cloak, and an athletic physique.'],
  ['marcus', 'Create an anatomically realistic human male ranger with tan skin, short brown hair, emerald eyes, dark brown tactical leather coat and boots, athletic muscular build, and realistic humanoid proportions.'],
] as const;

function degenerateCount(positions: number[], indices: number[]) {
  let count = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    if (indices[i] === indices[i + 1] || indices[i] === indices[i + 2] || indices[i + 1] === indices[i + 2]) {
      count++;
      continue;
    }
    const ab = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const ac = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (Math.hypot(...cross) * 0.5 < 1e-12) count++;
  }
  return count;
}

test('generated sample geometry has no repeated-index or zero-area triangles', () => {
  for (const [id, prompt] of CASES) {
    const spec = parseCharacterPromptFallback(prompt, { id, name: id });
    const primitives = buildHighDetailCharacterGeometry(spec, buildHumanoidSkeleton(spec));
    assert.ok(primitives.length > 0, `${id}: geometry should be generated`);
    for (const primitive of primitives) {
      assert.equal(primitive.indices.length % 3, 0, `${id}/${primitive.name}: complete triangles`);
      assert.equal(degenerateCount(primitive.positions, primitive.indices), 0, `${id}/${primitive.name}: no degenerate triangles`);
      assert.equal(primitive.positions.length / 3, primitive.joints.length / 4, `${id}/${primitive.name}: joints aligned`);
      assert.equal(primitive.positions.length / 3, primitive.weights.length / 4, `${id}/${primitive.name}: weights aligned`);
      assert.equal(primitive.positions.length / 3, primitive.normals.length / 3, `${id}/${primitive.name}: normals aligned`);
      assert.equal(primitive.positions.length / 3, primitive.uvs.length / 2, `${id}/${primitive.name}: UVs aligned`);
    }
  }
});
