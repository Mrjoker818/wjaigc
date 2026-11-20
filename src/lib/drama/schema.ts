/** Validation for drama documents saved by the client. Unknown fields on shots/cast are kept for forward compatibility. */
import { z } from 'zod';
import { productionImageSchema, productionRunSchema } from './production-state';
import { DIRECTOR_STYLE_IDS } from '@/lib/video-director/director-styles';
import { MAX_IMAGE_HISTORY } from './bible-images';
import { DRAMA_TRANSITIONS, STILL_MOTIONS } from './render';
import { DRAMA_PROJECT_SCHEMA_ID, MAX_SHOTS_PER_EPISODE, type DramaProjectV1 } from './types';

export const MAX_DRAMA_DOC_BYTES = 2 * 1024 * 1024;
const MAX_EPISODES = 50;
export const MAX_REFERENCES = 30;

const text = (max: number) => z.string().max(max);
const id = z.string().min(1).max(128);

const take = z.looseObject({
  id,
  taskId: text(256).optional(),
  videoUrl: text(4096).optional(),
  thumbnailUrl: text(4096).optional(),
  status: z.enum(['submitted', 'generating', 'completed', 'failed']),
  credits: z.number().nonnegative().optional(),
  error: text(2000).optional(),
  retryable: z.boolean().optional(),
  deliveryState: z.object({ generation: z.enum(['unknown', 'pending', 'completed', 'failed']), result: z.enum(['pending', 'available']), code: text(128).optional(), creditStatus: z.enum(['pending', 'charged', 'refunded', 'not-applicable']).optional() }).optional(),
  createdAt: z.number(),
  inputSnapshot: text(100_000).optional(),
});

const shot = z.looseObject({
  id,
  index: z.number().int().nonnegative(),
  title: text(200),
  prompt: text(8000),
  dialogue: text(2000).optional(),
  speakerId: id.optional(),
  voiceoverUrl: text(4096).optional(),
  voiceoverText: text(2000).optional(),
  voiceoverSnapshot: text(100_000).optional(),
  durationSec: z.number().positive().max(60),
  duration: z.number().positive().max(60),
  aspectRatio: text(16),
  takes: z.array(take).max(50),
  selectedTakeId: id.optional(),
  firstFrameUrl: text(4096).optional(),
  lastFrameUrl: text(4096).optional(),
  propIds: z.array(id).max(50).optional(),
  clipEdit: z.object({
    trimStartSec: z.number().min(0).max(60).optional(),
    trimEndSec: z.number().positive().max(60).optional(),
    speed: z.number().min(0.5).max(2).optional(),
    volume: z.number().min(0).max(2).optional(),
  }).optional(),
  still: z.object({ motion: z.enum(STILL_MOTIONS) }).optional(),
  voiceSampleOff: z.boolean().optional(),
  generateAudio: z.boolean().optional(),
});

const sourceRange = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
  .refine(range => range.start <= range.end, { message: 'DRAMA_SOURCE_RANGE_INVALID' });

const sceneBlock = z.looseObject({
  id,
  heading: text(200),
  summary: text(4000),
  locationId: id.optional(),
  characterIds: z.array(id).max(30).optional(),
  shots: z.array(shot),
  sourceRange: sourceRange.optional(),
  sourceText: text(100_000).optional(),
  sourceChanged: z.boolean().optional(),
  dialogues: z.array(z.object({ characterId: id, text: text(100_000), sourceRange })).max(5000).optional(),
});

const episode = z.looseObject({
  id,
  index: z.number().int().nonnegative(),
  title: text(200),
  logline: text(2000),
  script: text(100_000),
  structuredScript: text(100_000).optional(),
  scenes: z.array(sceneBlock).max(MAX_SHOTS_PER_EPISODE),
  archivedScenes: z.array(sceneBlock).max(1000).optional(),
}).refine(value => value.scenes.reduce((total, scene) => total + scene.shots.length, 0) <= MAX_SHOTS_PER_EPISODE, {
  message: 'DRAMA_TOO_MANY_SHOTS',
}).superRefine((value, ctx) => {
  for (const [i, scene] of [...value.scenes, ...(value.archivedScenes ?? [])].entries()) {
    const source = scene.sourceText ?? value.structuredScript ?? value.script;
    if (scene.sourceRange && scene.sourceRange.end > source.length) {
      ctx.addIssue({ code: 'custom', message: 'DRAMA_SOURCE_RANGE_INVALID', path: ['scenes', i, 'sourceRange'] });
    }
    for (const dialogue of scene.dialogues ?? []) {
      const range = dialogue.sourceRange;
      if (range.end > source.length || source.slice(range.start, range.end) !== dialogue.text
        || (scene.sourceRange && (range.start < scene.sourceRange.start || range.end > scene.sourceRange.end))) {
        ctx.addIssue({ code: 'custom', message: 'DRAMA_DIALOGUE_SOURCE_INVALID', path: ['scenes', i, 'dialogues'] });
      }
    }
  }
});

const imageHistory = z.partialRecord(z.enum(['front', 'side', 'back', 'face', 'plate', 'sheet']), z.array(text(4096)).max(MAX_IMAGE_HISTORY)).optional();
const castMember = z.looseObject({
  id, name: text(200), appearance: text(4000), voice: text(128).optional(), imageHistory,
  voiceSampleUrl: text(4096).optional(), voiceSampleName: text(200).optional(), voiceSampleSec: z.number().positive().max(60).optional(),
});
const location = z.looseObject({ id, name: text(200), imageHistory });
const prop = z.looseObject({ id, name: text(200), imageHistory });

export const dramaProjectSchema = z.object({
  planner: z.object({ providerId: text(128).min(1), modelId: text(256).min(1) }).optional(),
  productionRun: productionRunSchema.optional(),
  productionImages: z.array(productionImageSchema).max(500).optional(),
  retainedImages: z.array(z.object({ url: text(4096), sourceUrl: text(4096).optional(), name: text(200).optional() })).max(500).optional(),
  sourceCharacters: z.array(z.object({ id, name: text(200) })).max(500).optional(),
  schemaId: z.literal(DRAMA_PROJECT_SCHEMA_ID),
  title: text(200),
  genre: text(100),
  style: z.enum(DIRECTOR_STYLE_IDS),
  aspectRatio: text(16),
  episodes: z.array(episode).max(MAX_EPISODES),
  cast: z.array(castMember).max(100),
  locations: z.array(location).max(200),
  props: z.array(prop).max(200),
  timeline: z.looseObject({
    transition: z.enum(DRAMA_TRANSITIONS as [string, ...string[]]),
    transitionSec: z.number().min(0).max(2),
    subtitles: z.boolean(),
    music: z.object({ url: text(4096), name: text(200), volume: z.number().min(0).max(1), ducking: z.boolean() }).optional(),
    lastRender: z.looseObject({
      taskId: text(256), episodeId: id.optional(), videoUrl: text(4096).optional(), thumbnailUrl: text(4096).optional(),
      durationSec: z.number().nonnegative().optional(), status: z.enum(['processing', 'completed', 'failed']),
      error: text(2000).optional(), createdAt: z.number(), inputSnapshot: text(100_000).optional(), sourceChanged: z.boolean().optional(),
    }).optional(),
  }),
  references: z.array(z.object({ url: text(4096), name: text(200).optional(), source: z.enum(['chat', 'canvas']) })).max(MAX_REFERENCES).optional(),
  sourceScript: z.object({
    originalText: text(100_000), fileName: text(255).optional(), format: z.enum(['text', 'txt', 'docx']),
    importedAt: z.number().finite().nonnegative(),
  }).optional(),
}).superRefine((doc, ctx) => {
  // Apply reference checks to imported provenance only; legacy documents remain loadable.
  const castIds = new Set(doc.cast.map(member => member.id));
  const sourceIds = new Set([...castIds, ...(doc.sourceCharacters ?? []).map(member => member.id)]);
  for (const episode of doc.episodes) {
    for (const scene of [...episode.scenes, ...(episode.archivedScenes ?? [])]) {
      if ((scene.sourceRange || scene.sourceText !== undefined || scene.dialogues) &&
        ((scene.characterIds ?? []).some(id => !castIds.has(id)) || (scene.dialogues ?? []).some(line => !sourceIds.has(line.characterId)))) {
        ctx.addIssue({ code: 'custom', message: 'DRAMA_SOURCE_CHARACTER_INVALID' });
      }
    }
  }
});

export class DramaDocumentError extends Error {
  constructor(readonly code: 'DRAMA_DOC_TOO_LARGE' | 'DRAMA_DOC_INVALID') {
    super(code);
    this.name = 'DramaDocumentError';
  }
}

export function parseDramaProject(value: unknown): DramaProjectV1 {
  if (new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength > MAX_DRAMA_DOC_BYTES) {
    throw new DramaDocumentError('DRAMA_DOC_TOO_LARGE');
  }
  const parsed = dramaProjectSchema.safeParse(value);
  if (!parsed.success) throw new DramaDocumentError('DRAMA_DOC_INVALID');
  return parsed.data as unknown as DramaProjectV1;
}
