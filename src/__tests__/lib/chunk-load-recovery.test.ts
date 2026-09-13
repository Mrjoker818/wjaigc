import { describe, expect, it, vi } from 'vitest';

import { attemptChunkLoadRecovery } from '@/lib/chunk-load-recovery';

function createEnvironment() {
  const markers = new Map<string, string>();
  const replace = vi.fn();

  return {
    markers,
    replace,
    environment: {
      href: 'https://example.test/simple-create?projectId=demo-project',
      now: () => 1_789_286_076_000,
      readMarker: (key: string) => markers.get(key) ?? null,
      writeMarker: (key: string, value: string) => markers.set(key, value),
      replace,
    },
  };
}

describe('attemptChunkLoadRecovery', () => {
  it('reloads a stale Next.js chunk failure once with a cache-busting URL', () => {
    const { environment, replace } = createEnvironment();
    const error = new Error(
      'ChunkLoadError: Failed to load chunk /_next/static/chunks/06-azuyjidcip.js',
    );

    expect(attemptChunkLoadRecovery(error, environment)).toBe(true);
    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith(
      'https://example.test/simple-create?projectId=demo-project&_chunk_retry=1789286076000',
    );
  });

  it('does not reload the same missing chunk twice in one browser session', () => {
    const { environment, replace } = createEnvironment();
    const error = new Error('Loading chunk 5504 failed');

    expect(attemptChunkLoadRecovery(error, environment)).toBe(true);
    expect(attemptChunkLoadRecovery(error, environment)).toBe(false);
    expect(replace).toHaveBeenCalledOnce();
  });

  it('does not treat ordinary request failures as deployment skew', () => {
    const { environment, replace } = createEnvironment();

    expect(attemptChunkLoadRecovery(new Error('Failed to fetch'), environment)).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('uses the retry URL itself as a loop guard when session storage is unavailable', () => {
    const { environment, replace } = createEnvironment();
    environment.readMarker = () => {
      throw new DOMException('Storage is disabled', 'SecurityError');
    };
    environment.writeMarker = () => {
      throw new DOMException('Storage is disabled', 'SecurityError');
    };

    expect(attemptChunkLoadRecovery(new Error('Loading chunk 99 failed'), environment)).toBe(true);
    expect(replace).toHaveBeenCalledOnce();

    const retriedEnvironment = {
      ...environment,
      href: 'https://example.test/simple-create?_chunk_retry=1789286076000',
    };
    expect(attemptChunkLoadRecovery(new Error('Loading chunk 99 failed'), retriedEnvironment)).toBe(false);
    expect(replace).toHaveBeenCalledOnce();
  });
});
