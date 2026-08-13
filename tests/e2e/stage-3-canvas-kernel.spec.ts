import type { Response } from '@playwright/test';

import {
  assertCanvasNodeContinuity,
  dragPointerAcrossFrames,
  measureCanvasInteraction,
  nextAnimationFrame,
} from '../helpers/canvas-performance';
import {
  expect,
  loginStage3User,
  openStage3Project,
  readStage3Projects,
  stage3CanvasCard,
  stage3ProjectId,
  test,
  validateStage3ProjectIsolation,
  waitForStage3Node,
  writeStage3Metrics,
} from '../helpers/stage-3-e2e';

test.use({ trace: 'off', video: 'on', screenshot: 'off' });
test.describe.configure({ timeout: 120_000 });
validateStage3ProjectIsolation(process.env);

function projectImage(
  projects: Array<Record<string, unknown>>,
  projectId: string,
  nodeId: string,
): Record<string, unknown> | undefined {
  const project = projects.find(candidate => candidate.id === projectId);
  if (!project || !Array.isArray(project.canvasImages)) return undefined;
  return (project.canvasImages as Array<Record<string, unknown>>).find(image => image.id === nodeId);
}

function isProjectSave(response: Response, projectId: string, requiredNodeId?: string): boolean {
  if (!response.ok() || response.request().method() !== 'POST' || !response.url().includes('/api/user-data/sync')) {
    return false;
  }
  try {
    const body = response.request().postDataJSON() as Record<string, unknown> | null;
    if (body?.key !== 'projects' || !Array.isArray(body.value)) return false;
    const project = (body.value as Array<Record<string, unknown>>).find(candidate => candidate.id === projectId);
    if (!project) return false;
    if (!requiredNodeId) return true;
    return Array.isArray(project.canvasImages)
      && (project.canvasImages as Array<Record<string, unknown>>).some(image => image.id === requiredNodeId);
  } catch {
    return false;
  }
}

function center(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('Stage 3 Canvas kernel baseline', () => {
  test('preserves drag, zoom anchor, reset, delete, undo, redo and reload state', async ({ page, stage3Evidence }, testInfo) => {
    const projectId = stage3ProjectId(testInfo.project.name, 1);
    await loginStage3User(page);
    const initialProjects = await readStage3Projects(page);
    const initialProject = initialProjects.find(project => project.id === projectId);
    expect(initialProject).toBeTruthy();
    const initialImages = initialProject?.canvasImages as Array<Record<string, unknown>>;
    expect(initialImages).toHaveLength(1);
    const nodeId = String(initialImages[0].id);
    const initialPosition = {
      x: Number(initialImages[0].x),
      y: Number(initialImages[0].y),
      zIndex: Number(initialImages[0].zIndex),
    };

    await openStage3Project(page, projectId);
    await waitForStage3Node(page, nodeId);
    await assertCanvasNodeContinuity(page, [nodeId]);
    const card = stage3CanvasCard(page, nodeId);
    const beforeDragBox = await card.boundingBox();
    expect(beforeDragBox).not.toBeNull();
    const dragStart = center(beforeDragBox!);
    const savedAfterDrag = page.waitForResponse(response => isProjectSave(response, projectId, nodeId), { timeout: 30_000 });
    const dragSample = await measureCanvasInteraction(page, async () => {
      await dragPointerAcrossFrames(
        page,
        dragStart,
        { x: dragStart.x + 96, y: dragStart.y + 64 },
        45,
      );
      await savedAfterDrag;
    }, { monitoredNodeIds: [nodeId] });
    await writeStage3Metrics(stage3Evidence, testInfo, 'one-node-drag-performance', dragSample);
    expect(dragSample.disappearedFrames).toBe(0);
    expect(dragSample.unclickableDurationMs).toBe(0);
    expect(dragSample.longestSaveTaskMs).toBeLessThanOrEqual(100);

    const afterDragProjects = await readStage3Projects(page);
    const afterDrag = projectImage(afterDragProjects, projectId, nodeId);
    expect(afterDrag).toBeTruthy();
    expect({ x: afterDrag?.x, y: afterDrag?.y }).not.toEqual({
      x: initialPosition.x,
      y: initialPosition.y,
    });

    const beforeZoomBox = await card.boundingBox();
    expect(beforeZoomBox).not.toBeNull();
    const zoomAnchor = center(beforeZoomBox!);
    await page.mouse.move(zoomAnchor.x, zoomAnchor.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -180);
    await page.keyboard.up('Control');
    await nextAnimationFrame(page);
    await nextAnimationFrame(page);
    const afterZoomBox = await card.boundingBox();
    expect(afterZoomBox).not.toBeNull();
    const afterZoomCenter = center(afterZoomBox!);
    expect(Math.abs(afterZoomCenter.x - zoomAnchor.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(afterZoomCenter.y - zoomAnchor.y)).toBeLessThanOrEqual(3);

    await page.getByTitle('重置视图').click();
    await nextAnimationFrame(page);
    const resetBox = await card.boundingBox();
    const canvasBox = await page.locator('[data-canvas-viewport]').boundingBox();
    expect(resetBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
    expect(resetBox!.x).toBeGreaterThanOrEqual(canvasBox!.x);
    expect(resetBox!.y).toBeGreaterThanOrEqual(canvasBox!.y);
    expect(resetBox!.x + resetBox!.width).toBeLessThanOrEqual(canvasBox!.x + canvasBox!.width);
    expect(resetBox!.y + resetBox!.height).toBeLessThanOrEqual(canvasBox!.y + canvasBox!.height);

    await card.click();
    await page.keyboard.press('Delete');
    await expect(page.getByAltText(nodeId, { exact: true })).toHaveCount(0);
    await page.keyboard.press('Control+KeyZ');
    await waitForStage3Node(page, nodeId);
    await page.keyboard.press('Control+Shift+KeyZ');
    await expect(page.getByAltText(nodeId, { exact: true })).toHaveCount(0);
    const restoredSave = page.waitForResponse(response => isProjectSave(response, projectId, nodeId), { timeout: 30_000 });
    await page.keyboard.press('Control+KeyZ');
    await waitForStage3Node(page, nodeId);
    await restoredSave;

    const beforeReloadProjects = await readStage3Projects(page);
    const beforeReload = projectImage(beforeReloadProjects, projectId, nodeId);
    expect(beforeReload).toBeTruthy();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForStage3Node(page, nodeId);
    const afterReloadProjects = await readStage3Projects(page);
    const afterReload = projectImage(afterReloadProjects, projectId, nodeId);
    expect(afterReload).toMatchObject({
      x: beforeReload?.x,
      y: beforeReload?.y,
      zIndex: beforeReload?.zIndex,
    });
    await assertCanvasNodeContinuity(page, [nodeId]);
  });

  for (const nodeCount of [100, 300] as const) {
    test(`measures ${nodeCount}-node pan performance without disappearing or unclickable frames`, async ({ page, stage3Evidence }, testInfo) => {
      const projectId = stage3ProjectId(testInfo.project.name, nodeCount);
      await loginStage3User(page);
      const projects = await readStage3Projects(page);
      const project = projects.find(candidate => candidate.id === projectId);
      expect(project).toBeTruthy();
      const images = project?.canvasImages as Array<Record<string, unknown>>;
      expect(images).toHaveLength(nodeCount);
      const middle = Math.floor(nodeCount / 2);
      const monitoredNodeIds = [middle, middle + 1, middle + 20, middle + 21]
        .filter(index => index < images.length)
        .map(index => String(images[index].id));

      await openStage3Project(page, projectId);
      await page.getByTitle('重置视图').click();
      for (const nodeId of monitoredNodeIds) await waitForStage3Node(page, nodeId);
      await assertCanvasNodeContinuity(page, monitoredNodeIds);
      const canvasBox = await page.locator('[data-canvas-viewport]').boundingBox();
      expect(canvasBox).not.toBeNull();
      const start = center(canvasBox!);
      const sample = await measureCanvasInteraction(page, async () => {
        await page.keyboard.down('Space');
        try {
          await dragPointerAcrossFrames(
            page,
            start,
            { x: start.x + 120, y: start.y + 72 },
            75,
          );
        } finally {
          await page.keyboard.up('Space');
        }
      }, { monitoredNodeIds });
      await writeStage3Metrics(stage3Evidence, testInfo, `${nodeCount}-node-pan-performance`, sample);

      expect(sample.averageFps).toBeGreaterThanOrEqual(nodeCount === 100 ? 55 : 45);
      expect(sample.inputDelayP95Ms).toBeLessThanOrEqual(50);
      expect(sample.disappearedFrames).toBe(0);
      expect(sample.unclickableDurationMs).toBe(0);
      expect(sample.longestSaveTaskMs).toBeLessThanOrEqual(100);
      await assertCanvasNodeContinuity(page, monitoredNodeIds);
    });
  }
});
