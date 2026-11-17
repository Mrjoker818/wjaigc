/** Pure helpers that turn an episode into render inputs: the selected take of every shot and dialogue subtitles. */
import type { SubtitleCue } from './render';
import { activeTake, type DramaProjectV1 } from './types';

export interface TimelineClip {
  shotId: string;
  videoUrl: string;
  dialogue?: string;
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
    clips.push({ shotId: shot.id, videoUrl: take.videoUrl, ...(shot.dialogue?.trim() ? { dialogue: shot.dialogue.trim() } : {}) });
  }
  return { clips, missingShotIds };
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
