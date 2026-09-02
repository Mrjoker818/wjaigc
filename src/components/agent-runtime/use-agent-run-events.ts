'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { reduceAgentEvents } from '@/lib/agent-runtime/event-reducer';
import type { AgentEvent, AgentRunProjection } from '@/lib/agent-runtime/types';

interface AgentRunEventsResult {
  projection?: AgentRunProjection;
  stale: boolean;
  cancel: () => Promise<AgentRunProjection | undefined>;
  pause: (nextStepId: string) => Promise<AgentRunProjection | undefined>;
  resume: () => Promise<AgentRunProjection | undefined>;
}

export type ControlledAgentRunProjection = AgentRunProjection & {
  control?: {
    leaseOwner: string;
    dispatch?: { started: boolean };
  };
};

const EVENT_POLL_INTERVAL_MS = 500;
const EVENT_STALE_AFTER_MS = 1_000;
const POLL_STOP_STATUSES = new Set([
  'completed', 'failed', 'cancelled', 'timeout', 'paused',
]);

export function initialAgentRunProjection(runId: string): AgentRunProjection {
  return {
    runId,
    status: 'created',
    lastSequence: 0,
    plan: [],
    assetVersionIds: [],
    ignoredEventIds: [],
    missingSequences: [],
    qualityChecks: [],
  };
}

export async function loadAgentRunEvents(
  runId: string,
  afterSequence: number,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<AgentEvent[]> {
  const url = `/api/agent-runs/${encodeURIComponent(runId)}/events?after=${afterSequence}`;
  const response = signal
    ? await fetcher(url, { signal })
    : await fetcher(url);
  if (!response.ok) return [];
  const payload = await response.json() as { events?: AgentEvent[] };
  return Array.isArray(payload.events) ? payload.events : [];
}

export async function cancelAgentRunRequest(
  runId: string,
  fetcher: typeof fetch = fetch,
): Promise<AgentRunProjection | undefined> {
  const response = await fetcher(`/api/agent-runs/${encodeURIComponent(runId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Agent cancellation failed');
  const payload = await response.json() as { projection?: AgentRunProjection };
  return payload.projection;
}

async function controlAgentRunRequest(
  runId: string,
  body: { action: 'pause'; nextStepId: string } | { action: 'resume' },
  fetcher: typeof fetch,
): Promise<ControlledAgentRunProjection | undefined> {
  const response = await fetcher(`/api/agent-runs/${encodeURIComponent(runId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Agent ${body.action} failed`);
  const payload = await response.json() as {
    projection?: AgentRunProjection;
    leaseOwner?: string;
    dispatch?: { started: boolean };
  };
  if (!payload.projection) return undefined;
  return {
    ...payload.projection,
    control: {
      leaseOwner: payload.leaseOwner || '',
      ...(payload.dispatch ? { dispatch: payload.dispatch } : {}),
    },
  };
}

export function pauseAgentRunRequest(
  runId: string,
  nextStepId: string,
  fetcher: typeof fetch = fetch,
): Promise<ControlledAgentRunProjection | undefined> {
  return controlAgentRunRequest(runId, { action: 'pause', nextStepId }, fetcher);
}

export function resumeAgentRunRequest(
  runId: string,
  fetcher: typeof fetch = fetch,
): Promise<ControlledAgentRunProjection | undefined> {
  return controlAgentRunRequest(runId, { action: 'resume' }, fetcher);
}

export async function runAgentControlRequest(input: {
  request: () => Promise<AgentRunProjection | undefined>;
  invalidate: () => void;
  refresh: () => void;
}): Promise<AgentRunProjection | undefined> {
  try {
    const projection = await input.request();
    input.invalidate();
    input.refresh();
    return projection;
  } catch (error) {
    input.refresh();
    throw error;
  }
}

interface AgentRunEventPollerOptions {
  runId: string;
  load?: (runId: string, afterSequence: number, signal: AbortSignal) => Promise<AgentEvent[]>;
  onProjection(projection: AgentRunProjection): void;
  onStale(stale: boolean): void;
  now?: () => number;
}

export interface AgentRunEventPoller {
  poll(): Promise<void>;
  stop(): void;
  isActive(): boolean;
}

export function createAgentRunEventPoller({
  runId,
  load = (id, after, signal) => loadAgentRunEvents(id, after, fetch, signal),
  onProjection,
  onStale,
  now = Date.now,
}: AgentRunEventPollerOptions): AgentRunEventPoller {
  let active = true;
  let terminal = false;
  let events: AgentEvent[] = [];
  let lastSequence = 0;
  let lastAdvanceAt = now();
  let inFlight: Promise<void> | null = null;
  let controller: AbortController | null = null;

  const poll = (): Promise<void> => {
    if (!active || terminal) return Promise.resolve();
    if (inFlight) return inFlight;

    controller = new AbortController();
    const requestController = controller;
    const request = (async (): Promise<void> => {
      try {
        const received = await load(runId, lastSequence, requestController.signal);
        if (!active || requestController.signal.aborted) return;
        if (received.length > 0) {
          const nextEvents = [...events, ...received];
          const nextSequence = Math.max(
            ...received.map(event => event.sequence),
            lastSequence,
          );
          const nextProjection = reduceAgentEvents(nextEvents);
          if (!active || requestController.signal.aborted) return;
          events = nextEvents;
          lastSequence = nextSequence;
          lastAdvanceAt = now();
          onProjection(nextProjection);
          terminal = POLL_STOP_STATUSES.has(nextProjection.status);
          if (terminal) active = false;
        }
        if (active) onStale(now() - lastAdvanceAt > EVENT_STALE_AFTER_MS);
      } catch {
        if (active && !requestController.signal.aborted) {
          onStale(now() - lastAdvanceAt > EVENT_STALE_AFTER_MS);
        }
      } finally {
        if (controller === requestController) controller = null;
        inFlight = null;
      }
    })();
    inFlight = request;
    return request;
  };

  return {
    poll,
    stop(): void {
      active = false;
      controller?.abort();
      controller = null;
    },
    isActive: () => active && !terminal,
  };
}

export function useAgentRunEvents(runId: string | null | undefined): AgentRunEventsResult {
  const [projection, setProjection] = useState<AgentRunProjection | undefined>(
    () => runId ? initialAgentRunProjection(runId) : undefined,
  );
  const [stale, setStale] = useState(false);
  const [pollGeneration, setPollGeneration] = useState(0);
  const generation = useRef(0);
  const activeRunId = useRef<string | null>(null);

  useEffect(() => {
    generation.current += 1;
    if (activeRunId.current !== (runId || null)) {
      activeRunId.current = runId || null;
      setProjection(runId ? initialAgentRunProjection(runId) : undefined);
      setStale(false);
    }
    if (!runId) return undefined;

    const expectedGeneration = generation.current;
    const poller = createAgentRunEventPoller({
      runId,
      onProjection: next => {
        if (generation.current === expectedGeneration) setProjection(next);
      },
      onStale: next => {
        if (generation.current === expectedGeneration) setStale(next);
      },
    });
    let timer: number | undefined;
    const refresh = async (): Promise<void> => {
      await poller.poll();
      if (poller.isActive()) {
        timer = window.setTimeout(() => { void refresh(); }, EVENT_POLL_INTERVAL_MS);
      }
    };
    void refresh();
    return () => {
      poller.stop();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [runId, pollGeneration]);

  const cancel = useCallback(async (): Promise<AgentRunProjection | undefined> => {
    if (!runId) return undefined;
    const cancelled = await cancelAgentRunRequest(runId);
    if (activeRunId.current !== runId) return cancelled;
    generation.current += 1;
    const expectedGeneration = generation.current;
    if (
      cancelled
      && generation.current === expectedGeneration
      && cancelled.runId === runId
    ) {
      setProjection(cancelled);
      setPollGeneration(value => value + 1);
    }
    return cancelled;
  }, [runId]);

  const pause = useCallback(async (
    nextStepId: string,
  ): Promise<AgentRunProjection | undefined> => {
    if (!runId) return undefined;
    const expectedRunId = runId;
    const paused = await runAgentControlRequest({
      request: () => pauseAgentRunRequest(runId, nextStepId),
      invalidate: () => { generation.current += 1; },
      refresh: () => { setPollGeneration(value => value + 1); },
    });
    if (
      paused
      && paused.runId === expectedRunId
    ) {
      setProjection(paused);
    }
    return paused;
  }, [runId]);

  const resume = useCallback(async (): Promise<AgentRunProjection | undefined> => {
    if (!runId) return undefined;
    const expectedRunId = runId;
    const resumed = await runAgentControlRequest({
      request: () => resumeAgentRunRequest(runId),
      invalidate: () => { generation.current += 1; },
      refresh: () => { setPollGeneration(value => value + 1); },
    });
    if (
      resumed
      && resumed.runId === expectedRunId
    ) {
      setProjection(resumed);
      setStale(false);
    }
    return resumed;
  }, [runId]);

  return { projection, stale, cancel, pause, resume };
}
