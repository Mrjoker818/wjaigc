import { describe, expect, it } from 'vitest';

import {
  createEmptyWorkflow,
  createWorkflowNode,
  isWorkflowConnectionValid,
  type Workflow,
} from '@/lib/workflow-engine';
import {
  applyWorkflowCommand,
  createWorkflowClipboardSnapshot,
  createWorkflowCommandHistory,
  createWorkflowEditorState,
  mergeExternalWorkflowWithPositions,
  recordWorkflowHistoryEntries,
  reduceWorkflowEditorState,
  redoWorkflowCommandHistory,
  undoWorkflowCommandHistory,
} from '@/lib/workflow-renderer/commands';

function workflowFixture(): Workflow {
  const workflow = createEmptyWorkflow('commands');
  const source = createWorkflowNode('input-image', 10, 20, 'source');
  const target = createWorkflowNode('ai-generate', 180, 20, 'target');
  const text = createWorkflowNode('input-text', 10, 180, 'text');
  workflow.nodes = [source, target, text];
  workflow.connections = [{
    id: 'image-edge', fromNodeId: source.id, fromPortId: 'out-image',
    toNodeId: target.id, toPortId: 'in-image', type: 'image',
  }];
  return workflow;
}

describe('workflow render commands', () => {
  it('restores the mask input on an older saved edit node during initial load and hydration', () => {
    const workflow = workflowFixture();
    const edit = createWorkflowNode('ai-edit', 320, 20);
    edit.ports = edit.ports.filter(port => port.id !== 'in-mask');
    workflow.nodes.push(edit);

    const initial = createWorkflowEditorState(workflow);
    expect(initial.workflow.nodes.at(-1)?.ports.some(port => port.id === 'in-mask')).toBe(true);
    expect(edit.ports.some(port => port.id === 'in-mask')).toBe(false);

    const hydrated = reduceWorkflowEditorState(initial, {
      kind: 'command',
      command: { type: 'workflow.hydrate', workflow, transactionId: 'legacy-reload' },
    });
    expect(hydrated.workflow.nodes.at(-1)?.ports.some(port => port.id === 'in-mask')).toBe(true);

    const external = reduceWorkflowEditorState(hydrated, { kind: 'system.update', workflow });
    expect(external.workflow.nodes.at(-1)?.ports.some(port => port.id === 'in-mask')).toBe(true);
    expect(external.history).toBe(hydrated.history);
  });

  it('moves a drag transaction once for every selected node', () => {
    const workflow = workflowFixture();
    const moved = applyWorkflowCommand(workflow, {
      type: 'nodes.move', nodeIds: workflow.nodes.slice(0, 2).map(node => node.id),
      delta: { x: 24, y: -12 }, transactionId: 'drag-1',
    });

    expect(moved.historyEntries).toHaveLength(1);
    expect(moved.historyEntries[0]?.transactionId).toBe('drag-1');
    expect(moved.workflow.nodes[0]?.x).toBe(workflow.nodes[0]!.x + 24);
    expect(moved.workflow.nodes[1]?.y).toBe(workflow.nodes[1]!.y - 12);
  });

  it('rejects an invalid port connection without a history entry', () => {
    const workflow = workflowFixture();
    const invalid = applyWorkflowCommand(workflow, {
      type: 'connection.create',
      connection: {
        id: 'invalid-edge', fromNodeId: workflow.nodes[0]!.id, fromPortId: 'out-image',
        toNodeId: workflow.nodes[1]!.id, toPortId: 'in-prompt', type: 'image',
      },
      transactionId: 'invalid-connection',
    });

    expect(invalid.workflow).toBe(workflow);
    expect(invalid.historyEntries).toEqual([]);
  });

  it('deletes nodes with their connections in one reversible history transaction', () => {
    const workflow = workflowFixture();
    const deleted = applyWorkflowCommand(workflow, {
      type: 'nodes.delete', nodeIds: [workflow.nodes[0]!.id], transactionId: 'delete-source',
    });

    expect(deleted.workflow.nodes.map(node => node.id)).not.toContain(workflow.nodes[0]!.id);
    expect(deleted.workflow.connections).toEqual([]);
    expect(deleted.historyEntries[0]?.undo).toBeDefined();
  });

  it('copies selected nodes and preserves only their internal connections', () => {
    const workflow = workflowFixture();
    const copied = applyWorkflowCommand(workflow, {
      type: 'nodes.copy', nodeIds: workflow.nodes.slice(0, 2).map(node => node.id),
      offset: { x: 40, y: 40 }, transactionId: 'copy-pair',
    });

    expect(copied.workflow.nodes).toHaveLength(5);
    expect(copied.workflow.connections).toHaveLength(2);
    expect(copied.historyEntries).toHaveLength(1);
  });

  it('hydrates the server workflow without recording user history', () => {
    const workflow = workflowFixture();
    const hydrated = applyWorkflowCommand(workflow, {
      type: 'workflow.hydrate', workflow: { ...workflow, name: 'from server' }, transactionId: 'server-load',
    });

    expect(hydrated.workflow.name).toBe('from server');
    expect(hydrated.historyEntries).toEqual([]);
  });

  it('coalesces repeated drag updates into one actual editor history transaction', () => {
    const workflow = workflowFixture();
    const first = applyWorkflowCommand(workflow, {
      type: 'nodes.move', nodeIds: [workflow.nodes[0]!.id], delta: { x: 10, y: 0 }, transactionId: 'drag-1',
    });
    const second = applyWorkflowCommand(first.workflow, {
      type: 'nodes.move', nodeIds: [workflow.nodes[0]!.id], delta: { x: 15, y: 0 }, transactionId: 'drag-1',
    });

    const history = recordWorkflowHistoryEntries(
      recordWorkflowHistoryEntries(createWorkflowCommandHistory(), first.historyEntries),
      second.historyEntries,
    );

    expect(history.entries).toHaveLength(1);
    const undone = undoWorkflowCommandHistory(history, second.workflow);
    const redone = redoWorkflowCommandHistory(undone.history, undone.workflow);
    expect(undone.workflow.nodes[0]?.x).toBe(workflow.nodes[0]!.x);
    expect(redone.workflow.nodes[0]?.x).toBe(workflow.nodes[0]!.x + 25);
  });

  it('does not change user history when external hydration is dispatched', () => {
    const workflow = workflowFixture();
    const moved = applyWorkflowCommand(workflow, {
      type: 'nodes.move', nodeIds: [workflow.nodes[0]!.id], delta: { x: 10, y: 0 }, transactionId: 'move-1',
    });
    const history = recordWorkflowHistoryEntries(createWorkflowCommandHistory(), moved.historyEntries);
    const hydrated = applyWorkflowCommand(moved.workflow, {
      type: 'workflow.hydrate', workflow: { ...moved.workflow, name: 'server' }, transactionId: 'hydrate-server',
    });

    expect(recordWorkflowHistoryEntries(history, hydrated.historyEntries)).toBe(history);
  });

  it('atomically reduces workflow and history while system measurement and hydration add no user entry', () => {
    const workflow = workflowFixture();
    const node = workflow.nodes[0]!;
    const initial = createWorkflowEditorState(workflow);
    const moved = reduceWorkflowEditorState(initial, {
      kind: 'command',
      command: {
        type: 'nodes.move', nodeIds: [node.id], delta: { x: 20, y: 0 }, transactionId: 'drag-once',
      },
    });
    const measured = reduceWorkflowEditorState(moved, {
      kind: 'command',
      command: { type: 'node.measure', nodeId: node.id, size: { width: 333, height: 222 } },
    });
    const hydrated = reduceWorkflowEditorState(measured, {
      kind: 'command',
      command: { type: 'workflow.hydrate', workflow: { ...measured.workflow, name: 'server' }, transactionId: 'server' },
    });

    expect(moved.workflow.nodes[0]!.x).toBe(node.x + 20);
    expect(moved.history.entries).toHaveLength(1);
    expect(measured.workflow.nodes[0]).toMatchObject({ width: 333, height: 222 });
    expect(measured.history).toBe(moved.history);
    expect(hydrated.history.entries).toEqual([]);
    expect(hydrated.workflow.name).toBe('server');
  });

  it('commits drag positions onto the current workflow and undo preserves concurrent updates', () => {
    const workflow = workflowFixture();
    const source = workflow.nodes[0]!;
    const initial = createWorkflowEditorState(workflow);
    const concurrentlyUpdated = reduceWorkflowEditorState(initial, {
      kind: 'user.update',
      workflow: {
        ...workflow,
        nodes: workflow.nodes.map(node => node.id === source.id
          ? { ...node, config: { ...node.config, asyncImageUrl: '/concurrent.png' } }
          : node),
      },
      transactionId: 'async-config',
    });
    const measured = reduceWorkflowEditorState(concurrentlyUpdated, {
      kind: 'command',
      command: { type: 'node.measure', nodeId: source.id, size: { width: 444, height: 333 } },
    });
    const committed = reduceWorkflowEditorState(measured, {
      kind: 'command',
      command: {
        type: 'nodes.drag.commit',
        initialPositions: [{ nodeId: source.id, position: { x: source.x, y: source.y } }],
        positions: [{ nodeId: source.id, position: { x: 90, y: 120 } }],
        transactionId: 'drag-race',
      },
    });
    const undone = reduceWorkflowEditorState(committed, { kind: 'history.undo' });

    expect(committed.workflow.nodes[0]).toMatchObject({
      x: 90, y: 120, width: 444, height: 333,
      config: expect.objectContaining({ asyncImageUrl: '/concurrent.png' }),
    });
    expect(undone.workflow.nodes[0]).toMatchObject({
      x: source.x, y: source.y, width: 444, height: 333,
      config: expect.objectContaining({ asyncImageUrl: '/concurrent.png' }),
    });
  });

  it('undoes and redoes drag fields against current state after late config image and size updates', () => {
    const workflow = workflowFixture();
    const source = workflow.nodes[0]!;
    const committed = reduceWorkflowEditorState(createWorkflowEditorState(workflow), {
      kind: 'command',
      command: {
        type: 'nodes.drag.commit',
        initialPositions: [{ nodeId: source.id, position: { x: source.x, y: source.y } }],
        positions: [{ nodeId: source.id, position: { x: 90, y: 120 } }],
        transactionId: 'drag-late-update',
      },
    });
    const lateWorkflow = {
      ...committed.workflow,
      nodes: committed.workflow.nodes.map(node => node.id === source.id
        ? {
            ...node,
            width: 555,
            height: 444,
            config: { ...node.config, imageUrl: '/late.png', lateConfig: 'survives' },
          }
        : node),
    };
    const late = reduceWorkflowEditorState(committed, { kind: 'system.update', workflow: lateWorkflow });
    const undone = reduceWorkflowEditorState(late, { kind: 'history.undo' });
    const redone = reduceWorkflowEditorState(undone, { kind: 'history.redo' });

    expect(undone.workflow.nodes[0]).toMatchObject({
      x: source.x, y: source.y, width: 555, height: 444,
      config: expect.objectContaining({ imageUrl: '/late.png', lateConfig: 'survives' }),
    });
    expect(redone.workflow.nodes[0]).toMatchObject({
      x: 90, y: 120, width: 555, height: 444,
      config: expect.objectContaining({ imageUrl: '/late.png', lateConfig: 'survives' }),
    });
  });

  it('undoes and redoes delete paste and connect without clobbering unrelated concurrent state', () => {
    const workflow = workflowFixture();
    const source = workflow.nodes[0]!;
    const text = workflow.nodes[2]!;
    const connection = {
      id: 'late-prompt-edge', fromNodeId: text.id, fromPortId: 'out-prompt',
      toNodeId: workflow.nodes[1]!.id, toPortId: 'in-prompt', type: 'prompt' as const,
    };
    const commands = [
      { type: 'nodes.delete' as const, nodeIds: [source.id], transactionId: 'delete-op' },
      {
        type: 'clipboard.paste' as const,
        snapshot: createWorkflowClipboardSnapshot(workflow, [source.id]),
        offset: { x: 20, y: 20 },
        transactionId: 'paste-op',
      },
      { type: 'nodes.copy' as const, nodeIds: [source.id], offset: { x: 20, y: 20 }, transactionId: 'copy-op' },
      { type: 'connection.create' as const, connection, transactionId: 'connect-op' },
    ];

    for (const command of commands) {
      const committed = reduceWorkflowEditorState(createWorkflowEditorState(workflow), { kind: 'command', command });
      const concurrentWorkflow = {
        ...committed.workflow,
        nodes: committed.workflow.nodes.map(node => node.id === text.id
          ? { ...node, config: { ...node.config, unrelated: command.type } }
          : node),
      };
      const concurrent = reduceWorkflowEditorState(committed, { kind: 'system.update', workflow: concurrentWorkflow });
      const undone = reduceWorkflowEditorState(concurrent, { kind: 'history.undo' });
      const redone = reduceWorkflowEditorState(undone, { kind: 'history.redo' });

      expect(undone.workflow.nodes.find(node => node.id === text.id)?.config.unrelated).toBe(command.type);
      expect(redone.workflow.nodes.find(node => node.id === text.id)?.config.unrelated).toBe(command.type);
      if (command.type === 'nodes.delete') {
        expect(undone.workflow.nodes.some(node => node.id === source.id)).toBe(true);
        expect(undone.workflow.connections.some(item => item.id === 'image-edge')).toBe(true);
        expect(redone.workflow.nodes.some(node => node.id === source.id)).toBe(false);
        expect(redone.workflow.connections.some(item => item.id === 'image-edge')).toBe(false);
      } else if (command.type === 'clipboard.paste' || command.type === 'nodes.copy') {
        expect(undone.workflow.nodes).toHaveLength(workflow.nodes.length);
        expect(redone.workflow.nodes).toHaveLength(workflow.nodes.length + 1);
      } else {
        expect(undone.workflow.connections.some(item => item.id === connection.id)).toBe(false);
        expect(redone.workflow.connections.some(item => item.id === connection.id)).toBe(true);
      }
    }
  });

  it('delete redo removes late incident edges while preserving unrelated concurrent graph state', () => {
    const workflow = workflowFixture();
    const source = workflow.nodes[0]!;
    const target = workflow.nodes[1]!;
    const text = workflow.nodes[2]!;
    const output = createWorkflowNode('output-image', 420, 20, 'late output');
    const sourcePort = source.ports.find(port => port.direction === 'out' && port.type === 'image')!;
    const outputPort = output.ports.find(port => port.direction === 'in' && port.type === 'image')!;
    const textPort = text.ports.find(port => port.direction === 'out' && port.type === 'prompt')!;
    const targetPromptPort = target.ports.find(port => port.direction === 'in' && port.type === 'prompt')!;
    const committed = reduceWorkflowEditorState(createWorkflowEditorState(workflow), {
      kind: 'command',
      command: { type: 'nodes.delete', nodeIds: [source.id], transactionId: 'delete-race' },
    });
    const undone = reduceWorkflowEditorState(committed, { kind: 'history.undo' });
    const concurrent = reduceWorkflowEditorState(undone, {
      kind: 'system.update',
      workflow: {
        ...undone.workflow,
        nodes: [...undone.workflow.nodes.map(node => node.id === target.id
          ? { ...node, config: { ...node.config, concurrent: 'survives' } }
          : node), output],
        connections: [...undone.workflow.connections, {
          id: 'late-incident-edge',
          fromNodeId: source.id,
          fromPortId: sourcePort.id,
          toNodeId: output.id,
          toPortId: outputPort.id,
          type: 'image',
        }, {
          id: 'late-unrelated-edge',
          fromNodeId: text.id,
          fromPortId: textPort.id,
          toNodeId: target.id,
          toPortId: targetPromptPort.id,
          type: 'prompt',
        }],
      },
    });

    const redone = reduceWorkflowEditorState(concurrent, { kind: 'history.redo' });

    expect(redone.history.index).toBe(1);
    expect(redone.workflow.nodes.some(node => node.id === source.id)).toBe(false);
    expect(redone.workflow.connections.some(connection => connection.id === 'late-incident-edge')).toBe(false);
    expect(redone.workflow.connections.some(connection => connection.id === 'late-unrelated-edge')).toBe(true);
    expect(redone.workflow.nodes.find(node => node.id === target.id)?.config.concurrent).toBe('survives');
    expect(redone.workflow.connections.every(connection => isWorkflowConnectionValid(redone.workflow, connection))).toBe(true);
  });

  it('connection redo fails safely when an endpoint disappeared and still advances the history cursor', () => {
    const workflow = workflowFixture();
    const target = workflow.nodes[1]!;
    const text = workflow.nodes[2]!;
    const connection = {
      id: 'prompt-redo-race',
      fromNodeId: text.id,
      fromPortId: text.ports.find(port => port.direction === 'out' && port.type === 'prompt')!.id,
      toNodeId: target.id,
      toPortId: target.ports.find(port => port.direction === 'in' && port.type === 'prompt')!.id,
      type: 'prompt' as const,
    };
    const committed = reduceWorkflowEditorState(createWorkflowEditorState(workflow), {
      kind: 'command',
      command: { type: 'connection.create', connection, transactionId: 'connect-redo-race' },
    });
    const undone = reduceWorkflowEditorState(committed, { kind: 'history.undo' });
    const concurrent = reduceWorkflowEditorState(undone, {
      kind: 'system.update',
      workflow: {
        ...undone.workflow,
        nodes: undone.workflow.nodes
          .filter(node => node.id !== text.id)
          .map(node => node.id === target.id
            ? { ...node, config: { ...node.config, concurrent: 'survives' } }
            : node),
      },
    });

    const redone = reduceWorkflowEditorState(concurrent, { kind: 'history.redo' });

    expect(redone.history.index).toBe(1);
    expect(redone.workflow.connections.some(item => item.id === connection.id)).toBe(false);
    expect(redone.workflow.connections.some(item => item.id === 'image-edge')).toBe(true);
    expect(redone.workflow.nodes.find(node => node.id === target.id)?.config.concurrent).toBe('survives');
    expect(redone.workflow.connections.every(item => isWorkflowConnectionValid(redone.workflow, item))).toBe(true);
  });

  it('clipboard undo removes late edges incident to pasted nodes without touching unrelated edges', () => {
    const workflow = workflowFixture();
    const pasted = reduceWorkflowEditorState(createWorkflowEditorState(workflow), {
      kind: 'command',
      command: {
        type: 'clipboard.paste',
        snapshot: createWorkflowClipboardSnapshot(workflow, workflow.nodes.slice(0, 2).map(node => node.id)),
        offset: { x: 40, y: 40 },
        transactionId: 'clipboard-undo-race',
      },
    });
    const copiedSource = pasted.workflow.nodes.at(-2)!;
    const copiedSourcePort = copiedSource.ports.find(port => port.direction === 'out' && port.type === 'image')!;
    const target = workflow.nodes[1]!;
    const targetPort = target.ports.find(port => port.direction === 'in' && port.type === 'image')!;
    const concurrent = reduceWorkflowEditorState(pasted, {
      kind: 'system.update',
      workflow: {
        ...pasted.workflow,
        connections: [...pasted.workflow.connections, {
          id: 'late-pasted-incident-edge',
          fromNodeId: copiedSource.id,
          fromPortId: copiedSourcePort.id,
          toNodeId: target.id,
          toPortId: targetPort.id,
          type: 'image',
        }],
      },
    });

    const undone = reduceWorkflowEditorState(concurrent, { kind: 'history.undo' });

    expect(undone.workflow.connections.some(item => item.id === 'late-pasted-incident-edge')).toBe(false);
    expect(undone.workflow.connections.some(item => item.id === 'image-edge')).toBe(true);
    expect(undone.workflow.connections.every(item => isWorkflowConnectionValid(undone.workflow, item))).toBe(true);
  });

  it('delete redo preserves a same-id edge that was concurrently retargeted away from the deleted node', () => {
    const workflow = workflowFixture();
    const source = workflow.nodes[0]!;
    const target = workflow.nodes[1]!;
    const text = workflow.nodes[2]!;
    const retargeted = {
      id: 'image-edge',
      fromNodeId: text.id,
      fromPortId: text.ports.find(port => port.direction === 'out' && port.type === 'prompt')!.id,
      toNodeId: target.id,
      toPortId: target.ports.find(port => port.direction === 'in' && port.type === 'prompt')!.id,
      type: 'prompt' as const,
      data: { revision: 'concurrent-retarget' },
    };
    const deleted = reduceWorkflowEditorState(createWorkflowEditorState(workflow), {
      kind: 'command',
      command: { type: 'nodes.delete', nodeIds: [source.id], transactionId: 'identity-delete' },
    });
    const restored = reduceWorkflowEditorState(deleted, { kind: 'history.undo' });
    const retargetedState = reduceWorkflowEditorState(restored, {
      kind: 'system.update',
      workflow: { ...restored.workflow, connections: [retargeted] },
    });

    const redone = reduceWorkflowEditorState(retargetedState, { kind: 'history.redo' });

    expect(redone.workflow.nodes.some(node => node.id === source.id)).toBe(false);
    expect(redone.workflow.connections).toContainEqual(retargeted);
    expect(redone.workflow.connections.every(connection => isWorkflowConnectionValid(redone.workflow, connection))).toBe(true);
  });

  it('clipboard undo preserves a same-id edge retargeted away from the pasted nodes', () => {
    const workflow = workflowFixture();
    const target = workflow.nodes[1]!;
    const text = workflow.nodes[2]!;
    const pasted = reduceWorkflowEditorState(createWorkflowEditorState(workflow), {
      kind: 'command',
      command: {
        type: 'clipboard.paste',
        snapshot: createWorkflowClipboardSnapshot(workflow, workflow.nodes.slice(0, 2).map(node => node.id)),
        offset: { x: 40, y: 40 },
        transactionId: 'identity-clipboard',
      },
    });
    const pastedEdge = pasted.workflow.connections.find(connection => connection.id !== 'image-edge')!;
    const retargeted = {
      id: pastedEdge.id,
      fromNodeId: text.id,
      fromPortId: text.ports.find(port => port.direction === 'out' && port.type === 'prompt')!.id,
      toNodeId: target.id,
      toPortId: target.ports.find(port => port.direction === 'in' && port.type === 'prompt')!.id,
      type: 'prompt' as const,
      data: { revision: 'clipboard-replacement' },
    };
    const retargetedState = reduceWorkflowEditorState(pasted, {
      kind: 'system.update',
      workflow: {
        ...pasted.workflow,
        connections: pasted.workflow.connections.map(connection => (
          connection.id === pastedEdge.id ? retargeted : connection
        )),
      },
    });

    const undone = reduceWorkflowEditorState(retargetedState, { kind: 'history.undo' });

    expect(undone.workflow.nodes).toHaveLength(workflow.nodes.length);
    expect(undone.workflow.connections).toContainEqual(retargeted);
    expect(undone.workflow.connections.every(connection => isWorkflowConnectionValid(undone.workflow, connection))).toBe(true);
  });

  it('undo after a no-op connection redo preserves a concurrent same-id replacement', () => {
    const workflow = workflowFixture();
    const target = workflow.nodes[1]!;
    const text = workflow.nodes[2]!;
    const connection = {
      id: 'identity-connect',
      fromNodeId: text.id,
      fromPortId: text.ports.find(port => port.direction === 'out' && port.type === 'prompt')!.id,
      toNodeId: target.id,
      toPortId: target.ports.find(port => port.direction === 'in' && port.type === 'prompt')!.id,
      type: 'prompt' as const,
    };
    const connected = reduceWorkflowEditorState(createWorkflowEditorState(workflow), {
      kind: 'command',
      command: { type: 'connection.create', connection, transactionId: 'identity-connect' },
    });
    const undone = reduceWorkflowEditorState(connected, { kind: 'history.undo' });
    const sourceRemoved = reduceWorkflowEditorState(undone, {
      kind: 'system.update',
      workflow: {
        ...undone.workflow,
        nodes: undone.workflow.nodes.filter(node => node.id !== text.id),
      },
    });
    const noOpRedo = reduceWorkflowEditorState(sourceRemoved, { kind: 'history.redo' });
    const output = createWorkflowNode('output-image', 420, 20, 'replacement target');
    const source = workflow.nodes[0]!;
    const replacement = {
      id: connection.id,
      fromNodeId: source.id,
      fromPortId: source.ports.find(port => port.direction === 'out' && port.type === 'image')!.id,
      toNodeId: output.id,
      toPortId: output.ports.find(port => port.direction === 'in' && port.type === 'image')!.id,
      type: 'image' as const,
      data: { revision: 'post-noop-replacement' },
    };
    const replacementState = reduceWorkflowEditorState(noOpRedo, {
      kind: 'system.update',
      workflow: {
        ...noOpRedo.workflow,
        nodes: [...noOpRedo.workflow.nodes, output],
        connections: [...noOpRedo.workflow.connections, replacement],
      },
    });

    const afterUndo = reduceWorkflowEditorState(replacementState, { kind: 'history.undo' });

    expect(noOpRedo.history.index).toBe(1);
    expect(noOpRedo.workflow.connections.some(item => item.id === connection.id)).toBe(false);
    expect(afterUndo.history.index).toBe(0);
    expect(afterUndo.workflow.connections).toContainEqual(replacement);
    expect(afterUndo.workflow.connections.every(item => isWorkflowConnectionValid(afterUndo.workflow, item))).toBe(true);
  });

  it('merges a deferred external workflow with final drag positions', () => {
    const workflow = workflowFixture();
    const source = workflow.nodes[0]!;
    const external = {
      ...workflow,
      nodes: workflow.nodes.map(node => node.id === source.id
        ? { ...node, config: { ...node.config, externalImage: '/external.png' } }
        : node),
    };

    const merged = mergeExternalWorkflowWithPositions(external, [
      { nodeId: source.id, position: { x: 88, y: 99 } },
    ]);

    expect(merged.nodes[0]).toMatchObject({
      x: 88, y: 99,
      config: expect.objectContaining({ externalImage: '/external.png' }),
    });
  });

  it('replays the same deterministic workflow action to the same reducer result', () => {
    const workflow = workflowFixture();
    const connection = {
      id: 'precomputed-connection',
      fromNodeId: workflow.nodes[2]!.id,
      fromPortId: 'out-prompt',
      toNodeId: workflow.nodes[1]!.id,
      toPortId: 'in-prompt',
      type: 'prompt' as const,
    };
    const nextWorkflow = { ...workflow, connections: [...workflow.connections, connection] };
    const action = {
      kind: 'user.update' as const,
      workflow: nextWorkflow,
      transactionId: 'deterministic-update',
    };

    expect(reduceWorkflowEditorState(createWorkflowEditorState(workflow), action))
      .toEqual(reduceWorkflowEditorState(createWorkflowEditorState(workflow), action));
  });

  it('pastes the copy-time node and internal-edge snapshot after the sources are deleted', () => {
    const workflow = workflowFixture();
    const selectedIds = workflow.nodes.slice(0, 2).map(node => node.id);
    const snapshot = createWorkflowClipboardSnapshot(workflow, selectedIds);
    const deleted = applyWorkflowCommand(workflow, {
      type: 'nodes.delete', nodeIds: selectedIds, transactionId: 'delete-originals',
    }).workflow;
    const pasted = applyWorkflowCommand(deleted, {
      type: 'clipboard.paste', snapshot, offset: { x: 40, y: 40 }, transactionId: 'paste-deleted',
    });

    expect(pasted.workflow.nodes).toHaveLength(3);
    expect(pasted.workflow.nodes.slice(-2).map(node => node.label)).toEqual(['source (副本)', 'target (副本)']);
    expect(pasted.workflow.connections).toHaveLength(1);
    expect(pasted.historyEntries).toHaveLength(1);
  });

  it('pastes immutable copy-time values after the source workflow mutates', () => {
    const workflow = workflowFixture();
    workflow.nodes[0]!.config = { nested: { value: 'copied' } };
    const snapshot = createWorkflowClipboardSnapshot(workflow, workflow.nodes.slice(0, 2).map(node => node.id));
    workflow.nodes[0]!.label = 'mutated source';
    (workflow.nodes[0]!.config.nested as { value: string }).value = 'mutated';
    const pasted = applyWorkflowCommand(workflow, {
      type: 'clipboard.paste', snapshot, offset: { x: 40, y: 40 }, transactionId: 'paste-snapshot',
    });
    const copiedSource = pasted.workflow.nodes.at(-2)!;

    expect(copiedSource.label).toBe('source (副本)');
    expect(copiedSource.config).toEqual({ nested: { value: 'copied' } });
  });

  it('returns actual suffixed pasted node IDs when the preferred ID already exists', () => {
    const workflow = workflowFixture();
    const source = workflow.nodes[0]!;
    const snapshot = createWorkflowClipboardSnapshot(workflow, [source.id]);
    const preferredId = `copy-${source.id}-paste-conflict-1`;
    workflow.nodes.push({ ...structuredClone(source), id: preferredId });

    const pasted = applyWorkflowCommand(workflow, {
      type: 'clipboard.paste', snapshot, offset: { x: 40, y: 40 }, transactionId: 'paste-conflict',
    });

    expect(pasted.createdNodeIds).toEqual([`${preferredId}-2`]);
    expect(pasted.workflow.nodes.some(node => node.id === pasted.createdNodeIds[0])).toBe(true);
  });
});
