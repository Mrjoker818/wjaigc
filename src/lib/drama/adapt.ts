/** Long-text adaptation helpers: split a novel into parts, prompt one episode per part, merge the parts into one project. */
import { DIRECTOR_STYLES, normalizeDirectorStyle, type DirectorStyle } from '@/lib/video-director/director-styles';
import type { DramaProjectV1 } from './types';

export const ADAPT_MAX_CHARS = 60_000;
export const ADAPT_MIN_CHARS = 200;
/** One part becomes one episode; this keeps a planner call well inside its 90 s limit. */
export const ADAPT_CHUNK_CHARS = 8000;

const SENTENCE_ENDS = ['。', '！', '？', '!', '?', '…', '」', '”'];

/**
 * Splits at a paragraph break near the end of each part, else at a sentence end, else hard.
 * A short tail joins the previous part so the last episode is not a fragment.
 */
export function splitSourceText(text: string, size = ADAPT_CHUNK_CHARS): string[] {
  let rest = text.replace(/\r\n?/gu, '\n').trim();
  const chunks: string[] = [];
  const min = Math.floor(size * 0.6);
  while (rest.length > size) {
    const window = rest.slice(0, size);
    let cut = window.lastIndexOf('\n') + 1;
    if (cut < min) cut = Math.max(...SENTENCE_ENDS.map(mark => window.lastIndexOf(mark))) + 1;
    if (cut < min) cut = size;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest && chunks.length && rest.length < size * 0.2) chunks[chunks.length - 1] += `\n${rest}`;
  else if (rest) chunks.push(rest);
  return chunks;
}

export interface AdaptSettings {
  title?: string;
  style?: DirectorStyle;
  aspectRatio?: string;
  episodeDurationSec?: number;
}

export interface AdaptChunkInput extends AdaptSettings {
  chunk: string;
  index: number;
  total: number;
  /** Cast, locations and props from the parts already adapted; their ids must be reused. */
  known: Pick<DramaProjectV1, 'cast' | 'locations' | 'props'>;
  /** Logline of the previous episode, so this one continues from it. */
  previous?: string;
}

const listed = (items: Array<{ id: string; name: string }>) => items.slice(0, 80).map(item => `${item.id}=${item.name}`).join('；');

export function buildAdaptChunkPrompt(input: AdaptChunkInput): string {
  const style = normalizeDirectorStyle(input.style);
  const duration = Math.min(600, Math.max(15, Math.round(Number(input.episodeDurationSec) || 60)));
  const { known } = input;
  return [
    '你是专业短剧编剧，正在把一部小说按段改编成连续的短剧分集。仅返回一个 JSON 对象，不要 Markdown 或解释。',
    `这是全文第 ${input.index + 1}/${input.total} 段，改编成第 ${input.index + 1} 集，约 ${duration} 秒，画面比例 ${input.aspectRatio || '9:16'}。`,
    `视觉风格：${DIRECTOR_STYLES[style].planDescription}`,
    '忠于原文的人物、情节和关键台词；可以删减枝节、合并场次。开场 3 秒内有冲突，结尾留钩子；台词口语化、短句。',
    input.previous ? `上一集梗概：${input.previous}` : '',
    known.cast.length ? `已建立的角色（同一人物必须沿用这个 id）：${listed(known.cast)}` : '',
    known.locations.length ? `已建立的场景（同一地点沿用这个 id）：${listed(known.locations)}` : '',
    known.props.length ? `已建立的道具（沿用这个 id）：${listed(known.props)}` : '',
    'JSON 结构：{"title":片名,"genre":string,"logline":全剧一句话梗概,',
    '"cast":[{"id":英文id,"name":string,"role":主角/配角/反派,"age":string,"gender":string,"appearance":外貌50-100字,"costume":string,"hair":string}],',
    '"locations":[{"id":英文id,"name":场景名,"location":string,"timeOfDay":string,"lighting":string,"mood":string,"description":50-100字}],',
    '"props":[{"id":英文id,"name":道具名,"role":在故事里的作用,"description":外观材质颜色30-60字}],',
    '"episodes":[恰好 1 个：{"title":本集标题,"logline":本集梗概,"script":本集剧本(含场次标题、动作描写、台词，不超过 1500 字),',
    '"scenes":[2-8 个：{"heading":场次标题如"咖啡馆·内·夜","summary":本场发生的事和关键台词,"locationId":locations中的id,"characterIds":cast中的id数组}]}]}',
    'cast/locations/props 列出本集出场的：已建立的沿用原 id，外貌等字段可以留空；新出现的用新的英文 id，不要和已有 id 重复。',
    input.title ? `片名：${input.title}` : '',
    `原文：\n${input.chunk}`,
  ].filter(Boolean).join('\n');
}

/** Copies fields the existing entry leaves empty; an id seen before keeps its first description. */
function fillEmpty<T extends object>(existing: T, incoming: T): T {
  const out = { ...existing } as Record<string, unknown>;
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined && value !== '' && (out[key] === undefined || out[key] === '')) out[key] = value;
  }
  return out as T;
}

/**
 * Appends one adapted part. Reused ids merge into the existing entry; an id already taken by another
 * kind of entry is renamed, and the part's scenes follow the rename.
 */
export function mergeAdaptedChunk(base: DramaProjectV1 | null, part: DramaProjectV1): DramaProjectV1 {
  if (!base) return { ...part, episodes: part.episodes.map((episode, i) => ({ ...episode, index: i })) };
  const taken = new Set([...base.cast, ...base.locations, ...base.props].map(item => item.id));
  const merge = <T extends { id: string }>(existing: T[], incoming: T[]) => {
    const list = [...existing];
    const renamed = new Map<string, string>();
    for (const item of incoming) {
      const at = list.findIndex(entry => entry.id === item.id);
      if (at >= 0) { list[at] = fillEmpty(list[at], item); continue; }
      let id = item.id;
      for (let n = 2; taken.has(id); n += 1) id = `${item.id}_${n}`;
      if (id !== item.id) renamed.set(item.id, id);
      taken.add(id);
      list.push({ ...item, id });
    }
    return { list, renamed };
  };
  const cast = merge(base.cast, part.cast);
  const locations = merge(base.locations, part.locations);
  const props = merge(base.props, part.props);
  const episodes = part.episodes.map((episode, i) => ({
    ...episode,
    index: base.episodes.length + i,
    scenes: episode.scenes.map(scene => ({
      ...scene,
      ...(scene.locationId ? { locationId: locations.renamed.get(scene.locationId) ?? scene.locationId } : {}),
      ...(scene.characterIds ? { characterIds: scene.characterIds.map(id => cast.renamed.get(id) ?? id) } : {}),
    })),
  }));
  return { ...base, cast: cast.list, locations: locations.list, props: props.list, episodes: [...base.episodes, ...episodes] };
}
