// Express 5 route smoke test. Spawns the real server (tsx server.ts) on a dynamic port (PORT=0),
// like Electron does. Run: npx tsx --test server/routes.smoke.test.ts
// Static/SPA checks run only when `npm run build` has produced dist/index.html.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hasDist = fs.existsSync(path.join(root, 'dist', 'index.html'));
let child: ChildProcess | undefined;
let port = 0;
let projectsDir = '';

function request(
  method: string,
  urlPath: string,
  opts: { host?: string; headers?: Record<string, string>; body?: Buffer } = {}
): Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        headers: { Host: opts.host ?? `127.0.0.1:${port}`, ...(opts.headers || {}) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks), headers: res.headers })
        );
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Minimal valid GLB: one triangle, no materials. */
function tinyTriangleGlb(): Buffer {
  const positions = Buffer.alloc(36);
  [0, 0, 0, 0.5, 0, 0, 0, 1, 0].forEach((v, i) => positions.writeFloatLE(v, i * 4));
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [0.5, 1, 0] },
    ],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const total = 12 + 8 + jsonBuf.length + 8 + positions.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(positions.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, positions]);
}

before(async () => {
  projectsDir = fs.mkdtempSync(path.join(root, '_smoke-projects-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: '0',
      NODE_ENV: hasDist ? 'production' : 'development',
      VRM_FORGE_PROJECTS_DIR: projectsDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child = proc;
  let log = '';
  port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not become ready:\n' + log)), 60000);
    proc.stdout!.on('data', (d: Buffer) => {
      log += d.toString();
      const m = /VRM_FORGE_READY:(\d+)/.exec(log);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    proc.stderr!.on('data', (d: Buffer) => (log += d.toString()));
    proc.on('exit', (c) => reject(new Error(`server exited early (${c}):\n${log}`)));
  });
});

after(() => {
  child?.kill();
  if (projectsDir) fs.rmSync(projectsDir, { recursive: true, force: true });
});

test('dynamic port is bound on loopback and /api/health answers', async () => {
  assert.ok(port > 0);
  const r = await request('GET', '/api/health');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body.toString());
  assert.equal(j.status, 'ok');
  assert.equal(j.host, '127.0.0.1');
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('/api/system/capabilities returns blender, hardware, providers', async () => {
  const r = await request('GET', '/api/system/capabilities');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body.toString());
  assert.ok('blender' in j && 'hardware' in j && 'providers' in j);
});

test('Host allowlist: loopback host with live port passes, spoofed hosts get 403', async () => {
  assert.equal((await request('GET', '/api/health', { host: `localhost:${port}` })).status, 200);
  for (const host of [
    'evil.com',
    `evil.com:${port}`,
    `localhost.evil.com:${port}`,
    `127.0.0.1.evil.com:${port}`,
    `127.0.0.1:${port + 1}`,
  ]) {
    assert.equal((await request('GET', '/api/health', { host })).status, 403, host);
  }
  assert.equal((await request('GET', '/', { host: `evil.com:${port}` })).status, 403);
});

test('non-loopback Origin on /api is rejected', async () => {
  const r = await request('GET', '/api/health', { headers: { Origin: 'http://evil.com' } });
  assert.equal(r.status, 403);
});

test('POST routes tolerate a missing body (Express 5 leaves req.body undefined)', async () => {
  assert.equal((await request('POST', '/api/blender/detect')).status, 200);
  const r = await request('POST', '/api/blender/configure', {
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from(JSON.stringify({ executablePath: path.join(root, 'definitely-not-blender.exe') })),
  });
  assert.equal(r.status, 400);
});

test('express.raw upload routes: validate-upload, import-glb, bad payloads', async () => {
  const glb = tinyTriangleGlb();
  const v = await request('POST', '/api/characters/validate-upload', {
    headers: { 'Content-Type': 'application/octet-stream' },
    body: glb,
  });
  assert.equal(v.status, 200);
  assert.ok('report' in JSON.parse(v.body.toString()));

  const bad = await request('POST', '/api/characters/import-glb', {
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from('nope'),
  });
  assert.equal(bad.status, 400);

  const noBody = await request('POST', '/api/characters/import-glb');
  assert.equal(noBody.status, 400);

  // A bare triangle has no humanoid/expressions, so the importer may reject it in its own validation
  // (currently reported as 500); the point here is that express.raw delivered the body to the importer.
  const imp = await request('POST', '/api/characters/import-glb?name=Smoke%20Tri&vrmVersion=0.0', {
    headers: { 'Content-Type': 'application/octet-stream' },
    body: glb,
  });
  assert.ok(
    imp.status === 200 || imp.status === 422 || /validation failed/.test(imp.body.toString()),
    `import-glb status ${imp.status}: ${imp.body.toString().slice(0, 300)}`
  );
});

test('project listing and path params (/api/projects, /api/projects/:id, files/:filename)', async () => {
  const list = await request('GET', '/api/projects');
  assert.equal(list.status, 200);
  const missing = await request('GET', '/api/projects/does-not-exist');
  assert.ok([400, 404].includes(missing.status), String(missing.status));
  const traversal = await request('GET', '/api/projects/x/files/..%2F..%2Fpackage.json');
  assert.ok([400, 403, 404].includes(traversal.status), String(traversal.status));
});

test('static files and SPA fallback (needs npm run build)', { skip: !hasDist }, async () => {
  const rootPage = await request('GET', '/');
  assert.equal(rootPage.status, 200);
  assert.match(rootPage.body.toString(), /<div id="root"/);
  const spa = await request('GET', '/some/deep/route');
  assert.equal(spa.status, 200);
  assert.match(spa.body.toString(), /<div id="root"/);
});
