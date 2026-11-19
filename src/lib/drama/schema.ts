/** Validation for drama documents saved by the client. Unknown fields on shots/cast are kept for forward compatibility. */
import { z } from 'zod';
import { DIRECTOR_STYLE_IDS } from '@/lib/video-director/director-styles';
import { MAX_IMAGE_HISTORY } from './bible-images';
import { DRAMA_TRANSITIONS } from './render';
import { DRAMA_PROJECT_SCHEMA_ID, MAX_SHOTS_PER_EPISODE, type DramaProjectV1 } from './types';

export const MAX_DRAMA_DOC_BYTES = 2 * 1024 * 1024;
const MAX_EPISODES = 50;

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
  createdAt: z.number(),
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
  durationSec: z.number().positive().max(60),
  duration: z.number().positive().max(60),
  aspectRatio: text(16),
  takes: z.array(take).max(50),
  selectedTakeId: id.optional(),
  firstFrameUrl: text(4096).optional(),
  lastFrameUrl: text(4096).optional(),
  propIds: z.array(id).max(50).optional(),
});

const sceneBlock = z.looseObject({
  id,
  heading: text(200),
  summary: text(4000),
  locationId: id.optional(),
  characterIds: z.array(id).max(30).optional(),
  shots: z.array(shot),
});

const episode = z.looseObject({
  id,
  index: z.number().int().nonnegative(),
  title: text(200),
  logline: text(2000),
  script: text(100_000),
  scenes: z.array(sceneBlock).max(MAX_SHOTS_PER_EPISODE),
}).refine(value => value.scenes.reduce((total, scene) => total + scene.shots.length, 0) <= MAX_SHOTS_PER_EPISODE, {
  message: 'DRAMA_TOO_MANY_SHOTS',
});

const imageHistory = z.partialRecord(z.enum(['front', 'side', 'plate', 'sheet']), z.array(text(4096)).max(MAX_IMAGE_HISTORY)).optional();
const castMember = z.looseObject({ id, name: text(200), appearance: text(4000), voice: text(128).optional(), imageHistory });
const location = z.looseObject({ id, name: text(200), imageHistory });
const prop = z.looseObject({ id, name: text(200), imageHistory });

export const dramaProjectSchema = z.object({
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
  }),
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
