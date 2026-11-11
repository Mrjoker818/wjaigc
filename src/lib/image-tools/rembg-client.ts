import path from 'node:path';
import sharp from 'sharp';
import {
  hasLocalFile, LOCAL_AI_ENABLED, LOCAL_WORKER_MAX_PNG_BYTES,
  REMBG_WORKER, REMOVEBG_MODELS_DIR, runLocalPython,
} from './config';

const models = ['birefnet-general-lite', 'birefnet-general', 'birefnet-portrait', 'birefnet-massive'];
export const LOCAL_REMBG_MODEL = process.env.REMOVEBG_MODEL || 'birefnet-general-lite';
const env = { REMOVEBG_MODELS_DIR, U2NET_HOME: REMOVEBG_MODELS_DIR };
const maxPixels = 2048 ** 2;

export async function isRembgConfigured(): Promise<boolean> {
  return LOCAL_AI_ENABLED && models.includes(LOCAL_REMBG_MODEL)
    && path.isAbsolute(REMOVEBG_MODELS_DIR) && await hasLocalFile(REMBG_WORKER)
    && await hasLocalFile(path.join(REMOVEBG_MODELS_DIR, `${LOCAL_REMBG_MODEL}.onnx`));
}

export async function checkRembgHealth(): Promise<boolean> {
  if (!await isRembgConfigured()) return false;
  try {
    const output = JSON.parse(await runLocalPython([REMBG_WORKER, '--check', LOCAL_REMBG_MODEL],
      { timeout: 15_000, env }));
    return output?.success === true && output.model === LOCAL_REMBG_MODEL;
  } catch {
    return false;
  }
}

export async function generateRembgMask(image: Buffer): Promise<{ rgba: Buffer; mask: Buffer } | null> {
  if (!await isRembgConfigured() || image.length > 20 * 1024 * 1024) return null;
  try {
    const source = await sharp(image, { limitInputPixels: maxPixels }).metadata();
    if (!source.width || !source.height || Math.max(source.width, source.height) > 2048) return null;
    const input = JSON.stringify({ image: image.toString('base64'), model: LOCAL_REMBG_MODEL });
    const output = JSON.parse(await runLocalPython([REMBG_WORKER], {
      timeout: 120_000, input, env, maxBuffer: 48 * 1024 * 1024,
    }));
    if (output?.success !== true || output.model !== LOCAL_REMBG_MODEL
      || typeof output.rgbaBase64 !== 'string'
      || output.rgbaBase64.length > Math.ceil(LOCAL_WORKER_MAX_PNG_BYTES / 3) * 4) return null;
    const rgba = Buffer.from(output.rgbaBase64, 'base64');
    const candidate = sharp(rgba, { limitInputPixels: maxPixels });
    const metadata = await candidate.metadata();
    if (metadata.format !== 'png' || !metadata.hasAlpha
      || metadata.width !== source.width || metadata.height !== source.height) return null;
    // Derive the downloadable mask from the actual alpha rather than trusting a second payload.
    const mask = await candidate.extractChannel('alpha').png().toBuffer();
    return { rgba, mask };
  } catch {
    return null;
  }
}
