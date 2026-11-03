// @vitest-environment jsdom

import { afterEach as afterMediaApis, beforeEach as beforeMediaApis } from 'vitest';
import { installJsdomMediaQueries, runJsdomFixtureCleanup } from '../helpers/jsdom-browser-apis';
import React from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ChatPanel} from '@/components/chat-panel';
import type {CanvasImage} from '@/components/infinite-canvas';
const image:CanvasImage={id:'synthetic-image',url:'/synthetic.png',x:0,y:0,width:20,height:20};
beforeEach(()=>{const values=new Map<string,string>();const storage={get length(){return values.size},clear:()=>values.clear(),getItem:(k:string)=>values.get(k)??null,key:(i:number)=>[...values.keys()][i]??null,removeItem:(k:string)=>{values.delete(k)},setItem:(k:string,v:string)=>{values.set(k,v)}};Object.defineProperty(window,'localStorage',{configurable:true,value:storage});vi.stubGlobal('localStorage',storage);Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});vi.stubGlobal('fetch',vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{if(init?.method&&init.method!=='GET')throw Error('NETWORK_BLOCKED');return Response.json({})}));});
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals()});
describe('selected canvas image while project loads',()=>{
 it('leaves an empty draft untouched if the real selection entry is refused',async()=>{
  const resolve=vi.fn(async()=>{throw Error('项目正在加载，请稍后重新选择图片')});
  const view=(selected:CanvasImage|null)=><ChatPanel themeStyle="gold" projectId="synthetic-project" canvasImages={[image]} chatTabOpen selectedCanvasImage={selected} onResolveCanvasImageForChat={resolve}/>;
  const mounted=render(view(null));const input=await screen.findByPlaceholderText('输入消息，@ 引用图片/品牌，/ 使用模板...') as HTMLTextAreaElement;input.focus();mounted.rerender(view(image));await waitFor(()=>expect(resolve).toHaveBeenCalledTimes(1));await act(async()=>{});expect(input.value).toBe('');expect(screen.queryByPlaceholderText(/描述你想对这1张图片/)).toBeNull();
 });
 it('can retry the same selection after loading failure without replacing user draft',async()=>{
  const resolve=vi.fn().mockRejectedValueOnce(Error('项目正在加载，请稍后重新选择图片')).mockResolvedValueOnce(image);
  const view=(selected:CanvasImage|null)=><ChatPanel themeStyle="gold" projectId="synthetic-project" canvasImages={[image]} chatTabOpen selectedCanvasImage={selected} onResolveCanvasImageForChat={resolve}/>;
  const mounted=render(view(null));const input=await screen.findByPlaceholderText('输入消息，@ 引用图片/品牌，/ 使用模板...') as HTMLTextAreaElement;input.focus();mounted.rerender(view(image));await waitFor(()=>expect(resolve).toHaveBeenCalledTimes(1));await act(async()=>{});fireEvent.change(input,{target:{value:'用户草稿'}});mounted.rerender(view(null));mounted.rerender(view(image));await waitFor(()=>expect(resolve).toHaveBeenCalledTimes(2));await screen.findByPlaceholderText(/描述你想对这1张图片/);expect(input.value).toBe('用户草稿');
 });
 it('does not apply the first result after deselecting and reselecting the same image',async()=>{
  let first!:(value:CanvasImage)=>void,second!:(value:CanvasImage)=>void;
  const resolve=vi.fn().mockImplementationOnce(()=>new Promise<CanvasImage>(r=>{first=r})).mockImplementationOnce(()=>new Promise<CanvasImage>(r=>{second=r}));
  const view=(selected:CanvasImage|null)=><ChatPanel themeStyle="gold" projectId="synthetic-project" canvasImages={[image]} chatTabOpen selectedCanvasImage={selected} onResolveCanvasImageForChat={resolve}/>;
  const mounted=render(view(null));const input=await screen.findByPlaceholderText('输入消息，@ 引用图片/品牌，/ 使用模板...') as HTMLTextAreaElement;input.focus();mounted.rerender(view(image));await waitFor(()=>expect(resolve).toHaveBeenCalledTimes(1));mounted.rerender(view(null));mounted.rerender(view(image));await waitFor(()=>expect(resolve).toHaveBeenCalledTimes(2));
  await act(async()=>{first(image)});expect(input.value).toBe('');expect(screen.queryByPlaceholderText(/描述你想对这1张图片/)).toBeNull();
  await act(async()=>{second(image)});await screen.findByPlaceholderText(/描述你想对这1张图片/);expect(input.value).toBe('针对这张图片，我想...');
 });
});

// Explicit file-local browser API fixture; business mocks and original tests are unchanged.
let restoreMediaApis: (() => void) | undefined;
beforeMediaApis((): void => { restoreMediaApis = installJsdomMediaQueries(window, { colorScheme: 'light', reducedMotion: false }); });
afterMediaApis((): void => { runJsdomFixtureCleanup([cleanup, (): void => { const restore = restoreMediaApis; restoreMediaApis = undefined; restore?.(); }]); });
