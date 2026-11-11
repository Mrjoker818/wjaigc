import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConnection, createWorkflowNode, resolveWorkflowIterations, shouldSkipNodeForInactiveBranches,
  type ExecutionResult } from '@/lib/workflow-engine';

const source = readFileSync(resolve(process.cwd(), 'src/app/api/workflow/execute/route.ts'), 'utf8');

describe('workflow control executor wiring', () => {
  it('uses the shared iteration plan and separates loop-body and completion ports', () => {
    expect(source).toContain('const loopIterations = isLoopNode ? resolveWorkflowIterations(node, inputs) : []');
    expect(source).toContain("outputData.activePorts = ['out-done']");
    expect(source).toContain("node.type === 'loop-for' || node.type === 'loop-each' || node.type === 'loop-while'");
    expect(source).toContain("connection.fromPortId === 'out-loop'");
    expect(source).toMatch(/const loopBodyConnections = explicitLoopBody.length > 0\s*\? explicitLoopBody\s*:\s*outgoing.filter\(connection => connection.fromPortId !== 'out-done'\)/);
    expect(source).toContain('readValidatedNodeInputs(dsNode, nodes, connections, resultMap, execState.userId!, bodyEdgeIds)');
    expect(source).toContain('dsInputs._loopItem = loopIteration.item');
    expect(source).toContain('attempt: loopIteration.index');
    expect(source).toContain('evaluateWorkflowCondition');
    expect(source).toContain('lastLoopOutput');
    expect(source).toContain('resolveInlineSubgraph');
    expect(source).toContain('hydrateInlineSubgraphInputs');
    expect(source).toContain("depth >= 3");
    expect(source).toContain('resolveGroupOutput');
    expect(source).toContain('node.type === \'parallel\'');
    expect(source).toContain('allParallelWork.push(work)');
    expect(source).toContain('await Promise.all(allParallelWork)');
    expect(source).toContain('[branch.nodeId]: structuredClone(result)');

    const loop = createWorkflowNode('loop-each', 0, 0);
    loop.config = { ...loop.config, itemsSource: 'manual', items: 'first\nsecond', loopCount: 2 };
    const body = createWorkflowNode('output-video', 300, 0);
    const done = createWorkflowNode('output-video', 300, 200);
    const edges = [
      createConnection(loop.id, 'out-loop', body.id, 'in-video', 'any'),
      createConnection(loop.id, 'out-done', done.id, 'in-video', 'any'),
    ];
    const results = new Map<string, ExecutionResult>([[loop.id, {
      nodeId: loop.id, status: 'success', durationMs: 0, output: { activePorts: ['out-done'] },
    }]]);
    expect(resolveWorkflowIterations(loop, {})).toEqual([
      { index: 1, total: 2, item: 'first' }, { index: 2, total: 2, item: 'second' },
    ]);
    expect(shouldSkipNodeForInactiveBranches(body, edges, results)).toBe(true);
    expect(shouldSkipNodeForInactiveBranches(done, edges, results)).toBe(false);
  });
});
