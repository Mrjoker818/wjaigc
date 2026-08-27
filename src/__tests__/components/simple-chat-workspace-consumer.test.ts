// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  consumeSimpleChatWorkspaceHandoffForProject,
  createSimpleChatWorkspaceHandoffProjectQueue,
  createSimpleChatWorkspaceHandoffRunGuard,
  getSimpleChatWorkspaceHandoffIdentity,
  shouldConsumeSimpleChatWorkspaceHandoff,
} from '@/lib/simple-chat-workspace-handoff-client';
import { parseSimpleChatWorkspaceHandoffIntent } from '@/lib/simple-chat-workspace-handoff';
import {
  buildProjectWorkspaceUrl,
  replaceWorkspaceHistoryState,
  useWorkspaceLocationSearch,
} from '@/lib/project-workspace-url';
import { createEmptyWorkflow } from '@/lib/workflow-engine';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function handoffFor(messageId: string, text = messageId) {
  return {
    text,
    images: [],
    sourceTrace: {
      source: 'simple-chat' as const,
      chatProjectId: 'chat-1',
      chatTaskId: 'task-1',
      messageId,
      createdAt: '2026-08-27T00:00:00.000Z',
    },
    warnings: [],
  };
}

const intent = {
  targetProjectId: 'canvas-1',
  chatProjectId: 'chat-1',
  chatTaskId: 'task-1',
  chatMessageId: 'message-1',
};

describe('simple chat workspace consumer guard', () => {
  it('consumes each same-project handoff after custom history and popstate location changes', async () => {
    window.history.replaceState(
      null,
      '',
      '/?projectId=canvas-1&mode=node&chatProjectId=chat-1&chatTaskId=task-1&chatMessageId=message-a',
    );
    const persisted: string[] = [];

    renderHook(() => {
      const search = useWorkspaceLocationSearch();
      const workflowRef = useRef(createEmptyWorkflow('canvas-1'));
      const guardRef = useRef(createSimpleChatWorkspaceHandoffRunGuard());
      const queueRef = useRef(createSimpleChatWorkspaceHandoffProjectQueue());

      useEffect(() => {
        const handoffIntent = parseSimpleChatWorkspaceHandoffIntent(search);
        const currentProjectId = new URLSearchParams(search).get('projectId');
        void consumeSimpleChatWorkspaceHandoffForProject({
          intent: handoffIntent,
          currentProjectId,
          getCurrentWorkflow: () => workflowRef.current,
          guard: guardRef.current,
          queue: queueRef.current,
          resolve: async current => handoffFor(current.chatMessageId),
          transfer: async () => { throw new Error('unexpected transfer'); },
          persist: async workflow => {
            persisted.push((workflow.nodes.at(-1)?.config.sourceTrace as { messageId: string }).messageId);
          },
          applyWorkflow: workflow => { workflowRef.current = workflow; },
          cleanUrl: () => undefined,
          now: () => 1000,
        });
      }, [search]);
    });

    await waitFor(() => expect(persisted).toEqual(['message-a']));

    act(() => {
      replaceWorkspaceHistoryState(
        window,
        '/?projectId=canvas-1&mode=node&chatProjectId=chat-1&chatTaskId=task-1&chatMessageId=message-b',
      );
    });
    await waitFor(() => expect(persisted).toEqual(['message-a', 'message-b']));

    act(() => {
      window.history.replaceState(
        null,
        '',
        '/?projectId=canvas-1&mode=node&chatProjectId=chat-1&chatTaskId=task-1&chatMessageId=message-c',
      );
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(persisted).toEqual(['message-a', 'message-b', 'message-c']));

    act(() => {
      replaceWorkspaceHistoryState(window, buildProjectWorkspaceUrl(window.location, 'canvas-2'));
    });
    await waitFor(() => expect(persisted).toEqual(['message-a', 'message-b', 'message-c']));
    expect(window.location.search).toBe('?projectId=canvas-2&mode=node');
  });

  it('consumes only a handoff for the current project', () => {
    expect(shouldConsumeSimpleChatWorkspaceHandoff(intent, 'canvas-1')).toBe(true);
    expect(shouldConsumeSimpleChatWorkspaceHandoff(intent, 'canvas-2')).toBe(false);
    expect(shouldConsumeSimpleChatWorkspaceHandoff(null, 'canvas-1')).toBe(false);
  });

  it('suppresses only the same running identity and allows retry after failure', () => {
    const guard = createSimpleChatWorkspaceHandoffRunGuard();
    const identity = getSimpleChatWorkspaceHandoffIdentity(intent);

    expect(guard.begin(identity)).toBe(true);
    expect(guard.begin(identity)).toBe(false);
    guard.fail(identity);
    expect(guard.begin(identity)).toBe(true);
  });

  it('does not let an older failed run reset a newer identity', () => {
    const guard = createSimpleChatWorkspaceHandoffRunGuard();
    const first = getSimpleChatWorkspaceHandoffIdentity(intent);
    const second = getSimpleChatWorkspaceHandoffIdentity({ ...intent, chatMessageId: 'message-2' });

    expect(guard.begin(first)).toBe(true);
    expect(guard.begin(second)).toBe(true);
    guard.fail(first);
    expect(guard.begin(second)).toBe(false);
  });

  it('tracks each running identity when the same handoff begins after another handoff', () => {
    const guard = createSimpleChatWorkspaceHandoffRunGuard();
    const first = getSimpleChatWorkspaceHandoffIdentity(intent);
    const second = getSimpleChatWorkspaceHandoffIdentity({ ...intent, chatMessageId: 'message-2' });

    expect(guard.begin(first)).toBe(true);
    expect(guard.begin(second)).toBe(true);
    expect(guard.begin(first)).toBe(false);
  });

  it('releases only the matching identity on completion or failure', () => {
    const guard = createSimpleChatWorkspaceHandoffRunGuard();
    const first = getSimpleChatWorkspaceHandoffIdentity(intent);
    const second = getSimpleChatWorkspaceHandoffIdentity({ ...intent, chatMessageId: 'message-2' });

    expect(guard.begin(first)).toBe(true);
    expect(guard.begin(second)).toBe(true);
    guard.complete(first);
    expect(guard.begin(first)).toBe(true);
    expect(guard.begin(second)).toBe(false);
    guard.fail(first);
    expect(guard.begin(first)).toBe(true);
    expect(guard.begin(second)).toBe(false);
  });

  it('runs the existing executor only for the matching project and releases failures for retry', async () => {
    const guard = createSimpleChatWorkspaceHandoffRunGuard();
    const events: string[] = [];
    let persistAttempts = 0;
    const input = {
      intent,
      currentProjectId: 'canvas-1',
      currentWorkflow: createEmptyWorkflow('existing'),
      guard,
      resolve: async () => {
        events.push('resolve');
        return {
          text: 'hello',
          images: [],
          sourceTrace: {
            source: 'simple-chat' as const,
            chatProjectId: 'chat-1',
            chatTaskId: 'task-1',
            messageId: 'message-1',
            createdAt: '2026-08-27T00:00:00.000Z',
          },
          warnings: [],
        };
      },
      transfer: async () => { throw new Error('unexpected transfer'); },
      persist: async () => {
        persistAttempts += 1;
        events.push('persist');
        if (persistAttempts === 1) throw new Error('save failed');
      },
      cleanUrl: () => { events.push('clean'); },
      now: () => 1000,
    };

    await expect(consumeSimpleChatWorkspaceHandoffForProject({
      ...input,
      currentProjectId: 'canvas-2',
    })).resolves.toBeNull();
    expect(events).toEqual([]);

    await expect(consumeSimpleChatWorkspaceHandoffForProject(input)).rejects.toThrow('save failed');
    await expect(consumeSimpleChatWorkspaceHandoffForProject(input)).resolves.toMatchObject({ status: 'success' });
    expect(events).toEqual(['resolve', 'persist', 'resolve', 'persist', 'clean']);
  });

  it('does not update, persist, or clean project A after navigation switches to project B', async () => {
    const queue = createSimpleChatWorkspaceHandoffProjectQueue();
    const guard = createSimpleChatWorkspaceHandoffRunGuard();
    const releaseResolve = deferred<ReturnType<typeof handoffFor>>();
    const workflowA = createEmptyWorkflow('A');
    const workflowB = createEmptyWorkflow('B');
    let currentProjectId = 'canvas-1';
    let currentIdentity = getSimpleChatWorkspaceHandoffIdentity(intent);
    let displayedWorkflow = workflowB;
    const persisted: string[] = [];
    let cleanCount = 0;

    const running = consumeSimpleChatWorkspaceHandoffForProject({
      intent,
      currentProjectId: 'canvas-1',
      getCurrentProjectId: () => currentProjectId,
      getCurrentIdentity: () => currentIdentity,
      getCurrentWorkflow: () => workflowA,
      queue,
      guard,
      resolve: async () => releaseResolve.promise,
      transfer: async () => { throw new Error('unexpected transfer'); },
      persist: async workflow => { persisted.push(workflow.id); },
      applyWorkflow: workflow => { displayedWorkflow = workflow; },
      cleanUrl: () => { cleanCount += 1; },
      now: () => 1000,
    });

    currentProjectId = 'canvas-2';
    currentIdentity = 'later-navigation';
    releaseResolve.resolve(handoffFor('message-1'));

    await expect(running).rejects.toThrow('导入已取消');
    expect(displayedWorkflow).toBe(workflowB);
    expect(persisted).toEqual([]);
    expect(cleanCount).toBe(0);
  });

  it('cancels A before persistence when the shared browser URL changes to B', async () => {
    const queue = createSimpleChatWorkspaceHandoffProjectQueue();
    const guard = createSimpleChatWorkspaceHandoffRunGuard();
    const firstIntent = intent;
    const secondIntent = { ...intent, chatMessageId: 'message-2' };
    const firstResolved = deferred<ReturnType<typeof handoffFor>>();
    const firstStarted = deferred();
    let currentIdentity = getSimpleChatWorkspaceHandoffIdentity(firstIntent);
    let workflow = createEmptyWorkflow('W');
    const starts: string[] = [];
    const persisted: string[] = [];

    const run = (handoffIntent: typeof intent, barrier?: typeof firstResolved) => (
      consumeSimpleChatWorkspaceHandoffForProject({
        intent: handoffIntent,
        currentProjectId: 'canvas-1',
        getCurrentProjectId: () => 'canvas-1',
        getCurrentIdentity: () => currentIdentity,
        getCurrentWorkflow: () => workflow,
        queue,
        guard,
        resolve: async () => {
          starts.push(handoffIntent.chatMessageId);
          if (handoffIntent.chatMessageId === 'message-1') firstStarted.resolve();
          return barrier ? barrier.promise : handoffFor(handoffIntent.chatMessageId);
        },
        transfer: async () => { throw new Error('unexpected transfer'); },
        persist: async next => {
          persisted.push((next.nodes.at(-1)?.config.sourceTrace as { messageId: string }).messageId);
        },
        applyWorkflow: next => { workflow = next; },
        cleanUrl: () => undefined,
        now: () => 1000,
      })
    );

    const first = run(firstIntent, firstResolved);
    await firstStarted.promise;
    expect(starts).toEqual(['message-1']);

    currentIdentity = getSimpleChatWorkspaceHandoffIdentity(secondIntent);
    const second = run(secondIntent);
    firstResolved.resolve(handoffFor('message-1'));
    await expect(first).rejects.toThrow('导入已取消');
    await second;

    expect(starts).toEqual(['message-1', 'message-2']);
    expect(persisted).toEqual(['message-2']);
    expect(workflow.nodes.filter(node => node.config.sourceTrace).map(node => (
      node.config.sourceTrace as { messageId: string }
    ).messageId)).toEqual(['message-2']);
  });

  it('applies a successfully persisted A before queued B plans from the latest workflow', async () => {
    const queue = createSimpleChatWorkspaceHandoffProjectQueue();
    const guard = createSimpleChatWorkspaceHandoffRunGuard();
    const firstIntent = intent;
    const secondIntent = { ...intent, chatMessageId: 'message-2' };
    const firstPersistEntered = deferred();
    const releaseFirstPersist = deferred();
    let currentIdentity = getSimpleChatWorkspaceHandoffIdentity(firstIntent);
    let workflow = createEmptyWorkflow('W');
    const persisted: string[][] = [];
    const cleanedIdentities: string[] = [];

    const run = (handoffIntent: typeof intent) => consumeSimpleChatWorkspaceHandoffForProject({
      intent: handoffIntent,
      currentProjectId: 'canvas-1',
      getCurrentProjectId: () => 'canvas-1',
      getCurrentIdentity: () => currentIdentity,
      getCurrentWorkflow: () => workflow,
      queue,
      guard,
      resolve: async () => handoffFor(handoffIntent.chatMessageId),
      transfer: async () => { throw new Error('unexpected transfer'); },
      persist: async next => {
        if (handoffIntent.chatMessageId === 'message-1') {
          firstPersistEntered.resolve();
          await releaseFirstPersist.promise;
        }
        persisted.push(next.nodes.filter(node => node.config.sourceTrace).map(node => (
          node.config.sourceTrace as { messageId: string }
        ).messageId));
      },
      applyWorkflow: next => { workflow = next; },
      cleanUrl: () => { cleanedIdentities.push(currentIdentity); },
      now: () => 1000,
    });

    const first = run(firstIntent);
    await firstPersistEntered.promise;
    currentIdentity = getSimpleChatWorkspaceHandoffIdentity(secondIntent);
    const second = run(secondIntent);
    releaseFirstPersist.resolve();

    await expect(first).resolves.toMatchObject({ status: 'success' });
    await expect(second).resolves.toMatchObject({ status: 'success' });
    expect(persisted).toEqual([['message-1'], ['message-1', 'message-2']]);
    expect(workflow.nodes.filter(node => node.config.sourceTrace).map(node => (
      node.config.sourceTrace as { messageId: string }
    ).messageId)).toEqual(['message-1', 'message-2']);
    expect(cleanedIdentities).toEqual([getSimpleChatWorkspaceHandoffIdentity(secondIntent)]);
  });

  it('does not make project B wait for a blocked project A queue', async () => {
    const queue = createSimpleChatWorkspaceHandoffProjectQueue();
    const guard = createSimpleChatWorkspaceHandoffRunGuard();
    const projectAStarted = deferred();
    const releaseProjectA = deferred<ReturnType<typeof handoffFor>>();
    const projectBCompleted = deferred();
    const projectBIntent = { ...intent, targetProjectId: 'canvas-2', chatMessageId: 'message-b' };

    const projectA = consumeSimpleChatWorkspaceHandoffForProject({
      intent,
      currentProjectId: 'canvas-1',
      currentWorkflow: createEmptyWorkflow('A'),
      queue,
      guard,
      resolve: async () => {
        projectAStarted.resolve();
        return releaseProjectA.promise;
      },
      transfer: async () => { throw new Error('unexpected transfer'); },
      persist: async () => undefined,
      cleanUrl: () => undefined,
      now: () => 1000,
    });
    await projectAStarted.promise;

    const projectB = consumeSimpleChatWorkspaceHandoffForProject({
      intent: projectBIntent,
      currentProjectId: 'canvas-2',
      currentWorkflow: createEmptyWorkflow('B'),
      queue,
      guard,
      resolve: async () => handoffFor('message-b'),
      transfer: async () => { throw new Error('unexpected transfer'); },
      persist: async () => { projectBCompleted.resolve(); },
      cleanUrl: () => undefined,
      now: () => 1000,
    });

    await projectBCompleted.promise;
    await expect(projectB).resolves.toMatchObject({ status: 'success' });
    releaseProjectA.resolve(handoffFor('message-1'));
    await expect(projectA).resolves.toMatchObject({ status: 'success' });
  });

  it('continues the project queue after a failure and releases the failed identity for retry', async () => {
    const queue = createSimpleChatWorkspaceHandoffProjectQueue();
    const guard = createSimpleChatWorkspaceHandoffRunGuard();
    const firstIntent = intent;
    const secondIntent = { ...intent, chatMessageId: 'message-2' };
    let workflow = createEmptyWorkflow('W');
    const starts: string[] = [];
    const run = (handoffIntent: typeof intent, fail: boolean) => consumeSimpleChatWorkspaceHandoffForProject({
      intent: handoffIntent,
      currentProjectId: 'canvas-1',
      getCurrentProjectId: () => 'canvas-1',
      getCurrentIdentity: () => getSimpleChatWorkspaceHandoffIdentity(handoffIntent),
      getCurrentWorkflow: () => workflow,
      queue,
      guard,
      resolve: async () => {
        starts.push(handoffIntent.chatMessageId);
        if (fail) throw new Error('resolve failed');
        return handoffFor(handoffIntent.chatMessageId);
      },
      transfer: async () => { throw new Error('unexpected transfer'); },
      persist: async next => { workflow = next; },
      applyWorkflow: next => { workflow = next; },
      cleanUrl: () => undefined,
      now: () => 1000,
    });

    const first = run(firstIntent, true);
    const second = run(secondIntent, false);
    await expect(first).rejects.toThrow('resolve failed');
    await expect(second).resolves.toMatchObject({ status: 'success' });
    await expect(run(firstIntent, false)).resolves.toMatchObject({ status: 'success' });
    expect(starts).toEqual(['message-1', 'message-2', 'message-1']);
  });

  it('cleans only while the current project and URL identity still match', async () => {
    const queue = createSimpleChatWorkspaceHandoffProjectQueue();
    let currentIdentity = getSimpleChatWorkspaceHandoffIdentity(intent);
    let cleanCount = 0;
    let applyCount = 0;
    const workflow = createEmptyWorkflow('W');

    await expect(consumeSimpleChatWorkspaceHandoffForProject({
      intent,
      currentProjectId: 'canvas-1',
      getCurrentProjectId: () => 'canvas-1',
      getCurrentIdentity: () => currentIdentity,
      getCurrentWorkflow: () => workflow,
      queue,
      guard: createSimpleChatWorkspaceHandoffRunGuard(),
      resolve: async () => handoffFor('message-1'),
      transfer: async () => { throw new Error('unexpected transfer'); },
      persist: async () => { currentIdentity = 'later-navigation'; },
      applyWorkflow: () => { applyCount += 1; },
      cleanUrl: () => { cleanCount += 1; },
      now: () => 1000,
    })).resolves.toMatchObject({ status: 'success' });
    expect(applyCount).toBe(1);
    expect(cleanCount).toBe(0);
  });

  it('serializes an ordinary workflow save with handoff and preserves both updates', async () => {
    const queue = createSimpleChatWorkspaceHandoffProjectQueue();
    const ordinarySaveEntered = deferred();
    const releaseOrdinarySave = deferred();
    let workflow = createEmptyWorkflow('W');
    const persisted: string[][] = [];

    const ordinarySave = queue.enqueue('canvas-1', async () => {
      ordinarySaveEntered.resolve();
      await releaseOrdinarySave.promise;
      workflow = {
        ...workflow,
        nodes: [{
          ...workflow.nodes[0],
          id: 'ordinary-save-node',
          type: 'input-text',
          label: '普通保存节点',
          x: 20,
          y: 20,
          width: 200,
          height: 120,
          ports: [],
          config: { text: '普通保存' },
        }],
      };
      persisted.push(workflow.nodes.map(node => node.id));
    });
    await ordinarySaveEntered.promise;

    const handoff = consumeSimpleChatWorkspaceHandoffForProject({
      intent,
      currentProjectId: 'canvas-1',
      getCurrentProjectId: () => 'canvas-1',
      getCurrentWorkflow: () => workflow,
      queue,
      guard: createSimpleChatWorkspaceHandoffRunGuard(),
      resolve: async () => handoffFor('message-1'),
      transfer: async () => { throw new Error('unexpected transfer'); },
      persist: async next => { persisted.push(next.nodes.map(node => node.id)); },
      applyWorkflow: next => { workflow = next; },
      cleanUrl: () => undefined,
      now: () => 1000,
    });

    expect(persisted).toEqual([]);
    releaseOrdinarySave.resolve();
    await Promise.all([ordinarySave, handoff]);

    expect(persisted).toHaveLength(2);
    expect(persisted[1]).toContain('ordinary-save-node');
    expect(workflow.nodes.map(node => node.id)).toContain('ordinary-save-node');
    expect(workflow.nodes.some(node => (
      node.config.sourceTrace as { messageId?: string } | undefined
    )?.messageId === 'message-1')).toBe(true);
  });
});
