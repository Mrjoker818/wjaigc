// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppErrorBoundary } from '@/components/app-error-boundary';
import { attemptChunkLoadRecovery } from '@/lib/chunk-load-recovery';

vi.mock('@/lib/chunk-load-recovery', () => ({
  attemptChunkLoadRecovery: vi.fn(() => true),
}));

function BrokenRoute(): React.ReactNode {
  throw new Error('ChunkLoadError: Failed to load chunk /_next/static/chunks/old.js');
}

describe('AppErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(attemptChunkLoadRecovery).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attempts controlled recovery before presenting a chunk render failure', () => {
    render(
      <AppErrorBoundary>
        <BrokenRoute />
      </AppErrorBoundary>,
    );

    expect(attemptChunkLoadRecovery).toHaveBeenCalledOnce();
    expect(screen.getByText('页面渲染出错')).toBeTruthy();
  });
});
