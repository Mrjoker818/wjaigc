// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrandEcommercePanel } from '@/components/brand-ecommerce-panel';

const providers = [
  { id: 'pear-test', name: 'PearAPI', displayName: 'PearAPI', modelType: 'image', isEnabled: true },
  { id: 'apimart-test', name: 'APImart', displayName: 'APImart', modelType: 'image', isEnabled: true },
];

const imageModels = providers.map(provider => ({
  id: 'gpt-image-2',
  name: 'Gpt Image 2',
  providerId: provider.id,
  type: 'image',
}));

const chatProviders = [
  { id: 'pear-chat', name: 'Pear Chat', displayName: 'Pear Chat', modelType: 'chat', isEnabled: true },
  { id: 'apimart-chat', name: 'APImart Chat', displayName: 'APImart Chat', modelType: 'chat', isEnabled: true },
];

const chatModels = chatProviders.map(provider => ({
  id: 'shared-chat-model',
  name: 'Shared Chat Model',
  providerId: provider.id,
  type: 'chat',
}));

const template = {
  id: 'white-bg',
  name: 'Contract White Background',
  icon: '',
  description: 'Local request contract fixture',
  promptTemplate: '{productDesc}',
  negativePrompt: '',
  aspectRatio: '1:1',
  category: 'product',
};

describe('brand ecommerce provider selection request contract', () => {
  let generateRequests: Array<Record<string, unknown>>;
  let generateResponse: Record<string, unknown>;
  let assets: Array<Record<string, unknown>>;
  let assetRequests: Array<Record<string, unknown>>;
  let assistRequests: Array<Record<string, unknown>>;
  let availableChatProviders: typeof chatProviders;
  let availableChatModels: Array<{ id: string; name: string; providerId?: string; type: string }>;

  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() { return storage.size; },
    });
    generateRequests = [];
    generateResponse = { success: false, error: 'LOCAL_CONTRACT_ONLY' };
    assets = [];
    assetRequests = [];
    assistRequests = [];
    availableChatProviders = chatProviders;
    availableChatModels = chatModels;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === '/api/models?type=image') {
        return Response.json({ success: true, providers, models: imageModels });
      }
      if (url === '/api/models?type=chat') {
        return Response.json({ success: true, providers: availableChatProviders, models: availableChatModels });
      }
      if (url.startsWith('/api/brand-assets?')) {
        return Response.json({ success: true, assets });
      }
      if (url === '/api/brand-assets') {
        assetRequests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ success: false, error: 'LOCAL_CONTRACT_ONLY' });
      }
      if (url === '/api/brand-ecommerce') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (body.action === 'templates') {
          return Response.json({ success: true, templates: [template] });
        }
        if (body.action === 'generate') {
          generateRequests.push(body);
          // The test ends at the request boundary; it never simulates a generated image.
          return Response.json(generateResponse);
        }
        if (body.action === 'assist') {
          assistRequests.push(body);
          return Response.json({ success: true, content: '' });
        }
      }
      throw new Error(`Unexpected test request: ${url}`);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function openConfiguredPanel(): Promise<void> {
    render(<BrandEcommercePanel onClose={vi.fn()} />);
    await screen.findByText(template.name);
    fireEvent.click(screen.getByRole('button', { name: '生成设置' }));
    fireEvent.change(screen.getByPlaceholderText(/描述你的商品/), {
      target: { value: 'A plain ceramic cup for a local contract test' },
    });
    await waitFor(() => expect((screen.getByRole('button', { name: '批量生成' }) as HTMLButtonElement).disabled).toBe(false));
  }

  function selectImageProvider(name: string): void {
    const section = screen.getByText('生成模型').parentElement;
    if (!section) throw new Error('Missing model selection section');
    fireEvent.click(within(section).getByRole('button'));
    fireEvent.click(within(section).getByRole('button', { name: new RegExp(`Gpt Image 2.*${name}`) }));
  }

  function selectLlmProvider(name: string): void {
    const section = screen.getByText('LLM 辅助模型').parentElement;
    if (!section) throw new Error('Missing LLM selection section');
    fireEvent.click(within(section).getByRole('button'));
    fireEvent.click(within(section).getByRole('button', { name: new RegExp(`Shared Chat Model.*${name}`) }));
  }

  it('submits one exact LLM provider-model pair for all AI assist requests', async () => {
    await openConfiguredPanel();
    selectLlmProvider('APImart Chat');
    fireEvent.click(screen.getByRole('button', { name: 'AI 辅助优化设计' }));
    await waitFor(() => expect(assistRequests).toHaveLength(3));
    expect(assistRequests.map(request => ({
      assistType: request.assistType,
      llmModel: request.llmModel,
      llmProviderId: request.llmProviderId,
    }))).toEqual([
      { assistType: 'optimize-prompt', llmModel: 'shared-chat-model', llmProviderId: 'apimart-chat' },
      { assistType: 'suggest-style', llmModel: 'shared-chat-model', llmProviderId: 'apimart-chat' },
      { assistType: 'suggest-text', llmModel: 'shared-chat-model', llmProviderId: 'apimart-chat' },
    ]);
  });

  it('restores an exact persisted LLM provider-model pair', async () => {
    localStorage.setItem('wujie_selected_llm_model', 'apimart-chat::shared-chat-model');
    await openConfiguredPanel();
    fireEvent.click(screen.getByRole('button', { name: 'AI 辅助优化设计' }));
    await waitFor(() => expect(assistRequests).toHaveLength(3));
    expect(assistRequests.every(request => request.llmProviderId === 'apimart-chat')).toBe(true);
  });

  it('requires reselection instead of guessing an ambiguous legacy LLM provider', async () => {
    localStorage.setItem('wujie_selected_llm_model', 'shared-chat-model');
    await openConfiguredPanel();
    const section = screen.getByText('LLM 辅助模型').parentElement;
    if (!section) throw new Error('Missing LLM selection section');
    expect(within(section).getByRole('button').textContent).toContain('选择LLM模型...');
    expect(screen.queryByRole('button', { name: 'AI 辅助优化设计' })).toBeNull();
    expect(localStorage.getItem('wujie_selected_llm_model')).toBe('shared-chat-model');
  });

  it('persists an exact LLM provider-model pair after selection', async () => {
    await openConfiguredPanel();
    selectLlmProvider('APImart Chat');
    expect(localStorage.getItem('wujie_selected_llm_model')).toBe('apimart-chat::shared-chat-model');
  });

  it('does not expose AI assist when the catalog omits the LLM provider id', async () => {
    availableChatProviders = [];
    availableChatModels = [{ id: 'providerless-chat', name: 'Providerless Chat', type: 'chat' }];
    await openConfiguredPanel();
    expect(screen.queryByRole('button', { name: 'AI 辅助优化设计' })).toBeNull();
  });

  it('submits the API providerId field for the initial exact provider', async () => {
    await openConfiguredPanel();
    fireEvent.click(screen.getByRole('button', { name: '批量生成' }));
    await waitFor(() => expect(generateRequests).toHaveLength(1));
    expect(generateRequests[0]).toMatchObject({ model: 'gpt-image-2', providerId: 'pear-test' });
  });

  it('changes the submitted provider when choosing the same model from another provider', async () => {
    await openConfiguredPanel();
    selectImageProvider('APImart');
    fireEvent.click(screen.getByRole('button', { name: '批量生成' }));
    await waitFor(() => expect(generateRequests).toHaveLength(1));
    expect(generateRequests[0]).toMatchObject({ model: 'gpt-image-2', providerId: 'apimart-test' });
  });

  it('restores the existing model plus providerId storage format without switching providers', async () => {
    localStorage.setItem('wujie_selected_model', JSON.stringify({
      model: 'gpt-image-2', providerId: 'apimart-test',
    }));
    await openConfiguredPanel();
    fireEvent.click(screen.getByRole('button', { name: '批量生成' }));
    await waitFor(() => expect(generateRequests).toHaveLength(1));
    expect(generateRequests[0]).toMatchObject({ model: 'gpt-image-2', providerId: 'apimart-test' });
  });

  it('gives same-name provider options separate React identities', async () => {
    const consoleError = vi.spyOn(console, 'error');
    await openConfiguredPanel();
    selectImageProvider('APImart');
    expect(consoleError.mock.calls.filter(args => args.some(arg => String(arg).includes('same key')))).toEqual([]);
  });

  it('retains the chosen provider for a single-template retry', async () => {
    generateResponse = { results: [{ templateId: template.id, templateName: template.name, error: 'LOCAL_CONTRACT_ONLY' }] };
    await openConfiguredPanel();
    selectImageProvider('APImart');
    fireEvent.click(screen.getByRole('button', { name: '批量生成' }));
    fireEvent.click(await screen.findByRole('button', { name: '重新生成' }));
    await waitFor(() => expect(generateRequests).toHaveLength(2));
    expect(generateRequests[1]).toMatchObject({ model: 'gpt-image-2', providerId: 'apimart-test' });
  });

  it('requires reselection instead of guessing an ambiguous legacy model provider', async () => {
    localStorage.setItem('wujie_selected_model', 'gpt-image-2');
    render(<BrandEcommercePanel onClose={vi.fn()} />);
    await screen.findByText(template.name);
    fireEvent.click(screen.getByRole('button', { name: '生成设置' }));
    fireEvent.change(screen.getByPlaceholderText(/描述你的商品/), { target: { value: 'A plain cup' } });
    const selectRequired = screen.queryByRole('button', { name: '请先选择模型' }) as HTMLButtonElement | null;
    expect(selectRequired).not.toBeNull();
    expect(selectRequired?.disabled).toBe(true);
    expect(generateRequests).toEqual([]);
    expect(localStorage.getItem('wujie_selected_model')).toBe('gpt-image-2');
  });

  it('loads an exact provider from a saved brand asset', async () => {
    assets = [{ id: 'asset-test', name: 'Saved APImart asset', selected_model: 'apimart-test::gpt-image-2', product_desc: 'A cup' }];
    await openConfiguredPanel();
    fireEvent.click(screen.getByRole('button', { name: /品牌方案/ }));
    fireEvent.click(await screen.findByText('Saved APImart asset'));
    fireEvent.click(screen.getByRole('button', { name: '批量生成' }));
    await waitFor(() => expect(generateRequests).toHaveLength(1));
    expect(generateRequests[0]).toMatchObject({ model: 'gpt-image-2', providerId: 'apimart-test' });
  });

  it('saves the exact selected model key in the existing brand asset field', async () => {
    await openConfiguredPanel();
    selectImageProvider('APImart');
    fireEvent.click(screen.getByRole('button', { name: /品牌方案/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存当前' }));
    fireEvent.change(screen.getByPlaceholderText(/输入方案名称/), { target: { value: 'Exact selection' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(assetRequests).toHaveLength(1));
    expect(assetRequests[0].selectedModel).toBe('apimart-test::gpt-image-2');
  });
});
