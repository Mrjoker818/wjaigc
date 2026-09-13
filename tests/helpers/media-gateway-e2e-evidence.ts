import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import type { Page, TestInfo } from '@playwright/test';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

interface EvidenceFacts {
  requestIds: string[];
  gatewayRequestIds: string[];
  taskIds: string[];
  redactedLedger?: unknown;
  [key: string]: unknown;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = /authorization|cookie|password|secret|token|api.?key/i.test(key)
      ? '[REDACTED]'
      : redact(entry);
  }
  return output;
}

function collectIdentifiers(value: unknown, facts: EvidenceFacts): void {
  if (Array.isArray(value)) {
    value.forEach(entry => collectIdentifiers(entry, facts));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') {
      if (key === 'requestId') facts.requestIds.push(entry);
      if (key === 'gatewayRequestId') facts.gatewayRequestIds.push(entry);
      if (key === 'taskId') facts.taskIds.push(entry);
    } else if (key === 'taskIds' && Array.isArray(entry)) {
      facts.taskIds.push(...entry.filter((item): item is string => typeof item === 'string'));
    }
    collectIdentifiers(entry, facts);
  }
}

export function createMediaGatewayEvidence(page: Page, testInfo: TestInfo) {
  const consoleEntries: Array<Record<string, unknown>> = [];
  const networkEntries: Array<Record<string, unknown>> = [];
  const facts: EvidenceFacts = { requestIds: [], gatewayRequestIds: [], taskIds: [] };

  page.on('console', message => {
    consoleEntries.push({ timestamp: new Date().toISOString(), type: message.type(), text: message.text() });
  });
  page.on('response', response => {
    const url = new URL(response.url());
    networkEntries.push({
      timestamp: new Date().toISOString(),
      method: response.request().method(),
      url: `${url.origin}${url.pathname}`,
      status: response.status(),
      mimeType: response.headers()['content-type']?.split(';')[0] || null,
    });
  });

  return {
    record(value: Record<string, unknown>): void {
      collectIdentifiers(value, facts);
      Object.assign(facts, redact(value));
    },
    recordLedger(value: unknown): void {
      facts.redactedLedger = redact(value);
    },
    async finalize(): Promise<void> {
      facts.requestIds = unique(facts.requestIds);
      facts.gatewayRequestIds = unique(facts.gatewayRequestIds);
      facts.taskIds = unique(facts.taskIds);
      await testInfo.attach('console.json', {
        body: Buffer.from(`${JSON.stringify(consoleEntries, null, 2)}\n`),
        contentType: 'application/json',
      });
      await testInfo.attach('network.json', {
        body: Buffer.from(`${JSON.stringify(networkEntries, null, 2)}\n`),
        contentType: 'application/json',
      });
      await testInfo.attach('task-evidence.json', {
        body: Buffer.from(`${JSON.stringify(facts, null, 2)}\n`),
        contentType: 'application/json',
      });
      await testInfo.attach('final.png', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    },
  };
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'unnamed';
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export default class MediaGatewayEvidenceReporter implements Reporter {
  async onTestEnd(test: TestCase, result: TestResult): Promise<void> {
    if (!test.location.file.endsWith('v588-media-gateway.spec.ts')) return;
    const commit = safeSegment(process.env.E2E_MEDIA_GATEWAY_COMMIT || 'cloud-pending');
    const directory = resolve(
      process.cwd(),
      'test-results',
      'media-gateway',
      commit,
      safeSegment(test.parent.project()?.name || 'unknown-project'),
      safeSegment(test.titlePath().join('-')),
    );
    await mkdir(directory, { recursive: true });
    const names = new Map<string, string>([
      ['trace', 'trace.zip'],
      ['video', 'video.webm'],
      ['screenshot', 'screenshot.png'],
      ['final.png', 'final.png'],
      ['console.json', 'console.json'],
      ['network.json', 'network.json'],
      ['task-evidence.json', 'task-evidence.json'],
    ]);
    const artifacts: Array<{ name: string; bytes: number; sha256: string }> = [];
    let facts: EvidenceFacts = { requestIds: [], gatewayRequestIds: [], taskIds: [] };
    for (const attachment of result.attachments) {
      const targetName = names.get(attachment.name);
      if (!targetName) continue;
      const data = attachment.body || (attachment.path ? await readFile(attachment.path) : undefined);
      if (!data) continue;
      const target = resolve(directory, targetName);
      if (attachment.path) await copyFile(attachment.path, target);
      else await writeFile(target, data);
      artifacts.push({ name: basename(target), bytes: data.byteLength, sha256: sha256(data) });
      if (targetName === 'task-evidence.json') {
        facts = JSON.parse(data.toString('utf8')) as EvidenceFacts;
      }
    }
    const manifest = {
      schemaVersion: 1,
      commit,
      deploymentUrl: process.env.E2E_BASE_URL || null,
      project: test.parent.project()?.name || null,
      test: test.titlePath(),
      status: result.status,
      startedAt: result.startTime.toISOString(),
      durationMs: result.duration,
      requestIds: facts.requestIds || [],
      gatewayRequestIds: facts.gatewayRequestIds || [],
      taskIds: facts.taskIds || [],
      redactedLedger: facts.redactedLedger || null,
      artifacts,
    };
    await writeFile(resolve(directory, 'evidence-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
}
