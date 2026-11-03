// @vitest-environment jsdom
import React, {useLayoutEffect, useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import ChatArea from '@/components/simple-chat/chat-area';
import type {SimpleChatTask} from '@/components/simple-chat/simple-chat-types';

const validImage='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zr1sAAAAASUVORK5CYII=';
const baseTask:SimpleChatTask={id:'same-task',projectId:'same-project',name:'测试',messages:[],model:'chat-model',providerId:'provider-1',createdAt:1,updatedAt:1};
const initialTasks={a:structuredClone(baseTask),b:structuredClone(baseTask)};
const users={a:{id:'user-a',name:'账号A',createdAt:1,updatedAt:1},b:{id:'user-b',name:'账号B',createdAt:1,updatedAt:1}};
let readback:Record<string,SimpleChatTask>={};
function Fixture(){
 const [account,setAccount]=useState<'a'|'b'>('a');
 const [tasks,setTasks]=useState(initialTasks);
 useLayoutEffect(()=>{readback=tasks},[tasks]);
 const task=tasks[account],project={id:'same-project',name:'合成项目',tasks:[task],agents:[],knowledgeItems:[],createdAt:1,updatedAt:1};
 return <><button onClick={()=>setAccount('a')}>切换A</button><button onClick={()=>setAccount('b')}>切换B</button>
 <ChatArea user={users[account]} project={project} task={task}
 onUpdateTask={next=>setTasks(prev=>({...prev,[account]:next}))} onPersistTask={async()=>{}}
 onUpdateProject={()=>{}} onCreateTask={()=>{}} onSelectTask={()=>{}} onUpdateAgent={()=>{}}
 onDeleteAgent={()=>{}} onSkillToAgent={()=>{}} onLogout={()=>{}} onBackToWorkspace={()=>{}} sidebarOpen onToggleSidebar={()=>{}}/></>;
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve}}
let registration=deferred<Response>();let posts:Array<Record<string,unknown>>=[];let stream:{emit:(payload:object)=>void;cancelled:()=>boolean}|null=null;
let failFirstChat=false,chatFailed=false;
function deferredStream(){
 let c!:ReadableStreamDefaultController<Uint8Array>;let wasCancelled=false,closed=false;const encoder=new TextEncoder();
 const body=new ReadableStream<Uint8Array>({start(controller){c=controller},cancel(){wasCancelled=true}});
 return {response:{ok:true,body} as Response,emit:(payload:object)=>c.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)),cancelled:()=>wasCancelled,close:()=>{if(!wasCancelled&&!closed){closed=true;c.close()}}};
}
let streamResponse=deferredStream();
beforeEach(()=>{
 initialTasks.a=structuredClone(baseTask);initialTasks.b=structuredClone(baseTask);registration=deferred<Response>();posts=[];streamResponse=deferredStream();stream=streamResponse;failFirstChat=false;chatFailed=false;
 const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k),clear:()=>storage.clear()});
 vi.stubGlobal('FileReader',class {result=validImage;onload:((e:unknown)=>void)|null=null;readAsDataURL(){this.onload?.({target:this})}});
 vi.stubGlobal('WebSocket',class{constructor(){throw Error('NETWORK_BLOCKED')}});vi.stubGlobal('XMLHttpRequest',class{constructor(){throw Error('NETWORK_BLOCKED')}});
 Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>{}});
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),method=init?.method||'GET';
  if(method==='GET'&&url==='/api/models?type=chat')return Response.json({models:[{id:'chat-model',name:'Chat',providerId:'provider-1'}],providers:[{id:'provider-1',name:'Provider'}]});
  if(method==='GET'&&url==='/api/models?type=image')return Response.json({models:[],providers:[]});
  if(method==='GET'&&url==='/api/user-data/sync?key=projects')return Response.json({success:true,value:[{id:'canvas-project',name:'合成画布'}]});
  if(method==='GET'&&url==='/api/simple-chat/memory')return Response.json({memories:[]});
  if(method==='POST'&&url==='/api/simple-chat/chat'){const body=JSON.parse(String(init?.body));posts.push(body);if(body.assetAction==='register')return registration.promise;if(failFirstChat&&!chatFailed){chatFailed=true;return Response.json({error:'SYNTHETIC_FAILURE'},{status:503})}return streamResponse.response}
  throw Error('NETWORK_BLOCKED '+method+' '+url);
 }));
});
afterEach(()=>{streamResponse.close();cleanup();vi.unstubAllGlobals()});
const input=()=>screen.getByPlaceholderText(/输入消息，Enter/) as HTMLTextAreaElement;
async function mount(){const view=render(<Fixture/>);await waitFor(()=>expect((screen.getByLabelText('目标画布项目') as HTMLSelectElement).value).toBe('canvas-project'));return view}
async function startUpload(){const view=await mount();const file=view.container.querySelector<HTMLInputElement>('#chat-file-upload')!;fireEvent.change(file,{target:{files:[new File(['fixture'],'fixture.png',{type:'image/png'})]}});await screen.findByRole('button',{name:'移除图片：fixture.png'});fireEvent.change(input(),{target:{value:'原账号发送'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));await waitFor(()=>expect(posts.some(x=>x.assetAction==='register')).toBe(true));return view}
async function releaseRegistration(){await act(async()=>{registration.resolve(Response.json({url:'/managed/image.png',assetId:'asset',assetVersionId:'version',placementId:'placement'}));await registration.promise;await new Promise(r=>setTimeout(r,30))})}
function switchTo(account:'a'|'b'){fireEvent.click(screen.getByRole('button',{name:account==='a'?'切换A':'切换B'}))}
describe('ordinary chat scope epochs',()=>{
 it('coalesces repeated clicks while registration is pending and permits an explicit retry after failure',async()=>{
  const view=await mount();const file=view.container.querySelector<HTMLInputElement>('#chat-file-upload')!;
  fireEvent.change(file,{target:{files:[new File(['fixture'],'fixture.png',{type:'image/png'})]}});
  await screen.findByRole('button',{name:'移除图片：fixture.png'});fireEvent.change(input(),{target:{value:'只发送一次'}});
  const button=screen.getByRole('button',{name:'发送消息'});failFirstChat=true;
  act(()=>{button.dispatchEvent(new MouseEvent('click',{bubbles:true}));button.dispatchEvent(new MouseEvent('click',{bubbles:true}))});
  expect(posts.filter(p=>p.assetAction==='register')).toHaveLength(1);
  await releaseRegistration();await waitFor(()=>expect(readback.a.messages.some(m=>m.status==='failed')).toBe(true));
  expect(posts.filter(p=>!p.assetAction)).toHaveLength(1);
  fireEvent.click(screen.getByTitle('重试失败请求'));
  await waitFor(()=>expect(posts.filter(p=>!p.assetAction)).toHaveLength(2));
  await act(async()=>{streamResponse.emit({type:'text',content:'重试成功'});streamResponse.close()});
  await screen.findByText('重试成功');
  expect(readback.a.messages.filter(m=>m.content==='只发送一次')).toHaveLength(1);
 });
 it('an older pending registration does not block a new account send or release its active lock',async()=>{
  await startUpload();switchTo('b');fireEvent.change(input(),{target:{value:'新账号明确发送'}});
  fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
  await waitFor(()=>expect(posts.filter(p=>!p.assetAction)).toHaveLength(1));
  await releaseRegistration();
  expect(posts.filter(p=>!p.assetAction)).toHaveLength(1);
  expect(readback.b.messages.some(m=>m.content==='新账号明确发送')).toBe(true);
  fireEvent.change(input(),{target:{value:'后续草稿'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
  expect(posts.filter(p=>!p.assetAction)).toHaveLength(1);expect(input().value).toBe('后续草稿');
  await act(async()=>{streamResponse.emit({type:'text',content:'新账号结果'});streamResponse.close()});
  await screen.findByText('新账号结果');
 });
 it('same-account send continues and renders the ordinary response',async()=>{await startUpload();await releaseRegistration();await waitFor(()=>expect(posts.filter(p=>!p.assetAction)).toHaveLength(1));await act(async()=>{streamResponse.emit({type:'text',content:'正常回答'});streamResponse.close()});await screen.findByText('正常回答')});
 it('same-account typing during attachment registration preserves the newer unsent draft',async()=>{
  await startUpload();fireEvent.change(input(),{target:{value:'等待期间的新草稿'}});
  await releaseRegistration();await waitFor(()=>expect(posts.filter(p=>!p.assetAction)).toHaveLength(1));
  expect(input().value).toBe('等待期间的新草稿');
  expect(readback.a.messages.some(message=>message.content==='原账号发送')).toBe(true);
 });
 it('keeps images added during attachment registration and sends only the captured image',async()=>{
  const view=await startUpload();
  const file=view.container.querySelector<HTMLInputElement>('#chat-file-upload')!;
  fireEvent.change(file,{target:{files:[new File(['second'],'later.png',{type:'image/png'})]}});
  await screen.findByRole('button',{name:'移除图片：later.png'});
  fireEvent.change(input(),{target:{value:'新增图片的未发送草稿'}});
  await releaseRegistration();
  await waitFor(()=>expect(posts.filter(p=>!p.assetAction)).toHaveLength(1));
  expect(input().value).toBe('新增图片的未发送草稿');
  expect(screen.queryByRole('button',{name:'移除图片：fixture.png'})).toBeNull();
  expect(screen.getByRole('button',{name:'移除图片：later.png'})).toBeTruthy();
  expect(posts.filter(p=>p.assetAction==='register')).toHaveLength(1);
  expect(readback.a.messages.find(m=>m.content==='原账号发送')?.attachments?.map(a=>a.name)).toEqual(['fixture.png']);
 });
 it('switching to temporary mode while registration waits preserves both mode drafts and invalidates the old send',async()=>{
  await startUpload();fireEvent.click(screen.getByTitle('开启临时聊天'));
  await waitFor(()=>expect(input().value).toBe(''));
  fireEvent.change(input(),{target:{value:'临时模式未发送草稿'}});
  await releaseRegistration();
  expect(posts.filter(p=>!p.assetAction)).toHaveLength(0);
  expect(input().value).toBe('临时模式未发送草稿');
  expect(screen.queryByRole('button',{name:'移除图片：fixture.png'})).toBeNull();
  fireEvent.click(screen.getByTitle('临时聊天中（不保存）'));
  await waitFor(()=>expect(input().value).toBe('原账号发送'));
  expect(screen.getByRole('button',{name:'移除图片：fixture.png'})).toBeTruthy();
 });
 it.each([false,true])('late registration after account change ABA=%s does not append or clear draft',async aba=>{
  await startUpload();switchTo('b');if(aba)switchTo('a');
  fireEvent.change(input(),{target:{value:'当前账号未发送草稿'}});
  const active=aba?'a':'b';await releaseRegistration();
  console.log('LATE_REGISTRATION',JSON.stringify({aba,chatPosts:posts.filter(p=>!p.assetAction).length,input:input().value,messages:readback[active].messages.map(m=>m.content),imagePresent:!!screen.queryByRole('button',{name:'移除图片：fixture.png'})}));
  expect(posts.filter(p=>!p.assetAction)).toHaveLength(0);
  expect(input().value).toBe('当前账号未发送草稿');
  expect(readback[active].messages.some(m=>m.content==='原账号发送')).toBe(false);
  expect(!!screen.queryByRole('button',{name:'移除图片：fixture.png'})).toBe(aba);
 });
 it.each([false,true])('late stream after account change ABA=%s is cancelled and cannot append a search event',async aba=>{
  await mount();fireEvent.change(input(),{target:{value:'原账号发送'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
  await waitFor(()=>expect(posts.filter(p=>!p.assetAction)).toHaveLength(1));switchTo('b');if(aba)switchTo('a');
  fireEvent.change(input(),{target:{value:'当前账号未发送草稿'}});
  await act(async()=>{streamResponse.emit({type:'search_status',status:'completed',resultCount:0});await new Promise(r=>setTimeout(r,30))});
  expect(input().value).toBe('当前账号未发送草稿');
  expect(readback[aba?'a':'b'].messages.some(m=>m.content.includes('联网搜索未找到相关结果'))).toBe(false);
  expect(stream?.cancelled()).toBe(true);
 });
 it.each([true,false])('uses the system reduced-motion preference for automatic chat scrolling: %s',async reduced=>{
  const scroll=vi.fn();Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:scroll});
  vi.stubGlobal('matchMedia',(query:string)=>({matches:query==='(prefers-reduced-motion: reduce)'&&reduced,media:query,addEventListener:()=>{},removeEventListener:()=>{}}));
  await mount();fireEvent.change(input(),{target:{value:'滚动偏好测试'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
  await waitFor(()=>expect(scroll).toHaveBeenCalled());
  expect(scroll.mock.calls.at(-1)?.[0]).toMatchObject({behavior:reduced?'instant':'smooth'});
 });
});
