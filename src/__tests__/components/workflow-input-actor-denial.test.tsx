// @vitest-environment jsdom
import React from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import NodeEditor from '@/components/node-editor';
import type { Workflow, WorkflowNode } from '@/lib/workflow-engine';
import {createEmptyWorkflow} from '@/lib/workflow-engine';
import {CANVAS_ASSET_DRAG_MIME,serializeCanvasAssetDragPayload} from '@/lib/asset-core/workspace-transfer';

const workflow={...createEmptyWorkflow('隔离工作流'),id:'scope-workflow'};
const image={id:'synthetic-image',url:'/fixture-image.png',name:'合成图片',description:'合成图片',projectId:'project-a'};
const adopted={assetId:'asset-a',assetVersionId:'version-a',placementId:'placement-a',url:'/adopted.png'};
const transferred={assetId:'asset-a',assetVersionId:'version-a',placementId:'workflow-placement',url:'/fixture-image.png'};
beforeEach(()=>{const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k),clear:()=>storage.clear()});vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));vi.stubGlobal('ResizeObserver',class{observe(){} unobserve(){} disconnect(){}});vi.stubGlobal('BroadcastChannel',undefined);vi.stubGlobal('WebSocket',class{constructor(){throw Error('UNEXPECTED_WEBSOCKET')}});vi.stubGlobal('XMLHttpRequest',class{constructor(){throw Error('UNEXPECTED_XHR')}})});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
type Mode='adopt'|'transfer';
async function setup(stage:Mode,status:409|503){
 let release!:(r:Response)=>void;const held=new Promise<Response>(resolve=>{release=resolve});let attempts=0;let recovering: false | 200 | 503=false;const posts:string[]=[];const headers:string[]=[];let latest!:Workflow;
 const adoptedCallback=vi.fn();const frozen=structuredClone(image);
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);const method=init?.method||'GET';if(method==='GET')return Response.json({models:[],skills:[],workflows:[],presets:[]});
  if(url==='/api/workflow/execute'){posts.push(url);return Response.json({error:'SYNTHETIC_ONLY'},{status:409})}
  if(!['/api/assets/adopt-canvas-image','/api/assets/transfer'].includes(url))throw Error('NETWORK_BLOCKED '+url);
  posts.push(url);headers.push(new Headers(init?.headers).get('x-wujie-expected-actor-id')||'');
  if(recovering===503)return Response.json({error:'SYNTHETIC_UNAVAILABLE'},{status:503});
  if(recovering===200)return Response.json(url.endsWith('adopt-canvas-image')?adopted:transferred);
  if(url==='/api/assets/adopt-canvas-image'&&stage==='transfer')return Response.json(adopted);
  if((stage==='adopt'&&url.endsWith('adopt-canvas-image'))||(stage==='transfer'&&url.endsWith('/transfer'))){attempts++;return held}
  return Response.json(transferred);
 }));
 const mounted=render(<NodeEditor workflow={workflow} rendererMode="legacy" projectId="project-a" userId="user-a" canvasDocumentMode={false} canvasImages={[image]} taskModelCatalog={[]} taskModelOptions={[]} onWorkflowChange={v=>{if(v)latest=structuredClone(v)}} onCanvasImageAssetReferenceAdopted={adoptedCallback}/>);
 const surface=mounted.container.querySelector<HTMLElement>('.canvas-bg');expect(surface).not.toBeNull();
 const drop=new MouseEvent('drop',{bubbles:true,cancelable:true,clientX:200,clientY:200});Object.defineProperty(drop,'dataTransfer',{value:{getData:(type:string)=>type===CANVAS_ASSET_DRAG_MIME?serializeCanvasAssetDragPayload(image):''}});fireEvent(surface!,drop);
 await waitFor(()=>expect(attempts).toBe(1));
 const field=await screen.findByLabelText('名称') as HTMLInputElement;act(()=>field.focus());fireEvent.change(field,{target:{value:'尚未失焦的节点草稿'}});expect(document.activeElement).toBe(field);
 const r=status===409?Response.json({error:'ACTOR_SCOPE_CHANGED'},{status}):Response.json({error:'SYNTHETIC_UNAVAILABLE'},{status});
 await act(async()=>{release(r);await held;await new Promise(resolve=>setTimeout(resolve,80))});
 const current=()=>latest?.nodes?.find((n:WorkflowNode)=>n.type==='input-image');
 console.log('DENIAL_OBSERVATION',JSON.stringify({stage,status,config:current()?.config,alert:screen.queryByRole('alert')?.textContent||null,focused:document.activeElement===field,draft:field.value,posts,headers}));
 expect(image).toEqual(frozen);expect(field.value).toBe('尚未失焦的节点草稿');expect(document.activeElement).toBe(field);expect(headers.every(h=>h==='user-a')).toBe(true);
 return {field,current,posts,adoptedCallback,mounted,snapshot:()=>structuredClone(latest),recover:(code:200|503=200)=>{recovering=code}};
}
describe('legacy workflow input actor mismatch',()=>{
 it('a blocked A project intent cannot be retried in project B and remains recoverable in A',async()=>{
  const x=await setup('adopt',409);const saved=x.snapshot();x.mounted.unmount();
  let latest!:Workflow;const view=(projectId:string)=><NodeEditor workflow={saved} rendererMode="legacy" projectId={projectId} userId="user-a" canvasDocumentMode={false} canvasImages={[image]} taskModelCatalog={[]} taskModelOptions={[]} onWorkflowChange={v=>{if(v)latest=structuredClone(v)}}/>;
  const mounted=render(view('project-b'));x.recover();const before=x.posts.length;
  fireEvent.click(screen.getByRole('button',{name:'重试接收图片'}));
  await act(async()=>{await new Promise(r=>setTimeout(r,100))});
  expect(x.posts).toHaveLength(before);
  expect(screen.getByRole('alert').textContent).toMatch(/原项目/);
  mounted.rerender(view('project-a'));fireEvent.click(screen.getByRole('button',{name:'重试接收图片'}));
  await waitFor(()=>expect(latest?.nodes?.find((n:WorkflowNode)=>n.type==='input-image')?.config.placementId).toBe('workflow-placement'));
  expect(x.posts.length).toBeGreaterThan(before);
 });
 it('a blocked A project intent offers no old-intent image selection in B',async()=>{
  const x=await setup('adopt',409);const saved=x.snapshot();x.mounted.unmount();x.recover();
  render(<NodeEditor workflow={saved} rendererMode="legacy" projectId="project-b" userId="user-a" canvasDocumentMode={false} canvasImages={[image]} taskModelCatalog={[]} taskModelOptions={[]}/>);
  const before=x.posts.length;fireEvent.click(screen.getByRole('button',{name:'重新选择图片'}));
  expect(screen.getByRole('alert').textContent).toMatch(/原项目/);
  expect(screen.queryByRole('button',{name:'合成图片'})).toBeNull();
  expect(x.posts).toHaveLength(before);
 });
 it('the ordinary property-panel selection cannot bypass the project guard or discard the draft',async()=>{
  const x=await setup('adopt',409);const saved=x.snapshot();x.recover();
  x.mounted.rerender(<NodeEditor workflow={saved} rendererMode="legacy" projectId="project-b" userId="user-a" canvasDocumentMode={false} canvasImages={[image]} taskModelCatalog={[]} taskModelOptions={[]}/>);
  const field=await screen.findByLabelText('名称') as HTMLInputElement;act(()=>field.focus());fireEvent.change(field,{target:{value:'当前项目的未提交草稿'}});
  const preview=screen.getByAltText('预览');const clear=preview.parentElement?.querySelector('button');expect(clear).not.toBeNull();fireEvent.click(clear!);
  fireEvent.click(screen.getByRole('button',{name:'从画布选择图片'}));const before=x.posts.length;
  fireEvent.click(screen.getByRole('button',{name:/1\. 合成图片/}));
  await act(async()=>{await new Promise(r=>setTimeout(r,100))});
  expect(x.posts).toHaveLength(before);expect(field.value).toBe('当前项目的未提交草稿');expect(document.activeElement).toBe(field);
 });
 it('changing source in the wrong project does not clear the blocked execution protection',async()=>{
  const x=await setup('adopt',409);const saved=x.snapshot();x.recover();
  x.mounted.rerender(<NodeEditor workflow={saved} rendererMode="legacy" projectId="project-b" userId="user-a" canvasDocumentMode={false} canvasImages={[image]} taskModelCatalog={[]} taskModelOptions={[]}/>);
  fireEvent.change(screen.getByRole('combobox',{name:'来源'}),{target:{value:'url'}});
  const before=x.posts.length;fireEvent.click(screen.getByRole('button',{name:'执行工作流'}));
  await act(async()=>{await new Promise(r=>setTimeout(r,100))});
  expect(x.posts).toHaveLength(before);expect(screen.getByText('图片资产正在同步，请完成后再运行工作流')).toBeTruthy();
 });
 it('legacy blocked intents without a recorded target project fail closed',async()=>{
  const x=await setup('adopt',409);const saved=x.snapshot();const n=saved.nodes.find((v:WorkflowNode)=>v.type==='input-image')!;delete n.config.assetTransferExpectedProjectId;x.mounted.unmount();x.recover();
  render(<NodeEditor workflow={saved} rendererMode="legacy" projectId="project-a" userId="user-a" canvasDocumentMode={false} canvasImages={[image]} taskModelCatalog={[]} taskModelOptions={[]}/>);
  const before=x.posts.length;fireEvent.click(screen.getByRole('button',{name:'重试接收图片'}));fireEvent.click(screen.getByRole('button',{name:'重新选择图片'}));
  await act(async()=>{await new Promise(r=>setTimeout(r,100))});expect(x.posts).toHaveLength(before);
  expect(screen.getByRole('alert').textContent).toMatch(/无法确认.*项目/);
  expect(screen.queryByRole('button',{name:'合成图片'})).toBeNull();
 });
 it.each(['adopt','transfer'] as const)('%s 409 blocks input and provides recovery without losing draft',async stage=>{
  const x=await setup(stage,409);expect(x.current()?.config.assetTransferPending).toBe(true);expect(screen.queryByRole('alert')?.textContent).toMatch(/账号.*切换|账号.*不一致/);expect(screen.queryByRole('alert')?.textContent).toMatch(/重新选择/);
  x.recover();fireEvent.click(screen.getByRole('button',{name:'重试接收图片'}));
  await waitFor(()=>expect(x.current()?.config.placementId).toBe('workflow-placement'));expect(x.current()?.config.assetTransferPending).toBe(false);expect(x.field.value).toBe('尚未失焦的节点草稿');
 });
 it.each(['adopt','transfer'] as const)('%s 503 keeps original legacy fallback and draft',async stage=>{
  const x=await setup(stage,503);expect(x.current()?.config.assetTransferPending).toBe(false);expect(x.current()?.config.imageUrl).toBe(image.url);expect(x.current()?.config.assetVersionId).toBeUndefined();expect(screen.queryByRole('alert')?.textContent||'').not.toMatch(/账号.*切换|账号.*不一致/);
 });
 it('a 503 retry after an actor mismatch does not unlock the previously blocked node',async()=>{
  const x=await setup('adopt',409);expect(x.current()?.config.assetTransferPending).toBe(true);const count=x.posts.length;x.recover(503);fireEvent.click(screen.getByRole('button',{name:'重试接收图片'}));await waitFor(()=>expect(x.posts.length).toBe(count+1));await act(async()=>{await new Promise(r=>setTimeout(r,80))});expect(x.current()?.config.assetTransferPending).toBe(true);expect(screen.getByRole('alert').textContent).toMatch(/账号/);expect(x.field.value).toBe('尚未失焦的节点草稿');
  x.recover(200);fireEvent.click(screen.getByRole('button',{name:'重试接收图片'}));await waitFor(()=>expect(x.current()?.config.placementId).toBe('workflow-placement'));expect(x.current()?.config.assetTransferPending).toBe(false);
 });
 it('the normal workflow run remains blocked while the actor mismatch is unresolved',async()=>{
  const x=await setup('adopt',409);const before=x.posts.length;fireEvent.click(screen.getByRole('button',{name:'执行工作流'}));await screen.findByText('图片资产正在同步，请完成后再运行工作流');expect(x.posts.length).toBe(before);expect(x.current()?.config.assetTransferPending).toBe(true);expect(x.field.value).toBe('尚未失焦的节点草稿');
 });
 it('a reopened editor preserves a recoverable actor mismatch notice for the saved blocked node',async()=>{
  const x=await setup('adopt',409);const saved=x.snapshot();expect(saved.nodes.find((n:WorkflowNode)=>n.type==='input-image')!.config.assetTransferPending).toBe(true);x.mounted.unmount();
  let reopened!:Workflow;const b=render(<NodeEditor workflow={saved} rendererMode="legacy" projectId="project-a" userId="user-b" canvasDocumentMode={false} canvasImages={[image]} taskModelCatalog={[]} taskModelOptions={[]}/>);
  const before=x.posts.length;fireEvent.click(screen.getByRole('button',{name:'重试接收图片'}));expect(x.posts.length).toBe(before);expect(screen.queryByRole('alert')?.textContent).toMatch(/账号/);b.unmount();
  render(<NodeEditor workflow={saved} rendererMode="legacy" projectId="project-a" userId="user-a" canvasDocumentMode={false} canvasImages={[image]} taskModelCatalog={[]} taskModelOptions={[]} onWorkflowChange={v=>{if(v)reopened=structuredClone(v)}}/>);
  expect(screen.queryByRole('button',{name:'重试接收图片'})).not.toBeNull();expect(screen.queryByRole('alert')?.textContent).toMatch(/账号/);x.recover();fireEvent.click(screen.getByRole('button',{name:'重试接收图片'}));await waitFor(()=>expect(reopened?.nodes?.find((n:WorkflowNode)=>n.type==='input-image')?.config.placementId).toBe('workflow-placement'));expect(reopened.nodes.find((n:WorkflowNode)=>n.type==='input-image')!.config.assetTransferPending).toBe(false);
 });
 it('retrying an old execution cannot bypass a blocked input',async()=>{
  const x=await setup('adopt',409);const saved=x.snapshot();const node=saved.nodes.find((n:WorkflowNode)=>n.type==='input-image')!;x.mounted.unmount();
  const scope=JSON.stringify(['user-a','project-a',workflow.id]);localStorage.setItem(`wujie_workflow_exec_state:v2:${scope}`,JSON.stringify({executionId:'synthetic-execution',execStatus:'paused',execLogs:[{time:1,nodeId:node.id,label:'合成节点',status:'error',message:'历史失败'}],execResults:{}}));
  render(<NodeEditor workflow={saved} rendererMode="legacy" projectId="project-a" userId="user-a" canvasDocumentMode={false} canvasImages={[image]} taskModelCatalog={[]} taskModelOptions={[]}/>);
  fireEvent.click(screen.getByRole('button',{name:'切换执行日志面板'}));const retry=await screen.findByRole('button',{name:'重试此节点'});const before=x.posts.length;fireEvent.click(retry);await act(async()=>{await new Promise(r=>setTimeout(r,100))});
  console.log('OLD_EXECUTION_RETRY',JSON.stringify({before,after:x.posts,blockedNode:node.id}));expect(x.posts.length).toBe(before);
 });
});
