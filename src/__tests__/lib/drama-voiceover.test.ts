import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildRenderPlan, type RenderClip } from '@/lib/drama/render';
import { collectEpisodeTimeline } from '@/lib/drama/timeline';
import { createEmptyDramaProject, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';
import { currentVoiceover, shotSpeaker, shotsNeedingVoiceover, shotVoice } from '@/lib/drama/voiceover';
import { generateVoiceover } from '@/lib/drama/workbench-client';

function hasBinary(name: string): boolean {
  try { execFileSync(name, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

const clips: RenderClip[] = [
  { path: 'a.mp4', durationSec: 2, hasAudio: true },
  { path: 'b.mp4', durationSec: 3, hasAudio: false },
];

function shot(patch: Partial<DramaShot>): DramaShot {
  return {
    id: 's', index: 0, title: '', purpose: '', actionBeat: '', prompt: '', duration: 5, durationSec: 5,
    aspectRatio: '9:16', references: [], continuityNotes: [], status: 'planned', takes: [], ...patch,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('drama voiceover', () => {
  it('picks the chosen speaker, else the first character, and their voice', () => {
    const cast = [{ id: 'a', name: '甲', appearance: '', voice: 'onyx' }, { id: 'b', name: '乙', appearance: '' }];
    expect(shotSpeaker(shot({ characterIds: ['a', 'b'] }), cast)?.id).toBe('a');
    expect(shotVoice(shot({ characterIds: ['a'], speakerId: 'b' }), cast)).toBe('alloy');
    expect(shotVoice(shot({ characterIds: ['a'] }), cast)).toBe('onyx');
    expect(shotVoice(shot({}), [])).toBe('alloy');
  });

  it('treats a recording of an older line as stale', () => {
    const fresh = shot({ id: 'f', dialogue: ' 你好 ', voiceoverUrl: '/api/serve-upload/generated-audio/x.mp3', voiceoverText: '你好' });
    const stale = shot({ id: 'o', dialogue: '再见', voiceoverUrl: '/api/serve-upload/generated-audio/y.mp3', voiceoverText: '你好' });
    const silent = shot({ id: 'n' });
    expect(currentVoiceover(fresh)).toBe(fresh.voiceoverUrl);
    expect(currentVoiceover(stale)).toBeUndefined();
    expect(shotsNeedingVoiceover([fresh, stale, silent, shot({ id: 'l', dialogue: '新台词' })]).map(item => item.id)).toEqual(['o', 'l']);

    const doc: DramaProjectV1 = createEmptyDramaProject({ title: 't' });
    doc.episodes = [{ id: 'e', index: 0, title: '', logline: '', script: '', scenes: [{ id: 'sc', heading: '', summary: '', shots: [
      { ...fresh, takes: [{ id: 't1', status: 'completed', videoUrl: '/v/1.mp4', createdAt: 1 }] },
      { ...stale, takes: [{ id: 't2', status: 'completed', videoUrl: '/v/2.mp4', createdAt: 1 }] },
    ] }] }];
    expect(collectEpisodeTimeline(doc, 'e').clips).toEqual([
      { shotId: 'f', videoUrl: '/v/1.mp4', dialogue: '你好', voiceoverUrl: fresh.voiceoverUrl },
      { shotId: 'o', videoUrl: '/v/2.mp4', dialogue: '再见' },
    ]);
  });

  it('mixes each voiceover at its clip start and turns the clip sound down under it', () => {
    const plan = buildRenderPlan({
      clips, width: 640, height: 360, transition: 'fade', transitionSec: 0.5,
      voiceovers: [{ clipIndex: 1, path: 'voice-1.mp3' }], outputPath: 'o.mp4',
    });
    expect(plan.args).toContain('voice-1.mp3');
    const filter = plan.args[plan.args.indexOf('-filter_complex') + 1];
    // Clip 1 starts at 1.5s and its visible part begins after the 0.5s fade.
    expect(filter).toContain('[3:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:2.5,asetpts=PTS-STARTPTS,adelay=2000:all=1[vo0]');
    expect(filter).toContain('[ax1][vo0]amix=inputs=2:duration=first:normalize=0[amix]');
    expect(filter).toMatch(/asetpts=PTS-STARTPTS,volume=0\.35\[a1\]/);
    expect(filter).not.toMatch(/volume=0\.35\[a0\]/);
    expect(plan.args[plan.args.indexOf('-map', plan.args.indexOf('-map') + 1) + 1]).toBe('[amix]');
  });

  it('rejects voiceovers for missing or repeated clips', () => {
    const base = { clips, width: 640, height: 360, outputPath: 'o.mp4' };
    expect(() => buildRenderPlan({ ...base, voiceovers: [{ clipIndex: 2, path: 'v.mp3' }] })).toThrow('DRAMA_RENDER_BAD_VOICEOVER');
    expect(() => buildRenderPlan({ ...base, voiceovers: [{ clipIndex: 0, path: 'v.mp3' }, { clipIndex: 0, path: 'w.mp3' }] }))
      .toThrow('DRAMA_RENDER_BAD_VOICEOVER');
  });

  it('records a line through /api/audio/generate and explains a missing permission', async () => {
    const fetcher = vi.fn(async () => json({ success: true, audioUrl: '/api/serve-upload/generated-audio/tts.mp3' }));
    await expect(generateVoiceover('你好', 'nova', fetcher)).resolves.toBe('/api/serve-upload/generated-audio/tts.mp3');
    expect(fetcher).toHaveBeenCalledWith('/api/audio/generate', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ text: '你好', voice: 'nova', format: 'mp3' }),
    }));
    await expect(generateVoiceover('你好', 'nova', async () => json({ success: false, error: '当前账号未获得语音生成权限。' }, 403)))
      .rejects.toThrow('当前账号未获得语音生成权限。');
    await expect(generateVoiceover('你好', 'nova', async () => json({}, 403))).rejects.toThrow('还没有开通语音生成');
  });

  it.skipIf(!hasBinary('ffmpeg') || !hasBinary('ffprobe'))('renders a clip with a voiceover mixed in', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drama-voice-'));
    try {
      const run = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: dir, stdio: 'pipe' });
      run(['-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=2:r=25', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'a.mp4']);
      run(['-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=3:r=25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'b.mp4']);
      // Longer than the clip: the mix must still end with the video.
      run(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=6', '-c:a', 'libmp3lame', 'voice-1.mp3']);
      const plan = buildRenderPlan({
        clips, width: 320, height: 240, transition: 'fade', transitionSec: 0.5,
        voiceovers: [{ clipIndex: 1, path: 'voice-1.mp3' }], outputPath: 'out.mp4',
      });
      run(plan.args.slice(2));
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration',
        '-of', 'json', join(dir, 'out.mp4')], { encoding: 'utf8' })) as { streams: Array<{ codec_type: string }>; format: { duration: string } };
      expect(probe.streams.map(stream => stream.codec_type).sort()).toEqual(['audio', 'video']);
      expect(Math.abs(Number(probe.format.duration) - plan.durationSec)).toBeLessThan(0.25);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
