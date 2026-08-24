import { describe, expect, it, vi } from 'vitest';

import { resolveProviderForTask } from '@/lib/task-core/exact-provider-routing';

describe('exact provider routing', () => {
  it('does not cross-provider fallback for an explicit image generation provider', async () => {
    const findById = vi.fn().mockResolvedValue(null);
    const findByModel = vi.fn().mockResolvedValue({ id: 'provider-other' });
    const findByFeature = vi.fn().mockResolvedValue({ id: 'provider-feature' });

    await expect(resolveProviderForTask({
      providerId: 'provider-requested',
      findById,
      findByModel,
      findByFeature,
    })).resolves.toBeNull();
    expect(findById).toHaveBeenCalledWith('provider-requested');
    expect(findByModel).not.toHaveBeenCalled();
    expect(findByFeature).not.toHaveBeenCalled();
  });

  it('does not cross-provider fallback for an explicit video extend provider', async () => {
    const findById = vi.fn().mockResolvedValue(null);
    const findByModel = vi.fn().mockResolvedValue({ id: 'provider-other' });
    const findByFeature = vi.fn().mockResolvedValue({ id: 'provider-feature' });

    await expect(resolveProviderForTask({
      providerId: 'provider-video-requested',
      findById,
      findByModel,
      findByFeature,
    })).resolves.toBeNull();
    expect(findByModel).not.toHaveBeenCalled();
    expect(findByFeature).not.toHaveBeenCalled();
  });

  it('discovers a provider only when the request did not select one explicitly', async () => {
    const findById = vi.fn();
    const findByModel = vi.fn().mockResolvedValue(null);
    const findByFeature = vi.fn().mockResolvedValue({ id: 'provider-feature' });

    await expect(resolveProviderForTask({
      findById,
      findByModel,
      findByFeature,
    })).resolves.toEqual({ id: 'provider-feature' });
    expect(findById).not.toHaveBeenCalled();
    expect(findByModel).toHaveBeenCalledOnce();
    expect(findByFeature).toHaveBeenCalledOnce();
  });
});
