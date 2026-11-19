/** Pure ffmpeg planning for stitching shots: keeps audio, fills silence, optional transitions, burned subtitles, voiceovers and music. */

export type DramaTransition = 'cut' | 'fade' | 'flash';

export const DRAMA_TRANSITIONS: readonly DramaTransition[] = ['cut', 'fade', 'flash'];

export interface RenderClip {
  /** Input file path, relative to the ffmpeg working directory or absolute. */
  path: string;
  /** Length of the source file. */
  durationSec: number;
  hasAudio: boolean;
  /** Part of the source to keep, in source seconds; defaults to the whole file. The end is clamped to the file. */
  trimStartSec?: number;
  trimEndSec?: number;
  /** Playback rate, 0.5 to 2; audio keeps its pitch. */
  speed?: number;
  /** Gain on the clip's own sound, 0 to 2. */
  volume?: number;
}

/** Shortest piece of a clip a trim may leave. */
export const MIN_CLIP_SEC = 0.2;
export const CLIP_SPEED_RANGE = [0.5, 2] as const;
export const CLIP_VOLUME_MAX = 2;

/** Kept part of the source, after clamping the trim to the file. */
function keptRange(clip: RenderClip): [number, number] {
  const end = Math.min(clip.durationSec, clip.trimEndSec ?? clip.durationSec);
  const start = Math.max(0, Math.min(clip.trimStartSec ?? 0, end));
  return [start, end];
}

/** Seconds the clip lasts in the film, after trim and speed. */
export function clipLength(clip: RenderClip): number {
  const [start, end] = keptRange(clip);
  return (end - start) / (clip.speed ?? 1);
}

/** A recorded line played from the start of a clip's visible part. */
export interface RenderVoiceover {
  clipIndex: number;
  /** Audio file path inside the ffmpeg working directory. */
  path: string;
}

/** Camera moves for a still shot: push in, pull out, or pan across the picture. */
export const STILL_MOTIONS = ['push-in', 'pull-out', 'pan-left', 'pan-right'] as const;
export type StillMotion = typeof STILL_MOTIONS[number];

export interface StillClipInput {
  /** Image inside the ffmpeg working directory; ffmpeg reads the format from the bytes. */
  imagePath: string;
  outputPath: string;
  width: number;
  height: number;
  durationSec: number;
  motion: StillMotion;
  fps?: number;
}

/** Zoom at the far end of a push or pull, and the fixed zoom that leaves room to pan. */
const STILL_ZOOM = 1.2;
const STILL_PAN_ZOOM = 1.15;

/**
 * Args for turning one image into a silent clip with a slow camera move (Ken Burns).
 * The image is first scaled to twice the output size so the move does not step from pixel to pixel.
 */
export function buildStillClipArgs(input: StillClipInput): string[] {
  if (!STILL_MOTIONS.includes(input.motion)) throw new Error('DRAMA_RENDER_BAD_MOTION');
  if (!(input.durationSec > 0 && input.durationSec <= 60)) throw new Error('DRAMA_RENDER_BAD_DURATION');
  const width = even(input.width);
  const height = even(input.height);
  const fps = input.fps ?? 30;
  const frames = Math.max(2, Math.round(input.durationSec * fps));
  const progress = `on/${frames - 1}`;
  const centerX = 'iw/2-(iw/zoom/2)';
  const centerY = 'ih/2-(ih/zoom/2)';
  const move = {
    'push-in': { z: `1+${seconds(STILL_ZOOM - 1)}*${progress}`, x: centerX, y: centerY },
    'pull-out': { z: `${STILL_ZOOM}-${seconds(STILL_ZOOM - 1)}*${progress}`, x: centerX, y: centerY },
    'pan-left': { z: String(STILL_PAN_ZOOM), x: `(iw-iw/zoom)*(1-${progress})`, y: centerY },
    'pan-right': { z: String(STILL_PAN_ZOOM), x: `(iw-iw/zoom)*${progress}`, y: centerY },
  }[input.motion];
  const big = `${width * 2}:${height * 2}`;
  return [
    '-hide_banner', '-y', '-i', input.imagePath,
    '-vf', `scale=${big}:force_original_aspect_ratio=increase,crop=${big},`
      + `zoompan=z='${move.z}':x='${move.x}':y='${move.y}':d=${frames}:s=${width}x${height}:fps=${fps},setsar=1,format=yuv420p`,
    '-frames:v', String(frames), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    input.outputPath,
  ];
}

/** Frame size for an episode with no video clip to copy it from. */
export function stillFrameSize(aspectRatio: string): { width: number; height: number } {
  const sizes: Record<string, [number, number]> = {
    '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [1080, 1080], '3:4': [960, 1280], '4:3': [1280, 960], '21:9': [1680, 720],
  };
  const [width, height] = sizes[aspectRatio] ?? [720, 1280];
  return { width, height };
}

/** Background music looped under the whole film. */
export interface RenderMusic {
  /** Audio file path inside the ffmpeg working directory. */
  path: string;
  /** Linear gain, 0 to 1. */
  volume: number;
  /** Turn the music down while dialogue, voiceovers or the clips' own sound play. */
  ducking: boolean;
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
  music?: RenderMusic;
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
/** Music fades in and out over this long, or a quarter of the film when it is short. */
const MUSIC_FADE_SEC = 2;
/**
 * Peak limiter on the finished mix, so music added on top of loud clips cannot clip.
 * Not loudnorm: its single-pass mode resamples to 192 kHz and doubled ffmpeg's memory on a 720p episode.
 */
const MIX_LIMITER = 'alimiter=limit=0.89:level=disabled';

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
  const shortest = Math.min(...clips.map(clipLength));
  return Math.max(0, Math.min(requested, shortest / 2, 2));
}

/** Start time of every clip after transitions overlap neighbours. */
export function timelineStarts(clips: RenderClip[], transitionSec: number): number[] {
  const starts: number[] = [];
  let cursor = 0;
  clips.forEach((clip, index) => {
    starts.push(cursor);
    cursor += clipLength(clip) - (index < clips.length - 1 ? transitionSec : 0);
  });
  return starts;
}

export function buildRenderPlan(input: RenderPlanInput): RenderPlan {
  const { clips } = input;
  if (clips.length < 1) throw new Error('DRAMA_RENDER_NO_CLIPS');
  for (const clip of clips) {
    if (!(clip.durationSec > 0) || !Number.isFinite(clip.durationSec)) throw new Error('DRAMA_RENDER_BAD_DURATION');
    const speed = clip.speed ?? 1;
    if (!(speed >= CLIP_SPEED_RANGE[0] && speed <= CLIP_SPEED_RANGE[1])) throw new Error('DRAMA_RENDER_BAD_SPEED');
    const volume = clip.volume ?? 1;
    if (!(volume >= 0 && volume <= CLIP_VOLUME_MAX)) throw new Error('DRAMA_RENDER_BAD_VOLUME');
    if (!(clipLength(clip) * speed >= MIN_CLIP_SEC)) throw new Error('DRAMA_RENDER_BAD_TRIM');
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
  const music = input.music;
  if (music && (!music.path || !(music.volume >= 0 && music.volume <= 1))) throw new Error('DRAMA_RENDER_BAD_MUSIC');
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
      args.push('-f', 'lavfi', '-t', seconds(clipLength(clip)), '-i', `anullsrc=channel_layout=stereo:sample_rate=${SAMPLE_RATE}`);
      audioInputs.push(nextInput);
      nextInput += 1;
    }
  });
  const voiceoverInputs = voiceovers.map(voiceover => {
    args.push('-i', voiceover.path);
    nextInput += 1;
    return nextInput - 1;
  });
  // Looped forever and cut to the film's length in the filter graph.
  const musicInput = music ? nextInput : -1;
  if (music) args.push('-stream_loop', '-1', '-i', music.path);

  const filters: string[] = [];
  clips.forEach((clip, index) => {
    const [start, end] = keptRange(clip);
    const speed = clip.speed ?? 1;
    const dur = seconds(clipLength(clip));
    const pts = speed === 1 ? 'PTS-STARTPTS' : `(PTS-STARTPTS)/${seconds(speed)}`;
    filters.push(`[${index}:v]trim=${seconds(start)}:${seconds(end)},setpts=${pts},scale=${width}:${height}:force_original_aspect_ratio=decrease,`
      + `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${index}]`);
    const own = audioInputs[index] === -1;
    // The source's own sound gets the same trim and speed as its picture; atempo keeps the pitch.
    const shape = own ? `atrim=${seconds(start)}:${seconds(end)},asetpts=PTS-STARTPTS,${speed === 1 ? '' : `atempo=${seconds(speed)},`}` : '';
    const gain = (clip.volume ?? 1) * (voiced.has(index) ? UNDER_VOICEOVER_VOLUME : 1);
    filters.push(`[${own ? `${index}:a` : `${audioInputs[index]}:a`}]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,`
      + `${shape}apad,atrim=0:${dur},asetpts=PTS-STARTPTS${gain === 1 ? '' : `,volume=${seconds(gain)}`}[a${index}]`);
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
      const lengthSec = Math.max(0.1, clipLength(clips[i]) - (i > 0 ? transitionSec : 0) - (i < clips.length - 1 ? transitionSec : 0));
      const delayMs = Math.round(startSec * 1000);
      filters.push(`[${voiceoverInputs[k]}:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,`
        + `atrim=0:${seconds(lengthSec)},asetpts=PTS-STARTPTS,adelay=${delayMs}:all=1[vo${k}]`);
    });
    filters.push(`[${audioOut}]${voiceovers.map((_, k) => `[vo${k}]`).join('')}amix=inputs=${voiceovers.length + 1}:duration=first:normalize=0[amix]`);
    audioOut = 'amix';
  }
  const last = clips.length - 1;
  const durationSec = clipStarts[last] + clipLength(clips[last]);
  if (music) {
    const fade = Math.min(MUSIC_FADE_SEC, durationSec / 4);
    filters.push(`[${musicInput}:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,`
      + `atrim=0:${seconds(durationSec)},asetpts=PTS-STARTPTS,volume=${seconds(music.volume)},`
      + `afade=t=in:d=${seconds(fade)},afade=t=out:st=${seconds(durationSec - fade)}:d=${seconds(fade)}[bgm]`);
    if (music.ducking) {
      // The foreground keys a compressor on the music: it dips under speech and comes back within half a second.
      filters.push(`[${audioOut}]asplit=2[fg][fgkey]`);
      filters.push('[bgm][fgkey]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[bgmd]');
      filters.push(`[fg][bgmd]amix=inputs=2:duration=first:normalize=0,${MIX_LIMITER}[amusic]`);
    } else {
      filters.push(`[${audioOut}][bgm]amix=inputs=2:duration=first:normalize=0,${MIX_LIMITER}[amusic]`);
    }
    audioOut = 'amusic';
  }
  if (input.subtitleFile) {
    const fontSize = Math.max(12, Math.round(Math.min(width, height) / 22));
    const font = input.subtitleFont
      ? `:fontsdir=${input.subtitleFont.dir}:force_style='FontName=${input.subtitleFont.family},FontSize=${fontSize},Outline=2'`
      : `:force_style='FontSize=${fontSize},Outline=2'`;
    filters.push(`[${videoOut}]subtitles=${input.subtitleFile}${font}[vsub]`);
    videoOut = 'vsub';
  }

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
