/** Drama project document: script → episodes → scenes → shots, plus the cast/location/prop bible and timeline. */
import type { DirectorStyle } from '@/lib/video-director/director-styles';
import type { VideoCharacter, VideoProp, VideoScene, VideoShotPlan } from '@/lib/video-director/continuity';
import type { DramaTransition } from './render';

export const DRAMA_PROJECT_SCHEMA_ID = 'drama-project-v1';
export const MAX_SHOTS_PER_EPISODE = 120;

export type DramaTakeStatus = 'submitted' | 'generating' | 'completed' | 'failed';

/** One generation attempt for a shot. A shot keeps every take so the user can switch between them. */
export interface DramaTake {
  id: string;
  taskId?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  status: DramaTakeStatus;
  credits?: number;
  error?: string;
  /** The server said this failure is safe to submit again (the charge was refunded or never made). */
  retryable?: boolean;
  createdAt: number;
  /** Model the take was submitted to, so a reopened page can keep polling the right provider. */
  modelId?: string;
  providerId?: string;
}

export interface DramaShot extends VideoShotPlan {
  /** Spoken line, burned as a subtitle and optionally voiced. */
  dialogue?: string;
  /** Cast member who says the line; defaults to the first character in the shot. */
  speakerId?: string;
  /** Generated voiceover of the line, mixed over the clip when the episode renders. */
  voiceoverUrl?: string;
  /** The line as it read when the voiceover was recorded; a different line means the recording is stale. */
  voiceoverText?: string;
  durationSec: number;
  modelId?: string;
  providerId?: string;
  takes: DramaTake[];
  selectedTakeId?: string;
}

export interface DramaSceneBlock {
  id: string;
  /** Slug line, e.g. "咖啡馆 · 内景 · 夜". */
  heading: string;
  summary: string;
  locationId?: string;
  /** Cast members who appear in this scene. */
  characterIds?: string[];
  shots: DramaShot[];
}

export interface DramaEpisode {
  id: string;
  index: number;
  title: string;
  logline: string;
  /** Full script text the user can edit. */
  script: string;
  scenes: DramaSceneBlock[];
}

/** Character with turnaround images. `lockedImageUrl` is the one used as reference for every shot. */
export interface DramaCastMember extends VideoCharacter {
  imageUrlFull?: string;
  lockedImageUrl?: string;
  /** Text-to-speech voice id for this character's lines. */
  voice?: string;
}

export interface DramaLocation extends VideoScene {
  lockedImageUrl?: string;
}

/** Key prop with its design sheet. `lockedImageUrl` is the one sent as a reference for shots that show it. */
export interface DramaProp extends VideoProp {
  lockedImageUrl?: string;
}

export interface DramaTimeline {
  transition: DramaTransition;
  transitionSec: number;
  subtitles: boolean;
  lastRender?: {
    taskId: string;
    episodeId?: string;
    videoUrl?: string;
    thumbnailUrl?: string;
    durationSec?: number;
    status: 'processing' | 'completed' | 'failed';
    error?: string;
    createdAt: number;
  };
}

export interface DramaProjectV1 {
  schemaId: typeof DRAMA_PROJECT_SCHEMA_ID;
  title: string;
  genre: string;
  style: DirectorStyle;
  aspectRatio: string;
  episodes: DramaEpisode[];
  cast: DramaCastMember[];
  locations: DramaLocation[];
  props: DramaProp[];
  timeline: DramaTimeline;
}

export interface DramaProjectRecord {
  id: string;
  projectId: string | null;
  title: string;
  doc: DramaProjectV1;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export function createEmptyDramaProject(input: Partial<Pick<DramaProjectV1, 'title' | 'genre' | 'style' | 'aspectRatio'>> = {}): DramaProjectV1 {
  return {
    schemaId: DRAMA_PROJECT_SCHEMA_ID,
    title: input.title?.trim() || '未命名短剧',
    genre: input.genre?.trim() || '',
    style: input.style ?? 'cinematic',
    aspectRatio: input.aspectRatio || '9:16',
    episodes: [],
    cast: [],
    locations: [],
    props: [],
    timeline: { transition: 'cut', transitionSec: 0.5, subtitles: true },
  };
}

/** The take used for rendering: the selected one, otherwise the newest completed take. */
export function activeTake(shot: Pick<DramaShot, 'takes' | 'selectedTakeId'>): DramaTake | undefined {
  const selected = shot.takes.find(take => take.id === shot.selectedTakeId && take.status === 'completed' && take.videoUrl);
  if (selected) return selected;
  return [...shot.takes].reverse().find(take => take.status === 'completed' && take.videoUrl);
}

export function episodeShots(episode: DramaEpisode): DramaShot[] {
  return episode.scenes.flatMap(scene => scene.shots);
}
