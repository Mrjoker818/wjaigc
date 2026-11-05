// @vitest-environment node
import {createRequire} from 'node:module';
import {chromium,type BrowserContext,type Request} from '@playwright/test';
import {expect,it} from 'vitest';

interface BNWindow extends Window {bn:{start():void;stop():void;events:Array<{taskId?:string;type?:string}>;nativeEvents:string[]}}
interface Terminal {status:number|null;kind:'finished'|'failed';error:string|null}
const origin='https://bn-events.invalid';
async function bounded<T>(label:string,work:()=>Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('BN_BOUND '+label)),2500);})]);}finally{if(timer)clearTimeout(timer);}}

it('BN distinguishes original native and TaskEventsClient JSON503 receipts from actual valid SSE delivery',async()=>{
 const require=createRequire(import.meta.url),{build}=require('esbuild') as typeof import('esbuild');
 const result=await build({bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',absWorkingDir:process.cwd(),tsconfig:'tsconfig.json',stdin:{resolveDir:process.cwd(),loader:'ts',sourcefile:'bn-task-events-diagnostic.ts',contents:"import {TaskEventsClient} from '@/lib/task-events-client';const c=new TaskEventsClient(),events:unknown[]=[],nativeEvents:string[]=[];c.onTaskEvent(e=>events.push(e));let native:EventSource|null=null;Object.assign(window,{bn:{events,nativeEvents,start(){if(location.hash==='#native'){native=new EventSource('/api/task-events');native.onopen=()=>nativeEvents.push('open');native.onerror=()=>nativeEvents.push('error');native.onmessage=()=>nativeEvents.push('message');}else c.connect();},stop(){native?.close();c.disconnect();}}});"}});
 expect(result.outputFiles).toHaveLength(1);const browser=await chromium.launch({headless:true}),summaries:unknown[]=[];
 try{for(const variant of ['native-json503','client-json503','client-sse200'] as const){
  const problems:string[]=[],pending=new Set<Request>(),handlers=new Set<Promise<void>>(),terminal:Terminal[]=[],network:Array<Record<string,unknown>>=[];let context:BrowserContext|undefined,status:number|null=null,complete:(()=>void)|undefined;
  const done=new Promise<void>(resolve=>{complete=resolve;});
  try{
   context=await browser.newContext({viewport:{width:320,height:640},serviceWorkers:'block'});const page=await context.newPage(),cdp=await context.newCDPSession(page),ids=new Set<string>();await cdp.send('Network.enable');
   cdp.on('Network.requestWillBeSent',e=>{if(e.request.url===origin+'/api/task-events'){ids.add(e.requestId);network.push({phase:'request',id:e.requestId,time:e.timestamp});}});
   cdp.on('Network.responseReceived',e=>{if(ids.has(e.requestId))network.push({phase:'response',id:e.requestId,status:e.response.status,mimeType:e.response.mimeType,time:e.timestamp});});
   cdp.on('Network.loadingFinished',e=>{if(ids.has(e.requestId))network.push({phase:'finished',id:e.requestId,time:e.timestamp});});
   cdp.on('Network.loadingFailed',e=>{if(ids.has(e.requestId))network.push({phase:'failed',id:e.requestId,error:e.errorText,canceled:e.canceled,time:e.timestamp});});
   context.on('request',r=>pending.add(r));context.on('response',r=>{if(r.url()===origin+'/api/task-events')status=r.status();});
   context.on('requestfinished',r=>{pending.delete(r);if(r.url()===origin+'/api/task-events'){terminal.push({status,kind:'finished',error:null});complete?.();}});
   context.on('requestfailed',r=>{pending.delete(r);if(r.url()===origin+'/api/task-events'){terminal.push({status,kind:'failed',error:r.failure()?.errorText??null});complete?.();}else problems.push('unexpected native failure '+r.url());});
   page.on('pageerror',e=>problems.push(String(e)));page.on('dialog',d=>{problems.push('DIALOG');void d.dismiss();});await context.routeWebSocket('**/*',s=>{problems.push('WS');s.close();});
   const counts=new Map<string,number>();await context.route('**/*',async route=>{const operation=(async():Promise<void>=>{const r=route.request(),u=new URL(r.url()),h=r.headers();if(u.origin!==origin||u.username||u.password||r.method()!=='GET'||r.postData()!==null||['authorization','cookie','x-api-key','api-key','idempotency-key'].some(k=>k in h))throw Error('BN_BOUNDARY');const key=u.pathname+u.search;counts.set(key,(counts.get(key)??0)+1);if(counts.get(key)!==1)throw Error('BN_REPEAT '+key);
    if(key==='/'&&r.isNavigationRequest()){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body></body></html>'});return;}
    if(key==='/api/session'&&variant!=='native-json503'){await route.fulfill({json:{success:true,user:{id:'bn-synthetic-actor'}}});return;}
    if(key==='/api/task-events'){network.push({phase:'fulfill-start'});if(variant==='client-sse200')await route.fulfill({contentType:'text/event-stream',body:'data: {"taskId":"bn-synthetic","type":"progress","task":{"taskId":"bn-synthetic","type":"generate","status":"processing","progress":1,"createdAt":1,"updatedAt":1}}\n\n'});else await route.fulfill({status:503,json:{success:false,error:'OFFLINE_FIXTURE_EVENTS_UNAVAILABLE'}});network.push({phase:'fulfill-return'});return;}
    throw Error('BN_UNKNOWN '+key);
   })().catch(async e=>{problems.push(String(e));await route.abort('blockedbyclient');});handlers.add(operation);try{await operation;}finally{handlers.delete(operation);}});
   await page.goto(origin+(variant==='native-json503'?'#native':''));await page.addScriptTag({content:result.outputFiles[0].text});await page.evaluate(()=>(window as unknown as BNWindow).bn.start());await bounded('original native terminal',()=>done);
   if(variant==='client-sse200')await page.waitForFunction(()=>(window as unknown as BNWindow).bn.events.length===1,undefined,{timeout:1500});
   const data=await page.evaluate(()=>(window as unknown as BNWindow).bn);network.push({phase:'terminal-observed-before-public-disconnect'});await bounded('public disconnect',()=>page.evaluate(()=>(window as unknown as BNWindow).bn.stop()));await bounded('route drain',()=>Promise.all([...handlers]));
   expect(pending.size).toBe(0);expect(handlers.size).toBe(0);expect(problems).toEqual([]);expect(terminal).toHaveLength(1);expect(counts.get('/api/task-events')).toBe(1);expect(counts.get('/api/session')??0).toBe(variant==='native-json503'?0:1);
   if(variant==='client-sse200'){expect(terminal[0]).toEqual({status:200,kind:'finished',error:null});expect(data.events.map(e=>({taskId:e.taskId,type:e.type}))).toEqual([{taskId:'bn-synthetic',type:'progress'}]);}else{expect(terminal[0].status).toBe(503);if(terminal[0].kind==='failed')expect(terminal[0].error).toBe('net::ERR_ABORTED');else expect(terminal[0].error).toBeNull();expect(data.events).toEqual([]);}
   summaries.push({variant,terminal,network,events:data.events,nativeEvents:data.nativeEvents,pending:pending.size,problems,cleanupBeginsOnlyAfterTerminal:true,notUiAcceptance:true});await cdp.detach();
  }finally{if(context){try{for(const p of context.pages())await bounded('final public disconnect',()=>p.evaluate(()=>(window as unknown as BNWindow).bn?.stop()));await bounded('final routes',()=>Promise.all([...handlers]));}finally{await bounded('actual context close',()=>context!.close());}}if(problems.length)throw Error('BN_DIAGNOSTIC_FAILURE '+problems.join(';'));}
 }}finally{await bounded('actual browser close',()=>browser.close());}
 console.log('BN_SSE_NATIVE_DIAGNOSTIC',JSON.stringify({summaries,noImplementationReplacement:true,businessCodeModified:false,notCozeOrDeviceAcceptance:true}));
},25000);
