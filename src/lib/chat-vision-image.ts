import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { getServerDataRoot } from '@/lib/server-data-root';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export interface PreparedVisionImage {
  url: string;
  width: number;
  height: number;
  source: 'inline' | 'remote';
}

interface VisionContentPart {
  type?: string;
  text?: string;
  image_url?: { url?: string; detail?: string };
}

function extensionOf(value: string): string {
  return value.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() || '';
}

function mimeFor(value: string, fallback = 'image/png'): string {
  return MIME_BY_EXTENSION[extensionOf(value)] || fallback;
}

function readExisting(candidates: string[]): Buffer | null {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return fs.readFileSync(candidate);
    }
  }
  return null;
}

async function readStoredImage(imageUrl: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!imageUrl.startsWith('/')) return null;
  const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
  const stripped = imageUrl.replace(/^\/api\/serve-upload\//, '').replace(/^\//, '');
  const filename = path.basename(stripped);
  const dataRoot = getServerDataRoot();
  const buffer = readExisting([
    path.join(workspace, 'public', stripped),
    path.join(dataRoot, stripped),
    path.join(dataRoot, 'uploads', stripped),
    path.join(workspace, 'public', 'uploads', filename),
  ]);
  if (buffer) return { buffer, mimeType: mimeFor(stripped) };

  try {
    const { isS3Available, downloadImageFromS3 } = await import('@/lib/s3-storage');
    if (!isS3Available()) return null;
    for (const key of [`images/${filename}`, `uploads/${filename}`, `generate/${filename}`, filename, stripped]) {
      const downloaded = await downloadImageFromS3(key);
      if (downloaded) return { buffer: downloaded, mimeType: mimeFor(key) };
    }
  } catch {
    return null;
  }
  return null;
}

async function readRemoteImage(imageUrl: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) return null;
  const mimeType = response.headers.get('content-type')?.split(';')[0] || mimeFor(imageUrl);
  return { buffer: Buffer.from(await response.arrayBuffer()), mimeType };
}

/** 保留视觉细节，同时限制单张图片体积，避免请求被模型网关拒绝。 */
async function normalizeForVision(buffer: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string; width: number; height: number }> {
  const source = sharp(buffer, { failOn: 'none' }).rotate();
  const metadata = await source.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const tooLarge = Math.max(width, height) > 2048 || buffer.length > 4_500_000;
  if (!tooLarge && mimeType !== 'image/gif') return { buffer, mimeType, width, height };

  const normalized = await source
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: normalized.data,
    mimeType: 'image/jpeg',
    width: normalized.info.width,
    height: normalized.info.height,
  };
}

export async function prepareVisionImage(imageUrl: string): Promise<PreparedVisionImage | null> {
  if (!imageUrl) return null;
  try {
    let loaded: { buffer: Buffer; mimeType: string } | null = null;
    if (imageUrl.startsWith('data:image/')) {
      const [header, payload] = imageUrl.split(',', 2);
      if (!payload) return null;
      loaded = { buffer: Buffer.from(payload, 'base64'), mimeType: header.slice(5, header.indexOf(';')) || 'image/png' };
    } else if (imageUrl.startsWith('/')) {
      loaded = await readStoredImage(imageUrl);
    } else if (/^https?:\/\//i.test(imageUrl)) {
      loaded = await readRemoteImage(imageUrl);
    }
    if (!loaded) return /^https?:\/\//i.test(imageUrl) ? { url: imageUrl, width: 0, height: 0, source: 'remote' } : null;

    const normalized = await normalizeForVision(loaded.buffer, loaded.mimeType);
    return {
      url: `data:${normalized.mimeType};base64,${normalized.buffer.toString('base64')}`,
      width: normalized.width,
      height: normalized.height,
      source: 'inline',
    };
  } catch (error) {
    console.warn('[chat-vision] failed to prepare image:', error instanceof Error ? error.message : error);
    return /^https?:\/\//i.test(imageUrl) ? { url: imageUrl, width: 0, height: 0, source: 'remote' } : null;
  }
}

export async function prepareChatVisionMessages<T extends { content?: unknown }>(messages: T[]): Promise<T[]> {
  const prepared: T[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      prepared.push(message);
      continue;
    }
    const content: VisionContentPart[] = [];
    const facts: string[] = [];
    for (const part of message.content as VisionContentPart[]) {
      if (part.type !== 'image_url' || !part.image_url?.url) {
        content.push(part);
        continue;
      }
      const image = await prepareVisionImage(part.image_url.url);
      if (!image) {
        facts.push('有一张引用图片无法读取，请明确说明无法确认其画面，不要根据文件名猜测。');
        continue;
      }
      facts.push(image.width && image.height
        ? `图片#${facts.length + 1}实际像素 ${image.width}×${image.height}，请以图像内容为准。`
        : `图片#${facts.length + 1}已附在消息中，请以图像内容为准。`);
      content.push({ ...part, image_url: { ...part.image_url, url: image.url, detail: 'high' } });
    }
    if (facts.length > 0) {
      const textIndex = content.findIndex(part => part.type === 'text');
      const factText = `\n\n[图像读取事实]\n${facts.join('\n')}`;
      if (textIndex >= 0) content[textIndex] = { ...content[textIndex], text: `${content[textIndex].text || ''}${factText}` };
      else content.unshift({ type: 'text', text: factText.trim() });
    }
    prepared.push({ ...message, content });
  }
  return prepared;
}
