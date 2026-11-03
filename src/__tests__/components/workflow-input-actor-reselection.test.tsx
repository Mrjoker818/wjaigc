// @vitest-environment jsdom
import React from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import NodeEditor from '@/components/node-editor';
import type { Workflow, WorkflowNode } from '@/lib/workflow-engine';
import {createEmptyWorkflow} from '@/lib/workflow-engine';
import {CANVAS_ASSET_DRAG_MIME,serializeCanvasAssetDragPayload} from '@/lib/asset-core/workspace-transfer';
const wf={...createEmptyWorkflow('隔离重选'),id:'reselect-workflow'};
const a={id:'image-a',url:'/synthetic-a.png',name:'第一张图片',description:'第一张图片',projectId:'project-a'};
const b={id:'image-b',url:'/synthetic-b.png',name:'第二张图片',description:'第二张图片',projectId:'project-a',assetId:'asset-b',assetVersionId:'version-b',placementId:'canvas-b'};
const result={assetId:'asset-b',assetVersionId:'version-b',placementId:'workflow-b',url:'/synthetic-b.png'};
beforeEach(()=>{const m=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>m.set(k,v),removeItem:(k:string)=>m.delete(k),clear:()=>m.clear()});vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));vi.stubGlobal('ResizeObserver',class{observe(){} unobserve(){} disconnect(){}});vi.stubGlobal('BroadcastChannel',undefined);vi.stubGlobal('WebSocket',class{constructor(){throw Error('BLOCKED')}});vi.stubGlobal('XMLHttpRequest',class{constructor(){throw Error('BLOCKED')}})});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
async function start(mode:'success'|'unavailable'|'held'){
 let latest!:Workflow;let delivery=mode;let finish!:(r:Response)=>void;const waiting=new Promise<Response>(resolve=>{finish=resolve});const posts:Array<{url:string,body:Record<string, unknown>}>=[];
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input),method=init?.method||'GET';if(method==='GET')return Response.json({models:[],skills:[],workflows:[],presets:[]});
  if(url==='/api/assets/adopt-canvas-image'){posts.push({url,body:JSON.parse(String(init?.body))});return Response.json({error:'ACTOR_SCOPE_CHANGED'},{status:409})}
  if(url==='/api/assets/transfer'){posts.push({url,body:JSON.parse(String(init?.body))});if(delivery==='unavailable')return Response.json({error:'UNAVAILABLE'},{status:503});if(delivery==='held')return waiting;return Response.json(result)}throw Error('NETWORK_BLOCKED '+url);
 }));
 const view=(initial:Workflow,onChange=(v:Workflow|null)=>{if(v)latest=structuredClone(v)})=><NodeEditor workflow={initial} rendererMode="legacy" projectId="project-a" userId="user-a" canvasDocumentMode={false} canvasImages={[a,b]} taskModelCatalog={[]} taskModelOptions={[]} onWorkflowChange={onChange}/>;
 const mounted=render(view(wf));const surface=mounted.container.querySelector<HTMLElement>('.canvas-bg')!;const drop=new MouseEvent('drop',{bubbles:true,cancelable:true,clientX:200,clientY:200});Object.defineProperty(drop,'dataTransfer',{value:{getData:(t:string)=>t===CANVAS_ASSET_DRAG_MIME?serializeCanvasAssetDragPayload(a):''}});fireEvent(surface,drop);
 await screen.findByText(/账号已切换或不一致/);const node=()=>latest?.nodes?.find((n:WorkflowNode)=>n.type==='input-image');expect(node()?.config.assetTransferPending).toBe(true);
 const preview=screen.getByAltText('预览');const clear=preview.parentElement?.querySelector('button');expect(clear).not.toBeNull();fireEvent.click(clear!);fireEvent.click(screen.getByRole('button',{name:'从画布选择图片'}));fireEvent.click(screen.getByRole('button',{name:/2\. 第二张图片/}));
 await waitFor(()=>expect(posts.some(p=>p.url==='/api/assets/transfer'&&p.body.sourceVersion==='version-b')).toBe(true));
 await act(async()=>{await new Promise(r=>setTimeout(r,80))});
 return {node,mounted,posts,view,snapshot:()=>structuredClone(latest),succeed:()=>{delivery='success'},finish:()=>finish(Response.json(result))};
}
describe('explicit replacement after actor mismatch',()=>{
 it('successful replacement installs B and removes stale actor markers',async()=>{const x=await start('success');await waitFor(()=>expect(x.node()?.config.placementId).toBe('workflow-b'));expect(x.node()!.config.assetTransferPending).toBe(false);expect(x.node()!.config.assetTransferError).toBeUndefined();expect(x.node()!.config.assetTransferExpectedSource).toBeUndefined()});
 it('503 after replacement retains the block for B and can retry B',async()=>{const x=await start('unavailable');expect(x.node()?.config.assetTransferPending).toBe(true);expect((x.node()?.config.assetTransferExpectedSource as {id?:string} | undefined)?.id).toBe('image-b');x.succeed();fireEvent.click(screen.getByRole('button',{name:'重试接收图片'}));await waitFor(()=>expect(x.node()?.config.placementId).toBe('workflow-b'));expect(x.posts.at(-1)?.body.sourceVersion).toBe('version-b')});
 it('while replacement is pending its retained identity points at the selected image',async()=>{const x=await start('held');expect(x.node()?.config.assetTransferPending).toBe(true);expect((x.node()?.config.assetTransferExpectedSource as {id?:string} | undefined)?.id).toBe('image-b');await act(async()=>{x.finish();await new Promise(r=>setTimeout(r,50))})});
 it('undo during a pending replacement prevents its late result from overwriting restored state',async()=>{const x=await start('held');fireEvent.click(screen.getByRole('button',{name:'撤销'}));await act(async()=>{await new Promise(r=>setTimeout(r,80))});const before=x.node()?structuredClone(x.node()!.config):null;await act(async()=>{x.finish();await new Promise(r=>setTimeout(r,80))});console.log('RESELECT_UNDO_TRACE',JSON.stringify({before,after:x.node()?.config}));expect(x.node()?.config??null).toEqual(before)});
 it('reopening after B 503 preserves B block and retry',async()=>{const x=await start('unavailable');const saved=x.snapshot();const n=saved.nodes.find((n:WorkflowNode)=>n.type==='input-image')!;expect((n.config.assetTransferExpectedSource as {id?:string} | undefined)?.id).toBe('image-b');x.mounted.unmount();let latest!:Workflow;render(x.view(saved,v=>{if(v)latest=structuredClone(v)}));x.succeed();fireEvent.click(screen.getByRole('button',{name:'重试接收图片'}));await waitFor(()=>expect(latest?.nodes?.find((n:WorkflowNode)=>n.type==='input-image')?.config.placementId).toBe('workflow-b'));});
});
