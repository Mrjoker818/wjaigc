import { readFileSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import ts from 'typescript';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

// Scope inherited DB bindings before imports and module-level guard snapshots.
await vi.hoisted(async () => {
  const { afterAll } = await import('vitest');
  const { scopeOfflineDatabaseEnvironment } = await import('../helpers/isolated-child-database-env');
  const restore = scopeOfflineDatabaseEnvironment(process.env);
  try {
    afterAll(restore);
  } catch (error) {
    restore();
    throw error;
  }
});

// Actual route regression for failure, refund acknowledgement and terminal conflicts.
// Real HTTP handler, 302 adapter/parser and error translator; all external effects are synthetic.
const boundary = vi.hoisted(() => {
  const forbidden = vi.fn((): never => { throw new Error('IMAGE_EDIT_REGRESSION_EXTERNAL_EFFECT_FORBIDDEN'); });
  vi.stubGlobal('fetch', forbidden);
  return { forbidden, auth: vi.fn(), access: vi.fn(), source: vi.fn(), plan: vi.fn(),
    charge: vi.fn(), refund: vi.fn(), provider: vi.fn(), log: vi.fn(),
    taskPersist: vi.fn(), taskRead: vi.fn(), terminal: vi.fn(), transport: vi.fn() };
});
vi.mock('server-only', () => ({}));
vi.mock('pg', () => { throw new Error('IMAGE_EDIT_REGRESSION_PG_IMPORT_FORBIDDEN'); });
vi.mock('@/lib/db-client', () => ({ getPool: boundary.forbidden, execSql: boundary.forbidden,
  query: boundary.forbidden, withTransaction: boundary.forbidden }));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: boundary.auth }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: boundary.forbidden,
  listManagedUsers: boundary.forbidden, getAuthSecretForInternalRequests: boundary.forbidden }));
vi.mock('@/lib/collaboration/generation-project-access', async original => ({
  ...await original<typeof import('@/lib/collaboration/generation-project-access')>(),
  authorizeGenerationProject: boundary.access,
}));
vi.mock('@/lib/collaboration/image-edit-source-admission', async original => ({
  ...await original<typeof import('@/lib/collaboration/image-edit-source-admission')>(),
  authorizeDocumentImageEditSource: boundary.source,
}));
vi.mock('@/lib/task-core/image-edit-model-plan', async original => ({
  ...await original<typeof import('@/lib/task-core/image-edit-model-plan')>(),
  prepareImageEditModelPlan: boundary.plan,
}));
vi.mock('@/lib/credits', async original => ({ ...await original<typeof import('@/lib/credits')>(),
  consumeCredits: boundary.charge, refundCredits: boundary.refund,
  calculateConfiguredCreditCost: boundary.forbidden,
}));
vi.mock('@/lib/image-edit-provider', async original => ({
  ...await original<typeof import('@/lib/image-edit-provider')>(),
  submitImageTask: boundary.forbidden, autoTrySubmitImageTask: boundary.provider,
}));
vi.mock('@/lib/cloud-task-persistence', () => ({ recordImageTaskSubmitted: boundary.taskPersist,
  recordImageTaskTerminal: boundary.forbidden, projectPersistedCompletedTask: boundary.forbidden }));
vi.mock('@/lib/task-core/billing-service', () => ({ createBillableTask: boundary.forbidden,
  settleFailedTask: boundary.forbidden }));
vi.mock('@/lib/cloud-task-storage', async original => ({
  ...await original<typeof import('@/lib/cloud-task-storage')>(),
  completeCloudTask: boundary.forbidden, terminateCloudTaskAndRefund: boundary.terminal,
  getCloudTaskForUser: boundary.taskRead, getCloudTaskForUserByIdempotencyKey: boundary.forbidden,
  claimCloudTaskLease: boundary.forbidden, releaseCloudTaskLease: boundary.forbidden,
}));
vi.mock('@/lib/fetch-image-buffer', async original => ({
  ...await original<typeof import('@/lib/fetch-image-buffer')>(),
  fetchImageBuffer: async (url: string) => {
    if (!url.startsWith('data:image/png;base64,')) return boundary.forbidden();
    return Buffer.from(url.split(',')[1], 'base64');
  },
}));
vi.mock('fs/promises', async original => {
  const actual = await original<typeof import('fs/promises')>();
  const writes = { writeFile: boundary.forbidden, mkdir: boundary.forbidden, copyFile: boundary.forbidden };
  return { ...actual, ...writes, default: { ...actual, ...writes } };
});
vi.mock('@/lib/server-data-root', () => ({ saveImageFile: boundary.forbidden,
  getServerDataRoot: () => '/offline', getServerSystemDir: () => '/offline/system',
  isServerDataRootDurable: () => false }));
vi.mock('@/lib/s3-storage', () => ({ isS3Available: () => false,
  uploadImageToS3: boundary.forbidden, persistRemoteImage: boundary.forbidden }));
vi.mock('@/lib/asset-core/binary-persistence', () => ({ persistAssetBytes: boundary.forbidden }));
vi.mock('@/lib/task-registry', () => ({ registerTask: boundary.forbidden,
  updateTaskProgress: boundary.forbidden, isTaskCancelled: () => false }));
vi.mock('@/lib/op-log', () => ({ logError: boundary.log, logOperation: boundary.log,
  OP_ACTIONS: { IMAGE_EDIT: 'image_edit' }, startTimer: () => ({ end: () => 0 }) }));

import { POST } from '@/app/api/image-edit/route';
import { ImageEditSourceAdmissionError } from '@/lib/collaboration/image-edit-source-admission';

const actor = { id: 'offline-review-actor', name: 'Offline', role: 'user', status: 'active' };
const privateMarker = 'synthetic-private-image-edit-detail';
const providerRejectionBody = JSON.stringify({ error: '供应商失败', token: privateMarker });
const providerRejectionMessage = `302.AI 放大失败: ${providerRejectionBody}`;
const references = new Set<string>();
let imageUrl: string;
let balance: number;
let refunds: Array<{ reference: string; amount: number }>;

function plan(requested: string, candidateModel = requested) {
  const provider = { id: 'offline', type: 'upscaler', modelType: 'upscaler', isEnabled: true,
    selectedModels: [candidateModel], baseUrl: 'https://provider.invalid/v1', apiKey: 'synthetic-key' };
  return { requestedModelId: requested, requestedProviderId: '', explicit: false,
    candidates: [{ providerId: 'offline', model: candidateModel, apiKey: provider.apiKey,
      apiBaseUrl: provider.baseUrl, source: 'admin-auto', providerType: 'upscaler', provider }],
    dedicatedRemoveBgCandidates: [], visionCandidates: [] };
}
function request(extra: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/image-edit', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'upscale', imageUrl, scale: 2, ...extra }) });
}
function unknownRefund(receipt: 'throw' | 'false') {
  boundary.refund.mockImplementation(async (_userId: string, amount: number, _reason: string, reference: string) => {
    expect(reference).toMatch(/^refund-image-edit-[0-9a-f-]{36}$/);
    // Synthetic ledger applies before its acknowledgement is lost. No real ledger is imported/called.
    if (!refunds.some(row => row.reference === reference)) {
      refunds.push({ reference, amount }); balance += amount;
    }
    if (receipt === 'throw') throw new Error(`退款回执丢失 ${privateMarker}`);
    return { success: false, balance: 0 };
  });
}
async function assertUnknownResponse(response: Response, prefix: string) {
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body).toEqual({ success: false, error: '服务暂时出错，请稍后重试或切换模型' });
  expect(JSON.stringify(body)).not.toContain(privateMarker);
  expect(body).not.toMatchObject({ refunded: true });
  expect(boundary.charge).toHaveBeenCalledTimes(1);
  expect(boundary.refund).toHaveBeenCalledTimes(1);
  expect(boundary.terminal).not.toHaveBeenCalled();
  expect(boundary.taskPersist).not.toHaveBeenCalled();
  expect(boundary.taskRead).not.toHaveBeenCalled();
  const args = boundary.refund.mock.calls[0];
  expect(args[0]).toBe(actor.id); expect(args[1]).toBe(7); expect(args[2]).toContain(prefix);
  expect(refunds).toEqual([{ reference: args[3], amount: 7 }]);
  expect(balance).toBe(100);
  expect(references.has(args[3])).toBe(false); references.add(args[3]);
  console.info('IMAGE_EDIT_HANDLER_BOUNDARY_OBSERVED', JSON.stringify({ prefix, status: response.status,
    error: body.error, refundCalls: boundary.refund.mock.calls.length, appliedSyntheticRefunds: refunds.length,
    balance, reference: args[3] }));
}

beforeAll(async () => {
  // Inspect all three actual refund call sites without copying their implementation.
  const filename = path.resolve('src/app/api/image-edit/route.ts');
  const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const calls: ts.CallExpression[] = []; const declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'refundCredits') calls.push(node);
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'refundReference') declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(calls).toHaveLength(3);
  expect(calls.map(call => call.arguments[3]?.getText(source))).toEqual(Array(3).fill('refundReference'));
  expect(declarations).toHaveLength(1);
  expect(declarations[0].initializer?.getText(source)).toBe('`refund-image-edit-${randomUUID()}`');
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#456789' } }).png().toBuffer();
  imageUrl = `data:image/png;base64,${png.toString('base64')}`;
});
beforeEach(() => {
  expect(Object.keys(process.env).filter(key => /^(PG|DATABASE|POSTGRES|TEST_POSTGRES|COZE_SUPABASE)|^WUJIE_.*DB|^WUJIE_AUTH_PERSISTENCE_MODE$/.test(key))).toEqual([]);
  vi.clearAllMocks(); balance = 100; refunds = [];
  for (const dependency of [boundary.provider, boundary.taskPersist, boundary.taskRead, boundary.terminal, boundary.transport]) {
    dependency.mockReset().mockImplementation(boundary.forbidden);
  }
  vi.stubEnv('WUJIE_TASK_CORE_MODE', 'legacy');
  vi.stubGlobal('fetch', boundary.forbidden);
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(boundary.forbidden);
  vi.spyOn(tls, 'connect').mockImplementation(boundary.forbidden);
  boundary.auth.mockResolvedValue({ userId: actor.id, user: actor, source: 'cookie' });
  boundary.access.mockResolvedValue({ kind: 'unscoped', actorUserId: actor.id });
  boundary.source.mockImplementation(async ({ imageUrl: input }: { imageUrl: string }) => input);
  boundary.plan.mockResolvedValue(plan('Real-ESRGAN'));
  boundary.charge.mockImplementation(async () => { balance -= 7; return { success: true, cost: 7 }; });
  unknownRefund('throw');
});
afterEach(() => {
  try {
    expect(boundary.forbidden).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  }
});

it.each([
  ['Chinese JSON', JSON.stringify({ error: '供应商失败', detail: privateMarker }), 'throw'],
  ['mixed URL text', `上游异常 https://provider.invalid/private?token=${privateMarker}`, 'false'],
] as const)('outer HTTP catch hides %s and makes one refund attempt despite an unknown receipt', async (_label, raw, receipt) => {
  boundary.plan.mockResolvedValue(plan('gpt-image-1'));
  boundary.provider.mockRejectedValue(new Error(raw));
  unknownRefund(receipt);
  const response = await POST(request({ action: 'multi_angle', rotation: 30 }));
  await assertUnknownResponse(response, '图像编辑异常退款');
  expect(boundary.provider).toHaveBeenCalledTimes(2); // Existing endpoint fallback, both are synthetic.
  expect(boundary.log).toHaveBeenCalled();
});

it('legacy requested-302 failure with a lost refund acknowledgement cannot refund again in the outer catch', async () => {
  // An automatic plan has only an admitted non-302 candidate. The real handler rejects the unsatisfied
  // requested-302 selection before provider dispatch and takes its legacy settlement branch.
  boundary.plan.mockResolvedValue(plan('302-esrgan', 'Real-ESRGAN'));
  unknownRefund('false');
  const response = await POST(request({ upscaleModel: '302-esrgan' }));
  await assertUnknownResponse(response, '302.AI 超分失败退款');
  expect(boundary.provider).not.toHaveBeenCalled();
});

it('post-charge document-source denial with a lost refund acknowledgement cannot refund again in the outer catch', async () => {
  boundary.access.mockResolvedValue({ kind: 'document', actorUserId: actor.id,
    ownerId: actor.id, projectId: 'offline-project', grantGeneration: '0' });
  let checks = 0;
  boundary.source.mockImplementation(async ({ imageUrl: input }: { imageUrl: string }) => {
    if (++checks === 3) throw new ImageEditSourceAdmissionError(403, 'IMAGE_EDIT_SOURCE_MISMATCH');
    return input;
  });
  const response = await POST(request({ projectId: 'offline-project', upscaleModel: 'Real-ESRGAN' }));
  await assertUnknownResponse(response, '文档来源复验失败退款');
  expect(checks).toBe(3);
  expect(boundary.provider).not.toHaveBeenCalled();
});

it('does not expose Chinese provider JSON through the successful task-refund response', async () => {
  const exactPlan = plan('302-esrgan');
  exactPlan.candidates[0].apiBaseUrl = 'https://api.302.ai';
  exactPlan.candidates[0].provider.baseUrl = 'https://api.302.ai';
  boundary.plan.mockResolvedValue(exactPlan);
  boundary.taskPersist.mockResolvedValue(true);
  boundary.taskRead.mockResolvedValue({ status: 'processing', result: {} });
  boundary.terminal.mockResolvedValue({ transitioned: true, refunded: true });
  boundary.transport.mockImplementation(async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://api.302.ai/302/submit/esrgan');
    expect(init?.method).toBe('POST');
    return new Response(providerRejectionBody,
      { status: 422, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', boundary.transport);
  const response = await POST(request({ upscaleModel: '302-esrgan' }));
  const body = await response.json();
  console.info('IMAGE_EDIT_DIRECT_SETTLEMENT_EXIT_OBSERVED', JSON.stringify({ status: response.status,
    body, taskRefundCalls: boundary.terminal.mock.calls.length, legacyRefundCalls: boundary.refund.mock.calls.length }));
  expect(boundary.transport).toHaveBeenCalledTimes(1);
  expect(boundary.taskPersist).toHaveBeenCalledTimes(1);
  expect(boundary.terminal).toHaveBeenCalledTimes(1);
  expect(boundary.refund).not.toHaveBeenCalled();
  expect(boundary.charge).toHaveBeenCalledTimes(1);
  const persisted = boundary.taskPersist.mock.calls[0][0];
  expect(persisted).toMatchObject({ userId: actor.id, type: 'upscale', creditCost: 7 });
  expect(boundary.terminal).toHaveBeenCalledWith(
    persisted.taskId,
    'failed',
    providerRejectionMessage,
    undefined,
    { requireActive: true },
  ); // Internal settlement retains the original provider detail.
  expect(response.status).toBe(422);
  expect(body).toMatchObject({ success: false, error: '服务暂时出错，请稍后重试或切换模型',
    code: 'UPSCALE_PROVIDER_REJECTED', providerStatus: 422, providerCode: null,
    retryable: false, refunded: true, taskId: persisted.taskId });
  expect(JSON.stringify(body)).not.toContain(privateMarker);
});

it('does not expose Chinese provider JSON through the terminal-conflict task-refund response', async () => {
  const exactPlan = plan('302-esrgan');
  exactPlan.candidates[0].apiBaseUrl = 'https://api.302.ai';
  exactPlan.candidates[0].provider.baseUrl = 'https://api.302.ai';
  boundary.plan.mockResolvedValue(exactPlan);
  boundary.taskPersist.mockResolvedValue(true);
  let settlementAttempted = false;
  const observedOrder: string[] = [];
  boundary.taskRead.mockImplementation(async () => {
    const status = settlementAttempted ? 'cancelled' : 'processing';
    observedOrder.push(`read:${status}`);
    return { status, result: {} };
  });
  boundary.terminal.mockImplementation(async () => {
    // The task wins a terminal transition elsewhere between the earlier read and this attempt.
    // This request neither transitions nor refunds it. No real settlement/DB is invoked.
    observedOrder.push('settle:failed');
    settlementAttempted = true;
    return { transitioned: false, refunded: false };
  });
  boundary.transport.mockImplementation(async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://api.302.ai/302/submit/esrgan');
    expect(init?.method).toBe('POST');
    return new Response(providerRejectionBody,
      { status: 422, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', boundary.transport);
  const response = await POST(request({ upscaleModel: '302-esrgan' }));
  const body = await response.json();
  console.info('IMAGE_EDIT_CONFLICT_EXIT_OBSERVED', JSON.stringify({ status: response.status,
    body, taskSettlementCalls: boundary.terminal.mock.calls.length,
    legacyRefundCalls: boundary.refund.mock.calls.length }));
  expect(boundary.transport).toHaveBeenCalledTimes(1);
  expect(boundary.taskPersist).toHaveBeenCalledTimes(1);
  expect(boundary.charge).toHaveBeenCalledTimes(1);
  expect(boundary.terminal).toHaveBeenCalledTimes(1);
  expect(boundary.refund).not.toHaveBeenCalled();
  const persisted = boundary.taskPersist.mock.calls[0][0];
  expect(persisted).toMatchObject({ userId: actor.id, type: 'upscale', creditCost: 7 });
  expect(boundary.terminal).toHaveBeenCalledWith(
    persisted.taskId,
    'failed',
    providerRejectionMessage,
    undefined,
    { requireActive: true },
  );
  expect(boundary.taskRead).toHaveBeenLastCalledWith(persisted.taskId, actor.id);
  expect(observedOrder).toEqual(['read:processing', 'settle:failed', 'read:cancelled']);
  expect(response.status).toBe(409);
  expect(body).toMatchObject({ success: false, error: '服务暂时出错，请稍后重试或切换模型',
    code: 'TASK_TERMINAL_CONFLICT', providerStatus: 409, providerCode: null,
    retryable: false, refunded: false, taskId: persisted.taskId, status: 'cancelled' });
  expect(JSON.stringify(body)).not.toContain(privateMarker);
});
