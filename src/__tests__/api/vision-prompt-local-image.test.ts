import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getApiProviders, getSessionUser, fetchWithV1Retry, getServerDataRoot,
  isS3Available, downloadImageFromS3 } = vi.hoisted(() => ({
  getApiProviders: vi.fn(),
  getSessionUser: vi.fn(),
  fetchWithV1Retry: vi.fn(),
  getServerDataRoot: vi.fn(),
  isS3Available: vi.fn(),
  downloadImageFromS3: vi.fn(),
}));

vi.mock('@/lib/server-api-config', () => ({
  getApiProviders,
  findProviderForModel: vi.fn(),
  normalizeApiBaseUrl: (url: string): string => url,
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser }));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry }));
// These tests exercise real local file/S3 fallback paths, not account billing.
// Real authenticated charges and refunds are covered by the PostgreSQL suite.
vi.mock('@/lib/credits', () => ({
  consumeCredits: async (): Promise<{ success: boolean; balance: number; cost: number }> =>
    ({ success: true, balance: 0, cost: 0 }),
  refundCredits: async (): Promise<{ success: boolean; balance: number }> =>
    ({ success: true, balance: 0 }),
}));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot }));
vi.mock('@/lib/s3-storage', () => ({ isS3Available, downloadImageFromS3 }));
vi.mock('@/lib/image-source-map', () => ({ getImageSourceUrl: async (): Promise<null> => null }));

import { POST } from '@/app/api/vision-prompt/route';
import { readVisionPromptLocalImage } from '@/lib/vision-prompt-local-reader';

const temporaryRoots: string[] = [];

beforeEach(() => {
  getSessionUser.mockResolvedValue({ id: 'vision-local-admin', role: 'admin' });
  getApiProviders.mockResolvedValue([{
    id: 'vision-provider', name: 'Vision Provider', type: 'chat', modelType: 'chat',
    isEnabled: true, apiKey: 'test-key', baseUrl: 'https://example.invalid/v1',
    selectedModels: ['vision-model'], providerPreset: 'openai',
  }]);
  fetchWithV1Retry.mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { content: '{"ok":true}' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
  isS3Available.mockReturnValue(false);
  downloadImageFromS3.mockResolvedValue(null);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('local fallback disabled')));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('wujie-vision-local-')) {
      throw new Error('Unexpected temporary test directory');
    }
    await rm(root, { recursive: true, force: true });
  }
});

async function makeWorkspace(): Promise<{ root: string; dataRoot: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'wujie-vision-local-'));
  temporaryRoots.push(root);
  const dataRoot = path.join(root, 'data');
  await mkdir(path.join(root, 'public', 'uploads'), { recursive: true });
  await mkdir(dataRoot);
  vi.stubEnv('COZE_WORKSPACE_PATH', root);
  getServerDataRoot.mockReturnValue(dataRoot);
  return { root, dataRoot };
}

async function analyze(imageUrl: string): Promise<Response> {
  return POST(new NextRequest('http://localhost/api/vision-prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageUrl, model: 'vision-model', providerId: 'vision-provider' }),
  }));
}

describe('vision prompt local image boundary', () => {
  it.each([
    'system/providers.json', 'users/account.json', 'users/private.png',
    'SYSTEM/private.PNG', 'settings.json', 'settings',
  ])('rejects non-public %s before any external fallback or provider access', async (relativePath) => {
    const { dataRoot } = await makeWorkspace();
    const marker = 'private-fixture-not-real-credentials';
    const filename = path.join(dataRoot, ...relativePath.split('/'));
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, marker);
    // If local access falls through, S3 must not make this forbidden path usable.
    isS3Available.mockReturnValue(true);
    downloadImageFromS3.mockResolvedValue(Buffer.from(marker));

    const response = await analyze(`/api/serve-upload/${relativePath}`);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(marker);
    expect(getApiProviders).not.toHaveBeenCalled();
    expect(fetchWithV1Retry).not.toHaveBeenCalled();
    expect(downloadImageFromS3).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['users/private.png', 'settings.json'])('also denies %s through the exported local reader', async (relativePath) => {
    const { root, dataRoot } = await makeWorkspace();
    const filename = path.join(dataRoot, ...relativePath.split('/'));
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, 'private-fixture-not-real-credentials');
    await expect(readVisionPromptLocalImage(dataRoot, root, relativePath)).rejects.toThrow('Unsafe local media path');
  });

  it('sends a real public upload to the selected vision model', async () => {
    const { root } = await makeWorkspace();
    await writeFile(path.join(root, 'public', 'uploads', 'reference.png'), Buffer.from([1, 2, 3]));

    const response = await analyze('/api/serve-upload/uploads/reference.png');
    expect(response.status).toBe(200);
    expect(fetchWithV1Retry).toHaveBeenCalledOnce();
    const options = fetchWithV1Retry.mock.calls[0][2] as RequestInit;
    expect(options.body).toContain('data:image/png;base64,AQID');
  });

  it('preserves a real image in the persistent data directory', async () => {
    const { dataRoot } = await makeWorkspace();
    await mkdir(path.join(dataRoot, 'generate'));
    await writeFile(path.join(dataRoot, 'generate', 'reference.webp'), Buffer.from([4, 5, 6]));

    const response = await analyze('/api/serve-upload/generate/reference.webp');
    expect(response.status).toBe(200);
    expect(fetchWithV1Retry).toHaveBeenCalledOnce();
    const options = fetchWithV1Retry.mock.calls[0][2] as RequestInit;
    expect(options.body).toContain('data:image/webp;base64,BAUG');
  });

  it('preserves a direct public image outside uploads', async () => {
    const { root } = await makeWorkspace();
    await mkdir(path.join(root, 'public', 'generate'));
    await writeFile(path.join(root, 'public', 'generate', 'reference.png'), Buffer.from([7, 8]));

    const response = await analyze('/api/serve-upload/generate/reference.png');
    expect(response.status).toBe(200);
    const options = fetchWithV1Retry.mock.calls[0][2] as RequestInit;
    expect(options.body).toContain('data:image/png;base64,Bwg=');
  });

  it('falls back to the existing S3 key search when no local file exists', async () => {
    await makeWorkspace();
    isS3Available.mockReturnValue(true);
    downloadImageFromS3.mockImplementation(async (key: string) =>
      key === 'images/missing.png' ? Buffer.from([10, 11]) : null);

    const response = await analyze('/api/serve-upload/missing.png');
    expect(response.status).toBe(200);
    expect(downloadImageFromS3).toHaveBeenCalledWith('images/missing.png');
    const options = fetchWithV1Retry.mock.calls[0][2] as RequestInit;
    expect(options.body).toContain('data:image/png;base64,Cgs=');
  });

  it('never sends a sibling file reached through a parent segment to the vision model', async () => {
    const { root } = await makeWorkspace();
    await writeFile(path.join(root, 'secret.png'), Buffer.from([9, 9, 9]));

    const response = await analyze('/api/serve-upload/../secret.png');
    expect(response.status).not.toBe(200);
    expect(fetchWithV1Retry).not.toHaveBeenCalled();
  });
});
