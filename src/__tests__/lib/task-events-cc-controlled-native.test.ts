// @vitest-environment node
import {createServer,type ServerResponse} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium,type BrowserContext,type Request} from '@playwright/test';
import {expect,it} from 'vitest';

type Variant='native-headers503'|'fetch-headers503'|'client-headers503';
interface CCWindow extends Window {cc:{start():void;stop():void;seen:string[];readyState:number|null;status:number|null;body:string|null;stopCalled:boolean;client?:{isConnected():boolean}}}
interface NativeTerminal {kind:'finished'|'failed';error:string|null;beforePublicStop:boolean;bodyReleased:boolean;bodyBytesSent:number}
const responseBody=JSON.stringify({success:false,error:'OFFLINE_FIXTURE_EVENTS_UNAVAILABLE'});
async function bounded<T>(label:string,work:()=>Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('CC_BOUND '+label)),2500);})]);}finally{if(timer)clearTimeout(timer);}}

it('CC separates native EventSource header rejection from fetch body completion before public cleanup',async()=>{
 const require=createRequire(import.meta.url),{build}=require('esbuild') as typeof import('esbuild');
 const bundled=await build({bundle:true,write:false,platform:'browser',format:'iife',globalName:'CCClient',target:'es2022',absWorkingDir:process.cwd(),tsconfig:'tsconfig.json',stdin:{resolveDir:process.cwd(),loader:'ts',sourcefile:'cc-original-client.ts',contents:"export {TaskEventsClient} from '@/lib/task-events-client';"}});
 expect(bundled.outputFiles).toHaveLength(1);const browser=await chromium.launch({headless:true}),summaries:unknown[]=[];
 try{
  expect(browser.version()).toBe('148.0.7778.96');
  for(const variant of ['native-headers503','fetch-headers503','client-headers503'] as const){
   const nonce=randomBytes(16).toString('hex'),problems:string[]=[],pending=new Set<Request>(),handlers=new Set<Promise<void>>(),terminal:NativeTerminal[]=[],responseStatuses=new Map<Request,number>(),counts=new Map<string,number>(),wire:Array<Record<string,unknown>>=[];
   let origin='',pageUrl='',context:BrowserContext|undefined,serverStarted=false,publicStop=false,bodyReleased=false,bodyBytesSent=0,stream:ServerResponse|undefined,serverStreamClosed=false,streamWritableEnded:boolean|null=null,primary:unknown;
   let onHeaders:(()=>void)|undefined,onTerminal:(()=>void)|undefined,onResponse:(()=>void)|undefined,onServerClose:(()=>void)|undefined;
   const headersReady=new Promise<void>(resolve=>{onHeaders=resolve;}),nativeDone=new Promise<void>(resolve=>{onTerminal=resolve;}),responseReady=new Promise<void>(resolve=>{onResponse=resolve;}),serverClosed=new Promise<void>(resolve=>{onServerClose=resolve;});
   const controlScript=variant==='native-headers503'
    ? "let native;cc.start=()=>{native=new EventSource('/api/task-events');native.onopen=()=>cc.seen.push('open');native.onmessage=()=>cc.seen.push('message');native.onerror=()=>{cc.readyState=native.readyState;cc.seen.push('error');};};cc.stop=()=>{cc.stopCalled=true;native?.close();};"
    : variant==='fetch-headers503'
     ? "cc.start=()=>{void fetch('/api/task-events').then(async response=>{cc.status=response.status;cc.body=await response.text();cc.seen.push('body');}).catch(()=>cc.seen.push('fetch-error'));};cc.stop=()=>{cc.stopCalled=true;};"
     : '';
   const server=createServer((request,response)=>{
    try{
     const url=new URL(request.url||'/',origin),headers=request.headers;
     if(url.origin!==origin||request.method!=='GET'||headers.host!==origin.slice('http://'.length)||['authorization','cookie','x-api-key','api-key','idempotency-key','content-length','transfer-encoding'].some(key=>key in headers))throw Error('CC_SERVER_BOUNDARY');
     const key=url.pathname+url.search;counts.set(key,(counts.get(key)||0)+1);if(counts.get(key)!==1)throw Error('CC_SERVER_REPEAT '+key);
     if(key==='/?nonce='+nonce){response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'same-origin'});response.end('<!doctype html><html><head><link rel="icon" href="data:,"></head><body><script>window.cc={seen:[],readyState:null,status:null,body:null,stopCalled:false};'+controlScript+'</script></body></html>');return;}
     if(headers.referer!==pageUrl)throw Error('CC_SERVER_OWNED_PAGE_REFERRER');
     if(key==='/api/session'&&variant==='client-headers503'){response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({success:true,user:{id:'cc-synthetic-actor'}}));return;}
     if(key==='/api/task-events'){
      stream=response;response.on('close',()=>{serverStreamClosed=true;streamWritableEnded=response.writableEnded;wire.push({phase:'server-stream-close',bodyReleased,bodyBytesSent,writableEnded:response.writableEnded,beforePublicStop:!publicStop});onServerClose?.();});
      response.writeHead(503,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(responseBody),'cache-control':'no-store'});response.flushHeaders();wire.push({phase:'server-headers-flushed',status:503,bodyReleased,bodyBytesSent});onHeaders?.();return;
     }
     throw Error('CC_SERVER_UNKNOWN '+key);
    }catch(error){problems.push(String(error));response.destroy();}
   });
   server.on('error',error=>problems.push('CC_SERVER_ERROR '+String(error)));server.on('upgrade',(_request,socket)=>{problems.push('CC_UNKNOWN_WS');socket.destroy();});
   try{
    await bounded('owned server listen',()=>new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});}));serverStarted=true;const address=server.address();if(!address||typeof address==='string'||address.address!=='127.0.0.1')throw Error('CC_EXACT_LOOPBACK_LISTENER');origin='http://127.0.0.1:'+address.port;pageUrl=origin+'/?nonce='+nonce;
    context=await browser.newContext({viewport:{width:320,height:640},serviceWorkers:'block'});const page=await context.newPage();page.setDefaultTimeout(1500);
    context.on('request',request=>pending.add(request));
    context.on('response',response=>{responseStatuses.set(response.request(),response.status());if(response.url()===origin+'/api/task-events'){wire.push({phase:'native-response',status:response.status(),bodyReleased,bodyBytesSent,beforePublicStop:!publicStop});onResponse?.();}});
    const end=(request:Request,kind:'finished'|'failed'):void=>{pending.delete(request);if(request.url()===origin+'/api/task-events'){terminal.push({kind,error:request.failure()?.errorText??null,beforePublicStop:!publicStop,bodyReleased,bodyBytesSent});wire.push({phase:'native-'+kind,bodyReleased,bodyBytesSent,beforePublicStop:!publicStop});onTerminal?.();}else if(kind==='failed')problems.push('CC_UNEXPECTED_NATIVE_FAILURE '+request.url());};
    context.on('requestfinished',request=>end(request,'finished'));context.on('requestfailed',request=>end(request,'failed'));page.on('pageerror',error=>problems.push(String(error)));page.on('dialog',dialog=>{problems.push('CC_UNEXPECTED_DIALOG');void dialog.dismiss();});
    await context.routeWebSocket('**/*',socket=>{problems.push('CC_UNKNOWN_BROWSER_WS');socket.close({code:1008,reason:'Owned control forbids WebSockets'});});
    await context.route('**/*',async route=>{const operation=(async():Promise<void>=>{const request=route.request(),url=new URL(request.url()),headers=request.headers();if(url.origin!==origin||url.username||url.password||request.method()!=='GET'||request.postData()!==null||['authorization','cookie','x-api-key','api-key','idempotency-key'].some(key=>key in headers))throw Error('CC_BROWSER_BOUNDARY');const key=url.pathname+url.search;if(key!=='/?nonce='+nonce&&key!=='/api/task-events'&&!(variant==='client-headers503'&&key==='/api/session'))throw Error('CC_BROWSER_UNKNOWN '+key);await route.continue();})().catch(async error=>{problems.push(String(error));await route.abort('blockedbyclient');});handlers.add(operation);try{await operation;}finally{handlers.delete(operation);}});
    await page.goto(pageUrl);
    if(variant==='client-headers503'){
     await page.addScriptTag({content:bundled.outputFiles[0].text});await page.addScriptTag({content:"const client=new CCClient.TaskEventsClient();cc.client=client;cc.start=()=>client.connect();cc.stop=()=>{cc.stopCalled=true;client.disconnect();};"});
    }
    await page.evaluate(()=>(window as unknown as CCWindow).cc.start());await bounded('503 headers',()=>headersReady);await bounded('native response',()=>responseReady);expect(bodyReleased).toBe(false);expect(bodyBytesSent).toBe(0);
    if(variant==='fetch-headers503'){
     expect(terminal).toEqual([]);expect(serverStreamClosed).toBe(false);if(!stream)throw Error('CC_FETCH_STREAM_REQUIRED');wire.push({phase:'controller-release-body',beforePublicStop:!publicStop});bodyReleased=true;bodyBytesSent=Buffer.byteLength(responseBody);stream.end(responseBody);await bounded('fetch native finished',()=>nativeDone);await page.waitForFunction(()=>(window as unknown as CCWindow).cc.seen.includes('body'));expect(terminal).toEqual([{kind:'finished',error:null,beforePublicStop:true,bodyReleased:true,bodyBytesSent:Buffer.byteLength(responseBody)}]);expect(await page.evaluate(()=>(window as unknown as CCWindow).cc.body)).toBe(responseBody);
    }else{
     await bounded('headers-only native abort',()=>nativeDone);await bounded('server observed native abort',()=>serverClosed);expect(terminal).toEqual([{kind:'failed',error:'net::ERR_ABORTED',beforePublicStop:true,bodyReleased:false,bodyBytesSent:0}]);expect(streamWritableEnded).toBe(false);if(variant==='native-headers503'){await page.waitForFunction(()=>(window as unknown as CCWindow).cc.seen.includes('error'));expect(await page.evaluate(()=>(window as unknown as CCWindow).cc.readyState)).toBe(2);}
    }
    expect([...responseStatuses].find(([request])=>request.url()===origin+'/api/task-events')?.[1]).toBe(503);expect(await page.evaluate(()=>(window as unknown as CCWindow).cc.stopCalled)).toBe(false);wire.push({phase:'controller-public-stop-after-native-terminal'});publicStop=true;await bounded('public stop',()=>page.evaluate(()=>(window as unknown as CCWindow).cc.stop()));await bounded('route drain',()=>Promise.all([...handlers]));expect(pending.size).toBe(0);expect(handlers.size).toBe(0);expect(counts.get('/api/task-events')).toBe(1);expect(counts.get('/api/session')||0).toBe(variant==='client-headers503'?1:0);expect(counts.size).toBe(variant==='client-headers503'?3:2);expect(problems).toEqual([]);
    const data=await page.evaluate(()=>{const c=(window as unknown as CCWindow).cc;return {seen:c.seen,readyState:c.readyState,status:c.status,body:c.body,stopCalled:c.stopCalled,connected:c.client?.isConnected()??null};});summaries.push({variant,terminal,wire,status:503,bodyReleased,bodyBytesSent,bodySha256:createHash('sha256').update(responseBody).digest('hex'),serverStreamClosed,streamWritableEnded,publicStopAfterNativeTerminal:true,noAppOrClientInNativeControl:variant==='native-headers503',data,pending:pending.size,problems:[...problems],browserVersion:browser.version(),notHistoricalUiCauseProof:true});
   }catch(error){primary=error;summaries.push({variant,failure:String(error),terminal,wire,bodyReleased,bodyBytesSent,serverStreamClosed,publicStop,problems:[...problems],notHistoricalUiCauseProof:true});}
   const cleanupErrors:unknown[]=[];
   if(context){for(const page of context.pages())try{await bounded('final public stop',()=>page.evaluate(()=>(window as unknown as CCWindow).cc?.stop?.()));}catch(error){cleanupErrors.push(error);}try{await bounded('final routes',()=>Promise.all([...handlers]));}catch(error){cleanupErrors.push(error);}try{await bounded('actual context close',()=>context!.close());}catch(error){cleanupErrors.push(error);}}
   if(serverStarted){server.closeAllConnections();try{await bounded('actual owned server close',()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));}catch(error){cleanupErrors.push(error);}}
   if(pending.size||handlers.size||server.listening||problems.length)cleanupErrors.push(Error('CC_FINAL_RESOURCES_OR_BOUNDARY '+JSON.stringify({pending:pending.size,handlers:handlers.size,listening:server.listening,problems})));
   console.log('CC_VARIANT_CLOSED',JSON.stringify({variant,actualContextClosed:context?context.pages().length===0:true,actualServerClosed:!server.listening,pending:pending.size,handlers:handlers.size,cleanupErrors:cleanupErrors.map(String)}));
   if(primary)throw cleanupErrors.length?new AggregateError([primary,...cleanupErrors],'CC_CONTROL_AND_CLEANUP'):primary;if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'CC_CLEANUP');
  }
 }finally{await bounded('actual browser close',()=>browser.close());console.log('CC_CONTROLLED_TRANSPORT',JSON.stringify({summaries,noBusinessSourceModified:true,noOldFixturesAssertionsBudgetsModified:true,historicalUiGatesUnaccepted:true}));}
},25000);
