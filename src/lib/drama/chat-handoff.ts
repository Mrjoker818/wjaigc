import type { DramaEpisode, DramaProjectV1 } from './types';

/** A drama episode taken to simple chat with「在对话里继续改」. */
export interface DramaChatHandoff {
  dramaId: string;
  projectId?: string;
  title: string;
  /** e.g. "第 1 集 · 6 场 · 3 个角色". */
  summary: string;
  /** The episode as Markdown: logline, cast, scenes and the script text. */
  text: string;
  createdAt: number;
}

const KEY = 'wujie:drama-chat-handoff';
const ID = /^[A-Za-z0-9_-]{1,100}$/;
/** The chat model reads the whole message as context; longer scripts are cut here. */
export const DRAMA_CHAT_HANDOFF_SCRIPT_CHARS = 20_000;
/** A handoff older than this was abandoned (the chat tab never opened) and is ignored. */
const MAX_AGE_MS = 10 * 60 * 1000;

export function buildDramaChatHandoff(
  doc: DramaProjectV1,
  episode: DramaEpisode,
  ids: { dramaId: string; projectId?: string },
  now = Date.now(),
): DramaChatHandoff {
  const title = doc.title.trim() || '未命名短剧';
  const castById = new Map(doc.cast.map(member => [member.id, member.name]));
  const locationById = new Map(doc.locations.map(location => [location.id, location.name]));
  const script = episode.script.trim();
  // `index` counts from 0; titles are often already "第 1 集：…".
  const number = doc.episodes.indexOf(episode) + 1 || episode.index + 1;
  const episodeTitle = episode.title.trim();
  const episodeLabel = /^第\s*\d+\s*集/.test(episodeTitle)
    ? episodeTitle
    : `第 ${number} 集${episodeTitle ? `：${episodeTitle}` : ''}`;
  const lines = [
    `## 《${title}》${episodeLabel}`,
    episode.logline.trim() ? `**梗概**：${episode.logline.trim()}` : '',
    doc.cast.length ? `**角色**：${doc.cast.map(member => member.name).join('、')}` : '',
    episode.scenes.length ? '**分场**' : '',
    ...episode.scenes.map((scene, i) => {
      const where = scene.locationId ? locationById.get(scene.locationId) : undefined;
      const who = (scene.characterIds ?? []).map(id => castById.get(id)).filter(Boolean).join('、');
      const meta = [where, who].filter(Boolean).join('；');
      return `${i + 1}. ${scene.heading.trim() || `第 ${i + 1} 场`}${meta ? `（${meta}）` : ''}${scene.summary.trim() ? `：${scene.summary.trim()}` : ''}`;
    }),
    script ? '**剧本正文**' : '',
    script.length > DRAMA_CHAT_HANDOFF_SCRIPT_CHARS
      ? `${script.slice(0, DRAMA_CHAT_HANDOFF_SCRIPT_CHARS)}\n\n（剧本较长，后面的内容没有带过来。）`
      : script,
  ];
  return {
    dramaId: ids.dramaId,
    ...(ids.projectId ? { projectId: ids.projectId } : {}),
    title,
    summary: `第 ${number} 集 · ${episode.scenes.length} 场 · ${doc.cast.length} 个角色`,
    text: lines.filter(Boolean).join('\n\n'),
    createdAt: now,
  };
}

export function writeDramaChatHandoff(storage: Pick<Storage, 'setItem'>, handoff: DramaChatHandoff): void {
  storage.setItem(KEY, JSON.stringify(handoff));
}

/** Reads the handoff once and removes it, so a reload does not open a second task. */
export function takeDramaChatHandoff(storage: Pick<Storage, 'getItem' | 'removeItem'>, now = Date.now()): DramaChatHandoff | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(KEY);
    if (raw !== null) storage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { dramaId, projectId, title, summary, text, createdAt } = value as Record<string, unknown>;
  if (typeof dramaId !== 'string' || !ID.test(dramaId)) return null;
  if (projectId !== undefined && (typeof projectId !== 'string' || !ID.test(projectId))) return null;
  if (typeof title !== 'string' || !title.trim() || title.length > 120) return null;
  if (typeof summary !== 'string' || summary.length > 120) return null;
  if (typeof text !== 'string' || !text.trim() || text.length > DRAMA_CHAT_HANDOFF_SCRIPT_CHARS + 20_000) return null;
  if (typeof createdAt !== 'number' || now - createdAt > MAX_AGE_MS || createdAt - now > 60_000) return null;
  return { dramaId, ...(projectId ? { projectId } : {}), title, summary, text, createdAt };
}

/** The first message of the chat task: the episode, and how to take edits back. */
export function dramaChatHandoffMessage(handoff: DramaChatHandoff): string {
  return [
    `已从短剧工作台带来《${handoff.title}》的剧本。告诉我想怎么改，比如「第 2 场的冲突再强一点」或「结局改成开放式」。`,
    handoff.text,
    '改好后，把需要的段落复制回短剧的剧本页；点下面的按钮回到短剧工作台。',
  ].join('\n\n');
}
