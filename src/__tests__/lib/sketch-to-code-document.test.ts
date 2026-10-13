import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetVersion } from '@/lib/asset-core/types';
import { compileSketchHtml } from '@/lib/sketch-to-code/html';
import { parseSketchDocumentVersion, validateSketchDraft, readSketchDocument } from '@/lib/sketch-to-code/document';
import { createTaskBillingTransactionId } from '@/lib/credits';
import { quoteSketchTokenSettlement } from '@/lib/sketch-to-code/token-billing';
vi.mock('server-only', () => ({}));
const readPorts = vi.hoisted(() => ({ pool: vi.fn(), storage: vi.fn(), media: vi.fn() }));
vi.mock('@/lib/db-client', async original => ({ ...await original<typeof import('@/lib/db-client')>(), getPool: readPorts.pool }));
vi.mock('@/lib/asset-core/storage', async original => ({ ...await original<typeof import('@/lib/asset-core/storage')>(), createAssetStorageTransaction: readPorts.storage }));
vi.mock('@/lib/asset-core/managed-media-read', () => ({ readManagedAssetVersionBytes: readPorts.media }));
const uiTree = { type: 'text', text: '安全<&>草图' };
const html = compileSketchHtml(uiTree);
const analysis = { summary: '草图', layout: '单列', controls: [], text: ['安全<&>草图'] };
function styledTree(depth: number): unknown {
  let tree: unknown = { type: 'text', text: '边界<&>', style: { color: '#111827' } };
  for (let nodeDepth = 1; nodeDepth < depth; nodeDepth++) tree = { type: 'container', children: [tree] };
  return tree;
}
function version(): AssetVersion {
  return { id: 'v', assetId: 'a', ownerId: 'owner', projectId: 'p', taskId: 't', idempotencyKey: 'sketch:t:html',
    parentVersionIds: [], createdAt: '', file: { url: '/api/sketch-to-code/t/document', availability: 'ready', mimeType: 'text/html',
      byteSize: Buffer.byteLength(html), checksum: createHash('sha256').update(html).digest('hex') },
    metadata: { schemaId: 'sketch-code-html-v1', compilerVersion: 1, role: 'html', taskId: 't', actorUserId: 'actor',
      ownerId: 'owner', projectId: 'p', requestDigest: 'a'.repeat(64), uiTree, html, analysis } };
}

// Original reader, real permission/fence/Token verifier; only external SQL,
// asset store and managed-file ports are replaced. This is NOT live PG proof.
function readerFixture(token = false, document = false): {
  task: Record<string, unknown>; htmlVersion: AssetVersion; preview: AssetVersion; transactions: Record<string, unknown>[];
  queries: string[]; releases: boolean[]; editors: string[]; read: (actorUserId?: string) => ReturnType<typeof readSketchDocument>;
} {
  const png = createCanvas(8, 8).toBuffer('image/png'); const htmlVersion = version(); htmlVersion.metadata!.actorUserId = 'owner';
  const preview: AssetVersion = { id: 'pv', assetId: 'pa', ownerId: 'owner', projectId: 'p', taskId: 't', idempotencyKey: 'sketch:t:preview', parentVersionIds: [], createdAt: '',
    file: { url: '/api/serve-upload/fixture.png', mimeType: 'image/png', availability: 'ready', width: 8, height: 8, byteSize: png.length, checksum: createHash('sha256').update(png).digest('hex') },
    metadata: { schemaId: 'sketch-code-preview-v1', role: 'input-sketch', requestDigest: 'a'.repeat(64), actorUserId: 'owner', taskId: 't', ownerId: 'owner', projectId: 'p' } };
  const pricing = token ? { mode: 'token' as const, calls: 2 as const, perCallCredits: 7, totalCredits: 14, tokenPricing: { input: 1, output: 1 } } : { calls: 2 as const, perCallCredits: 7, totalCredits: 14 };
  const result: Record<string, unknown> = { sketchAdmission: { version: 1, route: '/api/sketch-to-code', requestDigest: 'a'.repeat(64), access: { kind: 'personal', actorUserId: 'owner', ownerId: 'owner', projectId: 'p' }, pricing },
    htmlAssetId: 'a', htmlAssetVersionId: 'v', previewAssetId: 'pa', previewAssetVersionId: 'pv', html, analysis };
  const task: Record<string, unknown> = { id: 't', user_id: 'owner', project_id: 'p', type: 'sketch-to-code', provider_id: 'p1', model: 'm1', status: 'completed', credit_status: 'charged', credit_cost: '14',
    request_digest: 'a'.repeat(64), idempotency_key: 'nonce', charged_transaction_id: createTaskBillingTransactionId('charge', 't'), refunded_transaction_id: '', result };
  if (document) {
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    (result.sketchAdmission as Record<string, unknown>).access = { kind: 'document', actorUserId: 'owner', ownerId: 'owner', projectId: 'p', grantGeneration: '0' };
  }
  const transactions: Record<string, unknown>[] = [];
  if (token) {
    const usage = { analysis: { inputTokens: 1, outputTokens: 1 }, reconstruction: { inputTokens: 1, outputTokens: 1 }, total: { inputTokens: 2, outputTokens: 2 } };
    const settlement = quoteSketchTokenSettlement('t', pricing, usage, String(task.charged_transaction_id));
    result.sketchTokenSettlement = structuredClone(settlement); htmlVersion.metadata!.sketchTokenSettlement = structuredClone(settlement); preview.metadata!.sketchTokenSettlement = structuredClone(settlement);
    transactions.push({ id: settlement.chargedTransactionId, user_id: 'owner', type: 'consume', amount: -14, balance_after: 86, model: 'm1', task_id: 't', reference_id: 't' },
      { id: settlement.adjustmentTransactionId, user_id: 'owner', type: 'refund', amount: 13, balance_after: 99, model: 'm1', task_id: 't', reference_id: 't' });
  }
  const queries: string[] = [], releases: boolean[] = [], editors = ['another-editor'];
  const client = { query: async (sql: string, values: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount?: number }> => {
    queries.push(sql);
    if (sql.includes('SELECT * FROM cloud_tasks')) return { rows: [task] };
    if (sql.includes('SELECT status FROM wujie_users')) return { rows: [{ status: 'active' }] };
    if (sql.includes('SELECT p.owner_id')) return { rows: [{ owner_id: 'owner', status: 'active', owner_status: 'active', enabled: document, has_document: document }] };
    if (sql.includes('SELECT grant_generation')) return { rows: editors.includes(String(values[2])) ? [{ grant_generation: '3' }] : [] };
    if (sql.includes('SELECT 1 FROM wujie_project_document_editors')) return { rows: [{}], rowCount: editors.includes(String(values[2])) && values[3] === '3' ? 1 : 0 };
    if (sql.includes('SELECT enabled FROM wujie_project_document_settings')) return { rows: [{ enabled: document }] };
    if (sql.includes("current_setting('lock_timeout')")) return { rows: [{ lock_timeout: '5s', statement_timeout: '10s' }] };
    if (sql.includes('SELECT balance,total_used')) return { rows: [{ balance: 99, total_used: 1 }] };
    if (sql.includes('FROM wujie_credit_transactions')) return { rows: transactions };
    return { rows: [] };
  }, release: (discard = false): void => { releases.push(discard); } };
  readPorts.pool.mockReturnValue({ connect: async () => client });
  readPorts.storage.mockReturnValue({ findVersion: async (_owner: string, _project: string, id: string) => id === 'v' ? htmlVersion : id === 'pv' ? preview : null,
    findAsset: async (_owner: string, _project: string, id: string) => ({ id, status: 'active', kind: id === 'a' ? 'document' : 'image', currentVersionId: id === 'a' ? 'v' : 'pv' }) });
  readPorts.media.mockResolvedValue({ bytes: png });
  return { task, htmlVersion, preview, transactions, queries, releases, editors, read: (actorUserId = 'owner') => readSketchDocument({ actorUserId, projectId: 'p', taskId: 't' }) };
}
afterEach(() => { vi.unstubAllEnvs(); });
describe('HTTP projection from the original authorized reader transaction', () => {
  it('another current document editor reads without becoming task owner or requiring the old lease', async () => {
    const f = readerFixture(true, true); f.task.lease_owner = ''; f.task.lease_expires_at = '0';
    expect(await f.read('another-editor')).toMatchObject({ taskId: 't', html, actualCredits: 1 });
    expect(f.queries.at(-1)).toBe('COMMIT'); expect(f.queries.some(sql => sql.includes('SELECT 1 FROM wujie_project_document_editors'))).toBe(true);
  });
  it.each(['viewer', 'stranger', 'another-editor'])('current %s without an active editor grant cannot read refs or HTML', async actor => {
    const f = readerFixture(false, true); f.editors.length = 0;
    await expect(f.read(actor)).rejects.toThrow('SKETCH_DOCUMENT_UNAVAILABLE'); expect(f.queries.at(-1)).toBe('ROLLBACK');
  });
  it.each([false, true])('returns same verified refs/binding/bytes and flat or Token net cost (token=%s)', async token => {
    const f = readerFixture(token); const content = await f.read();
    expect(content).toMatchObject({ previewAssetId: 'pa', htmlAssetId: 'a', previewAssetVersionId: 'pv', htmlAssetVersionId: 'v', providerId: 'p1', modelId: 'm1', reserveCredits: 14, actualCredits: token ? 1 : 14, documentUrl: '/api/sketch-to-code/t/document' });
    expect(content.bytes).toEqual(Buffer.from(content.html)); expect(Object.isFrozen(content)).toBe(true); expect(Object.isFrozen(content.pricing)).toBe(true);
    expect(JSON.stringify(content)).not.toMatch(/grantGeneration|chargedTransactionId|adjustmentTransactionId|sketchAdmission|inputTokens|image\/png/);
    expect(f.queries.at(-1)).toBe('COMMIT'); expect(f.queries.some(q => q.includes('FOR SHARE OF v,a'))).toBe(true); expect(f.releases).toEqual([false]);
  });
  it.each(['flat-credit', 'pricing', 'binding', 'token-task', 'token-preview', 'token-html', 'ledger', 'preview-checksum', 'html-tamper', 'full-refund'] as const)('rejects %s without a projection', async variant => {
    const f = readerFixture(variant.startsWith('token') || variant === 'ledger'); const result = f.task.result as Record<string, unknown>;
    if (variant === 'flat-credit') f.task.credit_cost = '15'; if (variant === 'pricing') (result.sketchAdmission as Record<string, unknown>).pricing = { calls: 2 };
    if (variant === 'binding') f.task.provider_id = ''; if (variant === 'full-refund') f.task.refunded_transaction_id = 'refund';
    if (variant === 'preview-checksum') f.preview.file.checksum = 'b'.repeat(64); if (variant === 'html-tamper') result.html = '<script>tamper</script>';
    if (variant === 'token-task') (result.sketchTokenSettlement as Record<string, unknown>).actualCredits = 14;
    if (variant === 'token-preview') (f.preview.metadata!.sketchTokenSettlement as Record<string, unknown>).actualCredits = 14;
    if (variant === 'token-html') (f.htmlVersion.metadata!.sketchTokenSettlement as Record<string, unknown>).actualCredits = 14;
    if (variant === 'ledger') f.transactions.pop();
    await expect(f.read()).rejects.toThrow('SKETCH_DOCUMENT_UNAVAILABLE'); expect(f.queries.at(-1)).toBe('ROLLBACK');
  });
});
describe('logical sketch HTML is verifiable compilation, never arbitrary HTML', () => {
  it.each(['analysis-only', 'reconstruction-only', 'all-null'] as const)('usage validates %s missing phase data without a guessed aggregate', variant => {
    const usage = { analysis: variant === 'analysis-only' ? { inputTokens: 0, outputTokens: 0 } : null,
      reconstruction: variant === 'reconstruction-only' ? { inputTokens: 3, outputTokens: 4 } : null, total: null };
    expect(validateSketchDraft({ uiTree, html, analysis, usage })).toHaveProperty('usage', usage);
  });
  it.each([undefined, null, {}, { analysis: null, reconstruction: null, total: { inputTokens: 0, outputTokens: 0 } },
    { analysis: { inputTokens: 1, outputTokens: 2 }, reconstruction: { inputTokens: 3, outputTokens: 4 }, total: { inputTokens: 5, outputTokens: 6 } },
    { analysis: { inputTokens: '1', outputTokens: 2 }, reconstruction: null, total: null }])('usage rejects invalid server draft usage %j', usage => {
    expect(() => validateSketchDraft({ uiTree, html, analysis, usage })).toThrow('SKETCH_DOCUMENT_UNAVAILABLE');
  });
  it.each(['outer', 'phase', 'count', 'toJSON'] as const)('usage never executes %s accessor or serialization hook', variant => {
    let invoked = 0;
    const usage = { analysis: { inputTokens: 1, outputTokens: 2 }, reconstruction: null, total: null };
    const draft = { uiTree, html, analysis, usage };
    if (variant === 'outer') Object.defineProperty(draft, 'usage', { get: () => { invoked++; return usage; } });
    else if (variant === 'phase') Object.defineProperty(usage, 'analysis', { get: () => { invoked++; return {}; } });
    else if (variant === 'count') Object.defineProperty(usage.analysis, 'inputTokens', { get: () => { invoked++; return 1; } });
    else Object.assign(usage, { toJSON: () => { invoked++; return usage; } });
    expect(() => validateSketchDraft(draft)).toThrow('SKETCH_DOCUMENT_UNAVAILABLE'); expect(invoked).toBe(0);
  });
  it('usage cannot turn altered HTML into compiler provenance', () => {
    const usage = { analysis: { inputTokens: 0, outputTokens: 0 }, reconstruction: null, total: null };
    expect(() => validateSketchDraft({ uiTree, html: html + '<script>bad</script>', analysis, usage })).toThrow('SKETCH_DOCUMENT_UNAVAILABLE');
  });
  it('usage validates original prototypes before the JSON copy can erase them', () => {
    const inherited = Object.create({ inputTokens: 1, outputTokens: 2 }) as unknown;
    const arrayPrototype = Object.assign(Object.create(Array.prototype) as Record<string, unknown>, { inputTokens: 1, outputTokens: 2 });
    for (const phase of [inherited, arrayPrototype]) {
      expect(() => validateSketchDraft({ uiTree, html, analysis, usage: { analysis: phase, reconstruction: null, total: null } })).toThrow('SKETCH_DOCUMENT_UNAVAILABLE');
    }
  });

  it('usage survives the execution clone and validation seam as owned frozen data with exact HTML', () => {
    const usage = { analysis: { inputTokens: 101, outputTokens: 17 }, reconstruction: { inputTokens: 203, outputTokens: 29 }, total: { inputTokens: 304, outputTokens: 46 } };
    const snapshot = structuredClone({ uiTree, html, analysis, usage });
    const draft = validateSketchDraft(snapshot);
    expect(draft).toHaveProperty('usage', usage); expect(draft.html).toBe(html);
    snapshot.usage.analysis.inputTokens = 999; snapshot.usage.total.inputTokens = 999;
    expect(draft).toHaveProperty('usage.total', { inputTokens: 304, outputTokens: 46 });
    const result = (draft as unknown as { usage: typeof usage }).usage;
    expect([result, result.analysis, result.reconstruction, result.total].every(Object.isFrozen)).toBe(true);
    expect(parseSketchDocumentVersion(version()).bytes.equals(Buffer.from(html))).toBe(true);
  });

  it('preserves compiler depth12 styled leaf bytes through draft and persisted metadata envelopes', () => {
    const source = styledTree(12), compiled = compileSketchHtml(source);
    expect(compiled).toContain('<p style="color:#111827">边界&lt;&amp;&gt;</p>');
    const draft = validateSketchDraft({ uiTree: source, html: compiled, analysis });
    expect(draft.html).toBe(compiled); expect(Object.isFrozen(draft.uiTree)).toBe(true);
    const v = version();
    Object.assign(v.metadata!, { uiTree: source, html: compiled });
    v.file.byteSize = Buffer.byteLength(compiled); v.file.checksum = createHash('sha256').update(compiled).digest('hex');
    expect(parseSketchDocumentVersion(v).bytes.equals(Buffer.from(compiled))).toBe(true);
  });
  it('still rejects adjacent depth13 styled leaves at the original compiler boundary', () => {
    const source = styledTree(13);
    expect(() => compileSketchHtml(source)).toThrow('SKETCH_UI_TREE_LIMIT');
    expect(() => validateSketchDraft({ uiTree: source, html, analysis })).toThrow('SKETCH_DOCUMENT_UNAVAILABLE');
    const v = version(); v.metadata!.uiTree = source;
    expect(() => parseSketchDocumentVersion(v)).toThrow('SKETCH_DOCUMENT_UNAVAILABLE');
  });
  it('recompiles the source and returns identical UTF8 preview/download bytes', () => {
    const result = parseSketchDocumentVersion(version());
    expect(result.bytes.equals(Buffer.from(html))).toBe(true);
    expect(result.html).toContain('<p>安全&lt;&amp;&gt;草图</p>');
    expect(result.analysis).toEqual(analysis);
  });
  it('keeps Token billing usage out of the compiled document byte stream', () => {
    const v = version();
    v.metadata!.sketchTokenSettlement = { version: 1, reserveCredits: 14, actualCredits: 1, deltaCredits: -13,
      chargedTransactionId: 'charge', adjustmentTransactionId: 'refund',
      usage: { analysis: { inputTokens: 1, outputTokens: 1 }, reconstruction: { inputTokens: 1, outputTokens: 1 }, total: { inputTokens: 2, outputTokens: 2 } } };
    expect(parseSketchDocumentVersion(v).bytes.equals(Buffer.from(html))).toBe(true);
    expect(parseSketchDocumentVersion(v).html).not.toContain('inputTokens');
  });
  it('detaches and deeply freezes the validated source and analysis', () => {
    const value = structuredClone({ uiTree, html, analysis }); const result = validateSketchDraft(value);
    value.uiTree.text = 'changed'; value.analysis.text.push('changed');
    expect(result.uiTree).toEqual(uiTree); expect(result.analysis.text).toEqual(['安全<&>草图']);
    expect(Object.isFrozen(result.uiTree)).toBe(true); expect(Object.isFrozen(result.analysis.text)).toBe(true);
  });
  it('rejects stored accessors without executing them', () => {
    const v = version(); let executed = false;
    Object.defineProperty(v.metadata, 'html', { enumerable: true, get: () => { executed = true; return html; } });
    expect(() => parseSketchDocumentVersion(v)).toThrow('SKETCH_DOCUMENT_UNAVAILABLE');
    expect(executed).toBe(false);
  });
  it.each(['missing', 'script', 'style', 'large', 'deep', 'different', 'analysis'] as const)('rejects %s source or delivery', change => {
    const value: Record<string, unknown> = structuredClone({ uiTree, html, analysis });
    if (change === 'missing') delete value.uiTree;
    if (change === 'script') value.uiTree = { type: 'script', text: 'alert(1)' };
    if (change === 'style') value.uiTree = { type: 'text', text: '', style: { backgroundColor: 'url(https://secret)' } };
    if (change === 'large') value.uiTree = { type: 'text', text: 'x'.repeat(65537) };
    if (change === 'deep') { let node: unknown = uiTree; for (let i = 0; i < 13; i++) node = { type: 'container', children: [node] }; value.uiTree = node; }
    if (change === 'different') value.html = html + '<script>bad</script>';
    if (change === 'analysis') value.analysis = { summary: '', layout: '', controls: [], text: [] };
    expect(() => validateSketchDraft(value)).toThrow('SKETCH_DOCUMENT_UNAVAILABLE');
  });
  it.each(['checksum', 'mime', 'bytes', 'schema', 'compiler', 'source', 'html', 'owner', 'task', 'url', 'availability'] as const)(
    'rejects persisted %s tampering even with otherwise valid content', change => {
      const v = structuredClone(version());
      if (change === 'checksum') v.file.checksum = 'b'.repeat(64);
      if (change === 'mime') v.file.mimeType = 'application/json';
      if (change === 'bytes') v.file.byteSize!++;
      if (change === 'schema') v.metadata!.schemaId = 'other';
      if (change === 'compiler') v.metadata!.compilerVersion = 2;
      if (change === 'source') delete v.metadata!.uiTree;
      if (change === 'html') { v.metadata!.html = '<script>bad</script>'; v.file.byteSize = 20; v.file.checksum = createHash('sha256').update('<script>bad</script>').digest('hex'); }
      if (change === 'owner') v.ownerId = 'other';
      if (change === 'task') v.taskId = 'other';
      if (change === 'url') v.file.url = '/api/serve-upload/arbitrary.html';
      if (change === 'availability') v.file.availability = 'missing';
      expect(() => parseSketchDocumentVersion(v)).toThrow('SKETCH_DOCUMENT_UNAVAILABLE');
    });
});
