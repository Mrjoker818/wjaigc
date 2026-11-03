import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyWorkflow, createWorkflowNode } from '@/lib/workflow-engine';
import { projectLegacyRenderModel, projectReactFlowRenderModel } from '@/lib/workflow-renderer/view-model';
import {
  createReactFlowEdges,
  createReactFlowNodes,
  createReactFlowCommandHandlers,
  WorkflowReactFlowSurface,
} from '@/components/workflow/WorkflowReactFlowSurface';
import { WorkflowLegacySurface } from '@/components/workflow/WorkflowLegacySurface';
import { WorkflowShadowProbe } from '@/components/workflow/WorkflowShadowProbe';
import { validReport } from '@/__tests__/helpers/platform-compliance-fixtures';
import {parseUiSource,openingNodes,literalAttr,readUiAttr,evaluateUi,attrNode,type UiSource,type Opening} from '@/__tests__/helpers/ui-source-contracts';

const legacyRendererSource = readFileSync(resolve(process.cwd(), 'src/components/workflow/WorkflowLegacyNodeCard.tsx'), 'utf8');
const reactFlowSurfaceSource = readFileSync(resolve(process.cwd(), 'src/components/workflow/WorkflowReactFlowSurface.tsx'), 'utf8');
const reactFlowNodeSource = readFileSync(resolve(process.cwd(), 'src/components/workflow/WorkflowNodeCard.tsx'), 'utf8');
const rendererPresentationSource = readFileSync(resolve(process.cwd(), 'src/lib/workflow-renderer/presentation.ts'), 'utf8');
const nodeEditorSource = readFileSync(resolve(process.cwd(), 'src/components/node-editor.tsx'), 'utf8');
const canvasWorkspaceSource = readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');
const rendererSources = [
  'WorkflowLegacyNodeCard.tsx',
  'WorkflowLegacySurface.tsx',
  'WorkflowNodeCard.tsx',
  'WorkflowReactFlowSurface.tsx',
  'WorkflowShadowProbe.tsx',
].map(file => readFileSync(resolve(process.cwd(), `src/components/workflow/${file}`), 'utf8'));

const MINIMAP_POLICY_PREFIX = 'NODE_MINIMAP_POLICY:';
function requireMinimap(condition:unknown,code:string):asserts condition {if(!condition)throw new Error(MINIMAP_POLICY_PREFIX+code);}
function oneMinimap<T>(values:T[],code:string):T {requireMinimap(values.length===1,code+':'+values.length);return values[0];}
function inMinimapSpan(node:ts.Node,scope:ts.Node):boolean {return node.getStart()>=scope.getStart()&&node.getEnd()<=scope.getEnd();}
function minimapSyntacticSource(text:string):UiSource {
 const source=parseUiSource(text),name=source.file.fileName,options:ts.CompilerOptions={noLib:true,noResolve:true,noEmit:true,jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.ES2022};
 const isFile=(file:string):boolean=>file===name||file.replaceAll('\\','/').endsWith('/'+name);
 const host:ts.CompilerHost={getSourceFile:(file:string):ts.SourceFile|undefined=>isFile(file)?source.file:undefined,getDefaultLibFileName:():string=>'unused.d.ts',writeFile:():void=>{throw Error(MINIMAP_POLICY_PREFIX+'emit');},getCurrentDirectory:():string=>'/',getCanonicalFileName:(file:string):string=>file,useCaseSensitiveFileNames:():boolean=>true,getNewLine:():string=>'\n',fileExists:isFile,readFile:(file:string):string|undefined=>isFile(file)?text:undefined};
 const program=ts.createProgram([name],options,host);requireMinimap(program.getSyntacticDiagnostics(source.file).length===0,'syntax');return source;
}
interface MinimapPolicyParts {source:UiSource;fn:ts.FunctionDeclaration;rootReturn:ts.ReturnStatement;state:ts.VariableDeclaration;setterBinding:ts.Identifier;effect:ts.CallExpression;callback:ts.ArrowFunction|ts.FunctionExpression;toggle:Opening;close:Opening;map:Opening;toggleHandler:ts.Expression;closeHandler:ts.Expression;mapGuard:ts.BinaryExpression;refDeclaration:ts.VariableDeclaration}
function minimapExpression(node:Opening,key:string):ts.Expression {const a=attrNode(node,key);requireMinimap(a?.initializer&&ts.isJsxExpression(a.initializer)&&a.initializer.expression,'expression:'+key);return a.initializer.expression;}
function minimapNoSpreadOrDuplicate(node:Opening):void {const names:string[]=[];for(const a of node.attributes.properties){requireMinimap(ts.isJsxAttribute(a),'spread');names.push(a.name.getText());}requireMinimap(new Set(names).size===names.length,'duplicate-attribute');}
function minimapPlainPath(node:ts.Node,end:ts.Node):void {let current:ts.Node|undefined=node;while(current&&current!==end){requireMinimap(ts.isJsxElement(current)||ts.isJsxFragment(current)||ts.isJsxExpression(current)||ts.isParenthesizedExpression(current)||ts.isJsxOpeningElement(current)||ts.isJsxSelfClosingElement(current),'dead-or-indirect-jsx');current=current.parent;}requireMinimap(current===end,'return-path');}
function minimapPolicyPartsFromSource(source:UiSource):MinimapPolicyParts {
 const fn=oneMinimap(source.file.statements.filter(ts.isFunctionDeclaration).filter(n=>n.name?.text==='NodeEditor'),'node-editor');requireMinimap(fn.body,'body');const rootReturn=oneMinimap(fn.body.statements.filter(ts.isReturnStatement),'root-return');requireMinimap(rootReturn.expression,'root-return-expression');requireMinimap(fn.body.statements.at(-1)===rootReturn,'root-last-return');const checkPrelude=(node:ts.Node):void=>{if(ts.isFunctionLike(node))return;requireMinimap(!ts.isReturnStatement(node)&&!ts.isThrowStatement(node)&&!ts.isForStatement(node)&&!ts.isForInStatement(node)&&!ts.isForOfStatement(node)&&!ts.isWhileStatement(node)&&!ts.isDoStatement(node)&&!ts.isTryStatement(node)&&!ts.isSwitchStatement(node),'root-live-statement-path');ts.forEachChild(node,checkPrelude);};fn.body.statements.slice(0,-1).forEach(checkPrelude);
 const declarations=fn.body.statements.filter(ts.isVariableStatement).flatMap(s=>[...s.declarationList.declarations]),state=oneMinimap(declarations.filter(d=>ts.isArrayBindingPattern(d.name)&&d.name.elements.length===2&&ts.isBindingElement(d.name.elements[0])&&ts.isIdentifier(d.name.elements[0].name)&&d.name.elements[0].name.text==='showMinimap'),'state');
 requireMinimap(ts.isArrayBindingPattern(state.name)&&ts.isBindingElement(state.name.elements[1])&&ts.isIdentifier(state.name.elements[1].name)&&state.name.elements[1].name.text==='setShowMinimap','setter-binding');const setterBinding=state.name.elements[1].name;const refDeclaration=oneMinimap(declarations.filter(d=>ts.isIdentifier(d.name)&&d.name.text==='minimapToggleRef'),'actual-ref-declaration');requireMinimap(refDeclaration.initializer&&ts.isCallExpression(refDeclaration.initializer)&&ts.isIdentifier(refDeclaration.initializer.expression)&&refDeclaration.initializer.expression.text==='useRef'&&refDeclaration.initializer.arguments.length===1,'actual-ref-hook');
 const inside=source.nodes.filter(n=>inMinimapSpan(n,fn.body!)),calls=inside.filter((n):n is ts.CallExpression=>ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='setShowMinimap'),refs=inside.filter((n):n is ts.Identifier=>ts.isIdentifier(n)&&n.text==='setShowMinimap');requireMinimap(calls.length===3,'all-state-writes');requireMinimap(refs.length===4&&refs.every(n=>n===setterBinding||(ts.isCallExpression(n.parent)&&n.parent.expression===n&&calls.includes(n.parent))),'setter-alias-or-extra-reference');
 const effects=fn.body.statements.filter(ts.isExpressionStatement).map(s=>s.expression).filter((n):n is ts.CallExpression=>ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='useLayoutEffect').filter(e=>calls.some(c=>inMinimapSpan(c,e))&&inside.some(n=>inMinimapSpan(n,e)&&ts.isPropertyAccessExpression(n)&&n.name.text==='matchMedia')),effect=oneMinimap(effects,'live-media-effect');requireMinimap(effect.arguments.length===2&&ts.isArrayLiteralExpression(effect.arguments[1])&&effect.arguments[1].elements.length===0,'stable-mount-dependencies');const callback=effect.arguments[0];requireMinimap(ts.isArrowFunction(callback)||ts.isFunctionExpression(callback),'effect-callback');
 const openings=openingNodes(source).filter(n=>inMinimapSpan(n,fn.body!)),toggle=oneMinimap(openings.filter(n=>literalAttr(n,'aria-label')==='切换小地图'),'toggle'),close=oneMinimap(openings.filter(n=>literalAttr(n,'aria-label')==='关闭小地图'),'close'),map=oneMinimap(openings.filter(n=>!!attrNode(n,'data-workflow-minimap')),'map');for(const n of[toggle,close,map])minimapNoSpreadOrDuplicate(n);minimapPlainPath(toggle.parent,rootReturn);requireMinimap(ts.isJsxElement(map.parent),'map-element');
 let guard:ts.Node|undefined=map.parent;while(guard&&!ts.isBinaryExpression(guard)){requireMinimap(!ts.isConditionalExpression(guard)&&!ts.isIfStatement(guard),'dead-map');guard=guard.parent;}requireMinimap(guard&&ts.isBinaryExpression(guard)&&guard.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken&&ts.isIdentifier(guard.left)&&guard.left.text==='showMinimap','map-controlled-guard');const mapGuard=guard;
 let right:ts.Expression=mapGuard.right;while(ts.isParenthesizedExpression(right))right=right.expression;requireMinimap(ts.isCallExpression(right)&&right.arguments.length===0,'map-live-call');let callee:ts.Expression=right.expression;while(ts.isParenthesizedExpression(callee))callee=callee.expression;requireMinimap(ts.isArrowFunction(callee)&&ts.isBlock(callee.body),'map-live-iife');const mapReturns=callee.body.statements.filter(ts.isReturnStatement),mapReturn=oneMinimap(mapReturns,'map-root-return');requireMinimap(callee.body.statements.at(-1)===mapReturn&&callee.body.statements.every(s=>s===mapReturn||ts.isVariableStatement(s)),'dead-map-prelude');minimapPlainPath(map.parent,mapReturn);minimapPlainPath(mapGuard.parent,rootReturn);minimapPlainPath(close.parent,map.parent);
 const toggleHandler=minimapExpression(toggle,'onClick'),closeHandler=minimapExpression(close,'onClick');for(const h of[toggleHandler,closeHandler])requireMinimap(ts.isArrowFunction(h)||ts.isFunctionExpression(h),'live-handler');requireMinimap(calls.filter(c=>inMinimapSpan(c,callback)).length===1&&calls.filter(c=>inMinimapSpan(c,toggleHandler)).length===1&&calls.filter(c=>inMinimapSpan(c,closeHandler)).length===1,'writer-live-bindings');
 const ref=minimapExpression(toggle,'ref');requireMinimap(ts.isIdentifier(ref)&&ref.text==='minimapToggleRef','same-ref');requireMinimap(literalAttr(toggle,'aria-controls')==='workflow-minimap'&&literalAttr(map,'id')==='workflow-minimap','controls-id');return{source,fn,rootReturn,state,setterBinding,effect,callback,toggle,close,map,toggleHandler,closeHandler,mapGuard,refDeclaration};
}
function minimapPolicyParts(text:string):MinimapPolicyParts {return minimapPolicyPartsFromSource(minimapSyntacticSource(text));}
interface MinimapFakeMap {contains:(value:unknown)=>boolean}
interface MinimapFakeRoot {querySelector:(selector:string)=>MinimapFakeMap|null}
interface MinimapFakeToggle {ownerDocument:{activeElement:unknown};closest:(selector:string)=>MinimapFakeRoot;focus:()=>void}
function assertMinimapPolicyParts(p:MinimapPolicyParts):void {
 requireMinimap(p.state.initializer,'initializer');
 for(const initialWidth of[320,767,768,1280]){
  const state={value:false,writes:0,focuses:0,width:initialWidth,height:720},outside={},inside={},doc:{activeElement:unknown}={activeElement:outside};const isOpen=():boolean=>state.value;
  const setter=(next:unknown):void=>{const value=typeof next==='function'?(next as (value:boolean)=>unknown)(state.value):next;requireMinimap(typeof value==='boolean','boolean-state');state.value=value;state.writes++;};
  const useState=(initial:unknown):unknown[]=>{const value=typeof initial==='function'?(initial as ()=>unknown)():initial;requireMinimap(value===false,'ssr-default-closed');state.value=false;return[value,setter];};
  const initialized=evaluateUi(p.source,p.state.initializer,{useState,React:{useState}});requireMinimap(Array.isArray(initialized)&&initialized[0]===false&&initialized[1]===setter,'state-initialization');
  const map:MinimapFakeMap={contains:(value:unknown):boolean=>value===inside},root:MinimapFakeRoot={querySelector:(selector:string):MinimapFakeMap|null=>{requireMinimap(selector==='[data-workflow-minimap]','root-map-query');return state.value?map:null;}},toggle:MinimapFakeToggle={ownerDocument:doc,closest:(selector:string):MinimapFakeRoot=>{requireMinimap(selector==='.node-editor-root','same-node-root');return root;},focus:():void=>{state.focuses++;doc.activeElement=toggle;}};let refCalls=0;const useRef=(value:unknown):{current:unknown}=>{refCalls++;requireMinimap(value===null,'actual-ref-initial-value');return{current:value};};requireMinimap(p.refDeclaration.initializer,'actual-ref-initializer');const actualRef=evaluateUi(p.source,p.refDeclaration.initializer,{useRef,React:{useRef}});requireMinimap(refCalls===1&&actualRef!==null&&typeof actualRef==='object'&&'current' in actualRef&&actualRef.current===null,'actual-ref-result');const ref=actualRef as {current:MinimapFakeToggle|null};ref.current=toggle;
  interface FakeMedia {readonly matches:boolean;listeners:Set<()=>void>;addEventListener:(type:string,fn:unknown)=>void;removeEventListener:(type:string,fn:unknown)=>void}
  const mediaObjects:FakeMedia[]=[],resizeListeners=new Set<()=>void>();let mediaCalls=0;
  const win={get innerWidth():number{return state.width;},get innerHeight():number{return state.height;},matchMedia:(query:string):FakeMedia=>{mediaCalls++;const match=/^\(\s*(min|max)-width\s*:\s*([\d.]+)(px|rem)\s*\)$/.exec(query);requireMinimap(match,'supported-media-query');const threshold=Number(match[2])*(match[3]==='rem'?16:1);requireMinimap(Number.isFinite(threshold),'media-threshold');const minWidth=match[1]==='min'?threshold:0,maxWidth=match[1]==='max'?threshold:Infinity,listeners=new Set<()=>void>(),media:FakeMedia={get matches():boolean{return state.width>=minWidth&&state.width<=maxWidth;},listeners,addEventListener:(type:string,fn:unknown):void=>{requireMinimap(type==='change'&&typeof fn==='function','mql-listener');requireMinimap(!listeners.has(fn as ()=>void),'duplicate-mql-subscribe');listeners.add(fn as ()=>void);},removeEventListener:(type:string,fn:unknown):void=>{requireMinimap(type==='change'&&typeof fn==='function','mql-unsubscribe');requireMinimap(listeners.delete(fn as ()=>void),'same-mql-object-and-callback');}};mediaObjects.push(media);return media;},addEventListener:(type:string,fn:unknown):void=>{requireMinimap(type==='resize'&&typeof fn==='function','window-listener');resizeListeners.add(fn as ()=>void);},removeEventListener:(type:string,fn:unknown):void=>{requireMinimap(type==='resize'&&typeof fn==='function','window-unsubscribe');requireMinimap(resizeListeners.delete(fn as ()=>void),'same-window-callback');}};
  const scope=():Record<string,unknown>=>({window:win,setShowMinimap:setter,showMinimap:state.value,minimapToggleRef:ref});
  const attrs=():void=>{requireMinimap(readUiAttr(p.source,p.toggle,'aria-pressed',scope())===state.value&&readUiAttr(p.source,p.toggle,'aria-expanded',scope())===state.value,'aria-state');for(const n of[p.toggle,p.map,p.close]){for(const key of['disabled','hidden','aria-disabled','aria-hidden'])if(attrNode(n,key)){const value=readUiAttr(p.source,n,key,scope());requireMinimap(value===false||value==='false'||value===undefined,'available:'+key);}const classes=readUiAttr(p.source,n,'className',scope());requireMinimap(typeof classes==='string'&&!classes.split(/\s+/).some(token=>['hidden','invisible','opacity-0','pointer-events-none'].includes(token.split(':').at(-1)??'')),'visible-class');if(attrNode(n,'style')){const style=readUiAttr(p.source,n,'style',scope()) as Record<string,unknown>;requireMinimap(style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!==0,'visible-style');}}requireMinimap(readUiAttr(p.source,p.toggle,'ref',scope())===ref,'ref-wiring');};
  const callback=evaluateUi(p.source,p.callback,scope());requireMinimap(typeof callback==='function','callable-effect');const cleanup=(callback as ()=>unknown)();requireMinimap(typeof cleanup==='function','cleanup');requireMinimap(mediaCalls===1,'single-mql');requireMinimap(mediaObjects.reduce((n,m)=>n+m.listeners.size,0)+resizeListeners.size>0,'subscribed');requireMinimap(isOpen()===(initialWidth>=768),'initial-default');requireMinimap(doc.activeElement===outside&&state.focuses===0,'initial-no-focus-steal');attrs();
  const resize=(width:number,height=720):void=>{const previous=mediaObjects.map(media=>({media,matches:media.matches}));state.width=width;state.height=height;for(const old of previous)if(old.matches!==old.media.matches)for(const fn of[...old.media.listeners])fn();for(const fn of[...resizeListeners])fn();attrs();};
  const click=(node:Opening):void=>{const fn=readUiAttr(p.source,node,'onClick',scope());requireMinimap(typeof fn==='function','callable-handler');(fn as (event:unknown)=>unknown)({currentTarget:toggle,preventDefault:():void=>{},stopPropagation:():void=>{}});attrs();};
  resize(767);requireMinimap(isOpen()===false,'phone-default');click(p.toggle);requireMinimap(isOpen()===true,'toggle-opens');resize(320,568);requireMinimap(isOpen()===true,'same-phone-choice');resize(375,812);requireMinimap(isOpen()===true,'height-and-phone-choice');click(p.toggle);requireMinimap(isOpen()===false,'toggle-closes');click(p.toggle);resize(768);requireMinimap(isOpen()===true,'boundary-wide');click(p.toggle);requireMinimap(isOpen()===false,'wide-manual-close');resize(1280,600);resize(1024,900);requireMinimap(isOpen()===false,'same-wide-choice');resize(767);requireMinimap(isOpen()===false,'boundary-phone');
  click(p.toggle);doc.activeElement=inside;const beforeInside=state.focuses;resize(768);requireMinimap(doc.activeElement===inside,'wide-no-focus-steal');resize(767);requireMinimap(isOpen()===false&&doc.activeElement===toggle&&state.focuses===beforeInside+1,'contained-focus-restored');
  doc.activeElement=outside;click(p.toggle);const beforeOutside=state.focuses;resize(768);resize(767);requireMinimap(isOpen()===false&&doc.activeElement===outside&&state.focuses===beforeOutside,'outside-focus-preserved');
  click(p.toggle);doc.activeElement=inside;const beforeClose=state.focuses;click(p.close);requireMinimap(isOpen()===false&&doc.activeElement===toggle&&state.focuses===beforeClose+1,'close-focus-restored');
  (cleanup as ()=>void)();requireMinimap(mediaCalls===1&&mediaObjects.length===1,'no-new-mql-during-cleanup');requireMinimap(mediaObjects.every(m=>m.listeners.size===0)&&resizeListeners.size===0,'listeners-cleaned');const beforeCleanupWrites=state.writes;resize(768);requireMinimap(isOpen()===false&&state.writes===beforeCleanupWrites,'unmounted-no-writes');
 }
}
function assertMinimapPolicy(text:string):void {assertMinimapPolicyParts(minimapPolicyParts(text));}
function replaceMinimapNode(text:string,node:ts.Node,replacement:string):string {return text.slice(0,node.getStart())+replacement+text.slice(node.getEnd());}
function replaceMinimapOnce(text:string,from:string,to:string):string {requireMinimap(text.split(from).length===2,'mutation-unique');return text.replace(from,()=>to);}
function verifyMinimapPolicySource(text:string):{positive:number;negative:number;initialWidths:number[]} {
 const p=minimapPolicyParts(text);assertMinimapPolicyParts(p);const query=oneMinimap(p.source.nodes.filter((n):n is ts.StringLiteral=>ts.isStringLiteral(n)&&inMinimapSpan(n,p.callback)&&n.text==='(min-width: 768px)'),'query-literal'),equivalent=replaceMinimapNode(text,query,"'( min-width : 768px )'");assertMinimapPolicy(equivalent);
 const controls:{name:string;source:string}[]=[
 {name:'root-early-return',source:replaceMinimapNode(text,p.rootReturn,'if (true) return null;\n'+p.rootReturn.getText(p.source.file))},
 {name:'initial-open',source:replaceMinimapNode(text,p.state.initializer!,'useState(true)')},
 {name:'wrong-threshold',source:replaceMinimapNode(text,query,"'(min-width: 769px)'")},
 {name:'one-way-toggle',source:replaceMinimapNode(text,p.toggleHandler,'() => setShowMinimap(true)')},
 {name:'disabled-toggle',source:replaceMinimapNode(text,minimapExpression(p.toggle,'aria-expanded'),"showMinimap") .replace('aria-label="切换小地图"','disabled aria-label="切换小地图"')},
 {name:'disabled-close',source:replaceMinimapOnce(text,'aria-label="关闭小地图"','disabled aria-label="关闭小地图"')},
 {name:'missing-ref-declaration',source:replaceMinimapNode(text,p.refDeclaration.parent.parent,'')},
 {name:'non-hook-ref-initializer',source:replaceMinimapNode(text,p.refDeclaration.initializer!,'({current: null})')},
 {name:'wrong-expanded',source:replaceMinimapNode(text,minimapExpression(p.toggle,'aria-expanded'),'false')},
 {name:'wrong-ref',source:replaceMinimapNode(text,minimapExpression(p.toggle,'ref'),'toolbarRef')},
 {name:'unguarded-map',source:replaceMinimapNode(text,p.mapGuard.left,'true')},
 {name:'dead-toggle',source:replaceMinimapNode(text,p.toggle.parent,'{false && ('+p.toggle.parent.getText(p.source.file)+')}')},
 {name:'dead-handler',source:replaceMinimapNode(text,p.toggleHandler,'() => { if (false) setShowMinimap(true); }')},
 {name:'dead-map-return',source:replaceMinimapNode(text,p.mapGuard.right,p.mapGuard.right.getText(p.source.file).replace('return (','if (true) return null; return ('))},
 {name:'extra-resize-write',source:replaceMinimapOnce(text,'  const minimapPointer =','  useLayoutEffect(() => { window.addEventListener("resize", () => setShowMinimap(false)); }, []);\n  const minimapPointer =')},
 {name:'setter-alias',source:replaceMinimapOnce(text,'  const minimapPointer =','  const alias = setShowMinimap;\n  const minimapPointer =')},
 {name:'state-dependent-effect',source:replaceMinimapNode(text,p.effect.arguments[1],'[showMinimap]')},
 {name:'cleanup-missing',source:replaceMinimapOnce(text,"return (): void => media.removeEventListener('change', syncMinimapDefault);","return (): void => {};")},
 {name:'cleanup-wrong-mql-object',source:replaceMinimapOnce(text,"return (): void => media.removeEventListener('change', syncMinimapDefault);","return (): void => window.matchMedia('(min-width: 768px)').removeEventListener('change', syncMinimapDefault);")},
 {name:'unconditional-focus',source:replaceMinimapOnce(text,'if (toggle && map?.contains(toggle.ownerDocument.activeElement)) toggle.focus();','toggle?.focus();')},
 {name:'contained-focus-missing',source:replaceMinimapOnce(text,'if (toggle && map?.contains(toggle.ownerDocument.activeElement)) toggle.focus();','void map;')},
 {name:'close-focus-missing',source:replaceMinimapNode(text,p.closeHandler,'() => { setShowMinimap(false); }')}
 ];
 requireMinimap(controls.length===22,'negative-count');for(const control of controls){requireMinimap(control.source!==text,'negative-no-change:'+control.name);const parsedControl=minimapSyntacticSource(control.source);let rejected=false;try{assertMinimapPolicyParts(minimapPolicyPartsFromSource(parsedControl));}catch(error){requireMinimap(error instanceof Error&&error.message.startsWith(MINIMAP_POLICY_PREFIX),'negative-error:'+control.name);rejected=true;}requireMinimap(rejected,'negative-accepted:'+control.name);}
 return{positive:2,negative:controls.length,initialWidths:[320,767,768,1280]};
}

interface ExecutionDockRegions {
  rootStart: number; rootEnd: number; dockStart: number; logStart: number; logEnd: number; canvasCloseStart: number;
  dockClassStart: number; dockClassEnd: number; dockClassText: string;
}

function assertExecutionLogDockStructure(source: string): ExecutionDockRegions {
  const fail: (code: string) => never = code => { throw new Error('NODE_EXEC_LOG_AST:' + code); };
  const diagnostics = ts.transpileModule(source, {
    fileName: 'node-editor-contract.tsx', reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 },
  }).diagnostics ?? [];
  if (diagnostics.some(d => d.category === ts.DiagnosticCategory.Error)) fail('syntax');
  const ast = ts.createSourceFile('node-editor-contract.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ast.statements.filter(ts.isFunctionDeclaration).filter(n => n.name?.text === 'NodeEditor');
  if (declarations.length !== 1 || !declarations[0].body) fail('function-unique');
  const fn = declarations[0];
  if (!ts.getModifiers(fn)?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) fail('default-export');
  const returns = fn.body!.statements.filter(ts.isReturnStatement);
  if (returns.length !== 1 || !returns[0].expression) fail('return-unique');
  const elements: ts.JsxElement[] = [];
  const visit = (node: ts.Node): void => { if (ts.isJsxElement(node)) elements.push(node); ts.forEachChild(node, visit); };
  visit(returns[0].expression);
  const attributes = (node: ts.JsxElement, name: string): ts.JsxAttribute[] =>
    node.openingElement.attributes.properties.filter(ts.isJsxAttribute).filter(a => a.name.getText(ast) === name);
  const byRef = (name: string): ts.JsxElement => {
    const matches = elements.filter(e => attributes(e, 'ref').some(a => a.initializer && ts.isJsxExpression(a.initializer)
      && a.initializer.expression && ts.isIdentifier(a.initializer.expression) && a.initializer.expression.text === name));
    if (matches.length !== 1) fail(name + '-unique');
    return matches[0];
  };
  const classLiteral = (node: ts.JsxElement, required = false): ts.StringLiteral | undefined => {
    const attrs = attributes(node, 'className');
    if (attrs.length > 1 || (required && attrs.length !== 1)) fail('class-unique');
    if (!attrs.length) return undefined;
    const value = attrs[0].initializer;
    if (!value || !ts.isStringLiteral(value)) return fail('class-static');
    return value;
  };
  const roots = elements.filter(e => attributes(e, 'className').some(a => a.initializer && ts.isStringLiteral(a.initializer)
    && a.initializer.text.split(/\s+/).includes('node-editor-root')));
  if (roots.length !== 1) fail('root-unique');
  const root = roots[0], dock = byRef('executionDockRef'), log = byRef('executionLogPanelRef'), canvas = byRef('canvasContainerRef');
  let returnReached = false;
  for (let parent = root.parent; parent; parent = parent.parent) {
    if (parent === returns[0]) { returnReached = true; break; }
    if (!ts.isJsxFragment(parent) && !ts.isParenthesizedExpression(parent)) fail('root-conditional-return-path');
  }
  if (!returnReached) fail('root-return-path');
  const nativeDiv = (node: ts.JsxElement): void => {
    if (!ts.isIdentifier(node.openingElement.tagName) || node.openingElement.tagName.text !== 'div'
      || !ts.isIdentifier(node.closingElement.tagName) || node.closingElement.tagName.text !== 'div') fail('native-layout-anchor');
  };
  for (const anchor of [root, dock, log, canvas]) nativeDiv(anchor);
  const inside = (node: ts.Node, ancestor: ts.Node): boolean => { for (let p = node.parent; p; p = p.parent) if (p === ancestor) return true; return false; };
  if (!inside(canvas, root) || !inside(dock, root)) fail('outside-root');
  if (inside(log, canvas)) fail('log-inside-canvas');
  if (!inside(log, dock)) fail('log-outside-dock');
  if (dock.parent !== root) fail('dock-not-root-child');
  let main: ts.Node = canvas;
  while (main.parent && main.parent !== root) main = main.parent;
  if (!ts.isJsxElement(main) || main === dock || main.getEnd() >= dock.getStart(ast)) fail('main-dock-siblings-order');
  nativeDiv(main);
  const unwrap = (expression: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) expression = expression.expression;
    return expression;
  };
  const neVars = fn.body!.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations])
    .filter(d => ts.isIdentifier(d.name) && d.name.text === 'neVars');
  const checkStyle = (node: ts.JsxElement, label: string): void => {
    if (node.openingElement.attributes.properties.some(ts.isJsxSpreadAttribute)) fail(label + '-spread');
    const attrs = attributes(node, 'style');
    if (attrs.length > 1) fail(label + '-style-unique');
    if (!attrs.length) return;
    const value = attrs[0].initializer;
    if (!value || !ts.isJsxExpression(value) || !value.expression) fail(label + '-style-expression');
    const object = unwrap(value.expression);
    if (!ts.isObjectLiteralExpression(object)) fail(label + '-style-object');
    for (const prop of object.properties) {
      if (ts.isSpreadAssignment(prop)) {
        if (!ts.isIdentifier(prop.expression) || prop.expression.text !== 'neVars' || neVars.length !== 1 || !neVars[0].initializer) fail(label + '-style-spread');
        const variables = unwrap(neVars[0].initializer);
        if (!ts.isObjectLiteralExpression(variables) || !variables.properties.every(p => ts.isPropertyAssignment(p)
          && ts.isStringLiteral(p.name) && p.name.text.startsWith('--'))) fail(label + '-style-vars');
      } else {
        if (!ts.isPropertyAssignment(prop) || (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name))) fail(label + '-style-key');
        if (!['background', 'cursor'].includes(prop.name.text)) fail(label + '-style-position');
      }
    }
  };
  const normalFlow = (node: ts.JsxElement, label: string): string[] => {
    const tokens = classLiteral(node)?.text.split(/\s+/).filter(Boolean) ?? [];
    for (const token of tokens) {
      const tail = token.slice(token.lastIndexOf(':') + 1).replace(/^!|!$/g, '');
      if (/^(?:absolute|fixed|sticky|hidden|contents|flex-row(?:-reverse)?|flex-col-reverse|h-0)$/.test(tail)
        || /^(?:-?(?:top|bottom|left|right|inset|translate|order|float)-|-m[trblxy]?-)/.test(tail)
        || /\[(?:position|display|float|order|transform|translate|inset|top|bottom|left|right):/.test(token)
        || (tail.startsWith('transform') && tail !== 'transform-none')) fail(label + '-position');
    }
    checkStyle(node, label); return tokens;
  };
  const rootTokens = normalFlow(root, 'root');
  if (!rootTokens.includes('flex') || !rootTokens.includes('flex-col') || rootTokens.some(t => /(?:^|:)(?:grid|block|inline-flex|inline-grid)$/.test(t))) fail('root-column-layout');
  if (!normalFlow(main, 'main').includes('flex-1')) fail('main-flex-region');
  const dockTokens = normalFlow(dock, 'dock');
  if (!dockTokens.includes('shrink-0') || !dockTokens.includes('border-t') || attributes(dock, 'data-workflow-ui-occlusion').length !== 1) fail('dock-normal-flow');
  let guarded = false;
  for (let parent: ts.Node | undefined = log; parent && parent !== dock; parent = parent.parent) {
    if (ts.isJsxElement(parent)) normalFlow(parent, 'log');
    else if (ts.isBinaryExpression(parent)) {
      if (parent.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken || !ts.isIdentifier(unwrap(parent.left))
        || (unwrap(parent.left) as ts.Identifier).text !== 'showExecLog' || !inside(log, parent.right)) fail('log-positive-condition');
      guarded = true;
    } else if (!ts.isParenthesizedExpression(parent) && !ts.isJsxExpression(parent)) fail('log-unsupported-parent');
  }
  if (!guarded) fail('log-positive-condition');
  const dockClass = classLiteral(dock, true)!;
  return { rootStart: root.getStart(ast), rootEnd: root.getEnd(), dockStart: dock.getStart(ast), logStart: log.getStart(ast), logEnd: log.getEnd(),
    canvasCloseStart: canvas.closingElement.getStart(ast), dockClassStart: dockClass.getStart(ast),
    dockClassEnd: dockClass.getEnd(), dockClassText: dockClass.text };
}

afterEach(() => vi.unstubAllGlobals());

describe('WorkflowReactFlowSurface', () => {
  it('renders the compliance report summary through the shared React Flow product card', () => {
    const workflow = createEmptyWorkflow('compliance summary');
    const node = createWorkflowNode('ai-skill', 0, 0, 'Platform compliance');
    node.execResult = {
      status: 'success',
      output: {
        complianceReports: [validReport({
          verdict: 'blocked',
          summary: { passed: 0, warning: 0, blocked: 1, unknown: 0 },
          checks: [{
            ...validReport().checks[0]!, status: 'blocked', evidence: ['尺寸不合规'],
            remediation: '调整尺寸',
          }],
        })],
        documentAssetVersionIds: ['report-version'],
      },
    };
    workflow.nodes = [node];

    const markup = renderToStaticMarkup(createElement(WorkflowReactFlowSurface, {
      model: projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 }),
      onCommand: vi.fn(), readOnly: false,
    }));

    expect(markup).toContain('不通过');
    expect(markup).toContain('1 份报告');
    expect(markup).toContain('1 项问题');
    expect(markup).not.toContain('/api/skill-reports/report-version');
  });

  it.each([
    ['unknown verdict', { schemaVersion: 1, verdict: 'approved', summary: { passed: 1, warning: 0, blocked: 0, unknown: 0 } }],
    ['missing fields', { schemaVersion: 1, verdict: 'passed' }],
    ['invalid counts', { schemaVersion: 1, verdict: 'passed', summary: { passed: -1, warning: 0, blocked: 0, unknown: 0 } }],
  ])('fails closed for %s in the shared compliance summary', (_label, report) => {
    const workflow = createEmptyWorkflow('invalid compliance summary');
    const node = createWorkflowNode('ai-skill', 0, 0, 'Platform compliance');
    node.execResult = { status: 'success', output: { complianceReports: [report] } };
    workflow.nodes = [node];

    const markup = renderToStaticMarkup(createElement(WorkflowReactFlowSurface, {
      model: projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 }),
      onCommand: vi.fn(), readOnly: false,
    }));

    expect(markup).toContain('待确认');
    expect(markup).toContain('需要人工复核');
    expect(markup).not.toContain('>通过<');
  });

  it('keeps execution logs in the bottom dock instead of covering workflow nodes', () => {
    expect(nodeEditorSource).not.toContain('(showExecLog || execLogs.length > 0)');
    expect(nodeEditorSource).not.toContain('absolute bottom-12 right-3 w-[380px]');
    expect(nodeEditorSource).not.toMatch(/setExecStatus\('running'\);\r?\n\s+setShowExecLog\(true\);/);
    expect(nodeEditorSource).toContain('{showExecLog && (');
    expect(nodeEditorSource).toContain('data-workflow-ui-occlusion');
    expect(nodeEditorSource).not.toContain('absolute bottom-12 left-3');
    expect(nodeEditorSource).toContain('aria-live="polite"');
    expect(nodeEditorSource).toContain('selectedNodeIds.size === 0 && (');
    const regions = assertExecutionLogDockStructure(nodeEditorSource);
    const logMarkup = nodeEditorSource.slice(regions.logStart, regions.logEnd);
    const withoutLog = nodeEditorSource.slice(0, regions.logStart) + 'null' + nodeEditorSource.slice(regions.logEnd);
    const rootMarkup = nodeEditorSource.slice(regions.rootStart, regions.rootEnd);
    const controls = [
      { name: 'root hidden by false branch', source: nodeEditorSource.slice(0, regions.rootStart) + '{false && (' + rootMarkup + ')}' + nodeEditorSource.slice(regions.rootEnd), error: 'root-conditional-return-path' },
      { name: 'custom component root', source: nodeEditorSource.slice(0, regions.rootStart) + rootMarkup.replace(/^<div\b/, '<RootLayout').replace(/<\/div>$/, '</RootLayout>') + nodeEditorSource.slice(regions.rootEnd), error: 'native-layout-anchor' },
      { name: 'missing dock', source: nodeEditorSource.replace('ref={executionDockRef}', 'ref={missingDockRef}'), error: 'executionDockRef-unique' },
      { name: 'log outside dock', source: withoutLog.slice(0, regions.dockStart) + logMarkup + withoutLog.slice(regions.dockStart), error: 'log-outside-dock' },
      { name: 'log inside canvas', source: withoutLog.slice(0, regions.canvasCloseStart) + logMarkup + withoutLog.slice(regions.canvasCloseStart), error: 'log-inside-canvas' },
      { name: 'absolute dock class', source: nodeEditorSource.slice(0, regions.dockClassStart) + JSON.stringify(regions.dockClassText + ' absolute') + nodeEditorSource.slice(regions.dockClassEnd), error: 'dock-position' },
      { name: 'absolute dock style', source: nodeEditorSource.replace('ref={executionDockRef}', 'ref={executionDockRef} style={{ position: "absolute" }}'), error: 'dock-style-position' },
      { name: 'unguarded log', source: nodeEditorSource.replace('{showExecLog && (', '{true && ('), error: 'log-positive-condition' },
      { name: 'malformed source', source: nodeEditorSource.slice(0, regions.dockClassStart), error: 'syntax' },
    ];
    for (const control of controls) {
      expect(control.source, control.name + ' changes its input').not.toBe(nodeEditorSource);
      expect(() => assertExecutionLogDockStructure(control.source), control.name)
        .toThrow('NODE_EXEC_LOG_AST:' + control.error);
    }
  });

  it('keeps the minimap out of the mobile interaction surface', () => {
    // Mobile defaults to closed; users can explicitly open and close the minimap at every width.
    // Verify the live state writers and controls instead of requiring a permanent CSS hiding class.
    expect(nodeEditorSource).toContain('data-workflow-minimap');
    expect(verifyMinimapPolicySource(nodeEditorSource)).toEqual({positive:2,negative:22,initialWidths:[320,767,768,1280]});
  });

  it('defers ResizeObserver-driven layout writes until the next animation frame', () => {
    expect(legacyRendererSource).toContain('requestAnimationFrame(() => {');
    expect(legacyRendererSource).toContain('cancelAnimationFrame(resizeFrame);');
    expect(nodeEditorSource).toContain('requestAnimationFrame(() => {');
    expect(nodeEditorSource).toContain('cancelAnimationFrame(viewportResizeFrame);');
  });

  it('mounts only the host-authorized visible nodes and their internal edges', () => {
    const workflow = createEmptyWorkflow('virtualized react flow');
    const first = createWorkflowNode('input-text', 0, 0, 'First');
    const second = createWorkflowNode('ai-generate', 240, 0, 'Second');
    const third = createWorkflowNode('output-image', 480, 0, 'Third');
    workflow.nodes = [first, second, third];
    workflow.connections = [
      {
        id: 'first-second', fromNodeId: first.id, fromPortId: 'out-prompt',
        toNodeId: second.id, toPortId: 'in-prompt', type: 'prompt',
      },
      {
        id: 'second-third', fromNodeId: second.id, fromPortId: 'out-image',
        toNodeId: third.id, toPortId: 'in-image', type: 'image',
      },
    ];
    const model = projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 });
    const visibleNodeIds = new Set([first.id, second.id]);

    expect(createReactFlowNodes(model, false, {}, visibleNodeIds).map(node => node.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(createReactFlowEdges(model, {}, 'idle', visibleNodeIds).map(edge => edge.id)).toEqual([
      'first-second',
    ]);
    expect(reactFlowSurfaceSource).toContain('const projectedEdges = useMemo(() => createReactFlowEdges(');
    expect(reactFlowSurfaceSource).toContain('edges={projectedEdges}');
  });

  it('renders the domain projection as an inert custom-node surface without dispatching commands', () => {
    const workflow = createEmptyWorkflow('react flow');
    workflow.nodes = [createWorkflowNode('input-text', 0, 0, 'Prompt')];
    const onCommand = vi.fn();
    const markup = renderToStaticMarkup(createElement(WorkflowReactFlowSurface, {
      model: projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 }),
      onCommand,
      readOnly: true,
    }));

    expect(markup).toContain('data-workflow-react-flow-surface');
    expect(markup).toContain('Prompt');
    expect(markup).toContain('out-prompt');
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('owns the legacy edge and node DOM while preserving port and collapse accessibility contracts', () => {
    const workflow = createEmptyWorkflow('legacy');
    workflow.nodes = [createWorkflowNode('input-text', 0, 0, 'Legacy prompt')];
    const model = projectReactFlowRenderModel(workflow, { x: 4, y: 8, zoom: 1 });
    const onCommand = vi.fn();

    const markup = renderToStaticMarkup(createElement(WorkflowLegacySurface, {
      model,
      onCommand,
    }));

    expect(markup).toContain('data-workflow-legacy-edge-layer');
    expect(markup).toContain('data-workflow-legacy-node-layer');
    expect(markup).toContain(`data-node-id="${workflow.nodes[0].id}"`);
    expect(markup).toContain(`data-port-id="${workflow.nodes[0].id}-out-out-prompt"`);
    expect(markup).toContain('aria-label="折叠节点"');
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('keeps legacy card side effects in the host callbacks rather than the renderer module', () => {
    for (const source of rendererSources) {
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toContain('localStorage');
      expect(source).not.toContain("@/lib/prompt-templates");
    }
    expect(legacyRendererSource).toContain('onImageFileDrop');
    expect(legacyRendererSource).toContain('onSavePromptPreset');
  });

  it('keeps every workflow-engine dependency type-only across renderer modules', () => {
    for (const source of rendererSources) {
      const engineImports = source.match(/import[^;]*from ['"]@\/lib\/workflow-engine['"];/g) ?? [];
      expect(engineImports.every(statement => statement.startsWith('import type'))).toBe(true);
    }
    expect(rendererPresentationSource).not.toMatch(/\bfetch\s*\(|localStorage/);
  });

  it('does not touch storage while rendering a host-supplied prompt template list', () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem, setItem, removeItem: vi.fn() });
    const workflow = createEmptyWorkflow('pure renderer');
    workflow.nodes = [createWorkflowNode('input-text', 0, 0, 'Prompt')];
    const props = {
      model: projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 }),
      onCommand: vi.fn(),
      promptTemplates: [{
        id: 'plain-template', name: 'Plain', content: 'plain prompt', category: 'test', tags: ['plain'],
      }],
    } as unknown as ComponentProps<typeof WorkflowLegacySurface>;

    renderToStaticMarkup(createElement(WorkflowLegacySurface, props));

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('renders legacy node, port, geometry, and edge DOM only from the legacy projection', () => {
    const workflow = createEmptyWorkflow('projected legacy DOM');
    const source = createWorkflowNode('input-text', 0, 0, 'raw source');
    const target = createWorkflowNode('ai-generate', 240, 0, 'raw target');
    workflow.nodes = [source, target];
    workflow.connections = [{
      id: 'raw-edge', fromNodeId: source.id, fromPortId: 'out-prompt',
      toNodeId: target.id, toPortId: 'in-prompt', type: 'prompt',
    }];
    const model = projectLegacyRenderModel(workflow, { x: 0, y: 0, zoom: 1 });
    model.nodes[0] = {
      ...model.nodes[0]!, label: 'projected source', position: { x: 111, y: 222 },
      size: { width: 333, height: 144 },
      ports: [{ id: 'projected-output', label: 'Projected output', type: 'prompt', direction: 'out' }],
    };
    model.edges[0] = {
      ...model.edges[0]!, id: 'projected-edge',
      source: { nodeId: source.id, portId: 'projected-output' },
    };

    const markup = renderToStaticMarkup(createElement(WorkflowLegacySurface, {
      model,
      onCommand: vi.fn(),
      getPortPosition: (_node, port) => port.direction === 'out' ? { x: 10, y: 20 } : { x: 30, y: 20 },
    }));

    expect(markup).toContain('projected source');
    expect(markup).not.toContain('raw source');
    expect(markup).toContain('left:111px');
    expect(markup).toContain('top:222px');
    expect(markup).toContain('width:333px');
    expect(markup).toContain('min-height:144px');
    expect(markup).toContain(`data-port-id="${source.id}-out-projected-output"`);
    expect(markup).not.toContain(`data-port-id="${source.id}-out-out-prompt"`);
    expect(markup).toContain('data-edge-id="projected-edge"');
    expect(markup).not.toContain('data-edge-id="raw-edge"');
  });

  it('cannot report shadow sync when an omitted legacy projection node is also omitted from actual DOM', () => {
    const workflow = createEmptyWorkflow('legacy omission');
    workflow.nodes = [createWorkflowNode('input-text', 0, 0, 'must be omitted')];
    const shadow = projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 });
    const legacy = { ...projectLegacyRenderModel(workflow, { x: 0, y: 0, zoom: 1 }), nodes: [] };
    const markup = renderToStaticMarkup(createElement('div', null,
      createElement(WorkflowLegacySurface, { model: legacy, onCommand: vi.fn() }),
      createElement(WorkflowShadowProbe, { legacyModel: legacy, shadowModel: shadow }),
    ));

    expect(markup).not.toContain('data-node-id');
    expect(markup).toContain('data-in-sync="false"');
  });

  it('compares the exact legacy and shadow models supplied by the host', () => {
    const workflow = createEmptyWorkflow('probe');
    workflow.nodes = [createWorkflowNode('input-text', 0, 0, 'Probe')];
    const legacy = projectReactFlowRenderModel(workflow, { x: 12, y: 16, zoom: 1.2 });
    const shadow = { ...legacy, nodes: [] };

    const markup = renderToStaticMarkup(createElement(WorkflowShadowProbe, {
      legacyModel: legacy,
      shadowModel: shadow,
    }));

    expect(markup).toContain('data-in-sync="false"');
  });

  it('translates React Flow group drag, viewport, and connections into controlled host updates', () => {
    const workflow = createEmptyWorkflow('commands');
    const source = createWorkflowNode('input-text', 0, 0, 'Prompt');
    const target = createWorkflowNode('ai-generate', 240, 0, 'Generate');
    workflow.nodes = [source, target];
    const onCommand = vi.fn();
    let hostModel = projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 }, new Set([source.id, target.id]));
    const handlers = createReactFlowCommandHandlers(
      hostModel,
      onCommand,
      viewport => { hostModel = { ...hostModel, viewport }; },
    );

    handlers.commitNodeDrag([
      { id: source.id, position: { x: 32, y: 12 } },
      { id: target.id, position: { x: 272, y: 12 } },
    ], 'flow-drag');
    handlers.updateViewport({ x: -120, y: 48, zoom: 1.5 });
    handlers.createConnection({
      source: source.id, sourceHandle: 'out-prompt', target: target.id, targetHandle: 'in-prompt',
    }, 'flow-connect');

    expect(onCommand).toHaveBeenNthCalledWith(1, {
      type: 'nodes.drag.commit',
      initialPositions: [
        { nodeId: source.id, position: { x: 0, y: 0 } },
        { nodeId: target.id, position: { x: 240, y: 0 } },
      ],
      positions: [
        { nodeId: source.id, position: { x: 32, y: 12 } },
        { nodeId: target.id, position: { x: 272, y: 12 } },
      ],
      transactionId: 'flow-drag',
    });
    expect(onCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'connection.create', transactionId: 'flow-connect',
      connection: expect.objectContaining({ type: 'prompt', fromPortId: 'out-prompt', toPortId: 'in-prompt' }),
    }));
    expect(hostModel.viewport).toEqual({ x: -120, y: 48, zoom: 1.5 });
    expect(reactFlowSurfaceSource).toContain('onViewportChange=');
  });

  it('uses the full product card and status/control/accessibility contract', () => {
    const workflow = createEmptyWorkflow('product card');
    const node = createWorkflowNode('ai-generate', 0, 0, 'Generate');
    node.execResult = { status: 'running' };
    workflow.nodes = [node];

    const markup = renderToStaticMarkup(createElement(WorkflowReactFlowSurface, {
      model: projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 }, new Set([node.id])),
      onCommand: vi.fn(),
      readOnly: false,
    }));

    expect(markup).toContain('data-node-id');
    expect(markup).toContain('node-type-bar');
    expect(markup).toContain('status-badge running');
    expect(markup).toContain('aria-label="折叠节点"');
    expect(markup).toContain('title="运行此节点"');
  });

  it('keeps nodes and ports movable/connectable only on the controlled interactive surface', async () => {
    const workflow = createEmptyWorkflow('conditional interaction');
    workflow.nodes = [createWorkflowNode('input-text', 0, 0, 'Prompt')];
    const model = projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 });
    type ProjectedModel = typeof model;
    const surfaceModule = await import('@/components/workflow/WorkflowReactFlowSurface');
    const createNodes = (surfaceModule as unknown as {
      createReactFlowNodes: (renderModel: ProjectedModel, readOnly: boolean) => Array<{
        draggable?: boolean;
        connectable?: boolean;
        data: { readOnly: boolean };
      }>;
    }).createReactFlowNodes;

    expect(createNodes(model, false)[0]).toMatchObject({
      draggable: true,
      connectable: true,
      data: { readOnly: false },
    });
    expect(createNodes(model, true)[0]).toMatchObject({
      draggable: false,
      connectable: false,
      data: { readOnly: true },
    });
    expect(reactFlowSurfaceSource).toContain("@xyflow/react/dist/style.css");
    expect(reactFlowSurfaceSource).toContain('useNodesState');
    expect(reactFlowSurfaceSource).toContain('onNodesChange={readOnly ? undefined : onFlowNodesChange}');
    expect(reactFlowSurfaceSource).toContain('if (!dragActiveRef.current) setFlowNodes(projectedNodes)');
    expect(reactFlowSurfaceSource).not.toContain('useEdgesState');
  });

  it('preserves projected Ctrl multi-selection without invoking a second legacy selection path', async () => {
    const workflow = createEmptyWorkflow('multiselect');
    const first = createWorkflowNode('input-text', 0, 0, 'first');
    const second = createWorkflowNode('input-text', 240, 0, 'second');
    workflow.nodes = [first, second];
    const model = projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 }, new Set([first.id]));
    const legacySelect = vi.fn();
    const surfaceModule = await import('@/components/workflow/WorkflowReactFlowSurface');
    const nodes = surfaceModule.createReactFlowNodes(model, false, {
      cardCallbacks: { onSelect: legacySelect } as never,
    });

    nodes[1]!.data.cardProps.onSelect({ ctrlKey: true, metaKey: false } as never);

    expect(surfaceModule.resolveReactFlowSelection(model, second.id, true))
      .toEqual([first.id, second.id]);
    expect(legacySelect).not.toHaveBeenCalled();
  });

  it('uses each visible product port as the single React Flow handle and forwards size measurement', () => {
    const workflow = createEmptyWorkflow('visible handles');
    const node = createWorkflowNode('input-text', 0, 0, 'Prompt');
    workflow.nodes = [node];
    const onUpdateNodeSize = vi.fn();
    const model = projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 });
    const markup = renderToStaticMarkup(createElement(WorkflowReactFlowSurface, {
      model,
      onCommand: vi.fn(),
      readOnly: false,
      cardCallbacks: { onUpdateNodeSize } as never,
    }));
    const portId = `${node.id}-out-out-prompt`;
    const portTag = markup.match(new RegExp(`<[^>]*data-port-id="${portId}"[^>]*>`))?.[0];

    expect(portTag).toContain('react-flow__handle');
    expect(markup.match(new RegExp(`data-port-id="${portId}"`, 'g'))).toHaveLength(1);
    expect(markup.match(/data-port-id=/g)).toHaveLength(node.ports.length);
    expect(reactFlowNodeSource).toContain('renderPortHandle');
    expect(reactFlowNodeSource).not.toContain("style={{ top: `${((index + 1)");

    const flowNode = createReactFlowNodes(model, false, {
      cardCallbacks: { onUpdateNodeSize } as never,
    })[0]!;
    flowNode.data.cardProps.onUpdateNodeSize?.(node.id, 333, 222);
    expect(onUpdateNodeSize).toHaveBeenCalledWith(node.id, 333, 222);
  });

  it('projects custom typed edges instead of React Flow defaults', async () => {
    const workflow = createEmptyWorkflow('custom edge');
    const source = createWorkflowNode('input-text', 0, 0, 'Prompt');
    const target = createWorkflowNode('ai-generate', 240, 0, 'Generate');
    workflow.nodes = [source, target];
    workflow.connections = [{
      id: 'prompt-edge', fromNodeId: source.id, fromPortId: 'out-prompt',
      toNodeId: target.id, toPortId: 'in-prompt', type: 'prompt',
    }];
    const surfaceModule = await import('@/components/workflow/WorkflowReactFlowSurface');
    const createEdges = (surfaceModule as unknown as {
      createReactFlowEdges: (model: ReturnType<typeof projectReactFlowRenderModel>) => Array<{
        type?: string;
        data?: { portType?: string };
      }>;
    }).createReactFlowEdges;

    expect(createEdges(projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 }))[0])
      .toMatchObject({ type: 'workflow', data: { portType: 'prompt' } });
    expect(reactFlowNodeSource).toContain('WorkflowLegacyNodeCard');
  });

  it('keeps the workflow-to-chat result action available in both renderers', () => {
    expect(legacyRendererSource).toContain('发送到智能对话');
    expect(legacyRendererSource).toContain('onSendToChat?.(node.id)');
    expect(reactFlowSurfaceSource).toContain('onSendToChat');
  });

  it('keeps the mobile content strip available and persists before workflow-to-chat navigation', () => {
    const mobileLayout = nodeEditorSource.match(/const applyMobileLayout = \(\) => \{[\s\S]*?\n\s*\};/)?.[0] || '';
    expect(mobileLayout).toContain('setShowLeftPanel(false)');
    expect(mobileLayout).not.toContain('setShowContentStrip(false)');
    expect(nodeEditorSource).toContain('onBeforeWorkflowChatNavigation');
    expect(nodeEditorSource).toContain('navigateToWorkflowChatAfterPersistence');
    expect(canvasWorkspaceSource).toContain('onBeforeWorkflowChatNavigation');
    expect(canvasWorkspaceSource).toContain("canvasPersistenceScheduler.flush('immediate')");
  });
});
