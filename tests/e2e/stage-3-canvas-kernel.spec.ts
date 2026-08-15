import type { Locator, Page, Request, Response } from '@playwright/test';

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

function trackModelRequestIdle(page: Page) {
  const pending = new Set<Request>();
  let lastActivityAt = Date.now();
  const isTracked = (request: Request) => (
    request.method() === 'GET'
    && /\/api\/models\?type=(image|chat)(?:&|$)/.test(request.url())
  );
  const onRequest = (request: Request) => {
    if (!isTracked(request)) return;
    pending.add(request);
    lastActivityAt = Date.now();
  };
  const onSettled = (request: Request) => {
    if (!isTracked(request)) return;
    pending.delete(request);
    lastActivityAt = Date.now();
  };
  page.on('request', onRequest);
  page.on('requestfinished', onSettled);
  page.on('requestfailed', onSettled);
  return {
    wait: async () => {
      await expect.poll(() => (
        pending.size === 0 && Date.now() - lastActivityAt >= 250
      ), {
        message: 'image and chat model requests should settle before navigation',
        timeout: 10_000,
        intervals: [50, 100, 150],
      }).toBe(true);
    },
    dispose: () => {
      page.off('request', onRequest);
      page.off('requestfinished', onSettled);
      page.off('requestfailed', onSettled);
    },
  };
}

function center(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function enforcesDesktopChromiumPerformance(projectName: string): boolean {
  return projectName === 'chromium' || projectName === 'chromium-1080p';
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

async function captureCanvasGeometry(page: Page, nodeId: string) {
  return page.evaluate(id => {
    const card = document.querySelector<HTMLElement>(`[data-canvas-image-id="${CSS.escape(id)}"]`);
    const surface = document.querySelector<HTMLElement>('[data-canvas-surface="true"]');
    const viewport = document.querySelector<HTMLElement>('[data-canvas-viewport]');
    return {
      cardLeft: card?.style.left ?? null,
      cardTop: card?.style.top ?? null,
      cardWidth: card?.style.width ?? null,
      cardHeight: card?.style.height ?? null,
      selected: card?.dataset.canvasSelected ?? null,
      surfaceTransform: surface?.style.transform ?? null,
      computedSurfaceTransform: surface ? getComputedStyle(surface).transform : null,
      surfaceRect: surface ? {
        left: surface.getBoundingClientRect().left,
        top: surface.getBoundingClientRect().top,
      } : null,
      occupiedRight: viewport?.dataset.canvasOccupiedRight ?? null,
      viewportScrollLeft: viewport?.scrollLeft ?? null,
      viewportScrollTop: viewport?.scrollTop ?? null,
      scrollAncestors: card ? Array.from({ length: 6 }, (_, index) => {
        let ancestor: HTMLElement | null = card;
        for (let depth = 0; depth <= index; depth += 1) ancestor = ancestor?.parentElement ?? null;
        return ancestor ? {
          tag: ancestor.tagName,
          className: ancestor.className,
          scrollLeft: ancestor.scrollLeft,
          scrollTop: ancestor.scrollTop,
        } : null;
      }).filter(Boolean) : [],
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      visualViewport: window.visualViewport ? {
        offsetLeft: window.visualViewport.offsetLeft,
        offsetTop: window.visualViewport.offsetTop,
        pageLeft: window.visualViewport.pageLeft,
        pageTop: window.visualViewport.pageTop,
        width: window.visualViewport.width,
      } : null,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  }, nodeId);
}

async function hittableCardCenter(page: Page, locator: Locator) {
  const box = await stableCardBox(locator);
  const expectedId = await locator.getAttribute('data-canvas-image-id');
  const point = await page.evaluate(({ box, expectedId }) => {
    const viewport = document.querySelector<HTMLElement>('[data-canvas-viewport]')?.getBoundingClientRect();
    if (!viewport) return null;
    const occupiedRight = Number(
      document.querySelector<HTMLElement>('[data-canvas-viewport]')?.dataset.canvasOccupiedRight || 0,
    );
    const left = Math.max(box.x, viewport.left) + 2;
    const right = Math.min(box.x + box.width, viewport.right - occupiedRight) - 2;
    const top = Math.max(box.y, viewport.top) + 2;
    const bottom = Math.min(box.y + box.height, viewport.bottom) - 2;
    if (left >= right || top >= bottom) return null;
    const candidates = [
      { x: (left + right) / 2, y: (top + bottom) / 2 },
      { x: left + (right - left) * 0.25, y: top + (bottom - top) * 0.5 },
      { x: left + (right - left) * 0.75, y: top + (bottom - top) * 0.5 },
      { x: left + (right - left) * 0.5, y: top + (bottom - top) * 0.25 },
      { x: left + (right - left) * 0.5, y: top + (bottom - top) * 0.75 },
    ];
    return candidates.find(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return target?.closest<HTMLElement>('[data-canvas-image-id]')?.dataset.canvasImageId === expectedId
        && !target?.closest('[data-toolbar], [data-floating-panel], [data-popup], [data-modal]');
    }) ?? null;
  }, { box, expectedId });
  expect(point, 'canvas card must expose a point that is not covered by floating UI').not.toBeNull();
  if (!point) throw new Error('Canvas card has no unobstructed interactive point');
  return { box, point };
}

async function hittableResizeHandle(page: Page, card: Locator) {
  const imageId = await card.getAttribute('data-canvas-image-id');
  const handles = card.locator('.cursor-nwse-resize, .cursor-nesw-resize');
  const count = await handles.count();
  for (let index = 0; index < count; index += 1) {
    const handle = handles.nth(index);
    const box = await handle.boundingBox();
    if (!box) continue;
    const point = center(box);
    const hittable = await page.evaluate(({ x, y, imageId }) => {
      const target = document.elementFromPoint(x, y);
      return target?.closest<HTMLElement>('[data-canvas-image-id]')?.dataset.canvasImageId === imageId
        && target instanceof HTMLElement
        && (target.className.includes('cursor-nwse-resize') || target.className.includes('cursor-nesw-resize'));
    }, { ...point, imageId });
    if (hittable) return { box, point };
  }
  throw new Error('Selected canvas card does not expose a hittable resize handle');
}

async function findHittableRightEdgePair(page: Page, imageIds: string[]): Promise<[string, string]> {
  const candidates = [0, 1, 2, 3, 4]
    .map(row => imageIds.slice(row * 20 + 18, row * 20 + 20))
    .filter((pair): pair is [string, string] => pair.length === 2);
  let selected: [string, string] | null = null;

  await expect.poll(async () => {
    selected = await page.evaluate(candidatePairs => {
      const viewport = document.querySelector<HTMLElement>('[data-canvas-viewport]')?.getBoundingClientRect();
      if (!viewport) return null;
      const isClearPoint = (x: number, y: number, expectedId?: string) => {
        if (x <= viewport.left || x >= viewport.right || y <= viewport.top || y >= viewport.bottom) return false;
        const target = document.elementFromPoint(x, y);
        const imageId = target?.closest<HTMLElement>('[data-canvas-image-id]')?.dataset.canvasImageId;
        const covered = target?.closest('[data-toolbar], [data-floating-panel], [data-popup], [data-modal]');
        return !covered && (expectedId ? imageId === expectedId : !imageId);
      };
      for (const pair of candidatePairs) {
        const rectangles = pair.map(id => (
          document.querySelector<HTMLElement>(`[data-canvas-image-id="${CSS.escape(id)}"]`)?.getBoundingClientRect()
        ));
        if (rectangles.some(rectangle => !rectangle)) continue;
        const [first, second] = rectangles as [DOMRect, DOMRect];
        const centersAreHittable = pair.every((id, index) => {
          const rectangle = rectangles[index]!;
          return isClearPoint(
            rectangle.left + rectangle.width / 2,
            rectangle.top + rectangle.height / 2,
            id,
          );
        });
        const startIsClear = isClearPoint(
          Math.max(first.right, second.right) + 2,
          Math.max(first.bottom, second.bottom) + 2,
        );
        const endIsClear = isClearPoint(
          Math.min(first.left, second.left) - 2,
          Math.min(first.top, second.top) - 2,
        );
        if (centersAreHittable && startIsClear && endIsClear) return pair;
      }
      return null;
    }, candidates);
    return selected;
  }, {
    message: 'a right-edge Canvas pair should be fully hittable and clear of floating UI',
    timeout: 10_000,
    intervals: [100, 250, 500],
  }).not.toBeNull();

  return selected!;
}

async function findCanvasBlankSpace(page: Page) {
  return page.locator('[data-canvas-viewport]').evaluate(viewport => {
    const rect = viewport.getBoundingClientRect();
    const blockedSelector = [
      '[data-canvas-image-id]',
      '[data-toolbar]',
      '[data-floating-panel]',
      '[data-popup]',
      '[data-modal]',
      '[data-workspace-right-panel]',
      '[role="dialog"]',
    ].join(',');
    for (let y = rect.top + 48; y < rect.bottom - 48; y += 40) {
      for (let x = rect.left + 48; x < rect.right - 48; x += 40) {
        const target = document.elementFromPoint(x, y);
        if (target?.closest('[data-canvas-viewport]') && !target.closest(blockedSelector)) {
          return { x, y };
        }
      }
    }
    throw new Error('No unobstructed Canvas point is available for keyboard focus');
  });
}

async function clickCanvasBlankSpace(page: Page) {
  const point = await findCanvasBlankSpace(page);
  await page.mouse.click(point.x, point.y);
}

test.describe('Stage 3 Canvas kernel baseline', () => {
  test('uses the hand tool for panning and preserves focused button Space behavior', async ({ page }, testInfo) => {
    const projectId = stage3ProjectId(testInfo.project.name, 1);
    await loginStage3User(page);
    await openStage3Project(page, projectId);

    const handTool = page.getByTestId('canvas-hand-tool');
    const selectTool = page.getByTestId('canvas-select-tool');
    await handTool.click();
    await expect(handTool).toHaveAttribute('aria-pressed', 'true');

    const before = await page.locator('[data-canvas-surface]').getAttribute('style');
    const start = await findCanvasBlankSpace(page);
    await page.evaluate(() => {
      const state = window as typeof window & { __stage3PanPointerId?: number };
      document.querySelector('[data-canvas-viewport]')?.addEventListener('pointerdown', event => {
        state.__stage3PanPointerId = (event as PointerEvent).pointerId;
      }, { once: true });
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const capturedPointer = await page.evaluate(() => {
      const state = window as typeof window & { __stage3PanPointerId?: number };
      const viewport = document.querySelector('[data-canvas-viewport]');
      return typeof state.__stage3PanPointerId === 'number'
        ? viewport?.hasPointerCapture(state.__stage3PanPointerId) ?? false
        : false;
    });
    expect(capturedPointer).toBe(true);
    await expect(page.locator('[data-canvas-surface]')).toHaveCSS('pointer-events', 'auto');
    await expect(page.locator('[data-canvas-surface]')).toHaveAttribute('data-canvas-pan-active', 'true');
    for (let index = 1; index <= 16; index += 1) {
      const progress = index / 16;
      await page.mouse.move(start.x + 64 * progress, start.y + 40 * progress);
      await nextAnimationFrame(page);
    }
    await page.mouse.up();
    const retainedCapture = await page.evaluate(() => {
      const state = window as typeof window & { __stage3PanPointerId?: number };
      const viewport = document.querySelector('[data-canvas-viewport]');
      return typeof state.__stage3PanPointerId === 'number'
        ? viewport?.hasPointerCapture(state.__stage3PanPointerId) ?? false
        : false;
    });
    expect(retainedCapture).toBe(false);
    await expect(page.locator('[data-canvas-surface]')).toHaveCSS('pointer-events', 'auto');
    await expect(page.locator('[data-canvas-surface]')).not.toHaveAttribute('data-canvas-pan-active', 'true');
    const after = await page.locator('[data-canvas-surface]').getAttribute('style');
    expect(after).not.toBe(before);

    await selectTool.focus();
    await page.keyboard.press('Space');
    await expect(selectTool).toHaveAttribute('aria-pressed', 'true');
    await expect(handTool).toHaveAttribute('aria-pressed', 'false');
  });

  test('persists a user deletion made during the server snapshot merge window', async ({ page }, testInfo) => {
    test.setTimeout(95_000);
    const projectId = stage3ProjectId(testInfo.project.name, 100);
    await loginStage3User(page);
    const initialResponse = await page.request.get('/api/user-data/sync?key=projects');
    expect(initialResponse.ok()).toBe(true);
    const initialBody = await initialResponse.json() as {
      value?: Array<Record<string, unknown>>;
      projectRevision?: number;
    };
    const originalProjects = structuredClone(initialBody.value ?? []);
    const project = originalProjects.find(candidate => candidate.id === projectId);
    expect(project).toBeTruthy();
    const originalImages = project!.canvasImages as Array<Record<string, unknown>>;
    expect(originalImages).toHaveLength(100);
    const remoteDeletedNodeId = String(originalImages[0].id);
    const nodeId = String(originalImages[50].id);
    const markerId = `stage3-remote-marker-${testInfo.project.name}-${Date.now()}`;

    await page.clock.install({ time: new Date() });
    const modelRequestIdle = trackModelRequestIdle(page);
    const quickCreateModelsLoaded = Promise.all([
      page.waitForResponse(response => (
        response.ok()
        && response.url().includes('/api/models?type=image')
      )),
      page.waitForResponse(response => (
        response.ok()
        && response.url().includes('/api/models?type=chat')
      )),
    ]);
    await openStage3Project(page, projectId);
    await quickCreateModelsLoaded;
    await modelRequestIdle.wait();
    await waitForStage3Node(page, nodeId);
    await waitForStage3Node(page, remoteDeletedNodeId);
    let remoteMutationAttempted = false;
    try {
      const remoteProjects = structuredClone(originalProjects);
      const remoteProject = remoteProjects.find(candidate => candidate.id === projectId)!;
      const sourceImage = (remoteProject.canvasImages as Array<Record<string, unknown>>)[0];
      remoteProject.canvasImages = [
        ...(remoteProject.canvasImages as Array<Record<string, unknown>>)
          .filter(image => image.id !== remoteDeletedNodeId),
        {
          ...sourceImage,
          id: markerId,
          x: Number(sourceImage.x ?? 0) + 480,
          y: Number(sourceImage.y ?? 0) + 120,
          prompt: markerId,
        },
      ];
      remoteProject.settings = {
        ...((remoteProject.settings as Record<string, unknown> | undefined) ?? {}),
        stage3MergeNonce: markerId,
      };
      remoteMutationAttempted = true;
      const remoteWrite = await page.request.post('/api/user-data/sync', {
        data: {
          key: 'projects',
          value: remoteProjects,
          ...(typeof initialBody.projectRevision === 'number'
            ? { projectRevision: initialBody.projectRevision }
            : {}),
        },
      });
      expect(remoteWrite.ok()).toBe(true);

      await expect.poll(async () => {
        const projects = await readStage3Projects(page);
        return {
          marker: projectImage(projects, projectId, markerId)?.id,
          remoteDeleted: projectImage(projects, projectId, remoteDeletedNodeId)?.id,
        };
      }, {
        message: 'the exact remote snapshot should exist on the server before the online merge',
        timeout: 10_000,
        intervals: [250, 500, 1_000],
      }).toEqual({ marker: markerId, remoteDeleted: undefined });

      const periodicSyncResponse = page.waitForResponse(async response => {
        if (response.request().method() !== 'GET') return false;
        const url = new URL(response.url());
        if (url.pathname !== '/api/user-data/sync' || url.searchParams.get('key') !== 'projects') return false;
        if (!response.ok()) return false;
        const body = await response.json().catch(() => null) as { value?: Array<Record<string, unknown>> } | null;
        return projectImage(body?.value ?? [], projectId, markerId)?.id === markerId;
      }, { timeout: 20_000 });
      await page.clock.fastForward(30_100);
      const periodicResponse = await periodicSyncResponse;
      expect(periodicResponse.ok()).toBe(true);
      const periodicBody = await periodicResponse.json() as { projectRevision?: number };
      expect(Number.isSafeInteger(periodicBody.projectRevision)).toBe(true);
      await waitForStage3Node(page, markerId, 20_000);
      await expect(page.getByAltText(remoteDeletedNodeId, { exact: true })).toHaveCount(0);
      await page.getByTitle('重置视图').click();
      await page.clock.runFor(600);
      const mergeObservedAt = Date.now();

      const saveWithoutNode = page.waitForResponse(response => {
        if (!isProjectSave(response, projectId)) return false;
        try {
          const body = response.request().postDataJSON() as { value?: Array<Record<string, unknown>> };
          const savedProject = body.value?.find(candidate => candidate.id === projectId);
          return Array.isArray(savedProject?.canvasImages)
            && !(savedProject.canvasImages as Array<Record<string, unknown>>)
              .some(image => image.id === nodeId)
            && !(savedProject.canvasImages as Array<Record<string, unknown>>)
              .some(image => image.id === remoteDeletedNodeId)
            && (savedProject.canvasImages as Array<Record<string, unknown>>)
              .some(image => image.id === markerId);
        } catch {
          return false;
        }
      }, { timeout: 15_000 });

      const card = stage3CanvasCard(page, nodeId);
      const { point } = await hittableCardCenter(page, card);
      await page.mouse.click(point.x, point.y);
      await page.keyboard.press('Delete');
      expect(Date.now() - mergeObservedAt).toBeLessThan(2_000);
      await saveWithoutNode;
      await expect.poll(async () => {
        const projects = await readStage3Projects(page);
        return {
          deleted: projectImage(projects, projectId, nodeId) === undefined,
          remoteDeleted: projectImage(projects, projectId, remoteDeletedNodeId) === undefined,
          markerRetained: projectImage(projects, projectId, markerId)?.id === markerId,
        };
      }, { timeout: 15_000 }).toEqual({
        deleted: true,
        remoteDeleted: true,
        markerRetained: true,
      });

      await modelRequestIdle.wait();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-canvas-viewport]')).toHaveAttribute('data-project-id', projectId);
      await expect(page.getByAltText(nodeId, { exact: true })).toHaveCount(0);
      await expect(page.getByAltText(remoteDeletedNodeId, { exact: true })).toHaveCount(0);
      await waitForStage3Node(page, markerId);
    } finally {
      if (remoteMutationAttempted) {
        await page.clock.runFor(3_000).catch(() => undefined);
        let restored = false;
        for (let attempt = 0; attempt < 3 && !restored; attempt += 1) {
          const latest = await page.request.get('/api/user-data/sync?key=projects');
          if (!latest.ok()) continue;
          const latestBody = await latest.json().catch(() => ({})) as { projectRevision?: number };
          const restore = await page.request.post('/api/user-data/sync', {
            data: {
              key: 'projects',
              value: originalProjects,
              ...(typeof latestBody.projectRevision === 'number'
                ? { projectRevision: latestBody.projectRevision }
                : {}),
            },
          });
          restored = restore.ok();
          if (!restored) await page.waitForTimeout(250 * (attempt + 1));
        }
        expect(restored, 'controlled project fixture should be restored after the race test').toBe(true);

        await expect.poll(async () => {
          return readStage3Projects(page);
        }, {
          message: 'the complete controlled project fixture should match its original snapshot',
          timeout: 10_000,
          intervals: [250, 500, 1_000],
        }).toEqual(originalProjects);
      }
      modelRequestIdle.dispose();
    }
  });

  test('keeps canvas tool sessions mutually exclusive across toolbar and shortcut entry points', async ({ page }, testInfo) => {
    const projectId = stage3ProjectId(testInfo.project.name, 1);
    await loginStage3User(page);
    const projects = await readStage3Projects(page);
    const project = projects.find(candidate => candidate.id === projectId);
    expect(project).toBeTruthy();
    const image = (project?.canvasImages as Array<Record<string, unknown>>)[0];
    const nodeId = String(image.id);

    await openStage3Project(page, projectId);
    const card = stage3CanvasCard(page, nodeId);
    await expect(card).toBeVisible({ timeout: 30_000 });
    const viewport = page.locator('[data-canvas-viewport]');
    await page.getByTitle('重置视图').click();
    await clickCanvasBlankSpace(page);

    await page.keyboard.press('Shift+Digit3');
    await expect(viewport).toHaveAttribute('data-canvas-active-tool', 'agent');
    await expect(page.locator('[data-popup="agent-editor"]')).toBeVisible();

    await page.keyboard.press('Shift+Digit5');
    await expect(viewport).toHaveAttribute('data-canvas-active-tool', 'brand-ecommerce');
    await expect(page.locator('[data-popup="agent-editor"]')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(viewport).toHaveAttribute('data-canvas-active-tool', '');

    await page.getByTitle('重置视图').click();
    await hittableCardCenter(page, card);
    await card.click();
    await page.getByTestId('canvas-erase').click();
    await expect(viewport).toHaveAttribute('data-canvas-active-tool', 'erase');
    await expect(page.locator('[data-floating-panel="erase"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewport).toHaveAttribute('data-canvas-active-tool', '');

    await clickCanvasBlankSpace(page);
    await page.keyboard.press('c');
    await expect(viewport).toHaveAttribute('data-canvas-active-tool', 'chatcanvas');
    await expect(page.getByTestId('annotation-composer')).toBeVisible();
    await page.getByTestId('annotation-prompt').click();
    await expect(viewport).toHaveAttribute('data-canvas-active-tool', 'chatcanvas');
    await page.keyboard.press('Escape');
    await expect(viewport).toHaveAttribute('data-canvas-active-tool', '');
  });

  test('selects one node and reverse-box selects the exact visible pair', async ({ page, stage3Evidence }, testInfo) => {
    const projectId = stage3ProjectId(testInfo.project.name, 100);
    await loginStage3User(page);
    const projects = await readStage3Projects(page);
    const project = projects.find(candidate => candidate.id === projectId);
    expect(project).toBeTruthy();
    const images = project?.canvasImages as Array<Record<string, unknown>>;
    const imageIds = images.map(image => String(image.id));

    await openStage3Project(page, projectId);
    await page.getByTitle('重置视图').click();
    const targetIds = await findHittableRightEdgePair(page, imageIds);
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
      x: Math.max(...boxes.map(box => box.x + box.width)) + 2,
      y: Math.max(...boxes.map(box => box.y + box.height)) + 2,
    };
    const end = {
      x: Math.min(...boxes.map(box => box.x)) - 2,
      y: Math.min(...boxes.map(box => box.y)) - 2,
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
    if (enforcesDesktopChromiumPerformance(testInfo.project.name)) {
      expect(sample.inputDelayP95Ms).toBeLessThanOrEqual(50);
    }
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
    await page.evaluate(() => {
      const state = window as typeof window & { __stage3PointerDownId?: number };
      delete state.__stage3PointerDownId;
      document.querySelector('[data-canvas-viewport]')?.addEventListener('pointerdown', event => {
        state.__stage3PointerDownId = (event as PointerEvent).pointerId;
      }, { capture: true, once: true });
    });
    await page.mouse.down();
    await page.mouse.move(cancelledAt.x, cancelledAt.y, { steps: 8 });
    const pointerId = await page.evaluate(() => (
      (window as typeof window & { __stage3PointerDownId?: number }).__stage3PointerDownId
    ));
    expect(pointerId).toEqual(expect.any(Number));
    await page.locator('[data-canvas-viewport]').dispatchEvent('pointercancel', {
      pointerId,
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

  test('saves image drag coordinates, zoom anchor and reset state across refresh', async ({ page, stage3Evidence }, testInfo) => {
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

    const emergencyCard = stage3CanvasCard(page, nodeId);
    const emergencyBefore = await stableCardBox(emergencyCard);
    const emergencyStart = center(emergencyBefore);
    await page.mouse.move(emergencyStart.x, emergencyStart.y);
    await page.mouse.down();
    await page.mouse.move(emergencyStart.x + 48, emergencyStart.y + 32);
    await page.mouse.up();
    const emergencyMoved = await stableCardBox(emergencyCard);
    expect(emergencyMoved.x).toBeGreaterThan(emergencyBefore.x + 30);
    expect(emergencyMoved.y).toBeGreaterThan(emergencyBefore.y + 20);

    // Do not wait for the normal autosave response: beforeunload recovery owns this boundary.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForStage3Node(page, nodeId);
    const emergencyReloaded = await stableCardBox(stage3CanvasCard(page, nodeId));
    expect(Math.abs(emergencyReloaded.x - emergencyMoved.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(emergencyReloaded.y - emergencyMoved.y)).toBeLessThanOrEqual(2);
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

  test('restores a batch delete with one undo and preserves layer order', async ({ page }, testInfo) => {
    const projectId = stage3ProjectId(testInfo.project.name, 100);
    await loginStage3User(page);
    const projects = await readStage3Projects(page);
    const project = projects.find(candidate => candidate.id === projectId);
    expect(project).toBeTruthy();
    const originalImages = project?.canvasImages as Array<Record<string, unknown>>;
    const originalOrder = originalImages.map(image => String(image.id));

    await openStage3Project(page, projectId);
    await page.getByTitle('重置视图').click();
    const targetIds = await findHittableRightEdgePair(page, originalOrder);
    for (const nodeId of targetIds) await waitForStage3Node(page, nodeId);

    await stage3CanvasCard(page, targetIds[0]).click();
    await stage3CanvasCard(page, targetIds[1]).click({ modifiers: ['Control'] });
    await page.keyboard.press('Delete');
    for (const nodeId of targetIds) {
      await expect(page.getByAltText(nodeId, { exact: true })).toHaveCount(0);
    }

    const restoredSave = page.waitForResponse(
      response => isProjectSave(response, projectId, targetIds[0]),
      { timeout: 30_000 },
    );
    await page.keyboard.press('Control+KeyZ');
    for (const nodeId of targetIds) await waitForStage3Node(page, nodeId);
    await restoredSave;

    await expect.poll(async () => {
      const currentProjects = await readStage3Projects(page);
      const currentProject = currentProjects.find(candidate => candidate.id === projectId);
      const currentImages = currentProject?.canvasImages as Array<Record<string, unknown>> | undefined;
      return currentImages?.map(image => String(image.id)) ?? [];
    }, { timeout: 30_000 }).toEqual(originalOrder);
  });

  test('commits move and resize as one undo step each', async ({ page, stage3Evidence }, testInfo) => {
    const projectId = stage3ProjectId(testInfo.project.name, 1);
    await page.addInitScript(() => {
      const state = window as typeof window & {
        __stage3HistoryInputEvents?: Array<Record<string, unknown>>;
      };
      state.__stage3HistoryInputEvents = [];
      const describeTarget = (target: EventTarget | null): Record<string, unknown> => {
        if (!(target instanceof HTMLElement)) return { tag: null };
        return {
          tag: target.tagName,
          role: target.getAttribute('role'),
          testId: target.dataset.testid ?? null,
          canvasImageId: target.closest<HTMLElement>('[data-canvas-image-id]')?.dataset.canvasImageId ?? null,
          contentEditable: target.isContentEditable,
        };
      };
      for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'keydown', 'keyup']) {
        window.addEventListener(type, (event) => {
          const pointer = event instanceof PointerEvent ? event : null;
          const keyboard = event instanceof KeyboardEvent ? event : null;
          const viewport = document.querySelector<HTMLElement>('[data-canvas-viewport]');
          state.__stage3HistoryInputEvents?.push({
            type,
            pointerId: pointer?.pointerId ?? null,
            buttons: pointer?.buttons ?? null,
            code: keyboard?.code ?? null,
            ctrlKey: keyboard?.ctrlKey ?? null,
            shiftKey: keyboard?.shiftKey ?? null,
            target: describeTarget(event.target),
            activeElement: describeTarget(document.activeElement),
            viewportHasPointerCapture: pointer ? viewport?.hasPointerCapture(pointer.pointerId) ?? false : null,
            timestamp: performance.now(),
          });
        }, true);
      }
    });
    await loginStage3User(page);
    const projects = await readStage3Projects(page);
    const project = projects.find(candidate => candidate.id === projectId);
    expect(project).toBeTruthy();
    const nodeId = String((project?.canvasImages as Array<Record<string, unknown>>)[0]?.id);

    await openStage3Project(page, projectId);
    await waitForStage3Node(page, nodeId);
    const card = stage3CanvasCard(page, nodeId);
    const { box: original, point: start } = await hittableCardCenter(page, card);
    const originalGeometry = await captureCanvasGeometry(page, nodeId);
    const viewport = await page.locator('[data-canvas-viewport]').boundingBox();
    expect(viewport).not.toBeNull();
    const dragTarget = {
      x: start.x + (start.x < viewport!.x + viewport!.width / 2 ? 56 : -56),
      y: start.y + (start.y < viewport!.y + viewport!.height / 2 ? 40 : -40),
    };
    await dragPointerAcrossFrames(page, start, dragTarget, 18);
    const moved = await stableCardBox(card);
    const movedGeometry = await captureCanvasGeometry(page, nodeId);
    const moveInputEvents = await page.evaluate(() => (
      (window as typeof window & {
        __stage3HistoryInputEvents?: Array<Record<string, unknown>>;
      }).__stage3HistoryInputEvents ?? []
    ));
    const moveStartTarget = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return {
        tag: target?.tagName ?? null,
        className: target instanceof HTMLElement ? target.className : null,
        imageId: target?.closest<HTMLElement>('[data-canvas-image-id]')?.dataset.canvasImageId ?? null,
        toolbar: target?.closest<HTMLElement>('[data-toolbar]')?.dataset.toolbar ?? null,
      };
    }, start);
    await writeStage3Metrics(stage3Evidence, testInfo, 'move-input-diagnostics', {
      original,
      originalGeometry,
      moved,
      movedGeometry,
      start,
      dragTarget,
      moveStartTarget,
      events: moveInputEvents,
    });
    expect(Math.abs(moved.x - original.x)).toBeGreaterThan(20);
    expect(Math.abs(moved.y - original.y)).toBeGreaterThan(20);

    await page.evaluate(() => {
      const probe = document.createElement('textarea');
      probe.dataset.testid = 'stage3-native-undo-probe';
      probe.style.position = 'fixed';
      probe.style.left = '0';
      probe.style.top = '0';
      probe.style.width = '1px';
      probe.style.height = '1px';
      document.body.appendChild(probe);
    });
    const nativeUndoProbe = page.getByTestId('stage3-native-undo-probe');
    await nativeUndoProbe.focus();
    await expect(nativeUndoProbe).toBeFocused();
    await page.keyboard.press('Control+KeyZ');
    await expect.poll(async () => {
      const box = await card.boundingBox();
      return box ? Math.abs(box.x - moved.x) + Math.abs(box.y - moved.y) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(2);
    await nativeUndoProbe.evaluate(element => element.remove());

    const selectTool = page.getByTestId('canvas-select-tool');
    await selectTool.focus();
    await expect(selectTool).toBeFocused();
    await page.keyboard.press('Control+KeyZ');
    const firstMoveUndoInputEvents = await page.evaluate(() => (
      (window as typeof window & {
        __stage3HistoryInputEvents?: Array<Record<string, unknown>>;
      }).__stage3HistoryInputEvents ?? []
    ));
    await writeStage3Metrics(stage3Evidence, testInfo, 'move-undo-input-events', {
      events: firstMoveUndoInputEvents,
    });
    await expect.poll(async () => {
      const box = await card.boundingBox();
      return box ? Math.abs(box.x - original.x) + Math.abs(box.y - original.y) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(2);
    await page.keyboard.press('Control+Shift+KeyZ');
    await expect.poll(async () => {
      const box = await card.boundingBox();
      return box ? Math.abs(box.x - moved.x) + Math.abs(box.y - moved.y) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(2);

    await card.click();
    const { point: resizeStart } = await hittableResizeHandle(page, card);
    const resizeTarget = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return {
        imageId: target?.closest<HTMLElement>('[data-canvas-image-id]')?.dataset.canvasImageId ?? null,
        isResizeHandle: target instanceof HTMLElement && target.className.includes('cursor-nwse-resize'),
      };
    }, resizeStart);
    expect(resizeTarget).toEqual({ imageId: nodeId, isResizeHandle: true });
    await dragPointerAcrossFrames(
      page,
      resizeStart,
      {
        x: resizeStart.x < moved.x + moved.width / 2 ? resizeStart.x - 64 : resizeStart.x + 64,
        y: resizeStart.y,
      },
      14,
    );
    const resized = await stableCardBox(card);
    const resizedGeometry = await captureCanvasGeometry(page, nodeId);
    expect(resized.width).toBeGreaterThan(moved.width + 20);
    expect(resized.height).toBeGreaterThan(moved.height + 10);

    await page.keyboard.press('Control+KeyZ');
    await expect.poll(async () => {
      const box = await card.boundingBox();
      return box ? Math.abs(box.width - moved.width) + Math.abs(box.height - moved.height) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(2);
    const afterResizeUndo = await stableCardBox(card);
    const afterResizeUndoGeometry = await captureCanvasGeometry(page, nodeId);
    const viewportAfterResizeUndo = await page.locator('[data-canvas-viewport]').boundingBox();
    await writeStage3Metrics(stage3Evidence, testInfo, 'move-resize-history-geometry', {
      original,
      originalGeometry,
      moved,
      movedGeometry,
      resized,
      resizedGeometry,
      afterResizeUndo,
      afterResizeUndoGeometry,
      viewportAfterResizeUndo,
    });
    await expect.poll(async () => {
      const box = await card.boundingBox();
      return box ? Math.abs(box.x - moved.x) + Math.abs(box.y - moved.y) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(2);

    await page.keyboard.press('Control+KeyZ');
    await expect.poll(async () => {
      const box = await card.boundingBox();
      return box ? Math.abs(box.x - original.x) + Math.abs(box.y - original.y) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(2);

    await page.keyboard.press('Control+Shift+KeyZ');
    await page.keyboard.press('Control+Shift+KeyZ');
    await expect.poll(async () => {
      const box = await card.boundingBox();
      if (!box) return Number.POSITIVE_INFINITY;
      return Math.abs(box.x - resized.x)
        + Math.abs(box.y - resized.y)
        + Math.abs(box.width - resized.width)
        + Math.abs(box.height - resized.height);
    }).toBeLessThanOrEqual(4);

    const resizedBeforeImmediateReload = await captureCanvasGeometry(page, nodeId);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForStage3Node(page, nodeId);
    const resizedAfterImmediateReload = await captureCanvasGeometry(page, nodeId);
    expect(resizedAfterImmediateReload).toMatchObject({
      cardLeft: resizedBeforeImmediateReload.cardLeft,
      cardTop: resizedBeforeImmediateReload.cardTop,
      cardWidth: resizedBeforeImmediateReload.cardWidth,
      cardHeight: resizedBeforeImmediateReload.cardHeight,
    });
    const authoritativeProjectsAfterReload = await readStage3Projects(page);
    const authoritativeImageAfterReload = projectImage(authoritativeProjectsAfterReload, projectId, nodeId);
    expect(Number(authoritativeImageAfterReload?.x)).toBeCloseTo(
      Number.parseFloat(String(resizedBeforeImmediateReload.cardLeft)),
      5,
    );
    expect(Number(authoritativeImageAfterReload?.y)).toBeCloseTo(
      Number.parseFloat(String(resizedBeforeImmediateReload.cardTop)),
      5,
    );
    expect(Number(authoritativeImageAfterReload?.width)).toBeCloseTo(
      Number.parseFloat(String(resizedBeforeImmediateReload.cardWidth)),
      5,
    );
    expect(Number(authoritativeImageAfterReload?.height)).toBeCloseTo(
      Number.parseFloat(String(resizedBeforeImmediateReload.cardHeight)),
      5,
    );
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
      await clickCanvasBlankSpace(page);
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

      if (enforcesDesktopChromiumPerformance(testInfo.project.name)) {
        expect(sample.averageFps).toBeGreaterThanOrEqual(nodeCount === 100 ? 55 : 45);
        expect(sample.inputDelayP95Ms).toBeLessThanOrEqual(50);
        expect(sample.longestSaveTaskMs).toBeLessThanOrEqual(100);
      }
      expect(sample.disappearedFrames).toBe(0);
      expect(sample.unclickableDurationMs).toBe(0);
      await assertCanvasNodeContinuity(page, monitoredNodeIds);
    });
  }

  test('saves and refreshes a 300 nodes project within the main-thread budget', async ({ page, stage3Evidence }, testInfo) => {
    const projectId = stage3ProjectId(testInfo.project.name, 300);
    await loginStage3User(page);
    const projects = await readStage3Projects(page);
    const project = projects.find(candidate => candidate.id === projectId);
    expect(project).toBeTruthy();
    const images = project?.canvasImages as Array<Record<string, unknown>>;
    expect(images).toHaveLength(300);
    const target = images[images.length - 1];
    const nodeId = String(target.id);
    const initialPosition = {
      x: Number(target.x),
      y: Number(target.y),
      zIndex: Number(target.zIndex),
    };

    await openStage3Project(page, projectId);
    await page.getByTitle('重置视图').click();
    await waitForStage3Node(page, nodeId);
    const card = stage3CanvasCard(page, nodeId);
    const { point: dragStart } = await hittableCardCenter(page, card);
    const savedAfterDrag = page.waitForResponse(
      response => isProjectSave(response, projectId, nodeId, initialPosition),
      { timeout: 30_000 },
    );
    const saveSample = await measureCanvasInteraction(page, async () => {
      await dragPointerAcrossFrames(
        page,
        dragStart,
        { x: dragStart.x + 72, y: dragStart.y + 48 },
        45,
      );
      await savedAfterDrag;
    }, { monitoredNodeIds: [nodeId] });
    await writeStage3Metrics(stage3Evidence, testInfo, '300-node-save-performance', saveSample);

    expect(saveSample.disappearedFrames).toBe(0);
    expect(saveSample.unclickableDurationMs).toBe(0);
    if (enforcesDesktopChromiumPerformance(testInfo.project.name)) {
      expect(saveSample.longestSaveTaskMs).toBeLessThanOrEqual(100);
    }
    const savedProjects = await readStage3Projects(page);
    const savedImage = projectImage(savedProjects, projectId, nodeId);
    expect(savedImage).toMatchObject({
      width: target.width,
      height: target.height,
      zIndex: target.zIndex,
    });
    expect(savedImage?.processing ?? null).toEqual(target.processing ?? null);
    expect({ x: savedImage?.x, y: savedImage?.y }).not.toEqual({
      x: initialPosition.x,
      y: initialPosition.y,
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForStage3Node(page, nodeId);
    const reloadedProjects = await readStage3Projects(page);
    expect(projectImage(reloadedProjects, projectId, nodeId)).toMatchObject({
      x: savedImage?.x,
      y: savedImage?.y,
      width: savedImage?.width,
      height: savedImage?.height,
      zIndex: savedImage?.zIndex,
    });
    expect(projectImage(reloadedProjects, projectId, nodeId)?.processing ?? null)
      .toEqual(savedImage?.processing ?? null);
    await assertCanvasNodeContinuity(page, [nodeId]);
  });
});
