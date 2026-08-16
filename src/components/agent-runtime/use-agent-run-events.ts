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

export function useAgentRunEvents(runId: string | null | undefined): AgentRunEventsResult {
  const [projection, setProjection] = useState<AgentRunProjection>();
  const [stale, setStale] = useState(false);
  const lastSequence = useRef(0);
  const lastAdvanceAt = useRef(Date.now());

  useEffect(() => {
    lastSequence.current = 0;
    lastAdvanceAt.current = Date.now();
    setProjection(undefined);
    setStale(false);
    if (!runId) return undefined;

    let active = true;
    let events: AgentEvent[] = [];
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}/events?after=${lastSequence.current}`);
        if (!response.ok) return;
        const payload = await response.json() as { events?: AgentEvent[] };
        const received = Array.isArray(payload.events) ? payload.events : [];
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
    const response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Agent cancellation failed');
    const payload = await response.json() as { projection?: AgentRunProjection };
    if (payload.projection) setProjection(payload.projection);
  }, [runId]);

  return { projection, stale, cancel };
}
