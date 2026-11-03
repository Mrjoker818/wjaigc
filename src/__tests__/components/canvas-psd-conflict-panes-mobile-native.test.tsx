// @vitest-environment node
// Real InfiniteCanvas and shipped CSS. Public props only; no paid/business I/O.
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import type { LayerDocumentRecord } from '@/lib/layer-documents/types';
type HFScenario='error'|'server'|'local'|'reload';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { afterAll, beforeAll, expect, it } from 'vitest';
type Theme='gold'|'mono';
interface Options {admin?:boolean; requireMissing?:boolean; touch?:boolean;holdRecovery?:boolean;catalogLoading?:boolean;hfScenario?:HFScenario}
interface FixtureWindow extends Window {canvasUi:{png:string;mount(theme:Theme,options:Options):void;unmount():void;state:{mounts:number;disposed:boolean;scopeChecks:number;images:unknown[];groups:unknown[];actions:string[];view:{offsetX:number;offsetY:number;zoom:number}|null;events:Array<{type:string;target:string}>}}}
interface Session {context:BrowserContext;page:Page;options:Options;errors:string[];counts:Map<string,number>;handlers:Set<Promise<void>>;mounted:boolean;pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;refused:Set<Request>;responseStatus:Map<Request,number>;nativeWaiters:Set<()=>void>;png:Buffer;releaseRecovery:()=>void;recoveryCalls:number;hf:{scenario:HFScenario;base:LayerDocumentRecord|null;document:LayerDocumentRecord|null;patches:unknown[];reads:number;statuses:number[];audits:unknown[]}}
const ORIGIN='https://canvas-shell-mobile.invalid';
const HF_QUERY='/api/layer-documents?projectId=canvas-ui-project&sourceImageId=br-A&sourceVersionId=et-owned-source-v1';
const HELP_FILES=['canvas-overview.jpeg','erase-tool.jpeg','mask-tool.jpeg','remove-bg.jpeg','upscale.jpeg','lang-edit.jpeg','svg-trace.jpeg','extend.jpeg','oh-my-prompt.jpeg'];
const ENTRY=String.raw`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {InfiniteCanvas,type CanvasImage} from '@/components/infinite-canvas';
import {TreeHistoryManager} from '@/lib/canvas-tree-history';
import {taskEventsClient} from '@/lib/task-events-client';
import {OperationAuditClient} from '@/components/operation-audit-client';
const root=createRoot(document.getElementById('fixture-root')!);
const picture=document.createElement('canvas');picture.width=64;picture.height=64;const ctx=picture.getContext('2d');if(!ctx)throw Error('CANVAS_UI_FIXTURE_CANVAS2D');ctx.fillStyle='#d17a35';ctx.fillRect(0,0,64,64);const png=picture.toDataURL();
const panoramaPicture=document.createElement('canvas');panoramaPicture.width=256;panoramaPicture.height=128;const panoramaContext=panoramaPicture.getContext('2d');if(!panoramaContext)throw Error('DP_OWNED_PANORAMA_CANVAS');for(const [i,color]of ['#bc3d3d','#d68130','#c5ad38','#409b55','#32a6a3','#387ac1','#7454bc','#b4479e'].entries()){panoramaContext.fillStyle=color;panoramaContext.fillRect(i*32,0,32,128);}const panoramaPng=panoramaPicture.toDataURL();
const manager=new TreeHistoryManager();
const state={mounts:0,disposed:false,scopeChecks:0,images:[] as CanvasImage[],groups:[] as Array<{id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}>,actions:[] as string[],view:null as {offsetX:number;offsetY:number;zoom:number}|null,events:[] as Array<{type:string,target:string}>};
const action=(name:string)=>()=>{state.actions.push(name);};
const observe=(e:Event)=>{const el=e.target as Element;state.events.push({type:e.type,target:el?.hasAttribute?.('data-canvas-viewport')?'canvas':el?.closest?.('button')?.textContent?.trim()||el?.tagName||'unknown'});};
const scope={actorId:'omp-mobile-user',projectId:'canvas-ui-project',key:'bb-native-scope',authority:'legacy' as const,assertCurrent(_write=false):void{const actor=localStorage.getItem('unbounded_ai_current_user'),stored=JSON.parse(localStorage.getItem('unbounded_ai_user_data')||'null'),project=document.querySelector('[data-canvas-viewport]')?.getAttribute('data-project-id');if(state.disposed||actor!==this.actorId||project!==this.projectId||!stored?.users?.some((u:{id:string;status:string})=>u.id===this.actorId&&u.status==='active'))throw Error('BB_SYNTHETIC_SCOPE_IDENTITY_CHANGED');state.scopeChecks++;}};
const sketchContext={key:scope.key,captureScope:()=>{scope.assertCurrent();return scope;},insert:async()=>{throw Error('BB_UNEXPECTED_INSERT');}};
const bxDescriptor={providerId:'bx-provider',modelId:'bx-image',kind:'image' as const,sourceType:'image' as const,protocol:'openai',executionMode:'sync' as const,allowedRatios:['1:1','3:2'],allowedSizes:['1024x1024'],qualityOptions:['standard'],maxOutputs:2,supportsVision:false,supportsReferenceImages:true,maxReferenceImages:14,supportsMask:false,allowedDurationsSeconds:[],maxDurationSeconds:0,supportedOperations:['image-to-image','multi-reference'] as Array<'image-to-image'|'multi-reference'>,outputKinds:['image'],capabilitySources:{allowedRatios:'admin' as const,allowedSizes:'admin' as const,qualityOptions:'admin' as const,supportsReferenceImages:'admin' as const,maxReferenceImages:'admin' as const}};
const bxUnsupported={...bxDescriptor,modelId:'bx-no-reference',supportsReferenceImages:false,maxReferenceImages:0};
const bySecond={...bxDescriptor,providerId:'by-provider-b',maxReferenceImages:2,allowedRatios:['1:1','16:9'],allowedSizes:['1536x1024'],qualityOptions:['hd'],maxOutputs:1};
function Entry({theme,admin,catalogLoading}:{theme:'gold'|'mono';admin:boolean;catalogLoading:boolean}):React.ReactElement{
 const [images,setImages]=useState<CanvasImage[]>([{id:'br-A',annotationVersionId:'et-owned-source-v1',url:panoramaPng,mediaType:'image' as const,x:40,y:60,width:240,height:120,name:'BW A',prompt:'BR成员A'},{id:'br-B',url:png,x:100,y:190,width:56,height:56,name:'BW B',prompt:'BR成员B'},{id:'br-keep',url:png,x:100,y:380,width:56,height:56,name:'BW 保留',prompt:'BR组外素材'}]);const [selected,setSelected]=useState<CanvasImage|null>(null);state.images=images;const [groups,setGroups]=useState<Array<{id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}>>([]);state.groups=groups;
 return <><OperationAuditClient/><InfiniteCanvas images={images} selectedImage={selected} projectId="canvas-ui-project" isPanelCollapsed={false} isAdmin={admin}
 taskModelCatalog={[bxDescriptor,bxUnsupported,bySecond]} taskModelOptions={[{id:'bx-image',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 图像',type:'image'},{id:'bx-no-reference',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 不支持参考图',type:'image'},{id:'bx-image',providerId:'by-provider-b',providerName:'BY 合成供应商乙',name:'BY 图像乙',type:'image'}]} themeStyle={theme==='mono'?'monochrome':'gold'} initialViewState={{offsetX:0,offsetY:0,zoom:1}} onViewStateChange={view=>{state.view=view;}}
 initialGroups={groups} onGroupsChange={next=>{setGroups(next);}} versionHistoryManager={manager} sketchImageEnabled={true} sketchContext={sketchContext} catalogStatus={{loading:catalogLoading,error:null}} onImagesChange={setImages} onSelectImage={setSelected} onPreviewImage={action('preview')} onGenerateVariation={action('variation')} onExtractKeywords={action('keywords')} onSendToChat={image=>{state.actions.push('chat:'+image.id);}} onFusion={action('fusion')} onAddImages={()=>{throw Error('CANVAS_UI_FIXTURE_UNEXPECTED_PUBLISH')}}
 onSwitchToDashboard={action('dashboard')} onToggleVisionPrompt={action('omp')} onToggleSettings={action('settings')} onToggleTheme={action('theme')} onToggleUserManager={action('users')} onToggleAdminSystem={action('admin')} onToggleProjectData={action('projects')} onToggleFavorites={action('favorites')} onTogglePromptTemplate={action('templates')} onToggleHelp={action('external-help')} onSwitchToNodeMode={action('node')} onSwitchToWorkflowHub={action('workflow')}/></>;
}
Object.assign(window,{canvasUi:{state,png,mount(theme:'gold'|'mono',options:{admin?:boolean;catalogLoading?:boolean}){if(state.mounts||state.disposed)throw Error('CANVAS_UI_FIXTURE_REMOUNT');state.mounts++;for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.addEventListener(type,observe,true);document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');root.render(<Entry theme={theme} admin={options.admin===true} catalogLoading={options.catalogLoading===true}/>);},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}taskEventsClient.disconnect();for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.removeEventListener(type,observe,true);}}});
`;
let browser: Browser | undefined;
let bundle = '', css = '';
const live = new Set<Session>(), contexts = new Set<BrowserContext>();

beforeAll(async () => {
  // Same native loader and exact installed Next/ag-psd browser boundaries as the
  // reviewed additional-tools-b aspect host. No component or hook replacements.
  if (typeof process.getBuiltinModule !== 'function') throw Error('CANVAS_UI_FIXTURE_NATIVE_LOADER_REQUIRED');
  const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  const NativeRegExp = (require('node:vm') as typeof import('node:vm')).runInThisContext('RegExp') as RegExpConstructor;
  const result = await build({ write: false, bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_CACHE_COMPONENTS': 'false', '__dirname': '"/"' },
    inject: ['task5-next-client-process'],
    plugins: [{ name: 'next-official-browser-variants', setup(builder: import('esbuild').PluginBuild): void {
      const browserVariants = require('next/dist/build/browser-variant-modules') as { browserVariantModules: string[] };
      const variants = new Map(browserVariants.browserVariantModules.map(id => [
        require.resolve(`next/dist/${id}.js`), require.resolve(`next/dist/${id}.browser.js`),
      ]));
      const frameworkFilter = /(?:client-boundary-params|instant-samples|instant-validation[\\/]impl|navigation-dynamic-rendering|server-async-storage|unstable-rethrow)(?:\.js)?$/;
      builder.onResolve({ filter: new NativeRegExp('^task5-next-client-process$') }, () => ({ path: 'task5-next-client-process', namespace: 'task5-framework-host' }));
      builder.onLoad({ filter: new NativeRegExp('.*'), namespace: 'task5-framework-host' }, () => ({
        contents: "export { default as process } from 'next/dist/compiled/process';", loader: 'js', resolveDir: process.cwd(),
      }));
      const utilImporters = new Set([require.resolve('ag-psd/dist/abr.js'), require.resolve('ag-psd/dist/additionalInfo.js')].map(file => path.resolve(file)));
      builder.onResolve({ filter: new NativeRegExp('^util$') }, args => args.importer && utilImporters.has(path.resolve(args.importer))
        ? { path: require.resolve('next/dist/compiled/util') } : undefined);
      builder.onResolve({ filter: new NativeRegExp(frameworkFilter.source, frameworkFilter.flags) }, args => {
        if (!args.importer) return undefined;
        const actual = createRequire(args.importer).resolve(args.path), browserFile = variants.get(actual);
        return browserFile ? { path: browserFile } : undefined;
      });
    } }],
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'oh-my-prompt-mobile-entry.tsx' },
  });
  if (result.outputFiles.length !== 1) throw Error('CANVAS_UI_FIXTURE_MEMORY_BUNDLE_REQUIRED');
  bundle = result.outputFiles[0].text;
  const files = Object.keys(result.metafile!.inputs).filter(file => /^src[\\/]/.test(file) && /\.[jt]sx?$/.test(file));
  const sources = await Promise.all(files.map(async file => ({ content: await readFile(path.resolve(file), 'utf8'), extension: path.extname(file).slice(1) })));
  sources.push({ content: ENTRY, extension: 'tsx' });
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), { base: process.cwd(),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
          : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    } });
  css = compiler.build(new Scanner({}).scanFiles(sources));
  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => {
  const errors: string[] = [];
  for (const s of live) { try { await dispose(s); } catch (error) { errors.push(String(error)); } }
  for (const context of contexts) { try { await context.close(); contexts.delete(context); } catch (error) { errors.push(String(error)); } }
  try { await browser?.close(); } finally { browser = undefined; }
  if (errors.length) throw Error(errors.join('\n'));
}, 15000);

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}
async function bounded(name: string, operation: () => Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('CANVAS_UI_FIXTURE_CLEANUP_TIMEOUT ' + name)), 2500); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function session(theme: Theme = 'gold', width: number = 390, height: number = 844, options: Options = {}): Promise<Session> {
  if (!browser) throw Error('CANVAS_UI_FIXTURE_BROWSER_REQUIRED');
  if (!options.hfScenario) throw Error('HF_EXACT_SCENARIO_REQUIRED');
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce', hasTouch: options.touch===true, isMobile: options.touch===true }); contexts.add(context);
  let value: Session | undefined;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    let releaseRecovery:()=>void=()=>{};const recoveryGate=options.holdRecovery?new Promise<void>(resolve=>{releaseRecovery=resolve;}):Promise.resolve();
    const s: Session = { context, page, options, errors: [], counts: new Map(), handlers: new Set(), mounted: false,
      pending: new Set(), completed: new Set(), failed: new Set(), refused: new Set(), responseStatus: new Map(), nativeWaiters: new Set(), png: Buffer.alloc(0),releaseRecovery,recoveryCalls:0,hf:{scenario:options.hfScenario,base:null,document:null,patches:[],reads:0,statuses:[],audits:[]} }; value = s; live.add(s);
    context.on('request', request => s.pending.add(request));
    context.on('response', response => s.responseStatus.set(response.request(),response.status()));
    context.on('requestfinished', request => { s.pending.delete(request); s.completed.add(request); for (const notify of s.nativeWaiters) notify(); });
    context.on('requestfailed', request => { s.pending.delete(request); s.failed.add(request); for (const notify of s.nativeWaiters) notify(); });
    page.on('pageerror', error => s.errors.push(String(error)));
    page.on('dialog', dialog => { s.errors.push('CANVAS_UI_FIXTURE_UNEXPECTED_DIALOG'); void dialog.dismiss().catch(error => s.errors.push(String(error))); });
    await context.routeWebSocket('**/*', socket => { s.errors.push('CANVAS_UI_FIXTURE_UNKNOWN_WS'); socket.close({ code: 1008, reason: 'Offline fixture forbids WebSockets' }); });
    await context.route('**/*', async route => {
      const operation = (async (): Promise<void> => {
        const request = route.request(), url = new URL(request.url()), headers = request.headers();
        const hfPatch=request.method()==='PATCH'&&url.pathname==='/api/layer-documents'&&url.search==='';
        const hfAuditPost=request.method()==='POST'&&url.pathname==='/api/activity'&&url.search==='';
        if (url.origin !== ORIGIN || url.username || url.password || (!hfPatch&&!hfAuditPost&&request.method() !== 'GET') || (!hfPatch&&!hfAuditPost&&request.postData() !== null)
          || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key'] || headers['idempotency-key']) throw Error('CANVAS_UI_FIXTURE_HTTP_BOUNDARY');
        const key = url.pathname + url.search, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count);
        const hfLimit=(key==='/api/layer-documents'||key==='/api/activity')?(s.hf.scenario==='error'||s.hf.scenario==='local'?2:1):key===HF_QUERY?(s.hf.scenario==='error'?1:s.hf.scenario==='reload'?3:2):null;
        if (count > (hfLimit??(['/api/session','/api/auth/me','/api/task-events'].includes(key)?6:HELP_FILES.some(file=>key==='/api/help-image?file='+file)?3:1))) throw Error('CANVAS_UI_FIXTURE_HTTP_COUNT ' + key);
        if (key === '/' && request.isNavigationRequest()) {
          await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;width:100vw;height:100dvh;overflow:hidden"><div id="fixture-root" style="position:relative;width:100%;height:100%"></div></body></html>` }); return;
        }
        if(key==='/api/tasks/recover?projectId=canvas-ui-project'){if(headers['x-wujie-expected-actor-id']!=='omp-mobile-user'||headers['content-type']!=='application/json')throw Error('BB_RECOVERY_ACTOR_HEADERS');s.recoveryCalls++;await recoveryGate;await route.fulfill({json:{success:true,tasks:[]}});return;}
        if (key === '/api/session' || key === '/api/auth/me') { await route.fulfill({ json: { success:true,user:{id:'omp-mobile-user',name:'HF隔离用户',username:'离线用户',role:'user',apiPermissions:{image:true,chat:true,threeD:true,imageEdit:true,vectorize:true,vlm:true,layer:true,video:true,upscaler:true,removebg:true,audio:true},status:'active',createdAt:1,updatedAt:1} } }); return; }
        if (key === '/api/task-events') { await route.fulfill({ status:204,body:'' });return; }
        if (key === '/api/models?type=3d') { await route.fulfill({json:{success:true,capabilityCatalogVersion:1,providers:[],models:[],taskModelCatalog:[],modelAuthorizationMigration:{resolved:[],required:[]},quickCreatePolicy:{autoModelRouting:false,globalDefault:'',quickCreateDefault:''}}});return; }
        if (key === '/api/upscayl' || key === '/api/models?type=upscaler' || key === '/api/models?type=removebg') { await route.fulfill({json:key==='/api/upscayl'?{available:false,models:[]}:{success:true,providers:[],models:[]}});return; }
        if (HELP_FILES.some(file => key === '/api/help-image?file=' + file)) { await route.fulfill({contentType:'image/png',body:s.png});return; }
        if (key === HF_QUERY) { s.hf.reads++;
          if(s.hf.reads>1){if(!s.hf.document)throw Error('HF_EXISTING_DOCUMENT_REQUIRED');if(s.hf.scenario==='reload'&&s.hf.reads===2){await route.fulfill({status:503,json:{success:false,code:'HF_LOAD_FAILURE',message:'隔离夹具：服务器版本暂时无法读取',retryable:true}});return;}await route.fulfill({json:{success:true,document:s.hf.document}});return;} const background=await s.page.evaluate(()=>{const found=(window as unknown as FixtureWindow).canvasUi.state.images.find(image=>typeof image==='object'&&image!==null&&'id' in image&&image.id==='br-A');if(typeof found!=='object'||found===null||!('url' in found)||typeof found.url!=='string')throw Error('EW_OWNED_SOURCE_REQUIRED');return found.url;});const foreground='data:image/png;base64,'+s.png.toString('base64');if(!background.startsWith('data:image/png;base64,')||background===foreground)throw Error('EW_DISTINCT_OWNED_PNGS');const document={id:'ew-owned-document',userId:'omp-mobile-user',projectId:'canvas-ui-project',sourceImageId:'br-A',sourceVersionId:'et-owned-source-v1',taskId:'ew-owned-historical-task',engine:'local',schemaVersion:1,revision:7,createdAt:1,updatedAt:1,content:{schemaVersion:1,title:'图片',width:256,height:128,exportMode:'basic',layers:[{id:'ew-background',name:'EW 合成背景',role:'background',imageUrl:background,width:256,height:128,offsetX:0,offsetY:0,opacity:1,blendMode:'normal',visible:true,locked:false,order:0,source:'local-enhanced'},{id:'ew-subject',name:'EW 合成主体',role:'subject',imageUrl:foreground,width:64,height:64,offsetX:80,offsetY:32,opacity:1,blendMode:'normal',visible:true,locked:false,order:1,source:'local-enhanced'}]}};s.hf.base=structuredClone(document) as LayerDocumentRecord;s.hf.document=structuredClone(document) as LayerDocumentRecord;await route.fulfill({json:{success:true,document}});return; }
        if(hfPatch){
          const raw=request.postData();if(!raw||raw.length>65536||headers['content-type']!=='application/json'||!s.hf.base||!s.hf.document)throw Error('HF_PATCH_EXACT_BODY_REQUIRED');
          const body:unknown=JSON.parse(raw),expectedContent=structuredClone(s.hf.base.content);expectedContent.layers[1].visible=false;
          const expected={documentId:'ew-owned-document',expectedRevision:s.hf.document.revision,content:expectedContent};
          if(!isDeepStrictEqual(body,expected))throw Error('HF_PATCH_ID_REVISION_OR_CONTENT_MISMATCH');
          s.hf.patches.push(body);
          if(s.hf.patches.length===1){
            if(s.hf.scenario==='error'){s.hf.statuses.push(503);await route.fulfill({status:503,json:{success:false,code:'HF_SAVE_FAILURE',message:'隔离夹具：保存失败，当前修改仍保留，请检查连接后重试。',retryable:true}});return;}
            s.hf.document={...structuredClone(s.hf.base),revision:8,updatedAt:2,content:{...structuredClone(s.hf.base.content),layers:s.hf.base.content.layers.map((layer,index)=>index===1?{...layer,name:'HF 服务器主体'}:{...layer})}};
            s.hf.statuses.push(409);await route.fulfill({status:409,json:{success:false,code:'LAYER_DOCUMENT_REVISION_CONFLICT',message:'隔离版本冲突',retryable:false}});return;
          }
          if((s.hf.scenario!=='error'&&s.hf.scenario!=='local')||s.hf.patches.length!==2)throw Error('HF_PATCH_EXACT_SEQUENCE');
          s.hf.document={...s.hf.document,revision:s.hf.document.revision+1,updatedAt:3,content:expectedContent};
          s.hf.statuses.push(200);await route.fulfill({json:{success:true,document:s.hf.document}});return;
        }
        if(hfAuditPost){
          const raw=request.postData();if(!raw||raw.length>1024||headers['content-type']!=='application/json')throw Error('HF_AUDIT_EXACT_BODY_REQUIRED');
          const body:unknown=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error('HF_AUDIT_OBJECT_REQUIRED');
          const audit=body as Record<string,unknown>,expectedStatus=s.hf.statuses[s.hf.audits.length];
          if(!isDeepStrictEqual(Object.keys(audit).sort(),['action','durationMs','method','path','status'])||audit.action!=='patch_api_request'||audit.method!=='PATCH'||audit.path!=='/api/layer-documents'||audit.status!==expectedStatus||expectedStatus===undefined||typeof audit.durationMs!=='number'||!Number.isInteger(audit.durationMs)||audit.durationMs<0||audit.durationMs>25000)throw Error('HF_AUDIT_EXACT_PATCH_RECEIPT');
          s.hf.audits.push(body);await route.fulfill({json:{success:true}});return;
        }
        if (key === '/logo.png') { await route.fulfill({contentType:'image/png',body:s.png});return; }
        throw Error('CANVAS_UI_FIXTURE_UNKNOWN_HTTP ' + key);
      })().catch(async error => { s.errors.push(String(error)); s.refused.add(route.request()); await route.abort('blockedbyclient'); });
      s.handlers.add(operation); try { await operation; } finally { s.handlers.delete(operation); }
    });
    await context.addInitScript(() => { const actor='omp-mobile-user',user={id:actor,username:'离线用户',password:'',role:'user',apiPermissions:{image:true,chat:true,threeD:true,imageEdit:true,vectorize:true,vlm:true,layer:true,video:true,upscaler:true,removebg:true,audio:true},status:'active',createdAt:1,updatedAt:1};localStorage.setItem('unbounded_ai_current_user',actor);localStorage.setItem('wujie_selected_model',JSON.stringify({model:'bx-provider::bx-image',providerId:'bx-provider'}));localStorage.setItem('unbounded_ai_user_data',JSON.stringify({users:[user],userData:{[actor]:{user,projects:[],apiKeys:[],usageStats:[]}}})); });
    await page.goto(ORIGIN); await page.addScriptTag({ content: bundle });
    console.log('BB_FETCH_RECEIVER_DIAG',JSON.stringify(await page.evaluate(async()=>{const errors:string[]=[];const holder={fetcher:window.fetch};try{await holder.fetcher('http://[');}catch(error){errors.push(String(error));}try{await window.fetch('http://[');}catch(error){errors.push(String(error));}return errors;})));
    s.png=Buffer.from((await page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.png)).split(',')[1],'base64');
    await page.evaluate(v => (window as unknown as FixtureWindow).canvasUi.mount(v.theme,v.options), {theme,options}); s.mounted = true;
    await page.locator('[data-canvas-viewport]').waitFor();
    await nativeRequestsFinished(s); await settle(page);
    await page.waitForFunction(()=>(window as unknown as FixtureWindow).canvasUi.state.view!==null,undefined,{timeout:1500});
    expect(await page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.view),'initial public canvas view').toEqual({offsetX:0,offsetY:0,zoom:1});
    return s;
  } catch (error) {
    try { if (value) await dispose(value); else { await context.close(); contexts.delete(context); } }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'CANVAS_UI_FIXTURE_BOOTSTRAP'); }
    throw error;
  }
}
async function nativeRequestsFinished(s: Session): Promise<void> {
  let notify: (() => void) | undefined;
  try {
    await bounded('native requests', () => new Promise<void>(resolve => {
      notify = () => { if (s.pending.size === 0) resolve(); }; s.nativeWaiters.add(notify); notify();
    }));
  } finally { if (notify) s.nativeWaiters.delete(notify); }
}
async function dispose(s: Session, expectedRefusal?: 'http' | 'websocket', cleanupProbe?: () => void): Promise<void> {
  const failures: unknown[] = [];
  try {
    if (s.mounted) await bounded('unmount', () => s.page.evaluate(() => (window as unknown as FixtureWindow).canvasUi.unmount()));
    cleanupProbe?.(); // Used only by the cleanup-fault selftest, after real unmount.
  } catch (error) { failures.push(error); }
  try { await bounded('routes', () => Promise.all([...s.handlers])); } catch (error) { failures.push(String(error)); }
  try { await nativeRequestsFinished(s); await bounded('final routes', () => Promise.all([...s.handlers])); } catch (error) { failures.push(String(error)); }
  const unresolvedBeforeClose = s.pending.size !== 0 || s.handlers.size !== 0;
  try { await s.context.close(); contexts.delete(s.context); live.delete(s); } catch (error) { failures.push(String(error)); }
  // Cleanup/lifecycle/allowlist failures can never share the expected-refusal
  // prefix. A boundary selftest must not succeed merely because close failed.
  const invalid=(code:string):never=>{if(failures.length)throw new AggregateError([Error(code),...failures],'CANVAS_UI_FIXTURE_VALIDATION_AND_CLEANUP');throw Error(code);};
  const allowed=['/api/activity','/api/layer-documents','/api/layer-documents?projectId=canvas-ui-project&sourceImageId=br-A&sourceVersionId=et-owned-source-v1','/','/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/logo.png','/api/tasks/recover?projectId=canvas-ui-project',...HELP_FILES.map(file=>'/api/help-image?file='+file)];
  const keys=[...s.counts.keys()];
  if(s.options.requireMissing || s.counts.get('/')!==1 || keys.some(k=>!allowed.includes(k)&&!(expectedRefusal==='http'&&k==='/unexpected'))){
    console.log('CANVAS_UI_FIXTURE_REQUEST_DIAGNOSTIC',JSON.stringify({counts:[...s.counts],errors:s.errors}));
    invalid('CANVAS_UI_FIXTURE_REQUEST_VALIDATION');
  }
  const completed=[...s.completed].map(r=>r.url());
  const expectedCompleted=[...s.counts].filter(([k])=>k!=='/unexpected').flatMap(([k,n])=>Array.from({length:n},()=>ORIGIN+k));
  const failed=[...s.failed];
  const validFailures=expectedRefusal==='http'?failed.length===1&&failed[0].url()===ORIGIN+'/unexpected'&&s.refused.has(failed[0]):failed.length===0;
  if(unresolvedBeforeClose||s.pending.size||!validFailures||JSON.stringify(completed.sort())!==JSON.stringify(expectedCompleted.sort())){
    console.log('CANVAS_UI_NATIVE_REQUEST_FAILURE_DIAGNOSTIC',JSON.stringify({unresolvedBeforeClose,pending:[...s.pending].map(r=>r.url()),completed,expectedCompleted,failed:failed.map(r=>({url:r.url(),error:r.failure()?.errorText,status:s.responseStatus.get(r)}))}));
    invalid('CANVAS_UI_FIXTURE_NATIVE_REQUEST_FAILURE');
  }
  if (failures.length) throw Error('CANVAS_UI_FIXTURE_CLEANUP_FAILURE: ' + failures.join('; '));
  if (expectedRefusal) {
    const expected = expectedRefusal === 'http' ? 'Error: CANVAS_UI_FIXTURE_UNKNOWN_HTTP /unexpected' : 'CANVAS_UI_FIXTURE_UNKNOWN_WS';
    if (s.errors.length !== 1 || s.errors[0] !== expected) throw Error('CANVAS_UI_FIXTURE_UNEXPECTED_FAILURES: ' + s.errors.join('; '));
  }
  if (s.errors.length) throw Error('CANVAS_UI_FIXTURE_INFRASTRUCTURE: ' + s.errors.join('; '));
  if(s.hf.audits.length!==s.hf.patches.length||s.hf.statuses.length!==s.hf.patches.length)throw Error('HF_EXACT_AUDIT_FOR_EVERY_PATCH_REQUIRED');
}

async function withSession(theme:Theme,width:number,height:number,options:Options,run:(s:Session)=>Promise<void>):Promise<void>{const s=await session(theme,width,height,options);let primary:unknown;try{await run(s);}catch(e){primary=e;}try{await dispose(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'CANVAS_UI_FIXTURE_TEST_AND_CLEANUP');throw cleanup;}if(primary)throw primary;}

















interface HFCase {theme:Theme;width:number;height:number;scenario:HFScenario;touch:boolean}
async function hfTap(s:Session,control:Locator):Promise<void>{await control.scrollIntoViewIfNeeded();if(s.options.touch)await control.tap();else await control.click();await settle(s.page);}
async function hfGuardedClose(s:Session,control:Locator):Promise<void>{
 let calls=0,witness:unknown;
 await s.page.exposeBinding('hfCloseClickWitness',(_source,value:unknown):void=>{calls++;witness=value;});
 const handle=await control.elementHandle();if(!handle)throw Error('HF_EXACT_CLOSE_BUTTON_REQUIRED');
 try{
  await handle.evaluate(el=>{el.addEventListener('click',(event:Event):void=>{void (window as unknown as {hfCloseClickWitness:(value:unknown)=>Promise<void>}).hfCloseClickWitness({trusted:event.isTrusted,sameButton:event.currentTarget===el,label:el.getAttribute('aria-label')});},{once:true});});
  await hfTap(s,control);await expect.poll(()=>calls,{timeout:1500,message:'trusted click on the same guarded close button'}).toBe(1);
  expect(witness).toEqual({trusted:true,sameButton:true,label:'关闭'});
 }finally{await handle.dispose();}
}
async function hfOpen(s:Session,e:HFCase):Promise<Locator>{
 const img=s.page.locator('[data-canvas-image-id="br-A"]');
 if(e.touch)await img.tap({position:{x:200,y:100}});else await img.click({position:{x:200,y:100}});await settle(s.page);
 if(e.width<768){await hfTap(s,s.page.locator('[data-mobile-image-actions]').getByRole('button',{name:'更多',exact:true}));await hfTap(s,s.page.getByRole('dialog',{name:'图片工具',exact:true}).getByRole('button',{name:'编辑元素',exact:true}));}
 else{await hfTap(s,s.page.getByRole('button',{name:'展开更多工具',exact:true}));const overflow=s.page.locator('[data-image-toolbar-overflow]');await overflow.waitFor({state:'visible'});await hfTap(s,overflow.getByTestId('canvas-edit-elements'));}
 const editor=s.page.getByTestId('layer-editor');await editor.waitFor({state:'visible'});await editor.getByTestId('layer-document-status').filter({hasText:'已保存'}).waitFor({state:'visible'});await editor.getByTestId('layer-count').filter({hasText:'2 个图层'}).waitFor({state:'visible'});await nativeRequestsFinished(s);return editor;
}
async function hfCapture(s:Session,e:HFCase,label:string):Promise<void>{
 const dir=path.resolve('output/playwright/psd-pane-hj-native-20261020',String(process.pid));await mkdir(dir,{recursive:true});
 const file=path.join(dir,e.theme+'-'+e.width+'x'+e.height+'-'+e.scenario+'-'+label+'.png');await s.page.screenshot({path:file});console.log('HJ_CAPTURE',JSON.stringify({file,label,notRealStoragePsdCloudOrDeviceAcceptance:true}));
}
async function hfAudit(s:Session,editor:Locator,alert:Locator,e:HFCase):Promise<void>{
 const layout=await alert.evaluate(el=>{
  const b=el.getBoundingClientRect(),p=el.closest('[role="dialog"]')!.getBoundingClientRect(),message=el.querySelector(':scope > span')!.getBoundingClientRect();
  const controls=Array.from(el.querySelectorAll('button')).map(button=>{const r=button.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(button);return{name:button.textContent?.trim(),left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,lines:new Set(Array.from(range.getClientRects()).filter(x=>x.width>1).map(x=>Math.round(x.top))).size,overflow:button.scrollWidth>button.clientWidth+1,hit:[[r.x+r.width/2,r.y+r.height/2],[r.left+4,r.y+r.height/2],[r.right-4,r.y+r.height/2],[r.x+r.width/2,r.top+4],[r.x+r.width/2,r.bottom-4]].every(([x,y])=>button.contains(document.elementFromPoint(x,y)))};});
  const overlaps=Array.from(el.parentElement!.querySelectorAll('[data-layer-row] [data-layer-action="visibility"]')).filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top;}).length;
  return{banner:{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height,overflow:el.scrollWidth>el.clientWidth+1},dialog:{left:p.left,right:p.right,top:p.top,bottom:p.bottom},messageWidth:message.width,controls,overlaps,viewport:{width:innerWidth,height:innerHeight}};
 });
 console.log('HF_ALERT_GEOMETRY',JSON.stringify({e,...layout}));
 expect.soft(layout.banner.overflow,'HF banner has no horizontal overflow').toBe(false);
 expect.soft(layout.banner.left,'HF banner inside dialog left').toBeGreaterThanOrEqual(layout.dialog.left);
 expect.soft(layout.banner.right,'HF banner inside dialog right').toBeLessThanOrEqual(layout.dialog.right);
 expect.soft(layout.banner.bottom,'HF banner fits viewport').toBeLessThanOrEqual(e.height);
 expect.soft(layout.messageWidth,'HF error message retains readable line width').toBeGreaterThanOrEqual(Math.min(160,layout.dialog.right-layout.dialog.left-32));
 expect.soft(layout.overlaps,'HF recovery banner does not cover layer visibility controls').toBe(0);
 for(const control of layout.controls){
  expect.soft(control.height,'HF recovery touch target height '+control.name).toBeGreaterThanOrEqual(e.touch?44:32);
  expect.soft(control.width,'HF recovery target width '+control.name).toBeGreaterThanOrEqual(44);
  expect.soft(control.lines,'HF recovery label stays on one line '+control.name).toBe(1);
  expect.soft(control.overflow,'HF recovery label is not clipped '+control.name).toBe(false);
  expect.soft(control.hit,'HF recovery center and inset points are reachable '+control.name).toBe(true);
 }
 expect(await editor.getByTestId('layer-document-status').textContent()).toContain(e.scenario==='error'?'保存失败':'保存冲突');
 await nativeRequestsFinished(s);
}
const hjCases:readonly HFCase[]=[
 {theme:'gold',width:640,height:320,scenario:'server',touch:true},
 {theme:'mono',width:640,height:320,scenario:'local',touch:true},
 {theme:'gold',width:568,height:320,scenario:'local',touch:true},
 {theme:'mono',width:568,height:320,scenario:'server',touch:true},
 {theme:'gold',width:320,height:568,scenario:'server',touch:true},
 {theme:'mono',width:390,height:844,scenario:'local',touch:true},
 {theme:'gold',width:1040,height:720,scenario:'server',touch:false},
 {theme:'mono',width:1040,height:720,scenario:'local',touch:false},
];
async function hjLayerTarget(editor:Locator,control:Locator,e:HFCase):Promise<void>{
 await control.scrollIntoViewIfNeeded();const v=await control.evaluate(el=>{const r=el.getBoundingClientRect(),pane=el.closest('[role="region"]')!.getBoundingClientRect();return {width:r.width,height:r.height,paneHeight:pane.height,inside:r.left>=pane.left&&r.right<=pane.right&&r.top>=pane.top&&r.bottom<=pane.bottom,hit:[[r.left+4,r.top+4],[r.right-4,r.top+4],[r.left+4,r.bottom-4],[r.right-4,r.bottom-4],[r.left+r.width/2,r.top+r.height/2]].every(([x,y])=>el.contains(document.elementFromPoint(x,y))) };});
 console.log('HJ_LAYER_TARGET',JSON.stringify({e,...v}));
 expect.soft(v.width,'HJ actual layer control width').toBeGreaterThanOrEqual(e.touch?44:20);expect.soft(v.height,'HJ actual layer control height').toBeGreaterThanOrEqual(e.touch?44:20);
 expect.soft(v.inside,'HJ full layer control fits its pane during conflict').toBe(true);expect.soft(v.hit,'HJ full layer control remains unobstructed during conflict').toBe(true);
 expect(await editor.getByTestId('layer-document-status').textContent()).toContain('保存冲突');
}
async function hjSwipeProperties(s:Session,pane:Locator,e:HFCase):Promise<void>{
 const r=await pane.boundingBox();if(!r)throw Error('HJ_PROPERTIES_BOUNDS');const start={x:r.x+24,y:r.y+Math.min(24,r.height/2)},before=await pane.evaluate(el=>({top:el.scrollTop,overflow:el.scrollHeight>el.clientHeight}));
 expect(await pane.evaluate((el,p)=>{const hit=document.elementFromPoint(p.x,p.y);return Boolean(hit&&el.contains(hit)&&!hit.closest('button,input,textarea,select'));},start),'HJ native swipe begins on actual property content').toBe(true);
 const cdp=await s.context.newCDPSession(s.page);let active=false;
 try{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1,force:1}]});active=true;for(const fraction of [.25,.5,.75,1]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x,y:start.y-64*fraction,id:1,force:1}]});await settle(s.page);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});active=false;}finally{try{if(active)await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});}finally{await cdp.detach();}}
 await settle(s.page);const after=await pane.evaluate(el=>el.scrollTop);console.log('HJ_PROPERTIES_SCROLL',JSON.stringify({e,before,after}));if(before.overflow)await expect.poll(()=>pane.evaluate(el=>el.scrollTop),{timeout:1500,message:'HJ native property scroll remains available during conflict'}).toBeGreaterThan(before.top);
}
for(const e of hjCases)it('HJ PSD conflict secondary panes '+e.theme+' '+e.width+'x'+e.height+' '+e.scenario,async()=>{
 await withSession(e.theme,e.width,e.height,{touch:e.touch,hfScenario:e.scenario},async s=>{
  const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state),editor=await hfOpen(s,e),views=editor.getByRole('group',{name:'PSD 编辑视图',exact:true});
  try{
   if(e.touch)await hfTap(s,views.getByRole('button',{name:'图层',exact:true}));
   const visibility=editor.locator('[data-layer-row="ew-subject"] [data-layer-action="visibility"]');await hfTap(s,visibility);expect(await visibility.getAttribute('aria-pressed')).toBe('false');
   const alert=editor.getByTestId('layer-document-conflict');await alert.getByRole('button',{name:'使用服务器版本',exact:true}).waitFor({state:'visible'});await nativeRequestsFinished(s);expect(s.hf.patches).toHaveLength(1);await hfAudit(s,editor,alert,e);await hfCapture(s,e,'conflict-layer-pane');
   // Selecting, viewing and scrolling must not resolve or overwrite a conflict.
   for(const [id,name]of [['ew-background','EW 合成背景'],['ew-subject','EW 合成主体']]){
    const row=editor.locator('[data-layer-row="'+id+'"]'),control=row.locator('[data-layer-action="visibility"]');await hjLayerTarget(editor,control,e);
    await hfTap(s,row.getByText(name,{exact:true}));await expect.poll(()=>row.getAttribute('data-layer-selected'),{timeout:1500}).toBe('true');
   }
   if(e.touch)await hfTap(s,views.getByRole('button',{name:'属性',exact:true}));
   const properties=editor.getByRole('region',{name:'图层属性',exact:true,includeHidden:true});await properties.waitFor({state:'visible'});await properties.getByText('EW 合成主体',{exact:true}).waitFor({state:'visible'});
   if(e.touch)expect(await editor.locator('#psd-mobile-pane-canvas').evaluate(el=>(el as HTMLElement).inert),'HJ covered drawing pane is inert').toBe(true);
   if(e.touch)await hjSwipeProperties(s,properties,e);
   const position=properties.getByTestId('layer-position');await position.scrollIntoViewIfNeeded();expect(await position.textContent()).toBe('80,32');expect(await properties.getByText('64x64',{exact:true}).count()).toBe(1);
   await hfCapture(s,e,'conflict-properties');
   if(e.touch){
    await hfTap(s,views.getByRole('button',{name:'画布',exact:true}));const canvas=editor.getByRole('region',{name:'图层画布',exact:true});
    expect(await canvas.getAttribute('aria-hidden')).toBe('false');expect(await canvas.evaluate(el=>(el as HTMLElement).inert),'HJ drawing pane becomes active again').toBe(false);expect(await properties.getAttribute('aria-hidden')).toBe('true');
    const rect=await canvas.boundingBox(),surface=canvas.getByTestId('layer-canvas'),drawing=await surface.boundingBox(),hit=await surface.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===el;});
    console.log('HJ_CANVAS_GEOMETRY',JSON.stringify({e,rect,drawing,hit}));
    for(const [label,value]of [['region width',rect?.width],['region height',rect?.height],['canvas width',drawing?.width],['canvas height',drawing?.height]] as const)expect.soft(value,'HJ actual '+label+' retains a full touch target').toBeGreaterThanOrEqual(44);
    expect.soft(hit,'HJ actual drawing canvas center remains reachable').toBe(true);await hfTap(s,views.getByRole('button',{name:'图层',exact:true}));
   }
   expect(s.hf.patches).toHaveLength(1);expect(s.hf.reads).toBe(2);expect(s.hf.document?.revision).toBe(8);
   const close=editor.getByRole('button',{name:'关闭',exact:true});await hfGuardedClose(s,close);await nativeRequestsFinished(s);expect(await editor.isVisible()).toBe(true);expect(s.hf.patches).toHaveLength(1);
   await hfTap(s,alert.getByRole('button',{name:e.scenario==='local'?'保留当前修改并重试':'使用服务器版本',exact:true}));await editor.getByTestId('layer-document-status').filter({hasText:'已保存'}).waitFor({state:'visible'});await alert.waitFor({state:'detached'});await nativeRequestsFinished(s);
   const local=e.scenario==='local';expect(s.hf.patches).toHaveLength(local?2:1);expect(s.hf.document?.revision).toBe(local?9:8);expect(s.hf.reads).toBe(2);expect(s.hf.audits).toHaveLength(s.hf.patches.length);
   await hfTap(s,close);await editor.waitFor({state:'detached'});await nativeRequestsFinished(s);const after=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);expect(after.images).toEqual(before.images);expect(after.groups).toEqual(before.groups);expect(after.view).toEqual(before.view);expect(after.actions).toEqual([]);
   console.log('HJ_SECONDARY_BODY',JSON.stringify({e,reads:s.hf.reads,patches:s.hf.patches.length,audits:s.hf.audits.length,revision:s.hf.document?.revision,bodyReachedNotPassGate:true,notRealStorageOrDevice:true}));
  }catch(error){await hfCapture(s,e,'failure');throw error;}
 });
},25000);

