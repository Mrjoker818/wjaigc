import { describe, expect, it } from 'vitest';
import { RENDER_LOST, waitForRender } from '@/lib/drama/render-client';

const answer = (data: unknown) => async () => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
const noSleep = async () => undefined;

describe('drama render client', () => {
  it('explains a render the server lost on restart', async () => {
    await expect(waitForRender('t', { fetch: answer({ status: 'failed', error: '任务不存在或已过期，请重新提交' }), sleep: noSleep }))
      .rejects.toThrow(RENDER_LOST);
  });

  it('keeps the server message for other failures and returns the film when done', async () => {
    await expect(waitForRender('t', { fetch: answer({ status: 'failed', error: '第 2 个镜头的配音文件读不到了' }), sleep: noSleep }))
      .rejects.toThrow('第 2 个镜头的配音文件读不到了');
    await expect(waitForRender('t', { fetch: answer({ status: 'completed', result: { videoUrl: '/v/f.mp4', durationSec: 12 } }), sleep: noSleep }))
      .resolves.toEqual({ videoUrl: '/v/f.mp4', durationSec: 12 });
  });
});
