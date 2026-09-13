// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GlobalErrorMonitor } from '@/components/global-error-monitor';
import { attemptChunkLoadRecovery } from '@/lib/chunk-load-recovery';

vi.mock('@/lib/chunk-load-recovery', () => ({
  attemptChunkLoadRecovery: vi.fn(() => false),
}));

describe('GlobalErrorMonitor', () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

  beforeEach(() => {
    fetchMock.mockClear();
    vi.mocked(attemptChunkLoadRecovery).mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications.',
  ])('handles the browser ResizeObserver delivery notice without reporting it: %s', message => {
    render(<GlobalErrorMonitor />);
    const event = new ErrorEvent('error', { cancelable: true, message });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('continues reporting real errors even when their text mentions ResizeObserver', () => {
    render(<GlobalErrorMonitor />);
    const event = new ErrorEvent('error', {
      cancelable: true,
      message: 'ResizeObserver callback crashed while updating a node',
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('offers unhandled promise failures to the chunk recovery guard', () => {
    render(<GlobalErrorMonitor />);
    const error = new Error('Loading chunk 5504 failed');
    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: error });

    window.dispatchEvent(event);

    expect(attemptChunkLoadRecovery).toHaveBeenCalledWith(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
