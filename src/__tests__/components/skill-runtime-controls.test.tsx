// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SkillInputFields } from '@/components/skill-runtime/SkillInputFields';
import { SkillRunProgress } from '@/components/skill-runtime/SkillRunProgress';
import { useSkillRun } from '@/components/skill-runtime/use-skill-run';
import type { AgentRunProjection } from '@/lib/agent-runtime/types';
import type { SkillDefinition, SkillInputField } from '@/lib/skill-runtime/types';

const agentEvents = vi.hoisted(() => ({
  useAgentRunEvents: vi.fn((runId: string | undefined) => {
    void runId;
    return {
      projection: undefined,
      stale: false,
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    };
  }),
}));

vi.mock('@/components/agent-runtime/use-agent-run-events', () => agentEvents);

const fields: readonly SkillInputField[] = [
  { key: 'prompt', label: '创意描述', kind: 'text', required: true },
  { key: 'hero', label: '主图', kind: 'image', required: true },
  { key: 'references', label: '参考图', kind: 'images', required: false, maximumItems: 2 },
  { key: 'brand', label: '品牌套件', kind: 'brand-kit', required: false },
  { key: 'rows', label: '数据集', kind: 'dataset', required: false },
  { key: 'style', label: '风格', kind: 'select', required: true, options: ['简约', '明亮'] },
  { key: 'count', label: '数量', kind: 'number', required: false },
  { key: 'transparent', label: '透明背景', kind: 'boolean', required: false },
];

const definition: SkillDefinition = {
  id: 'skill-1', version: 3, name: '商品设计', category: 'design', description: 'test',
  systemPrompt: 'test', allowedSurfaces: ['canvas'], inputs: fields, steps: [], enabled: true,
  builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
};

const projection = (overrides: Partial<AgentRunProjection> = {}): AgentRunProjection => ({
  runId: 'run-1', status: 'executing', lastSequence: 2,
  plan: [
    { id: 'draft', label: '整理需求', status: 'completed' },
    { id: 'render', label: '生成画面', status: 'active' },
  ],
  currentStepId: 'render', progress: 45, assetVersionIds: [], ignoredEventIds: [],
  missingSequences: [], qualityChecks: [], ...overrides,
});

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => body } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  agentEvents.useAgentRunEvents.mockClear();
});

describe('SkillInputFields', () => {
  it('renders all eight field kinds with accessible labels, constraints, values, and errors', () => {
    const onChange = vi.fn();
    render(<SkillInputFields
      fields={fields}
      values={{
        prompt: '海报', hero: 'version-hero', references: ['version-a'], brand: 'brand-1',
        rows: [{ sku: 'A-1' }], style: '简约', count: 2, transparent: true,
      }}
      errors={{ prompt: '创意描述不能为空' }}
      onChange={onChange}
    />);

    expect(screen.getByLabelText('创意描述').getAttribute('maxlength')).toBe('16384');
    expect((screen.getByLabelText('主图') as HTMLInputElement).value).toBe('version-hero');
    expect((screen.getByLabelText('参考图') as HTMLTextAreaElement).value).toBe('version-a');
    expect(screen.getByLabelText('参考图').getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('最多 2 项')).toBeTruthy();
    expect((screen.getByLabelText('品牌套件') as HTMLInputElement).value).toBe('brand-1');
    expect((screen.getByLabelText('数据集') as HTMLTextAreaElement).value)
      .toBe(JSON.stringify([{ sku: 'A-1' }], null, 2));
    expect((screen.getByLabelText('风格') as HTMLSelectElement).value).toBe('简约');
    expect((screen.getByLabelText('数量') as HTMLInputElement).valueAsNumber).toBe(2);
    expect((screen.getByLabelText('透明背景') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('创意描述不能为空');
    expect(screen.getByLabelText('创意描述').getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '4' } });
    fireEvent.click(screen.getByLabelText('透明背景'));
    fireEvent.change(screen.getByLabelText('数据集'), { target: { value: '[{"sku":"B-2"}]' } });
    expect(onChange).toHaveBeenCalledWith('count', 4);
    expect(onChange).toHaveBeenCalledWith('transparent', false);
    expect(onChange).toHaveBeenCalledWith('rows', [{ sku: 'B-2' }]);
  });

  it('reports invalid dataset JSON and uses UTF-8 bytes for the serialized capacity boundary', () => {
    const onChange = vi.fn();
    render(<SkillInputFields fields={fields} values={{}} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('数据集'), { target: { value: '{' } });
    expect(screen.getByRole('alert').textContent).toContain('请输入有效的 JSON 数组');
    expect(onChange).not.toHaveBeenCalledWith('rows', expect.anything());

    fireEvent.change(screen.getByLabelText('创意描述'), {
      target: { value: '界'.repeat(16_384) },
    });
    expect(onChange).toHaveBeenCalledWith('prompt', '界'.repeat(16_384));

    fireEvent.change(screen.getByLabelText('数据集'), {
      target: { value: JSON.stringify([{ value: '界'.repeat(180_000) }]) },
    });
    expect(screen.getByRole('alert').textContent).toContain('输入内容超过 512 KiB');
  });

  it('enforces the serialized UTF-8 limit when a plain field crosses the combined boundary', () => {
    const onChange = vi.fn();
    render(<SkillInputFields
      fields={fields}
      values={{ rows: [{ value: '界'.repeat(170_000) }] }}
      onChange={onChange}
    />);

    fireEvent.change(screen.getByLabelText('创意描述'), {
      target: { value: 'x'.repeat(16_384) },
    });

    expect(screen.getByRole('alert').textContent).toContain('输入内容超过 512 KiB');
    expect(onChange).not.toHaveBeenCalledWith('prompt', expect.anything());
  });

  it('enforces object rows, row limits, finite numbers, and external draft resets', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SkillInputFields
      fields={fields}
      values={{ references: ['old'], rows: [{ sku: 'old' }] }}
      onChange={onChange}
    />);

    fireEvent.change(screen.getByLabelText('数据集'), { target: { value: '[1]' } });
    expect(screen.getByRole('alert').textContent).toContain('每一行必须是对象');
    fireEvent.change(screen.getByLabelText('数据集'), {
      target: { value: JSON.stringify(Array.from({ length: 1_001 }, () => ({}))) },
    });
    expect(screen.getByRole('alert').textContent).toContain('最多允许 1000 行');

    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '1e309' } });
    expect(onChange).not.toHaveBeenCalledWith('count', Number.POSITIVE_INFINITY);

    fireEvent.change(screen.getByLabelText('参考图'), { target: { value: 'draft' } });
    rerender(<SkillInputFields
      fields={fields}
      values={{ references: ['new'], rows: [{ sku: 'new' }] }}
      onChange={onChange}
    />);
    expect((screen.getByLabelText('参考图') as HTMLTextAreaElement).value).toBe('new');
    expect((screen.getByLabelText('数据集') as HTMLTextAreaElement).value)
      .toBe(JSON.stringify([{ sku: 'new' }], null, 2));
  });
});

describe('SkillRunProgress', () => {
  it('shows the estimate, projected phase, progress, and active controls', () => {
    const onPause = vi.fn();
    const onCancel = vi.fn();
    render(<SkillRunProgress
      estimate={{ minimum: 5, maximum: 8, steps: [{ stepId: 'render', cost: 8 }] }}
      projection={projection()}
      onPause={onPause}
      onCancel={onCancel}
    />);

    expect(screen.getByText('预计 5-8 积分')).toBeTruthy();
    expect(screen.getByText('正在执行')).toBeTruthy();
    expect(screen.getByText('生成画面')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('45');
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onPause).toHaveBeenCalledWith('render');
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows persisted paused-step controls and terminal errors only when applicable', () => {
    const onResume = vi.fn();
    const onRetry = vi.fn();
    const { rerender } = render(<SkillRunProgress
      projection={projection({ status: 'paused', resumeFromStepId: 'render' })}
      onResume={onResume}
      onRetry={onRetry}
    />);
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '从失败步骤重试' }));
    expect(onResume).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith('render');

    rerender(<SkillRunProgress
      projection={projection({ status: 'paused', resumeFromStepId: 'render' })}
      stale
    />);
    expect(screen.getByText('已暂停')).toBeTruthy();

    rerender(<SkillRunProgress
      projection={projection({
        status: 'failed',
        plan: [{ id: 'render', label: '生成画面', status: 'failed' }],
        error: { code: 'RENDER_FAILED', message: '生成失败', retryable: true },
      })}
      onRetry={onRetry}
    />);
    expect(screen.getByRole('alert').textContent).toContain('RENDER_FAILED');
    expect(screen.getByText('执行失败')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '从失败步骤重试' }));
    expect(onRetry).toHaveBeenCalledWith('render');
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
  });
});

describe('useSkillRun', () => {
  const request = {
    skillId: definition.id, skillVersion: definition.version, surface: 'canvas' as const,
    projectId: 'project-1', workspaceId: 'canvas-1', inputValues: { prompt: '海报' },
    sourceVersionIds: [], modelBindings: {
      orchestrator: { providerId: 'provider-1', modelId: 'chat-1' },
    }, idempotencyKey: 'request-1',
  };

  it('uses the existing estimate and Skill Run APIs and exposes control commands', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ minimum: 2, maximum: 3, steps: [] }))
      .mockResolvedValueOnce(jsonResponse({ runId: 'run-1', reused: false }))
      .mockResolvedValue(jsonResponse({ accepted: true }));
    const { result } = renderHook(() => useSkillRun({ fetcher: fetcher as typeof fetch }));

    await act(async () => { await result.current.estimateRun(request); });
    expect(result.current.estimate).toMatchObject({ minimum: 2, maximum: 3 });
    await act(async () => { await result.current.startRun(request); });
    expect(result.current.runId).toBe('run-1');
    await act(async () => {
      await result.current.pause();
      await result.current.resume();
      await result.current.cancel();
      await result.current.retry('render');
    });

    expect(fetcher).toHaveBeenCalledWith('/api/skill-runs/estimate', expect.objectContaining({ method: 'POST' }));
    expect(fetcher).toHaveBeenCalledWith('/api/skill-runs', expect.objectContaining({ method: 'POST' }));
    expect(fetcher).toHaveBeenCalledWith('/api/skill-runs/run-1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ action: 'pause' }),
    }));
    expect(fetcher).toHaveBeenCalledWith('/api/skill-runs/run-1/retry', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ stepId: 'render' }),
    }));
  });

  it('restarts the existing Agent event projection after resume, retry, and cancel', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ runId: 'run-1', reused: false }))
      .mockResolvedValue(jsonResponse({ accepted: true }));
    const { result } = renderHook(() => useSkillRun({ fetcher: fetcher as typeof fetch }));

    await act(async () => { await result.current.startRun(request); });
    await act(async () => { await result.current.resume(); });
    await waitFor(() => {
      const runIds = agentEvents.useAgentRunEvents.mock.calls.map(call => call[0]);
      expect(runIds.slice(-2)).toEqual([undefined, 'run-1']);
    });

    await act(async () => { await result.current.retry('render'); });
    await waitFor(() => {
      const runIds = agentEvents.useAgentRunEvents.mock.calls.map(call => call[0]);
      expect(runIds.slice(-2)).toEqual([undefined, 'run-1']);
    });

    await act(async () => { await result.current.cancel(); });
    await waitFor(() => {
      const runIds = agentEvents.useAgentRunEvents.mock.calls.map(call => call[0]);
      expect(runIds.slice(-2)).toEqual([undefined, 'run-1']);
    });
  });

  it('isolates a delayed old start response after a newer run starts', async () => {
    let resolveOld!: (response: Response) => void;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(jsonResponse({ runId: 'run-new', reused: false }));
    const { result } = renderHook(() => useSkillRun({ fetcher: fetcher as typeof fetch }));

    let oldRequest!: Promise<string | undefined>;
    act(() => { oldRequest = result.current.startRun(request); });
    await act(async () => {
      await result.current.startRun({ ...request, idempotencyKey: 'request-2' });
    });
    expect(result.current.runId).toBe('run-new');

    await act(async () => {
      resolveOld(jsonResponse({ runId: 'run-old', reused: false }));
      await expect(oldRequest).resolves.toBeUndefined();
    });
    expect(result.current.runId).toBe('run-new');
  });

  it('isolates estimates and keeps busy true while a newer start is pending', async () => {
    let resolveEstimate!: (response: Response) => void;
    let resolveStart!: (response: Response) => void;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveEstimate = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveStart = resolve; }));
    const { result } = renderHook(() => useSkillRun({ fetcher: fetcher as typeof fetch }));

    let pendingEstimate!: Promise<unknown>;
    let pendingStart!: Promise<unknown>;
    act(() => { pendingEstimate = result.current.estimateRun(request); });
    act(() => { pendingStart = result.current.startRun(request); });
    await act(async () => {
      resolveEstimate(jsonResponse({ minimum: 99, maximum: 99, steps: [] }));
      await pendingEstimate;
    });
    expect(result.current.estimate).toBeUndefined();
    expect(result.current.busy).toBe(true);

    await act(async () => {
      resolveStart(jsonResponse({ runId: 'run-1', reused: false }));
      await pendingStart;
    });
    expect(result.current.busy).toBe(false);
  });

  it('remains mounted through the Strict Mode effect replay', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ runId: 'run-1', reused: false }));
    const { result } = renderHook(
      () => useSkillRun({ fetcher: fetcher as typeof fetch }),
      { wrapper: StrictMode },
    );

    await act(async () => { await result.current.startRun(request); });
    expect(result.current.runId).toBe('run-1');
  });

  it('ignores a delayed control failure after a newer run starts', async () => {
    let rejectControl!: (error: Error) => void;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ runId: 'run-old', reused: false }))
      .mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => {
        rejectControl = reject;
      }))
      .mockResolvedValueOnce(jsonResponse({ runId: 'run-new', reused: false }));
    const { result } = renderHook(() => useSkillRun({ fetcher: fetcher as typeof fetch }));

    await act(async () => { await result.current.startRun(request); });
    let oldControl!: Promise<boolean>;
    act(() => { oldControl = result.current.cancel(); });
    await act(async () => {
      await result.current.startRun({ ...request, idempotencyKey: 'request-2' });
    });
    rejectControl(new Error('old control failed'));
    await act(async () => { await oldControl; });

    expect(result.current.runId).toBe('run-new');
    expect(result.current.error).toBeUndefined();
    expect(result.current.busy).toBe(false);
  });

  it('aborts in-flight requests and ignores late state writes after unmount', async () => {
    let signal: AbortSignal | undefined;
    let resolveRequest!: (response: Response) => void;
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal || undefined;
      return new Promise<Response>(resolve => { resolveRequest = resolve; });
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => useSkillRun({ fetcher: fetcher as typeof fetch }));

    let pending!: Promise<unknown>;
    act(() => { pending = result.current.estimateRun(request); });
    unmount();
    expect(signal?.aborted).toBe(true);
    resolveRequest(jsonResponse({ minimum: 1, maximum: 1, steps: [] }));
    await pending;
    await waitFor(() => expect(consoleError).not.toHaveBeenCalled());
  });
});
