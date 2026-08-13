import type { Locator, Page, Response } from '@playwright/test';

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

function isProjectSave(
  response: Response,
  projectId: string,
  requiredNodeId?: string,
  previousPosition?: { x: number; y: number },
): boolean {
  if (!response.ok() || response.request().method() !== 'POST' || !response.url().includes('/api/user-data/sync')) {
    return false;
  }
  try {
    const body = response.request().postDataJSON() as Record<string, unknown> | null;
    if (body?.key !== 'projects' || !Array.isArray(body.value)) return false;
    const project = (body.value as Array<Record<string, unknown>>).find(candidate => candidate.id === projectId);
    if (!project) return false;
    if (!requiredNodeId) return true;
    if (!Array.isArray(project.canvasImages)) return false;
    const image = (project.canvasImages as Array<Record<string, unknown>>)
      .find(candidate => candidate.id === requiredNodeId);
    if (!image) return false;
    return !previousPosition
      || Number(image.x) !== previousPosition.x
      || Number(image.y) !== previousPosition.y;
  } catch {
    return false;
  }
}

function center(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function stableCardBox(locator: Locator) {
  let previousSignature = '';
  let stableSamples = 0;
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    if (!box) return 0;
    const signature = [box.x, box.y, box.width, box.height]
      .map(value => Math.round(value * 10) / 10)
      .join(':');
    stableSamples = signature === previousSignature ? stableSamples + 1 : 0;
    previousSignature = signature;
    return stableSamples;
  }, {
    message: 'canvas card layout should settle before pointer input',
    timeout: 5_000,
    intervals: [50, 100, 150],
  }).toBeGreaterThanOrEqual(2);
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function hittableCardCenter(page: Page, locator: Locator) {
  const box = await stableCardBox(locator);
  const point = center(box);
  const hittable = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return Boolean(target?.closest('[data-canvas-image-id]'))
      && !target?.closest('[data-toolbar], [data-floating-panel], [data-popup], [data-modal]');
  }, point);
  expect(hittable, 'canvas card center must not be covered by floating UI').toBe(true);
  return { box, point };
}

test.describe('Stage 3 Canvas kernel baseline', () => {
  test('selects one node and reverse-box selects the exact visible pair', async ({ page, stage3Evidence }, testInfo) => {
    const projectId = stage3ProjectId(testInfo.project.name, 100);
    await loginStage3User(page);
    const projects = await readStage3Projects(page);
    const project = projects.find(candidate => candidate.id === projectId);
    expect(project).toBeTruthy();
    const images = project?.canvasImages as Array<Record<string, unknown>>;
    // Use a middle-row right-edge pair so reverse selection starts in guaranteed
    // blank space outside the dense grid while remaining inside the viewport.
    const targetIds = images.slice(58, 60).map(image => String(image.id));

    await openStage3Project(page, projectId);
    await page.getByTitle('重置视图').click();
    for (const nodeId of targetIds) await waitForStage3Node(page, nodeId);

    const firstCard = stage3CanvasCard(page, targetIds[0]);
    await hittableCardCenter(page, firstCard);
    await firstCard.click();
    await expect(firstCard).toHaveAttribute('data-canvas-selected', 'true');
    const secondCard = stage3CanvasCard(page, targetIds[1]);
    await secondCard.click({ modifiers: ['Control'] });
    await expect(firstCard).toHaveAttribute('data-canvas-selected', 'true');
    await expect(secondCard).toHaveAttribute('data-canvas-selected', 'true');
    await secondCard.click({ modifiers: ['Control'] });
    await expect(firstCard).toHaveAttribute('data-canvas-selected', 'true');
    await expect(secondCard).toHaveAttribute('data-canvas-selected', 'false');

    const boxes = await Promise.all(targetIds.map(async nodeId => {
      return stableCardBox(stage3CanvasCard(page, nodeId));
    }));
    const start = {
      x: Math.max(...boxes.map(box => box.x + box.width)) + 6,
      y: Math.max(...boxes.map(box => box.y + box.height)) + 6,
    };
    const end = {
      x: Math.min(...boxes.map(box => box.x)) - 6,
      y: Math.min(...boxes.map(box => box.y)) - 6,
    };

    await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('[data-canvas-viewport]');
      const events: Array<Record<string, unknown>> = [];
      (window as typeof window & { __stage3SelectionEvents?: Array<Record<string, unknown>> })
        .__stage3SelectionEvents = events;
      for (const type of ['pointerdown', 'pointermove', 'pointerup'] as const) {
        viewport?.addEventListener(type, event => {
          const target = event.target instanceof Element ? event.target : null;
          events.push({
            type,
            x: event.clientX,
            y: event.clientY,
            pointerId: event.pointerId,
            button: event.button,
            buttons: event.buttons,
            targetImageId: target?.closest<HTMLElement>('[data-canvas-image-id]')?.dataset.canvasImageId ?? null,
            targetTag: target?.tagName ?? null,
            transform: document.querySelector<HTMLElement>('[data-canvas-surface]')?.style.transform ?? null,
          });
        }, true);
      }
    });

    const sample = await measureCanvasInteraction(page, async () => {
      await dragPointerAcrossFrames(page, start, end, 20);
    }, { monitoredNodeIds: targetIds });
    await writeStage3Metrics(stage3Evidence, testInfo, 'reverse-box-select-performance', sample);

    const committedGeometry = await page.evaluate(ids => Object.fromEntries(ids.map(id => {
      const element = document.querySelector<HTMLElement>(`[data-canvas-image-id="${CSS.escape(id)}"]`);
      const rect = element?.getBoundingClientRect();
      return [id, rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null];
    })), targetIds);
    const selectionEvents = await page.evaluate(() => (
      (window as typeof window & { __stage3SelectionEvents?: Array<Record<string, unknown>> })
        .__stage3SelectionEvents ?? []
    ));
    await writeStage3Metrics(stage3Evidence, testInfo, 'reverse-box-select-geometry', {
      start,
      end,
      before: Object.fromEntries(targetIds.map((id, index) => [id, boxes[index]])),
      committed: committedGeometry,
      selectionEvents,
    });

    const selectedIds = await page.locator('[data-canvas-selected="true"]')
      .evaluateAll(elements => elements.map(element => element.getAttribute('data-canvas-image-id')).filter(Boolean));
    expect(selectedIds.sort()).toEqual([...targetIds].sort());
    expect(sample.inputDelayP95Ms).toBeLessThanOrEqual(50);
    expect(sample.disappearedFrames).toBe(0);
    expect(sample.unclickableDurationMs).toBe(0);
  });

  test('pointer cancel rolls back image drag preview without persisting coordinates', async ({ page }, testInfo) => {
    const projectId = stage3ProjectId(testInfo.project.name, 1);
    await loginStage3User(page);
    const beforeProjects = await readStage3Projects(page);
    const project = beforeProjects.find(candidate => candidate.id === projectId);
    expect(project).toBeTruthy();
    const image = (project?.canvasImages as Array<Record<string, unknown>>)[0];
    const nodeId = String(image.id);
    const beforePosition = { x: Number(image.x), y: Number(image.y) };

    await openStage3Project(page, projectId);
    await waitForStage3Node(page, nodeId);
    const card = stage3CanvasCard(page, nodeId);
    const { box: beforeBox, point: start } = await hittableCardCenter(page, card);
    const cancelledAt = { x: start.x + 72, y: start.y + 44 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(cancelledAt.x, cancelledAt.y, { steps: 8 });
    await page.locator('[data-canvas-viewport]').dispatchEvent('pointercancel', {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: cancelledAt.x,
      clientY: cancelledAt.y,
    });
    await page.mouse.up();
    await nextAnimationFrame(page);
    await nextAnimationFrame(page);

    const afterBox = await card.boundingBox();
    expect(afterBox).not.toBeNull();
    expect(Math.abs(afterBox!.x - beforeBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterBox!.y - beforeBox.y)).toBeLessThanOrEqual(1);
    const afterProjects = await readStage3Projects(page);
    expect(projectImage(afterProjects, projectId, nodeId)).toMatchObject(beforePosition);
  });

  test('preserves image drag coordinates, zoom anchor, reset and reload state', async ({ page, stage3Evidence }, testInfo) => {
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
    const { point: dragStart } = await hittableCardCenter(page, card);
    const savedAfterDrag = page.waitForResponse(
      response => isProjectSave(response, projectId, nodeId, initialPosition),
      { timeout: 30_000 },
    );
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

    const beforeZoomBox = await stableCardBox(card);
    const zoomAnchor = center(beforeZoomBox);
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

    const beforeReloadProjects = await readStage3Projects(page);
    const beforeReload = projectImage(beforeReloadProjects, projectId, nodeId);
    expect(beforeReload).toMatchObject({ x: afterDrag?.x, y: afterDrag?.y });
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

  test('preserves delete, undo and redo history transactions', async ({ page }, testInfo) => {
    const projectId = stage3ProjectId(testInfo.project.name, 1);
    await loginStage3User(page);
    const projects = await readStage3Projects(page);
    const project = projects.find(candidate => candidate.id === projectId);
    expect(project).toBeTruthy();
    const nodeId = String((project?.canvasImages as Array<Record<string, unknown>>)[0]?.id);

    await openStage3Project(page, projectId);
    await waitForStage3Node(page, nodeId);
    await stage3CanvasCard(page, nodeId).click();
    await page.keyboard.press('Delete');
    await expect(page.getByAltText(nodeId, { exact: true })).toHaveCount(0);
    await page.keyboard.press('Control+KeyZ');
    await waitForStage3Node(page, nodeId);
    await page.keyboard.press('Control+Shift+KeyZ');
    await expect(page.getByAltText(nodeId, { exact: true })).toHaveCount(0);
    const restoredSave = page.waitForResponse(
      response => isProjectSave(response, projectId, nodeId),
      { timeout: 30_000 },
    );
    await page.keyboard.press('Control+KeyZ');
    await waitForStage3Node(page, nodeId);
    await restoredSave;
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
