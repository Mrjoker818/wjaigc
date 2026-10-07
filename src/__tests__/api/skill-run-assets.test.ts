import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const mocks=vi.hoisted(()=>({auth:vi.fn(),resolve:vi.fn(),sources:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/api-auth',()=>({requireApiAuthOrReject:mocks.auth}));
vi.mock('@/lib/skill-runtime/document-assets',()=>({resolveSkillRunAssets:mocks.resolve,
  resolveSkillRunSources:mocks.sources,
  SkillAssetScopeError:class extends Error {}}));
import { GET } from '@/app/api/skill-runs/[runId]/assets/route';
import { GET as SOURCES } from '@/app/api/skill-runs/[runId]/sources/route';
describe('Skill run assets HTTP boundary',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({user:{id:'editor'}});});
  const request=(query:string):NextRequest=>new NextRequest('http://localhost/api/skill-runs/run/assets?'+query);
  const context={params:Promise.resolve({runId:'run'})};
  it('binds session actor and exact project/run ordered distinct versions',async()=>{
    const result={actorUserId:'editor',projectId:'target',runId:'run',references:[{assetVersionId:'v',kind:'document',url:'/report'}]};
    mocks.resolve.mockResolvedValue(result);
    const response=await GET(request('projectId=target&assetVersionId=v'),context);
    expect(response.status).toBe(200);expect(await response.json()).toEqual(result);
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({actorUserId:'editor',projectId:'target',runId:'run',assetVersionIds:['v']}));
  });
  it.each(['assetVersionId=v','projectId=target','projectId=target&projectId=other&assetVersionId=v',
    'projectId=target&assetVersionId=v&assetVersionId=v','projectId=target&assetVersionId=v&owner=owner',
    'projectId=target&'+Array.from({length:101},(_,i)=>'assetVersionId=v'+i).join('&')])('rejects invalid query before resolver: %s',async query=>{
    expect((await GET(request(query),context)).status).toBe(400);expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('keeps auth rejection and database failure fail-closed',async()=>{
    mocks.auth.mockResolvedValueOnce(NextResponse.json({error:'unauthenticated'},{status:401}));
    expect((await GET(request('projectId=target&assetVersionId=v'),context)).status).toBe(401);
    expect(mocks.resolve).not.toHaveBeenCalled();
    mocks.resolve.mockRejectedValue(new Error('Database unavailable'));
    expect((await GET(request('projectId=target&assetVersionId=v'),context)).status).toBe(503);
  });
});
describe('1397 fix1 separate source HTTP boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: 'editor' } }); });
  const request = (query: string): NextRequest => new NextRequest('http://localhost/api/skill-runs/run/sources?' + query);
  const context = { params: Promise.resolve({ runId: 'run' }) };
  it('binds session actor, run, ordered source IDs and the exact request signal', async () => {
    const input = request('projectId=target&assetVersionId=source&assetVersionId=second');
    mocks.sources.mockResolvedValue({ actorUserId: 'editor', projectId: 'target', runId: 'run', references: [] });
    expect((await SOURCES(input, context)).status).toBe(200);
    expect(mocks.sources).toHaveBeenCalledWith({ actorUserId: 'editor', projectId: 'target', runId: 'run', assetVersionIds: ['source', 'second'], signal: input.signal });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it.each(['assetVersionId=s', 'projectId=target', 'projectId=target&projectId=other&assetVersionId=s',
    'projectId=target&assetVersionId=s&assetVersionId=s', 'projectId=target&assetVersionId=s&owner=owner',
    'projectId=target&' + Array.from({ length: 101 }, (_, i) => 'assetVersionId=s' + i).join('&')])('rejects invalid source query %s', async query => {
    expect((await SOURCES(request(query), context)).status).toBe(400); expect(mocks.sources).not.toHaveBeenCalled();
  });
  it('preserves auth and database rejection without output/private fallback', async () => {
    mocks.auth.mockResolvedValueOnce(NextResponse.json({ error: 'unauthenticated' }, { status: 401 }));
    expect((await SOURCES(request('projectId=target&assetVersionId=s'), context)).status).toBe(401);
    mocks.sources.mockRejectedValue(new Error('DB unavailable'));
    expect((await SOURCES(request('projectId=target&assetVersionId=s'), context)).status).toBe(503);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
