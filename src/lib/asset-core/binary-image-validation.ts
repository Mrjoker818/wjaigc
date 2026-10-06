import childProcess from 'node:child_process';
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BINARY_MEDIA_PIXEL_LIMIT, MAX_ASSET_BINARY_BYTES, MAX_ASSET_VIDEO_BYTES } from './binary-media-contract';

// A killable process is necessary: racing a Promise or destroying a Sharp pipeline does
// not prove that its libvips CPU work stopped. No lease is released before child close.
const decoderProgram = `
const sharp = require(process.argv[1]);
sharp.cache(false);
sharp.concurrency(1);
(async () => {
  const image = sharp(process.argv[2], { animated: true, failOn: 'warning', limitInputPixels: ${BINARY_MEDIA_PIXEL_LIMIT} });
  const pendingMetadata = image.metadata();
  process.stdout.write('metadata\\n');
  const metadata = await pendingMetadata;
  const { width, height } = metadata;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width * height > ${BINARY_MEDIA_PIXEL_LIMIT}) throw new Error('dimensions');
  // Animated metadata.height is the vertical stack of all frames. Keep the
  // total-pixel budget above and full-frame stats below, but return display size.
  const displayHeight = metadata.pageHeight === undefined ? height : metadata.pageHeight;
  const pages = metadata.pages === undefined ? 1 : metadata.pages;
  if (!Number.isSafeInteger(displayHeight) || displayHeight < 1 || !Number.isSafeInteger(pages)
    || pages < 1 || displayHeight * pages !== height) throw new Error('frame dimensions');
  const formats = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'heif' };
  const mime = process.argv[3];
  if (!Object.hasOwn(formats, mime) || metadata.format !== formats[mime]
    || (mime === 'image/avif' && metadata.compression !== 'av1')) throw new Error('format');
  const pendingDecode = image.stats();
  process.stdout.write('decode\\n');
  await pendingDecode;
  process.stdout.write('ok:' + width + ':' + displayHeight + '\\n');
})().catch(() => { process.exitCode = 1; });
`;

let active = 0;
let inputBytes = 0;

export interface VerifiedBinaryImageDimensions { width: number; height: number }

async function decode(filename: string, mimeType: string, signal: AbortSignal): Promise<VerifiedBinaryImageDimensions> {
  signal.throwIfAborted();
  const sharpPath = createRequire(join(process.cwd(), 'package.json')).resolve('sharp');
  // Disable inherited Node injection options; only installed CPU Sharp is loaded.
  const env = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', VIPS_CONCURRENCY: '1', UV_THREADPOOL_SIZE: '1' };
  return new Promise<VerifiedBinaryImageDimensions>((resolve, reject) => {
    const child = childProcess.spawn(process.execPath, ['--max-old-space-size=64', '-e', decoderProgram, sharpPath, filename, mimeType], {
      windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env,
    });
    let failure: unknown;
    let output = '';
    let outputBytes = 0;
    const stop = (error: unknown): void => {
      failure ??= error;
      // Do not settle here. SIGKILL terminates the native worker as well as Node.
      child.kill('SIGKILL');
    };
    const abort = (): void => stop(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.on('error', error => { failure ??= error; });
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 4096) stop(new Error('ASSET_IMAGE_DECODER_OUTPUT_LIMIT'));
      else output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      stop(new Error(outputBytes > 4096 ? 'ASSET_IMAGE_DECODER_OUTPUT_LIMIT' : 'ASSET_BINARY_FORMAT_INVALID'));
    });
    child.once('close', code => {
      signal.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else {
        const result = /^metadata\ndecode\nok:([1-9][0-9]*):([1-9][0-9]*)\n$/.exec(output);
        const width = Number(result?.[1]); const height = Number(result?.[2]);
        if (code !== 0 || !result || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
          || width * height > BINARY_MEDIA_PIXEL_LIMIT) reject(new TypeError('ASSET_BINARY_FORMAT_INVALID'));
        else resolve({ width, height });
      }
    });
  });
}

export async function inspectBinaryImage(bytes: Buffer, mimeType: string, signal?: AbortSignal): Promise<VerifiedBinaryImageDimensions> {
  signal?.throwIfAborted();
  if (bytes.length < 1 || bytes.length > MAX_ASSET_BINARY_BYTES) throw new TypeError('ASSET_BYTES_INVALID');
  if (active >= 2 || inputBytes + bytes.length > MAX_ASSET_VIDEO_BYTES) throw new Error('ASSET_MEDIA_BUSY');
  active++; inputBytes += bytes.length;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error('ASSET_IMAGE_DECODER_TIMEOUT')), 15_000);
  timer.unref();
  const bounded = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  let directory: string | undefined;
  let filename: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), 'wujie-image-validate-'));
    filename = join(directory, 'input');
    await writeFile(filename, bytes, { flag: 'wx', signal: bounded });
    const dimensions = await decode(filename, mimeType, bounded);
    bounded.throwIfAborted();
    return dimensions;
  } finally {
    clearTimeout(timer);
    try {
      if (filename) await rm(filename, { force: true });
      if (directory) await rmdir(directory);
    } finally { active--; inputBytes -= bytes.length; }
  }
}

/** Preserve all existing validation-only callers and their void result contract. */
export async function validateBinaryImage(bytes: Buffer, mimeType: string, signal?: AbortSignal): Promise<void> {
  await inspectBinaryImage(bytes, mimeType, signal);
}
