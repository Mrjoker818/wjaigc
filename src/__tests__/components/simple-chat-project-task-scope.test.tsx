// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type ChatArea from '@/components/simple-chat/chat-area';
import type { SimpleChatProject, SimpleChatTask } from '@/components/simple-chat/simple-chat-types';
import { createMemorySimpleChatEnvelopeStore, jsonResponse, project, task } from '@/__tests__/fixtures/simple-chat-sync';
import type { SimpleChatSyncCoordinator } from '@/lib/simple-chat-sync-client';

const boundary = vi.hoisted(() => ({
  chat: null as ComponentProps<typeof ChatArea> | null,
  projects: [] as SimpleChatProject[],
  coordinator: null as SimpleChatSyncCoordinator | null,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/lib/auth-session', () => ({ fetchSessionPayload: async () => ({
  success: true, user: { id: 'synthetic-user', name: 'Synthetic', createdAt: 1, updatedAt: 1 },
}) }));
vi.mock('@/lib/simple-chat-sync-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/simple-chat-sync-client')>();
  return { ...actual, createSimpleChatSyncCoordinator: () => boundary.coordinator };
});
vi.mock('@/lib/simple-chat-sync-storage', () => ({ createIndexedDbSimpleChatEnvelopeStore: () => ({}) }));
vi.mock('@/components/dashboard/login-panel', () => ({ LoginPanel: () => null }));
vi.mock('@/components/simple-chat/sidebar', () => ({
  default: (props: { projects: SimpleChatProject[] }) => { boundary.projects = props.projects; return null; },
}));
vi.mock('@/components/simple-chat/chat-area', () => ({
  default: (props: ComponentProps<typeof ChatArea>) => { boundary.chat = props; return null; },
}));

import SimpleChatPage from '../../app/simple-chat/page';

function fixture(): SimpleChatProject[] {
  const a = project('project-a', [task('shared', 'A original'), task('a-other', 'A other')]);
  const b = project('project-b', [task('shared', 'B original'), task('b-other', 'B other')]);
  a.tasks[0].messages = [{ id: 'a-message', role: 'user', content: 'A private content', createdAt: 1 }];
  b.tasks[0].messages = [{ id: 'b-message', role: 'user', content: 'B private content', createdAt: 1 }];
  return [a, b];
}

async function mountPage(): Promise<{
  initial: SimpleChatProject[];
  coordinator: SimpleChatSyncCoordinator;
  store: ReturnType<typeof createMemorySimpleChatEnvelopeStore>;
  remote: () => SimpleChatProject[];
}> {
  const initial = fixture();
  let remote = structuredClone(initial);
  let revision = 4;
  const store = createMemorySimpleChatEnvelopeStore();
  const syncClient = await vi.importActual<typeof import('@/lib/simple-chat-sync-client')>('@/lib/simple-chat-sync-client');
  let sequence = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    if (String(input).split('?')[0] !== '/api/user-data/sync') throw new Error('Unexpected network request');
    if (init?.method === 'GET') return jsonResponse(200, { success: true, value: remote, syncRevision: revision });
    if (init?.method !== 'POST') throw new Error('Unexpected request method');
    const body = JSON.parse(String(init.body)) as { key: string; value: SimpleChatProject[]; expectedRevision: number };
    if (body.key !== 'chat_simple_projects' || body.expectedRevision !== revision) throw new Error('Unexpected sync request');
    remote = structuredClone(body.value);
    revision += 1;
    return jsonResponse(200, { success: true, syncRevision: revision });
  };
  const coordinator = syncClient.createSimpleChatSyncCoordinator({
    store, fetchImpl,
    createId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  });
  boundary.coordinator = coordinator;
  render(<SimpleChatPage />);
  await waitFor(() => expect(boundary.chat?.task?.id).toBe('shared'));
  await waitFor(() => expect(boundary.projects).toHaveLength(2));
  return { initial, coordinator, store, remote: () => structuredClone(remote) };
}

beforeEach(() => {
  boundary.chat = null;
  boundary.projects = [];
  boundary.coordinator = null;
  vi.stubGlobal('fetch', () => Promise.reject(new Error('Unexpected global network request')));
  window.history.replaceState(null, '', '/simple-chat');
});

afterEach(async () => {
  cleanup();
  await boundary.coordinator?.dispose({ flush: false });
  vi.unstubAllGlobals();
});

describe('simple chat project-scoped task updates', () => {
  it.each(['update', 'persist'] as const)(
    '%s only changes the task in its own project when IDs collide',
    async mode => {
      const { initial, coordinator, store, remote } = await mountPage();
      const target: SimpleChatTask = {
        ...initial[0].tasks[0], name: 'A edited',
        messages: [{ id: 'a-message', role: 'user', content: 'A edited content', createdAt: 1 }],
      };
      await act(async () => {
        if (mode === 'update') boundary.chat!.onUpdateTask(target);
        else await boundary.chat!.onPersistTask(target);
      });
      await waitFor(() => expect(boundary.projects[0].tasks[0].name).toBe('A edited'));
      expect(boundary.projects[0].tasks[0]).toMatchObject({ id: 'shared', projectId: 'project-a', messages: target.messages });
      expect(boundary.projects[0].tasks[1]).toEqual(initial[0].tasks[1]);
      expect(boundary.projects[1]).toEqual(initial[1]);
      if (mode === 'update') await act(async () => { await coordinator.flush('manual'); });
      expect(remote()[1]).toEqual(initial[1]);
      expect(remote()[0].tasks[0]).toMatchObject({ id: 'shared', projectId: 'project-a', name: 'A edited', messages: target.messages });
      const envelope = await store.get('synthetic-user');
      expect(envelope?.currentProjects[1]).toEqual(initial[1]);
      expect(envelope?.pendingOperations).toEqual([]);
    },
  );

  it.each(['update', 'persist'] as const)(
    '%s does not create a task when the project or task is missing',
    async mode => {
      const { initial } = await mountPage();
      const invoke = async (value: SimpleChatTask): Promise<void> => {
        await act(async () => {
          if (mode === 'update') boundary.chat!.onUpdateTask(value);
          else await boundary.chat!.onPersistTask(value);
        });
      };
      await invoke({ ...initial[0].tasks[0], projectId: 'missing-project', name: 'stale' });
      expect(boundary.projects).toEqual(initial);
      await invoke({ ...initial[0].tasks[0], id: 'missing-task', name: 'stale' });
      expect(boundary.projects).toEqual(initial);
    },
  );
});
