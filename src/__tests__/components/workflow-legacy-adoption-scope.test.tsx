// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NodeEditor from '@/components/node-editor';
import { createEmptyWorkflow } from '@/lib/workflow-engine';
import { CANVAS_ASSET_DRAG_MIME, serializeCanvasAssetDragPayload } from '@/lib/asset-core/workspace-transfer';

const workflow = { ...createEmptyWorkflow('隔离工作流'), id: 'scope-test-workflow' };
const image = { id: 'same-image', url: '/fixture-image.png', name: '合成图片', description: '合成图片', projectId: 'project-a' };
const result = { assetId: 'asset-a', assetVersionId: 'version-a', placementId: 'placement-a', url: '/adopted.png' };

async function awaitBounded(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Transfer response was not consumed')), 1500);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  vi.stubGlobal('BroadcastChannel', undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('legacy canvas adoption scope', () => {
  it.each(['project', 'account', 'return-to-project', 'same'])('only applies the adoption to its original active scope: %s', async scenario => {
    let release!: (response: Response) => void;
    const adoption = new Promise<Response>(resolve => { release = resolve; });
    let finishAdoption!: () => void;
    const adoptionConsumed = new Promise<void>(resolve => { finishAdoption = resolve; });
    const adoptionResponse = Response.json(result);
    const readAdoption = adoptionResponse.json.bind(adoptionResponse);
    adoptionResponse.json = async () => { try { return await readAdoption(); } finally { finishAdoption(); } };
    let finishTransfer!: () => void;
    const transferConsumed = new Promise<void>(resolve => { finishTransfer = resolve; });
    const adopted = vi.fn();
    const requests: string[] = [];
    let adoptionActor: string | null = null;
    let transferActor: string | null = null;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push(`${init?.method || 'GET'} ${url}`);
      if (url === '/api/assets/adopt-canvas-image') {
        adoptionActor = new Headers(init?.headers).get('x-wujie-expected-actor-id');
        return adoption;
      }
      if (url === '/api/assets/transfer') {
        transferActor = new Headers(init?.headers).get('x-wujie-expected-actor-id');
        const response = Response.json(result);
        const read = response.json.bind(response);
        response.json = async () => { try { return await read(); } finally { finishTransfer(); } };
        return response;
      }
      if (!init?.method || init.method === 'GET') return Response.json({ models: [], skills: [], workflows: [], presets: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const view = (projectId: string, userId: string) => <NodeEditor workflow={workflow} rendererMode="legacy"
      projectId={projectId} userId={userId} canvasDocumentMode={false} canvasImages={[image]}
      taskModelCatalog={[]} taskModelOptions={[]} onCanvasImageAssetReferenceAdopted={adopted} />;
    const mounted = render(view('project-a', 'user-a'));
    try {
      const surface = mounted.container.querySelector<HTMLElement>('.canvas-bg');
      expect(surface).not.toBeNull();
      const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 });
      Object.defineProperty(drop, 'dataTransfer', { value: {
        getData: (type: string) => type === CANVAS_ASSET_DRAG_MIME ? serializeCanvasAssetDragPayload(image) : '',
      } });
      fireEvent(surface!, drop);
      await waitFor(() => expect(requests).toContain('POST /api/assets/adopt-canvas-image'));
      expect(adoptionActor).toBe('user-a');
      if (scenario === 'project' || scenario === 'return-to-project') mounted.rerender(view('project-b', 'user-a'));
      if (scenario === 'account') mounted.rerender(view('project-a', 'user-b'));
      if (scenario === 'return-to-project') mounted.rerender(view('project-a', 'user-a'));
      await act(async () => { release(adoptionResponse); await awaitBounded(adoptionConsumed); });
      if (scenario === 'same') {
        await waitFor(() => expect(requests).toContain('POST /api/assets/transfer'));
        await act(async () => { await awaitBounded(transferConsumed); });
        expect(adopted).toHaveBeenCalledExactlyOnceWith(image.id, result);
        expect(transferActor).toBe('user-a');
        expect(requests.filter(request => request.startsWith('POST '))).toEqual([
          'POST /api/assets/adopt-canvas-image', 'POST /api/assets/transfer',
        ]);
      } else {
        expect(adopted).not.toHaveBeenCalled();
        expect(requests.filter(request => request.startsWith('POST '))).toEqual(['POST /api/assets/adopt-canvas-image']);
      }
    } finally {
      try {
        await act(async () => { release(adoptionResponse); await adoption; });
        if (requests.includes('POST /api/assets/adopt-canvas-image')) {
          await act(async () => { await awaitBounded(adoptionConsumed); });
          if (requests.includes('POST /api/assets/transfer')) await act(async () => { await awaitBounded(transferConsumed); });
        }
      } finally {
        mounted.unmount();
      }
    }
  });
});
