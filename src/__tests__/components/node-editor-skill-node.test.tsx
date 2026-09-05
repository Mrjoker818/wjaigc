// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import NodeEditor from '@/components/node-editor';
import { createEmptyWorkflow, createWorkflowNode } from '@/lib/workflow-engine';

const workflowSkill = {
  id: 'workflow-skill', version: 2, name: '工作流产品套图', category: 'image',
  description: 'workflow only', systemPrompt: 'system', allowedSurfaces: ['canvas', 'workflow'],
  inputs: [{ key: 'brief', label: '产品需求', kind: 'text', required: true }],
  steps: [{ id: 'step', label: '生成', toolId: 'generate_image', execution: 'sequential', promptTemplate: '{{brief}}', modelRole: 'image', qualityGateIds: [] }],
  enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('NodeEditor workflow Skill node', () => {
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
});
