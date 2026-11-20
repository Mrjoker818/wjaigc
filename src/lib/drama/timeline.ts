/** Pure helpers that turn an episode into render inputs: the selected take of every shot and dialogue subtitles. */
import { clipLength, type StillMotion, type SubtitleCue } from './render';
import type { DramaClipEdit, DramaProjectV1, DramaShot, ShotSource } from './types';
import { currentTakeForShot, isVoiceoverCurrent } from './production-version';

function currentShotSource(doc: DramaProjectV1, episodeId: string, shot: DramaShot): ShotSource | undefined {
  if (shot.still && shot.firstFrameUrl) return { kind: 'still', imageUrl: shot.firstFrameUrl, motion: shot.still.motion };
  const take = currentTakeForShot(doc, episodeId, shot);
  return take ? { kind: 'video', take } : undefined;
}

/** One shot in the film: a video take, or a still image with a camera move (then `videoUrl` is absent). */
export interface TimelineClip {
  shotId: string;
  videoUrl?: string;
  still?: { url: string; motion: StillMotion; durationSec: number };
  dialogue?: string;
  /** Voiceover recorded from the current line; a stale one is left out. */
  voiceoverUrl?: string;
  edit?: DramaClipEdit;
}

/** Planned seconds the shot fills in the film: its planned length, trimmed and sped up or slowed down. */
export function shotFilmLength(shot: Pick<DramaShot, 'durationSec' | 'clipEdit'> & Partial<Pick<DramaShot, 'still' | 'firstFrameUrl'>>): number {
  // A still is drawn at the planned length; trim and speed belong to video takes.
  if (shot.still && shot.firstFrameUrl) return shot.durationSec;
  return clipLength({ path: '', hasAudio: false, durationSec: shot.durationSec, ...shot.clipEdit });
}

export interface EpisodeTimeline {
  clips: TimelineClip[];
  /** Shots that have no completed take yet; rendering is blocked until they do. */
  missingShotIds: string[];
}

export function collectEpisodeTimeline(doc: DramaProjectV1, episodeId: string): EpisodeTimeline {
  const episode = doc.episodes.find(item => item.id === episodeId);
  const clips: TimelineClip[] = [];
  const missingShotIds: string[] = [];
  for (const shot of episode ? episode.scenes.flatMap(scene => scene.shots) : []) {
    const source = currentShotSource(doc, episodeId, shot);
    if (!source) { missingShotIds.push(shot.id); continue; }
    const voiceoverUrl = isVoiceoverCurrent(doc, shot) ? shot.voiceoverUrl : undefined;
    clips.push({
      shotId: shot.id,
      ...(source.kind === 'video'
        ? { videoUrl: source.take.videoUrl!, ...(shot.clipEdit ? { edit: shot.clipEdit } : {}) }
        : { still: { url: source.imageUrl, motion: source.motion, durationSec: shot.durationSec } }),
      ...(shot.dialogue?.trim() ? { dialogue: shot.dialogue.trim() } : {}),
      ...(voiceoverUrl ? { voiceoverUrl } : {}),
    });
  }
  return { clips, missingShotIds };
}

export interface TimelineBlock {
  shotId: string;
  sceneNumber: number;
  shotNumber: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  /** The shot has a video take or a still in the film. */
  hasTake: boolean;
  /** The shot is a still with a camera move. */
  still?: boolean;
  thumbnailUrl?: string;
  subtitle?: string;
}

/**
 * Planned layout of an episode for the timeline bar, using each shot's planned length.
 * The server measures the real clip lengths when it renders, so the final film can differ by a fraction of a second.
 */
export function buildTimeline(doc: DramaProjectV1, episodeId: string): TimelineBlock[] {
  const episode = doc.episodes.find(item => item.id === episodeId);
  if (!episode) return [];
  const shots = episode.scenes.flatMap((scene, sceneIndex) => scene.shots.map(shot => ({ shot, sceneNumber: sceneIndex + 1 })));
  const overlap = doc.timeline.transition === 'cut' || shots.length < 2 ? 0
    : Math.max(0, Math.min(doc.timeline.transitionSec, Math.min(...shots.map(item => shotFilmLength(item.shot))) / 2, 2));
  let cursor = 0;
  return shots.map(({ shot, sceneNumber }, i) => {
    const source = currentShotSource(doc, episodeId, shot);
    const startSec = cursor;
    const length = shotFilmLength(shot);
    cursor += length - (i < shots.length - 1 ? overlap : 0);
    return {
      shotId: shot.id, sceneNumber, shotNumber: i + 1, startSec, endSec: startSec + length, durationSec: length,
      hasTake: Boolean(source),
      ...(source?.kind === 'still' ? { still: true, thumbnailUrl: source.imageUrl } : {}),
      ...(source?.kind === 'video' && source.take.thumbnailUrl ? { thumbnailUrl: source.take.thumbnailUrl } : {}),
      ...(doc.timeline.subtitles && shot.dialogue?.trim() ? { subtitle: shot.dialogue.trim() } : {}),
    };
  });
}

/** One cue per clip with dialogue, shown for the part of the clip that does not overlap a transition. */
export function dialogueCues(
  clips: Array<Pick<TimelineClip, 'dialogue'>>, clipStarts: number[], durations: number[], transitionSec: number,
): SubtitleCue[] {
  return clips.flatMap((clip, i) => {
    if (!clip.dialogue) return [];
    const startSec = clipStarts[i] + (i > 0 ? transitionSec : 0);
    const endSec = clipStarts[i] + durations[i] - (i < clips.length - 1 ? transitionSec : 0);
    return endSec > startSec ? [{ startSec, endSec, text: clip.dialogue }] : [];
  });
}
