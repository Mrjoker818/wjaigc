// @vitest-environment node
// Actual producer, file-service and video handlers; only external identities/providers are synthetic.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import { NextRequest, NextResponse } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dataRoot: '', scratch: '', auth: true, requests: 0, unexpected: 0, fallbacks: 0,
  reply: Buffer.alloc(0) as Buffer, mime: 'audio/mpeg', declaredBytes: '', cancelled: false, chunked: false, pulled: 0,
}));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: (): string => mocks.dataRoot }));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: async () => [{
  id: 'qp-provider', name: 'QP synthetic provider', type: 'audio', isEnabled: true,
  baseUrl: 'https://qp.provider.invalid', apiKey: 'qp-not-a-real-key', selectedModels: ['qp-synthetic-tts'],
}] }));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async (): Promise<NextResponse | { id: string }> =>
    mocks.auth ? { id: 'qp-synthetic-actor' } : NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('os', async original => ({ ...await original<typeof import('os')>(), tmpdir: (): string => mocks.scratch }));
vi.mock('@/lib/s3-storage', () => ({
  downloadImageFromS3: async (): Promise<null> => { mocks.fallbacks++; return null; },
  readBinaryFromS3Exact: async (): Promise<null> => { mocks.fallbacks++; return null; },
  deriveS3Key: (value: string): string => value,
  getS3PresignedUrl: async (): Promise<null> => { mocks.fallbacks++; return null; },
  resolveS3Key: async (): Promise<null> => { mocks.fallbacks++; return null; },
}));
vi.mock('@/lib/image-source-map', () => ({
  getImageSourceUrl: async (): Promise<null> => { mocks.fallbacks++; return null; },
}));
vi.mock('@/lib/asset-core/recovery-media', () => ({ readExactRecoveryMedia: async (): Promise<null> => null }));
vi.mock('@/lib/asset-core/binary-persistence', () => ({
  MAX_ASSET_BINARY_BYTES: 256 * 1024 * 1024,
  recoverExportAssetBytes: async (): Promise<never> => { throw Error('QP_UNEXPECTED_EXPORT_RECOVERY'); },
  validateExportAssetBytes: async (): Promise<never> => { throw Error('QP_UNEXPECTED_EXPORT_VALIDATION'); },
}));

const BASE = process.env.WUJIE_QP_MEDIA_TEST_ROOT;
if (BASE && !/^J:[/\\]无界本地版[/\\]projects[/\\]_upstream-wjaigc-restore[/\\]\.superpowers[/\\]sdd[/\\]2026-10-09-sketch-to-code[/\\]mobile-qp-audio-media-(?:red|green)-20261025[/\\]fixtures$/u.test(BASE)) {
  throw Error('QP_OWN_FIXTURE_ROOT_REQUIRED');
}
let ROOT = BASE ? path.resolve(BASE) : '';
let defaultParent: string | undefined;
const VIDEO_URL = '/api/serve-upload/generated-videos/qp-source.mp4';
const TEXT = 'QP 本地合成配音验收，不调用真实模型。';
const cpuChildren: Array<{ pid?: number; code: number | null; closed: boolean; error?: string }> = [];
const cpuTasks: Promise<string>[] = [];
let preparation: Promise<void> | undefined;
let closing = false;
async function cpu(file: 'ffmpeg' | 'ffprobe', args: string[]): Promise<string> {
  if (closing) throw Error('QP_CPU_SPAWN_AFTER_CLEANUP');
  const task = new Promise<string>((resolve, reject) => {
    let error: unknown, stdout = '';
    const child = childProcess.execFile(file, args, { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (failure, out) => { error ??= failure; stdout = out; });
    const record = { pid: child.pid, code: null as number | null, closed: false, error: undefined as string | undefined };
    cpuChildren.push(record);
    child.on('error', failure => { error ??= failure; record.error = String(failure); });
    child.once('close', code => { record.closed = true; record.code = code; if (error) reject(error); else resolve(stdout); });
  });
  cpuTasks.push(task);
  return task;
}
let workspace = '', caseRoot = '', audioBytes: Buffer, wavBytes: Buffer, videoBytes: Buffer, mp2Bytes: Buffer;
let audioPost: typeof import('@/app/api/audio/generate/route')['POST'];
let videoPost: typeof import('@/app/api/video/tools/route')['POST'];
let serveGet: typeof import('@/app/api/serve-upload/[...path]/route')['GET'];
function post(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://qp.local' + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function generate(format: unknown = 'mp3'): Promise<{ response: NextResponse; data: Record<string, unknown> }> {
  const response = await audioPost(post('/api/audio/generate', { text: TEXT, format }));
  const data = await response.json() as Record<string, unknown>;
  return { response, data };
}
async function serve(url: string, range?: string): Promise<NextResponse> {
  const parts = url.startsWith('/api/serve-upload/') ? url.slice('/api/serve-upload/'.length).split('/') : url.split('/').filter(Boolean);
  return serveGet(new NextRequest('http://qp.local' + url, { headers: range ? { range } : {} }), { params: Promise.resolve({ path: parts }) });
}
async function files(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    if (item.isDirectory() && !item.isSymbolicLink()) found.push(...(await files(path.join(directory, item.name))).map(p => item.name + '/' + p));
    else found.push(item.name);
  }
  return found;
}
beforeAll(async (): Promise<void> => {
  preparation = (async (): Promise<void> => {
  if (!ROOT) {
    const os = await vi.importActual<typeof import('os')>('os');
    defaultParent = path.resolve(os.tmpdir());
    ROOT = await fs.mkdtemp(path.join(defaultParent, 'wujie-qp-audio-'));
  } else await fs.mkdir(ROOT);
  const fixture = path.join(ROOT, 'immutable-media'); await fs.mkdir(fixture);
  await cpu('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=10:d=1',
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(fixture, 'source.mp4')]);
  await cpu('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000:duration=1',
    '-ac', '1', '-c:a', 'libmp3lame', '-y', path.join(fixture, 'voice.mp3')]);
  await cpu('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path.join(fixture, 'voice.mp3'), '-c:a', 'pcm_s16le', '-y', path.join(fixture, 'voice.wav')]);
  await cpu('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path.join(fixture, 'voice.wav'), '-c:a', 'mp2', '-f', 'mp2', '-y', path.join(fixture, 'voice.mp2')]);
  [audioBytes, wavBytes, videoBytes, mp2Bytes] = await Promise.all(['voice.mp3', 'voice.wav', 'source.mp4', 'voice.mp2'].map(name => fs.readFile(path.join(fixture, name))));
  })();
  await preparation;
}, 30000);
beforeEach(async (): Promise<void> => {
  vi.resetModules();
  caseRoot = await fs.mkdtemp(path.join(ROOT, 'case-')); workspace = path.join(caseRoot, 'workspace');
  mocks.dataRoot = path.join(caseRoot, 'data'); mocks.scratch = path.join(caseRoot, 'scratch');
  await Promise.all([workspace, mocks.dataRoot, mocks.scratch].map(p => fs.mkdir(p)));
  mocks.auth = true; mocks.requests = 0; mocks.unexpected = 0; mocks.fallbacks = 0; mocks.reply = audioBytes; mocks.mime = 'audio/mpeg'; mocks.declaredBytes = ''; mocks.cancelled = false; mocks.chunked = false; mocks.pulled = 0;
  vi.spyOn(process, 'cwd').mockReturnValue(workspace);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url !== 'https://qp.provider.invalid/v1/audio/speech' || init?.method !== 'POST') {
      mocks.unexpected++; throw Error('QP_UNEXPECTED_NETWORK_OR_FALLBACK');
    }
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;
    if (request.input !== TEXT || request.model !== 'qp-synthetic-tts') throw Error('QP_WRONG_PROVIDER_REQUEST');
    mocks.requests++;
    const body = new ReadableStream<Uint8Array>({
      pull(controller): void {
        if (!mocks.chunked) { controller.enqueue(new Uint8Array(mocks.reply)); controller.close(); return; }
        if (++mocks.pulled <= 12) controller.enqueue(new Uint8Array(8 * 1024 * 1024));
        else controller.close();
      },
      cancel(): void { mocks.cancelled = true; },
    });
    return new Response(body, { headers: { 'content-type': mocks.mime, ...(mocks.declaredBytes ? { 'content-length': mocks.declaredBytes } : {}) } });
  });
  [{ POST: audioPost }, { POST: videoPost }, { GET: serveGet }] = await Promise.all([
    import('@/app/api/audio/generate/route'), import('@/app/api/video/tools/route'), import('@/app/api/serve-upload/[...path]/route'),
  ]);
  await fs.mkdir(path.join(mocks.dataRoot, 'generated-videos'));
  await fs.writeFile(path.join(mocks.dataRoot, 'generated-videos', 'qp-source.mp4'), videoBytes, { flag: 'wx' });
}, 30000);
afterEach(async (): Promise<void> => {
  try {
    expect(mocks.unexpected, 'QP_NO_UNPLANNED_NETWORK').toBe(0);
    expect(mocks.fallbacks, 'QP_NO_LEGACY_S3_OR_SOURCE_FALLBACK').toBe(0);
    expect(cpuChildren.every(c => c.closed && c.code === 0 && !c.error), 'QP_ALL_OWN_CPU_CHILDREN_CLOSED').toBe(true);
    console.log('QP_AUDIO_CLEANUP ' + JSON.stringify({ requests: mocks.requests, unexpected: mocks.unexpected, fallbacks: mocks.fallbacks, cpuChildrenClosed: true }));
  } finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
afterAll(async (): Promise<void> => {
  closing = true;
  const settled = await Promise.allSettled([...(preparation ? [preparation] : []), ...cpuTasks]);
  const errors = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason as unknown);
  console.log('QP_CPU_CHILDREN ' + JSON.stringify(cpuChildren));
  if (errors.length) throw new AggregateError(errors, 'QP_PREPARATION_OR_CPU_CLEANUP_ERROR');
  expect(cpuChildren.every(child => child.closed), 'QP_CPU_CLOSE_BEFORE_SUITE_CLEANUP').toBe(true);
  if (defaultParent) {
    if (path.dirname(path.resolve(ROOT)) !== defaultParent || !path.basename(ROOT).startsWith('wujie-qp-audio-')) throw Error('QP_UNSAFE_FIXTURE_CLEANUP');
    await fs.rm(ROOT, { recursive: true, force: false });
  }
}, 25000);

describe('QP actual TTS artifact handoff', (): void => {
  it('delivers the generated MP3 bytes through file serving into the actual video compositor', async (): Promise<void> => {
    const generated = await generate();
    expect(generated.response.status, 'QP_GENERATION_PRECONDITION').toBe(200);
    const audioUrl = String(generated.data.audioUrl);
    const served = await serve(audioUrl), servedBytes = Buffer.from(await served.arrayBuffer());
    const composed = await videoPost(post('/api/video/tools', { action: 'add-audio', videoUrl: VIDEO_URL, audioUrl, volume: 0.5 }));
    const composite = await composed.json() as Record<string, unknown>;
    console.log('QP_AUDIO_HANDOFF_OBSERVATION ' + JSON.stringify({ generation: generated.response.status, served: served.status, composed: composed.status, contentType: served.headers.get('content-type'), audioUrl, error: composite.error ?? null, requests: mocks.requests }));
    expect(composed.status, 'QP_GENERATED_AUDIO_REACHES_VIDEO_CONSUMER').toBe(200);
    expect(served.status).toBe(200); expect(served.headers.get('content-type')).toBe('audio/mpeg'); expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(servedBytes).toEqual(audioBytes);
    expect(audioUrl).toMatch(/^\/api\/serve-upload\/generated-audio\/tts_[a-zA-Z0-9_]+\.mp3$/u);
    const publicUrl = String(composite.videoUrl);
    expect(publicUrl).toMatch(/^\/api\/serve-upload\/generated-videos\/merged_[a-zA-Z0-9_]+\.mp4$/u);
    const exactOutput = path.join(mocks.dataRoot, publicUrl.slice('/api/serve-upload/'.length));
    const probe = JSON.parse(await cpu('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', exactOutput])) as { streams: Array<{ codec_type: string }>; format: { duration: string } };
    expect(probe.streams.map(s => s.codec_type).sort()).toEqual(['audio', 'video']);
    expect(Number(probe.format.duration)).toBeGreaterThan(0.5); expect(Number(probe.format.duration)).toBeLessThan(2);
    await cpu('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-i', exactOutput, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
    console.log('QP_DECODED_OUTPUT ' + JSON.stringify({ format: 'mp3', streams: ['audio', 'video'], duration: Number(probe.format.duration), sourceHash: createHash('sha256').update(servedBytes).digest('hex') }));
  }, 180000);
  it('serves generated WAV with matching bytes and MIME', async (): Promise<void> => {
    mocks.reply = wavBytes; mocks.mime = 'audio/wav';
    const generated = await generate('wav'); expect(generated.response.status).toBe(200);
    const response = await serve(String(generated.data.audioUrl));
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(wavBytes);
    const composed = await videoPost(post('/api/video/tools', { action: 'add-audio', videoUrl: VIDEO_URL, audioUrl: String(generated.data.audioUrl), volume: 0.5 }));
    const composite = await composed.json() as Record<string, unknown>;
    expect(composed.status).toBe(200);
    const output = path.join(mocks.dataRoot, String(composite.videoUrl).slice('/api/serve-upload/'.length));
    const probe = JSON.parse(await cpu('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', output])) as { streams: Array<{ codec_type: string }>; format: { duration: string } };
    expect(probe.streams.map(stream => stream.codec_type).sort()).toEqual(['audio', 'video']);
    expect(Number(probe.format.duration)).toBeGreaterThan(0.5); expect(Number(probe.format.duration)).toBeLessThan(2);
    await cpu('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
    console.log('QP_DECODED_OUTPUT ' + JSON.stringify({ format: 'wav', streams: ['audio', 'video'], duration: Number(probe.format.duration), sourceHash: createHash('sha256').update(wavBytes).digest('hex') }));
  }, 180000);
  it('keeps unauthenticated calls out of generation and composition', async (): Promise<void> => {
    mocks.auth = false;
    const generated = await generate(); expect(generated.response.status).toBe(401);
    const response = await videoPost(post('/api/video/tools', { action: 'add-audio', videoUrl: VIDEO_URL, audioUrl: '/generated-audio/arbitrary.mp3' }));
    expect(response.status).toBe(401); await response.arrayBuffer(); expect(mocks.requests).toBe(0);
    expect(await files(workspace)).toEqual([]);
  });
  it('rejects an unsafe format before a provider request or file write', async (): Promise<void> => {
    const generated = await generate('../escape');
    expect(generated.response.status).toBe(400); expect(mocks.requests).toBe(0);
    expect(await files(workspace)).toEqual([]); expect(await files(mocks.dataRoot)).toEqual(['generated-videos/qp-source.mp4']);
  });
  it('does not publish an HTML provider response as MP3', async (): Promise<void> => {
    mocks.reply = Buffer.from('<html>qp-invalid-audio</html>'); mocks.mime = 'text/html';
    const generated = await generate();
    expect(generated.response.status).toBeGreaterThanOrEqual(400); expect(generated.data.audioUrl).toBeUndefined();
    expect(await files(workspace)).toEqual([]); expect(await files(mocks.dataRoot)).toEqual(['generated-videos/qp-source.mp4']);
  });
  it('rejects a requested MP3 whose actual bytes are WAV', async (): Promise<void> => {
    mocks.reply = wavBytes; mocks.mime = 'audio/wav';
    const generated = await generate();
    expect(generated.response.status).toBeGreaterThanOrEqual(400); expect(generated.data.audioUrl).toBeUndefined();
    expect(await files(mocks.dataRoot)).toEqual(['generated-videos/qp-source.mp4']);
  });
  it('does not substitute a missing exact artifact with uploads or a legacy basename', async (): Promise<void> => {
    const hash = createHash('sha256').update(audioBytes).digest('hex'), filename = 'tts_1792000000000_abcdef12_' + hash + '.mp3';
    for (const directory of [path.join(mocks.dataRoot, 'uploads', 'generated-audio'), path.join(workspace, 'public', 'generated-audio'), path.join(workspace, 'public', 'uploads')]) {
      await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, filename), audioBytes);
    }
    const response = await serve('/api/serve-upload/generated-audio/' + filename);
    expect(response.status).toBe(404); expect(Buffer.from(await response.arrayBuffer())).not.toEqual(audioBytes);
    const composed = await videoPost(post('/api/video/tools', { action: 'add-audio', videoUrl: VIDEO_URL, audioUrl: '/api/serve-upload/generated-audio/' + filename }));
    expect(composed.status).toBeGreaterThanOrEqual(400); await composed.arrayBuffer();
  });
  it('rejects bytes replaced after generation instead of serving a valid-looking filename', async (): Promise<void> => {
    const generated = await generate(); expect(generated.response.status).toBe(200);
    const url = String(generated.data.audioUrl);
    expect(url).toMatch(/^\/api\/serve-upload\/generated-audio\//u);
    await fs.writeFile(path.join(mocks.dataRoot, url.slice('/api/serve-upload/'.length)), wavBytes);
    const response = await serve(url); expect(response.status).toBe(404); await response.arrayBuffer();
  });
  it.each(['directory-junction', 'hardlink'] as const)('rejects a linked generated artifact: %s', async (kind): Promise<void> => {
    const hash = createHash('sha256').update(audioBytes).digest('hex'), filename = 'tts_1792000000000_abcdef12_' + hash + '.mp3';
    const privateDir = path.join(caseRoot, 'private'); await fs.mkdir(privateDir); const privateFile = path.join(privateDir, filename); await fs.writeFile(privateFile, audioBytes);
    const directory = path.join(mocks.dataRoot, 'generated-audio');
    if (kind === 'directory-junction') await fs.symlink(privateDir, directory, process.platform === 'win32' ? 'junction' : 'dir');
    else { await fs.mkdir(directory); await fs.link(privateFile, path.join(directory, filename)); }
    const response = await serve('/api/serve-upload/generated-audio/' + filename);
    expect(response.status).toBe(404); expect(Buffer.from(await response.arrayBuffer())).not.toEqual(audioBytes);
    expect(await fs.readFile(privateFile)).toEqual(audioBytes);
    if (kind === 'directory-junction') {
      const rejected = await generate(); expect(rejected.response.status).toBeGreaterThanOrEqual(400);
      expect((await fs.readdir(privateDir)).sort()).toEqual([filename]);
    }
  });
  it('serves an audio byte range and rejects an impossible range', async (): Promise<void> => {
    const generated = await generate(), url = String(generated.data.audioUrl);
    const response = await serve(url, 'bytes=0-31'); expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-31/' + audioBytes.length);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(audioBytes.subarray(0, 32));
    const invalid = await serve(url, 'bytes=999999999-'); expect(invalid.status).toBe(416); await invalid.arrayBuffer();
  });
  it('refuses an oversized declared response before storing an artifact', async (): Promise<void> => {
    mocks.declaredBytes = '536870912';
    const generated = await generate(); expect(generated.response.status).toBeGreaterThanOrEqual(400);
    expect(generated.data.audioUrl).toBeUndefined(); expect(await files(mocks.dataRoot)).toEqual(['generated-videos/qp-source.mp4']);
  });
  it('cancels an oversized chunked provider body before consuming it all', async (): Promise<void> => {
    mocks.chunked = true; mocks.mime = 'audio/mpeg';
    const generated = await generate();
    expect(generated.response.status).toBeGreaterThanOrEqual(400); expect(generated.data.audioUrl).toBeUndefined();
    expect(mocks.pulled).toBeGreaterThan(0); expect(mocks.pulled).toBeLessThan(12); expect(mocks.cancelled).toBe(true);
    expect(await files(mocks.dataRoot)).toEqual(['generated-videos/qp-source.mp4']);
  });
  it('rejects an encoded reserved path before the general downloader can read replaced bytes', async (): Promise<void> => {
    const generated = await generate(); expect(generated.response.status).toBe(200);
    const url = String(generated.data.audioUrl);
    await fs.writeFile(path.join(mocks.dataRoot, url.slice('/api/serve-upload/'.length)), wavBytes);
    const response = await videoPost(post('/api/video/tools', { action: 'add-audio', videoUrl: VIDEO_URL, audioUrl: url.replace('/generated-audio/', '/%67enerated-audio/') }));
    await response.arrayBuffer();
    console.log('QP_BOUNDARY_RED_OBSERVATION ' + JSON.stringify({ kind: 'encoded-namespace', status: response.status }));
    expect(response.status, 'QP_ENCODED_AUDIO_ALIAS_REJECTED').toBeGreaterThanOrEqual(400);
  }, 120000);
  it('does not publish a truncated MP3 with the correct MIME and a valid-looking frame header', async (): Promise<void> => {
    mocks.reply = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0]); mocks.mime = 'audio/mpeg';
    const generated = await generate();
    console.log('QP_BOUNDARY_RED_OBSERVATION ' + JSON.stringify({ kind: 'truncated-mp3', status: generated.response.status }));
    expect(generated.response.status, 'QP_TRUNCATED_MP3_REJECTED').toBeGreaterThanOrEqual(400);
    expect(generated.data.audioUrl).toBeUndefined(); expect(await files(mocks.dataRoot)).toEqual(['generated-videos/qp-source.mp4']);
  }, 30000);
  it('does not publish inconsistent WAV block alignment with the correct MIME', async (): Promise<void> => {
    const damaged = Buffer.from(wavBytes), at = damaged.indexOf(Buffer.from('fmt ')) + 8;
    expect(at).toBeGreaterThan(7); damaged.writeUInt16LE(7, at + 12);
    mocks.reply = damaged; mocks.mime = 'audio/wav';
    const generated = await generate('wav');
    console.log('QP_BOUNDARY_RED_OBSERVATION ' + JSON.stringify({ kind: 'inconsistent-wav', status: generated.response.status }));
    expect(generated.response.status, 'QP_INCONSISTENT_WAV_REJECTED').toBeGreaterThanOrEqual(400);
    expect(generated.data.audioUrl).toBeUndefined(); expect(await files(mocks.dataRoot)).toEqual(['generated-videos/qp-source.mp4']);
  }, 30000);
  it('rejects a Windows separator alias of the reserved namespace before ordinary file reads', async (): Promise<void> => {
    const generated = await generate(); expect(generated.response.status).toBe(200);
    const url = String(generated.data.audioUrl);
    await fs.writeFile(path.join(mocks.dataRoot, url.slice('/api/serve-upload/'.length)), wavBytes);
    const response = await videoPost(post('/api/video/tools', { action: 'add-audio', videoUrl: VIDEO_URL, audioUrl: url.replace('/generated-audio/', '/generated-audio%5C') }));
    await response.arrayBuffer();
    console.log('QP_FINAL_RULE_OBSERVATION ' + JSON.stringify({ kind: 'windows-alias', status: response.status }));
    expect(response.status).toBeGreaterThanOrEqual(400);
  }, 120000);
  it('rejects correctly labeled MPEG Layer II bytes when MP3 was requested', async (): Promise<void> => {
    expect(mp2Bytes.length).toBeGreaterThan(12); expect(mp2Bytes[1] & 6).not.toBe(2);
    mocks.reply = mp2Bytes; mocks.mime = 'audio/mpeg';
    const generated = await generate();
    console.log('QP_FINAL_RULE_OBSERVATION ' + JSON.stringify({ kind: 'layer-ii', status: generated.response.status }));
    expect(generated.response.status).toBeGreaterThanOrEqual(400); expect(generated.data.audioUrl).toBeUndefined();
    expect(await files(mocks.dataRoot)).toEqual(['generated-videos/qp-source.mp4']);
  }, 30000);
});

