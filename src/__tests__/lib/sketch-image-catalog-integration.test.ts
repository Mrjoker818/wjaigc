import { beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';
import { getConfiguredModelsForProviders } from '@/lib/model-type-classification';
import { resolveTaskModelCatalogResultFromSnapshot, resolveTaskModelFromProviders } from '@/lib/task-core/model-catalog';
import { sketchImageModels, type SketchImageInput } from '@/lib/sketch-to-code/image-contract';
import { prepareSketchImage } from '@/lib/sketch-to-code/image-generation';
import { createConfiguredSketchImageDependencies } from '@/lib/sketch-to-code/configured-image-dependencies';

vi.mock('server-only', () => ({}));

const actor: User = {
  id: 'raster-catalog-actor', name: 'Synthetic catalog actor', role: 'user', status: 'active',
  createdAt: 1, updatedAt: 1, imageModels: ['raster-image::gpt-image-2'], chatModels: ['raster-vision::gpt-4o'],
  apiPermissions: { image: true, chat: true, vlm: true, threeD: false, imageEdit: false,
    vectorize: false, layer: false, video: false, upscaler: false, removebg: false, audio: false },
};
const projectId = 'raster-catalog-project';
let originalPng: string;

function providers(outputKinds?: string[]): ApiProvider[] {
  return [
    { id: 'raster-vision', name: 'Synthetic vision', type: 'vlm', modelType: 'vlm', isEnabled: true,
      baseUrl: 'https://catalog-fixture.invalid/vision/v1', apiKey: 'synthetic-vision-only',
      requestStyle: 'chat-completions', selectedModels: ['gpt-4o'], createdAt: 1, updatedAt: 1 },
    { id: 'raster-image', name: 'Synthetic image', type: 'image', modelType: 'image', isEnabled: true,
      baseUrl: 'https://catalog-fixture.invalid/image/v1', apiKey: 'synthetic-image-only',
      selectedModels: ['gpt-image-2'], createdAt: 1, updatedAt: 1,
      advancedParams: { compatProfile: 'openai', ...(outputKinds ? {
        taskModelCapabilities: JSON.stringify({ 'gpt-image-2': { outputKinds } }),
      } : {}) } },
  ];
}

function input(): SketchImageInput {
  return { projectId, imageDataUrl: originalPng, instruction: '保留原始草图构图',
    visionProviderId: 'raster-vision', visionModelId: 'gpt-4o', imageProviderId: 'raster-image',
    imageModelId: 'gpt-image-2', idempotencyKey: 'raster-catalog-input', aspectRatio: '1:1' };
}

beforeAll(async () => {
  originalPng = `data:image/png;base64,${(await sharp({ create: {
    width: 2, height: 2, channels: 4, background: '#111827',
  } }).png().toBuffer()).toString('base64')}`;
});

describe('sketch image admission consumes the real public catalog raster output contract', () => {
  // Catches rejecting the producer's format descriptors in favor of an invented literal "image" category.
  it('offers the reference-capable image from the unchanged real catalog producer', () => {
    const configured = providers();
    const catalog = resolveTaskModelCatalogResultFromSnapshot(getConfiguredModelsForProviders(configured), actor, configured);
    const image = catalog.taskModelCatalog.find(model => model.providerId === 'raster-image');
    expect(image?.outputKinds).toEqual(['png', 'jpeg', 'webp']);
    expect(sketchImageModels(catalog.taskModelCatalog).map(model => [model.providerId, model.modelId]))
      .toEqual([['raster-image', 'gpt-image-2']]);
  });

  it.each(['png', 'jpeg', 'webp'])('offers an explicitly configured %s output without changing model identity', format => {
    const configured = providers([format]);
    const catalog = resolveTaskModelCatalogResultFromSnapshot(getConfiguredModelsForProviders(configured), actor, configured);
    expect(sketchImageModels(catalog.taskModelCatalog).map(model => [model.providerId, model.modelId]))
      .toEqual([['raster-image', 'gpt-image-2']]);
  });

  // The real factory resolves and freezes the same producer descriptors; no provider request or SQL publication runs.
  it.each([
    { label: 'catalog defaults' },
    { label: 'png-only', outputKinds: ['png'] },
    { label: 'jpeg-only', outputKinds: ['jpeg'] },
    { label: 'webp-only', outputKinds: ['webp'] },
  ])('prepares the original PNG using the real configured factory and pure authorized catalog resolver ($label)',
    async ({ outputKinds }: { outputKinds?: string[] }): Promise<void> => {
    const configured = providers(outputKinds);
    const dependencies = createConfiguredSketchImageDependencies({
      authorizeProject: async value => ({ kind: 'personal', actorUserId: value.actorUserId,
        ownerId: actor.id, projectId: String(value.projectId) }),
      resolveTaskModel: async (providerId, modelId, actorId) => {
        if (actorId !== actor.id) throw new Error('Unexpected synthetic actor');
        return resolveTaskModelFromProviders(configured, providerId, modelId, actor);
      },
      findProviderById: async providerId => configured.find(provider => provider.id === providerId) || null,
      transport: async (): Promise<Response> => { throw new Error('Catalog regression permits no provider requests'); },
    });
    const prepared = await prepareSketchImage(input(), dependencies.generation,
      { actorUserId: actor.id, signal: new AbortController().signal });
    expect(prepared.input).toEqual(input());
    expect(prepared.visionBinding).toEqual({ providerId: 'raster-vision', modelId: 'gpt-4o' });
    expect(prepared.imageBinding).toEqual({ providerId: 'raster-image', modelId: 'gpt-image-2' });
    expect(Object.isFrozen(prepared.input)).toBe(true);
    expect(dependencies.routing()).toEqual({ vision: expect.stringMatching(/^[a-f0-9]{64}$/),
      image: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it.each(['svg', 'pdf', 'text', 'mp4'])('still excludes a non-raster %s-only catalog output', format => {
    const configured = providers([format]);
    const catalog = resolveTaskModelCatalogResultFromSnapshot(getConfiguredModelsForProviders(configured), actor, configured);
    expect(sketchImageModels(catalog.taskModelCatalog)).toEqual([]);
  });
});
