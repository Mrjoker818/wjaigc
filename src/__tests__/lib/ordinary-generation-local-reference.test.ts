import { link, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { PROFILE_OPENAI } from '@/lib/api-compatibility';

const fixture = vi.hoisted(() => ({ root: '' }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-data-root', () => ({
  getServerDataRoot: () => path.join(fixture.root, 'data'),
  getServerSystemDir: () => path.join(fixture.root || process.cwd(), 'data', 'system'),
  getServerUsersDir: () => path.join(fixture.root || process.cwd(), 'data', 'users'),
}));

import { createOrdinaryProvider, type OrdinaryProviderOptions } from '@/lib/task-core/ordinary-generation-provider';
import type { ModelConfig } from '@/lib/task-core/ordinary-generation-request';

const model: ModelConfig = { name: 'Offline', modelId: 'dall-e-2', paramType: 'none', supportedSizes: [], qualityOptions: [],
  resolutionOptions: [], supportsImageToImage: true, maxN: 1, estimatedTime: 30 };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const PRIVATE = Buffer.from('private-reference-must-not-leave-server');

async function submitReference(reference: string, sent: string[], recover?: (url: string) => Response): Promise<void> {
  const transport: typeof fetch = async (input, options): Promise<Response> => {
    const url = String(input);
    if (url === 'https://remote.invalid/api/serve-upload/safe.png') {
      return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    }
    if (url.includes('localhost:5000/api/serve-upload/')) {
      if (recover) return recover(url);
      throw new Error(`Undeclared IO: ${url}`);
    }
    if (!url.startsWith('https://offline.invalid/')) throw new Error(`Undeclared IO: ${url}`);
    expect(options?.method).toBe('POST');
    sent.push(String(options?.body));
    return Response.json({ data: [{ url: 'https://offline.invalid/result.png' }] });
  };
  const options: OrdinaryProviderOptions = {
    requestedSize: '1:1', enhancedPrompt: 'blue cup', agentProviderIdempotencyKey: 'offline-reference',
    accessibleReferenceImages: [reference], aspectRatio: '1:1', strictAgentRouting: false,
    isPrivateIp: (): boolean => false, downloadAndSaveImage: async (): Promise<null> => null,
    controlled: true, transport, profile: PROFILE_OPENAI, responsesApiEnabled: false,
    providerFetch: (base, endpoint, init, retry, timeout) => fetchWithV1Retry(base, endpoint,
      { ...init, transport, propagateErrors: true }, retry, timeout),
  };
  const submit = createOrdinaryProvider(options);
  await submit(model, 'test-only', 'https://offline.invalid/v1', 'provider', 1);
}

describe('ordinary generation local reference ownership', () => {
  const original = { workspace: process.env.COZE_WORKSPACE_PATH, domain: process.env.COZE_PROJECT_DOMAIN_DEFAULT };

  beforeEach(async () => {
    fixture.root = await mkdtemp(path.join(tmpdir(), 'wujie-ordinary-ref-'));
    await mkdir(path.join(fixture.root, 'data', 'uploads'), { recursive: true });
    await mkdir(path.join(fixture.root, 'public', 'uploads'), { recursive: true });
    process.env.COZE_WORKSPACE_PATH = fixture.root;
    process.env.COZE_PROJECT_DOMAIN_DEFAULT = 'https://preview.invalid';
    vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Undeclared IO'); });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (original.workspace === undefined) delete process.env.COZE_WORKSPACE_PATH;
    else process.env.COZE_WORKSPACE_PATH = original.workspace;
    if (original.domain === undefined) delete process.env.COZE_PROJECT_DOMAIN_DEFAULT;
    else process.env.COZE_PROJECT_DOMAIN_DEFAULT = original.domain;
    const resolved = path.resolve(fixture.root);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('wujie-ordinary-ref-')) {
      throw new Error('Refusing to remove an unexpected fixture directory');
    }
    await rm(resolved, { recursive: true, force: true });
  });

  it('rejects a managed URL that traverses from uploads to a private file before provider submission', async () => {
    await writeFile(path.join(fixture.root, 'data', 'private.png'), PRIVATE);
    const sent: string[] = [];

    await expect(submitReference('https://preview.invalid/api/serve-upload/../private.png', sent))
      .rejects.toThrow(/local media path|reference image/i);

    expect(sent).toEqual([]);
  });

  it('rejects a hard-linked managed upload that aliases a private file', async () => {
    const privateFile = path.join(fixture.root, 'data', 'private.png');
    await writeFile(privateFile, PRIVATE);
    await link(privateFile, path.join(fixture.root, 'data', 'uploads', 'linked.png'));
    const sent: string[] = [];

    await expect(submitReference('/api/serve-upload/linked.png', sent))
      .rejects.toThrow(/local media path|reference image/i);

    expect(sent).toEqual([]);
  });

  it('uses actual bytes of valid managed and legacy public uploads', async () => {
    await writeFile(path.join(fixture.root, 'data', 'uploads', 'safe.png'), PNG);
    await writeFile(path.join(fixture.root, 'public', 'uploads', 'old.png'), PNG);
    const sent: string[] = [];

    await submitReference('https://preview.invalid/api/serve-upload/safe.png?version=1', sent);
    await submitReference('/uploads/old.png', sent);

    expect(sent).toHaveLength(2);
    for (const body of sent) expect(body).toContain(PNG.toString('base64'));
  });

  it('does not reinterpret another domain as a local managed upload', async () => {
    await writeFile(path.join(fixture.root, 'data', 'uploads', 'safe.png'), PRIVATE);
    const sent: string[] = [];

    await submitReference('https://remote.invalid/api/serve-upload/safe.png', sent);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(PNG.toString('base64'));
    expect(sent[0]).not.toContain(PRIVATE.toString('base64'));
  });

  it('recovers a missing managed upload over the local HTTP service in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const recoveredUrls: string[] = [];
    const sent: string[] = [];

    await submitReference('/api/serve-upload/missing.png?version=1', sent, url => {
      recoveredUrls.push(url);
      if (url === 'http://localhost:5000/api/serve-upload/missing.png?version=1') {
        return new Response(PNG, { headers: { 'content-type': 'image/png' } });
      }
      throw new Error(`Undeclared IO: ${url}`);
    });

    expect(recoveredUrls).toEqual(['http://localhost:5000/api/serve-upload/missing.png?version=1']);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(PNG.toString('base64'));
  });
});
