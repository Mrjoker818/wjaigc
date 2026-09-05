import sharp from 'sharp';
import { createWorkflowNode } from '../../src/lib/workflow-engine';
import {
  ensureStage4Session, expect, openStage4CanvasProject, seedStage4Baseline,
  stage4FixtureForProject, test,
} from '../helpers/stage-4-e2e';

test.use({ trace: 'off', video: 'on' });
test.describe.configure({ mode: 'serial', timeout: 120_000 });

for (const [name, width, height] of [['landscape', 1200, 600], ['portrait', 600, 1200]] as const) {
  test(`节点图片预览真实布局 ${name}`, async ({ page, baseURL }, testInfo) => {
    expect(['127.0.0.1', 'localhost']).toContain(new URL(baseURL!).hostname);
    const fixture = await stage4FixtureForProject(testInfo.project.name);
    const auth = await ensureStage4Session(page, fixture);
    page.on('response', async response => {
      if (response.url().includes('/api/user-data/sync') && response.status() >= 400) {
        await testInfo.attach('fixture-sync-error.json', { body: await response.body(), contentType: 'application/json' });
      }
    });
    const imagePath = `/__test_node_preview_${name}.png`;
    const png = await sharp({ create: { width, height, channels: 3, background: '#e53935' } }).png().toBuffer();
    await page.route(`**${imagePath}`, route => route.fulfill({ contentType: 'image/png', body: png }));
    const node = createWorkflowNode('input-image', 40, 40);
    node.label = '预览布局样本';
    node.config.imageUrl = imagePath;
    // This layout case has no managed canvas assets; the baseline placeholder is not an AssetVersion.
    fixture.canvasProject.canvasImages = [];
    fixture.canvasProject.metadata = {
      ...(fixture.canvasProject.metadata as Record<string, unknown>),
      workflow: { ...fixture.workflow, nodes: [node], connections: [] },
    };
    await seedStage4Baseline(page, fixture, auth);
    await openStage4CanvasProject(page, String(fixture.canvasProject.id));
    await page.getByRole('button', { name: '节点模式', exact: true }).click();
    const image = page.getByLabel('预览布局样本', { exact: true }).locator('img').first();
    await expect(image).toBeVisible();
    await page.getByLabel('预览布局样本', { exact: true }).getByText('预览', { exact: true }).click();
    const preview = page.locator('img[alt="预览"].shadow-2xl');
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate(element => ({
      complete: (element as HTMLImageElement).complete,
      width: (element as HTMLImageElement).naturalWidth,
      height: (element as HTMLImageElement).naturalHeight,
    }))).toEqual({ complete: true, width, height });

    for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 812 }, { width: 320, height: 640 }]) {
      await page.setViewportSize(viewport);
      const box = await preview.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeCloseTo(viewport.width * 0.8, 0);
      expect(box!.height).toBeCloseTo(viewport.height * 0.8, 0);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      const screenshot = await preview.screenshot();
      await testInfo.attach(`${name}-${viewport.width}.png`, { body: screenshot, contentType: 'image/png' });
      const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * info.channels;
        if (data[offset] > 180 && data[offset + 1] < 90 && data[offset + 2] < 90) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
      expect(maxX - minX).toBeGreaterThan(50);
      expect(maxY - minY).toBeGreaterThan(50);
      expect((maxX - minX + 1) / (maxY - minY + 1)).toBeCloseTo(width / height, 1);
    }
    await preview.click();
    await expect(preview).toHaveCount(0);
  });
}
