import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/node-editor.tsx'),
  'utf8',
);

describe('node editor history baseline', () => {
  it('uses one pure reducer as the atomic workflow and history authority', () => {
    expect(source).toContain('useReducer(reduceWorkflowEditorState');
    expect(source).toContain('dispatchWorkflowEditorTransition');
    expect(source).not.toContain('const setWf =');
    expect(source).not.toContain('setWfRaw');
    expect(source).not.toContain('setWorkflowHistory');
    expect(source).not.toContain('P2: 保存历史快照');
    expect(source).not.toContain('手动记录一次历史快照');
  });

  it('hydrates external workflow state without adding user history', () => {
    expect(source).toContain("type: 'workflow.hydrate'");
    expect(source).toContain("transactionId: 'external-workflow-hydrate'");
    expect(source).not.toContain('if (!isDraggingRef.current) setWf(workflow)');
  });

  it('commits drag end, copy, delete, and connect through the command dispatcher', () => {
    expect(source).toContain('nodeDragStartWorkflowRef');
    expect(source).toContain("type: 'nodes.move'");
    expect(source).toContain("type: 'clipboard.paste'");
    expect(source).toContain("type: 'nodes.delete'");
    expect(source).toContain("type: 'connection.create'");
    expect(source).not.toContain("transactionId: 'legacy-node-drag-preview'");
  });

  it('keeps broadcast effects outside the reducer and records size measurement as a system command', () => {
    const updateNodeSizeBlock = source.slice(
      source.indexOf('const updateNodeSize'),
      source.indexOf('const handleGlobalImageUpload'),
    );

    expect(source).toContain('workflowEditorState.broadcastRevision');
    expect(source).toContain("type: 'node.measure'");
    expect(source).not.toMatch(/setWorkflowEditorState\([\s\S]*broadcastWorkflow/);
    expect(updateNodeSizeBlock).not.toContain('updateWorkflow(');
  });
});
