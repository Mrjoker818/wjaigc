import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  cancelWorkflowSkillRun,
  executeWorkflowSkillRun,
  resumeWorkflowSkillRun,
  WorkflowSkillRunTerminalError,
} from '@/lib/workflow-skill-execution';
import {
  collectPersistedWorkflowSkillRunIds,
  inheritNestedWorkflowExecutionContext,
  registerWorkflowSkillSubmission,
  registerWorkflowSkillRunOrCancel,
  waitForWorkflowSkillSubmissions,
  workflowSkillRunRegistryKey,
} from '@/lib/workflow-execution-context';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/workflow/execute/route.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('workflow Skill Run execution', () => {
  it('submits and projects the same durable Skill Run instead of creating another state machine', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'run-1' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        run: { runId: 'run-1', status: 'running', assetVersionIds: [], outputs: [] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        run: {
          runId: 'run-1', status: 'completed', assetVersionIds: ['version-1'],
          outputs: [{ stepId: 'copy', kind: 'text', content: '成品文案' }],
        },
      }), { status: 200 }));

    const result = await executeWorkflowSkillRun({
      submitUrl: 'http://localhost:5000/api/skill-runs',
      requestBody: { skillId: 'skill-a' },
      headers: { 'Content-Type': 'application/json' },
      fetcher,
      pollIntervalMs: 0,
      resolveAssetVersion: async versionId => ({
        assetId: 'asset-1', assetVersionId: versionId, url: '/result.png',
      }),
    });

    expect(fetcher).toHaveBeenNthCalledWith(1, 'http://localhost:5000/api/skill-runs', expect.objectContaining({ method: 'POST' }));
    expect(fetcher).toHaveBeenNthCalledWith(2, 'http://localhost:5000/api/skill-runs/run-1', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual({
      runId: 'run-1',
      status: 'completed',
      taskId: 'run-1',
      imageUrl: '/result.png',
      imageUrls: ['/result.png'],
      assetVersionId: 'version-1',
      assetVersionIds: ['version-1'],
      assetReferences: [{ assetId: 'asset-1', assetVersionId: 'version-1', url: '/result.png' }],
      prompt: '成品文案',
      text: '成品文案',
      outputs: [{ stepId: 'copy', kind: 'text', content: '成品文案' }],
    });
  });

  it('keeps polling the same durable run after a transient status failure', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'run-transient' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'temporary outage' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        run: { runId: 'run-transient', status: 'completed', assetVersionIds: [], outputs: [] },
      }), { status: 200 }));

    const result = await executeWorkflowSkillRun({
      submitUrl: 'http://localhost:5000/api/skill-runs',
      requestBody: { skillId: 'skill-a' },
      headers: { 'Content-Type': 'application/json' },
      fetcher,
      pollIntervalMs: 0,
      timeoutMs: 1_000,
      resolveAssetVersion: async () => null,
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ runId: 'run-transient', status: 'completed' });
  });

  it('bounds Skill Run submission when the internal request stalls', async () => {
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));

    await expect(executeWorkflowSkillRun({
      submitUrl: 'http://localhost:5000/api/skill-runs',
      requestBody: { skillId: 'skill-a' },
      headers: { 'Content-Type': 'application/json' },
      fetcher: fetcher as typeof fetch,
      requestTimeoutMs: 5,
      resolveAssetVersion: async () => null,
    })).rejects.toThrow('Skill Run 提交请求超时');
  });

  it('bounds a paused Skill Run resume request when the internal request stalls', async () => {
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));

    await expect(resumeWorkflowSkillRun({
      submitUrl: 'http://localhost:5000/api/skill-runs',
      runId: 'run-paused',
      stepId: 'generate',
      headers: { 'Content-Type': 'application/json' },
      fetcher: fetcher as typeof fetch,
      requestTimeoutMs: 5,
      resolveAssetVersion: async () => null,
    })).rejects.toThrow('Skill Run 恢复请求超时');
  });

  it('cancels the durable run before reporting a workflow polling timeout', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'run-timeout' }), { status: 201 }))
      .mockImplementationOnce(async () => {
        await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
        return new Response(JSON.stringify({
          run: { runId: 'run-timeout', status: 'running', assetVersionIds: [], outputs: [] },
        }), { status: 200 });
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({
        runId: 'run-timeout', status: 'cancelled', assetVersionIds: [], outputs: [],
      }), { status: 200 }));

    await expect(executeWorkflowSkillRun({
      submitUrl: 'http://localhost:5000/api/skill-runs',
      requestBody: { skillId: 'skill-a' },
      headers: { 'Content-Type': 'application/json' },
      fetcher,
      pollIntervalMs: 100,
      timeoutMs: 5,
      statusRequestTimeoutMs: 50,
      resolveAssetVersion: async () => null,
    })).rejects.toThrow('Skill Run 执行超时');

    expect(fetcher).toHaveBeenLastCalledWith(
      'http://localhost:5000/api/skill-runs/run-timeout',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ action: 'cancel' }) }),
    );
  });

  it('reports confirmed timeout cancellation as a terminal cancelled run', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'run-timeout-terminal' }), { status: 201 }))
      .mockImplementationOnce(async () => {
        await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
        return new Response(JSON.stringify({
          run: { runId: 'run-timeout-terminal', status: 'running', assetVersionIds: [], outputs: [] },
        }), { status: 200 });
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({
        projection: { runId: 'run-timeout-terminal', status: 'cancelled', assetVersionIds: [], outputs: [] },
      }), { status: 200 }));

    await expect(executeWorkflowSkillRun({
      submitUrl: 'http://localhost:5000/api/skill-runs',
      requestBody: { skillId: 'skill-a' },
      headers: { 'Content-Type': 'application/json' },
      fetcher,
      pollIntervalMs: 100,
      timeoutMs: 5,
      statusRequestTimeoutMs: 50,
      resolveAssetVersion: async () => null,
    })).rejects.toEqual(expect.objectContaining({
      name: WorkflowSkillRunTerminalError.name,
      status: 'cancelled',
      message: expect.stringContaining('Skill Run 执行超时'),
    }));
  });

  it('rejects cancellation unless the durable run confirms a cancelled terminal state', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      runId: 'run-still-running', status: 'running',
    }), { status: 200 }));

    await expect(cancelWorkflowSkillRun({
      submitUrl: 'http://localhost:5000/api/skill-runs',
      runId: 'run-still-running',
      headers: { 'Content-Type': 'application/json' },
      fetcher,
    })).rejects.toThrow('未确认取消');
  });

  it('accepts the projection wrapper returned by the Skill Run cancellation endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      accepted: true,
      event: { eventId: 'event-cancelled' },
      projection: {
        runId: 'run-cancelled',
        status: 'cancelled',
        assetVersionIds: [],
        outputs: [],
      },
    }), { status: 200 }));

    await expect(cancelWorkflowSkillRun({
      submitUrl: 'http://localhost:5000/api/skill-runs',
      runId: 'run-cancelled',
      headers: { 'Content-Type': 'application/json' },
      fetcher,
    })).resolves.toMatchObject({ runId: 'run-cancelled', status: 'cancelled' });
  });

  it('wires ai-skill through the authenticated workflow executor and persists the runId projection', () => {
    expect(routeSource).toContain("node.type === 'ai-skill'");
    expect(routeSource).toContain('buildWorkflowSkillRunRequest');
    expect(routeSource).toContain('executeWorkflowSkillRun');
    expect(routeSource).toContain('cancelWorkflowSkillRun');
    expect(routeSource).toContain('isWorkflowSkillNodeEnabled');
    expect(routeSource).toMatch(/runId:[\s\S]+?persistWorkflowExecution/);
    expect(routeSource).toContain("success: retryResult.status === 'success'");
  });

  it('shares the root cancellation registry and project identity with nested executions', () => {
    const activeSkillRuns: Record<string, string> = {};
    const activeLayerTasks: Record<string, string> = {};
    const cancellationState = { cancelled: false };
    const persistActiveSkillRuns = vi.fn().mockResolvedValue(undefined);
    const parent = {
      userId: 'user-1',
      userRole: 'user' as const,
      projectId: 'project-1',
      workflowId: 'workflow-1',
      activeSkillRuns,
      activeLayerTasks,
      cancellationState,
      persistActiveSkillRuns,
    };

    const child = inheritNestedWorkflowExecutionContext(parent);

    expect(child).toEqual(parent);
    expect(child.activeSkillRuns).toBe(activeSkillRuns);
    expect(child.activeLayerTasks).toBe(activeLayerTasks);
    expect(child.cancellationState).toBe(cancellationState);
    expect(child.persistActiveSkillRuns).toBe(persistActiveSkillRuns);
  });

  it('namespaces equal local node ids by nested execution identity', () => {
    expect(workflowSkillRunRegistryKey('exec:subgraph-a', 'skill-node')).toBe('exec:subgraph-a:skill-node');
    expect(workflowSkillRunRegistryKey('exec:subgraph-b', 'skill-node')).toBe('exec:subgraph-b:skill-node');
  });

  it('recovers active Skill Run ids from a persisted workflow projection after cache loss', () => {
    expect(collectPersistedWorkflowSkillRunIds({
      activeSkillRuns: {
        'exec:node-a': 'run-a',
        'exec:node-b': 'run-b',
      },
      results: {
        'node-a': { status: 'running', output: { runId: 'run-a' } },
        'node-complete': { status: 'success', output: { runId: 'run-complete' } },
      },
    })).toEqual(['run-a', 'run-b']);
    expect(routeSource).toContain('activeSkillRuns: execState.activeSkillRuns');
    expect(routeSource).toContain('collectPersistedWorkflowSkillRunIds');
  });

  it('immediately cancels a run that arrives after the workflow was cancelled', async () => {
    const activeSkillRuns: Record<string, string> = {};
    const cancel = vi.fn().mockResolvedValue(undefined);

    await expect(registerWorkflowSkillRunOrCancel({
      status: 'cancelled',
      activeSkillRuns,
    }, 'node-late', 'run-late', cancel)).resolves.toBe(false);

    expect(cancel).toHaveBeenCalledWith('run-late');
    expect(activeSkillRuns).toEqual({});
  });

  it('waits for an in-flight Skill submission before confirming workflow cancellation', async () => {
    const context: {
      pendingSkillSubmissions?: Record<string, Promise<void>>;
      activeSkillRuns: Record<string, string>;
    } = { activeSkillRuns: {} };
    const completeSubmission = registerWorkflowSkillSubmission(context, 'execution:skill-node');
    let cancellationReady = false;
    const waiting = waitForWorkflowSkillSubmissions(context).then(() => {
      cancellationReady = true;
    });

    await Promise.resolve();
    expect(cancellationReady).toBe(false);

    context.activeSkillRuns['execution:skill-node'] = 'run-late';
    completeSubmission();
    await waiting;

    expect(cancellationReady).toBe(true);
    expect(Object.values(context.activeSkillRuns)).toEqual(['run-late']);
    expect(routeSource).toMatch(
      /cancellationState\.cancelled = true;[\s\S]+?await waitForWorkflowSkillSubmissions\(exec\);[\s\S]+?Object\.values\(exec\.activeSkillRuns/,
    );
  });

  it('uses the shared root cancellation state for a late nested run', async () => {
    const activeSkillRuns: Record<string, string> = {};
    const cancel = vi.fn().mockResolvedValue(undefined);

    await expect(registerWorkflowSkillRunOrCancel({
      status: 'running',
      cancellationState: { cancelled: true },
      activeSkillRuns,
    }, 'nested:node-late', 'run-late', cancel)).resolves.toBe(false);

    expect(cancel).toHaveBeenCalledWith('run-late');
    expect(activeSkillRuns).toEqual({});
  });

  it('retains unconfirmed runs and persists nested run tracking through the root owner', () => {
    expect(routeSource).toContain('let activeRunRegistered = false');
    expect(routeSource).toContain('let activeRunTerminal = false');
    expect(routeSource).toContain('activeRunRegistered && activeRunTerminal');
    expect(routeSource).toContain('persistActiveSkillRuns');
    expect(routeSource).toContain('cancellationState?.cancelled');
    expect(routeSource).toContain("attemptKey: `retry:${retryAttempt}`");
    expect(routeSource).toContain('resumeWorkflowSkillRun');
  });

  it('pairs the primary image URL with the same resolved asset version', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'run-assets' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        run: {
          runId: 'run-assets', status: 'completed',
          assetVersionIds: ['missing-version', 'resolved-version'], outputs: [],
        },
      }), { status: 200 }));

    const result = await executeWorkflowSkillRun({
      submitUrl: 'http://localhost:5000/api/skill-runs',
      requestBody: { skillId: 'skill-a' },
      headers: { 'Content-Type': 'application/json' },
      fetcher,
      pollIntervalMs: 0,
      resolveAssetVersion: async versionId => versionId === 'resolved-version'
        ? { assetId: 'asset-2', assetVersionId: versionId, url: '/resolved.png' }
        : null,
    });

    expect(result).toMatchObject({ imageUrl: '/resolved.png', assetVersionId: 'resolved-version' });
  });

  it('resumes a paused Skill Run at its persisted step without creating a new run', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        run: { runId: 'run-paused', status: 'completed', assetVersionIds: [], outputs: [] },
      }), { status: 200 }));

    await expect(resumeWorkflowSkillRun({
      submitUrl: 'http://localhost:5000/api/skill-runs',
      runId: 'run-paused',
      stepId: 'generate',
      headers: { 'Content-Type': 'application/json' },
      fetcher,
      pollIntervalMs: 0,
      resolveAssetVersion: async () => null,
    })).resolves.toMatchObject({ runId: 'run-paused', status: 'completed' });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:5000/api/skill-runs/run-paused/retry',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ stepId: 'generate' }) }),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('resumes a frozen paused run before resolving the mutable Skill definition', () => {
    const retryBranch = routeSource.slice(
      routeSource.indexOf("if (action === 'retry')"),
      routeSource.indexOf('// ─── 执行工作流'),
    );

    expect(retryBranch.indexOf('previousOutput')).toBeGreaterThanOrEqual(0);
    expect(retryBranch.indexOf('previousOutput')).toBeLessThan(
      retryBranch.indexOf('buildExecutableNodeRequest'),
    );
    expect(retryBranch).toContain('resume: { runId: pausedRunId, stepId: resumeFromStepId }');
  });

  it.each(['failed', 'paused', 'cancelled', 'timeout'])('retains the durable run projection when status is %s', async status => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'run-terminal' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        run: {
          runId: 'run-terminal',
          status,
          assetVersionIds: ['version-terminal'],
          outputs: [{ stepId: 'copy', kind: 'text', content: '终态输出' }],
        },
      }), { status: 200 }));

    const execution = executeWorkflowSkillRun({
      submitUrl: 'http://localhost:5000/api/skill-runs',
      requestBody: { skillId: 'skill-a' },
      headers: { 'Content-Type': 'application/json' },
      fetcher,
      pollIntervalMs: 0,
      resolveAssetVersion: async () => null,
    });

    await expect(execution).rejects.toMatchObject({
      name: 'WorkflowSkillRunTerminalError',
      runId: 'run-terminal',
      status,
      output: {
        runId: 'run-terminal',
        taskId: 'run-terminal',
        status,
        assetVersionIds: ['version-terminal'],
        outputs: [{ stepId: 'copy', kind: 'text', content: '终态输出' }],
      },
    });
  });
});
