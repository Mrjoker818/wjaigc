import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  hasLocalFile, IOPAINT_MODELS_DIR, IOPAINT_WORKER, LOCAL_AI_ENABLED,
  LOCAL_WORKER_MAX_PNG_BYTES, runLocalPython,
} from './config';

const models = {
  lama: ['big-lama.pt'],
  'anime-lama': ['anime-manga-big-lama.pt'],
  zits: ['zits-wireframe-0717.pt', 'zits-edge-line-0717.pt',
    'zits-structure-upsample-0717.pt', 'zits-inpaint-0717.pt'],
} as const;
export const LOCAL_ERASE_MODEL = process.env.IOPAINT_MODEL || 'lama';
const env = { IOPAINT_MODELS_DIR, TORCH_HOME: IOPAINT_MODELS_DIR };

export async function isLocalEraseConfigured(): Promise<boolean> {
  if (!LOCAL_AI_ENABLED || !Object.hasOwn(models, LOCAL_ERASE_MODEL)
    || !path.isAbsolute(IOPAINT_MODELS_DIR) || !await hasLocalFile(IOPAINT_WORKER)) return false;
  const files = models[LOCAL_ERASE_MODEL as keyof typeof models];
  for (const file of files) {
    if (!await hasLocalFile(path.join(IOPAINT_MODELS_DIR, file))
      && !await hasLocalFile(path.join(IOPAINT_MODELS_DIR, 'hub', 'checkpoints', file))) return false;
  }
  return true;
}

export async function checkLocalEraseHealth(): Promise<boolean> {
  if (!await isLocalEraseConfigured()) return false;
  try {
    const output = JSON.parse(await runLocalPython([IOPAINT_WORKER, '--check', LOCAL_ERASE_MODEL],
      { timeout: 15_000, env }));
    return output?.success === true && output.model === LOCAL_ERASE_MODEL;
  } catch {
    return false;
  }
}

export async function eraseWithLama(
  image: Buffer, mask: Buffer, width: number, height: number,
): Promise<Buffer | null> {
  if (!await isLocalEraseConfigured() || width > 2048 || height > 2048) return null;
  let dir: string | undefined;
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'wujie-erase-'));
    const input = path.join(dir, 'input.png');
    const maskFile = path.join(dir, 'mask.png');
    const output = path.join(dir, 'output.png');
    await writeFile(input, await sharp(image).png().toBuffer());
    await writeFile(maskFile, mask);
    const stdout = await runLocalPython([IOPAINT_WORKER, input, maskFile, output, LOCAL_ERASE_MODEL],
      { timeout: 120_000, env });
    const method = stdout.match(/\bmethod=([a-z0-9-]+)\b/i)?.[1];
    if (method !== LOCAL_ERASE_MODEL) return null;
    const file = await lstat(output);
    if (!file.isFile() || file.size > LOCAL_WORKER_MAX_PNG_BYTES) return null;
    const result = await readFile(output);
    const png = sharp(result, { limitInputPixels: 2048 ** 2 });
    const metadata = await png.metadata();
    if (metadata.format !== 'png' || metadata.width !== width || metadata.height !== height) return null;
    return await png.png().toBuffer();
  } catch {
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
