import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({admin:vi.fn(),sql:vi.fn(),pool:vi.fn(()=>{throw new Error('unexpected database connection')})}));
vi.mock('@/lib/server-auth',()=>({requireAdminUser:mocks.admin}));
vi.mock('@/lib/db-client',()=>({execSql:mocks.sql,getPool:mocks.pool}));
vi.mock('@/lib/refund-identity-claim',()=>({ensureRefundIdentityClaims:vi.fn()}));
vi.mock('@/lib/auth/auth-persistence',()=>({refreshAuthJsonFileAtomic:vi.fn()}));
vi.mock('@/lib/auth/auth-repository',()=>({withDatabaseAuthReplicaLock:vi.fn()}));
vi.mock('@/lib/api-provider-selected-models-storage',()=>({encodeSelectedModelsForStorage:vi.fn(),resolveSelectedModelsStorageKind:vi.fn()}));
vi.mock('@/lib/server-api-config',()=>({findProviderForFeature:vi.fn(()=>{throw new Error('unexpected provider')})}));
vi.mock('@/lib/api-helpers',()=>({fetchWithV1Retry:vi.fn(()=>{throw new Error('unexpected network')})}));
import {GET as auditGet} from '@/app/api/admin/audit/route';
import {POST as opPost} from '@/app/api/admin/op-log/route';
import {dbGetAuditStats} from '@/lib/db-storage';
const routes=[{name:'audit GET stats',call:()=>auditGet(new NextRequest('http://fixture.invalid/api/admin/audit?stats=true'))},{name:'operation POST statistics',call:()=>opPost(new NextRequest('http://fixture.invalid/api/admin/op-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'statistics'})}))}] as const;
function kind(sql:string):string{if(sql.includes('GROUP BY action'))return 'breakdown';if(sql.includes('GROUP BY level'))return 'levels';if(sql.includes('AVG(duration_ms)'))return 'avg';if(sql.includes('COUNT(DISTINCT'))return 'users';if(sql.includes('created_at >='))return 'today';if(sql.includes('resolution_status'))return 'unresolved';if(sql.includes('level IN'))return 'errors';if(sql.includes('COUNT(*)'))return 'total';throw Error('unexpected SQL');}
const zero={totalActions:0,todayActions:0,uniqueUsers:0,actionBreakdown:{},levelBreakdown:{},errorCount:0,unresolvedErrorCount:0,avgDurationMs:0};
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('fetch',vi.fn(()=>{throw Error('unexpected network')}));mocks.admin.mockResolvedValue({id:'synthetic-admin',name:'synthetic'});mocks.sql.mockImplementation(async(sql:string)=>{const k=kind(sql);return {rows:k==='breakdown'||k==='levels'?[]:k==='avg'?[{avg:null}]:[{count:0}],rowCount:1}});vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()});
describe.each(routes)('$name strict storage',({call})=>{
 it.each(['total','breakdown','avg'])('returns failure when %s SQL fails without exposing raw errors',async failed=>{mocks.sql.mockImplementation(async(sql:string)=>{const k=kind(sql);if(k===failed)throw new Error('synthetic-private-stats-error');return {rows:k==='breakdown'||k==='levels'?[]:k==='avg'?[{avg:null}]:[{count:0}],rowCount:1}});const response=await call(),body=await response.json();expect(response.status).toBe(500);expect(body.success).toBe(false);expect(JSON.stringify(body)).not.toContain('synthetic-private-stats-error');expect(vi.mocked(console.error).mock.calls.flat().map(String).join(' ')).not.toContain('synthetic-private-stats-error');expect(mocks.sql).toHaveBeenCalledTimes(8);expect(mocks.pool).not.toHaveBeenCalled()});
 it('returns successful zero statistics for truly empty data',async()=>{const response=await call();expect(response.status).toBe(200);expect((await response.json()).stats).toEqual(zero);expect(mocks.sql).toHaveBeenCalledTimes(8)});
 it('preserves normal nonzero aggregations',async()=>{const data:Record<string,unknown[]>={total:[{count:9}],today:[{count:2}],users:[{count:3}],breakdown:[{action:'login',count:4}],levels:[{level:'error',count:4}],errors:[{count:4}],unresolved:[{count:1}],avg:[{avg:12.6}]};mocks.sql.mockImplementation(async(sql:string)=>({rows:data[kind(sql)],rowCount:1}));const response=await call();expect(response.status).toBe(200);expect((await response.json()).stats).toEqual({totalActions:9,todayActions:2,uniqueUsers:3,actionBreakdown:{login:4},levelBreakdown:{error:4},errorCount:4,unresolvedErrorCount:1,avgDurationMs:13})});
 it('rejects unauthorized request before SQL',async()=>{mocks.admin.mockResolvedValue(null);const response=await call();expect(response.status).toBe(403);expect(mocks.sql).not.toHaveBeenCalled();expect(mocks.pool).not.toHaveBeenCalled()});
});
it('legacy direct caller retains existing zero fallback on SQL error',async()=>{mocks.sql.mockRejectedValue(new Error('synthetic'));expect(await dbGetAuditStats()).toEqual(zero);expect(mocks.sql).toHaveBeenCalledTimes(8)});
