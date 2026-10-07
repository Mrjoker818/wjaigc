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
    const completionMatch = /completed = await \(submission\?\.videoCanvasAdmission \? completeDocumentVideoTask : completeCloudTask\)\(\s*taskId,/u.exec(
      source.slice(videoStart),
    );
    const completion = completionMatch ? videoStart + completionMatch.index : -1;
    const completionTail = completion >= 0 ? source.slice(completion) : '';
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

  it('does not publish a gateway video when durable artifact persistence fails', () => {
    const videoStart = source.indexOf("if (registryTask.type === 'video')");
    const videoEnd = source.indexOf('// Local task types', videoStart);
    const videoSource = source.slice(videoStart, videoEnd);

    expect(videoSource).toContain('await persistGatewayVideoArtifact({');
    expect(videoSource).toContain('videoPersistenceError');
    expect(videoSource).toMatch(
      /videoPersistenceError[\s\S]*terminateCloudTaskAndRefund\([\s\S]*taskId,[\s\S]*'failed'/,
    );
  });

  it('holds a database lease while a gateway video artifact reaches its terminal state', () => {
    const videoStart = source.indexOf("if (registryTask.type === 'video')");
    const videoEnd = source.indexOf('// Local task types', videoStart);
    const videoSource = source.slice(videoStart, videoEnd);
    const leaseClaim = videoSource.indexOf('await claimCloudTaskLease(');
    const persistence = videoSource.indexOf('await persistGatewayVideoArtifact({');

    expect(leaseClaim).toBeGreaterThan(-1);
    expect(persistence).toBeGreaterThan(leaseClaim);
    expect(videoSource).toMatch(
      /terminateCloudTaskAndRefund\(\s*taskId,\s*'failed',\s*gatewayVideoError,\s*gatewayVideoArtifactLeaseOwner,?\s*\)/,
    );
    expect(videoSource).toMatch(
      /\(submission\?\.videoCanvasAdmission \? completeDocumentVideoTask : completeCloudTask\)\(\s*taskId,\s*completedResult,\s*gatewayVideoArtifactLeaseOwner,?\s*\)/,
    );
    expect(videoSource).toContain('600_000');
  });

  it('uses the persisted task as the authoritative gateway identity', () => {
    const videoStart = source.indexOf("if (registryTask.type === 'video')");
    const videoEnd = source.indexOf('// Local task types', videoStart);
    const videoSource = source.slice(videoStart, videoEnd);
    const persistedRead = videoSource.indexOf('await getCloudTaskForUser(taskId, userId)');
    const gatewayDecision = videoSource.indexOf('const gatewayVideoTask');

    expect(persistedRead).toBeGreaterThan(-1);
    expect(gatewayDecision).toBeGreaterThan(persistedRead);
    expect(videoSource).toContain('persistedVideoTask?.result');
  });

  it('downloads completed videos through the SSRF-safe bounded transport', () => {
    const videoStart = source.indexOf("if (registryTask.type === 'video')");
    const videoEnd = source.indexOf('// Local task types', videoStart);
    const videoSource = source.slice(videoStart, videoEnd);
    const persistenceStart = videoSource.indexOf('if (videoResult.videoUrl)');
    const persistenceSource = videoSource.slice(persistenceStart);

    expect(persistenceSource).toContain('await downloadSafeVideoArtifact({');
    expect(persistenceSource).not.toContain('Buffer.from(await videoResp.arrayBuffer())');
  });

  it('cleans persisted gateway video artifacts when completion loses the terminal race', () => {
    const videoStart = source.indexOf("if (registryTask.type === 'video')");
    const videoEnd = source.indexOf('// Local task types', videoStart);
    const videoSource = source.slice(videoStart, videoEnd);

    expect(videoSource).toMatch(
      /if \(!completed\)[\s\S]*cleanupPersistedGatewayVideoResult\(/u,
    );
    expect(videoSource).toMatch(
      /catch \(completionError\)[\s\S]*cleanupPersistedGatewayVideoResult\([\s\S]*throw completionError/u,
    );
  });

  it('keeps legacy non-gateway video completion compatible when local persistence fails', () => {
    const videoStart = source.indexOf("if (registryTask.type === 'video')");
    const videoEnd = source.indexOf('// Local task types', videoStart);
    const videoSource = source.slice(videoStart, videoEnd);

    expect(videoSource).toMatch(
      /if \(gatewayVideoTask\s*&&\s*\([\s\S]*videoPersistenceError/u,
    );
    expect(videoSource).toContain('persistedVideoLocalPath = persistedPath;');
    expect(videoSource.indexOf('persistedVideoLocalPath = persistedPath;')).toBeLessThan(
      videoSource.indexOf('await fs.writeFile(persistedPath, downloaded.buffer'),
    );
  });

  it('preserves a provider video thumbnail in the durable result and response', () => {
    const videoStart = source.indexOf("if (registryTask.type === 'video')");
    const videoEnd = source.indexOf('// Local task types', videoStart);
    const videoSource = source.slice(videoStart, videoEnd);

    expect(videoSource).toContain('videoThumbnailUrl: videoResult.thumbnailUrl');
  });

  it('returns the durable thumbnail from persisted and registry terminal shortcuts', () => {
    const persistedStart = source.indexOf("persistedTask.status === 'completed' && persistedTask.result?.videoUrl");
    const persistedEnd = source.indexOf("if (['failed', 'cancelled', 'timeout']", persistedStart);
    const persistedSource = source.slice(persistedStart, persistedEnd);
    const registryStart = source.indexOf("const completedVideo = registryTask.type === 'video'");
    const registryEnd = source.indexOf("if (registryTask.status === 'failed')", registryStart);
    const registrySource = source.slice(registryStart, registryEnd);

    expect(persistedSource).toContain('videoThumbnailUrl: persistedTask.result.videoThumbnailUrl');
    expect(registrySource).toContain('videoThumbnailUrl: completedVideo.videoThumbnailUrl');
  });
});
