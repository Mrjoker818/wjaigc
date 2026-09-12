import { expect, test } from '../helpers/brief-to-video';

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.use({ trace: 'off', video: 'on' });

test('Brief 到视频本地确定性门禁覆盖三工作区、审批和恢复', async ({
  page,
  briefToVideo,
}, testInfo) => {
  test.skip(
    !process.env.DATABASE_URL && !process.env.PGDATABASE_URL,
    'BLOCKED: DATABASE_URL or PGDATABASE_URL is required for the isolated Brief-to-video E2E fixture',
  );

  await briefToVideo.openCanvas();
  await expect(page.getByText('Brief 到视频成片', { exact: true }).last()).toBeVisible({ timeout: 30_000 });

  const textRun = await briefToVideo.createRun('canvas', 'text-to-video');
  const startRun = await briefToVideo.createRun('canvas', 'image-to-video');
  const bothRun = await briefToVideo.createRun('canvas', 'first-last-frame');

  for (const run of [textRun, startRun, bothRun]) {
    await expect.poll(() => briefToVideo.readRunStatus(run.runId)).toBe('paused');
  }
  expect(briefToVideo.videoSubmissions()).toHaveLength(0);

  const revised = await briefToVideo.revise(bothRun.runId);
  expect(revised.planChecksum).not.toBe(bothRun.planChecksum);
  expect(briefToVideo.videoSubmissions()).toHaveLength(0);

  await briefToVideo.approve(revised);
  await expect.poll(() => briefToVideo.videoSubmissions().length, {
    timeout: 60_000,
    intervals: [100, 250, 500, 1_000],
  }).toBe(1);
  expect(briefToVideo.videoSubmissions()[0]).toMatchObject({
    providerId: briefToVideo.videoProviderId,
    modelId: briefToVideo.videoModelId,
    mode: 'first-last-frame',
    durationSeconds: 5,
    aspectRatio: '9:16',
  });

  await briefToVideo.cancel(revised.runId);
  await expect.poll(() => briefToVideo.readRunStatus(revised.runId)).toBe('cancelled');
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(await briefToVideo.readRunStatus(revised.runId)).toBe('cancelled');
  expect(briefToVideo.videoSubmissions()).toHaveLength(1);

  const workflow = await briefToVideo.createWorkflowRun();
  expect(workflow.status).toBe('paused');
  expect(workflow.downstreamDispatched).toBe(false);
  expect(briefToVideo.videoSubmissions()).toHaveLength(1);

  const simpleChat = await briefToVideo.verifySimpleChatIntentAndCatalog();
  expect(simpleChat.catalogCount).toBe(16);
  expect(simpleChat.catalogContainsBriefToVideo).toBe(false);
  expect(simpleChat.intentRunId).toEqual(expect.any(String));

  if (testInfo.project.name === 'mobile-chromium') {
    await briefToVideo.assertMobileApprovalControls();
  }

  await briefToVideo.writeMachineEvidence({
    textRunId: textRun.runId,
    startFrameRunId: startRun.runId,
    firstLastFrameRunId: revised.runId,
    workflowRunId: workflow.runId,
    simpleChatRunId: simpleChat.intentRunId,
  });
});
