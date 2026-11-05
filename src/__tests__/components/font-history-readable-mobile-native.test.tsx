// @vitest-environment node
// Real FontDesignPanel and project styles, synthetic responses only.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { afterAll, beforeAll, expect, it } from 'vitest';

const ENTRY = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import FontDesignPanel from '@/components/font-design-panel';
const state={closed:0};const root=createRoot(document.getElementById('root'));window.fixture={state,mount(mono=false){root.render(<FontDesignPanel isMonochrome={mono} onClose={()=>state.closed++} onAddImages={()=>{throw Error('UNEXPECTED_ADD_IMAGES')}} />)},unmount(){root.unmount()}};
`;
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
  sources.push({ content: ENTRY, extension: 'tsx' }, { content: await readFile(path.resolve('src/components/font-design-panel.tsx'), 'utf8'), extension: 'tsx' });
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), { base: process.cwd(), loadStylesheet: async (id, base) => {
    const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : id === 'tw-animate-css' ? path.join(process.cwd(), 'node_modules/tw-animate-css/dist/tw-animate.css') : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
    return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
  } });
  css = compiler.build(new Scanner({}).scanFiles(sources)) + result.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

async function visibleTarget(page: Page, target: Locator): Promise<void> {
  await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const rect = await target.boundingBox(); if (!rect) throw Error('SIMPLE_CREATE_TARGET_MISSING');
  const viewport = page.viewportSize()!;
  expect(rect.width).toBeGreaterThanOrEqual(44);
  expect(rect.height).toBeGreaterThanOrEqual(44);
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 0.5);
  expect(await target.evaluate(element => { const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
}




interface FixtureState { closed:number }
interface FixtureWindow extends Window { fixture: {state: FixtureState; mount(mono?: boolean): void; unmount(): void}; clip: string[] }
async function setup(mode:'portrait'|'short', titles:string[], mono=false) {
 const viewport=mode==='portrait'?{width:320,height:640}:{width:640,height:320};const context=await browser!.newContext({viewport,isMobile:true,hasTouch:true,serviceWorkers:'block'});const page=await context.newPage(),errors:string[]=[],requests:Array<{method:string;path:string;body:unknown}>=[];
 await context.addInitScript(()=>{(window as unknown as FixtureWindow).clip=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as unknown as FixtureWindow).clip.push(text)}}})});
 page.on('pageerror',e=>errors.push(e.message));await context.routeWebSocket('**/*',socket=>{errors.push('unexpected websocket');socket.close()});
 await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()),method=req.method();let body:{text?:string}|null=null;try{body=req.postData()?JSON.parse(req.postData()!):null}catch{errors.push('invalid body')};requests.push({method,path:u.pathname+u.search,body});if(u.origin!=='https://font-history-fixture.invalid'||req.headers().cookie||req.headers().authorization||req.headers()['x-api-key']){errors.push('unexpected network');return route.abort('blockedbyclient')};
 if(method==='GET'&&u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="root"></div>'});
 if(method==='GET'&&u.pathname==='/logo.png')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
 if(method==='GET'&&u.pathname==='/api/font-design/plan')return route.fulfill({json:{styleCategories:[],scenes:[],strokeOptions:[],graphicElements:[],materials:[]}});
 if(method==='GET'&&u.pathname==='/api/models')return route.fulfill({json:{providers:[],models:[]}});
 if(method==='GET'&&u.pathname==='/api/font-design/gallery')return route.fulfill({json:{items:[],total:0,totalPages:0}});
 if(method==='POST'&&['/api/font-design/prompt','/api/font-design/generate-image'].includes(u.pathname))return route.fulfill({json:{prompt:'合成提示-'+body?.text}});
 errors.push('unexpected request '+method+' '+u.pathname);return route.abort('blockedbyclient')});
 await page.goto('https://font-history-fixture.invalid/');await page.addScriptTag({content:bundle});await page.evaluate(mono=>(window as unknown as FixtureWindow).fixture.mount(mono),mono);
 const input=page.getByPlaceholder('请输入中文标题、活动主题、封面标题或文字Logo名称');await input.waitFor();
 for(const title of titles){await input.fill(title);expect(await input.inputValue()).toBe(title);const prompt=page.getByRole('button',{name:'生成即梦提示词'});await prompt.scrollIntoViewIfNeeded();await prompt.click();await page.getByText('合成提示-'+title,{exact:true}).first().waitFor();const gen=page.getByRole('button',{name:'发送到图像生成'});await gen.scrollIntoViewIfNeeded();await gen.click();await page.getByRole('button',{name:'历史记录',exact:true}).click();await page.getByText(title,{exact:true}).waitFor();}
 return {context,page,errors,requests,input};
}
const cardFor=(page:Page,title:string)=>page.getByText(title,{exact:true}).locator('xpath=../..');
async function waitTransition(page:Page){await page.waitForTimeout(300)}
const readableCases = [
 {mode:'portrait',mono:false}, {mode:'portrait',mono:true},
 {mode:'short',mono:false}, {mode:'short',mono:true},
] as const;
it.each(readableCases)('readable history $mode mono=$mono keeps two 20-character titles and actions usable',async({mode,mono})=>{
 const titles=['第一条长历史标题用于完整展示和按钮布局测试','第二条长历史标题用于完整展示和按钮布局测试'].map(text=>text.slice(0,20));
 expect(titles.map(t=>t.length)).toEqual([20,20]);const f=await setup(mode,titles,mono);try{
 const {page}=f;const cards=titles.map(title=>cardFor(page,title));const boxes=await Promise.all(cards.map(card=>card.boundingBox()));expect(boxes.every(Boolean)).toBe(true);const ordered=boxes.map(box=>box!).sort((a,b)=>a.y-b.y);expect(ordered[0].y+ordered[0].height).toBeLessThanOrEqual(ordered[1].y+0.5);
 for(let i=0;i<titles.length;i++){
  const card=cards[i],title=page.getByText(titles[i],{exact:true});await card.scrollIntoViewIfNeeded();await waitTransition(page);
  const data=await title.evaluate(e=>{const range=document.createRange();range.selectNodeContents(e);const box=e.getBoundingClientRect(),card=e.parentElement?.parentElement?.getBoundingClientRect(),style=getComputedStyle(e);return{box:{x:box.x,y:box.y,right:box.right,bottom:box.bottom,width:box.width,height:box.height},card:{x:card?.x,y:card?.y,right:card?.right,bottom:card?.bottom},fragments:[...range.getClientRects()].map(r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom})),whiteSpace:style.whiteSpace,overflow:style.overflowX,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}});
  const viewport=page.viewportSize()!;expect(data.box.x).toBeGreaterThanOrEqual(0);expect(data.box.y).toBeGreaterThanOrEqual(0);expect(data.box.right).toBeLessThanOrEqual(viewport.width);expect(data.box.bottom).toBeLessThanOrEqual(viewport.height);
  console.log('READABLE_HISTORY_OBSERVATION',JSON.stringify({mode,mono,index:i,data}));expect(data.fragments.length).toBeGreaterThan(0);for(const fragment of data.fragments){expect(fragment.x).toBeGreaterThanOrEqual(data.box.x-0.5);expect(fragment.right).toBeLessThanOrEqual(data.box.right+0.5);expect(fragment.y).toBeGreaterThanOrEqual(data.box.y-0.5);expect(fragment.bottom).toBeLessThanOrEqual(data.box.bottom+0.5)}
  const controls=[card.getByTitle('再次生成'),card.getByTitle('复制提示词'),card.getByTitle('删除')];for(const control of controls)await visibleTarget(page,control);
  const first=await controls[0].boundingBox();expect(first).not.toBeNull();expect(data.box.right<=first!.x+0.5||data.box.bottom<=first!.y+0.5).toBe(true);
 }
 await cards[0].scrollIntoViewIfNeeded();const reuse=cards[0].getByTitle('再次生成');await reuse.tap();expect(await f.input.inputValue()).toBe(titles[0]);expect(await page.getByText(titles[1],{exact:true}).count()).toBe(1);expect(f.requests.filter(item=>item.path==='/api/font-design/generate-image')).toHaveLength(2);expect(f.errors).toEqual([]);await page.evaluate(()=>(window as unknown as FixtureWindow).fixture.unmount());
 }finally{await f.context.close()}},30000);
