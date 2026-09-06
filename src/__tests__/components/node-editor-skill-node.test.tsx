// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import NodeEditor from '@/components/node-editor';
import { loadSavedWorkflowSkillResult } from '@/lib/skill-runtime/workflow-client';
import { createEmptyWorkflow, createWorkflowNode } from '@/lib/workflow-engine';

const workflowSkill = {
  id: 'workflow-skill', version: 2, name: '工作流产品套图', category: 'image',
  description: 'workflow only', systemPrompt: 'system', allowedSurfaces: ['canvas', 'workflow'],
  inputs: [{ key: 'brief', label: '产品需求', kind: 'text', required: true }],
  steps: [{ id: 'step', label: '生成', toolId: 'generate_image', execution: 'sequential', promptTemplate: '{{brief}}', modelRole: 'image', qualityGateIds: [] }],
  enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
};

const marketingWorkflowSkills = [
  { ...workflowSkill, id: 'preset-ad-ab-variants', name: '广告 A/B 变体' },
  { ...workflowSkill, id: 'preset-retargeting-creative', name: '再营销素材' },
  {
    ...workflowSkill,
    id: 'preset-omnichannel-campaign',
    name: '全渠道活动素材包',
    inputs: [
      { key: 'campaignName', label: '活动名称', kind: 'text', required: true },
      {
        key: 'channels', label: '投放渠道', kind: 'multi-select', required: true,
        options: ['小红书', '微信', 'Instagram'], maximumItems: 3,
      },
    ],
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('NodeEditor workflow Skill node', () => {
  it.each(['click', 'mouse-sequence'] as const)('opens a saved Skill result via %s in a viewport-sized preview without submitting another task', async interaction => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url);
      if (url.includes('/api/skill-runs/preview-run')) return new Response(JSON.stringify({ run: {
        runId: 'preview-run', projectId: 'project-a', workspaceId: 'workflow:preview-workflow',
        surface: 'workflow', skillId: workflowSkill.id, skillVersion: 2, status: 'completed',
        assetVersionIds: ['preview-version'],
      } }));
      if (url.startsWith('/api/assets?')) return new Response(JSON.stringify({
        assetVersionId: 'preview-version', url: '/skill-preview.png',
      }));
      return new Response('{}');
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = { ...node.config, skillId: workflowSkill.id, version: 2, runId: 'preview-run' };
    render(<NodeEditor workflow={{ ...createEmptyWorkflow('Preview'), id: 'preview-workflow', nodes: [node] }} projectId="project-a" canvasImages={[]} />);
    await waitFor(() => expect(document.querySelector('img[src="/skill-preview.png"]')).not.toBeNull());
    const resultImage = document.querySelector('img[src="/skill-preview.png"]')!;
    if (interaction === 'mouse-sequence') {
      fireEvent.pointerDown(resultImage, { button: 0, pointerId: 1, pointerType: 'mouse' });
      fireEvent.mouseDown(resultImage, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(resultImage, { button: 0, pointerId: 1, pointerType: 'mouse' });
      fireEvent.mouseUp(resultImage, { button: 0, clientX: 100, clientY: 100 });
    }
    fireEvent.click(resultImage);
    const preview = screen.getByAltText('预览') as HTMLImageElement;
    expect(preview.getAttribute('src')).toBe('/skill-preview.png');
    expect(preview.parentElement?.style.width).toBe('80vw');
    expect(preview.parentElement?.style.height).toBe('80vh');
    expect(preview.style.width).toBe('100%');
    expect(preview.style.height).toBe('100%');
    expect(preview.style.objectFit).toBe('contain');
    const createObjectUrl = vi.fn(() => 'blob:workflow-skill-preview');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: '下载预览图片' }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    await waitFor(
      () => expect(revokeObjectUrl).toHaveBeenCalledWith('blob:workflow-skill-preview'),
      { timeout: 1_500 },
    );
    expect(requests).toContain('/skill-preview.png');
    fireEvent.click(preview);
    expect(screen.queryByAltText('预览')).toBeNull();
    expect(requests.some(url => url === '/api/workflow/execute' || url === '/api/skill-runs')).toBe(false);
  });

  it('persists a remote Skill result before download when the direct fetch fails', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (url.includes('/api/skill-runs/preview-run')) return new Response(JSON.stringify({ run: {
        runId: 'preview-run', projectId: 'project-a', workspaceId: 'workflow:preview-workflow',
        surface: 'workflow', skillId: workflowSkill.id, skillVersion: 2, status: 'completed',
        assetVersionIds: ['preview-version'],
      } }));
      if (url.startsWith('/api/assets?')) return new Response(JSON.stringify({
        assetVersionId: 'preview-version', url: 'https://media.example/skill-preview.png',
      }));
      if (url === 'https://media.example/skill-preview.png') return new Response('', { status: 502 });
      if (url === '/api/save-image') return new Response(JSON.stringify({ success: true, url: '/api/serve-upload/persisted.png' }));
      if (url === '/api/serve-upload/persisted.png') return new Response('png');
      return new Response('{}');
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:persisted-preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = { ...node.config, skillId: workflowSkill.id, version: 2, runId: 'preview-run' };
    render(<NodeEditor workflow={{ ...createEmptyWorkflow('Preview'), id: 'preview-workflow', nodes: [node] }} projectId="project-a" canvasImages={[]} />);
    await waitFor(() => expect(document.querySelector('img[src="https://media.example/skill-preview.png"]')).not.toBeNull());
    fireEvent.click(document.querySelector('img[src="https://media.example/skill-preview.png"]')!);
    fireEvent.click(screen.getByRole('button', { name: '下载预览图片' }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    const persistRequest = requests.find(request => request.url === '/api/save-image');
    expect(persistRequest?.init?.method).toBe('POST');
    expect(JSON.parse(String(persistRequest?.init?.body))).toEqual({ imageUrl: 'https://media.example/skill-preview.png' });
    expect(requests.some(request => request.url === '/api/serve-upload/persisted.png')).toBe(true);
  });

  it.each([['paused', '已暂停'], ['cancelled', '已取消']] as const)('renders restored %s state and cleans observation on unmount', async (status, label) => {
    vi.useFakeTimers();
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/skill-runs/status-run')) {
        reads++;
        return new Response(JSON.stringify({ run: { runId: 'status-run', projectId: 'project-a',
          workspaceId: 'workflow:status-workflow', surface: 'workflow', skillId: workflowSkill.id,
          skillVersion: 2, status, assetVersionIds: [] } }));
      }
      return new Response('{}');
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = { ...node.config, skillId: workflowSkill.id, version: 2, runId: 'status-run' };
    try {
      const view = render(<NodeEditor workflow={{ ...createEmptyWorkflow('Status'), id: 'status-workflow', nodes: [node] }} projectId="project-a" canvasImages={[]} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(within(screen.getByLabelText(node.label)).getByText(label)).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
      expect(reads).toBe(status === 'cancelled' ? 1 : 3);
      view.unmount();
      const lastReads = reads;
      await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
      expect(reads).toBe(lastReads);
    } finally { cleanup(); vi.useRealTimers(); }
  });

  it.each(['normal', 'timeout'] as const)('observes a saved running Skill after %s until completion without restarting it and stops at terminal state', async scenario => {
    vi.useFakeTimers();
    let reads = 0;
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(url);
      if (url.includes('/api/skill-runs/running-run')) {
        reads++;
        if (scenario === 'timeout' && reads === 1) return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        });
        return new Response(JSON.stringify({ run: {
          runId: 'running-run', projectId: 'project-a', workspaceId: 'workflow:running-workflow', surface: 'workflow',
          skillId: workflowSkill.id, skillVersion: 2, status: reads === 1 ? 'executing' : 'completed',
          assetVersionIds: reads === 1 ? [] : ['completed-version'],
        } }));
      }
      if (url.startsWith('/api/assets?')) return new Response(JSON.stringify({ assetVersionId: 'completed-version', url: '/completed-result.png' }));
      return new Response('{}');
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = { ...node.config, skillId: workflowSkill.id, version: 2, runId: 'running-run' };
    try {
      render(<NodeEditor workflow={{ ...createEmptyWorkflow('Running'), id: 'running-workflow', nodes: [node] }} projectId="project-a" canvasImages={[]} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      if (scenario === 'normal') expect(within(screen.getByLabelText(node.label)).getByText('运行中')).toBeTruthy();
      else await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(document.querySelector('img[src="/completed-result.png"]')).not.toBeNull();
      const preview = document.querySelector<HTMLImageElement>('img[src="/completed-result.png"]')!;
      expect(preview.style.width).toBe('100%');
      expect(preview.style.height).toBe('100%');
      expect(preview.style.objectFit).toBe('contain');
      const terminalReads = reads;
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(reads).toBe(terminalReads);
      expect(requests.some(url => url === '/api/workflow/execute' || url === '/api/skill-runs')).toBe(false);
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it('removes an old preview when the saved run changes before the new result returns', async () => {
    let resolveNew!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { resolveNew = resolve; });
    const run = (runId: string, version: string) => ({ run: {
      runId, projectId: 'project-a', workspaceId: 'workflow:rerun-workflow', surface: 'workflow',
      skillId: workflowSkill.id, skillVersion: 2, status: 'completed', assetVersionIds: [version],
    } });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/skill-runs/old-run')) return new Response(JSON.stringify(run('old-run', 'old-version')));
      if (url.includes('/api/skill-runs/new-run')) return pending;
      if (url.startsWith('/api/assets?')) {
        const version = new URL(url, 'https://test.invalid').searchParams.get('assetVersionId');
        return new Response(JSON.stringify({ assetVersionId: version, url: `/${version}.png` }));
      }
      return new Response('{}');
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = { ...node.config, skillId: workflowSkill.id, version: 2, runId: 'old-run' };
    const workflow = { ...createEmptyWorkflow('Rerun'), id: 'rerun-workflow', nodes: [node] };
    const view = render(<NodeEditor workflow={workflow} projectId="project-a" canvasImages={[]} />);
    await waitFor(() => expect(document.querySelector('img[src="/old-version.png"]')).not.toBeNull());
    view.rerender(<NodeEditor workflow={{ ...workflow, nodes: [{ ...node, config: { ...node.config, runId: 'new-run' } }] }} projectId="project-a" canvasImages={[]} />);
    expect(document.querySelector('img[src="/old-version.png"]')).toBeNull();
    await act(async () => { resolveNew(new Response(JSON.stringify(run('new-run', 'new-version')))); await pending; });
    await waitFor(() => expect(document.querySelector('img[src="/new-version.png"]')).not.toBeNull());
  });

  it('continues restoring other nodes after one saved run times out', async () => {
    vi.useFakeTimers();
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(url);
      if (url.includes('/api/skill-runs/slow-run')) return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
      if (url.includes('/api/skill-runs/fast-run')) return new Response(JSON.stringify({ run: {
        runId: 'fast-run', projectId: 'project-a', workspaceId: 'workflow:multi-restore', surface: 'workflow',
        skillId: workflowSkill.id, skillVersion: 2, status: 'completed', assetVersionIds: ['fast-version'],
      } }));
      if (url.startsWith('/api/assets?')) return new Response(JSON.stringify({ assetVersionId: 'fast-version', url: '/fast-result.png' }));
      return new Response('{}');
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const nodes = ['slow-run', 'fast-run'].map(runId => {
      const node = createWorkflowNode('ai-skill', 0, 0);
      node.config = { ...node.config, skillId: workflowSkill.id, version: 2, runId };
      return node;
    });
    try {
      render(<NodeEditor workflow={{ ...createEmptyWorkflow('Multi restore'), id: 'multi-restore', nodes }} projectId="project-a" canvasImages={[]} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(requests).toContain('/api/skill-runs/fast-run?observeOnly=true');
      expect(document.querySelector('img[src="/fast-result.png"]')).not.toBeNull();
      expect(screen.getByText('Skill 结果恢复超时，正在重试，不会重新生成或扣费')).toBeTruthy();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it('ignores a late execution status after the user changes in the same project', async () => {
    const key = `wujie_workflow_exec_state:v2:${JSON.stringify(['user-a', 'project-a', 'workflow-a'])}`;
    const stored = new Map([[key, JSON.stringify({ executionId: 'old-execution', execStatus: 'running', nodeIds: ['node-a'] })]]);
    const writes: string[] = [];
    vi.stubGlobal('localStorage', { getItem: (name: string) => stored.get(name) ?? null,
      setItem: (name: string, value: string) => { writes.push(name); stored.set(name, value); }, removeItem: (name: string) => stored.delete(name) });
    let resolveStatus!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { resolveStatus = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/workflow/execute' ? pending : new Response('{}')));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const workflow = { ...createEmptyWorkflow('Late execution'), id: 'workflow-a' };
    const view = render(<NodeEditor workflow={workflow} userId="user-a" projectId="project-a" canvasImages={[]} />);
    view.rerender(<NodeEditor workflow={workflow} userId="user-b" projectId="project-a" canvasImages={[]} />);
    await act(async () => {
      resolveStatus(new Response(JSON.stringify({ status: 'completed', results: {} })));
      await pending;
    });
    expect(screen.queryByText('执行完成')).toBeNull();
    expect(writes.filter(name => name.startsWith('wujie_workflow_exec_state'))).toEqual([]);
  });

  it.each(['legacy', 'other-user', 'other-project', 'other-workflow', 'matching'])('isolates persisted running execution: %s', async scenario => {
    const identity = ['user-a', 'project-a', 'workflow-a'];
    if (scenario === 'other-user') identity[0] = 'user-b';
    if (scenario === 'other-project') identity[1] = 'project-b';
    if (scenario === 'other-workflow') identity[2] = 'workflow-b';
    const key = scenario === 'legacy' ? 'wujie_workflow_exec_state'
      : `wujie_workflow_exec_state:v2:${JSON.stringify(identity)}`;
    const stored = new Map([[key, JSON.stringify({ executionId: 'stored-execution', execStatus: 'running', nodeIds: ['node-a'], execResults: {}, execLogs: [] })]]);
    vi.stubGlobal('localStorage', { getItem: (name: string) => stored.get(name) ?? null,
      setItem: (name: string, value: string) => stored.set(name, value), removeItem: (name: string) => stored.delete(name) });
    const statuses: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/workflow/execute') statuses.push(String(init?.body));
      return new Response(JSON.stringify({ status: 'processing' }));
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    await act(async () => {
      render(<NodeEditor workflow={{ ...createEmptyWorkflow('Cache isolation'), id: 'workflow-a' }} userId="user-a" projectId="project-a" canvasImages={[]} />);
    });
    expect(statuses).toHaveLength(scenario === 'matching' ? 1 : 0);
    if (scenario !== 'matching') expect(stored.has(key)).toBe(true);
  });

  it('reports restoration timeout without submitting another paid run', async () => {
    vi.useFakeTimers();
    const requests: string[] = [];
    let restoreSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(url);
      if (url.includes('/api/skill-runs/')) {
        restoreSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          restoreSignal?.addEventListener('abort', () => reject(restoreSignal?.reason), { once: true });
        });
      }
      return new Response('{}');
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = { ...node.config, skillId: workflowSkill.id, version: 2, runId: 'slow-run' };
    try {
      render(<NodeEditor workflow={{ ...createEmptyWorkflow('Slow restore'), nodes: [node] }} projectId="project-a" canvasImages={[]} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(restoreSignal?.aborted).toBe(true);
      expect(screen.getByText('Skill 结果恢复超时，正在重试，不会重新生成或扣费')).toBeTruthy();
      expect(requests.some(url => url === '/api/workflow/execute' || url === '/api/skill-runs')).toBe(false);
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it('aborts pending restoration and ignores a late response after project change', async () => {
    let complete!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    const pending = new Promise<Response>(resolve => { complete = resolve; });
    const assetRequests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/skill-runs/')) { signal = init?.signal as AbortSignal; return pending; }
      if (url.startsWith('/api/assets?')) assetRequests.push(url);
      return new Response('{}');
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = { ...node.config, skillId: workflowSkill.id, version: 2, runId: 'late-run' };
    const workflow = { ...createEmptyWorkflow('Late restore'), id: 'wf', nodes: [node] };
    const view = render(<NodeEditor workflow={workflow} projectId="project-a" canvasImages={[]} />);
    await waitFor(() => expect(signal).toBeDefined());
    view.rerender(<NodeEditor workflow={{ ...workflow, nodes: [] }} projectId="project-b" canvasImages={[]} />);
    expect(signal?.aborted).toBe(true);
    complete(new Response(JSON.stringify({ run: {
      runId: 'late-run', projectId: 'project-a', surface: 'workflow', workspaceId: 'workflow:wf',
      skillId: workflowSkill.id, skillVersion: 2, status: 'completed', assetVersionIds: ['late-version'],
    } })));
    await pending;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(assetRequests).toEqual([]);
  });

  it('clears an already restored result when switching projects', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/skill-runs/')) return new Response(JSON.stringify({ run: {
        runId: 'saved-run', projectId: 'project-a', surface: 'workflow', workspaceId: 'workflow:shared-id',
        skillId: workflowSkill.id, skillVersion: 2, status: 'completed', assetVersionIds: ['result-version'],
      } }));
      if (url.startsWith('/api/assets?')) return new Response(JSON.stringify({ assetVersionId: 'result-version', url: '/project-a-only.png' }));
      return new Response('{}');
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = { ...node.config, skillId: workflowSkill.id, version: 2, runId: 'saved-run' };
    const workflow = { ...createEmptyWorkflow('Restore scope'), id: 'shared-id', nodes: [node] };
    const view = render(<NodeEditor workflow={workflow} projectId="project-a" canvasImages={[]} />);
    await waitFor(() => expect(document.querySelector('img[src="/project-a-only.png"]')).not.toBeNull());
    view.rerender(<NodeEditor workflow={{ ...workflow, nodes: [{ ...node, config: { ...node.config, runId: undefined } }] }} projectId="project-b" canvasImages={[]} />);
    await waitFor(() => expect(document.querySelector('img[src="/project-a-only.png"]')).toBeNull());
  });

  it.each(['projectId', 'workspaceId', 'runId', 'skillId', 'skillVersion'])('rejects saved run %s mismatches before reading assets', async field => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ run: {
      runId: 'run', projectId: 'project', workspaceId: 'workflow:wf', surface: 'workflow',
      skillId: 'skill', skillVersion: 1, status: 'completed', assetVersionIds: ['asset-version'], [field]: 'wrong',
    } })));
    await expect(loadSavedWorkflowSkillResult({ runId: 'run', projectId: 'project', workflowId: 'wf', skillId: 'skill',
      skillVersion: 1, signal: new AbortController().signal, fetcher })).rejects.toThrow('不匹配');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves saved text outputs without creating a run', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ run: {
      runId: 'run', projectId: 'project', workspaceId: 'workflow:wf', surface: 'workflow',
      skillId: 'skill', skillVersion: 1, status: 'completed', assetVersionIds: [],
      outputs: [{ stepId: 'brief', kind: 'text', content: 'Saved brief' }],
    } })));
    const result = await loadSavedWorkflowSkillResult({ runId: 'run', projectId: 'project', workflowId: 'wf', skillId: 'skill',
      skillVersion: 1, signal: new AbortController().signal, fetcher });
    expect(result.output.text).toBe('Saved brief');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('restores a saved Skill result through read-only run and asset queries without generating again', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url);
      if (url === '/api/skill-runs/saved-run?observeOnly=true') return new Response(JSON.stringify({ run: {
        runId: 'saved-run', projectId: 'project-a', surface: 'workflow', workspaceId: 'workflow:saved-workflow',
        skillId: workflowSkill.id, skillVersion: workflowSkill.version, status: 'completed',
        sourceVersionIds: [], assetVersionIds: ['version-result'], outputs: [],
      } }));
      if (url.startsWith('/api/assets?')) return new Response(JSON.stringify({ assetId: 'result-asset', assetVersionId: 'version-result', url: '/result.png' }));
      return new Response('{}');
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = { ...node.config, skillId: workflowSkill.id, version: workflowSkill.version, runId: 'saved-run' };
    render(<NodeEditor workflow={{ ...createEmptyWorkflow('Restore'), id: 'saved-workflow', nodes: [node] }} projectId="project-a" canvasImages={[]} />);
    await waitFor(() => expect(document.querySelector('img[src="/result.png"]')).not.toBeNull());
    expect(requests).toContain('/api/skill-runs/saved-run?observeOnly=true');
    expect(requests.some(url => url === '/api/workflow/execute' || url === '/api/skill-runs')).toBe(false);
  });

  it.each(['completed', 'failed'] as const)('shows cascade progress for %s within its execution scope and leaves unrelated nodes idle', async status => {
    const stored = new Map<string, string>();
    const removeItem = vi.fn((key: string) => stored.delete(key));
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/workflow/execute') {
        const request = JSON.parse(String(init?.body));
        if (request.action === 'start') return new Response(JSON.stringify({ executionId: 'scope-display-run' }));
        return new Response(JSON.stringify({ status, results: status === 'failed' ? { [selected.id]: { status: 'failed' } } : {} }));
      }
      return new Response('{}');
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const selected = createWorkflowNode('input-text', 0, 0);
    const unrelated = { ...createWorkflowNode('input-text', 0, 0), label: 'Unrelated node' };
    render(<NodeEditor workflow={{ ...createEmptyWorkflow('Scoped progress'), nodes: [selected, unrelated] }} projectId="project-a" canvasImages={[]} />);
    fireEvent.click(screen.getAllByTitle('运行此链')[0]);
    await screen.findByText(status === 'failed' ? '执行失败' : '执行完成');
    await waitFor(() => expect(removeItem).toHaveBeenCalledWith(expect.stringContaining('wujie_workflow_exec_state:v2:')), { timeout: 4000 });
    expect(screen.getByText(status === 'failed' ? '1/1' : '0/1')).toBeTruthy();
    expect(within(screen.getByLabelText('Unrelated node')).getByText('就绪')).toBeTruthy();
  });

  it('discards an in-flight quote when the project changes', async () => {
    let finishQuote!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { finishQuote = resolve; });
    let estimateSignal: AbortSignal | undefined;
    const submissions: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/skills?surface=workflow') return new Response(JSON.stringify({ skills: [workflowSkill] }));
      if (url === '/api/skill-runs/estimate') { estimateSignal = init?.signal as AbortSignal; return pending; }
      if (url === '/api/workflow/execute') submissions.push(init?.body);
      return new Response('{}');
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = { ...node.config, skillId: workflowSkill.id, version: workflowSkill.version, inputValues: { brief: 'test' } };
    const workflow = { ...createEmptyWorkflow('Pending quote'), nodes: [node] };
    const view = render(<NodeEditor workflow={workflow} projectId="project-a" canvasImages={[]} />);
    fireEvent.mouseDown(screen.getByLabelText(node.label), { button: 0 });
    fireEvent.mouseUp(screen.getByLabelText(node.label), { button: 0 });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Skill' }).textContent).toContain(workflowSkill.name));
    fireEvent.click(screen.getByRole('button', { name: '执行工作流' }));
    await waitFor(() => expect(estimateSignal).toBeDefined());
    view.rerender(<NodeEditor workflow={workflow} projectId="project-b" canvasImages={[]} />);
    expect(estimateSignal?.aborted).toBe(true);
    finishQuote(new Response(JSON.stringify({ minimum: 62, maximum: 62, modelBindings: {
      image: { providerId: 'p', modelId: 'i' }, orchestrator: { providerId: 'p', modelId: 'c' },
    } })));
    await waitFor(() => expect(screen.queryByText('正在预估 Skill 积分…')).toBeNull());
    expect(screen.queryByRole('dialog', { name: 'Skill 费用预估' })).toBeNull();
    expect(submissions).toEqual([]);
  });

  it.each(['confirm', 'cancel', 'expire'] as const)('handles a successful estimate with %s without premature execution', async action => {
    const submissions: Array<Record<string, unknown>> = [];
    const bindings = {
      image: { providerId: 'provider-a', modelId: 'image-model' },
      orchestrator: { providerId: 'provider-chat', modelId: 'chat-model' },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/skills?surface=workflow') return new Response(JSON.stringify({ skills: [workflowSkill] }));
      if (url === '/api/skill-runs/estimate') return new Response(JSON.stringify({ minimum: 62, maximum: 62, modelBindings: bindings }));
      if (url === '/api/workflow/execute') submissions.push(JSON.parse(String(init?.body)));
      return new Response('{}');
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = { ...node.config, skillId: workflowSkill.id, version: workflowSkill.version, inputValues: { brief: '商品摄影' }, modelBindings: bindings };
    render(<NodeEditor workflow={{ ...createEmptyWorkflow('Estimate'), nodes: [node] }} projectId="project-a" canvasImages={[]} />);
    fireEvent.mouseDown(screen.getByLabelText(node.label), { button: 0 });
    fireEvent.mouseUp(screen.getByLabelText(node.label), { button: 0 });
    await screen.findByRole('combobox', { name: 'Skill' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Skill' }).textContent).toContain(workflowSkill.name));
    fireEvent.click(screen.getByRole('button', { name: '执行工作流' }));
    await screen.findByRole('dialog', { name: 'Skill 费用预估' });
    expect(screen.getByText('62 积分')).toBeTruthy();
    expect(submissions).toHaveLength(0);
    if (action === 'cancel') {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
      expect(submissions).toHaveLength(0);
    } else {
      if (action === 'expire') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000);
      const confirm = screen.getByRole('button', { name: '确认执行' });
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      if (action === 'expire') {
        expect(await screen.findByText('预估已过期或配置已变化，请重新执行以获取预估')).toBeTruthy();
        expect(submissions).toHaveLength(0);
      } else {
        await waitFor(() => expect(submissions).toHaveLength(1));
        expect(submissions[0]).toMatchObject({ nodes: [{ config: { modelBindings: bindings } }] });
      }
    }
  });

  it('limits cascade submission to the selected chain rather than disconnected nodes', async () => {
    const submissions: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/workflow/execute' && typeof init?.body === 'string') {
        submissions.push(JSON.parse(init.body));
      }
      return new Response('{}', { status: 200 });
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const selected = createWorkflowNode('input-text', 0, 0);
    const unrelated = createWorkflowNode('input-text', 500, 0);
    const workflow = { ...createEmptyWorkflow('Cascade scope'), nodes: [selected, unrelated] };
    render(<NodeEditor workflow={workflow} projectId="project-a" canvasImages={[]} />);
    fireEvent.click(screen.getAllByTitle('运行此链')[0]);
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect((submissions[0].nodes as Array<{ id: string }>).map(node => node.id)).toEqual([selected.id]);
  });

  it('does not create a workflow before a Skill estimate succeeds', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      requests.push({ url, body });
      if (url === '/api/skills?surface=workflow') {
        return new Response(JSON.stringify({ skills: [workflowSkill] }), { status: 200 });
      }
      if (url === '/api/skill-runs/estimate') {
        return new Response(JSON.stringify({ code: 'ESTIMATE_UNAVAILABLE', error: '费用预估暂不可用' }), { status: 503 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });

    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = {
      ...node.config,
      skillId: workflowSkill.id,
      version: workflowSkill.version,
      inputValues: { brief: '一杯抹茶拿铁商品摄影' },
      modelBindings: { image: { providerId: 'provider-a', modelId: 'image-model' } },
    };
    const workflow = { ...createEmptyWorkflow('Skill estimate workflow'), nodes: [node] };
    render(<NodeEditor workflow={workflow} projectId="project-a" canvasImages={[]} />);
    await waitFor(() => expect(requests.some(item => item.url === '/api/skills?surface=workflow')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '执行工作流' }));

    await waitFor(() => {
      expect(requests.some(item => item.url === '/api/skill-runs/estimate')
        || requests.some(item => item.url === '/api/workflow/execute')).toBe(true);
    });
    expect(requests.filter(item => item.url === '/api/workflow/execute' && item.body.action === 'start')).toEqual([]);
    expect(requests.find(item => item.url === '/api/skill-runs/estimate')?.body).toMatchObject({
      skillId: workflowSkill.id,
      skillVersion: workflowSkill.version,
      surface: 'workflow',
      projectId: 'project-a',
      modelBindings: { image: { providerId: 'provider-a', modelId: 'image-model' } },
    });
    expect(await screen.findByText('费用预估暂不可用')).toBeTruthy();
  });

  it('keeps the execution id when workflow cancellation is not confirmed', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/node-editor.tsx'), 'utf8');
    expect(source).toContain('if (!response.ok)');
    expect(source).toContain("data.error || '取消工作流失败'");
  });

  it('loads only the workflow catalog and renders shared dynamic inputs', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/skills?surface=workflow') {
        return new Response(JSON.stringify({ skills: [workflowSkill] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });

    const node = createWorkflowNode('ai-skill', 0, 0);
    const workflow = { ...createEmptyWorkflow('Skill workflow'), nodes: [node] };
    render(<NodeEditor workflow={workflow} projectId="project-a" canvasImages={[]} />);

    fireEvent.mouseDown(screen.getByLabelText(node.label), { button: 0 });
    fireEvent.mouseUp(screen.getByLabelText(node.label), { button: 0 });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/skills?surface=workflow',
      expect.objectContaining({ method: 'GET' }),
    ));

    const skillSelect = await screen.findByRole('combobox', { name: 'Skill' });
    expect(screen.queryByText('独立对话 Skill')).toBeNull();
    fireEvent.change(skillSelect, { target: { value: workflowSkill.id } });
    expect(await screen.findByLabelText('产品需求')).toBeTruthy();
  });

  it('renders all marketing Skills and their structured inputs from the workflow catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/skills?surface=workflow') {
        return new Response(JSON.stringify({ skills: marketingWorkflowSkills }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });

    const node = createWorkflowNode('ai-skill', 0, 0);
    render(<NodeEditor workflow={{ ...createEmptyWorkflow('Marketing Skills'), nodes: [node] }} projectId="project-a" canvasImages={[]} />);
    fireEvent.mouseDown(screen.getByLabelText(node.label), { button: 0 });
    fireEvent.mouseUp(screen.getByLabelText(node.label), { button: 0 });

    const skillSelect = await screen.findByRole('combobox', { name: 'Skill' });
    expect(within(skillSelect).getByRole('option', { name: '广告 A/B 变体' })).toBeTruthy();
    expect(within(skillSelect).getByRole('option', { name: '再营销素材' })).toBeTruthy();
    expect(within(skillSelect).getByRole('option', { name: '全渠道活动素材包' })).toBeTruthy();
    fireEvent.change(skillSelect, { target: { value: 'preset-omnichannel-campaign' } });
    expect(await screen.findByLabelText('活动名称')).toBeTruthy();
    expect(screen.getByRole('group', { name: /投放渠道/ })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: '小红书' })).toBeTruthy();
  });

  it('shows AssetVersion inputs bound through an upstream image connection', async () => {
    const boundSkill = {
      ...workflowSkill,
      id: 'bound-source-skill',
      name: '来源绑定 Skill',
      inputs: [{
        key: 'sourceImages', label: '来源图片', kind: 'images', required: true,
        maximumItems: 6, bindToSourceVersions: true,
      }],
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/skills?surface=workflow') {
        return new Response(JSON.stringify({ skills: [boundSkill] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });

    const source = createWorkflowNode('input-image', -300, 0);
    source.config = { ...source.config, imageUrl: '/logo.png', assetVersionId: 'asset-version-1' };
    const skillNode = createWorkflowNode('ai-skill', 0, 0);
    const workflow = {
      ...createEmptyWorkflow('Bound source'),
      nodes: [source, skillNode],
      connections: [{
        id: 'source-to-skill', fromNodeId: source.id, fromPortId: 'out-image',
        toNodeId: skillNode.id, toPortId: 'in-image', type: 'image' as const,
      }],
    };
    render(<NodeEditor workflow={workflow} projectId="project-a" canvasImages={[]} />);
    fireEvent.mouseDown(screen.getByLabelText(skillNode.label), { button: 0 });
    fireEvent.mouseUp(screen.getByLabelText(skillNode.label), { button: 0 });
    const skillSelect = await screen.findByRole('combobox', { name: 'Skill' });
    fireEvent.change(skillSelect, { target: { value: boundSkill.id } });

    expect(await screen.findByText('已选择 1 张来源图片')).toBeTruthy();
  });
});
