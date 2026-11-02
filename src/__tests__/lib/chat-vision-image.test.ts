import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { prepareChatVisionMessages, prepareVisionImage } from '@/lib/chat-vision-image';

describe('canvas chat vision image preparation', () => {
  it('inlines a readable image and preserves its exact pixel dimensions', async () => {
    const source = await sharp({
      create: { width: 3, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).png().toBuffer();

    const prepared = await prepareVisionImage(`data:image/png;base64,${source.toString('base64')}`);

    expect(prepared).toMatchObject({ width: 3, height: 2, source: 'inline' });
    expect(prepared?.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('does not let a prompt substitute for an unreadable image', async () => {
    const [message] = await prepareChatVisionMessages([{
      role: 'user',
      content: [
        { type: 'text', text: '描述图片#1' },
        { type: 'image_url', image_url: { url: '/api/serve-upload/missing-image.png' } },
      ],
    }]);

    expect(message.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('不要根据文件名猜测') }),
    ]);
  });
});
