import { afterEach, describe, expect, it } from 'vitest';

import * as handoffClient from '@/lib/simple-chat-workspace-handoff-client';

type BoundedKeyBuilder = (scope: string, parts: string[]) => string;
type CanvasIdentityBuilder = (input: {
  targetProjectId: string;
  chatTaskId: string;
  messageId: string;
  imageIndex: number;
  sourceVersionId: string;
}) => { entityId: string; idempotencyKey: string };

const originalCrypto = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
});

describe('simple-chat transfer idempotency', () => {
  it('preserves readable short keys and hashes long identities within the API limit', async () => {
    const build = (handoffClient as unknown as { buildBoundedSimpleChatTransferIdempotencyKey?: BoundedKeyBuilder })
      .buildBoundedSimpleChatTransferIdempotencyKey;
    expect(build).toBeTypeOf('function');
    if (!build) return;

    expect(build('simple-chat-canvas', ['project-a', 'task-a', 'message-a', '0', 'version-a']))
      .toBe('simple-chat-canvas:project-a:task-a:message-a:0:version-a');

    const longParts = ['project-'.repeat(20), 'task-'.repeat(20), 'message-'.repeat(20), '0', 'version-'.repeat(20)];
    const first = build('simple-chat-canvas', longParts);
    const repeated = build('simple-chat-canvas', longParts);
    const changed = build('simple-chat-canvas', [...longParts.slice(0, -1), 'different-version']);

    expect(first.length).toBeLessThanOrEqual(256);
    expect(first).toBe(repeated);
    expect(first).not.toBe(changed);
    expect(first).toMatch(/^simple-chat-canvas:[a-f0-9]{64}$/);
  });

  it('builds a complete bounded canvas transfer identity without Web Crypto', () => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    const build = (handoffClient as unknown as { buildSimpleChatCanvasTransferIdentity?: CanvasIdentityBuilder })
      .buildSimpleChatCanvasTransferIdentity;
    expect(build).toBeTypeOf('function');
    if (!build) return;

    expect(build({
      targetProjectId: 'project-a',
      chatTaskId: 'task-a',
      messageId: 'message-a',
      imageIndex: 0,
      sourceVersionId: 'version-a',
    })).toEqual({
      entityId: 'simple-chat:task-a:message-a:0',
      idempotencyKey: 'simple-chat-canvas:project-a:task-a:message-a:0:version-a',
    });

    const long = build({
      targetProjectId: 'project-'.repeat(40),
      chatTaskId: 'task-'.repeat(40),
      messageId: 'message-'.repeat(40),
      imageIndex: 0,
      sourceVersionId: 'version-'.repeat(40),
    });
    expect(long.entityId.length).toBeLessThanOrEqual(256);
    expect(long.idempotencyKey.length).toBeLessThanOrEqual(256);
    expect(long.entityId).toMatch(/^simple-chat:[a-f0-9]{64}$/);
    expect(long.idempotencyKey).toMatch(/^simple-chat-canvas:[a-f0-9]{64}$/);
  });

  it('bounds workflow handoff idempotency keys while preserving the existing short format', () => {
    const build = handoffClient.buildSimpleChatWorkflowTransfer;
    const createInput = (value: string) => ({
      intent: {
        targetProjectId: value,
        chatProjectId: value,
        chatTaskId: value,
        chatMessageId: value,
      },
      workflowId: value,
      pending: {
        nodeId: `${value}-input`,
        imageIndex: 0,
        sourceTrace: { source: 'simple-chat' },
        assetRef: { url: '/image.png', assetVersionId: value },
      },
    });

    const short = createInput('a');
    expect(build(short.intent as never, short.workflowId, short.pending as never).idempotencyKey)
      .toBe('simple-chat-workflow:["a","a","a","a","a",0,"a"]');

    const long = createInput('identity-'.repeat(40));
    const first = build(long.intent as never, long.workflowId, long.pending as never).idempotencyKey;
    const repeated = build(long.intent as never, long.workflowId, long.pending as never).idempotencyKey;
    expect(first.length).toBeLessThanOrEqual(256);
    expect(first).toBe(repeated);
    expect(first).toMatch(/^simple-chat-workflow:[a-f0-9]{64}$/);
  });
});
