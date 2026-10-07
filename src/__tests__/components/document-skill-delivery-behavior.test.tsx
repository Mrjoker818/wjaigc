// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvasSkillProjectionCoordinator, loadCompletedCanvasSkillAssets,
  shouldAutoProjectCanvasSkill } from '@/lib/skill-runtime/canvas-client';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import { resolveCanvasSkillAssets } from '@/lib/skill-runtime/canvas-client';
import { importDocumentMediaBatch,assertDocumentMediaBatchProjection } from '@/lib/collaboration/document-media-batch-client';
import type { CanvasImage } from '@/lib/user-types';
import type { DocumentMediaBatchRequest } from '@/lib/collaboration/document-media-batch-request';

function callback<T>(name:string,bindings:Record<string,unknown>):T {
  const source=ts.createSourceFile('workspace.tsx',readFileSync('src/components/canvas-workspace.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let text:string|undefined;
  const visit=(node:ts.Node):void=>{
    if(ts.isVariableDeclaration(node)&&node.name.getText(source)===name&&node.initializer) {
      const expression=ts.isCallExpression(node.initializer)?node.initializer.arguments[0]:node.initializer;
      text='const '+name+'='+expression.getText(source)+';';
    }
    if(ts.isFunctionDeclaration(node)&&node.name?.text===name)text=node.getText(source);
    ts.forEachChild(node,visit);
  };visit(source);if(!text)throw new Error('Actual callback missing: '+name);
  const js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  return new Function(...Object.keys(bindings),js+';return '+name+';')(...Object.values(bindings)) as T;
}
afterEach(()=>vi.unstubAllGlobals());
function workspaceFixture(pause?:'resolve'|'import'|'refresh') {
  let release!:()=>void,entered!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;});const arrived=new Promise<void>(resolve=>{entered=resolve;});
  const wait=async(phase:string):Promise<void>=>{if(phase===pause){entered();await waiting;}};
  const actor={current:{id:'editor'}},project={current:{id:'target'}},history={current:'target'},epoch={current:1},mounted={current:true};
  const controller=new AbortController(),latest={current:[] as CanvasImage[]},successes:string[]=[],requests:Record<string,unknown>[]=[];
  let writable=true;
  const references=['a','b'].map(assetVersionId=>({assetVersionId,assetId:'asset-'+assetVersionId,url:'/api/serve-upload/'+assetVersionId+'.png',kind:'image' as const}));
  const authority={current:{projectId:'target',authority:'document',recordMediaHistory:():void=>{},isWritable:()=>writable,
    refreshMedia:async():Promise<CanvasImage[]>=>{await wait('refresh');return latest.current;}}};
  vi.stubGlobal('fetch',async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
    const url=String(input);
    if(url.includes('/assets?')) {await wait('resolve');return Response.json({actorUserId:'editor',projectId:'target',runId:'run',
      references:references.map(ref=>({...ref,width:32,height:24,placementState:{kind:'unplaced'}}))});}
    if(url!=='/api/collaboration/document-assets/import-batch')throw new Error('Private fallback forbidden: '+url);
    const request=JSON.parse(String(init?.body)) as DocumentMediaBatchRequest;requests.push({...request});await wait('import');
    const items=request.items.map((item:{sourceVersionId:string},index:number)=>({sourceVersionId:item.sourceVersionId,mode:'attach',childKey:'child-'+index,
      placementId:'placement-'+index,assetVersionId:item.sourceVersionId,documentSequence:2,
      assetReference:{...references[index],placementId:'placement-'+index,entityId:'entity-'+index}}));
    latest.current=items.map((item:typeof items[number])=>({id:item.assetReference.entityId,assetId:item.assetReference.assetId,
      assetVersionId:item.assetVersionId,placementId:item.placementId,url:item.assetReference.url,prompt:'',x:1,y:2,
      width:32,height:24,originalWidth:32,originalHeight:24,rotation:0,zIndex:1,createdAt:1}));
    return Response.json({success:true,projectId:'target',documentSequence:2,items});
  });
  const bindings:Record<string,unknown>={currentUserRef:actor,currentProjectRef:project,historyProjectIdRef:history,
    historyTransitionEpochRef:epoch,isMountedRef:mounted,historyLifecyclePendingRef:{current:false},isDocumentHistoryRecoveryPending:()=>false,
    collaborativeCanvasRef:authority,documentMediaTransferIntentsRef:{current:new Map()},latestImagesRef:latest,resolveCanvasSkillAssets,
    importDocumentMediaBatch,assertDocumentMediaBatchProjection,toast:{success:(message:string)=>successes.push(message)},
    autoLayoutImages:callback('autoLayoutImages',{}),getCanvasImageDisplaySize:callback('getCanvasImageDisplaySize',{}),
    loadCanvasImageSize:()=>{throw new Error('Authorized dimensions should be used');},
    handleAddImages:()=>{throw new Error('Legacy append forbidden');},captureCanvasInsertionScope:()=>{throw new Error('Private fallback forbidden');}};
  bindings.captureDocumentMediaTransferScope=callback('captureDocumentMediaTransferScope',bindings);
  bindings.handleAddDocumentEmbeddedMedia=callback('handleAddDocumentEmbeddedMedia',bindings);
  const parent=callback<(references:WorkspaceAssetReference[],meta:{runId:string;signal:AbortSignal})=>Promise<void>>('handleAddEmbeddedChatImages',bindings);
  return {run:()=>parent(references,{runId:'run',signal:controller.signal}),parent,references,requests,successes,arrived,release,
    mutate:(kind:string):void=>{
      if(kind==='actor')actor.current={id:'other'};
      if(kind==='project') {project.current={id:'other'};history.current='other';}
      if(kind==='roundtrip'){epoch.current+=2;}
      if(kind==='authority')authority.current={...authority.current};
      if(kind==='unmount')mounted.current=false;
      if(kind==='abort')controller.abort();
      if(kind==='readonly')writable=false;
    }};
}

function completionEffect(bindings: Record<string,unknown>): () => void {
  const source=ts.createSourceFile('chat.tsx',readFileSync('src/components/chat-panel.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback: ts.Node | undefined;
  const visit=(node:ts.Node):void=>{
    if(ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect'&&node.arguments[0]) {
      let readsProjection=false;
      const inspect=(child:ts.Node):void=>{ if(ts.isPropertyAccessExpression(child)
        &&child.getText(source)==='skillRun.projection')readsProjection=true;ts.forEachChild(child,inspect); };
      inspect(node.arguments[0]);if(readsProjection)callback=node.arguments[0];
    } ts.forEachChild(node,visit);
  };visit(source);
  if(!callback)throw new Error('Existing completed effect not found');
  const js=ts.transpileModule('const effect='+callback.getText(source)+';',
    {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  return new Function(...Object.keys(bindings),js+';return effect;')(...Object.values(bindings)) as ()=>void;
}
describe('1397 actual completion UI entry',()=>{
  it('actual Chat completion reaches actual Workspace parent and canonical batch acknowledgement',async()=>{
    const fixture=workspaceFixture(),documentFetch=fetch;
    const fetcher=(async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>String(input).startsWith('/api/skill-runs/run?')
      ?Response.json({run:{runId:'run',status:'completed',assetVersionIds:['a','b'],outputs:[]}}):documentFetch(input,init)) as typeof fetch;
    const coordinator=createCanvasSkillProjectionCoordinator();coordinator.activate('run','target');const errors:unknown[]=[];
    completionEffect({skillRun:{projection:{status:'completed',runId:'run'}},projectId:'target',canvasAuthority:'document',skillAccountKey:'editor',
      activeCanvasSkillRunRef:{current:{runId:'run',projectId:'target',skillId:'ordinary',sourceVersionIds:[]}},
      skillProjectionCoordinatorRef:{current:coordinator},shouldAutoProjectCanvasSkill,
      receiveSkillOutputs:fixture.parent,skillProjectionAttemptCountsRef:{current:new Map()},skillProjectionControllerRef:{current:null},
      skillCanvasImagesRef:{current:[]},toast:{error:(value:unknown)=>errors.push(value)},setSkillProjectionRetry:()=>{},
      loadCompletedCanvasSkillAssets:(input:Parameters<typeof loadCompletedCanvasSkillAssets>[0])=>loadCompletedCanvasSkillAssets({...input,fetcher})})();
    for(let i=0;i<20;i++)await new Promise(resolve=>setTimeout(resolve,0));
    expect(errors).toEqual([]);expect(fixture.requests).toHaveLength(1);expect(fixture.successes).toHaveLength(1);
  });
  it('completed Chat delivers all output versions once and performs zero private asset pre-reads',async()=>{
    const refs:WorkspaceAssetReference[]=['output-a','output-b'].map(assetVersionId=>({assetVersionId,
      assetId:'asset-'+assetVersionId,url:'/api/serve-upload/'+assetVersionId+'.png',kind:'image'}));
    const calls:unknown[]=[];const privateReads:string[]=[];const errors:unknown[]=[];
    const coordinator=createCanvasSkillProjectionCoordinator();coordinator.activate('run','target');
    const fetcher=(async(url:RequestInfo|URL):Promise<Response>=>{
      const path=String(url);
      if(path.startsWith('/api/assets?')) {privateReads.push(path);const version=new URL(path,'http://localhost').searchParams.get('assetVersionId');
        return Response.json(refs.find(r=>r.assetVersionId===version));}
      if(path.startsWith('/api/skill-runs/run/assets?'))return Response.json({actorUserId:'editor',projectId:'target',runId:'run',references:refs});
      return Response.json({run:{runId:'run',status:'completed',assetVersionIds:['output-a','output-b'],outputs:[]}});
    }) as typeof fetch;
    const effect=completionEffect({skillRun:{projection:{status:'completed',runId:'run'}},projectId:'target',
      canvasAuthority:'document',skillAccountKey:'editor',
      activeCanvasSkillRunRef:{current:{runId:'run',projectId:'target',skillId:'ordinary',sourceVersionIds:[]}},
      skillProjectionCoordinatorRef:{current:coordinator},shouldAutoProjectCanvasSkill,
      receiveSkillOutput:(reference:unknown):void=>{calls.push(reference);},
      receiveSkillOutputs:(references:unknown):void=>{calls.push(references);},
      skillProjectionAttemptCountsRef:{current:new Map()},skillProjectionControllerRef:{current:null},
      skillCanvasImagesRef:{current:[]},toast:{error:(value:unknown):void=>{errors.push(value);}},
      setSkillProjectionRetry:():void=>{},loadCompletedCanvasSkillAssets:(input:Parameters<typeof loadCompletedCanvasSkillAssets>[0])=>
        loadCompletedCanvasSkillAssets({...input,fetcher})});
    effect();
    // External HTTP completes immediately; allow the real effect/coordinator promise chain to settle.
    for(let i=0;i<20;i++)await new Promise(resolve=>setTimeout(resolve,0));
    expect(errors).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(refs);
    expect(privateReads).toEqual([]);
  });
});

describe('1397 actual Workspace parent -> document batch client -> canonical projection',()=>{
  it('sends one run-bound batch for two owner outputs, no private transfer or local append',async()=>{
    const fixture=workspaceFixture();await fixture.run();expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]).toMatchObject({skillRunId:'run',projectId:'target',items:[{sourceVersionId:'a'},{sourceVersionId:'b'}]});
    expect(fixture.successes).toHaveLength(1);
  });
  it.each([['resolve','actor'],['resolve','roundtrip'],['import','project'],['import','authority'],
    ['refresh','unmount'],['refresh','abort'],['refresh','readonly']] as const)('rejects late %s / %s without success',async(phase,mutation)=>{
    const fixture=workspaceFixture(phase),result=fixture.run().then(()=>null,error=>error);
    await fixture.arrived;fixture.mutate(mutation);fixture.release();expect(await result).toBeInstanceOf(Error);
    expect(fixture.successes).toEqual([]);if(phase==='resolve')expect(fixture.requests).toEqual([]);
  });
  it('document resolver keeps video and refuses cross-actor/run/project envelope without fallback',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({actorUserId:'editor',projectId:'target',runId:'run',
      references:[{assetId:'asset',assetVersionId:'video-v',kind:'video',url:'/video.mp4',width:32,height:24,placementState:{kind:'unplaced'}}]}));
    expect((await resolveCanvasSkillAssets({projectId:'target',runId:'run',assetVersionIds:['video-v'],expectedActorId:'editor',fetcher}))[0].kind).toBe('video');
    fetcher.mockResolvedValue(Response.json({actorUserId:'other',projectId:'target',runId:'run',references:[]}));
    await expect(resolveCanvasSkillAssets({projectId:'target',runId:'run',assetVersionIds:['video-v'],expectedActorId:'editor',fetcher})).rejects.toThrow();
    expect(fetcher.mock.calls.every(([url])=>String(url).startsWith('/api/skill-runs/run/assets?'))).toBe(true);
  });
});
