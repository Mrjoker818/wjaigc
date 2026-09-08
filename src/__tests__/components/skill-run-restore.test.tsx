// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSkillRun } from '@/components/skill-runtime/use-skill-run';
import {
  createCanvasSkillIdempotencyKey,
  createPlatformComplianceRecheckRequest,
  frozenSkillRunRequestFromHistory,
} from '@/components/skill-runtime/platform-compliance-client';
import type { SkillRunRequest } from '@/lib/skill-runtime/run-request';

vi.mock('@/components/agent-runtime/use-agent-run-events', () => ({
  useAgentRunEvents: vi.fn(() => ({ projection: undefined, stale: false })),
}));

const identity = {
  runId: 'paused-run', projectId: 'project-1', surface: 'canvas' as const,
  skillId: 'preset-food-photography',
};

function response(body: unknown, status = 200): Response {
  return { ok: status === 200, status, json: async () => body } as Response;
}

describe('restore an existing Skill run after remount', () => {
  it('reattaches an owned scoped run without creating or resuming it', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ run: identity }));
    const { result } = renderHook(() => useSkillRun({ fetcher }));

    await act(async () => { await result.current.restoreRun(identity); });

    expect(result.current.runId).toBe(identity.runId);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/api/skill-runs/paused-run?observeOnly=true',
      expect.objectContaining({ method: 'GET' }));
  });

  it.each([
    { projectId: 'another-project' },
    { surface: 'simple-chat' },
    { skillId: 'another-skill' },
    { runId: 'another-run' },
  ])('rejects a response from another scope: %j', async mismatch => {
    const fetcher = vi.fn().mockResolvedValue(response({ run: { ...identity, ...mismatch } }));
    const { result } = renderHook(() => useSkillRun({ fetcher }));

    await act(async () => { await result.current.restoreRun(identity); });

    expect(result.current.runId).toBeUndefined();
    expect(result.current.error).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not reattach a late response after leaving the project', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
    const { result } = renderHook(() => useSkillRun({ fetcher }));
    let restoring!: Promise<string | undefined>;
    act(() => { restoring = result.current.restoreRun(identity); });
    act(() => { result.current.reset(); });
    await act(async () => { resolve(response({ run: identity })); await restoring; });

    expect(result.current.runId).toBeUndefined();
    expect(result.current.busy).toBe(false);
  });

  it('keeps ownership rejection visible without creating a replacement run', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: 'Run not found' }, 404));
    const { result } = renderHook(() => useSkillRun({ fetcher }));
    await act(async () => { await result.current.restoreRun(identity); });
    expect(result.current.error).toBe('Run not found');
    expect(result.current.runId).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('creates a new run request for recheck without mutating historical inputs or sources', () => {
    const historical: SkillRunRequest = {
      skillId: 'preset-platform-compliance-audit', skillVersion: 1, surface: 'canvas',
      projectId: 'project-1', workspaceId: 'canvas:project-1',
      inputValues: { sourceImages: ['version-1', 'version-2'], platform: 'Amazon', region: 'US' },
      sourceVersionIds: ['version-1', 'version-2'],
      modelBindings: {
        orchestrator: { providerId: 'pear', modelId: 'chat-1' },
        vision: { providerId: 'pear', modelId: 'vision-1' },
      },
      idempotencyKey: 'canvas-skill:old',
    };

    const next = createPlatformComplianceRecheckRequest(historical, 'canvas-skill:new');

    expect(next).toEqual({ ...historical, inputValues: historical.inputValues,
      sourceVersionIds: historical.sourceVersionIds, modelBindings: historical.modelBindings,
      idempotencyKey: 'canvas-skill:new' });
    expect(next).not.toBe(historical);
    expect(next.inputValues).not.toBe(historical.inputValues);
    expect(next.sourceVersionIds).not.toBe(historical.sourceVersionIds);
    expect(next.modelBindings).not.toBe(historical.modelBindings);
    expect(historical.idempotencyKey).toBe('canvas-skill:old');
  });

  it('restores a validated frozen historical request without consulting the current model', () => {
    const request = frozenSkillRunRequestFromHistory({
      runId: 'old-run', projectId: 'project-1', surface: 'canvas', workspaceId: 'canvas:project-1',
      skillId: 'preset-platform-compliance-audit', skillVersion: 3, status: 'completed', createdAt: 1,
      inputValues: { platform: 'Amazon', region: 'US' }, sourceVersionIds: ['version-1'],
      modelBindings: {
        orchestrator: { providerId: 'historical-provider', modelId: 'historical-chat' },
        vision: { providerId: 'historical-provider', modelId: 'historical-vision' },
      },
    });
    expect(request).toMatchObject({
      skillVersion: 3,
      inputValues: { platform: 'Amazon', region: 'US' },
      sourceVersionIds: ['version-1'],
      modelBindings: { vision: { providerId: 'historical-provider', modelId: 'historical-vision' } },
    });
  });

  it('creates distinct fallback keys for consecutive rechecks in the same millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      getRandomValues: (bytes: Uint8Array) => { bytes.fill(7); return bytes; },
    } });
    try {
      const first = createCanvasSkillIdempotencyKey();
      const second = createCanvasSkillIdempotencyKey();
      expect(first).not.toBe(second);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    }
  });
});
