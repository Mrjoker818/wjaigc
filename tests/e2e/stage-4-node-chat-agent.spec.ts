import {
  ensureStage4Session,
  expect,
  openStage4CanvasProject,
  openStage4ChatProject,
  readStage4PersistedWorkflowNodeCount,
  seedStage4Baseline,
  stage4FixtureForProject,
  test,
  writeStage4Metrics,
} from '../helpers/stage-4-e2e';
import { measureWorkflowInteraction } from '../helpers/workflow-performance';

test.describe.configure({ mode: 'serial', timeout: 120_000 });
// The stage4Evidence fixture owns tracing and stores the retained archive.
test.use({ trace: 'off', video: 'on' });

test('establishes the local legacy node, chat, and agent baseline', async ({ page, stage4Evidence }, testInfo) => {
  const fixture = await stage4FixtureForProject(testInfo.project.name);

  const auth = await ensureStage4Session(page, fixture);
  await writeStage4Metrics(stage4Evidence, testInfo, 'auth-context', {
    userId: auth.userId,
    username: auth.username,
    strategy: auth.strategy,
    browserProfile: fixture.browserProfile,
  });

  const seeded = await seedStage4Baseline(page, fixture, auth);
  await writeStage4Metrics(stage4Evidence, testInfo, 'seeded-baseline', {
    browserProfile: fixture.browserProfile,
    canvasProjectId: String(fixture.canvasProject.id),
    chatProjectId: String(fixture.chatProject.id),
    nodeCount: fixture.nodeCount,
    canvasKernelMode: seeded.canvasKernelMode,
    projectRevision: seeded.projectRevision,
  });

  await openStage4CanvasProject(page, String(fixture.canvasProject.id));
  const nodeModeButton = page.getByTitle('节点模式').first();
  await expect(nodeModeButton).toBeVisible({ timeout: 20_000 });
  await nodeModeButton.click();

  const backToCanvas = page.getByRole('button', { name: '返回画布', exact: true });
  await expect(backToCanvas).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => readStage4PersistedWorkflowNodeCount(
    page,
    String(fixture.canvasProject.id),
  ), { timeout: 20_000 }).toBe(fixture.nodeCount);
  await expect.poll(() => page.locator('[data-node-id]').count(), { timeout: 20_000 })
    .toBeGreaterThan(0);

  const workflowSample = await measureWorkflowInteraction(page, fixture.expectedNodeIds, async current => {
    const firstNode = current.locator('[data-node-id="stage4-node-1"]');
    await expect(firstNode).toBeVisible({ timeout: 10_000 });
    const from = await firstNode.boundingBox();
    if (!from) throw new Error('BLOCKED: failed to resolve workflow node geometry for Stage 4 performance sampling');
    const dragHandle = firstNode.locator('.node-header');
    const handleBox = await dragHandle.boundingBox();
    if (!handleBox) throw new Error('BLOCKED: failed to resolve workflow node drag handle for Stage 4 performance sampling');
    await current.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await current.mouse.down();
    await current.mouse.move(
      handleBox.x + handleBox.width / 2 + 48,
      handleBox.y + handleBox.height / 2 + 24,
    );
    await current.mouse.up();
    await expect.poll(async () => (await firstNode.boundingBox())?.x ?? from.x)
      .toBeGreaterThan(from.x + 20);
    await current.waitForTimeout(10_000);
  });

  await writeStage4Metrics(stage4Evidence, testInfo, 'workflow-performance', workflowSample);
  expect(workflowSample.monitoredNodeCount).toBe(fixture.nodeCount);
  expect(workflowSample.averageFps).toBeGreaterThanOrEqual(55);
  expect(workflowSample.inputDelayP95Ms).toBeLessThanOrEqual(50);
  expect(workflowSample.lostNodeCount).toBe(0);
  expect(workflowSample.unclickableDurationMs).toBe(0);

  await backToCanvas.click();
  const canvasImage = page.locator(`[data-canvas-image-id="stage4-image-${fixture.browserProfile}"]`);
  await expect(canvasImage).toBeVisible({ timeout: 20_000 });
  await canvasImage.click({ force: true });

  const imageToolbar = page.locator('[data-toolbar="image-action-toolbar"]');
  await expect(imageToolbar).toBeVisible({ timeout: 10_000 });
  const toolbarOverflowButton = imageToolbar.getByTitle('展开更多工具');
  await expect(toolbarOverflowButton).toBeVisible({ timeout: 10_000 });
  await toolbarOverflowButton.click();
  const imageAgentButton = page.locator('[data-image-toolbar-overflow]')
    .getByRole('button', { name: 'Agent编排', exact: true });
  await expect(imageAgentButton).toBeVisible({ timeout: 10_000 });
  await imageAgentButton.click();
  await expect(page.getByText('Agent 编排', { exact: true })).toBeVisible({ timeout: 20_000 });

  await openStage4ChatProject(page, String(fixture.chatProject.id));
  const targetCanvasProject = page.getByRole('combobox', { name: '目标画布项目' });
  await targetCanvasProject.selectOption(String(fixture.canvasProject.id));
  await page.getByTitle('Agent 模式').click();
  await expect(page.getByText('Agent 管理', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Stage 4 Agent', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: '使用', exact: true }).click();
  await expect(page.getByText('🤖 Stage 4 Agent', { exact: true })).toBeVisible({ timeout: 10_000 });
});
