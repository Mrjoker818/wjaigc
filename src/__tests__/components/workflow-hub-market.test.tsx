// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkflowHub from '@/components/workflow-hub';
import type { Workflow } from '@/lib/workflow-engine';

afterEach(cleanup);

it('filters the template catalog and opens a usable workflow from a matching card', () => {
  const openWorkflow = vi.fn();
  render(<WorkflowHub onBack={vi.fn()} onEditWorkflow={openWorkflow} />);

  fireEvent.click(screen.getByRole('button', { name: 'AI修图' }));
  expect(screen.queryByRole('heading', { name: '文生图' })).toBeNull();
  const template = screen.getByRole('heading', { name: '抠图+高清放大' }).closest('article');
  expect(template).not.toBeNull();
  fireEvent.click(within(template!).getByRole('button', { name: '使用模板' }));
  expect(openWorkflow).toHaveBeenCalledWith(expect.objectContaining({
    name: '抠图+高清放大',
    nodes: expect.arrayContaining([expect.objectContaining({ type: 'ai-removebg' })]),
    connections: expect.arrayContaining([expect.objectContaining({ type: 'image' })]),
  }));

  fireEvent.click(screen.getByRole('button', { name: '全部' }));
  expect(screen.getByRole('heading', { name: '文生图' })).toBeTruthy();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function savedWorkflow(name: string): Workflow {
  return {
    id: 'same-saved-id',
    projectId: 'saved-project',
    name,
    version: '1.0.0',
    nodes: [{
      id: 'prompt',
      type: 'input-text',
      label: 'Prompt',
      x: 0, y: 0, width: 160, height: 80,
      ports: [],
      config: { text: name },
    }],
    connections: [],
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
  };
}

function workflowList(name: string): Response {
  return Response.json({ workflows: [savedWorkflow(name)] });
}

function dropWorkflow(text: Promise<string>): void {
  const file = new File([], 'workflow.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => text });
  fireEvent.drop(screen.getByRole('button', { name: '选择或拖入 JSON 文件' }), {
    dataTransfer: { files: [file] },
  });
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('workflow hub actor changes', () => {
  afterEach(async () => {
    // Let the export revoke its temporary URL before restoring jsdom's URL.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('blocks the previous selection during a deferred list load and exports the new actor’s chosen workflow', async () => {
    const currentList = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(workflowList('Previous workflow'))
      .mockReturnValueOnce(currentList.promise));
    const createObjectURL = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:workflow-export');
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = vi.fn();
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const onBack = vi.fn();
    const onEditWorkflow = vi.fn();
    const view = render(<WorkflowHub userId="actor-a" onBack={onBack} onEditWorkflow={onEditWorkflow} />);
    await screen.findByRole('option', { name: 'Previous workflow' });
    fireEvent.change(screen.getByRole('combobox', { name: '选择要导出的工作流' }), {
      target: { value: 'same-saved-id' },
    });

    view.rerender(<WorkflowHub userId="actor-b" onBack={onBack} onEditWorkflow={onEditWorkflow} />);
    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('option', { name: 'Previous workflow' })).toBeNull();

    await act(async () => { currentList.resolve(workflowList('Current workflow')); });
    await screen.findByRole('option', { name: 'Current workflow' });
    const selector = screen.getByRole<HTMLSelectElement>('combobox', { name: '选择要导出的工作流' });
    expect(selector.value).toBe('');
    fireEvent.change(selector, { target: { value: 'same-saved-id' } });
    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const contents = JSON.parse(await readBlob(createObjectURL.mock.calls[0][0]));
    expect(contents).toEqual({
      name: 'Current workflow',
      nodes: [expect.objectContaining({ id: 'prompt', config: { text: 'Current workflow' } })],
      connections: [],
    });
  });

  it('discards a deferred list from an earlier visit to the same actor', async () => {
    const oldList = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>()
      .mockReturnValueOnce(oldList.promise)
      .mockResolvedValueOnce(workflowList('Other actor workflow'))
      .mockResolvedValueOnce(workflowList('Current visit workflow'));
    vi.stubGlobal('fetch', fetcher);
    const onBack = vi.fn();
    const onEditWorkflow = vi.fn();
    const view = render(<WorkflowHub userId="actor-a" onBack={onBack} onEditWorkflow={onEditWorkflow} />);

    view.rerender(<WorkflowHub userId="actor-b" onBack={onBack} onEditWorkflow={onEditWorkflow} />);
    await screen.findByRole('option', { name: 'Other actor workflow' });
    view.rerender(<WorkflowHub userId="actor-a" onBack={onBack} onEditWorkflow={onEditWorkflow} />);
    await screen.findByRole('option', { name: 'Current visit workflow' });

    await act(async () => { oldList.resolve(workflowList('Earlier visit workflow')); });
    expect(screen.queryByRole('option', { name: 'Earlier visit workflow' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Current visit workflow' })).toBeTruthy();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/workflow/save?userId=actor-a',
      '/api/workflow/save?userId=actor-b',
      '/api/workflow/save?userId=actor-a',
    ]);
  });

  it.each(['resolves', 'rejects'] as const)('ignores a file read that %s after switching actors', async outcome => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ workflows: [] })));
    const onBack = vi.fn();
    const onEditWorkflow = vi.fn();
    const oldRead = deferred<string>();
    const view = render(<WorkflowHub userId="actor-a" onBack={onBack} onEditWorkflow={onEditWorkflow} />);
    dropWorkflow(oldRead.promise);
    view.rerender(<WorkflowHub userId="actor-b" onBack={onBack} onEditWorkflow={onEditWorkflow} />);

    await act(async () => {
      if (outcome === 'resolves') oldRead.resolve(JSON.stringify(savedWorkflow('Previous import')));
      else oldRead.reject(new Error('Synthetic file-read failure'));
    });
    expect(onEditWorkflow).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();

    await act(async () => {
      dropWorkflow(Promise.resolve(JSON.stringify(savedWorkflow('Current import'))));
    });
    expect(onEditWorkflow).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'Current import' }));
  });

  it('opens only the latest import when two reads finish out of order', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ workflows: [] })));
    const onEditWorkflow = vi.fn();
    const first = deferred<string>();
    render(<WorkflowHub userId="actor-a" onBack={vi.fn()} onEditWorkflow={onEditWorkflow} />);
    dropWorkflow(first.promise);
    await act(async () => {
      dropWorkflow(Promise.resolve(JSON.stringify(savedWorkflow('Latest import'))));
    });
    await act(async () => { first.resolve(JSON.stringify(savedWorkflow('Superseded import'))); });
    expect(onEditWorkflow).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'Latest import' }));
  });
});
