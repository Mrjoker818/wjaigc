import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fixture = vi.hoisted(() => ({
  base:'https://synthetic.invalid/v1', mode:'error' as 'error'|'non-json',
  calls:[] as string[], redirects:[] as Array<RequestRedirect | undefined>,
  updates:[] as Array<{status?:string;error?:string}>,
}));
vi.mock('server-only',() => ({}));
vi.mock('@/lib/server-api-config',() => ({getApiProviders:async () => [{id:'synthetic-provider',name:'synthetic',type:'chat',modelType:'chat',baseUrl:fixture.base,apiKey:'synthetic-key',isEnabled:true,selectedModels:['vision-two'],createdAt:1,updatedAt:1}]}));
vi.mock('@/lib/server-auth',() => ({getSessionUser:async () => ({id:'synthetic-user',name:'synthetic',role:'admin',status:'active',createdAt:1,updatedAt:1}),listManagedUsers:async () => []}));
vi.mock('@/lib/task-registry',() => ({registerTask:vi.fn(),updateTaskProgress:(_id:string,value:{status?:string;error?:string}) => {fixture.updates.push(value);}}));
vi.mock('@/lib/api-helpers',async importOriginal => {
  const actual=await importOriginal<typeof import('@/lib/api-helpers')>();
  return {...actual,fetchWithV1Retry:(base:string,path:string,options:RequestInit) => actual.fetchWithV1Retry(base,path,{
    ...options,transport:async (input,init) => {
      fixture.calls.push(String(input));
      fixture.redirects.push(init?.redirect);
      if(fixture.mode==='error') return new Response('synthetic-key private upstream details',{status:503,headers:{'content-type':'text/plain'}});
      if(fixture.calls.length===1) return new Response('<html>synthetic-key</html>',{status:200,headers:{'content-type':'text/html'}});
      return new Response('{"choices":[{"message":{"content":"{}"}}]}',{status:200,headers:{'content-type':'application/json'}});
    },
  })};
});
import { POST } from '@/app/api/activity-venue/qc/route';
const request=(): NextRequest => new NextRequest('https://synthetic.invalid/api/activity-venue/qc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:'synthetic-provider',model:'vision-two',imageUrl:'https://image.invalid/test.png',designId:{brandName:'合成品牌',lockedFields:{}}})});
beforeEach(() => {fixture.base='https://synthetic.invalid/v1';fixture.mode='error';fixture.calls=[];fixture.redirects=[];fixture.updates=[];});

describe('venue quality check submission',() => {
  it.each(['error','non-json'] as const)('does not automatically repeat a versioned submission after %s',async mode => {
    fixture.mode=mode;
    expect((await POST(request())).status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(value => value.status==='failed')).toBe(true));
    expect(fixture.calls).toEqual(['https://synthetic.invalid/v1/chat/completions']);
    expect(fixture.redirects).toEqual(['manual']);
    expect(fixture.updates.map(value => value.error || '').join(' ')).not.toContain('synthetic-key');
  });
  it('does not retry a configured unversioned endpoint on an ambiguous response',async () => {
    fixture.base='https://synthetic.invalid';
    expect((await POST(request())).status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(value => value.status==='failed')).toBe(true));
    expect(fixture.calls).toEqual(['https://synthetic.invalid/chat/completions']);
  });
  it('does not expose provider response text through task errors',async () => {
    expect((await POST(request())).status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(value => value.status==='failed')).toBe(true));
    expect(fixture.updates.map(value => value.error || '').join(' ')).not.toContain('synthetic-key');
  });
});
