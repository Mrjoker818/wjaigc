/** Pure ffmpeg planning for stitching shots: keeps audio, fills silence, optional transitions, burned subtitles and voiceovers. */

export type DramaTransition = 'cut' | 'fade' | 'flash';

export const DRAMA_TRANSITIONS: readonly DramaTransition[] = ['cut', 'fade', 'flash'];

export interface RenderClip {
  /** Input file path, relative to the ffmpeg working directory or absolute. */
  path: string;
  durationSec: number;
  hasAudio: boolean;
}

/** A recorded line played from the start of a clip's visible part. */
export interface RenderVoiceover {
  clipIndex: number;
  /** Audio file path inside the ffmpeg working directory. */
  path: string;
}

export interface SubtitleCue {
  startSec: number;
  endSec: number;
  text: string;
}

export interface RenderPlanInput {
  clips: RenderClip[];
  width: number;
  height: number;
  fps?: number;
  /** Transition between every pair of clips. */
  transition?: DramaTransition;
  transitionSec?: number;
  /** SRT file name inside the ffmpeg working directory. Must not contain filter metacharacters. */
  subtitleFile?: string;
  /** Font for burned subtitles: a directory inside the working directory and the font family name. */
  subtitleFont?: { dir: string; family: string };
  /** At most one per clip. The clip's own audio is turned down under its voiceover. */
  voiceovers?: RenderVoiceover[];
  outputPath: string;
}

export interface RenderPlan {
  args: string[];
  durationSec: number;
  /** Clip start times on the final timeline; used to place subtitles. */
  clipStarts: number[];
}

const SAMPLE_RATE = 44100;
const SAFE_SUBTITLE_FILE = /^[A-Za-z0-9_.-]+\.srt$/;
const SAFE_FONT_DIR = /^[A-Za-z0-9_-]+$/;
const SAFE_FONT_FAMILY = /^[A-Za-z0-9 ]+$/;
/** Level of the clip's own sound (ambience, or a line the video model already spoke) under a voiceover. */
const UNDER_VOICEOVER_VOLUME = 0.35;

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function seconds(value: number): string {
  return Number(value.toFixed(3)).toString();
}

/** Transition length is clamped so it never consumes more than half of the shortest clip. */
export function effectiveTransitionSec(clips: RenderClip[], transition: DramaTransition, requested = 0.5): number {
  if (transition === 'cut' || clips.length < 2) return 0;
  const shortest = Math.min(...clips.map(clip => clip.durationSec));
  return Math.max(0, Math.min(requested, shortest / 2, 2));
}

/** Start time of every clip after transitions overlap neighbours. */
export function timelineStarts(clips: RenderClip[], transitionSec: number): number[] {
  const starts: number[] = [];
  let cursor = 0;
  clips.forEach((clip, index) => {
    starts.push(cursor);
    cursor += clip.durationSec - (index < clips.length - 1 ? transitionSec : 0);
  });
  return starts;
}

export function buildRenderPlan(input: RenderPlanInput): RenderPlan {
  const { clips } = input;
  if (clips.length < 1) throw new Error('DRAMA_RENDER_NO_CLIPS');
  for (const clip of clips) {
    if (!(clip.durationSec > 0) || !Number.isFinite(clip.durationSec)) throw new Error('DRAMA_RENDER_BAD_DURATION');
  }
  if (input.subtitleFile !== undefined && !SAFE_SUBTITLE_FILE.test(input.subtitleFile)) {
    throw new Error('DRAMA_RENDER_BAD_SUBTITLE_FILE');
  }
  if (input.subtitleFont && (!SAFE_FONT_DIR.test(input.subtitleFont.dir) || !SAFE_FONT_FAMILY.test(input.subtitleFont.family))) {
    throw new Error('DRAMA_RENDER_BAD_SUBTITLE_FONT');
  }
  const voiceovers = input.voiceovers ?? [];
  const voiced = new Set<number>();
  for (const voiceover of voiceovers) {
    if (!Number.isInteger(voiceover.clipIndex) || voiceover.clipIndex < 0 || voiceover.clipIndex >= clips.length
      || voiced.has(voiceover.clipIndex) || !voiceover.path) throw new Error('DRAMA_RENDER_BAD_VOICEOVER');
    voiced.add(voiceover.clipIndex);
  }
  const width = even(input.width);
  const height = even(input.height);
  const fps = input.fps ?? 30;
  const transition = input.transition ?? 'cut';
  const transitionSec = effectiveTransitionSec(clips, transition, input.transitionSec);

  const args: string[] = ['-hide_banner', '-y'];
  const audioInputs: number[] = [];
  clips.forEach(clip => { args.push('-i', clip.path); });
  let nextInput = clips.length;
  clips.forEach(clip => {
    if (clip.hasAudio) {
      audioInputs.push(-1);
    } else {
      args.push('-f', 'lavfi', '-t', seconds(clip.durationSec), '-i', `anullsrc=channel_layout=stereo:sample_rate=${SAMPLE_RATE}`);
      audioInputs.push(nextInput);
      nextInput += 1;
    }
  });
  const voiceoverInputs = voiceovers.map(voiceover => {
    args.push('-i', voiceover.path);
    nextInput += 1;
    return nextInput - 1;
  });

  const filters: string[] = [];
  clips.forEach((clip, index) => {
    const dur = seconds(clip.durationSec);
    filters.push(`[${index}:v]trim=0:${dur},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,`
      + `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${index}]`);
    const audioSource = audioInputs[index] === -1 ? `${index}:a` : `${audioInputs[index]}:a`;
    filters.push(`[${audioSource}]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,`
      + `apad,atrim=0:${dur},asetpts=PTS-STARTPTS${voiced.has(index) ? `,volume=${UNDER_VOICEOVER_VOLUME}` : ''}[a${index}]`);
  });

  const clipStarts = timelineStarts(clips, transitionSec);
  let videoOut = 'v0';
  let audioOut = 'a0';
  if (clips.length > 1 && transitionSec === 0) {
    filters.push(`${clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${clips.length}:v=1:a=1[vcat][acat]`);
    videoOut = 'vcat';
    audioOut = 'acat';
  } else if (clips.length > 1) {
    const kind = transition === 'flash' ? 'fadewhite' : 'fade';
    for (let i = 1; i < clips.length; i += 1) {
      const nextVideo = `vx${i}`;
      const nextAudio = `ax${i}`;
      filters.push(`[${videoOut}][v${i}]xfade=transition=${kind}:duration=${seconds(transitionSec)}:offset=${seconds(clipStarts[i])}[${nextVideo}]`);
      filters.push(`[${audioOut}][a${i}]acrossfade=d=${seconds(transitionSec)}[${nextAudio}]`);
      videoOut = nextVideo;
      audioOut = nextAudio;
    }
  }
  if (voiceovers.length) {
    // Same window as the clip's subtitle: after the incoming transition, cut before the outgoing one.
    voiceovers.forEach((voiceover, k) => {
      const i = voiceover.clipIndex;
      const startSec = clipStarts[i] + (i > 0 ? transitionSec : 0);
      const lengthSec = Math.max(0.1, clips[i].durationSec - (i > 0 ? transitionSec : 0) - (i < clips.length - 1 ? transitionSec : 0));
      const delayMs = Math.round(startSec * 1000);
      filters.push(`[${voiceoverInputs[k]}:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,`
        + `atrim=0:${seconds(lengthSec)},asetpts=PTS-STARTPTS,adelay=${delayMs}:all=1[vo${k}]`);
    });
    filters.push(`[${audioOut}]${voiceovers.map((_, k) => `[vo${k}]`).join('')}amix=inputs=${voiceovers.length + 1}:duration=first:normalize=0[amix]`);
    audioOut = 'amix';
  }
  if (input.subtitleFile) {
    const fontSize = Math.max(12, Math.round(Math.min(width, height) / 22));
    const font = input.subtitleFont
      ? `:fontsdir=${input.subtitleFont.dir}:force_style='FontName=${input.subtitleFont.family},FontSize=${fontSize},Outline=2'`
      : `:force_style='FontSize=${fontSize},Outline=2'`;
    filters.push(`[${videoOut}]subtitles=${input.subtitleFile}${font}[vsub]`);
    videoOut = 'vsub';
  }

  const last = clips.length - 1;
  const durationSec = clipStarts[last] + clips[last].durationSec;
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', `[${videoOut}]`, '-map', `[${audioOut}]`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', String(SAMPLE_RATE),
    '-movflags', '+faststart', input.outputPath,
  );
  return { args, durationSec, clipStarts };
}

function srtTime(totalSec: number): string {
  const ms = Math.max(0, Math.round(totalSec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(rest, 3)}`;
}

/** Empty cues are dropped; text is single-spaced so a cue cannot inject extra SRT blocks. */
export function buildSrt(cues: SubtitleCue[]): string {
  return cues
    .map(cue => ({ ...cue, text: cue.text.replace(/\r?\n\s*\r?\n/g, '\n').trim() }))
    .filter(cue => cue.text && cue.endSec > cue.startSec)
    .map((cue, index) => `${index + 1}\n${srtTime(cue.startSec)} --> ${srtTime(cue.endSec)}\n${cue.text}\n`)
    .join('\n');
}
