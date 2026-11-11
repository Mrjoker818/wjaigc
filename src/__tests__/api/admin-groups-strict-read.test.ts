import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const f = vi.hoisted(() => ({ allowed: true, mode: 'empty' as 'empty'|'error'|'rows', queries: [] as string[] }));
vi.mock('@/lib/db-client', () => ({
  execSql: async (sql: string) => {
    f.queries.push(sql);
    if (sql !== 'SELECT * FROM wujie_user_groups ORDER BY created_at ASC') throw new Error('UNEXPECTED_SQL_WRITE_OR_QUERY');
    if (f.mode === 'error') throw new Error('SYNTHETIC_SQL_FAILURE_PRIVATE_DETAIL');
    return {rows: f.mode === 'rows' ? [{id:'g1',name:'Group One',product_types:['canvas'],credit_quota:12,is_active:false,created_at:1,updated_at:2}] : [],rowCount:f.mode === 'rows' ? 1 : 0};
  },
  getPool: () => ({ connect: async () => ({
    query: async (sql: string) => {
      const operation = sql.trim().split(/\s+/u)[0];
      f.queries.push(operation);
      if (operation === 'UPDATE' && f.mode === 'error') throw new Error('SYNTHETIC_SQL_FAILURE_PRIVATE_DETAIL');
      if (['BEGIN', 'UPDATE', 'ROLLBACK', 'COMMIT'].includes(operation)) return { rows: [], rowCount: 0 };
      throw new Error('UNEXPECTED_SQL_QUERY');
    },
    release() {},
  }) }),
}));
vi.mock('@/lib/server-auth', () => ({requireAdminUser: async () => f.allowed ? {id:'admin-synthetic',name:'Synthetic Admin',role:'admin'} : null}));
import { GET, POST } from '@/app/api/admin/groups/route';
import { dbReadGroups } from '@/lib/db-storage';
const get = () => new NextRequest('https://groups.invalid/api/admin/groups');
const update = (id='g1') => new NextRequest('https://groups.invalid/api/admin/groups',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'update',id,name:'X'})});
beforeEach(() => { f.allowed=true; f.mode='empty'; f.queries=[]; });
describe('real route with real storage mapping and only SQL/auth replaced', () => {
  it('GET SQL failure returns a nonleaking failure rather than success empty', async () => { f.mode='error';const r=await GET(get());expect(r.status).toBe(500);expect(await r.json()).toEqual({success:false,error:'Failed to load groups'});expect(f.queries).toHaveLength(1); });
  it('update SQL failure rolls back and does not disclose storage details', async () => {
    f.mode = 'error';
    const response = await POST(update());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ success: false, outcome: 'unknown', error: 'Group operation outcome unknown' });
    expect(f.queries).toEqual(['BEGIN', 'UPDATE', 'ROLLBACK']);
  });
  it('genuine empty GET stays successful and empty', async () => {const r=await GET(get());expect(r.status).toBe(200);expect(await r.json()).toEqual({success:true,groups:[]});});
  it('an update with no matched group stays 404 without inserting a group or audit row', async () => {
    const response = await POST(update());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'Group not found' });
    expect(f.queries).toEqual(['BEGIN', 'UPDATE', 'COMMIT']);
  });
  it('GET preserves the existing row fields and mapping', async () => {f.mode='rows';const r=await GET(get());expect(r.status).toBe(200);expect(await r.json()).toEqual({success:true,groups:[{id:'g1',name:'Group One',product_types:['canvas'],credit_quota:12,is_active:false,created_at:1,updated_at:2}]});});
  it('unauthorized GET and POST return 403 without reading', async () => {f.allowed=false;const a=await GET(get()),b=await POST(update());expect(a.status).toBe(403);expect(b.status).toBe(403);expect(await a.json()).toEqual({success:false,error:'Admin access required'});expect(await b.json()).toEqual({success:false,error:'Admin access required'});expect(f.queries).toEqual([]);});
  it('legacy no-argument helper retains failure-as-empty behavior', async () => {f.mode='error';expect(await dbReadGroups()).toEqual([]);expect(f.queries).toHaveLength(1);});
});
