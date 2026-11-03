import {validateBJPost,type BJPostInput,type BJPostReceipt} from './video-plan-bj-post-contract';
export interface BLPostInput extends BJPostInput {audited?:ReadonlyArray<{path:string;status:number}>}
export type BLPostReceipt=BJPostReceipt;
function exact(body:Record<string,unknown>,expected:Record<string,unknown>):boolean {
 return JSON.stringify(Object.keys(body).sort())===JSON.stringify(Object.keys(expected).sort())
  && Object.entries(expected).every(([key,value])=>Object.is(body[key],value));
}
export function validateBLPost(input:BLPostInput):BLPostReceipt {
 const origin='https://canvas-shell-mobile.invalid',url=new URL(input.url);
 const oldPaths=['/api/video/director/prompt','/api/video/director/shot-plan','/api/video/tools'];
 if(oldPaths.includes(url.pathname))return validateBJPost(input);
 const paths=[...oldPaths,'/api/video/extract-frame','/api/save-image','/api/video/director/diagnose'];
 if(input.method!=='POST'||url.origin!==origin||url.username||url.password||url.search||url.hash
  ||![...paths,'/api/activity'].includes(url.pathname))throw Error('BL_POST_BOUNDARY');
 const headers=Object.fromEntries(Object.entries(input.headers).map(([key,value])=>[key.toLowerCase(),value]));
 if(['authorization','cookie','x-api-key','api-key','idempotency-key'].some(key=>key in headers)
  ||headers['content-type']!=='application/json')throw Error('BL_POST_HEADERS');
 const max=url.pathname==='/api/activity'?6:url.pathname==='/api/video/director/diagnose'?2:1;
 if(!Number.isInteger(input.count)||input.count<1||input.count>max)throw Error('BL_POST_COUNT');
 if(!input.body||input.body.byteLength>2048)throw Error('BL_POST_BODY_LIMIT');
 let parsed:unknown;
 try{parsed=JSON.parse(new TextDecoder().decode(input.body));}catch{throw Error('BL_POST_JSON');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('BL_POST_OBJECT');
 const body=parsed as Record<string,unknown>,pathname=url.pathname;
 if(pathname==='/api/video/extract-frame'){
  if(!exact(body,{videoUrl:origin+'/bj-video/A.mp4',frame:'last'}))throw Error('BL_POST_EXTRACT');
 }else if(pathname==='/api/save-image'){
  if(!exact(body,{imageUrl:origin+'/bl-frame/raw.png',mediaType:'image'}))throw Error('BL_POST_PERSIST');
 }else if(pathname==='/api/video/director/diagnose'){
  const shot=body.shot;
  if(!shot||typeof shot!=='object'||Array.isArray(shot))throw Error('BL_POST_SHOT');
  const record=shot as Record<string,unknown>,id=record.id;
  if((id!=='A'&&id!=='B')||!exact(record,{id,title:'BJ-'+id})
   ||!exact(body,{prompt:id==='A'?'BJ-A海岸起步':'BJ-B海岸远景',issue:'BL synthetic '+id+' failed',
    model:'bg-offline::kling-v3-video-generation',aspectRatio:'16:9',duration:10,shot}))throw Error('BL_POST_DIAGNOSE');
 }else{
  const audited=input.audited??[],duration=body.durationMs;
  if(input.count!==audited.length+1||typeof body.path!=='string'||!paths.includes(body.path)
   ||typeof duration!=='number'||!Number.isInteger(duration)||duration<0||duration>25000
   ||!exact(body,{action:'post_api_request',method:'POST',path:body.path,status:200,durationMs:duration}))throw Error('BL_POST_ACTIVITY');
  const matching=(entry:{path:string;status:number}):boolean=>entry.path===body.path&&entry.status===200;
  // AuditClient sends receipts without waiting for them: acknowledge only an
  // actual unconsumed response, without inventing an arrival-order guarantee.
  if(input.prior.filter(matching).length<=audited.filter(matching).length)throw Error('BL_POST_ACTIVITY_UNMATCHED');
 }
 return {path:pathname,body};
}
