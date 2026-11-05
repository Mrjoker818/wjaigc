// @vitest-environment jsdom
import React from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import NodeEditor from '@/components/node-editor';
import type { Workflow, WorkflowNode } from '@/lib/workflow-engine';
import {createEmptyWorkflow,createWorkflowNode} from '@/lib/workflow-engine';
import {CANVAS_ASSET_DRAG_MIME,serializeCanvasAssetDragPayload} from '@/lib/asset-core/workspace-transfer';

const a={id:'image-a',url:'/synthetic-a.png',name:'第一张图片',description:'第一张图片',projectId:'project-a'};
const b={id:'image-b',url:'/synthetic-b.png',name:'第二张图片',description:'第二张图片',projectId:'project-a',assetId:'asset-b',assetVersionId:'version-b',placementId:'canvas-b'};
const c={id:'image-c',url:'/synthetic-c.png',name:'第三张图片',description:'第三张图片',projectId:'project-a',assetId:'asset-c',assetVersionId:'version-c',placementId:'canvas-c'};
const expected=(image:typeof c)=>({id:image.id,url:image.url,projectId:image.projectId,assetVersionId:image.assetVersionId,placementId:image.placementId});
beforeEach(()=>{const m=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>m.set(k,v),removeItem:(k:string)=>m.delete(k),clear:()=>m.clear()});vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));vi.stubGlobal('ResizeObserver',class{observe(){} unobserve(){} disconnect(){}});vi.stubGlobal('BroadcastChannel',undefined);vi.stubGlobal('WebSocket',class{constructor(){throw Error('BLOCKED')}});vi.stubGlobal('XMLHttpRequest',class{constructor(){throw Error('BLOCKED')}})});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});

async function setup(){
 const prior=createWorkflowNode('input-image',30,30,'其他待恢复节点');
 prior.id='other-node';
 prior.config={...prior.config,imageUrl:c.url,source:'canvas',sourceImageId:c.id,assetTransferPending:true,assetTransferError:'ACTOR_SCOPE_CHANGED',assetTransferExpectedActorId:'user-a',assetTransferExpectedProjectId:'project-a',assetTransferExpectedSource:expected(c)};
 const workflow={...createEmptyWorkflow('隔离多节点'),id:'multi-node-workflow',nodes:[prior]};
 let latest:Workflow=structuredClone(workflow);let releaseB!:(r:Response)=>void;let releaseC!:(r:Response)=>void;let immediate=false;
 const heldB=new Promise<Response>(resolve=>{releaseB=resolve}),heldC=new Promise<Response>(resolve=>{releaseC=resolve});
 const posts:Array<{url:string,body:Record<string, unknown>,actor:string}>=[];
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),method=init?.method||'GET';if(method==='GET')return Response.json({models:[],skills:[],workflows:[],presets:[]});
  const body=JSON.parse(String(init?.body));posts.push({url,body,actor:new Headers(init?.headers).get('x-wujie-expected-actor-id')||''});
  if(url==='/api/assets/adopt-canvas-image')return immediate
   ? Response.json({assetId:'asset-a',assetVersionId:'version-a',placementId:'canvas-a',url:a.url})
   : Response.json({error:'ACTOR_SCOPE_CHANGED'},{status:409});
  if(url==='/api/assets/transfer'){
   const result={assetId:body.sourceVersion==='version-c'?'asset-c':body.sourceVersion==='version-a'?'asset-a':'asset-b',assetVersionId:body.sourceVersion,placementId:'workflow-'+body.sourceVersion,url:body.sourceVersion==='version-c'?c.url:body.sourceVersion==='version-a'?a.url:b.url};
   if(immediate)return Response.json(result);
   if(body.sourceVersion==='version-c')return heldC;
   if(body.sourceVersion==='version-b')return heldB;
  }
  throw Error('NETWORK_BLOCKED '+url);
 }));
 const mounted=render(<NodeEditor workflow={workflow} rendererMode="legacy" projectId="project-a" userId="user-a" canvasDocumentMode={false} canvasImages={[a,b,c]} taskModelCatalog={[]} taskModelOptions={[]} onWorkflowChange={v=>{if(v)latest=structuredClone(v)}}/>);
 const surface=mounted.container.querySelector<HTMLElement>('.canvas-bg')!;
 const drop=new MouseEvent('drop',{bubbles:true,cancelable:true,clientX:200,clientY:200});Object.defineProperty(drop,'dataTransfer',{value:{getData:(t:string)=>t===CANVAS_ASSET_DRAG_MIME?serializeCanvasAssetDragPayload(a):''}});fireEvent(surface,drop);
 await waitFor(()=>expect(screen.getAllByRole('alert')).toHaveLength(2));
 const target=()=>latest.nodes.find((n:WorkflowNode)=>n.id!=='other-node');
 const other=()=>latest.nodes.find((n:WorkflowNode)=>n.id==='other-node');
 const alerts=screen.getAllByRole('alert');fireEvent.click(within(alerts[0]!).getByRole('button',{name:'重试接收图片'}));
 await waitFor(()=>expect(posts.some(p=>p.body.sourceVersion==='version-c')).toBe(true));
 const preview=screen.getByAltText('预览');const clear=preview.parentElement?.querySelector('button');expect(clear).not.toBeNull();fireEvent.click(clear!);fireEvent.click(screen.getByRole('button',{name:'从画布选择图片'}));fireEvent.click(screen.getByRole('button',{name:/2\. 第二张图片/}));
 await waitFor(()=>expect(posts.some(p=>p.body.sourceVersion==='version-b')).toBe(true));
 return {target,other,posts,releaseB,releaseC,immediate:()=>{immediate=true}};
}

describe('independent blocked inputs and history',()=>{
 it('reselection rejects the wrong account and a 503 remains blocked until a successful retry',async()=>{
  const node=createWorkflowNode('input-image',20,20,'账号保护');
  node.id='blocked-node';
  node.config={...node.config,imageUrl:'',source:'canvas',sourceImageId:c.id,assetTransferPending:true,assetTransferError:'ACTOR_SCOPE_CHANGED',assetTransferExpectedActorId:'user-a',assetTransferExpectedProjectId:'project-a',assetTransferExpectedSource:expected(c)};
  const workflow={...createEmptyWorkflow('账号隔离'),id:'account-workflow',nodes:[node]};
  let latest:Workflow=structuredClone(workflow);let unavailable=true;const posts:Array<{actor:string,body:Record<string, unknown>}>=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
   if((init?.method||'GET')==='GET')return Response.json({models:[],skills:[],workflows:[],presets:[]});
   if(String(input)!=='/api/assets/transfer')throw Error('NETWORK_BLOCKED '+String(input));
   posts.push({actor:new Headers(init?.headers).get('x-wujie-expected-actor-id')||'',body:JSON.parse(String(init?.body))});
   return unavailable?Response.json({error:'UNAVAILABLE'},{status:503}):Response.json({assetId:'asset-c',assetVersionId:'version-c',placementId:'workflow-c',url:c.url});
  }));
  const view=(userId:string)=><NodeEditor workflow={workflow} rendererMode="legacy" projectId="project-a" userId={userId} canvasDocumentMode={false} canvasImages={[c]} taskModelCatalog={[]} taskModelOptions={[]} onWorkflowChange={v=>{if(v)latest=structuredClone(v)}}/>;
  const mounted=render(view('user-b'));fireEvent.click(screen.getByRole('button',{name:'重新选择图片'}));
  expect(screen.getByText(/请先切回原账号/)).toBeTruthy();expect(screen.queryByRole('button',{name:'第三张图片'})).toBeNull();expect(posts).toHaveLength(0);
  mounted.rerender(view('user-a'));fireEvent.click(screen.getByRole('button',{name:'第三张图片'}));
  await waitFor(()=>expect(posts).toHaveLength(1));
  await act(async()=>{await new Promise(r=>setTimeout(r,80))});
  await waitFor(()=>expect((latest.nodes[0].config.assetTransferExpectedSource as {id?:string} | undefined)?.id).toBe('image-c'));
  expect(latest.nodes[0].config.assetTransferPending).toBe(true);expect(latest.nodes[0].config.assetTransferError).toBe('ACTOR_SCOPE_CHANGED');
  unavailable=false;fireEvent.click(screen.getByRole('button',{name:'重试接收图片'}));
  await waitFor(()=>expect(latest.nodes[0].config.placementId).toBe('workflow-c'));
  expect(posts.every(p=>p.actor==='user-a'&&p.body.sourceVersion==='version-c')).toBe(true);
 });
 it('after undo with empty URL the user can explicitly reselect the original image while another recovery and a draft remain intact',async()=>{
  const x=await setup();fireEvent.click(screen.getByRole('button',{name:'撤销'}));
  expect(x.target()?.config.imageUrl).toBe('');
  const field=screen.getByLabelText('名称') as HTMLInputElement;act(()=>field.focus());fireEvent.change(field,{target:{value:'尚未失焦的独立草稿'}});
  const before=x.posts.length;
  const targetAlert=screen.getAllByRole('alert')[1]!;
  fireEvent.click(within(targetAlert).getByRole('button',{name:'重新选择图片'}));
  expect(x.posts.length).toBe(before);
  x.immediate();
  fireEvent.click(within(targetAlert).getByRole('button',{name:/第一张图片/}));
  await waitFor(()=>expect(x.target()?.config.placementId).toBe('workflow-version-a'));
  expect(field.value).toBe('尚未失焦的独立草稿');expect(document.activeElement).toBe(field);
  expect(x.posts.slice(before).map(p=>p.url)).toEqual(['/api/assets/adopt-canvas-image','/api/assets/transfer']);
  expect(x.posts.slice(before).every(p=>p.actor==='user-a')).toBe(true);
  await act(async()=>{x.releaseB(Response.json({assetId:'asset-b',assetVersionId:'version-b',placementId:'late-b',url:b.url}));x.releaseC(Response.json({assetId:'asset-c',assetVersionId:'version-c',placementId:'workflow-version-c',url:c.url}));await new Promise(r=>setTimeout(r,80))});
  expect(x.target()?.config.placementId).toBe('workflow-version-a');
  expect(x.other()?.config.placementId).toBe('workflow-version-c');
  expect(x.target()?.config.assetTransferPending).toBe(false);
 });
 it('undo and redo of a node rename keep both pending recoveries current',async()=>{
  const x=await setup();
  const field=screen.getByLabelText('名称') as HTMLInputElement;
  fireEvent.change(field,{target:{value:'用户更名'}});fireEvent.blur(field);
  await waitFor(()=>expect(x.target()?.label).toBe('用户更名'));
  fireEvent.click(screen.getByRole('button',{name:'撤销'}));
  await waitFor(()=>expect(x.target()?.label).not.toBe('用户更名'));
  fireEvent.click(screen.getByRole('button',{name:'重做'}));
  await waitFor(()=>expect(x.target()?.label).toBe('用户更名'));
  await act(async()=>{x.releaseB(Response.json({assetId:'asset-b',assetVersionId:'version-b',placementId:'workflow-version-b',url:b.url}));x.releaseC(Response.json({assetId:'asset-c',assetVersionId:'version-c',placementId:'workflow-version-c',url:c.url}));await new Promise(r=>setTimeout(r,80))});
  expect(x.target()?.config.placementId).toBe('workflow-version-b');
  expect(x.target()?.label).toBe('用户更名');
  expect(x.other()?.config.placementId).toBe('workflow-version-c');
 });
 it.each([false,true])('undo%s does not cancel the other node and stale selected-image result cannot overwrite history',async redo=>{
  const x=await setup();fireEvent.click(screen.getByRole('button',{name:'撤销'}));
  if(redo)fireEvent.click(screen.getByRole('button',{name:'重做'}));
  const before=structuredClone(x.target()?.config);
  await act(async()=>{x.releaseB(Response.json({assetId:'asset-b',assetVersionId:'version-b',placementId:'workflow-version-b',url:b.url}));x.releaseC(Response.json({assetId:'asset-c',assetVersionId:'version-c',placementId:'workflow-version-c',url:c.url}));await new Promise(r=>setTimeout(r,80))});
  expect(x.target()?.config).toEqual(before);
  expect(x.other()?.config.placementId).toBe('workflow-version-c');
  expect(x.other()?.config.assetTransferPending).toBe(false);
  expect(x.posts.every(p=>p.actor==='user-a')).toBe(true);
  console.log('HISTORY_TARGET',JSON.stringify({redo,config:x.target()?.config}));
  x.immediate();
  if(redo){
   const alert=screen.getByRole('alert');
   fireEvent.click(within(alert).getByRole('button',{name:'重试接收图片'}));
  } else {
   fireEvent.click(screen.getByRole('button',{name:'从画布选择图片'}));
   fireEvent.click(screen.getByRole('button',{name:/2\. 第二张图片/}));
  }
  await waitFor(()=>expect(x.target()?.config.placementId).toBe('workflow-version-b'));
 });
});
