import {
  assertNoMobileOverflow,
  expect,
  openCanvasExportDrawer,
  readExportRun,
  restoreCanvasExportRun,
  startCanvasExportFromDrawer,
  test,
  verifyCrossWorkspaceProjection,
  verifyDownloadedExportBundle,
  verifyFailureEvidence,
} from '../helpers/multi-platform-export';

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test('Canvas 完成多平台导出、校验 ZIP/manifest、批量入画布并刷新恢复', async ({
  page,
  multiPlatformExport,
}, testInfo) => {
  const drawer = await openCanvasExportDrawer(page, multiPlatformExport);
  await expect(drawer.getByText('已选择 6 张受管图片')).toBeVisible();
  await expect(drawer.getByText('积分 0')).toBeVisible();

  const started = await startCanvasExportFromDrawer(page, drawer, {
    targetLabels: ['Instagram 帖子', 'YouTube 封面'],
    fit: 'contain',
    namingTemplate: '{project}-{asset}-{platform}-{size}-{index}',
  });
  await expect(drawer.getByRole('progressbar', { name: '导出进度' })).toHaveAttribute(
    'value',
    /^(?!0(?:\.0+)?$)\d+(?:\.\d+)?$/,
    { timeout: 15_000 },
  );

  const run = await readExportRun(page, started.runId, 'completed');
  expect(run.creditCost).toBe(0);
  expect(run.result.outcome).toBe('completed');
  expect(run.result.imageAssetVersionIds).toHaveLength(12);
  await verifyDownloadedExportBundle(page, multiPlatformExport, run);
  const groupDownload = page.waitForEvent('download');
  await drawer.getByRole('button', { name: /下载 instagram 整组/i }).click();
  expect((await groupDownload).suggestedFilename()).toMatch(/instagram-export\.zip$/u);

  await drawer.getByRole('button', { name: '批量放入画布' }).click();
  const visibleCanvasImages = expect.poll(
    () => page.locator('[data-canvas-image-id]').count(),
    { message: '批量放入画布后视区内应有可见结果', timeout: 20_000 },
  );
  if (testInfo.project.name === 'mobile-chromium') {
    await visibleCanvasImages.toBeGreaterThan(0);
  } else {
    await visibleCanvasImages.toBeGreaterThan(6);
  }
  await expect.poll(
    () => multiPlatformExport.activeCanvasPlacementCount(),
    { message: '虚拟化画布之外的导出结果也必须持久化', timeout: 60_000 },
  ).toBe(18);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => multiPlatformExport.activeCanvasPlacementCount()).toBe(18);
  await restoreCanvasExportRun(page, multiPlatformExport, started.runId);
  await expect(page.getByRole('button', { name: `查看任务 ${started.runId}` })).toBeVisible();

  if (testInfo.project.name === 'mobile-chromium') {
    await assertNoMobileOverflow(page, drawer, multiPlatformExport.evidenceDirectory);
  }
});

test('损坏来源形成 partial_success，修复来源后只重试失败项', async ({
  page,
  multiPlatformExport,
}) => {
  const partial = await multiPlatformExport.startApiRun(page, {
    sourceAssetVersionIds: [multiPlatformExport.sources.landscape.id, multiPlatformExport.sources.corrupt.id],
    targetPresetIds: ['instagram-post-v1'],
  });
  const failedRun = await readExportRun(page, partial.runId, 'failed');
  expect(failedRun.result.outcome).toBe('partial_success');
  expect(failedRun.result.failures).toEqual([
    expect.objectContaining({ sourceAssetVersionId: multiPlatformExport.sources.corrupt.id }),
  ]);

  await multiPlatformExport.repairCorruptSource();
  const retry = await multiPlatformExport.retryFailedItems(page, partial.runId);
  expect(retry.runId).not.toBe(partial.runId);
  const retriedRun = await readExportRun(page, retry.runId, 'completed');
  expect(retriedRun.result.imageAssetVersionIds).toHaveLength(2);
  expect(retriedRun.result.lineage).toMatchObject({ retryOfRunId: partial.runId, attempt: 2 });
});

test('转换中取消保持 cancelled，刷新恢复不把终态改写为 completed', async ({
  page,
  multiPlatformExport,
}) => {
  const cancellationPresetIds = await multiPlatformExport.prepareCancellationLoad();
  const started = await multiPlatformExport.startApiRun(page, {
    sourceAssetVersionIds: multiPlatformExport.sourceIds,
    targetPresetIds: cancellationPresetIds,
  });
  await multiPlatformExport.cancelRun(page, started.runId);
  const cancelled = await readExportRun(page, started.runId, 'cancelled');
  const completedBeforeRefresh = cancelled.result.imageAssetVersionIds.length;

  await page.reload({ waitUntil: 'domcontentloaded' });
  const recovered = await readExportRun(page, started.runId, 'cancelled');
  expect(recovered.result.imageAssetVersionIds).toHaveLength(completedBeforeRefresh);
});

test('Workflow 与 Simple Chat 共享运行/制品契约，ZIP 首次失败后可从历史重下', async ({
  page,
  multiPlatformExport,
}) => {
  const run = await multiPlatformExport.startApiRun(page, {
    sourceAssetVersionIds: [multiPlatformExport.sources.transparent.id],
    targetPresetIds: ['instagram-post-v1'],
  });
  const completed = await readExportRun(page, run.runId, 'completed');

  await verifyCrossWorkspaceProjection(page, multiPlatformExport, completed);
  await multiPlatformExport.failNextZipDownload(page, completed.result.zipAssetVersionId);
  await restoreCanvasExportRun(page, multiPlatformExport, run.runId);
  await page.getByRole('button', { name: '下载 ZIP' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '导出制品加载失败' })).toBeVisible();
  await expect(page.getByRole('button', { name: '下载 ZIP' })).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 ZIP' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.zip$/u);
});

test.afterEach(async ({ page, multiPlatformExport }, testInfo) => {
  await verifyFailureEvidence(page, multiPlatformExport, testInfo);
});
