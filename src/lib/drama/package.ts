/** The drama document inside an episode's production package, so the ZIP can be imported back into the workbench. Pure. */
import type { DramaProjectV1 } from './types';

export const PACKAGE_MANIFEST = '短剧.json';
const PACKAGE_FORMAT = 'wujie-drama-package';
/** The request proxy rejects bodies over 50MB, so an uploaded clip has to fit under that with the form overhead. */
export const MAX_DRAMA_CLIP_BYTES = 48 * 1024 * 1024;

export interface PackageManifest {
  format: typeof PACKAGE_FORMAT;
  version: 1;
  doc: DramaProjectV1;
  /** Document URL → file inside the ZIP. Only files that made it into the ZIP are listed. */
  media: Record<string, string>;
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
  return {
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
  };
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
  return {
    ...manifest as PackageManifest,
    media: Object.fromEntries(Object.entries(media).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  };
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
