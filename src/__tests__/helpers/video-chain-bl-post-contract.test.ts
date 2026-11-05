import {expect,it} from 'vitest';
import {validateBLPost,type BLPostInput} from './video-chain-bl-post-contract';
const origin='https://canvas-shell-mobile.invalid',extract={videoUrl:origin+'/bj-video/A.mp4',frame:'last'},persist={imageUrl:origin+'/bl-frame/raw.png',mediaType:'image'},diagnose={prompt:'BJ-A海岸起步',issue:'BL synthetic A failed',model:'bg-offline::kling-v3-video-generation',aspectRatio:'16:9',duration:10,shot:{id:'A',title:'BJ-A'}};
function input(path='/api/video/extract-frame',body:unknown=extract):BLPostInput{return {url:origin+path,method:'POST',headers:{'content-type':'application/json'},body:new TextEncoder().encode(JSON.stringify(body)),count:1,prior:[]};}
const director={userIdea:'BJ故事：海边骑行。',mode:'text2video',modelId:'bg-offline::kling-v3-video-generation',aspectRatio:'16:9',duration:10,style:'cinematic',verbosity:'standard'};
for(const [path,body] of [['/api/video/director/prompt',director],['/api/video/extract-frame',extract],['/api/save-image',persist],['/api/video/director/diagnose',diagnose]] as const){it('BL exact '+path+' keeps the synthetic contract',()=>{expect(validateBLPost(input(path,body)).body).toEqual(body);});}
for(const path of ['/api/video/extract-frame','/api/video/director/diagnose']){it('BL audit links '+path,()=>{const body={action:'post_api_request',method:'POST',path,status:200,durationMs:4},v=input('/api/activity',body);v.count=3;v.prior=[{path:'/api/video/director/prompt',status:200},{path:'/api/video/director/shot-plan',status:200},{path,status:200}];v.audited=v.prior.slice(0,2);expect(validateBLPost(v).body).toEqual(body);});}
it('BL accepts out-of-order audit only for an actually pending path',()=>{const body={action:'post_api_request',method:'POST',path:'/api/save-image',status:200,durationMs:4},v=input('/api/activity',body);v.prior=[{path:'/api/video/extract-frame',status:200},{path:'/api/save-image',status:200}];expect(validateBLPost(v).body).toEqual(body);});
it('BL rejects an already consumed audit receipt',()=>{const body={action:'post_api_request',method:'POST',path:'/api/video/extract-frame',status:200,durationMs:4},v=input('/api/activity',body);v.count=2;v.prior=[{path:'/api/video/extract-frame',status:200}];v.audited=[{path:'/api/video/extract-frame',status:200}];expect(()=>validateBLPost(v)).toThrow();});
const refusals:ReadonlyArray<[string,(v:BLPostInput)=>void]>=[
 ['foreign origin',v=>{v.url='https://other.invalid/api/video/extract-frame';}],
 ['credential presence',v=>{v.headers.cookie='';}],
 ['query',v=>{v.url+='?unexpected=1';}],
 ['wrong method',v=>{v.method='GET';}],
 ['extra extract field',v=>{v.body=new TextEncoder().encode(JSON.stringify({...extract,secret:'not-real'}));}],
 ['wrong frame',v=>{v.body=new TextEncoder().encode(JSON.stringify({...extract,frame:'first'}));}],
 ['foreign video',v=>{v.body=new TextEncoder().encode(JSON.stringify({...extract,videoUrl:'https://external.invalid/A.mp4'}));}],
 ['wrong known video',v=>{v.body=new TextEncoder().encode(JSON.stringify({...extract,videoUrl:origin+'/bj-video/B.mp4'}));}],
 ['foreign persist image',v=>{v.url=origin+'/api/save-image';v.body=new TextEncoder().encode(JSON.stringify({...persist,imageUrl:'https://external.invalid/raw.png'}));}],
 ['persist media mismatch',v=>{v.url=origin+'/api/save-image';v.body=new TextEncoder().encode(JSON.stringify({...persist,mediaType:'video'}));}],
 ['repeat extraction',v=>{v.count=2;}],
 ['unmatched audit',v=>{v.url=origin+'/api/activity';v.body=new TextEncoder().encode(JSON.stringify({action:'post_api_request',method:'POST',path:'/api/save-image',status:200,durationMs:4}));v.prior=[{path:'/api/video/extract-frame',status:200}];}],
 ['seventh audit',v=>{v.url=origin+'/api/activity';v.count=7;}],
 ['oversize body',v=>{v.body=new Uint8Array(2049);}],
 ['malformed JSON',v=>{v.body=new TextEncoder().encode('{');}],
];
for(const [name,mutate] of refusals){it('BL refuses '+name,()=>{const v=input();mutate(v);expect(()=>validateBLPost(v)).toThrow();});}
