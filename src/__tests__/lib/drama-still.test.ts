import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { autopilotPlan } from '@/lib/drama/autopilot';
import { buildRenderPlan, buildStillClipArgs, stillFrameSize, STILL_MOTIONS } from '@/lib/drama/render';
import { parseDramaProject } from '@/lib/drama/schema';
import { buildTimeline, collectEpisodeTimeline } from '@/lib/drama/timeline';
import { createEmptyDramaProject, shotSource, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';
import { pendingShots } from '@/lib/drama/workbench-state';

function hasBinary(name: string): boolean {
  try { execFileSync(name, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function shot(id: string, patch: Partial<DramaShot> = {}): DramaShot {
  return {
    id, index: 0, title: '', purpose: '', actionBeat: '', prompt: `画面${id}`, duration: 4, durationSec: 4,
    aspectRatio: '9:16', references: [], continuityNotes: [], status: 'planned', takes: [], ...patch,
  };
}

const video = { takes: [{ id: 't', status: 'completed' as const, videoUrl: '/v/a.mp4', thumbnailUrl: '/v/a.jpg', createdAt: 1 }], selectedTakeId: 't' };

function doc(shots: DramaShot[]): DramaProjectV1 {
  return {
    ...createEmptyDramaProject({ title: '招财猫' }),
    episodes: [{ id: 'e', index: 0, title: '', logline: '', script: '', scenes: [{ id: 'sc', heading: '', summary: '', shots }] }],
  };
}

describe('drama still shots', () => {
  it('uses the first frame only when the user turned the still on, and keeps the video otherwise', () => {
    expect(shotSource(shot('a', video))?.kind).toBe('video');
    expect(shotSource(shot('a', { ...video, firstFrameUrl: '/f.png', still: { motion: 'pan-left' } })))
      .toEqual({ kind: 'still', imageUrl: '/f.png', motion: 'pan-left' });
    // A still flag without a first frame falls back to the video, or to nothing.
    expect(shotSource(shot('a', { ...video, still: { motion: 'push-in' } }))?.kind).toBe('video');
    expect(shotSource(shot('a', { still: { motion: 'push-in' } }))).toBeUndefined();
  });

  it('counts a still as ready for the film, the one-click plan and the render timeline', () => {
    const d = doc([
      shot('a', video),
      shot('b', { firstFrameUrl: '/f.png', still: { motion: 'push-in' }, clipEdit: { speed: 2 } }),
      shot('c', { firstFrameUrl: '/g.png' }),
    ]);
    expect(pendingShots(d.episodes[0]).map(s => s.id)).toEqual(['c']);
    expect(autopilotPlan(d, 'e').shots).toEqual(['c']);
    const timeline = collectEpisodeTimeline(d, 'e');
    expect(timeline.missingShotIds).toEqual(['c']);
    expect(timeline.clips[1]).toEqual({ shotId: 'b', still: { url: '/f.png', motion: 'push-in', durationSec: 4 } });
    // A still keeps its planned length: speed and trim belong to video takes.
    const blocks = buildTimeline(d, 'e');
    expect(blocks[1]).toMatchObject({ hasTake: true, still: true, durationSec: 4, thumbnailUrl: '/f.png' });
    expect(blocks[2]).toMatchObject({ hasTake: false });
  });

  it('saves the still choice and rejects unknown moves', () => {
    const d = doc([shot('a', { firstFrameUrl: '/f.png', still: { motion: 'pull-out' } })]);
    expect(parseDramaProject(d).episodes[0].scenes[0].shots[0].still).toEqual({ motion: 'pull-out' });
    const bad = doc([shot('a', { firstFrameUrl: '/f.png', still: { motion: 'spin' as never } })]);
    expect(() => parseDramaProject(bad)).toThrow('DRAMA_DOC_INVALID');
  });

  it('builds one camera move per motion at the frame size and length asked for', () => {
    for (const motion of STILL_MOTIONS) {
      const args = buildStillClipArgs({ imagePath: 'still-0', outputPath: 'clip-0.mp4', width: 721, height: 1280, durationSec: 2, motion });
      const vf = args[args.indexOf('-vf') + 1];
      expect(vf).toContain('scale=1444:2560:force_original_aspect_ratio=increase,crop=1444:2560');
      expect(vf).toContain(':d=60:s=722x1280:fps=30');
      expect(args.slice(args.indexOf('-frames:v'), args.indexOf('-frames:v') + 2)).toEqual(['-frames:v', '60']);
      expect(args).toContain('-an');
    }
    expect(() => buildStillClipArgs({ imagePath: 'a', outputPath: 'b', width: 10, height: 10, durationSec: 2, motion: 'spin' as never }))
      .toThrow('DRAMA_RENDER_BAD_MOTION');
    expect(stillFrameSize('16:9')).toEqual({ width: 1280, height: 720 });
    expect(stillFrameSize('odd')).toEqual({ width: 720, height: 1280 });
  });

  it.skipIf(!hasBinary('ffmpeg') || !hasBinary('ffprobe'))('renders a moving still next to a video clip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drama-still-'));
    try {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x480:d=1', '-frames:v', '1',
        '-f', 'image2', '-c:v', 'png', join(dir, 'still-1')], { stdio: 'ignore' });
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=320x568:d=2:r=25',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
        join(dir, 'clip-0.mp4')], { stdio: 'ignore' });
      execFileSync('ffmpeg', ['-loglevel', 'error', ...buildStillClipArgs({
        imagePath: 'still-1', outputPath: 'clip-1.mp4', width: 320, height: 568, durationSec: 1.5, motion: 'pan-right',
      })], { cwd: dir, stdio: 'pipe' });
      const still = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration',
        '-of', 'json', join(dir, 'clip-1.mp4')], { encoding: 'utf8' })) as { streams: Array<{ codec_type: string; width: number; height: number }>; format: { duration: string } };
      expect(still.streams.map(stream => stream.codec_type)).toEqual(['video']);
      expect(still.streams[0]).toMatchObject({ width: 320, height: 568 });
      expect(Math.abs(Number(still.format.duration) - 1.5)).toBeLessThan(0.1);

      const plan = buildRenderPlan({
        clips: [{ path: 'clip-0.mp4', durationSec: 2, hasAudio: true }, { path: 'clip-1.mp4', durationSec: 1.5, hasAudio: false }],
        width: 320, height: 568, transition: 'fade', transitionSec: 0.3, outputPath: 'out.mp4',
      });
      execFileSync('ffmpeg', ['-loglevel', 'error', ...plan.args], { cwd: dir, stdio: 'pipe' });
      const out = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json',
        join(dir, 'out.mp4')], { encoding: 'utf8' })) as { streams: Array<{ codec_type: string }>; format: { duration: string } };
      expect(out.streams.map(stream => stream.codec_type).sort()).toEqual(['audio', 'video']);
      expect(Math.abs(Number(out.format.duration) - plan.durationSec)).toBeLessThan(0.25);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
