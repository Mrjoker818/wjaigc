// @vitest-environment node
import {createRequire} from 'node:module';
import path from 'node:path';
import {chromium,type BrowserContext,type Request} from '@playwright/test';
import {expect,it} from 'vitest';

interface DiagnosticWindow extends Window {bd:{start():void;stop():void;connected():boolean;events:unknown[]}}
interface Terminal {status:number|null;kind:'finished'|'failed';error:string|null}
const origin='https://bd-events.invalid';
async function bounded<T>(name:string,work:()=>Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('BD_CLEANUP_TIMEOUT '+name)),2500);})]);}finally{if(timer)clearTimeout(timer);}}
it('BD records native original TaskEventsClient receipts and controlled drain versus early disconnect',async()=>{
 const require=createRequire(import.meta.url),{build}=require('esbuild') as typeof import('esbuild');
 const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',absWorkingDir:process.cwd(),tsconfig:'tsconfig.json',stdin:{resolveDir:process.cwd(),sourcefile:'bd-task-events-entry.ts',loader:'ts',contents:"import {TaskEventsClient} from '@/lib/task-events-client';const client=new TaskEventsClient(),events:unknown[]=[];client.onTaskEvent(e=>events.push(e));Object.assign(window,{bd:{start:()=>client.connect(),stop:()=>client.disconnect(),connected:()=>client.isConnected(),events}});"}});
 expect(bundle.outputFiles).toHaveLength(1);const browser=await chromium.launch({headless:true}),summaries:unknown[]=[];
 try{for(const variant of ['json503-small','json503-large','sse200','held503-early-stop','held503-drained'] as const){
  let context:BrowserContext|undefined;const problems:string[]=[],pending=new Set<Request>(),terminal:Terminal[]=[],handlers=new Set<Promise<void>>();let status:number|null=null,count=0,resolveTerminal:(()=>void)|undefined,releaseGate:(()=>void)|undefined,started:(()=>void)|undefined;
  const done=new Promise<void>(resolve=>{resolveTerminal=resolve;});
  const gate=new Promise<void>(resolve=>{releaseGate=resolve;}),requested=new Promise<void>(resolve=>{started=resolve;});
  try{
   context=await browser.newContext({viewport:{width:320,height:640},serviceWorkers:'block'});const page=await context.newPage();
   context.on('request',r=>pending.add(r));context.on('response',r=>{if(r.url()===origin+'/api/task-events')status=r.status();});
   context.on('requestfinished',r=>{pending.delete(r);if(r.url()===origin+'/api/task-events'){terminal.push({status,kind:'finished',error:null});resolveTerminal?.();}});
   context.on('requestfailed',r=>{pending.delete(r);if(r.url()===origin+'/api/task-events'){terminal.push({status,kind:'failed',error:r.failure()?.errorText??null});resolveTerminal?.();}else problems.push('unexpected failure '+r.url());});
   page.on('pageerror',e=>problems.push(String(e)));page.on('dialog',d=>{problems.push('DIALOG');void d.dismiss();});await context.routeWebSocket('**/*',s=>{problems.push('WS');s.close();});
   const counts=new Map<string,number>();await context.route('**/*',async route=>{const operation=(async():Promise<void>=>{const r=route.request(),u=new URL(r.url()),h=r.headers();if(u.origin!==origin||u.username||u.password||r.method()!=='GET'||r.postData()!==null||h.authorization||h.cookie||h['x-api-key']||h['api-key'])throw Error('BD_HTTP_BOUNDARY');const key=u.pathname+u.search;counts.set(key,(counts.get(key)??0)+1);if(counts.get(key)!==1)throw Error('BD_EXACT_ONCE '+key);
    if(key==='/'&&r.isNavigationRequest()){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body></body></html>'});return;}
    if(key==='/api/session'){await route.fulfill({json:{success:true,user:{id:'bd-synthetic-actor'}}});return;}
    if(key==='/api/task-events'){count++;started?.();if(variant.startsWith('held503'))await gate;if(variant==='sse200')await route.fulfill({contentType:'text/event-stream',body:'data: {"taskId":"bd-fake-task","type":"progress","task":{"taskId":"bd-fake-task","type":"generate","status":"processing","progress":1,"createdAt":1,"updatedAt":1}}\n\n'});else await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:'OFFLINE_FIXTURE_EVENTS_UNAVAILABLE',padding:variant==='json503-large'?'x'.repeat(1024*512):''})});return;}
    throw Error('BD_UNKNOWN '+key);
   })().catch(async e=>{problems.push(String(e));await route.abort('blockedbyclient');});handlers.add(operation);try{await operation;}finally{handlers.delete(operation);}});
   await page.goto(origin);await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(()=>(window as unknown as DiagnosticWindow).bd.start());
   if(variant.startsWith('held503')){await bounded('controlled request start',()=>requested);expect(pending.size).toBe(1);if(variant==='held503-early-stop')await bounded('early public disconnect',()=>page.evaluate(()=>(window as unknown as DiagnosticWindow).bd.stop()));else releaseGate?.();}
   let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([done,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('BD_NATIVE_TERMINAL_TIMEOUT')),2500);})]);}finally{if(timer)clearTimeout(timer);}
   releaseGate?.();
   if(variant==='sse200')await page.waitForFunction(()=>(window as unknown as DiagnosticWindow).bd.events.length===1,undefined,{timeout:1500});
   const events=await page.evaluate(()=>(window as unknown as DiagnosticWindow).bd.events);await bounded('public disconnect',()=>page.evaluate(()=>(window as unknown as DiagnosticWindow).bd.stop()));await bounded('route drain',()=>Promise.all([...handlers]));
   expect(count).toBe(1);expect(pending.size).toBe(0);expect(handlers.size).toBe(0);expect(problems).toEqual([]);expect(terminal).toHaveLength(1);if(variant==='sse200'){expect(terminal[0]).toEqual({status:200,kind:'finished',error:null});expect(events).toHaveLength(1);}else if(variant==='held503-early-stop'){expect(terminal[0]).toEqual({status:null,kind:'failed',error:'net::ERR_ABORTED'});expect(events).toEqual([]);}else{expect(terminal[0].status).toBe(503);if(variant==='held503-drained')expect(terminal[0].kind).toBe('finished');expect(events).toEqual([]);}
   summaries.push({variant,terminal,deliveredEvents:events.length,pending:pending.size,problems,localOnly:true});
  }finally{releaseGate?.();if(context){try{for(const page of context.pages())try{await bounded('final disconnect',()=>page.evaluate(()=>(window as unknown as DiagnosticWindow).bd?.stop()));}catch(e){problems.push('stop '+String(e));}await bounded('final routes',()=>Promise.all([...handlers]));}catch(e){problems.push('drain '+String(e));}finally{try{await bounded('actual context close',()=>context!.close());}catch(e){problems.push('close '+String(e));}}}if(problems.length)throw Error('BD_DIAGNOSTIC_CLEANUP '+problems.join(';'));}
 }}finally{await bounded('actual browser close',()=>browser.close());}
 console.log('BD_SSE_RECEIPT_DIAGNOSTIC',JSON.stringify({source:path.resolve('src/lib/task-events-client.ts'),summaries,notProductRegression:true,notBusinessData:true}));
},25000);
