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
  await briefToVideo.assertCanvasSkillCatalogCount(30);
  await expect(page.getByText('Brief 到视频成片', { exact: true }).last()).toBeVisible({ timeout: 30_000 });

  const textRun = await briefToVideo.createCanvasRunFromUi('text-to-video');
  await briefToVideo.assertNoVideoChildInDatabase(textRun.runId);
  await briefToVideo.cancelFromUi(textRun.runId);
  const startRun = await briefToVideo.createCanvasRunFromUi('image-to-video');
  await briefToVideo.assertNoVideoChildInDatabase(startRun.runId);
  await briefToVideo.cancelFromUi(startRun.runId);
  const bothRun = await briefToVideo.createCanvasRunFromUi('first-last-frame');
  await briefToVideo.assertNoVideoChildInDatabase(bothRun.runId);

  expect(briefToVideo.videoSubmissions()).toHaveLength(0);

  if (testInfo.project.name === 'mobile-chromium') {
    await briefToVideo.assertMobileApprovalExperience();
  }

  const revised = await briefToVideo.reviseFromUi(bothRun.runId);
  expect(revised.planChecksum).not.toBe(bothRun.planChecksum);
  await briefToVideo.assertNoVideoChildInDatabase(revised.runId);
  expect(briefToVideo.videoSubmissions()).toHaveLength(0);

  await briefToVideo.approveFromUi(revised);
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

  await briefToVideo.cancelFromUi(revised.runId);
  await expect.poll(() => briefToVideo.readRunStatus(revised.runId)).toBe('cancelled');
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(await briefToVideo.readRunStatus(revised.runId)).toBe('cancelled');
  expect(briefToVideo.videoSubmissions()).toHaveLength(1);

  const workflow = await briefToVideo.runWorkflowThroughUi();
  expect(workflow.catalogCount).toBe(30);
  expect(workflow.outputNodeType).toBe('output-video');
  expect(workflow.videoAssetVersionId).toEqual(expect.any(String));

  const simpleChat = await briefToVideo.runSimpleChatThroughUi();
  expect(simpleChat.catalogCount).toBe(16);
  expect(simpleChat.catalogContainsBriefToVideo).toBe(false);
  expect(simpleChat.videoAssetVersionId).toEqual(expect.any(String));

  await briefToVideo.writeMachineEvidence({
    textRunId: textRun.runId,
    startFrameRunId: startRun.runId,
    firstLastFrameRunId: revised.runId,
    workflowRunId: workflow.runId,
    simpleChatCancelledRunId: simpleChat.cancelledRunId,
    simpleChatRunId: simpleChat.completedRunId,
    workflowVideoAssetVersionId: workflow.videoAssetVersionId,
    simpleChatVideoAssetVersionId: simpleChat.videoAssetVersionId,
  });
});
