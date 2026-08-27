// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NodeEditor from '@/components/node-editor';
import {
  consumeSimpleChatWorkspaceHandoffForProject,
  createSimpleChatWorkspaceHandoffRunGuard,
} from '@/lib/simple-chat-workspace-handoff-client';
import {
  createSimpleChatImportWorkflow,
  stableChatImportWorkflowId,
} from '@/lib/simple-chat-workspace-handoff';
import type { Workflow } from '@/lib/workflow-engine';

class ResizeObserverMock implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.callback([{
      target,
      contentRect: target.getBoundingClientRect(),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    }], this);
  }

  unobserve(): void {}
  disconnect(): void {}
}

class BroadcastChannelMock implements BroadcastChannel {
  readonly name: string;
  onmessage: ((this: BroadcastChannel, ev: MessageEvent) => unknown) | null = null;
  onmessageerror: ((this: BroadcastChannel, ev: MessageEvent) => unknown) | null = null;

  constructor(name: string) { this.name = name; }
  close(): void {}
  postMessage(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean { return true; }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

const intent = {
  targetProjectId: 'canvas-1',
  chatProjectId: 'chat-1',
  chatTaskId: 'task-1',
  chatMessageId: 'message-1',
};

function HandoffNodeEditorHarness({
  resolveHandoff,
  onChildWorkflow,
  onPersist,
}: {
  resolveHandoff: () => Promise<{
    text: string;
    images: [];
    sourceTrace: {
      source: 'simple-chat';
      chatProjectId: string;
      chatTaskId: string;
      messageId: string;
      createdAt: string;
    };
    warnings: [];
  }>;
  onChildWorkflow: (workflow: Workflow) => void;
  onPersist: (workflow: Workflow) => void;
}) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const bootstrapWorkflow = useMemo(
    () => createSimpleChatImportWorkflow(intent.targetProjectId, 1000),
    [],
  );
  const editorWorkflow = workflow ?? bootstrapWorkflow;
  const workflowRef = useRef(editorWorkflow);
  const startedRef = useRef(false);

  useEffect(() => {
    workflowRef.current = editorWorkflow;
  }, [editorWorkflow]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void consumeSimpleChatWorkspaceHandoffForProject({
      intent,
      currentProjectId: intent.targetProjectId,
      currentWorkflow: workflowRef.current,
      getCurrentWorkflow: () => workflowRef.current,
      guard: createSimpleChatWorkspaceHandoffRunGuard(),
      resolve: resolveHandoff,
      transfer: async () => { throw new Error('unexpected transfer'); },
      persist: async next => { onPersist(next); },
      applyWorkflow: next => {
        workflowRef.current = next;
        setWorkflow(next);
      },
      cleanUrl: () => undefined,
      now: () => 1000,
    });
  }, [onPersist, resolveHandoff]);

  return (
    <NodeEditor
      workflow={editorWorkflow}
      projectId={intent.targetProjectId}
      userId="user-1"
      canvasImages={[]}
      onWorkflowChange={next => {
        if (!next) return;
        workflowRef.current = next;
        setWorkflow(next);
        onChildWorkflow(next);
      }}
    />
  );
}

describe('simple chat NodeEditor handoff lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorageMock());
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: '',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('mounts from null and retains the stable identity while resolution is delayed', async () => {
    const releaseResolver = deferred<Awaited<ReturnType<Parameters<typeof HandoffNodeEditorHarness>[0]['resolveHandoff']>>>();
    const childWorkflows: Workflow[] = [];
    const persisted: Workflow[] = [];

    render(
      <HandoffNodeEditorHarness
        resolveHandoff={() => releaseResolver.promise}
        onChildWorkflow={workflow => { childWorkflows.push(workflow); }}
        onPersist={workflow => { persisted.push(workflow); }}
      />,
    );

    await waitFor(() => expect(childWorkflows.length).toBeGreaterThan(0));
    expect(childWorkflows[0]).toMatchObject({
      id: stableChatImportWorkflowId('canvas-1'),
      name: '智能对话导入',
    });

    releaseResolver.resolve({
      text: 'delayed handoff',
      images: [],
      sourceTrace: {
        source: 'simple-chat',
        chatProjectId: 'chat-1',
        chatTaskId: 'task-1',
        messageId: 'message-1',
        createdAt: '2026-08-27T00:00:00.000Z',
      },
      warnings: [],
    });

    await waitFor(() => expect(persisted).toHaveLength(1));
    expect(persisted[0]).toMatchObject({
      id: stableChatImportWorkflowId('canvas-1'),
      name: '智能对话导入',
    });
  });
});
