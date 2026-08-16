'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { reduceAgentEvents } from '@/lib/agent-runtime/event-reducer';
import type { AgentEvent, AgentRunProjection } from '@/lib/agent-runtime/types';

interface AgentRunEventsResult {
  projection?: AgentRunProjection;
  stale: boolean;
  cancel: () => Promise<void>;
}

const EVENT_POLL_INTERVAL_MS = 500;
const EVENT_STALE_AFTER_MS = 1_000;

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
): Promise<AgentEvent[]> {
  const response = await fetcher(
    `/api/agent-runs/${encodeURIComponent(runId)}/events?after=${afterSequence}`,
  );
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

export function useAgentRunEvents(runId: string | null | undefined): AgentRunEventsResult {
  const [projection, setProjection] = useState<AgentRunProjection | undefined>(
    () => runId ? initialAgentRunProjection(runId) : undefined,
  );
  const [stale, setStale] = useState(false);
  const lastSequence = useRef(0);
  const lastAdvanceAt = useRef(0);

  useEffect(() => {
    lastSequence.current = 0;
    lastAdvanceAt.current = Date.now();
    setProjection(runId ? initialAgentRunProjection(runId) : undefined);
    setStale(false);
    if (!runId) return undefined;

    let active = true;
    let events: AgentEvent[] = [];
    const refresh = async (): Promise<void> => {
      try {
        const received = await loadAgentRunEvents(runId, lastSequence.current);
        if (received.length > 0) {
          events = [...events, ...received];
          lastSequence.current = Math.max(...received.map(event => event.sequence), lastSequence.current);
          lastAdvanceAt.current = Date.now();
          if (active) setProjection(reduceAgentEvents(events));
        }
        if (active) setStale(Date.now() - lastAdvanceAt.current > EVENT_STALE_AFTER_MS);
      } catch {
        if (active) setStale(Date.now() - lastAdvanceAt.current > EVENT_STALE_AFTER_MS);
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, EVENT_POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [runId]);

  const cancel = useCallback(async (): Promise<void> => {
    if (!runId) return;
    const cancelled = await cancelAgentRunRequest(runId);
    if (cancelled) setProjection(cancelled);
  }, [runId]);

  return { projection, stale, cancel };
}
