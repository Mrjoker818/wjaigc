/** Opens a production package exported by the workbench as a new drama, uploading the media it carries. Runs in the browser. */
import JSZip from 'jszip';
import { parseDramaProject } from './schema';
import { MAX_DRAMA_CLIP_BYTES, PACKAGE_LIMITS, PACKAGE_MANIFEST, assertPackagePath, packageMediaKind, projectPackageDoc, readPackageManifest, remapPackageDocument, type PackageMediaKind } from './package';
import type { DramaProjectRecord } from './types';
import { createDramaProject, IMAGE_TOO_BIG, uploadDramaClip, uploadDramaMusic, uploadReferenceImage, type WorkbenchFetch } from './workbench-client';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v', mp3: 'audio/mpeg', wav: 'audio/wav',
};

export interface ImportResult {
  record: DramaProjectRecord;
  /** Files in the package that could not be uploaded; the drama keeps their original addresses. */
  failed: string[];
}

/** The default image edge limit of the upload route. */
const UPLOAD_MAX_EDGE = 2048;

type Shrink = (file: File, maxEdge: number) => Promise<File>;

export interface ImportOptions {
  projectId?: string;
  fetch?: WorkbenchFetch;
  onProgress?: (done: number, total: number) => void;
  /** Replaces the browser's canvas resize in tests. */
  shrink?: Shrink;
}

/** Redraws the image so its longer edge is at most `maxEdge`, as PNG. Generated 4K frames are bigger than uploads allow. */
async function shrinkInBrowser(file: File, maxEdge: number): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error(IMAGE_TOO_BIG);
  return new File([blob], file.name.replace(/\.[a-z0-9]+$/iu, '.png'), { type: 'image/png' });
}

function uploadMedia(kind: PackageMediaKind, file: File, fetcher: WorkbenchFetch | undefined, shrink: Shrink): Promise<string> {
  if (kind === 'image') {
    return uploadReferenceImage(file, fetcher).catch(async (error: unknown) => {
      if (!(error instanceof Error) || error.message !== IMAGE_TOO_BIG) throw error;
      return uploadReferenceImage(await shrink(file, UPLOAD_MAX_EDGE), fetcher);
    });
  }
  if (kind === 'video') {
    if (file.size > MAX_DRAMA_CLIP_BYTES) return Promise.reject(new Error('视频超过 48MB'));
    return uploadDramaClip(file, fetcher);
  }
  return uploadDramaMusic(file, fetcher).then(result => result.url);
}

/** Central-directory sizes are untrusted. Stop actual inflation before allocating an oversized blob. */
function boundedZipBytes(entry: JSZip.JSZipObject, maxBytes: number, reserve: (bytes: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let settled = false;
    // JSZip exposes this browser streaming API at runtime but omits it from JSZipObject's declarations.
    const stream = (entry as JSZip.JSZipObject & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array');
    stream.on('data', (chunk: Uint8Array) => {
      if (settled) return;
      try {
        size += chunk.byteLength;
        if (size > maxBytes) throw new Error('制作包文件实际展开大小超过上限');
        reserve(chunk.byteLength);
        chunks.push(chunk);
      } catch (error) { settled = true; stream.pause(); reject(error); }
    });
    stream.on('error', (error: unknown) => { if (!settled) { settled = true; reject(error); } });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      resolve(bytes);
    });
    stream.resume();
  });
}

export async function importDramaPackage(file: Blob, options: ImportOptions = {}): Promise<ImportResult> {
  if (file.size > PACKAGE_LIMITS.maxArchiveBytes) throw new Error('制作包压缩大小超过上限，请使用单集制作包');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error('这个文件不是 ZIP 压缩包，选择工作台导出的「制作包」再试');
  }
  let expanded = 0;
  const entries = Object.values(zip.files);
  if (entries.length > PACKAGE_LIMITS.maxFiles * 2) throw new Error('制作包文件数量超过上限');
  for (const media of entries) {
    assertPackagePath(media.dir ? media.name.replace(/\/$/u, '') : media.name);
    const original = (media as unknown as { unsafeOriginalName?: string }).unsafeOriginalName;
    if (original) assertPackagePath(original);
    const size = (media as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (!media.dir && (!Number.isSafeInteger(size) || size! < 0 || size! > PACKAGE_LIMITS.maxFileBytes)) throw new Error('制作包文件展开大小超过上限');
    expanded += size ?? 0;
    if (expanded > PACKAGE_LIMITS.maxTotalBytes) throw new Error('制作包展开大小超过上限');
  }
  const entry = zip.file(PACKAGE_MANIFEST);
  if (!entry) throw new Error(`压缩包里没有「${PACKAGE_MANIFEST}」，只能导入工作台导出的制作包`);
  if ((entry as unknown as { _data: { uncompressedSize: number } })._data.uncompressedSize > PACKAGE_LIMITS.maxManifestBytes) throw new Error('制作包清单超过上限');
  let actualExpanded = 0;
  const reserve = (size: number) => {
    actualExpanded += size;
    if (actualExpanded > PACKAGE_LIMITS.maxTotalBytes) throw new Error('制作包实际展开总大小超过上限');
  };
  const manifest = readPackageManifest(new TextDecoder().decode(await boundedZipBytes(entry, PACKAGE_LIMITS.maxManifestBytes, reserve)));
  manifest.doc = parseDramaProject(manifest.doc);
  // Legacy episode packages keep their established partial-import behavior. Project archives are explicit about completeness.
  if (manifest.archive && (!manifest.archive.complete || Object.values(manifest.media).some(name => !packageMediaKind(name) || !zip.file(name)))) throw new Error('整项目制作包不完整或文件缺失，请修复缺失文件后重新导出');

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
        const bytes = await boundedZipBytes(job.media, PACKAGE_LIMITS.maxFileBytes, reserve);
        const blob = new Blob([bytes.buffer]);
        const expected = manifest.archive?.files.find(item => item.url === job.url)?.bytes;
        if (blob.size > PACKAGE_LIMITS.maxFileBytes || (expected !== undefined && blob.size !== expected)) throw new Error('制作包文件大小与清单不一致');
        const picked = new File([blob], job.name.split('/').pop()!, { type: MIME[ext] ?? '' });
        urls.set(job.url, await uploadMedia(job.kind, picked, options.fetch, options.shrink ?? shrinkInBrowser));
      } catch {
        failed.push(job.name);
      }
      done += 1;
      options.onProgress?.(done, jobs.length);
    }
  });
  await Promise.all(workers);

  if (manifest.archive && failed.length) throw new Error(`${failed.length} 个文件上传失败，未创建不完整的项目，请重试导入`);
  const remapped = projectPackageDoc(remapPackageDocument(manifest.doc, urls), 'history');
  const detached = remapPackageDocument(manifest.archive?.completedProductionImages ?? [], urls);
  const retained = [...(remapped.retainedImages ?? [])];
  for (const value of detached) {
    if (!value || typeof value !== 'object') continue;
    const image = value as Record<string, unknown>;
    const url = typeof image.url === 'string' ? image.url : typeof image.sourceUrl === 'string' ? image.sourceUrl : undefined;
    if (url && !retained.some(item => item.url === url)) retained.push({ url, ...(typeof image.sourceUrl === 'string' ? { sourceUrl: image.sourceUrl } : {}), ...(typeof image.name === 'string' ? { name: image.name.slice(0, 200) } : {}) });
  }
  if (retained.length > 500) throw new Error('归档图片超过项目上限，未创建不完整项目');
  if (retained.length) remapped.retainedImages = retained;
  const record = await createDramaProject(remapped, options.projectId, options.fetch);
  return { record, failed: failed.sort() };
}
