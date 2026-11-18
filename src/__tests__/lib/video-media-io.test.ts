import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const dataRoot = mkdtempSync(path.join(tmpdir(), 'wujie-media-io-'));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => dataRoot }));

import { platformBaseUrl, readLocalVideoBuffer } from '@/lib/video-media-io';

afterEach(() => vi.unstubAllEnvs());
afterAll(() => rmSync(dataRoot, { recursive: true, force: true }));

describe('readLocalVideoBuffer', () => {
  it('finds generated videos stored under uploads/, as /api/serve-upload does', async () => {
    mkdirSync(path.join(dataRoot, 'uploads', 'video', 'task1'), { recursive: true });
    writeFileSync(path.join(dataRoot, 'uploads', 'video', 'task1', 'clip.mp4'), 'uploaded');
    mkdirSync(path.join(dataRoot, 'generated-videos'), { recursive: true });
    writeFileSync(path.join(dataRoot, 'generated-videos', 'film.mp4'), 'rendered');

    expect((await readLocalVideoBuffer('/api/serve-upload/video/task1/clip.mp4'))?.toString()).toBe('uploaded');
    expect((await readLocalVideoBuffer('/api/serve-upload/generated-videos/film.mp4'))?.toString()).toBe('rendered');
    expect(await readLocalVideoBuffer('/api/serve-upload/../outside.mp4')).toBeNull();
  });
});

describe('platformBaseUrl', () => {
  it('keeps a protocol the project domain already has', () => {
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'http://127.0.0.1:15179/');
    expect(platformBaseUrl()).toBe('http://127.0.0.1:15179');
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'app.example.com');
    expect(platformBaseUrl()).toBe('https://app.example.com');
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
    vi.stubEnv('DEPLOY_RUN_PORT', '15179');
    expect(platformBaseUrl()).toBe('http://localhost:15179');
  });
});
