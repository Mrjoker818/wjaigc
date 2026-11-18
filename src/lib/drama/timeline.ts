/** Pure helpers that turn an episode into render inputs: the selected take of every shot and dialogue subtitles. */
import type { SubtitleCue } from './render';
import { activeTake, type DramaProjectV1 } from './types';
import { currentVoiceover } from './voiceover';

export interface TimelineClip {
  shotId: string;
  videoUrl: string;
  dialogue?: string;
  /** Voiceover recorded from the current line; a stale one is left out. */
  voiceoverUrl?: string;
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
    const take = activeTake(shot);
    if (!take?.videoUrl) { missingShotIds.push(shot.id); continue; }
    const voiceoverUrl = currentVoiceover(shot);
    clips.push({
      shotId: shot.id, videoUrl: take.videoUrl,
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
  hasTake: boolean;
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
    : Math.max(0, Math.min(doc.timeline.transitionSec, Math.min(...shots.map(item => item.shot.durationSec)) / 2, 2));
  let cursor = 0;
  return shots.map(({ shot, sceneNumber }, i) => {
    const take = activeTake(shot);
    const startSec = cursor;
    cursor += shot.durationSec - (i < shots.length - 1 ? overlap : 0);
    return {
      shotId: shot.id, sceneNumber, shotNumber: i + 1, startSec, endSec: startSec + shot.durationSec, durationSec: shot.durationSec,
      hasTake: Boolean(take?.videoUrl),
      ...(take?.thumbnailUrl ? { thumbnailUrl: take.thumbnailUrl } : {}),
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
