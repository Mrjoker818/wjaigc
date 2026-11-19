/**
 * Turns a stored voice sample (`/api/serve-upload/generated-audio/...`) into a URL a video model can download.
 * Order as for images: an S3 presigned URL when object storage is configured (Coze), then a signed public
 * link when a public media origin is configured (self-hosted VPS). Audio is never inlined: the providers
 * that take reference audio only fetch http(s) URLs.
 */
import 'server-only';
import { isGeneratedAudioLocation, readGeneratedAudioFromUrl } from '@/lib/generated-audio-storage';
import { DEFAULT_PUBLIC_MEDIA_TTL_SEC, publicMediaOrigin, signPublicAudioPath } from '@/lib/public-media-link';

export class ProviderAudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderAudioError';
  }
}

async function presign(bytes: Buffer, filename: string, mimeType: string): Promise<string | null> {
  try {
    const storage = await import('@/lib/s3-storage');
    if (!storage.isS3Available()) return null;
    const uploaded = await storage.uploadImageToS3(bytes, `generated-audio/${filename}`, mimeType);
    return uploaded ? await storage.getS3PresignedUrl(uploaded.replace(/^\/+/, ''), DEFAULT_PUBLIC_MEDIA_TTL_SEC) : null;
  } catch {
    return null;
  }
}

/**
 * Checks that the user can read each voice sample, then publishes it.
 * Throws ProviderAudioError with a message for the user when a sample is missing or cannot be published.
 */
export async function toProviderAudioUrls(urls: readonly string[], ownerId: string, signal?: AbortSignal): Promise<string[]> {
  return Promise.all(urls.map(async url => {
    if (!isGeneratedAudioLocation(url)) throw new ProviderAudioError('参考音频必须是上传到本站的声音样本');
    const audio = await readGeneratedAudioFromUrl(url, signal, ownerId).catch(() => null);
    if (!audio) throw new ProviderAudioError('找不到这段声音样本，请在设定页重新上传');
    const presigned = await presign(audio.buffer, audio.filename, audio.mimeType);
    if (presigned) return presigned;
    const origin = publicMediaOrigin();
    const signed = origin ? signPublicAudioPath(audio.filename, ownerId) : null;
    if (origin && signed) return `${origin}${signed}`;
    throw new ProviderAudioError('服务器没有配置公网媒体地址，声音样本无法发给视频模型；请管理员配置后再试，或在检查器里关掉声音样本');
  }));
}
