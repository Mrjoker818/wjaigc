import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRenderPlan, buildSrt, clipLength, effectiveTransitionSec, timelineStarts, type RenderClip } from '@/lib/drama/render';

function hasBinary(name: string): boolean {
  try { execFileSync(name, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

const clips: RenderClip[] = [
  { path: 'a.mp4', durationSec: 2, hasAudio: true },
  { path: 'b.mp4', durationSec: 3, hasAudio: false },
  { path: 'c.mp4', durationSec: 2, hasAudio: true },
];

describe('drama render plan', () => {
  it('keeps every audio track and fills silent clips with anullsrc', () => {
    const plan = buildRenderPlan({ clips, width: 640, height: 360, outputPath: 'out.mp4' });
    expect(plan.args).not.toContain('-an');
    expect(plan.args.filter(arg => arg.startsWith('anullsrc'))).toHaveLength(1);
    const filter = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('[0:a]');
    expect(filter).toContain('[3:a]');
    expect(filter).toContain('[2:a]');
    expect(filter).toContain('concat=n=3:v=1:a=1[vcat][acat]');
    expect(plan.durationSec).toBe(7);
    expect(plan.clipStarts).toEqual([0, 2, 5]);
  });

  it('overlaps clips for fade and flash transitions', () => {
    const fade = buildRenderPlan({ clips, width: 640, height: 360, transition: 'fade', transitionSec: 0.5, outputPath: 'o.mp4' });
    const filter = fade.args[fade.args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('xfade=transition=fade:duration=0.5:offset=1.5');
    expect(filter).toContain('xfade=transition=fade:duration=0.5:offset=4');
    expect(filter).toContain('acrossfade=d=0.5');
    expect(fade.durationSec).toBe(6);
    const flash = buildRenderPlan({ clips, width: 640, height: 360, transition: 'flash', outputPath: 'o.mp4' });
    expect(flash.args.join(' ')).toContain('transition=fadewhite');
  });

  it('clamps transitions to half of the shortest clip and ignores cut', () => {
    expect(effectiveTransitionSec(clips, 'fade', 5)).toBe(1);
    expect(effectiveTransitionSec(clips, 'cut', 1)).toBe(0);
    expect(timelineStarts(clips, 1)).toEqual([0, 1, 3]);
  });

  it('rejects unsafe subtitle file names and empty input', () => {
    expect(() => buildRenderPlan({ clips, width: 640, height: 360, subtitleFile: "x':y.srt", outputPath: 'o.mp4' }))
      .toThrow('DRAMA_RENDER_BAD_SUBTITLE_FILE');
    expect(() => buildRenderPlan({ clips, width: 640, height: 360, subtitleFile: 's.srt',
      subtitleFont: { dir: 'fonts', family: "x',y" }, outputPath: 'o.mp4' })).toThrow('DRAMA_RENDER_BAD_SUBTITLE_FONT');
    expect(() => buildRenderPlan({ clips: [], width: 640, height: 360, outputPath: 'o.mp4' })).toThrow('DRAMA_RENDER_NO_CLIPS');
    expect(() => buildRenderPlan({ clips: [{ path: 'a', durationSec: 0, hasAudio: true }], width: 2, height: 2, outputPath: 'o' }))
      .toThrow('DRAMA_RENDER_BAD_DURATION');
  });

  it('loops music under the film, fades it, ducks it under the foreground and limits the peaks', () => {
    const plan = buildRenderPlan({ clips, width: 640, height: 360, music: { path: 'bgm.mp3', volume: 0.4, ducking: true }, outputPath: 'o.mp4' });
    const loop = plan.args.indexOf('-stream_loop');
    expect(plan.args.slice(loop, loop + 4)).toEqual(['-stream_loop', '-1', '-i', 'bgm.mp3']);
    const filter = plan.args[plan.args.indexOf('-filter_complex') + 1];
    // Inputs: three clips, one anullsrc for the silent clip, then the music.
    expect(filter).toContain('[4:a]aresample=44100');
    expect(filter).toContain('atrim=0:7,asetpts=PTS-STARTPTS,volume=0.4,afade=t=in:d=1.75,afade=t=out:st=5.25:d=1.75[bgm]');
    expect(filter).toContain('[acat]asplit=2[fg][fgkey]');
    expect(filter).toContain('[bgm][fgkey]sidechaincompress=');
    expect(filter).toContain('alimiter=limit=0.89');
    expect(filter).not.toContain('loudnorm');
    expect(plan.args[plan.args.indexOf('-map', plan.args.indexOf('-map') + 1) + 1]).toBe('[amusic]');

    const flat = buildRenderPlan({ clips, width: 640, height: 360, music: { path: 'bgm.mp3', volume: 0.2, ducking: false }, outputPath: 'o.mp4' });
    const flatFilter = flat.args[flat.args.indexOf('-filter_complex') + 1];
    expect(flatFilter).not.toContain('sidechaincompress');
    expect(flatFilter).toContain('[acat][bgm]amix=inputs=2');
    expect(() => buildRenderPlan({ clips, width: 640, height: 360, music: { path: 'bgm.mp3', volume: 2, ducking: false }, outputPath: 'o.mp4' }))
      .toThrow('DRAMA_RENDER_BAD_MUSIC');
  });

  it('trims, retimes and turns down a clip, and lays the timeline out by the cut length', () => {
    const edited: RenderClip[] = [
      { path: 'a.mp4', durationSec: 5, hasAudio: true, trimStartSec: 1, trimEndSec: 4, speed: 1.5, volume: 0.5 },
      { path: 'b.mp4', durationSec: 3, hasAudio: false, trimEndSec: 9, speed: 0.5 },
    ];
    expect(clipLength(edited[0])).toBe(2);
    // The out point is clamped to the file, so the 3-second clip at half speed lasts 6 seconds.
    expect(clipLength(edited[1])).toBe(6);
    const plan = buildRenderPlan({ clips: edited, width: 640, height: 360, outputPath: 'o.mp4' });
    expect(plan.clipStarts).toEqual([0, 2]);
    expect(plan.durationSec).toBe(8);
    const filter = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('[0:v]trim=1:4,setpts=(PTS-STARTPTS)/1.5,');
    expect(filter).toContain('atrim=1:4,asetpts=PTS-STARTPTS,atempo=1.5,apad,atrim=0:2,asetpts=PTS-STARTPTS,volume=0.5[a0]');
    expect(filter).toContain('[1:v]trim=0:3,setpts=(PTS-STARTPTS)/0.5,');
    // The silent clip's stand-in audio is generated at the cut length, so it is not trimmed or retimed again.
    expect(plan.args).toContain('6');
    expect(filter).not.toMatch(/\[2:a\][^;]*atempo/);
  });

  it('rejects speeds, volumes and trims out of range', () => {
    const base = { path: 'a.mp4', durationSec: 5, hasAudio: true };
    const plan = (clip: RenderClip) => () => buildRenderPlan({ clips: [clip], width: 640, height: 360, outputPath: 'o.mp4' });
    expect(plan({ ...base, speed: 3 })).toThrow('DRAMA_RENDER_BAD_SPEED');
    expect(plan({ ...base, volume: 2.5 })).toThrow('DRAMA_RENDER_BAD_VOLUME');
    expect(plan({ ...base, trimStartSec: 4.95 })).toThrow('DRAMA_RENDER_BAD_TRIM');
  });

  it('writes SRT cues and collapses blank lines inside a cue', () => {
    expect(buildSrt([
      { startSec: 0, endSec: 1.5, text: '你好' },
      { startSec: 2, endSec: 2, text: 'skip' },
      { startSec: 61.25, endSec: 63, text: 'a\n\n2\n00:00:00,000 --> 00:00:01,000' },
    ])).toBe('1\n00:00:00,000 --> 00:00:01,500\n你好\n\n2\n00:01:01,250 --> 00:01:03,000\na\n2\n00:00:00,000 --> 00:00:01,000\n');
  });

  it.skipIf(!hasBinary('ffmpeg') || !hasBinary('ffprobe'))('renders real clips with audio, fade and subtitles', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drama-render-'));
    try {
      const make = (name: string, seconds: number, audio: boolean, color: string) => {
        execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
          '-f', 'lavfi', '-i', `color=c=${color}:s=320x240:d=${seconds}:r=25`,
          ...(audio ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`] : []),
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(audio ? ['-c:a', 'aac', '-shortest'] : []),
          join(dir, name)], { stdio: 'ignore' });
      };
      make('a.mp4', 2, true, 'red');
      make('b.mp4', 3, false, 'green');
      make('c.mp4', 2, true, 'blue');
      mkdirSync(join(dir, 'fonts'));
      copyFileSync(join(process.cwd(), 'src/lib/pdf/fonts/WujiePdfSansSC-Regular.ttf'), join(dir, 'fonts', 'subtitle.ttf'));
      writeFileSync(join(dir, 'subs.srt'), buildSrt([{ startSec: 0, endSec: 1, text: '你好，世界' }]), 'utf8');
      const plan = buildRenderPlan({
        clips: clips.map(clip => ({ ...clip })), width: 640, height: 360,
        transition: 'fade', transitionSec: 0.5, subtitleFile: 'subs.srt',
        subtitleFont: { dir: 'fonts', family: 'Wujie PDF Sans SC' }, outputPath: 'out.mp4',
      });
      execFileSync('ffmpeg', ['-loglevel', 'error', ...plan.args], { cwd: dir, stdio: 'pipe' });
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
        'stream=codec_type:format=duration', '-of', 'json', join(dir, 'out.mp4')], { encoding: 'utf8' })) as {
        streams: Array<{ codec_type: string }>; format: { duration: string };
      };
      expect(probe.streams.map(stream => stream.codec_type).sort()).toEqual(['audio', 'video']);
      expect(Math.abs(Number(probe.format.duration) - plan.durationSec)).toBeLessThan(0.25);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it.skipIf(!hasBinary('ffmpeg') || !hasBinary('ffprobe'))('renders a trimmed, sped-up clip next to a slowed silent one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drama-edit-'));
    try {
      for (const [name, seconds, audio] of [['a.mp4', 4, true], ['b.mp4', 2, false]] as const) {
        execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
          '-f', 'lavfi', '-i', `color=c=gray:s=320x240:d=${seconds}:r=25`,
          ...(audio ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`] : []),
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(audio ? ['-c:a', 'aac', '-shortest'] : []),
          join(dir, name)], { stdio: 'ignore' });
      }
      const plan = buildRenderPlan({
        clips: [
          { path: 'a.mp4', durationSec: 4, hasAudio: true, trimStartSec: 0.5, trimEndSec: 3.5, speed: 2, volume: 0.6 },
          { path: 'b.mp4', durationSec: 2, hasAudio: false, speed: 0.5 },
        ],
        width: 320, height: 240, transition: 'fade', transitionSec: 0.5, outputPath: 'out.mp4',
      });
      expect(plan.durationSec).toBe(5);
      execFileSync('ffmpeg', ['-loglevel', 'error', ...plan.args], { cwd: dir, stdio: 'pipe' });
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', join(dir, 'out.mp4')], { encoding: 'utf8' })) as {
        format: { duration: string };
      };
      expect(Math.abs(Number(probe.format.duration) - plan.durationSec)).toBeLessThan(0.25);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it.skipIf(!hasBinary('ffmpeg') || !hasBinary('ffprobe'))('renders real clips with ducked music shorter than the film', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drama-music-'));
    try {
      for (const [name, seconds, audio] of [['a.mp4', 2, true], ['b.mp4', 3, false]] as const) {
        execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
          '-f', 'lavfi', '-i', `color=c=gray:s=320x240:d=${seconds}:r=25`,
          ...(audio ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`] : []),
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(audio ? ['-c:a', 'aac', '-shortest'] : []),
          join(dir, name)], { stdio: 'ignore' });
      }
      // Two seconds of music for a five-second film, so it has to loop.
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2',
        '-c:a', 'libmp3lame', join(dir, 'bgm.mp3')], { stdio: 'ignore' });
      const plan = buildRenderPlan({
        clips: [{ path: 'a.mp4', durationSec: 2, hasAudio: true }, { path: 'b.mp4', durationSec: 3, hasAudio: false }],
        width: 320, height: 240, transition: 'fade', transitionSec: 0.5,
        music: { path: 'bgm.mp3', volume: 0.5, ducking: true }, outputPath: 'out.mp4',
      });
      execFileSync('ffmpeg', ['-loglevel', 'error', ...plan.args], { cwd: dir, stdio: 'pipe' });
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
        'stream=codec_type,duration:format=duration', '-of', 'json', join(dir, 'out.mp4')], { encoding: 'utf8' })) as {
        streams: Array<{ codec_type: string; duration?: string }>; format: { duration: string };
      };
      expect(probe.streams.map(stream => stream.codec_type).sort()).toEqual(['audio', 'video']);
      const audio = probe.streams.find(stream => stream.codec_type === 'audio');
      expect(Math.abs(Number(audio?.duration) - plan.durationSec)).toBeLessThan(0.25);
      expect(Math.abs(Number(probe.format.duration) - plan.durationSec)).toBeLessThan(0.25);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
