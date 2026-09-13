import { expect, test, type Locator, type Page } from '@playwright/test';

const secret = `wmg_abcd1234${'s'.repeat(35)}`;
const admin = {
  id: 'media-gateway-admin',
  name: 'Media Gateway Admin',
  role: 'admin',
  status: 'active',
  productType: 'canvas,chat',
  createdAt: 1,
  updatedAt: 1,
};
const gatewayKey = {
  id: 'gwkey_responsive',
  userId: 'user-responsive',
  keyPrefix: 'wmg_abcd1234',
  label: 'Responsive key',
  requestsPerMinute: 60,
  dailyQuota: 1000,
  todayUsage: 12,
  enabled: true,
  createdBy: admin.id,
  createdAt: '2026-09-13T00:00:00.000Z',
  lastUsedAt: '2026-09-13T01:00:00.000Z',
  revokedAt: null,
};
const issuedGatewayKey = { ...gatewayKey, todayUsage: 0, lastUsedAt: null };

test.use({ viewport: { width: 375, height: 667 } });

async function installRoutes(page: Page): Promise<void> {
  await page.route('**/api/**', route => route.fulfill({ json: { success: true } }));
  await page.route('**/api/session', route => route.fulfill({ json: { success: true, user: admin } }));
  await page.route('**/api/user-data/sync**', route => route.fulfill({ json: {
    success: true,
    value: [],
    projectRevision: 1,
    deletedCanvasPlacements: [],
  } }));
  await page.route('**/api/admin/gateway/keys**', route => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 201, json: { success: true, key: issuedGatewayKey, secret } });
    }
    return route.fulfill({ json: { success: true, keys: [gatewayKey] } });
  });
  await page.route('**/api/admin/users**', route => route.fulfill({ json: { success: true, users: [] } }));
  await page.route('**/api/admin/apis**', route => route.fulfill({ json: { success: true, providers: [] } }));
  await page.route('**/api/admin/groups**', route => route.fulfill({ json: { success: true, groups: [] } }));
  await page.route('**/api/admin/api-balance**', route => route.fulfill({ json: { success: true, balances: [] } }));
  await page.route('**/api/models**', route => route.fulfill({ json: { success: true, providers: [], models: [] } }));
}

async function expectNoHorizontalOverflow(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))).toEqual(expect.objectContaining({
    clientWidth: expect.any(Number),
    scrollWidth: expect.any(Number),
  }));
  const geometry = await locator.evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
}

test('media gateway admin stays within 375px through sheet and one-time secret dialog', async ({ page }) => {
  await installRoutes(page);
  await page.goto('/?view=dashboard', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '媒体网关' }).click();

  await expectNoHorizontalOverflow(page.getByTestId('media-gateway-admin'));
  await expectNoHorizontalOverflow(page.getByTestId('media-gateway-mobile-list'));

  await page.getByRole('button', { name: '签发密钥' }).click();
  const sheet = page.getByRole('dialog', { name: '签发媒体网关密钥' });
  await expectNoHorizontalOverflow(sheet);
  await sheet.getByLabel('用户 ID').fill('user-responsive');
  await sheet.getByLabel('标签').fill('Responsive key');
  await sheet.getByRole('button', { name: '确认签发' }).click();

  const secretDialog = page.getByRole('dialog', { name: '密钥签发成功' });
  await expect(secretDialog.getByText(secret)).toBeVisible();
  await expectNoHorizontalOverflow(secretDialog);
});
