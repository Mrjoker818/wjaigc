// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTaskModelCatalog } from '@/hooks/use-task-model-catalog';

const hookPath = resolve(process.cwd(), 'src/hooks/use-task-model-catalog.ts');

describe('task model catalog consumers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('provides one client hook for the versioned task model catalog', () => {
    expect(existsSync(hookPath)).toBe(true);
    if (!existsSync(hookPath)) return;

    const source = readFileSync(hookPath, 'utf8');
    expect(source).toContain('export function useTaskModelCatalog');
  });

  it('loads the versioned catalog and indexes descriptors by exact provider/model key', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        capabilityCatalogVersion: 1,
        providers: [{ id: 'pear', name: 'PearAPI 图像' }],
        models: [{ id: 'gpt-image-2', name: 'Gpt Image 2', providerId: 'pear', type: 'image' }],
        taskModelCatalog: [{
          providerId: 'pear',
          modelId: 'gpt-image-2',
          kind: 'image',
          sourceType: 'image',
          protocol: 'pear',
          executionMode: 'async',
          allowedRatios: ['1:1', '16:9'],
          allowedSizes: [],
          qualityOptions: ['standard', 'hd'],
          maxOutputs: 4,
          supportsReferenceImages: true,
          maxReferenceImages: 4,
          supportsMask: false,
          supportedOperations: ['text-to-image', 'image-to-image'],
          outputKinds: ['png'],
          capabilitySources: {},
        }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useTaskModelCatalog('image'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith('/api/models?type=image', expect.objectContaining({
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }));
    expect(result.current.error).toBeNull();
    expect(result.current.models).toEqual([
      expect.objectContaining({
        id: 'gpt-image-2',
        providerId: 'pear',
        providerName: 'PearAPI 图像',
      }),
    ]);
    expect(result.current.descriptorsByKey.get('pear::gpt-image-2')).toMatchObject({
      allowedRatios: ['1:1', '16:9'],
      qualityOptions: ['standard', 'hd'],
      maxOutputs: 4,
    });
  });

  it('reports a catalog version mismatch instead of accepting an incompatible payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        capabilityCatalogVersion: 2,
        models: [],
        taskModelCatalog: [],
      }),
    })));

    const { result } = renderHook(() => useTaskModelCatalog('image'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toEqual(expect.objectContaining({
      message: '模型能力目录不可用',
    }));
    expect(result.current.descriptorsByKey.size).toBe(0);
  });

  it('aborts the in-flight catalog request when its consumer unmounts', () => {
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      requestSignal = init?.signal || undefined;
      return new Promise(() => {});
    }));

    const { unmount } = renderHook(() => useTaskModelCatalog('image'));
    expect(requestSignal?.aborted).toBe(false);

    act(() => unmount());
    expect(requestSignal?.aborted).toBe(true);
  });

  it('reloads the catalog when the page becomes visible after an admin configuration change', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        capabilityCatalogVersion: 1,
        providers: [],
        models: [],
        taskModelCatalog: [],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

    const { unmount } = renderHook(() => useTaskModelCatalog('image'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    unmount();
  });
});
