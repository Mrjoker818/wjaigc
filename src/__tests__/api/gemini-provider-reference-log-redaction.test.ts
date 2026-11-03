import {expect,it,vi} from 'vitest';
import {createOrdinaryProvider} from '@/lib/task-core/ordinary-generation-provider';
import {PROFILE_GEMINI_IMAGE} from '@/lib/api-compatibility';
vi.hoisted(() => { vi.stubGlobal('fetch', async () => { throw new Error('TEST_NETWORK_FORBIDDEN'); }); });
vi.mock('server-only',()=>({}));
// All imports use an exclusive temporary data root, even in the default suite.
vi.mock('@/lib/server-data-root', async () => {
 const fs = await import('node:fs'); const path = await import('node:path'); const os = await import('node:os');
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wujie-gemini-log-'));
 return {getServerDataRoot: () => root, getServerSystemDir: () => path.join(root, 'system'), getServerUsersDir: () => path.join(root, 'users')};
});
vi.mock('pg', () => ({Pool: class { constructor() { throw new Error('TEST_DATABASE_FORBIDDEN'); } }}));

const localRead = vi.hoisted(() => vi.fn());
vi.mock('@/lib/image-tools/local-image-reader', async (original) => ({ ...await original<typeof import('@/lib/image-tools/local-image-reader')>(), readImageToolsLocalFile: localRead }));
const referenceSecret='synthetic-signed-reference-token';
const referenceUrl='https://reference.invalid/a?token='+referenceSecret;
const credential='synthetic-api-credential';
const prompt='synthetic-private-prompt';
const providerSecret='synthetic-echoed-upstream-body';
const outputImage='data:image/png;base64,c3ludGhldGljLW91dHB1dA==';
const model={name:'fixture',modelId:'gemini-2.5-flash-image',paramType:'none' as const,supportedSizes:[],qualityOptions:[],resolutionOptions:[],supportsImageToImage:true,maxN:1,estimatedTime:1};
async function exercise(referenceStatus:number,providerResponse:Response){
 const logs=[vi.spyOn(console,'log').mockImplementation(()=>{}),vi.spyOn(console,'warn').mockImplementation(()=>{}),vi.spyOn(console,'error').mockImplementation(()=>{}),vi.spyOn(console,'info').mockImplementation(()=>{})];
 const transport=vi.fn(async(input:RequestInfo|URL)=>{expect(String(input)).toBe(referenceUrl);return new Response(referenceStatus===200?new Uint8Array([1,2,3]):null,{status:referenceStatus,headers:{'content-type':'image/png'}});});
 const providerFetch=vi.fn(async(base:string,endpoint:string,options:RequestInit = {})=>{expect(base).toBe('https://provider.invalid');expect(endpoint).toBe('/chat/completions');expect(options.method).toBe('POST');return providerResponse;});
 try{
  const submit=createOrdinaryProvider({requestedSize:'1:1',enhancedPrompt:prompt,agentProviderIdempotencyKey:'synthetic-task',accessibleReferenceImages:[referenceUrl],aspectRatio:'1:1',strictAgentRouting:false,downloadAndSaveImage:async()=>null,isPrivateIp:()=>false,profile:PROFILE_GEMINI_IMAGE,transport,providerFetch});
  const result=await submit(model,credential,'https://provider.invalid','fixture-provider',1).then(value=>({value,error:undefined}),error=>({value:undefined,error}));
  expect(transport).toHaveBeenCalledTimes(1);expect(providerFetch).toHaveBeenCalledTimes(1);
  const args=providerFetch.mock.calls[0][2]!,header=args.headers as Record<string,string>,body=String(args.body);
  expect(header.Authorization).toBe('Bearer '+credential);expect(body).toContain(prompt);
  const output=JSON.stringify(logs.flatMap(spy=>spy.mock.calls));return{output,result,body};
 }finally{logs.forEach(spy=>spy.mockRestore())}
}
function successfulImage(){return Response.json({choices:[{message:{content:[{type:'image_url',image_url:{url:outputImage}}]}}]});}
it('direct success retains request and response behavior',async()=>{
 const {output,result,body}=await exercise(200,successfulImage());expect(result.value).toEqual({taskIds:[],directImageUrls:[outputImage],usedModel:model.modelId,usedProviderId:'fixture-provider'});expect(body).toContain('AQID');expect(output).not.toContain(prompt);expect(output).not.toContain(credential);
});
it('signed reference URL is absent from logs after successful media fetch',async()=>{
 const {output,result}=await exercise(200,successfulImage());expect(result.value?.directImageUrls).toEqual([outputImage]);expect(output).not.toContain(referenceSecret);
});
it('signed reference URL is absent from logs after media fetch error',async()=>{
 const {output,result,body}=await exercise(503,successfulImage());expect(result.value?.directImageUrls).toEqual([outputImage]);expect(body).toContain(referenceUrl);expect(output).not.toContain(referenceSecret);
});
it('non-retryable provider message is not logged locally but remains in returned error',async()=>{
 const {output,result}=await exercise(200,Response.json({error:{message:providerSecret}},{status:400}));expect(output).not.toContain(providerSecret);expect(result.error).toBeInstanceOf(Error);expect(result.error.message).toContain(providerSecret);expect(result.error.retryable).toBeUndefined();
});
it.each([{status:502,message:'No available channel',retry:true},{status:401,message:'bad_response_status_code',retry:true},{status:501,message:'ordinary failure',retry:false},{status:429,message:'rate limit',retry:false}])('preserves error retry flag $status',async({status,message,retry})=>{
 const {result}=await exercise(200,Response.json({error:{message}},{status}));expect(result.error).toBeInstanceOf(Error);expect(result.error.retryable===true).toBe(retry);
});

it('does not log transport exception details or private URL paths', async () => {
 const logs=[vi.spyOn(console,'log').mockImplementation(()=>{}),vi.spyOn(console,'warn').mockImplementation(()=>{}),vi.spyOn(console,'error').mockImplementation(()=>{})];
 const transport=vi.fn(async()=>{throw Error('synthetic-private-path '+referenceUrl)});
 try {
  const submit=createOrdinaryProvider({requestedSize:'1:1',enhancedPrompt:prompt,agentProviderIdempotencyKey:'synthetic-task',accessibleReferenceImages:[referenceUrl],aspectRatio:'1:1',strictAgentRouting:false,downloadAndSaveImage:async()=>null,isPrivateIp:()=>false,profile:PROFILE_GEMINI_IMAGE,transport,providerFetch:vi.fn(async()=>successfulImage())});
  const result=await submit(model,credential,'https://provider.invalid','fixture-provider',1);
  expect(result.directImageUrls).toEqual([outputImage]); const output=JSON.stringify(logs.flatMap(spy=>spy.mock.calls));
  expect(output).not.toContain(referenceSecret); expect(output).not.toContain('synthetic-private-path'); expect(output).not.toContain('reference.invalid');
 } finally {logs.forEach(spy=>spy.mockRestore())}
});

it.each(['local','recovery-failure'])('managed reference %s does not log its private filename or exception', async (mode) => {
 const logs=[vi.spyOn(console,'log').mockImplementation(()=>{}),vi.spyOn(console,'warn').mockImplementation(()=>{}),vi.spyOn(console,'error').mockImplementation(()=>{})];
 const managed='/api/serve-upload/synthetic-private-filename.png?token='+referenceSecret;
 localRead.mockReset(); localRead.mockResolvedValue(mode==='local'?Buffer.from([1,2,3]):null);
 const transport=vi.fn(async()=>{throw Error('synthetic-private-filename '+referenceSecret)});
 try {
  const submit=createOrdinaryProvider({requestedSize:'1:1',enhancedPrompt:prompt,agentProviderIdempotencyKey:'synthetic-task',accessibleReferenceImages:[managed],aspectRatio:'1:1',strictAgentRouting:false,downloadAndSaveImage:async()=>null,isPrivateIp:()=>false,profile:PROFILE_GEMINI_IMAGE,transport,providerFetch:vi.fn(async()=>successfulImage())});
  const result=await submit(model,credential,'https://provider.invalid','fixture-provider',1); expect(result.directImageUrls).toEqual([outputImage]); expect(localRead).toHaveBeenCalled();
  const output=JSON.stringify(logs.flatMap(spy=>spy.mock.calls)); expect(output).not.toContain('synthetic-private-filename'); expect(output).not.toContain(referenceSecret);
  if(mode==='recovery-failure') expect(transport).toHaveBeenCalledTimes(1);
 } finally {logs.forEach(spy=>spy.mockRestore())}
});
