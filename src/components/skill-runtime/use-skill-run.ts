'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAgentRunEvents } from '@/components/agent-runtime/use-agent-run-events';
import type { AgentEvent, AgentRunProjection } from '@/lib/agent-runtime/types';
import type { SkillRunCostEstimate } from '@/lib/skill-runtime/cost-estimator';
import type { SkillRunRequest } from '@/lib/skill-runtime/run-request';

interface UseSkillRunOptions {
  fetcher?: typeof fetch;
}

interface UseSkillRunResult {
  runId?: string;
  estimate?: SkillRunCostEstimate;
  projection?: AgentRunProjection;
  retryableStepId?: string;
  retryabilityError?: string;
  stale: boolean;
  busy: boolean;
  error?: string;
  estimateRun: (request: SkillRunRequest) => Promise<SkillRunCostEstimate | undefined>;
  startRun: (request: SkillRunRequest) => Promise<string | undefined>;
  pause: () => Promise<boolean>;
  resume: () => Promise<boolean>;
  cancel: () => Promise<boolean>;
  retry: (stepId: string) => Promise<boolean>;
  refreshRetryability: () => void;
  reset: () => void;
}

interface ActiveRunIdentity {
  runId: string;
  generation: number;
}

interface ErrorPayload {
  error?: string | { message?: string };
  message?: string;
}

interface AgentEventsResponse {
  events?: AgentEvent[];
}

function errorMessage(payload: ErrorPayload, fallback: string): string {
  if (typeof payload.error === 'string') return payload.error;
  if (payload.error && typeof payload.error.message === 'string') return payload.error.message;
  if (typeof payload.message === 'string') return payload.message;
  return fallback;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & ErrorPayload;
  if (!response.ok) throw new Error(errorMessage(payload, `请求失败 (${response.status})`));
  return payload;
}

export function useSkillRun({ fetcher = fetch }: UseSkillRunOptions = {}): UseSkillRunResult {
  const [runId, setRunId] = useState<string>();
  const [eventRunId, setEventRunId] = useState<string>();
  const [estimate, setEstimate] = useState<SkillRunCostEstimate>();
  const [retryableStepId, setRetryableStepId] = useState<string>();
  const [retryabilityError, setRetryabilityError] = useState<string>();
  const [retryabilityRefresh, setRetryabilityRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const mounted = useRef(true);
  const activeRun = useRef<ActiveRunIdentity | undefined>(undefined);
  const startGeneration = useRef(0);
  const estimateGeneration = useRef(0);
  const busyGeneration = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const startController = useRef<AbortController | undefined>(undefined);
  const estimateController = useRef<AbortController | undefined>(undefined);
  const historyController = useRef<AbortController | undefined>(undefined);
  const historyGeneration = useRef(0);
  const eventRefreshTimer = useRef<number | undefined>(undefined);
  const events = useAgentRunEvents(eventRunId);

  useEffect(() => {
    const activeControllers = controllers.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeRun.current = undefined;
      startGeneration.current += 1;
      estimateGeneration.current += 1;
      historyGeneration.current += 1;
      busyGeneration.current += 1;
      if (eventRefreshTimer.current !== undefined) {
        window.clearTimeout(eventRefreshTimer.current);
      }
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
    };
  }, []);

  const refreshEventProjection = useCallback((
    expectedRunId: string,
    expectedGeneration: number,
  ): void => {
    if (eventRefreshTimer.current !== undefined) {
      window.clearTimeout(eventRefreshTimer.current);
    }
    setEventRunId(undefined);
    eventRefreshTimer.current = window.setTimeout(() => {
      eventRefreshTimer.current = undefined;
      if (mounted.current && startGeneration.current === expectedGeneration) {
        const active = activeRun.current;
        if (active?.runId === expectedRunId && active.generation === expectedGeneration) {
          setEventRunId(expectedRunId);
        }
      }
    }, 0);
  }, []);

  const request = useCallback(async <T,>(
    url: string,
    init: RequestInit,
    controller: AbortController,
  ): Promise<T | undefined> => {
    controllers.current.add(controller);
    try {
      return await readJson<T>(await fetcher(url, { ...init, signal: controller.signal }));
    } catch (requestError) {
      if (controller.signal.aborted || !mounted.current) return undefined;
      throw requestError;
    } finally {
      controllers.current.delete(controller);
    }
  }, [fetcher]);

  const projection = runId
    && activeRun.current?.runId === runId
    && activeRun.current.generation === startGeneration.current
    && eventRunId === runId
    && events.projection?.runId === runId
    ? events.projection
    : undefined;

  useEffect(() => {
    historyController.current?.abort();
    const generation = ++historyGeneration.current;
    setRetryableStepId(undefined);
    setRetryabilityError(undefined);
    if (projection?.status !== 'paused' || !projection.resumeFromStepId) return;

    const active = activeRun.current;
    if (active?.runId !== projection.runId || active.generation !== startGeneration.current) return;
    const expectedRunId = projection.runId;
    const expectedStepId = projection.resumeFromStepId;
    const expectedRunGeneration = active.generation;
    const controller = new AbortController();
    historyController.current = controller;
    void request<AgentEventsResponse>(
      `/api/agent-runs/${encodeURIComponent(expectedRunId)}/events?after=0`,
      { method: 'GET' },
      controller,
    ).then(payload => {
      const executionErrorPause = payload?.events?.some(event => (
        event.runId === expectedRunId
        && event.sequence === projection.lastSequence
        && event.type === 'run.paused'
        && event.payload.nextStepId === expectedStepId
        && event.payload.pauseReason === 'execution-error'
      ));
      if (
        mounted.current
        && historyGeneration.current === generation
        && activeRun.current?.runId === expectedRunId
        && activeRun.current.generation === expectedRunGeneration
        && executionErrorPause
      ) {
        setRetryableStepId(expectedStepId);
      }
    }).catch(() => {
      if (
        !controller.signal.aborted
        && mounted.current
        && historyGeneration.current === generation
        && activeRun.current?.runId === expectedRunId
        && activeRun.current.generation === expectedRunGeneration
      ) {
        setRetryabilityError('无法确认失败步骤是否可重试');
      }
    });
    return () => controller.abort();
  }, [projection, request, retryabilityRefresh]);

  const refreshRetryability = useCallback((): void => {
    const active = activeRun.current;
    if (
      projection?.status === 'paused'
      && projection.resumeFromStepId
      && active?.runId === projection.runId
      && active.generation === startGeneration.current
    ) {
      setRetryabilityRefresh(value => value + 1);
    }
  }, [projection]);

  const estimateRun = useCallback(async (
    input: SkillRunRequest,
  ): Promise<SkillRunCostEstimate | undefined> => {
    estimateController.current?.abort();
    const controller = new AbortController();
    estimateController.current = controller;
    const generation = ++estimateGeneration.current;
    const operationGeneration = ++busyGeneration.current;
    if (mounted.current) {
      setBusy(true);
      setError(undefined);
    }
    try {
      const result = await request<SkillRunCostEstimate>('/api/skill-runs/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }, controller);
      if (result && mounted.current && estimateGeneration.current === generation) {
        setEstimate(result);
        return result;
      }
      return undefined;
    } catch (requestError) {
      if (
        mounted.current
        && estimateGeneration.current === generation
        && busyGeneration.current === operationGeneration
      ) {
        setError(requestError instanceof Error ? requestError.message : '估价失败');
      }
      return undefined;
    } finally {
      if (mounted.current && busyGeneration.current === operationGeneration) setBusy(false);
    }
  }, [request]);

  const startRun = useCallback(async (input: SkillRunRequest): Promise<string | undefined> => {
    startController.current?.abort();
    estimateController.current?.abort();
    historyController.current?.abort();
    estimateGeneration.current += 1;
    historyGeneration.current += 1;
    const controller = new AbortController();
    startController.current = controller;
    const generation = ++startGeneration.current;
    const operationGeneration = ++busyGeneration.current;
    activeRun.current = undefined;
    if (mounted.current) {
      setRunId(undefined);
      setBusy(true);
      setError(undefined);
      setEstimate(undefined);
      setEventRunId(undefined);
      setRetryableStepId(undefined);
      setRetryabilityError(undefined);
    }
    try {
      const result = await request<{ runId?: string }>('/api/skill-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }, controller);
      const nextRunId = result?.runId;
      if (nextRunId && mounted.current && startGeneration.current === generation) {
        activeRun.current = { runId: nextRunId, generation };
        setRunId(nextRunId);
        setEventRunId(nextRunId);
        return nextRunId;
      }
      return undefined;
    } catch (requestError) {
      if (
        mounted.current
        && startGeneration.current === generation
        && busyGeneration.current === operationGeneration
      ) {
        setError(requestError instanceof Error ? requestError.message : '运行启动失败');
      }
      return undefined;
    } finally {
      if (mounted.current && busyGeneration.current === operationGeneration) setBusy(false);
    }
  }, [request]);

  const control = useCallback(async (
    action: 'pause' | 'resume' | 'cancel',
  ): Promise<boolean> => {
    const active = activeRun.current;
    if (!runId || active?.runId !== runId || active.generation !== startGeneration.current) return false;
    const expectedRunId = active.runId;
    const expectedGeneration = active.generation;
    const operationGeneration = ++busyGeneration.current;
    const controller = new AbortController();
    if (mounted.current) {
      setBusy(true);
      setError(undefined);
    }
    try {
      const result = await request<{ accepted?: boolean }>(
        `/api/skill-runs/${encodeURIComponent(expectedRunId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
        controller,
      );
      const accepted = result?.accepted === true
        && activeRun.current?.runId === expectedRunId
        && activeRun.current.generation === expectedGeneration;
      if (accepted && action !== 'pause') {
        refreshEventProjection(expectedRunId, expectedGeneration);
      }
      return accepted;
    } catch (requestError) {
      if (
        mounted.current
        && activeRun.current?.runId === expectedRunId
        && activeRun.current.generation === expectedGeneration
        && busyGeneration.current === operationGeneration
      ) {
        setError(requestError instanceof Error ? requestError.message : '运行控制失败');
      }
      return false;
    } finally {
      if (
        mounted.current
        && activeRun.current?.runId === expectedRunId
        && activeRun.current.generation === expectedGeneration
        && busyGeneration.current === operationGeneration
      ) setBusy(false);
    }
  }, [refreshEventProjection, request, runId]);

  const retry = useCallback(async (stepId: string): Promise<boolean> => {
    const active = activeRun.current;
    if (!runId || active?.runId !== runId || active.generation !== startGeneration.current) return false;
    const expectedRunId = active.runId;
    const expectedGeneration = active.generation;
    const operationGeneration = ++busyGeneration.current;
    const controller = new AbortController();
    if (mounted.current) {
      setBusy(true);
      setError(undefined);
    }
    try {
      const result = await request<{ accepted?: boolean }>(
        `/api/skill-runs/${encodeURIComponent(expectedRunId)}/retry`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stepId }),
        },
        controller,
      );
      const accepted = result?.accepted === true
        && activeRun.current?.runId === expectedRunId
        && activeRun.current.generation === expectedGeneration;
      if (accepted) refreshEventProjection(expectedRunId, expectedGeneration);
      return accepted;
    } catch (requestError) {
      if (
        mounted.current
        && activeRun.current?.runId === expectedRunId
        && activeRun.current.generation === expectedGeneration
        && busyGeneration.current === operationGeneration
      ) {
        setError(requestError instanceof Error ? requestError.message : '重试失败');
      }
      return false;
    } finally {
      if (
        mounted.current
        && activeRun.current?.runId === expectedRunId
        && activeRun.current.generation === expectedGeneration
        && busyGeneration.current === operationGeneration
      ) setBusy(false);
    }
  }, [refreshEventProjection, request, runId]);

  const reset = useCallback((): void => {
    startController.current?.abort();
    estimateController.current?.abort();
    historyController.current?.abort();
    startGeneration.current += 1;
    estimateGeneration.current += 1;
    historyGeneration.current += 1;
    busyGeneration.current += 1;
    activeRun.current = undefined;
    if (eventRefreshTimer.current !== undefined) {
      window.clearTimeout(eventRefreshTimer.current);
      eventRefreshTimer.current = undefined;
    }
    setRunId(undefined);
    setEventRunId(undefined);
    setEstimate(undefined);
    setRetryableStepId(undefined);
    setRetryabilityError(undefined);
    setError(undefined);
    setBusy(false);
  }, []);

  return {
    runId,
    estimate,
    projection,
    retryableStepId,
    retryabilityError,
    stale: projection ? events.stale : false,
    busy,
    error,
    estimateRun,
    startRun,
    pause: () => control('pause'),
    resume: () => control('resume'),
    cancel: () => control('cancel'),
    retry,
    refreshRetryability,
    reset,
  };
}
