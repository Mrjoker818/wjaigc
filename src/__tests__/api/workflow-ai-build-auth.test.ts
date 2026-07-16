import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  findProviderForFeature: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/server-api-config', () => ({ findProviderForFeature: mocks.findProviderForFeature }));
vi.mock('@/lib/workflow-engine', () => ({
  AI_BUILD_PROMPT: 'prompt',
  AI_BUILD_REFINE_PROMPT: 'refine',
  parseAIBuildResponse: vi.fn(),
  createWorkflowFromAIResult: vi.fn(),
}));

import { POST } from '@/app/api/workflow/ai-build/route';

describe('POST /api/workflow/ai-build authorization', () => {
  beforeEach(() => {
    mocks.requireApiAuthOrReject.mockReset();
    mocks.findProviderForFeature.mockReset();
  });

  it('rejects unauthenticated callers before looking up a chat provider', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue(
      NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    );

    const response = await POST(new NextRequest('http://localhost/api/workflow/ai-build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Build a product image workflow' }),
    }));

    expect(response.status).toBe(401);
    expect(mocks.findProviderForFeature).not.toHaveBeenCalled();
  });
});
