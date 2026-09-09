import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  loadUserSkillCatalog: vi.fn(),
  copySkillForUser: vi.fn(),
  createConversationSkillForUser: vi.fn(),
  deleteUserSkill: vi.fn(),
  updateUserSkill: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/skill-runtime/storage', () => ({
  loadUserSkillCatalog: mocks.loadUserSkillCatalog,
  copySkillForUser: mocks.copySkillForUser,
  createConversationSkillForUser: mocks.createConversationSkillForUser,
  deleteUserSkill: mocks.deleteUserSkill,
  updateUserSkill: mocks.updateUserSkill,
}));

import { GET, POST } from '@/app/api/skills/route';
import { DELETE, PATCH } from '@/app/api/skills/[skillId]/route';
import { readStrictJsonObject, SkillRequestError } from '@/app/api/skills/http';
import { CANVAS_WORKFLOW_SKILLS } from '@/lib/skill-runtime/catalog';
import type { SkillDefinition } from '@/lib/skill-runtime/types';

const auth = {
  authenticated: true as const,
  userId: 'user-1',
  userRole: 'user',
  user: { id: 'user-1' },
  source: 'cookie' as const,
};

function jsonRequest(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/skills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAuthOrReject.mockResolvedValue(auth);
  });

  it('requires API authentication before reading the catalog', async () => {
    const rejection = NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    mocks.requireApiAuthOrReject.mockResolvedValue(rejection);

    const response = await GET(new NextRequest('http://localhost/api/skills?surface=canvas'));

    expect(response).toBe(rejection);
    expect(mocks.loadUserSkillCatalog).not.toHaveBeenCalled();
  });

  it('lists only a strict supported surface for the authenticated user', async () => {
    mocks.loadUserSkillCatalog.mockResolvedValue([{ id: 'preset-ecommerce-listing' }]);

    const response = await GET(new NextRequest('http://localhost/api/skills?surface=canvas'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ skills: [{ id: 'preset-ecommerce-listing' }] });
    expect(mocks.loadUserSkillCatalog).toHaveBeenCalledWith('user-1', 'canvas');

    const invalid = await GET(new NextRequest('http://localhost/api/skills?surface=Canvas'));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_SKILL_SURFACE' });
  });

  it('omits a simple-chat executable Skill when its catalog visibility excludes simple chat', async () => {
    const source = CANVAS_WORKFLOW_SKILLS[0] as SkillDefinition;
    const originalAllowed = source.allowedSurfaces;
    const originalCatalog = source.catalogSurfaces;
    source.allowedSurfaces = ['canvas', 'workflow', 'simple-chat'];
    source.catalogSurfaces = ['canvas', 'workflow'];
    try {
      const actualStorage = await vi.importActual<typeof import('@/lib/skill-runtime/storage')>(
        '@/lib/skill-runtime/storage',
      );
      const store = actualStorage.createSkillStore(actualStorage.createMemorySkillStorageAdapter());
      mocks.loadUserSkillCatalog.mockImplementation((userId, surface) => store.load(userId, surface));

      const response = await GET(new NextRequest('http://localhost/api/skills?surface=simple-chat'));

      expect(response.status).toBe(200);
      expect((await response.json()).skills).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: source.id }),
      ]));
      await expect(store.resolveExecutable('user-1', source.id, 'simple-chat'))
        .resolves.toMatchObject({ id: source.id });
    } finally {
      source.allowedSurfaces = originalAllowed;
      source.catalogSurfaces = originalCatalog;
    }
  });

  it('creates a copy from a strict JSON body and rejects unknown fields', async () => {
    mocks.copySkillForUser.mockResolvedValue({ id: 'skill-copy', version: 1 });

    const response = await POST(jsonRequest('http://localhost/api/skills', 'POST', {
      sourceSkillId: 'preset-ecommerce-listing',
    }));
    expect(response.status).toBe(201);
    expect(mocks.copySkillForUser).toHaveBeenCalledWith('user-1', 'preset-ecommerce-listing');

    const unknown = await POST(jsonRequest('http://localhost/api/skills', 'POST', {
      sourceSkillId: 'preset-ecommerce-listing',
      ownerId: 'user-2',
    }));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ code: 'INVALID_REQUEST_BODY' });
  });

  it('creates an independent conversation Skill without a selected template', async () => {
    mocks.createConversationSkillForUser.mockResolvedValue({ id: 'skill-conversation-1', version: 1 });
    const response = await POST(jsonRequest('http://localhost/api/skills', 'POST', {
      name: 'Saved conversation', description: 'Reusable exchange', category: '品牌视觉',
      systemPrompt: 'You are a brand designer', conversation: 'User: make a poster',
    }));

    expect(response.status).toBe(201);
    expect(mocks.createConversationSkillForUser).toHaveBeenCalledWith('user-1', {
      name: 'Saved conversation', description: 'Reusable exchange', category: '品牌视觉',
      systemPrompt: 'You are a brand designer', conversation: 'User: make a poster',
    });
    expect(mocks.copySkillForUser).not.toHaveBeenCalled();
  });

  it('accepts a bounded Chinese conversation together with its agent prompt', async () => {
    mocks.createConversationSkillForUser.mockResolvedValue({ id: 'skill-conversation-cn', version: 1 });
    const conversation = '用户：请继续完善当前画布设计。\n助手：我会保留现有元素并优化布局。'.repeat(70).slice(0, 2_000);
    const systemPrompt = '你是画布中的品牌设计智能体，需要结合当前项目素材继续执行。'.repeat(50);
    const body = {
      name: '中文画布对话',
      description: conversation,
      category: '品牌视觉',
      systemPrompt,
      conversation,
    };
    expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeGreaterThan(8_192);

    const response = await POST(jsonRequest('http://localhost/api/skills', 'POST', body));

    expect(response.status).toBe(201);
    expect(mocks.createConversationSkillForUser).toHaveBeenCalledWith('user-1', body);
  });

  it('rejects malformed, non-JSON, and overlong copy requests', async () => {
    const malformed = await POST(new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    }));
    expect(malformed.status).toBe(400);

    const wrongType = await POST(new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    }));
    expect(wrongType.status).toBe(415);

    const overlong = await POST(jsonRequest('http://localhost/api/skills', 'POST', {
      sourceSkillId: `preset-${'x'.repeat(200)}`,
    }));
    expect(overlong.status).toBe(400);
    expect(mocks.copySkillForUser).not.toHaveBeenCalledWith('user-1', expect.stringContaining('x'.repeat(200)));
  });

  it('enforces the body limit in UTF-8 bytes for Unicode JSON', async () => {
    const text = JSON.stringify({ value: '界'.repeat(2_800) });
    expect(text.length).toBeLessThan(8_192);
    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(8_192);

    await expect(readStrictJsonObject(new Request('http://localhost/api/skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: text,
    }))).rejects.toMatchObject({ code: 'INVALID_REQUEST_BODY' });
  });

  it('rejects oversized Content-Length before pulling the request body', async () => {
    const getReader = vi.fn();
    const request = {
      headers: new Headers({
        'content-type': 'application/json',
        'content-length': '8193',
      }),
      body: { getReader },
    } as unknown as Request;

    await expect(readStrictJsonObject(request)).rejects.toMatchObject({
      code: 'INVALID_REQUEST_BODY',
    });
    expect(getReader).not.toHaveBeenCalled();
  });

  it('cancels streaming reads immediately after the byte limit is exceeded', async () => {
    let pull = 0;
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pull += 1;
        controller.enqueue(new Uint8Array(5_000).fill(0x20));
        if (pull === 3) controller.close();
      },
      cancel: cancelled,
    });
    const request = new Request('http://localhost/api/skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    await expect(readStrictJsonObject(request)).rejects.toBeInstanceOf(SkillRequestError);
    expect(pull).toBe(2);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('rejects malformed UTF-8 with a stable encoding error', async () => {
    const request = new Request('http://localhost/api/skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new Uint8Array([0xff]),
    });

    await expect(readStrictJsonObject(request)).rejects.toMatchObject({
      code: 'INVALID_REQUEST_BODY',
      message: 'Invalid UTF-8 body',
    });
  });

  it('patches only enabled, name, and description and maps hidden ownership to 404', async () => {
    mocks.updateUserSkill.mockResolvedValue({ id: 'skill-copy', version: 2, enabled: false });
    const context = { params: Promise.resolve({ skillId: 'skill-copy' }) };

    const response = await PATCH(jsonRequest('http://localhost/api/skills/skill-copy', 'PATCH', {
      enabled: false,
      name: 'My skill',
      description: 'Updated description',
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.updateUserSkill).toHaveBeenCalledWith('user-1', 'skill-copy', {
      enabled: false,
      name: 'My skill',
      description: 'Updated description',
    });

    mocks.updateUserSkill.mockRejectedValueOnce(Object.assign(new Error('missing'), {
      code: 'SKILL_NOT_FOUND',
      status: 404,
    }));
    const missing = await PATCH(jsonRequest('http://localhost/api/skills/hidden', 'PATCH', {
      enabled: false,
    }), { params: Promise.resolve({ skillId: 'hidden' }) });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'SKILL_NOT_FOUND' });

    const forbidden = await PATCH(jsonRequest('http://localhost/api/skills/skill-copy', 'PATCH', {
      allowedSurfaces: ['simple-chat'],
    }), context);
    expect(forbidden.status).toBe(400);
  });

  it('deletes an owned Skill through an explicit server contract', async () => {
    const response = await DELETE(
      new NextRequest('http://localhost/api/skills/skill-copy', { method: 'DELETE' }),
      { params: Promise.resolve({ skillId: 'skill-copy' }) },
    );

    expect(response.status).toBe(204);
    expect(mocks.deleteUserSkill).toHaveBeenCalledWith('user-1', 'skill-copy');
  });

  it('returns stable conflict and storage failure statuses', async () => {
    mocks.copySkillForUser.mockRejectedValueOnce(Object.assign(new Error('conflict'), {
      code: 'SKILL_REVISION_CONFLICT',
      status: 409,
    }));
    const conflict = await POST(jsonRequest('http://localhost/api/skills', 'POST', {
      sourceSkillId: 'preset-storyboard',
    }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'SKILL_REVISION_CONFLICT' });

    mocks.copySkillForUser.mockRejectedValueOnce(Object.assign(new Error('storage failed'), {
      code: 'SKILL_STORAGE_ERROR',
      status: 500,
    }));
    const failed = await POST(jsonRequest('http://localhost/api/skills', 'POST', {
      sourceSkillId: 'preset-storyboard',
    }));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ code: 'SKILL_STORAGE_ERROR', error: 'Skill storage failed' });
  });
});
