// @vitest-environment node
// Real GenerationPanel and styles; synthetic catalog and intercepted network.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ENTRY = String.raw`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GenerationPanel} from '@/components/generation-panel';
const root=createRoot(document.getElementById('root'));const state={outputs:[]};
function App(){const [ref,setRef]=useState(null);window.fixture.add=(i)=>setRef({url:['/a.png','/b.png','/c.png'][i],description:['甲描述','乙描述','丙描述'][i]});return <GenerationPanel onGenerate={params=>state.outputs.push(params)} externalReferenceImage={ref} onExternalReferenceImageConsumed={()=>setRef(null)} />;}
window.fixture={state,mount(){root.render(<App/>)},unmount(){root.unmount()}};
`;

interface FixtureOutput { referenceImages: string[]; referenceDescriptions: string[]; referenceStrengths: number[]; referenceCategories: Record<string, string[]>; prompt: string; model: string; providerId?: string }
interface FixtureWindow extends Window { fixture: { add: (index: number) => void; mount: () => void; unmount: () => void; state: { outputs: FixtureOutput[] } } }

let browser: Browser | undefined;
let bundle = '', css = '';

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  const NativeRegExp = (require('node:vm') as typeof import('node:vm')).runInThisContext('RegExp') as RegExpConstructor;
  const variants = require('next/dist/build/browser-variant-modules') as { browserVariantModules: string[] };
  const browserFiles = new Map(variants.browserVariantModules.map(id => [require.resolve(`next/dist/${id}.js`), require.resolve(`next/dist/${id}.browser.js`)]));
  const framework = /(?:client-boundary-params|instant-samples|instant-validation[\\/]impl|navigation-dynamic-rendering|server-async-storage|unstable-rethrow)(?:\.js)?$/;
  const result = await build({ write: false, outfile: 'simple-create-fixture.js', bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022', absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_CACHE_COMPONENTS': 'false', '__dirname': '"/"' }, inject: ['simple-create-fixture-process'],
    plugins: [{ name: 'browser-fixture', setup(builder): void {
      builder.onResolve({ filter: new NativeRegExp('^simple-create-fixture-process$') }, () => ({ path: 'process', namespace: 'fixture' }));
      builder.onLoad({ filter: new NativeRegExp('.*'), namespace: 'fixture' }, () => ({ contents: "export { default as process } from 'next/dist/compiled/process';", loader: 'js', resolveDir: process.cwd() }));
      const allowed = new Set([require.resolve('ag-psd/dist/abr.js'), require.resolve('ag-psd/dist/additionalInfo.js')].map(file => path.resolve(file)));
      builder.onResolve({ filter: new NativeRegExp('^util$') }, args => args.importer && allowed.has(path.resolve(args.importer)) ? { path: require.resolve('next/dist/compiled/util') } : undefined);
      builder.onResolve({ filter: new NativeRegExp(framework.source, framework.flags) }, args => { if (!args.importer) return undefined; const file = browserFiles.get(createRequire(args.importer).resolve(args.path)); return file ? { path: file } : undefined; });
    } }], stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'simple-create-mobile-entry.tsx' } });
  bundle = result.outputFiles.filter(file => file.path.endsWith('.js'))[0].text;
  const files = Object.keys(result.metafile!.inputs).filter(file => /^src[\\/]/.test(file) && /\.[jt]sx?$/.test(file));
  const sources = await Promise.all(files.map(async file => ({ content: await readFile(path.resolve(process.cwd(),file), 'utf8'), extension: path.extname(file).slice(1) })));
  sources.push({ content: ENTRY, extension: 'tsx' });
  const compiler = await compile(await readFile(path.join(process.cwd(), 'src/app/globals.css'), 'utf8'), { base: process.cwd(), loadStylesheet: async (id, base) => {
    const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : id === 'tw-animate-css' ? path.join(process.cwd(), 'node_modules/tw-animate-css/dist/tw-animate.css') : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
    return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
  } });
  css = compiler.build(new Scanner({}).scanFiles(sources)) + result.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
const catalog = {success:true,capabilityCatalogVersion:1,providers:[{id:'demo',name:'合成'}],models:[{id:'image',name:'合成模型',providerId:'demo',type:'image',isDefault:true}],taskModelCatalog:[{providerId:'demo',modelId:'image',kind:'image',sourceType:'image',protocol:'openai',executionMode:'sync',allowedRatios:['1:1'],allowedSizes:['1024x1024'],qualityOptions:['standard'],maxOutputs:1,supportsReferenceImages:true,maxReferenceImages:4,supportsMask:false,outputKinds:['image'],capabilitySources:{}}]};
async function setup(){
 const context=await browser!.newContext({viewport:{width:320,height:640},isMobile:true,hasTouch:true,serviceWorkers:'block'});const page=await context.newPage();const errors:string[]=[];const requests:string[]=[];page.on('pageerror',e=>errors.push('page: '+e.message));await context.routeWebSocket('**/*',socket=>{errors.push('websocket');socket.close()});
 await context.route('**/*',async route=>{const request=route.request(),u=new URL(request.url());requests.push(request.method()+' '+u.pathname+u.search);if(u.origin!=='https://semantic-fixture.invalid'||request.method()!=='GET'||request.headers().cookie||request.headers().authorization){errors.push('forbidden '+request.method()+' '+u.origin+u.pathname);return route.abort('blockedbyclient')}
 if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="root"></div>'});
 if(['/a.png','/b.png','/c.png','/logo.png'].includes(u.pathname))return route.fulfill({contentType:'image/png',body:png});
 if(u.pathname==='/api/models')return route.fulfill({json:catalog});
 if(u.pathname.startsWith('/api/'))return route.fulfill({json:{}});
 errors.push('unexpected '+u.pathname);return route.abort('blockedbyclient')});
 await page.goto('https://semantic-fixture.invalid/');await page.addScriptTag({content:bundle});await page.evaluate(()=>(window as unknown as FixtureWindow).fixture.mount());await page.getByText('0/4',{exact:true}).waitFor({state:'visible',timeout:5000});
 return {context,page,errors,requests};
}
async function add(page:Page,n:number){await page.evaluate(i=>(window as unknown as FixtureWindow).fixture.add(i),n);await page.locator(`img[src="/${'abc'[n]}.png"]`).waitFor()}
function card(page:Page,src:string){return page.locator(`img[src="${src}"]`).locator('xpath=ancestor::div[contains(@class,"rounded-md") and contains(@class,"border")][1]')}
async function configure(page:Page,src:string,strength:number,category:string){const c=card(page,src);const slider=c.locator('input[type=range]');await slider.fill(String(strength));expect(await slider.inputValue()).toBe(String(strength));await c.getByRole('button',{name:category,exact:true}).click()}
async function remove(page:Page,index:number){const b=page.getByRole('button',{name:`移除第${index+1}张参考图`});await b.scrollIntoViewIfNeeded();await b.tap()}
async function generate(page:Page,index=0){await page.locator('#gen-prompt-textarea').fill('合成描述 #1');await page.evaluate(()=>document.dispatchEvent(new CustomEvent('trigger-generate')));await expect.poll(()=>page.evaluate(()=>(window as unknown as FixtureWindow).fixture.state.outputs.length)).toBe(index+1);return page.evaluate(i=>(window as unknown as FixtureWindow).fixture.state.outputs[i],index)}
async function three(page:Page){for(let i=0;i<3;i++)await add(page,i);await configure(page,'/a.png',15,'风格');await configure(page,'/b.png',55,'构图');await configure(page,'/c.png',90,'场景')}
async function finish(f:Awaited<ReturnType<typeof setup>>){expect(f.errors).toEqual([]);await f.page.evaluate(()=>(window as unknown as FixtureWindow).fixture.unmount());await f.context.close()}

describe('真实 GenerationPanel 参考图语义回归',()=>{
 const cases=[
  {name:'删除首张',index:0,images:['/b.png','/c.png'],desc:['乙描述','丙描述'],strength:[55,90],cats:{'0':['composition'],'1':['scene']}},
  {name:'删除中间',index:1,images:['/a.png','/c.png'],desc:['甲描述','丙描述'],strength:[15,90],cats:{'0':['style'],'1':['scene']}},
  {name:'删除末张',index:2,images:['/a.png','/b.png'],desc:['甲描述','乙描述'],strength:[15,55],cats:{'0':['style'],'1':['composition']}}
 ];
 for(const c of cases)it(`${c.name}：剩余图、分类、强度和生成参数保持对应`,async()=>{const f=await setup();try{await three(f.page);await remove(f.page,c.index);for(const url of c.images)expect(await f.page.locator(`img[src="${url}"]`).count()).toBe(1);const out=await generate(f.page);expect(out.referenceImages).toEqual(c.images);expect(out.referenceDescriptions).toEqual(c.desc);expect(out.referenceStrengths).toEqual(c.strength);expect(out.referenceCategories).toEqual(c.cats);expect(out.prompt).toContain(`[参考图1: ${c.desc[0]}]`);expect(out.model).toBe('image');expect(out.providerId).toBe('demo');console.log('OBS',c.name,JSON.stringify({images:out.referenceImages,descriptions:out.referenceDescriptions,strengths:out.referenceStrengths,categories:out.referenceCategories}));await finish(f)}finally{await f.context.close()}},25000);
 it('短强度数组删除首张后，未设置项保留默认值',async()=>{const f=await setup();try{for(let i=0;i<3;i++)await add(f.page,i);await configure(f.page,'/a.png',15,'风格');await card(f.page,'/c.png').getByRole('button',{name:'场景',exact:true}).click();const before=await generate(f.page);expect(before.referenceImages).toEqual(['/a.png','/b.png','/c.png']);expect(before.referenceStrengths).toEqual([15]);await remove(f.page,0);expect(await card(f.page,'/b.png').locator('input[type=range]').inputValue()).toBe('0');expect(await card(f.page,'/c.png').locator('input[type=range]').inputValue()).toBe('0');const out=await generate(f.page,1);expect(out.referenceImages).toEqual(['/b.png','/c.png']);expect(out.referenceDescriptions).toEqual(['乙描述','丙描述']);expect(out.referenceStrengths).toEqual([]);expect(out.referenceCategories).toEqual({'1':['scene']});console.log('OBS 短数组',JSON.stringify({images:out.referenceImages,strengths:out.referenceStrengths,categories:out.referenceCategories}));await finish(f)}finally{await f.context.close()}},25000);
 it('删除中间后新增槽并上传新图，生成参数无错位',async()=>{const f=await setup();try{await three(f.page);await remove(f.page,1);await f.page.getByRole('button',{name:'新增参考图',exact:true}).click();const chooserPromise=f.page.waitForEvent('filechooser');await f.page.getByRole('button',{name:'上传参考图 #3',exact:true}).click();const chooser=await chooserPromise;await chooser.setFiles({name:'new.png',mimeType:'image/png',buffer:png});const newImage=f.page.locator('img[src^="data:image/png;base64,"]');await newImage.waitFor();expect(await newImage.count()).toBe(1);const src=await newImage.getAttribute('src');const c=newImage.locator('xpath=ancestor::div[contains(@class,"rounded-md") and contains(@class,"border")][1]');await c.locator('input[type=range]').fill('33');await c.getByRole('button',{name:'色彩',exact:true}).click();const out=await generate(f.page);expect(out.referenceImages).toEqual(['/a.png','/c.png',src]);expect(out.referenceDescriptions).toEqual(['甲描述','丙描述','']);expect(out.referenceStrengths).toEqual([15,90,33]);expect(out.referenceCategories).toEqual({'0':['style'],'1':['scene'],'2':['color']});console.log('OBS 补槽',JSON.stringify({images:out.referenceImages,descriptions:out.referenceDescriptions,strengths:out.referenceStrengths,categories:out.referenceCategories}));await finish(f)}finally{await f.context.close()}},25000);
});
