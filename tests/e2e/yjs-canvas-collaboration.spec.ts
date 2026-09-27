import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

interface ProjectImage {
  id: string;
  placementId?: string;
  assetVersionId?: string;
}

interface ProjectsResponse {
  projectRevision: number;
  value: Array<{ id: string; canvasImages?: ProjectImage[]; metadata?: Record<string, unknown> }> | null;
}

const localGate = process.env.E2E_YJS_LOCAL_GATE === '1';

function requireLocalGate(): { baseURL: string; ownerName: string; ownerPassword: string } {
  const baseURL = process.env.E2E_BASE_URL ?? '';
  const databaseURL = process.env.PGDATABASE_URL ?? '';
  const dataRoot = process.env.WUJIE_DATA_DIR ?? '';
  const ownerName = process.env.E2E_YJS_OWNER_NAME ?? '';
  const ownerPassword = process.env.E2E_YJS_OWNER_PASSWORD ?? '';
  const base = new URL(baseURL);
  const database = new URL(databaseURL);
  if (base.hostname !== '127.0.0.1' || database.hostname !== '127.0.0.1'
    || !database.pathname.startsWith('/wujie_yjs_task7_')
    || !dataRoot.includes('_tmp_e2e') || !ownerName || !ownerPassword
    || process.env.WUJIE_YJS_ENABLED !== 'true') {
    throw new Error('Yjs browser gate requires an isolated localhost project, database, and data root');
  }
  return { baseURL, ownerName, ownerPassword };
}

async function readProjects(context: BrowserContext): Promise<ProjectsResponse> {
  const response = await context.request.get('/api/user-data/sync?key=projects');
  expect(response.status()).toBe(200);
  return response.json() as Promise<ProjectsResponse>;
}

async function readLeft(page: Page, imageId: string): Promise<number> {
  return page.locator(`[data-canvas-image-id="${imageId}"]`).evaluate(element => (
    Number.parseFloat((element as HTMLElement).style.left)
  ));
}

interface ImagePosition {
  x: number;
  y: number;
}

async function readPosition(page: Page, imageId: string): Promise<ImagePosition> {
  return page.locator(`[data-canvas-image-id="${imageId}"]`).evaluate(element => ({
    x: Number.parseFloat((element as HTMLElement).style.left),
    y: Number.parseFloat((element as HTMLElement).style.top),
  }));
}

async function installDocumentSocketGate(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    const state = {
      block: false,
      socket: null as WebSocket | null,
      holdUpdates: false,
      sentUpdates: 0,
      held: [] as Array<{ socket: WebSocket; frame: Uint8Array }>,
      flush(): void {
        this.holdUpdates = false;
        for (const update of this.held.splice(0)) {
          NativeSocket.prototype.send.call(update.socket, update.frame);
          this.sentUpdates += 1;
        }
      },
    };
    (window as Window & { __yjsGateSocket?: typeof state }).__yjsGateSocket = state;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (String(url).includes('/api/collaboration/document')) {
          state.socket = this;
          if (state.block) this.addEventListener('open', () => this.close());
        }
      }

      send(data: Parameters<WebSocket['send']>[0]): void {
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data)
          : ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
        if (this.url.includes('/api/collaboration/document') && bytes?.[0] === 0x02) {
          if (state.holdUpdates) {
            state.held.push({ socket: this, frame: new Uint8Array(bytes) });
            return;
          }
          state.sentUpdates += 1;
        }
        super.send(data);
      }
    };
  });
}

async function prepareCanvasViewport(page: Page): Promise<void> {
  await page.bringToFront();
  const collapsePanel = page.getByRole('button', { name: '收起面板', exact: true });
  if (await collapsePanel.isVisible()) await collapsePanel.click();
  const viewport = page.locator('[data-canvas-viewport]');
  await expect(viewport).toHaveAttribute('data-canvas-occupied-right', '20');
  await page.locator('[data-toolbar="bottom-toolbar"]').getByTitle('重置视图', { exact: true }).click();
  await expect(page.locator('[data-canvas-history-pending]')).toHaveAttribute('data-canvas-history-pending', 'false');
}

async function focusCanvasKeyboard(page: Page): Promise<void> {
  await page.bringToFront();
  const selected = page.locator('[data-canvas-image-id][data-canvas-selected="true"]');
  const selectedCount = await selected.count();
  const selectTool = page.getByTestId('canvas-select-tool');
  // This button changes the pointer tool, not image selection. A real click
  // establishes keyboard ownership without clearing the state Esc must test.
  await selectTool.click();
  // WebKit may leave a mouse-clicked button unfocused. Body is also a valid
  // canvas shortcut target; an editor or overlay retaining focus is not.
  await expect.poll(() => selectTool.evaluate(element => (
    document.hasFocus()
    && (document.activeElement === element || document.activeElement === document.body)
  ))).toBe(true);
  await expect(selected).toHaveCount(selectedCount);
  await expect(page.locator('[data-canvas-history-pending]')).toHaveAttribute('data-canvas-history-pending', 'false');
}

async function dragImage(page: Page, imageId: string, dx: number, dy: number): Promise<void> {
  await prepareCanvasViewport(page);
  const image = page.locator(`[data-canvas-image-id="${imageId}"]`);
  await expect(image).toBeVisible();
  await expect(image).toBeInViewport({ ratio: 1 });
  // Unlike raw mouse.move, hover checks stability and whether the image can
  // actually receive input. Read the coordinates only after that check.
  await image.hover();
  const bounds = await image.boundingBox();
  expect(bounds).not.toBeNull();
  const x = bounds!.x + bounds!.width / 2;
  const y = bounds!.y + bounds!.height / 2;
  const viewport = page.viewportSize()!;
  for (const point of [{ x, y }, { x: x + dx, y: y + dy }]) {
    expect(point.x).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(viewport.width - 20);
    expect(point.y).toBeGreaterThan(0);
    expect(point.y).toBeLessThan(viewport.height);
  }
  expect(await image.evaluate((element, point) => {
    const hit = document.elementFromPoint(point.x, point.y);
    return !!hit && element.contains(hit) && !hit.closest('[data-toolbar], button, input');
  }, { x, y })).toBe(true);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

async function openAnnotationComposer(page: Page): Promise<void> {
  await page.bringToFront();
  await page.getByRole('button', { name: '全部工具' }).click();
  await page.locator('[data-toolbar="bottom-annotation-entry"]').click();
  await expect(page.getByTestId('annotation-composer')).toBeVisible();
}

test('owner and invited editor converge without copying the project into the editor account', async ({ browser, browserName, headless, launchOptions }) => {
  test.skip(!localGate, 'Requires an explicit isolated localhost Yjs gate');
  test.setTimeout(240_000);
  const gate = requireLocalGate();
  let firstContext = await browser.newContext({ baseURL: gate.baseURL, viewport: { width: 1280, height: 800 } });
  let firstPage = await firstContext.newPage();
  let editorBrowser: Browser | undefined;
  let secondContextForCleanup: BrowserContext | undefined;

  try {
    // The isolated setContent probe reproduces Firefox's captured mouse input
    // crossing contexts even after bringToFront. A separate browser process
    // preserves owner's live gesture while editor receives its own native click.
    if (browserName === 'firefox') {
      editorBrowser = await browser.browserType().launch({ ...launchOptions, headless });
    }
    const secondContext = await (editorBrowser ?? browser).newContext({
      baseURL: gate.baseURL, viewport: { width: 1280, height: 800 },
    });
    secondContextForCleanup = secondContext;
    const secondPage = await secondContext.newPage();
    const errors: string[] = [];
    for (const page of [firstPage, secondPage]) page.on('pageerror', error => errors.push(error.message));

    const ownerLogin = await firstContext.request.post('/api/auth/login', {
      data: { name: gate.ownerName, password: gate.ownerPassword, productType: 'canvas' },
    });
    expect(ownerLogin.status()).toBe(200);
    await firstPage.goto('/?view=dashboard', { waitUntil: 'domcontentloaded' });
    await firstPage.getByRole('button', { name: '新建项目' }).click();
    const viewport = firstPage.locator('[data-canvas-viewport]');
    await expect(viewport).toBeVisible({ timeout: 30_000 });
    const projectId = await viewport.getAttribute('data-project-id');
    expect(projectId).toBeTruthy();

    await expect.poll(async () => (
      (await readProjects(firstContext)).value?.some(project => project.id === projectId) ?? false
    ), { timeout: 70_000 }).toBe(true);
    await expect(firstPage.getByRole('status').filter({ hasText: '同步不可用，改动未确认' }))
      .toHaveCount(0, { timeout: 70_000 });
    await expect(firstPage.getByRole('status').filter({ hasText: '正在确认协作状态' }))
      .toHaveCount(0, { timeout: 70_000 });

    await firstPage.getByTestId('canvas-image-upload-input').setInputFiles([
      resolve(__dirname, '../fixtures/tiny-test.png'),
      resolve(__dirname, '../fixtures/annotation-source.png'),
    ]);
    let images: ProjectImage[] = [];
    await expect.poll(async () => {
      const projects = await readProjects(firstContext);
      images = projects.value?.find(project => project.id === projectId)?.canvasImages ?? [];
      return images.filter(image => image.placementId && image.assetVersionId).length;
    }, { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
    const [firstImage, secondImage] = images.filter(image => image.placementId && image.assetVersionId);
    expect(firstImage.id).not.toBe(secondImage.id);

    const snapshot = await readProjects(firstContext);
    const seededWorkflow = {
      id: `workflow-${randomUUID()}`,
      name: '协作项目保留的节点工作流',
      version: 'v1.0', nodes: [], connections: [], status: 'idle',
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    const seededProjects = snapshot.value?.map(project => project.id === projectId
      ? {
        ...project,
        // Tiny source pixels remain valid media, but a 2px hit target makes
        // user gestures unreliable. Seed visible, separated canvas placements
        // through the normal project API before switching document authority.
        canvasImages: project.canvasImages?.map((image, index) => ({
          ...image, x: 200 + index * 180, y: 150, width: 100, height: 100,
        })),
        metadata: { ...project.metadata, workflow: seededWorkflow },
      }
      : project);
    expect(seededProjects).toBeTruthy();
    const seeded = await firstContext.request.post('/api/user-data/sync', {
      data: { key: 'projects', value: seededProjects, projectRevision: snapshot.projectRevision },
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    const enabledSnapshot = await readProjects(firstContext);
    const enabled = await firstPage.evaluate(async input => {
      const response = await fetch('/api/collaboration/document-enable', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return { status: response.status, body: await response.json() };
    }, { projectId, expectedRevision: enabledSnapshot.projectRevision });
    expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);

    const editorName = `yjs_editor_${randomUUID().slice(0, 8)}`;
    const editorPassword = `LocalYjsEditor-${randomUUID()}`;
    const createdEditor = await firstContext.request.post('/api/admin/users', {
      data: { action: 'create', name: editorName, password: editorPassword },
    });
    expect(createdEditor.status()).toBe(200);
    const editorUserId = (await createdEditor.json() as { user?: { id?: string } }).user?.id;
    expect(editorUserId).toBeTruthy();
    const grant = await firstContext.request.post('/api/collaboration/editors', {
      headers: { Origin: gate.baseURL },
      data: { projectId, memberUserId: editorUserId },
    });
    expect(grant.status()).toBe(200);
    const editorLogin = await secondContext.request.post('/api/auth/login', {
      data: { name: editorName, password: editorPassword, productType: 'canvas' },
    });
    expect(editorLogin.status()).toBe(200);
    expect(((await readProjects(secondContext)).value ?? []).some(project => project.id === projectId)).toBe(false);

    const ownerStorage = await firstContext.storageState();
    await firstContext.close();
    firstContext = await browser.newContext({
      baseURL: gate.baseURL,
      storageState: ownerStorage,
      viewport: { width: 1280, height: 800 },
    });
    await installDocumentSocketGate(firstContext);
    await installDocumentSocketGate(secondContext);
    firstPage = await firstContext.newPage();
    firstPage.on('pageerror', error => errors.push(error.message));
    // A fresh development server can spend over 30 seconds compiling the first project route.
    // The saved-status assertions below still require the actual page and document to load.
    await firstPage.goto(`/?projectId=${encodeURIComponent(projectId!)}`, {
      waitUntil: 'domcontentloaded', timeout: 90_000,
    });
    await secondPage.goto(`/?projectId=${encodeURIComponent(projectId!)}`, {
      waitUntil: 'domcontentloaded', timeout: 90_000,
    });
    const savedStatus = (page: Page) => page.getByRole('status').filter({ hasText: '已保存' });
    await expect(savedStatus(firstPage)).toBeVisible({ timeout: 30_000 });
    await expect(savedStatus(secondPage)).toBeVisible({ timeout: 30_000 });
    await firstPage.getByTitle('节点模式').first().click();
    await expect(firstPage.getByRole('toolbar', { name: '工作流工具栏' })).toBeVisible();
    await expect(firstPage.getByText(seededWorkflow.name, { exact: true })).toBeVisible();
    await firstPage.getByRole('button', { name: '返回画布', exact: true }).click();
    await expect(savedStatus(firstPage)).toBeVisible();
    const firstBefore = await readLeft(firstPage, firstImage.id);
    const secondBefore = await readLeft(secondPage, secondImage.id);

    // A rejected durable queue write must not advance InfiniteCanvas's image
    // ref; the next drag must start from the last accepted server geometry.
    await firstPage.evaluate(() => {
      const original = Storage.prototype.setItem;
      (window as Window & { __restoreYjsStorage?: () => void }).__restoreYjsStorage = () => {
        Storage.prototype.setItem = original;
      };
      Storage.prototype.setItem = function (key: string, value: string): void {
        if (this === localStorage && key.startsWith('wujie-canvas-document-pending-v1:')) {
          throw new DOMException('local queue full', 'QuotaExceededError');
        }
        original.call(this, key, value);
      };
    });
    await dragImage(firstPage, firstImage.id, 36, 12);
    await expect.poll(() => readLeft(firstPage, firstImage.id)).toBe(firstBefore);
    await firstPage.evaluate(() => {
      (window as Window & { __restoreYjsStorage?: () => void }).__restoreYjsStorage?.();
    });
    await expect(savedStatus(firstPage)).toBeVisible({ timeout: 30_000 });

    // Distinct placements must be edited from a shared confirmed baseline,
    // before either peer can observe the other's update (not saved-then-edit).
    const documentURL = `/api/collaboration/document-project?projectId=${encodeURIComponent(projectId!)}`;
    const beforeDistinctResponse = await firstContext.request.get(documentURL);
    expect(beforeDistinctResponse.status()).toBe(200);
    const beforeDistinct = await beforeDistinctResponse.json() as {
      projection: { placements: Record<string, Record<string, unknown>> };
    };
    const firstInitialPlacement = beforeDistinct.projection.placements[firstImage.placementId!];
    const secondInitialPlacement = beforeDistinct.projection.placements[secondImage.placementId!];
    expect(firstInitialPlacement).toBeTruthy();
    expect(secondInitialPlacement).toBeTruthy();
    const firstStartPosition = { x: firstInitialPlacement.x, y: firstInitialPlacement.y };
    const secondStartPosition = { x: secondInitialPlacement.x, y: secondInitialPlacement.y };
    expect(firstStartPosition.x).toBe(firstBefore);
    expect(secondStartPosition.x).toBe(secondBefore);
    for (const page of [firstPage, secondPage]) {
      await expect(savedStatus(page)).toBeVisible();
      expect(await readPosition(page, firstImage.id)).toEqual(firstStartPosition);
      expect(await readPosition(page, secondImage.id)).toEqual(secondStartPosition);
    }
    await Promise.all([firstPage, secondPage].map(page => page.evaluate(() => {
      const state = (window as Window & {
        __yjsGateSocket?: { holdUpdates: boolean; held: unknown[] };
      }).__yjsGateSocket;
      if (!state || state.held.length !== 0) throw new Error('Document socket gate not ready');
      state.holdUpdates = true;
    })));

    await firstPage.evaluate(() => {
      const original = Storage.prototype.setItem;
      const capture = window as Window & {
        __capturedYjsFrame?: { key: string; value: string };
        __restoreYjsCapture?: () => void;
      };
      capture.__restoreYjsCapture = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function (key: string, value: string): void {
        if (this === localStorage && key.startsWith('wujie-canvas-document-pending-v1:')) {
          capture.__capturedYjsFrame ??= { key, value };
        }
        original.call(this, key, value);
      };
    });
    await dragImage(firstPage, firstImage.id, 56, 24);
    await expect.poll(() => readLeft(firstPage, firstImage.id)).not.toBe(firstBefore);
    const capturedPending = await firstPage.evaluate(() => {
      const capture = window as Window & {
        __capturedYjsFrame?: { key: string; value: string };
        __restoreYjsCapture?: () => void;
      };
      capture.__restoreYjsCapture?.();
      return capture.__capturedYjsFrame ?? null;
    });
    expect(capturedPending).not.toBeNull();
    await dragImage(secondPage, secondImage.id, -48, 32);
    await expect.poll(() => readLeft(secondPage, secondImage.id)).not.toBe(secondBefore);
    const firstMoved = await readLeft(firstPage, firstImage.id);
    const secondMoved = await readLeft(secondPage, secondImage.id);
    const firstConcurrentPosition = await readPosition(firstPage, firstImage.id);
    const secondConcurrentPosition = await readPosition(secondPage, secondImage.id);
    expect(firstConcurrentPosition).not.toEqual(firstStartPosition);
    expect(secondConcurrentPosition).not.toEqual(secondStartPosition);
    expect(await readPosition(firstPage, secondImage.id)).toEqual(secondStartPosition);
    expect(await readPosition(secondPage, firstImage.id)).toEqual(firstStartPosition);
    for (const page of [firstPage, secondPage]) {
      await expect.poll(() => page.evaluate(() => (window as Window & {
        __yjsGateSocket?: { held: unknown[] };
      }).__yjsGateSocket?.held.length)).toBeGreaterThan(0);
      await expect(savedStatus(page)).toHaveCount(0);
    }
    // Neither local edit has reached persistence yet. Both candidates exist
    // before releasing editor then owner through the existing native sockets.
    const heldResponse = await firstContext.request.get(documentURL);
    expect(heldResponse.status()).toBe(200);
    const heldProjection = await heldResponse.json() as typeof beforeDistinct;
    expect(heldProjection.projection.placements[firstImage.placementId!]).toEqual(firstInitialPlacement);
    expect(heldProjection.projection.placements[secondImage.placementId!]).toEqual(secondInitialPlacement);
    for (const page of [secondPage, firstPage]) {
      await page.evaluate(() => (window as Window & {
        __yjsGateSocket?: { flush(): void };
      }).__yjsGateSocket?.flush());
    }
    await expect.poll(() => readLeft(secondPage, firstImage.id)).toBe(firstMoved);
    await expect.poll(() => readLeft(firstPage, secondImage.id)).toBe(secondMoved);
    await expect(savedStatus(firstPage)).toBeVisible();
    await expect(savedStatus(secondPage)).toBeVisible();
    await expect(async () => {
      const response = await firstContext.request.get(documentURL);
      expect(response.status()).toBe(200);
      const body = await response.json() as typeof beforeDistinct;
      expect(body.projection.placements[firstImage.placementId!])
        .toEqual({ ...firstInitialPlacement, ...firstConcurrentPosition });
      expect(body.projection.placements[secondImage.placementId!])
        .toEqual({ ...secondInitialPlacement, ...secondConcurrentPosition });
      for (const page of [firstPage, secondPage]) {
        expect(await readPosition(page, firstImage.id)).toEqual(firstConcurrentPosition);
        expect(await readPosition(page, secondImage.id)).toEqual(secondConcurrentPosition);
      }
    }).toPass({ timeout: 10_000 });

    await focusCanvasKeyboard(firstPage);
    await firstPage.keyboard.press('Control+z');
    await expect.poll(() => readLeft(firstPage, firstImage.id)).toBe(firstBefore);
    await expect.poll(() => readLeft(secondPage, firstImage.id)).toBe(firstBefore);
    expect(await readLeft(firstPage, secondImage.id)).toBe(secondMoved);
    await expect(savedStatus(firstPage)).toBeVisible();

    await firstPage.reload({ waitUntil: 'domcontentloaded' });
    await secondPage.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => readLeft(firstPage, firstImage.id)).toBe(firstBefore);
    await expect.poll(() => readLeft(secondPage, secondImage.id)).toBe(secondMoved);
    await expect(savedStatus(firstPage)).toBeVisible();
    await expect(savedStatus(secondPage)).toBeVisible();

    // Both real pages edit from the same confirmed state. Holding only outgoing
    // update frames prevents the first drag from becoming the second's input.
    // Both placements were seeded at a visible 100px size before collaboration.
    const conflictImage = secondImage;
    const beforeConflictResponse = await firstContext.request.get(documentURL);
    expect(beforeConflictResponse.status()).toBe(200);
    const beforeConflict = await beforeConflictResponse.json() as {
      projection: { placements: Record<string, Record<string, unknown>> };
    };
    const initialPlacement = beforeConflict.projection.placements[conflictImage.placementId!];
    expect(initialPlacement).toBeTruthy();
    const initialPosition = { x: initialPlacement.x, y: initialPlacement.y };
    expect(await readPosition(firstPage, conflictImage.id)).toEqual(initialPosition);
    expect(await readPosition(secondPage, conflictImage.id)).toEqual(initialPosition);
    for (const page of [firstPage, secondPage]) {
      await page.evaluate(() => {
        const state = (window as Window & {
          __yjsGateSocket?: { holdUpdates: boolean };
        }).__yjsGateSocket;
        if (!state) throw new Error('Document socket gate missing');
        state.holdUpdates = true;
      });
    }
    await dragImage(firstPage, conflictImage.id, 28, 16);
    await dragImage(secondPage, conflictImage.id, -24, -12);
    const ownerPosition = await readPosition(firstPage, conflictImage.id);
    const editorPosition = await readPosition(secondPage, conflictImage.id);
    expect(ownerPosition).not.toEqual(initialPosition);
    expect(editorPosition).not.toEqual(initialPosition);
    expect(ownerPosition.x).not.toBe(editorPosition.x);
    expect(ownerPosition.y).not.toBe(editorPosition.y);
    for (const page of [firstPage, secondPage]) {
      await expect.poll(() => page.evaluate(() => (window as Window & {
        __yjsGateSocket?: { held: unknown[] };
      }).__yjsGateSocket?.held.length)).toBeGreaterThan(0);
      await expect(savedStatus(page)).toHaveCount(0);
    }
    // Deliver in reverse editing order through the native sockets.
    for (const page of [secondPage, firstPage]) {
      await page.evaluate(() => (window as Window & {
        __yjsGateSocket?: { flush(): void };
      }).__yjsGateSocket?.flush());
    }
    await expect(savedStatus(firstPage)).toBeVisible();
    await expect(savedStatus(secondPage)).toBeVisible();
    await expect(async () => {
      const response = await firstContext.request.get(documentURL);
      expect(response.status()).toBe(200);
      const body = await response.json() as typeof beforeConflict;
      const placement = body.projection.placements[conflictImage.placementId!];
      // A complete candidate must win. Hybrid x/y or other changed fields fail.
      expect([
        { ...initialPlacement, ...ownerPosition },
        { ...initialPlacement, ...editorPosition },
      ]).toContainEqual(placement);
      const winner = placement.x === ownerPosition.x ? ownerPosition : editorPosition;
      expect(await readPosition(firstPage, conflictImage.id)).toEqual(winner);
      expect(await readPosition(secondPage, conflictImage.id)).toEqual(winner);
    }).toPass({ timeout: 10_000 });
    for (const width of [320, 375, 393]) {
      await firstPage.setViewportSize({ width, height: 720 });
      const collapsePanel = firstPage.getByRole('button', { name: '收起面板' });
      if (await collapsePanel.isVisible()) await collapsePanel.click();
      await expect(savedStatus(firstPage)).toBeVisible();
      const statusBounds = await savedStatus(firstPage).boundingBox();
      expect(statusBounds).not.toBeNull();
      expect(statusBounds!.x).toBeGreaterThanOrEqual(0);
      expect(statusBounds!.x + statusBounds!.width).toBeLessThanOrEqual(width);
      await expect(firstPage.locator('[data-canvas-viewport]')).toBeVisible();
      const persistedImages = (await readProjects(firstContext)).value
        ?.find(project => project.id === projectId)?.canvasImages ?? [];
      expect(persistedImages.map(image => image.id)).toEqual(expect.arrayContaining([
        firstImage.id, secondImage.id,
      ]));
    }
    await firstPage.setViewportSize({ width: 1280, height: 800 });
    await prepareCanvasViewport(firstPage);
    await focusCanvasKeyboard(firstPage);
    await firstPage.keyboard.press('Escape');
    await expect(firstPage.locator('[data-toolbar="image-action-toolbar"]')).toHaveCount(0);
    await expect(firstPage.locator('[data-canvas-image-id][data-canvas-selected="true"]')).toHaveCount(0);
    await firstPage.locator(`[data-canvas-image-id="${firstImage.id}"]`).click();
    await firstPage.locator(`[data-canvas-image-id="${secondImage.id}"]`).click({ modifiers: ['Control'] });
    await firstPage.keyboard.press('Control+Shift+KeyG');
    await expect.poll(async () => {
      const response = await firstContext.request.get(
        `/api/collaboration/document-project?projectId=${encodeURIComponent(projectId!)}`,
      );
      expect(response.status()).toBe(200);
      const body = await response.json() as {
        projection?: { groupDefinitions?: Record<string, unknown> };
      };
      return Object.keys(body.projection?.groupDefinitions ?? {}).length;
    }).toBe(1);
    await expect(secondPage.getByText('组 1')).toBeVisible();

    await openAnnotationComposer(firstPage);
    await firstPage.locator('[data-annotation-tool="region"]').click();
    const annotationImage = firstPage.locator(`[data-canvas-image-id="${firstImage.id}"]`);
    const annotationBounds = await annotationImage.boundingBox();
    expect(annotationBounds).not.toBeNull();
    const regionStart = {
      x: annotationBounds!.x + annotationBounds!.width * 0.25,
      y: annotationBounds!.y + annotationBounds!.height * 0.25,
    };
    await firstPage.mouse.move(regionStart.x, regionStart.y);
    await firstPage.mouse.down();
    await firstPage.mouse.move(regionStart.x + 32, regionStart.y + 32, { steps: 8 });
    await firstPage.mouse.up();
    await expect(firstPage.getByTestId('annotation-composer').getByText('区域 1')).toBeVisible();
    await expect.poll(async () => {
      const response = await firstContext.request.get(
        `/api/collaboration/document-project?projectId=${encodeURIComponent(projectId!)}`,
      );
      expect(response.status()).toBe(200);
      const body = await response.json() as {
        projection?: { annotationRecords?: Record<string, unknown> };
      };
      return Object.keys(body.projection?.annotationRecords ?? {}).length;
    }).toBe(1);
    await openAnnotationComposer(secondPage);
    await expect(secondPage.getByTestId('annotation-composer').getByText('区域 1')).toBeVisible();
    // Observe the native input boundary without dispatching events or changing
    // selection/focus. A completed Playwright click alone does not prove that
    // the remote button received a DOM click while the other page holds capture.
    for (const page of [firstPage, secondPage]) {
      await page.evaluate(() => {
        const events: Array<Record<string, unknown>> = [];
        Object.assign(window, { __annotationInputEvents: events });
        for (const type of ['pointerdown', 'pointerup', 'pointercancel',
          'gotpointercapture', 'lostpointercapture', 'click', 'focus', 'blur']) {
          window.addEventListener(type, event => {
            const target = event.target instanceof Element ? event.target : null;
            events.push({
              type, trusted: event.isTrusted, focused: document.hasFocus(),
              removeId: target?.closest('[data-annotation-remove]')?.getAttribute('data-annotation-remove'),
              canvas: Boolean(target?.closest('[data-canvas-viewport]')),
              pointerId: event instanceof PointerEvent ? event.pointerId : null,
              buttons: event instanceof MouseEvent ? event.buttons : null,
            });
          }, { capture: true });
        }
      });
    }
    const draftStart = {
      x: annotationBounds!.x + annotationBounds!.width * 0.55,
      y: annotationBounds!.y + annotationBounds!.height * 0.55,
    };
    await firstPage.bringToFront();
    await firstPage.mouse.move(draftStart.x, draftStart.y);
    await firstPage.mouse.down();
    await firstPage.mouse.move(draftStart.x + 16, draftStart.y + 16, { steps: 4 });
    const ownerDraft = firstPage.locator('[data-annotation-kind="draft-region"]');
    await expect(ownerDraft).toHaveCount(1);
    const remoteRemove = secondPage.getByTestId('annotation-composer').locator('[data-annotation-remove]');
    const remoteRemoveId = await remoteRemove.getAttribute('data-annotation-remove');
    expect(remoteRemoveId).not.toBeNull();
    // Select the editor page without releasing owner's drag. Firefox also needs
    // the process isolation above; bringToFront alone did not isolate capture.
    await secondPage.bringToFront();
    await expect.poll(() => secondPage.evaluate(() => document.hasFocus())).toBe(true);
    await remoteRemove.click();
    const annotationInputEvidence = await Promise.all([firstPage, secondPage].map(page => (
      page.evaluate(() => ({
        focused: document.hasFocus(),
        activeTag: document.activeElement?.tagName,
        events: (window as Window & { __annotationInputEvents?: unknown[] }).__annotationInputEvents,
        remainingRemoveButtons: document.querySelectorAll('[data-annotation-remove]').length,
      }))
    )));
    await test.info().attach('annotation-remove-native-input', {
      body: Buffer.from(JSON.stringify(annotationInputEvidence, null, 2)),
      contentType: 'application/json',
    });
    // hasFocus alone is insufficient: Firefox reported true for BOTH pages in
    // the failing trace. Require the intended native click and a still-live draft.
    expect(annotationInputEvidence[1].events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'click', trusted: true, removeId: remoteRemoveId }),
    ]));
    await expect(ownerDraft).toHaveCount(1);
    // Separate a missing native click/local removal from a propagation failure.
    await expect(secondPage.getByTestId('annotation-composer').getByText('区域 1')).toHaveCount(0);
    await expect.poll(async () => {
      const response = await firstContext.request.get(
        `/api/collaboration/document-project?projectId=${encodeURIComponent(projectId!)}`,
      );
      expect(response.status()).toBe(200);
      const body = await response.json() as {
        projection?: { annotationTombstones?: Record<string, boolean> };
      };
      return Object.values(body.projection?.annotationTombstones ?? {}).filter(Boolean).length;
    }).toBe(1);
    await expect(firstPage.getByTestId('annotation-composer').getByText('区域 1')).toHaveCount(0);
    await firstPage.bringToFront();
    await expect(ownerDraft).toHaveCount(1);
    await firstPage.mouse.move(draftStart.x + 40, draftStart.y + 40, { steps: 4 });
    await firstPage.mouse.up();
    await expect.poll(async () => {
      const response = await firstContext.request.get(
        `/api/collaboration/document-project?projectId=${encodeURIComponent(projectId!)}`,
      );
      expect(response.status()).toBe(200);
      const body = await response.json() as {
        projection?: { annotationRecords?: Record<string, unknown> };
      };
      return Object.keys(body.projection?.annotationRecords ?? {}).length;
    }).toBe(2);
    await expect(secondPage.getByTestId('annotation-composer').getByText('区域 1')).toBeVisible();
    await secondPage.bringToFront();
    await secondPage.getByTestId('annotation-composer').locator('[data-annotation-remove]').click();
    await expect.poll(async () => {
      const response = await firstContext.request.get(
        `/api/collaboration/document-project?projectId=${encodeURIComponent(projectId!)}`,
      );
      expect(response.status()).toBe(200);
      const body = await response.json() as {
        projection?: { annotationTombstones?: Record<string, boolean> };
      };
      return Object.values(body.projection?.annotationTombstones ?? {}).filter(Boolean).length;
    }).toBe(2);
    await expect(firstPage.getByTestId('annotation-composer').getByText('区域 1')).toHaveCount(0);
    await firstPage.reload({ waitUntil: 'domcontentloaded' });
    await secondPage.reload({ waitUntil: 'domcontentloaded' });
    for (const page of [firstPage, secondPage]) {
      await expect(savedStatus(page)).toBeVisible({ timeout: 30_000 });
      await prepareCanvasViewport(page);
      await openAnnotationComposer(page);
      await expect(page.getByTestId('annotation-composer').getByText('区域 1')).toHaveCount(0);
    }
    await firstPage.evaluate(() => {
      const state = (window as Window & {
        __yjsGateSocket?: { block: boolean; socket: WebSocket | null };
      }).__yjsGateSocket;
      if (!state?.socket) throw new Error('Document socket was not captured');
      state.block = true;
      state.socket.close();
    });
    await expect(firstPage.getByRole('status').filter({ hasText: '同步不可用' })).toBeVisible();
    await firstPage.locator('[data-annotation-tool="region"]').click();
    const imageBounds = await Promise.all([firstImage.id, secondImage.id].map(id => (
      firstPage.locator(`[data-canvas-image-id="${id}"]`).boundingBox()
    )));
    const failedEditBounds = imageBounds
      .filter((bounds): bounds is NonNullable<typeof bounds> => bounds !== null)
      .sort((left, right) => right.width * right.height - left.width * left.height)[0];
    expect(failedEditBounds?.width).toBeGreaterThan(40);
    expect(failedEditBounds?.height).toBeGreaterThan(40);
    await firstPage.bringToFront();
    await firstPage.mouse.move(failedEditBounds!.x + failedEditBounds!.width * 0.3,
      failedEditBounds!.y + failedEditBounds!.height * 0.3);
    await firstPage.mouse.down();
    await firstPage.mouse.move(failedEditBounds!.x + failedEditBounds!.width * 0.7,
      failedEditBounds!.y + failedEditBounds!.height * 0.7, { steps: 8 });
    await firstPage.mouse.up();
    await expect(firstPage.getByText('协作文档尚未连接，不能写入')).toBeVisible();
    await expect(firstPage.getByTestId('annotation-composer').getByText('区域 1')).toHaveCount(0);
    await focusCanvasKeyboard(firstPage);
    await firstPage.keyboard.press('Escape');
    await expect(firstPage.locator('[data-toolbar="image-action-toolbar"]')).toHaveCount(0);
    // Esc removes selection, not hover. The focus click above moves the real
    // pointer away; wait for the existing hover-dismiss timer to complete.
    await expect(firstPage.locator('[data-toolbar="image-hover-toolbar"]')).toHaveCount(0);
    const groupTitle = firstPage.locator('[data-canvas-group-drag-handle]');
    await groupTitle.dblclick({ position: { x: 8, y: 8 } });
    const groupNameInput = groupTitle.locator('input');
    await expect(groupNameInput).toBeVisible();
    await groupNameInput.fill('离线组');
    await groupNameInput.press('Enter');
    await expect(firstPage.getByText('协作文档尚未连接，不能写入').first()).toBeVisible();
    await expect(groupTitle.getByText('离线组')).toHaveCount(0);
    await expect(groupTitle.getByText('组 1')).toBeVisible();
    await firstPage.evaluate(({ key, value }) => localStorage.setItem(key, value), capturedPending!);
    await firstPage.reload({ waitUntil: 'domcontentloaded' });
    const recoveryStatus = firstPage.getByRole('status').filter({ hasText: '上次改动未确认' });
    await expect(recoveryStatus).toBeVisible({ timeout: 30_000 });
    // Reload on desktop starts with the right panel expanded. Keep this real
    // overlap regression: do not call prepareCanvasViewport here.
    await expect(firstPage.getByRole('button', { name: '收起面板', exact: true })).toBeVisible();
    await expect(firstPage.getByRole('button', { name: '下载未同步副本' })).toBeVisible();
    await expect(firstPage.getByRole('button', { name: '重试同步' })).toBeVisible();
    expect(await firstPage.evaluate(() => (window as Window & {
      __yjsGateSocket?: { sentUpdates: number };
    }).__yjsGateSocket?.sentUpdates)).toBe(0);
    const [downloaded] = await Promise.all([
      firstPage.waitForEvent('download'),
      firstPage.getByRole('button', { name: '下载未同步副本' }).click(),
    ]);
    expect(await downloaded.failure()).toBeNull();
    const recoveryStream = await downloaded.createReadStream();
    expect(recoveryStream).not.toBeNull();
    const recoveryChunks: Buffer[] = [];
    for await (const chunk of recoveryStream!) recoveryChunks.push(Buffer.from(chunk));
    const recoveryCopy = JSON.parse(Buffer.concat(recoveryChunks).toString('utf8')) as {
      schemaVersion: number;
      projectId: string;
      pendingFrames: Array<{ frameBase64: string; intent?: Record<string, unknown> }>;
    };
    expect(recoveryCopy.schemaVersion).toBe(1);
    expect(recoveryCopy.projectId).toBe(projectId);
    expect(recoveryCopy.pendingFrames.length).toBeGreaterThan(0);
    expect(recoveryCopy.pendingFrames[0].frameBase64.length).toBeGreaterThan(0);
    expect(recoveryCopy.pendingFrames[0].intent).toBeTruthy();
    for (const width of [1280, 320, 375, 393]) {
      await firstPage.setViewportSize({ width, height: 720 });
      for (const collapsed of [false, true]) {
        const desiredToggle = collapsed ? '展开面板' : '收起面板';
        if (!await firstPage.getByRole('button', { name: desiredToggle, exact: true }).isVisible()) {
          await firstPage.getByRole('button', {
            name: collapsed ? '收起面板' : '展开面板', exact: true,
          }).click();
        }
        for (const control of [recoveryStatus,
          firstPage.getByRole('button', { name: '下载未同步副本' }),
          firstPage.getByRole('button', { name: '重试同步' })]) {
          await expect(control).toBeVisible();
          await expect.poll(() => control.evaluate(element => {
            const bounds = element.getBoundingClientRect();
            return bounds.width > 0 && bounds.height > 0
              && bounds.x >= 0 && bounds.right <= window.innerWidth
              && bounds.y >= 0 && bounds.bottom <= window.innerHeight
              && element.contains(document.elementFromPoint(
                bounds.x + bounds.width / 2, bounds.y + bounds.height / 2,
              ));
          }), { message: `recovery control reachable at ${width}px, collapsed=${collapsed}` }).toBe(true);
          const bounds = await control.boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        }
        // Trial checks the retry hit target without consuming the pending copy.
        await firstPage.getByRole('button', { name: '重试同步' }).click({ trial: true });
        const [layoutDownload] = await Promise.all([
          firstPage.waitForEvent('download'),
          firstPage.getByRole('button', { name: '下载未同步副本' }).click(),
        ]);
        expect(await layoutDownload.failure()).toBeNull();
      }
    }
    await firstPage.getByRole('button', { name: '展开面板', exact: true }).click();
    await firstPage.getByRole('button', { name: '重试同步' }).click();
    await expect(savedStatus(firstPage)).toBeVisible({ timeout: 30_000 });
    expect(await firstPage.evaluate(() => (window as Window & {
      __yjsGateSocket?: { sentUpdates: number };
    }).__yjsGateSocket?.sentUpdates)).toBeGreaterThan(0);
    expect(await firstPage.evaluate(({ key }) => localStorage.getItem(key), capturedPending!)).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    try {
      await secondContextForCleanup?.close();
    } finally {
      try {
        await firstContext.close();
      } finally {
        await editorBrowser?.close();
      }
    }
  }
});
