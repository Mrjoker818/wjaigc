// @vitest-environment node
// Real InfiniteCanvas, real browser/CSS, normal toolbar entry. No generated 3D
// modal DOM, private state injection, forced clicks, paid generation or services.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Route } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Theme = 'gold' | 'mono';
interface CanvasState { mounts: number; disposed: boolean; images: unknown[]; selected: string | null }
interface FixtureWindow extends Window {
  threeDMobile: { state: CanvasState; png: string; mount(theme: Theme): void; unmount(): void };
}
interface Session {
  context: BrowserContext; page: Page; errors: string[]; counts: Map<string, number>;
  requests: string[]; handlers: Set<Promise<void>>; png: Buffer; mounted: boolean; dialogs: string[];
}
const ORIGIN = 'https://three-d-mobile.invalid';
const ACTOR = 'three-d-mobile-user';
const THEMES: readonly Theme[] = ['gold', 'mono'];
const ENTRY = String.raw`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {InfiniteCanvas,type CanvasImage} from '@/components/infinite-canvas';
import {taskEventsClient} from '@/lib/task-events-client';
const root=createRoot(document.getElementById('fixture-root')!);
const image=document.createElement('canvas');image.width=64;image.height=64;
const ctx=image.getContext('2d');if(!ctx)throw Error('THREE_D_CANVAS2D_REQUIRED');
ctx.fillStyle='#d17a35';ctx.fillRect(0,0,64,64);const png=image.toDataURL();
const source={id:'three-d-mobile-source',url:png,x:180,y:180,width:96,height:96,
  originalWidth:64,originalHeight:64,prompt:'离线来源',assetVersionId:'three-d-mobile-version',createdAt:1,zIndex:1};
const state={mounts:0,disposed:false,images:[] as CanvasImage[],selected:null as string|null};
function Entry({theme}:{theme:'gold'|'mono'}):React.ReactElement{
 const [images,setImages]=useState<CanvasImage[]>([source]);
 const [selected,setSelected]=useState<CanvasImage|null>(null);state.images=images;state.selected=selected?.id||null;
 return <InfiniteCanvas images={images} selectedImage={selected} projectId="three-d-mobile-project" isPanelCollapsed
 themeStyle={theme==='mono'?'monochrome':'gold'} initialViewState={{offsetX:0,offsetY:0,zoom:1}}
 onImagesChange={setImages} onSelectImage={setSelected} onPreviewImage={()=>{}} onGenerateVariation={()=>{}}
 onExtractKeywords={()=>{}} onFusion={()=>{}} onAddImages={()=>{throw Error('THREE_D_UNEXPECTED_PUBLISH')}}/>;
}
Object.assign(window,{threeDMobile:{state,png,mount(theme:'gold'|'mono'){
 if(state.mounts||state.disposed)throw Error('THREE_D_REMOUNT_FORBIDDEN');state.mounts++;
 document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');root.render(<Entry theme={theme}/>);
},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}taskEventsClient.disconnect();}}});
`;
let browser: Browser | undefined;
let bundle = '', css = '';
const live = new Set<Session>();
const contexts = new Set<BrowserContext>();

beforeAll(async () => {
  // Same native loader and exact installed Next/ag-psd browser boundaries as the
  // reviewed additional-tools-b aspect host. No component or hook replacements.
  if (typeof process.getBuiltinModule !== 'function') throw Error('THREE_D_NATIVE_LOADER_REQUIRED');
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
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'three-d-mobile-entry.tsx' },
  });
  if (result.outputFiles.length !== 1) throw Error('THREE_D_MEMORY_BUNDLE_REQUIRED');
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
  const failures: string[] = [];
  for (const s of live) { try { await dispose(s); } catch (error) { failures.push(String(error)); } }
  for (const context of contexts) { try { await context.close(); contexts.delete(context); } catch (error) { failures.push(String(error)); } }
  try { await browser?.close(); } finally { browser = undefined; }
  if (failures.length) throw Error(failures.join('\n'));
}, 15000);

async function serve(s: Session, route: Route): Promise<void> {
  const r = route.request(), u = new URL(r.url()), key = `${r.method()} ${u.pathname}${u.search}`, h = r.headers();
  s.requests.push(key);
  if (u.origin !== ORIGIN || u.username || u.password || r.postData() !== null || r.method() !== 'GET'
    || h.authorization || h['x-api-key'] || h['api-key'] || h['idempotency-key'] || h['x-user-id']) throw Error('THREE_D_HTTP_BOUNDARY');
  const n = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, n);
  if (n > (['GET /api/session', 'GET /api/auth/me', 'GET /api/task-events'].includes(key) ? 6 : 2)) throw Error('THREE_D_HTTP_COUNT');
  if (key === 'GET /' && r.isNavigationRequest()) {
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;width:100vw;height:100dvh;overflow:hidden"><div id="fixture-root" style="position:relative;width:100%;height:100%"></div></body></html>` }); return;
  }
  if (['GET /api/session', 'GET /api/auth/me'].includes(key)) {
    await route.fulfill({ json: { success: true, user: { id: ACTOR, username: '离线用户', role: 'user' } } }); return;
  }
  if (key === 'GET /api/task-events') {
    await route.fulfill({ status: 503, json: { success: false, error: 'OFFLINE_FIXTURE_EVENTS_UNAVAILABLE' } }); return;
  }
  if (key === 'GET /api/models?type=3d') {
    await route.fulfill({ json: { success: true, capabilityCatalogVersion: 1, providers: [], models: [], taskModelCatalog: [],
      modelAuthorizationMigration: { resolved: [], required: [] }, quickCreatePolicy: { autoModelRouting: false, globalDefault: '', quickCreateDefault: '' } } }); return;
  }
  if (['GET /api/upscayl', 'GET /api/models?type=upscaler', 'GET /api/models?type=removebg'].includes(key)) {
    await route.fulfill({ json: key === 'GET /api/upscayl' ? { available: false, models: [] } : { success: true, providers: [], models: [] } }); return;
  }
  if (key === 'GET /logo.png') { await route.fulfill({ contentType: 'image/png', body: s.png }); return; }
  throw Error(`THREE_D_UNKNOWN_HTTP ${key}`);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}
function modal(s: Session): Locator { return s.page.locator('[data-modal="3d-conversion"] > div'); }
function header(s: Session): Locator { return modal(s).locator(':scope > div').nth(0); }
function body(s: Session): Locator { return modal(s).locator(':scope > div').nth(1); }
function footer(s: Session): Locator { return modal(s).locator(':scope > div').nth(2); }
async function openModal(s: Session): Promise<void> {
  const mobile = s.page.locator('[data-mobile-canvas-toolbar]');
  if (await mobile.isVisible()) {
    await mobile.getByRole('button', { name: '全部工具', exact: true }).click();
    await s.page.getByRole('dialog', { name: '全部工具', exact: true }).getByRole('button', { name: '图转3D工厂', exact: true }).click();
  } else {
    await s.page.locator('[data-toolbar="bottom-toolbar"]').getByRole('button', { name: '全部工具', exact: true }).click();
    await s.page.locator('[data-bottom-toolbar-drawer]').getByRole('button', { name: '图转3D工厂', exact: true }).click();
  }
  await modal(s).waitFor({ state: 'visible' }); await settle(s.page);
}
async function session(theme: Theme, width: number, height: number): Promise<Session> {
  if (!browser) throw Error('THREE_D_BROWSER_REQUIRED');
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  contexts.add(context);
  let s: Session | undefined;
  try {
  const page = await context.newPage(); page.setDefaultTimeout(1500);
  const current: Session = { context, page, errors: [], counts: new Map(), requests: [], handlers: new Set(), png: Buffer.alloc(0), mounted: false, dialogs: [] };
  s = current; live.add(current);
  page.on('pageerror', error => current.errors.push(String(error)));
  // Always dismiss alerts/confirmation before any assertion; the AI confirmation
  // is denied. A failed message assertion cannot strand a blocking browser dialog.
  page.on('dialog', dialog => {
    current.dialogs.push(dialog.message());
    const operation = dialog.dismiss().catch(error => { current.errors.push(String(error)); });
    current.handlers.add(operation); void operation.finally(() => current.handlers.delete(operation));
  });
  await context.routeWebSocket('**/*', socket => { current.errors.push('THREE_D_UNKNOWN_WEBSOCKET'); socket.close({ code: 1008, reason: 'Offline fixture forbids WebSockets' }); });
  await context.route('**/*', async route => {
    const operation = serve(current, route).catch(async error => { current.errors.push(String(error)); await route.abort('blockedbyclient'); });
    current.handlers.add(operation); try { await operation; } finally { current.handlers.delete(operation); }
  });
  await context.addInitScript(({ actor }) => {
    const user = { id: actor, username: '离线用户', password: '', role: 'user', status: 'active', createdAt: 1, updatedAt: 1 };
    localStorage.setItem('unbounded_ai_current_user', actor);
    localStorage.setItem('unbounded_ai_user_data', JSON.stringify({ users: [user], userData: { [actor]: { user, projects: [], apiKeys: [], usageStats: [] } } }));
  }, { actor: ACTOR });
    await page.goto(ORIGIN); await page.addScriptTag({ content: bundle });
    current.png = Buffer.from((await page.evaluate(() => (window as unknown as FixtureWindow).threeDMobile.png)).split(',')[1], 'base64');
    await page.evaluate(t => (window as unknown as FixtureWindow).threeDMobile.mount(t), theme); current.mounted = true;
    await page.locator('[data-canvas-viewport]').waitFor(); await openModal(current); return current;
  } catch (error) {
    try { if (s) await dispose(s); else { await context.close(); contexts.delete(context); } }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'THREE_D_BOOTSTRAP'); }
    throw error;
  }
}
async function boundedCleanup(name: string, work: () => Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`THREE_D_CLEANUP_TIMEOUT ${name}`)), 2500); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function dispose(s: Session): Promise<void> {
  const failures: unknown[] = [];
  try { if (s.mounted) await boundedCleanup('unmount', () => s.page.evaluate(() => (window as unknown as FixtureWindow).threeDMobile.unmount())); }
  catch (error) { failures.push(error); }
  try { await boundedCleanup('routes', () => Promise.all([...s.handlers])); } catch (error) { failures.push(error); }
  try { await s.context.close(); live.delete(s); contexts.delete(s.context); } catch (error) { failures.push(error); }
  if (s.errors.length || failures.length) throw Error(`THREE_D_FIXTURE_INFRASTRUCTURE: ${s.errors.join('; ')} ${failures.map(String).join('; ')}`);
  if (s.requests.some(request => !request.startsWith('GET '))) throw Error('THREE_D_UNEXPECTED_SUBMISSION');
}
async function withSession(theme: Theme, width: number, height: number, run: (s: Session) => Promise<void>): Promise<void> {
  const s = await session(theme, width, height); try { await run(s); } finally { await dispose(s); }
}
async function target(control: Locator, touch = true): Promise<void> {
  const result = await control.evaluate(element => {
    const r = element.getBoundingClientRect(), own = getComputedStyle(element);
    let clear = own.visibility === 'visible' && Number(own.opacity) > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    for (let p = element.parentElement; p; p = p.parentElement) {
      const b = p.getBoundingClientRect(), st = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(st.overflowX) && (r.left < b.left + p.clientLeft - 0.5 || r.right > b.left + p.clientLeft + p.clientWidth + 0.5)) clear = false;
      if (/(auto|scroll|hidden|clip)/.test(st.overflowY) && (r.top < b.top + p.clientTop - 0.5 || r.bottom > b.top + p.clientTop + p.clientHeight + 0.5)) clear = false;
    }
    // Rounded corners are not promised hit area. Check the native center and all
    // four side interiors; keep full-rectangle viewport/ancestor clipping above.
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const points = [[r.left + 8, y], [r.right - 8, y], [x, r.top + 8], [x, r.bottom - 8], [x, y]];
    return { x: r.x, y: r.y, width: r.width, height: r.height, clear, hit: points.every(([x, y]) => element.contains(document.elementFromPoint(x, y))) };
  });
  expect(result.clear, `complete control visible ${JSON.stringify(result)}`).toBe(true);
  expect(result.hit, 'native center and inset-edge hits').toBe(true);
  if (touch) { expect(result.height).toBeGreaterThanOrEqual(44); expect(result.width).toBeGreaterThanOrEqual(44); }
}
async function fixedActions(s: Session): Promise<void> {
  await target(footer(s).getByRole('button', { name: '取消', exact: true }));
  await target(footer(s).getByRole('button', { name: '开始转换', exact: true }));
  const close = header(s).getByRole('button'); await target(close);
  expect(await close.getAttribute('aria-label')).toBe('关闭图转3D工厂');
  const r = await modal(s).boundingBox();
  expect(r!.x).toBeGreaterThanOrEqual(8); expect(r!.y).toBeGreaterThanOrEqual(8);
}
async function nativeReveal(s: Session, control: Locator): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const clip = await body(s).boundingBox(), r = await control.boundingBox();
    if (!clip || !r) throw Error('THREE_D_SCROLL_GEOMETRY');
    if (r.y >= clip.y + 1 && r.y + r.height <= clip.y + clip.height - 1) return;
    expect(clip.height, 'body can fit the target').toBeGreaterThanOrEqual(r.height + 2);
    await s.page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2);
    await s.page.mouse.wheel(0, r.y < clip.y + 1 ? Math.floor(r.y - clip.y - 2) : Math.ceil(r.y + r.height - clip.y - clip.height + 2));
    await settle(s.page);
  }
  throw Error('THREE_D_NATIVE_SCROLL_UNREACHED');
}
async function state(s: Session): Promise<CanvasState> { return s.page.evaluate(() => (window as unknown as FixtureWindow).threeDMobile.state); }
async function mode(s: Session, name: string): Promise<void> {
  const accessible = ({ '单图转3D': '🖼 单图转3D', '多图转3D': '📷 多图转3D', '文生3D': '✏️ 文生3D' } as Record<string, string>)[name] ?? name;
  const plain = body(s).getByRole('button', { name, exact: true });
  const control = accessible === name ? plain : plain.or(body(s).getByRole('button', { name: accessible, exact: true }));
  await nativeReveal(s, control); await target(control); await control.click(); await settle(s.page);
}
async function bodyTargets(s: Session): Promise<void> {
  const controls = body(s).locator('button, select, input:not([type="file"]), textarea, div.cursor-pointer');
  for (let index = 0; index < await controls.count(); index++) {
    const control = controls.nth(index); if (!await control.isVisible()) continue;
    await nativeReveal(s, control); await target(control);
  }
}

describe('mobile 3d layout', () => {
  it.each(THEMES.flatMap(theme => [[320, 640], [390, 844], [640, 320], [1440, 900]].map(([width, height]) => ({ theme, width, height }))))
  ('$theme $width x $height keeps footer, modes and settings reachable', async ({ theme, width, height }) => {
    await withSession(theme, width, height, async s => {
      const before = await state(s), sourceRect = await s.page.locator('[data-canvas-image-id="three-d-mobile-source"]').boundingBox();
      await fixedActions(s);
      for (const name of ['单图转3D', '多图转3D', '文生3D']) {
        await mode(s, name); const last = body(s).getByText('姿态', { exact: true }).locator('..');
        await nativeReveal(s, last); await target(last, false); await bodyTargets(s); await fixedActions(s);
      }
      await mode(s, '本地模型');
      const endpoint = body(s).getByPlaceholder('http://127.0.0.1:7860/api/image-to-3d');
      await nativeReveal(s, endpoint); await target(endpoint);
      await bodyTargets(s);
      await mode(s, 'API 大模型');
      const provider = body(s).locator('select').first(); await nativeReveal(s, provider); await target(provider);
      expect(await state(s)).toEqual(before);
      expect(await s.page.locator('[data-canvas-image-id="three-d-mobile-source"]').boundingBox()).toEqual(sourceRect);
      expect(await s.page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);
      await footer(s).getByRole('button', { name: '取消', exact: true }).click(); expect(await modal(s).count()).toBe(0);
    });
  }, 25000);

  it.each(THEMES)('%s retains prompt and mode through portrait and short landscape', async theme => {
    await withSession(theme, 390, 844, async s => {
      await mode(s, '文生3D'); const prompt = body(s).locator('textarea'); await nativeReveal(s, prompt); await prompt.fill('保留同一窗口中的离线草稿');
      await mode(s, '本地模型');
      const localModel = body(s).locator('select').first(); await nativeReveal(s, localModel); await localModel.selectOption({ label: 'TripoSR' });
      const endpoint = body(s).getByPlaceholder('http://127.0.0.1:7860/api/image-to-3d'); await nativeReveal(s, endpoint); await endpoint.fill('http://offline.invalid/three-d');
      const saved = await body(s).locator('select').evaluateAll(elements => elements.map(element => (element as HTMLSelectElement).value));
      for (const [width, height] of [[640, 320], [320, 640], [1440, 900]]) {
        await s.page.setViewportSize({ width, height }); await settle(s.page); await fixedActions(s);
        expect(await prompt.inputValue()).toBe('保留同一窗口中的离线草稿'); expect((await state(s)).mounts).toBe(1);
        expect(await endpoint.inputValue()).toBe('http://offline.invalid/three-d');
        expect(await body(s).locator('select').evaluateAll(elements => elements.map(element => (element as HTMLSelectElement).value))).toEqual(saved);
      }
      await header(s).getByRole('button', { name: '关闭图转3D工厂', exact: true }).click(); expect(await modal(s).count()).toBe(0);
    });
  }, 25000);
});

describe('mobile 3d interaction', () => {
  it.each(THEMES)('%s refuses empty generation and keeps normal exit paths', async theme => {
    await withSession(theme, 320, 640, async s => {
      for (const [name, message] of [['单图转3D', '请先选择或上传一张图片'], ['多图转3D', '请至少上传一张图片'], ['文生3D', '请输入3D模型描述']]) {
        await mode(s, name); await fixedActions(s);
        await footer(s).getByRole('button', { name: '开始转换', exact: true }).click();
        expect(s.dialogs.at(-1)).toBe(message); await fixedActions(s);
      }
      await modal(s).click({ position: { x: 3, y: 3 } }); expect(await modal(s).count()).toBe(1);
      await s.page.keyboard.press('Escape'); expect(await modal(s).count()).toBe(0);
      await openModal(s); await s.page.locator('[data-modal="3d-conversion"]').click({ position: { x: 1, y: 1 } });
      expect(await modal(s).count()).toBe(0); expect((await state(s)).images).toHaveLength(1);
    });
  }, 25000);
});

describe('mobile 3d fixture boundary', () => {
  it.each(['http', 'websocket'] as const)('refuses %s as infrastructure rather than layout RED', async transport => {
    const s = await session('gold', 390, 844);
    try {
      if (transport === 'http') {
        expect(await s.page.evaluate(async () => { try { await fetch('/not-admitted'); return false; } catch { return true; } })).toBe(true);
      } else {
        const code = await s.page.evaluate(() => new Promise<number>((resolve, reject) => {
          const socket = new WebSocket('wss://not-admitted.invalid/'); const timer = setTimeout(() => reject(Error('THREE_D_WS_NOT_REFUSED')), 3000);
          socket.onclose = event => { clearTimeout(timer); resolve(event.code); };
        })); expect(code).toBe(1008);
      }
      let failure: unknown; try { await dispose(s); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error); expect((failure as Error).name).toBe('Error');
      expect((failure as Error).message).toMatch(/^THREE_D_FIXTURE_INFRASTRUCTURE:/);
    } finally { if (live.has(s)) { await s.context.close(); live.delete(s); contexts.delete(s.context); } }
  }, 25000);
});

describe('mobile 3d hit policy', () => {
  it('uses native center and side interiors of the real rounded footer control', async () => {
    await withSession('gold', 1440, 900, async s => {
      const sample = await footer(s).getByRole('button', { name: '取消', exact: true }).evaluate(element => {
        const r = element.getBoundingClientRect(), inside = (x: number, y: number): boolean => element.contains(document.elementFromPoint(x, y));
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        return { radius: getComputedStyle(element).borderTopLeftRadius,
          corners: [inside(r.x + 2, r.y + 2), inside(r.right - 2, r.bottom - 2)], center: inside(x, y),
          sideInteriors: [inside(r.x + 8, y), inside(r.right - 8, y), inside(x, r.y + 8), inside(x, r.bottom - 8)] };
      });
      console.log('THREE_D_NATIVE_ROUNDED_HIT_SAMPLE', JSON.stringify(sample));
      expect(sample.center).toBe(true); expect(sample.sideInteriors).toEqual([true, true, true, true]);
    });
  }, 25000);
});
