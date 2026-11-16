import { describe, expect, it } from 'vitest';
import {
  buildChatRequestHistory,
  findChatTurnUserMessage,
  isLatestChatTurnMessage,
  restoreChatMessageImages,
  type CanvasChatHistoryMessage,
} from '@/lib/canvas-chat-history';

const anchor = (id: string) => ({ imageId: id, imageUrl: `https://e/${id}.png`, imageName: id, assetVersionId: `v-${id}` });

function turns(count: number): CanvasChatHistoryMessage[] {
  return Array.from({ length: count }, (_, index) => [
    { id: `u${index}`, role: 'user' as const, content: `q${index}`, imageAnchors: [anchor(`i${index}`)] },
    { id: `a${index}`, role: 'assistant' as const, content: `r${index}` },
  ]).flat();
}

describe('canvas chat request history', () => {
  it('keeps only the most recent messages and starts at a user message', () => {
    const history = buildChatRequestHistory(turns(30), 5, 10);
    expect(history.map(message => message.id)).toEqual(['u28', 'a28', 'u29', 'a29']);
  });

  it('strips images from messages outside the image window but keeps their text', () => {
    const history = buildChatRequestHistory(turns(4), 40, 2);
    expect(history.filter(message => message.imageAnchors).map(message => message.id)).toEqual(['u3']);
    expect(history.find(message => message.id === 'u0')).toEqual({ id: 'u0', role: 'user', content: 'q0' });
  });

  it('drops empty placeholder messages', () => {
    const history = buildChatRequestHistory([
      { id: 'u', role: 'user', content: 'hi' },
      { id: 'a', role: 'assistant', content: '' },
    ], 40, 6);
    expect(history.map(message => message.id)).toEqual(['u']);
  });
});

describe('canvas chat regenerate', () => {
  const messages = turns(2);

  it('only offers regenerate for the latest turn', () => {
    expect(isLatestChatTurnMessage(messages, 'u1')).toBe(true);
    expect(isLatestChatTurnMessage(messages, 'a1')).toBe(true);
    expect(isLatestChatTurnMessage(messages, 'a0')).toBe(false);
    expect(isLatestChatTurnMessage(messages, 'missing')).toBe(false);
  });

  it('finds the user message that started the turn', () => {
    expect(findChatTurnUserMessage(messages, 'a1')?.id).toBe('u1');
    expect(findChatTurnUserMessage(messages, 'u1')?.id).toBe('u1');
    expect(findChatTurnUserMessage(messages, 'missing')).toBeUndefined();
  });

  it('restores the images the user message carried', () => {
    expect(restoreChatMessageImages({
      id: 'u', role: 'user', content: 'q', imageUrl: 'https://e/legacy.png', imageAnchors: [anchor('x')],
    })).toEqual([
      { id: 'x', url: 'https://e/x.png', name: 'x', assetVersionId: 'v-x' },
      { id: 'u-image', url: 'https://e/legacy.png', name: '图片' },
    ]);
  });
});
