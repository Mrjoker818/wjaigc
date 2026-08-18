// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GlobalErrorMonitor } from '@/components/global-error-monitor';

describe('GlobalErrorMonitor', () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

  beforeEach(() => {
    fetchMock.mockClear();
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
});
