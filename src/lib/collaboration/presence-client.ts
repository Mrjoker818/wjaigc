'use client';

import { useEffect, useState } from 'react';

import {
  PRESENCE_SUBPROTOCOL,
  presenceSnapshotFrameSchema,
  type PresenceSnapshotFrame,
} from './presence-schema';

export interface ProjectPresenceState {
  status: 'disabled' | 'connecting' | 'online' | 'unavailable';
  participants: PresenceSnapshotFrame['participants'];
}

const EMPTY_STATE: ProjectPresenceState = { status: 'disabled', participants: [] };
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const AUTH_STORAGE_KEY = 'unbounded_ai_current_user';
const HEARTBEAT_MS = 15_000;
const MAX_RETRY_MS = 10_000;

export function useProjectPresence(projectId: string | null): ProjectPresenceState {
  const [state, setState] = useState<ProjectPresenceState>(EMPTY_STATE);

  useEffect(() => {
    if (!projectId) {
      setState(EMPTY_STATE);
      return;
    }

    let active = true;
    let stopped = false;
    let socket: WebSocket | null = null;
    let controller: AbortController | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let acceptedConnectionId: string | null = null;
    let acceptedSequence = -1;

    const publish = (next: ProjectPresenceState): void => {
      if (active) setState(next);
    };

    // A hidden tab may defer connecting, but must never retain another project's roster.
    publish({ status: 'disabled', participants: [] });

    const clearHeartbeat = (): void => {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    };

    const closeCurrent = (): void => {
      controller?.abort();
      controller = null;
      clearHeartbeat();
      if (socket) {
        const old = socket;
        socket = null;
        old.onopen = null;
        old.onmessage = null;
        old.onclose = null;
        old.onerror = null;
        old.close();
      }
      acceptedConnectionId = null;
      acceptedSequence = -1;
    };

    const scheduleRetry = (): void => {
      if (!active || stopped || document.hidden || retry) return;
      const base = Math.min(MAX_RETRY_MS, 500 * 2 ** Math.min(attempts++, 5));
      const delay = Math.round(base * (0.75 + Math.random() * 0.5));
      retry = setTimeout(() => {
        retry = null;
        void connect();
      }, delay);
    };

    const connect = async (): Promise<void> => {
      if (!active || stopped || document.hidden || socket || controller) return;
      const request = new AbortController();
      controller = request;
      try {
        // Read the flag before attempting a mutation that is intentionally 503
        // when disabled. This does not replace project authorization on POST.
        const availability = await fetch('/api/collaboration/presence-ticket', {
          method: 'GET', credentials: 'include', cache: 'no-store', signal: request.signal,
        });
        if (!active || controller !== request || stopped) return;
        if (availability.status === 401 || availability.status === 403) {
          stopped = true;
          publish({ status: 'unavailable', participants: [] });
          return;
        }
        const capability: unknown = await availability.json();
        if (!active || controller !== request || stopped) return;
        if (!availability.ok || typeof capability !== 'object' || capability === null
          || !('success' in capability) || capability.success !== true
          || !('enabled' in capability) || typeof capability.enabled !== 'boolean') {
          throw new Error('invalid presence availability');
        }
        if (!capability.enabled) {
          publish({ status: 'disabled', participants: [] });
          return;
        }
        const response = await fetch('/api/collaboration/presence-ticket', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }),
          signal: request.signal,
        });
        if (!active || controller !== request || stopped) return;
        const payload: unknown = await response.json();
        if (!active || controller !== request || stopped) return;
        if (!response.ok) {
          const code = typeof payload === 'object' && payload !== null && 'code' in payload
            ? payload.code : null;
          publish({ status: code === 'PRESENCE_DISABLED' ? 'disabled' : 'unavailable', participants: [] });
          // An owner may enter a freshly created legacy project before its first
          // server sync commits; permission can also arrive after an invitation.
          if (response.status !== 401 && code !== 'PRESENCE_DISABLED') scheduleRetry();
          return;
        }
        const ticket = typeof payload === 'object' && payload !== null && 'ticket' in payload
          ? payload.ticket : null;
        if (typeof ticket !== 'string' || !TICKET_PATTERN.test(ticket)) {
          throw new Error('invalid presence ticket');
        }
        publish({ status: 'connecting', participants: [] });
        const url = new URL('/api/collaboration/presence', window.location.href);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const connected = new WebSocket(url.href, [PRESENCE_SUBPROTOCOL, `wujie-ticket.${ticket}`]);
        socket = connected;
        connected.onopen = () => {
          if (!active || socket !== connected) return;
          if (connected.protocol !== PRESENCE_SUBPROTOCOL) {
            connected.close();
            publish({ status: 'unavailable', participants: [] });
            return;
          }
          heartbeat = setInterval(() => {
            if (connected.readyState === WebSocket.OPEN) {
              connected.send(JSON.stringify({ type: 'heartbeat' }));
            }
          }, HEARTBEAT_MS);
        };
        connected.onmessage = (event: MessageEvent) => {
          if (!active || socket !== connected || typeof event.data !== 'string') return;
          let decoded: unknown;
          try {
            decoded = JSON.parse(event.data);
          } catch {
            connected.close();
            return;
          }
          const frame = presenceSnapshotFrameSchema.safeParse(decoded);
          if (!frame.success || frame.data.projectId !== projectId) return;
          if (acceptedConnectionId && frame.data.connectionId !== acceptedConnectionId) return;
          if (frame.data.sequence < acceptedSequence) return;
          acceptedConnectionId = frame.data.connectionId;
          acceptedSequence = frame.data.sequence;
          attempts = 0;
          const seen = new Set<string>();
          const participants = frame.data.participants.filter(person => {
            if (seen.has(person.userId)) return false;
            seen.add(person.userId);
            return true;
          });
          publish({ status: 'online', participants });
        };
        connected.onerror = () => connected.close();
        connected.onclose = (event: CloseEvent) => {
          if (!active || socket !== connected) return;
          socket = null;
          clearHeartbeat();
          acceptedConnectionId = null;
          acceptedSequence = -1;
          publish({ status: 'unavailable', participants: [] });
          if (event.code !== 1008 || event.reason === 'heartbeat timeout') scheduleRetry();
        };
      } catch {
        if (active && !stopped && !request.signal.aborted) {
          publish({ status: 'unavailable', participants: [] });
          scheduleRetry();
        }
      } finally {
        if (controller === request) controller = null;
      }
    };

    const onVisibility = (): void => {
      if (document.hidden) {
        if (retry) clearTimeout(retry);
        retry = null;
        closeCurrent();
        publish({ status: 'unavailable', participants: [] });
      } else {
        void connect();
      }
    };
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== AUTH_STORAGE_KEY) return;
      stopped = true;
      if (retry) clearTimeout(retry);
      retry = null;
      closeCurrent();
      publish({ status: 'unavailable', participants: [] });
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('storage', onStorage);
    void connect();
    return () => {
      active = false;
      if (retry) clearTimeout(retry);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('storage', onStorage);
      closeCurrent();
    };
  }, [projectId]);

  return state;
}
