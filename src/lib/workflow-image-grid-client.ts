import {createWorkflowNode,topologicalSort,type Workflow,type WorkflowNode} from '@/lib/workflow-engine';
import type {WorkflowInputTransferGuard,WorkflowInputTransferToken} from '@/lib/asset-core/workspace-transfer';
import {loadBrowserImageBlob} from '@/lib/browser-image-blob';
import {assertWorkflowImageGridShape} from './workflow-image-actions';
import {parseWorkflowImageGridAction,type WorkflowImageGridActionRequest} from './workflow-image-action-request';
import {planPublishedWorkflowImageGrid} from './workflow-image-graph';
export interface WorkflowGridClientSnapshot {
  actorId:string;projectId:string;workflowId:string;documentMode:boolean;workflow:Workflow;
  results:Readonly<Record<string,{output?:Record<string,unknown>}>>;
}
export interface WorkflowGridClientView {
  phase:'idle'|'preparing'|'unknown'|'error'|'completed'|'stale';message:string;canRetry:boolean;
}
export interface WorkflowGridClientHost {
  snapshot():WorkflowGridClientSnapshot;guard():WorkflowInputTransferGuard;
  fetcher:typeof fetch;apply(workflow:Workflow):void;onView(view:WorkflowGridClientView):void;
}
export interface WorkflowGridClient {
  run(nodeId:string,columns:number,rows:number):Promise<void>;retry():Promise<void>;
  stop():void;reset():void;dismiss():void;
}
interface GridOperation {
  scope:string;sourceFingerprint?:string;guard:WorkflowInputTransferGuard;token:WorkflowInputTransferToken;
  validationWorkflow:Workflow;
  request:WorkflowImageGridActionRequest;body?:string;controller?:AbortController;timer?:ReturnType<typeof setTimeout>;
  epoch:number;inFlight:boolean;sent:boolean;unknown:boolean;
}
interface PendingGridRequest {operationId:string;body:string;sourceHash:string}
export interface WorkflowGridRecoveryStore {
  read(scope:string):Promise<PendingGridRequest|undefined>;
  claim(scope:string,request:PendingGridRequest):Promise<PendingGridRequest>;
  remove(scope:string,operationId:string):Promise<void>;
}

async function pendingGridTransaction<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore,done:(value:T)=>void)=>void):Promise<T> {
  const database=await new Promise<IDBDatabase>((resolve,reject)=>{
    const open=indexedDB.open('wujie-workflow-image-grid',1);
    let blocked=false;
    open.onupgradeneeded=()=>{open.result.createObjectStore('pending');};
    open.onerror=()=>reject(open.error);
    open.onblocked=()=>{blocked=true;reject(new Error('GRID_RECOVERY_STORAGE'));};
    open.onsuccess=()=>{if(blocked)open.result.close();else resolve(open.result);};
  });
  try{
    return await new Promise<T>((resolve,reject)=>{
      const transaction=database.transaction('pending',mode,mode==='readwrite'?{durability:'strict'}:undefined);
      let value:T;
      transaction.oncomplete=()=>resolve(value);
      transaction.onabort=()=>reject(transaction.error??new Error('GRID_RECOVERY_STORAGE'));
      run(transaction.objectStore('pending'),result=>{value=result;});
    });
  }finally{database.close();}
}

const browserGridRecovery:WorkflowGridRecoveryStore={
  read:scope=>pendingGridTransaction('readonly',(store,done)=>{
    const get=store.get(scope);get.onsuccess=()=>done(get.result);
  }),
  claim:(scope,request)=>pendingGridTransaction('readwrite',(store,done)=>{
    const get=store.get(scope);
    get.onsuccess=()=>{
      if(get.result!==undefined){done(get.result);return;}
      store.add(request,scope);done(request);
    };
  }),
  remove:(scope,operationId)=>pendingGridTransaction('readwrite',(store,done)=>{
    const get=store.get(scope);
    get.onsuccess=()=>{if(get.result?.operationId===operationId)store.delete(scope);done(undefined);};
  }),
};

const idle:WorkflowGridClientView={phase:'idle',message:'',canRetry:false};
function scopeKey(snapshot:WorkflowGridClientSnapshot):string {
  if(!snapshot.actorId||!snapshot.projectId||!snapshot.workflowId||snapshot.workflow.id!==snapshot.workflowId)throw new Error('GRID_SCOPE');
  return JSON.stringify([snapshot.actorId,snapshot.projectId,snapshot.workflowId,snapshot.documentMode]);
}
function sourceReference(snapshot:WorkflowGridClientSnapshot,node:WorkflowNode):WorkflowImageGridActionRequest['source'] {
  const output=snapshot.results[node.id]?.output;
  // Exactly the card's visible image wins; never combine a new result URL with
  // an older configured asset identity.
  const selected=typeof output?.imageUrl==='string'&&output.imageUrl?output:node.config;
  const reference:WorkflowImageGridActionRequest['source']={projectId:snapshot.projectId};
  for(const key of ['projectId','assetId','assetVersionId','placementId','imageUrl'] as const){
    const value=selected[key];if(value===undefined||value==='')continue;
    if(typeof value!=='string')throw new Error('GRID_SOURCE');reference[key]=value;
  }
  if(reference.projectId!==snapshot.projectId||node.config.assetTransferPending===true
    ||snapshot.documentMode&&(!reference.assetVersionId||!reference.placementId))throw new Error('GRID_SOURCE');
  return reference;
}
function sourceState(snapshot:WorkflowGridClientSnapshot,nodeId:string):{reference:WorkflowImageGridActionRequest['source'];fingerprint:string} {
  const matches=snapshot.workflow.nodes.filter(node=>node.id===nodeId),node=matches[0];
  if(matches.length!==1||!Number.isFinite(node.x)||!Number.isFinite(node.y))throw new Error('GRID_SOURCE');
  const ports=node.ports.filter(port=>port.type==='image'&&port.direction==='out');
  if(ports.length!==1||node.ports.filter(port=>port.id===ports[0].id).length!==1)throw new Error('GRID_PORT');
  const reference=sourceReference(snapshot,node),incoming=snapshot.workflow.connections.filter(edge=>edge.toNodeId===nodeId);
  const upstream=incoming.map(edge=>{
    const parent=snapshot.workflow.nodes.find(item=>item.id===edge.fromNodeId);
    return parent?{id:parent.id,ports:parent.ports,config:parent.config,output:snapshot.results[parent.id]?.output}:null;
  });
  const fingerprint=JSON.stringify([reference,node.type,node.ports,node.config.source,node.config.sourceImageId,
    node.config.sourceVersionId,node.config.assetTransferPending,node.config.imageInputTransform,node.config.blockedInputs,incoming,upstream],
  (_key,value:unknown)=>{
    const object=record(value);
    return object?Object.fromEntries(Object.keys(object).sort().map(key=>[key,object[key]])):value;
  });
  return {reference,fingerprint};
}
function record(value:unknown):Record<string,unknown>|undefined {
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
}
async function hashSource(fingerprint:string):Promise<string> {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function blobDataUrl(url:string,fetcher:typeof fetch,signal:AbortSignal):Promise<string> {
  const blob=await loadBrowserImageBlob(url,(input,init)=>fetcher(input,{...init,signal}));
  signal.throwIfAborted();if(!blob.size||blob.size>32*1024*1024||!blob.type.startsWith('image/'))throw new Error('GRID_BLOB');
  return new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    const clear=():void=>{signal.removeEventListener('abort',abort);reader.onload=null;reader.onerror=null;reader.onabort=null;};
    const abort=():void=>{reader.abort();clear();reject(new Error('GRID_BLOB_ABORTED'));};
    reader.onload=():void=>{const result=reader.result;clear();typeof result==='string'?resolve(result):reject(new Error('GRID_BLOB'));};
    reader.onerror=():void=>{clear();reject(new Error('GRID_BLOB'));};reader.onabort=():void=>{clear();reject(new Error('GRID_BLOB_ABORTED'));};
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}reader.readAsDataURL(blob);
  });
}

/** One recoverable request per actor, project, workflow and authority mode. */
export function createWorkflowImageGridClient(host:WorkflowGridClientHost,recovery=browserGridRecovery):WorkflowGridClient {
  let current:GridOperation|undefined,opening:object|undefined;
  const scopeCurrent=(scope:string):boolean=>{try{return scopeKey(host.snapshot())===scope;}catch{return false;}};
  const sameScope=(operation:GridOperation):boolean=>scopeCurrent(operation.scope);
  const emit=(operation:GridOperation,view:WorkflowGridClientView):void=>{if(current===operation&&sameScope(operation))host.onView(view);};
  const unknown=(operation:GridOperation):void=>{operation.unknown=true;emit(operation,{phase:'unknown',message:'保存结果尚未确认，请核对原操作；不要重复切分。',canRetry:true});};
  const active=(operation:GridOperation,epoch:number):boolean=>current===operation&&operation.epoch===epoch;
  const sourceCurrent=(operation:GridOperation):boolean=>{
    try{return sameScope(operation)&&host.guard()===operation.guard&&operation.guard.isCurrent(operation.token)
      &&sourceState(host.snapshot(),operation.request.sourceNodeId).fingerprint===operation.sourceFingerprint;}catch{return false;}
  };
  const restore=async(saved:PendingGridRequest,snapshot:WorkflowGridClientSnapshot,scope:string):Promise<GridOperation>=>{
    const request=parseWorkflowImageGridAction(JSON.parse(saved.body));
    if(request.operationId!==saved.operationId||request.projectId!==snapshot.projectId||request.workspaceId!==snapshot.workflowId
      ||typeof saved.sourceHash!=='string'||!/^[a-f0-9]{64}$/u.test(saved.sourceHash))throw new Error('GRID_RECOVERY_STORAGE');
    const guard=host.guard(),token=guard.begin(request.sourceNodeId);
    let sourceFingerprint:string|undefined;
    try{
      const {fingerprint}=sourceState(snapshot,request.sourceNodeId);
      if(await hashSource(fingerprint)===saved.sourceHash)sourceFingerprint=fingerprint;
    }catch{/* The original graph source may have been removed. */}
    const node=createWorkflowNode('input-image',0,0);
    const validationWorkflow={...snapshot.workflow,nodes:[{...node,id:request.sourceNodeId,config:{projectId:request.projectId}}],connections:[]};
    return {scope,sourceFingerprint,guard,token,request,validationWorkflow,body:saved.body,epoch:0,inFlight:false,sent:true,unknown:true};
  };
  const complete=async(operation:GridOperation,view:WorkflowGridClientView):Promise<void>=>{
    emit(operation,view);current=undefined;
    try{await recovery.remove(operation.scope,operation.request.operationId);}catch{/* Keep the original operation available for replay. */}
  };
  const stop=():void=>{
    const operation=current;if(!operation?.inFlight)return;
    ++operation.epoch;operation.inFlight=false;clearTimeout(operation.timer);operation.controller?.abort();
    if(operation.sent)unknown(operation);
    else emit(operation,{phase:'error',message:'已停止准备图片，尚未提交切分。',canRetry:true});
  };
  const attempt=async(operation:GridOperation):Promise<void>=>{
    if(operation.inFlight||!sameScope(operation))return;
    if(!operation.unknown&&!sourceCurrent(operation)){emit(operation,{phase:'stale',message:'原图片已变化，请重新选择图片。',canRetry:false});current=undefined;return;}
    operation.inFlight=true;const epoch=++operation.epoch,controller=new AbortController();operation.controller=controller;
    emit(operation,{phase:'preparing',message:operation.unknown?'正在核对原切分结果…':'正在切分并保存图片…',canRetry:false});
    const timer=setTimeout(()=>{if(active(operation,epoch))stop();},150_000);operation.timer=timer;
    try {
      if(!operation.body){
        const imageUrl=operation.request.source.imageUrl;
        if(imageUrl?.startsWith('blob:'))operation.request.source.imageUrl=await blobDataUrl(imageUrl,host.fetcher,controller.signal);
        if(!active(operation,epoch))return;
        if(!sourceCurrent(operation)){emit(operation,{phase:'stale',message:'原图片已变化，未提交切分，请重新选择图片。',canRetry:false});current=undefined;return;}
        operation.body=JSON.stringify(parseWorkflowImageGridAction(operation.request));
      }
      if(!active(operation,epoch)||!sameScope(operation))return;
      if(!operation.sent){
        const sourceHash=await hashSource(operation.sourceFingerprint!);
        if(!active(operation,epoch)||!sameScope(operation))return;
        const saved=await recovery.claim(operation.scope,{operationId:operation.request.operationId,body:operation.body,sourceHash});
        if(!active(operation,epoch)||!sameScope(operation))return;
        if(saved.operationId!==operation.request.operationId){
          const restored=await restore(saved,host.snapshot(),operation.scope);
          if(active(operation,epoch)&&sameScope(operation)){current=restored;await attempt(restored);}
          return;
        }
        operation.sent=true;
        if(!sourceCurrent(operation)){unknown(operation);return;}
      }
      const response=await host.fetcher('/api/workflow/image-actions',{method:'POST',credentials:'include',
        headers:{'content-type':'application/json','x-wujie-expected-actor-id':JSON.parse(operation.scope)[0] as string},body:operation.body,signal:controller.signal});
      const payload=record(await response.json());if(!active(operation,epoch)||!sameScope(operation))return;
      if(response.status===200&&payload?.success===true&&payload.status==='committed'){
        const expected={workspaceId:operation.request.workspaceId,operationId:operation.request.operationId,
          targetNodeIds:operation.request.targetNodeIds,parentVersionId:operation.request.source.assetVersionId};
        // Validate the complete receipt independently of a subsequently deleted
        // source; deletion cannot make a definitive receipt unknowable.
        try {planPublishedWorkflowImageGrid(operation.validationWorkflow,operation.request.sourceNodeId,operation.request.projectId,
          operation.request.columns,operation.request.rows,payload.value,expected);}
        catch{unknown(operation);return;}
        if(!sourceCurrent(operation)){await complete(operation,{phase:'stale',message:'切分已保存，原图片或连线已变化，未加入当前节点图。',canRetry:false});return;}
        let planned:Workflow;
        try {planned=planPublishedWorkflowImageGrid(host.snapshot().workflow,operation.request.sourceNodeId,operation.request.projectId,
          operation.request.columns,operation.request.rows,payload.value,expected);}
        catch {await complete(operation,{phase:'stale',message:'切分已保存，当前节点图已变化，未加入节点图。',canRetry:false});return;}
        host.apply(planned);await complete(operation,{phase:'completed',message:'切分图片已加入节点图。',canRetry:false});
      }else if(!operation.unknown&&response.status>=400&&response.status<500&&typeof payload?.code==='string'&&payload.retrySameOperation!==true){
        await recovery.remove(operation.scope,operation.request.operationId);
        if(!active(operation,epoch)||!sameScope(operation))return;
        operation.sent=false;
        const message=response.status===413?'切分后的 PNG 超出大小限制，请增加切分数量后重试。'
          :response.status===401||response.status===403||response.status===409?'当前账号、图片权限或项目状态已变化，请检查后重试。'
            :'图片未能切分，请检查图片和切分数量后重试。';
        emit(operation,{phase:'error',message,canRetry:true});
      }else unknown(operation);
    }catch{
      if(active(operation,epoch)){
        if(operation.sent)unknown(operation);
        else emit(operation,{phase:'error',message:'图片准备失败，请检查图片和浏览器存储后重试。',canRetry:true});
      }
    }finally{clearTimeout(timer);if(active(operation,epoch))operation.inFlight=false;}
  };
  return {
    async run(nodeId,columns,rows):Promise<void>{
      if(current?.inFlight||opening)return;
      if(current?.unknown){if(sameScope(current)){unknown(current);return;}current=undefined;}
      const launch={};opening=launch;
      let scope:string|undefined;
      try {
        const snapshot=host.snapshot();scope=scopeKey(snapshot);
        const saved=await recovery.read(scope);
        if(opening!==launch||!scopeCurrent(scope))return;
        if(saved){
          const restored=await restore(saved,host.snapshot(),scope);
          if(opening===launch&&scopeCurrent(scope)){current=restored;await attempt(restored);}
          return;
        }
        assertWorkflowImageGridShape(columns,rows);
        const source=sourceState(snapshot,nodeId);topologicalSort(snapshot.workflow.nodes,snapshot.workflow.connections);
        if(new Set(snapshot.workflow.nodes.map(node=>node.id)).size!==snapshot.workflow.nodes.length)throw new Error('GRID_IDS');
        const existing=new Set(snapshot.workflow.nodes.map(node=>node.id)),targetNodeIds:string[]=[];
        for(let index=0;index<columns*rows;index++){const id=crypto.randomUUID();if(existing.has(id))throw new Error('GRID_IDS');existing.add(id);targetNodeIds.push(id);}
        const request=parseWorkflowImageGridAction({action:'grid',projectId:snapshot.projectId,workspaceId:snapshot.workflowId,
          sourceNodeId:nodeId,operationId:crypto.randomUUID(),columns,rows,targetNodeIds,source:source.reference});
        const guard=host.guard(),token=guard.begin(nodeId);
        const sourceNode=snapshot.workflow.nodes.find(node=>node.id===nodeId)!;
        const validationWorkflow:Workflow={...snapshot.workflow,nodes:[{...sourceNode,ports:structuredClone(sourceNode.ports),config:{projectId:snapshot.projectId}}],connections:[]};
        current={scope,sourceFingerprint:source.fingerprint,guard,token,request,validationWorkflow,epoch:0,inFlight:false,sent:false,unknown:false};
        await attempt(current);
      }catch{
        if(opening===launch&&(!scope||scopeCurrent(scope)))host.onView({phase:'error',
          message:'无法准备切分，请检查当前图片、切分设置和浏览器存储。',canRetry:false});
      }finally{if(opening===launch)opening=undefined;}
    },
    async retry():Promise<void>{if(current)await attempt(current);},stop,
    reset():void {const operation=current;current=undefined;opening=undefined;if(operation){++operation.epoch;clearTimeout(operation.timer);operation.controller?.abort();}},
    dismiss():void {host.onView(idle);},
  };
}
