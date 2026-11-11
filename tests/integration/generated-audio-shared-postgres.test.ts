import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { NextRequest, NextResponse } from 'next/server';
import { expect, it, vi } from 'vitest';
import { closePool } from '@/lib/db-client';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';

const runtime = vi.hoisted(() => ({ root: '' }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => runtime.root }));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async (request: Request) => {
    const id = request.headers.get('x-synthetic-user');
    return id ? { userId: id, source: 'cookie', user: { id, role: 'user', status: 'active', apiPermissions: { audio: true } } }
      : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  },
}));
vi.mock('@/lib/server-api-config', () => ({
  getApiProviders: async () => [{
    id: 'fixture-tts', name: '测试语音供应商', type: 'audio', isEnabled: true,
    baseUrl: 'https://tts.example.invalid', apiKey: 'synthetic-key', selectedModels: ['fixture-tts-model'],
  }],
}));
vi.mock('@/lib/server-auth', () => ({
  listManagedUsers: async (): Promise<never> => { throw new Error('Unexpected internal actor lookup'); },
}));

const run = promisify(execFile);
const actor = 'test-audio-owner';

function request(url: string, owner?: string, body?: object, range?: string) {
  const headers = new Headers();
  if (owner) headers.set('x-synthetic-user', owner);
  if (range) headers.set('Range', range);
  return new NextRequest('http://localhost' + url, {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
  });
}

it('serves and composes owner-bound generated audio after reopening with an empty data root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wujie-shared-tts-'));
  try {
    await withIsolatedPostgres('shared_tts', async ({ query }) => {
      const migration = await readFile('migrations/20261111_wj_generated_audio_storage.sql', 'utf8');
      await query(migration);
      vi.stubEnv('WUJIE_DEPLOYMENT_DB_ONLY', '1');

      const producerRoot = path.join(root, 'producer');
      const receiverRoot = path.join(root, 'receiver');
      await mkdir(producerRoot);
      await mkdir(path.join(receiverRoot, 'generated-videos'), { recursive: true });
      const source = path.join(receiverRoot, 'generated-videos', 'source.mp4');
      const voice = path.join(root, 'voice.wav');
      await Promise.all([
        run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=10:d=1',
          '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { timeout: 15000, windowsHide: true }),
        run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000:duration=0.8',
          '-ac', '1', '-c:a', 'pcm_s16le', voice], { timeout: 15000, windowsHide: true }),
      ]);
      const audio = await readFile(voice);
      const upstream = vi.fn(async (url: string) => {
        if (url !== 'https://tts.example.invalid/v1/audio/speech') throw new Error('Unexpected fixture endpoint');
        return new Response(new Uint8Array(audio), { headers: { 'Content-Type': 'audio/wav' } });
      });
      vi.stubGlobal('fetch', upstream);
      runtime.root = producerRoot;
      const { POST: generate } = await import('@/app/api/audio/generate/route');
      const generated = await generate(request('/api/audio/generate', actor, { text: '合成语音', format: 'wav' }));
      expect(generated.status).toBe(200);
      const { filename, audioUrl } = await generated.json() as { filename: string; audioUrl: string };
      expect(filename).toMatch(/^ttsdb_/u);
      expect(await readdir(producerRoot)).toEqual([]);
      expect((await query('SELECT owner_id, octet_length(audio_bytes) AS size FROM wujie_generated_audio')).rows)
        .toEqual([{ owner_id: actor, size: audio.length }]);

      await closePool();
      vi.resetModules();
      runtime.root = receiverRoot;
      const { GET: serve } = await import('@/app/api/serve-upload/[...path]/route');
      const params = { params: Promise.resolve({ path: ['generated-audio', filename] }) };
      expect((await serve(request(audioUrl), params)).status).toBe(401);
      expect((await serve(request(audioUrl, 'other-test-user'), params)).status).toBe(404);
      const played = await serve(request(audioUrl, actor, undefined, 'bytes=0-31'), params);
      expect(played.status).toBe(206);
      expect(played.headers.get('cache-control')).toBe('private, no-store');
      expect(Buffer.from(await played.arrayBuffer())).toEqual(audio.subarray(0, 32));

      const { POST: compose } = await import('@/app/api/video/tools/route');
      const composition = {
        action: 'add-audio', videoUrl: '/api/serve-upload/generated-videos/source.mp4', audioUrl, volume: 0.5,
      };
      expect((await compose(request('/api/video/tools', 'other-test-user', composition))).ok).toBe(false);
      const composed = await compose(request('/api/video/tools', actor, composition));
      expect(composed.status).toBe(200);
      const { videoUrl } = await composed.json() as { videoUrl: string };
      const output = path.join(receiverRoot, videoUrl.slice('/api/serve-upload/'.length));
      const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', output], {
        timeout: 15000, windowsHide: true,
      });
      expect(JSON.parse(probe.stdout).streams).toEqual([{ codec_type: 'video' }, { codec_type: 'audio' }]);
      expect(upstream).toHaveBeenCalledOnce();
    });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
