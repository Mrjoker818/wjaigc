import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/poll-task/route.ts'),
  'utf8',
);

describe('video poll terminal durability contract', () => {
  it('commits a completed video before publishing the in-memory completion state', () => {
    const videoStart = source.indexOf("if (registryTask.type === 'video')");
    const completion = source.indexOf('const completed = await completeCloudTask(taskId,', videoStart);
    const completionTail = source.slice(completion);
    const memoryMatch = /updateTaskProgress\(taskId,\s*\{\s*status:\s*'completed'/.exec(completionTail);
    const memoryUpdate = memoryMatch ? completion + memoryMatch.index : -1;

    expect(videoStart).toBeGreaterThan(-1);
    expect(completion).toBeGreaterThan(videoStart);
    expect(memoryUpdate).toBeGreaterThan(completion);
  });

  it('uses atomic terminal settlement for all video failure outcomes', () => {
    const videoStart = source.indexOf("if (registryTask.type === 'video')");
    const videoEnd = source.indexOf('// Local task types', videoStart);
    const videoSource = source.slice(videoStart, videoEnd);

    expect(videoSource).toContain("terminateCloudTaskAndRefund(taskId, 'failed'");
  });

  it('does not poll a local task id as though it were a provider video task after a restart', () => {
    const recoveryStart = source.indexOf('const recovery = buildRecoveredTaskContext');
    const unresolvedRemoteIdGuard = source.indexOf('const lostVideoSubmissionBeforeRemoteId', recoveryStart);
    const terminalSettlement = source.indexOf(
      "terminateCloudTaskAndRefund(recovery.taskId, 'failed', error)",
      unresolvedRemoteIdGuard,
    );

    expect(unresolvedRemoteIdGuard).toBeGreaterThan(recoveryStart);
    expect(terminalSettlement).toBeGreaterThan(unresolvedRemoteIdGuard);
  });

  it('normalizes persisted video-extend jobs to the active video poller', () => {
    const recoveryStart = source.indexOf('const recovered = registerTask(');
    const recoveryBlock = source.slice(recoveryStart, recoveryStart + 360);

    expect(recoveryBlock).toContain("recovery.type.startsWith('video')");
    expect(recoveryBlock).toContain("'video'");
  });
});
