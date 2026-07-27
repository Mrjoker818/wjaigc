import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/node-editor.tsx'),
  'utf8',
);

describe('node editor execution wiring', () => {
  it('routes toolbar and per-node runs through the same tracked execution starter', () => {
    expect(source).toContain('const startWorkflowExecution = useCallback(async (');
    expect(source).toContain('await startWorkflowExecution({');
    expect(source).toContain('startNodeId,');
    expect(source).toContain('tailNodeId: tailId,');
    expect(source).toContain('await startWorkflowExecution({ nodes: wf.nodes, connections: wf.connections })');
  });

  it('stores the execution id so status polling and progress rendering can start', () => {
    expect(source).toContain('setExecStatus(\'running\')');
    expect(source).toContain('setExecutionId(data.executionId)');
    expect(source).toContain('execStatus: \'running\'');
    expect(source).toContain('setExecStatus(\'failed\')');
  });

  it('does not restart polling when logs change and deduplicates settled node logs', () => {
    expect(source).not.toContain(
      '}, [execLogs, execStatus, executionId, onAddImages, wf.nodes]);',
    );
    expect(source).toContain('mergeExecutionLogs(prev, newLogs)');
  });

  it('keeps the canvas image picker wide enough to select an owned source image', () => {
    expect(source).toContain('className="relative flex-1 group/canvas"');
    expect(source).toContain(
      'className="absolute right-0 top-full mt-1 w-64 max-h-40',
    );
  });
});
