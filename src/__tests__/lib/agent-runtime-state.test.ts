import { describe, expect, it } from 'vitest';

import {
  assertAgentEventPayloadSafe,
  reduceAgentEvents,
} from '@/lib/agent-runtime/event-reducer';
import type {
  AgentEvent,
  AgentEventType,
} from '@/lib/agent-runtime/types';

function event(
  sequence: number,
  type: AgentEventType,
  payload: Record<string, unknown> = {},
  eventId = `event-${sequence}`,
): AgentEvent {
  return {
    eventId,
    runId: 'run-1',
    sequence,
    type,
    timestamp: new Date(1_700_000_000_000 + sequence).toISOString(),
    payload,
  };
}

describe('shared Agent runtime projection', () => {
  it('does not let a late completion cross a persisted pause', () => {
    const projection = reduceAgentEvents([
      event(1, 'run.created'),
      event(2, 'tool.started', { stepId: 'generate-1' }),
      event(3, 'run.paused', { nextStepId: 'generate-2' }),
      event(4, 'run.completed', { result: { imageUrl: '/late.png' } }),
    ]);

    expect(projection.status).toBe('paused');
    expect(projection.resumeFromStepId).toBe('generate-2');
    expect(projection.ignoredEventIds).toContain('event-4');
  });

  it('resumes from the persisted next step and returns to queued', () => {
    const projection = reduceAgentEvents([
      event(1, 'run.created'),
      event(2, 'run.paused', { nextStepId: 'generate-2' }),
      event(3, 'run.resumed', { nextStepId: 'generate-2', generation: 2 }),
    ]);

    expect(projection.resumeFromStepId).toBe('generate-2');
    expect(projection.status).toBe('queued');
  });

  it('ignores execution events from a stale or missing generation after resume', () => {
    const projection = reduceAgentEvents([
      event(1, 'run.created'),
      event(2, 'run.paused', { nextStepId: 'generate-2' }),
      event(3, 'run.resumed', { nextStepId: 'generate-2', generation: 4 }),
      event(4, 'tool.started', { toolId: 'generate-2', stepId: 'generate-2', generation: 3 }),
      event(5, 'step.retrying', { stepId: 'generate-2', generation: 3, progress: 50 }),
      event(6, 'tool.completed', { toolId: 'generate-2' }),
      event(7, 'tool.started', { toolId: 'generate-2', stepId: 'generate-2', generation: 4 }),
    ]);

    expect(projection.status).toBe('executing');
    expect(projection.currentStepId).toBe('generate-2');
    expect(projection.ignoredEventIds).toEqual(expect.arrayContaining([
      'event-4', 'event-5', 'event-6',
    ]));
  });

  it('projects retry and quality events deterministically across disorder and duplicates', () => {
    const projection = reduceAgentEvents([
      event(7, 'quality.checked', {
        stepId: 'generate-2', gateId: 'composition', passed: true,
      }),
      event(1, 'run.created'),
      event(5, 'step.retrying', { stepId: 'generate-2', progress: 40 }),
      event(7, 'quality.checked', {
        stepId: 'generate-2', gateId: 'composition', passed: true,
      }),
    ]);

    expect(projection.currentStepId).toBe('generate-2');
    expect(projection.progress).toBe(40);
    expect(projection.qualityChecks).toEqual([
      { stepId: 'generate-2', gateId: 'composition', passed: true },
    ]);
    expect(projection.missingSequences).toEqual([2, 3, 4, 6]);
    expect(projection.ignoredEventIds).toEqual(['event-7']);
  });

  it('uses a stable event ID tie-breaker for conflicting duplicate sequences', () => {
    const events = [
      event(1, 'run.created'),
      event(5, 'quality.checked', {
        stepId: 'generate-2', gateId: 'composition', passed: true,
      }, 'quality-a'),
      event(5, 'quality.checked', {
        stepId: 'generate-2', gateId: 'composition', passed: false,
      }, 'quality-b'),
    ];

    expect(reduceAgentEvents(events)).toEqual(reduceAgentEvents([...events].reverse()));
  });


  it('locks the first terminal event and ignores all later terminal, tool, and asset facts', () => {
    const projection = reduceAgentEvents([
      event(1, 'run.created'),
      event(2, 'plan.updated', {
        plan: [{ id: 'step-1', label: 'Generate', status: 'pending' }],
      }),
      event(3, 'tool.started'),
      event(4, 'run.cancelled'),
      event(5, 'tool.completed', { result: { imageUrl: '/late.png' } }),
      event(6, 'asset.created', { assetVersionId: 'late-version' }),
      event(7, 'run.completed', { result: { imageUrl: '/late.png' } }),
    ]);

    expect(projection.status).toBe('cancelled');
    expect(projection.lastSequence).toBe(4);
    expect(projection.assetVersionIds).toEqual([]);
    expect(projection.result).toBeUndefined();
    expect(projection.ignoredEventIds).toEqual([
      'event-5',
      'event-6',
      'event-7',
    ]);
  });

  it('deduplicates repeated event IDs and sequences deterministically', () => {
    const projection = reduceAgentEvents([
      event(1, 'run.created'),
      event(2, 'tool.started', {}, 'tool-first'),
      event(2, 'asset.created', { assetVersionId: 'duplicate-version' }, 'tool-duplicate'),
      event(3, 'tool.progress', {}, 'tool-first'),
    ]);

    expect(projection.status).toBe('executing');
    expect(projection.lastSequence).toBe(2);
    expect(projection.assetVersionIds).toEqual([]);
    expect(projection.ignoredEventIds).toEqual([
      'tool-duplicate',
      'tool-first',
    ]);
  });

  it('never accepts an event ID again after its first occurrence was ignored', () => {
    const projection = reduceAgentEvents([
      event(1, 'run.created'),
      event(2, 'tool.started', {}, 'accepted-sequence'),
      event(2, 'tool.progress', {}, 'repeated-later'),
      event(3, 'asset.created', { assetVersionId: 'must-not-appear' }, 'repeated-later'),
    ]);

    expect(projection.lastSequence).toBe(2);
    expect(projection.assetVersionIds).toEqual([]);
    expect(projection.ignoredEventIds).toEqual([
      'repeated-later',
      'repeated-later',
    ]);
  });

  it('continues across sequence gaps while exposing the missing sequences for recovery', () => {
    const projection = reduceAgentEvents([
      event(4, 'asset.created', { assetVersionId: 'version-4' }),
      event(1, 'run.created'),
    ]);

    expect(projection.lastSequence).toBe(4);
    expect(projection.missingSequences).toEqual([2, 3]);
    expect(projection.assetVersionIds).toEqual(['version-4']);
  });

  it.each([
    ['run.failed', 'failed'],
    ['run.timeout', 'timeout'],
  ] as const)('locks %s as the terminal status', (type, status) => {
    const projection = reduceAgentEvents([
      event(1, 'run.created'),
      event(2, type, {
        error: { code: 'PROVIDER_FAILURE', message: 'Provider failed', retryable: true },
      }),
      event(3, 'run.completed', { result: { imageUrl: '/late.png' } }),
    ]);

    expect(projection.status).toBe(status);
    expect(projection.lastSequence).toBe(2);
    expect(projection.error).toEqual({
      code: 'PROVIDER_FAILURE',
      message: 'Provider failed',
      retryable: true,
    });
    expect(projection.ignoredEventIds).toContain('event-3');
  });
});

describe('Agent event payload safety', () => {
  it.each([
    { nested: { apiKey: 'not-persisted' } },
    { values: [{ access_token: 'not-persisted' }] },
    { Password: 'not-persisted' },
    { metadata: { clientSecret: 'not-persisted' } },
    { authorization: 'Bearer not-persisted' },
  ])('rejects recursively secret-bearing keys without echoing values: %j', (payload) => {
    expect(() => assertAgentEventPayloadSafe(payload)).toThrowError(
      'Agent event payload contains sensitive data',
    );

    try {
      assertAgentEventPayloadSafe(payload);
    } catch (error) {
      expect(String(error)).not.toContain('not-persisted');
    }
  });

  it.each([
    { value: 'Bearer abcdefghijklmnopqrstuvwxyz' },
    { value: 'sk-abcdefghijklmnopqrstuvwxyz123456' },
    { value: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----' },
  ])('rejects recognizable secret values even under neutral keys', (payload) => {
    expect(() => assertAgentEventPayloadSafe(payload)).toThrowError(
      'Agent event payload contains sensitive data',
    );
  });

  it.each([
    { prompt: 'Use sk-abcdefghijklmnopqrstuvwxyz123456 for this request' },
    { prompt: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz' },
    { prompt: 'password = never-persist-this-value' },
  ])('rejects credential material embedded in free-form text', (payload) => {
    expect(() => assertAgentEventPayloadSafe(payload)).toThrowError(
      'Agent event payload contains sensitive data',
    );
  });

  it.each([
    { value: 'https://assets.example.com/private/source.png' },
    { value: 'https://cdn.example.com/a.png?X-Amz-Signature=secret' },
    { prompt: 'POST https://api.example.com with x-api-key: abcdefghijklmnop' },
  ])('rejects remote or signed URLs and credential-shaped strings in events', (payload) => {
    expect(() => assertAgentEventPayloadSafe(payload)).toThrowError(
      'Agent event payload contains sensitive data',
    );
  });

  it('does not mistake ordinary Chinese product copy for a credential', () => {
    expect(assertAgentEventPayloadSafe({
      prompt: '设计一个“API 密钥管理”和“访问令牌说明”的中文帮助页面，不要展示真实凭据。',
    })).toEqual({
      prompt: '设计一个“API 密钥管理”和“访问令牌说明”的中文帮助页面，不要展示真实凭据。',
    });
  });

  it('accepts nested JSON payloads without credential material', () => {
    expect(assertAgentEventPayloadSafe({
      progress: 45,
      result: { imageUrl: '/uploads/result.png' },
      tags: ['agent', 'canvas'],
    })).toEqual({
      progress: 45,
      result: { imageUrl: '/uploads/result.png' },
      tags: ['agent', 'canvas'],
    });
  });
});
