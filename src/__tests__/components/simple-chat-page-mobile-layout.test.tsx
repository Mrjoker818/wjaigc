// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SimpleChatAgent, SimpleChatProject } from '@/components/simple-chat/simple-chat-types';

// Task5 is appended after the frozen 14994-byte / 22-case prefix. This suite
// runs React in Chromium; the unchanged outer jsdom hooks do not drive its UI.
// No code below is executed while preparing this fixture for controller review.
const T5_PAGE_ENTRY = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import SimpleChatPage from '@/app/simple-chat/page';
import { Providers } from '@/app/simple-chat/providers';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createIndexedDbSimpleChatEnvelopeStore } from '@/lib/simple-chat-sync-storage';

const faults: string[] = [];
const timers = new Set<number>();
const intervals = new Set<number>();
let opens = 0; let transactions = 0;
// Passive observers forward native arguments and return the native handles.
// They never change a delay, a transaction, its result, or the sync coordinator.
const setNativeTimeout = window.setTimeout.bind(window);
const clearNativeTimeout = window.clearTimeout.bind(window);
window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]): number => {
  if (typeof callback !== 'function') {
    faults.push('UNOBSERVABLE_STRING_TIMEOUT');
    return setNativeTimeout(callback, delay, ...args);
  }
  const handle = setNativeTimeout((...values: unknown[]) => {
    timers.delete(handle); Reflect.apply(callback, window, values);
  }, delay, ...args);
  timers.add(handle); return handle;
}) as typeof window.setTimeout;
window.clearTimeout = (handle?: number): void => {
  if (handle !== undefined) { timers.delete(handle); intervals.delete(handle); }
  clearNativeTimeout(handle);
};
const setNativeInterval = window.setInterval.bind(window);
const clearNativeInterval = window.clearInterval.bind(window);
window.setInterval = ((callback: TimerHandler, delay?: number, ...args: unknown[]): number => {
  const handle = setNativeInterval(callback, delay, ...args);
  intervals.add(handle); return handle;
}) as typeof window.setInterval;
window.clearInterval = (handle?: number): void => {
  if (handle !== undefined) { intervals.delete(handle); timers.delete(handle); }
  clearNativeInterval(handle);
};
const nativeOpen = IDBFactory.prototype.open;
IDBFactory.prototype.open = function (...args: Parameters<IDBFactory['open']>): IDBOpenDBRequest {
  const request = nativeOpen.apply(this, args); opens++;
  let ended = false;
  const end = (): void => { if (!ended) { ended = true; opens--; } };
  request.addEventListener('success', end, { once: true });
  request.addEventListener('error', () => { faults.push('INDEXEDDB_OPEN_ERROR'); end(); }, { once: true });
  request.addEventListener('blocked', () => { faults.push('INDEXEDDB_OPEN_BLOCKED'); }, { once: true });
  return request;
};
const nativeTransaction = IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>): IDBTransaction {
  const transaction = nativeTransaction.apply(this, args); transactions++;
  let ended = false;
  const end = (): void => { if (!ended) { ended = true; transactions--; } };
  transaction.addEventListener('complete', end, { once: true });
  transaction.addEventListener('abort', () => { faults.push('INDEXEDDB_TRANSACTION_ABORT'); end(); }, { once: true });
  transaction.addEventListener('error', () => { faults.push('INDEXEDDB_TRANSACTION_ERROR'); }, { once: true });
  return transaction;
};
window.addEventListener('unhandledrejection', event => {
  faults.push('UNHANDLED_REJECTION: ' + String(event.reason));
});
// Only keyboard viewport metrics/events are synthetic. DOMRect/Range and all
// document, layout, storage, FileReader, pointer and React behavior stay real.
const visual = Object.assign(new EventTarget(), {
  width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0,
});
Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
const settle = async (): Promise<void> => {
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
};
function navigation(kind: string, href?: string): never {
  const message = 'UNEXPECTED_NAVIGATION: ' + kind + (href ? ' ' + href : '');
  faults.push(message); throw new Error(message);
}
const router: AppRouterInstance = {
  back: () => navigation('back'), forward: () => navigation('forward'),
  refresh: () => navigation('refresh'), push: href => navigation('push', href),
  replace: href => navigation('replace', href), prefetch: href => navigation('prefetch', href),
  bfcacheId: 'task5-framework-host',
};
const root = createRoot(document.getElementById('task5-root')!);
let mounted = false; let unmounted = false;
Object.assign(window, { task5PageFixture: {
  settle,
  mount(theme: 'gold' | 'monochrome'): void {
    if (mounted || unmounted) throw new Error('TASK5_REMOUNT_FORBIDDEN');
    mounted = true;
    localStorage.setItem('simple-chat-theme', theme === 'gold' ? 'dark' : 'light');
    root.render(<AppRouterContext.Provider value={router}><Providers><SimpleChatPage /></Providers></AppRouterContext.Provider>);
  },
  async viewport(width: number, height: number, top = 0): Promise<void> {
    Object.assign(visual, { width, height, offsetLeft: 0, offsetTop: top });
    window.dispatchEvent(new Event('resize'));
    visual.dispatchEvent(new Event('resize')); visual.dispatchEvent(new Event('scroll'));
    await settle();
  },
  async unmount(): Promise<void> {
    if (!unmounted) { unmounted = true; root.unmount(); }
    // The Page's original async flush/dispose continues after this returns.
    await settle();
  },
  async envelope() {
    // Public store API, readonly; no coordinator/reference/state reflection.
    return await createIndexedDbSimpleChatEnvelopeStore().get('task5-user');
  },
  diagnostics() {
    return { faults: [...faults], timers: timers.size, intervals: intervals.size, opens, transactions };
  },
} });
`;

type T5Theme = 'gold' | 'monochrome';
type T5Variant = 'default' | 'active-agent';
type T5Locator = import('@playwright/test').Locator;
interface T5Bridge {
  mount(theme: T5Theme): void;
  settle(): Promise<void>;
  viewport(width: number, height: number, top?: number): Promise<void>;
  unmount(): Promise<void>;
  envelope(): Promise<import('@/lib/simple-chat-project-sync').SimpleChatSyncEnvelopeV1 | null>;
  diagnostics(): { faults: string[]; timers: number; intervals: number; opens: number; transactions: number };
}
declare global { interface Window { task5PageFixture?: T5Bridge } }
interface T5Session {
  context: import('@playwright/test').BrowserContext;
  page: Page;
  faults: string[];
  requests: string[];
  handlers: Set<Promise<void>>;
  fetches: Set<import('@playwright/test').Request>;
  projects: SimpleChatProject[];
  revision: number;
  ready: boolean;
  mounted: boolean;
  variant: T5Variant;
}
const T5_ORIGIN = 'https://simple-chat-task5.invalid';
const T5_URL = `${T5_ORIGIN}/simple-chat?projectId=task5-project&taskId=task5-task`;
const T5_CHAT_NAME = '同名离线聊天模型超长名称用于检查手机信息层级';
const T5_IMAGE_NAME = '同名离线图像模型超长名称用于检查模型菜单';
const T5_CHAT_ID = 'task5-chat-shared';
const T5_IMAGE_ID = 'task5-image-shared';
const T5_PROVIDERS = [{ id: 'task5-first', name: '离线供应商甲' }, { id: 'task5-second', name: '离线供应商乙' }];
const T5_PLACEHOLDER = '输入消息，Enter 发送，支持 Ctrl+V 粘贴图片';
const T5_MESSAGE = 'Task5 原会话消息保持不变';
const T5_DRAFT = 'Task5 两行未发送输入\n保留附件、模型和目标画布';
const T5_TOOLS = `textarea[placeholder="${T5_PLACEHOLDER}"] + div > button`;
const T5_SIZES = [[320, 640], [375, 667], [430, 932], [768, 600], [844, 390], [1440, 900]] as const;
const T5_LONG_AGENT: SimpleChatAgent = {
  id: 'task5-long-agent', name: 'Task5长名称智能助手用于真实手机移除按钮边界验证'.repeat(8),
  description: '仅合成账号的长名称布局夹具', systemPrompt: '仅检查布局，不执行模型或工具。',
  emoji: '🤖', tools: [], createdAt: 1, updatedAt: 1,
};

function t5Projects(): SimpleChatProject[] {
  return [{
    id: 'task5-project', name: 'Task5 真实独立聊天项目', createdAt: 1, updatedAt: 1,
    agents: [], knowledgeItems: [],
    tasks: [{ id: 'task5-task', projectId: 'task5-project', name: 'Task5 当前对话',
      model: '', providerId: '', imageModel: T5_IMAGE_ID, imageProviderId: T5_PROVIDERS[0].id,
      reasoningEffort: 'medium', responseSpeed: 'balanced', createdAt: 1, updatedAt: 1,
      messages: [{ id: 'task5-user-message', role: 'user', content: '保留此对话的公开任务身份', createdAt: 1 },
        { id: 'task5-assistant-message', role: 'assistant', content: T5_MESSAGE, createdAt: 2 }],
    }],
  }];
}

function t5Record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function t5SeedProjects(variant: T5Variant): SimpleChatProject[] {
  const projects = t5Projects();
  if (variant === 'active-agent') {
    projects[0].agents = [{ ...T5_LONG_AGENT, tools: [] }];
    projects[0].tasks[0].activeAgentId = T5_LONG_AGENT.id;
  }
  return projects;
}

// All setup is suite-scoped, with imports deferred until the controller admits
// execution. The original beforeAll/beforeEach/afterEach/afterAll remain intact.
describe('mobile simple-chat page layout', () => {
  let t5Browser: Browser | undefined;
  let t5Bundle = ''; let t5Css = '';
  let t5Validate: typeof import('@/lib/simple-chat-project-sync').validateSimpleChatProjects;
  let t5Equal: typeof import('node:util').isDeepStrictEqual;

  beforeAll(async () => {
    // Vitest's VM pool wraps even import('node:module').createRequire. Obtain
    // Node's builtin directly so esbuild uses its own native realm intrinsics.
    if (typeof process.getBuiltinModule !== 'function') throw new Error('TASK5_NATIVE_NODE_MODULE_LOADER_UNAVAILABLE');
    const { createRequire } = process.getBuiltinModule('node:module');
    const require = createRequire(import.meta.url);
    const { build } = require('esbuild') as typeof import('esbuild');
    const NativeRegExp = (require('node:vm') as typeof import('node:vm')).runInThisContext('RegExp') as RegExpConstructor;
    const [{ compile: compilePageCss }, { Scanner }, paths, utils, validation] = await Promise.all([
      import('tailwindcss'), import('@tailwindcss/oxide'),
      import('node:path'), import('node:util'), import('@/lib/simple-chat-project-sync'),
    ]);
    t5Validate = validation.validateSimpleChatProjects; t5Equal = utils.isDeepStrictEqual;
    const frozen = JSON.parse(await readFile(resolve('.superpowers/sdd/2026-10-09-sketch-to-code/android-mobile-task5-before-20261018.frozen.json'), 'utf8')) as { originalChatFontTestText: string };
    const { Buffer } = await import('node:buffer');
    const prefix = Buffer.from(frozen.originalChatFontTestText, 'utf8');
    const current = await readFile(resolve('src/__tests__/components/chat-font-mobile-layout.test.tsx'));
    if (prefix.length !== 14994 || !current.equals(prefix)) {
      throw new Error('TASK5_FROZEN_22_CASE_FILE_CHANGED');
    }
    // Use Next's own browser siblings, exactly as its browser compiler does
    // (create-compiler-aliases.js / browser-variant-modules.js). No hook mocks.
    const browserVariants = require('next/dist/build/browser-variant-modules') as { browserVariantModules: string[] };
    const variants = new Map(browserVariants.browserVariantModules.map(id => [
      require.resolve(`next/dist/${id}.js`), require.resolve(`next/dist/${id}.browser.js`),
    ]));
    const frameworkFilter = /(?:client-boundary-params|instant-samples|instant-validation[\\/]impl|navigation-dynamic-rendering|server-async-storage|unstable-rethrow)(?:\.js)?$/;
    const result = await build({
      write: false, bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
      absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json', metafile: true,
      // Explicit public framework constants only; never serialize host env.
      define: { 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_CACHE_COMPONENTS': 'false', '__dirname': '"/"' },
      // Next's client compiler provides its browser process implementation.
      // Its env is empty; never import or serialize the host process.env.
      inject: ['task5-next-client-process'],
      stdin: { contents: T5_PAGE_ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'task5-page-browser-entry.tsx' },
      plugins: [{ name: 'next-official-browser-variants', setup(builder): void {
        builder.onResolve({ filter: new NativeRegExp('^task5-next-client-process$') }, () => ({
          path: 'task5-next-client-process', namespace: 'task5-framework-host',
        }));
        builder.onLoad({ filter: new NativeRegExp('.*'), namespace: 'task5-framework-host' }, () => ({
          contents: "export { default as process } from 'next/dist/compiled/process';",
          loader: 'js', resolveDir: process.cwd(),
        }));
        builder.onResolve({ filter: new NativeRegExp(frameworkFilter.source, frameworkFilter.flags) }, args => {
          if (!args.importer) return undefined;
          const actual = createRequire(args.importer).resolve(args.path);
          const browserFile = variants.get(actual);
          return browserFile ? { path: browserFile } : undefined;
        });
      } }],
    });
    if (result.outputFiles.length !== 1) throw new Error('TASK5_EXPECTED_ONE_MEMORY_BUNDLE');
    t5Bundle = result.outputFiles[0].text;
    const compiler = await compilePageCss(await readFile(resolve('src/app/globals.css'), 'utf8'), {
      base: process.cwd(),
      loadStylesheet: async (id: string, base: string) => {
        const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
          : id === 'tw-animate-css' ? paths.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
            : require.resolve(id.startsWith('.') ? paths.resolve(base, id) : id);
        return { path: file, base: paths.dirname(file), content: await readFile(file, 'utf8') };
      },
    });
    // Scan the actual browser dependency sources, including Sidebar/Theme and
    // conditional settings, not a jsdom snapshot or a hand-picked class list.
    const inputs = Object.keys(result.metafile.inputs).filter(file => /^src[\\/]/.test(file));
    if (!inputs.includes('src/app/simple-chat/page.tsx') && !inputs.includes('src\\app\\simple-chat\\page.tsx')) {
      throw new Error('TASK5_REAL_PAGE_MISSING_FROM_BUNDLE');
    }
    const sources = await Promise.all(inputs.map(async file => ({ content: await readFile(resolve(file), 'utf8'), extension: paths.extname(file).slice(1) })));
    t5Css = compiler.build(new Scanner({}).scanFiles(sources));
    t5Browser = await chromium.launch({ headless: true });
  }, 30_000);

  afterAll(async () => { await t5Browser?.close(); });

  function validWrite(body: unknown, s: T5Session): body is { key: string; value: SimpleChatProject[]; expectedRevision: number } {
    if (!t5Record(body) || Object.keys(body).sort().join(',') !== 'expectedRevision,key,value'
      || body.key !== 'chat_simple_projects' || body.expectedRevision !== s.revision
      || !Array.isArray(body.value) || !t5Validate(body.value as SimpleChatProject[]).success) return false;
    const value = body.value as SimpleChatProject[];
    const seed = t5SeedProjects(s.variant)[0]; const next = value[0]; const nextTask = next?.tasks[0];
    return value.length === 1 && next.id === seed.id && next.name === seed.name
      && Object.keys(next).every(key => Object.keys(seed).includes(key))
      && next.createdAt === seed.createdAt && Number.isFinite(next.updatedAt) && next.updatedAt >= 1
      && next.tasks.length === 1 && nextTask.id === seed.tasks[0].id && nextTask.projectId === seed.id
      && Object.keys(nextTask).every(key => Object.keys(seed.tasks[0]).includes(key))
      && nextTask.createdAt === seed.tasks[0].createdAt && Number.isFinite(nextTask.updatedAt) && nextTask.updatedAt >= 1
      && nextTask.name === seed.tasks[0].name && t5Equal(nextTask.messages, seed.tasks[0].messages)
      && t5Equal(next.agents, seed.agents) && t5Equal(next.knowledgeItems, seed.knowledgeItems)
      && (s.variant !== 'active-agent' || (
        (nextTask.activeAgentId === T5_LONG_AGENT.id || nextTask.activeAgentId === undefined)
        && (s.projects[0].tasks[0].activeAgentId !== undefined || nextTask.activeAgentId === undefined)
        && nextTask.providerId === T5_PROVIDERS[0].id && nextTask.imageProviderId === T5_PROVIDERS[0].id
        && nextTask.reasoningEffort === seed.tasks[0].reasoningEffort
        && nextTask.responseSpeed === seed.tasks[0].responseSpeed
      ))
      && nextTask.model === T5_CHAT_ID && T5_PROVIDERS.some(provider => provider.id === nextTask.providerId)
      && nextTask.imageModel === T5_IMAGE_ID && T5_PROVIDERS.some(provider => provider.id === nextTask.imageProviderId)
      && ['low', 'medium', 'high', 'maximum'].includes(nextTask.reasoningEffort ?? '')
      && ['fast', 'balanced', 'quality'].includes(nextTask.responseSpeed ?? '');
  }

  async function t5Bounded<T>(promise: Promise<T>, label: string, milliseconds = 8_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`TASK5_OBSERVER_TIMEOUT: ${label}`)), milliseconds);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  async function t5Settle(s: T5Session): Promise<void> {
    await t5Bounded(s.page.evaluate(async () => { await window.task5PageFixture?.settle(); }), 'two native frames');
  }

  function t5RemoteProjectsMatch(stored: readonly SimpleChatProject[], remote: readonly SimpleChatProject[]): boolean {
    // IndexedDB preserves optional undefined properties; the real JSON POST
    // omits them. Compare the confirmed wire representation, not own-key shape.
    return t5Equal(JSON.parse(JSON.stringify(stored)), remote);
  }

  async function t5Idle(s: T5Session, requireEnvelope: boolean): Promise<void> {
    const deadline = Date.now() + 8_000;
    let quietSince = 0; let signature = '';
    let lastObservation: Record<string, boolean | number> | null = null;
    while (Date.now() < deadline) {
      const observation = await t5Bounded(s.page.evaluate(async ({ readEnvelope }) => {
        const fixture = window.task5PageFixture;
        if (!fixture) return null;
        const envelope = readEnvelope ? await fixture.envelope() : null;
        await fixture.settle();
        return { envelope, ...fixture.diagnostics() };
      }, { readEnvelope: requireEnvelope }), 'native storage drain');
      if (observation?.faults.length) throw new Error(observation.faults.join('\n'));
      const stored = observation?.envelope;
      const projectsMatch = stored !== null && stored !== undefined && t5RemoteProjectsMatch(stored.currentProjects, s.projects);
      const storedClean = !requireEnvelope || (stored !== null && stored !== undefined
        && stored.userId === 'task5-user' && stored.baseRevision === s.revision
        && stored.pendingOperations.length === 0 && projectsMatch);
      lastObservation = {
        routes: s.handlers.size, fetches: s.fetches.size, requireEnvelope,
        envelopePresent: stored !== null && stored !== undefined,
        userMatches: stored?.userId === 'task5-user', revisionMatches: stored?.baseRevision === s.revision,
        pendingCount: stored?.pendingOperations.length ?? -1, projectsMatch,
        timers: observation?.timers ?? -1, intervals: observation?.intervals ?? -1,
        opens: observation?.opens ?? -1, transactions: observation?.transactions ?? -1,
      };
      const clean = s.handlers.size === 0 && s.fetches.size === 0 && storedClean
        && (!observation || (observation.timers === 0 && observation.intervals === 0
          && observation.opens === 0 && observation.transactions === 0));
      const nextSignature = `${s.revision}:${s.requests.length}:${JSON.stringify(stored?.currentProjects)}`;
      if (!clean || signature !== nextSignature) { quietSince = 0; signature = nextSignature; }
      if (clean) {
        if (!quietSince) quietSince = Date.now();
        // Observe a full original 800ms debounce interval of quiescence, with
        // no native timers/open requests/transactions or in-flight HTTP left.
        if (Date.now() - quietSince >= 800) return;
      }
      await t5Settle(s);
    }
    throw new Error(`TASK5_ASYNC_TAIL_NOT_DRAINED: ${JSON.stringify(lastObservation)}`);
  }

  async function t5Dispose(s: T5Session): Promise<void> {
    const failures: string[] = [];
    try {
      if (!s.page.isClosed()) {
        await t5Bounded(s.page.evaluate(async () => { await window.task5PageFixture?.unmount(); }), 'original Page unmount');
        await t5Idle(s, s.ready);
        const diagnostics = await s.page.evaluate(() => window.task5PageFixture?.diagnostics());
        if (diagnostics?.faults.length) failures.push(...diagnostics.faults);
      } else failures.push('PAGE_CLOSED_BEFORE_DRAIN');
    } catch (error) { failures.push(`DRAIN: ${String(error)}`); }
    finally {
      try { await t5Bounded(Promise.all([...s.handlers]), 'route handlers'); }
      catch (error) { failures.push(`ROUTES: ${String(error)}`); }
      if (s.handlers.size || s.fetches.size) failures.push(`UNSETTLED_HTTP: ${s.handlers.size}/${s.fetches.size}`);
      try { await t5Bounded(s.context.close(), 'context close'); }
      catch (error) { failures.push(`CONTEXT_CLOSE: ${String(error)}`); }
    }
    if (failures.length) throw new Error(`TASK5_CLEANUP_ERROR:\n${failures.join('\n')}`);
  }

  async function t5Open(theme: T5Theme, width: number, height: number, variant: T5Variant = 'default'): Promise<T5Session> {
    if (!t5Browser) throw new Error('TASK5_BROWSER_NOT_INITIALIZED');
    const context = await t5Browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    let s: T5Session | undefined;
    // Initialization failures from newPage, event registration, route setup,
    // bootstrap and mount all close this context through the same error path.
    try {
      const browserPage = await context.newPage(); browserPage.setDefaultTimeout(2_000);
      s = { context, page: browserPage, faults: [], requests: [], handlers: new Set(), fetches: new Set(),
        projects: t5SeedProjects(variant), revision: 1, ready: false, mounted: false, variant };
      const session = s;
      browserPage.on('pageerror', error => { session.faults.push(`PAGEERROR: ${error.message}`); });
      browserPage.on('request', request => {
        if (request.resourceType() === 'fetch' || request.resourceType() === 'xhr') session.fetches.add(request);
      });
      browserPage.on('requestfinished', request => { session.fetches.delete(request); });
      browserPage.on('requestfailed', request => {
        session.fetches.delete(request);
        session.faults.push(`REQUEST_FAILED: ${request.method()} ${request.url()}`);
      });
      await context.routeWebSocket('**/*', socket => {
        session.faults.push(`UNEXPECTED_WEBSOCKET: ${socket.url()}`); socket.close();
      });
      await context.route('**/*', async route => {
        const request = route.request(); const url = request.url(); const method = request.method();
        const raw = request.postData(); session.requests.push(`${method} ${url}`);
        const handle = async (): Promise<void> => {
          if (url === T5_URL && method === 'GET' && raw === null && request.isNavigationRequest()) {
            await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${t5Css}</style></head><body><div id="task5-root"></div></body></html>` }); return;
          }
          if (method === 'GET' && raw === null && url === `${T5_ORIGIN}/api/session`) {
            await route.fulfill({ json: { success: true, user: { id: 'task5-user', name: 'Task5 离线用户', createdAt: 1, updatedAt: 1 } } }); return;
          }
          if (method === 'GET' && raw === null && url === `${T5_ORIGIN}/api/user-data/sync?key=chat_simple_projects`) {
            await route.fulfill({ json: { success: true, key: 'chat_simple_projects', value: session.projects, syncRevision: session.revision } }); return;
          }
          if (method === 'GET' && raw === null && url === `${T5_ORIGIN}/api/user-data/sync?key=projects`) {
            await route.fulfill({ json: { success: true, key: 'projects', value: [
              { id: 'task5-canvas-first', name: '第一个本地合成目标画布', images: [], createdAt: 1, updatedAt: 1 },
              { id: 'task5-canvas-second', name: '第二个名称较长的本地合成目标画布', images: [], createdAt: 1, updatedAt: 1 },
            ] } }); return;
          }
          if (method === 'GET' && raw === null && (url === `${T5_ORIGIN}/api/models?type=chat` || url === `${T5_ORIGIN}/api/models?type=image`)) {
            const chat = url.endsWith('type=chat');
            await route.fulfill({ json: { success: true, providers: T5_PROVIDERS,
              models: T5_PROVIDERS.map(provider => ({ id: chat ? T5_CHAT_ID : T5_IMAGE_ID,
                name: chat ? T5_CHAT_NAME : T5_IMAGE_NAME, providerId: provider.id, type: chat ? 'chat' : 'image' })),
            } }); return;
          }
          if (method === 'GET' && raw === null && url === `${T5_ORIGIN}/api/simple-chat/memory`) {
            await route.fulfill({ json: { memories: [] } }); return;
          }
          if (method === 'POST' && url === `${T5_ORIGIN}/api/user-data/sync`
            && request.headers()['content-type']?.split(';')[0] === 'application/json') {
            let body: unknown;
            try { body = JSON.parse(raw ?? 'null'); } catch { throw new Error('INVALID_SYNC_JSON'); }
            if (!validWrite(body, session)) throw new Error('UNEXPECTED_SYNC_BODY_OR_REVISION');
            session.projects = body.value; session.revision++;
            await route.fulfill({ json: { success: true, key: 'chat_simple_projects', syncRevision: session.revision } }); return;
          }
          throw new Error(`UNEXPECTED_HTTP: ${method} ${url}`);
        };
        const running = handle(); session.handlers.add(running);
        try { await running; }
        catch (error) {
          session.faults.push(`ROUTE_ERROR: ${String(error)}`);
          await route.abort('blockedbyclient').catch(abortError => { session.faults.push(`ABORT_ERROR: ${String(abortError)}`); });
        } finally { session.handlers.delete(running); }
      });
      await browserPage.goto(T5_URL);
      await browserPage.addScriptTag({ content: t5Bundle });
      session.mounted = true;
      await browserPage.evaluate(theme => {
        if (!window.task5PageFixture) throw new Error('TASK5_BRIDGE_MISSING');
        window.task5PageFixture.mount(theme);
      }, theme);
      // Session, Theme, original coordinator/IndexedDB, the real chat model,
      // target canvases and initial mobile Sidebar effect must all commit first.
      await browserPage.waitForFunction(({ expectedTheme, phone, placeholder }) => {
        const root = document.querySelector('#task5-root');
        const sync = root?.querySelector('[data-testid="simple-chat-sync-status"]');
        const target = root?.querySelector<HTMLSelectElement>('select[aria-label="目标画布项目"]');
        return document.documentElement.getAttribute('data-theme') === expectedTheme
          && sync?.textContent?.trim() === '已同步' && root?.querySelector(`textarea[placeholder="${placeholder}"]`)
          && root.querySelector('header')?.textContent?.includes('同名离线聊天模型超长名称用于检查手机信息层级')
          && target?.options.length === 3 && target.value === 'task5-canvas-first'
          && root.querySelectorAll('aside').length === (phone ? 0 : 1);
      }, { expectedTheme: theme === 'gold' ? 'dark' : 'light', phone: width < 768,
        placeholder: variant === 'active-agent' ? `与 ${T5_LONG_AGENT.name} 对话...` : T5_PLACEHOLDER }, { timeout: 8_000 });
      if (!session.requests.includes(`GET ${T5_ORIGIN}/api/models?type=chat`)
        || !session.requests.includes(`GET ${T5_ORIGIN}/api/models?type=image`)
        || !session.requests.includes(`GET ${T5_ORIGIN}/api/simple-chat/memory`)) {
        throw new Error('TASK5_PUBLIC_CATALOG_OR_MEMORY_INITIALIZATION_MISSING');
      }
      session.ready = true;
      await t5Idle(session, true);
      if (session.faults.length) throw new Error(session.faults.join('\n'));
      return session;
    } catch (error) {
      let cleanupError: unknown;
      try { if (s) await t5Dispose(s); else await t5Bounded(context.close(), 'initialization context close'); }
      catch (failure) { cleanupError = failure; }
      throw new Error(`TASK5_INITIALIZATION_ERROR: ${String(error)}\n${s?.faults.join('\n') ?? ''}\n${cleanupError ? String(cleanupError) : ''}`);
    }
  }

  async function t5With(theme: T5Theme, width: number, height: number, run: (s: T5Session) => Promise<void>, variant: T5Variant = 'default'): Promise<void> {
    const s = await t5Open(theme, width, height, variant);
    let failed = false; let failure: unknown; let cleanupFailure: unknown;
    try { await run(s); } catch (error) { failed = true; failure = error; }
    try { await t5Dispose(s); } catch (error) { cleanupFailure = error; }
    // Infrastructure wins even when the body first observed a layout assertion.
    if (s.faults.length || cleanupFailure) throw new Error(`TASK5_ORDINARY_ERROR:\n${s.faults.join('\n')}\n${cleanupFailure ? String(cleanupFailure) : ''}`);
    if (failed) throw failure;
  }

  async function t5One(locator: T5Locator, description: string): Promise<T5Locator> {
    if (await locator.count() !== 1) throw new Error(`TASK5_SELECTOR_ERROR: ${description}`);
    return locator;
  }

  async function t5Viewport(s: T5Session, width: number, height: number, visualHeight = height, offsetTop = 0): Promise<void> {
    await s.page.setViewportSize({ width, height });
    await s.page.evaluate(async ({ width, visualHeight, offsetTop }) => {
      if (!window.task5PageFixture) throw new Error('TASK5_BRIDGE_MISSING');
      await window.task5PageFixture.viewport(width, visualHeight, offsetTop);
    }, { width, visualHeight, offsetTop });
  }

  async function t5Inside(locator: T5Locator, width: number, height: number, top = 0, touch = false): Promise<void> {
    const box = await locator.boundingBox();
    expect(box, 'real control must be rendered').not.toBeNull();
    if (!box) return;
    expect(box.x, 'left inside viewport').toBeGreaterThanOrEqual(0);
    expect(box.y, 'top inside visual viewport').toBeGreaterThanOrEqual(top);
    expect(box.x + box.width, 'right inside viewport').toBeLessThanOrEqual(width + 0.5);
    expect(box.y + box.height, 'bottom inside visual viewport').toBeLessThanOrEqual(top + height + 0.5);
    expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThan(0);
    if (touch) { expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44); }
    const metrics = await locator.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const ranges: DOMRect[] = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(walker.currentNode);
        ranges.push(...Array.from(range.getClientRects()));
      }
      const visible = ranges.filter(rect => rect.width > 0 && rect.height > 0);
      const textHeight = visible.length ? Math.max(...visible.map(rect => rect.bottom)) - Math.min(...visible.map(rect => rect.top)) : 0;
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return { textHeight, oneLine: element.matches('button:not([role="option"]),h1,h2,h3'),
        lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5,
        hit: hit === element || (hit !== null && element.contains(hit)) };
    });
    if (metrics.oneLine) expect(metrics.textHeight, 'button/title text stays on one line').toBeLessThanOrEqual(metrics.lineHeight + 1);
    expect(metrics.hit, 'control center is not clipped or covered').toBe(true);
  }

  function t5Model(s: T5Session, kind: 'chat' | 'image'): T5Locator {
    return s.page.getByRole('button', { name: new RegExp(kind === 'chat' ? T5_CHAT_NAME : T5_IMAGE_NAME) });
  }

  function t5More(s: T5Session): T5Locator {
    return s.page.getByRole('button', { name: /^(更多设置|聊天设置|更多)$/ });
  }

  function t5Settings(s: T5Session): T5Locator {
    return s.page.getByRole('region', { name: /^(聊天设置|更多设置)$/ })
      .or(s.page.getByRole('dialog', { name: /^(聊天设置|更多设置)$/ }));
  }

  async function t5OpenSettings(s: T5Session, width: number, height: number, top = 0): Promise<T5Locator> {
    const more = t5More(s);
    // The absent requested product entry is an explicit requirement assertion,
    // not a locator timeout masquerading as a valid layout RED.
    expect(await more.count(), 'one accessible mobile more/settings entry').toBe(1);
    await t5Inside(more, width, height, top, true);
    await more.click(); await t5Settle(s);
    const panel = t5Settings(s);
    expect(await panel.count(), 'one accessible settings region/dialog').toBe(1);
    await t5Inside(panel, width, height, top);
    return panel;
  }

  async function t5CloseSettings(s: T5Session, width: number, height: number, top = 0): Promise<void> {
    const close = t5Settings(s).getByRole('button', { name: /^(关闭设置|关闭聊天设置|关闭更多设置)$/ });
    expect(await close.count(), 'settings has one named close control').toBe(1);
    await t5Inside(close, width, height, top, true);
    await close.click(); await t5Settle(s);
    expect(await t5Settings(s).isVisible()).toBe(false);
  }

  async function t5ChooseSecond(s: T5Session, kind: 'chat' | 'image', width: number, height: number): Promise<void> {
    const trigger = await t5One(t5Model(s, kind), `${kind} model trigger`);
    await trigger.scrollIntoViewIfNeeded(); await t5Inside(trigger, width, height);
    await trigger.click(); await t5Settle(s);
    const menu = await t5One(s.page.getByRole('listbox'), `${kind} visible model menu`);
    await t5Inside(menu, width, height);
    const option = await t5One(menu.getByRole('option').filter({ hasText: T5_PROVIDERS[1].name }), `${kind} second provider option`);
    await option.scrollIntoViewIfNeeded(); await t5Inside(option, width, height);
    await option.click(); await t5Settle(s);
    // Reopen through the real trigger: conditional menu mounting is allowed.
    await trigger.click(); await t5Settle(s);
    const selected = s.page.getByRole('listbox').getByRole('option', { selected: true });
    expect(await selected.count(), 'one selected provider/model pair').toBe(1);
    expect(await selected.textContent()).toContain(T5_PROVIDERS[1].name);
    await trigger.click(); await t5Settle(s);
  }

  async function t5SameSettingsControl(wholePage: T5Locator, inSettings: T5Locator, name: string): Promise<void> {
    expect(await wholePage.count(), `${name} is unique across the whole Page, including hidden DOM`).toBe(1);
    expect(await inSettings.count(), `${name} is carried by settings`).toBe(1);
    expect(await wholePage.and(inSettings).count(), `${name} is the same actual DOM control in settings`).toBe(1);
  }

  async function t5RecheckModel(s: T5Session, kind: 'chat' | 'image', width: number, height: number, top = 0): Promise<void> {
    const trigger = await t5One(t5Model(s, kind), `${kind} model trigger after viewport change`);
    await trigger.scrollIntoViewIfNeeded(); await trigger.click(); await t5Settle(s);
    const menu = await t5One(s.page.getByRole('listbox'), `${kind} real menu after viewport change`);
    await t5Inside(menu, width, height, top);
    const maxHeight = await menu.evaluate(element => parseFloat(getComputedStyle(element).maxHeight));
    expect(Number.isFinite(maxHeight), `${kind} menu has a finite visible-viewport height limit`).toBe(true);
    expect(maxHeight).toBeGreaterThan(0);
    expect(maxHeight, `${kind} menu height limit follows the current visual viewport`).toBeLessThanOrEqual(height);
    const selected = menu.getByRole('option', { selected: true });
    const expectedPair = menu.getByRole('option')
      .filter({ hasText: kind === 'chat' ? T5_CHAT_NAME : T5_IMAGE_NAME })
      .filter({ hasText: T5_PROVIDERS[1].name });
    expect(await selected.count(), `${kind} keeps exactly one selected option after viewport change`).toBe(1);
    expect(await expectedPair.count(), `${kind} catalog contains the exact second-provider/model pair`).toBe(1);
    expect(await selected.and(expectedPair).count(), `${kind} selected option is the exact retained pair`).toBe(1);
    expect(await selected.textContent()).toContain(kind === 'chat' ? T5_CHAT_NAME : T5_IMAGE_NAME);
    expect(await selected.textContent()).toContain(T5_PROVIDERS[1].name);
    await trigger.click(); await t5Settle(s);
    expect(await trigger.getAttribute('aria-expanded'), `${kind} menu closes after viewport change`).toBe('false');
    expect(await s.page.getByRole('listbox').count(), `${kind} menu no longer covers the Page`).toBe(0);
  }

  async function t5Composer(s: T5Session, width: number, height: number, top = 0): Promise<void> {
    const tools = s.page.locator(T5_TOOLS);
    expect(await tools.count(), 'original nine direct tools plus send, without duplicates').toBe(10);
    const input = await s.page.getByPlaceholder(T5_PLACEHOLDER).boundingBox();
    if (!input) throw new Error('TASK5_TEXTAREA_MEASUREMENT_MISSING');
    for (const tool of await tools.all()) {
      await t5Inside(tool, width, height, top, true);
      const box = await tool.boundingBox();
      expect(box!.y, 'direct tools begin below the real textarea').toBeGreaterThanOrEqual(input.y + input.height - 0.5);
    }
    await t5Inside(s.page.getByLabel('目标画布项目', { exact: true }), width, height, top, true);
  }

  async function t5PairsRetained(s: T5Session): Promise<void> {
    // The public envelope verifies the exact pair even if settings or menus
    // unmount while closed. The menu's real selected option was checked above.
    expect(await (await t5One(t5Model(s, 'chat'), 'retained chat trigger')).textContent()).toContain(T5_PROVIDERS[1].name);
    const stored = await s.page.evaluate(async () => await window.task5PageFixture?.envelope());
    const task = stored?.currentProjects[0]?.tasks[0];
    expect(task?.id).toBe('task5-task'); expect(task?.model).toBe(T5_CHAT_ID);
    expect(task?.providerId).toBe(T5_PROVIDERS[1].id);
    expect(task?.imageModel).toBe(T5_IMAGE_ID); expect(task?.imageProviderId).toBe(T5_PROVIDERS[1].id);
    expect(task?.messages).toEqual(t5Projects()[0].tasks[0].messages);
    expect(s.projects.map(project => project.id)).toEqual(['task5-project']);
    const url = new URL(s.page.url());
    expect(url.searchParams.get('projectId')).toBe('task5-project');
    expect(url.searchParams.get('taskId')).toBe('task5-task');
  }

  for (const theme of ['gold', 'monochrome'] as const) {
    for (const [width, height] of T5_SIZES) {
      it(`mobile simple-chat page layout default ${width}x${height} (${theme})`, async () => {
        await t5With(theme, width, height, async s => {
          const geometry = await s.page.evaluate(message => {
            const header = document.querySelector('#task5-root header');
            const chat = header?.parentElement;
            const host = document.querySelector('#task5-root')?.firstElementChild;
            const sync = document.querySelector('[data-testid="simple-chat-sync-status"]')?.parentElement;
            const textarea = chat?.querySelector('textarea');
            const composer = textarea && Array.from(chat!.children).find(child => child.contains(textarea));
            const target = chat?.querySelector('select[aria-label="目标画布项目"]');
            const footer = target?.parentElement?.parentElement;
            const messages = chat && Array.from(chat.children).find(child => getComputedStyle(child).overflowY === 'auto' && child.textContent?.includes(message));
            const agent = header?.nextElementSibling;
            if (!host || !sync || !chat || !header || !agent || !messages || !composer || !footer) {
              throw new Error('TASK5_REAL_PAGE_ANCESTRY_NOT_FOUND');
            }
            const rect = (element: Element) => {
              const box = element.getBoundingClientRect();
              return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom,
                transform: getComputedStyle(element).transform, zoom: getComputedStyle(element).zoom };
            };
            return { host: rect(host), sync: rect(sync), chat: rect(chat), header: rect(header), agent: rect(agent),
              messages: rect(messages), composer: rect(composer), footer: rect(footer),
              scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
          }, T5_MESSAGE);
          expect(geometry.scrollWidth, 'no overall horizontal overflow').toBeLessThanOrEqual(geometry.clientWidth);
          for (const [name, box] of Object.entries(geometry).filter((entry): entry is [string, typeof geometry.host] => typeof entry[1] === 'object')) {
            expect(box.x, `${name} left`).toBeGreaterThanOrEqual(0);
            expect(box.right, `${name} right`).toBeLessThanOrEqual(width + 0.5);
            expect(box.y, `${name} top`).toBeGreaterThanOrEqual(0);
            expect(box.bottom, `${name} bottom`).toBeLessThanOrEqual(height + 0.5);
            expect(box.transform, `${name} is not scaled`).toBe('none');
            expect(Number(box.zoom), `${name} zoom`).toBe(1);
          }
          expect(geometry.sync.height, 'real Page sync bar').toBeCloseTo(28, 0);
          expect(geometry.chat.y).toBeGreaterThanOrEqual(geometry.sync.bottom - 0.5);
          expect(geometry.chat.bottom, 'ChatArea shares the actual parent height').toBeLessThanOrEqual(geometry.host.bottom + 0.5);
          const available = geometry.host.height - geometry.sync.height;
          if (width < 768) expect(geometry.messages.height, 'default phone messages retain 40% below sync').toBeGreaterThanOrEqual(available * 0.4);
          if (width === 844 && height === 390) expect(geometry.messages.height, 'short landscape messages').toBeGreaterThanOrEqual(80);
          expect(geometry.messages.bottom).toBeLessThanOrEqual(geometry.composer.y + 0.5);
          expect(geometry.header.bottom).toBeLessThanOrEqual(geometry.agent.y + 0.5);
          await t5Composer(s, width, height);
          for (const name of [theme === 'gold' ? '亮色模式' : '暗色模式', '临时聊天', '全局搜索']) {
            await t5Inside(s.page.getByRole('button', { name, exact: true }), width, height, 0, true);
          }
          const header = s.page.locator('header');
          const compact = width < 768 || height <= 430;
          for (const control of [header.getByTitle('切换侧边栏', { exact: true }), header.getByRole('button', { name: '新对话', exact: true }), t5Model(s, 'chat')]) {
            await t5Inside(await t5One(control, 'primary header control'), width, height, 0, compact);
          }
          await t5Inside(s.page.getByRole('button', { name: '管理', exact: true }), width, height, 0, compact);
          if (compact) {
            expect(await t5More(s).count(), 'mobile header exposes settings without hiding composer tools').toBe(1);
            await t5Inside(t5More(s), width, height, 0, true);
          }
        });
      }, 30_000);
    }

    it(`mobile simple-chat page layout preserves one live Page through settings keyboard and resize (${theme})`, async () => {
      await t5With(theme, 1440, 900, async s => {
        await t5ChooseSecond(s, 'chat', 1440, 900);
        await t5ChooseSecond(s, 'image', 1440, 900);
        await s.page.getByRole('button', { name: '深度', exact: true }).click();
        await s.page.getByLabel('响应速度', { exact: true }).selectOption('quality');
        await t5Idle(s, true);
        const input = s.page.getByPlaceholder(T5_PLACEHOLDER);
        await input.fill(T5_DRAFT);
        await s.page.getByTitle('上传图片', { exact: true }).click({ trial: true });
        const png = await s.page.evaluate(() => {
          const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('TASK5_PNG_CONTEXT_MISSING');
          context.fillStyle = '#d4af37'; context.fillRect(0, 0, 16, 16);
          return canvas.toDataURL('image/png');
        });
        const { Buffer } = await import('node:buffer');
        await s.page.locator('#chat-file-upload').setInputFiles({ name: 'task5.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
        await s.page.waitForFunction(png => Array.from(document.images).some(image => image.src === png && image.complete && image.naturalWidth === 16), png);
        await s.page.getByLabel('目标画布项目', { exact: true }).selectOption('task5-canvas-second');
        await s.page.getByRole('button', { name: '临时聊天', exact: true }).click();
        const textareaIdentity = await input.elementHandle();
        const pageIdentity = await s.page.locator('#task5-root > div').elementHandle();
        if (!textareaIdentity || !pageIdentity) throw new Error('TASK5_INITIAL_DOM_IDENTITY_MISSING');
        await t5Viewport(s, 375, 667);
        // Page's real initial sidebar effect is mount-only. Close its actual
        // sidebar control after rotation; do not inject sidebar state.
        if (await s.page.locator('aside').count()) {
          await (await t5One(s.page.locator('aside > div').first().getByRole('button'), 'real sidebar close')).click();
        }
        await t5OpenSettings(s, 375, 667);
        await t5RecheckModel(s, 'image', 375, 667);
        await t5CloseSettings(s, 375, 667);
        await t5RecheckModel(s, 'chat', 375, 667);
        await t5OpenSettings(s, 375, 667);
        await t5Viewport(s, 375, 667, 320, 70);
        await t5Inside(t5Settings(s), 375, 320, 70);
        await t5RecheckModel(s, 'image', 375, 320, 70);
        await t5CloseSettings(s, 375, 320, 70);
        await t5RecheckModel(s, 'chat', 375, 320, 70);
        await t5Inside(s.page.getByRole('button', { name: '发送消息', exact: true }), 375, 320, 70, true);
        await t5Viewport(s, 844, 390);
        await t5OpenSettings(s, 844, 390);
        await t5RecheckModel(s, 'image', 844, 390);
        await t5CloseSettings(s, 844, 390);
        await t5RecheckModel(s, 'chat', 844, 390);
        await t5Viewport(s, 375, 667);
        await t5RecheckModel(s, 'chat', 375, 667);
        await t5Composer(s, 375, 667);
        expect(await input.inputValue()).toBe(T5_DRAFT);
        expect(await s.page.getByLabel('目标画布项目', { exact: true }).inputValue()).toBe('task5-canvas-second');
        expect(await s.page.getByRole('button', { name: '临时聊天中', exact: true }).count()).toBe(1);
        await t5OpenSettings(s, 375, 667);
        expect(await s.page.getByLabel('响应速度', { exact: true }).inputValue()).toBe('quality');
        const deep = s.page.getByRole('button', { name: '深度', exact: true });
        expect(await deep.getAttribute('class')).toContain('bg-primary');
        await t5RecheckModel(s, 'image', 375, 667);
        await t5CloseSettings(s, 375, 667);
        expect(await s.page.locator(`img[src="${png}"]`).count()).toBe(1);
        expect(await s.page.getByText(T5_MESSAGE, { exact: true }).count()).toBe(1);
        expect(await textareaIdentity.evaluate(element => element.isConnected && element === document.querySelector('#task5-root textarea'))).toBe(true);
        expect(await pageIdentity.evaluate(element => element.isConnected && element === document.querySelector('#task5-root')?.firstElementChild)).toBe(true);
        await t5PairsRetained(s);
        await s.page.getByRole('button', { name: '发送消息', exact: true }).click({ trial: true });
        expect(s.requests.some(request => /\/api\/(simple-chat\/chat|chat|generate)(?:\?|$)/.test(request))).toBe(false);
      });
    }, 35_000);

    it(`mobile simple-chat page layout keeps secondary controls scrollable and sidebar reachable (${theme})`, async () => {
      await t5With(theme, 375, 667, async s => {
        const panel = await t5OpenSettings(s, 375, 667);
        const scrollable = await panel.evaluate(element => [element, ...Array.from(element.querySelectorAll('*'))]
          .some(item => ['auto', 'scroll'].includes(getComputedStyle(item).overflowY)));
        expect(scrollable, 'settings own a vertical scroll area').toBe(true);
        for (const title of ['项目指令', '知识库', 'Artifacts 文档', '项目内搜索', '用户记忆', '写作画布', '全局搜索 (Ctrl+K)', '分享对话', '用量统计', '导出分析报告']) {
          const control = panel.getByTitle(title, { exact: true });
          expect(await control.count(), `${title} has a single business control`).toBe(1);
          await t5SameSettingsControl(s.page.getByTitle(title, { exact: true }), control, title);
          await control.scrollIntoViewIfNeeded(); await t5Inside(control, 375, 667, 0, true);
        }
        const imageInSettings = panel.getByRole('button', { name: new RegExp(T5_IMAGE_NAME), includeHidden: true });
        await t5SameSettingsControl(
          s.page.getByRole('button', { name: new RegExp(T5_IMAGE_NAME), includeHidden: true }), imageInSettings, 'image model trigger');
        await t5SameSettingsControl(s.page.getByLabel('响应速度', { exact: true }), panel.getByLabel('响应速度', { exact: true }), 'response speed');
        await t5SameSettingsControl(s.page.locator('[aria-label="推理强度"]'), panel.locator('[aria-label="推理强度"]'), 'reasoning group');
        await t5SameSettingsControl(s.page.getByRole('button', { name: '深度', exact: true, includeHidden: true }),
          panel.getByRole('button', { name: '深度', exact: true, includeHidden: true }), 'deep reasoning control');
        for (const control of [panel.getByLabel('响应速度', { exact: true }), panel.getByRole('button', { name: '深度', exact: true }), imageInSettings]) {
          await (await t5One(control, 'secondary model/reasoning/speed control')).scrollIntoViewIfNeeded();
          await t5Inside(control, 375, 667);
        }
        await t5ChooseSecond(s, 'chat', 375, 667);
        if (!await panel.isVisible()) await t5OpenSettings(s, 375, 667);
        await t5ChooseSecond(s, 'image', 375, 667);
        await t5CloseSettings(s, 375, 667);
        await t5Idle(s, true); await t5PairsRetained(s);
        expect(await s.page.locator(T5_TOOLS).count()).toBe(10);
        await t5Viewport(s, 844, 390);
        const landscapeSettings = await t5OpenSettings(s, 844, 390);
        expect(await landscapeSettings.locator('select[aria-label="响应速度"]').count()).toBe(1);
        expect(await landscapeSettings.locator('[aria-label="推理强度"]').count()).toBe(1);
        await t5RecheckModel(s, 'image', 844, 390);
        await t5CloseSettings(s, 844, 390);
        await t5RecheckModel(s, 'chat', 844, 390);
        await t5Composer(s, 844, 390);
        await s.page.getByTitle('切换侧边栏', { exact: true }).click(); await t5Settle(s);
        expect(await s.page.locator('aside').count(), 'actual Sidebar can open').toBe(1);
        await t5Inside(s.page.locator('aside'), 844, 390);
        await (await t5One(s.page.locator('aside > div').first().getByRole('button'), 'real Sidebar close')).click();
        await t5Settle(s);
        expect(await s.page.locator('aside').count()).toBe(0);
        const manage = s.page.getByRole('button', { name: '管理', exact: true });
        await manage.click(); await t5Settle(s);
        expect(await s.page.getByText('Agent 管理', { exact: true }).count(), 'Agent remains manageable without a created agent').toBe(1);
        // Close by the existing modal's visible header button, not business state.
        const modalHeader = (await t5One(s.page.getByText('Agent 管理', { exact: true }), 'Agent modal title')).locator('..');
        await (await t5One(modalHeader.getByRole('button'), 'Agent modal close')).click();
        await t5Settle(s); await t5PairsRetained(s);
      });
    }, 35_000);

    it(`mobile simple-chat active agent long name removal stays reachable and preserves conversation (${theme})`, async () => {
      await t5With(theme, 320, 640, async s => {
        const before = await s.page.evaluate(async () => await window.task5PageFixture?.envelope());
        if (!before) throw new Error('TASK5_ACTIVE_AGENT_INITIAL_ENVELOPE_MISSING');
        expect(before.userId).toBe('task5-user');
        expect(before.currentProjects).toHaveLength(1);
        const originalProject = JSON.parse(JSON.stringify(before.currentProjects[0])) as SimpleChatProject;
        expect(originalProject.id).toBe('task5-project'); expect(originalProject.tasks).toHaveLength(1);
        const originalTask = originalProject.tasks[0];
        expect(originalTask.id).toBe('task5-task'); expect(originalTask.projectId).toBe(originalProject.id);
        expect(originalTask.activeAgentId).toBe(T5_LONG_AGENT.id);
        expect(originalProject.agents).toEqual([T5_LONG_AGENT]);
        expect(originalTask.model).toBe(T5_CHAT_ID); expect(originalTask.providerId).toBe(T5_PROVIDERS[0].id);
        expect(originalTask.imageModel).toBe(T5_IMAGE_ID); expect(originalTask.imageProviderId).toBe(T5_PROVIDERS[0].id);
        expect(originalTask.messages).toEqual(t5Projects()[0].tasks[0].messages);
        const bar = await t5One(s.page.locator('#task5-root header + div'), 'real active Agent bar');
        expect(await bar.textContent()).toContain(T5_LONG_AGENT.name);
        // Select the real badge action, not a clone, private state or the
        // separate Agent management button. Its center must survive clipping.
        const remove = bar.getByRole('button').filter({ hasNotText: /^\s*管理\s*$/ });
        await t5Inside(await t5One(remove, 'real active Agent remove button'), 320, 640, 0, true);
        await remove.click(); await t5Settle(s); await t5Idle(s, true);
        const after = await s.page.evaluate(async () => await window.task5PageFixture?.envelope());
        if (!after) throw new Error('TASK5_ACTIVE_AGENT_FINAL_ENVELOPE_MISSING');
        expect(after.userId).toBe(before.userId); expect(after.baseRevision).toBe(s.revision);
        expect(after.baseRevision, 'the real selection removal completed its synthetic CAS').toBeGreaterThan(before.baseRevision);
        expect(after.pendingOperations).toEqual([]); expect(after.currentProjects).toHaveLength(1);
        const currentProject = JSON.parse(JSON.stringify(after.currentProjects[0])) as SimpleChatProject;
        expect(currentProject.tasks).toHaveLength(1);
        expect(currentProject.tasks[0].activeAgentId).toBeUndefined();
        // Only selection and original handler timestamps may change. This
        // retains every other project/task field, model pair, agent and message.
        expect({ ...currentProject, updatedAt: originalProject.updatedAt,
          tasks: currentProject.tasks.map(task => ({ ...task,
            updatedAt: originalTask.updatedAt, activeAgentId: originalTask.activeAgentId,
          })),
        }).toEqual(originalProject);
        expect(t5RemoteProjectsMatch(after.currentProjects, s.projects)).toBe(true);
        expect(await bar.getByText('未选择', { exact: true }).count()).toBe(1);
        expect(await remove.count()).toBe(0);
        expect(await s.page.getByPlaceholder(T5_PLACEHOLDER, { exact: true }).count()).toBe(1);
        const url = new URL(s.page.url());
        expect(url.searchParams.get('projectId')).toBe(originalProject.id);
        expect(url.searchParams.get('taskId')).toBe(originalTask.id);
        expect(s.requests.some(request => /\/api\/(simple-chat\/chat|chat|generate)(?:\?|$)/.test(request))).toBe(false);
      }, 'active-agent');
    }, 30_000);
  }
});
