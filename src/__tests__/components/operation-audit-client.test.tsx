// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OperationAuditClient } from '@/components/operation-audit-client';

describe('OperationAuditClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not create an unhandled rejection when audit reporting is offline', async () => {
    const auditCatch = vi.fn().mockResolvedValue(undefined);
    const auditRequest = { catch: auditCatch } as unknown as Promise<Response>;
    const originalFetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return url.endsWith('/api/activity')
        ? auditRequest
        : Promise.reject(new TypeError('request offline'));
    });
    vi.stubGlobal('fetch', originalFetch);

    render(<OperationAuditClient />);

    await expect(window.fetch('/api/generate', { method: 'POST' })).rejects.toThrow('request offline');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(originalFetch).toHaveBeenCalledTimes(2);
    expect(originalFetch.mock.calls[1]?.[0]).toBe('/api/activity');
    expect(auditCatch).toHaveBeenCalledTimes(1);
  });
});
