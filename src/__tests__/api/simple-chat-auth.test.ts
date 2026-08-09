import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findProviderForModel: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/server-api-config', () => ({
  findProviderForModel: mocks.findProviderForModel,
}));

vi.mock('@/lib/server-auth', () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock('coze-coding-dev-sdk', () => ({
  SearchClient: class {},
  Config: class {},
  HeaderUtils: { extractForwardHeaders: vi.fn() },
}));

import { POST } from '@/app/api/simple-chat/chat/route';

function request(): NextRequest {
  return new NextRequest('http://localhost/api/simple-chat/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'chat-model',
    }),
  });
}

describe('POST /api/simple-chat/chat', () => {
  beforeEach(() => {
    mocks.findProviderForModel.mockReset();
    mocks.getSessionUser.mockReset();
  });

  it('rejects unauthenticated requests before looking up a provider', async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
  });

  it('rejects a signed-in user without intelligent-chat permission', async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      productType: 'canvas',
      apiPermissions: { chat: false },
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
  });
});
