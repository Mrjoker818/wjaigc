// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NodeEditor from '@/components/node-editor';
import type { Workflow } from '@/lib/workflow-engine';
import { createEmptyWorkflow } from '@/lib/workflow-engine';
import { CANVAS_ASSET_DRAG_MIME, serializeCanvasAssetDragPayload } from '@/lib/asset-core/workspace-transfer';

const workflow = { ...createEmptyWorkflow('协作素材'), id: 'workflow-a' };
const image = { id: 'image-a', url: '/fixture.png', name: '合成图片', description: '合成图片', projectId: 'project-a', assetId: 'asset-a', assetVersionId: 'version-a', placementId: 'placement-a' };

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key), clear: () => storage.clear() });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('WebSocket', class { constructor() { throw new Error('NETWORK_BLOCKED'); } });
  vi.stubGlobal('XMLHttpRequest', class { constructor() { throw new Error('NETWORK_BLOCKED'); } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('document workflow input actor mismatch', () => {
  it('retains the blocked source and allows retry only in its original account and project', async () => {
    let latest: Workflow | null = null;
    let retry = false;
    const headers: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method || 'GET') === 'GET') return Response.json({ models: [], skills: [], workflows: [], presets: [] });
      if (url !== '/api/assets') throw new Error(`NETWORK_BLOCKED ${url}`);
      headers.push(new Headers(init?.headers).get('x-wujie-expected-actor-id') || '');
      return retry ? Response.json({ assetId: image.assetId, assetVersionId: image.assetVersionId, placementId: image.placementId, url: image.url }) : Response.json({ error: 'ACTOR_SCOPE_CHANGED' }, { status: 409 });
    }));
    const view = (actor: string, project: string) => <NodeEditor workflow={workflow} rendererMode="legacy" projectId={project} userId={actor} canvasDocumentMode canvasImages={[image]} taskModelCatalog={[]} taskModelOptions={[]} onWorkflowChange={value => { if (value) latest = structuredClone(value); }} />;
    const mounted = render(view('user-a', 'project-a'));
    const surface = mounted.container.querySelector<HTMLElement>('.canvas-bg');
    expect(surface).not.toBeNull();
    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 });
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: (type: string) => type === CANVAS_ASSET_DRAG_MIME ? serializeCanvasAssetDragPayload(image) : '' } });
    fireEvent(surface!, drop);
    await waitFor(() => expect(headers).toEqual(['user-a']));
    await screen.findByText(/账号已切换或不一致/);
    const current = () => (latest as Workflow | null)?.nodes.find(node => node.type === 'input-image');
    expect(current()?.config.assetTransferPending).toBe(true);
    expect(current()?.config.assetTransferError).toBe('ACTOR_SCOPE_CHANGED');
    expect(headers).toEqual(['user-a']);
    mounted.rerender(view('user-b', 'project-a'));
    fireEvent.click(screen.getByRole('button', { name: '重试接收图片' }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(headers).toEqual(['user-a']);
    mounted.rerender(view('user-a', 'project-a'));
    retry = true;
    fireEvent.click(screen.getByRole('button', { name: '重试接收图片' }));
    await waitFor(() => expect(current()?.config.assetTransferPending).toBe(false));
    expect(current()?.config.placementId).toBe(image.placementId);
    expect(headers).toEqual(['user-a', 'user-a']);
  }, 12000);
});
