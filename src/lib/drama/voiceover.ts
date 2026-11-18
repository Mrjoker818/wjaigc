/** Dialogue voiceover: which voice speaks a shot's line and whether its recorded audio still matches the line. */
import type { DramaCastMember, DramaShot } from './types';

/** Voices of OpenAI-compatible `/audio/speech` providers, the protocol `/api/audio/generate` speaks. */
export const DRAMA_VOICES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'alloy', label: '中性' },
  { id: 'nova', label: '女声 · 明亮' },
  { id: 'shimmer', label: '女声 · 柔和' },
  { id: 'echo', label: '男声 · 沉稳' },
  { id: 'onyx', label: '男声 · 低沉' },
  { id: 'fable', label: '旁白 · 讲述' },
];

export const DEFAULT_VOICE = 'alloy';

/** The speaker picked for the shot, or else the first character in it. */
export function shotSpeaker(shot: Pick<DramaShot, 'speakerId' | 'characterIds'>, cast: DramaCastMember[]): DramaCastMember | undefined {
  return cast.find(member => member.id === shot.speakerId) ?? cast.find(member => member.id === shot.characterIds?.[0]);
}

export function shotVoice(shot: Pick<DramaShot, 'speakerId' | 'characterIds'>, cast: DramaCastMember[]): string {
  return shotSpeaker(shot, cast)?.voice || DEFAULT_VOICE;
}

/** The voiceover URL when it was recorded from the line as it reads now; an edited line needs a new recording. */
export function currentVoiceover(shot: Pick<DramaShot, 'dialogue' | 'voiceoverUrl' | 'voiceoverText'>): string | undefined {
  const line = shot.dialogue?.trim();
  return line && shot.voiceoverUrl && shot.voiceoverText === line ? shot.voiceoverUrl : undefined;
}

/** Shots with a line but no voiceover that matches it. */
export function shotsNeedingVoiceover<T extends Pick<DramaShot, 'dialogue' | 'voiceoverUrl' | 'voiceoverText'>>(shots: T[]): T[] {
  return shots.filter(shot => shot.dialogue?.trim() && !currentVoiceover(shot));
}
