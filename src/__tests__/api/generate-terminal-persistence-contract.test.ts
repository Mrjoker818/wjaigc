import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/generate/route.ts'),
  'utf8',
);

describe('generate authoritative terminal persistence contract', () => {
  it('awaits every durable submitOnly terminal transition without a prior terminal registry write', () => {
    const helperStart = source.indexOf('const recordSubmitOnlyTerminal = async');
    const submitOnlyEnd = source.indexOf(
      '\n      return NextResponse.json({',
      helperStart,
    );
    const submitOnlyWorker = source.slice(helperStart, submitOnlyEnd);

    expect(helperStart).toBeGreaterThan(-1);
    expect(submitOnlyEnd).toBeGreaterThan(helperStart);
    expect(submitOnlyWorker).toContain(
      'const recordSubmitOnlyTerminal = async',
    );
    expect(submitOnlyWorker).not.toContain('void recordImageTaskTerminal');
    expect(submitOnlyWorker).not.toMatch(
      /updateTaskProgress\(asyncTaskId,\s*\{[\s\S]{0,120}?status:\s*'(completed|failed|cancelled)'/,
    );

    const terminalCalls = [
      ...submitOnlyWorker.matchAll(/recordSubmitOnlyTerminal\(\{/g),
    ];
    expect(terminalCalls.length).toBeGreaterThan(5);
    for (const call of terminalCalls) {
      const prefix = submitOnlyWorker.slice(
        Math.max(0, (call.index || 0) - 20),
        call.index,
      );
      expect(prefix).toMatch(/await\s*$/);
    }
  });

  it('keeps direct internal tasks in memory but awaits create and terminal CAS for durable tasks', () => {
    const directStart = source.indexOf('if (directImageUrls.length > 0)');
    const directEnd = source.indexOf('if (taskIds.length === 0)', directStart);
    const directBranch = source.slice(directStart, directEnd);

    expect(directBranch).toContain('if (_skipCloudTaskPersistence)');
    expect(directBranch).toMatch(
      /if \(_skipCloudTaskPersistence\)[\s\S]*?updateTaskProgress\(directTid,\s*\{[\s\S]*?status:\s*'completed'/,
    );
    expect(directBranch).toContain(
      'const taskCreated = await recordImageTaskSubmitted',
    );
    expect(directBranch).toMatch(
      /if \(taskCreated\)[\s\S]*?await recordImageTaskTerminal\(directTid,/,
    );
    expect(directBranch).toContain(
      'terminalTransitioned = terminal?.transitioned === true',
    );
    expect(directBranch).toContain(
      'if (terminalTransitioned && persistedUrl && persistedUrl !== rawUrl)',
    );
    expect(directBranch).not.toContain('void recordImageTaskTerminal');
  });
});
