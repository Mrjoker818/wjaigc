/** Deterministic source extraction only: no network, model calls, storage or invented story details. */
import { createEmptyDramaProject, MAX_SHOTS_PER_EPISODE, type DramaCastMember, type DramaEpisode,
  type DramaProjectV1, type DramaSceneBlock, type DramaSourceDialogue } from './types';
import type { DirectorStyle } from '@/lib/video-director/director-styles';

export const MAX_SOURCE_SCRIPT_CHARS = 100_000;
export interface SourceScriptOptions {
  title?: string;
  style?: DirectorStyle;
  aspectRatio?: string;
  fileName?: string;
  format?: 'text' | 'txt' | 'docx';
  now?: number;
}
export interface SourceScriptResult {
  doc: DramaProjectV1;
  warnings: string[];
  stats: { episodes: number; scenes: number; characters: number; dialogues: number };
}
export class SourceScriptError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'SourceScriptError'; }
}

interface Line { text: string; start: number; end: number }
const NUM = '[0-9０-９一二三四五六七八九十百千零〇两壹贰叁肆伍陆柒捌玖拾]+';
const EPISODE = new RegExp(`^(?:第\\s*${NUM}\\s*[集回]|(?:EPISODE|EP\\.?)\\s*\\d+)(?=$|[\\s:：.、—–-])`, 'i');
const SCENE = new RegExp(`^(?:第\\s*${NUM}\\s*[场幕]|场(?:景|次)?\\s*${NUM}|SCENE\\s*\\d+)(?=$|[\\s:：.、—–-])`, 'i');
const SLUG = /^(?:(?:INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E\.?)(?:\s|$)|(?:内景|外景|内\/外景|内外景)(?:[\s·:：.-]|$))/i;
const NUMBERED_SCENE = /^\d+[-－—]\d+(?=\s|[.、:：]|$)/;
const META = /^(?:时间|地点|场景|场次|人物|角色|出场人物|字幕|画面|音效|音乐|备注|说明|动作|镜头|旁白说明|标题|time|location|characters|scene|note|notes|action|sfx|music|https?|ftp)$/i;
const normalize = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ');
const headingText = (value: string) => value.trim().replace(/^#{1,6}\s*/, '').trim();

/** Iterate without normalizing line endings, so every offset is a JS/UTF-16 source offset. */
function lines(text: string): Line[] {
  const result: Line[] = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) && match[0].length) {
    result.push({ text: match[1], start: match.index, end: pattern.lastIndex });
  }
  return result;
}
function checkText(text: string): void {
  if (typeof text !== 'string' || !text.trim()) throw new SourceScriptError('DRAMA_SOURCE_EMPTY');
  if (text.length > MAX_SOURCE_SCRIPT_CHARS) throw new SourceScriptError('DRAMA_SOURCE_LIMIT');
}
function warn(warnings: string[], code: string, message: string): void {
  const value = `${code}: ${message}`;
  if (!warnings.includes(value)) warnings.push(value);
}
function bounded(value: string, max: number): string {
  if (value.length > max) throw new SourceScriptError('DRAMA_SOURCE_FIELD_LIMIT');
  return value;
}
function nameFromCue(cue: string): string | undefined {
  // Parentheticals are performance directions, not identity or appearance.
  const name = normalize(cue.replace(/\s*(?:[（(][^（）()]*[）)]|\[(?:V\.?O\.?|O\.?S\.?)\])\s*$/i, ''));
  if (!name || name.length > 80 || META.test(name)) return;
  if (!/^[\p{L}][\p{L}\p{M}\p{N} ·・.'’_-]*$/u.test(name)) return;
  return name;
}

function allocate(prefix: string, used: Set<string>): string {
  let n = used.size + 1;
  while (used.has(`${prefix}_${n}`)) n += 1;
  const id = `${prefix}_${n}`;
  used.add(id);
  return id;
}

function parseScenes(script: string, episodeId: string, cast: DramaCastMember[], warnings: string[], used: Set<string>, reservedCast: string[] = []): DramaSceneBlock[] {
  const sourceLines = lines(script);
  const headings = sourceLines.filter(line => {
    const text = headingText(line.text);
    return SCENE.test(text) || SLUG.test(text) || NUMBERED_SCENE.test(text);
  });
  if (headings.length > MAX_SHOTS_PER_EPISODE) throw new SourceScriptError('DRAMA_SOURCE_SCENE_LIMIT');
  if (!headings.length) warn(warnings, 'DRAMA_SOURCE_UNSTRUCTURED', '未识别到明确分场，原文作为一场保留，请确认分场。');
  if (headings[0]?.start && sourceLines.some(line => line.start < headings[0].start && line.text.trim() && !EPISODE.test(headingText(line.text)))) {
    warn(warnings, 'DRAMA_SOURCE_PREAMBLE', '首场标题前有文本，已保留在本集正文中，请复核其所属场次。');
  }
  const starts = headings.length ? headings : [{ text: '', start: 0, end: 0 }];
  const known = new Map(cast.map(member => [normalize(member.name), member.id]));
  const castIds = new Set([...cast.map(member => member.id), ...reservedCast]);
  const findCharacter = (name: string): string => {
    const existing = known.get(name);
    if (existing) return existing;
    if (cast.length >= 100) throw new SourceScriptError('DRAMA_SOURCE_CHARACTER_LIMIT');
    const id = allocate('source_cast', castIds);
    cast.push({ id, name, appearance: '' }); known.set(name, id);
    return id;
  };
  return starts.map((heading, index) => {
    const start = heading.start;
    const end = starts[index + 1]?.start ?? script.length;
    const dialogues: DramaSourceDialogue[] = [];
    const sceneLines = sourceLines.filter(line => line.start >= start && line.start < end);
    for (let i = 0; i < sceneLines.length; i += 1) {
      const line = sceneLines[i]; const trimmed = headingText(line.text);
      if (EPISODE.test(trimmed) || SCENE.test(trimmed) || SLUG.test(trimmed) || NUMBERED_SCENE.test(trimmed)) continue;
      const inline = /^(\s*)([^:：\r\n]{1,120})[:：]([\s\S]*)$/.exec(line.text);
      if (inline) {
        const name = nameFromCue(inline[2]);
        // URLs, production labels and long prose before a colon are never cast members.
        if (!name || /^\s*\/\//.test(inline[3])) {
          warn(warnings, 'DRAMA_SOURCE_AMBIGUOUS', '含冒号的行无法确认是角色台词，已原样保留，请复核。');
          continue;
        }
        if (!inline[3].trim()) {
          warn(warnings, 'DRAMA_SOURCE_AMBIGUOUS', '角色标签后没有同一行台词，已原样保留，请复核。');
          continue;
        }
        const offset = line.start + inline[1].length + inline[2].length + 1;
        dialogues.push({ characterId: findCharacter(name), text: inline[3], sourceRange: { start: offset, end: line.start + line.text.length } });
        continue;
      }
      // Conventional screenplay cue: uppercase name, then one or more nonblank dialogue lines.
      if (/^[A-Z][A-Z .’'_-]{1,79}(?:\s*\((?:V\.?O\.?|O\.?S\.?|CONT'D)\))?$/.test(trimmed)) {
        const name = nameFromCue(trimmed);
        let j = i + 1;
        while (j < sceneLines.length && sceneLines[j].text.trim()) {
          const next = headingText(sceneLines[j].text);
          if (EPISODE.test(next) || SCENE.test(next) || SLUG.test(next) || /[:：]/.test(next) || /^[A-Z][A-Z .’'_-]+$/.test(next)) break;
          j += 1;
        }
        if (name && j > i + 1) {
          const from = sceneLines[i + 1].start;
          const last = sceneLines[j - 1]; const to = last.start + last.text.length;
          dialogues.push({ characterId: findCharacter(name), text: script.slice(from, to), sourceRange: { start: from, end: to } });
          i = j - 1;
        } else warn(warnings, 'DRAMA_SOURCE_AMBIGUOUS', '独立大写行无法确认角色与台词对应关系，请复核。');
      }
    }
    return {
      id: allocate(`${episodeId}_scene`, used), heading: bounded(headingText(heading.text), 200), summary: '',
      shots: [], sourceRange: { start, end }, characterIds: [...new Set(dialogues.map(line => line.characterId))], dialogues,
    };
  });
}

/** Missing metadata means a legacy, manually structured episode, which remains usable. */
export function isEpisodeStructureCurrent(episode: DramaEpisode): boolean {
  return episode.structuredScript === undefined || episode.structuredScript === episode.script;
}

/** Read the snapshot the range belongs to, never offsets against subsequently edited text. */
export function sceneSourceText(episode: DramaEpisode, scene: DramaSceneBlock): string {
  const source = scene.sourceText ?? episode.structuredScript ?? episode.script;
  const range = scene.sourceRange;
  if (!range) return scene.sourceText ?? scene.summary;
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start || range.end > source.length) return '';
  return source.slice(range.start, range.end);
}

export function parseSourceScript(text: string, options: SourceScriptOptions = {}): SourceScriptResult {
  checkText(text);
  const warnings: string[] = [];
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now) || now < 0) throw new SourceScriptError('DRAMA_SOURCE_DATE_INVALID');
  const doc = createEmptyDramaProject({ title: bounded(options.title ?? options.fileName?.replace(/\.[^.]+$/, '') ?? '', 200), style: options.style, aspectRatio: options.aspectRatio });
  doc.sourceScript = { originalText: text, format: options.format ?? 'text', importedAt: now,
    ...(options.fileName === undefined ? {} : { fileName: bounded(options.fileName, 255) }) };
  const episodeHeadings = lines(text).filter(line => EPISODE.test(headingText(line.text)));
  if (episodeHeadings.length > 50) throw new SourceScriptError('DRAMA_SOURCE_EPISODE_LIMIT');
  if (!episodeHeadings.length) warn(warnings, 'DRAMA_SOURCE_NO_EPISODES', '未识别到明确分集，按一集保留，请确认集数。');
  if (episodeHeadings[0]?.start && text.slice(0, episodeHeadings[0].start).trim()) {
    warn(warnings, 'DRAMA_SOURCE_PREAMBLE', '首集标题前有文本，已保留在第一集正文中，请复核。');
  }
  const headings = episodeHeadings.length ? episodeHeadings : [{ text: '', start: 0, end: 0 }];
  const used = new Set<string>();
  doc.episodes = headings.map((line, index) => {
    const id = `source_episode_${index + 1}`;
    const script = text.slice(index ? line.start : 0, headings[index + 1]?.start ?? text.length);
    return { id, index, title: bounded(headingText(line.text), 200), logline: '', script, structuredScript: script,
      scenes: parseScenes(script, id, doc.cast, warnings, used) };
  });
  const scenes = doc.episodes.flatMap(episode => episode.scenes);
  return { doc, warnings, stats: { episodes: doc.episodes.length, scenes: scenes.length,
    characters: doc.cast.length, dialogues: scenes.reduce((count, scene) => count + (scene.dialogues?.length ?? 0), 0) } };
}

/** Reparse a single edited episode, retaining one-to-one heading occurrences and all previous media. */
export function reparseEpisode(doc: DramaProjectV1, episodeId: string): { doc: DramaProjectV1; warnings: string[]; changedSceneIds: string[] } {
  const episode = doc.episodes.find(item => item.id === episodeId);
  if (!episode) throw new SourceScriptError('DRAMA_SOURCE_EPISODE_NOT_FOUND');
  if (episode.script.length > MAX_SOURCE_SCRIPT_CHARS) throw new SourceScriptError('DRAMA_SOURCE_LIMIT');
  const warnings: string[] = [];
  const cast = [...doc.cast];
  const used = new Set(doc.episodes.flatMap(item => [...item.scenes, ...(item.archivedScenes ?? [])].map(scene => scene.id)));
  const parsed = episode.script.trim() ? parseScenes(episode.script, episode.id, cast, warnings, used, doc.sourceCharacters?.map(member => member.id)) : [];
  if (!episode.script.trim()) warn(warnings, 'DRAMA_SOURCE_EMPTY', '本集正文已清空，原有场景移至归档，请确认。');
  const queues = new Map<string, DramaSceneBlock[]>();
  for (const scene of episode.scenes) {
    const key = normalize(scene.heading); const queue = queues.get(key) ?? [];
    queue.push(scene); queues.set(key, queue);
  }
  const changedSceneIds: string[] = [];
  const matched = new Set<string>();
  const scenes = parsed.map(scene => {
    const previous = queues.get(normalize(scene.heading))?.shift();
    if (!previous) { changedSceneIds.push(scene.id); return scene; }
    matched.add(previous.id);
    const changed = sceneSourceText(episode, previous) !== sceneSourceText({ ...episode, structuredScript: episode.script }, scene);
    if (changed) changedSceneIds.push(previous.id);
    if (!changed) return { ...previous, sourceRange: scene.sourceRange, dialogues: scene.dialogues, sourceText: undefined };
    return { ...previous, ...scene, id: previous.id, shots: previous.shots,
      sourceText: undefined, ...(changed || previous.sourceChanged ? { sourceChanged: true } : {}) };
  });
  const removed = episode.scenes.filter(scene => !matched.has(scene.id)).map(scene => {
    const offset = scene.sourceRange?.start ?? 0;
    return { ...scene, sourceChanged: true, sourceText: sceneSourceText(episode, scene), sourceRange: undefined,
      dialogues: scene.dialogues?.map(line => ({ ...line, sourceRange: {
        start: line.sourceRange.start - offset, end: line.sourceRange.end - offset,
      } })) };
  });
  if (removed.length) {
    changedSceneIds.push(...removed.map(scene => scene.id));
    warn(warnings, 'DRAMA_SOURCE_SCENES_ARCHIVED', `${removed.length} 场已从当前剧本移至归档，镜头与素材仍保留，未加入当前成片。`);
  }
  if (changedSceneIds.length) warn(warnings, 'DRAMA_SOURCE_CHANGED', '正文或分场已变更，受影响场次的已有产物需重新复核。');
  const next: DramaEpisode = { ...episode, structuredScript: episode.script, scenes,
    ...((episode.archivedScenes?.length || removed.length) ? { archivedScenes: [...(episode.archivedScenes ?? []), ...removed] } : {}) };
  return { doc: { ...doc, cast, episodes: doc.episodes.map(item => item.id === episodeId ? next : item),
    timeline: changedSceneIds.length && (!doc.timeline.lastRender?.episodeId || doc.timeline.lastRender.episodeId === episodeId)
      && doc.timeline.lastRender ? { ...doc.timeline, lastRender: { ...doc.timeline.lastRender, sourceChanged: true } } : doc.timeline },
    warnings, changedSceneIds };
}
