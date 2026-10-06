import childProcess from 'node:child_process';
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateBinaryImage } from './binary-image-validation';
import { readSafeBmpDimensions } from '@/lib/safe-image-input';
import { BINARY_MEDIA_PIXEL_LIMIT, binaryExtensions } from './binary-media-contract';

async function probe(args: string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let failure: unknown;
    let output = { stdout: '', stderr: '' };
    // execFile's signal option reports AbortError before close. Kill explicitly and reap.
    const child = childProcess.execFile('ffprobe', args, {
      timeout: 15_000, maxBuffer: 256 * 1024, windowsHide: true, killSignal: 'SIGKILL', encoding: 'utf8',
    }, (error, stdout, stderr) => { failure ??= error; output = { stdout, stderr }; });
    const abort = (): void => { failure ??= signal?.reason; child.kill('SIGKILL'); };
    child.on('error', error => { failure ??= error; });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.once('close', () => {
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure); else resolve(output);
    });
  });
}

function invalid(): never { throw new TypeError('ASSET_BINARY_FORMAT_INVALID'); }

function dimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width * height > BINARY_MEDIA_PIXEL_LIMIT) invalid();
}

/** Explicit BMP subset: Windows DIB 40/108/124, BI_RGB, 24/32 bit, top-down or bottom-up. */
function validateBmp(bytes: Buffer): void {
  if (bytes.length < 54 || bytes.toString('ascii', 0, 2) !== 'BM' || bytes.readUInt32LE(2) !== bytes.length) invalid();
  const dib = bytes.readUInt32LE(14);
  const offset = bytes.readUInt32LE(10);
  const { width, height } = readSafeBmpDimensions(bytes);
  const bits = bytes.readUInt16LE(28);
  dimensions(width, height);
  if (![40, 108, 124].includes(dib) || offset < 14 + dib || offset > bytes.length
    || bytes.readUInt16LE(26) !== 1 || ![24, 32].includes(bits) || bytes.readUInt32LE(30) !== 0) invalid();
  const length = Math.ceil(width * bits / 32) * 4 * height;
  const declared = bytes.readUInt32LE(34);
  if (offset + length !== bytes.length || (declared !== 0 && declared !== length)) invalid();
}

interface Box { type: string; start: number; end: number }
// Per input, shared by all recursive calls. Media payload/padding is not metadata.
interface ParseBudget { work: number; metadata: number }
function spend(budget: ParseBudget, work: number, metadata: number): void {
  budget.work += work; budget.metadata += metadata;
  if (budget.work > 16_384 || budget.metadata > 8 * 1024 * 1024) throw new TypeError('ASSET_MEDIA_PARSE_LIMIT');
}
function boxes(bytes: Buffer, budget: ParseBudget, start = 0, end = bytes.length, top = false): Box[] {
  const result: Box[] = [];
  while (start < end) {
    spend(budget, 1, 0);
    if (end - start < 8) invalid();
    let size = bytes.readUInt32BE(start);
    const type = bytes.toString('ascii', start + 4, start + 8);
    let header = 8;
    if (size === 1) {
      if (end - start < 16) invalid();
      const big = bytes.readBigUInt64BE(start + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
      size = Number(big); header = 16;
    } else if (size === 0) size = end - start;
    if (size < header || start + size > end) invalid();
    // Charge each byte once at the top; child traversal shares the work counter.
    if (top) spend(budget, 0, ['mdat', 'free', 'skip'].includes(type) ? header : size);
    result.push({ type, start: start + header, end: start + size });
    start += size;
  }
  return result;
}

function brands(bytes: Buffer, top: Box[]): { major: number; avif: boolean; mp4: boolean } {
  const box = top.find(item => item.type === 'ftyp');
  if (!box || box.end - box.start < 8 || (box.end - box.start) % 4 !== 0) invalid();
  if ((box.end - box.start) / 4 - 1 > 1024) throw new TypeError('ASSET_MEDIA_PARSE_LIMIT');
  const result = { major: bytes.readUInt32BE(box.start), avif: false, mp4: false };
  // Numeric scan: no per-brand strings or growing array.
  for (let at = box.start; at < box.end; at += 4) {
    if (at === box.start + 4) continue; // minor_version is not a brand.
    const brand = bytes.readUInt32BE(at);
    if (brand === 0x61766966 || brand === 0x61766973) result.avif = true;
    if (brand === 0x69736f6d || (brand >= 0x69736f32 && brand <= 0x69736f39)
      || brand === 0x6d703431 || brand === 0x6d703432 || brand === 0x61766331
      || brand === 0x4d345620 || brand === 0x4d345648 || brand === 0x4d345650
      || brand === 0x4d534e56 || brand === 0x64617368) result.mp4 = true;
  }
  return result;
}

function validateMovReferences(bytes: Buffer, items: Box[], budget: ParseBudget, depth = 0): void {
  if (depth > 12) invalid();
  for (const box of items) {
    if (['moov', 'trak', 'mdia', 'minf', 'dinf'].includes(box.type)) {
      validateMovReferences(bytes, boxes(bytes, budget, box.start, box.end), budget, depth + 1);
    }
    if (box.type === 'dref') {
      if (box.end - box.start < 8) invalid();
      const refs = boxes(bytes, budget, box.start + 8, box.end);
      if (refs.length !== bytes.readUInt32BE(box.start + 4)) invalid();
      for (const ref of refs) {
        // Only self-contained URL entries. Never hand external file/URL references to ffprobe.
        if (ref.type !== 'url ' || ref.end - ref.start !== 4 || bytes.readUInt32BE(ref.start) !== 1) invalid();
      }
    }
  }
}

function ebmlNumber(bytes: Buffer, at: number, id: boolean, boundary: number): { value: number; length: number; unknown: boolean } {
  if (at >= boundary || bytes[at] === 0) invalid();
  let length = 1;
  while (length <= 8 && !(bytes[at] & (1 << (8 - length)))) length++;
  if (length > (id ? 4 : 8) || at + length > boundary) invalid();
  let value = BigInt(id ? bytes[at] : bytes[at] & ((1 << (8 - length)) - 1));
  for (let i = 1; i < length; i++) value = value * BigInt(256) + BigInt(bytes[at + i]);
  const unknown = !id && value === (BigInt(1) << BigInt(7 * length)) - BigInt(1);
  if (!unknown && value > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  return { value: unknown ? 0 : Number(value), length, unknown };
}

function validateWebm(bytes: Buffer, budget: ParseBudget): void {
  let docType = false;
  let segment = false;
  // Known master elements are traversed with one shared budget, never reset per track/cluster.
  const masters = new Set([0x1a45dfa3, 0x18538067, 0x114d9b74, 0x4dbb, 0x1549a966,
    0x1654ae6b, 0xae, 0xe0, 0xe1, 0x1f43b675, 0xa0, 0x1c53bb6b, 0xbb, 0xb7,
    0x1254c367, 0x7373, 0x63c0, 0x67c8, 0x1043a770, 0x45b9, 0xb6, 0x80]);
  // Matroska schema permits unknown size only for Segment (root) and Cluster
  // (Segment child). RFC 8794 §6.2: their end is a schema-level boundary, not
  // a nested master. Global Void/CRC are deliberately absent from these sets.
  const roots = new Set([0x1a45dfa3, 0x18538067]);
  const segmentChildren = new Set([0x114d9b74, 0x1549a966, 0x1f43b675, 0x1654ae6b,
    0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367]);
  const visit = (start: number, boundary: number, depth: number, parent: number, unknown = false): number => {
    if (depth > 12) invalid();
    let at = start;
    while (at < boundary) {
      const header = at;
      const id = ebmlNumber(bytes, at, true, boundary);
      if (depth > 0 && (roots.has(id.value) || (segmentChildren.has(id.value) && parent !== 0x18538067))) {
        if (unknown) return header; // Caller consumes the sibling/ancestor exactly once.
        invalid(); // A known-sized parent cannot end early or be escaped.
      }
      spend(budget, 1, 0);
      at += id.length;
      const size = ebmlNumber(bytes, at, false, boundary); at += size.length;
      const end = size.unknown ? boundary : at + size.value;
      if (end > boundary || at > boundary || (size.unknown && ![0x18538067, 0x1f43b675].includes(id.value))) invalid();
      if (depth === 0 && !roots.has(id.value)) invalid();
      spend(budget, 0, at - header);
      if (id.value === 0x18538067 && depth === 0) segment = true;
      if (id.value === 0x4282 && parent === 0x1a45dfa3) docType = end - at === 4 && bytes.readUInt32BE(at) === 0x7765626d;
      if (masters.has(id.value)) at = visit(at, end, depth + 1, id.value, size.unknown);
      else {
        if (![0xa3, 0xa1, 0xec].includes(id.value)) spend(budget, 0, end - at);
        at = end;
      }
    }
    return at;
  };
  visit(0, bytes.length, 0, 0);
  if (!docType || !segment) invalid();
}

export interface VerifiedMediaDimensions { width: number; height: number }

/** Strict metadata/packet inspection, never a decoder or browser codec guarantee. */
export async function inspectNewBinaryMedia(bytes: Buffer, mimeType: string, signal?: AbortSignal): Promise<VerifiedMediaDimensions | undefined> {
  signal?.throwIfAborted();
  const budget: ParseBudget = { work: 0, metadata: 0 };
  if (mimeType === 'image/bmp') { validateBmp(bytes); return readSafeBmpDimensions(bytes); }
  if (mimeType === 'image/gif' || mimeType === 'image/avif') {
    if (mimeType === 'image/avif' && !brands(bytes, boxes(bytes, budget, 0, bytes.length, true)).avif) invalid();
    await validateBinaryImage(bytes, mimeType, signal);
    return undefined;
  }
  if (mimeType === 'video/webm') validateWebm(bytes, budget);
  else {
    const top = boxes(bytes, budget, 0, bytes.length, true);
    const compatible = top.some(box => box.type === 'ftyp') ? brands(bytes, top) : undefined;
    if (mimeType === 'video/quicktime' ? compatible && compatible.major !== 0x71742020
      : compatible?.major === 0x71742020 || !compatible?.mp4) invalid();
    if (!top.some(box => box.type === 'moov') || !top.some(box => box.type === 'mdat' && box.end > box.start)) invalid();
    validateMovReferences(bytes, top, budget);
  }
  const directory = await mkdtemp(join(tmpdir(), 'wujie-media-validate-'));
  const filename = join(directory, `input.${binaryExtensions(mimeType)?.[0]}`);
  try {
    await writeFile(filename, bytes, { flag: 'wx', signal });
    const { stdout, stderr } = await probe([
      '-v', 'error', '-max_alloc', '67108864', '-threads', '1',
      '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm',
      ...(mimeType === 'video/webm' ? [] : ['-enable_drefs', '0', '-use_absolute_path', '0']),
      '-count_packets', '-show_entries', 'stream=codec_type,width,height,nb_read_packets:format=format_name',
      '-of', 'json', filename,
    ], signal);
    if (stderr.trim()) invalid();
    const result = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string; width?: number; height?: number; nb_read_packets?: string }>; format?: { format_name?: string } };
    const stream = result.streams?.find(item => item.codec_type === 'video' && Number(item.nb_read_packets) > 0);
    if (!stream || !(mimeType === 'video/webm' ? result.format?.format_name?.includes('webm') : result.format?.format_name?.includes('mov'))) invalid();
    dimensions(stream.width ?? 0, stream.height ?? 0);
    signal?.throwIfAborted();
    return { width: stream.width!, height: stream.height! };
  } finally {
    await rm(filename, { force: true });
    await rmdir(directory);
  }
}

/** Preserve the validation-only API for recovery and existing callers. */
export async function validateNewBinaryMedia(bytes: Buffer, mimeType: string, signal?: AbortSignal): Promise<void> {
  await inspectNewBinaryMedia(bytes, mimeType, signal);
}

/** Validate a bounded remote source-map recovery before it is cached or served. */
let activeSourceVideoValidations = 0;
let sourceVideoInputBytes = 0;

export async function validateRecoveredSourceMedia(bytes: Buffer, mimeType: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
    return validateBinaryImage(bytes, mimeType, signal);
  }
  if (['image/bmp', 'image/gif', 'image/avif', 'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'].includes(mimeType)) {
    return validateNewBinaryMedia(bytes, mimeType, signal);
  }
  if (mimeType !== 'video/x-msvideo' && mimeType !== 'video/x-matroska') invalid();
  if (bytes.length < 1 || bytes.length > 200 * 1024 * 1024) throw new TypeError('ASSET_BYTES_INVALID');
  if (activeSourceVideoValidations >= 2 || sourceVideoInputBytes + bytes.length > 256 * 1024 * 1024) {
    throw new Error('ASSET_MEDIA_BUSY');
  }
  activeSourceVideoValidations++;
  sourceVideoInputBytes += bytes.length;
  let directory: string | undefined;
  let filename: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), 'wujie-source-video-validate-'));
    filename = join(directory, mimeType === 'video/x-msvideo' ? 'input.avi' : 'input.mkv');
    await writeFile(filename, bytes, { flag: 'wx', signal });
    const { stdout, stderr } = await probe([
      '-v', 'error', '-max_alloc', '67108864', '-threads', '1',
      '-protocol_whitelist', 'file', '-format_whitelist', mimeType === 'video/x-msvideo' ? 'avi' : 'matroska',
      '-count_packets', '-show_entries', 'stream=codec_type,width,height,nb_read_packets:format=format_name',
      '-of', 'json', filename,
    ], signal);
    if (stderr.trim()) invalid();
    const result = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string; width?: number; height?: number; nb_read_packets?: string }>; format?: { format_name?: string } };
    const stream = result.streams?.find(item => item.codec_type === 'video' && Number(item.nb_read_packets) > 0);
    if (!stream || !result.format?.format_name?.split(',').includes(mimeType === 'video/x-msvideo' ? 'avi' : 'matroska')) invalid();
    dimensions(stream.width ?? 0, stream.height ?? 0);
    signal?.throwIfAborted();
  } finally {
    try {
      if (filename) await rm(filename, { force: true });
      if (directory) await rmdir(directory);
    } finally {
      activeSourceVideoValidations--;
      sourceVideoInputBytes -= bytes.length;
    }
  }
}
