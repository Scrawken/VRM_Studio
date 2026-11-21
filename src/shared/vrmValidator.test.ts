import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVrmBinary } from './vrmValidator';
import { VRM_REQUIRED_HUMANOID_BONES } from './types';

type Gltf = Record<string, any>;

function packGlb(gltf: Gltf, bin: Uint8Array): Uint8Array {
  const raw = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonChunk = new Uint8Array(raw.length + ((4 - (raw.length % 4)) % 4));
  jsonChunk.fill(0x20);
  jsonChunk.set(raw, 0);
  const binChunk = new Uint8Array(bin.length + ((4 - (bin.length % 4)) % 4));
  binChunk.set(bin, 0);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonChunk.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonChunk, 20);
  const o = 20 + jsonChunk.length;
  dv.setUint32(o, binChunk.length, true);
  dv.setUint32(o + 4, 0x004e4942, true);
  out.set(binChunk, o + 8);
  return out;
}

/** Mutable builder state passed to mutators so they can append extra accessors. */
interface Ctx {
  gltf: Gltf;
  addVec3: (floats: number[]) => number;
}

function buildVrm0(mutator?: (ctx: Ctx) => void): Uint8Array {
  const nodes: Gltf[] = VRM_REQUIRED_HUMANOID_BONES.map((b) => ({ name: b }));
  nodes[4].children = [17];
  nodes.push({ name: 'hairRoot' });
  nodes.push({ name: 'BodyMesh', mesh: 0, skin: 0 });

  const chunks: Uint8Array[] = [];
  const bufferViews: Gltf[] = [];
  const accessors: Gltf[] = [];
  let off = 0;
  const push = (bytes: Uint8Array) => {
    const pad = (4 - (off % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      off += pad;
    }
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length });
    chunks.push(bytes);
    off += bytes.length;
    return bufferViews.length - 1;
  };
  const f32 = (a: number[]) => new Uint8Array(new Float32Array(a).buffer);
  const addVec3 = (floats: number[]) => {
    accessors.push({ bufferView: push(f32(floats)), componentType: 5126, count: floats.length / 3, type: 'VEC3' });
    return accessors.length - 1;
  };

  const posAcc = addVec3([0, 0, 0, 0.3, 0, 0, 0, 0.5, 0]);
  accessors[posAcc].min = [0, 0, 0];
  accessors[posAcc].max = [0.3, 0.5, 0];
  accessors.push({ bufferView: push(new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0])), componentType: 5121, count: 3, type: 'VEC4' });
  const j0Acc = accessors.length - 1;
  accessors.push({ bufferView: push(f32([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])), componentType: 5126, count: 3, type: 'VEC4' });
  const w0Acc = accessors.length - 1;
  accessors.push({ bufferView: push(new Uint8Array(new Uint16Array([0, 1, 2]).buffer)), componentType: 5123, count: 3, type: 'SCALAR' });
  const idxAcc = accessors.length - 1;
  const morphAcc = addVec3([0, 0, 0, 0, 0.025, 0, 0, 0, 0]);
  const ibm = new Float32Array(18 * 16);
  for (let i = 0; i < 18; i++) for (const k of [0, 5, 10, 15]) ibm[i * 16 + k] = 1;
  accessors.push({ bufferView: push(new Uint8Array(ibm.buffer)), componentType: 5126, count: 18, type: 'MAT4' });
  const ibmAcc = accessors.length - 1;

  const gltf: Gltf = {
    asset: { version: '2.0' },
    extensionsUsed: ['VRM'],
    nodes,
    skins: [{ joints: Array.from({ length: 18 }, (_, i) => i), inverseBindMatrices: ibmAcc }],
    meshes: [{
      name: 'Body',
      primitives: [{
        attributes: { POSITION: posAcc, JOINTS_0: j0Acc, WEIGHTS_0: w0Acc },
        indices: idxAcc,
        material: 0,
        targets: [{ POSITION: morphAcc }],
      }],
    }],
    materials: [{ name: 'DefaultMat' }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: 0 }],
    extensions: {
      VRM: {
        specVersion: '0.0',
        meta: {
          title: 'T',
          author: 'A',
          licenseName: 'Other',
          allowedUserName: 'OnlyAuthor',
          violentUssageName: 'Disallow',
          sexualUssageName: 'Disallow',
          commercialUssageName: 'Disallow',
        },
        humanoid: { humanBones: VRM_REQUIRED_HUMANOID_BONES.map((bone, node) => ({ bone, node })) },
        firstPerson: { firstPersonBone: 4, meshAnnotations: [{ mesh: 0, firstPersonFlag: 'Auto' }] },
        blendShapeMaster: {
          blendShapeGroups: [
            { name: 'Neutral', presetName: 'neutral', binds: [] },
            { name: 'Joy', presetName: 'joy', binds: [{ mesh: 0, index: 0, weight: 100 }] },
          ],
        },
        secondaryAnimation: {
          boneGroups: [{ comment: 'Hair', stiffiness: 0.6, bones: [17], colliderGroups: [0] }],
          colliderGroups: [{ node: 4, colliders: [{ offset: { x: 0, y: 0.08, z: 0 }, radius: 0.1 }] }],
        },
      },
    },
  };
  mutator?.({ gltf, addVec3 });

  const bin = new Uint8Array(off);
  let wp = 0;
  for (const c of chunks) {
    bin.set(c, wp);
    wp += c.length;
  }
  gltf.buffers[0].byteLength = bin.length;
  return packGlb(gltf, bin);
}

const check = (r: ReturnType<typeof validateVrmBinary>, id: string) => r.checks.find((c) => c.id === id);
const ZEROS = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const NONZERO = [0, 0, 0, 0, 0.05, 0, 0, 0, 0];

test('baseline VRM 0.0 fixture is valid', () => {
  const r = validateVrmBinary(buildVrm0(), '0.0');
  assert.equal(r.valid, true, JSON.stringify(r.checks));
});

test('normal-only and tangent-only morph targets count as non-empty; all-zero stays empty', () => {
  for (const attr of ['NORMAL', 'TANGENT']) {
    const r = validateVrmBinary(
      buildVrm0(({ gltf, addVec3 }) => {
        const zero = addVec3(ZEROS);
        const nz = addVec3(NONZERO);
        gltf.meshes[0].primitives[0].targets = [{ POSITION: zero, [attr]: nz }];
      }),
      '0.0'
    );
    assert.equal(r.valid, true, `${attr}: ${JSON.stringify(r.checks)}`);
    assert.deepEqual(r.nonEmptyExpressions, ['joy']);
  }
  const empty = validateVrmBinary(
    buildVrm0(({ gltf, addVec3 }) => {
      const z = addVec3(ZEROS);
      gltf.meshes[0].primitives[0].targets = [{ POSITION: z, NORMAL: z, TANGENT: z }];
    }),
    '0.0'
  );
  assert.equal(empty.valid, false);
  assert.equal(check(empty, 'facial_expressions')?.status, 'fail');
});

test('VRM 1.0 normal-only morph binds are non-empty', () => {
  const bytes = buildVrm0(({ gltf, addVec3 }) => {
    const zero = addVec3(ZEROS);
    const nz = addVec3(NONZERO);
    gltf.meshes[0].primitives[0].targets = [{ POSITION: zero, NORMAL: nz }];
    const humanBones: Record<string, { node: number }> = {};
    VRM_REQUIRED_HUMANOID_BONES.forEach((b, i) => (humanBones[b] = { node: i }));
    delete gltf.extensions.VRM;
    gltf.extensionsUsed = ['VRMC_vrm'];
    gltf.extensions.VRMC_vrm = {
      specVersion: '1.0',
      humanoid: { humanBones },
      expressions: { preset: { happy: { morphTargetBinds: [{ node: 18, index: 0, weight: 1 }] } } },
    };
  });
  const r = validateVrmBinary(bytes, '1.0');
  assert.equal(r.valid, true, JSON.stringify(r.checks));
  assert.deepEqual(r.nonEmptyExpressions, ['happy']);
});

test('humanoid hierarchy problems warn but do not invalidate', () => {
  const flat = validateVrmBinary(buildVrm0(), '0.0');
  assert.equal(flat.valid, true);
  const hc = check(flat, 'humanoid_hierarchy');
  assert.equal(hc?.status, 'warn');
  assert.match(hc!.detail, /spine/);

  const chained = validateVrmBinary(
    buildVrm0(({ gltf }) => {
      const n = gltf.nodes;
      for (let i = 0; i < 17; i++) delete n[i].children;
      n[0].children = [1, 11, 14];
      n[1].children = [2];
      n[2].children = [3, 5, 8];
      n[3].children = [4];
      n[4].children = [17];
      n[5].children = [6];
      n[6].children = [7];
      n[8].children = [9];
      n[9].children = [10];
      n[11].children = [12];
      n[12].children = [13];
      n[14].children = [15];
      n[15].children = [16];
    }),
    '0.0'
  );
  assert.equal(chained.valid, true, JSON.stringify(chained.checks));
  assert.equal(check(chained, 'humanoid_hierarchy'), undefined);
});

test('VRM 0.0 materialProperties schema is validated', () => {
  const withMp = (mps: unknown) =>
    validateVrmBinary(buildVrm0(({ gltf }) => (gltf.extensions.VRM.materialProperties = mps)), '0.0');
  const good = withMp([
    {
      name: 'DefaultMat',
      shader: 'VRM/MToon',
      renderQueue: 2000,
      floatProperties: { _Cutoff: 0.5 },
      vectorProperties: { _Color: [1, 1, 1, 1] },
      textureProperties: {},
      keywordMap: { _ALPHATEST_ON: false },
      tagMap: { RenderType: 'Opaque' },
    },
  ]);
  assert.equal(good.valid, true, JSON.stringify(good.checks));
  const cases: Array<[unknown, RegExp]> = [
    ['nope', /materialProperties must be an array/],
    [[{ floatProperties: { a: 'x' } }], /floatProperties/],
    [[{ vectorProperties: { a: ['x'] } }], /vectorProperties/],
    [[{ textureProperties: { a: 9 } }], /textureProperties/],
    [[{ renderQueue: 1.5 }], /renderQueue/],
    [[{ keywordMap: { a: 1 } }], /keywordMap/],
    [[5], /not an object/],
  ];
  for (const [mps, re] of cases) {
    const r = withMp(mps);
    assert.equal(r.valid, false, String(re));
    assert.match(check(r, 'vrm_metadata')!.detail, re);
  }
});

test('VRM 0.0 meta, firstPerson, blendShape and spring gaps are rejected', () => {
  const mutate = (fn: (vrm: Gltf) => void) => validateVrmBinary(buildVrm0(({ gltf }) => fn(gltf.extensions.VRM)), '0.0');
  const cases: Array<[(v: Gltf) => void, RegExp]> = [
    [(v) => (v.meta.title = 5), /meta\.title/],
    [(v) => (v.meta.texture = 3), /meta\.texture/],
    [(v) => (v.firstPerson.lookAtTypeName = 'Eyes'), /lookAtTypeName/],
    [(v) => (v.firstPerson.meshAnnotations[0].firstPersonFlag = 'Nope'), /firstPersonFlag/],
    [(v) => (v.blendShapeMaster.blendShapeGroups[1].isBinary = 'yes'), /isBinary/],
    [(v) => (v.blendShapeMaster.blendShapeGroups[1].materialValues = [{ materialName: 'm' }]), /materialValues/],
    [(v) => v.blendShapeMaster.blendShapeGroups.push({ name: 'J2', presetName: 'joy', binds: [] }), /Duplicate blendShapeGroup/],
  ];
  for (const [fn, re] of cases) {
    const r = mutate(fn);
    assert.equal(r.valid, false, String(re));
    assert.match(check(r, 'vrm_metadata')!.detail, re);
  }
  const springCases: Array<[(v: Gltf) => void, RegExp]> = [
    [(v) => (v.secondaryAnimation.boneGroups[0].dragForce = 1.5), /dragForce/],
    [(v) => (v.secondaryAnimation.boneGroups[0].stiffiness = 'x'), /stiffiness/],
    [(v) => (v.secondaryAnimation.boneGroups[0].gravityPower = -1), /gravityPower/],
  ];
  for (const [fn, re] of springCases) {
    const r = mutate(fn);
    assert.equal(r.valid, false, String(re));
    assert.match(check(r, 'spring_bones')!.detail, re);
  }
});

// ---- V2: materialValues material refs, materialProperties count, spring gravityDir/center ----

test('blendShape materialValues must reference an existing glTF material name', () => {
  const withMv = (name: string) =>
    validateVrmBinary(
      buildVrm0(({ gltf }) => {
        gltf.extensions.VRM.blendShapeMaster.blendShapeGroups[1].materialValues = [
          { materialName: name, propertyName: '_Color', targetValue: [1, 0, 0, 1] },
        ];
      }),
      '0.0'
    );
  const ok = withMv('DefaultMat');
  assert.equal(ok.valid, true, JSON.stringify(ok.checks));
  const bad = withMv('NoSuchMaterial');
  assert.equal(bad.valid, false);
  assert.match(check(bad, 'vrm_metadata')!.detail, /unknown material "NoSuchMaterial"/);
});

test('materialProperties length mismatch is a warning, never an error', () => {
  const none = validateVrmBinary(buildVrm0(), '0.0'); // fixture has no materialProperties
  assert.equal(check(none, 'vrm0_material_properties'), undefined);
  const r = validateVrmBinary(
    buildVrm0(({ gltf }) => {
      gltf.extensions.VRM.materialProperties = [{ name: 'DefaultMat' }, { name: 'Extra' }];
    }),
    '0.0'
  );
  assert.equal(r.valid, true, JSON.stringify(r.checks));
  assert.equal(check(r, 'vrm0_material_properties')!.status, 'warn');
  assert.match(check(r, 'vrm0_material_properties')!.detail, /2 entries but the glTF has 1 materials/);
  const match = validateVrmBinary(
    buildVrm0(({ gltf }) => {
      gltf.extensions.VRM.materialProperties = [{ name: 'DefaultMat' }];
    }),
    '0.0'
  );
  assert.equal(check(match, 'vrm0_material_properties'), undefined);
});

test('spring boneGroup gravityDir must be finite {x,y,z}; zero length warns; centre range is checked', () => {
  const mutate = (fn: (bg: Gltf) => void) =>
    validateVrmBinary(buildVrm0(({ gltf }) => fn(gltf.extensions.VRM.secondaryAnimation.boneGroups[0])), '0.0');
  const badDirs: unknown[] = [[0, -1, 0], 'down', { x: 0, y: -1 }, { x: 0, y: 'a', z: 0 }, { x: 0, y: null, z: 0 }];
  for (const d of badDirs) {
    const r = mutate((bg) => (bg.gravityDir = d));
    assert.equal(r.valid, false, JSON.stringify(d));
    assert.match(check(r, 'spring_bones')!.detail, /gravityDir must be an object/);
  }
  const good = mutate((bg) => {
    bg.gravityDir = { x: 0, y: -1, z: 0 };
    bg.gravityPower = 0.3;
  });
  assert.equal(good.valid, true);
  assert.equal(check(good, 'spring_bones')!.status, 'pass');
  const zero = mutate((bg) => {
    bg.gravityDir = { x: 0, y: 0, z: 0 };
    bg.gravityPower = 0.3;
  });
  assert.equal(zero.valid, true, 'zero-length gravityDir is only a warning');
  assert.equal(check(zero, 'spring_bones')!.status, 'warn');
  assert.match(check(zero, 'spring_bones')!.detail, /zero length/);
  const zeroPower = mutate((bg) => {
    bg.gravityDir = { x: 0, y: 0, z: 0 };
    bg.gravityPower = 0;
  });
  assert.equal(check(zeroPower, 'spring_bones')!.status, 'pass');
  for (const c of [-2, 9999, 1.5]) {
    const r = mutate((bg) => (bg.center = c));
    assert.equal(r.valid, false, String(c));
    assert.match(check(r, 'spring_bones')!.detail, /center/);
  }
});
