/** LLM planning for drama projects: one call for the script bible, then one call per scene for its shots. */
import { z } from 'zod';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { DIRECTOR_STYLES, normalizeDirectorStyle, type DirectorStyle } from '@/lib/video-director/director-styles';
import { buildShotPlanSystemPrompt, parseShotPlanFullResponse } from '@/lib/video-director/continuity';
import {
  createEmptyDramaProject,
  MAX_SHOTS_PER_EPISODE,
  type DramaCastMember,
  type DramaEpisode,
  type DramaLocation,
  type DramaProjectV1,
  type DramaSceneBlock,
  type DramaShot,
} from './types';

const MAX_RESPONSE_BYTES = 512 * 1024;
const PLANNER_TIMEOUT_MS = 90_000;
const MAX_SHOTS_PER_SCENE = 20;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export class DramaPlannerError extends Error {
  constructor(readonly code: 'DRAMA_PLAN_INVALID' | 'DRAMA_PLANNER_UNAVAILABLE', readonly retryable: boolean, options?: ErrorOptions) {
    super(code, options);
    this.name = 'DramaPlannerError';
  }
}

export interface DramaScriptInput {
  idea: string;
  title?: string;
  genre?: string;
  style?: DirectorStyle;
  aspectRatio?: string;
  episodeCount?: number;
  /** Target length of one episode in seconds. */
  episodeDurationSec?: number;
}

export interface DramaShotPlanInput {
  doc: DramaProjectV1;
  episodeId: string;
  sceneId: string;
  /** Default length of one shot in seconds. */
  shotDurationSec?: number;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(trimmed);
  const body = fenced?.[1]?.trim() ?? trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

function safeId(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return SAFE_ID.test(raw) ? raw : fallback;
}

const looseText = (max: number) => z.unknown().transform(value => (typeof value === 'string' ? value : value == null ? '' : String(value)).slice(0, max));

const scriptResponseSchema = z.object({
  title: looseText(200),
  genre: looseText(100).optional(),
  logline: looseText(2000).optional(),
  cast: z.array(z.record(z.string(), z.unknown())).max(30).default([]),
  locations: z.array(z.record(z.string(), z.unknown())).max(50).default([]),
  episodes: z.array(z.object({
    title: looseText(200),
    logline: looseText(2000).optional(),
    script: looseText(100_000).optional(),
    scenes: z.array(z.object({
      heading: looseText(200),
      summary: looseText(4000),
      locationId: z.unknown().optional(),
      characterIds: z.array(z.unknown()).max(30).optional(),
    })).min(1).max(60),
  })).min(1).max(20),
});

export function buildDramaScriptPrompt(input: DramaScriptInput): string {
  const style = normalizeDirectorStyle(input.style);
  const episodes = clampInt(input.episodeCount, 1, 1, 20);
  const duration = clampInt(input.episodeDurationSec, 60, 15, 600);
  return [
    '你是专业短剧编剧。根据用户的创意写出可直接拍摄的短剧剧本。仅返回一个 JSON 对象，不要 Markdown 或解释。',
    `共 ${episodes} 集，每集约 ${duration} 秒，画面比例 ${input.aspectRatio || '9:16'}。`,
    `视觉风格：${DIRECTOR_STYLES[style].planDescription}`,
    '短剧节奏：开场 3 秒内抛出冲突，每集结尾留钩子；台词口语化、短句。',
    'JSON 结构：{"title":string,"genre":string,"logline":string,',
    '"cast":[{"id":英文id,"name":string,"role":主角/配角/反派,"age":string,"gender":string,"appearance":外貌50-100字,"costume":string,"hair":string}],',
    '"locations":[{"id":英文id,"name":场景名,"location":string,"timeOfDay":string,"lighting":string,"mood":string,"description":50-100字}],',
    '"episodes":[{"title":string,"logline":string,"script":完整剧本文本(含场次标题、动作描写、角色台词),',
    '"scenes":[{"heading":场次标题如"咖啡馆·内·夜","summary":本场发生的事和关键台词,"locationId":locations中的id,"characterIds":cast中的id数组}]}]}',
    'id 只用英文字母、数字、下划线；scenes 引用的 id 必须存在。',
    input.title ? `片名：${input.title}` : '',
    input.genre ? `类型：${input.genre}` : '',
    `用户创意：${input.idea}`,
  ].filter(Boolean).join('\n');
}

/** Turns the script response into a fresh drama document. Ids are sanitized and dangling references dropped. */
export function parseDramaScriptResponse(text: string, input: DramaScriptInput, now = Date.now()): DramaProjectV1 {
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new DramaPlannerError('DRAMA_PLAN_INVALID', true);
  let raw: unknown;
  try { raw = JSON.parse(stripFence(text)); } catch (cause) { throw new DramaPlannerError('DRAMA_PLAN_INVALID', true, { cause }); }
  const parsed = scriptResponseSchema.safeParse(raw);
  if (!parsed.success) throw new DramaPlannerError('DRAMA_PLAN_INVALID', true, { cause: parsed.error });
  const plan = parsed.data;
  const str = (value: unknown, max = 2000) => (typeof value === 'string' ? value : '').slice(0, max);

  const castIds = new Set<string>();
  const cast: DramaCastMember[] = plan.cast.map((item, i) => {
    let id = safeId(item.id, `char_${i + 1}`);
    while (castIds.has(id)) id = `${id}_${i}`;
    castIds.add(id);
    return {
      id, name: str(item.name, 200) || `角色${i + 1}`, role: str(item.role, 100), age: str(item.age, 50),
      gender: str(item.gender, 20), appearance: str(item.appearance, 4000), costume: str(item.costume, 1000),
      hair: str(item.hair, 500), status: 'pending',
    };
  });
  const locationIds = new Set<string>();
  const locations: DramaLocation[] = plan.locations.map((item, i) => {
    let id = safeId(item.id, `loc_${i + 1}`);
    while (locationIds.has(id)) id = `${id}_${i}`;
    locationIds.add(id);
    return {
      id, name: str(item.name, 200) || `场景${i + 1}`, location: str(item.location, 500), timeOfDay: str(item.timeOfDay, 50),
      lighting: str(item.lighting, 500), mood: str(item.mood, 200), description: str(item.description, 4000), status: 'pending',
    };
  });

  const episodes: DramaEpisode[] = plan.episodes.map((episode, e) => ({
    id: `ep_${now.toString(36)}_${e}`,
    index: e,
    title: episode.title || `第 ${e + 1} 集`,
    logline: episode.logline ?? '',
    script: episode.script ?? '',
    scenes: episode.scenes.map((scene, s): DramaSceneBlock => {
      const locationId = typeof scene.locationId === 'string' && locationIds.has(scene.locationId) ? scene.locationId : undefined;
      const characterIds = (scene.characterIds ?? []).filter((id): id is string => typeof id === 'string' && castIds.has(id));
      return {
        id: `sc_${now.toString(36)}_${e}_${s}`,
        heading: scene.heading || `第 ${s + 1} 场`,
        summary: scene.summary,
        ...(locationId ? { locationId } : {}),
        ...(characterIds.length ? { characterIds } : {}),
        shots: [],
      };
    }),
  }));

  const doc = createEmptyDramaProject({
    title: plan.title || input.title, genre: plan.genre || input.genre, style: normalizeDirectorStyle(input.style),
    aspectRatio: input.aspectRatio,
  });
  return { ...doc, episodes, cast, locations };
}

function sceneShotCount(summary: string, requested?: number): number {
  if (requested) return clampInt(requested, 4, 1, MAX_SHOTS_PER_SCENE);
  // Roughly one shot per beat; a beat is a sentence of the scene summary.
  const beats = summary.split(/[。！？!?\n]/u).filter(part => part.trim().length > 3).length;
  return clampInt(beats, 3, 2, 8);
}

function findScene(doc: DramaProjectV1, episodeId: string, sceneId: string): { episode: DramaEpisode; scene: DramaSceneBlock } {
  const episode = doc.episodes.find(item => item.id === episodeId);
  const scene = episode?.scenes.find(item => item.id === sceneId);
  if (!episode || !scene) throw new DramaPlannerError('DRAMA_PLAN_INVALID', false);
  return { episode, scene };
}

/** System and user messages for breaking one scene into shots. The scene's cast and location are given as fixed ids. */
export function buildDramaShotMessages(input: DramaShotPlanInput & { shotCount?: number }): Array<{ role: 'system' | 'user'; content: string }> {
  const { doc } = input;
  const { scene } = findScene(doc, input.episodeId, input.sceneId);
  const perShot = clampInt(input.shotDurationSec, 5, 3, 15);
  const count = sceneShotCount(scene.summary, input.shotCount);
  const cast = doc.cast.filter(member => !scene.characterIds || scene.characterIds.includes(member.id));
  const location = doc.locations.find(item => item.id === scene.locationId);
  const lines = [
    `场次：${scene.heading}`,
    `本场内容：${scene.summary}`,
    cast.length ? `出场角色（characterIds 只能用这些 id）：${cast.map(member => `${member.id}=${member.name}，${member.appearance}`).join('；')}` : '本场没有固定角色。',
    location ? `场景（sceneId 固定为 ${location.id}）：${location.name}，${location.description || location.location || ''}` : '',
    `拆成 ${count} 个镜头，单镜头 ${perShot} 秒左右，画面比例 ${doc.aspectRatio}。`,
    '每个镜头额外给出 dialogue 字段：该镜头内角色说的台词原文（没有就给空字符串）。',
    'characters/scenes/props 可以返回空数组，角色和场景已经定好。',
  ].filter(Boolean);
  return [
    { role: 'system', content: buildShotPlanSystemPrompt(count * perShot, count, doc.style, doc.aspectRatio) },
    { role: 'user', content: lines.join('\n') },
  ];
}

/** Parses shots for one scene. Character and scene ids are kept only when they exist in the project. */
export function parseDramaShotResponse(text: string, input: DramaShotPlanInput, now = Date.now()): DramaShot[] {
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new DramaPlannerError('DRAMA_PLAN_INVALID', true);
  const { doc } = input;
  const { episode, scene } = findScene(doc, input.episodeId, input.sceneId);
  const perShot = clampInt(input.shotDurationSec, 5, 3, 15);
  const cleaned = stripFence(text);
  const parsed = parseShotPlanFullResponse(cleaned, perShot, doc.aspectRatio);
  if (parsed.shots.length === 0) throw new DramaPlannerError('DRAMA_PLAN_INVALID', true);
  let dialogues: unknown[] = [];
  try {
    const raw = JSON.parse(cleaned) as { shots?: Array<{ dialogue?: unknown }> };
    dialogues = Array.isArray(raw.shots) ? raw.shots.map(item => item?.dialogue) : [];
  } catch { /* parseShotPlanFullResponse already accepted the text */ }

  const castIds = new Set(doc.cast.map(member => member.id));
  const existing = episode.scenes.reduce((total, item) => total + (item.id === scene.id ? 0 : item.shots.length), 0);
  const room = MAX_SHOTS_PER_EPISODE - existing;
  if (room <= 0) throw new DramaPlannerError('DRAMA_PLAN_INVALID', false);
  return parsed.shots.slice(0, Math.min(MAX_SHOTS_PER_SCENE, room)).map((shot, i): DramaShot => {
    const durationSec = Math.max(2, Math.min(15, Number(shot.duration) || perShot));
    const characterIds = (shot.characterIds ?? []).filter(id => castIds.has(id));
    const fallbackCast = scene.characterIds?.filter(id => castIds.has(id)) ?? [];
    const dialogue = typeof dialogues[i] === 'string' ? (dialogues[i] as string).slice(0, 2000) : '';
    return {
      ...shot,
      id: `shot_${now.toString(36)}_${scene.id.slice(-6)}_${i}`,
      index: i,
      duration: durationSec,
      durationSec,
      aspectRatio: doc.aspectRatio,
      characterIds: characterIds.length ? characterIds : fallbackCast,
      sceneId: scene.locationId,
      ...(dialogue ? { dialogue } : {}),
      takes: [],
      status: 'planned',
    };
  });
}

export interface DramaLlmConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  signal?: AbortSignal;
}

/** Calls an OpenAI-compatible chat endpoint and returns the assistant text. */
export async function callDramaLlm(
  config: DramaLlmConfig, messages: Array<{ role: string; content: string }>, temperature = 0.7,
): Promise<string> {
  const signal = config.signal
    ? AbortSignal.any([config.signal, AbortSignal.timeout(PLANNER_TIMEOUT_MS)])
    : AbortSignal.timeout(PLANNER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchWithV1Retry(config.baseUrl, '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.modelId, messages, temperature, max_tokens: 8000, stream: false }),
      signal,
    }, true, PLANNER_TIMEOUT_MS);
  } catch (cause) {
    throw new DramaPlannerError('DRAMA_PLANNER_UNAVAILABLE', true, { cause });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new DramaPlannerError('DRAMA_PLANNER_UNAVAILABLE', response.status === 429 || response.status >= 500);
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw new DramaPlannerError('DRAMA_PLAN_INVALID', true);
  try {
    const data = JSON.parse(body) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) return content;
  } catch { /* fall through */ }
  throw new DramaPlannerError('DRAMA_PLAN_INVALID', true);
}
