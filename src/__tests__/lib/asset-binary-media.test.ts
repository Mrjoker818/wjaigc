import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import childProcess, { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assetBinaryFileOps } from '@/lib/asset-core/binary-file-ops';
import fileSystem from 'fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ root: '' }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => state.root }));
// The outbox is tested separately; persistence and local filesystem remain real.
vi.mock('@/lib/asset-core/cleanup-outbox', () => ({
  drainPendingAssetCleanup: async () => ({ completed: 0, failed: 0 }),
  recordAssetCleanupFailure: async () => undefined,
}));
import { persistAssetBytes, recoverExportAssetBytes, validateAssetBinaryFormat } from '@/lib/asset-core/binary-persistence';
import { GET } from '@/app/api/serve-upload/[...path]/route';
import { validateNewBinaryMedia } from '@/lib/asset-core/binary-media-validation';

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8); header.writeUInt32BE(8 + payload.length); header.write(type, 4);
  return Buffer.concat([header, payload]);
}

async function serve(filename: string, range?: string): Promise<Response> {
  return GET(new NextRequest(`http://localhost/api/serve-upload/exports/${filename}`, {
    headers: range ? { Range: range } : {},
  }), { params: Promise.resolve({ path: ['exports', filename] }) });
}

function bmp(): Buffer {
  const bytes = Buffer.alloc(58);
  bytes.write('BM'); bytes.writeUInt32LE(58, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(1, 18); bytes.writeInt32LE(1, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(4, 34);
  bytes[54] = 255;
  return bytes;
}

async function video(extension: 'mp4' | 'webm'): Promise<Buffer> {
  const name = extension === 'mp4' ? 'yjs-task8b1-tiny-valid.mp4.base64' : 'yjs-task8b2-tiny-valid.webm.base64';
  return Buffer.from(await readFile(resolve('tests/fixtures', name), 'utf8'), 'base64');
}

// Independent fixture encoder/known-size reader; never use the production parser to build expectations.
function ebmlElement(id: number, payload: Buffer, unknown = false): Buffer {
  let width = 1;
  while (payload.length >= 2 ** (7 * width) - 1) width++;
  const size = Buffer.alloc(width);
  let value = payload.length;
  for (let i = width - 1; i >= 0; i--) { size[i] = value % 256; value = Math.floor(value / 256); }
  size[0] |= 1 << (8 - width);
  return Buffer.concat([Buffer.from(id.toString(16), 'hex'), unknown ? Buffer.from([0xff]) : size, payload]);
}

interface FixtureElement { id: number; raw: Buffer; payload: Buffer }
function fixtureElements(bytes: Buffer): FixtureElement[] {
  const elements: FixtureElement[] = [];
  const number = (at: number, id: boolean): [number, number] => {
    if (at >= bytes.length || bytes[at] === 0) throw new Error('invalid fixture vint');
    let width = 1;
    while (width <= 8 && !(bytes[at] & (128 >> (width - 1)))) width++;
    if (width > (id ? 4 : 8) || at + width > bytes.length) throw new Error('truncated fixture vint');
    let value = id ? bytes[at] : bytes[at] & ((128 >> (width - 1)) - 1);
    for (let i = 1; i < width; i++) value = value * 256 + bytes[at + i];
    return [value, width];
  };
  for (let at = 0; at < bytes.length;) {
    const [id, idWidth] = number(at, true);
    const [size, sizeWidth] = number(at + idWidth, false);
    const start = at + idWidth + sizeWidth, end = start + size;
    if (end > bytes.length || end <= at) throw new Error('invalid known-size test fixture');
    elements.push({ id, raw: bytes.subarray(at, end), payload: bytes.subarray(start, end) });
    at = end;
  }
  return elements;
}

async function webmParts(): Promise<{ header: Buffer; metadata: Buffer; cluster: Buffer }> {
  const root = fixtureElements(await video('webm'));
  const children = fixtureElements(root.find(item => item.id === 0x18538067)!.payload);
  return {
    header: root.find(item => item.id === 0x1a45dfa3)!.raw,
    metadata: Buffer.concat(children.filter(item => [0x1549a966, 0x1654ae6b].includes(item.id)).map(item => item.raw)),
    cluster: children.find(item => item.id === 0x1f43b675)!.payload,
  };
}

async function inspectWebm(bytes: Buffer, name: string): Promise<unknown> {
  const filename = join(state.root, name);
  await writeFile(filename, bytes, { flag: 'wx' });
  const { stdout, stderr } = await promisify(execFile)('ffprobe', [
    '-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,width,height,nb_read_packets', '-of', 'json', filename,
  ], { windowsHide: true, timeout: 10_000, maxBuffer: 256 * 1024 });
  expect(stderr).toBe('');
  const result: unknown = JSON.parse(stdout);
  console.log('fix2 real ffprobe', name, bytes.length, createHash('sha256').update(bytes).digest('hex'), JSON.stringify(result), 'stderr empty');
  return result;
}

describe('Task8B2a binary media', () => {
  beforeEach(async () => { state.root = await mkdtemp(join(tmpdir(), 'task8b2a-media-')); });
  afterEach(async () => { await rm(state.root, { recursive: true, force: true }); });

  it.each(['mp4', 'webm'] as const)('persists the verified %s pixel dimensions without changing its original bytes', async extension => {
    const bytes = await video(extension);
    const file = await persistAssetBytes({ bytes, filename: `source-size.${extension}`, mimeType: `video/${extension}` });
    expect(file).toMatchObject({ width: 32, height: 24, byteSize: bytes.length });
    expect(await readFile(join(state.root, 'exports', file.url.split('/').at(-1)!))).toEqual(bytes);
  });

  it('persists verified PNG pixels independently of any canvas display size', async () => {
    const bytes = await sharp({ create: { width: 720, height: 480, channels: 3, background: 'green' } }).png().toBuffer();
    const file = await persistAssetBytes({ bytes, filename: 'source-size.png', mimeType: 'image/png' });
    expect(file).toMatchObject({ width: 720, height: 480, byteSize: bytes.length });
    expect(await readFile(join(state.root, 'exports', file.url.split('/').at(-1)!))).toEqual(bytes);
  });

  it('fix2 accepts 14 consecutive unknown-size Clusters equivalent to explicit Clusters', async () => {
    const { header, metadata, cluster } = await webmParts();
    const make = (unknown: boolean): Buffer => Buffer.concat([header, ebmlElement(0x18538067,
      Buffer.concat([metadata, ...Array.from({ length: 14 }, () => ebmlElement(0x1f43b675, cluster, unknown))]), true)]);
    const explicit = make(false), unknown = make(true);
    const expected = { streams: [{ codec_type: 'video', width: 32, height: 24, nb_read_packets: '28' }] };
    const explicitProbe = await inspectWebm(explicit, 'explicit.webm');
    expect(explicitProbe).toMatchObject(expected);
    expect(await inspectWebm(unknown, 'unknown.webm')).toEqual(explicitProbe);
    await expect(validateNewBinaryMedia(explicit, 'video/webm')).resolves.toBeUndefined();
    await expect(validateNewBinaryMedia(unknown, 'video/webm')).resolves.toBeUndefined();
    const file = await persistAssetBytes({ bytes: unknown, filename: 'live-clusters.webm', mimeType: 'video/webm' });
    const filename = file.url.split('/').at(-1)!;
    await file.cleanup();
    await recoverExportAssetBytes({ bytes: unknown, filename, mimeType: 'video/webm' });
    const response = await serve(filename, 'bytes=0-63');
    expect(response.status).toBe(206);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(unknown.subarray(0, 64));
    expect(await readFile(join(state.root, 'exports', filename))).toEqual(unknown);
  });

  it('fix2 ends an unknown Cluster at a legal Tags sibling without spending a nesting level', async () => {
    const { header, metadata, cluster } = await webmParts();
    const tagName = ebmlElement(0x45a3, Buffer.from('TEST'));
    let simpleTag = ebmlElement(0x67c8, Buffer.concat([tagName, ebmlElement(0x4487, Buffer.from('value'))]));
    // Nine recursive SimpleTags reach, but do not exceed, the existing depth 12 limit.
    for (let i = 1; i < 9; i++) simpleTag = ebmlElement(0x67c8, Buffer.concat([tagName, simpleTag]));
    const tags = ebmlElement(0x1254c367, ebmlElement(0x7373, Buffer.concat([ebmlElement(0x63c0, Buffer.alloc(0)), simpleTag])));
    const bytes = Buffer.concat([header, ebmlElement(0x18538067, Buffer.concat([
      metadata, ebmlElement(0x1f43b675, cluster, true), tags, ebmlElement(0x1f43b675, cluster, true),
    ]), true)]);
    expect(await inspectWebm(bytes, 'tags-sibling.webm')).toMatchObject({ streams: [{ nb_read_packets: '4' }] });
    await expect(validateNewBinaryMedia(bytes, 'video/webm')).resolves.toBeUndefined();
  });

  it.each([0x18538067, 0x1a45dfa3])('fix2 unwinds unknown Cluster and Segment at root/ancestor %s', async rootId => {
    const { header, metadata, cluster } = await webmParts();
    const segment = ebmlElement(0x18538067, Buffer.concat([metadata, ebmlElement(0x1f43b675, cluster, true)]), true);
    const bytes = Buffer.concat([header, ...Array.from({ length: 14 }, (_, i) =>
      i > 0 && rootId === 0x1a45dfa3 ? Buffer.concat([header, segment]) : segment)]);
    // Multi-document/segment handling is still subject to real ffprobe. Observe that
    // structural traversal reaches it rather than falsely exhausting nesting depth.
    const spy = vi.spyOn(childProcess, 'execFile');
    try {
      const outcome = await validateNewBinaryMedia(bytes, 'video/webm').then(() => 'accepted').catch(error => {
        expect(error).toBeInstanceOf(TypeError); expect(error.message).toBe('ASSET_BINARY_FORMAT_INVALID');
        return 'real ffprobe rejected after structural traversal';
      });
      expect(spy).toHaveBeenCalledTimes(1);
      console.log('fix2 root boundary', rootId.toString(16), outcome);
    } finally { spy.mockRestore(); }
  });

  it('fix2 keeps Global Void and CRC inside unknown Clusters with trailing media blocks', async () => {
    const { header, metadata, cluster } = await webmParts();
    const parts = fixtureElements(cluster);
    // Void payload deliberately contains apparent boundary IDs; it is opaque padding.
    const body = Buffer.concat([parts[0].raw, ebmlElement(0xec, Buffer.from('1f43b675ff18538067ff', 'hex')),
      ...parts.slice(1).map(item => item.raw)]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const checksum = Buffer.alloc(4); checksum.writeUInt32LE((crc ^ 0xffffffff) >>> 0);
    const payload = Buffer.concat([ebmlElement(0xbf, checksum), body]);
    const make = (unknown: boolean): Buffer => Buffer.concat([header, ebmlElement(0x18538067,
      Buffer.concat([metadata, ...Array.from({ length: 14 }, () => ebmlElement(0x1f43b675, payload, unknown))]), true)]);
    const explicit = make(false), unknown = make(true);
    const expected = await inspectWebm(explicit, 'globals-explicit.webm');
    expect(expected).toMatchObject({ streams: [{ nb_read_packets: '28' }] });
    expect(await inspectWebm(unknown, 'globals-unknown.webm')).toEqual(expected);
    await expect(validateNewBinaryMedia(unknown, 'video/webm')).resolves.toBeUndefined();
  });

  it.each(['id', 'size', 'payload', 'root-in-known-parent'] as const)('fix2 cannot escape a known parent through %s', async fault => {
    const { header, metadata, cluster } = await webmParts();
    const truncated = fault === 'id' ? Buffer.from([0x1f]) : fault === 'size' ? Buffer.from([0xec, 0x40])
      : fault === 'payload' ? Buffer.from([0xec, 0x84, 0]) : header;
    const bytes = Buffer.concat([header, ebmlElement(0x18538067, Buffer.concat([
      metadata, ebmlElement(0x1f43b675, Buffer.concat([cluster, truncated]), true),
    ])), header, ebmlElement(0x18538067, Buffer.concat([metadata, ebmlElement(0x1f43b675, cluster)]))]);
    const spy = vi.spyOn(childProcess, 'execFile');
    try {
      await expect(validateNewBinaryMedia(bytes, 'video/webm')).rejects.toThrow('ASSET_BINARY_FORMAT_INVALID');
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('fix2 terminates at the exact known parent end without absorbing the next document', async () => {
    const { header, metadata, cluster } = await webmParts();
    const segment = ebmlElement(0x18538067, Buffer.concat([metadata, ebmlElement(0x1f43b675, cluster, true)]));
    const bytes = Buffer.concat(Array.from({ length: 14 }, () => Buffer.concat([header, segment])));
    const spy = vi.spyOn(childProcess, 'execFile');
    try {
      // FFmpeg 8.1 reports unknown-size children in finite parents as an error.
      // The structure is legal EBML; retain the existing strict stderr contract.
      await expect(validateNewBinaryMedia(bytes, 'video/webm')).rejects.toThrow('ASSET_BINARY_FORMAT_INVALID');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });

  it.each(['known-cluster', 'unknown-tracks', 'depth-13'] as const)('fix2 retains structural rejection for %s before probing', async fault => {
    const { header, metadata, cluster } = await webmParts();
    let invalid = ebmlElement(0x1f43b675, Buffer.concat([cluster, ebmlElement(0x1f43b675, cluster, true)]));
    if (fault === 'unknown-tracks') invalid = ebmlElement(0x1654ae6b, Buffer.alloc(0), true);
    if (fault === 'depth-13') {
      let tags = ebmlElement(0x4487, Buffer.from('value'));
      for (let i = 0; i < 10; i++) tags = ebmlElement(0x67c8, Buffer.concat([ebmlElement(0x45a3, Buffer.from('TEST')), tags]));
      invalid = Buffer.concat([ebmlElement(0x1f43b675, cluster, true), ebmlElement(0x1254c367, ebmlElement(0x7373, tags))]);
    }
    const bytes = Buffer.concat([header, ebmlElement(0x18538067, Buffer.concat([metadata, invalid]), true)]);
    const spy = vi.spyOn(childProcess, 'execFile');
    try {
      await expect(validateNewBinaryMedia(bytes, 'video/webm')).rejects.toThrow('ASSET_BINARY_FORMAT_INVALID');
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('fix2 shares work across unknown siblings and metadata across their Tags siblings', async () => {
    const { header, metadata, cluster } = await webmParts();
    const padding = Buffer.concat(Array.from({ length: 4096 }, () => ebmlElement(0xec, Buffer.alloc(0))));
    const work = Buffer.concat([header, ebmlElement(0x18538067, Buffer.concat([metadata,
      ...Array.from({ length: 4 }, () => ebmlElement(0x1f43b675, padding, true)),
    ]), true)]);
    const tag = ebmlElement(0x1254c367, ebmlElement(0x7373, ebmlElement(0x67c8, Buffer.concat([
      ebmlElement(0x45a3, Buffer.from('BINARY')), ebmlElement(0x4485, Buffer.alloc(4 * 1024 * 1024)),
    ]))));
    const largeMetadata = Buffer.concat([header, ebmlElement(0x18538067, Buffer.concat([metadata,
      ebmlElement(0x1f43b675, cluster, true), tag, ebmlElement(0x1f43b675, cluster, true), tag,
    ]), true)]);
    const spy = vi.spyOn(childProcess, 'execFile');
    try {
      await expect(validateNewBinaryMedia(work, 'video/webm')).rejects.toThrow('ASSET_MEDIA_PARSE_LIMIT');
      await expect(validateNewBinaryMedia(largeMetadata, 'video/webm')).rejects.toThrow('ASSET_MEDIA_PARSE_LIMIT');
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it.each(['mp4', 'webm'] as const)('persists and restores real %s bytes unchanged', async extension => {
    const bytes = await video(extension);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const file = await persistAssetBytes({ bytes, filename: `tiny.${extension}`, mimeType: `video/${extension}` });
    const filename = file.url.split('/').at(-1)!;
    expect(file.checksum).toBe(checksum);
    expect(await readFile(join(state.root, 'exports', filename))).toEqual(bytes);
    await file.cleanup();
    await recoverExportAssetBytes({ bytes, filename, mimeType: `video/${extension}` });
    expect(await readFile(join(state.root, 'exports', filename))).toEqual(bytes);
    expect(await readdir(join(state.root, 'exports'))).toEqual([filename]);
  });

  it.each(['gif', 'avif', 'bmp'] as const)('persists and restores real %s image without transcoding', async format => {
    const bytes = format === 'bmp' ? bmp() : await sharp({ create: { width: 2, height: 3, channels: 4, background: '#ff0000' } })[format]().toBuffer();
    const mimeType = `image/${format}`;
    const file = await persistAssetBytes({ bytes, filename: `tiny.${format}`, mimeType });
    const filename = file.url.split('/').at(-1)!;
    await file.cleanup();
    await recoverExportAssetBytes({ bytes, filename, mimeType });
    expect(await readFile(join(state.root, 'exports', filename))).toEqual(bytes);
  });

  it.each(['mp4', 'webm'] as const)('rejects truncated %s even with a correct filename digest', async extension => {
    const bytes = (await video(extension)).subarray(0, -8);
    const filename = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}-tiny.${extension}`;
    await expect(recoverExportAssetBytes({ bytes, filename, mimeType: `video/${extension}` })).rejects.toThrow('ASSET_BINARY_FORMAT_INVALID');
    expect(await readdir(state.root)).toEqual([]);
  });

  it('rejects WebP masquerading as any new format', async () => {
    const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).webp().toBuffer();
    for (const mimeType of ['image/gif', 'image/avif', 'image/bmp', 'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']) {
      await expect(validateAssetBinaryFormat(bytes, mimeType)).rejects.toThrow('ASSET_BINARY_FORMAT_INVALID');
    }
  });

  it.each(['offset', 'stride', 'compression', 'pixels'] as const)('rejects BMP with invalid %s', async fault => {
    const bytes = bmp();
    if (fault === 'offset') bytes.writeUInt32LE(1, 10);
    if (fault === 'stride') bytes.writeInt32LE(2, 22);
    if (fault === 'compression') bytes.writeUInt32LE(1, 30);
    if (fault === 'pixels') { bytes.writeInt32LE(100000, 18); bytes.writeInt32LE(100000, 22); }
    await expect(validateAssetBinaryFormat(bytes, 'image/bmp')).rejects.toThrow('ASSET_BINARY_FORMAT_INVALID');
  });

  it.each(['mp4', 'webm'] as const)('serves verified %s ranges and no-Range with original bytes', async extension => {
    const bytes = await video(extension);
    const file = await persistAssetBytes({ bytes, filename: `tiny.${extension}`, mimeType: `video/${extension}` });
    const filename = file.url.split('/').at(-1)!;
    for (const [range, start, end] of [['bytes=2-9', 2, 9], ['bytes=-7', bytes.length - 7, bytes.length - 1]] as const) {
      const response = await serve(filename, range);
      expect(response.status).toBe(206);
      expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/${bytes.length}`);
      expect(response.headers.get('accept-ranges')).toBe('bytes');
      expect(response.headers.get('content-type')).toBe(`video/${extension}`);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(start, end + 1));
    }
    const full = await serve(filename);
    expect(full.status).toBe(200);
    expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
    const invalid = await serve(filename, `bytes=${bytes.length}-`);
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get('content-range')).toBe(`bytes */${bytes.length}`);
    await writeFile(join(state.root, 'exports', filename), Buffer.alloc(bytes.length));
    expect((await serve(filename, 'bytes=0-3')).status).toBe(404);
  });

  it('fails closed for forged export names even when old public files exist', async () => {
    const directory = join(state.root, 'uploads', 'exports');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'forged.mp4'), 'public fallback secret');
    const response = await serve('forged.mp4');
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('public fallback secret');
  });

  it.each(['mov', 'm4v'] as const)('validates real %s container and preserves bytes', async extension => {
    const target = join(state.root, `fixture.${extension}`);
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x24:r=2', '-t', '0.5', '-c:v', 'libx264', '-threads', '1', '-f', extension === 'mov' ? 'mov' : 'ipod', target], { timeout: 10000, windowsHide: true });
    const bytes = await readFile(target);
    const file = await persistAssetBytes({ bytes, filename: `tiny.${extension}`, mimeType: extension === 'mov' ? 'video/quicktime' : 'video/x-m4v' });
    expect(await readFile(join(state.root, 'exports', file.url.split('/').at(-1)!))).toEqual(bytes);
    if (extension === 'mov') {
      // QuickTime can identify itself through moov/mdat without an ISO ftyp brand.
      const unbranded = Buffer.from(bytes);
      expect(unbranded.toString('ascii', 4, 8)).toBe('ftyp');
      unbranded.write('free', 4); // Keep offsets and packet bytes unchanged.
      const legacyPath = join(state.root, 'unbranded.mov');
      await writeFile(legacyPath, unbranded);
      const probe = await promisify(execFile)('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', legacyPath], { timeout: 10000, windowsHide: true });
      expect(JSON.parse(probe.stdout).streams[0]).toMatchObject({ codec_type: 'video', width: 32, height: 24 });
      const restored = await persistAssetBytes({ bytes: unbranded, filename: 'unbranded.mov', mimeType: 'video/quicktime' });
      expect(await readFile(join(state.root, 'exports', restored.url.split('/').at(-1)!))).toEqual(unbranded);
    }
  });

  it('rejects audio-only MP4 and external MOV data references', async () => {
    const target = join(state.root, 'audio.mp4');
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '0.1', '-c:a', 'aac', target], { timeout: 10000, windowsHide: true });
    await expect(validateAssetBinaryFormat(await readFile(target), 'video/mp4')).rejects.toThrow('ASSET_BINARY_FORMAT_INVALID');
    const bytes = await video('mp4');
    const at = bytes.indexOf(Buffer.from('url '));
    expect(at).toBeGreaterThan(0);
    bytes.writeUInt32BE(0, at + 4);
    await expect(validateAssetBinaryFormat(bytes, 'video/mp4')).rejects.toThrow('ASSET_BINARY_FORMAT_INVALID');
  });

  it('rejects truncated GIF and HEIF brands pretending to be AVIF', async () => {
    const image = sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } });
    const gif = await image.clone().gif().toBuffer();
    await expect(validateAssetBinaryFormat(gif.subarray(0, 20), 'image/gif')).rejects.toThrow('ASSET_BINARY_FORMAT_INVALID');
    const avif = await image.clone().avif().toBuffer();
    for (let at = 0; at < avif.length - 4; at++) if (avif.toString('ascii', at, at + 4) === 'avif') avif.write('heic', at);
    await expect(validateAssetBinaryFormat(avif, 'image/avif')).rejects.toThrow('ASSET_BINARY_FORMAT_INVALID');
  });

  it('does not publish when source bytes change during async validation', async () => {
    const bytes = await video('mp4');
    const expected = Buffer.from(bytes);
    const pending = persistAssetBytes({ bytes, filename: 'tiny.mp4', mimeType: 'video/mp4' });
    bytes.fill(0);
    // A caller-owned Buffer must not change the bytes validated, hashed and published.
    const file = await pending;
    expect(await readFile(join(state.root, 'exports', file.url.split('/').at(-1)!))).toEqual(expected);
  });

  it('aborts after local publication and removes only this call target', async () => {
    const controller = new AbortController();
    const link = assetBinaryFileOps.link;
    const spy = vi.spyOn(assetBinaryFileOps, 'link').mockImplementation(async (from, to) => {
      await link(from, to); controller.abort(new Error('cancel after publication'));
    });
    try {
      await expect(persistAssetBytes({ bytes: await video('mp4'), filename: 'tiny.mp4', mimeType: 'video/mp4', signal: controller.signal })).rejects.toThrow('cancel after publication');
      expect(await readdir(join(state.root, 'exports'))).toEqual([]);
    } finally { spy.mockRestore(); }
  });

  it('bounds concurrent media preparation without retaining a work queue', async () => {
    const bytes = await video('mp4');
    const outcomes = await Promise.allSettled(Array.from({ length: 3 }, () => persistAssetBytes({ bytes, filename: 'tiny.mp4', mimeType: 'video/mp4' })));
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    const rejected = outcomes.find(result => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.message).toBe('ASSET_MEDIA_BUSY');
  });

  it('limits large Range bodies to 16 MiB, streams full no-Range, and releases admission on cancel', async () => {
    const padding = Buffer.alloc(17 * 1024 * 1024);
    padding.writeUInt32BE(padding.length, 0); padding.write('free', 4);
    const bytes = Buffer.concat([await video('mp4'), padding]);
    const file = await persistAssetBytes({ bytes, filename: 'large.mp4', mimeType: 'video/mp4' });
    const filename = file.url.split('/').at(-1)!;
    const range = await serve(filename, 'bytes=0-');
    expect(range.status).toBe(206);
    expect(range.headers.get('content-length')).toBe(String(16 * 1024 * 1024));
    expect(Buffer.from(await range.arrayBuffer()).equals(bytes.subarray(0, 16 * 1024 * 1024))).toBe(true);
    const full = await serve(filename);
    expect(full.status).toBe(200);
    expect(Buffer.from(await full.arrayBuffer()).equals(bytes)).toBe(true);
    const held: Response[] = [];
    try {
      for (let i = 0; i < 4; i++) { const response = await serve(filename); expect(response.status).toBe(200); held.push(response); }
      expect((await serve(filename)).status).toBe(503);
    } finally { await Promise.all(held.map(response => response.body!.cancel())); }
    const available = await serve(filename, 'bytes=0-7');
    expect(available.status).toBe(206);
    expect(Buffer.from(await available.arrayBuffer())).toEqual(bytes.subarray(0, 8));
  });

  it('rejects a damaged staging write without uploading or publishing changed bytes', async () => {
    const write = assetBinaryFileOps.writeFile;
    const spy = vi.spyOn(assetBinaryFileOps, 'writeFile').mockImplementation(async (target, bytes, options) => {
      return write(target, Buffer.isBuffer(bytes) ? bytes.subarray(0, 8) : bytes, options);
    });
    try {
      await expect(persistAssetBytes({ bytes: await video('mp4'), filename: 'tiny.mp4', mimeType: 'video/mp4' })).rejects.toThrow();
      expect(await readdir(join(state.root, 'exports'))).toEqual([]);
    } finally { spy.mockRestore(); }
  });

  it('refuses persistence and recovery through a linked export directory', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'task8b2a-outside-'));
    try {
      await symlink(outside, join(state.root, 'exports'), process.platform === 'win32' ? 'junction' : 'dir');
      const bytes = await video('mp4');
      await expect(persistAssetBytes({ bytes, filename: 'tiny.mp4', mimeType: 'video/mp4' })).rejects.toThrow();
      await expect(recoverExportAssetBytes({ bytes, filename: `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}-tiny.mp4`, mimeType: 'video/mp4' })).rejects.toThrow();
      expect(await readdir(outside)).toEqual([]);
    } finally { await rm(join(state.root, 'exports'), { force: true, recursive: true }); await rm(outside, { recursive: true, force: true }); }
  });

  it('closes a checked file when cancellation races the asynchronous open', async () => {
    const file = await persistAssetBytes({ bytes: await video('mp4'), filename: 'tiny.mp4', mimeType: 'video/mp4' });
    const filename = file.url.split('/').at(-1)!;
    const controller = new AbortController();
    const openFile = fileSystem.open;
    const handles: Awaited<ReturnType<typeof openFile>>[] = [];
    const spy = vi.spyOn(fileSystem, 'open').mockImplementation(async (...args) => {
      const handle = await openFile(...args); handles.push(handle); controller.abort(); return handle;
    });
    try {
      const response = await GET(new NextRequest(`http://localhost${file.url}`, { signal: controller.signal }), { params: Promise.resolve({ path: ['exports', filename] }) });
      expect(response.status).toBe(404);
      expect(handles.length).toBeGreaterThan(0);
      expect(handles.every(handle => handle.fd === -1)).toBe(true);
    } finally { spy.mockRestore(); await Promise.all(handles.map(handle => handle.close())); }
  });

  it('cleans a partially written exclusive fallback without touching earlier media', async () => {
    const bytes = await video('mp4');
    const kept = await persistAssetBytes({ bytes, filename: 'kept.mp4', mimeType: 'video/mp4' });
    const linkSpy = vi.spyOn(assetBinaryFileOps, 'link').mockRejectedValue(Object.assign(new Error('no hard links'), { code: 'EPERM' }));
    const write = assetBinaryFileOps.writeFile;
    let writes = 0;
    const writeSpy = vi.spyOn(assetBinaryFileOps, 'writeFile').mockImplementation(async (target, data, options) => {
      if (++writes === 2) {
        await write(target, Buffer.from('partial'), options); throw new Error('injected disk failure');
      }
      return write(target, data, options);
    });
    try {
      await expect(persistAssetBytes({ bytes, filename: 'failed.mp4', mimeType: 'video/mp4' })).rejects.toThrow('injected disk failure');
      expect(await readdir(join(state.root, 'exports'))).toEqual([kept.url.split('/').at(-1)!]);
      expect(await readFile(join(state.root, 'exports', kept.url.split('/').at(-1)!))).toEqual(bytes);
      expect(writes).toBe(2);
    } finally { linkSpy.mockRestore(); writeSpy.mockRestore(); }
  });

  it('compensates its restored target when temporary unlink fails after publication', async () => {
    const bytes = await video('mp4');
    const filename = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}-tiny.mp4`;
    const remove = assetBinaryFileOps.rm;
    let failed = false;
    const spy = vi.spyOn(assetBinaryFileOps, 'rm').mockImplementation(async (target, options) => {
      if (!failed && String(target).endsWith('.tmp')) { failed = true; throw new Error('injected recovery unlink failure'); }
      return remove(target, options);
    });
    try {
      await expect(recoverExportAssetBytes({ bytes, filename, mimeType: 'video/mp4' })).rejects.toThrow('injected recovery unlink failure');
      expect(await readdir(join(state.root, 'exports'))).toEqual([]);
    } finally { spy.mockRestore(); }
  });

  it('rejects bounded ftyp brand flooding before invoking the native decoder', async () => {
    const bytes = Buffer.concat([box('ftyp', Buffer.concat([Buffer.from('avif'), Buffer.alloc(4), Buffer.from('avif'.repeat(1024))])), box('mdat', Buffer.from('x'))]);
    await expect(validateNewBinaryMedia(bytes, 'image/avif')).rejects.toThrow('ASSET_MEDIA_PARSE_LIMIT');
  });

  it('shares BMFF box work across nested containers instead of resetting per call', async () => {
    const leaf = box('free', Buffer.alloc(0));
    const track = box('trak', Buffer.concat(Array.from({ length: 4096 }, () => leaf)));
    const bytes = Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0')), box('moov', Buffer.concat(Array.from({ length: 4 }, () => track))), box('mdat', Buffer.from('x'))]);
    await expect(validateNewBinaryMedia(bytes, 'video/mp4')).rejects.toThrow('ASSET_MEDIA_PARSE_LIMIT');
  });

  it('rejects oversized metadata while preserving the separate media byte budget', async () => {
    const bytes = Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0')), box('moov', box('udta', Buffer.alloc(8 * 1024 * 1024))), box('mdat', Buffer.from('x'))]);
    await expect(validateNewBinaryMedia(bytes, 'video/mp4')).rejects.toThrow('ASSET_MEDIA_PARSE_LIMIT');
  });

  it('shares EBML element work across separate nested masters with a small input', async () => {
    const voidElement = Buffer.from([0xec, 0x80]);
    const clusterPayload = Buffer.concat(Array.from({ length: 4096 }, () => voidElement));
    const cluster = Buffer.concat([Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x20, 0x20, 0x00]), clusterPayload]);
    const bytes = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84]), Buffer.from('webm'),
      Buffer.from([0x18, 0x53, 0x80, 0x67, 0xff]), ...Array.from({ length: 4 }, () => cluster)]);
    await expect(validateNewBinaryMedia(bytes, 'video/webm')).rejects.toThrow('ASSET_MEDIA_PARSE_LIMIT');
  });

  it('stops the initial full read after the in-flight chunk completes on abort', async () => {
    const bytes = Buffer.concat([await video('mp4'), box('free', Buffer.alloc(17 * 1024 * 1024))]);
    const file = await persistAssetBytes({ bytes, filename: 'cancel-read.mp4', mimeType: 'video/mp4' });
    const filename = file.url.split('/').at(-1)!;
    const controller = new AbortController();
    const openFile = fileSystem.open;
    const handles: Awaited<ReturnType<typeof openFile>>[] = [];
    let reads = 0;
    let arrived!: () => void; const started = new Promise<void>(resolve => { arrived = resolve; });
    let resume!: () => void; const barrier = new Promise<void>(resolve => { resume = resolve; });
    const spy = vi.spyOn(fileSystem, 'open').mockImplementation(async (...args) => {
      const handle = await openFile(...args); handles.push(handle);
      const read = handle.read.bind(handle);
      vi.spyOn(handle, 'read').mockImplementation((async (...args: Parameters<typeof read>) => {
        reads++; const result = await read(...args);
        if (reads === 1) { arrived(); await barrier; }
        return result;
      }) as typeof handle.read);
      return handle;
    });
    try {
      let settled = false;
      const pending = GET(new NextRequest(`http://localhost${file.url}`, { signal: controller.signal }), { params: Promise.resolve({ path: ['exports', filename] }) })
        .then(result => { settled = true; return result; });
      await started; controller.abort();
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(handles.every(handle => handle.fd !== -1)).toBe(true);
      resume();
      expect((await pending).status).toBe(404);
      expect(reads).toBe(1);
      expect(handles.every(handle => handle.fd === -1)).toBe(true);
    } finally { resume(); spy.mockRestore(); await Promise.all(handles.map(handle => handle.close())); }
  });

  it('keeps aborted ffprobe validation pending until the real process close boundary', async () => {
    const bytes = await video('mp4');
    const controller = new AbortController();
    const emit = childProcess.ChildProcess.prototype.emit as (
      this: childProcess.ChildProcess, event: string | symbol, ...args: unknown[]
    ) => boolean;
    let release!: () => void;
    let reached!: () => void; const atClose = new Promise<void>(resolve => { reached = resolve; });
    const spy = vi.spyOn(childProcess.ChildProcess.prototype, 'emit').mockImplementation(function (
      this: childProcess.ChildProcess, event: string | symbol, ...args: unknown[]
    ): boolean {
      if (event === 'spawn') {
        const result = emit.call(this, event, ...args);
        controller.abort(new Error('stop probe')); return result;
      }
      if (event === 'close') {
        expect(() => process.kill(this.pid!, 0)).toThrow();
        release = () => { emit.call(this, event, ...args); }; reached(); return true;
      }
      return emit.call(this, event, ...args);
    });
    let settled = false;
    const pending = validateNewBinaryMedia(bytes, 'video/mp4', controller.signal).then(
      () => { settled = true; return 'resolved'; },
      error => { settled = true; return error.message; },
    );
    try {
      await atClose;
      // Let the old AbortError callback and filesystem cleanup finish if incorrectly detached.
      for (let i = 0; i < 10; i++) await new Promise<void>(resolve => setImmediate(resolve));
      expect(settled).toBe(false);
    } finally { release(); spy.mockRestore(); }
    expect(await pending).toBe('stop probe');
  });
});
