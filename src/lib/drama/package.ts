/** The drama document inside an episode's production package, so the ZIP can be imported back into the workbench. Pure. */
import { activeTake, type DramaProjectV1 } from './types';
import { rebaseImportedProduction } from './production-version';

export const PACKAGE_MANIFEST = '短剧.json';
const PACKAGE_FORMAT = 'wujie-drama-package';
/** The request proxy rejects bodies over 50MB, so an uploaded clip has to fit under that with the form overhead. */
export const MAX_DRAMA_CLIP_BYTES = 48 * 1024 * 1024;
/** ZIPs are held in browser memory. Limit both compressed input and expanded content. */
export const PACKAGE_LIMITS = {
  maxArchiveBytes: 256 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024,
  maxFileBytes: MAX_DRAMA_CLIP_BYTES, maxManifestBytes: 8 * 1024 * 1024, maxFiles: 10_000,
} as const;
export type PackageMediaMode = 'selected' | 'history';
export type PackageLimits = { [K in keyof typeof PACKAGE_LIMITS]: number };
export interface PackageFileReference {
  url: string;
  name: string;
  references: string[];
  status: 'packed' | 'missing';
  bytes?: number;
  reason?: string;
}
export interface ProjectArchive {
  scope: 'project';
  mediaMode: PackageMediaMode;
  complete: boolean;
  files: PackageFileReference[];
  /** Completed images detached from current bible/shot fields; never contains operation handles. */
  completedProductionImages?: unknown[];
}

export interface PackageManifest {
  format: typeof PACKAGE_FORMAT;
  version: 1;
  doc: DramaProjectV1;
  /** Document URL → file inside the ZIP. Only files that made it into the ZIP are listed. */
  media: Record<string, string>;
  /** Optional extension of the v1 envelope, retaining episode package compatibility. */
  archive?: ProjectArchive;
}

const OPERATION_KEY = /^(?:taskId|taskIds|operationId|operationIds|runId|checkpoint|checkpoints|productionRun|productionImages|runCheckpoint|runCheckpoints|leaseToken|leaseOwner|idempotencyKey)$/iu;

/** No exporting account's operations may be polled or retried by the importing account. */
export function stripPackageOperations<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => stripPackageOperations(item)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !OPERATION_KEY.test(key)).map(([key, item]) => [key, stripPackageOperations(item)])) as T;
}

/** Retain original numbering, scripts, source ranges, completed media and production provenance. */
export function projectPackageDoc(doc: DramaProjectV1, mode: PackageMediaMode): DramaProjectV1 {
  if (mode !== 'selected' && mode !== 'history') bad('请选择选用素材或含历史模式');
  const out = stripPackageOperations(doc);
  if (mode === 'selected') delete out.retainedImages;
  if (out.timeline.lastRender?.status !== 'completed') delete out.timeline.lastRender;
  // The incumbent schema requires this string. Empty means there is no resumable render handle.
  else out.timeline.lastRender.taskId = '';
  for (const item of [...out.cast, ...out.locations, ...out.props]) {
    if (mode === 'selected') delete item.imageHistory;
    item.generating = false;
    if (item.status === 'generating' || item.status === 'pending') item.status = item.lockedImageUrl ? 'completed' : 'pending';
    if ('generateStatus' in item && item.generateStatus === 'generating') item.generateStatus = 'pending';
  }
  for (const episode of out.episodes) for (const scene of [...episode.scenes, ...(episode.archivedScenes ?? [])]) for (const shot of scene.shots) {
    const selected = activeTake(shot);
    shot.takes = shot.takes.filter(take => (take.status === 'completed' || take.status === 'failed') && (mode === 'history' || take.id === selected?.id));
    if (!shot.takes.some(take => take.id === shot.selectedTakeId)) delete shot.selectedTakeId;
    if (['submitted', 'generating', 'diagnosing'].includes(shot.status)) shot.status = selected ? 'completed' : 'planned';
  }
  return out;
}

export function completedPackageImages(doc: DramaProjectV1): unknown[] {
  const images = (doc as unknown as Record<string, unknown>).productionImages;
  const out: unknown[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if ((record.status === 'completed' || record.state === 'stored' || (record.state === 'retrieving' && typeof record.sourceUrl === 'string')) && (typeof record.url === 'string' || typeof record.sourceUrl === 'string')) out.push(stripPackageOperations(value));
    else Object.values(value).forEach(visit);
  };
  visit(images);
  return out;
}

/** URL occurrences, including repeated uses and JSON dependency snapshots; prose is never scanned for links. */
export function packageReferences(value: unknown, root = ''): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const visit = (item: unknown, path: string, key: string, history: boolean) => {
    if (typeof item === 'string') {
      if (/snapshot$/iu.test(key)) {
        try { visit(JSON.parse(item), `${path}/@json`, '', false); } catch { /* Legacy opaque snapshot. */ }
      } else if (item && (/(?:url|urls)$/iu.test(key) || /^(?:imageUrl|images?$)/iu.test(key) || history)) {
        out.set(item, [...(out.get(item) ?? []), path]);
      }
    } else if (Array.isArray(item)) item.forEach((child, i) => visit(child, `${path}/${i}`, key, history));
    else if (item && typeof item === 'object') for (const [name, child] of Object.entries(item)) {
      visit(child, `${path}/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`, name, history || name === 'imageHistory');
    }
  };
  visit(value, root, '', false);
  return out;
}

/** ZIP paths are relative, literal, slash-separated and never repaired into another path. */
export function assertPackagePath(name: string): void {
  let decoded = name;
  for (let i = 0; i < 3; i++) {
    if (!decoded || decoded.length > 512 || /[\\:\u0000-\u001f\u007f]/u.test(decoded) || decoded.startsWith('/') || decoded.split('/').some(part => !part || part === '.' || part === '..')) bad('制作包包含不安全的文件路径');
    try { const next = decodeURIComponent(decoded); if (next === decoded) return; decoded = next; }
    catch {
      // A filename may contain a literal percent (e.g. "100%"), but never a partially encoded path.
      if (/%[a-f\d]{2}/iu.test(decoded)) bad('制作包包含无效的文件路径');
      return;
    }
  }
  bad('制作包包含无效的文件路径');
}

/**
 * The project with only this episode, renumbered as the first. Takes still generating and a render still running are dropped:
 * their tasks belong to the account that exported them and cannot be polled after an import.
 */
export function packageDoc(doc: DramaProjectV1, episodeId: string): DramaProjectV1 {
  const episode = doc.episodes.find(item => item.id === episodeId);
  const last = doc.timeline.lastRender;
  const keepRender = last?.status === 'completed' && last.episodeId === episodeId;
  const timeline = { ...doc.timeline };
  delete timeline.lastRender;
  const out = stripPackageOperations({
    ...doc,
    episodes: episode ? [{
      ...episode, index: 0,
      scenes: episode.scenes.map(scene => ({
        ...scene,
        shots: scene.shots.map(shot => {
          const takes = shot.takes.filter(take => take.status === 'completed' || take.status === 'failed');
          const selected = takes.some(take => take.id === shot.selectedTakeId);
          return { ...shot, takes, ...(selected ? {} : { selectedTakeId: undefined }) };
        }),
      })),
    }] : [],
    timeline: keepRender ? { ...timeline, lastRender: last } : timeline,
  });
  if (out.timeline.lastRender) out.timeline.lastRender = { ...out.timeline.lastRender, taskId: '' };
  return out;
}

export function packageManifest(doc: DramaProjectV1, episodeId: string, media: Array<{ name: string; url: string }>): PackageManifest {
  return { format: PACKAGE_FORMAT, version: 1, doc: packageDoc(doc, episodeId), media: Object.fromEntries(media.map(item => [item.url, item.name])) };
}

/** Thrown with a message the user can act on. */
function bad(message: string): never { throw new Error(message); }

export function readPackageManifest(text: string): PackageManifest {
  let value: unknown;
  try { value = JSON.parse(text); } catch { bad(`「${PACKAGE_MANIFEST}」已损坏，重新导出制作包后再导入`); }
  const manifest = value as Partial<PackageManifest> | null;
  if (!manifest || manifest.format !== PACKAGE_FORMAT || manifest.version !== 1 || typeof manifest.doc !== 'object' || !manifest.doc) {
    bad(`「${PACKAGE_MANIFEST}」不是工作台导出的短剧，换一个制作包再试`);
  }
  const media = manifest.media && typeof manifest.media === 'object' ? manifest.media : {};
  for (const name of Object.values(media)) if (typeof name === 'string') assertPackagePath(name);
  if (manifest.archive !== undefined) {
    const archive = manifest.archive;
    if (!archive || archive.scope !== 'project' || !['selected', 'history'].includes(archive.mediaMode) || typeof archive.complete !== 'boolean' || !Array.isArray(archive.files) || archive.files.length > PACKAGE_LIMITS.maxFiles) bad('制作包归档清单无效');
    const urls = new Set<string>();
    const names = new Set<string>();
    for (const file of archive.files) {
      if (!file || typeof file.url !== 'string' || typeof file.name !== 'string' || !Array.isArray(file.references) || !file.references.length || !file.references.every(ref => typeof ref === 'string') || !['packed', 'missing'].includes(file.status)) bad('制作包引用清单无效');
      assertPackagePath(file.name);
      if (urls.has(file.url) || names.has(file.name)) bad('制作包引用清单重复');
      urls.add(file.url); names.add(file.name);
      if ((file.status === 'packed' && media[file.url] !== file.name) || (file.status === 'missing' && file.url in media)) bad('制作包文件清单与引用不一致');
    }
    if (archive.complete !== archive.files.every(file => file.status === 'packed') || Object.keys(media).some(url => !urls.has(url))) bad('制作包完整性声明无效');
    const refs = packageReferences(manifest.doc, '/doc');
    for (const [url, paths] of packageReferences(archive.completedProductionImages, '/archive/completedProductionImages')) refs.set(url, [...(refs.get(url) ?? []), ...paths]);
    for (const [url, paths] of refs) if (!archive.files.some(file => file.url === url && paths.every(path => file.references.includes(path)))) bad('制作包缺失引用清单');
  }
  return {
    ...manifest as PackageManifest,
    media: Object.fromEntries(Object.entries(media).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  };
}

/** Rewrite JSON bindings after a real remap. Opaque digests remain bound to old inputs and require revalidation. */
export function remapPackageDocument<T>(value: T, urls: ReadonlyMap<string, string>): T {
  const changed = [...packageReferences(value).keys()].some(url => urls.has(url) && urls.get(url) !== url);
  const visit = (item: unknown, key = '', history = false): unknown => {
    if (typeof item === 'string') return history || /(?:url|urls)$/iu.test(key) || /^(?:imageUrl|images?$)/iu.test(key) ? urls.get(item) ?? item : item;
    if (Array.isArray(item)) return item.map(child => visit(child, key, history));
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).flatMap(([key, child]) => {
      if (changed && /snapshot$/iu.test(key) && typeof child === 'string') {
        try { return [[key, JSON.stringify(visit(JSON.parse(child)))]]; } catch { return [[key, child]]; }
      }
      return [[key, visit(child, key, history || key === 'imageHistory')]];
    }));
  };
  const remapped = stripPackageOperations(visit(value)) as T;
  return changed && value && typeof value === 'object' && (value as { schemaId?: unknown }).schemaId === 'drama-project-v1'
    ? rebaseImportedProduction(value as unknown as DramaProjectV1, remapped as unknown as DramaProjectV1) as T : remapped;
}

export type PackageMediaKind = 'image' | 'video' | 'audio';

export function packageMediaKind(name: string): PackageMediaKind | null {
  const ext = /\.([a-z0-9]+)$/iu.exec(name)?.[1]?.toLowerCase();
  if (!ext) return null;
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav'].includes(ext)) return 'audio';
  return null;
}

/** Copy of the document with every string equal to an old URL replaced by its new URL, wherever it appears (takes, history, music). */
export function replaceUrls<T>(value: T, urls: ReadonlyMap<string, string>): T {
  if (typeof value === 'string') return (urls.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map(item => replaceUrls(item, urls)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceUrls(item, urls)])) as T;
  }
  return value;
}
