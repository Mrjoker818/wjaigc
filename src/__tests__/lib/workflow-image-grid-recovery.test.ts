import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { build } from 'vite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { WorkflowImageGridActionRequest } from '@/lib/workflow-image-action-request';

const origin = 'https://workflow-grid.fixture.invalid';
const entry = `
import {createWorkflowImageGridClient} from '@/lib/workflow-image-grid-client';
import {createWorkflowInputTransferGuard} from '@/lib/asset-core/workspace-transfer';
import {createEmptyWorkflow,createWorkflowNode} from '@/lib/workflow-engine';
window.gridFixture = (actorId, url) => {
  const projectId = 'fixture-project', workflowId = 'fixture-workflow';
  const source = createWorkflowNode('input-image', 0, 0);
  source.id = 'fixture-source'; source.config = {projectId, imageUrl: url};
  let workflow = {...createEmptyWorkflow('Fixture'), id: workflowId, nodes: [source]};
  const guard = createWorkflowInputTransferGuard();
  let view, applied = 0;
  const client = createWorkflowImageGridClient({
    snapshot: () => ({actorId, projectId, workflowId, documentMode: false, workflow, results: {}}),
    guard: () => guard, fetcher: (input, init) => fetch(input, init),
    apply: next => { workflow = next; applied++; }, onView: next => { view = next; },
  });
  client.reset();
  window.gridRun = async () => {
    await client.run(source.id, 2, 1);
    return {phase: view?.phase, applied, nodes: workflow.nodes.map(node => node.id), edges: workflow.connections.length};
  };
  window.gridReset = () => client.reset();
};`;

declare global {
  interface Window {
    gridFixture(actorId: string, source: string): void;
    gridRun(): Promise<{ phase: string; applied: number; nodes: string[]; edges: number }>;
    gridReset(): void;
  }
}

let browser: Browser, bundle: string;
beforeAll(async () => {
  const id = 'virtual:workflow-grid-recovery-fixture';
  const result = await build({ configFile: false, envFile: false, publicDir: false, logLevel: 'error',
    resolve: { alias: { '@': path.resolve('src') } },
    build: { write: false, minify: false, lib: { entry: id, name: 'GridFixture', formats: ['iife'] }, rollupOptions: { input: id } },
    plugins: [{ name: 'workflow-grid-recovery-fixture',
      resolveId: candidate => candidate === id ? '\0' + id : null,
      load: candidate => candidate === '\0' + id ? entry : null }],
  });
  const output = (Array.isArray(result) ? result[0] : result);
  if (!('output' in output) || output.output[0].type !== 'chunk') throw new Error('Expected a bundled grid fixture');
  bundle = output.output[0].code;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function offlineContext(context: BrowserContext) {
  const received: Array<{ actor: string | undefined; body: string; request: WorkflowImageGridActionRequest }> = [];
  const committed = new Set<string>();
  await context.route('**/*', async route => {
    const browserRequest = route.request(), url = new URL(browserRequest.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<script src="/fixture.js"></script>' });
    if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
    if (url.pathname !== '/api/workflow/image-actions' || browserRequest.method() !== 'POST') return route.abort();
    const body = browserRequest.postData()!, request = JSON.parse(body) as WorkflowImageGridActionRequest;
    const actor = browserRequest.headers()['x-wujie-expected-actor-id'];
    received.push({ actor, body, request });
    const identity = JSON.stringify([actor, request.operationId]);
    if (!committed.has(identity)) {
      committed.add(identity);
      return route.fulfill({ status: 202, json: { success: false, status: 'unknown', operationId: request.operationId } });
    }
    return route.fulfill({ json: { success: true, status: 'committed', value: {
      projectId: request.projectId, workspaceId: request.workspaceId, operationId: request.operationId, parentVersionId: 'fixture-parent',
      tiles: request.targetNodeIds.map((nodeId, index) => ({ nodeId, cell: { index, columns: 2, rows: 1, column: index, row: 0,
        left: index, top: 0, width: 1, height: 2 }, reference: { assetId: `asset-${index}`, assetVersionId: `version-${index}`,
        placementId: `placement-${index}`, entityId: nodeId, url: `/api/serve-upload/tile-${index}.png`, kind: 'image' } })),
    } } });
  });
  return { received, committed };
}

it('reopens a closed editor with one durable grid operation and the original ordered request', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const { received, committed } = await offlineContext(context);
    const page = await context.newPage();
    await page.goto(origin);
    // Exercise a request that exceeds the usual Web Storage quota.
    await page.evaluate(() => window.gridFixture('fixture-actor', 'data:image/png;base64,' + 'A'.repeat(6 * 1024 * 1024)));
    expect(await page.evaluate(() => window.gridRun())).toMatchObject({ phase: 'unknown', applied: 0 });
    await page.evaluate(() => window.gridReset()); await page.close();

    const reopened = await context.newPage();
    await reopened.goto(origin);
    await reopened.evaluate(() => window.gridFixture('fixture-actor', 'data:image/png;base64,' + 'A'.repeat(6 * 1024 * 1024)));
    const recovered = await reopened.evaluate(() => window.gridRun());
    expect(received).toHaveLength(2);
    expect(received[1].body === received[0].body).toBe(true);
    expect(received[1].actor).toBe('fixture-actor');
    expect(committed.size).toBe(1);
    expect(recovered).toEqual({ phase: 'completed', applied: 1, nodes: ['fixture-source', ...received[0].request.targetNodeIds], edges: 2 });
  } finally { await context.close(); }
}, 30_000);

it('isolates saved grid requests by actor and leaves a changed source graph untouched', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const { received } = await offlineContext(context);
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(() => window.gridFixture('first-actor', '/fixture/original.png'));
    expect(await page.evaluate(() => window.gridRun())).toMatchObject({ phase: 'unknown', applied: 0 });
    await page.reload();
    await page.evaluate(() => window.gridFixture('second-actor', '/fixture/original.png'));
    expect(await page.evaluate(() => window.gridRun())).toMatchObject({ phase: 'unknown', applied: 0 });
    await page.reload();
    await page.evaluate(() => window.gridFixture('first-actor', '/fixture/replacement.png'));
    expect(await page.evaluate(() => window.gridRun())).toMatchObject({ phase: 'stale', applied: 0, edges: 0 });
    expect(received.map(({ actor }) => actor)).toEqual(['first-actor', 'second-actor', 'first-actor']);
    expect(received[1].request.operationId).not.toBe(received[0].request.operationId);
    expect(received[2].body).toBe(received[0].body);
  } finally { await context.close(); }
}, 30_000);

it('claims one operation when two editor instances start a split together', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const { received, committed } = await offlineContext(context);
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all(pages.map(async page => {
      await page.goto(origin);
      await page.evaluate(() => window.gridFixture('fixture-actor', '/fixture/source.png'));
    }));
    const outcomes = await Promise.all(pages.map(page => page.evaluate(() => window.gridRun())));
    expect(received).toHaveLength(2);
    expect(received[0].body).toBe(received[1].body);
    expect(committed.size).toBe(1);
    expect(outcomes.map(outcome => outcome.applied).sort()).toEqual([0, 1]);
  } finally { await context.close(); }
}, 30_000);
