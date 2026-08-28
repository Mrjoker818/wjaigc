// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock('@/hooks/use-task-model-catalog', () => ({
  useTaskModelCatalog: () => catalogState.current,
}));
vi.mock('@/lib/universal-api-manager', () => ({
  UniversalApiManager: {
    getInstance: () => ({ getProviders: () => [] }),
  },
}));
vi.mock('@/lib/user-manager', () => ({
  UserManager: { getInstance: () => ({ getApiKeys: () => [] }) },
}));
vi.mock('@/components/third-party-model-dialog', () => ({
  ThirdPartyModelDialog: () => null,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { GenerationPanel } from '@/components/generation-panel';

const descriptor = {
  providerId: 'pear',
  modelId: 'gpt-image-2',
  kind: 'image',
  sourceType: 'image',
  protocol: 'pear',
  executionMode: 'async',
  allowedRatios: ['1:1', '16:9'],
  allowedSizes: ['1024x1024', '1536x1024'],
  qualityOptions: ['standard', 'hd'],
  maxOutputs: 4,
  supportsReferenceImages: true,
  maxReferenceImages: 4,
  supportsMask: false,
  supportedOperations: ['text-to-image', 'image-to-image'],
  outputKinds: ['png'],
  capabilitySources: {},
};

describe('GenerationPanel exact catalog behavior', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    });
    catalogState.current = {
      models: [{
        id: 'gpt-image-2',
        name: 'Gpt Image 2',
        providerId: 'pear',
        providerName: 'PearAPI 图像',
        type: 'image',
        isDefault: true,
      }],
      descriptorsByKey: new Map([['pear::gpt-image-2', descriptor]]),
      loading: false,
      error: null,
      reload: vi.fn(),
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function persistUserSelection(selection: string) {
    localStorage.setItem('unbounded_ai_current_user', 'user-1');
    localStorage.setItem('unbounded_ai_user_data', JSON.stringify({
      userData: {
        'user-1': { selectedModel: selection },
      },
    }));
  }

  function readPersistedUserSelection(): string | undefined {
    const stored = localStorage.getItem('unbounded_ai_user_data');
    return stored
      ? JSON.parse(stored)?.userData?.['user-1']?.selectedModel
      : undefined;
  }

  it('does not select or rewrite either provider for an ambiguous persisted bare model id', async () => {
    persistUserSelection('shared-image');
    catalogState.current = {
      models: [
        {
          id: 'shared-image',
          name: 'Shared Image A',
          providerId: 'provider-a',
          providerName: 'Provider A',
          type: 'image',
        },
        {
          id: 'shared-image',
          name: 'Shared Image B',
          providerId: 'provider-b',
          providerName: 'Provider B',
          type: 'image',
        },
      ],
      descriptorsByKey: new Map([
        ['provider-a::shared-image', { ...descriptor, providerId: 'provider-a', modelId: 'shared-image' }],
        ['provider-b::shared-image', { ...descriptor, providerId: 'provider-b', modelId: 'shared-image' }],
      ]),
      loading: false,
      error: null,
      reload: vi.fn(),
    };

    render(<GenerationPanel onGenerate={vi.fn()} />);

    const select = screen.getByLabelText('图像模型') as HTMLSelectElement;
    await waitFor(() => expect(select.options).toHaveLength(3));
    expect(select.value).toBe('');
    expect(readPersistedUserSelection()).toBe('shared-image');
    expect(localStorage.getItem('wujie_selected_model')).toBeNull();
  });

  it('migrates and writes back a persisted bare model id with one visible provider', async () => {
    persistUserSelection('gpt-image-2');

    render(<GenerationPanel onGenerate={vi.fn()} />);

    await waitFor(() => expect(readPersistedUserSelection()).toBe('pear::gpt-image-2'));
    expect((screen.getByLabelText('图像模型') as HTMLSelectElement).value).toBe('pear::gpt-image-2');
    expect(JSON.parse(localStorage.getItem('wujie_selected_model') || 'null')).toMatchObject({
      model: 'gpt-image-2',
      providerId: 'pear',
      compositeKey: 'pear::gpt-image-2',
    });
  });

  it('preserves a valid persisted exact provider key', async () => {
    persistUserSelection('pear::gpt-image-2');

    render(<GenerationPanel onGenerate={vi.fn()} />);

    await waitFor(() => expect((screen.getByLabelText('图像模型') as HTMLSelectElement).value)
      .toBe('pear::gpt-image-2'));
    expect(readPersistedUserSelection()).toBe('pear::gpt-image-2');
  });

  it('does not write back a persisted bare model id with no visible provider', async () => {
    persistUserSelection('missing-image');

    render(<GenerationPanel onGenerate={vi.fn()} />);

    const select = screen.getByLabelText('图像模型') as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
    expect(select.value).toBe('');
    expect(readPersistedUserSelection()).toBe('missing-image');
    expect(localStorage.getItem('wujie_selected_model')).toBeNull();
  });

  it('shows only the selected provider/model descriptor values', async () => {
    render(<GenerationPanel onGenerate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('16:9')).toBeTruthy());
    expect(screen.queryByText('21:9')).toBeNull();
    expect(screen.getByText('标准')).toBeTruthy();
    expect(screen.getByText('高清')).toBeTruthy();
    expect(screen.getByText('1024x1024')).toBeTruthy();
    expect(screen.getByText('1536x1024')).toBeTruthy();
    expect(screen.getByText('x1')).toBeTruthy();
    expect(screen.getByText('x4')).toBeTruthy();
  });

  it('rejects the shared generate command while the exact descriptor is unavailable', () => {
    const onGenerate = vi.fn();
    const onError = vi.fn();
    catalogState.current = {
      models: [],
      descriptorsByKey: new Map(),
      loading: true,
      error: null,
      reload: vi.fn(),
    };
    render(<GenerationPanel onGenerate={onGenerate} onError={onError} />);

    act(() => document.dispatchEvent(new Event('trigger-generate')));

    expect(onGenerate).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('模型能力尚未加载');
  });

  it('omits quality and size parameters that the descriptor does not expose', async () => {
    const onGenerate = vi.fn();
    catalogState.current = {
      ...catalogState.current,
      descriptorsByKey: new Map([['pear::gpt-image-2', {
        ...descriptor,
        allowedSizes: [],
        qualityOptions: [],
      }]]),
    };
    render(<GenerationPanel onGenerate={onGenerate} />);
    await waitFor(() => expect(screen.getByText('16:9')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('创意描述'), { target: { value: '测试提示词' } });
    act(() => document.dispatchEvent(new Event('trigger-generate')));

    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({
      quality: undefined,
      resolution: undefined,
      size: '',
    }));
  });

  it('sends resolution tiers as resolution instead of an invalid pixel size', async () => {
    const onGenerate = vi.fn();
    catalogState.current = {
      ...catalogState.current,
      descriptorsByKey: new Map([['pear::gpt-image-2', {
        ...descriptor,
        allowedSizes: ['1K', '2K', '4K'],
        qualityOptions: ['auto', 'low', 'medium', 'high'],
      }]]),
    };
    render(<GenerationPanel onGenerate={onGenerate} />);
    await waitFor(() => expect(screen.getByText('1K')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('创意描述'), { target: { value: '透明 PNG 图标' } });
    act(() => document.dispatchEvent(new Event('trigger-generate')));

    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({
      size: '',
      resolution: '1K',
    }));
  });
});
