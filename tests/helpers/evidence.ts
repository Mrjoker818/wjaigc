import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { runArtifactPath } from './v588-auth-task-9';

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
  const authRunId = process.env.E2E_AUTH_RUN_ID?.trim();
  const authRole = process.env.E2E_TEST_ROLE?.trim() || 'user';
  await Promise.all([
    mkdir(join(root, 'screenshots'), { recursive: true }),
    mkdir(join(root, 'console'), { recursive: true }),
    mkdir(join(root, 'network'), { recursive: true }),
  ]);
  const safeLabel = label.replaceAll(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const screenshotPath = authRunId
    ? runArtifactPath('screenshots', authRunId, testInfo.project.name, `p0-${authRole}`, testInfo.retry, `${safeLabel}.png`)
    : join(root, 'screenshots', `${safeLabel}-${testInfo.project.name}.png`);
  const consolePath = authRunId
    ? runArtifactPath('console', authRunId, testInfo.project.name, `p0-${authRole}`, testInfo.retry, `${safeLabel}.json`)
    : join(root, 'console', `${safeLabel}-${testInfo.project.name}.json`);
  const networkPath = authRunId
    ? runArtifactPath('network', authRunId, testInfo.project.name, `p0-${authRole}`, testInfo.retry, `${safeLabel}.json`)
    : join(root, 'network', `${safeLabel}-${testInfo.project.name}.json`);
  const dialogsPath = authRunId
    ? runArtifactPath('console', authRunId, testInfo.project.name, `p0-${authRole}`, testInfo.retry, `${safeLabel}-dialogs.json`)
    : join(root, 'console', `${safeLabel}-${testInfo.project.name}-dialogs.json`);
  const identityPath = testInfo.outputPath('v588-artifact-identity.json');
  await Promise.all([screenshotPath, consolePath, networkPath, dialogsPath].map(async path => {
    const { dirname } = await import('node:path');
    await mkdir(dirname(path), { recursive: true });
  }));
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await Promise.all([
    writeFile(consolePath, JSON.stringify(evidence.console, null, 2)),
    writeFile(networkPath, JSON.stringify(evidence.network, null, 2)),
    writeFile(dialogsPath, JSON.stringify(evidence.dialogs, null, 2)),
    ...(authRunId ? [writeFile(identityPath, JSON.stringify({
      runId: authRunId,
      project: testInfo.project.name,
      role: `p0-${authRole}`,
      retry: testInfo.retry,
    }, null, 2))] : []),
  ]);
  await testInfo.attach('browser-console.json', { path: consolePath, contentType: 'application/json' });
  await testInfo.attach('network-log.json', { path: networkPath, contentType: 'application/json' });
  await testInfo.attach('browser-dialogs.json', { path: dialogsPath, contentType: 'application/json' });
}
