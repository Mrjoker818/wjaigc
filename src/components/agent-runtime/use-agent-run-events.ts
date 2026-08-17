'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { reduceAgentEvents } from '@/lib/agent-runtime/event-reducer';
import type { AgentEvent, AgentRunProjection } from '@/lib/agent-runtime/types';

interface AgentRunEventsResult {
  projection?: AgentRunProjection;
  stale: boolean;
  cancel: () => Promise<AgentRunProjection | undefined>;
}

const EVENT_POLL_INTERVAL_MS = 500;
const EVENT_STALE_AFTER_MS = 1_000;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timeout']);

export function initialAgentRunProjection(runId: string): AgentRunProjection {
  return {
    runId,
    status: 'created',
    lastSequence: 0,
    plan: [],
    assetVersionIds: [],
    ignoredEventIds: [],
    missingSequences: [],
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
          terminal = TERMINAL_STATUSES.has(nextProjection.status);
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
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    setProjection(runId ? initialAgentRunProjection(runId) : undefined);
    setStale(false);
    if (!runId) return undefined;

    const poller = createAgentRunEventPoller({
      runId,
      onProjection: setProjection,
      onStale: setStale,
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
  }, [runId]);

  const cancel = useCallback(async (): Promise<AgentRunProjection | undefined> => {
    if (!runId) return undefined;
    const expectedGeneration = generation.current;
    const cancelled = await cancelAgentRunRequest(runId);
    if (
      cancelled
      && generation.current === expectedGeneration
      && cancelled.runId === runId
    ) {
      setProjection(cancelled);
    }
    return cancelled;
  }, [runId]);

  return { projection, stale, cancel };
}
