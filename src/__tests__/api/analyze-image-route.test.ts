import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), extractHeaders: vi.fn(() => ({})) }));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async () => ({ userId: 'owner', userRole: 'user' }),
}));
vi.mock('coze-coding-dev-sdk', () => ({
  LLMClient: class { invoke = mocks.invoke; },
  Config: class {},
  HeaderUtils: { extractForwardHeaders: mocks.extractHeaders },
}));

import { POST } from '@/app/api/analyze/route';

it('sends the selected image with the poster instruction and returns the analysis text', async () => {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP8sAAAAASUVORK5CYII=';
  mocks.invoke.mockResolvedValue({ content: 'blue poster, soft light' });
  const response = await POST(new NextRequest('http://localhost/api/analyze', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image, category: 'poster' }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    success: true, prompt: 'blue poster, soft light', model: 'doubao-seed-1-6-vision-250815',
  });
  expect(mocks.invoke).toHaveBeenCalledWith([expect.objectContaining({
    role: 'user', content: [
      expect.objectContaining({ type: 'text', text: expect.stringContaining('海报') }),
      { type: 'image_url', image_url: { url: image, detail: 'high' } },
    ],
  })], { model: 'doubao-seed-1-6-vision-250815', temperature: 0.7 });
});
