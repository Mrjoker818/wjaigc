import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/node-editor.tsx'),
  'utf8',
);

describe('node editor history baseline', () => {
  it('uses command entries as the actual editor history without an automatic parallel snapshot effect', () => {
    expect(source).toContain('createWorkflowCommandHistory');
    expect(source).toContain('recordWorkflowHistoryEntries');
    expect(source).toContain('result.historyEntries');
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
    expect(source).toContain("type: 'nodes.copy'");
    expect(source).toContain("type: 'nodes.delete'");
    expect(source).toContain("type: 'connection.create'");
    expect(source).not.toContain("transactionId: 'legacy-node-drag-preview'");
  });
});
