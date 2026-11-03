// @vitest-environment jsdom
import React, {act, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {MoreHorizontal, Settings2, Share2} from 'lucide-react';
import {DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem} from '@/components/ui/dropdown-menu';
import {CanvasShareCreateDialog} from '@/components/canvas-share/create-dialog';
import {CanvasShareManagePanel} from '@/components/canvas-share/manage-panel';

interface Scope {actorId:string; projectId:string}
interface ProbeProps {scope:Scope}
// Execute the parent's actual declarations, handlers, JSX and scope effects.
// This deliberately does not mount unrelated canvas/storage/model services.
function shareProbe():React.ComponentType<ProbeProps>{
 const source=readFileSync(path.resolve('src/components/canvas-workspace.tsx'),'utf8');
 const file=ts.createSourceFile('canvas-workspace.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const names=new Set(['shareCreateOpen','shareManageOpen','createdShareAccess','shareMenuTriggerRef','shareMenuGenerationRef','shareMenuScopeRef','shareMenuSessionsRef','activeShareMenuSessionRef','registerShareMenuContent','shareMenuScope']);
 const declarations=new Map<string,string>(),effects:string[]=[],menus:string[]=[],dialogs:string[]=[];
 const visit=(n:ts.Node):void=>{
  if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations){const name=ts.isIdentifier(d.name)?d.name.text:ts.isArrayBindingPattern(d.name)?d.name.elements[0]?.getText(file):undefined;if(name&&names.has(name)){if(declarations.has(name))throw Error('SHARE_STATE_AMBIGUOUS:'+name);declarations.set(name,n.getText(file))}}
  if(ts.isExpressionStatement(n)){const s=n.getText(file);if((s.startsWith('useLayoutEffect(')&&s.includes('shareMenuScopeRef.current'))||(s.startsWith('useEffect(')&&s.includes('setShareCreateOpen(false)')&&s.includes('setCreatedShareAccess(undefined)')))effects.push(s)}
  if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(file)==='DropdownMenu'&&n.getText(file).includes('分享画布')&&n.getText(file).includes('管理分享'))menus.push(n.getText(file));
  if(ts.isJsxSelfClosingElement(n)&&['CanvasShareCreateDialog','CanvasShareManagePanel'].includes(n.tagName.getText(file)))dialogs.push(n.getText(file));
  ts.forEachChild(n,visit);
 };
 visit(file);if(menus.length!==1||dialogs.length!==2||!['shareCreateOpen','shareManageOpen','createdShareAccess'].every(n=>declarations.has(n)))throw Error('SHARE_SOURCE_NOT_UNIQUE');
 const code=`function SourceShareProbe({scope}) { const currentProject={id:scope.projectId,name:scope.projectId};const currentUser={id:scope.actorId};const viewStateRef=useRef({offsetX:0,offsetY:0,zoom:1});${[...declarations.values()].join('\n')}${effects.join('\n')}return <>${menus[0]}${dialogs.join('\n')}</>;}`;
 const compiled=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React},reportDiagnostics:true});if(compiled.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw Error('SHARE_PROBE_SYNTAX');
 const bindings={React,useCallback,useEffect,useLayoutEffect,useRef,useState,DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,CanvasShareCreateDialog,CanvasShareManagePanel,MoreHorizontal,Settings2,Share2};
 return new Function(...Object.keys(bindings),compiled.outputText+'\nreturn SourceShareProbe;')(...Object.values(bindings)) as React.ComponentType<ProbeProps>;
}
const Probe=shareProbe();
const actEnvironment=globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean};
const previousAct=actEnvironment.IS_REACT_ACT_ENVIRONMENT;
const previousScroll=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');
let root:Root|undefined,host:HTMLDivElement|undefined,outside:HTMLButtonElement|undefined;
const pending=new Set<Promise<Response>>(),violations:string[]=[];
let usingClock=false;
beforeEach(()=>{
 actEnvironment.IS_REACT_ACT_ENVIRONMENT=true;violations.length=0;
 if(!previousScroll)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:():void=>{}});
 vi.stubGlobal('fetch',(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const task=(async():Promise<Response>=>{const url=new URL(String(input),'http://localhost'),method=init?.method??'GET';if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError');
   if(url.origin==='http://localhost'&&url.pathname==='/api/canvas-shares/preflight'&&method==='POST')return Response.json({success:true,projectName:'A',projectRevision:1,itemCount:1,viewport:{offsetX:0,offsetY:0,zoom:1},readiness:{ready:true,failures:[]}});
   if(url.origin==='http://localhost'&&url.pathname==='/api/canvas-shares'&&method==='GET')return Response.json({success:true,shares:[]});
   violations.push(method+' '+url.pathname);throw Error('UNEXPECTED_SHARE_REQUEST');})();pending.add(task);void task.then(()=>pending.delete(task),()=>pending.delete(task));return task;
 });
 host=document.createElement('div');document.body.append(host);outside=document.createElement('button');outside.textContent='独立焦点';document.body.append(outside);root=createRoot(host);
});
afterEach(async()=>{
 try{
  if(root)await act(async()=>root?.unmount());
  if(usingClock){for(let n=0;n<5&&vi.getTimerCount();n++)await act(async()=>{await vi.runOnlyPendingTimersAsync()});expect(vi.getTimerCount()).toBe(0)}
  vi.useRealTimers();usingClock=false;
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));await Promise.allSettled([...pending])});
  expect(pending.size).toBe(0);expect(violations).toEqual([]);
  expect(document.querySelector('[role="menu"],[role="dialog"]')).toBeNull();
  expect(document.body.style.pointerEvents).not.toBe('none');expect(document.body.getAttribute('data-scroll-locked')).toBeNull();
 }finally{vi.useRealTimers();usingClock=false;vi.unstubAllGlobals();root=undefined;host?.remove();host=undefined;outside?.remove();outside=undefined;if(previousScroll)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',previousScroll);else Reflect.deleteProperty(HTMLElement.prototype,'scrollIntoView');actEnvironment.IS_REACT_ACT_ENVIRONMENT=previousAct}
});
async function render(scope:Scope={actorId:'actor-A',projectId:'A'}):Promise<void>{await act(async()=>root?.render(<Probe scope={scope}/>));const button=host?.querySelector('button');if(button)Object.defineProperty(button,'getClientRects',{configurable:true,value:()=>[new DOMRect(0,0,44,44)]})}
function trigger():HTMLButtonElement{const button=host?.querySelector('button');expect(button).not.toBeNull();return button as HTMLButtonElement}
async function key(target:EventTarget,key:string):Promise<void>{await act(async()=>{target.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}))})}
async function menu():Promise<void>{await render();await act(async()=>trigger().focus());await key(trigger(),'Enter');expect(document.querySelector('[role="menu"]')).not.toBeNull()}
async function selectShare():Promise<void>{const item=[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent?.includes('分享画布'));expect(item).toBeDefined();await key(item!,'Enter');expect(document.querySelector('[role="dialog"]')).not.toBeNull()}
function pauseClose():void{vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});usingClock=true}
async function releaseClose():Promise<void>{await act(async()=>{await vi.runOnlyPendingTimersAsync()})}

it('returns keyboard focus after cancelling the ordinary project menu',async()=>{await menu();await key(document.activeElement!,'Escape');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))});expect(document.activeElement).toBe(trigger())});
it('returns focus to the project menu after the ordinary share dialog closes',async()=>{await menu();await selectShare();await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))});await key(document.activeElement!,'Escape');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))});expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.activeElement).toBe(trigger())});
it('hands menu focus to the actual share dialog without the old menu close stealing it',async()=>{await menu();pauseClose();await selectShare();const dialog=document.querySelector('[role="dialog"]')!;expect(dialog.contains(document.activeElement)).toBe(true);await releaseClose();expect(dialog.contains(document.activeElement)).toBe(true)});
for(const kind of ['project','actor'] as const)it('does not return focus through a delayed close after '+kind+' A→B→A',async()=>{
 await menu();pauseClose();await selectShare();await key(document.activeElement!,'Escape');expect(document.querySelector('[role="dialog"]')).toBeNull();expect(vi.getTimerCount()).toBeGreaterThan(0);
 await render({actorId:kind==='actor'?'actor-B':'actor-A',projectId:kind==='project'?'B':'A'});
 await render({actorId:'actor-A',projectId:'A'});
 await act(async()=>outside?.focus());expect(document.activeElement).toBe(outside);await releaseClose();expect(document.activeElement).toBe(outside);
});
