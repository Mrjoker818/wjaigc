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
    const submitCreate = source.lastIndexOf(
      'const taskCreated = await recordImageTaskSubmitted',
      helperStart,
    );
    const submitRegister = source.lastIndexOf(
      "registerTask(asyncTaskId, 'generate-async', '生成图片', userId);",
      helperStart,
    );
    expect(submitCreate).toBeGreaterThan(-1);
    expect(submitRegister).toBeGreaterThan(submitCreate);
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
      'await publishDurableDirectTask',
    );
    expect(directBranch).toMatch(
      /createTask:\s*\(\) => recordImageTaskSubmitted\(/,
    );
    expect(directBranch).toMatch(
      /prepareCompletion:\s*async\s*\(\)[\s\S]*?await persistRemoteImage\(rawUrl\)/,
    );
    expect(directBranch).toMatch(
      /completeTask:\s*\(prepared\) => recordImageTaskTerminal\([\s\S]*?imageUrl:[\s\S]*?prepared\.imageUrl/,
    );
    expect(directBranch).toMatch(
      /if \(publication\.published\)[\s\S]*?exposeDurableDirectTask\(\{[\s\S]*?taskIds,[\s\S]*?directImageUrls:\s*publishedDirectImageUrls,[\s\S]*?publishRegistry:[\s\S]*?registerTask\(/,
    );
    const durablePublication = directBranch.slice(
      directBranch.indexOf('if (publication.published)'),
    );
    expect(durablePublication).not.toContain('publishCompleted:');
    expect(durablePublication).not.toContain('getTaskResultImageUrls');
    expect(durablePublication).not.toContain(
      'publishedDirectImageUrls.push(rawUrl)',
    );
    const durableStart = directBranch.indexOf('} else {');
    expect(directBranch.indexOf('persistRemoteImage(rawUrl).then'))
      .toBeLessThan(durableStart);
    expect(directBranch.indexOf('persistRemoteImage(rawUrl).then', durableStart))
      .toBe(-1);
    expect(directBranch).not.toContain('void recordImageTaskTerminal');
  });

  it('awaits provider task durability and filters the final polling response', () => {
    const publicationStart = source.indexOf(
      'const taskPublication = await publishGenerateTaskCandidates',
    );
    const publicationBranch = source.slice(publicationStart);

    expect(publicationStart).toBeGreaterThan(-1);
    expect(publicationBranch).toMatch(
      /createDurableTask:\s*\(tid\) => recordImageTaskSubmitted\(/,
    );
    expect(publicationBranch).toMatch(
      /publishProcessing:[\s\S]*?registerTask\([\s\S]*?updateTaskProgress\(/,
    );
    expect(publicationBranch).toContain(
      'const publishedTaskIds = taskPublication.publishedTaskIds',
    );
    expect(publicationBranch).toContain('status: _skipCloudTaskPersistence ? 500 : 503');
    expect(publicationBranch).toContain('taskIds: publishedTaskIds');
    expect(publicationBranch).toContain('count: publishedTaskIds.length');
    expect(publicationBranch).not.toContain('void recordImageTaskSubmitted');
  });

  it('marks completed direct ids before registry publication and skips them in the provider loop', () => {
    const directStart = source.indexOf('if (directImageUrls.length > 0)');
    const publicationStart = source.indexOf(
      'const taskPublication = await publishGenerateTaskCandidates',
      directStart,
    );
    const branch = source.slice(directStart, publicationStart + 500);
    const authoritativeMark = branch.indexOf(
      'authoritativeDirectTaskIds.add(publication.taskId)',
    );
    const expose = branch.indexOf('exposeDurableDirectTask({');

    expect(authoritativeMark).toBeGreaterThan(-1);
    expect(expose).toBeGreaterThan(authoritativeMark);
    expect(branch).toContain('authoritativeDirectTaskIds,');
  });
});
