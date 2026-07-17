'use client';

import { useEffect } from 'react';
import { getOperationAuditAction, normalizeAuditPath, shouldAuditClientRequest } from '@/lib/operation-audit';

type FetchArgs = Parameters<typeof window.fetch>;

function resolveRequest(input: FetchArgs[0], init?: FetchArgs[1]): { method: string; pathname: string } | null {
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const url = input instanceof Request ? input.url : String(input);
  try {
    const parsed = new URL(url, window.location.origin);
    return { method, pathname: parsed.pathname };
  } catch {
    return null;
  }
}

export function OperationAuditClient() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (...args: FetchArgs) => {
      const request = resolveRequest(args[0], args[1]);
      const startedAt = Date.now();
      try {
        const response = await originalFetch(...args);
        if (request && shouldAuditClientRequest(request.pathname, request.method)) {
          void originalFetch('/api/activity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
            body: JSON.stringify({
              action: getOperationAuditAction(request.pathname, request.method),
              method: request.method,
              path: normalizeAuditPath(request.pathname),
              status: response.status,
              durationMs: Date.now() - startedAt,
            }),
          });
        }
        return response;
      } catch (error) {
        if (request && shouldAuditClientRequest(request.pathname, request.method)) {
          void originalFetch('/api/activity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
            body: JSON.stringify({
              action: getOperationAuditAction(request.pathname, request.method),
              method: request.method,
              path: normalizeAuditPath(request.pathname),
              status: 0,
              durationMs: Date.now() - startedAt,
              error: error instanceof Error ? error.message.slice(0, 300) : 'Network request failed',
            }),
          });
        }
        throw error;
      }
    };

    return () => { window.fetch = originalFetch; };
  }, []);

  return null;
}
