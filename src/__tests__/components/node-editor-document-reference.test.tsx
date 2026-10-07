// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NodeEditor from '@/components/node-editor';
import { createEmptyWorkflow, createWorkflowNode, type Workflow } from '@/lib/workflow-engine';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const image = { id: 'canvas-a', name: 'Shared input', description: 'Shared input',
  url: '/untrusted.png', assetId: 'asset-a', assetVersionId: 'version-a',
  placementId: 'canvas-placement-a', projectId: 'project-a' };
const canonical = { url: '/api/serve-upload/canonical.png', assetId: 'asset-a',
  assetVersionId: 'version-a', placementId: 'canvas-placement-a' };

function setup(fetcher: typeof fetch, documentMode = true): { latest: () => Workflow; switchProject: () => void } {
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  const node = createWorkflowNode('input-image', 0, 0);
  let latest: Workflow = { ...createEmptyWorkflow('Document input'), id: 'workflow-a', nodes: [node] };
  const props = { workflow: latest, userId: 'editor-a', projectId: 'project-a', canvasDocumentMode: documentMode,
    canvasImages: [image], onWorkflowChange: (workflow: Workflow | null): void => { if (workflow) latest = workflow; } };
  const view = render(<NodeEditor {...props} />);
  fireEvent.mouseDown(screen.getByLabelText(node.label), { button: 0 });
  fireEvent.mouseUp(screen.getByLabelText(node.label), { button: 0 });
  fireEvent.click(screen.getByText('画布'));
  fireEvent.click(screen.getByRole('button', { name: '1. Shared input' }));
  return { latest: () => latest, switchProject: () => view.rerender(<NodeEditor {...props} projectId="project-b" />) };
}

describe('NodeEditor document canvas inputs', () => {
  it('reads the exact canonical document placement without creating a personal transfer', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (url === '/api/assets' || url === '/api/assets/transfer') {
        return new Response(JSON.stringify(url === '/api/assets' ? canonical : { ...canonical, placementId: 'personal-copy' }));
      }
      return new Response(JSON.stringify({ skills: [] }));
    });
    const state = setup(fetcher);
    await waitFor(() => expect(state.latest().nodes[0].config.assetTransferPending).toBe(false));
    expect(fetcher).toHaveBeenCalledWith('/api/assets', expect.objectContaining({
      body: JSON.stringify({ projectId: 'project-a', assetVersionId: 'version-a', placementId: 'canvas-placement-a' }),
      headers: { 'Content-Type': 'application/json', 'x-wujie-expected-actor-id': 'editor-a' },
    }));
    expect(fetcher.mock.calls.some(([url]) => url === '/api/assets/transfer')).toBe(false);
    expect(state.latest().nodes[0].config).toMatchObject({ imageUrl: canonical.url,
      assetVersionId: 'version-a', placementId: 'canvas-placement-a', projectId: 'project-a' });
  });

  it('clears rejected document inputs instead of falling back to an untrusted URL', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => url === '/api/assets' || url === '/api/assets/transfer'
      ? new Response(JSON.stringify({ code: 'DOCUMENT_FORBIDDEN' }), { status: 403 })
      : new Response(JSON.stringify({ skills: [] })));
    const state = setup(fetcher);
    await waitFor(() => expect(state.latest().nodes[0].config.assetTransferPending).toBe(false));
    expect(state.latest().nodes[0].config.imageUrl).toBe('');
    expect(state.latest().nodes[0].config.assetVersionId).toBeUndefined();
  });

  it('ignores a canonical response after the actor changes project', async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>(yes => { resolve = yes; });
    const fetcher = vi.fn(async (url: string | URL | Request) => url === '/api/assets' || url === '/api/assets/transfer'
      ? pending : new Response(JSON.stringify({ skills: [] })));
    const state = setup(fetcher);
    state.switchProject();
    await act(async () => { resolve(new Response(JSON.stringify(canonical))); await pending; });
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url === '/api/assets' || url === '/api/assets/transfer')).toBe(true));
    expect(state.latest().nodes[0].config.assetVersionId).toBeUndefined();
    expect(state.latest().nodes[0].config.imageUrl).not.toBe(canonical.url);
  });

  it.each([
    { ...canonical, assetVersionId: 'other-version' },
    { ...canonical, placementId: 'other-placement' },
    { ...canonical, url: '' },
  ])('does not adopt an unconfirmed tuple returned by the API (%j)', async reference => {
    const fetcher = vi.fn(async (url: string | URL | Request) => url === '/api/assets'
      ? new Response(JSON.stringify(reference)) : new Response(JSON.stringify({ skills: [] })));
    const state = setup(fetcher);
    await waitFor(() => expect(state.latest().nodes[0].config.assetTransferPending).toBe(false));
    expect(state.latest().nodes[0].config.imageUrl).toBe('');
    expect(state.latest().nodes[0].config.assetVersionId).toBeUndefined();
  });

  it('preserves the personal workflow transfer path for non-document projects', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => url === '/api/assets/transfer'
      ? new Response(JSON.stringify({ ...canonical, placementId: 'personal-copy' }))
      : new Response(JSON.stringify({ skills: [] })));
    const state = setup(fetcher, false);
    await waitFor(() => expect(state.latest().nodes[0].config.assetTransferPending).toBe(false));
    expect(fetcher.mock.calls.some(([url]) => url === '/api/assets')).toBe(false);
    expect(state.latest().nodes[0].config.placementId).toBe('personal-copy');
  });
});
