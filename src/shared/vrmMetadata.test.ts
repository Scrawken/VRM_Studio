import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createDefaultVrmMetadata, parseCharacterPromptFallback } from './characterParser';
import { registerPngCompressor } from './pngEncoder';
import {
  buildRiggedVrmFromExternalMesh,
  buildVrm1MetaBlock,
  resolveEffectiveVrmMetadata,
} from './vrmBuilder';
import { parseAndValidateGlbAsset } from '../../server/glbImporter';
import type { ParsedGlbAsset, VrmMetadataConfig } from './types';

registerPngCompressor((raw) => new Uint8Array(zlib.deflateSync(raw, { level: 6 })));

function packGlb(gltf: Record<string, unknown>, bin: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jp = (4 - (json.length % 4)) % 4;
  const jc = new Uint8Array(json.length + jp);
  jc.set(json);
  jc.fill(0x20, json.length);
  const bp = (4 - (bin.length % 4)) % 4;
  const bc = new Uint8Array(bin.length + bp);
  bc.set(bin);
  const total = 12 + 8 + jc.length + 8 + bc.length;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jc.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(jc, 20);
  const o = 20 + jc.length;
  v.setUint32(o, bc.length, true);
  v.setUint32(o + 4, 0x004e4942, true);
  out.set(bc, o + 8);
  return out;
}

function readJson(bytes: Uint8Array): Record<string, any> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = v.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
}

/** A tall tapered column (8 verts, 12 tris), ~1.7m high, enough for the generated-rig path. */
function makeColumnGlb(): Uint8Array {
  const pos: number[] = [];
  for (const y of [0, 1.7]) {
    const r = y === 0 ? 0.25 : 0.15;
    for (const [x, z] of [[-r, -r], [r, -r], [r, r], [-r, r]]) pos.push(x, y, z);
  }
  const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  const posBytes = new Uint8Array(new Float32Array(pos).buffer);
  const idxBytes = new Uint8Array(new Uint16Array(idx).buffer);
  const bin = new Uint8Array(posBytes.length + idxBytes.length);
  bin.set(posBytes);
  bin.set(idxBytes, posBytes.length);
  return packGlb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: 'Body' }],
      meshes: [{ name: 'Body', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-0.25, 0, -0.25], max: [0.25, 1.7, 0.25] },
        { bufferView: 1, componentType: 5123, count: idx.length, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: posBytes.length },
        { buffer: 0, byteOffset: posBytes.length, byteLength: idxBytes.length },
      ],
      buffers: [{ byteLength: bin.length }],
    },
    bin
  );
}

const SOURCE_META: Partial<VrmMetadataConfig> = {
  title: 'Source Avatar',
  author: 'Original Author',
  version: '2.3',
  contactInformation: 'author@example.invalid',
  reference: 'https://example.invalid/ref',
  licenseName: 'CC_BY_NC',
  otherLicenseUrl: 'https://example.invalid/license',
  otherPermissionUrl: 'https://example.invalid/permission',
  allowedUserName: 'ExplicitlyLicensedPerson',
  violentUsage: 'Disallow',
  sexualUsage: 'Disallow',
  commercialUsage: 'Disallow',
  allowRedistribution: false,
  modification: 'prohibited',
  sourceRestrictions: {
    allowedUserName: 'ExplicitlyLicensedPerson',
    commercialUsage: 'Disallow',
    licenseName: 'CC_BY_NC',
  },
};

function makeSpec(vrmVersion: '0.0' | '1.0' = '0.0') {
  return parseCharacterPromptFallback('Imported test character', {
    id: 'meta_test',
    name: 'Meta Test',
    vrmVersion,
  });
}

test('default spec metadata never replaces source licence identity', () => {
  const spec = makeSpec();
  // spec.vrmMetadata carries only defaults ('Other', '1.0', '') -> source must win.
  const meta = resolveEffectiveVrmMetadata(spec, SOURCE_META);
  assert.equal(meta.licenseName, 'CC_BY_NC');
  assert.equal(meta.version, '2.3');
  assert.equal(meta.author, 'Original Author');
  assert.equal(meta.contactInformation, 'author@example.invalid');
  assert.equal(meta.reference, 'https://example.invalid/ref');
  assert.equal(meta.otherLicenseUrl, 'https://example.invalid/license');
  assert.equal(meta.otherPermissionUrl, 'https://example.invalid/permission');
  assert.equal(meta.commercialUsage, 'Disallow');
  assert.deepEqual(meta.sourceRestrictions, SOURCE_META.sourceRestrictions);
});

test('explicit spec identity wins, permissions can never be relaxed past the source', () => {
  const spec = makeSpec();
  spec.vrmMetadata = createDefaultVrmMetadata(spec.name, {
    author: 'New Owner',
    commercialUsage: 'Allow',
    allowedUserName: 'Everyone',
  });
  const meta = resolveEffectiveVrmMetadata(spec, SOURCE_META);
  assert.equal(meta.author, 'New Owner');
  assert.equal(meta.commercialUsage, 'Disallow');
  assert.equal(meta.allowedUserName, 'ExplicitlyLicensedPerson');
  assert.equal(meta.licenseName, 'CC_BY_NC');
});

test('no source meta: defaults only, nothing invented from other assets', () => {
  const meta = resolveEffectiveVrmMetadata(makeSpec());
  assert.equal(meta.licenseName, 'Other');
  assert.equal(meta.allowedUserName, 'OnlyAuthor');
  assert.equal(meta.author, '');
});

test('VRM 1.0 meta maps a CC licenseName to its licence URL, not the VRM default', () => {
  const meta = resolveEffectiveVrmMetadata(makeSpec('1.0'), { ...SOURCE_META, otherLicenseUrl: '' });
  const block = buildVrm1MetaBlock(meta) as Record<string, unknown>;
  assert.equal(block.licenseUrl, 'https://creativecommons.org/licenses/by-nc/4.0/');
  assert.deepEqual(block.authors, ['Original Author']);
  assert.equal(block.version, '2.3');
});

function buildWith(version: '0.0' | '1.0', patch: (p: ParsedGlbAsset) => void, sourceMeta = SOURCE_META) {
  const glb = makeColumnGlb();
  const parsed = parseAndValidateGlbAsset(glb);
  assert.equal(parsed.valid, true, parsed.error);
  parsed.sourceVrmMeta = sourceMeta;
  patch(parsed);
  return buildRiggedVrmFromExternalMesh(makeSpec(version), parsed, glb);
}

test('import->export keeps source meta in both VRM versions', () => {
  const v0 = readJson(buildWith('0.0', () => undefined).vrmBuffer).extensions.VRM.meta;
  assert.equal(v0.licenseName, 'CC_BY_NC');
  assert.equal(v0.author, 'Original Author');
  assert.equal(v0.version, '2.3');
  assert.equal(v0.otherPermissionUrl, 'https://example.invalid/permission');
  assert.equal(v0.allowedUserName, 'OnlyAuthor', 'spec default is tighter than source; spec wins, never looser');
  const built1 = buildWith('1.0', () => undefined);
  const v1 = readJson(built1.vrmBuffer).extensions.VRMC_vrm.meta;
  assert.equal(v1.licenseUrl, 'https://example.invalid/license');
  assert.equal(v1.authors[0], 'Original Author');
  assert.ok(built1.rigReport?.warnings?.some((w) => w.includes('otherPermissionUrl')));
});

test('spring bone params, centre, gravityDir and collider refs survive; skipped groups do not shift refs', () => {
  // Discover real joint names of the generated rig first.
  const probe = readJson(buildWith('0.0', () => undefined).vrmBuffer);
  const names: string[] = probe.nodes.map((n: any) => n.name);
  const headName = names.find((n) => /head/i.test(n))!;
  const spineName = names.find((n) => /spine|chest/i.test(n))!;
  assert.ok(headName && spineName, `rig node names: ${names.join(',')}`);

  const built = buildWith('0.0', (p) => {
    p.existingVrmColliderGroups = [
      { nodeName: 'DoesNotExist', colliders: [{ offset: [0, 0, 0], radius: 0.5 }] },
      { nodeName: headName, colliders: [{ offset: [0.01, 0.02, 0.03], radius: 0.07 }] },
    ];
    p.existingVrmSprings = [
      {
        comment: 'WithCollider',
        stiffiness: 0.9,
        gravityPower: 0.3,
        gravityDir: [0.1, -0.9, 0.2],
        dragForce: 0.55,
        hitRadius: 0.033,
        centerNodeName: spineName,
        boneNames: ['hairBackRoot'],
        colliderGroupIndices: [1],
        colliderGroupNodeNames: [headName],
      },
      {
        comment: 'NoCollider',
        stiffiness: 0.5,
        gravityPower: 0.1,
        gravityDir: [0, -1, 0],
        dragForce: 0.2,
        hitRadius: 0.01,
        boneNames: ['hairLeftRoot'],
        colliderGroupIndices: [],
        colliderGroupNodeNames: [],
      },
    ];
  });
  const sec = readJson(built.vrmBuffer).extensions.VRM.secondaryAnimation;
  assert.equal(sec.colliderGroups.length, 1, 'unresolved collider group skipped');
  const cg = sec.colliderGroups[0];
  assert.equal(cg.colliders[0].radius, 0.07);
  const groups = sec.boneGroups as any[];
  const bySpring = (c: string) => groups.find((g) => g.comment === c);
  // Spring bones on humanoid bones are dropped by design; only assert when the group survived.
  const a = bySpring('WithCollider');
  assert.ok(a, 'spring with collider ref survives');
  {
    assert.equal(a.stiffiness, 0.9);
    assert.equal(a.dragForce, 0.55);
    assert.equal(a.hitRadius, 0.033);
    assert.ok(Math.abs(Math.abs(a.gravityDir.y) - 0.9) < 1e-9);
    assert.deepEqual(a.colliderGroups, [0], 'ref 1 remapped to 0 after skipped group');
    assert.ok(a.center >= 0);
  }
  const b = bySpring('NoCollider');
  assert.ok(b, 'spring without colliders survives');
  assert.deepEqual(b.colliderGroups, [], 'empty source collider list is not padded with defaults');
});
