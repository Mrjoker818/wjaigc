// @vitest-environment node
import { readOwnedOneSecondVideo } from '../../../tests/helpers/owned-media-fixture';
// Production search/export/share and real ChatArea/Providers/CSS; only synthetic .invalid I/O.
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {compile} from 'tailwindcss';
import {Scanner} from '@tailwindcss/oxide';
import {chromium,type Browser,type BrowserContext,type Page,type Locator,type Request} from '@playwright/test';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';

type Theme='gold'|'mono';
type Surface='messages'|'markdown'|'lightbox'|'timeline'|'brief'|'multi'|'approval'|'result';
interface Options{surface:Surface;variant?:string;status?:string;zero?:boolean;initialIndex?:number;ops?:string[];operationError?:boolean;holdOps?:boolean;clipboardDenied?:boolean;clipboardHold?:boolean}
interface Gate{wait:Promise<void>;release():void}
interface FixtureWindow extends Window{scUi:{mount(theme:Theme,options:Options):void;unmount():void;state:{disposed:boolean;closed:number;approvals:unknown[];returned:unknown[];cancelCalls:number}};clipboardFixture:{release():void;pending:number}}
interface Session{context:BrowserContext;page:Page;options:Options;errors:string[];counts:Map<string,number>;handlers:Set<Promise<void>>;pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;refused:Set<Request>;plannedFailed:Set<Request>;nativeWaiters:Set<()=>void>;gates:Gate[];mounted:boolean;consumed:Set<number>;bodies:Array<{path:string;body:unknown}>;reads:Map<string,{min:number;max:number}>}
const ORIGIN='https://simple-chat-messages-results-mobile.invalid';
const THEMES:Theme[]=['gold','mono'];
let pngA:Buffer,pngB:Buffer,videoBytes:Buffer,zipBytes:Buffer;
const DATA={"markdown":"# 合成消息正文\n\n正文和长词正文和长词正文和长词正文和长词正文和长词正文和长词正文和长词正文和长词正文和长词正文和长词正文和长词正文和长词\n\nhttps://link.invalid/segmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegment\n\n| 标题 | 描述 |\n| --- | --- |\n| 合成 | table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell- |\n\n```javascript\nconst greeting = \"合成完整代码\";\nconsole.log(greeting);\nlong_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_;\n```\n","code":"const greeting = \"合成完整代码\";\nconsole.log(greeting);\nlong_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_;\n","longWord":"SYNTHETIC_WORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORD","runId":"synthetic-run","projectId":"synthetic-project","approval":{"schemaId":"skill-approval-state-v1","status":"pending","stepId":"plan-film","nextStepId":"generate-film","outputSchemaId":"brief-to-video-plan-v1","planChecksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","revision":3,"generation":1,"allowRevision":true},"videoPlan":{"schemaId":"brief-to-video-plan-v1","title":"合成脚本 长标题长标题长标题长标题长标题长标题长标题长标题长标题长标题长标题长标题","logline":"合成故事摘要 SYNTHETIC_WORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORD","durationSeconds":15,"aspectRatio":"16:9","scenes":[{"order":1,"timeRange":"0-15s","visual":"合成画面 SYNTHETIC_WORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORD","camera":"缓慢推进","action":"展示合成产品","textOverlay":"合成字幕"}],"finalVideoPrompt":"合成验收脚本，没有模型执行","negativePrompt":"无","factualConstraints":["不得替换合成品牌"]},"result":{"schemaId":"brief-to-video-result-v1","runId":"synthetic-run","planChecksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","videoAssetVersionId":"video-v","sourceAssetVersionIds":["source-v"],"providerId":"synthetic-provider","modelId":"synthetic-model","remoteTaskId":"synthetic-remote","durationSeconds":1,"aspectRatio":"16:9"},"exportResult":{"schemaVersion":1,"runId":"synthetic-run","outcome":"partial_success","imageAssetVersionIds":["image-v"],"manifestAssetVersionId":"manifest-v","zipAssetVersionId":"zip-v","failures":[{"sourceAssetVersionId":"source-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","code":"EXPORT_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX","retryable":true}]}};
const ENTRY="\nimport React,{useState} from 'react';\nimport {createRoot} from 'react-dom/client';\nimport ChatArea from '@/components/simple-chat/chat-area';\nimport {MarkdownRenderer} from '@/components/simple-chat/markdown-renderer';\nimport {ImageLightbox} from '@/components/simple-chat/image-lightbox';\nimport {AgentProgressTimeline} from '@/components/agent-runtime/AgentProgressTimeline';\nimport {BriefToVideoCard} from '@/components/simple-chat/brief-to-video-card';\nimport {MultiPlatformExportCard} from '@/components/simple-chat/multi-platform-export-card';\nimport {BriefToVideoApprovalCard} from '@/components/skill-runtime/BriefToVideoApprovalCard';\nimport {BriefToVideoResultCard} from '@/components/skill-runtime/BriefToVideoResultCard';\nimport {Providers} from '@/app/simple-chat/providers';\nimport {Toaster} from 'sonner';\nimport type {SimpleChatProject,SimpleChatTask} from '@/components/simple-chat/simple-chat-types';\nimport type {AgentRunProjection,AgentRunStatus} from '@/lib/agent-runtime/types';\nconst DATA={\"markdown\":\"# 合成消息正文\\n\\n正文和长词正文和长词正文和长词正文和长词正文和长词正文和长词正文和长词正文和长词正文和长词正文和长词正文和长词正文和长词\\n\\nhttps://link.invalid/segmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegmentsegment\\n\\n| 标题 | 描述 |\\n| --- | --- |\\n| 合成 | table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell-table-cell- |\\n\\n```javascript\\nconst greeting = \\\"合成完整代码\\\";\\nconsole.log(greeting);\\nlong_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_;\\n```\\n\",\"code\":\"const greeting = \\\"合成完整代码\\\";\\nconsole.log(greeting);\\nlong_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_long_identifier_;\\n\",\"longWord\":\"SYNTHETIC_WORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORD\",\"runId\":\"synthetic-run\",\"projectId\":\"synthetic-project\",\"approval\":{\"schemaId\":\"skill-approval-state-v1\",\"status\":\"pending\",\"stepId\":\"plan-film\",\"nextStepId\":\"generate-film\",\"outputSchemaId\":\"brief-to-video-plan-v1\",\"planChecksum\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"revision\":3,\"generation\":1,\"allowRevision\":true},\"videoPlan\":{\"schemaId\":\"brief-to-video-plan-v1\",\"title\":\"合成脚本 长标题长标题长标题长标题长标题长标题长标题长标题长标题长标题长标题长标题\",\"logline\":\"合成故事摘要 SYNTHETIC_WORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORD\",\"durationSeconds\":15,\"aspectRatio\":\"16:9\",\"scenes\":[{\"order\":1,\"timeRange\":\"0-15s\",\"visual\":\"合成画面 SYNTHETIC_WORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORDWORD\",\"camera\":\"缓慢推进\",\"action\":\"展示合成产品\",\"textOverlay\":\"合成字幕\"}],\"finalVideoPrompt\":\"合成验收脚本，没有模型执行\",\"negativePrompt\":\"无\",\"factualConstraints\":[\"不得替换合成品牌\"]},\"result\":{\"schemaId\":\"brief-to-video-result-v1\",\"runId\":\"synthetic-run\",\"planChecksum\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"videoAssetVersionId\":\"video-v\",\"sourceAssetVersionIds\":[\"source-v\"],\"providerId\":\"synthetic-provider\",\"modelId\":\"synthetic-model\",\"remoteTaskId\":\"synthetic-remote\",\"durationSeconds\":1,\"aspectRatio\":\"16:9\"},\"exportResult\":{\"schemaVersion\":1,\"runId\":\"synthetic-run\",\"outcome\":\"partial_success\",\"imageAssetVersionIds\":[\"image-v\"],\"manifestAssetVersionId\":\"manifest-v\",\"zipAssetVersionId\":\"zip-v\",\"failures\":[{\"sourceAssetVersionId\":\"source-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\",\"code\":\"EXPORT_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\",\"retryable\":true}]}};\n\nconst images=['/fixture/image-a.png','/fixture/image-b.png'];\nconst seed:SimpleChatProject={id:'chat-project',name:'合成消息项目',createdAt:1,updatedAt:1,agents:[],knowledgeItems:[],tasks:[{id:'chat-task',projectId:'chat-project',name:'合成任务',messages:[{id:'user-long',role:'user',content:DATA.longWord,createdAt:1},{id:'answer-rich',role:'assistant',content:DATA.markdown,images,createdAt:2},{id:'answer-failed',role:'assistant',content:'合成失败正文 '+DATA.longWord,status:'failed',error:{message:DATA.longWord,retryable:false},createdAt:3}],model:'',providerId:'',createdAt:1,updatedAt:1}]};\nconst user={id:'synthetic-mobile-user',name:'仅本地界面合成用户',role:'user' as const,status:'active' as const,productType:'chat' as const,createdAt:1,updatedAt:1};\nconst state={disposed:false,closed:0,approvals:[] as unknown[],returned:[] as unknown[],cancelCalls:0};\nconst root=createRoot(document.getElementById('fixture-root')!);let mounted=false;\nfunction Entry({options}:{options:{surface:string;variant?:string;status?:AgentRunStatus;zero?:boolean;initialIndex?:number}}){\n const [project,setProject]=useState(()=>options.variant==='active-agent'?{...seed,agents:[{id:'synthetic-agent',name:'合成活动Agent '+DATA.longWord,description:'本地界面验收',systemPrompt:'只用于合成UI，不调用模型',tools:[],createdAt:1,updatedAt:1}],tasks:seed.tasks.map(task=>({...task,activeAgentId:'synthetic-agent'}))}:seed),[open,setOpen]=useState(options.surface!=='lightbox');const unavailable=()=>{throw Error('SC_UI_FIXTURE_UNEXPECTED_WRITE');};\n const close=()=>{state.closed++;setOpen(false);};\n const projection:AgentRunProjection={runId:DATA.runId,status:options.status??'executing',lastSequence:2,plan:[{id:'long-step',label:'合成步骤 '+DATA.longWord,status:'running'}],assetVersionIds:[],ignoredEventIds:[],missingSequences:[],qualityChecks:[],...(['failed','cancelled','timeout'].includes(options.status??'')?{error:{code:'SYNTHETIC_ERROR_'+('X'.repeat(44)),message:'合成错误 '+DATA.longWord,retryable:options.status==='failed'}}:{})};\n const cancel=async()=>{state.cancelCalls++;const response=await fetch('/fixture/cancel',{method:'DELETE'});if(!response.ok)throw Error('合成取消失败，请重试');await response.json();};\n const approve=async(action:string,value?:unknown,instruction?:string)=>{state.approvals.push({action,value,instruction});if(options.variant==='operation-error')throw Error('合成审批操作失败');return false;};\n return <div id=\"fixture-surface\" className={options.surface==='messages'?'h-full w-full min-w-0':'h-full w-full min-w-0 overflow-y-auto overscroll-contain bg-background p-3 text-foreground sm:p-5'}>\n {options.surface==='messages'?<ChatArea user={user} project={project} task={project.tasks[0]} onUpdateTask={(task:SimpleChatTask)=>setProject(p=>({...p,tasks:p.tasks.map(t=>t.id===task.id?task:t)}))} onPersistTask={async()=>{unavailable();}} onUpdateProject={setProject} onCreateTask={unavailable} onSelectTask={unavailable} onUpdateAgent={unavailable} onDeleteAgent={unavailable} onSkillToAgent={unavailable} onLogout={unavailable} onBackToWorkspace={unavailable} sidebarOpen={false} onToggleSidebar={unavailable}/>:options.surface==='markdown'?<MarkdownRenderer content={DATA.markdown}/>:options.surface==='lightbox'?<><button className=\"min-h-11 min-w-11 rounded-lg border border-border px-3\" onClick={()=>setOpen(true)}>打开图片预览</button>{open&&<ImageLightbox images={options.zero?[]:images} initialIndex={options.initialIndex??0} onClose={close}/>}</>:options.surface==='timeline'?<AgentProgressTimeline projection={projection} onCancel={cancel}/>:options.surface==='brief'?<BriefToVideoCard runId={DATA.runId} projectId={DATA.projectId} onReturnToCanvas={refs=>{state.returned.push(refs);}}/>:options.surface==='multi'?<MultiPlatformExportCard runId={DATA.runId} projectId={DATA.projectId} onReturnToCanvas={refs=>{state.returned.push(refs);}}/>:options.surface==='approval'?<BriefToVideoApprovalCard runId={DATA.runId} projectId={DATA.projectId} onApprove={v=>approve('approve',v)} onRevise={(v,t)=>approve('revise',v,t)} onCancel={()=>approve('cancel')}/>:<BriefToVideoResultCard runId={DATA.runId} projectId={DATA.projectId} authority={options.variant==='authority-pending'?'pending':'legacy'}/>}<Toaster/>\n </div>;\n}\nfunction Launch({options}:{options:{surface:string}}){const [active,setActive]=useState(false);return active?<Entry options={options}/>:<button className=\"min-h-11 min-w-11\" onClick={()=>setActive(true)}>进入隔离验收界面</button>;}\nObject.assign(window,{scUi:{state,mount(theme:'gold'|'mono',options:{surface:string}){if(mounted||state.disposed)throw Error('SC_UI_FIXTURE_REMOUNT');mounted=true;localStorage.setItem('simple-chat-theme',theme==='mono'?'light':'dark');root.render(<Providers><Launch options={options}/></Providers>);},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}}}});\n";
let browser:Browser|undefined;let bundle='',css='';
const live=new Set<Session>(),contexts=new Set<BrowserContext>();
beforeAll(async () => {
  // Same native loader and exact installed Next/ag-psd browser boundaries as the
  // reviewed additional-tools-b aspect host. No component or hook replacements.
  if (typeof process.getBuiltinModule !== 'function') throw Error('SC_UI_FIXTURE_NATIVE_LOADER_REQUIRED');
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
        contents: "export { default as process } from 'next/dist/compiled/process'; export { Buffer } from 'next/dist/compiled/buffer';", loader: 'js', resolveDir: process.cwd(),
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
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'simple-chat-messages-results-mobile-entry.tsx' },
  });
  if (result.outputFiles.length !== 1) throw Error('SC_UI_FIXTURE_MEMORY_BUNDLE_REQUIRED');
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
  const sharp=require('sharp') as typeof import('sharp').default;
  pngA=await sharp({create:{width:800,height:450,channels:4,background:'#d4af37'}}).png().toBuffer();
  pngB=await sharp({create:{width:450,height:800,channels:4,background:'#234888'}}).png().toBuffer();
  videoBytes=await readOwnedOneSecondVideo();
  const JSZip=require('jszip') as typeof import('jszip');zipBytes=await new JSZip().file('synthetic.txt','synthetic export').generateAsync({type:'nodebuffer'});
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
  try { await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('SC_UI_FIXTURE_CLEANUP_TIMEOUT ' + name)), 2500); })]); }
  finally { if (timer) clearTimeout(timer); }
}

async function target(control: Locator): Promise<void> {
  const value = await control.evaluate(e => { const r = e.getBoundingClientRect(); let clear = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    for (let p = e.parentElement; p; p = p.parentElement) { const b = p.getBoundingClientRect(), s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && (r.left < b.left + p.clientLeft - 0.5 || r.right > b.left + p.clientLeft + p.clientWidth + 0.5)) clear = false; if (/(auto|scroll|hidden|clip)/.test(s.overflowY) && (r.top < b.top + p.clientTop - 0.5 || r.bottom > b.top + p.clientTop + p.clientHeight + 0.5)) clear = false; }
    const x = r.x + r.width / 2, y = r.y + r.height / 2; return { width: r.width, height: r.height, clear, hit: [[x,y],[r.left+8,y],[r.right-8,y],[x,r.top+8],[x,r.bottom-8]].every(([a,b]) => e.contains(document.elementFromPoint(a,b))) }; });
  if(!value.clear)console.log('Q_TARGET_CLEAR_DIAGNOSTIC',JSON.stringify({value,geometry:await control.evaluate(e=>{const r=e.getBoundingClientRect();const rows:unknown[]=[];for(let p=e.parentElement;p;p=p.parentElement){const b=p.getBoundingClientRect(),s=getComputedStyle(p);if(/auto|scroll|hidden|clip/.test(s.overflowY))rows.push({tag:p.tagName,top:b.top+p.clientTop,bottom:b.top+p.clientTop+p.clientHeight});}return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,viewport:[innerWidth,innerHeight],rows};})}));
  expect(value.width, 'target width').toBeGreaterThanOrEqual(44); expect(value.height, 'target height').toBeGreaterThanOrEqual(44); expect(value.clear, 'whole target visible').toBe(true); expect(value.hit, 'native hit').toBe(true);
}

async function textContrast(control: Locator, placeholder = false): Promise<number> {
  return control.evaluate((element, isPlaceholder) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw Error('SC_UI_FIXTURE_CONTRAST_CANVAS');
    type Rgba = [number, number, number, number]; type Rgb = [number, number, number];
    const rgba = (value: string): Rgba => {
      if (!CSS.supports('color', value) || /^(?:none|currentcolor|inherit|initial|unset|revert|url\()/i.test(value)) throw Error('SC_UI_FIXTURE_CONTRAST_COLOR');
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
    };
    const blend = (front: Rgba, back: Rgb): Rgb => [0, 1, 2].map(i => front[i] * front[3] + back[i] * (1 - front[3])) as Rgb;
    const luminance = (rgb: Rgb): number => rgb.map(v => { const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: Rgb, b: Rgb): number => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    if (ratio([255, 255, 255], [255, 255, 255]) !== 1 || Math.abs(ratio([0, 0, 0], [255, 255, 255]) - 21) > 0.000001) throw Error('SC_UI_FIXTURE_CONTRAST_CANARY');
    const layers: Rgba[] = []; let opaque = false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (Number(style.opacity) !== 1 || style.filter !== 'none' || style.mixBlendMode !== 'normal' || style.backgroundImage !== 'none') throw Error('SC_UI_FIXTURE_CONTRAST_UNSUPPORTED_BACKDROP');
      const color = rgba(style.backgroundColor); layers.push(color); if (color[3] === 1) { opaque = true; break; }
    }
    if (!opaque) throw Error('SC_UI_FIXTURE_CONTRAST_BACKDROP_REQUIRED');
    let backdrop: Rgb = [255, 255, 255]; for (const layer of layers.reverse()) backdrop = blend(layer, backdrop);
    const own = getComputedStyle(element); if (own.filter !== 'none' || own.mixBlendMode !== 'normal' || own.backgroundImage !== 'none') throw Error('SC_UI_FIXTURE_CONTRAST_UNSUPPORTED_CONTROL');
    const background = blend(rgba(own.backgroundColor), backdrop), ownOpacity = Number(own.opacity);
    const text = isPlaceholder ? getComputedStyle(element, '::placeholder') : own;
    const paint = rgba(text.color); if (isPlaceholder) paint[3] *= Number(text.opacity);
    return ratio(blend([...blend(paint, background), ownOpacity], backdrop), blend([...background, ownOpacity], backdrop));
  }, placeholder);
}



function gate():Gate{let release=():void=>{};const wait=new Promise<void>(r=>{release=r;});return{wait,release};}
const keyOf=(r:Request):string=>r.method()+' '+new URL(r.url()).pathname+new URL(r.url()).search;
function readPlan(o:Options):Map<string,{min:number;max:number}>{
 const reads=new Map<string,{min:number;max:number}>([['GET /',{min:1,max:1}]]),add=(key:string,min=1,max=min)=>reads.set(key,{min,max});
 if(o.surface==='messages'){for(const key of ['GET /api/models?type=chat','GET /api/models?type=image','GET /api/user-data/sync?key=projects','GET /api/simple-chat/memory'])add(key,1,2);for(const key of ['GET /fixture/image-a.png','GET /fixture/image-b.png'])add(key,1,1);}
 if(o.surface==='lightbox'){add('GET /fixture/image-a.png',!o.zero&&o.initialIndex===undefined?1:0,2);add('GET /fixture/image-b.png',0,2);}
 if(o.surface==='brief'||o.surface==='multi'){const refresh=(o.ops??[]).includes('cancel')&&!o.operationError&&o.variant!=='operation-error'?1:0;add('GET /api/agent-runs/synthetic-run/events?after=0',1+refresh);if(o.surface==='multi')add('GET /api/skill-runs/synthetic-run',(o.variant==='paused'?2:1)+refresh);}
 if(o.surface==='approval'||o.surface==='result'||o.surface==='brief'&&o.variant!=='paused'){
   const count=1+((o.ops??[]).includes('return-brief')?1:0);add('GET /api/skill-runs/synthetic-run?observeOnly=true',count,count);
 }
 if((o.surface==='result'||o.surface==='brief'&&o.variant!=='paused')&&!['not-ready','authority-pending','load-error'].includes(o.variant??'')){
  const count=1+((o.ops??[]).includes('return-brief')?1:0);add('GET /api/assets?projectId=synthetic-project&assetVersionId=video-v',count,count);if(o.variant!=='wrong-asset')add('GET /fixture/film.mp4',1,4);
 }
 for(const op of o.ops??[]){if(op==='download-zip'){add('GET /api/assets?projectId=synthetic-project&assetVersionId=zip-v');add('GET /fixture/export.zip');}if(op==='download-manifest'){add('GET /api/assets?projectId=synthetic-project&assetVersionId=manifest-v');add('GET /fixture/manifest.json');}if(op==='return-multi')add('GET /api/assets?projectId=synthetic-project&assetVersionId=image-v');}
 return reads;
}
function consume(s:Session,op:string):void{const index=(s.options.ops??[]).findIndex((x,i)=>x===op&&!s.consumed.has(i));if(index<0)throw Error('SC_UI_FIXTURE_UNPROMISED_OPERATION '+op);s.consumed.add(index);for(const n of s.nativeWaiters)n();}
async function hold(s:Session):Promise<void>{if(s.options.variant==='hold'||s.options.holdOps){const g=gate();s.gates.push(g);await g.wait;}}
function runPayload(s:Session):Record<string,unknown>{
 if(s.options.surface==='approval')return{run:{runId:DATA.runId,projectId:DATA.projectId,status:'paused',approval:DATA.approval,steps:[{id:'plan-film',cost:5},{id:'generate-film',cost:120}],outputs:[{stepId:'plan-film',kind:'json',schemaId:'brief-to-video-plan-v1',content:JSON.stringify(DATA.videoPlan)}]}};
 if(s.options.surface==='multi')return{run:{runId:DATA.runId,status:s.options.variant==='paused'?'paused':'completed',outputs:s.options.variant==='paused'?[]:[{stepId:'export',kind:'json',schemaId:'multi-platform-export-result-v1',content:JSON.stringify(DATA.exportResult)}]}};
 return{run:{runId:DATA.runId,status:s.options.variant==='not-ready'?'executing':'completed',assetVersionIds:['video-v'],outputs:[{stepId:'film',kind:'json',schemaId:'brief-to-video-result-v1',content:JSON.stringify(DATA.result)}]}};
}
function runEvents(s:Session):unknown[]{const cancelled=s.consumed.size>0&&!s.options.operationError&&s.options.variant!=='operation-error';const type=cancelled?'run.cancelled':s.options.variant==='paused'?'run.paused':'run.completed';return[{eventId:'created',runId:DATA.runId,sequence:1,type:'run.created',timestamp:'2026-10-19T00:00:00Z',payload:{}},{eventId:'plan',runId:DATA.runId,sequence:2,type:'plan.updated',timestamp:'2026-10-19T00:00:01Z',payload:{plan:[{id:'long-step',label:'合成步骤 '+DATA.longWord,status:'running'}]}},{eventId:'terminal',runId:DATA.runId,sequence:3,type,timestamp:'2026-10-19T00:00:02Z',payload:type==='run.completed'&&s.options.surface==='multi'?{result:{outputs:[{stepId:'export',kind:'json',schemaId:'multi-platform-export-result-v1',content:JSON.stringify(DATA.exportResult)}]}}:type==='run.paused'?{error:{code:'SYNTHETIC_PAUSED',message:'合成暂停 '+DATA.longWord,retryable:false}}:{}}];}
async function waitCompletedKey(s:Session,key:string):Promise<void>{let n:(()=>void)|undefined;try{await bounded('specific native request',()=>new Promise<void>(resolve=>{n=()=>{if([...s.completed].some(r=>keyOf(r)===key))resolve();};s.nativeWaiters.add(n);n();}));}finally{if(n)s.nativeWaiters.delete(n);}}
async function session(theme:Theme='gold',width=390,height=844,options:Options={surface:'markdown'}):Promise<Session>{
 if(!browser)throw Error('SC_UI_FIXTURE_BROWSER_REQUIRED');const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',reducedMotion:'reduce',hasTouch:width<768,isMobile:width<768});contexts.add(context);let value:Session|undefined;
 try{const page=await context.newPage();page.setDefaultTimeout(1500);const s:Session={context,page,options,errors:[],counts:new Map(),handlers:new Set(),pending:new Set(),completed:new Set(),failed:new Set(),refused:new Set(),plannedFailed:new Set(),nativeWaiters:new Set(),gates:[],mounted:false,consumed:new Set(),bodies:[],reads:readPlan(options)};value=s;live.add(s);
 context.on('request',r=>s.pending.add(r));context.on('requestfinished',r=>{s.pending.delete(r);s.completed.add(r);for(const n of s.nativeWaiters)n();});context.on('requestfailed',r=>{s.pending.delete(r);s.failed.add(r);for(const n of s.nativeWaiters)n();});page.on('pageerror',e=>s.errors.push(String(e)));page.on('dialog',d=>{s.errors.push('SC_UI_FIXTURE_UNEXPECTED_DIALOG');void d.dismiss();});
 await context.routeWebSocket('**/*',socket=>{s.errors.push('SC_UI_FIXTURE_UNKNOWN_WS');socket.close({code:1008,reason:'Offline fixture'});});
 await context.route('**/*',async route=>{const operation=(async():Promise<void>=>{const r=route.request(),u=new URL(r.url()),h=r.headers(),key=keyOf(r);if(u.origin!==ORIGIN||u.username||u.password||h.authorization||h.cookie||h['x-api-key']||h['api-key']||h['idempotency-key'])throw Error('SC_UI_FIXTURE_HTTP_BOUNDARY');const count=(s.counts.get(key)??0)+1;s.counts.set(key,count);
 if(r.method()==='GET'&&r.postData()===null){const allowed=s.reads.get(key);if(!allowed||count>allowed.max)throw Error('SC_UI_FIXTURE_UNKNOWN_HTTP '+key);
 if(key==='GET /'&&r.isNavigationRequest()){await route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body style="margin:0;width:100vw;height:100dvh;overflow:hidden"><div id="fixture-root" style="height:100%;width:100%"></div></body></html>'});return;}
 if(key==='GET /api/models?type=chat'){await route.fulfill({json:{success:true,models:[{id:'synthetic-model',name:'合成模型',providerId:'synthetic-provider'}],providers:[{id:'synthetic-provider',name:'合成供应商'}]}});return;}
 if(key==='GET /api/models?type=image'){await route.fulfill({json:{success:true,models:[],providers:[]}});return;}
 if(key==='GET /api/user-data/sync?key=projects'){await route.fulfill({json:{success:true,key:'projects',value:[]}});return;}
 if(key==='GET /api/simple-chat/memory'){await route.fulfill({json:{memories:[]}});return;}
 if(u.pathname==='/fixture/image-a.png'||u.pathname==='/fixture/image-b.png'){if(r.resourceType()==='fetch'){consume(s,'download-image');await hold(s);if(options.operationError||options.variant==='operation-error'){await route.fulfill({status:503,contentType:'text/plain',body:'synthetic unavailable'});return;}}await route.fulfill({contentType:'image/png',body:u.pathname.endsWith('a.png')?pngA:pngB});return;}
 if(key==='GET /api/agent-runs/synthetic-run/events?after=0'){if(options.surface==='multi')await waitCompletedKey(s,'GET /api/skill-runs/synthetic-run');await route.fulfill({json:{events:runEvents(s)}});return;}
 if(u.pathname==='/api/skill-runs/synthetic-run'){if(options.variant==='load-error'){await route.fulfill({status:503,json:{error:'synthetic unavailable'}});return;}if(count>1&&options.surface==='brief')consume(s,'return-brief');await route.fulfill({json:runPayload(s)});return;}
 if(u.pathname==='/api/assets'){const id=u.searchParams.get('assetVersionId');if(id==='zip-v')consume(s,'download-zip');else if(id==='manifest-v')consume(s,'download-manifest');else if(id==='image-v')consume(s,'return-multi');else if(id!=='video-v')throw Error('SC_UI_FIXTURE_UNKNOWN_ASSET');const ref=id==='video-v'?{assetId:'asset-video',assetVersionId:options.variant==='wrong-asset'?'wrong-version':'video-v',kind:'video',url:'/fixture/film.mp4'}:id==='image-v'?{assetId:'asset-image',assetVersionId:'image-v',kind:'image',url:'/fixture/image-a.png'}:{assetId:'asset-'+id,assetVersionId:id,kind:'document',name:id==='zip-v'?'synthetic-export.zip':'synthetic-manifest.json',url:id==='zip-v'?'/fixture/export.zip':'/fixture/manifest.json'};await hold(s);await route.fulfill({json:ref});return;}
 if(u.pathname==='/fixture/export.zip'){await route.fulfill({contentType:'application/zip',body:zipBytes});return;}
 if(u.pathname==='/fixture/manifest.json'){await route.fulfill({contentType:'application/json',body:'{"synthetic":true}\n'});return;}
 if(u.pathname==='/fixture/film.mp4'){console.log('Q_VIDEO_REQUEST',JSON.stringify({method:r.method(),type:r.resourceType(),navigation:r.isNavigationRequest(),headers:r.headers()}));const range=h.range?.match(/^bytes=(\d+)-(\d*)$/);if(h.range&&!range)throw Error('SC_UI_FIXTURE_MEDIA_RANGE');const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),videoBytes.length-1):videoBytes.length-1;if(start>end)throw Error('SC_UI_FIXTURE_MEDIA_RANGE');await route.fulfill({status:range?206:200,contentType:'video/mp4',headers:{'accept-ranges':'bytes',...(range?{'content-range':'bytes '+start+'-'+end+'/'+videoBytes.length}:{})},body:videoBytes.subarray(start,end+1)});return;}
 }
 if((r.method()==='DELETE'&&(u.pathname==='/fixture/cancel'||u.pathname==='/api/agent-runs/synthetic-run')||r.method()==='PATCH'&&u.pathname==='/api/skill-runs/synthetic-run')&&!u.search){consume(s,'cancel');const expectedPath=options.surface==='timeline'?'/fixture/cancel':options.surface==='brief'?'/api/skill-runs/synthetic-run':'/api/agent-runs/synthetic-run';if(u.pathname!==expectedPath||r.method()!==(options.surface==='brief'?'PATCH':'DELETE'))throw Error('SC_UI_FIXTURE_CANCEL_IDENTITY');if(r.method()==='PATCH'&&r.postData()!==JSON.stringify({action:'cancel'}))throw Error('SC_UI_FIXTURE_CANCEL_BODY');if(r.method()==='DELETE'&&r.postData()!==null)throw Error('SC_UI_FIXTURE_CANCEL_BODY');s.bodies.push({path:u.pathname,body:r.postData()});await hold(s);if(options.operationError||options.variant==='operation-error'){await route.fulfill({status:403,json:{error:'synthetic refusal'}});return;}await route.fulfill({json:options.surface==='brief'?{accepted:true}:{projection:{runId:DATA.runId,status:'cancelled',lastSequence:4,plan:[],assetVersionIds:[],ignoredEventIds:[],missingSequences:[],qualityChecks:[]}}});return;}
 throw Error('SC_UI_FIXTURE_UNKNOWN_HTTP '+key);
 })().catch(async e=>{console.log('Q_FIXTURE_ROUTE_DIAGNOSTIC',JSON.stringify({key:keyOf(route.request()),error:String(e)}));s.errors.push(String(e));s.refused.add(route.request());await route.abort('blockedbyclient');});s.handlers.add(operation);try{await operation;}finally{s.handlers.delete(operation);}});
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:ORIGIN});await page.addInitScript(({deny,hold})=>{let release=():void=>{};const wait=new Promise<void>(r=>{release=r;});const fixture={release,pending:0};Object.assign(window,{clipboardFixture:fixture});if(deny||hold){const original=navigator.clipboard.writeText.bind(navigator.clipboard);Object.defineProperty(navigator.clipboard,'writeText',{value:async(text:string)=>{fixture.pending++;try{if(hold)await wait;if(deny)throw new DOMException('合成剪贴板拒绝','NotAllowedError');await original(text);}finally{fixture.pending--;}}});}},{deny:!!options.clipboardDenied,hold:!!options.clipboardHold});
 await page.goto(ORIGIN);await page.addScriptTag({content:bundle});await page.evaluate(({theme,options})=>(window as unknown as FixtureWindow).scUi.mount(theme,options),{theme,options});s.mounted=true;await page.waitForFunction(t=>document.documentElement.getAttribute('data-theme')===(t==='mono'?'light':'dark'),theme,{timeout:1500});await page.getByRole('button',{name:'进入隔离验收界面',exact:true}).click();
 if(options.surface==='messages'){await page.getByPlaceholder(options.variant==='active-agent'?'与 合成活动Agent '+DATA.longWord+' 对话...':'输入消息，Enter 发送，支持 Ctrl+V 粘贴图片',{exact:true}).waitFor();await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('[data-chat-message-id] img')].length===2&&[...document.querySelectorAll<HTMLImageElement>('[data-chat-message-id] img')].every(i=>i.complete&&i.naturalWidth>0));}
 else if(options.surface==='lightbox'){await page.getByRole('button',{name:'打开图片预览',exact:true}).click();if(!options.zero&&options.initialIndex===undefined)await page.waitForFunction(()=>[...document.images].some(i=>i.complete&&i.naturalWidth>0));}
 else if(options.surface==='approval'){if(options.variant==='load-error')await page.getByRole('alert').waitFor();else await page.getByRole('button',{name:'批准生成',exact:true}).waitFor();}
 else if(options.surface==='result'||options.surface==='brief'&&options.variant!=='paused'){if(['not-ready','authority-pending','load-error','wrong-asset'].includes(options.variant??''))await page.getByRole('alert').waitFor();else await page.getByRole('link',{name:'下载成片',exact:true}).waitFor();}
 else if(options.surface==='multi'||options.surface==='brief'){if(options.variant==='paused')await page.getByText('合成步骤 '+DATA.longWord,{exact:true}).waitFor();else await page.getByRole('button',{name:'下载 ZIP',exact:true}).waitFor();}
 await settle(page);await nativeRequestsFinished(s);return s;
 }catch(e){console.log('Q_FIXTURE_BOOT_DIAGNOSTIC',JSON.stringify({surface:options.surface,error:String(e),errors:value?.errors,counts:value?[...value.counts]:[],text:value?await value.page.locator('body').innerText().catch(()=>'<unavailable>'):'<no page>'}));try{if(value)await dispose(value);else{await context.close();contexts.delete(context);}}catch(cleanup){console.log('Q_FIXTURE_CLEANUP_DIAGNOSTIC',String(cleanup));throw new AggregateError([e,cleanup],'SC_UI_FIXTURE_BOOTSTRAP');}throw e;}
}

async function nativeRequestsFinished(s:Session):Promise<void>{let notify:(()=>void)|undefined;try{await bounded('native requests',()=>new Promise<void>(resolve=>{notify=()=>{if(!s.pending.size)resolve();};s.nativeWaiters.add(notify);notify();}));}finally{if(notify)s.nativeWaiters.delete(notify);}}
async function dispose(s:Session,refusal?:'http'|'websocket',cleanupProbe?:()=>void):Promise<void>{
 const failures:string[]=[];try{if(s.mounted)await bounded('unmount',()=>s.page.evaluate(()=>(window as unknown as FixtureWindow).scUi.unmount()));cleanupProbe?.();}catch(e){failures.push(String(e));}for(const g of s.gates)g.release();try{await bounded('clipboard drain',async()=>{await s.page.evaluate(()=>(window as unknown as FixtureWindow).clipboardFixture.release());await s.page.waitForFunction(()=>(window as unknown as FixtureWindow).clipboardFixture.pending===0,undefined,{timeout:1500});});}catch(e){failures.push(String(e));}
 try{await bounded('routes',()=>Promise.all([...s.handlers]));await nativeRequestsFinished(s);await bounded('final routes',()=>Promise.all([...s.handlers]));}catch(e){failures.push(String(e));}const unresolved=s.pending.size!==0||s.handlers.size!==0;
 try{await s.context.close();contexts.delete(s.context);live.delete(s);}catch(e){failures.push(String(e));}
 const contractFailures:string[]=[];const expectedOps=s.options.ops??[],allowedKeys=new Set(s.reads.keys());if(expectedOps.includes('cancel'))allowedKeys.add((s.options.surface==='brief'?'PATCH /api/skill-runs/synthetic-run':s.options.surface==='multi'?'DELETE /api/agent-runs/synthetic-run':'DELETE /fixture/cancel'));if(refusal==='http')allowedKeys.add('GET /unexpected');
 if(s.consumed.size!==expectedOps.length||[...s.counts].some(([k])=>!allowedKeys.has(k))||[...s.reads].some(([k,n])=>(s.counts.get(k)??0)<n.min||(s.counts.get(k)??0)>n.max))contractFailures.push('SC_UI_FIXTURE_REQUEST_VALIDATION');
 const expectedFailed=new Set<Request>();if(refusal==='http'){if(s.refused.size!==1||keyOf([...s.refused][0])!=='GET /unexpected')contractFailures.push('SC_UI_FIXTURE_REFUSAL_CONTRACT');if(s.refused.size===1)expectedFailed.add([...s.refused][0]);}else if(s.refused.size)contractFailures.push('SC_UI_FIXTURE_UNEXPECTED_REFUSAL');
 const completedByKey=new Map<string,number>();for(const r of s.completed)completedByKey.set(keyOf(r),(completedByKey.get(keyOf(r))??0)+1);const failedByKey=new Map<string,number>();for(const r of expectedFailed)failedByKey.set(keyOf(r),(failedByKey.get(keyOf(r))??0)+1);
 if(unresolved||s.failed.size!==expectedFailed.size||[...s.failed].some(r=>!expectedFailed.has(r))||[...s.counts].some(([k,n])=>(completedByKey.get(k)??0)+(failedByKey.get(k)??0)!==n))contractFailures.push('SC_UI_FIXTURE_NATIVE_REQUEST_FAILURE');
 if(failures.length)contractFailures.push('SC_UI_FIXTURE_CLEANUP_FAILURE: '+failures.join('; '));if(refusal){const expected=refusal==='http'?'Error: SC_UI_FIXTURE_UNKNOWN_HTTP GET /unexpected':'SC_UI_FIXTURE_UNKNOWN_WS';if(s.errors.length!==1||s.errors[0]!==expected)contractFailures.push('SC_UI_FIXTURE_UNEXPECTED_FAILURES: '+s.errors.join('; '));}if(s.errors.length)contractFailures.push('SC_UI_FIXTURE_INFRASTRUCTURE: '+s.errors.join('; '));if(contractFailures.length)throw new AggregateError(contractFailures.map(x=>Error(x)),contractFailures.join('\n'));
}
async function withSession(theme:Theme,width:number,height:number,options:Options,run:(s:Session)=>Promise<void>):Promise<void>{const s=await session(theme,width,height,options);let primary:unknown;try{await run(s);}catch(e){primary=e;}try{await dispose(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'SC_UI_FIXTURE_TEST_AND_CLEANUP');throw cleanup;}if(primary)throw primary;}
async function capture(s:Session,name:string):Promise<void>{const directory=path.resolve('output/playwright/simple-chat-messages-results-native-20261019',String(process.pid));await mkdir(directory,{recursive:true});const file=path.join(directory,name+'.png');await s.page.screenshot({path:file});console.log('SC_UI_NATIVE_CAPTURE',JSON.stringify({path:file,physicalAndroid:false,coze:false}));}
async function panelBounds(panel:Locator):Promise<void>{const r=await panel.evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,leak:e.scrollWidth-e.clientWidth};});console.log('SC_UI_PANEL_BOUNDS',JSON.stringify(r));expect(r.left,'panel left inside viewport').toBeGreaterThanOrEqual(0);expect(r.top,'panel top inside viewport').toBeGreaterThanOrEqual(0);expect(r.right,'panel right inside viewport').toBeLessThanOrEqual(r.w);expect(r.bottom,'panel bottom inside viewport').toBeLessThanOrEqual(r.h);expect(r.leak,'panel has no horizontal leak').toBeLessThanOrEqual(1);}
async function reveal(s:Session,control:Locator):Promise<void>{
  const trace:unknown[]=[];
  for(let i=0;i<12;i++){
    const g=await control.evaluate(e=>{const r=e.getBoundingClientRect();let top=0,bottom=innerHeight;const candidates:HTMLElement[]=[];for(let p=e.parentElement;p;p=p.parentElement){const b=p.getBoundingClientRect(),st=getComputedStyle(p);if(/auto|scroll|hidden|clip/.test(st.overflowY)){top=Math.max(top,b.top+p.clientTop);bottom=Math.min(bottom,b.top+p.clientTop+p.clientHeight);}if(/auto|scroll/.test(st.overflowY)&&p.scrollHeight>p.clientHeight)candidates.push(p);}let scroll:{x:number;y:number;width:number;height:number}|null=null;for(const candidate of candidates){const b=candidate.getBoundingClientRect();let left=Math.max(0,b.left+candidate.clientLeft),right=Math.min(innerWidth,b.left+candidate.clientLeft+candidate.clientWidth),visibleTop=Math.max(0,b.top+candidate.clientTop),visibleBottom=Math.min(innerHeight,b.top+candidate.clientTop+candidate.clientHeight);for(let p=candidate.parentElement;p;p=p.parentElement){const b=p.getBoundingClientRect(),st=getComputedStyle(p);if(/auto|scroll|hidden|clip/.test(st.overflowY)){visibleTop=Math.max(visibleTop,b.top+p.clientTop);visibleBottom=Math.min(visibleBottom,b.top+p.clientTop+p.clientHeight);}if(/auto|scroll|hidden|clip/.test(st.overflowX)){left=Math.max(left,b.left+p.clientLeft);right=Math.min(right,b.left+p.clientLeft+p.clientWidth);}}if(right>left&&visibleBottom>visibleTop){scroll={x:left,y:visibleTop,width:right-left,height:visibleBottom-visibleTop};break;}}return {top:r.top,bottom:r.bottom,clipTop:top,clipBottom:bottom,viewportHeight:innerHeight,scroll};});
    trace.push({iteration:i,...g});
    if(g.top>=0&&g.bottom<=g.viewportHeight&&g.top>=g.clipTop-0.5&&g.bottom<=g.clipBottom+0.5)return;
    if(!g.scroll)throw Error('SC_UI_FIXTURE_NO_SCROLL_SURFACE');
    await s.page.mouse.move(g.scroll.x+g.scroll.width/2,g.scroll.y+g.scroll.height/2);
    const gap=Math.max(0,Math.min(12,(g.clipBottom-g.clipTop-(g.bottom-g.top))/2));
    await s.page.mouse.wheel(0,g.top<g.clipTop?g.top-g.clipTop-gap:g.bottom-g.clipBottom+gap);await settle(s.page);
  }
  console.log('Q_SCROLL_DIAGNOSTIC',JSON.stringify({trace,control:await control.evaluate(e=>({text:e.textContent,title:e.getAttribute('title'),parents:(()=>{const rows:unknown[]=[];for(let p=e.parentElement;p;p=p.parentElement){const r=p.getBoundingClientRect(),s=getComputedStyle(p);rows.push({tag:p.tagName,cls:p.className,top:r.top,bottom:r.bottom,overflowY:s.overflowY,scrollTop:p.scrollTop,scrollHeight:p.scrollHeight,clientHeight:p.clientHeight});}return rows;})()}))}));
  throw Error('SC_UI_FIXTURE_NATIVE_SCROLL_DID_NOT_CONVERGE');
}
async function click(s:Session,control:Locator):Promise<void>{await reveal(s,control);expect(await control.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'native hit').toBe(true);await control.click();await settle(s.page);}



const frame=(s:Session):Locator=>s.page.locator('#fixture-surface');
const preview=(s:Session):Locator=>s.page.locator('[data-slot="dialog-content"],div.fixed.inset-0').filter({has:s.page.getByTitle('关闭 (Esc)',{exact:true})}).last();
const state=(s:Session)=>s.page.evaluate(()=>(window as unknown as FixtureWindow).scUi.state);
async function waitActions(s:Session):Promise<void>{await settle(s.page);await nativeRequestsFinished(s);await settle(s.page);}
async function expectNativeDownload(s:Session,control:Locator,expected:Buffer,name:string):Promise<void>{const promise=s.page.waitForEvent('download');if(s.options.surface==='result')console.log('Q_VIDEO_ANCHOR',await control.evaluate(e=>({tag:e.tagName,href:e.getAttribute('href'),download:e.getAttribute('download'),rect:e.getBoundingClientRect().toJSON()})));await click(s,control);if(s.options.surface==='result')console.log('Q_VIDEO_AFTER_CLICK',JSON.stringify({url:s.page.url(),errors:s.errors,counts:[...s.counts]}));const download=await promise;expect(await download.failure()).toBeNull();expect(download.suggestedFilename()).toBe(name);const stream=await download.createReadStream();if(!stream)throw Error('SC_UI_FIXTURE_DOWNLOAD_STREAM');const parts:Buffer[]=[];for await(const part of stream)parts.push(Buffer.from(part));expect(Buffer.concat(parts)).toEqual(expected);}

const SURFACES:Surface[]=['messages','markdown','lightbox','timeline','brief','multi','approval','result'];
describe('messages results fixture smoke',()=>{it.each(SURFACES)('%s uses real parser and drains exact native transport',async surface=>{await withSession('gold',390,844,{surface,status:'failed'},async s=>{expect(await frame(s).count()).toBe(1);});},25000);});
describe('messages results layout',()=>{
 it.each(SURFACES.flatMap(surface=>THEMES.flatMap(theme=>[[320,640],[390,844],[640,320],[1440,900]].map(([width,height])=>({surface,theme,width,height})))))('$surface $theme $width x $height preserves screen bounds and operable controls',async({surface,theme,width,height})=>{await withSession(theme,width,height,{surface,status:'failed'},async s=>{if(surface==='approval')await click(s,s.page.getByRole('button',{name:'修改脚本',exact:true}));await capture(s,surface+'-'+theme+'-'+width+'x'+height);const p=surface==='lightbox'?preview(s):frame(s);await panelBounds(p);if(surface==='messages'&&width<768){const bar=s.page.locator('[data-chat-message-id="user-long"]').getByTitle('编辑',{exact:true}).locator('..');expect(await bar.evaluate(e=>Number(getComputedStyle(e).opacity)),'message results mobile actions visible before pointer').toBe(1);}if(surface==='markdown'){const ratio=await textContrast(p.getByRole('button').first());console.log('Q_TEXT_CONTRAST',ratio);expect(ratio).toBeGreaterThanOrEqual(4.5);}const controls=await p.locator(surface==='messages'?'[data-chat-message-id] button':'button,a[download]').all();for(const b of controls){await reveal(s,b);if(surface==='messages')await v5RevealMessageHorizontal(s,b);await target(b);}if(surface==='approval')expect(await s.page.getByRole('textbox',{name:'脚本修改要求'}).evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),'message results input font').toBeGreaterThanOrEqual(16);if(surface==='messages'){const bar=s.page.locator('[data-chat-message-id="user-long"]').getByTitle('编辑',{exact:true}).locator('..');if(width<768)expect(await bar.evaluate(e=>Number(getComputedStyle(e).opacity)),'message results mobile actions visible without hover').toBe(1);}});},25000);
});
const STATUS_ROWS=[['created','正在排队'],['queued','正在排队'],['planning','正在规划'],['awaiting-confirmation','待确认'],['executing','正在执行'],['uploading','正在上传'],['paused','已暂停'],['completed','已完成'],['failed','执行失败'],['cancelled','已取消'],['timeout','执行超时']] as const;
describe('messages results status',()=>{it.each(STATUS_ROWS.flatMap(([status,label])=>THEMES.map(theme=>({status,label,theme}))))('$status $theme exposes actual state and separated readable error',async({status,label,theme})=>{await withSession(theme,390,844,{surface:'timeline',status},async s=>{expect(await frame(s).getByText(label,{exact:true}).count(),'message results status label').toBe(1);await panelBounds(frame(s));if(['failed','cancelled','timeout'].includes(status)){const rows=await frame(s).getByRole('alert').locator(':scope > span').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom};}));expect(rows).toHaveLength(3);expect(rows[1].top,'message results error rows separated').toBeGreaterThanOrEqual(rows[0].bottom);expect(rows[2].top,'message results error rows separated').toBeGreaterThanOrEqual(rows[1].bottom);}const terminal=['completed','failed','cancelled','timeout'].includes(status);expect(await frame(s).getByRole('button').count()).toBe(terminal?0:1);if(!terminal)await target(frame(s).getByRole('button'));});},25000);});
describe('messages results keyboard',()=>{it.each(THEMES)('%s lightbox protects focus then restores original trigger',async theme=>{await withSession(theme,390,844,{surface:'lightbox'},async s=>{const p=preview(s);expect(await p.getAttribute('role'),'message results lightbox dialog').toBe('dialog');expect(await p.evaluate(e=>e.contains(document.activeElement)),'message results focus inside').toBe(true);await s.page.keyboard.press('Shift+Tab');expect(await p.getByRole('button').last().evaluate(e=>e===document.activeElement),'message results focus last boundary').toBe(true);await s.page.keyboard.press('Tab');expect(await p.getByRole('button').first().evaluate(e=>e===document.activeElement),'message results focus first boundary').toBe(true);await s.page.keyboard.press('Escape');await settle(s.page);expect((await state(s)).closed).toBe(1);expect(await s.page.getByRole('button',{name:'打开图片预览'}).evaluate(e=>e===document.activeElement),'message results restored trigger').toBe(true);});},25000);});
describe('messages results picture bounds',()=>{
 it.each(THEMES)('%s empty images do not capture Escape',async theme=>{await withSession(theme,390,844,{surface:'lightbox',zero:true},async s=>{expect(await s.page.locator('img').count()).toBe(0);await s.page.keyboard.press('Escape');await settle(s.page);expect((await state(s)).closed,'message results empty image listener').toBe(0);});},25000);
 it.each(THEMES.flatMap(theme=>[[-1,'/fixture/image-a.png'],[999,'/fixture/image-b.png']].map(([initialIndex,want])=>({theme,initialIndex:Number(initialIndex),want}))))('$theme index $initialIndex has a valid visible picture',async({theme,initialIndex,want})=>{await withSession(theme,390,844,{surface:'lightbox',initialIndex},async s=>{expect(await s.page.locator('img').getAttribute('src'),'message results initial index clamped').toBe(want);});},25000);
});
describe('messages results copy ui',()=>{
 it.each(THEMES)('%s code copy refusal is visible and retry remains enabled',async theme=>{await withSession(theme,390,844,{surface:'markdown',clipboardDenied:true},async s=>{await click(s,frame(s).getByRole('button').first());expect(await frame(s).getByText('复制失败',{exact:true}).count(),'message results copy failure visible').toBe(1);expect(await frame(s).getByRole('button').first().isEnabled()).toBe(true);});},25000);
 it.each(THEMES)('%s code copy waits for actual clipboard acknowledgement',async theme=>{await withSession(theme,390,844,{surface:'markdown',clipboardHold:true},async s=>{const b=frame(s).getByRole('button').first();await click(s,b);expect(await b.isDisabled(),'message results copy pending disabled').toBe(true);const r=await b.boundingBox();if(!r)throw Error('SC_UI_FIXTURE_TARGET');await s.page.mouse.click(r.x+r.width/2,r.y+r.height/2);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).clipboardFixture.pending),'message results copy once').toBe(1);});},25000);
});
describe('messages results interactions',()=>{
 it.each(THEMES)('%s user message edit fits and cancel preserves original content',async theme=>{await withSession(theme,320,640,{surface:'messages'},async s=>{const message=s.page.locator('[data-chat-message-id="user-long"]');await click(s,message.getByTitle('编辑',{exact:true}));const input=message.getByRole('textbox');expect(await input.evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),'message results edit input font').toBeGreaterThanOrEqual(16);await panelBounds(frame(s));await input.fill('仅本地草稿，不触发生成');await click(s,message.getByRole('button',{name:'取消',exact:true}));expect(await message.innerText()).toContain(DATA.longWord);});},25000);
 it.each(THEMES)('%s copies complete code bytes via native clipboard', async theme => {
   await withSession(theme, 390, 844, { surface: 'markdown' }, async s => {
     await click(s, frame(s).getByRole('button').first());
     const copied = await s.page.evaluate(() => navigator.clipboard.readText());
     // The native clipboard can return CRLF on Windows.
     expect(copied.replaceAll('\r\n', '\n')).toBe(DATA.code.slice(0, -1));
   });
 }, 25000);
 it.each(THEMES)('%s lightbox keyboard navigation wraps and resets bounded zoom',async theme=>{await withSession(theme,390,844,{surface:'lightbox'},async s=>{await s.page.keyboard.press('ArrowRight');await settle(s.page);expect(await s.page.locator('img').getAttribute('src')).toBe('/fixture/image-b.png');await s.page.keyboard.press('ArrowRight');await settle(s.page);expect(await s.page.locator('img').getAttribute('src')).toBe('/fixture/image-a.png');for(let i=0;i<12;i++)await click(s,s.page.getByTitle('放大',{exact:true}));expect(await preview(s).getByText('400%',{exact:true}).count()).toBe(1);await s.page.keyboard.press('ArrowLeft');await settle(s.page);expect(await preview(s).getByText('100%',{exact:true}).count()).toBe(1);});},25000);
 it.each(THEMES)('%s copies the selected original image URL',async theme=>{await withSession(theme,390,844,{surface:'lightbox'},async s=>{await click(s,s.page.getByTitle('复制链接',{exact:true}));expect(await s.page.evaluate(()=>navigator.clipboard.readText())).toBe('/fixture/image-a.png');});},25000);
 it.each(THEMES)('%s downloads the exact original PNG bytes',async theme=>{await withSession(theme,390,844,{surface:'lightbox',ops:['download-image']},async s=>{await expectNativeDownload(s,s.page.getByTitle('下载',{exact:true}),pngA,'image-1.png');});},25000);
 it.each(THEMES)('%s refuses an HTTP error instead of downloading it as PNG',async theme=>{await withSession(theme,390,844,{surface:'lightbox',ops:['download-image'],operationError:true},async s=>{const downloaded:unknown[]=[];s.page.on('download',d=>downloaded.push(d));await click(s,s.page.getByTitle('下载',{exact:true}));await waitActions(s);expect(await s.page.getByText('下载失败',{exact:true}).count(),'message results image download failure visible').toBe(1);expect(downloaded,'message results no error document downloaded').toHaveLength(0);});},25000);
 it.each(THEMES)('%s native player decodes and plays the owned one-second clip',async theme=>{await withSession(theme,390,844,{surface:'result'},async s=>{const video=frame(s).locator('video');await video.press('Space');await s.page.waitForFunction(()=>{const v=document.querySelector('video');return !!v&&v.currentTime>0.05;},undefined,{timeout:4000});expect(await video.evaluate(e=>(e as HTMLVideoElement).error)).toBeNull();expect(await video.evaluate(e=>{const v=e as HTMLVideoElement;return [v.videoWidth,v.videoHeight,v.getVideoPlaybackQuality().totalVideoFrames];})).toEqual([160,90,expect.any(Number)]);expect(await video.evaluate(e=>(e as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(0);});},25000);
 it.each(THEMES)('%s video download-link contract preserves resolved fixture URL',async theme=>{await withSession(theme,390,844,{surface:'result'},async s=>{const link=s.page.getByRole('link',{name:'下载成片',exact:true});await reveal(s,link);await target(link);expect(await link.isVisible()).toBe(true);expect(await link.isEnabled()).toBe(true);expect(await link.evaluate(e=>({tag:e.tagName,url:(e as HTMLAnchorElement).href,origin:new URL((e as HTMLAnchorElement).href).origin,download:e.getAttribute('download')}))).toEqual({tag:'A',url:ORIGIN+'/fixture/film.mp4',origin:ORIGIN,download:''});});},25000);
 it.each(THEMES)('%s export ZIP native download preserves exact artifact and filename',async theme=>{await withSession(theme,390,844,{surface:'multi',ops:['download-zip']},async s=>{await expectNativeDownload(s,s.page.getByRole('button',{name:'下载 ZIP'}),zipBytes,'synthetic-export.zip');});},25000);
 it.each(THEMES)('%s manifest native download preserves exact artifact and filename',async theme=>{await withSession(theme,390,844,{surface:'multi',ops:['download-manifest']},async s=>{await expectNativeDownload(s,s.page.getByRole('button',{name:'下载 manifest'}),Buffer.from('{"synthetic":true}\n'),'synthetic-manifest.json');});},25000);
 it.each(THEMES)('%s export return keeps original managed image reference',async theme=>{await withSession(theme,390,844,{surface:'multi',ops:['return-multi']},async s=>{await click(s,s.page.getByRole('button',{name:'返回画布'}));await waitActions(s);expect((await state(s)).returned).toEqual([[{assetId:'asset-image',assetVersionId:'image-v',kind:'image',url:'/fixture/image-a.png'}]]);});},25000);
 it.each(THEMES)('%s brief return keeps original managed video reference',async theme=>{await withSession(theme,390,844,{surface:'brief',ops:['return-brief']},async s=>{await click(s,s.page.getByRole('button',{name:'返回画布'}));await waitActions(s);expect((await state(s)).returned).toEqual([[{assetId:'asset-video',assetVersionId:'video-v',kind:'video',url:'/fixture/film.mp4'}]]);});},25000);
 it.each(THEMES)('%s revision submits exact frozen approval identity and trimmed input',async theme=>{await withSession(theme,390,844,{surface:'approval'},async s=>{await click(s,s.page.getByRole('button',{name:'修改脚本'}));await s.page.getByRole('textbox',{name:'脚本修改要求'}).fill('  合成修改，不调用模型  ');await click(s,s.page.getByRole('button',{name:'提交修改要求'}));expect((await state(s)).approvals).toEqual([{action:'revise',value:{revision:3,generation:1,planChecksum:'a'.repeat(64)},instruction:'合成修改，不调用模型'}]);expect(await s.page.getByRole('alert').count()).toBe(1);});},25000);
 it.each(THEMES)('%s approval rejection stays visible without claiming successful execution',async theme=>{await withSession(theme,390,844,{surface:'approval'},async s=>{await click(s,s.page.getByRole('button',{name:'批准生成'}));expect((await state(s)).approvals).toEqual([{action:'approve',value:{revision:3,generation:1,planChecksum:'a'.repeat(64)}}]);expect(await s.page.getByRole('alert').count()).toBe(1);});},25000);
 it.each(THEMES)('%s approval operation exception stays visible and retryable',async theme=>{await withSession(theme,390,844,{surface:'approval',variant:'operation-error'},async s=>{await click(s,s.page.getByRole('button',{name:'取消任务'}));expect(await s.page.getByRole('alert').innerText()).toContain('合成审批操作失败');expect(await s.page.getByRole('button',{name:'取消任务'}).isEnabled()).toBe(true);});},25000);
 it.each(THEMES.flatMap(theme=>['not-ready','authority-pending','wrong-asset','load-error'].map(variant=>({theme,variant}))))('$theme $variant result does not expose an invalid delivery link',async({theme,variant})=>{await withSession(theme,390,844,{surface:'result',variant},async s=>{expect(await frame(s).getByRole('alert').count()).toBe(1);expect(await frame(s).getByRole('link',{name:'下载成片'}).count()).toBe(0);});},25000);
});
describe('messages results cancellation diagnostic',()=>{
 it.each((['timeline','brief','multi'] as const).flatMap(surface=>THEMES.map(theme=>({surface,theme}))))('$surface $theme shows rejection without an unhandled promise',async({surface,theme})=>{await withSession(theme,390,844,{surface,variant:'paused',ops:['cancel'],operationError:true},async s=>{await click(s,frame(s).getByRole('button',{name:'取消任务'}));await waitActions(s);expect(await frame(s).getByRole('alert').filter({hasText:surface==='brief'?'视频任务控制失败':surface==='multi'?'Agent cancellation failed':'合成取消失败，请重试'}).count(),'message results cancel failure visible').toBe(1);expect(s.errors,'message results no uncaught cancellation').toEqual([]);});},25000);
 it.each((['timeline','brief','multi'] as const).flatMap(surface=>THEMES.map(theme=>({surface,theme}))))('$surface $theme waits for one actual cancellation acknowledgement',async({surface,theme})=>{await withSession(theme,390,844,{surface,variant:'paused',ops:['cancel'],holdOps:true},async s=>{const b=frame(s).getByRole('button',{name:'取消任务'});await click(s,b);try{expect(await frame(s).getByRole('button').last().isDisabled(),'message results cancel pending disabled').toBe(true);}finally{for(const g of s.gates)g.release();await waitActions(s);if(surface==='timeline'){expect((await state(s)).cancelCalls).toBe(1);expect(await b.isEnabled()).toBe(true);}else{await frame(s).getByText('已取消',{exact:true}).waitFor();await waitActions(s);}}});},25000);
});
async function expectFixtureFailure(operation:Promise<void>,messages:string[]):Promise<void>{let failure:unknown;try{await operation;}catch(e){failure=e;}expect(failure).toBeInstanceOf(AggregateError);expect((failure as AggregateError).errors.map((e:Error)=>e.message).sort()).toEqual([...messages].sort());}
describe('messages results fixture boundary',()=>{
  it('preserves missing operation and cleanup failures together',async()=>{const s=await session('gold',390,844,{surface:'markdown',ops:['cancel']});await expectFixtureFailure(dispose(s,undefined,()=>{throw Error('SC_UI_FIXTURE_INJECTED_CLEANUP');}),['SC_UI_FIXTURE_REQUEST_VALIDATION','SC_UI_FIXTURE_CLEANUP_FAILURE: Error: SC_UI_FIXTURE_INJECTED_CLEANUP']);expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);},25000);
  it('rejects a missing promised POST instead of passing an unsubmitted operation',async()=>{const s=await session('gold',390,844,{surface:'markdown',ops:['cancel']});await expectFixtureFailure(dispose(s),['SC_UI_FIXTURE_REQUEST_VALIDATION']);expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);},25000);
  it.each(['http','websocket'] as const)('refuses unknown %s as infrastructure',async transport=>{const s=await session('gold',390,844,{surface:'markdown'});try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* deliberate refusal */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const ws=new WebSocket('wss://unexpected.invalid'),timer=setTimeout(()=>reject(Error('SC_UI_FIXTURE_WS_TIMEOUT')),1500);ws.onclose=()=>{clearTimeout(timer);resolve();};}));await expectFixtureFailure(dispose(s,transport),[transport==='http'?'SC_UI_FIXTURE_INFRASTRUCTURE: Error: SC_UI_FIXTURE_UNKNOWN_HTTP GET /unexpected':'SC_UI_FIXTURE_INFRASTRUCTURE: SC_UI_FIXTURE_UNKNOWN_WS']);}finally{if(live.has(s))await dispose(s);}},25000);
  it.each(['http','websocket'] as const)('preserves a cleanup failure alongside expected %s refusal',async transport=>{const s=await session('gold',390,844,{surface:'markdown'});try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* deliberate refusal */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const ws=new WebSocket('wss://unexpected.invalid'),timer=setTimeout(()=>reject(Error('SC_UI_FIXTURE_WS_TIMEOUT')),1500);ws.onclose=()=>{clearTimeout(timer);resolve();};}));await expectFixtureFailure(dispose(s,transport,()=>{throw Error('SC_UI_FIXTURE_INJECTED_CLEANUP');}),[transport==='http'?'SC_UI_FIXTURE_INFRASTRUCTURE: Error: SC_UI_FIXTURE_UNKNOWN_HTTP GET /unexpected':'SC_UI_FIXTURE_INFRASTRUCTURE: SC_UI_FIXTURE_UNKNOWN_WS','SC_UI_FIXTURE_CLEANUP_FAILURE: Error: SC_UI_FIXTURE_INJECTED_CLEANUP']);expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);}finally{if(live.has(s))await dispose(s);}},25000);
});

describe('messages results late receipts',()=>{
 it.each(THEMES)('%s closed lightbox does not announce a late clipboard receipt',async theme=>{await withSession(theme,390,844,{surface:'lightbox',clipboardHold:true},async s=>{await click(s,s.page.getByTitle('复制链接',{exact:true}));await click(s,s.page.getByTitle('关闭 (Esc)',{exact:true}));await s.page.evaluate(()=>(window as unknown as FixtureWindow).clipboardFixture.release());await s.page.waitForFunction(()=>(window as unknown as FixtureWindow).clipboardFixture.pending===0);await settle(s.page);expect(await s.page.getByText('链接已复制',{exact:true}).count()).toBe(0);});},25000);
 it.each(THEMES)('%s closed lightbox does not deliver or announce a late failed download',async theme=>{await withSession(theme,390,844,{surface:'lightbox',ops:['download-image'],holdOps:true,operationError:true},async s=>{const downloaded:unknown[]=[];s.page.on('download',d=>downloaded.push(d));await click(s,s.page.getByTitle('下载',{exact:true}));await click(s,s.page.getByTitle('关闭 (Esc)',{exact:true}));for(const g of s.gates)g.release();await waitActions(s);expect(downloaded).toHaveLength(0);expect(await s.page.getByText('下载失败',{exact:true}).count()).toBe(0);});},25000);
});

// R: consumer-visible reading room, table header words and original composer controls.
// Leaving the old 80px reserve or allowing table headers to squeeze into single
// character columns must fail these checks. No model submission is performed.
describe('reading space r table',()=>{
 it.each(THEMES.flatMap(theme=>[[320,640],[390,844],[640,320],[1440,900]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height keeps short table headers as words',async({theme,width,height})=>{
  await withSession(theme,width,height,{surface:'markdown'},async s=>{
   await capture(s,'r-table-'+theme+'-'+width+'x'+height);
   await panelBounds(frame(s));
   const headers=frame(s).locator('thead th');expect(await headers.allTextContents()).toEqual(['标题','描述']);
   const lines=await headers.evaluateAll(elements=>elements.map(element=>{const range=document.createRange();range.selectNodeContents(element);return [...new Set([...range.getClientRects()].map(r=>Math.round(r.top*2)/2))].length;}));
   expect(lines,'reading space r header words unbroken').toEqual([1,1]);
  });
 },25000);
});

// V: only the messages layout loop opts into this extra horizontal observation.
// Original reveal/target and all other surfaces keep their prior contracts.
async function v5RevealMessageHorizontal(s: Session, control: Locator): Promise<void> {
  for (let step = 0; step < 12; step++) {
    const geometry = await control.evaluate(element => {
      const box = element.getBoundingClientRect();
      let clipLeft = 0, clipRight = innerWidth;
      const candidates: HTMLElement[] = [];
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const rect = parent.getBoundingClientRect(), css = getComputedStyle(parent);
        if (/auto|scroll|hidden|clip/.test(css.overflowX)) {
          clipLeft = Math.max(clipLeft, rect.left + parent.clientLeft);
          clipRight = Math.min(clipRight, rect.left + parent.clientLeft + parent.clientWidth);
        }
        if (/auto|scroll/.test(css.overflowX) && parent.scrollWidth > parent.clientWidth + 1) candidates.push(parent);
      }
      let scroll: { x: number; y: number; width: number; height: number } | null = null;
      for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect();
        let left = Math.max(0, rect.left + candidate.clientLeft), right = Math.min(innerWidth, rect.left + candidate.clientLeft + candidate.clientWidth);
        let top = Math.max(0, rect.top + candidate.clientTop), bottom = Math.min(innerHeight, rect.top + candidate.clientTop + candidate.clientHeight);
        for (let parent = candidate.parentElement; parent; parent = parent.parentElement) {
          const bounds = parent.getBoundingClientRect(), css = getComputedStyle(parent);
          if (/auto|scroll|hidden|clip/.test(css.overflowX)) { left = Math.max(left, bounds.left + parent.clientLeft); right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth); }
          if (/auto|scroll|hidden|clip/.test(css.overflowY)) { top = Math.max(top, bounds.top + parent.clientTop); bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight); }
        }
        if (right > left && bottom > top) { scroll = { x: left, y: top, width: right - left, height: bottom - top }; break; }
      }
      return { left: box.left, right: box.right, width: box.width, clipLeft, clipRight, scroll };
    });
    if (geometry.left >= geometry.clipLeft - 0.5 && geometry.right <= geometry.clipRight + 0.5) return;
    if (!geometry.scroll) throw Error('SC_UI_FIXTURE_NO_HORIZONTAL_SCROLL_SURFACE');
    const gap = Math.max(0, Math.min(12, (geometry.clipRight - geometry.clipLeft - geometry.width) / 2));
    await s.page.mouse.move(geometry.scroll.x + geometry.scroll.width / 2, geometry.scroll.y + geometry.scroll.height / 2);
    await s.page.mouse.wheel(geometry.left < geometry.clipLeft ? geometry.left - geometry.clipLeft - gap : geometry.right - geometry.clipRight + gap, 0);
    await settle(s.page);
  }
  throw Error('SC_UI_FIXTURE_NATIVE_HORIZONTAL_SCROLL_DID_NOT_CONVERGE');
}

interface V5CloseTrace { kind: string; connected: boolean; state: string | null; animationName: string; animationDuration: string; at: number }
interface V5CloseWindow extends Window { v5CloseTrace: V5CloseTrace[]; v5CloseStop: () => void }
describe('real page reading v native reveal', () => {
  it.each(THEMES)('%s reaches original horizontal message action with native wheel', async theme => {
    await withSession(theme, 640, 320, { surface: 'messages' }, async s => {
      const control = s.page.getByTitle('在 Canvas 中编辑', { exact: true }).last();
      const row = control.locator('xpath=ancestor::div[button[@title="复制"]][1]');
      const before = await state(s);
      await reveal(s, control);
      const initial = await row.evaluate(element => element.scrollLeft);
      await v5RevealMessageHorizontal(s, control); await target(control);
      expect(await row.evaluate(element => element.scrollLeft), 'real page reading v native horizontal scroll advances').toBeGreaterThan(initial);
      expect(await state(s), 'real page reading v observing actions does not activate a callback').toEqual(before);
    });
  }, 25000);
  it('rejects a genuinely non-scrollable ancestor clipped control', async () => {
    await withSession('gold', 640, 320, { surface: 'messages' }, async s => {
      await s.page.evaluate(() => { const clip = document.createElement('div'); clip.id = 'v-native-clip-counterexample'; clip.style.cssText = 'position:fixed;left:20px;top:120px;width:20px;height:64px;overflow:hidden;z-index:999999'; const button = document.createElement('button'); button.style.cssText = 'display:block;width:44px;height:44px;min-width:44px'; button.textContent = '裁剪反例'; clip.append(button); document.body.append(clip); });
      try {
        const control = s.page.locator('#v-native-clip-counterexample button');
        expect(await control.evaluate(element => element.getBoundingClientRect().width)).toBe(44);
        await expect(v5RevealMessageHorizontal(s, control)).rejects.toThrow('SC_UI_FIXTURE_NO_HORIZONTAL_SCROLL_SURFACE');
      } finally { await s.page.locator('#v-native-clip-counterexample').evaluate(element => element.remove()); }
    });
  }, 25000);
  it.each(THEMES)('%s records native closed animation before actual menu detach', async theme => {
    await withSSession(theme, 390, 844, { surface: 'messages' }, async s => {
      const menu = await sMenu(s), handle = await menu.elementHandle();
      if (!handle) throw Error('V5_NATIVE_MENU_NODE_REQUIRED');
      await menu.evaluate(node => {
        const win = window as unknown as V5CloseWindow, trace: V5CloseTrace[] = [];
        const sample = (kind: string): void => { const css = getComputedStyle(node); trace.push({ kind, connected: node.isConnected, state: node.getAttribute('data-state'), animationName: css.animationName, animationDuration: css.animationDuration, at: performance.now() }); };
        const attributes = new MutationObserver(() => sample('attributes'));
        attributes.observe(node, { attributes: true, attributeFilter: ['data-state'] });
        const removed = new MutationObserver(() => { if (!node.isConnected) sample('detached'); });
        removed.observe(document.body, { childList: true, subtree: true });
        const ended = (event: Event): void => { if (event.target === node) sample('own-animationend'); }; node.addEventListener('animationend', ended);
        win.v5CloseTrace = trace; win.v5CloseStop = () => { attributes.disconnect(); removed.disconnect(); node.removeEventListener('animationend', ended); };
      });
      try {
        await click(s, menu.getByRole('menuitem', { name: /^生成标语/ }));
        await s.page.waitForFunction(node => !node.isConnected, handle, { timeout: 1500 });
        const trace = await s.page.evaluate(() => (window as unknown as V5CloseWindow).v5CloseTrace);
        console.log('V5_NATIVE_MENU_CLOSE_TRACE', JSON.stringify({ theme, trace }));
        expect(trace.some(row => row.state === 'closed' && row.connected && row.animationName !== 'none' && row.animationDuration.split(',').some(value => parseFloat(value) > 0)), 'real page reading v native closing animation is not a detached node').toBe(true);
        expect(trace.some(row => row.kind === 'detached' && !row.connected), 'real page reading v observes true native detach').toBe(true);
        const closedIndex = trace.findIndex(row => row.state === 'closed' && row.connected && row.kind === 'attributes');
        const ownEndIndex = trace.findIndex(row => row.kind === 'own-animationend' && row.state === 'closed' && row.connected);
        const detachIndex = trace.findIndex(row => row.kind === 'detached' && !row.connected);
        expect(closedIndex, 'real page reading v original node enters closed state').toBeGreaterThanOrEqual(0);
        expect(ownEndIndex, 'real page reading v original node owns the later animationend').toBeGreaterThan(closedIndex);
        expect(detachIndex, 'real page reading v same node detaches only after own animationend').toBeGreaterThan(ownEndIndex);
        expect(await sInput(s).inputValue()).toBe(S_COMMANDS[4].prompt);
        expect(await menu.count()).toBe(0);
      } finally { await s.page.evaluate(() => (window as unknown as V5CloseWindow).v5CloseStop()); }
    });
  }, 25000);
});

// S: real FileReader, chooser and clipboard; drop is an explicitly synthetic DOM
// DataTransfer, never physical Android drag. Regressions: hover-only/tiny actions,
// inconsistent image filtering, hidden second shortcut switch and lost draft/focus.

interface SReaderWindow extends Window{sNativeReaders:{started:number;completed:number;pending:number;errors:string[]}}
async function sObserveReaders(s:Session):Promise<void>{
 await s.page.evaluate(()=>{const state={started:0,completed:0,pending:0,errors:[] as string[]};Object.assign(window,{sNativeReaders:state});const original=FileReader.prototype.readAsDataURL;FileReader.prototype.readAsDataURL=function(this:FileReader,blob:Blob):void{state.started++;state.pending++;let ended=false;const done=():void=>{if(ended)return;ended=true;state.pending--;state.completed++;if(this.error)state.errors.push(this.error.name);};this.addEventListener('loadend',done,{once:true});try{original.call(this,blob);}catch(error){this.removeEventListener('loadend',done);done();throw error;}};});
}
async function sReadersFinish(s:Session,minimum=0):Promise<void>{
 await s.page.waitForFunction(min=>{const r=(window as unknown as SReaderWindow).sNativeReaders;return r.started>=min&&r.pending===0&&r.started===r.completed;},minimum,{timeout:1500});await settle(s.page);const value=await s.page.evaluate(()=>(window as unknown as SReaderWindow).sNativeReaders);if(value.pending!==0||value.completed!==value.started||value.errors.length)throw Error('SC_UI_FIXTURE_NATIVE_FILEREADER_DRAIN '+JSON.stringify(value));
}
async function withSSession(theme:Theme,width:number,height:number,options:Options,run:(s:Session)=>Promise<void>):Promise<void>{
 await withSession(theme,width,height,options,async s=>{await sObserveReaders(s);let primary:unknown;try{await run(s);}catch(error){primary=error;}try{await sReadersFinish(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'SC_UI_FIXTURE_S_TEST_AND_READER_CLEANUP');throw cleanup;}if(primary)throw primary;});
}

const S_NAME_A='S-第一张.png',S_NAME_B='S-第二张.png';
const S_ANALYZE='请对这张图片进行深度分析报告，从视觉风格、文案策略、目标受众、可复用技巧四个维度拆解，并给出可执行的创作建议：';
const S_COMMANDS=[
 {label:'深度分析图片',image:true,prompt:'请对这张图片进行专业的文案策划深度分析，按以下结构输出报告：\n\n## 一、视觉构成分析\n- 画面主体与视觉焦点\n- 色彩搭配与情绪调性\n- 构图方式与视觉引导\n\n## 二、文案拆解\n- 标题/主文案的写法特点（句式、语气、卖点表达）\n- 辅助文案的信息层级\n- CTA（行动号召）设计\n\n## 三、受众画像推断\n- 目标人群特征\n- 触发的情感诉求\n\n## 四、传播策略评估\n- 适用投放渠道分析\n- 优势与不足\n\n## 五、行动建议\n- 给出3条可直接复用的文案创作建议'},
 {label:'生成配套文案',image:true,prompt:'请为这张图片生成配套文案：1) 朋友圈文案（轻松口语化，带emoji）2) 小红书文案（种草风格，带话题标签）3) 海报主标题+副标题（精炼有力）'},
 {label:'以此图生成新图',image:true,prompt:'基于这张图片生成一张类似风格的新图片'},
 {label:'润色文案',image:false,prompt:'请润色以下文案，保持原意但让表达更流畅有力，并给出2个不同风格版本：\n\n'},
 {label:'生成标语',image:false,prompt:'请为以下产品/品牌生成5个标语（Slogan）候选，要求简洁有力、易记忆、有传播力：\n\n'},
 {label:'标题党生成器',image:false,prompt:'请为以下内容生成10个吸睛标题，覆盖不同风格：悬念式、数字式、痛点式、利益式、对比式：\n\n'},
];
const sInput=(s:Session):Locator=>s.page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片',{exact:true});
const sCard=(s:Session):Locator=>sInput(s).locator('..');
const sPictures=(s:Session):Locator=>sCard(s).locator('img[src^="data:"]');
async function sChoose(s:Session,files:Array<{name:string;mimeType:string;buffer:Buffer}>):Promise<void>{
 const [chooser]=await Promise.all([s.page.waitForEvent('filechooser'),click(s,s.page.getByTitle('上传图片',{exact:true}))]);
 await chooser.setFiles(files);await sReadersFinish(s,1);await settle(s.page);
}
async function sPicturesReady(s:Session,count:number):Promise<void>{
 await s.page.waitForFunction(want=>{const t=document.querySelector('textarea');return !!t&&[...t.parentElement!.querySelectorAll<HTMLImageElement>('img[src^="data:"]')].length===want&&[...t.parentElement!.querySelectorAll<HTMLImageElement>('img[src^="data:"]')].every(i=>i.complete&&i.naturalWidth>0);},count,{timeout:1500});
}
async function sUpload(s:Session,two=false):Promise<void>{await sChoose(s,[{name:S_NAME_A,mimeType:'image/png',buffer:pngA},...(two?[{name:S_NAME_B,mimeType:'image/png',buffer:pngB}]:[])]);await sPicturesReady(s,two?2:1);}
async function sMenu(s:Session,captureName?:string):Promise<Locator>{
 await click(s,s.page.getByTitle('快捷工作流',{exact:true}));if(captureName)await capture(s,captureName);
 const menu=s.page.getByRole('menu',{name:'文案策划快捷指令',exact:true});expect(await menu.count(),'composer shortcuts s single-step menu').toBe(1);return menu;
}
describe('composer shortcuts s attachment layout',()=>{
 it.each(THEMES.flatMap(theme=>[[320,640],[390,844],[640,320],[1440,900]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height exposes named attachment actions without hover',async({theme,width,height})=>{
  await withSSession(theme,width,height,{surface:'messages'},async s=>{await sUpload(s,true);await s.page.mouse.move(width-1,0);await capture(s,'s-attachments-'+theme+'-'+width+'x'+height);await panelBounds(frame(s));
   for(const picture of await sPictures(s).all()){const group=picture.locator('..');const buttons=group.getByRole('button');expect(await buttons.count()).toBe(2);for(const action of await buttons.all()){await reveal(s,action);if(width>=768)await action.focus();expect(await action.evaluate(e=>Number(getComputedStyle(e).opacity)),'composer shortcuts s attachment action visible').toBe(1);await target(action);expect(await textContrast(action),'composer shortcuts s attachment contrast').toBeGreaterThanOrEqual(4.5);expect(await action.evaluate(e=>!!(e.getAttribute('aria-label')||e.getAttribute('title')||e.textContent?.trim())),'composer shortcuts s attachment action named').toBe(true);}}
  });
 },25000);
});
describe('composer shortcuts s attachment operations',()=>{
 it.each(THEMES.flatMap(theme=>[[320,640],[640,320]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height removes the intended image and keeps analysis as draft',async({theme,width,height})=>{
  await withSSession(theme,width,height,{surface:'messages'},async s=>{await sUpload(s,true);const first=sCard(s).locator('img[src="data:image/png;base64,'+pngA.toString('base64')+'"]').locator('..'),remove=first.getByRole('button').first();expect(await remove.evaluate(e=>(e.getAttribute('aria-label')||e.getAttribute('title')||'')),'composer shortcuts s removal identifies image').toContain(S_NAME_A);await click(s,remove);expect(await sPictures(s).count()).toBe(1);expect(await sPictures(s).getAttribute('src')).toBe('data:image/png;base64,'+pngB.toString('base64'));const analyze=sPictures(s).locator('..').getByRole('button',{name:/深度分析/});await click(s,analyze);expect(await sInput(s).inputValue()).toBe(S_ANALYZE);expect(await sInput(s).evaluate(e=>e===document.activeElement),'composer shortcuts s analysis focuses draft').toBe(true);expect(await sPictures(s).count()).toBe(1);expect(await s.page.getByRole('button',{name:'发送消息',exact:true}).isEnabled()).toBe(true);});
 },25000);
});
describe('composer shortcuts s native clipboard',()=>{
 it.each(THEMES)('%s accepts a native PNG paste without replacing draft or sending',async theme=>{await withSSession(theme,390,844,{surface:'messages'},async s=>{await sInput(s).fill('保留图片旁的草稿');await s.page.evaluate(async encoded=>{const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));await navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([bytes],{type:'image/png'})})]);},pngA.toString('base64'));await sInput(s).focus();await s.page.keyboard.press('Control+V');await sPicturesReady(s,1);expect(await sInput(s).inputValue()).toBe('保留图片旁的草稿');expect(await sPictures(s).evaluate(e=>[(e as HTMLImageElement).naturalWidth,(e as HTMLImageElement).naturalHeight])).toEqual([800,450]);expect(await s.page.getByRole('button',{name:'发送消息',exact:true}).isEnabled()).toBe(true);});},25000);
 it.each(THEMES)('%s leaves ordinary clipboard text on the original textarea path',async theme=>{await withSSession(theme,390,844,{surface:'messages'},async s=>{await sInput(s).fill('原草稿 ');await s.page.evaluate(()=>navigator.clipboard.writeText('追加文字，不发送'));await sInput(s).focus();await s.page.keyboard.press('End');await s.page.keyboard.press('Control+V');await settle(s.page);expect(await sInput(s).inputValue()).toBe('原草稿 追加文字，不发送');expect(await sPictures(s).count()).toBe(0);});},25000);
});
describe('composer shortcuts s file boundaries',()=>{
 it.each(THEMES)('%s ignores non-image chooser entries just as the existing drop path does',async theme=>{await withSSession(theme,390,844,{surface:'messages'},async s=>{await sChoose(s,[{name:'S-not-image.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic text only')},{name:S_NAME_A,mimeType:'image/png',buffer:pngA}]);await settle(s.page);await s.page.waitForFunction(()=>!!document.querySelector('textarea')?.parentElement?.querySelector('img[src^="data:"]'));expect(await sPictures(s).count(),'composer shortcuts s chooser filters non-image').toBe(1);expect(await sPictures(s).getAttribute('src')).toBe('data:image/png;base64,'+pngA.toString('base64'));});},25000);
 it.each(THEMES)('%s handles an explicitly synthetic mixed-file drop through real FileReader',async theme=>{await withSSession(theme,390,844,{surface:'messages'},async s=>{const transfer=await s.page.evaluateHandle(encoded=>{const value=new DataTransfer();value.items.add(new File(['synthetic text'],'S-not-image.txt',{type:'text/plain'}));value.items.add(new File([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],'S-drop.png',{type:'image/png'}));return value;},pngA.toString('base64'));try{await sCard(s).dispatchEvent('drop',{dataTransfer:transfer});await sReadersFinish(s,1);await sPicturesReady(s,1);expect(await sPictures(s).getAttribute('src')).toBe('data:image/png;base64,'+pngA.toString('base64'));}finally{await transfer.dispose();}});},25000);
 it.each(THEMES)('%s retains two separately selected copies instead of silently losing the second chooser result',async theme=>{await withSSession(theme,390,844,{surface:'messages'},async s=>{await sUpload(s);await sChoose(s,[{name:S_NAME_A,mimeType:'image/png',buffer:pngA}]);await sPicturesReady(s,2);expect(await sPictures(s).count()).toBe(2);});},25000);
 it.each(THEMES)('%s retains attachment identity and draft when rotating the same mounted composer',async theme=>{await withSSession(theme,390,844,{surface:'messages'},async s=>{const input=sInput(s),handle=await input.elementHandle();if(!handle)throw Error('SC_UI_FIXTURE_INPUT');await sUpload(s);await input.fill('旋转不发送的合成草稿');for(const [width,height] of [[640,320],[390,844]]){await s.page.setViewportSize({width,height});await settle(s.page);expect(await handle.evaluate(e=>e.isConnected)).toBe(true);expect(await input.inputValue()).toBe('旋转不发送的合成草稿');expect(await sPictures(s).getAttribute('src')).toBe('data:image/png;base64,'+pngA.toString('base64'));}});},25000);
});
describe('composer shortcuts s menu layout',()=>{
 it.each(THEMES.flatMap(theme=>[[320,640],[390,844],[640,320],[1440,900]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height opens once and keeps all menu choices reachable',async({theme,width,height})=>{await withSSession(theme,width,height,{surface:'messages'},async s=>{await sUpload(s);const menu=await sMenu(s,'s-shortcuts-'+theme+'-'+width+'x'+height);await panelBounds(menu);expect(await menu.getByRole('menuitem').count(),'composer shortcuts s all menu choices').toBe(6);for(const item of await menu.getByRole('menuitem').all()){await reveal(s,item);await target(item);expect(await textContrast(item),'composer shortcuts s menu contrast').toBeGreaterThanOrEqual(4.5);}});},25000);
});
describe('composer shortcuts s selection',()=>{
 it.each(THEMES.flatMap(theme=>S_COMMANDS.map(command=>({theme,command}))))('$theme $command.label puts exact original prompt into draft and closes',async({theme,command})=>{await withSSession(theme,390,844,{surface:'messages'},async s=>{if(command.image)await sUpload(s);const menu=await sMenu(s);const item=menu.getByRole('menuitem',{name:new RegExp('^'+command.label)});const menuNode=await menu.elementHandle();if(!menuNode)throw Error('V5_SELECTION_ORIGINAL_MENU_REQUIRED');await click(s,item);expect(await sInput(s).inputValue()).toBe(command.prompt);await s.page.waitForFunction(node=>!node.isConnected,menuNode,{timeout:1500});expect(await s.page.getByRole('menu',{name:'文案策划快捷指令',exact:true}).count()).toBe(0);expect(await sInput(s).evaluate(e=>e===document.activeElement),'composer shortcuts s selected command focuses input').toBe(true);expect(await sPictures(s).count()).toBe(command.image?1:0);});},25000);
});
describe('composer shortcuts s image requirements',()=>{
 it.each(THEMES.flatMap(theme=>[[320,640],[640,320]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height disables only image commands when no image exists',async({theme,width,height})=>{await withSSession(theme,width,height,{surface:'messages'},async s=>{await sInput(s).fill('不能被禁用项覆盖');const menu=await sMenu(s);for(const command of S_COMMANDS){const item=menu.getByRole('menuitem',{name:new RegExp('^'+command.label)});expect(await item.isEnabled(),'composer shortcuts s correct image requirement').toBe(!command.image);}await s.page.keyboard.press('Escape');await settle(s.page);expect(await sInput(s).inputValue()).toBe('不能被禁用项覆盖');});},25000);
});
describe('composer shortcuts s dismissal',()=>{
 it.each(THEMES.flatMap(theme=>['escape','outside'].map(method=>({theme,method}))))('$theme $method closes without replacing draft and restores entry focus',async({theme,method})=>{await withSSession(theme,390,844,{surface:'messages'},async s=>{await sInput(s).fill('关闭菜单仍保留的草稿');await sMenu(s);if(method==='escape')await s.page.keyboard.press('Escape');else await s.page.mouse.click(2,2);await settle(s.page);expect(await s.page.getByRole('menu',{name:'文案策划快捷指令',exact:true}).count(),'composer shortcuts s dismissed menu').toBe(0);expect(await sInput(s).inputValue()).toBe('关闭菜单仍保留的草稿');expect(await s.page.getByTitle('快捷工作流',{exact:true}).evaluate(e=>e===document.activeElement),'composer shortcuts s restored entry focus').toBe(true);if(method==='outside'){const input=sInput(s);await sMenu(s);const point=await input.evaluate(element=>{const r=element.getBoundingClientRect();for(const x of [r.left+4,r.right-4,r.left+r.width/2]){const y=r.top+r.height/2;if(element.contains(document.elementFromPoint(x,y)))return{x,y};}return null;});expect(point,'composer shortcuts s outside input has an exposed native target').not.toBeNull();await s.page.mouse.click(point!.x,point!.y);await settle(s.page);expect(await s.page.getByRole('menu',{name:'文案策划快捷指令',exact:true}).count(),'composer shortcuts s outside input dismisses menu').toBe(0);expect(await input.evaluate(e=>e===document.activeElement),'composer shortcuts s outside input keeps user focus').toBe(true);await s.page.keyboard.press('End');await s.page.keyboard.type('继续输入');expect(await input.inputValue()).toBe('关闭菜单仍保留的草稿继续输入');}});},25000);
});
describe('composer shortcuts s keyboard',()=>{
 it.each(THEMES)('%s keyboard selects an enabled command without a second entry switch',async theme=>{await withSSession(theme,390,844,{surface:'messages'},async s=>{const entry=s.page.getByTitle('快捷工作流',{exact:true});await reveal(s,entry);await entry.focus();await s.page.keyboard.press('Enter');await settle(s.page);const menu=s.page.getByRole('menu',{name:'文案策划快捷指令',exact:true});expect(await menu.count(),'composer shortcuts s keyboard menu opens').toBe(1);await s.page.keyboard.press('Home');expect(await menu.getByRole('menuitem',{name:/^润色文案/}).evaluate(e=>e===document.activeElement),'composer shortcuts s disabled image entries skipped').toBe(true);await s.page.keyboard.press('Enter');await settle(s.page);expect(await sInput(s).inputValue()).toBe(S_COMMANDS[3].prompt);});},25000);
});

describe('reading space r contrast',()=>{
 it.each(THEMES.flatMap(theme=>[[320,640],[844,390]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height keeps empty composer placeholder readable',async({theme,width,height})=>{
  await withSession(theme,width,height,{surface:'messages'},async s=>{const input=s.page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片',{exact:true});const ratio=await textContrast(input,true);console.log('R_PLACEHOLDER_CONTRAST',JSON.stringify({theme,width,height,ratio}));expect(ratio,'reading space r placeholder contrast').toBeGreaterThanOrEqual(4.5);});
 },25000);
});
describe('reading space r landscape',()=>{
 it.each(THEMES.flatMap(theme=>[[640,320,106],[844,390,130]].flatMap(([width,height,minReading])=>['default','active-agent'].map(variant=>({theme,width,height,minReading,variant})))))('$theme $variant $width x $height keeps reading room and primary composer usable',async({theme,width,height,minReading,variant})=>{
  await withSession(theme,width,height,{surface:'messages',variant},async s=>{
   const input=s.page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片',{exact:true});
   const textInput=variant==='active-agent'?s.page.getByRole('textbox',{name:''}).last():input;
   const actualInput=variant==='active-agent'?s.page.getByPlaceholder('与 合成活动Agent '+DATA.longWord+' 对话...',{exact:true}):input;
   expect(await textInput.count()).toBe(1);expect(await actualInput.count()).toBe(1);
   await actualInput.fill('合成草稿，不发送\n第二行供横屏输入验收');await settle(s.page);
   await capture(s,'r-space-'+theme+'-'+variant+'-'+width+'x'+height);
   const reading=s.page.locator('[data-chat-message-id="user-long"]').locator('..').locator('..');
   expect((await reading.boundingBox())?.height,'reading space r minimum reading room').toBeGreaterThanOrEqual(minReading);
   expect(await actualInput.evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),'reading space r input font').toBeGreaterThanOrEqual(16);
   await target(actualInput);await target(s.page.getByRole('button',{name:'发送消息',exact:true}));
   expect(await s.page.getByRole('button',{name:'发送消息',exact:true}).isEnabled()).toBe(true);
   for(const control of [s.page.getByRole('combobox',{name:'目标画布项目',exact:true}),s.page.getByRole('button',{name:theme==='gold'?'亮色模式':'暗色模式',exact:true}),s.page.getByRole('button',{name:'临时聊天',exact:true}),s.page.getByRole('button',{name:'全局搜索',exact:true})]){await reveal(s,control);await target(control);}
   if(variant==='active-agent'){const remove=s.page.getByRole('button',{name:'移除当前 Agent',exact:true});await target(remove);}
   expect(await actualInput.inputValue()).toBe('合成草稿，不发送\n第二行供横屏输入验收');
  });
 },25000);
});
describe('reading space r rotation',()=>{
 it.each(THEMES)('%s keeps the same draft and input through portrait landscape portrait',async theme=>{
  await withSession(theme,390,844,{surface:'messages'},async s=>{
   const input=s.page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片',{exact:true}),handle=await input.elementHandle();if(!handle)throw Error('R_INPUT_HANDLE');
   await input.fill('保留的合成草稿');await s.page.setViewportSize({width:640,height:320});await settle(s.page);expect(await handle.evaluate(e=>e.isConnected)).toBe(true);expect(await input.inputValue()).toBe('保留的合成草稿');
   const reading=s.page.locator('[data-chat-message-id="user-long"]').locator('..').locator('..');expect((await reading.boundingBox())?.height,'reading space r minimum reading room').toBeGreaterThanOrEqual(106);
   await target(input);await target(s.page.getByRole('button',{name:'发送消息',exact:true}));
   await s.page.setViewportSize({width:390,height:844});await settle(s.page);expect(await handle.evaluate(e=>e.isConnected)).toBe(true);expect(await input.inputValue()).toBe('保留的合成草稿');await target(input);await target(s.page.getByRole('button',{name:'发送消息',exact:true}));
  });
 },25000);
});
