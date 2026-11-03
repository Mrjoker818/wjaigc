// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NodeEditor from '@/components/node-editor';
import { createEmptyWorkflow, type Workflow, type WorkflowNode } from '@/lib/workflow-engine';
import { CANVAS_ASSET_DRAG_MIME, serializeCanvasAssetDragPayload } from '@/lib/asset-core/workspace-transfer';

const image = { id: 'image-a', url: '/synthetic.png', name: '素材A', description: '素材A',
  versionId: 'source-v', projectId: 'project-a', assetId: 'asset-a', assetVersionId: 'asset-v', placementId: 'canvas-p' };
const original = { ...createEmptyWorkflow('synthetic'), id: 'workflow-a' };
let unexpectedGets: string[] = [];
beforeEach(() => { unexpectedGets = [];
  const storage = new Map<string,string>();
  vi.stubGlobal('localStorage', {getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),
    removeItem:(k:string)=>storage.delete(k),clear:()=>storage.clear()});
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('WebSocket', class { constructor(){throw Error('UNEXPECTED_WEBSOCKET');} });
  vi.stubGlobal('XMLHttpRequest', class { constructor(){throw Error('UNEXPECTED_XHR');} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); expect(unexpectedGets).toEqual([]); });

async function setup() {
  let release!: (r:Response)=>void, markConsumed!:()=>void;
  const held=new Promise<Response>(resolve=>{release=resolve;});
  const consumed=new Promise<void>(resolve=>{markConsumed=resolve;});
  const response=Response.json({assetId:'asset-a',assetVersionId:'asset-v',placementId:'workflow-p',url:'/canonical.png'});
  const json=response.json.bind(response);
  response.json=async()=>{try{return await json();}finally{markConsumed();}};
  const posts:Array<{url:string;body:Record<string,unknown>;actor:string|null}>=[];
  let latest:Workflow=structuredClone(original), released=false;
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input),method=init?.method||'GET';
    if(method==='GET'){
      if(url!=='/api/skills?surface=workflow'){unexpectedGets.push(method+' '+url);throw Error('BLOCKED:'+method+' '+url);}
      return Response.json({models:[],skills:[],workflows:[],presets:[]});
    }
    if(url!=='/api/assets/transfer'||method!=='POST')throw Error('BLOCKED:'+method+' '+url);
    const body: unknown = JSON.parse(String(init?.body));
    if(typeof body!=='object'||body===null||Array.isArray(body))throw Error('INVALID_REQUEST_BODY');
    posts.push({url,body:body as Record<string,unknown>,actor:new Headers(init?.headers).get('x-wujie-expected-actor-id')});
    return held;
  }));
  const view=render(<NodeEditor workflow={original} rendererMode="legacy" projectId="project-a" userId="actor-a"
    canvasDocumentMode={false} canvasImages={[image]} taskModelCatalog={[]} taskModelOptions={[]}
    onWorkflowChange={value=>{if(value)latest=structuredClone(value);}}/>);
  const surface=view.container.querySelector<HTMLElement>('.canvas-bg');expect(surface).not.toBeNull();
  const drop=new MouseEvent('drop',{bubbles:true,cancelable:true,clientX:200,clientY:200});
  Object.defineProperty(drop,'dataTransfer',{value:{getData:(type:string)=>type===CANVAS_ASSET_DRAG_MIME?serializeCanvasAssetDragPayload(image):''}});
  fireEvent(surface!,drop);
  await waitFor(()=>expect(posts).toHaveLength(1));
  await waitFor(()=>expect(latest.nodes).toHaveLength(1));
  const node=(): WorkflowNode | undefined => latest.nodes[0];
  async function resolveTransfer():Promise<void>{
    if(!released){released=true;release(response);}
    await act(async()=>{await held;let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([consumed,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('RESPONSE_NOT_CONSUMED')),1500);})]);}finally{if(timer)clearTimeout(timer);}});
  }
  return {posts,node,snapshot:()=>structuredClone(latest),resolveTransfer,view};
}

it('real insertion keeps source version and response placement through one undo and redo',async()=>{
  const f=await setup();
  try {
    expect(f.node()?.config).toEqual(expect.objectContaining({sourceImageId:image.id,sourceVersionId:image.versionId,assetTransferPending:true}));
    expect(f.posts[0]).toEqual(expect.objectContaining({actor:'actor-a',body:expect.objectContaining({
      sourceVersion:'asset-v',targetProject:'project-a',targetWorkspace:'workflow-a',entityType:'workflow-input',entityId:f.node()?.id,
    })}));
    await f.resolveTransfer();
    await waitFor(()=>expect(f.node()?.config).toEqual(expect.objectContaining({assetTransferPending:false,assetVersionId:'asset-v',placementId:'workflow-p'})));
    fireEvent.click(screen.getByRole('button',{name:'撤销'}));
    await waitFor(()=>expect(f.snapshot().nodes).toHaveLength(0));
    fireEvent.click(screen.getByRole('button',{name:'重做'}));
    await waitFor(()=>expect(f.node()?.config).toEqual(expect.objectContaining({assetVersionId:'asset-v',placementId:'workflow-p'})));
    expect(f.posts).toHaveLength(1);
  } finally {await f.resolveTransfer();f.view.unmount();}
},15000);

it('undo invalidates late transfer without resurrecting the node',async()=>{
  const f=await setup();
  try {
    expect(f.node()?.config.assetTransferPending).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'撤销'}));
    await waitFor(()=>expect(f.snapshot().nodes).toHaveLength(0));
    await f.resolveTransfer();
    expect(f.snapshot().nodes).toHaveLength(0);
    expect(f.posts).toHaveLength(1);
  } finally {await f.resolveTransfer();f.view.unmount();}
},15000);

it('rejects an unexpected GET',async()=>{
  const f=await setup();
  try {
    await expect(fetch('/unexpected-get')).rejects.toThrow('BLOCKED:GET /unexpected-get');
    expect(unexpectedGets).toEqual(['GET /unexpected-get']);
    unexpectedGets.length=0;
  } finally {await f.resolveTransfer();f.view.unmount();}
},15000);
