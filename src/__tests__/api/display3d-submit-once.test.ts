import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fixture=vi.hoisted(()=>({
  base:'https://synthetic.invalid/v1', mode:'error' as 'error'|'non-json', calls:[] as string[], redirects:[] as Array<RequestRedirect|undefined>, updates:[] as Array<{status?:string;error?:string;result?:{display3dOutcomeUnconfirmed?:boolean}}>,
}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/cloud-task-storage', async () => (await import('@/__tests__/fixtures/display3d-cloud-task-store')).createDisplay3DCloudTaskStore());
vi.mock('@/lib/server-api-config',()=>({getApiProviders:async()=>[{id:'synthetic-provider',name:'synthetic',type:'image',modelType:'image',baseUrl:fixture.base,apiKey:'fake-key',isEnabled:true,selectedModels:['image-two'],createdAt:1,updatedAt:1}]}));
vi.mock('@/lib/server-auth',()=>({getSessionUser:async()=>({id:'synthetic-user',name:'synthetic',role:'admin',status:'active',createdAt:1,updatedAt:1}),listManagedUsers:async()=>[]}));
vi.mock('@/lib/task-registry',()=>({registerTask:vi.fn(),waitForQueueSlot:async()=>true,getTaskInfo:()=>({status:'pending'}),isTaskCancelled:()=>false,registerTaskAbortController:vi.fn(),unregisterTaskAbortController:vi.fn(),releaseQueueSlot:vi.fn(),updateTaskProgress:(_id:string,value:{status?:string;error?:string})=>{fixture.updates.push(value);}}));
vi.mock('@/lib/api-helpers',async importOriginal=>{
  const actual=await importOriginal<typeof import('@/lib/api-helpers')>();
  return {...actual,fetchWithV1Retry:(base:string,path:string,options:RequestInit)=>actual.fetchWithV1Retry(base,path,{
    ...options,transport:async(input,init)=>{
      fixture.calls.push(String(input));
      fixture.redirects.push(init?.redirect);
      if(fixture.calls.length===1) return fixture.mode==='error'
        ? new Response('synthetic upstream error',{status:503,headers:{'content-type':'text/plain'}})
        : new Response('<html>synthetic</html>',{status:200,headers:{'content-type':'text/html'}});
      return new Response('{"data":[{"url":"https://synthetic.invalid/result.png"}]}',{status:200,headers:{'content-type':'application/json'}});
    },
  })};
});
import { POST } from '@/app/api/display-3d/generate/route';
const request=()=>new NextRequest('https://synthetic.invalid/api/display-3d/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({brandName:'synthetic',providerId:'synthetic-provider',model:'image-two'})});
beforeEach(()=>{fixture.base='https://synthetic.invalid/v1';fixture.mode='error';fixture.calls=[];fixture.redirects=[];fixture.updates=[];});

describe('display 3D submission is never automatically repeated',()=>{
  it.each(['error','non-json'] as const)('uses an explicitly versioned endpoint once after %s',async mode=>{
    fixture.mode=mode;
    const result=await POST(request());
    expect(result.status).toBe(200);
    await vi.waitFor(()=>expect(fixture.updates.some(value=>value.result?.display3dOutcomeUnconfirmed)).toBe(true));
    expect(fixture.calls).toEqual(['https://synthetic.invalid/v1/images/generations']);
    expect(fixture.redirects).toEqual(['manual']);
  });
  it('does not retry an unversioned configured endpoint after an ambiguous failure',async()=>{
    fixture.base='https://synthetic.invalid';
    const result=await POST(request());
    expect(result.status).toBe(200);
    await vi.waitFor(()=>expect(fixture.updates.some(value=>value.result?.display3dOutcomeUnconfirmed)).toBe(true));
    expect(fixture.calls).toEqual(['https://synthetic.invalid/images/generations']);
  });
});
