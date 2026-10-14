import { createHash } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { AssetVersion, Asset } from '@/lib/asset-core/types';
import type { AssetStorageTransaction } from '@/lib/asset-core/storage';
import type { SketchImageTaskRow } from '@/lib/sketch-to-code/image-task-state';
import { readSketchImageResult, type SketchImageResultDependencies } from '@/lib/sketch-to-code/image-result';
import { sketchImageRequestDigest } from '@/lib/sketch-to-code/image-admission';
import { quoteSketchImageSettlement, type SketchImagePricing } from '@/lib/sketch-to-code/image-pricing';
import { createTaskBillingTransactionId } from '@/lib/credits';
vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllEnvs());
function fixture(free = false): { row: SketchImageTaskRow; input: AssetVersion; output: AssetVersion; assets: Asset[];
  media: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn>; queries: string[]; release: ReturnType<typeof vi.fn>; dependencies: SketchImageResultDependencies;
  transactions: Record<string, unknown>[]; read: (actorUserId?: string) => ReturnType<typeof readSketchImageResult> } {
  vi.stubEnv('WUJIE_YJS_ENABLED','true');
  const png = createCanvas(8,8).toBuffer('image/png'), outputPng = createCanvas(9,9).toBuffer('image/png');
  const source = { projectId: 'p', imageDataUrl: 'data:image/png;base64,'+png.toString('base64'), instruction: '木屋', visionProviderId: 'vp', visionModelId: 'vm',
    imageProviderId: 'ip', imageModelId: 'im', idempotencyKey: 'nonce', aspectRatio: '1:1' };
  const pricing = { version: 1 as const, vision: { providerId: 'vp', modelId: 'vm', calls: 1 as const, mode: 'flat' as const, reserveCredits: free?0:7 },
    image: { providerId: 'ip', modelId: 'im', calls: 1 as const, credits: free?0:11 }, totalReserveCredits: free?0:18 };
  const analysis = { summary: '木屋', composition: '左侧木屋', prompt: '水彩木屋', negativePrompt: '水印' }, charge = free ? null : createTaskBillingTransactionId('charge','skimg_r');
  const settlement = { ...quoteSketchImageSettlement(pricing), chargedTransactionId: charge, adjustmentTransactionId: null };
  const digest = sketchImageRequestDigest(source), shared = { taskId: 'skimg_r', actorUserId: 'actor', ownerId: 'owner', projectId: 'p', requestDigest: digest,
    visionProviderId: 'vp', visionModelId: 'vm', imageProviderId: 'ip', imageModelId: 'im', analysis, sketchImageSettlement: settlement };
  const input: AssetVersion = { id: 'iv', assetId: 'ia', ownerId: 'owner', projectId: 'p', taskId: 'skimg_r', createdAt: '', parentVersionIds: [], idempotencyKey: 'sketch-image:skimg_r:input',
    file: { url: '/api/serve-upload/input.png', mimeType: 'image/png', availability: 'ready', width: 8, height: 8, byteSize: png.length, checksum: createHash('sha256').update(png).digest('hex') },
    metadata: structuredClone({ ...shared, schemaId: 'sketch-image-input-v1', role: 'input-sketch' }) };
  const output: AssetVersion = { id: 'ov', assetId: 'oa', ownerId: 'owner', projectId: 'p', taskId: 'skimg_r', createdAt: '', parentVersionIds: ['iv'], idempotencyKey: 'sketch-image:skimg_r:output',
    file: { url: '/api/serve-upload/output.png', mimeType: 'image/png', availability: 'ready', width: 9, height: 9, byteSize: outputPng.length, checksum: createHash('sha256').update(outputPng).digest('hex') },
    metadata: structuredClone({ ...shared, schemaId: 'sketch-image-output-v1', role: 'generated-image' }) };
  const row: SketchImageTaskRow = { id: 'skimg_r', user_id: 'actor', project_id: 'p', type: 'sketch-to-image', provider_id: 'ip', model: 'im', request_digest: digest,
    idempotency_key: 'nonce', status: 'completed', credit_cost: free?0:18, credit_status: free?'not-applicable':'charged', charged_transaction_id: charge, refunded_transaction_id: null,
    lease_owner: '', lease_expires_at: 0, attempt_count: 1, result: { sketchImageAdmission: { version: 1, route: '/api/sketch-to-image', requestDigest: digest, input: source, pricing,
      access: { kind: 'document', actorUserId: 'actor', ownerId: 'owner', projectId: 'p', grantGeneration: '1' } },
      sketchImageExecution: { version: 1, phase: 'accepted', routing: { vision: '1'.repeat(64), image: '2'.repeat(64) }, analysis,
        receipt: { taskIds: ['remote'], directImageUrls: [], usedModel: 'im', usedProviderId: 'ip' } }, analysis, sketchImageSettlement: structuredClone(settlement),
      previewAssetId: 'ia', previewAssetVersionId: 'iv', imageAssetId: 'oa', imageAssetVersionId: 'ov' } };
  const assets: Asset[] = [{ id: 'ia', ownerId: 'owner', projectId: 'p', kind: 'image', status: 'active', currentVersionId: 'iv', createdAt: '', updatedAt: '' },
    { id: 'oa', ownerId: 'owner', projectId: 'p', kind: 'image', status: 'active', currentVersionId: 'ov', createdAt: '', updatedAt: '' }];
  const transactions = free ? [] : [{ id: charge, user_id: 'actor', type: 'consume', amount: -18, balance_after: 100, model: 'im', task_id: row.id, reference_id: row.id }];
  const queries: string[] = [], release = vi.fn();
  const query = vi.fn(async (sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount?: number }> => {
    queries.push(sql); if (sql.startsWith('BEGIN')||sql.startsWith('COMMIT')||sql.startsWith('ROLLBACK')||sql.startsWith('SET LOCAL')||sql.includes('pg_advisory_xact_lock_shared')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM wujie_users')||sql.startsWith('SELECT id FROM wujie_projects')||sql.startsWith('SELECT project_id FROM wujie_project_canvas_documents')) return { rows: [] };
    if (sql.startsWith('SELECT *')) return { rows: [{ ...structuredClone(row), ...(sql.includes('clock_timestamp') ? { now_ms: String(Date.now()) } : {}) }] };
    if (sql.includes('SELECT current_setting')) return { rows: [{ lock_timeout: '5s', statement_timeout: '10s' }] };
    if (sql.includes('SELECT set_config')) return { rows: [] };
    if (sql.includes('FOR SHARE OF v,a')) return { rows: [{ id: 'iv' },{ id: 'ov' }] };
    if (sql.includes('FROM wujie_credits')) return { rows: free?[]:[{ balance: 100, total_used: 18 }] };
    if (sql.includes('FROM wujie_credit_transactions')) return { rows: structuredClone(transactions) };
    // Real original project fence; only external SQL is controlled.
    if (sql.includes('SELECT status FROM wujie_users')) return { rows: [{ status: 'active' }] };
    if (sql.includes('SELECT p.owner_id')) return { rows: [{ owner_id: 'owner', status: 'active', owner_status: 'active', enabled: true, has_document: true }] };
    if (sql.includes('SELECT 1 FROM wujie_project_document_editors')) return { rows: [{}], rowCount: 1 };
    if (sql.includes('SELECT enabled FROM wujie_project_document_settings')) return { rows: [{enabled:true}] };
    if (sql.includes('SELECT grant_generation')) return { rows: [{grant_generation:'3'}] };
    throw new Error('UNEXPECTED_SQL');
  });
  const client = { query, release } as unknown as PoolClient;
  const storage = { findVersion: async (_owner: string,_project: string,id: string) => id==='iv'?input:id==='ov'?output:null,
    findAsset: async (_owner: string,_project: string,id: string) => assets.find(a=>a.id===id)||null } as unknown as AssetStorageTransaction;
  const media = vi.fn(async (version: AssetVersion) => ({ bytes: version.id==='iv'?png:outputPng, mimeType: 'image/png', totalBytes: version.id==='iv'?png.length:outputPng.length }));
  const dependencies: SketchImageResultDependencies = { connect: async () => client, storage: () => storage, readMedia: media,
    readAccess: async (_client, actorUserId, projectId) => ({ kind: 'document', actorUserId, ownerId: 'owner', projectId, grantGeneration: '3' }) };
  return { row, input, output, assets, transactions, media, query, queries, release, dependencies,
    read: (actorUserId='actor') => readSketchImageResult({ actorUserId, projectId: 'p', taskId: row.id }, dependencies) };
}
describe('protected completed image result, original permissions/assets/finance and actual CPU decode', () => {
  it.each([false, true])('reads canonical PG NUMERIC reserve text under original protected result fences (free=%s)', async free => {
    const f = fixture(free); f.row.credit_cost = String(free ? 0 : 18);
    expect(await f.read()).toMatchObject({ taskId: 'skimg_r', imageAssetVersionId: 'ov', actualCredits: free ? 0 : 18, reserveCredits: free ? 0 : 18 });
    expect(f.row.credit_cost).toBe(free ? '0' : '18'); expect(f.media).toHaveBeenCalledTimes(2); expect(f.queries.at(-1)).toBe('COMMIT');
    expect(f.transactions).toHaveLength(free ? 0 : 1); expect(f.release).toHaveBeenCalledWith(false);
  });
  it.each(['018', '18.0', '1.8e1', '+18', ' 18', '-0', '9007199254740992', '19'])('refuses noncanonical or wrong SQL reserve %s before media projection', async value => {
    const f = fixture(); f.row.credit_cost = value;
    await expect(f.read()).rejects.toThrow('SKETCH_IMAGE_RESULT_UNAVAILABLE');
    expect(f.media).not.toHaveBeenCalled(); expect(f.queries).not.toContain('COMMIT'); expect(f.queries.at(-1)).toBe('ROLLBACK');
  });
  it.each([false,true])('returns only verified managed refs and net price after expired lease (free=%s)', async free => {
    const f=fixture(free); const result=await f.read(); expect(result).toMatchObject({ taskId:'skimg_r',imageUrl:'/api/serve-upload/output.png',previewUrl:'/api/serve-upload/input.png',actualCredits:free?0:18,reserveCredits:free?0:18 });
    expect(Object.isFrozen(result)).toBe(true); expect(f.media).toHaveBeenCalledTimes(2); expect(f.queries.at(-1)).toBe('COMMIT'); expect(f.release).toHaveBeenCalledWith(false);
    expect(JSON.stringify(result)).not.toMatch(/imageDataUrl|sketchImageAdmission|remote|inputTokens|grantGeneration|chargedTransactionId/);
  });
  it('another current editor can read without owning the task or old grant/lease', async () => {
    const f=fixture(); expect(await f.read('another-editor')).toMatchObject({ taskId:'skimg_r',imageAssetVersionId:'ov' });
  });
  it('a completed token result with legal partial refund retains no full-refund identity and returns actual net price', async () => {
    const f=fixture(), admission=f.row.result.sketchImageAdmission as {pricing:SketchImagePricing};
    admission.pricing={...admission.pricing,vision:{...admission.pricing.vision,mode:'token',tokenPricing:{input:1000,output:1000}}};
    const usage={inputTokens:2,outputTokens:3}; (f.row.result.sketchImageExecution as {usage?:typeof usage}).usage=usage;
    const quote=quoteSketchImageSettlement(admission.pricing,usage), refundId=createTaskBillingTransactionId('refund',f.row.id);
    expect(quote.actualCredits).toBe(12); expect(quote.deltaCredits).toBe(-6);
    const settlement={...quote,chargedTransactionId:f.row.charged_transaction_id,adjustmentTransactionId:refundId};
    f.row.result.sketchImageSettlement=settlement; f.input.metadata!.sketchImageSettlement=structuredClone(settlement);f.output.metadata!.sketchImageSettlement=structuredClone(settlement);
    f.transactions.push({id:refundId,user_id:'actor',type:'refund',amount:6,balance_after:106,model:'im',task_id:f.row.id,reference_id:f.row.id});
    expect(await f.read()).toMatchObject({actualCredits:12,reserveCredits:18});expect(f.row.refunded_transaction_id).toBeNull();
  });
  it('a read COMMIT ACK loss returns no refs and discards without retry or rollback', async () => {
    const f=fixture(), original=f.query.getMockImplementation()!;
    f.query.mockImplementation(async sql=>{const result=await original(sql);if(sql==='COMMIT')throw new Error('private-ack-loss');return result;});
    await expect(f.read()).rejects.toThrow('SKETCH_IMAGE_RESULT_UNAVAILABLE');expect(f.queries.filter(q=>q==='COMMIT')).toHaveLength(1);
    expect(f.queries).not.toContain('ROLLBACK');expect(f.release).toHaveBeenCalledWith(true);
  });
  it('keeps a busy original query owned until terminal after reader cancellation', async () => {
    const f=fixture(), original=f.query.getMockImplementation()!, c=new AbortController();let enter!:()=>void, release!:()=>void;
    const entered=new Promise<void>(r=>{enter=r;});
    f.query.mockImplementationOnce(async sql=>{enter();await new Promise<void>(r=>{release=r;});return original(sql);});
    const observed=readSketchImageResult({actorUserId:'actor',projectId:'p',taskId:f.row.id,signal:c.signal},f.dependencies).then(()=>({error:undefined}),error=>({error:error as Error}));
    await entered;c.abort();await nextTurn();expect(f.release).not.toHaveBeenCalled();release();
    expect((await observed).error?.message).toBe('SKETCH_IMAGE_RESULT_UNAVAILABLE');expect(f.queries).toEqual(['BEGIN','ROLLBACK']);expect(f.release).toHaveBeenCalledWith(false);
  });
  it.each(['current-access','owner','input-parent','output-parent','task','binding','schema','analysis','settlement-input','settlement-output','settlement-task','ledger','checksum','source','dimensions','trashed','full-refund','not-completed'] as const)('rejects changed %s without public refs', async kind => {
    const f=fixture();
    if(kind==='current-access') f.dependencies.readAccess=async(client,actorUserId)=>{void client;return {kind:'unscoped',actorUserId};};
    if(kind==='owner') f.input.ownerId='other'; if(kind==='input-parent') f.input.parentVersionIds=['other']; if(kind==='output-parent') f.output.parentVersionIds=[];
    if(kind==='task') f.output.taskId='other'; if(kind==='binding') f.output.metadata!.imageModelId='other'; if(kind==='schema') f.output.metadata!.schemaId='other';
    if(kind==='analysis') (f.output.metadata!.analysis as {prompt:string}).prompt='other';
    if(kind==='settlement-input') (f.input.metadata!.sketchImageSettlement as {actualCredits:number}).actualCredits=19;
    if(kind==='settlement-output') (f.output.metadata!.sketchImageSettlement as {actualCredits:number}).actualCredits=19;
    if(kind==='settlement-task') (f.row.result.sketchImageSettlement as {actualCredits:number}).actualCredits=19;
    if(kind==='ledger') f.transactions[0].amount=-19; if(kind==='checksum') f.output.file.checksum='0'.repeat(64);
    if(kind==='source') (f.row.result.sketchImageAdmission as {input:{instruction:string}}).input.instruction='changed';
    if(kind==='dimensions') f.output.file.width=10; if(kind==='trashed') f.assets[1].status='trashed'; if(kind==='full-refund') f.row.refunded_transaction_id='refund';
    if(kind==='not-completed') f.row.status='processing';
    await expect(f.read()).rejects.toThrow('SKETCH_IMAGE_RESULT_UNAVAILABLE'); expect(f.queries).not.toContain('COMMIT');
  });
});
