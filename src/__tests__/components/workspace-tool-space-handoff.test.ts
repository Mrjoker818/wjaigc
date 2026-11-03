import {readFileSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {expect,it} from 'vitest';
import {shouldInitiallyCollapseWorkspacePanel} from '@/lib/workspace-panel-layout';
import {CLOSED_CANVAS_TOOL_SESSION,openCanvasToolSession,type CanvasToolEntryPoint,type CanvasToolSession} from '@/lib/canvas-kernel/tool-registry';

const workspaceSource=readFileSync(path.resolve('src/components/canvas-workspace.tsx'),'utf8');
const workspaceFile=ts.createSourceFile('canvas-workspace.tsx',workspaceSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const canvasSource=readFileSync(path.resolve('src/components/infinite-canvas.tsx'),'utf8');
const canvasFile=ts.createSourceFile('infinite-canvas.tsx',canvasSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function findNodes(file:ts.SourceFile,predicate:(node:ts.Node)=>boolean):ts.Node[]{
  const result:ts.Node[]=[];const visit=(node:ts.Node):void=>{if(predicate(node))result.push(node);ts.forEachChild(node,visit);};
  visit(file);return result;
}
function evaluate(text:string,scope:Record<string,unknown>):unknown{
  const compiled=ts.transpileModule('const value=('+text+');',{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},reportDiagnostics:true,
  });
  if(compiled.diagnostics?.some(value=>value.category===ts.DiagnosticCategory.Error))throw Error('WORKSPACE_HANDOFF_SYNTAX');
  return new Function(...Object.keys(scope),compiled.outputText+'\nreturn value;')(...Object.values(scope)) as unknown;
}
function callback(file:ts.SourceFile,name:string):string{
  const matches=findNodes(file,node=>ts.isVariableDeclaration(node)&&node.name.getText(file)===name) as ts.VariableDeclaration[];
  const declaration=matches[0];
  if(matches.length!==1||!declaration.initializer||!ts.isCallExpression(declaration.initializer)
    ||declaration.initializer.expression.getText(file)!=='useCallback')throw Error('WORKSPACE_HANDOFF_CALLBACK_REQUIRED:'+name);
  return declaration.initializer.arguments[0].getText(file);
}
function boundActivation(scope:Record<string,unknown>):unknown{
  const entries=findNodes(workspaceFile,node=>(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))
    &&node.tagName.getText(workspaceFile)==='InfiniteCanvas') as (ts.JsxOpeningElement|ts.JsxSelfClosingElement)[];
  if(entries.length!==1)throw Error('WORKSPACE_HANDOFF_CANVAS_ENTRY');
  const prop=entries[0].attributes.properties.find(node=>ts.isJsxAttribute(node)&&node.name.getText(workspaceFile)==='onCanvasToolActivated') as ts.JsxAttribute|undefined;
  // An absent optional prop is the old real behavior: successful activation has no parent handoff.
  if(!prop)return undefined;
  if(!prop.initializer||!ts.isJsxExpression(prop.initializer)||!prop.initializer.expression||!ts.isIdentifier(prop.initializer.expression))
    throw Error('WORKSPACE_HANDOFF_ACTUAL_PROP_BINDING');
  const name=prop.initializer.expression.text;
  const child=findNodes(canvasFile,node=>ts.isFunctionDeclaration(node)&&node.name?.text==='InfiniteCanvas') as ts.FunctionDeclaration[];
  const parameter=child[0]?.parameters[0]?.name;
  if(child.length!==1||!parameter||!ts.isObjectBindingPattern(parameter))throw Error('WORKSPACE_HANDOFF_CHILD_BINDING');
  if(!parameter.elements.some(node=>node.name.getText(canvasFile)==='onCanvasToolActivated'))return undefined;
  return evaluate(callback(workspaceFile,name),scope);
}

// Execute actual source-derived parent/child activation arrows and the complete
// old reset listener with the real registry. UI setter adapters do not stand in
// for full Workspace rendering, outside-click handling or authenticated flows.
function readToolEffect():string {
  const file=workspaceFile;
  const effects:ts.CallExpression[]=[];
  const visit=(node:ts.Node):void=>{
    if(ts.isCallExpression(node)&&node.expression.getText(file)==='useEffect'
      &&node.getText(file).includes("'wujie:canvas-tool-opened'"))effects.push(node);
    ts.forEachChild(node,visit);
  };
  visit(file);
  if(effects.length!==1)throw Error('WORKSPACE_TOOL_EFFECT_UNIQUE');
  const result=ts.transpileModule(effects[0].getText(file),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},reportDiagnostics:true,
  });
  if(result.diagnostics?.some(value=>value.category===ts.DiagnosticCategory.Error))throw Error('WORKSPACE_TOOL_EFFECT_SYNTAX');
  return result.outputText;
}
interface EffectHarness {
  state:{collapsed:boolean;imageEditorOpen:boolean;videoPanelOpen:boolean;session:CanvasToolSession;toasts:string[];diagnostics:string[]};
  window:EventTarget&{innerWidth:number};
  openTool(toolId?:string,entryPoint?:CanvasToolEntryPoint):boolean;
  notifyClose():void;
  dispose():void;
}
function mountToolEffect(width:number,collapsed=false,activationFault?:Error):EffectHarness {
  const state={collapsed,imageEditorOpen:true,videoPanelOpen:true,session:CLOSED_CANVAS_TOOL_SESSION,toasts:[] as string[],diagnostics:[] as string[]};
  const window=Object.assign(new EventTarget(),{innerWidth:width});
  let cleanup:(()=>void)|undefined;
  const effect=(setup:()=>void|(()=>void)):void=>{const value=setup();if(typeof value==='function')cleanup=value;};
  new Function('useEffect','window','setShowImageEditor','setShowVideoPanel','setPanelCollapsed',
    'shouldInitiallyCollapseWorkspacePanel',readToolEffect())(
    effect,window,(next:boolean):void=>{state.imageEditorOpen=next;},(next:boolean):void=>{state.videoPanelOpen=next;},
    (next:boolean):void=>{state.collapsed=next;},shouldInitiallyCollapseWorkspacePanel);
  const notifyClose=():void=>{window.dispatchEvent(new Event('wujie:canvas-tool-opened'));};
  const bound=boundActivation({window,shouldInitiallyCollapseWorkspacePanel,
    setPanelCollapsed:(next:boolean):void=>{state.collapsed=next;}});
  const onCanvasToolActivated=activationFault?():never=>{throw activationFault;}:bound;
  const activate=evaluate(callback(canvasFile,'activateCanvasToolSession'),{
    selectedIds:new Set<string>(),selectedImage:null,projectId:'handoff-project',brandProject:null,
    openCanvasToolSession,CLOSED_CANVAS_TOOL_SESSION,closeCanvasToolPanels:notifyClose,
    setCanvasToolSession:(next:CanvasToolSession):void=>{state.session=next;},onCanvasToolActivated,
    toast:{error:(message:string):void=>{state.toasts.push(message);}},
    console:{error:(message:unknown):void=>{state.diagnostics.push(String(message));}},
  });
  if(typeof activate!=='function')throw Error('WORKSPACE_HANDOFF_ACTIVATE_REQUIRED');
  return {state,window,openTool:(toolId='chatcanvas',entryPoint:CanvasToolEntryPoint='bottom-toolbar'):boolean=>
    Reflect.apply(activate,undefined,[toolId,entryPoint]) as boolean,
    notifyClose,dispose:():void=>{if(!cleanup)throw Error('WORKSPACE_TOOL_EFFECT_CLEANUP_REQUIRED');cleanup();}};

}

for(const width of [320,375,390,767]){
  it('workspace tool handoff collapses an expanded panel at '+width+'px',():void=>{
    const harness=mountToolEffect(width);
    try{
      expect(harness.state.collapsed).toBe(false);
      harness.openTool();
      expect(harness.state).toMatchObject({collapsed:true,imageEditorOpen:false,videoPanelOpen:false});
      expect(harness.state.session.status).toBe('open');
    }finally{harness.dispose();}
  });
}
for(const width of [768,1024]){
  it('workspace tool handoff preserves the expanded desktop panel at '+width+'px',():void=>{
    const harness=mountToolEffect(width);
    try{
      harness.openTool();
      expect(harness.state).toMatchObject({collapsed:false,imageEditorOpen:false,videoPanelOpen:false});
      expect(harness.state.session.status).toBe('open');
    }finally{harness.dispose();}
  });
}
it('workspace tool handoff uses the current width when the tool opens',():void=>{
  const harness=mountToolEffect(1024);
  try{
    harness.window.innerWidth=390;
    harness.openTool();
    expect(harness.state.collapsed).toBe(true);
  }finally{harness.dispose();}
});
it('workspace tool handoff does not reopen an already collapsed mobile panel',():void=>{
  const harness=mountToolEffect(390,true);
  try{
    harness.openTool();harness.openTool();
    expect(harness.state.collapsed).toBe(true);
  }finally{harness.dispose();}
});
it('workspace tool handoff removes its original event listener on cleanup',():void=>{
  const harness=mountToolEffect(390);
  harness.dispose();harness.notifyClose();
  expect(harness.state).toMatchObject({collapsed:false,imageEditorOpen:true,videoPanelOpen:true});
});
it('workspace tool handoff ignores the existing close notification',():void=>{
  const harness=mountToolEffect(390);
  try{
    harness.notifyClose();
    expect(harness.state).toMatchObject({collapsed:false,imageEditorOpen:false,videoPanelOpen:false});
  }finally{harness.dispose();}
});
it('workspace tool handoff does not collapse a panel when tool selection is rejected',():void=>{
  const harness=mountToolEffect(390);
  try{
    expect(harness.openTool('erase','image-toolbar')).toBe(false);
    expect(harness.state).toMatchObject({collapsed:false,imageEditorOpen:true,videoPanelOpen:true});
    expect(harness.state.session.status).toBe('closed');
  }finally{harness.dispose();}
});
for(const [name,message] of [['ordinary','notification failed'],['selection-shaped','CANVAS_TOOL_SELECTION_REQUIRED:notification']] as const){
  it('workspace tool handoff keeps an accepted session when its notification throws '+name,():void=>{
    const harness=mountToolEffect(390,false,Error(message));
    try{
      expect(harness.openTool()).toBe(true);
      expect(harness.state.session.status).toBe('open');
      expect(harness.state.toasts).toEqual([]);
    }finally{harness.dispose();}
  });
}
