// @vitest-environment node
// Real InfiniteCanvas and shipped CSS. Public props only; no paid/business I/O.
import { isCompletedCanvasFixtureEventStream } from '../helpers/canvas-fixture-event-stream';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { afterAll, beforeAll, expect, it } from 'vitest';
type Theme='gold'|'mono';
type HVOrder='late-a'|'late-b';
interface Options {orderControl?:HVOrder;distinctB?:boolean;admin?:boolean; requireMissing?:boolean; touch?:boolean;holdRecovery?:boolean;catalogLoading?:boolean}
interface FixtureWindow extends Window {canvasUi:{png:string;mount(theme:Theme,options:Options):void;unmount():void;state:{mounts:number;disposed:boolean;scopeChecks:number;images:unknown[];groups:unknown[];actions:string[];view:{offsetX:number;offsetY:number;zoom:number}|null;events:Array<{type:string;target:string}>}}}
interface HVMediaGate {armed:boolean;waiting:number;seen:number;gate:Promise<void>;release:()=>void}
interface Session {media:HVMediaGate;context:BrowserContext;page:Page;options:Options;errors:string[];counts:Map<string,number>;handlers:Set<Promise<void>>;mounted:boolean;pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;refused:Set<Request>;responseStatus:Map<Request,number>;nativeWaiters:Set<()=>void>;png:Buffer;releaseRecovery:()=>void;recoveryCalls:number}
const ORIGIN='https://canvas-shell-mobile.invalid';
const HV_OWNED_A="data:video/mp4;base64,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";
const HV_OWNED_B="data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM4bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAmJ0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAKAAAABaAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHabWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABhW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUVzdGJsAAAAuXN0c2QAAAAAAAAAAQAAAKlhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAKAAWgBIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAL2F2Y0MBQsAK/+EAF2dCwArcKN+TARAAAAMAEAAAAwFA8SJ4AQAFaM4CPIAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAogAAAAAAAAAAYc3R0cwAAAAAAAAABAAAACgAABAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAoAAAABAAAAPHN0c3oAAAAAAAAAAAAAAAoAAAKaAAAARgAAAEYAAABGAAAARgAAAEYAAABGAAAARgAAAEYAAABGAAAAFHN0Y28AAAAAAAAAAQAAA2gAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYyLjEyLjEwMAAAAAhmcmVlAAAFGG1kYXQAAAJRBgX//03cRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIzIDA0ODBjYjAgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MSBkZWJsb2NrPTA6MDowIGFuYWx5c2U9MDowIG1lPWRpYSBzdWJtZT0wIHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTAgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0wIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PTAgdGhyZWFkcz0zIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTEga2V5aW50X21pbj0xIHNjZW5lY3V0PTAgaW50cmFfcmVmcmVzaD0wIHJjPWNyZiBtYnRyZWU9MCBjcmY9MTguMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0wAIAAAABBZYiEOhGKAAIxscAAQi44AAjuScnJycnJycnJ111111111111111111111111111111111111111111111111114AAABCZYiCA2hGKAAKi8cAAR9Y4AAsIScnJycnJycnJ111111111111111111111111111111111111111111111111114AAAAQmWIhA2hGKAAKi8cAAR9Y4AAsIScnJycnJycnJ111111111111111111111111111111111111111111111111114AAAAEJliIIDaEYoAAqLxwABH1jgACwhJycnJycnJycnXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXgAAABCZYiEDaEYoAAqLxwABH1jgACwhJycnJycnJycnXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXgAAAAQmWIggNoRigADMTHAAFhCOAAIbMnJycnJycnJyddddddddddddddddddddddddddddddddddddddddddddddddddeAAAAEJliIQNoRigADMTHAAFhCOAAIbMnJycnJycnJyddddddddddddddddddddddddddddddddddddddddddddddddddeAAAABCZYiCA2hGKAAMxMcAAWEI4AAhsycnJycnJycnJ111111111111111111111111111111111111111111111111114AAAAQmWIhA2hGKAAMxMcAAWEI4AAhsycnJycnJycnJ111111111111111111111111111111111111111111111111114AAAAEJliIIDaEYoAAzExwABYQjgACGzJycnJycnJycnXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXg=";
const THEMES:readonly Theme[]=['gold','mono'];
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
const HU_CLIP_B="data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM4bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAmJ0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAKAAAABaAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHabWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABhW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUVzdGJsAAAAuXN0c2QAAAAAAAAAAQAAAKlhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAKAAWgBIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAL2F2Y0MBQsAK/+EAF2dCwArcKN+TARAAAAMAEAAAAwFA8SJ4AQAFaM4CPIAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAogAAAAAAAAAAYc3R0cwAAAAAAAAABAAAACgAABAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAoAAAABAAAAPHN0c3oAAAAAAAAAAAAAAAoAAAKaAAAARgAAAEYAAABGAAAARgAAAEYAAABGAAAARgAAAEYAAABGAAAAFHN0Y28AAAAAAAAAAQAAA2gAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYyLjEyLjEwMAAAAAhmcmVlAAAFGG1kYXQAAAJRBgX//03cRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIzIDA0ODBjYjAgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MSBkZWJsb2NrPTA6MDowIGFuYWx5c2U9MDowIG1lPWRpYSBzdWJtZT0wIHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTAgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0wIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PTAgdGhyZWFkcz0zIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTEga2V5aW50X21pbj0xIHNjZW5lY3V0PTAgaW50cmFfcmVmcmVzaD0wIHJjPWNyZiBtYnRyZWU9MCBjcmY9MTguMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0wAIAAAABBZYiEOhGKAAIxscAAQi44AAjuScnJycnJycnJ111111111111111111111111111111111111111111111111114AAABCZYiCA2hGKAAKi8cAAR9Y4AAsIScnJycnJycnJ111111111111111111111111111111111111111111111111114AAAAQmWIhA2hGKAAKi8cAAR9Y4AAsIScnJycnJycnJ111111111111111111111111111111111111111111111111114AAAAEJliIIDaEYoAAqLxwABH1jgACwhJycnJycnJycnXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXgAAABCZYiEDaEYoAAqLxwABH1jgACwhJycnJycnJycnXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXgAAAAQmWIggNoRigADMTHAAFhCOAAIbMnJycnJycnJyddddddddddddddddddddddddddddddddddddddddddddddddddeAAAAEJliIQNoRigADMTHAAFhCOAAIbMnJycnJycnJyddddddddddddddddddddddddddddddddddddddddddddddddddeAAAABCZYiCA2hGKAAMxMcAAWEI4AAhsycnJycnJycnJ111111111111111111111111111111111111111111111111114AAAAQmWIhA2hGKAAMxMcAAWEI4AAhsycnJycnJycnJ111111111111111111111111111111111111111111111111114AAAAEJliIIDaEYoAAzExwABYQjgACGzJycnJycnJycnXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXg=";
const manager=new TreeHistoryManager();
const state={mounts:0,disposed:false,scopeChecks:0,images:[] as CanvasImage[],groups:[] as Array<{id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}>,actions:[] as string[],view:null as {offsetX:number;offsetY:number;zoom:number}|null,events:[] as Array<{type:string,target:string}>};
const action=(name:string)=>()=>{state.actions.push(name);};
const observe=(e:Event)=>{const el=e.target as Element;state.events.push({type:e.type,target:el?.hasAttribute?.('data-canvas-viewport')?'canvas':el?.closest?.('button')?.textContent?.trim()||el?.tagName||'unknown'});};
const scope={actorId:'omp-mobile-user',projectId:'canvas-ui-project',key:'bb-native-scope',authority:'legacy' as const,assertCurrent(_write=false):void{const actor=localStorage.getItem('unbounded_ai_current_user'),stored=JSON.parse(localStorage.getItem('unbounded_ai_user_data')||'null'),project=document.querySelector('[data-canvas-viewport]')?.getAttribute('data-project-id');if(state.disposed||actor!==this.actorId||project!==this.projectId||!stored?.users?.some((u:{id:string;status:string})=>u.id===this.actorId&&u.status==='active'))throw Error('BB_SYNTHETIC_SCOPE_IDENTITY_CHANGED');state.scopeChecks++;}};
const sketchContext={key:scope.key,captureScope:()=>{scope.assertCurrent();return scope;},insert:async()=>{throw Error('BB_UNEXPECTED_INSERT');}};
const bxDescriptor={providerId:'bx-provider',modelId:'bx-image',kind:'image' as const,sourceType:'image' as const,protocol:'openai',executionMode:'sync' as const,allowedRatios:['1:1','3:2'],allowedSizes:['1024x1024'],qualityOptions:['standard'],maxOutputs:2,supportsVision:false,supportsReferenceImages:true,maxReferenceImages:14,supportsMask:false,allowedDurationsSeconds:[],maxDurationSeconds:0,supportedOperations:['image-to-image','multi-reference'] as Array<'image-to-image'|'multi-reference'>,outputKinds:['image'],capabilitySources:{allowedRatios:'admin' as const,allowedSizes:'admin' as const,qualityOptions:'admin' as const,supportsReferenceImages:'admin' as const,maxReferenceImages:'admin' as const}};
const bxUnsupported={...bxDescriptor,modelId:'bx-no-reference',supportsReferenceImages:false,maxReferenceImages:0};
const bySecond={...bxDescriptor,providerId:'by-provider-b',maxReferenceImages:2,allowedRatios:['1:1','16:9'],allowedSizes:['1536x1024'],qualityOptions:['hd'],maxOutputs:1};
function Entry({theme,admin,catalogLoading,distinctB,orderControl}:{theme:'gold'|'mono';admin:boolean;catalogLoading:boolean;distinctB:boolean;orderControl?:'late-a'|'late-b'}):React.ReactElement{
 const HV_A=orderControl==='late-a'?'/api/serve-upload/hv-owned-a.mp4':"data:video/mp4;base64,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";
 const HV_B=orderControl==='late-b'?'/api/serve-upload/hv-owned-b.mp4':HU_CLIP_B;
 const [images,setImages]=useState<CanvasImage[]>([{id:'br-A',url:png,mediaType:'video' as const,videoUrl:HV_A,videoDuration:1,x:40,y:120,width:240,height:135,name:'BW A',prompt:'BR成员A'},{id:'br-B',url:png,...(distinctB?{mediaType:'video' as const,videoUrl:HV_B,videoDuration:1}:{}),x:100,y:270,width:56,height:56,name:'BW B',prompt:'BR成员B'},{id:'br-keep',url:png,x:100,y:380,width:56,height:56,name:'BW 保留',prompt:'BR组外素材'},{id:'hu-duplicate-a',url:png,mediaType:'video' as const,videoUrl:HV_A,x:-2000,y:120,width:56,height:56,prompt:'重复视频A'},{id:'hu-missing',url:png,mediaType:'video' as const,videoUrl:HU_CLIP_B,mediaAvailability:'missing' as const,x:-2200,y:120,width:56,height:56,prompt:'缺失视频'}]);const [selected,setSelected]=useState<CanvasImage|null>(null);state.images=images;const [groups,setGroups]=useState<Array<{id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}>>([]);state.groups=groups;
 return <><OperationAuditClient/><InfiniteCanvas images={images} selectedImage={selected} projectId="canvas-ui-project" isPanelCollapsed={false} isAdmin={admin}
 taskModelCatalog={[bxDescriptor,bxUnsupported,bySecond]} taskModelOptions={[{id:'bx-image',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 图像',type:'image'},{id:'bx-no-reference',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 不支持参考图',type:'image'},{id:'bx-image',providerId:'by-provider-b',providerName:'BY 合成供应商乙',name:'BY 图像乙',type:'image'}]} themeStyle={theme==='mono'?'monochrome':'gold'} initialViewState={{offsetX:0,offsetY:0,zoom:1}} onViewStateChange={view=>{state.view=view;}}
 initialGroups={groups} onGroupsChange={next=>{setGroups(next);}} versionHistoryManager={manager} sketchImageEnabled={true} sketchContext={sketchContext} catalogStatus={{loading:catalogLoading,error:null}} onImagesChange={setImages} onSelectImage={setSelected} onPreviewImage={action('preview')} onGenerateVariation={action('variation')} onExtractKeywords={action('keywords')} onSendToChat={image=>{state.actions.push('chat:'+image.id);}} onFusion={action('fusion')} onAddImages={()=>{throw Error('CANVAS_UI_FIXTURE_UNEXPECTED_PUBLISH')}}
 onSwitchToDashboard={action('dashboard')} onToggleVisionPrompt={action('omp')} onToggleSettings={action('settings')} onToggleTheme={action('theme')} onToggleUserManager={action('users')} onToggleAdminSystem={action('admin')} onToggleProjectData={action('projects')} onToggleFavorites={action('favorites')} onTogglePromptTemplate={action('templates')} onToggleHelp={action('external-help')} onSwitchToNodeMode={action('node')} onSwitchToWorkflowHub={action('workflow')}/></>;
}
Object.assign(window,{canvasUi:{state,png,mount(theme:'gold'|'mono',options:{admin?:boolean;catalogLoading?:boolean;distinctB?:boolean;orderControl?:'late-a'|'late-b'}){if(state.mounts||state.disposed)throw Error('CANVAS_UI_FIXTURE_REMOUNT');state.mounts++;for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.addEventListener(type,observe,true);document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');root.render(<Entry theme={theme} admin={options.admin===true} catalogLoading={options.catalogLoading===true} distinctB={options.distinctB===true} orderControl={options.orderControl}/>);},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}taskEventsClient.disconnect();for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.removeEventListener(type,observe,true);}}});
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
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce', hasTouch: options.touch===true, isMobile: options.touch===true }); contexts.add(context);
  let value: Session | undefined;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    let releaseRecovery:()=>void=()=>{};const recoveryGate=options.holdRecovery?new Promise<void>(resolve=>{releaseRecovery=resolve;}):Promise.resolve();
    let releaseMedia:()=>void=()=>{};const media:HVMediaGate={armed:false,waiting:0,seen:0,gate:new Promise<void>(resolve=>{releaseMedia=resolve;}),release:()=>releaseMedia()};
    const s: Session = { media,context, page, options, errors: [], counts: new Map(), handlers: new Set(), mounted: false,
      pending: new Set(), completed: new Set(), failed: new Set(), refused: new Set(), responseStatus: new Map(), nativeWaiters: new Set(), png: Buffer.alloc(0),releaseRecovery,recoveryCalls:0 }; value = s; live.add(s);
    context.on('request', request => s.pending.add(request));
    context.on('response', response => s.responseStatus.set(response.request(),response.status()));
    context.on('requestfinished', request => { s.pending.delete(request); s.completed.add(request); for (const notify of s.nativeWaiters) notify(); });
    context.on('requestfailed', request => {
      s.pending.delete(request);
      const completed = isCompletedCanvasFixtureEventStream(request, s.responseStatus.get(request), ORIGIN);
      (completed ? s.completed : s.failed).add(request);
      for (const notify of s.nativeWaiters) notify();
    });
    page.on('pageerror', error => s.errors.push(String(error)));
    page.on('dialog', dialog => { s.errors.push('CANVAS_UI_FIXTURE_UNEXPECTED_DIALOG'); void dialog.dismiss().catch(error => s.errors.push(String(error))); });
    await context.routeWebSocket('**/*', socket => { s.errors.push('CANVAS_UI_FIXTURE_UNKNOWN_WS'); socket.close({ code: 1008, reason: 'Offline fixture forbids WebSockets' }); });
    await context.route('**/*', async route => {
      const operation = (async (): Promise<void> => {
        const request = route.request(), url = new URL(request.url()), headers = request.headers();
        if (url.origin !== ORIGIN || url.username || url.password || request.method() !== 'GET' || request.postData() !== null
          || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key'] || headers['idempotency-key']) throw Error('CANVAS_UI_FIXTURE_HTTP_BOUNDARY');
        const key = url.pathname + url.search, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count);
        if (count > ((key==='/api/serve-upload/hv-owned-a.mp4'||key==='/api/serve-upload/hv-owned-b.mp4')?12:['/api/session','/api/auth/me','/api/task-events'].includes(key)?6:HELP_FILES.some(file=>key==='/api/help-image?file='+file)?3:1)) throw Error('CANVAS_UI_FIXTURE_HTTP_COUNT ' + key);
        if(key==='/api/serve-upload/hv-owned-a.mp4'||key==='/api/serve-upload/hv-owned-b.mp4'){
          const expected=options.orderControl==='late-a'?'/api/serve-upload/hv-owned-a.mp4':options.orderControl==='late-b'?'/api/serve-upload/hv-owned-b.mp4':'';
          if(key!==expected||request.isNavigationRequest())throw Error('HV_EXACT_OWN_MEDIA_ROUTE');
          const data=Buffer.from((key==='/api/serve-upload/hv-owned-a.mp4'?HV_OWNED_A:HV_OWNED_B).split(',')[1],'base64');
          const range=headers.range,match=range?.match(/^bytes=(\d+)-(\d*)$/);
          if(range&&!match)throw Error('HV_EXACT_SINGLE_RANGE');
          const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),data.length-1):data.length-1;
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||end>=data.length)throw Error('HV_RANGE_BOUNDS');
          s.media.seen++;if(s.media.armed){s.media.waiting++;await s.media.gate;}
          await route.fulfill({status:range?206:200,headers:{'content-type':'video/mp4','cache-control':'no-store','accept-ranges':'bytes','content-length':String(end-start+1),...(range?{'content-range':'bytes '+start+'-'+end+'/'+data.length}:{})},body:data.subarray(start,end+1)});return;
        }
        if (key === '/' && request.isNavigationRequest()) {
          await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;width:100vw;height:100dvh;overflow:hidden"><div id="fixture-root" style="position:relative;width:100%;height:100%"></div></body></html>` }); return;
        }
        if(key==='/api/tasks/recover?projectId=canvas-ui-project'){if(headers['x-wujie-expected-actor-id']!=='omp-mobile-user'||headers['content-type']!=='application/json')throw Error('BB_RECOVERY_ACTOR_HEADERS');s.recoveryCalls++;await recoveryGate;await route.fulfill({json:{success:true,tasks:[]}});return;}
        if (key === '/api/session' || key === '/api/auth/me') { await route.fulfill({ json: { success:true,user:{id:'omp-mobile-user',username:'离线用户',role:'user'} } }); return; }
        if (key === '/api/task-events') { await route.fulfill({ status:204,body:'' });return; }
        if (key === '/api/models?type=3d') { await route.fulfill({json:{success:true,capabilityCatalogVersion:1,providers:[],models:[],taskModelCatalog:[],modelAuthorizationMigration:{resolved:[],required:[]},quickCreatePolicy:{autoModelRouting:false,globalDefault:'',quickCreateDefault:''}}});return; }
        if (key === '/api/upscayl' || key === '/api/models?type=upscaler' || key === '/api/models?type=removebg') { await route.fulfill({json:key==='/api/upscayl'?{available:false,models:[]}:{success:true,providers:[],models:[]}});return; }
        if (HELP_FILES.some(file => key === '/api/help-image?file=' + file)) { await route.fulfill({contentType:'image/png',body:s.png});return; }
        if (key === '/logo.png') { await route.fulfill({contentType:'image/png',body:s.png});return; }
        throw Error('CANVAS_UI_FIXTURE_UNKNOWN_HTTP ' + key);
      })().catch(async error => { s.errors.push(String(error)); s.refused.add(route.request()); await route.abort('blockedbyclient'); });
      s.handlers.add(operation); try { await operation; } finally { s.handlers.delete(operation); }
    });
    await context.addInitScript(() => { const actor='omp-mobile-user',user={id:actor,username:'离线用户',password:'',role:'user',status:'active',createdAt:1,updatedAt:1};localStorage.setItem('unbounded_ai_current_user',actor);localStorage.setItem('wujie_selected_model',JSON.stringify({model:'bx-provider::bx-image',providerId:'bx-provider'}));localStorage.setItem('unbounded_ai_user_data',JSON.stringify({users:[user],userData:{[actor]:{user,projects:[],apiKeys:[],usageStats:[]}}})); });
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
  try { s.media.release(); } catch(error) { failures.push(error); }
  try { await nativeRequestsFinished(s); } catch(error) { failures.push(error); }
  try { await bounded('HV metadata observer detach',()=>hvStopObserver(s)); } catch(error) { failures.push(error); }
  try { await bounded('HV presentation observer detach',()=>hvStopPresentation(s)); } catch(error) { failures.push(error); }
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
  const allowed=[...(s.options.orderControl==='late-a'?['/api/serve-upload/hv-owned-a.mp4']:s.options.orderControl==='late-b'?['/api/serve-upload/hv-owned-b.mp4']:[]),'/','/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/logo.png','/api/tasks/recover?projectId=canvas-ui-project',...HELP_FILES.map(file=>'/api/help-image?file='+file)];
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
}

async function withSession(theme:Theme,width:number,height:number,options:Options,run:(s:Session)=>Promise<void>):Promise<void>{const s=await session(theme,width,height,options);let primary:unknown;try{await run(s);}catch(e){primary=e;}try{await dispose(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'CANVAS_UI_FIXTURE_TEST_AND_CLEANUP');throw cleanup;}if(primary)throw primary;}












async function huAudit(c:Locator):Promise<void>{await c.scrollIntoViewIfNeeded();const v=await c.evaluate(el=>{const r=el.getBoundingClientRect(),faults:string[]=[];const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n:Node|null;while((n=walker.nextNode())){if(!n.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(n);for(const b of range.getClientRects())if(b.left<r.left-.5||b.right>r.right+.5||b.top<r.top-.5||b.bottom>r.bottom+.5)faults.push('text-clipped');}return {name:el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent?.trim()||'',width:r.width,height:r.height,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),faults};});console.log('HU_CONTROL',JSON.stringify(v));expect.soft(v.width,'touch width '+v.name).toBeGreaterThanOrEqual(44);expect.soft(v.height,'touch height '+v.name).toBeGreaterThanOrEqual(44);expect.soft(v.inside&&v.hit,'visible '+v.name).toBe(true);expect.soft(v.name,'accessible purpose').not.toBe('');expect.soft(v.faults,'readable '+v.name).toEqual([]);}

interface HUCase {theme:Theme;width:number;height:number}
interface HUMedia {source:string;time:number;duration:number;paused:boolean;width:number;height:number;seeking:boolean;ready:number;error:number|null;pixel:number[]|null}
const HU_MATRIX:readonly HUCase[]=THEMES.flatMap(theme=>[
 {theme,width:320,height:640},{theme,width:390,height:844},
 {theme,width:640,height:320},{theme,width:1040,height:720},
]);
async function huActivate(s:Session,c:Locator):Promise<void>{await c.scrollIntoViewIfNeeded();if(s.options.touch)await c.tap();else await c.click();await settle(s.page);}
async function huOpen(s:Session):Promise<Locator>{
 if(s.options.touch){
  const d=await s.context.newCDPSession(s.page);let active=false;const failures:unknown[]=[];
  try{
   expect(await s.page.evaluate(()=>Boolean(document.elementFromPoint(128,198)?.closest('[data-canvas-image-id="br-A"]')))).toBe(true);
   await d.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:128,y:198,id:1,force:1}]});active=true;
   await s.page.locator('[data-popup="context-menu"]').waitFor({state:'visible'});
   await d.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});active=false;
  }catch(error){failures.push(error);}
  if(active){try{await d.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});}catch(error){failures.push(error);}}
  try{await d.detach();}catch(error){failures.push(error);}
  if(failures.length>1)throw new AggregateError(failures,'HU_ENTRY_PRIMARY_AND_CLEANUP');
  if(failures.length===1){const failure=failures[0];throw failure || new AggregateError([failure],'HU_FALSY_PRIMARY_PRESERVED');}
 }else await s.page.locator('[data-canvas-image-id="br-A"]').click({button:'right',position:{x:88,y:78}});
 await huActivate(s,s.page.locator('[data-popup="context-menu"]').getByRole('button',{name:'视频对比',exact:true}));
 const dialog=s.page.getByRole('dialog',{name:'视频对比',exact:true});await dialog.waitFor();return dialog;
}
async function huMedia(videos:Locator):Promise<HUMedia[]>{
 return videos.evaluateAll(nodes=>nodes.map(node=>{
  const v=node as HTMLVideoElement;let pixel:number[]|null=null;
  if(v.readyState>=2&&v.videoWidth&&v.videoHeight&&!v.seeking){
   const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');if(!ctx)throw Error('HU_PIXEL_CONTEXT');
   ctx.drawImage(v,Math.floor(v.videoWidth/2),Math.floor(v.videoHeight/2),1,1,0,0,1,1);pixel=Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3);
  }
  return{source:v.currentSrc,time:v.currentTime,duration:v.duration,paused:v.paused,width:v.videoWidth,height:v.videoHeight,seeking:v.seeking,ready:v.readyState,error:v.error?.code??null,pixel};
 }));
}
async function huCapture(s:Session,e:HUCase,label:string):Promise<void>{
 const dir=path.resolve('output/playwright/canvas-video-compare-loading-hv-r4-20261020',String(process.pid));await mkdir(dir,{recursive:true});
 const file=path.join(dir,e.theme+'-'+e.width+'x'+e.height+'-'+label+'.png');await s.page.screenshot({path:file});
 console.log('HU_CAPTURE',JSON.stringify({path:file,label,physicalAndroid:false,coze:false}));
}
async function huWithCapture(s:Session,e:HUCase,label:string,run:()=>Promise<void>):Promise<void>{
 const failures:unknown[]=[];
 try{await run();}catch(error){failures.push(error);}
 try{await huCapture(s,e,label);}catch(error){failures.push(error);}
 if(failures.length>1)throw new AggregateError(failures,'HU_PRIMARY_AND_CAPTURE');
 if(failures.length===1){const failure=failures[0];throw failure || new AggregateError([failure],'HU_FALSY_PRIMARY_PRESERVED');}
}
async function huDecoded(videos:Locator):Promise<void>{
 await expect.poll(async()=>{const m=await huMedia(videos);return m.length===2&&m.every(v=>v.width===160&&v.height===90&&v.duration===1&&v.ready>=2&&!v.error&&!v.seeking);},{timeout:1500}).toBe(true);
}

interface HVMetadataRow {source:string;heldPresent:boolean;heldConnected:boolean;heldFinite:boolean;heldDuration:number|null;unheldFinite:boolean}
interface HVObserver {rows:HVMetadataRow[];stop:()=>void}
interface HVObservedWindow extends Window {hvMetadata?:HVObserver}
async function hvObserve(s:Session,heldSource:string):Promise<void>{
 await s.page.evaluate(held=>{
  const rows:HVMetadataRow[]=[];
  const handler=(event:Event):void=>{
   if(!(event.target instanceof HTMLVideoElement)||!event.target.closest('[data-modal="video-compare"]'))return;
   const all=Array.from(document.querySelectorAll<HTMLVideoElement>('[data-modal="video-compare"] video'));
   const target=event.target,heldVideo=all.find(v=>v.src===held);
   rows.push({source:target.currentSrc||target.src,heldPresent:!!heldVideo,heldConnected:heldVideo?.isConnected===true,heldFinite:!!heldVideo&&Number.isFinite(heldVideo.duration),heldDuration:heldVideo&&Number.isFinite(heldVideo.duration)?heldVideo.duration:null,unheldFinite:Number.isFinite(target.duration)});
  };
  document.addEventListener('loadedmetadata',handler,true);
  (window as HVObservedWindow).hvMetadata={rows,stop:()=>document.removeEventListener('loadedmetadata',handler,true)};
 },heldSource);
}
async function hvStopObserver(s:Session):Promise<void>{
 await s.page.evaluate(()=>{const observer=(window as HVObservedWindow).hvMetadata;try{observer?.stop();}finally{delete (window as HVObservedWindow).hvMetadata;}});
}
interface HVPresentationRow {nodeId:number;source:string;presentedFrames:number;width:number;height:number;mediaTime:number}
interface HVPresentationWindow extends Window {hvPresentation?:{rows:HVPresentationRow[];nodeIds:WeakMap<HTMLVideoElement,number>;stop:()=>void}}
async function hvObservePresentation(s:Session):Promise<void>{
 await s.page.evaluate(()=>{
  const rows:HVPresentationRow[]=[],seen=new Set<HTMLVideoElement>(),handles=new Map<HTMLVideoElement,number>(),nodeIds=new WeakMap<HTMLVideoElement,number>();let nextId=0;
  const register=():void=>{
   for(const video of document.querySelectorAll<HTMLVideoElement>('[data-modal="video-compare"] video')){
    if(seen.has(video))continue;seen.add(video);nodeIds.set(video,++nextId);
    if(typeof video.requestVideoFrameCallback!=='function'||typeof video.cancelVideoFrameCallback!=='function')throw Error('HV_NATIVE_PRESENTATION_OBSERVER_REQUIRED');
    const handle=video.requestVideoFrameCallback((_now:number,meta:VideoFrameCallbackMetadata):void=>{
     handles.delete(video);rows.push({nodeId:nodeIds.get(video)!,source:video.currentSrc||video.src,presentedFrames:meta.presentedFrames,width:meta.width,height:meta.height,mediaTime:meta.mediaTime});
    });handles.set(video,handle);
   }
  };
  const observer=new MutationObserver(register);
  (window as HVPresentationWindow).hvPresentation={rows,nodeIds,stop:()=>{
   const failures:unknown[]=[];
   try{observer.disconnect();}catch(error){failures.push(error);}
   for(const[video,handle]of handles){try{video.cancelVideoFrameCallback(handle);}catch(error){failures.push(error);}}
   handles.clear();if(failures.length)throw new AggregateError(failures,'HV_PRESENTATION_OBSERVER_CLEANUP');
  }};
  observer.observe(document,{subtree:true,childList:true});register();
 });
}
async function hvStopPresentation(s:Session):Promise<void>{
 await s.page.evaluate(()=>{const observer=(window as HVPresentationWindow).hvPresentation;try{observer?.stop();}finally{delete (window as HVPresentationWindow).hvPresentation;}});
}
// This new file covers metadata ordering and compositor alignment only.
// The .2/.7 seek checks remain in unchanged HU, and may run only after a source change.
for(const theme of THEMES)for(const order of ['late-a','late-b'] as const)it('HV '+theme+' '+order+' metadata order remains finite after both real sources decode',async()=>{
 const e:HUCase={theme,width:390,height:844};
 await withSession(theme,390,844,{touch:true,distinctB:true,orderControl:order},async s=>{
  await huWithCapture(s,e,'metadata-'+order+'-end-or-failure',async()=>{
   const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);
   const dialog=await huOpen(s),videos=dialog.locator('video');await huDecoded(videos);
   await dialog.getByRole('combobox',{name:'从当前画布选择视频 B',exact:true}).selectOption('br-B');await settle(s.page);await huDecoded(videos);
   await nativeRequestsFinished(s);
   const held=ORIGIN+(order==='late-a'?'/api/serve-upload/hv-owned-a.mp4':'/api/serve-upload/hv-owned-b.mp4');
   const unheld=order==='late-a'?HV_OWNED_B:HV_OWNED_A;
   await hvObserve(s,held);s.media.armed=true;
   let observed:HVMetadataRow[]=[],beforeReleaseMax:string|null=null;
   try{
    await huActivate(s,dialog.getByRole('button',{name:'滑动',exact:true}));
    await expect.poll(()=>s.media.waiting,{timeout:1500,message:'new slider media must reach one explicit held GET'}).toBeGreaterThan(0);
    await expect.poll(async()=>s.page.evaluate(source=>(window as HVObservedWindow).hvMetadata?.rows.some(r=>r.source===source&&r.unheldFinite&&r.heldPresent&&r.heldConnected&&!r.heldFinite)===true,unheld),{timeout:1500,message:'unheld real metadata precedes held source metadata'}).toBe(true);
    observed=await s.page.evaluate(()=>(window as HVObservedWindow).hvMetadata?.rows||[]);
    beforeReleaseMax=await dialog.getByRole('slider',{name:'对比播放进度',exact:true}).getAttribute('max');
   }finally{s.media.release();}
   await nativeRequestsFinished(s);await huDecoded(videos);await settle(s.page);
   const aExpected=order==='late-a'?held:HV_OWNED_A,bExpected=order==='late-b'?held:HV_OWNED_B;
   let material:HUMedia[]=[];
   await expect.poll(async()=>{
    material=await huMedia(videos);const b=material[0],a=material[1];
    return material.length===2&&b.source===bExpected&&a.source===aExpected&&!!a.pixel&&!!b.pixel
      &&a.pixel[0]>180&&a.pixel[1]>140&&a.pixel[2]<110&&b.pixel[0]>200&&b.pixel[1]<30&&b.pixel[2]<30;
   },{timeout:1500,message:'actual ordered A gold and B red must match both known input files'}).toBe(true);
   console.log('HV_METADATA_MEDIA',JSON.stringify({theme,order,slots:material.map(v=>({...v,source:v.source===aExpected?'owned-A':v.source===bExpected?'owned-B':'unexpected'})),actualNativePixels:true}));
   const afterReleaseMax=await dialog.getByRole('slider',{name:'对比播放进度',exact:true}).getAttribute('max'),text=await dialog.innerText();
   observed=await s.page.evaluate(()=>(window as HVObservedWindow).hvMetadata?.rows||[]);
   console.log('HV_METADATA_ORDER',JSON.stringify({theme,order,observed:observed.map(r=>({...r,source:r.source===held?'held-owned-http':r.source===unheld?'unheld-owned-data':'unexpected'})),heldRequests:s.media.waiting,totalMediaRequests:s.media.seen,beforeReleaseMax,afterReleaseMax,visibleNaN:text.includes('NaN'),nativeBothDecoded:true,physicalAndroid:false}));
   let settledUi:{max:string|null;visibleNaN:boolean}={max:afterReleaseMax,visibleNaN:text.includes('NaN')};
   await expect.poll(async()=>{
    settledUi={max:await dialog.getByRole('slider',{name:'对比播放进度',exact:true}).getAttribute('max'),visibleNaN:(await dialog.innerText()).includes('NaN')};
    return settledUi.max==='1'&&!settledUi.visibleNaN;
   },{timeout:1500,message:'finite visible range/time must settle after either actual metadata order'}).toBe(true);
   console.log('HV_METADATA_UI_SETTLED',JSON.stringify({theme,order,...settledUi,actualUiBudget:1500}));
   await huActivate(s,dialog.getByRole('button',{name:'关闭视频对比',exact:true}));await dialog.waitFor({state:'detached'});
   const after=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);
   expect(after.images).toEqual(before.images);expect(after.groups).toEqual(before.groups);expect(after.view).toEqual(before.view);expect(after.actions).toEqual([]);
  });
 });
},25000);
for(const theme of THEMES)for(const viewport of [{width:390,height:844},{width:1040,height:720}])it('HV '+theme+' '+viewport.width+' slider clips rather than rescales the original A image',async()=>{
 const e:HUCase={theme,...viewport};
 await withSession(theme,e.width,e.height,{touch:e.width<1000,distinctB:true},async s=>{
  await huWithCapture(s,e,'compositor-end-or-failure',async()=>{
   const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);
   const dialog=await huOpen(s),videos=dialog.locator('video');await huDecoded(videos);
   await dialog.getByRole('combobox',{name:'从当前画布选择视频 B',exact:true}).selectOption('br-B');await settle(s.page);await huDecoded(videos);
   await hvObservePresentation(s);
   await huActivate(s,dialog.getByRole('button',{name:'滑动',exact:true}));await huDecoded(videos);
   await expect.poll(async()=>s.page.evaluate(({a,b})=>{
    const observation=(window as HVPresentationWindow).hvPresentation;
    const current=Array.from(document.querySelectorAll<HTMLVideoElement>('[data-modal="video-compare"] video'));
    return !!observation&&current.length===2&&[a,b].every(source=>{
     const video=current.find(v=>v.currentSrc===source);if(!video)return false;
     return observation.rows.some(r=>r.nodeId===observation.nodeIds.get(video)&&r.source===source&&r.presentedFrames>0&&r.width===160&&r.height===90);
    });
   },{a:HV_OWNED_A,b:HV_OWNED_B}),{timeout:1500,message:'both actual source frames must reach the browser compositor'}).toBe(true);
   console.log('HV_PRESENTED',JSON.stringify({theme,...viewport,rows:await s.page.evaluate(({a,b})=>(window as HVPresentationWindow).hvPresentation?.rows.map(r=>({...r,source:r.source===a?'owned-A':r.source===b?'owned-B':'unexpected'}))||[],{a:HV_OWNED_A,b:HV_OWNED_B}),originalBudget:1500}));
   const rects=await videos.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
   expect(rects.length).toBe(2);const b=rects[0],a=rects[1];
   const shot=await s.page.screenshot(),decoded=await sharp(shot).raw().toBuffer({resolveWithObject:true});
   const sample=(x:number,y:number):number[]=>{
    const cx=Math.floor(x),cy=Math.floor(y),{width,height,channels}=decoded.info;
    if(cx<1||cy<1||cx>=width-1||cy>=height-1)throw Error('HV_VIEWPORT_SAMPLE_BOUNDS');
    return[0,1,2].map(channel=>{let sum=0;for(let yy=cy-1;yy<=cy+1;yy++)for(let xx=cx-1;xx<=cx+1;xx++)sum+=decoded.data[(yy*width+xx)*channels+channel];return Math.round(sum/9);});
   };
   const aUpper=sample(b.x+b.width*.25,b.y+b.height*.125),aMiddle=sample(b.x+b.width*.25,b.y+b.height*.5),bUpper=sample(b.x+b.width*.75,b.y+b.height*.125);
   console.log('HV_COMPOSITE',JSON.stringify({theme,...viewport,rects,aUpper,aMiddle,bUpper,actualBrowserCompositorPixels:true,sourcePixelReadNotSubstituted:true,physicalAndroid:false}));
   expect.soft(Math.abs(a.width-b.width),'full-sized A underlying clipping').toBeLessThan(1);
   expect.soft(Math.abs(a.height-b.height),'A/B height alignment').toBeLessThan(1);
   expect.soft(Math.abs(a.x-b.x)+Math.abs(a.y-b.y),'A/B origin alignment').toBeLessThan(1);
   for(const pixel of [aUpper,aMiddle]){expect.soft(pixel[0],'A gold red').toBeGreaterThan(180);expect.soft(pixel[1],'A gold green').toBeGreaterThan(140);expect.soft(pixel[2],'A gold blue').toBeLessThan(110);}
   expect.soft(bUpper[0],'B red right side').toBeGreaterThan(200);expect.soft(bUpper[1],'B green right side').toBeLessThan(30);expect.soft(bUpper[2],'B blue right side').toBeLessThan(30);
   await huActivate(s,dialog.getByRole('button',{name:'关闭视频对比',exact:true}));await dialog.waitFor({state:'detached'});
   const after=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);
   expect(after.images).toEqual(before.images);expect(after.groups).toEqual(before.groups);expect(after.view).toEqual(before.view);expect(after.actions).toEqual([]);
  });
 });
},25000);

