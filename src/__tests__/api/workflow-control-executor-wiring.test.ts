import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/app/api/workflow/execute/route.ts'), 'utf8');

describe('workflow control executor wiring', () => {
  it('uses the shared iteration plan and separates loop-body and completion ports', () => {
    expect(source).toContain('resolveWorkflowIterations');
    expect(source).toContain("node.type === 'loop-for' || node.type === 'loop-each' || node.type === 'loop-while'");
    expect(source).toContain("connection.fromPortId === 'out-loop'");
    expect(source).toContain('_loopItem');
    expect(source).toContain('evaluateWorkflowCondition');
    expect(source).toContain('lastLoopOutput');
    expect(source).toContain('resolveInlineSubgraph');
    expect(source).toContain('hydrateInlineSubgraphInputs');
    expect(source).toContain("depth >= 3");
    expect(source).toContain('resolveGroupOutput');
    expect(source).toContain('node.type === \'parallel\'');
    expect(source).toContain('Promise.all(parallelBranches.map');
    expect(source).toContain('parallelResults');
  });
});
