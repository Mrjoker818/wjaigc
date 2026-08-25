import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  applySimpleChatModelSelection,
  buildSimpleChatHistoryRequestContext,
  filterSimpleChatImageInputs,
  readSimpleChatModelSelection,
  resolveSimpleChatModelSelection,
} from '@/lib/simple-chat-request-context';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zr1sAAAAASUVORK5CYII=';

const LONG_VALID_PNG = (() => {
  const pngBytes = Uint8Array.from(
    globalThis.atob(PNG_1PX.split(',')[1]),
    character => character.charCodeAt(0),
  );
  const bytes = new Uint8Array(pngBytes.length + 4096);
  bytes.set(pngBytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${globalThis.btoa(binary)}`;
})();

describe('simple-chat model selection', () => {
  it('atomically applies model and provider without mutating the task', () => {
    const task = { id: 'task-1', model: 'gemini-old', providerId: 'provider-old' };
    const next = applySimpleChatModelSelection(task, {
      modelId: 'gpt-5.5',
      providerId: 'provider-apimart',
    });
    expect(next).toEqual({ id: 'task-1', model: 'gpt-5.5', providerId: 'provider-apimart' });
    expect(task).toEqual({ id: 'task-1', model: 'gemini-old', providerId: 'provider-old' });
    expect(readSimpleChatModelSelection(next)).toEqual({
      modelId: 'gpt-5.5',
      providerId: 'provider-apimart',
    });
  });

  it('widens replaced model and provider fields from literal input types', () => {
    const task = {
      id: 'task-1',
      model: 'gemini-old',
      providerId: 'provider-old',
    } as const;
    const next = applySimpleChatModelSelection(task, {
      modelId: 'gpt-5.5',
      providerId: 'provider-apimart',
    });

    expectTypeOf(next.model).toEqualTypeOf<string>();
    expectTypeOf(next.providerId).toEqualTypeOf<string>();
  });

  it('repairs incomplete or stale selections to an exact catalog pair', () => {
    const catalog = [
      { modelId: 'shared-model', providerId: 'provider-a' },
      { modelId: 'shared-model', providerId: 'provider-b' },
      { modelId: 'other-model', providerId: 'provider-b' },
    ];

    expect(resolveSimpleChatModelSelection({ model: 'shared-model', providerId: '' }, catalog)).toEqual({
      modelId: 'shared-model',
      providerId: 'provider-a',
    });
    expect(resolveSimpleChatModelSelection({ model: '', providerId: 'provider-b' }, catalog)).toEqual({
      modelId: 'shared-model',
      providerId: 'provider-b',
    });
    expect(resolveSimpleChatModelSelection({ model: 'missing', providerId: 'missing' }, catalog)).toEqual({
      modelId: 'shared-model',
      providerId: 'provider-a',
    });
    expect(resolveSimpleChatModelSelection({ model: 'other-model', providerId: 'provider-b' }, catalog)).toEqual({
      modelId: 'other-model',
      providerId: 'provider-b',
    });
  });
});

describe('simple-chat image context', () => {
  it('keeps supported images and rejects malformed or unsafe references', () => {
    const result = filterSimpleChatImageInputs([
      'https://cdn.example.com/a.png',
      '/api/serve-upload/uploads/a.png',
      '/uploads/b.webp',
      PNG_1PX,
      'data:image/png;base64,not-valid',
      'data:text/plain;base64,SGVsbG8=',
      'blob:https://example.com/old',
      '',
      'https://user:password@example.com/private.png',
      'http://user:password@example.com/private.png',
      '//cdn.example.com/protocol-relative.png',
      '/api/serve-upload/../private.png',
      '/uploads/../private.png',
      '/uploads/%2525252e%2525252e/private.png',
      `https://cdn.example.com/${'a'.repeat(4097)}`,
    ]);
    expect(result.accepted).toEqual([
      'https://cdn.example.com/a.png',
      '/api/serve-upload/uploads/a.png',
      '/uploads/b.webp',
      PNG_1PX,
    ]);
    expect(result.rejectedCount).toBe(11);
  });

  it('accepts signature-valid data images longer than the URL limit', () => {
    expect(LONG_VALID_PNG.length).toBeGreaterThan(4096);
    expect(filterSimpleChatImageInputs([LONG_VALID_PNG])).toEqual({
      accepted: [LONG_VALID_PNG],
      rejectedCount: 0,
    });
  });

  it('only attaches valid images from the latest three image-bearing user rounds', () => {
    const messages = [
      { id: 'u1', role: 'user', content: 'one', images: ['https://cdn.example.com/1.png'] },
      { id: 'a1', role: 'assistant', content: 'reply' },
      { id: 'u2', role: 'user', content: 'two', images: ['https://cdn.example.com/2.png'] },
      { id: 'u3', role: 'user', content: 'three', images: ['data:image/png;base64,broken'] },
      { id: 'u4', role: 'user', content: 'four', images: ['/uploads/4.png'] },
    ];
    const originalMessages = structuredClone(messages);
    const context = buildSimpleChatHistoryRequestContext(messages);
    expect(context.messages.find(message => message.id === 'u1')?.images).toBeUndefined();
    expect(context.messages.find(message => message.id === 'u2')?.images).toEqual([
      'https://cdn.example.com/2.png',
    ]);
    expect(context.messages.find(message => message.id === 'u3')?.images).toBeUndefined();
    expect(context.messages.find(message => message.id === 'u4')?.images).toEqual(['/uploads/4.png']);
    expect(context.rejectedCount).toBe(1);
    expect(messages).toEqual(originalMessages);
  });
});
