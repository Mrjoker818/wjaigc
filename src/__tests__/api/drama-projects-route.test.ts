import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userId: 'user-a' as string | null,
  rows: new Map<string, { id: string; user_id: string; project_id: string | null; title: string; doc: unknown; version: number; created_at: number; updated_at: number }>(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async () => (mocks.userId
    ? { authenticated: true, userId: mocks.userId, userRole: 'user' }
    : NextResponse.json({ error: 'Authentication required' }, { status: 401 })),
}));
vi.mock('@/lib/collaboration/generation-project-access', () => ({
  GenerationProjectAccessError: class extends Error { status = 403; code = 'GENERATION_PROJECT_FORBIDDEN'; },
  authorizeGenerationProject: async ({ projectId }: { projectId: string }) => ({ kind: 'personal', projectId }),
}));
// A tiny in-memory stand-in for the four statements the store issues.
vi.mock('@/lib/db-client', () => ({
  execSql: async (sql: string, params: unknown[]) => {
    const pick = (row: typeof mocks.rows extends Map<string, infer R> ? R : never) => ({ ...row, doc: JSON.parse(String(row.doc)) });
    if (sql.startsWith('INSERT')) {
      const [id, user_id, project_id, title, doc, now] = params as [string, string, string | null, string, string, number];
      const row = { id, user_id, project_id, title, doc, version: 1, created_at: now, updated_at: now };
      mocks.rows.set(id, row);
      return { rows: [pick(row)], rowCount: 1 };
    }
    if (sql.trim().startsWith('UPDATE')) {
      const [id, userId, version, doc, title, now] = params as [string, string, number, string, string, number];
      const row = mocks.rows.get(id);
      if (!row || row.user_id !== userId || row.version !== version) return { rows: [], rowCount: 0 };
      Object.assign(row, { doc, title, version: row.version + 1, updated_at: now });
      return { rows: [pick(row)], rowCount: 1 };
    }
    if (sql.startsWith('DELETE')) {
      const [id, userId] = params as [string, string];
      const row = mocks.rows.get(id);
      if (!row || row.user_id !== userId) return { rows: [], rowCount: 0 };
      mocks.rows.delete(id);
      return { rows: [], rowCount: 1 };
    }
    const [id, userId] = params as [string, string];
    const row = mocks.rows.get(id);
    return row && row.user_id === userId ? { rows: [pick(row)], rowCount: 1 } : { rows: [], rowCount: 0 };
  },
}));

import { POST as create } from '@/app/api/drama/projects/route';
import { DELETE as remove, GET as read, PUT as save } from '@/app/api/drama/projects/[id]/route';

const request = (method: string, body?: unknown) => new NextRequest('http://localhost/api/drama/projects', {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  mocks.userId = 'user-a';
  mocks.rows.clear();
});

describe('drama project routes', () => {
  it('creates, saves with the version lock and rejects a stale save', async () => {
    const created = await (await create(request('POST', { title: '雨夜来信', projectId: 'p1' }))).json();
    const { id, version, doc } = created.project;
    expect(version).toBe(1);
    expect(created.project.projectId).toBe('p1');

    const first = await save(request('PUT', { version: 1, doc: { ...doc, title: '新名字' } }), ctx(id));
    expect(first.status).toBe(200);
    expect((await first.json()).project).toMatchObject({ version: 2, title: '新名字' });

    const stale = await save(request('PUT', { version: 1, doc }), ctx(id));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'DRAMA_VERSION_CONFLICT', currentVersion: 2 });
  });

  it('hides other users projects and rejects invalid documents', async () => {
    const { project } = await (await create(request('POST', {}))).json();
    mocks.userId = 'user-b';
    expect((await read(request('GET'), ctx(project.id))).status).toBe(404);
    expect((await save(request('PUT', { version: 1, doc: project.doc }), ctx(project.id))).status).toBe(404);
    expect((await remove(request('DELETE'), ctx(project.id))).status).toBe(404);
    mocks.userId = 'user-a';
    const invalid = await save(request('PUT', { version: 1, doc: { ...project.doc, style: 'noir' } }), ctx(project.id));
    expect(invalid.status).toBe(400);
    expect((await read(request('GET'), ctx('../etc'))).status).toBe(404);
    expect((await remove(request('DELETE'), ctx(project.id))).status).toBe(200);
  });

  it('requires authentication', async () => {
    mocks.userId = null;
    expect((await create(request('POST', {}))).status).toBe(401);
  });
});
