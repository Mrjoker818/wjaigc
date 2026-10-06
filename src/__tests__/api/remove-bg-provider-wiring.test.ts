import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiKind, ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';

const storage = vi.hoisted(() => ({ providers: vi.fn(), users: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', async original => ({
  ...await original<typeof import('@/lib/server-api-config')>(), getApiProviders: storage.providers,
}));
vi.mock('@/lib/server-auth', () => ({ listManagedUsers: storage.users }));
import { prepareImageEditModelPlan } from '@/lib/task-core/image-edit-model-plan';

const actor: User = { id: 'removebg-actor', name: 'Actor', role: 'user', status: 'active', createdAt: 1, updatedAt: 1 };
function provider(id: string, type: ApiKind, models: string[]): ApiProvider {
  return { id, name: id, type, modelType: type, selectedModels: models, selectedModel: models[0],
    baseUrl: `https://${id}.invalid/v1`, apiKey: `offline-${id}`, isEnabled: true, createdAt: 1, updatedAt: 1 };
}
beforeEach((): void => {
  vi.clearAllMocks();
  storage.providers.mockResolvedValue([
    provider('image-a', 'image', ['gpt-image-1']),
    provider('bg-a', 'removebg', ['remove-a', 'remove-b']),
    provider('bg-b', 'removebg', ['remove-a', 'remove-b']),
  ]);
  storage.users.mockResolvedValue([actor]);
  vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Undeclared network'); });
});
afterEach((): void => { vi.unstubAllGlobals(); });

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/image-edit/route.ts'),
  'utf8',
);

describe('dedicated RemoveBG provider wiring', () => {
  it('routes both remove-background action aliases through the dedicated adapter', () => {
    expect(source).toContain("from '@/lib/remove-bg-provider'");
    expect(source).toContain(
      "const isRemoveBackgroundAction = action === 'removebg' || action === 'remove_background';",
    );
    expect(source).toContain('await submitDedicatedRemoveBg(');
  });

  it('keeps dedicated providers out of the generic image-generation fallback', async (): Promise<void> => {
    // Catches dedicated models leaking into generic execution, or disappearing from the dedicated plan.
    for (const action of ['removebg', 'remove_background']) {
      const plan = await prepareImageEditModelPlan({ action, user: actor, source: 'cookie' });
      expect(plan.candidates.map(candidate => `${candidate.providerId}::${candidate.model}`))
        .toEqual(['image-a::gpt-image-1']);
      expect(plan.dedicatedRemoveBgCandidates.map(candidate => `${candidate.providerId}::${candidate.model}`))
        .toEqual(['bg-a::remove-a', 'bg-a::remove-b', 'bg-b::remove-a', 'bg-b::remove-b']);
      expect(plan.candidates.every(candidate => candidate.providerType !== 'removebg')).toBe(true);
      expect(plan.dedicatedRemoveBgCandidates.every(candidate => candidate.providerType === 'removebg')).toBe(true);
    }
    expect(source).toContain('const candidateModels = modelPlan.candidates;');
    expect(source).toContain('const genericRemoveBgCandidates = candidateModels;');
    expect(source).toContain('autoTrySubmitImageTask(genericRemoveBgCandidates');
  });

  it('calls the dedicated adapter before generic image generation', () => {
    const removeBgBranch = source.slice(
      source.indexOf("if (isRemoveBackgroundAction)"),
      source.lastIndexOf("if (action === 'inpaint')"),
    );

    expect(removeBgBranch.indexOf('submitDedicatedRemoveBg(')).toBeGreaterThan(-1);
    expect(removeBgBranch.indexOf('autoTrySubmitImageTask(genericRemoveBgCandidates')).toBeGreaterThan(
      removeBgBranch.indexOf('submitDedicatedRemoveBg('),
    );
  });

  it('returns actual provider and model metadata without serializing the API key', () => {
    const dedicatedStart = source.indexOf('submitDedicatedRemoveBg(');
    const dedicatedEnd = source.indexOf('autoTrySubmitImageTask(genericRemoveBgCandidates', dedicatedStart);
    const dedicatedPath = source.slice(dedicatedStart, dedicatedEnd);

    expect(dedicatedPath).toContain('providerId: dedicatedProvider.id');
    expect(dedicatedPath).toContain('usedModel: dedicatedModel');
    expect(dedicatedPath).not.toContain('apiKey:');
  });

  it('prioritizes an explicitly selected dedicated provider and model', async (): Promise<void> => {
    // Shared model names across providers must not broaden an explicit pair or retain selectedModel from config.
    for (const [providerId, model] of [['bg-a', 'remove-b'], ['bg-b', 'remove-b'], ['bg-b', 'remove-a']]) {
      const plan = await prepareImageEditModelPlan({ action: 'removebg', user: actor, source: 'cookie',
        providerId, model: `${providerId}::${model}` });
      expect(plan.explicit).toBe(true);
      expect(plan.requestedProviderId).toBe(providerId);
      expect(plan.requestedModelId).toBe(model);
      expect(plan.candidates).toEqual([]);
      expect(plan.dedicatedRemoveBgCandidates).toHaveLength(1);
      expect(plan.dedicatedRemoveBgCandidates[0]).toMatchObject({ providerId, model,
        provider: { id: providerId, selectedModel: model } });
    }
    expect(source).toContain('{ ...dedicatedProvider, selectedModel: dedicatedModel }');
  });

  it('charges both remove-background aliases through the same credit operation', () => {
    expect(source).toContain("isRemoveBackgroundAction ? 'image_remove_bg'");
  });

  it('preserves strict AI-only failure semantics and local fallback for automatic mode', () => {
    expect(source).toContain("if ((engineMode === 'ai' || engineMode === 'ai-only') && !aiSuccess)");
    expect(source).toContain('createLocalBackgroundAlpha(sourceBuffer)');
  });
});
