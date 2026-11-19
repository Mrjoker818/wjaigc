/** Pictures and videos the workbench can pick from: the project's canvas, its dramas and images sent from chat. Pure. */
import { castViewImage } from './bible-images';
import { CAST_VIEWS, type CastView } from './reference-prompts';
import { activeTake, type DramaProjectV1 } from './types';

export type LibrarySource = 'canvas' | 'drama' | 'chat';

export interface LibraryItem {
  url: string;
  kind: 'image' | 'video';
  /** What the item is, in the user's words: "招财猫 · 林辰正面", or the canvas prompt. */
  name: string;
  source: LibrarySource;
  thumbnailUrl?: string;
}

/** The canvas fields the library reads; matches `CanvasImage` without depending on the canvas module. */
export interface CanvasMediaLike {
  url?: string;
  name?: string;
  prompt?: string;
  mediaType?: 'image' | 'video';
  videoUrl?: string;
  thumbnailUrl?: string;
  isProcessingPlaceholder?: boolean;
  mediaAvailability?: string;
}

const VIEW_NAME: Record<CastView, string> = { front: '正面', side: '侧面', back: '背面', face: '面部' };
const UNUSABLE = new Set(['missing', 'unrecoverable', 'recovering', 'pending-persist']);

/** Only stored addresses can be referenced later; data: and blob: URLs live in one browser tab. */
function storedUrl(url: string | undefined): url is string {
  return Boolean(url) && (url!.startsWith('/') || url!.startsWith('https://'));
}

export function canvasLibraryItems(images: readonly CanvasMediaLike[]): LibraryItem[] {
  const out: LibraryItem[] = [];
  for (const image of images) {
    if (image.isProcessingPlaceholder || (image.mediaAvailability && UNUSABLE.has(image.mediaAvailability))) continue;
    const name = (image.name || image.prompt || '').trim().slice(0, 80) || '画布上的图';
    if (image.mediaType === 'video') {
      if (storedUrl(image.videoUrl)) {
        out.push({ url: image.videoUrl, kind: 'video', name, source: 'canvas', ...(storedUrl(image.thumbnailUrl) ? { thumbnailUrl: image.thumbnailUrl } : {}) });
      }
    } else if (storedUrl(image.url)) {
      out.push({ url: image.url, kind: 'image', name, source: 'canvas' });
    }
  }
  return dedupe(out);
}

/** Every bible image, keyframe, selected take and finished film of a drama, plus the images chat sent with it. */
export function dramaLibraryItems(doc: DramaProjectV1, label = doc.title || '未命名短剧'): LibraryItem[] {
  const out: LibraryItem[] = [];
  const add = (url: string | undefined, kind: LibraryItem['kind'], name: string, extra: Partial<LibraryItem> = {}) => {
    if (storedUrl(url)) out.push({ url, kind, name: `${label} · ${name}`, source: 'drama', ...extra });
  };
  for (const member of doc.cast) {
    for (const view of CAST_VIEWS) add(castViewImage(member, view), 'image', `${member.name}${VIEW_NAME[view]}`);
  }
  for (const location of doc.locations) add(location.imageUrl, 'image', `场景 ${location.name}`);
  for (const prop of doc.props) add(prop.imageUrl, 'image', `道具 ${prop.name}`);
  doc.episodes.forEach((episode, episodeIndex) => {
    const prefix = doc.episodes.length > 1 ? `第${episodeIndex + 1}集 ` : '';
    episode.scenes.flatMap(scene => scene.shots).forEach((shot, i) => {
      const number = `${prefix}镜头 ${String(i + 1).padStart(2, '0')}`;
      add(shot.firstFrameUrl, 'image', `${number}首帧`);
      add(shot.lastFrameUrl, 'image', `${number}尾帧`);
      const take = activeTake(shot);
      add(take?.videoUrl, 'video', number, storedUrl(take?.thumbnailUrl ?? shot.firstFrameUrl)
        ? { thumbnailUrl: take?.thumbnailUrl ?? shot.firstFrameUrl } : {});
    });
  });
  const last = doc.timeline.lastRender;
  if (last?.status === 'completed') add(last.videoUrl, 'video', '成片', storedUrl(last.thumbnailUrl) ? { thumbnailUrl: last.thumbnailUrl } : {});
  for (const reference of doc.references ?? []) {
    if (storedUrl(reference.url)) {
      out.push({ url: reference.url, kind: 'image', name: reference.name || '对话里发来的图', source: reference.source === 'canvas' ? 'canvas' : 'chat' });
    }
  }
  return dedupe(out);
}

/** Joins lists, keeping the first entry of each address so the nearer source wins. */
export function mergeLibrary(...lists: ReadonlyArray<readonly LibraryItem[]>): LibraryItem[] {
  return dedupe(lists.flat());
}

function dedupe(items: readonly LibraryItem[]): LibraryItem[] {
  const seen = new Set<string>();
  return items.filter(item => (seen.has(item.url) ? false : (seen.add(item.url), true)));
}
