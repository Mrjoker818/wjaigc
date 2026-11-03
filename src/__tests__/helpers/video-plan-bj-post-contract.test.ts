import {expect,it} from 'vitest';
import {validateBJPost,type BJPostInput} from './video-plan-bj-post-contract';
const origin='https://canvas-shell-mobile.invalid';
const prompt={userIdea:'BJ故事：海边骑行。',mode:'text2video',modelId:'bg-offline::kling-v3-video-generation',aspectRatio:'16:9',duration:10,style:'cinematic',verbosity:'standard'};
const plan={storyIdea:'BJ导演：海边骑行，镜头跟随。',duration:10,aspectRatio:'16:9',model:'bg-offline::kling-v3-video-generation',style:'cinematic',shotCount:3};
const tools={action:'concat-videos',videoUrls:[origin+'/bj-video/B.mp4',origin+'/bj-video/A.mp4']};
const activity={action:'post_api_request',method:'POST',path:'/api/video/director/prompt',status:200,durationMs:4};
function input(path='/api/video/director/prompt',value:unknown=prompt):BJPostInput{return {url:origin+path,method:'POST',headers:{'content-type':'application/json'},body:new TextEncoder().encode(JSON.stringify(value)),count:1,prior:[]};}
for(const [path,value] of [['/api/video/director/prompt',prompt],['/api/video/director/shot-plan',plan],['/api/video/tools',tools]] as const){it('BJ exact '+path+' accepts only its synthetic contract',()=>{const receipt=validateBJPost(input(path,value));expect(receipt.path).toBe(path);expect(receipt.body).toEqual(value);});}
it('BJ exact activity links the original submitted path and status',()=>{const value=input('/api/activity',activity);value.prior=[{path:'/api/video/director/prompt',status:200}];expect(validateBJPost(value).body).toEqual(activity);});
const refusals:ReadonlyArray<[string,(v:BJPostInput)=>void]>=[
 ['wrong origin',v=>{v.url='https://other.invalid/api/video/director/prompt';}],
 ['credentials',v=>{v.headers.Authorization='Bearer not-real';}],
 ['query',v=>{v.url+='?unexpected=1';}],
 ['wrong method',v=>{v.method='GET';}],
 ['unrelated route',v=>{v.url=origin+'/api/generate';}],
 ['wrong MIME',v=>{v.headers['content-type']='text/plain';}],
 ['oversize body',v=>{v.body=new Uint8Array(2049);}],
 ['malformed JSON',v=>{v.body=new TextEncoder().encode('{');}],
 ['extra field',v=>{v.body=new TextEncoder().encode(JSON.stringify({...prompt,secret:'unrelated'}));}],
 ['wrong provider model',v=>{v.body=new TextEncoder().encode(JSON.stringify({...prompt,modelId:'other::kling-v3-video-generation'}));}],
 ['repeat service',v=>{v.count=2;}],
 ['unsolicited audit',v=>{v.url=origin+'/api/activity';v.body=new TextEncoder().encode(JSON.stringify(activity));}],
 ['wrong audit path',v=>{v.url=origin+'/api/activity';v.prior=[{path:'/api/video/director/prompt',status:200}];v.body=new TextEncoder().encode(JSON.stringify({...activity,path:'/api/save-image'}));}],
 ['wrong audit status',v=>{v.url=origin+'/api/activity';v.prior=[{path:'/api/video/director/prompt',status:200}];v.body=new TextEncoder().encode(JSON.stringify({...activity,status:500}));}],
 ['foreign concat asset',v=>{v.url=origin+'/api/video/tools';v.body=new TextEncoder().encode(JSON.stringify({...tools,videoUrls:[origin+'/bj-video/B.mp4','https://external.invalid/A.mp4']}));}],
 ['duplicate concat asset',v=>{v.url=origin+'/api/video/tools';v.body=new TextEncoder().encode(JSON.stringify({...tools,videoUrls:[origin+'/bj-video/A.mp4',origin+'/bj-video/A.mp4']}));}],
];
for(const [name,mutate] of refusals){it('BJ refuses '+name,()=>{const v=input();mutate(v);expect(()=>validateBJPost(v)).toThrow();});}
