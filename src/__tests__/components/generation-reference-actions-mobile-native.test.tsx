// @vitest-environment node
// Real generation panel with synthetic references and intercepted network.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser } from '@playwright/test';
import { afterAll, beforeAll, expect, it } from 'vitest';

type FixtureWindow = Window & { fixture: { mount: (mono: boolean) => void; add: (index: number) => void; unmount: () => void } };

const ENTRY = String.raw`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GenerationPanel} from '@/components/generation-panel';
const root=createRoot(document.getElementById('root'));const state={outputs:[]};
function App({mono=false}){const [ref,setRef]=useState(null);window.fixture.add=(i)=>setRef({url:i===0?'/a.png':'/b.png',description:'示例'});return <GenerationPanel themeStyle={mono?'monochrome':'gold'} onGenerate={params=>state.outputs.push(params)} externalReferenceImage={ref} onExternalReferenceImageConsumed={()=>setRef(null)} />;}
window.fixture={state,mount(mono=false){root.render(<App mono={mono}/>)},unmount(){root.unmount()}};
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
  sources.push({ content: ENTRY, extension: 'tsx' }, {content:await readFile(path.join(process.cwd(), 'src/components/generation-panel.tsx'),'utf8'),extension:'tsx'});
  const compiler = await compile(await readFile(path.join(process.cwd(), 'src/app/globals.css'), 'utf8'), { base: process.cwd(), loadStylesheet: async (id, base) => {
    const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : id === 'tw-animate-css' ? path.join(process.cwd(), 'node_modules/tw-animate-css/dist/tw-animate.css') : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
    return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
  } });
  css = compiler.build(new Scanner({}).scanFiles(sources)) + result.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });




it.each([{width:320,height:640,mono:false,mobile:true},{width:320,height:640,mono:true,mobile:true},{width:640,height:320,mono:false,mobile:true},{width:640,height:320,mono:true,mobile:true},{width:1024,height:768,mono:false,mobile:false}])('generation references $width x $height theme $mono',async({width,height,mono,mobile})=>{
 const context=await browser!.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'}),page=await context.newPage(),errors:string[]=[],requests:Array<{method:string;path:string;body:unknown}>=[];
 page.on('pageerror',e=>errors.push(e.message));await context.routeWebSocket('**/*',socket=>{errors.push('unexpected websocket');socket.close()});
 await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()),method=req.method();let body:unknown=null;try{body=req.postData()?JSON.parse(req.postData()!):null}catch{errors.push('invalid body')};requests.push({method,path:u.pathname+u.search,body});if(u.origin!=='https://font-history-fixture.invalid'||req.headers().cookie||req.headers().authorization){errors.push('unexpected network');return route.abort('blockedbyclient')};
 if(method==='GET'&&u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="root"></div>'});
 if(method==='GET'&&u.pathname==='/logo.png')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
 if(method==='GET'&&(u.pathname==='/a.png'||u.pathname==='/b.png'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
 if(method==='GET'&&u.pathname.startsWith('/api/'))return route.fulfill({json:{}});
 errors.push('unexpected request '+method+' '+u.pathname);return route.abort('blockedbyclient');});
 try{await page.goto('https://font-history-fixture.invalid/');await page.addScriptTag({content:bundle});await page.evaluate((m)=>(window as unknown as FixtureWindow).fixture.mount(m),mono);

 const prompt=page.locator('textarea').first();await prompt.fill('保留草稿');
 await page.evaluate(()=>(window as unknown as FixtureWindow).fixture.add(0));await page.locator('img[src="/a.png"]').waitFor();
 await page.evaluate(()=>(window as unknown as FixtureWindow).fixture.add(1));await page.locator('img[src="/b.png"]').waitFor();await page.mouse.move(0,0);
 const first=page.locator('img[src="/a.png"]');await first.scrollIntoViewIfNeeded();const card=first.locator('..').locator('..');const remove=card.locator('button').first();await page.waitForTimeout(250);
 if(!mobile){await card.hover();await page.waitForTimeout(250);}
 const imageHit=await first.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));});expect(imageHit).toBe(true);
 const observation=await remove.evaluate(el=>{const b=el.getBoundingClientRect();let opacity=1;for(let p:Element|null=el;p;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);return {opacity,width:b.width,height:b.height,accessible:el.getAttribute('aria-label')}});
 console.log('GENERATION_REF_ACTION',JSON.stringify({observation,requests,errors}));expect(observation.opacity).toBeGreaterThanOrEqual(.99);expect(observation.width).toBeGreaterThanOrEqual(mobile?44:16);expect(observation.height).toBeGreaterThanOrEqual(mobile?44:16);expect(observation.accessible).toContain('移除');
 await (mobile?remove.tap():remove.click());expect(await page.locator('img[src="/a.png"]').count()).toBe(0);expect(await page.locator('img[src="/b.png"]').count()).toBe(1);expect(await prompt.inputValue()).toBe('保留草稿');expect(errors).toEqual([]);await page.evaluate(()=>(window as unknown as FixtureWindow).fixture.unmount());

 }finally{await context.close()}
},25000);
