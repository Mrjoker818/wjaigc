import {expect,it,vi} from 'vitest';
import {createOrdinaryProvider} from '@/lib/task-core/ordinary-generation-provider';
import {PROFILE_GEMINI_IMAGE} from '@/lib/api-compatibility';
import {createHash} from 'node:crypto';
vi.hoisted(() => { vi.stubGlobal('fetch', async () => { throw new Error('TEST_NETWORK_FORBIDDEN'); }); });
vi.mock('server-only',()=>({}));
// All imports use an exclusive temporary data root, even in the default suite.
vi.mock('@/lib/server-data-root', async () => {
 const fs = await import('node:fs'); const path = await import('node:path'); const os = await import('node:os');
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wujie-gemini-log-'));
 return {getServerDataRoot: () => root, getServerSystemDir: () => path.join(root, 'system'), getServerUsersDir: () => path.join(root, 'users')};
});
vi.mock('pg', () => ({Pool: class { constructor() { throw new Error('TEST_DATABASE_FORBIDDEN'); } }}));

const imageBytes=Buffer.from('synthetic-private-image').toString('base64'),image='data:image/png;base64,'+imageBytes;
const credential='synthetic-credential-sensitive',prompt='SECRET';
async function exercise(response:Response){
 const logs=[vi.spyOn(console,'log').mockImplementation(()=>{}),vi.spyOn(console,'warn').mockImplementation(()=>{}),vi.spyOn(console,'error').mockImplementation(()=>{})];
 const fetcher=vi.fn(async()=>response);
 try{const submit=createOrdinaryProvider({requestedSize:'1:1',enhancedPrompt:prompt,agentProviderIdempotencyKey:'synthetic-task-id',accessibleReferenceImages:[image],aspectRatio:'1:1',strictAgentRouting:false,downloadAndSaveImage:async()=>null,isPrivateIp:()=>false,profile:PROFILE_GEMINI_IMAGE,providerFetch:fetcher});
 const result=await submit({name:'fixture',modelId:'gemini-2.5-flash-image',paramType:'none',supportedSizes:[],qualityOptions:[],resolutionOptions:[],supportsImageToImage:true,maxN:1,estimatedTime:1},credential,'https://fixture.invalid','fixture-provider',1).then(()=>null,error=>error);
 expect(fetcher).toHaveBeenCalled();return {output:JSON.stringify(logs.flatMap(spy=>spy.mock.calls)),result};
 }finally{logs.forEach(spy=>spy.mockRestore())}
}
it('keeps request diagnostics without exposing image, prompt, or credentials',async()=>{
 const {output,result}=await exercise(Response.json({choices:[{message:{content:'no image'}}]}));expect(output).not.toContain(imageBytes);expect(output).not.toContain(prompt);expect(output).not.toContain(credential);expect(output).toContain('Gemini image route');expect(output).toContain('gemini-2.5-flash-image');expect(output).toContain('fixture-provider');expect(output).toContain(createHash('sha256').update('synthetic-task-id').digest('hex'));expect(output).not.toContain('synthetic-task-id');expect(result.message).toContain('未返回图片');
});
it('reports provider error status without logging echoed private data or credentials',async()=>{
 const {output,result}=await exercise(Response.json({error:{message:`No available channel ${imageBytes} ${credential} ${prompt}`}},{status:502}));expect(output).toContain('502');expect(output).toContain('fixture-provider');expect(output).not.toContain(imageBytes);expect(output).not.toContain(credential);expect(output).not.toContain(prompt);expect(result.retryable).toBe(true);
});
it('reports invalid JSON or missing image without logging response content',async()=>{
 for(const response of [new Response(`${imageBytes} ${credential} ${prompt}`,{status:200}),Response.json({choices:[{message:{content:`${imageBytes} ${credential} ${prompt}`}}]})]){const {output,result}=await exercise(response);expect(output).toMatch(/non-JSON|no extractable image/);expect(output).not.toContain(imageBytes);expect(output).not.toContain(credential);expect(output).not.toContain(prompt);expect(result).toBeInstanceOf(Error);}
});
