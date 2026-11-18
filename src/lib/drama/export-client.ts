/** Builds the episode's production package in the browser and hands files to the user as downloads. */
import JSZip from 'jszip';
import { episodePackageMedia, episodeSrt, safeFileName, shotListCsv } from './export';
import type { DramaProjectV1 } from './types';

type Fetcher = (input: string) => Promise<Response>;

export interface PackageResult {
  blob: Blob;
  fileName: string;
  /** Media that could not be downloaded; listed in the package so nothing goes missing silently. */
  missing: string[];
}

function episodeLabel(doc: DramaProjectV1, episodeId: string): string {
  const episode = doc.episodes.find(item => item.id === episodeId);
  const number = episode ? `第${episode.index + 1}集` : '';
  return safeFileName([doc.title, number].filter(Boolean).join('_'));
}

export function exportFileName(doc: DramaProjectV1, episodeId: string, suffix: string): string {
  return `${episodeLabel(doc, episodeId)}_${suffix}`;
}

/** ZIP with the script, shot list, subtitles and every media file of the episode. Downloads run a few at a time. */
export async function buildEpisodePackage(
  doc: DramaProjectV1, episodeId: string,
  options: { fetch?: Fetcher; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<PackageResult> {
  const fetcher = options.fetch ?? ((input: string) => fetch(input, { signal: options.signal }));
  const episode = doc.episodes.find(item => item.id === episodeId);
  if (!episode) throw new Error('这一集不存在，请刷新后重试');
  const zip = new JSZip();
  zip.file('剧本.txt', episode.script || '');
  zip.file('镜头表.csv', shotListCsv(doc, episodeId));
  const srt = episodeSrt(doc, episodeId);
  if (srt) zip.file('字幕.srt', srt);

  const media = episodePackageMedia(doc, episodeId);
  const missing: string[] = [];
  let done = 0;
  const queue = [...media];
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      options.signal?.throwIfAborted();
      try {
        const response = await fetcher(item.url);
        if (!response.ok) throw new Error(String(response.status));
        zip.file(item.name, await response.arrayBuffer());
      } catch (error) {
        if (options.signal?.aborted) throw error;
        missing.push(item.name);
      }
      done += 1;
      options.onProgress?.(done, media.length);
    }
  });
  await Promise.all(workers);
  if (missing.length) zip.file('缺失文件.txt', `以下文件下载失败，没有打进压缩包：\r\n${missing.sort().join('\r\n')}\r\n`);
  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, fileName: exportFileName(doc, episodeId, '制作包.zip'), missing };
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
