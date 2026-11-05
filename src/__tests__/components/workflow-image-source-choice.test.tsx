// @vitest-environment jsdom
// Additional editor boundaries; original tests, budgets and assertions stay intact.
import React from 'react';
import {act,cleanup,fireEvent,render,within,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import NodeEditor from '@/components/node-editor';
import {parseWorkflowImageGridAction,type WorkflowImageGridActionRequest} from '@/lib/workflow-image-action-request';
let gridPosted:WorkflowImageGridActionRequest[]=[];
let gridReply:((request:WorkflowImageGridActionRequest)=>Promise<Response>)|undefined;
function completeGrid(request:WorkflowImageGridActionRequest):Response {return Response.json({success:true,status:'committed',value:{projectId:request.projectId,workspaceId:request.workspaceId,operationId:request.operationId,parentVersionId:request.source.assetVersionId??'fixture-parent',tiles:request.targetNodeIds.map((nodeId,index)=>({nodeId,cell:{index,column:index%request.columns,row:Math.floor(index/request.columns),columns:request.columns,rows:request.rows,left:(index%request.columns)*(1200/request.columns),top:Math.floor(index/request.columns)*(800/request.rows),width:1200/request.columns,height:800/request.rows},reference:{kind:'image',assetId:'a'+index,assetVersionId:'v'+index,placementId:'p'+index,entityId:nodeId,url:'/fixture-tile-'+index+'.png'}}))}});}
function gridFixture():Workflow {const wf=fixture(),source=createWorkflowNode('input-image',40,80);source.id='ux-A';source.label='可拖动输入';source.config={...source.config,projectId:'ux-project',assetVersionId:'source-version',assetId:'source-asset',placementId:'source-place',imageUrl:'/fixture.png',gridCols:3,gridRows:2};wf.nodes[0]=source;return wf;}
function gridClick(container:HTMLElement):void {openNodeMenu(container);fireEvent.click(within(document.body).getByRole('menuitem',{name:'宫格切分 3×2'}));flush();}
function pendingGrid(){let resolve!:(response:Response)=>void;const promise=new Promise<Response>(done=>{resolve=done;});return {promise,resolve};}
import {createConnection,createEmptyWorkflow,createWorkflowNode,getNodePropertyFields,type Workflow} from '@/lib/workflow-engine';

class TestPointer extends MouseEvent {
 readonly pointerId:number;readonly pointerType:string;readonly isPrimary:boolean;
 constructor(type:string,init:PointerEventInit={}){super(type,init);this.pointerId=init.pointerId??1;this.pointerType=init.pointerType??'touch';this.isPrimary=init.isPrimary??true;}
}
const captures=new WeakMap<Element,Set<number>>(),frames=new Map<number,FrameRequestCallback>();let frameId=0,hitTarget:Element|null=null;
const descriptors=new Map(['setPointerCapture','releasePointerCapture','hasPointerCapture'].map(k=>[k,Object.getOwnPropertyDescriptor(HTMLElement.prototype,k)]));
const elementFromPoint=Object.getOwnPropertyDescriptor(document,'elementFromPoint');
const pointer=(id=1,x=100,y=120,type='touch'):PointerEventInit=>({pointerId:id,pointerType:type,isPrimary:id===1,button:0,clientX:x,clientY:y,bubbles:true,cancelable:true});
const rect=(x=0,y=0,width=0,height=0):DOMRect=>({x,y,left:x,top:y,width,height,right:x+width,bottom:y+height,toJSON:()=>({})});
function fixture():Workflow {
 const a=createWorkflowNode('input-text',40,80);a.id='ux-A';a.label='可拖动输入';a.config.textContent='保留原输入';
 const b=createWorkflowNode('ai-generate',400,200);b.id='ux-B';b.label='下游图像';
 return {...createEmptyWorkflow('UX boundaries'),id:'ux-boundaries',nodes:[a,b],connections:[]};
}
function editor(workflow=fixture(),actor='ux-actor'):React.JSX.Element{return <NodeEditor workflow={workflow} rendererMode="legacy" userId={actor} projectId="ux-project" canvasImages={[]} taskModelCatalog={[]}/>;}
function flush():void{act(()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(f=>f(1));});}
function mount(workflow=fixture()):ReturnType<typeof render>{const r=render(editor(workflow));flush();return r;}
function card(c:HTMLElement,id='ux-A'):HTMLElement{return [...c.querySelectorAll<HTMLElement>('[data-node-id]')].find(e=>e.dataset.nodeId===id)!;}
function header(c:HTMLElement):HTMLElement{return card(c).querySelector<HTMLElement>('[data-workflow-node-drag-handle]')!;}
function canvas(c:HTMLElement):HTMLElement{return c.querySelector<HTMLElement>('.canvas-bg')!;}
function undo(c:HTMLElement):HTMLButtonElement{return c.querySelector<HTMLButtonElement>('button[aria-label="撤销"]')!;}
function port(c:HTMLElement,node='ux-A',direction='out',type?:string,wf=fixture()):HTMLElement {
 const key=wf.nodes.find(n=>n.id===node)!.ports.find(p=>p.direction===direction&&(!type||p.type===type))!.id;
 return [...card(c,node).querySelectorAll<HTMLElement>('[data-workflow-port-key]')].find(e=>e.dataset.workflowPortKey===key&&e.dataset.workflowPortDirection===direction)!;
}
function edgeCount(c:HTMLElement):number{return c.querySelectorAll('[data-edge-id]').length;}
function domainCount(c:HTMLElement):number{return Number(c.querySelector('[data-workflow-legacy-surface]')!.getAttribute('data-domain-node-count'));}
function openNodeMenu(c:HTMLElement):void {
 fireEvent.pointerDown(header(c),pointer());fireEvent.pointerUp(card(c),pointer());
 const panel=c.querySelector<HTMLElement>('aside[data-workflow-ui-occlusion]')!;
 fireEvent.click(within(panel).getByRole('button',{name:'节点菜单'}));
}
beforeEach(()=>{
 localStorage.clear();frames.clear();frameId=0;hitTarget=null;gridPosted=[];gridReply=undefined;
 vi.stubGlobal('PointerEvent',TestPointer);vi.stubGlobal('BroadcastChannel',undefined);
 vi.stubGlobal('requestAnimationFrame',(f:FrameRequestCallback):number=>{frames.set(++frameId,f);return frameId;});vi.stubGlobal('cancelAnimationFrame',(id:number):void=>{frames.delete(id);});
 vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
 vi.stubGlobal('ResizeObserver',class {constructor(private callback:ResizeObserverCallback){}observe(target:Element):void{if(target.classList.contains('canvas-bg'))this.callback([{target,contentRect:rect(0,0,1000,700)} as ResizeObserverEntry],this as unknown as ResizeObserver);}unobserve():void{}disconnect():void{}});
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{const method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();if(method==='POST'&&String(input)==='/api/workflow/image-actions'){const headers=new Headers(init?.headers);if(headers.get('x-wujie-expected-actor-id')!=='ux-actor'||init?.credentials!=='include')throw Error('UX_GRID_FIXTURE_ACTOR');const request=parseWorkflowImageGridAction(JSON.parse(String(init?.body)));if(request.projectId!=='ux-project'||request.workspaceId!=='ux-boundaries')throw Error('UX_GRID_FIXTURE_SCOPE');gridPosted.push(request);return gridReply?gridReply(request):completeGrid(request);}if(method!=='GET')throw Error('UX_BOUNDARY_TEST_REFUSES_SUBMISSION');return Response.json({models:[],workflows:[],skills:[],presets:[]});}));
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement):DOMRect {
  if(this.classList.contains('canvas-bg')||this.hasAttribute('data-workflow-legacy-surface'))return rect(0,0,1000,700);
  if(this.hasAttribute('data-port-id'))return this.closest('[data-node-id="ux-A"]')?rect(220,160,12,12):this.classList.contains('input-port')?rect(400,240,12,12):rect(600,280,12,12);
  if(this.hasAttribute('data-node-id'))return this.dataset.nodeId==='ux-A'?rect(32,64,192,160):rect(320,160,192,240);
  return rect();
 });
 Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>hitTarget});
 Object.defineProperties(HTMLElement.prototype,{setPointerCapture:{configurable:true,value(this:Element,id:number):void{const set=captures.get(this)??new Set<number>();set.add(id);captures.set(this,set);}},hasPointerCapture:{configurable:true,value(this:Element,id:number):boolean{return captures.get(this)?.has(id)??false;}},releasePointerCapture:{configurable:true,value(this:Element,id:number):void{captures.get(this)?.delete(id);}}});
});
afterEach(()=>{
 cleanup();frames.clear();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();
 for(const[k,d]of descriptors){if(d)Object.defineProperty(HTMLElement.prototype,k,d);else Reflect.deleteProperty(HTMLElement.prototype,k);}
 if(elementFromPoint)Object.defineProperty(document,'elementFromPoint',elementFromPoint);else Reflect.deleteProperty(document,'elementFromPoint');
});

describe('connection validation and owner boundaries in the mounted editor',()=>{
 it('duplicate release does not add history or a second edge',()=>{
  const wf=fixture(),a=wf.nodes[0].ports.find(p=>p.direction==='out')!,b=wf.nodes[1].ports.find(p=>p.direction==='in'&&p.type==='prompt')!;
  wf.connections=[createConnection('ux-A',a.id,'ux-B',b.id,a.type)];const {container}=mount(wf),source=port(container),target=port(container,'ux-B','in','prompt',wf);hitTarget=target;
  fireEvent.pointerDown(source,pointer());fireEvent.pointerUp(source,pointer(1,406,246));flush();expect(edgeCount(container)).toBe(1);expect(undo(container).disabled).toBe(true);
 });
 it('incompatible input refuses the connection and settles preview',()=>{
  const wf=fixture(),{container}=mount(wf),source=port(container,'ux-A','out','prompt',wf);hitTarget=port(container,'ux-B','in','image',wf);
  fireEvent.pointerDown(source,pointer());fireEvent.pointerUp(source,pointer(1,406,246));flush();expect(edgeCount(container)).toBe(0);expect(undo(container).disabled).toBe(true);expect(container.querySelector('path[stroke-dasharray="6 4"]')).toBeNull();
 });
 it('wrong pointer id, type and capture owner cannot settle another connection',()=>{
  const {container}=mount(),source=port(container),target=port(container,'ux-B','in','prompt');hitTarget=target;
  fireEvent.pointerDown(source,pointer());fireEvent.pointerUp(source,pointer(2,406,246));fireEvent.pointerUp(source,pointer(1,406,246,'pen'));fireEvent.pointerUp(target,pointer(1,406,246));expect(edgeCount(container)).toBe(0);
  fireEvent.pointerUp(source,pointer(1,406,246));flush();expect(edgeCount(container)).toBe(1);
 });
 it('cancel and a late successful-looking release cannot create an edge',()=>{
  const {container}=mount(),source=port(container);hitTarget=port(container,'ux-B','in','prompt');fireEvent.pointerDown(source,pointer());fireEvent.pointerCancel(source,pointer());fireEvent.pointerUp(source,pointer(1,406,246));flush();expect(edgeCount(container)).toBe(0);expect(undo(container).disabled).toBe(true);
 });
 it('capture refusal creates neither preview nor history',()=>{
  const {container}=mount(),source=port(container);Object.defineProperty(source,'setPointerCapture',{value:()=>{throw Error('refused');}});
  fireEvent.pointerDown(source,pointer());fireEvent.pointerMove(source,pointer(1,300,250));flush();expect(container.querySelector('path[stroke-dasharray="6 4"]')).toBeNull();expect(undo(container).disabled).toBe(true);
 });
 it('actor change clears ownership before old release or native touch can affect the new scope',()=>{
  const wf=fixture(),r=mount(wf),source=port(r.container);hitTarget=port(r.container,'ux-B','in','prompt');fireEvent.pointerDown(source,pointer());r.rerender(editor(wf,'other-actor'));
  fireEvent.pointerUp(source,pointer(1,406,246));flush();expect(edgeCount(r.container)).toBe(0);expect(undo(r.container).disabled).toBe(true);expect(source.hasPointerCapture(1)).toBe(false);
 });
});

describe('viewport and touch alternatives',()=>{
 it('a keyboard selection remains available after a completed touch gesture',()=>{
  const {container}=mount(),surface=canvas(container);
  fireEvent.pointerDown(surface,pointer());fireEvent.pointerMove(surface,pointer(1,180,160));fireEvent.pointerUp(surface,pointer(1,180,160));flush();
  fireEvent.keyDown(card(container),{key:'Enter'});
  expect(container.querySelector<HTMLElement>('aside[data-workflow-ui-occlusion]')!.classList.contains('hidden')).toBe(false);
 });
 it('an unscaled target starts its preview at the measured visual port',()=>{
  const getStyle=window.getComputedStyle.bind(window);
  vi.spyOn(window,'getComputedStyle').mockImplementation((element,pseudo)=>{
    const style=getStyle(element,pseudo);
    return element.hasAttribute('data-workflow-legacy-node-layer')?new Proxy(style,{get(target,key){if(key==='transform')return 'matrix(0.8, 0, 0, 0.8, 0, 0)';const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}):style;
  });
  const wf=fixture();wf.nodes[0].ports=wf.nodes[0].ports.filter(port=>port.direction==='out'&&port.type==='prompt');const {container}=mount(wf),source=[...container.querySelectorAll<HTMLButtonElement>('[data-workflow-direct-port-target]')].find(e=>e.dataset.workflowPortNode==='ux-A'&&e.dataset.workflowPortDirection==='out')!;
  expect(source).toBeDefined();fireEvent.pointerDown(source,pointer());
  const path=container.querySelector('path[stroke-dasharray="6 4"]')!.getAttribute('d')!;
  const coordinates=path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  expect(coordinates.slice(0,2)).toEqual([282.5,207.5]);
 });
 it('body pinch changes only the viewport; cancellation preserves an edited textarea',()=>{
  const {container}=mount(),surface=canvas(container),body=card(container).querySelector<HTMLElement>('.node-body')!,input=card(container).querySelector<HTMLTextAreaElement>('textarea')!;
  fireEvent.pointerDown(body,pointer(1,100,100));expect(surface.hasPointerCapture(1)).toBe(false);fireEvent.pointerDown(body,pointer(2,200,100));expect(surface.hasPointerCapture(1)&&surface.hasPointerCapture(2)).toBe(true);
  fireEvent.pointerMove(surface,pointer(2,300,100));flush();expect(container.querySelector('[data-workflow-legacy-edge-layer] g[transform]')!.getAttribute('transform')).toBe('translate(-100, -100) scale(1.6)');
  fireEvent.change(input,{target:{value:'仍可编辑'}});fireEvent.pointerCancel(surface,pointer(2,300,100));flush();expect(input.value).toBe('仍可编辑');expect(undo(container).disabled).toBe(false);
  expect(container.querySelector('[data-workflow-legacy-edge-layer] g[transform]')!.getAttribute('transform')).toBe('translate(0, 0) scale(0.8)');expect(card(container).style.left).toBe('40px');
 });
 it('long press opens the existing canvas menu without creating a node or executing a task',()=>{
  vi.useFakeTimers();const {container,getByRole}=mount();fireEvent.pointerDown(canvas(container),pointer());act(()=>vi.advanceTimersByTime(500));
  expect(getByRole('menu',{name:'工作流画布菜单'})).not.toBeNull();expect(getByRole('menuitem',{name:'添加节点'})).not.toBeNull();expect(domainCount(container)).toBe(2);expect(undo(container).disabled).toBe(true);expect(canvas(container).hasPointerCapture(1)).toBe(false);
 });
 it('44px unscaled source target also opens the explicit list for keyboard activation',()=>{
  const wf=fixture();wf.nodes[0].ports=wf.nodes[0].ports.filter(port=>port.direction==='out'&&port.type==='prompt');const {container}=mount(wf);const target=[...container.querySelectorAll<HTMLButtonElement>('[data-workflow-direct-port-target]')].find(e=>e.dataset.workflowPortNode==='ux-A'&&e.dataset.workflowPortDirection==='out')!;
  expect(target).toBeDefined();expect(target.style.width).toBe('44px');expect(target.style.height).toBe('44px');fireEvent.click(target,{detail:0});
  const panel=container.querySelector<HTMLElement>('aside[data-workflow-ui-occlusion]')!;fireEvent.click(within(panel).getByRole('button',{name:/^连接至 下游图像 .*prompt$/}));expect(edgeCount(container)).toBe(1);fireEvent.click(undo(container));expect(edgeCount(container)).toBe(0);
 });
 it('self input in the explicit list is disabled',()=>{
  const wf=fixture();wf.nodes[0].ports.push({id:'self-in',label:'自身输入',direction:'in',type:'prompt'});const {container}=mount(wf);fireEvent.pointerDown(header(container),pointer());fireEvent.pointerUp(card(container),pointer());
  const panel=container.querySelector<HTMLElement>('aside[data-workflow-ui-occlusion]')!;fireEvent.click(within(panel).getByRole('button',{name:'连接端口'}));fireEvent.click(within(panel).getByRole('button',{name:/^从 可拖动输入 .*prompt 连接$/}));
  const self=within(panel).getByRole('button',{name:'连接至 可拖动输入 自身输入 prompt'}) as HTMLButtonElement;expect(self.disabled).toBe(true);fireEvent.click(self);expect(edgeCount(container)).toBe(0);
 });
});

describe('unscaled node menu preserves existing data-action payloads',()=>{
 function imageFixture():Workflow {const wf=fixture(),a=createWorkflowNode('input-image',40,80);a.id='ux-A';a.label='可拖动输入';a.config={...a.config,imageUrl:'https://unit.invalid/fixture.png',gridCols:3,gridRows:2};wf.nodes[0]=a;return wf;}
 it('grid action retains the configured columns and rows',async()=>{
  const {container,getByRole}=mount(imageFixture());openNodeMenu(container);expect(domainCount(container)).toBe(2);fireEvent.click(getByRole('menuitem',{name:'宫格切分 3×2'}));flush();await waitFor(()=>expect(domainCount(container)).toBe(8));expect(edgeCount(container)).toBe(6);
 });
 it('extract action retains the original source creation callback',()=>{
  const {container,getByRole}=mount(imageFixture());openNodeMenu(container);fireEvent.click(getByRole('menuitem',{name:'抽取为源节点'}));flush();expect(domainCount(container)).toBe(3);expect(edgeCount(container)).toBe(1);expect(card(container,'ux-B').style.left).toBe('400px');
 });
});

// New cases exercise real mounted editor state/history; only the CPU endpoint reply is synthetic.
describe('grid publication in the mounted editor',()=>{
 it('keeps the graph unchanged while preparing and adds the full result as one undo entry',async()=>{
  const pending=pendingGrid();gridReply=()=>pending.promise;const {container}=mount(gridFixture());gridClick(container);expect(domainCount(container)).toBe(2);expect(edgeCount(container)).toBe(0);expect(undo(container).disabled).toBe(true);await waitFor(()=>expect(gridPosted).toHaveLength(1));
  await act(async()=>{pending.resolve(completeGrid(gridPosted[0]));});await waitFor(()=>expect(domainCount(container)).toBe(8));expect(edgeCount(container)).toBe(6);fireEvent.click(undo(container));flush();expect(domainCount(container)).toBe(2);expect(edgeCount(container)).toBe(0);
 });
 it('offers reconciliation and preserves the complete original request after an uncertain result',async()=>{
  gridReply=async request=>gridPosted.length===1?Response.json({success:false,status:'unknown',projectId:request.projectId,workspaceId:request.workspaceId,operationId:request.operationId},{status:202}):completeGrid(request);const {container,getByRole}=mount(gridFixture());gridClick(container);await waitFor(()=>expect(getByRole('button',{name:'核对结果'})).not.toBeNull());expect(domainCount(container)).toBe(2);fireEvent.click(getByRole('button',{name:'核对结果'}));await waitFor(()=>expect(domainCount(container)).toBe(8));expect(gridPosted[1]).toEqual(gridPosted[0]);
 });
 it('stops waiting without inserting a late result and reconciles the same operation',async()=>{
  const pending=pendingGrid();gridReply=request=>gridPosted.length===1?pending.promise:Promise.resolve(completeGrid(request));const {container,getByRole}=mount(gridFixture());gridClick(container);await waitFor(()=>expect(gridPosted).toHaveLength(1));fireEvent.click(getByRole('button',{name:'停止等待'}));await act(async()=>{pending.resolve(completeGrid(gridPosted[0]));});expect(domainCount(container)).toBe(2);fireEvent.click(getByRole('button',{name:'核对结果'}));await waitFor(()=>expect(domainCount(container)).toBe(8));expect(gridPosted[1]).toEqual(gridPosted[0]);
 });
 it('cannot apply a response belonging to the previous account',async()=>{
  const pending=pendingGrid();gridReply=()=>pending.promise;const wf=gridFixture(),r=mount(wf);gridClick(r.container);await waitFor(()=>expect(gridPosted).toHaveLength(1));r.rerender(editor(wf,'other-actor'));await act(async()=>{pending.resolve(completeGrid(gridPosted[0]));});flush();expect(domainCount(r.container)).toBe(2);expect(edgeCount(r.container)).toBe(0);
 });
});

function weWorkflow(source='url'):Workflow {
  const input=createWorkflowNode('input-image',40,80),downstream=createWorkflowNode('input-image',400,200);
  input.id='ux-A';input.label='图片输入';input.config={source,projectId:'ux-project',...(source==='upstream'?{imageInputTransform:{version:1,kind:'identity'}}:{}),imageUrl:'https://unit.invalid/local.png',assetId:'local-a',assetVersionId:'local-v',placementId:'local-place',entityId:'local-image',gridCols:3,gridRows:2};
  downstream.id='we-downstream';downstream.label='后续图片';downstream.config={source:'upstream'};downstream.ports.unshift({id:'in-image',label:'上游图片',type:'image',direction:'in'});
  return{...createEmptyWorkflow('WE source choice'),id:'ux-boundaries',nodes:[input,downstream],connections:[createConnection(input.id,input.ports.find(port=>port.direction==='out'&&port.type==='image')!.id,downstream.id,'in-image','image')]};
}
function weMount(workflow:Workflow):{view:ReturnType<typeof render>;snapshots:Workflow[]} {
  const snapshots:Workflow[]=[];const view=render(<NodeEditor workflow={workflow} rendererMode="legacy" userId="ux-actor" projectId="ux-project" canvasImages={[]} taskModelCatalog={[]} onWorkflowChange={next=>{if(next)snapshots.push(structuredClone(next));}}/>);flush();return{view,snapshots};
}
describe('WE visible upstream image source',()=>{
  it('offers upstream alongside the original upload URL and canvas sources',()=>{
    const source=getNodePropertyFields('input-image').find(field=>field.key==='source');expect(source?.type).toBe('select');expect(source?.options?.map(option=>option.value)).toEqual(['upload','url','canvas','upstream']);
  });
  it('switches source and creates one actual image receiver port as one undoable edit',async()=>{
    const workflow=weWorkflow(),{view,snapshots}=weMount(workflow);const choice=within(card(view.container)).getByLabelText('图片来源') as HTMLSelectElement;
    expect(choice.value).toBe('url');fireEvent.change(choice,{target:{value:'upstream'}});flush();await waitFor(()=>expect(snapshots.at(-1)?.nodes[0].config.source).toBe('upstream'));
    const changed=snapshots.at(-1)!;expect(changed.nodes[0].config.imageInputTransform).toEqual({version:1,kind:'identity'});expect(changed.nodes[0].ports.filter(port=>port.id==='in-image')).toEqual([{id:'in-image',label:'上游图片',type:'image',direction:'in'}]);expect(changed.nodes[0].config.assetVersionId).toBe('local-v');expect(changed.connections).toEqual(workflow.connections);expect(changed.nodes).toHaveLength(2);
    fireEvent.click(undo(view.container));flush();await waitFor(()=>expect(snapshots.at(-1)?.nodes[0].config).toEqual(workflow.nodes[0].config));expect(snapshots.at(-1)?.nodes[0].ports).toEqual(workflow.nodes[0].ports);expect(snapshots.at(-1)?.connections).toEqual(workflow.connections);expect((within(card(view.container)).getByLabelText('图片来源') as HTMLSelectElement).value).toBe('url');
  });
  it('renders an existing receiver as a real labelled input row and original connectable port',()=>{
    const workflow=weWorkflow('upstream');workflow.nodes[0].ports.unshift({id:'in-image',label:'上游图片',type:'image',direction:'in'});const {view}=weMount(workflow),input=card(view.container).querySelector<HTMLElement>('[data-workflow-port-key="in-image"][data-workflow-port-direction="in"]');expect(input).not.toBeNull();expect(input?.closest('.port-row')?.textContent).toContain('上游图片');expect(input?.getAttribute('data-workflow-port-node')).toBe('ux-A');
  });
  it('previews the connected upstream image instead of a retained local target URL',()=>{
    const workflow=weWorkflow('upstream'),receiver=workflow.nodes[0],source=createWorkflowNode('input-image',0,0);source.id='we-source';source.config={source:'url',imageUrl:'https://unit.invalid/upstream.png'};receiver.ports.unshift({id:'in-image',label:'上游图片',type:'image',direction:'in'});workflow.nodes.unshift(source);workflow.connections.push(createConnection(source.id,source.ports.find(port=>port.direction==='out'&&port.type==='image')!.id,receiver.id,'in-image','image'));
    const {view}=weMount(workflow),images=[...card(view.container).querySelectorAll('img')].map(image=>image.getAttribute('src'));expect(images).toContain('https://unit.invalid/upstream.png');expect(images).not.toContain('https://unit.invalid/local.png');
  });
  it('shows an upstream connection instruction without offering an ignored local upload',()=>{
    const workflow=weWorkflow('upstream');workflow.nodes[0].config.imageUrl='';workflow.nodes[0].ports.unshift({id:'in-image',label:'上游图片',type:'image',direction:'in'});const {view}=weMount(workflow),input=within(card(view.container));expect(input.getByText('连接上游图片')).toBeTruthy();expect(input.queryByText('拖拽或点击上传')).toBeNull();expect(input.queryByPlaceholderText('粘贴图片 URL...')).toBeNull();
  });
  it('keeps local assets and existing edges when returning from upstream without duplicating its port',async()=>{
    const workflow=weWorkflow(),{view,snapshots}=weMount(workflow);const choice=within(card(view.container)).getByLabelText('图片来源') as HTMLSelectElement;
    for(const source of['upstream','url','upstream']){fireEvent.change(choice,{target:{value:source}});flush();await waitFor(()=>expect(snapshots.at(-1)?.nodes[0].config.source).toBe(source));}
    const changed=snapshots.at(-1)!;expect(changed.nodes[0].ports.filter(port=>port.id==='in-image')).toHaveLength(1);expect(changed.nodes[0].config).toEqual({...workflow.nodes[0].config,source:'upstream',imageInputTransform:{version:1,kind:'identity'}});expect(changed.connections).toEqual(workflow.connections);expect(changed.nodes).toHaveLength(2);expect(vi.mocked(fetch).mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
  });
});

const weTransfers=vi.hoisted(()=>({jobs:[] as Promise<unknown>[]}));
vi.mock('@/lib/asset-core/workspace-transfer',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/asset-core/workspace-transfer')>();
 return {...actual,runGuardedWorkflowInputTransfer:(input:Parameters<typeof actual.runGuardedWorkflowInputTransfer>[0]):ReturnType<typeof actual.runGuardedWorkflowInputTransfer>=>{const original=actual.runGuardedWorkflowInputTransfer(input);weTransfers.jobs.push(original);return original;}};
});
beforeEach(()=>{weTransfers.jobs=[];});
afterEach(async()=>{const closed=await Promise.allSettled(weTransfers.jobs);expect(closed.every(item=>item.status==='fulfilled')).toBe(true);});
describe('WE visible upstream image source receiver contract and late transfer',()=>{
 it('retains an existing legal grid receiver transform when selecting upstream',async()=>{
   const workflow=weWorkflow();workflow.nodes[0].config.imageInputTransform={version:1,kind:'grid',columns:3,rows:2,column:1,row:0};const {view,snapshots}=weMount(workflow);fireEvent.change(within(card(view.container)).getByLabelText('图片来源'),{target:{value:'upstream'}});flush();await waitFor(()=>expect(snapshots.at(-1)?.nodes[0].config.source).toBe('upstream'));expect(snapshots.at(-1)?.nodes[0].config).toEqual({...workflow.nodes[0].config,source:'upstream'});expect(snapshots.at(-1)?.connections).toEqual(workflow.connections);
 });
 it('does not let an actual pending canvas transfer overwrite a later source choice',async()=>{
   const workflow=weWorkflow();workflow.nodes[0].config.imageUrl='';const snapshots:Workflow[]=[],image={id:'we-canvas',url:'https://unit.invalid/pending.png',name:'待接入图片',description:'WE transfer fixture',assetId:'incoming-a',assetVersionId:'incoming-v',placementId:'incoming-place',projectId:'ux-project',width:2,height:2};
   const previous=vi.mocked(fetch).getMockImplementation()!;let held=false,release!:()=>void,captured:unknown;const gate=new Promise<void>(resolve=>{release=resolve;});
   vi.mocked(fetch).mockImplementation(async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{if(String(input)==='/api/assets/transfer'){captured=JSON.parse(String(init?.body));held=true;await gate;return Response.json({assetId:'late-a',assetVersionId:'late-v',placementId:'late-place',kind:'image',url:'https://unit.invalid/late.png'});}return previous(input,init);});
   try{const view=render(<NodeEditor workflow={workflow} rendererMode="legacy" userId="ux-actor" projectId="ux-project" canvasImages={[image]} taskModelCatalog={[]} onWorkflowChange={next=>{if(next)snapshots.push(structuredClone(next));}}/>);flush();fireEvent.pointerDown(header(view.container),pointer());fireEvent.pointerUp(card(view.container),pointer());fireEvent.click(view.getByRole('button',{name:'从画布选择图片'}));const canvasChoices=view.container.querySelectorAll<HTMLButtonElement>('button[title="WE transfer fixture"]');expect(canvasChoices).toHaveLength(1);fireEvent.click(canvasChoices[0]);await waitFor(()=>expect(held).toBe(true));expect(captured).toMatchObject({sourceVersion:'incoming-v',targetProject:'ux-project',targetWorkspace:'ux-boundaries',entityType:'workflow-input',entityId:'ux-A'});expect(weTransfers.jobs).toHaveLength(1);
     const choice=[...view.container.querySelectorAll<HTMLSelectElement>('select')].find(select=>!select.closest('[data-node-id]')&&[...select.options].some(option=>option.value==='canvas')&&[...select.options].some(option=>option.value==='url'));expect(choice).toBeTruthy();fireEvent.change(choice!,{target:{value:'url'}});flush();await waitFor(()=>expect(snapshots.at(-1)?.nodes[0].config.source).toBe('url'));await act(async()=>{release();await Promise.all(weTransfers.jobs);});flush();expect(snapshots.at(-1)?.nodes[0].config.source).toBe('url');expect(snapshots.at(-1)?.nodes[0].config.assetTransferPending).toBe(false);expect(snapshots.at(-1)?.nodes[0].config.assetVersionId).not.toBe('late-v');expect(snapshots.at(-1)?.nodes[0].config.imageUrl).not.toBe('https://unit.invalid/late.png');expect(snapshots.at(-1)?.connections).toEqual(workflow.connections);
   }finally{release();await Promise.allSettled(weTransfers.jobs);vi.mocked(fetch).mockImplementation(previous);}
 });
});

describe('WE visible upstream image source prepared grid preview',()=>{
 it('keeps every published grid tile visible as its own prepared image',async()=>{
  const workflow=weWorkflow(),{view,snapshots}=weMount(workflow);openNodeMenu(view.container);fireEvent.click(view.getByRole('menuitem',{name:'宫格切分 3×2'}));flush();await waitFor(()=>expect(domainCount(view.container)).toBe(8));const tiles=snapshots.at(-1)!.nodes.filter(node=>!workflow.nodes.some(original=>original.id===node.id));expect(tiles).toHaveLength(6);const urls=tiles.map(node=>String(node.config.imageUrl));expect(new Set(urls).size).toBe(6);for(const node of tiles){expect(node.config.source).toBe('upstream');expect(node.config.imageInputTransform).toMatchObject({version:1,kind:'grid',columns:3,rows:2});expect([...card(view.container,node.id).querySelectorAll('img')].map(image=>image.getAttribute('src'))).toContain(String(node.config.imageUrl));}expect(snapshots.at(-1)?.connections).toHaveLength(7);
 });
});

describe('WE receiver preview blocked input boundary',()=>{
 it('does not preview an upstream image through a blocked receiver edge',()=>{
  const workflow=weWorkflow('upstream'),receiver=workflow.nodes[0],source=createWorkflowNode('input-image',0,0);source.id='we-blocked-source';source.config={source:'url',imageUrl:'https://unit.invalid/blocked-upstream.png'};receiver.ports.unshift({id:'in-image',label:'上游图片',type:'image',direction:'in'});const connection=createConnection(source.id,source.ports.find(port=>port.direction==='out'&&port.type==='image')!.id,receiver.id,'in-image','image');receiver.config.blockedInputs=[connection.id];workflow.nodes.unshift(source);workflow.connections.push(connection);const {view}=weMount(workflow);expect([...card(view.container).querySelectorAll('img')].map(image=>image.getAttribute('src'))).not.toContain('https://unit.invalid/blocked-upstream.png');expect(within(card(view.container)).getByText('连接上游图片')).toBeTruthy();
 });
});
