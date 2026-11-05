// @vitest-environment node
// Real prompt-template component and shipped CSS in Chromium. Only the document
// response is supplied locally. No generated UI, private state, or model calls.
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Theme = 'gold' | 'mono';
interface FixtureWindow extends Window {
  promptMobile: { mount(theme: Theme): void; unmount(): void; state: { mounts: number; closes: number; uses: string[]; disposed: boolean } };
}
interface Session {
  context: BrowserContext; page: Page; errors: string[]; counts: Map<string, number>; handlers: Set<Promise<void>>; mounted: boolean;
  pending: Set<Request>; completed: Set<Request>; failed: Set<Request>; refused: Set<Request>; nativeWaiters: Set<() => void>;
}
const ORIGIN = 'https://prompt-template-mobile.invalid';
const THEMES: readonly Theme[] = ['gold', 'mono'];
const ENTRY = String.raw`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import PromptTemplatePanel from '@/components/prompt-template-panel';
const root=createRoot(document.getElementById('fixture-root')!);
const state={mounts:0,closes:0,uses:[] as string[],disposed:false};
function Entry({theme}:{theme:'gold'|'mono'}):React.ReactElement{
 const [open,setOpen]=useState(true);
 return <PromptTemplatePanel isOpen={open} isMonochrome={theme==='mono'} isAdmin
 onClose={()=>{state.closes++;setOpen(false)}} onUseTemplate={content=>{state.uses.push(content)}}/>;
}
Object.assign(window,{promptMobile:{state,mount(theme:'gold'|'mono'){
 if(state.mounts||state.disposed)throw Error('PT_FIXTURE_REMOUNT');state.mounts++;
 document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');root.render(<Entry theme={theme}/>);
},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}}}});
`;

let browser: Browser | undefined;
let bundle = '', css = '';
const live = new Set<Session>(), contexts = new Set<BrowserContext>();

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const result = await build({ write: false, bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'prompt-template-mobile-entry.tsx' } });
  if (result.outputFiles.length !== 1) throw Error('PT_FIXTURE_MEMORY_BUNDLE');
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
  try { await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('PT_FIXTURE_CLEANUP_TIMEOUT ' + name)), 2500); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function session(theme: Theme, width: number, height: number): Promise<Session> {
  if (!browser) throw Error('PT_FIXTURE_BROWSER_REQUIRED');
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce' }); contexts.add(context);
  let value: Session | undefined;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    const s: Session = { context, page, errors: [], counts: new Map(), handlers: new Set(), mounted: false,
      pending: new Set(), completed: new Set(), failed: new Set(), refused: new Set(), nativeWaiters: new Set() }; value = s; live.add(s);
    context.on('request', request => s.pending.add(request));
    context.on('requestfinished', request => { s.pending.delete(request); s.completed.add(request); for (const notify of s.nativeWaiters) notify(); });
    context.on('requestfailed', request => { s.pending.delete(request); s.failed.add(request); for (const notify of s.nativeWaiters) notify(); });
    page.on('pageerror', error => s.errors.push(String(error)));
    page.on('dialog', dialog => { s.errors.push('PT_FIXTURE_UNEXPECTED_DIALOG'); void dialog.dismiss().catch(error => s.errors.push(String(error))); });
    await context.routeWebSocket('**/*', socket => { s.errors.push('PT_FIXTURE_UNKNOWN_WS'); socket.close({ code: 1008, reason: 'Offline fixture forbids WebSockets' }); });
    await context.route('**/*', async route => {
      const operation = (async (): Promise<void> => {
        const request = route.request(), url = new URL(request.url()), headers = request.headers();
        if (url.origin !== ORIGIN || url.username || url.password || request.method() !== 'GET' || request.postData() !== null
          || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key'] || headers['idempotency-key']) throw Error('PT_FIXTURE_HTTP_BOUNDARY');
        const key = url.pathname + url.search, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count);
        if (count !== 1) throw Error('PT_FIXTURE_HTTP_COUNT ' + key);
        if (key === '/' && request.isNavigationRequest()) {
          await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="fixture-root"></div></body></html>` }); return;
        }
        throw Error('PT_FIXTURE_UNKNOWN_HTTP ' + key);
      })().catch(async error => { s.errors.push(String(error)); s.refused.add(route.request()); await route.abort('blockedbyclient'); });
      s.handlers.add(operation); try { await operation; } finally { s.handlers.delete(operation); }
    });
    await page.goto(ORIGIN); await page.addScriptTag({ content: bundle });
    await page.evaluate(t => (window as unknown as FixtureWindow).promptMobile.mount(t), theme); s.mounted = true;
    await shell(s).waitFor({ state: 'visible' });
    await page.getByText('照片写实风格', { exact: true }).waitFor(); await settle(page);
    return s;
  } catch (error) {
    try { if (value) await dispose(value); else { await context.close(); contexts.delete(context); } }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'PT_FIXTURE_BOOTSTRAP'); }
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
  const failures: string[] = [];
  try {
    if (s.mounted) await bounded('unmount', () => s.page.evaluate(() => (window as unknown as FixtureWindow).promptMobile.unmount()));
    cleanupProbe?.(); // Used only by the cleanup-fault selftest, after real unmount.
  } catch (error) { failures.push(String(error)); }
  try { await bounded('routes', () => Promise.all([...s.handlers])); } catch (error) { failures.push(String(error)); }
  try { await nativeRequestsFinished(s); await bounded('final routes', () => Promise.all([...s.handlers])); } catch (error) { failures.push(String(error)); }
  const unresolvedBeforeClose = s.pending.size !== 0 || s.handlers.size !== 0;
  try { await s.context.close(); contexts.delete(s.context); live.delete(s); } catch (error) { failures.push(String(error)); }
  // Cleanup/lifecycle/allowlist failures can never share the expected-refusal
  // prefix. A boundary selftest must not succeed merely because close failed.
  const required = ['/'];
  const requestKeys = expectedRefusal === 'http' ? [...required, '/unexpected'].sort() : required;
  if (JSON.stringify([...s.counts.keys()].sort()) !== JSON.stringify(requestKeys) || [...s.counts.values()].some(n => n !== 1)) throw Error('PT_FIXTURE_REQUEST_VALIDATION');
  const completed = [...s.completed].map(r => `${r.method()} ${r.url()}`).sort();
  const expectedCompleted = required.map(key => `GET ${ORIGIN}${key}`).sort();
  const failed = [...s.failed];
  const validFailures = expectedRefusal === 'http'
    ? failed.length === 1 && failed[0].url() === ORIGIN + '/unexpected' && s.refused.has(failed[0])
    : failed.length === 0;
  if (unresolvedBeforeClose || s.pending.size || !validFailures || JSON.stringify(completed) !== JSON.stringify(expectedCompleted)) throw Error('PT_FIXTURE_NATIVE_REQUEST_FAILURE');
  if (expectedRefusal) {
    const expected = expectedRefusal === 'http' ? 'Error: PT_FIXTURE_UNKNOWN_HTTP /unexpected' : 'PT_FIXTURE_UNKNOWN_WS';
    if (s.errors.length !== 1 || s.errors[0] !== expected) throw Error('PT_FIXTURE_UNEXPECTED_FAILURES: ' + s.errors.join('; '));
  }
  if (failures.length) throw Error('PT_FIXTURE_CLEANUP_FAILURE: ' + failures.join('; '));
  if (s.errors.length) throw Error('PT_FIXTURE_INFRASTRUCTURE: ' + s.errors.join('; '));
}
async function withSession(theme: Theme, width: number, height: number, run: (s: Session) => Promise<void>): Promise<void> {
  const s = await session(theme, width, height); try { await run(s); } finally { await dispose(s); }
}
function shell(s: Session): Locator { return s.page.locator('#fixture-root > div > div').nth(1); }
function body(s: Session): Locator { return shell(s).locator(':scope > div').nth(2); }
function add(s: Session): Locator { return s.page.getByRole('button', { name: '新建', exact: true }); }
function close(s: Session): Locator { return shell(s).locator(':scope > div').first().getByRole('button'); }
async function target(control: Locator, minimum = 44): Promise<void> {
  const info = await control.evaluate(element => {
    const r = element.getBoundingClientRect(), own = getComputedStyle(element);
    let clear = own.visibility === 'visible' && Number(own.opacity) > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const b = parent.getBoundingClientRect(), style = getComputedStyle(parent);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (r.left < b.left + parent.clientLeft - 0.5 || r.right > b.left + parent.clientLeft + parent.clientWidth + 0.5)) clear = false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (r.top < b.top + parent.clientTop - 0.5 || r.bottom > b.top + parent.clientTop + parent.clientHeight + 0.5)) clear = false;
    }
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x: r.x, y: r.y, width: r.width, height: r.height, clear,
      hit: [[x, y], [r.left + 8, y], [r.right - 8, y], [x, r.top + 8], [x, r.bottom - 8]].every(([a, b]) => element.contains(document.elementFromPoint(a, b))) };
  });
  expect(info.clear, 'whole target visible ' + JSON.stringify(info)).toBe(true);
  expect(info.width, 'target width').toBeGreaterThanOrEqual(minimum); expect(info.height, 'target height').toBeGreaterThanOrEqual(minimum);
  expect(info.hit, 'native center and side hits').toBe(true);
}
async function nativeReveal(s: Session, scroll: Locator, control: Locator, horizontal = false): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const clip = await scroll.boundingBox(), r = await control.boundingBox(); if (!clip || !r) throw Error('PT_FIXTURE_SCROLL_RECT');
    const start = horizontal ? r.x : r.y, size = horizontal ? r.width : r.height, bound = horizontal ? clip.x : clip.y, available = horizontal ? clip.width : clip.height;
    if (start >= bound + 1 && start + size <= bound + available - 1) return;
    expect(available, 'scroller fits target').toBeGreaterThanOrEqual(size + 2);
    const delta = start < bound + 1 ? Math.floor(start - bound - 2) : Math.ceil(start + size - bound - available + 2);
    await s.page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2); await s.page.mouse.wheel(horizontal ? delta : 0, horizontal ? 0 : delta); await settle(s.page);
  }
  throw Error('PT_FIXTURE_NATIVE_SCROLL_UNREACHED');
}
async function singleLine(control: Locator): Promise<void> {
  await target(control, 0);
  const text = await control.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const tops: number[] = []; let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim() || node.parentElement?.closest('svg')) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      tops.push(...[...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top)));
    }
    return { lines: new Set(tops).size, clipped: element.scrollWidth > element.clientWidth + 1 };
  });
  expect(text.lines, 'horizontal title').toBe(1); expect(text.clipped, 'title not clipped').toBe(false);
}

async function checkLayout(s: Session, mobile = true): Promise<void> {
  await target(add(s), mobile ? 44 : 0); await target(close(s), mobile ? 44 : 0);
  await singleLine(add(s));
  await target(s.page.getByPlaceholder('搜索模板...'), mobile ? 44 : 0);
  await target(s.page.getByRole('combobox'), mobile ? 44 : 0);
  expect(await shell(s).evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'shell no horizontal leak').toBe(true);
  await target(shell(s).locator(':scope > div').last(), 0);
}
async function snapshot(s: Session): Promise<string | null> {
  return s.page.evaluate(() => localStorage.getItem('wujie_prompt_templates'));
}
async function formFlow(s: Session, mobile = true): Promise<void> {
  const stored = await snapshot(s); await add(s).click();
  const name=s.page.getByPlaceholder('例如：照片写实风格'); await nativeReveal(s,body(s),name); await target(name,mobile?44:0); await name.fill('只读取消草稿');
  const category=s.page.getByPlaceholder('例如：风格、场景、人物'); await nativeReveal(s,body(s),category); await target(category,mobile?44:0); await category.fill('长分类不提交');
  const content=s.page.getByPlaceholder('A highly detailed image of {subject}, professional photography...'); await nativeReveal(s,body(s),content); await target(content,mobile?44:0);
  const tags=s.page.getByPlaceholder('写实, 摄影, 高清'); await nativeReveal(s,body(s),tags); await target(tags,mobile?44:0);
  const upload=s.page.getByRole('button',{name:'上传图片',exact:true}); await nativeReveal(s,body(s),upload); await target(upload,mobile?44:0);
  const global=shell(s).locator('label').filter({hasText:'全局模板（所有用户可见）'}); await nativeReveal(s,body(s),global); await target(global,mobile?44:0);
  const save=s.page.getByRole('button',{name:'保存',exact:true}); await nativeReveal(s,body(s),save); await target(save,mobile?44:0); expect(await save.isDisabled()).toBe(true);
  const cancel=s.page.getByRole('button',{name:'取消',exact:true}); await nativeReveal(s,body(s),cancel); await target(cancel,mobile?44:0); await cancel.click();
  expect(await name.count()).toBe(0); expect(await snapshot(s)).toBe(stored);
}
describe('mobile prompt template layout',()=>{
 it.each(THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height}))))
 ('$theme $width x $height keeps every toolbar action inside the window',async({theme,width,height})=>{
  await withSession(theme,width,height,async s=>{
   const directory=path.resolve('output/mobile-ui/prompt-template-native-20261018',String(process.pid));await mkdir(directory,{recursive:true});
   const file=path.join(directory,theme+'-'+width+'x'+height+'.png');await s.page.screenshot({path:file});console.log('PROMPT_TEMPLATE_NATIVE_CAPTURE',JSON.stringify({path:file,theme,width,height,physicalTouch:false}));
   await checkLayout(s);
   await close(s).click();expect(await shell(s).count()).toBe(0);
  });
 },25000);
});
describe('prompt template mobile interaction',()=>{
 it.each(THEMES)('%s supports native new and edit cancellation without storage writes',async theme=>{
  await withSession(theme,320,640,async s=>{
   await checkLayout(s);const stored=await snapshot(s);await formFlow(s);
   const search=s.page.getByPlaceholder('搜索模板...');await search.fill('不存在的模板XYZ');await s.page.getByText('暂无模板',{exact:true}).waitFor();await search.fill('');
   await s.page.getByRole('combobox').selectOption('人物');await s.page.getByText('人像摄影',{exact:true}).waitFor();expect(await s.page.getByText('照片写实风格',{exact:true}).count()).toBe(0);
   await s.page.getByRole('combobox').selectOption('');
   const edit=s.page.getByTitle('编辑',{exact:true}).first();await nativeReveal(s,body(s),edit);await s.page.mouse.move(0,0);await settle(s.page);
   expect(await edit.evaluate(e=>e.closest('.group')!.matches(':hover'))).toBe(false);
   await target(edit);expect(await edit.evaluate(e=>Number(getComputedStyle(e.parentElement!).opacity))).toBe(1);
   const remove=s.page.getByTitle('删除',{exact:true}).first();await target(remove);await edit.click();
   const name=s.page.getByPlaceholder('例如：照片写实风格');await nativeReveal(s,body(s),name);expect(await name.inputValue()).toBe('照片写实风格');
   const cancel=s.page.getByRole('button',{name:'取消',exact:true});await nativeReveal(s,body(s),cancel);await cancel.click();expect(await snapshot(s)).toBe(stored);
   expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).promptMobile.state.uses.length)).toBe(0);
  });
 },25000);
});
describe('prompt template mobile selection',()=>{
 it.each(THEMES)('%s uses a template without hover and closes exactly once',async theme=>{
  await withSession(theme,320,640,async s=>{
   const stored=await snapshot(s),use=s.page.getByTitle('使用模板',{exact:true}).first();await nativeReveal(s,body(s),use);await s.page.mouse.move(0,0);await settle(s.page);
   expect(await use.evaluate(e=>e.closest('.group')!.matches(':hover'))).toBe(false);await target(use);
   expect(await use.evaluate(e=>Number(getComputedStyle(e.parentElement!).opacity))).toBe(1);await use.click();
   const result=await s.page.evaluate(()=>(window as unknown as FixtureWindow).promptMobile.state);
   expect(result.uses).toEqual(['A highly detailed, photorealistic image of {subject}, professional photography, 8k resolution, sharp focus, natural lighting, {style}, masterpiece quality']);
   expect(result.closes).toBe(1);expect(await shell(s).count()).toBe(0);expect(await snapshot(s)).toBe(stored);
  });
 },25000);
});
describe('prompt template orientation',()=>{
 it.each(THEMES)('%s preserves the form when the window rotates',async theme=>{
  await withSession(theme,390,844,async s=>{
   await add(s).click();const name=s.page.getByPlaceholder('例如：照片写实风格');await name.fill('旋转草稿');const stored=await snapshot(s);
   for(const [width,height] of [[640,320],[320,640]]){await s.page.setViewportSize({width,height});await settle(s.page);await checkLayout(s);await nativeReveal(s,body(s),name);expect(await name.inputValue()).toBe('旋转草稿');}
   expect(await snapshot(s)).toBe(stored);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).promptMobile.state.mounts)).toBe(1);
  });
 },25000);
});
describe('prompt template desktop compatibility',()=>{
 it.each(THEMES)('%s preserves desktop list, form and selection',async theme=>{
  await withSession(theme,1440,900,async s=>{
   await checkLayout(s,false);await formFlow(s,false);const stored=await snapshot(s);
   const use=s.page.getByTitle('使用模板',{exact:true}).first();await nativeReveal(s,body(s),use);await use.hover();await use.click();
   const result=await s.page.evaluate(()=>(window as unknown as FixtureWindow).promptMobile.state);
   expect(result.closes).toBe(1);expect(result.uses).toHaveLength(1);expect(result.uses[0]).toContain('{subject}');expect(await snapshot(s)).toBe(stored);
  });
 },25000);
});
describe('prompt template fixture boundary', () => {
  it.each(['http', 'websocket'] as const)('refuses %s and classifies it as infrastructure', async transport => {
    const s = await session('gold', 390, 844);
    try {
      if (transport === 'http') expect(await s.page.evaluate(async () => { try { await fetch('/unexpected'); return false; } catch { return true; } })).toBe(true);
      else expect(await s.page.evaluate(() => new Promise<number>((resolve, reject) => {
        const socket = new WebSocket('wss://unexpected.invalid/'); const timer = setTimeout(() => reject(Error('PT_FIXTURE_WS_NOT_REFUSED')), 3000);
        socket.onclose = event => { clearTimeout(timer); resolve(event.code); };
      }))).toBe(1008);
      let failure: unknown; try { await dispose(s, transport); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error); expect((failure as Error).name).toBe('Error');
      expect((failure as Error).message).toBe(transport === 'http'
        ? 'PT_FIXTURE_INFRASTRUCTURE: Error: PT_FIXTURE_UNKNOWN_HTTP /unexpected'
        : 'PT_FIXTURE_INFRASTRUCTURE: PT_FIXTURE_UNKNOWN_WS');
    } finally { if (live.has(s)) { await s.context.close(); contexts.delete(s.context); live.delete(s); } }
  }, 25000);
});

describe('prompt template fixture cleanup isolation', () => {
  it.each(['http', 'websocket'] as const)('cannot absorb a cleanup fault into expected %s refusal', async transport => {
    const s = await session('gold', 390, 844);
    try {
      if (transport === 'http') await s.page.evaluate(async () => { try { await fetch('/unexpected'); } catch { /* expected refusal */ } });
      else await s.page.evaluate(() => new Promise<void>((resolve, reject) => {
        const socket = new WebSocket('wss://unexpected.invalid/'); const timer = setTimeout(() => reject(Error('PT_FIXTURE_WS_NOT_REFUSED')), 3000);
        socket.onclose = () => { clearTimeout(timer); resolve(); };
      }));
      let failure: unknown;
      try { await dispose(s, transport, () => { throw Error('PT_FIXTURE_INJECTED_CLEANUP'); }); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe('PT_FIXTURE_CLEANUP_FAILURE: Error: PT_FIXTURE_INJECTED_CLEANUP');
      expect(live.has(s)).toBe(false); expect(contexts.has(s.context)).toBe(false);
    } finally { if (live.has(s)) { await s.context.close(); contexts.delete(s.context); live.delete(s); } }
  }, 25000);
});

