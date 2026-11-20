/** Builds the episode's production package in the browser and hands files to the user as downloads. */
import JSZip from 'jszip';
import { episodePackageMedia, episodeSrt, projectPackageMedia, safeFileName, shotListCsv } from './export';
import { PACKAGE_LIMITS, PACKAGE_MANIFEST, completedPackageImages, packageManifest, packageMediaKind, projectPackageDoc, type PackageFileReference, type PackageLimits, type PackageManifest, type PackageMediaMode } from './package';
import type { DramaProjectV1 } from './types';

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface PackageResult {
  blob: Blob;
  fileName: string;
  /** Media that could not be downloaded; listed in the package so nothing goes missing silently. */
  missing: string[];
  complete?: boolean;
}

export interface ProjectPackageOptions {
  /** Required: a production archive must never silently choose whether to include history. */
  mediaMode: PackageMediaMode;
  fetch?: Fetcher;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** May lower the browser limits, never raise them. */
  limits?: Partial<PackageLimits>;
}

function archiveLimits(input: Partial<PackageLimits> = {}): PackageLimits {
  return Object.fromEntries(Object.entries(PACKAGE_LIMITS).map(([key, cap]) => {
    const chosen = input[key as keyof PackageLimits] ?? cap;
    if (!Number.isSafeInteger(chosen) || chosen <= 0 || chosen > cap) throw new Error('制作包大小上限设置无效');
    return [key, chosen];
  })) as PackageLimits;
}

/** Read incrementally: a missing/lying Content-Length must not allocate an unbounded ArrayBuffer. */
async function boundedMedia(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`下载失败（${response.status}）`);
  const size = Number(response.headers.get('content-length'));
  if (size > maxBytes) { await response.body?.cancel(); throw new Error('文件超过制作包大小上限'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('文件内容为空');
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('文件超过制作包大小上限');
      chunks.push(value);
    }
    if (!total) throw new Error('文件内容为空');
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Whole project, downloaded only in the signed-in browser; no server-side URL fetching. */
export async function buildProjectPackage(doc: DramaProjectV1, options: ProjectPackageOptions): Promise<PackageResult & { complete: boolean }> {
  options.signal?.throwIfAborted();
  const limits = archiveLimits(options.limits);
  const archived = projectPackageDoc(doc, options.mediaMode);
  const media = projectPackageMedia(doc, options.mediaMode);
  if (media.length + archived.episodes.length * 3 + 4 > limits.maxFiles) throw new Error('制作包文件数量超过上限，请改用单集导出');
  const zip = new JSZip();
  let bytesUsed = 0;
  const textFile = (name: string, text: string) => {
    bytesUsed += new TextEncoder().encode(text).byteLength;
    if (bytesUsed > limits.maxTotalBytes) throw new Error('制作包总大小超过上限，请改用单集导出');
    zip.file(name, text);
  };
  archived.episodes.forEach((episode, index) => {
    const dir = `分集/${String(index + 1).padStart(3, '0')}_${safeFileName(episode.title, '未命名')}`;
    textFile(`${dir}/剧本.txt`, episode.script);
    textFile(`${dir}/镜头表.csv`, shotListCsv(archived, episode.id));
    const srt = episodeSrt(archived, episode.id);
    if (srt) textFile(`${dir}/字幕.srt`, srt);
  });
  const original = (archived as unknown as { sourceScript?: { originalText?: string } }).sourceScript?.originalText;
  if (typeof original === 'string') textFile('原始剧本.txt', original);
  const files: PackageFileReference[] = [];
  options.onProgress?.(0, media.length);
  // One bounded transfer at a time: JSZip retains all successful buffers until generation finishes.
  for (const item of media) {
    options.signal?.throwIfAborted();
    const file: PackageFileReference = { ...item, status: 'missing' };
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('文件下载超时')), 60_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
    try {
      const inlineSupported = /^data:(?:image\/(?:png|jpe?g|webp|gif|bmp|avif)|video\/(?:mp4|webm)|audio\/(?:mpeg|mp3|wav))(?:[;,])/iu.test(item.url);
      if (!packageMediaKind(item.name) || !/^(?:https?:\/\/|\/(?!\/)|blob:|data:)/iu.test(item.url) || (item.url.startsWith('data:') && !inlineSupported)) throw new Error('不支持的媒体地址或格式');
      const response = await (options.fetch ?? fetch)(item.url, { signal, credentials: 'same-origin' });
      const bytes = await boundedMedia(response, Math.min(limits.maxFileBytes, limits.maxTotalBytes - bytesUsed), signal);
      bytesUsed += bytes.byteLength;
      zip.file(item.name, bytes);
      file.status = 'packed'; file.bytes = bytes.byteLength;
    } catch (error) {
      options.signal?.throwIfAborted();
      file.reason = error instanceof Error ? error.message : '文件下载失败';
    } finally { clearTimeout(timer); }
    files.push(file);
    options.onProgress?.(files.length, media.length);
  }
  const missing = files.filter(file => file.status === 'missing').map(file => file.name);
  const manifest: PackageManifest = {
    format: 'wujie-drama-package', version: 1, doc: archived,
    media: Object.fromEntries(files.filter(file => file.status === 'packed').map(file => [file.url, file.name])),
    archive: { scope: 'project', mediaMode: options.mediaMode, complete: missing.length === 0, files,
      ...(options.mediaMode === 'history' ? { completedProductionImages: completedPackageImages(doc) } : {}) },
  };
  const json = JSON.stringify(manifest, null, 2);
  if (new TextEncoder().encode(json).byteLength > limits.maxManifestBytes) throw new Error('制作包清单超过上限，请改用单集导出');
  textFile(PACKAGE_MANIFEST, json);
  if (missing.length) textFile('缺失文件.txt', `制作包不完整，以下引用未打包：\r\n${files.filter(file => file.status === 'missing').map(file => `${file.name}\t${file.url}\t${file.reason}`).join('\r\n')}`);
  options.signal?.throwIfAborted();
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  options.signal?.throwIfAborted();
  if (blob.size > limits.maxArchiveBytes) throw new Error('制作包压缩大小超过上限，请改用单集导出');
  return { blob, fileName: `${safeFileName(doc.title)}_整项目_${options.mediaMode === 'history' ? '含历史' : '选用素材'}.zip`, missing, complete: !missing.length };
}

function episodeLabel(doc: DramaProjectV1, episodeId: string): string {
  const episode = doc.episodes.find(item => item.id === episodeId);
  const number = episode ? `第${episode.index + 1}集` : '';
  return safeFileName([doc.title, number].filter(Boolean).join('_'));
}

export function exportFileName(doc: DramaProjectV1, episodeId: string, suffix: string): string {
  return `${episodeLabel(doc, episodeId)}_${suffix}`;
}

/**
 * ZIP with the script, shot list, subtitles and every media file of the episode, plus the document so the workbench can import it.
 * Downloads run a few at a time.
 */
export async function buildEpisodePackage(
  doc: DramaProjectV1, episodeId: string,
  options: { fetch?: Fetcher; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<PackageResult> {
  const fetcher = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const episode = doc.episodes.find(item => item.id === episodeId);
  if (!episode) throw new Error('这一集不存在，请刷新后重试');
  const zip = new JSZip();
  zip.file('剧本.txt', episode.script || '');
  zip.file('镜头表.csv', shotListCsv(doc, episodeId));
  const srt = episodeSrt(doc, episodeId);
  if (srt) zip.file('字幕.srt', srt);

  const media = episodePackageMedia(doc, episodeId);
  if (media.length + 5 > PACKAGE_LIMITS.maxFiles) throw new Error('制作包文件数量超过上限');
  const missing: string[] = [];
  const packed: typeof media = [];
  let bytesUsed = new TextEncoder().encode(episode.script + shotListCsv(doc, episodeId) + srt).byteLength;
  let done = 0;
  const queue = [...media];
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      options.signal?.throwIfAborted();
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(new Error('文件下载超时')), 60_000);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
      try {
        const response = await fetcher(item.url, { signal, credentials: 'same-origin' });
        const bytes = await boundedMedia(response, Math.min(PACKAGE_LIMITS.maxFileBytes, PACKAGE_LIMITS.maxTotalBytes - bytesUsed), signal);
        if (bytesUsed + bytes.byteLength > PACKAGE_LIMITS.maxTotalBytes) throw new Error('制作包总大小超过上限');
        bytesUsed += bytes.byteLength;
        zip.file(item.name, bytes);
        packed.push(item);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        missing.push(item.name);
      } finally { clearTimeout(timer); }
      done += 1;
      options.onProgress?.(done, media.length);
    }
  });
  await Promise.all(workers);
  const manifest = JSON.stringify(packageManifest(doc, episodeId, packed), null, 2);
  const manifestBytes = new TextEncoder().encode(manifest).byteLength;
  if (manifestBytes > PACKAGE_LIMITS.maxManifestBytes || bytesUsed + manifestBytes > PACKAGE_LIMITS.maxTotalBytes) throw new Error('制作包清单或总大小超过上限');
  zip.file(PACKAGE_MANIFEST, manifest);
  if (missing.length) zip.file('缺失文件.txt', `以下文件下载失败，没有打进压缩包：\r\n${missing.sort().join('\r\n')}\r\n`);
  const blob = await zip.generateAsync({ type: 'blob' });
  options.signal?.throwIfAborted();
  if (blob.size > PACKAGE_LIMITS.maxArchiveBytes) throw new Error('制作包压缩大小超过上限');
  return { blob, fileName: exportFileName(doc, episodeId, '制作包.zip'), missing, complete: missing.length === 0 };
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoke after the click has been handled, or some browsers cancel the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadText(text: string, fileName: string, type: string): void {
  downloadBlob(new Blob([text], { type }), fileName);
}
