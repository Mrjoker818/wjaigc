import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { expect, it, vi } from 'vitest';

// Only authentication is synthetic. Local save, data-root resolution, signature
// checks, GET route and safe local reads are the real implementation.
const guards = vi.hoisted(() => ({
  authCalls: 0,
  forbiddenCalls: [] as string[],
  deny: (name: string): never => {
    guards.forbiddenCalls.push(name);
    throw new Error(`D02_FORBIDDEN_DEPENDENCY:${name}`);
  },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async (request: NextRequest) => {
    guards.authCalls++;
    if (request.headers.get('x-d02-auth') === 'anonymous') {
      return NextResponse.json({ error: 'fixture unauthenticated' }, { status: 401 });
    }
    return {
      authenticated: true, userId: 'd02-synthetic-owner', userRole: 'user',
      user: { id: 'd02-synthetic-owner', role: 'user', productType: request.headers.get('x-d02-platform') ?? 'video' },
    };
  },
}));
vi.mock('@/lib/db-client', () => ({
  execSql: () => guards.deny('db.execSql'),
  getPool: () => guards.deny('db.getPool'),
  withTransaction: () => guards.deny('db.withTransaction'),
}));
vi.mock('@/lib/asset-core/storage', () => ({
  withAssetCoreTransaction: () => guards.deny('asset.transaction'),
}));
vi.mock('@/lib/s3-storage', () => ({
  downloadImageFromS3: () => guards.deny('s3.download'),
  readImageFromS3Bounded: () => guards.deny('s3.readBounded'),
  readBinaryFromS3Exact: () => guards.deny('s3.readExact'),
  getS3PresignedUrl: () => guards.deny('s3.presign'),
  deriveS3Key: () => guards.deny('s3.derive'),
  resolveS3Key: () => guards.deny('s3.resolve'),
}));
vi.mock('@/lib/image-source-map', () => ({
  getImageSourceUrl: () => guards.deny('source-map.lookup'),
}));
// Export artifacts are a different branch from imported drama-clips.
vi.mock('@/lib/asset-core/binary-persistence', () => ({
  MAX_ASSET_BINARY_BYTES: 256 * 1024 * 1024,
  recoverExportAssetBytes: () => guards.deny('export.recover'),
  validateExportAssetBytes: () => guards.deny('export.validate'),
}));

type NetworkGuard = { attempts: string[]; restore?: () => void };
type Receipt = { videoUrl: string; sha256: string; size: number; writerPid: number };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(import.meta.url);

// Self-contained for normal test runs; the evidence launcher additionally
// preloads a guard before Vitest itself starts. Serialized for the reader.
function installOfflineGuard(nodeRequire: NodeRequire): NetworkGuard {
  const attempts: string[] = [];
  const restores: Array<() => void> = [];
  const patch = (target: Record<string, unknown>, key: string, label: string) => {
    const previous = target[key];
    target[key] = () => { attempts.push(label); throw new Error(`D02_NETWORK_DENIED:${label}`); };
    restores.push(() => { target[key] = previous; });
  };
  for (const name of ['node:http', 'node:https']) {
    const mod = nodeRequire(name);
    for (const key of ['request', 'get']) patch(mod, key, `${name}.${key}`);
    patch(mod.Agent.prototype, 'createConnection', `${name}.Agent.createConnection`);
  }
  const net = nodeRequire('node:net');
  for (const key of ['connect', 'createConnection']) patch(net, key, `net.${key}`);
  patch(net.Socket.prototype, 'connect', 'net.Socket.connect');
  patch(net.Server.prototype, 'listen', 'net.Server.listen');
  patch(nodeRequire('node:tls'), 'connect', 'tls.connect');
  patch(nodeRequire('node:dgram'), 'createSocket', 'dgram.createSocket');
  const dns = nodeRequire('node:dns');
  for (const target of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
    for (const key of Object.getOwnPropertyNames(target)) {
      if (/^(lookup|resolve|reverse)/.test(key) && typeof target[key] === 'function') patch(target, key, `dns.${key}`);
    }
  }
  for (const key of ['fetch', 'WebSocket']) patch(globalThis as unknown as Record<string, unknown>, key, key);
  const sync = nodeRequire('node:module').syncBuiltinESMExports;
  sync();
  const global = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const symbol = Symbol.for('d02.network-denied');
  const state = { attempts, restore: () => { restores.reverse().forEach(restore => restore()); delete global[symbol]; sync(); } };
  global[symbol] = state;
  return state;
}

function toolPath(envName: string, packageName: string, fallback: string): string {
  if (process.env[envName]) return process.env[envName]!;
  try {
    const installed = require(packageName) as string | { path: string };
    return typeof installed === 'string' ? installed : installed.path;
  } catch { return fallback; } // Installed PATH tools only; never install/download.
}

function runTool(executable: string, args: string[]) {
  return spawnSync(executable, args, {
    encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
}

function inspectClip(filename: string) {
  const ffprobe = toolPath('D02_FFPROBE', 'ffprobe-static', 'ffprobe');
  const ffmpeg = toolPath('D02_FFMPEG', 'ffmpeg-static', 'ffmpeg');
  // Input protocols cannot access the network even in native subprocesses.
  const protocol = ['-protocol_whitelist', 'file,pipe'];
  const probe = runTool(ffprobe, [
    '-v', 'error', ...protocol, '-select_streams', 'v:0',
    '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames:format=duration',
    '-of', 'json', filename,
  ]);
  expect(probe.error, probe.stderr).toBeUndefined();
  expect(probe.status, probe.stderr).toBe(0);
  const metadata = JSON.parse(probe.stdout);
  expect(Number(metadata.format.duration)).toBeGreaterThan(0.9);
  expect(Number(metadata.format.duration)).toBeLessThan(1.1);
  expect(metadata.streams[0].width).toBeGreaterThan(0);
  expect(metadata.streams[0].height).toBeGreaterThan(0);
  expect(Number(metadata.streams[0].nb_read_frames)).toBeGreaterThan(0);
  const decoded = runTool(ffmpeg, [
    '-nostdin', '-v', 'error', '-xerror', ...protocol, '-i', filename,
    '-map', '0:v:0', '-f', 'null', '-',
  ]);
  expect(decoded.error, decoded.stderr).toBeUndefined();
  expect(decoded.status, decoded.stderr).toBe(0);
  return { ffprobe, ffmpeg, metadata, decodeExit: decoded.status };
}

async function serveClip(videoUrl: string, expected: Buffer) {
  const { GET } = await import('@/app/api/serve-upload/[...path]/route');
  const calls = guards.authCalls;
  const response = await GET(new NextRequest(`http://d02.invalid${videoUrl}`), {
    params: Promise.resolve({ path: videoUrl.slice('/api/serve-upload/'.length).split('/') }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('video/mp4');
  expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(expected);
  // Existing public URL contract, not a claim of private-media authorization.
  expect(guards.authCalls).toBe(calls);
}

// The same test re-enters in a separate Vitest process in read-only mode.
// The evidence launcher also denies network during runner startup.
it('round-trips a real clip through save/serve and a fresh process without DB or network', async () => {
  const preloaded = (globalThis as typeof globalThis & { [key: symbol]: unknown })[
    Symbol.for('d02.network-denied')
  ] as NetworkGuard | undefined;
  const network = preloaded ?? installOfflineGuard(require);
  const readerRoot = process.env.D02_CLIP_READER_ROOT;
  const root = readerRoot ?? await mkdtemp(path.join(tmpdir(), 'wujie-d02-clip-'));
  const previousRoot = process.env.WUJIE_DATA_DIR;
  const previousWorkspace = process.env.COZE_WORKSPACE_PATH;
  const previousDurable = process.env.WUJIE_DATA_DIR_DURABLE;
  process.env.WUJIE_DATA_DIR = root;
  process.env.COZE_WORKSPACE_PATH = root;
  process.env.WUJIE_DATA_DIR_DURABLE = 'false';
  vi.resetModules();
  const evidenceDir = process.env.D02_EVIDENCE_DIR;
  try {
    const storage = await import('@/lib/server-data-root');
    expect(storage.getServerDataRoot()).toBe(root);
    // This local temp directory is deliberately NOT declared a durable mount.
    expect(storage.isServerDataRootDurable()).toBe(false);
    if (readerRoot) {
      const receipt: Receipt = JSON.parse(await readFile(path.join(root, 'receipt.json'), 'utf8'));
      expect(process.pid).not.toBe(receipt.writerPid);
      const file = path.join(root, ...receipt.videoUrl.slice('/api/serve-upload/'.length).split('/'));
      const bytes = await readFile(file);
      expect(bytes.length).toBe(receipt.size);
      expect(hash(bytes)).toBe(receipt.sha256);
      await serveClip(receipt.videoUrl, bytes);
      const media = inspectClip(file);
      expect(guards.forbiddenCalls).toEqual([]);
      expect(network.attempts).toEqual([]);
      await writeFile(path.join(root, 'reader-result.json'), JSON.stringify({
        ...receipt, readerPid: process.pid, media, forbiddenCalls: guards.forbiddenCalls,
        networkAttempts: network.attempts, scope: 'local-new-process-only',
      }, null, 2));
      return;
    }

    // Only the explicitly allowed repository fixture is read.
    const original = await readFile(path.resolve('tests/fixtures/owned-one-second.mp4'));
    const { POST } = await import('@/app/api/drama/clip/route');
    const post = (file?: File, headers?: Record<string, string>) => {
      const body = new FormData();
      if (file) body.append('file', file);
      return POST(new NextRequest('http://d02.invalid/api/drama/clip', { method: 'POST', body, headers }));
    };
    const clip = () => new File([new Uint8Array(original)], 'owned-one-second.mp4', { type: 'video/mp4' });
    expect((await post(clip(), { 'x-d02-auth': 'anonymous' })).status).toBe(401);
    expect((await post(clip(), { 'x-d02-platform': 'chat' })).status).toBe(403);
    expect((await post()).status).toBe(400);
    expect((await post(new File(['invalid-content'], 'fake.mp4', { type: 'video/mp4' }))).status).toBe(400);
    expect((await post(new File([new Uint8Array(original)], 'fake.png', { type: 'image/png' }))).status).toBe(400);
    expect(await readdir(root)).toEqual([]);

    const response = await post(clip());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.videoUrl).toMatch(/^\/api\/serve-upload\/drama-clips\/clip_\d+_[a-f0-9]{8}\.mp4$/u);
    const savedFile = path.join(root, ...result.videoUrl.slice('/api/serve-upload/'.length).split('/'));
    const saved = await readFile(savedFile);
    expect(saved, 'saved bytes must exactly match the real input fixture').toEqual(original);
    expect(hash(saved)).toBe(hash(original));
    await serveClip(result.videoUrl, original);
    const media = inspectClip(savedFile);
    // Decode the returned GET bytes as a distinct file, too.
    const servedFile = path.join(root, 'served.mp4');
    const { GET } = await import('@/app/api/serve-upload/[...path]/route');
    const served = await GET(new NextRequest(`http://d02.invalid${result.videoUrl}`), {
      params: Promise.resolve({ path: ['drama-clips', path.basename(savedFile)] }),
    });
    const servedBytes = Buffer.from(await served.arrayBuffer());
    expect(servedBytes).toEqual(original);
    await writeFile(servedFile, servedBytes);
    inspectClip(servedFile);

    // Existing path protections stay in force; all targets are synthetic.
    await mkdir(path.join(root, 'users'));
    await writeFile(path.join(root, 'users', 'private.mp4'), original);
    for (const [parts, status] of [
      [['..', 'users', 'private.mp4'], 400],
      [['users', 'private.mp4'], 404],
      [['system', 'settings.json'], 404],
    ] as const) {
      const denied = await GET(new NextRequest('http://d02.invalid/api/serve-upload/test'), {
        params: Promise.resolve({ path: [...parts] }),
      });
      expect(denied.status).toBe(status);
    }

    const receipt: Receipt = { videoUrl: result.videoUrl, sha256: hash(original), size: original.length, writerPid: process.pid };
    await writeFile(path.join(root, 'receipt.json'), JSON.stringify(receipt));
    const guardFile = path.join(root, 'deny-network.cjs');
    await writeFile(guardFile, `(${installOfflineGuard.toString()})(require);`);
    const config = path.join(root, 'reader.config.mjs');
    await writeFile(config, `export default ${JSON.stringify({
      root: process.cwd(), envDir: false, cacheDir: path.join(root, 'vite-cache'),
      server: { host: '127.0.0.1', hmr: false },
      resolve: { alias: { '@': path.resolve('src') } },
      test: {
        environment: 'node', pool: 'forks', fileParallelism: false, maxWorkers: 1, minWorkers: 1,
        include: ['src/__tests__/api/drama-clip-real-storage.test.ts'],
      },
    })};`);
    const childEnv: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    for (const key of ['SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'PATH', 'Path', 'PATHEXT', 'TEMP', 'TMP', 'COMSPEC', 'NUMBER_OF_PROCESSORS']) {
      if (process.env[key] !== undefined) childEnv[key] = process.env[key];
    }
    Object.assign(childEnv, {
      CI: '1', NO_COLOR: '1', D02_CLIP_READER_ROOT: root,
      NODE_OPTIONS: `--require "${guardFile.replaceAll('\\', '/')}"`,
    });
    const child = spawnSync(process.execPath, [
      require.resolve('vitest/vitest.mjs'), 'run', '--config', config,
      'src/__tests__/api/drama-clip-real-storage.test.ts', '--reporter=verbose',
    ], {
      env: childEnv, encoding: 'utf8',
      timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    });
    if (evidenceDir) await writeFile(path.join(evidenceDir, 'reader.log'), child.stdout + child.stderr);
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stdout + child.stderr).toBe(0);
    const reader = JSON.parse(await readFile(path.join(root, 'reader-result.json'), 'utf8'));
    expect(reader.readerPid).not.toBe(process.pid);
    expect(reader.sha256).toBe(receipt.sha256);
    expect(reader.networkAttempts).toEqual([]);
    expect(reader.forbiddenCalls).toEqual([]);
    expect(guards.forbiddenCalls).toEqual([]);
    expect(network.attempts).toEqual([]);
    if (evidenceDir) await writeFile(path.join(evidenceDir, 'result.json'), JSON.stringify({
      receipt, media, reader, temporaryRoot: root, networkAttempts: network.attempts,
      forbiddenCalls: guards.forbiddenCalls, scope: 'local-new-process-only',
      cozeRedeployVerified: false,
    }, null, 2));
  } finally {
    if (previousRoot === undefined) delete process.env.WUJIE_DATA_DIR;
    else process.env.WUJIE_DATA_DIR = previousRoot;
    if (previousWorkspace === undefined) delete process.env.COZE_WORKSPACE_PATH;
    else process.env.COZE_WORKSPACE_PATH = previousWorkspace;
    if (previousDurable === undefined) delete process.env.WUJIE_DATA_DIR_DURABLE;
    else process.env.WUJIE_DATA_DIR_DURABLE = previousDurable;
    vi.resetModules();
    if (!readerRoot) {
      // Delete only the exact directory this test created using mkdtemp.
      const parent = await realpath(tmpdir());
      const resolved = await realpath(root);
      expect(path.dirname(resolved)).toBe(parent);
      expect(path.basename(resolved)).toMatch(/^wujie-d02-clip-/);
      await rm(resolved, { recursive: true, force: true });
    }
    if (!preloaded) network.restore?.();
  }
}, 45000);
