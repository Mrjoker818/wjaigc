import fs from 'node:fs/promises';
import { constants, type BigIntStats } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { getServerDataRoot } from '@/lib/server-data-root';

export type GeneratedAudioFormat = 'mp3' | 'wav';
export interface GeneratedAudioArtifact {
  filename: string; audioUrl: string; format: GeneratedAudioFormat; mimeType: string; size: number;
}
export interface GeneratedAudioBytes extends GeneratedAudioArtifact { buffer: Buffer }
const MAX_BYTES = 25 * 1024 * 1024;
const PREFIX = '/api/serve-upload/generated-audio/';
const verifiedContent = new Set<string>();
let activeAudioChecks = 0;
function invalid(): never { throw new TypeError('生成音频文件无效'); }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
export function isGeneratedAudioFormat(value: unknown): value is GeneratedAudioFormat { return value === 'mp3' || value === 'wav'; }
export function isGeneratedAudioLocation(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { return /^\/api\/serve-upload\/generated-audio(?:\/|$)/iu.test(decodeURIComponent(value.split(/[?#]/u, 1)[0]).replaceAll('\\', '/')); }
  catch { return false; }
}
function mime(format: GeneratedAudioFormat): string { return format === 'mp3' ? 'audio/mpeg' : 'audio/wav'; }
function identity(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs, stats.nlink].join(':');
}
function validateBytes(bytes: Buffer, format: GeneratedAudioFormat): void {
  if (bytes.length < 12 || bytes.length > MAX_BYTES) invalid();
  if (format === 'mp3') {
    let at = 0;
    if (bytes.toString('ascii', 0, 3) === 'ID3') {
      if (![2, 3, 4].includes(bytes[3]) || bytes.subarray(6, 10).some(value => value & 0x80)) invalid();
      at = 10 + bytes[6] * 2097152 + bytes[7] * 16384 + bytes[8] * 128 + bytes[9];
      if (bytes[3] === 4 && (bytes[5] & 0x10)) at += 10;
    }
    if (at + 4 >= bytes.length || bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0
      || ((bytes[at + 1] >> 3) & 3) === 1 || (bytes[at + 1] & 6) !== 2
      || [0, 15].includes(bytes[at + 2] >> 4) || ((bytes[at + 2] >> 2) & 3) === 3) invalid();
    return;
  }
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE'
    || bytes.readUInt32LE(4) + 8 !== bytes.length) invalid();
  let at = 12, count = 0, hasFormat = false, hasData = false, alignment = 0;
  const dataSizes: number[] = [];
  while (at < bytes.length) {
    if (++count > 4096 || at + 8 > bytes.length) invalid();
    const size = bytes.readUInt32LE(at + 4), start = at + 8, end = start + size;
    if (end > bytes.length) invalid();
    const kind = bytes.toString('ascii', at, at + 4);
    if (kind === 'fmt ') {
      if (size < 16 || ![1, 3, 65534].includes(bytes.readUInt16LE(start))
        || bytes.readUInt16LE(start + 2) < 1 || bytes.readUInt16LE(start + 2) > 32
        || bytes.readUInt32LE(start + 4) < 1 || bytes.readUInt32LE(start + 4) > 384000
        || bytes.readUInt16LE(start + 12) < 1) invalid();
      hasFormat = true;
      const channels = bytes.readUInt16LE(start + 2), rate = bytes.readUInt32LE(start + 4), bits = bytes.readUInt16LE(start + 14);
      alignment = bytes.readUInt16LE(start + 12);
      if (![8, 16, 24, 32, 64].includes(bits) || alignment !== channels * bits / 8
        || bytes.readUInt32LE(start + 8) !== rate * alignment
        || (bytes.readUInt16LE(start) === 3 && ![32, 64].includes(bits))) invalid();
    }
    if (kind === 'data' && size > 0) { hasData = true; dataSizes.push(size); }
    at = end + (size & 1);
  }
  if (at !== bytes.length || !hasFormat || !hasData || dataSizes.some(size => size % alignment !== 0)) invalid();
}
async function validateAudio(bytes: Buffer, format: GeneratedAudioFormat, signal?: AbortSignal): Promise<void> {
  validateBytes(bytes, format); signal?.throwIfAborted();
  const key = format + ':' + createHash('sha256').update(bytes).digest('hex');
  if (verifiedContent.has(key)) return;
  if (activeAudioChecks >= 2) throw new Error('音频校验繁忙，请稍后重试');
  activeAudioChecks++;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-threads', '1',
        '-protocol_whitelist', 'pipe', '-format_whitelist', format, '-f', format, '-i', 'pipe:0',
        '-map', '0:a:0', '-f', 'null', '-'], {
        windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'], timeout: 15000, killSignal: 'SIGKILL', signal,
      });
      let failure: unknown, errorBytes = 0;
      const fail = (error: unknown): void => { failure ??= error; child.kill('SIGKILL'); };
      child.on('error', error => { failure ??= error; });
      child.stdin.on('error', error => fail(new TypeError('生成音频无法解码', { cause: error })));
      child.stderr.on('data', (chunk: Buffer) => {
        errorBytes += chunk.length;
        if (errorBytes > 64 * 1024) fail(new Error('音频校验输出过大'));
      });
      child.once('close', (code, exitSignal) => {
        if (failure !== undefined || code !== 0 || exitSignal !== null || errorBytes > 0) reject(failure ?? new TypeError('生成音频无法解码'));
        else resolve();
      });
      try { child.stdin.end(bytes); } catch (error) { fail(error); }
    });
    if (verifiedContent.size >= 128) verifiedContent.delete(verifiedContent.values().next().value!);
    verifiedContent.add(key);
  } finally { activeAudioChecks--; }
}
async function readResponse(response: Response, format: GeneratedAudioFormat, signal?: AbortSignal): Promise<Buffer> {
  const reader = response.body?.getReader(); if (!reader) invalid();
  let finished = false, failure: unknown;
  try {
    const type = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
    const allowed = format === 'mp3' ? ['audio/mpeg', 'audio/mp3'] : ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'];
    if (type && type !== 'application/octet-stream' && !allowed.includes(type)) invalid();
    const header = response.headers.get('content-length');
    if (header !== null && (!/^\d+$/u.test(header) || !Number.isSafeInteger(Number(header)) || Number(header) < 1 || Number(header) > MAX_BYTES)) invalid();
    const chunks: Buffer[] = []; let length = 0;
    for (;;) {
      signal?.throwIfAborted(); const part = await reader.read(); signal?.throwIfAborted();
      if (part.done) break;
      length += part.value.byteLength; if (length > MAX_BYTES) invalid();
      chunks.push(Buffer.from(part.value));
    }
    const bytes = Buffer.concat(chunks, length); await validateAudio(bytes, format, signal); finished = true; return bytes;
  } catch (error) { failure = error; throw error; }
  finally {
    try { if (!finished) await reader.cancel(); }
    catch (error) { if (failure !== undefined) throw new AggregateError([failure, error], '音频读取及收尾失败'); throw error; }
    finally { reader.releaseLock(); }
  }
}
async function audioDirectory(create: boolean): Promise<string> {
  const root = await fs.realpath(path.resolve(getServerDataRoot())), directory = path.join(root, 'generated-audio');
  if (create) {
    try { await fs.mkdir(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const stats = await fs.lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || await fs.realpath(directory) !== directory) invalid();
  return directory;
}
function describe(filename: string): { hash: string; format: GeneratedAudioFormat } {
  const match = /^tts_\d{13}_[0-9a-f]{8}_([0-9a-f]{64})\.(mp3|wav)$/u.exec(filename);
  if (!match || !isGeneratedAudioFormat(match[2])) invalid();
  return { hash: match[1], format: match[2] };
}
export async function persistGeneratedAudioResponse(response: Response, format: GeneratedAudioFormat, signal?: AbortSignal): Promise<GeneratedAudioArtifact> {
  const bytes = await readResponse(response, format, signal); signal?.throwIfAborted();
  const directory = await audioDirectory(true), hash = createHash('sha256').update(bytes).digest('hex');
  const filename = 'tts_' + Date.now() + '_' + randomUUID().slice(0, 8) + '_' + hash + '.' + format;
  const target = path.join(directory, filename);
  const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  let owned: BigIntStats | undefined; let failure: unknown;
  try {
    owned = await handle.stat({ bigint: true });
    if (!owned.isFile() || owned.nlink !== BigInt(1) || await audioDirectory(false) !== directory) invalid();
    await handle.writeFile(bytes, { signal }); signal?.throwIfAborted();
    const actual = await fs.lstat(target, { bigint: true }), held = await handle.stat({ bigint: true });
    if (actual.isSymbolicLink() || !actual.isFile() || actual.nlink !== BigInt(1) || actual.size !== BigInt(bytes.length)
      || actual.dev !== owned.dev || actual.ino !== owned.ino || identity(actual) !== identity(held)
      || await audioDirectory(false) !== directory) invalid();
  } catch (error) {
    failure = error;
    if (owned) {
      try {
        if (await audioDirectory(false) !== directory) invalid();
        const current = await fs.lstat(target, { bigint: true });
        if (current.isSymbolicLink() || current.nlink !== BigInt(1) || current.dev !== owned.dev || current.ino !== owned.ino) invalid();
        await fs.unlink(target);
      } catch (cleanup) {
        if (!missing(cleanup)) { failure = new AggregateError([error, cleanup], '音频写入及收尾失败'); throw failure; }
      }
    }
    throw error;
  } finally {
    try { await handle.close(); }
    catch (error) { if (failure !== undefined) throw new AggregateError([failure, error], '音频写入及关闭失败'); throw error; }
  }
  return { filename, audioUrl: PREFIX + filename, format, mimeType: mime(format), size: bytes.length };
}
export async function readGeneratedAudio(filename: string, signal?: AbortSignal): Promise<GeneratedAudioBytes | null> {
  const descriptor = describe(filename);
  let directory: string, target: string, before: BigIntStats;
  try {
    directory = await audioDirectory(false); target = path.join(directory, filename);
    before = await fs.lstat(target, { bigint: true });
  } catch (error) { if (missing(error)) return null; throw error; }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== BigInt(1) || before.size < BigInt(1) || before.size > BigInt(MAX_BYTES)) invalid();
  const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); let failure: unknown;
  try {
    if (identity(await handle.stat({ bigint: true })) !== identity(before)) invalid();
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const part = await handle.read(bytes, offset, Math.min(bytes.length - offset, 64 * 1024), offset);
      if (part.bytesRead === 0) invalid(); offset += part.bytesRead;
    }
    signal?.throwIfAborted();
    if (await audioDirectory(false) !== directory || identity(await fs.lstat(target, { bigint: true })) !== identity(before)
      || identity(await handle.stat({ bigint: true })) !== identity(before)) invalid();
    if (createHash('sha256').update(bytes).digest('hex') !== descriptor.hash) invalid();
    await validateAudio(bytes, descriptor.format, signal);
    if (await audioDirectory(false) !== directory || identity(await fs.lstat(target, { bigint: true })) !== identity(before)
      || identity(await handle.stat({ bigint: true })) !== identity(before)) invalid();
    return { buffer: bytes, filename, audioUrl: PREFIX + filename, format: descriptor.format, mimeType: mime(descriptor.format), size: bytes.length };
  } catch (error) { failure = error; throw error; }
  finally {
    try { await handle.close(); }
    catch (error) { if (failure !== undefined) throw new AggregateError([failure, error], '音频读取及关闭失败'); throw error; }
  }
}
export async function readGeneratedAudioFromUrl(url: string, signal?: AbortSignal): Promise<GeneratedAudioBytes | null> {
  if (!url.startsWith(PREFIX)) invalid();
  return readGeneratedAudio(url.slice(PREFIX.length), signal);
}

