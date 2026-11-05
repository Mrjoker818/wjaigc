// @vitest-environment jsdom
import React from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import NodeEditor from '@/components/node-editor';
import {createEmptyWorkflow,createWorkflowNode} from '@/lib/workflow-engine';
import type { Workflow, WorkflowNode } from '@/lib/workflow-engine';
import {CANVAS_ASSET_DRAG_MIME,serializeCanvasAssetDragPayload} from '@/lib/asset-core/workspace-transfer';

const image={id:'image-a',url:'/synthetic-a.png',name:'第一张',description:'第一张',projectId:'project-a',assetId:'asset-a',assetVersionId:'version-a',placementId:'source-a'};
const other={...createWorkflowNode('input-text',10,10,'无关节点'),id:'unrelated-node'};
const workflow={...createEmptyWorkflow('隔离恢复'),id:'recovery-workflow',nodes:[other]};
const reply={assetId:'asset-a',assetVersionId:'version-a',placementId:'workflow-a',url:image.url};
function deferred(){let resolve!:(r:Response)=>void;const promise=new Promise<Response>(r=>{resolve=r});return {promise,resolve}}
beforeEach(()=>{const m=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>m.set(k,v),removeItem:(k:string)=>m.delete(k),clear:()=>m.clear()});vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));vi.stubGlobal('ResizeObserver',class{observe(){} unobserve(){} disconnect(){}});vi.stubGlobal('BroadcastChannel',undefined);vi.stubGlobal('WebSocket',class{constructor(){throw Error('NETWORK_BLOCKED')}});vi.stubGlobal('XMLHttpRequest',class{constructor(){throw Error('NETWORK_BLOCKED')}})});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
async function setup(){
 let latest:Workflow|null=null;const posts:Array<{url:string,body:unknown,actor:string}>=[];const old=deferred(),fresh=deferred();
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);if((init?.method||'GET')==='GET')return Response.json({models:[],skills:[],workflows:[],presets:[]});
  if(url!=='/api/assets/transfer'&&url!=='/api/workflow/execute')throw Error('NETWORK_BLOCKED '+url);
  posts.push({url,body:JSON.parse(String(init?.body)),actor:new Headers(init?.headers).get('x-wujie-expected-actor-id')||''});
  if(url==='/api/workflow/execute')return Response.json({error:'NETWORK_BLOCKED'},{status:409});
  const n=posts.filter(p=>p.url==='/api/assets/transfer').length;
  if(n===1)return Response.json({error:'ACTOR_SCOPE_CHANGED'},{status:409});
  if(n===2)return old.promise;if(n===3)return fresh.promise;throw Error('UNEXPECTED_TRANSFER_'+n);
 }));
 const view=(actor='user-a',project='project-a',initial:Workflow=workflow)=><NodeEditor workflow={initial} rendererMode="legacy" projectId={project} userId={actor} canvasDocumentMode={false} canvasImages={[image]} taskModelCatalog={[]} taskModelOptions={[]} onWorkflowChange={v=>{if(v) latest=structuredClone(v)}}/>;
 const mounted=render(view());const surface=mounted.container.querySelector<HTMLElement>('.canvas-bg')!;
 const drop=new MouseEvent('drop',{bubbles:true,cancelable:true,clientX:200,clientY:200});Object.defineProperty(drop,'dataTransfer',{value:{getData:(type:string)=>type===CANVAS_ASSET_DRAG_MIME?serializeCanvasAssetDragPayload(image):''}});fireEvent(surface,drop);
 await screen.findByText(/账号已切换或不一致/);
 const getWorkflow = (): Workflow => { if (!latest) throw new Error('Workflow has not been observed'); return latest; };
 const getNode = (): WorkflowNode => { const node = getWorkflow().nodes.find(n=>n.type==='input-image'); if (!node) throw new Error('Image node missing'); return node; };
 return {mounted,view,posts,old,fresh,node:getNode,other:()=>getWorkflow().nodes.find(n=>n.id==='unrelated-node'),snapshot:()=>structuredClone(getWorkflow())};
}
describe('actor mismatch recovery boundaries',()=>{
 it('keeps an explicitly chosen upstream source, rejects old-image retry, and confirms safe source without modifying another node',async()=>{
  const x=await setup();const untouched=structuredClone(x.other());const field=screen.getByLabelText('名称') as HTMLInputElement;
  act(()=>field.focus());fireEvent.change(field,{target:{value:'未失焦的节点草稿'}});
  fireEvent.change(screen.getByRole('combobox',{name:'来源'}),{target:{value:'upstream'}});
  await waitFor(()=>expect(x.node()?.config.source).toBe('upstream'));
  const before=x.posts.length;fireEvent.click(screen.getByRole('button',{name:'重试接收图片'}));
  await act(async()=>{await new Promise(r=>setTimeout(r,60))});
  expect(x.posts).toHaveLength(before);expect(x.node().config.source).toBe('upstream');
  x.mounted.rerender(x.view('user-a','project-b'));
  expect(screen.queryByRole('button',{name:'确认使用上游图片'})).toBeNull();
  x.mounted.rerender(x.view('user-a','project-a'));
  fireEvent.click(screen.getByRole('button',{name:'确认使用上游图片'}));
  await waitFor(()=>expect(x.node()?.config.assetTransferPending).toBe(false));
  expect(x.node().config.source).toBe('upstream');expect(x.node().config.imageUrl||'').toBe('');
  expect(x.node().config.assetTransferError).toBeUndefined();expect(x.other()).toEqual(untouched);
  expect(field.value).toBe('未失焦的节点草稿');expect(document.activeElement).toBe(field);
  fireEvent.click(screen.getByRole('button',{name:'撤销'}));
  await waitFor(()=>expect(x.node()?.config.assetTransferError).toBe('ACTOR_SCOPE_CHANGED'));
  fireEvent.click(screen.getByRole('button',{name:'重做'}));
  await waitFor(()=>expect(x.node()?.config.assetTransferPending).toBe(false));
  expect(x.node().config.source).toBe('upstream');expect(x.other()).toEqual(untouched);
 });
 it('ABA permits the new retry and the old completion cannot release its lock',async()=>{
  const x=await setup();fireEvent.click(screen.getByRole('button',{name:'重试接收图片'}));await waitFor(()=>expect(x.posts).toHaveLength(2));
  x.mounted.rerender(x.view('user-b'));x.mounted.rerender(x.view('user-a'));
  fireEvent.click(screen.getByRole('button',{name:'重试接收图片'}));await waitFor(()=>expect(x.posts).toHaveLength(3));
  await act(async()=>{x.old.resolve(Response.json({error:'UNAVAILABLE'},{status:503}));await x.old.promise;await new Promise(r=>setTimeout(r,40))});
  fireEvent.click(screen.getByRole('button',{name:'重试接收图片'}));expect(x.posts).toHaveLength(3);
  await act(async()=>{x.fresh.resolve(Response.json(reply));await x.fresh.promise;await new Promise(r=>setTimeout(r,40))});
  await waitFor(()=>expect(x.node()?.config.placementId).toBe('workflow-a'));
  expect(x.posts.every(p=>p.actor==='user-a')).toBe(true);
 });
 it('explains that a blocked image prevents even an unrelated node retry without sending it',async()=>{
  const x=await setup();const saved=x.snapshot();x.mounted.unmount();
  const scope=JSON.stringify(['user-a','project-a',workflow.id]);
  localStorage.setItem(`wujie_workflow_exec_state:v2:${scope}`,JSON.stringify({executionId:'synthetic-execution',execStatus:'paused',execLogs:[{time:1,nodeId:'unrelated-node',label:'无关节点',status:'error',message:'历史失败'}],execResults:{}}));
  render(x.view('user-a','project-a',saved));fireEvent.click(screen.getByRole('button',{name:'切换执行日志面板'}));
  const retry=await screen.findByRole('button',{name:'重试此节点'});const before=x.posts.length;fireEvent.click(retry);
  expect(await screen.findByText(/有图片尚未接收.*无法重试/)).toBeTruthy();
  expect(x.posts).toHaveLength(before);expect(x.other()).toEqual(saved.nodes.find(n=>n.id==='unrelated-node'));
 });
});
