/** Opens a production package exported by the workbench as a new drama, uploading the media it carries. Runs in the browser. */
import JSZip from 'jszip';
import { MAX_DRAMA_CLIP_BYTES, PACKAGE_MANIFEST, packageMediaKind, readPackageManifest, replaceUrls, type PackageMediaKind } from './package';
import type { DramaProjectRecord } from './types';
import { createDramaProject, uploadDramaClip, uploadDramaMusic, uploadReferenceImage, type WorkbenchFetch } from './workbench-client';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v', mp3: 'audio/mpeg', wav: 'audio/wav',
};

export interface ImportResult {
  record: DramaProjectRecord;
  /** Files in the package that could not be uploaded; the drama keeps their original addresses. */
  failed: string[];
}

export interface ImportOptions {
  projectId?: string;
  fetch?: WorkbenchFetch;
  onProgress?: (done: number, total: number) => void;
}

function uploadMedia(kind: PackageMediaKind, file: File, fetcher?: WorkbenchFetch): Promise<string> {
  if (kind === 'image') return uploadReferenceImage(file, fetcher);
  if (kind === 'video') {
    if (file.size > MAX_DRAMA_CLIP_BYTES) return Promise.reject(new Error('视频超过 48MB'));
    return uploadDramaClip(file, fetcher);
  }
  return uploadDramaMusic(file, fetcher).then(result => result.url);
}

export async function importDramaPackage(file: Blob, options: ImportOptions = {}): Promise<ImportResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error('这个文件不是 ZIP 压缩包，选择工作台导出的「制作包」再试');
  }
  const entry = zip.file(PACKAGE_MANIFEST);
  if (!entry) throw new Error(`压缩包里没有「${PACKAGE_MANIFEST}」，只能导入工作台导出的制作包`);
  const manifest = readPackageManifest(await entry.async('string'));

  const jobs = Object.entries(manifest.media).flatMap(([url, name]) => {
    const kind = packageMediaKind(name);
    const media = zip.file(name);
    return kind && media ? [{ url, name, kind, media }] : [];
  });
  const urls = new Map<string, string>();
  const failed: string[] = [];
  let done = 0;
  options.onProgress?.(0, jobs.length);
  const queue = [...jobs];
  const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        const ext = job.name.split('.').pop()!.toLowerCase();
        const blob = await job.media.async('blob');
        const picked = new File([blob], job.name.split('/').pop()!, { type: MIME[ext] ?? '' });
        urls.set(job.url, await uploadMedia(job.kind, picked, options.fetch));
      } catch {
        failed.push(job.name);
      }
      done += 1;
      options.onProgress?.(done, jobs.length);
    }
  });
  await Promise.all(workers);

  const record = await createDramaProject(replaceUrls(manifest.doc, urls), options.projectId, options.fetch);
  return { record, failed: failed.sort() };
}
