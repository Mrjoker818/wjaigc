import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

import { writeEvidenceManifest, type EvidenceStatus } from '../helpers/evidence-manifest';

function currentCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unconfirmed-local-commit';
  }
}

function safeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

test.describe('Stage 0 deployment evidence', () => {
  test('records reachability, route identity, and immediate browser errors', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    testInfo.annotations.push(
      { type: 'featureId', description: 'identity.session' },
      { type: 'verification', description: 'reachability-only' },
    );

    const localCommit = currentCommit();
    const deploymentCommit = process.env.E2E_DEPLOYMENT_COMMIT?.trim() || '';
    const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5000';
    const capturedAt = new Date().toISOString();
    const consoleEntries: Array<{ type: string; text: string }> = [];
    const networkEntries: Array<{
      method: string;
      url: string;
      status?: number;
      failure?: string;
    }> = [];
    const pageErrors: string[] = [];
    let status: EvidenceStatus = 'failed';
    let blockedReason = '';
    let pageReached = false;

    page.on('console', (message) => {
      consoleEntries.push({ type: message.type(), text: message.text() });
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      networkEntries.push({
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
      });
    });
    page.on('requestfailed', (request) => {
      networkEntries.push({
        method: request.method(),
        url: request.url(),
        failure: request.failure()?.errorText || 'unknown failure',
      });
    });

    try {
      const response = await page.goto('/', {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      expect(response, 'Deployment did not return a document response.').not.toBeNull();
      expect(response!.status(), 'Deployment returned a server error.').toBeLessThan(500);
      expect(new URL(page.url()).origin).toBe(new URL(baseURL).origin);
      await expect(page.locator('body')).not.toBeEmpty();
      expect(pageErrors, 'Immediate uncaught browser errors were detected.').toEqual([]);
      pageReached = true;

      if (!deploymentCommit) {
        blockedReason = 'E2E_DEPLOYMENT_COMMIT is missing; cloud runtime SHA cannot be confirmed.';
        status = 'blocked';
      } else {
        status = 'completed';
      }
    } catch (error) {
      blockedReason = error instanceof Error ? error.message : String(error);
      status = 'blocked';
    } finally {
      const manifestCommit = deploymentCommit || localCommit;
      const evidenceRoot = join(process.cwd(), 'test-results', 'evidence');
      const directory = join(
        evidenceRoot,
        safeSegment(manifestCommit),
        'identity.session',
        safeSegment(testInfo.project.name),
        safeSegment(capturedAt),
      );
      const screenshotRelative = 'screenshots/reachability.png';
      const consoleRelative = 'console/reachability.json';
      const networkRelative = 'network/reachability.json';
      const taskRelative = 'tasks/no-business-task.json';

      await Promise.all([
        mkdir(join(directory, 'screenshots'), { recursive: true }),
        mkdir(join(directory, 'console'), { recursive: true }),
        mkdir(join(directory, 'network'), { recursive: true }),
        mkdir(join(directory, 'tasks'), { recursive: true }),
      ]);

      let screenshotSaved = false;
      if (pageReached && !page.isClosed()) {
        try {
          await page.screenshot({
            path: join(directory, screenshotRelative),
            fullPage: true,
          });
          screenshotSaved = true;
        } catch {
          screenshotSaved = false;
        }
      }
      await Promise.all([
        writeFile(
          join(directory, consoleRelative),
          `${JSON.stringify({ console: consoleEntries, pageErrors }, null, 2)}\n`,
          'utf8',
        ),
        writeFile(
          join(directory, networkRelative),
          `${JSON.stringify(networkEntries, null, 2)}\n`,
          'utf8',
        ),
        writeFile(
          join(directory, taskRelative),
          `${JSON.stringify({
            businessTaskStarted: false,
            scope: 'reachability-only',
            localCommit,
            deploymentCommit: deploymentCommit || null,
            blockedReason: blockedReason || null,
          }, null, 2)}\n`,
          'utf8',
        ),
      ]);

      await writeEvidenceManifest({
        commit: manifestCommit,
        deploymentUrl: baseURL,
        browser: testInfo.project.name,
        viewport: page.viewportSize() || { width: 0, height: 0 },
        capturedAt,
        featureId: 'identity.session',
        artifactPaths: {
          ...(screenshotSaved ? { screenshot: screenshotRelative } : {}),
          console: consoleRelative,
          network: networkRelative,
          task: taskRelative,
        },
        requestIds: [],
        status,
      });

      for (const path of [
        join(directory, consoleRelative),
        join(directory, networkRelative),
        join(directory, taskRelative),
      ]) {
        await testInfo.attach(path.split(/[\\/]/).at(-1) || 'evidence.json', {
          path,
          contentType: 'application/json',
        });
      }
      if (screenshotSaved) {
        await testInfo.attach('reachability.png', {
          path: join(directory, screenshotRelative),
          contentType: 'image/png',
        });
      }
    }

    if (status === 'blocked') {
      test.skip(true, blockedReason || 'Stage 0 deployment evidence is blocked.');
    }
  });
});
