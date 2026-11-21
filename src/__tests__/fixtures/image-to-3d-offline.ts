import { NextRequest } from 'next/server';
import { vi } from 'vitest';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';

// Keep auth/config, billing, persistence and all outbound traffic synthetic.
// The POST handler, selection parser, validator, admission and adapters stay real.
const doubles = vi.hoisted(() => ({
  user: null as User | null,
  providers: [] as ApiProvider[],
  getApiProviders: vi.fn(),
  findProviderForModel: vi.fn(),
  consumeCredits: vi.fn(),
  calculateConfiguredCreditCost: vi.fn(),
  refundCredits: vi.fn(),
  createBillableTask: vi.fn(),
  settleFailedTask: vi.fn(),
  recordThreeDTaskSubmitted: vi.fn(),
  projectPersistedCompletedTask: vi.fn(),
  updateCloudTask: vi.fn(),
  completeCloudTask: vi.fn(),
  fetch: vi.fn(),
}));

export { doubles };

vi.mock('server-only', () => ({}));

vi.mock('@/lib/api-auth', () => ({
  getRequestUser: async () => doubles.user ? { user: doubles.user } : null,
}));
vi.mock('@/lib/server-api-config', () => ({
  getApiProviders: doubles.getApiProviders,
  findProviderForModel: doubles.findProviderForModel,
  normalizeApiBaseUrl: (url: string) => url.replace(/\/+$/, ''),
}));
vi.mock('@/lib/credits', () => ({
  calculateConfiguredCreditCost: doubles.calculateConfiguredCreditCost,
  consumeCredits: doubles.consumeCredits,
  refundCredits: doubles.refundCredits,
  InsufficientCreditsError: class extends Error {},
}));
vi.mock('@/lib/runtime-settings', () => ({
  getRuntimeSettings: async () => ({ threeDModelEnabled: true }),
}));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => '/synthetic-data' }));
vi.mock('@/lib/op-log', () => ({
  logOperation: vi.fn(), logError: vi.fn(), OP_ACTIONS: { MODEL_3D_GENERATE: '3d' },
}));
vi.mock('@/lib/cloud-task-persistence', () => ({
  recordThreeDTaskSubmitted: doubles.recordThreeDTaskSubmitted,
  projectPersistedCompletedTask: doubles.projectPersistedCompletedTask,
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  updateCloudTask: doubles.updateCloudTask,
  completeCloudTask: doubles.completeCloudTask,
}));
vi.mock('@/lib/task-core/billing-service', () => ({
  createBillableTask: doubles.createBillableTask,
  settleFailedTask: doubles.settleFailedTask,
}));
// All image validation stays real; object storage is an external boundary.
vi.mock('@/lib/s3-storage', () => ({ readManagedImageFromS3Bounded: vi.fn() }));

export const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC';
export const SECOND_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgYPgPAAEDAQBdlO9aAAAAAElFTkSuQmCC';

export function configuredProvider(overrides: Partial<ApiProvider> = {}): ApiProvider {
  return {
    id: 'provider-a', name: 'Meshy', displayName: 'Synthetic Meshy',
    baseUrl: 'https://provider-a.invalid', apiKey: 'synthetic-key-a',
    type: '3d', modelType: '3d', providerPreset: 'meshy', isEnabled: true,
    selectedModel: 'meshy-6', selectedModels: ['meshy-6'],
    createdAt: 1, updatedAt: 1,
    ...overrides,
  };
}

export function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    backend: 'api', mode: 'single-image', imageUrl: IMAGE,
    quality: 'standard', texture: 'pbr', format: 'glb', type: 'object',
    providerId: 'provider-a', provider: { id: 'provider-a', model: 'meshy-6' },
    ...overrides,
  };
}

export function request(body: Record<string, unknown>) {
  return new NextRequest('http://offline.invalid/api/image-to-3d', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function resetOfflineRoute() {
  vi.resetAllMocks();
  vi.stubEnv('WUJIE_TASK_CORE_MODE', 'legacy');
  vi.stubEnv('WUJIE_3D_LOCAL_WORKER_URL', '');
  vi.stubEnv('WUJIE_3D_LOCAL_WORKER_MODEL', '');
  doubles.user = {
    id: 'synthetic-user', name: 'Synthetic User', role: 'user', status: 'active',
    imageModels: ['provider-a::meshy-6'], createdAt: 1, updatedAt: 1,
  };
  doubles.providers = [configuredProvider()];
  doubles.getApiProviders.mockImplementation(async () => doubles.providers);
  doubles.findProviderForModel.mockImplementation(async (model: string) => (
    doubles.providers.find(p => p.isEnabled && p.selectedModels?.includes(model)) || null
  ));
  doubles.calculateConfiguredCreditCost.mockResolvedValue(10);
  doubles.consumeCredits.mockResolvedValue({ success: true, cost: 10, balance: 90 });
  doubles.createBillableTask.mockImplementation(async (input) => ({
    task: { ...input.task, creditCost: input.creditCost }, reused: false,
  }));
  doubles.updateCloudTask.mockResolvedValue(true);
  doubles.completeCloudTask.mockResolvedValue(true);
  doubles.fetch.mockImplementation(async () => Response.json({
    Response: { JobId: 'remote-task' }, result: 'remote-task',
    data: { task_id: 'remote-task' }, task_id: 'remote-task',
  }));
  vi.stubGlobal('fetch', doubles.fetch);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}
