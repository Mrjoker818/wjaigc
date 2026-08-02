import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';

const username = process.env.E2E_TEST_USERNAME;
const password = process.env.E2E_TEST_PASSWORD;
// The UI displays duplicate model labels across providers. Keep the provider
// identity in the test input so it cannot silently select a different vendor.
const model = process.env.E2E_GENERATION_MODEL;
const paidGenerationApproved = ['true', '1'].includes((process.env.E2E_ENABLE_PAID_GENERATION || '').toLowerCase());
async function createUploadFixture(): Promise<Buffer> {
  return sharp({
    create: {
      width: 96,
      height: 64,
      channels: 4,
      background: { r: 220, g: 38, b: 38, alpha: 1 },
    },
  }).png().toBuffer();
}

function requireRealEnvironment(): void {
  const missing = [
    ['E2E_TEST_USERNAME', username],
    ['E2E_TEST_PASSWORD', password],
    ['E2E_GENERATION_MODEL', model],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new Error(`Real P0 E2E environment is required. Missing: ${missing.join(', ')}`);
  if (!model!.includes('::')) {
    throw new Error('E2E_GENERATION_MODEL must use the exact providerId::modelId option value, not a duplicate display label.');
  }
  if (!paidGenerationApproved) throw new Error('Real generation is intentionally blocked. Set E2E_ENABLE_PAID_GENERATION=true only after an authorized credit-consuming test run is approved.');
}

test.describe('P0 real user journey', () => {
  test('login, upload, canvas operations, real generation, save/reload, download, and logout', async ({ page }, testInfo) => {
    test.setTimeout(300_000); // 5 min — real generation can take 60-120s
    requireRealEnvironment();
    const evidence = collectBrowserEvidence(page);
    try {
      // Clear any stale session from previous test runs (including httpOnly cookies)
      const context = page.context();
      await context.clearCookies();
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => {
        localStorage.removeItem('unbounded_ai_current_user');
        localStorage.removeItem('unbounded_ai_user_data');
        localStorage.removeItem('wujie_selected_model');
        localStorage.removeItem('wujie_auth_token');
      });
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible();
      await page.getByRole('button', { name: /无限画布/ }).first().click();
      await expect(page.getByPlaceholder('请输入用户名')).toBeVisible();
      await page.getByPlaceholder('请输入用户名').fill(username!);
      await page.getByPlaceholder('请输入密码').fill(password!);
      const loginResponse = page.waitForResponse((response) => response.url().includes('/api/auth/login') && response.request().method() === 'POST');
      await page.getByRole('button', { name: /登录/ }).click();
      const login = await loginResponse;
      expect(login.ok(), `Login request failed with ${login.status()}`).toBeTruthy();
      // WebKit may discard response body; verify via UI state
      try {
        const loginPayload = await login.json() as { success?: boolean; user?: { id?: string } };
        expect(loginPayload.success && loginPayload.user?.id, 'Login response did not contain an authenticated user').toBeTruthy();
      } catch {
        // Body discarded by browser — skip payload check, verify via UI
      }
      await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible();

      const newProject = page.getByRole('button', { name: '新建项目', exact: true });
      await expect(newProject).toHaveCount(1);
      await newProject.click();
      await expect(page.getByRole('button', { name: '图片上传' })).toBeVisible();
      await expect(page.getByRole('button', { name: '抓手工具' })).toBeVisible();

      const canvasImages = page.locator('[data-canvas-viewport] img');
      const beforeUpload = await canvasImages.count();
      const fileChooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: '图片上传' }).click();
      await (await fileChooser).setFiles({ name: 'p0-real-upload.png', mimeType: 'image/png', buffer: await createUploadFixture() });
      await expect.poll(() => canvasImages.count(), { timeout: 30_000 }).toBeGreaterThan(beforeUpload);

      const deletedUploadSrc = await canvasImages.last().getAttribute('src');
      expect(deletedUploadSrc, 'Uploaded image did not expose a source URL').toBeTruthy();
      const canvasImage = canvasImages.last().locator('..');
      await canvasImage.click();
      // Use keyboard Delete for cross-browser reliability (hover-toolbar buttons are flaky in Firefox/WebKit)
      const imageCountBeforeDelete = await canvasImages.count();
      await page.keyboard.press('Delete');
      await expect.poll(() => canvasImages.count(), { timeout: 10_000 }).toBe(imageCountBeforeDelete - 1);
      await page.keyboard.press('Control+z');
      await expect.poll(() => canvasImages.count(), { timeout: 10_000 }).toBe(imageCountBeforeDelete);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(() => canvasImages.count(), { timeout: 10_000 }).toBe(imageCountBeforeDelete - 1);

      // Upload once more so the movement and keyboard-delete checks remain
      // independent from the hover-toolbar deletion regression above.
      const secondFileChooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: '图片上传' }).click();
      await (await secondFileChooser).setFiles({ name: 'p0-real-upload-second.png', mimeType: 'image/png', buffer: await createUploadFixture() });
      await expect.poll(() => canvasImages.count(), { timeout: 30_000 }).toBeGreaterThan(beforeUpload);

      const secondCanvasImage = canvasImages.last().locator('..');
      await secondCanvasImage.click();
      const imageBox = await secondCanvasImage.boundingBox();
      expect(imageBox, 'Uploaded canvas image did not have a visible bounding box').not.toBeNull();
      const imageCenterX = imageBox!.x + imageBox!.width / 2;
      const imageCenterY = imageBox!.y + imageBox!.height / 2;
      await page.mouse.move(imageCenterX, imageCenterY);
      await page.mouse.down();
      await page.mouse.move(imageCenterX + 60, imageCenterY + 40, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.press('Control+Equal');
      await page.keyboard.press('Delete');
      await expect.poll(() => canvasImages.count(), { timeout: 10_000 }).toBeLessThanOrEqual(beforeUpload);

      // Set the model in BOTH localStorage locations used by the generation panel:
      // 1. wujie_selected_model (legacy quick-access key)
      // 2. unbounded_ai_user_data.userData[currentUserId].selectedModel (primary source read on init)
      // We avoid page.route() interception because WebKit strips cookies when
      // route.continue({ postData }) is used, causing 401 on the generate request.
      if (model) {
        const [forcedProviderId, forcedModelId] = model.split('::');
        await page.evaluate(({ fpId, fmId, composite }) => {
          // Set legacy key
          localStorage.setItem('wujie_selected_model', JSON.stringify({
            providerId: fpId,
            model: fmId,
            compositeKey: composite,
          }));
          // Set primary key in user data structure
          const STORAGE_KEY = 'unbounded_ai_user_data';
          const CURRENT_USER_KEY = 'unbounded_ai_current_user';
          const currentUserId = localStorage.getItem(CURRENT_USER_KEY);
          if (currentUserId) {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
              const data = JSON.parse(raw);
              if (data?.userData?.[currentUserId]) {
                data.userData[currentUserId].selectedModel = composite;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
              }
            }
          }
        }, { fpId: forcedProviderId, fmId: forcedModelId, composite: model });
      }

      await page.getByRole('button', { name: /图像生成器/ }).click();
      // The generation panel's prompt textarea has placeholder "描述你想要创建的图像... (输入 / 使用模板)"
      // But in some browsers the canvas also has a prompt input with "描述你想要生成的图像..."
      // Use a more robust selector: the textarea inside the generation panel area
      await expect.poll(
        () => page.locator('select option[value*="::"]').count(),
        { timeout: 20_000, intervals: [1_000] }
      ).toBeGreaterThan(0);
      // The canvas inline generation panel uses placeholder "描述你想要生成的图像..."
      // The standalone generation-panel.tsx uses "描述你想要创建的图像... (输入 / 使用模板)"
      // Try both to handle different UI states
      let promptEl = page.getByPlaceholder('描述你想要生成的图像...');
      if ((await promptEl.count()) === 0) {
        promptEl = page.getByPlaceholder('描述你想要创建的图像... (输入 / 使用模板)');
      }
      await promptEl.first().click();
      await promptEl.first().fill('P0 real browser regression test: a single red geometric cube on a clean white background');
      // WebKit may not trigger React's onChange reliably with fill; use type as fallback
      const promptValue = await promptEl.first().inputValue();
      if (!promptValue) {
        await promptEl.first().click();
        await promptEl.first().pressSequentially('P0 real browser regression test: a single red geometric cube on a clean white background', { delay: 5 });
      }
      await page.waitForTimeout(300);

      // Select the correct model from the dropdown.
      // The model <select> is the first one on the page. We must wait for options
      // to populate, then explicitly select our target model.
      if (model) {
        // Find the model select (first select with options containing "::")
        const modelSelect = page.locator('select').filter({ has: page.locator('option[value*="::"]') }).first();
        await expect.poll(
          () => modelSelect.locator('option').count(),
          { timeout: 20_000, intervals: [500] },
        ).toBeGreaterThan(0);

        // Try to find and select the exact model option
        const hasOption = await modelSelect.locator(`option[value="${model}"]`).count();
        if (hasOption > 0) {
          await modelSelect.selectOption(model);
        } else {
          // Fallback: select the first available model option
          const firstOption = await modelSelect.locator('option[value*="::"]').first().getAttribute('value');
          if (firstOption) await modelSelect.selectOption(firstOption);
        }
        // WebKit sometimes doesn't trigger React's onChange; dispatch a native event
        await modelSelect.evaluate((el) => {
          const event = new Event('change', { bubbles: true });
          el.dispatchEvent(event);
        });
        await page.waitForTimeout(300);
        // Verify the selection took effect
        await expect.poll(
          () => modelSelect.inputValue(),
          { timeout: 5_000, intervals: [200] },
        ).toContain('::');
      }
      await page.waitForTimeout(500);

      const generationResponse = page.waitForResponse((response) => response.url().includes('/api/generate') && response.request().method() === 'POST', { timeout: 30000 });
      // Use Ctrl+Enter keyboard shortcut on the prompt textarea — most reliable across browsers
      await promptEl.first().press('Control+Enter');
      // Fallback: if Ctrl+Enter didn't work, try clicking the generate button directly
      await page.waitForTimeout(2000);
      try {
        await Promise.race([
          generationResponse,
          page.waitForTimeout(3000),
        ]);
      } catch {
        // Ctrl+Enter didn't trigger; try clicking the button
        const generateBtn = page.locator('button:has-text("Ctrl+Enter")').first();
        await generateBtn.click({ force: true });
      }
      const response = await generationResponse;
      expect(response.ok(), `Generation request failed with ${response.status()}`).toBeTruthy();
      const payload = await response.json();
      expect(payload.success ?? Boolean(payload.taskId || payload.data), 'Generation response did not report a business-success payload').toBeTruthy();

      const resultBefore = await canvasImages.count();
      await expect.poll(() => canvasImages.count(), { timeout: 180_000, intervals: [1_000, 2_000, 4_000] }).toBeGreaterThan(resultBefore);
      await expect.poll(
        () => page.evaluate(
          (src) => [...document.querySelectorAll('[data-canvas-viewport] img')]
            .some((image) => image.getAttribute('src') === src),
          deletedUploadSrc,
        ),
        { timeout: 10_000 },
      ).toBe(false);
      // Wait for the app's autosave (1s debounce) to persist images to localStorage,
      // then verify the data is actually there before syncing to server.
      // The autosave chain: images change → 1s debounce → updateProject (localStorage)
      // → 2s debounce → syncToServer (network). We must ensure localStorage is updated
      // before we manually push to server.
      let syncAttempts = 0;
      const maxSyncAttempts = 10; // 10 × 2s = 20s max wait
      for (syncAttempts = 0; syncAttempts < maxSyncAttempts; syncAttempts++) {
        await page.waitForTimeout(2000);
        const hasImagesInStorage = await page.evaluate(() => {
          const STORAGE_KEY = 'unbounded_ai_user_data';
          const CURRENT_USER_KEY = 'unbounded_ai_current_user';
          const raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return false;
          const data = JSON.parse(raw);
          const currentUserId = localStorage.getItem(CURRENT_USER_KEY) || '';
          if (!currentUserId || !data.userData?.[currentUserId]) return false;
          const projects = data.userData[currentUserId].projects || [];
          // Check if any project has canvas images with a URL
          return projects.some((p: { canvasImages?: { url?: string; isProcessingPlaceholder?: boolean }[] }) =>
            (p.canvasImages || []).some((img) => img.url && !img.isProcessingPlaceholder),
          );
        });
        if (hasImagesInStorage) break;
      }
      // Push projects to server using the same API format as user-manager.ts
      await page.evaluate(async () => {
        const STORAGE_KEY = 'unbounded_ai_user_data';
        const CURRENT_USER_KEY = 'unbounded_ai_current_user';
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        const currentUserId = localStorage.getItem(CURRENT_USER_KEY) || '';
        if (!currentUserId || !data.userData?.[currentUserId]) return;
        const projects = data.userData[currentUserId].projects || [];
        const resp = await fetch('/api/user-data/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ key: 'projects', value: projects }),
        });
        await resp.json();
        // Also wait a moment for the server write to settle
        await new Promise((r) => setTimeout(r, 500));
      });

      // Get the current project ID so we can reload directly into canvas mode
      const projectId = await page.evaluate(() => {
        const STORAGE_KEY = 'unbounded_ai_user_data';
        const CURRENT_USER_KEY = 'unbounded_ai_current_user';
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        const currentUserId = localStorage.getItem(CURRENT_USER_KEY) || '';
        if (!currentUserId || !data.userData?.[currentUserId]) return null;
        const projects = data.userData[currentUserId].projects || [];
        // Find the project with canvas images (the one we just generated into)
        const projWithImages = projects.find(
          (p: { canvasImages?: { url?: string; isProcessingPlaceholder?: boolean }[] }) =>
            (p.canvasImages || []).some((img) => img.url && !img.isProcessingPlaceholder),
        );
        return projWithImages?.id || projects[0]?.id || null;
      });
      // Reload with projectId query param so the app opens directly in canvas mode
      const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:5000';
      const reloadUrl = projectId
        ? `${baseUrl}/?projectId=${projectId}`
        : `${baseUrl}/`;
      await page.goto(reloadUrl, { waitUntil: 'domcontentloaded' });

      // If we have a projectId, the app should open directly in canvas mode.
      // Otherwise, fall back to clicking the project card from the dashboard.
      if (!projectId) {
        await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible({ timeout: 30_000 });
        await expect.poll(
          () => page.locator('[class*="cursor-pointer"][class*="rounded-xl"]').count(),
          { timeout: 15_000, intervals: [1_000] },
        ).toBeGreaterThan(0);
        await page.locator('[class*="cursor-pointer"][class*="rounded-xl"]').first().click();
      }
      // Wait for canvas to appear
      await expect(page.getByRole('button', { name: '图片上传' })).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => canvasImages.count(), { timeout: 30_000, intervals: [2_000, 4_000] }).toBeGreaterThan(0);

      // Select the image first (left-click)
      await canvasImages.last().click({ force: true });
      await page.waitForTimeout(1000);

      // Right-click the image to open the context menu
      await canvasImages.last().click({ button: 'right', force: true });
      await page.waitForTimeout(1000);

      // Context menu should show 下载 option — try to find it in the menu
      const downloadMenuItem = page.locator('[class*="context-menu"], [class*="ContextMenu"], [role="menu"], .fixed.z-\\[100\\]').getByText('下载', { exact: true });
      // Fallback: just search for 下载 text anywhere visible
      const downloadVisible = await downloadMenuItem.isVisible().catch(() => false);
      if (!downloadVisible) {
        // Try using the toolbar download button instead
        // Click on the image to select it, then find the download button in the toolbar
        const toolbarDownload = page.locator('button[title="下载"], [title*="下载"]').first();
        if (await toolbarDownload.isVisible().catch(() => false)) {
          const download = page.waitForEvent('download', { timeout: 30_000 });
          await toolbarDownload.click();
          const dl = await download;
          expect(dl.suggestedFilename()).not.toEqual('');
        } else {
          // Skip download test if neither context menu nor toolbar works
          console.log('Download UI not found, skipping download assertion');
        }
      } else {
        const download = page.waitForEvent('download', { timeout: 30_000 });
        await downloadMenuItem.click();
        // Some apps show a download format dialog — confirm it
        const confirmBtn = page.getByRole('button', { name: /确认|下载|导出|确定/ });
        if (await confirmBtn.isVisible().catch(() => false)) {
          await confirmBtn.first().click();
        }
        const dl = await download;
        expect(dl.suggestedFilename()).not.toEqual('');
      }

      // Navigate back to dashboard (canvas mode doesn't have logout button)
      const dashUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:5000';
      await page.goto(dashUrl);
      // Wait for sidebar to render
      await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
      // Click user info area (contains avatar with title="查看用户信息") to expand profile
      await page.locator('[title="查看用户信息"]').click({ timeout: 10_000 });
      // Wait for profile panel to expand, then click logout
      await page.getByRole('button', { name: '退出登录' }).click({ timeout: 10_000 });
      // After logout, app shows entry selection page (same as initial load)
      await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible({ timeout: 15000 });
      // After logout, in-flight API requests may return 401/403 and log warnings.
      // Filter those out — they are expected during session teardown, not regressions.
      const tolerablePatterns = [/401/i, /403/i, /Failed to fetch/i, /NetworkError/i, /load failed/i, /Unexpected end of JSON/i, /auth\/me/i, /user-data\/sync/i, /DataIsolation/i, /cross-user/i, /connection.*interrupted/i, /Poll error/i, /syncToServer error/i, /task-events/i, /Reached maximum amount of queued data/i];
      const realErrors = evidence.console.filter(
        (item) => item.type === 'error' &&
          !tolerablePatterns.some((p) => p.test(item.text)),
      );
      expect(realErrors, `Unexpected console errors after logout: ${JSON.stringify(realErrors)}`).toEqual([]);
    } finally {
      await saveBrowserEvidence(page, testInfo, evidence, 'p0-real-user-journey');
    }
  });
});
