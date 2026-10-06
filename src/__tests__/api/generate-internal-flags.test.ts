import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { User } from '@/lib/user-types';
import type { GenerationProjectAccess } from '@/lib/collaboration/generation-project-access';

const boundary = vi.hoisted(() => ({
  session: vi.fn(), desktop: vi.fn(), project: vi.fn(), provider: vi.fn(),
  providerForModel: vi.fn(), allProviders: vi.fn(), model: vi.fn(),
  calculate: vi.fn(), check: vi.fn(), consume: vi.fn(), charge: vi.fn(),
  submitted: vi.fn(), terminal: vi.fn(), register: vi.fn(), progress: vi.fn(),
  task: vi.fn(), taskByKey: vi.fn(), update: vi.fn(), refund: vi.fn(),
  persistImage: vi.fn(), append: vi.fn(), after: vi.fn(), fetch: vi.fn(),
  database: vi.fn(),
}));

vi.mock('server-only', () => ({}));
// Fail closed if an overlooked dependency tries to open a real database connection.
vi.mock('pg', () => ({ Pool: class {
  constructor() { boundary.database(); throw new Error('Database forbidden in offline source tests'); }
} }));
vi.mock('next/server', async original => ({
  ...await original<typeof import('next/server')>(), after: boundary.after,
}));
vi.mock('@/lib/server-auth', () => ({
  getSessionUser: boundary.session,
  getAuthSecretForInternalRequests: async (): Promise<string> => 'offline-internal-secret-at-least-32-characters',
}));
// Preserve the real header parser; only the token's external user lookup is replaced.
vi.mock('@/lib/desktop-cloud', async original => ({
  ...await original<typeof import('@/lib/desktop-cloud')>(), getDesktopAuth: boundary.desktop,
}));
vi.mock('@/lib/collaboration/generation-project-access', async original => ({
  ...await original<typeof import('@/lib/collaboration/generation-project-access')>(),
  authorizeGenerationProject: boundary.project,
}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: boundary.provider, findProviderForModel: boundary.providerForModel,
  findAllProvidersForType: boundary.allProviders,
  normalizeApiBaseUrl: (value: string): string => value.replace(/\/$/, ''),
}));
vi.mock('@/lib/task-core/model-catalog', () => ({ resolveTaskModelForUser: boundary.model }));
vi.mock('@/lib/credits', () => ({
  calculateConfiguredCreditCost: boundary.calculate, checkCredits: boundary.check, consumeCredits: boundary.consume,
}));
vi.mock('@/lib/cloud-task-persistence', () => ({
  recordImageTaskSubmitted: boundary.submitted, recordImageTaskTerminal: boundary.terminal,
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  chargeCloudTaskCredits: boundary.charge, getCloudTaskForUser: boundary.task,
  getCloudTaskForUserByIdempotencyKey: boundary.taskByKey,
  terminateCloudTaskAndRefund: boundary.refund, updateCloudTask: boundary.update,
}));
vi.mock('@/lib/task-registry', () => ({
  registerTask: boundary.register, updateTaskProgress: boundary.progress,
  getTaskInfo: boundary.task, isTaskCancelled: (): boolean => false,
}));
vi.mock('@/lib/s3-storage', () => ({ persistRemoteImage: boundary.persistImage }));
vi.mock('@/lib/server-user-storage', () => ({ appendUserJsonl: boundary.append }));
vi.mock('@/lib/op-log', async original => ({
  ...await original<typeof import('@/lib/op-log')>(), logOperation: vi.fn(), logError: vi.fn(),
}));

// Intentionally real: source resolution, secret verification, and the complete route.
import { getInternalRequestHeaders } from '@/lib/api-auth';
import { POST } from '@/app/api/generate/route';

type Caller = 'cookie-user' | 'cookie-admin' | 'desktop-token' | 'missing-secret-cookie'
  | 'wrong-secret-cookie' | 'forged-strict-cookie' | 'internal' | 'anonymous'
  | 'forged-internal-anonymous' | 'wrong-secret-anonymous';

const user: User = {
  id: 'user-1', name: 'Offline user', role: 'user', status: 'active',
  imageModels: ['offline-model'], createdAt: 1, updatedAt: 1,
};
const trueFlags = [
  { label: 'credits', flags: { _skipCredits: true } },
  { label: 'persistence', flags: { _skipCloudTaskPersistence: true } },
  { label: 'both', flags: { _skipCredits: true, _skipCloudTaskPersistence: true } },
];
const externalCallers: Caller[] = ['cookie-user', 'cookie-admin', 'desktop-token',
  'missing-secret-cookie', 'wrong-secret-cookie', 'forged-strict-cookie'];
const routes = [undefined, 'personal-project', 'document-project'].flatMap(projectId =>
  [false, true].flatMap(submitOnly => [false, true].map(wrapper => ({
    label: `${projectId ?? 'unscoped'}/submitOnly=${submitOnly}/wrapper=${wrapper}`,
    projectId, submitOnly, wrapper,
  }))),
);

async function request(caller: Caller, body: Record<string, unknown>): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (caller.includes('cookie')) headers.cookie = `offline-session=${caller === 'cookie-admin' ? 'admin' : 'user'}`;
  if (caller === 'desktop-token') headers.authorization = 'Bearer offline-desktop-token';
  if (caller.includes('secret') || caller === 'forged-internal-anonymous') {
    Object.assign(headers, { 'x-internal-request': 'true', 'x-internal-user-id': 'forged-user',
      'x-internal-user-role': 'admin' });
    if (caller.includes('wrong-secret')) headers['x-wujie-internal-secret'] = 'wrong-internal-secret-at-least-32-characters';
  }
  if (caller === 'forged-strict-cookie') headers['x-wujie-agent-strict-routing'] = 'true';
  if (caller === 'internal') Object.assign(headers, await getInternalRequestHeaders('user-1', 'admin'));
  return POST(new NextRequest('http://localhost/api/generate', {
    method: 'POST', headers,
    body: JSON.stringify({ prompt: 'A blue cup', model: 'offline-model', providerId: 'offline-provider', ...body }),
  }));
}

function expectNoDownstream(): void {
  for (const [name, spy] of Object.entries(boundary)) {
    if (name !== 'session' && name !== 'desktop') expect(spy, name).not.toHaveBeenCalled();
  }
}

beforeEach((): void => {
  vi.resetAllMocks();
  vi.stubEnv('INTERNAL_API_SECRET', 'offline-internal-secret-at-least-32-characters');
  vi.stubEnv('WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER', 'false');
  vi.stubEnv('WUJIE_ENABLE_IN_PROCESS_ASYNC_WORKER', 'false');
  vi.stubGlobal('fetch', boundary.fetch);
  boundary.fetch.mockImplementation((): never => { throw new Error('Unexpected network request'); });
  boundary.session.mockImplementation(async (req: Request): Promise<User | null> => {
    const cookie = req.headers.get('cookie');
    return cookie === 'offline-session=admin' ? { ...user, role: 'admin' }
      : cookie === 'offline-session=user' ? user : null;
  });
  boundary.desktop.mockImplementation(async (token: string): Promise<{ user: User; token: string } | null> =>
    token === 'offline-desktop-token' ? { user, token } : null);
  boundary.project.mockImplementation(async ({ actorUserId, projectId }: {
    actorUserId: string; projectId: unknown;
  }): Promise<GenerationProjectAccess> => {
    if (projectId === undefined) return { kind: 'unscoped', actorUserId };
    if (projectId === 'personal-project') return { kind: 'personal', actorUserId, ownerId: actorUserId, projectId };
    if (projectId === 'document-project') return { kind: 'document', actorUserId,
      ownerId: actorUserId, projectId, grantGeneration: '0' };
    throw new Error('Unexpected project fixture');
  });
  // A missing provider is an intentional, observable stop after the source gate.
  boundary.provider.mockResolvedValue(null);
});

afterEach((): void => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('generate internal flags through real API authentication', () => {
  // Removing the source check, trusting a client header, or moving it below project
  // authorization must break these response and zero-side-effect assertions.
  describe.each(routes)('$label', ({ projectId, submitOnly, wrapper }) => {
    it.each(externalCallers.flatMap(caller => trueFlags.map(entry => ({ caller, ...entry }))))(
      'forbids $caller with $label', async ({ caller, flags }): Promise<void> => {
        vi.stubEnv('WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER', String(wrapper));
        const response = await request(caller, { projectId, submitOnly, ...flags });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ success: false,
          code: 'GENERATION_INTERNAL_FLAGS_FORBIDDEN', error: '当前请求不能使用内部执行标记', retryable: false });
        expectNoDownstream();
      },
    );

    it.each(['cookie-user', 'cookie-admin', 'desktop-token', 'internal'] as const)(
      'allows omitted/false flags from %s to reach the original provider check', async (caller): Promise<void> => {
        vi.stubEnv('WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER', String(wrapper));
        for (const flags of [{}, { _skipCredits: false }, { _skipCloudTaskPersistence: false },
          { _skipCredits: false, _skipCloudTaskPersistence: false }]) {
          const response = await request(caller, { projectId, submitOnly, ...flags });
          expect(response.status).toBe(400);
          expect(await response.json()).toMatchObject({ code: 'MODEL_PROVIDER_MISMATCH', retryable: false });
        }
        expect(boundary.project).toHaveBeenCalledTimes(4);
        expect(boundary.project).toHaveBeenCalledWith({ actorUserId: 'user-1', projectId });
        expect(boundary.provider).toHaveBeenCalledTimes(4);
        expect(boundary.fetch).not.toHaveBeenCalled();
      },
    );

    it.each(trueFlags)('allows authenticated internal $label to reach original flow', async ({ flags }): Promise<void> => {
      vi.stubEnv('WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER', String(wrapper));
      const response = await request('internal', { projectId, submitOnly, ...flags });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'MODEL_PROVIDER_MISMATCH' });
      expect(boundary.project).toHaveBeenCalledWith({ actorUserId: 'user-1', projectId });
      expect(boundary.provider).toHaveBeenCalledWith('offline-provider');
      expect(boundary.session).not.toHaveBeenCalled();
      expect(boundary.desktop).not.toHaveBeenCalled();
    });
  });

  describe.each(['cookie-user', 'cookie-admin', 'desktop-token', 'internal'] as const)('%s malformed types', caller => {
    it.each(['_skipCredits', '_skipCloudTaskPersistence'].flatMap(flag =>
      [null, 'true', 'false', 0, 1, [], {}].map(value => ({ flag, value }))))(
      'rejects $flag=$value before any downstream boundary', async ({ flag, value }): Promise<void> => {
        const response = await request(caller, { [flag]: value });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ success: false,
          code: 'GENERATION_INVALID_INTERNAL_FLAGS', error: '内部执行标记必须是布尔值', retryable: false });
        expectNoDownstream();
      },
    );
  });

  it.each([
    { _skipCredits: true, _skipCloudTaskPersistence: null },
    { _skipCredits: 'true', _skipCloudTaskPersistence: true },
  ])('validates types before rejecting an external true: %j', async flags => {
    const response = await request('cookie-user', flags);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'GENERATION_INVALID_INTERNAL_FLAGS', retryable: false });
    expectNoDownstream();
  });

  it.each(['anonymous', 'forged-internal-anonymous', 'wrong-secret-anonymous'] as const)(
    'preserves 401 precedence for %s with invalid or true flags', async (caller): Promise<void> => {
      for (const flags of [{ _skipCredits: true }, { _skipCloudTaskPersistence: true },
        { _skipCredits: null, _skipCloudTaskPersistence: true }]) {
        const response = await request(caller, flags);
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'Authentication required' });
      }
      expectNoDownstream();
    },
  );

  // Real internal auth must retain independent skip semantics in the route. The
  // provider and storage are offline; this is not evidence of real billing/recovery.
  it.each([
    { credits: false, persistence: false, debits: 1, creates: 1 },
    { credits: true, persistence: false, debits: 0, creates: 1 },
    { credits: false, persistence: true, debits: 1, creates: 0 },
    { credits: true, persistence: true, debits: 0, creates: 0 },
  ])('keeps internal skip combination credits=$credits persistence=$persistence', async ({
    credits, persistence, debits, creates,
  }): Promise<void> => {
    const provider = { id: 'offline-provider', name: 'Offline', displayName: 'Offline',
      type: 'image', modelType: 'image', apiKey: 'offline-key', baseUrl: 'https://provider.invalid',
      selectedModels: ['offline-model'], isEnabled: true, createdAt: 1, updatedAt: 1 };
    boundary.provider.mockResolvedValue(provider);
    boundary.providerForModel.mockResolvedValue(provider);
    boundary.allProviders.mockResolvedValue([{ provider, models: ['offline-model'] }]);
    boundary.model.mockResolvedValue({ providerId: 'offline-provider', modelId: 'offline-model',
      kind: 'image', sourceType: 'image', protocol: 'openai', executionMode: 'async',
      allowedRatios: ['1:1'], allowedSizes: [], qualityOptions: [], maxOutputs: 1,
      supportsReferenceImages: false, supportsMask: false, supportedOperations: ['text-to-image'],
      outputKinds: ['png'], capabilitySources: {} });
    boundary.consume.mockResolvedValue({ success: true, cost: 7 });
    boundary.submitted.mockResolvedValue(true);
    boundary.fetch.mockResolvedValue(new Response(JSON.stringify({ task_id: 'offline-provider-task' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const response = await request('internal', { _skipCredits: credits, _skipCloudTaskPersistence: persistence });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, taskIds: ['offline-provider-task'] });
    expect(boundary.fetch).toHaveBeenCalledTimes(1);
    expect(boundary.consume).toHaveBeenCalledTimes(debits);
    expect(boundary.submitted).toHaveBeenCalledTimes(creates);
    if (creates) expect(boundary.submitted).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'offline-provider-task', userId: 'user-1', creditCost: credits ? 0 : 7,
    }));
    expect(boundary.database).not.toHaveBeenCalled();
  });
});
