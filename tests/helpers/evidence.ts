import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

interface BrowserEvidence {
  console: Array<{ type: string; text: string; location: string }>;
  network: Array<{ method: string; url: string; status?: number; failure?: string }>;
  dialogs: Array<{ type: string; message: string; defaultValue: string }>;
}

export function collectBrowserEvidence(page: Page): BrowserEvidence {
  const evidence: BrowserEvidence = { console: [], network: [], dialogs: [] };
  page.on('console', (message) => {
    const location = message.location();
    evidence.console.push({ type: message.type(), text: message.text(), location: `${location.url}:${location.lineNumber}:${location.columnNumber}` });
  });
  page.on('dialog', (dialog) => {
    evidence.dialogs.push({
      type: dialog.type(),
      message: dialog.message(),
      defaultValue: dialog.defaultValue(),
    });
    void dialog.dismiss();
  });
  page.on('requestfailed', (request) => {
    evidence.network.push({ method: request.method(), url: request.url(), failure: request.failure()?.errorText || 'unknown failure' });
  });
  page.on('response', (response) => {
    if (response.status() >= 400 || response.url().includes('/api/')) {
      evidence.network.push({ method: response.request().method(), url: response.url(), status: response.status() });
    }
  });
  return evidence;
}

export async function saveBrowserEvidence(page: Page, testInfo: TestInfo, evidence: BrowserEvidence, label: string): Promise<void> {
  const root = join(process.cwd(), 'test-results');
  await Promise.all([
    mkdir(join(root, 'screenshots'), { recursive: true }),
    mkdir(join(root, 'console'), { recursive: true }),
    mkdir(join(root, 'network'), { recursive: true }),
  ]);
  const safeLabel = label.replaceAll(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const screenshotPath = join(root, 'screenshots', `${safeLabel}-${testInfo.project.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await Promise.all([
    writeFile(join(root, 'console', `${safeLabel}-${testInfo.project.name}.json`), JSON.stringify(evidence.console, null, 2)),
    writeFile(join(root, 'network', `${safeLabel}-${testInfo.project.name}.json`), JSON.stringify(evidence.network, null, 2)),
    writeFile(join(root, 'console', `${safeLabel}-${testInfo.project.name}-dialogs.json`), JSON.stringify(evidence.dialogs, null, 2)),
  ]);
  await testInfo.attach('browser-console.json', { path: join(root, 'console', `${safeLabel}-${testInfo.project.name}.json`), contentType: 'application/json' });
  await testInfo.attach('network-log.json', { path: join(root, 'network', `${safeLabel}-${testInfo.project.name}.json`), contentType: 'application/json' });
  await testInfo.attach('browser-dialogs.json', { path: join(root, 'console', `${safeLabel}-${testInfo.project.name}-dialogs.json`), contentType: 'application/json' });
}
