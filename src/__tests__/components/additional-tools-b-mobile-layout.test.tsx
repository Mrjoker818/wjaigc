// @vitest-environment node
// AUTHORING ONLY: 7 probe + 56 acceptance + 14 continuity declarations.
// No component/hook/renderer aliases. A host/HTTP/WS/WebGL error is NOT geometry RED.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { createServer, type Server as HttpServer } from 'node:http';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request, type Route, type Download, type ElementHandle } from '@playwright/test';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import JSZip from 'jszip';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const KINDS = ['projectdata', 'favorites', 'sticker', 'psd', 'model3d', 'effect', 'aspect'] as const;
type Kind = typeof KINDS[number];
type Theme = 'gold' | 'mono';
type Phase = 'pending' | 'completed' | 'cancelled';
const THEMES: readonly Theme[] = ['gold', 'mono'];
const VIEWPORTS = [[320, 640], [390, 780], [740, 360], [1440, 900]] as const;
const ORIGIN = 'https://additional-b.invalid';
const ACTOR = 'additional-b-user';
const PROJECT = 'additional-b-project';
const SOURCE_ID = 'additional-b-source';
const VERSION = 'additional-b-version';
const PROVIDER = 'additional-b-provider-two';
const OTHER_PROVIDER = 'additional-b-provider-one';
const IMAGE_MODEL = 'gpt-image-2';
const CHAT_MODEL = 'additional-b-chat';
const PROMPT = '离线主体与很长的项目标题，用于检查短屏操作和原参数保留';
const PSD_PROMPT = '保留主体，设计一张清晰的离线海报';
const INSTRUCTION = '保留展台主体与品牌文字，人工复核后输出';
const url = (name: string): string => `${ORIGIN}/fixtures/${name}`;
const SOURCE_URL = url('source.png');
const RESULT_URL = url('result.png');
const BORDER_URL = url('sticker-border.png');
const MODEL_URL = url('triangle.obj');
const COOKIE = `additional_b_session=${ACTOR}`;
const SOURCE_IMAGE = { id: SOURCE_ID, url: SOURCE_URL, x: 180, y: 180, width: 96, height: 96,
  originalWidth: 64, originalHeight: 64, prompt: PROMPT, model: IMAGE_MODEL, modelName: IMAGE_MODEL,
  apiProvider: PROVIDER, quality: 'standard', aspectRatio: '1:1', assetVersionId: VERSION, createdAt: 1, zIndex: 1, rotation: 0 };
// A real, uncompressed OBJ. No MTL, texture, decoder, HDR, or CDN dependency.
const OBJ = 'o offline_triangle\nv -1 -1 0\nv 1 -1 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 3//1\n';
const CAPTIONS = ['收到', '谢谢', '好耶', '加油', '晚安', '早安', '抱抱', '开心', '出发'];

// These literals are extracted/compiled by the controller without importing the
// node test host. Each kind has its own real import graph: aspect failure cannot
// be hidden by aliasing next/dynamic, nor prevent the other six graphs compiling.
const BROWSER_COMMON = String.raw`
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
const input = (window as unknown as { __additionalBInput: {
  actor: string; project: string; sourceId: string; version: string; provider: string;
  imageModel: string; prompt: string; sourceUrl: string; resultUrl: string; modelUrl: string;
} }).__additionalBInput;
if (!input || location.origin !== 'https://additional-b.invalid') throw new Error('B_FIXTURE_INPUT_OR_ORIGIN');
const root = createRoot(document.getElementById('fixture-root')!);
const state = { mounts: 0, closes: 0, callbacks: [] as Array<{ name: string; value: unknown }>,
  images: [] as unknown[], selectedId: null as string | null, disposed: false,
  pointerInputs: [] as Array<{ clientX: number; clientY: number; left: number; top: number; width: number; height: number }> };
const record = (name: string, value: unknown = null): void => {
  state.callbacks.push({ name, value: structuredClone(value) });
};
const source = { id: input.sourceId, url: input.sourceUrl, x: 180, y: 180, width: 96, height: 96,
  originalWidth: 64, originalHeight: 64, prompt: input.prompt, model: input.imageModel,
  modelName: input.imageModel, apiProvider: input.provider, quality: 'standard',
  aspectRatio: '1:1', assetVersionId: input.version, createdAt: 1, zIndex: 1, rotation: 0 };
const second = { ...source, id: 'additional-b-second', x: 32, y: 350, prompt: '另一张离线图片', createdAt: 2 };
// Only keyboard viewport metrics/events are synthesized; DOMRect, ResizeObserver,
// Range, pointer/mouse events, Canvas2D, WebGL, fetch and EventSource remain native.
const visual = Object.assign(new EventTarget(), { width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0 });
Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
const settle = async (): Promise<void> => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); };
function png(color: string): string {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('B_FIXTURE_CANVAS2D_BLOCKER');
  ctx.clearRect(0, 0, 64, 64); ctx.fillStyle = color; ctx.fillRect(16, 12, 32, 40);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(24, 20, 8, 8); return canvas.toDataURL('image/png');
}
const media = { source: png('#d17a35'), result: png('#438a4c') };
let renderEntry: (theme: 'gold' | 'mono') => React.ReactElement;
let disconnect: () => void = () => undefined;
Object.assign(window, { additionalB: {
  state, media, settle,
  mount(theme: 'gold' | 'mono'): void {
    if (state.mounts || state.disposed) throw new Error('B_FIXTURE_REMOUNT_FORBIDDEN');
    document.documentElement.classList.remove('theme-gold', 'theme-monochrome');
    document.documentElement.classList.add(theme === 'mono' ? 'theme-monochrome' : 'theme-gold');
    state.mounts++; root.render(renderEntry(theme));
  },
  async viewport(width: number, height: number, left = 0, top = 0): Promise<void> {
    Object.assign(visual, { width, height, offsetLeft: left, offsetTop: top });
    window.dispatchEvent(new Event('resize')); visual.dispatchEvent(new Event('resize')); visual.dispatchEvent(new Event('scroll')); await settle();
  },
  async unmount(): Promise<void> {
    try { if (!state.disposed) { state.disposed = true; root.unmount(); } }
    finally { disconnect(); }
    await settle();
  },
} });
`;

export const BROWSER_ENTRIES: Record<Kind, string> = {
  projectdata: BROWSER_COMMON + String.raw`
import { ProjectDataPanel } from '@/components/project-data-panel';
function Entry({ theme }: { theme: 'gold' | 'mono' }): React.ReactElement {
  const [open, setOpen] = useState(true); const [images, setImages] = useState([source, second]); state.images = images;
  return <ProjectDataPanel isOpen={open} projectName={input.prompt} projectDescription="离线项目资产：保留身份与原模型信息"
    images={images} isMonochrome={theme === 'mono'} onClose={() => { state.closes++; setOpen(false); }}
    onDeleteImages={async ids => { record('delete', ids); setImages(previous => previous.filter(image => !ids.includes(image.id))); }}
    onNavigateToImage={id => record('navigate', id)} onMakeSame={image => record('same', image)} />;
}
renderEntry = theme => <Entry theme={theme} />;
`,
  favorites: BROWSER_COMMON + String.raw`
import { FavoritesPanel } from '@/components/favorites-panel';
function Entry({ theme }: { theme: 'gold' | 'mono' }): React.ReactElement | null {
  const [open, setOpen] = useState(true);
  return open ? <FavoritesPanel userId={input.actor} isMonochrome={theme === 'mono'}
    onClose={() => { state.closes++; setOpen(false); }} onApplyParams={item => record('apply', item)} /> : null;
}
renderEntry = theme => <Entry theme={theme} />;
`,
  sticker: BROWSER_COMMON + String.raw`
import StickerAssistantPanel from '@/components/sticker-assistant-panel';
function Entry({ theme }: { theme: 'gold' | 'mono' }): React.ReactElement | null {
  const [open, setOpen] = useState(true);
  return open ? <StickerAssistantPanel isOpen onClose={() => { state.closes++; setOpen(false); }}
    isMonochrome={theme === 'mono'} onAddImages={(urls, meta) => record('add', { urls, meta })} /> : null;
}
renderEntry = theme => <Entry theme={theme} />;
`,
  psd: BROWSER_COMMON + String.raw`
import AiPsdPanel from '@/components/ai-psd/ai-psd-panel';
function Entry({ theme }: { theme: 'gold' | 'mono' }): React.ReactElement | null {
  const [open, setOpen] = useState(true);
  return open ? <AiPsdPanel onClose={() => { state.closes++; setOpen(false); }} isMonochrome={theme === 'mono'}
    onAddImages={(urls, meta) => record('add', { urls, meta })} /> : null;
}
renderEntry = theme => <Entry theme={theme} />;
`,
  model3d: BROWSER_COMMON + String.raw`
import ModelViewer3D from '@/components/model-viewer-3d';
function Entry(): React.ReactElement | null {
  const [open, setOpen] = useState(true);
  return open ? <ModelViewer3D modelUrl={input.modelUrl} modelUrls={{ obj: input.modelUrl }}
    previewImageUrl={input.sourceUrl} thumbnailUrls={{ front: input.sourceUrl, back: input.resultUrl }}
    textureUrls={[{ albedo: input.sourceUrl }]} model3DInfo={{ modelTaskId: 'additional-b-model', providerId: input.provider, model: input.imageModel }}
    onClose={() => { state.closes++; setOpen(false); }} onRetexture={id => record('retexture', id)}
    onRemesh={id => record('remesh', id)} onScreenshotToCanvas={data => record('screenshot', data)}
    onSendToSceneStudio={(model, info) => record('scene', { model, info })} /> : null;
}
renderEntry = () => <Entry />;
`,
  effect: BROWSER_COMMON + String.raw`
import { EffectReverseEngineeringPanel } from '@/components/effect-reverse-engineering-panel';
import { taskEventsClient } from '@/lib/task-events-client';
disconnect = () => taskEventsClient.disconnect();
function Entry({ theme }: { theme: 'gold' | 'mono' }): React.ReactElement | null {
  const [open, setOpen] = useState(true);
  return open ? <EffectReverseEngineeringPanel initialSource={{ projectId: input.project, imageId: input.sourceId,
    versionId: input.version, imageUrl: input.sourceUrl, label: input.prompt }} analyzerOptions={[]}
    isMonochrome={theme === 'mono'} onClose={() => { state.closes++; setOpen(false); }}
    onCanvasResult={result => record('effect-result', result)} /> : null;
}
// The actual parent renders its actual SourcePanel + Workspace grid, not a copied shell.
renderEntry = theme => <Entry theme={theme} />;
`,
  aspect: BROWSER_COMMON + String.raw`
import { InfiniteCanvas, type CanvasImage } from '@/components/infinite-canvas';
import { taskEventsClient } from '@/lib/task-events-client';
disconnect = () => taskEventsClient.disconnect();
function Entry({ theme }: { theme: 'gold' | 'mono' }): React.ReactElement {
  const [images, setImages] = useState<CanvasImage[]>([source]);
  const [selected, setSelected] = useState<CanvasImage | null>(null);
  state.images = images; state.selectedId = selected?.id || null;
  return <InfiniteCanvas images={images} selectedImage={selected} projectId={input.project} isPanelCollapsed={true}
    themeStyle={theme === 'mono' ? 'monochrome' : 'gold'} initialViewState={{ offsetX: 0, offsetY: 0, zoom: 1 }}
    onImagesChange={next => { record('images', next); setImages(next); }}
    onSelectImage={image => { record('select', image); setSelected(image); }}
    onPreviewImage={image => record('preview', image)} onGenerateVariation={image => record('variation', image)}
    onExtractKeywords={image => record('keywords', image)} onFusion={items => record('fusion', items)}
    onAddImages={(urls, sourceId, meta) => record('add', { urls, sourceId, meta })}
    onRequestTaskPoll={(payload, options) => fetch('/api/poll-task', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: options?.signal })} />;
}
renderEntry = theme => <Entry theme={theme} />;
`,
};

interface Callback { name: string; value: unknown }
interface State { mounts: number; closes: number; callbacks: Callback[]; images: Array<Record<string, unknown>>; selectedId: string | null; disposed: boolean;
  pointerInputs: Array<{ clientX: number; clientY: number; left: number; top: number; width: number; height: number }> }
interface Fixture {
  state: State; media: { source: string; result: string };
  mount: (theme: Theme) => void; settle: () => Promise<void>; unmount: () => Promise<void>;
  viewport: (width: number, height: number, left?: number, top?: number) => Promise<void>;
}
declare global { interface Window { additionalB: Fixture } }
interface Bundle { js: string; css: string }
interface Session {
  kind: Kind; theme: Theme; context: BrowserContext; page: Page; phase: Phase; mounted: boolean; closing: boolean;
  faults: string[]; requests: string[]; submissions: Record<string, unknown>[]; cancels: string[];
  observations: Array<{ at: number; event: string; detail: unknown }>;
  effectArtifactServer?: HttpServer; effectAssetUrl?: string;
  effectArtifactStarted?: boolean; effectArtifactStartFailure?: boolean;
  handlers: Set<Promise<void>>; fetches: Set<Request>; counts: Map<string, number>; media: Map<string, Buffer>;
  taskNumber: number; taskId: string; terminalServed: boolean; generationSeen: Set<number>; multipartCount: number;
  effectPoints: Array<{ x: number; y: number }>;
  downloadHeld: boolean; release: () => void; hold: Promise<void>; released: boolean;
}
const bundles = new Map<Kind, Bundle>();
const blockers = new Map<Kind, string>();
let browser: Browser | undefined;

beforeAll(async () => {
  // Exact local candidate seals run in the owned entry before compilation.
  // This behavior fixture must work without ignored, machine-local receipts.
  // Reuse Task5's proven native loader and exact installed Next client boundary.
  // No host environment, window/process mutation, Next component/context mocks.
  if (typeof process.getBuiltinModule !== 'function') throw new Error('B_FIXTURE_NATIVE_NODE_MODULE_LOADER_UNAVAILABLE');
  const { createRequire: nativeCreateRequire } = process.getBuiltinModule('node:module');
  const require = nativeCreateRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  const NativeRegExp = (require('node:vm') as typeof import('node:vm')).runInThisContext('RegExp') as RegExpConstructor;
  for (const kind of KINDS) {
    try {
      const result = await build({ write: false, bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
        absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
        ...(kind === 'aspect' ? {
          define: { 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_CACHE_COMPONENTS': 'false', '__dirname': '"/"' },
          inject: ['task5-next-client-process'],
          plugins: [{ name: 'next-official-browser-variants', setup(builder: import('esbuild').PluginBuild): void {
            const browserVariants = require('next/dist/build/browser-variant-modules') as { browserVariantModules: string[] };
            const variants = new Map(browserVariants.browserVariantModules.map(id => [
              require.resolve(`next/dist/${id}.js`), require.resolve(`next/dist/${id}.browser.js`),
            ]));
            const frameworkFilter = /(?:client-boundary-params|instant-samples|instant-validation[\\/]impl|navigation-dynamic-rendering|server-async-storage|unstable-rethrow)(?:\.js)?$/;
            builder.onResolve({ filter: new NativeRegExp('^task5-next-client-process$') }, () => ({
              path: 'task5-next-client-process', namespace: 'task5-framework-host',
            }));
            builder.onLoad({ filter: new NativeRegExp('.*'), namespace: 'task5-framework-host' }, () => ({
              contents: "export { default as process } from 'next/dist/compiled/process';",
              loader: 'js', resolveDir: process.cwd(),
            }));
            // The only additional compiler alignment: Next's real client util,
            // only for the two installed ag-psd importers admitted by review.
            const utilImporters = new Set([
              require.resolve('ag-psd/dist/abr.js'), require.resolve('ag-psd/dist/additionalInfo.js'),
            ].map(file => path.resolve(file)));
            builder.onResolve({ filter: new NativeRegExp('^util$') }, args =>
              args.importer && utilImporters.has(path.resolve(args.importer))
                ? { path: require.resolve('next/dist/compiled/util') } : undefined);
            builder.onResolve({ filter: new NativeRegExp(frameworkFilter.source, frameworkFilter.flags) }, args => {
              if (!args.importer) return undefined;
              const actual = createRequire(args.importer).resolve(args.path);
              const browserFile = variants.get(actual);
              return browserFile ? { path: browserFile } : undefined;
            });
          } }],
        } : {}),
        stdin: { contents: BROWSER_ENTRIES[kind], resolveDir: process.cwd(), loader: 'tsx', sourcefile: `additional-b-${kind}-browser-entry.tsx` } });
      if (result.outputFiles.length !== 1) throw new Error(`B_FIXTURE_EXPECTED_ONE_MEMORY_BUNDLE ${kind}`);
      const files = Object.keys(result.metafile!.inputs).filter(file => /^src[\\/]/.test(file) && /\.[jt]sx?$/.test(file));
      const sources = await Promise.all(files.map(async file => ({ content: await readFile(path.resolve(file), 'utf8'), extension: path.extname(file).slice(1) })));
      sources.push({ content: BROWSER_ENTRIES[kind], extension: 'tsx' });
      const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), { base: process.cwd(),
        loadStylesheet: async (id: string, base: string) => {
          const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
            : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
              : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
          return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
        } });
      bundles.set(kind, { js: result.outputFiles[0].text, css: compiler.build(new Scanner({}).scanFiles(sources)) });
    } catch (error) {
      blockers.set(kind, `B_FIXTURE_COMPILE_BLOCKER ${kind}: ${rawError(error)}`);
    }
  }
  browser = await chromium.launch({ headless: true });
}, 30000); // Same setup ceiling as the existing real React/browser harness.
afterAll(async () => { if (browser) await bounded('browser.close', () => browser!.close(), 2500); });

function rawError(error: unknown, seen = new Set<unknown>()): string {
  if (seen.has(error)) return '[already reported cause]';
  seen.add(error);
  if (!(error instanceof Error)) return String(error);
  const details = [error.stack || `${error.name}: ${error.message}`];
  if (error instanceof AggregateError) for (const [index, item] of Array.from(error.errors as Iterable<unknown>).entries()) {
    details.push(`AGGREGATE[${index}]:\n${rawError(item, seen)}`);
  }
  if ('cause' in error) details.push(`CAUSE:\n${rawError(error.cause, seen)}`);
  return details.join('\n');
}
function fail(message: string): never { throw new Error(message); }
function observeBoundary(s: Session, event: string, detail: unknown): void {
  if (s.kind === 'psd' || s.kind === 'effect') s.observations.push({ at: performance.now(), event, detail });
}
function bodyObject(raw: string | null): Record<string, unknown> | null {
  try { const value: unknown = JSON.parse(raw || 'null'); return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
  catch { return null; }
}
function exact(actual: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(actual, expected)) fail(`B_FIXTURE_WIRE_MISMATCH ${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}
function cap(s: Session, key: string, maximum: number): number {
  const count = (s.counts.get(key) || 0) + 1; s.counts.set(key, count);
  if (count > maximum) observeBoundary(s, 'cap-rejected', { key, count, maximum, taskId: s.taskId, phase: s.phase });
  if (count > maximum) fail(`B_FIXTURE_ROUTE_LIMIT ${key}: ${count}>${maximum}`);
  return count;
}
async function bounded<T>(label: string, action: () => Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([action(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`B_FIXTURE_DRAIN_BLOCKER ${label}`)), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function favoriteRows(): Record<string, unknown>[] {
  return [{ id: 101, user_id: ACTOR, image_url: SOURCE_URL, prompt: PROMPT, negative_prompt: '不要水印', model: IMAGE_MODEL,
    model_name: '离线图像模型乙', aspect_ratio: '1:1', quality: 'standard', image_width: 64, image_height: 64,
    original_width: 64, original_height: 64, api_provider: PROVIDER, api_base_url: ORIGIN, source_type: 'canvas',
    created_at: '1', username: '离线用户', tags: ['离线'], use_count: 2 }];
}
const FAVORITE = { id: 101, userId: ACTOR, imageUrl: SOURCE_URL, prompt: PROMPT, negativePrompt: '不要水印', model: IMAGE_MODEL,
  modelName: '离线图像模型乙', aspectRatio: '1:1', quality: 'standard', imageWidth: 64, imageHeight: 64,
  originalWidth: 64, originalHeight: 64, apiProvider: PROVIDER, apiBaseUrl: ORIGIN, sourceType: 'canvas',
  createdAt: '1', username: '离线用户', tags: ['离线'], useCount: 2 };
function catalog(kind: Kind, type: 'image' | 'chat'): Record<string, unknown> {
  const providers = [{ id: OTHER_PROVIDER, name: '离线供应商甲', isEnabled: true }, { id: PROVIDER, name: '离线供应商乙', isEnabled: true }];
  return { success: true, providers, models: providers.map((provider, index) => ({
    id: kind === 'psd' ? `psd-${type}-${index + 1}` : type === 'image' ? IMAGE_MODEL : CHAT_MODEL,
    name: type === 'image' ? '离线图像模型长名称用于保持供应商与选择' : '离线计划模型', providerId: provider.id, type, isDefault: index === 0,
  })) };
}
function psdBody(): Record<string, unknown> {
  return { generationMode: 'text_to_psd', prompt: PSD_PROMPT, title: '离线主标题', subtitle: '离线副标题', bodyText: '', ratio: '9:16',
    customWidth: 1600, customHeight: 900, sceneType: '海报', style: [], colorTone: 'auto', layerComplexity: 'standard', outputQuality: 'pro',
    textRenderMode: 'image', imageModel: 'psd-image-2', llmModel: 'psd-chat-2', referenceImageUrls: [], productImageUrls: [], logoImageUrls: [],
    brandName: '', brandSlogan: '', brandColors: [], materialType: '海报' };
}
function psdTask(s: Session): Record<string, unknown> {
  return { id: s.taskId, status: s.phase === 'completed' ? 'completed' : s.phase === 'cancelled' ? 'failed' : 'processing',
    progress: s.phase === 'completed' ? 100 : 42, label: s.phase === 'completed' ? '离线PSD界面结果' : '离线图层处理中',
    error: s.phase === 'cancelled' ? '离线取消' : undefined, previewUrl: s.phase === 'completed' ? RESULT_URL : undefined,
    layerPlan: { layers: [{ id: 'bg', name: 'bg/main', type: 'image', group: 'bg', visible: true },
      { id: 'subject', name: 'subject/1/主体', type: 'image', group: 'subject', visible: true }] },
    psdUrl: url('result.psd'), zipUrl: url('result.zip'), jsonUrl: url('plan.json'), reportUrl: url('report.md'),
    qualityReport: { overall: 90, consistency: 91, editability: 89 } };
}
function effectResult(s: Session): Record<string, unknown> {
  const exportUrl = s.effectAssetUrl; if (!exportUrl) fail('B_EFFECT_ARTIFACT_NOT_READY');
  return { correctedImageUrl: exportUrl, exportUrl, regions: [] };
}
function effectTask(s: Session): Record<string, unknown> {
  return { taskId: s.taskId, userId: ACTOR, status: s.phase === 'pending' ? 'correcting' : s.phase, progress: s.phase === 'completed' ? 100 : 42,
    label: s.phase === 'completed' ? '离线校正完成' : s.phase === 'cancelled' ? '离线校正已取消' : '离线四点校正处理中',
    createdAt: 1, updatedAt: 2, ...(s.phase === 'completed' ? { result: effectResult(s) } : {}) };
}
function stickerPlanPrompt(): string {
  return `你是一个表情包策划专家。请根据以下要求生成表情包计划。\n\n主体: 橘猫\n简洁手绘\n日常问候\n数量: 9个\n\n要求:\n1. 每个表情必须有明确的"文案"(caption)和"动作描述"(action)\n2. 文案要简短(1-4个字), 适合聊天场景\n3. 动作描述要具体, 确保每个表情的姿势/动作有明显差异\n4. 主体特征必须保持绝对一致(外形/颜色/轮廓/物种/服饰), 仅允许表情和姿势变化\n5. 动作描述中要包含该表情的具体身体动作和面部表情, 以确保生成的图片有足够的视觉差异\n\n请严格以JSON格式输出, 不要添加任何其他文字:\n[{"id":1,"caption":"文案","action":"动作描述"},...]`;
}
function stickerBody(index: number): Record<string, unknown> {
  return { prompt: `Sticker #${index}: "${CAPTIONS[index - 1]}" — 动作${index}. 简洁手绘. Subject identity: Subject: 橘猫. Visual: 橘猫. Clean solid white background, die-cut sticker style, 1024x1024 square, sticker sheet single item.`,
    aspectRatio: '1:1', n: 1, outputCount: 1, submitOnly: true, quality: 'standard', model: IMAGE_MODEL, providerId: PROVIDER };
}
async function headers(s: Session, request: Request, multipart = false): Promise<void> {
  if (new URL(request.url()).origin !== ORIGIN) fail(`B_FIXTURE_EXTERNAL_ORIGIN ${request.url()}`);
  if (request.frame().url() !== `${ORIGIN}/`) fail(`B_FIXTURE_FRAME ${request.frame().url()}`);
  const h = await request.allHeaders();
  exact(h.cookie, COOKIE, 'offline identity cookie');
  if (h.authorization || h['x-api-key'] || h['api-key'] || h['x-user-id']) fail('B_FIXTURE_UNEXPECTED_AUTH_HEADER');
  // Chromium route interception may precede injection of Fetch Metadata headers.
  // The exact target/frame/cookie boundary above remains mandatory when absent.
  if (h['sec-fetch-site'] !== undefined && h['sec-fetch-site'] !== 'same-origin') fail(`B_FIXTURE_FETCH_SITE ${h['sec-fetch-site']}`);
  if (h.origin && h.origin !== ORIGIN) fail(`B_FIXTURE_ORIGIN_HEADER ${h.origin}`);
  if (['fetch', 'xhr'].includes(request.resourceType())) {
    exact(h.accept, '*/*', 'native fetch accept');
    if (h['sec-fetch-dest'] !== undefined) exact(h['sec-fetch-dest'], '', 'native fetch destination');
    exact(h.referer, `${ORIGIN}/`, 'native fetch referer');
  }
  if (request.resourceType() === 'eventsource') exact(h.accept, 'text/event-stream', 'native EventSource accept');
  if (request.method() === 'POST') {
    if (multipart ? !/^multipart\/form-data; boundary=[A-Za-z0-9-]+$/.test(h['content-type'] || '') : h['content-type'] !== 'application/json') {
      fail(`B_FIXTURE_CONTENT_TYPE ${h['content-type']}`);
    }
  }
  if (new URL(request.url()).origin !== ORIGIN) fail(`B_FIXTURE_EXTERNAL_ORIGIN ${request.url()}`);
  if (s.closing) fail(`B_FIXTURE_REQUEST_AFTER_DRAIN ${request.method()} ${request.url()}`);
}
async function pngMultipart(s: Session, request: Request): Promise<void> {
  const h = await request.allHeaders(); const boundary = (h['content-type'] || '').split('boundary=')[1];
  const raw = request.postDataBuffer(); if (!boundary || !raw) fail('B_FIXTURE_MULTIPART_MISSING');
  const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sticker-bordered.png"\r\nContent-Type: image/png\r\n\r\n`);
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  if (!raw.subarray(0, prefix.length).equals(prefix) || !raw.subarray(-suffix.length).equals(suffix)) fail('B_FIXTURE_MULTIPART_STRUCTURE');
  const image = raw.subarray(prefix.length, raw.length - suffix.length);
  const metadata = await sharp(image).metadata();
  if (metadata.format !== 'png' || metadata.width !== 64 || metadata.height !== 64 || !metadata.hasAlpha) fail('B_FIXTURE_MULTIPART_REAL_PNG');
  const pixels = await sharp(image).ensureAlpha().raw().toBuffer();
  // Independent pixel facts: transparent corner and the actual white dilation at x=15,y=30.
  if (pixels[3] !== 0 || pixels[(30 * 64 + 15) * 4] !== 255 || pixels[(30 * 64 + 15) * 4 + 3] !== 255) fail('B_FIXTURE_WHITE_BORDER_NOT_PRODUCED');
  const previous = s.media.get('/fixtures/sticker-border.png');
  if (previous && !previous.equals(image)) fail('B_FIXTURE_BORDER_BYTES_CHANGED');
  s.media.set('/fixtures/sticker-border.png', image); s.multipartCount++;
}
function validateEffectBody(s: Session, body: Record<string, unknown> | null): void {
  if (!body) fail('B_FIXTURE_EFFECT_BODY');
  exact(Object.keys(body).sort(), ['action', 'projectId', 'sourceImageId', 'sourceVersionId', 'imageUrl', 'perspective', 'regions', 'instruction'].sort(), 'effect keys');
  exact({ ...body, perspective: null }, { action: 'correct', projectId: PROJECT, sourceImageId: SOURCE_ID, sourceVersionId: VERSION,
    imageUrl: SOURCE_URL, perspective: null, regions: [], instruction: INSTRUCTION }, 'effect frozen source');
  if (s.effectPoints.length !== 4) fail('B_FIXTURE_EFFECT_NATIVE_INPUTS_MISSING');
  exact(body.perspective, s.effectPoints, 'effect exact native pointer inputs');
}

function assertEffectArtifactRequest(
  method: string | undefined, url: string | undefined, headers: Record<string, string | string[] | undefined>,
  remote: string | undefined, expectedHost: string, count: number,
): void {
  if (!['GET', 'HEAD'].includes(method || '') || url !== '/effect-result.png' || headers.host !== expectedHost
    || remote !== '127.0.0.1' || !Number.isSafeInteger(count) || count < 1 || count > 40
    || ['authorization', 'cookie', 'x-api-key', 'api-key', 'x-user-id', 'transfer-encoding'].some(key => Boolean(headers[key]))
    || (headers['content-length'] !== undefined && headers['content-length'] !== '0')
    || (headers.origin !== undefined && headers.origin !== ORIGIN)
    || (headers.referer !== undefined && headers.referer !== ORIGIN + '/')) throw new Error('B_EFFECT_ARTIFACT_GUARD');
}
async function startEffectArtifact(s: Session): Promise<void> {
  if (s.kind !== 'effect' || s.effectArtifactServer) fail('B_EFFECT_ARTIFACT_START');
  const bytes = s.media.get('/fixtures/result.png'); if (!bytes) fail('B_EFFECT_ARTIFACT_BYTES');
  let expectedHost = '';
  const server = createServer((request, response) => {
    const count = (s.counts.get('effect-native-artifact') || 0) + 1; s.counts.set('effect-native-artifact', count);
    try {
      assertEffectArtifactRequest(request.method, request.url, request.headers, request.socket.remoteAddress, expectedHost, count);
      observeBoundary(s, 'artifact-server-request', { method: request.method, path: request.url, host: expectedHost, count });
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': String(bytes.length),
        'content-disposition': 'attachment; filename="effect-result.png"', 'cache-control': 'no-store',
        'access-control-allow-origin': ORIGIN, vary: 'Origin' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) { s.faults.push(rawError(error)); response.writeHead(403); response.end(); }
  });
  s.effectArtifactServer = server; s.effectArtifactStarted = false; s.effectArtifactStartFailure = false;
  server.on('error', error => { s.faults.push('B_EFFECT_ARTIFACT_SERVER ' + rawError(error)); });
  await new Promise<void>((resolve, reject) => {
    const onListenError = (error: Error): void => {
      if (!s.effectArtifactStarted && !server.listening) s.effectArtifactStartFailure = true;
      reject(error);
    };
    server.once('error', onListenError); server.listen(0, '127.0.0.1', () => { s.effectArtifactStarted = true; server.removeListener('error', onListenError); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') fail('B_EFFECT_ARTIFACT_ADDRESS');
  expectedHost = '127.0.0.1:' + address.port; s.effectAssetUrl = 'http://' + expectedHost + '/effect-result.png';
  observeBoundary(s, 'artifact-server-start', { host: expectedHost });
}
async function closeEffectArtifact(s: Session): Promise<void> {
  const server = s.effectArtifactServer; if (!server) return;
  if (s.effectArtifactStarted === false && s.effectArtifactStartFailure === true && !server.listening) {
    s.effectArtifactServer = undefined; observeBoundary(s, 'artifact-server-not-started', null); return;
  }
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (server.listening) fail('B_EFFECT_ARTIFACT_STILL_LISTENING');
  s.effectArtifactServer = undefined;
  observeBoundary(s, 'artifact-server-close', { listening: server.listening });
}

async function serve(s: Session, route: Route, bundle: Bundle): Promise<void> {
  const request = route.request(); const absolute = request.url(); const parsed = new URL(absolute);
  const method = request.method(); const raw = request.postData(); const body = bodyObject(raw);
  const key = `${method} ${parsed.pathname}${parsed.search}`; s.requests.push(key);
  observeBoundary(s, 'serve-request', { key, taskId: s.taskId, phase: s.phase, submissions: s.submissions.length, cancels: s.cancels.slice() });
  if (absolute === `${ORIGIN}/` && method === 'GET' && raw === null && request.isNavigationRequest()) {
    cap(s, 'document', 1);
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${bundle.css}</style></head><body style="margin:0;width:100vw;height:100dvh;overflow:hidden"><div id="fixture-root" style="position:relative;width:100%;height:100%"></div></body></html>` }); return;
  }
  const multipart = method === 'POST' && s.kind === 'sticker' && parsed.pathname === '/api/save-image' && raw !== null && (request.headers()['content-type'] || '').startsWith('multipart/');
  if (s.kind === 'effect' && s.effectAssetUrl && absolute === s.effectAssetUrl && ['GET', 'HEAD'].includes(method) && raw === null) {
    const h = await request.allHeaders();
    if (['authorization', 'cookie', 'x-api-key', 'api-key', 'x-user-id'].some(key => Boolean(h[key]))) fail('B_EFFECT_ARTIFACT_BROWSER_CREDENTIAL');
    await route.continue(); return; // This one owned loopback PNG is the only real network exception.
  }
  await headers(s, request, multipart);
  if ((method === 'GET' || method === 'HEAD') && raw === null && !parsed.search && s.media.has(parsed.pathname)) {
    cap(s, key, 40);
    if (s.downloadHeld && request.resourceType() === 'fetch' && parsed.pathname === '/fixtures/source.png') await s.hold;
    const bytes = s.media.get(parsed.pathname)!;
    await route.fulfill({ contentType: parsed.pathname.endsWith('.obj') ? 'text/plain' : 'image/png', headers: { 'content-length': String(bytes.length) }, body: method === 'HEAD' ? Buffer.alloc(0) : bytes }); return;
  }
  if (s.kind === 'aspect' && method === 'GET' && raw === null && parsed.pathname === '/logo.png' && !parsed.search) {
    cap(s, key, 2); await route.fulfill({ contentType: 'image/png', body: s.media.get('/fixtures/source.png')! }); return;
  }
  if ((s.kind === 'sticker' || s.kind === 'psd') && method === 'GET' && raw === null && [ '/api/models?type=image', '/api/models?type=chat' ].includes(parsed.pathname + parsed.search)) {
    cap(s, key, 1); await route.fulfill({ json: catalog(s.kind, parsed.searchParams.get('type') as 'image' | 'chat') }); return;
  }
  if ((s.kind === 'aspect' || s.kind === 'effect') && method === 'GET' && raw === null && ['/api/session', '/api/auth/me'].includes(parsed.pathname) && !parsed.search) {
    cap(s, key, 6); await route.fulfill({ json: { success: true, user: { id: ACTOR, username: '离线用户', role: 'user' } } }); return;
  }
  if ((s.kind === 'effect' || s.kind === 'aspect') && absolute === `${ORIGIN}/api/task-events` && method === 'GET' && raw === null) {
    cap(s, key, 6);
    // 此离线UI场景明确使用原生EventSource失败回退，不把立刻EOF的响应伪作在线SSE验收。
    await route.fulfill({ status: 503, headers: { 'cache-control': 'no-store' },
      json: { success: false, error: 'OFFLINE_FIXTURE_TASK_EVENTS_UNAVAILABLE' } }); return;
  }
  if (s.kind === 'aspect' && method === 'GET' && raw === null && parsed.pathname + parsed.search === '/api/models?type=3d') {
    cap(s, key, 1);
    await route.fulfill({ json: { success: true, capabilityCatalogVersion: 1, providers: [], models: [], taskModelCatalog: [],
      modelAuthorizationMigration: { resolved: [], required: [] }, quickCreatePolicy: { autoModelRouting: false, globalDefault: '', quickCreateDefault: '' } } }); return;
  }
  if (s.kind === 'aspect' && method === 'GET' && raw === null && ['/api/upscayl', '/api/models?type=upscaler', '/api/models?type=removebg'].includes(parsed.pathname + parsed.search)) {
    cap(s, key, 1); await route.fulfill({ json: parsed.pathname === '/api/upscayl' ? { available: false, models: [] } : { success: true, providers: [], models: [] } }); return;
  }
  if (s.kind === 'favorites' && key === `GET /api/favorites?userId=${ACTOR}&page=1&limit=20` && raw === null) {
    cap(s, key, 1); await route.fulfill({ json: { success: true, favorites: favoriteRows(), pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } } }); return;
  }
  if (s.kind === 'favorites' && key === `DELETE /api/favorites?id=101&userId=${ACTOR}` && raw === null) {
    cap(s, key, 1); await route.fulfill({ json: { success: true } }); return;
  }
  if (s.kind === 'sticker' && key === 'POST /api/chat') {
    cap(s, key, 1); exact(body, { model: CHAT_MODEL, providerId: PROVIDER, messages: [{ role: 'user', content: stickerPlanPrompt() }], stream: false }, 'sticker plan');
    await route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: JSON.stringify(CAPTIONS.map((caption, index) => ({ id: index + 1, caption, action: `动作${index + 1}` }))) } }] } }); return;
  }
  if (s.kind === 'sticker' && key === 'POST /api/generate') {
    cap(s, key, 9);
    const match = typeof body?.prompt === 'string' ? /^Sticker #(\d+):/.exec(body.prompt) : null;
    const index = match ? Number(match[1]) : 0;
    if (index < 1 || index > 9 || s.generationSeen.has(index)) fail('B_FIXTURE_STICKER_DUPLICATE_OR_ID');
    exact(body, stickerBody(index), 'sticker submit'); s.generationSeen.add(index); s.submissions.push(body!);
    await s.hold; await route.fulfill({ json: { success: true, imageUrls: [RESULT_URL] } }); return;
  }
  if (s.kind === 'sticker' && key === 'POST /api/image-edit') {
    cap(s, key, 9); exact(body, { action: 'remove_background', imageUrl: RESULT_URL, model: IMAGE_MODEL, providerId: PROVIDER, removeBgModel: 'birefnet-general-lite' }, 'sticker remove background');
    await route.fulfill({ json: { success: true, imageUrl: RESULT_URL } }); return;
  }
  if (s.kind === 'sticker' && key === 'POST /api/save-image') {
    cap(s, multipart ? 'sticker multipart' : 'sticker save json', 9);
    if (multipart) await pngMultipart(s, request); else exact(body, { imageUrl: RESULT_URL }, 'sticker persist');
    await route.fulfill({ json: { success: true, url: multipart ? BORDER_URL : RESULT_URL } }); return;
  }
  if (s.kind === 'psd' && key === 'POST /api/ai-psd/create') {
    cap(s, key, 2); exact(body, psdBody(), 'PSD existing public create'); s.submissions.push(body!);
    s.taskId = `additional-b-psd-${++s.taskNumber}`; s.phase = 'pending'; s.terminalServed = false;
    await route.fulfill({ json: { success: true, taskId: s.taskId } }); return;
  }
  if (s.kind === 'psd' && key === `GET /api/ai-psd/status?taskId=${s.taskId}` && s.taskId && raw === null) {
    // Conservative read-count ceiling from the existing 1s/1.5s/2s serial cadence:
    // poll29 at46s, poll30 at48s. This does not extend the45s case (which includes dispose).
    cap(s, `PSD status ${s.taskId}`, 29); if (s.phase !== 'pending') s.terminalServed = true;
    await route.fulfill({ json: { success: true, task: psdTask(s) } }); return;
  }
  if (s.kind === 'psd' && key === 'POST /api/cancel-task' && s.taskId) {
    cap(s, key, 1); exact(body, { taskId: s.taskId }, 'PSD cancel'); s.cancels.push(s.taskId); s.phase = 'cancelled'; s.terminalServed = true;
    await route.fulfill({ json: { success: true, message: '任务已取消' } }); return;
  }
  if (s.kind === 'effect' && key === 'POST /api/effect-reverse-engineering') {
    cap(s, key, 2); validateEffectBody(s, body); s.submissions.push(body!); s.taskId = `additional-b-effect-${++s.taskNumber}`;
    s.phase = 'pending'; s.terminalServed = false; await route.fulfill({ json: effectTask(s) }); return;
  }
  if (s.kind === 'effect' && key === `GET /api/effect-reverse-engineering?taskId=${s.taskId}` && s.taskId && raw === null) {
    // 45s case: at most30 interval reads plus submit and cancel reads; fixture SSE has no task events.
    cap(s, `effect status ${s.taskId}`, 32); if (s.phase !== 'pending') s.terminalServed = true;
    await route.fulfill({ json: effectTask(s) }); return;
  }
  if (s.kind === 'effect' && key === `DELETE /api/effect-reverse-engineering?taskId=${s.taskId}` && s.taskId && raw === null) {
    cap(s, 'effect cancel', 1); s.cancels.push(s.taskId); s.phase = 'cancelled';
    await route.fulfill({ json: effectTask(s) }); return;
  }
  if (s.kind === 'aspect' && key === 'POST /api/aspect-recompose') {
    cap(s, key, 1); exact(body, { imageUrl: SOURCE_URL, targetRatio: '9:16', targetWidth: 96, targetHeight: 171, model: IMAGE_MODEL, providerId: PROVIDER }, 'aspect selected image and pair');
    s.submissions.push(body!); s.taskId = 'additional-b-aspect'; s.phase = 'pending';
    await route.fulfill({ json: { success: true, taskId: s.taskId } }); return;
  }
  if (s.kind === 'aspect' && key === 'POST /api/poll-task' && s.taskId) {
    // Original800/1200/1800/2500ms cadence permits26 timer-driven reads in45s, not an extended case.
    cap(s, key, 26); exact(body, { taskId: s.taskId, model: IMAGE_MODEL, providerId: PROVIDER }, 'aspect frozen poll pair');
    if (s.phase !== 'pending') s.terminalServed = true;
    await route.fulfill({ json: s.phase === 'completed' ? { status: 'completed', progress: 100, imageUrl: RESULT_URL, taskType: 'edit' }
      : s.phase === 'cancelled' ? { status: 'cancelled' } : { status: 'processing', progress: 42, label: '离线重组处理中' } }); return;
  }
  if (s.kind === 'model3d' && key === `GET /api/proxy-3d-model?url=${encodeURIComponent(MODEL_URL)}` && raw === null) {
    cap(s, key, 1); await route.fulfill({ contentType: 'text/plain', body: OBJ }); return;
  }
  if ((s.kind === 'effect' || s.kind === 'psd') && key === 'GET /fixtures/result.zip' && raw === null) {
    cap(s, key, 1); const zip = new JSZip(); zip.file('result.png', s.media.get('/fixtures/result.png')!);
    await route.fulfill({ contentType: 'application/zip', headers: { 'content-disposition': 'attachment; filename="result.zip"' }, body: await zip.generateAsync({ type: 'nodebuffer' }) }); return;
  }
  if (s.kind === 'psd' && key === 'GET /fixtures/result.psd' && raw === null) {
    cap(s, key, 1);
    // Valid flattened 1x1 RGB PSD fixture, not an executed PSD generation service.
    const psd = Buffer.alloc(43); psd.write('8BPS'); psd.writeUInt16BE(1, 4); psd.writeUInt16BE(3, 12);
    psd.writeUInt32BE(1, 14); psd.writeUInt32BE(1, 18); psd.writeUInt16BE(8, 22); psd.writeUInt16BE(3, 24);
    psd[40] = 67; psd[41] = 138; psd[42] = 76;
    await route.fulfill({ contentType: 'image/vnd.adobe.photoshop', body: psd }); return;
  }
  fail(`B_FIXTURE_UNKNOWN_HTTP ${method} ${absolute} body=${raw}`);
}

async function openSession(kind: Kind, theme: Theme): Promise<Session> {
  const blocker = blockers.get(kind); if (blocker) fail(blocker);
  if (!browser || !bundles.has(kind)) fail(`B_FIXTURE_HOST_NOT_READY ${kind}`);
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let s: Session | undefined;
  try {
    await context.addCookies([{ name: 'additional_b_session', value: ACTOR, url: ORIGIN, sameSite: 'Strict', secure: true }]);
    await context.addInitScript(({ actor, project, provider, imageModel }) => {
      const user = { id: actor, username: '离线用户', password: '', role: 'user', status: 'active', createdAt: 1, updatedAt: 1 };
      localStorage.setItem('unbounded_ai_current_user', actor);
      localStorage.setItem('unbounded_ai_user_data', JSON.stringify({ users: [user], userData: { [actor]: {
        user, projects: [], apiKeys: [], usageStats: [], selectedModel: `${provider}::${imageModel}`,
      } } }));
      localStorage.setItem('wujie_selected_model', JSON.stringify({ model: imageModel, providerId: provider, quality: 'standard' }));
      localStorage.setItem('wujie_image_output_preferences', '{}');
      localStorage.setItem('wujie-favorites-local', JSON.stringify([{ id: 'other-user-sentinel', userId: 'other-user', imageUrl: '/other-user.png' }]));
      // This is a separate, unused user's fixture data, not another project/actor.
      void project;
    }, { actor: ACTOR, project: PROJECT, provider: PROVIDER, imageModel: IMAGE_MODEL });
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    let releaseHold!: () => void; const hold = new Promise<void>(resolve => { releaseHold = resolve; });
    s = { kind, theme, context, page, phase: 'pending', mounted: false, closing: false, faults: [], requests: [], submissions: [], cancels: [], observations: [],
      handlers: new Set(), fetches: new Set(), counts: new Map(), media: new Map([['/fixtures/triangle.obj', Buffer.from(OBJ)]]),
      taskNumber: 0, taskId: '', terminalServed: false, generationSeen: new Set(), multipartCount: 0, effectPoints: [], downloadHeld: false, hold, released: false,
      release(): void { if (!this.released) { this.released = true; releaseHold(); } } };
    const session = s;
    let requestSequence = 0; const requestIds = new Map<Request, number>();
    page.on('request', request => { const id = ++requestSequence; requestIds.set(request, id); observeBoundary(session, 'native-request', { id, method: request.method(), url: request.url() }); });
    page.on('response', response => { observeBoundary(session, 'native-response', { id: requestIds.get(response.request()), status: response.status(), url: response.url() }); });
    page.on('requestfinished', request => { observeBoundary(session, 'native-finished', { id: requestIds.get(request), url: request.url() }); });
    page.on('requestfailed', request => { observeBoundary(session, 'native-failed', { id: requestIds.get(request), url: request.url(), failure: request.failure() }); });
    page.on('download', item => { observeBoundary(session, 'native-download', { url: item.url(), name: item.suggestedFilename() }); });
    page.on('framenavigated', frame => { observeBoundary(session, 'native-navigation', { url: frame.url() }); });
    await context.routeWebSocket('**/*', socket => {
      session.faults.push(`B_FIXTURE_UNKNOWN_WS ${socket.url()}`); socket.close({ code: 1008, reason: 'Offline fixture forbids WebSockets' });
    });
    page.on('websocket', socket => { session.faults.push(`B_FIXTURE_UNKNOWN_WS_EVENT ${socket.url()}`); });
    page.on('pageerror', error => { session.faults.push(`B_FIXTURE_PAGEERROR ${rawError(error)}`); });
    page.on('request', request => { if (['fetch', 'xhr'].includes(request.resourceType())) session.fetches.add(request); });
    page.on('requestfinished', request => { session.fetches.delete(request); });
    page.on('requestfailed', request => { session.fetches.delete(request); });
    await context.route('**/*', async route => {
      const operation = serve(session, route, bundles.get(kind)!).catch(async error => {
        session.faults.push(rawError(error)); await route.abort('blockedbyclient').catch(abortError => { session.faults.push(rawError(abortError)); });
      });
      session.handlers.add(operation); try { await operation; } finally { session.handlers.delete(operation); }
    });
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(input => Object.assign(window, { __additionalBInput: input }), { actor: ACTOR, project: PROJECT, sourceId: SOURCE_ID,
      version: VERSION, provider: PROVIDER, imageModel: IMAGE_MODEL, prompt: PROMPT, sourceUrl: SOURCE_URL, resultUrl: RESULT_URL, modelUrl: MODEL_URL });
    await page.addScriptTag({ content: bundles.get(kind)!.js });
    const media = await page.evaluate(() => window.additionalB.media);
    session.media.set('/fixtures/source.png', Buffer.from(media.source.split(',')[1], 'base64'));
    session.media.set('/fixtures/result.png', Buffer.from(media.result.split(',')[1], 'base64'));
    if (kind === 'effect') await bounded('effect artifact start', () => startEffectArtifact(session), 2500);
    return session;
  } catch (error) {
    const cleanup: string[] = [];
    if (s) {
      s.release();
      try {
        await bounded('failed bootstrap routes', () => Promise.all([...s!.handlers]), 2500);
        if (!s.page.isClosed()) await bounded('failed bootstrap root', () => s!.page.evaluate(() => window.additionalB?.unmount()), 2500);
      } catch (failure) { cleanup.push(rawError(failure)); }
    }
    try { await bounded('failed bootstrap context', () => context.close(), 2500); }
    catch (failure) { cleanup.push(rawError(failure)); }
    if (s?.effectArtifactServer) { try { await bounded('failed bootstrap artifact', () => closeEffectArtifact(s!), 2500); } catch (failure) { cleanup.push(rawError(failure)); } }
    const detail = `B_FIXTURE_BOOTSTRAP_BLOCKER ${kind}: ${rawError(error)}\n${s?.faults.join('\n') || ''}\nCLEANUP:\n${cleanup.join('\n')}`;
    blockers.set(kind, detail); throw new Error(detail, { cause: error });
  }
}

async function dispose(s: Session): Promise<void> {
  const failures: Error[] = [];
  const attempt = async (stage: string, action: () => Promise<unknown>): Promise<void> => {
    try { await action(); }
    catch (error) { failures.push(new Error(`B_FIXTURE_CLEANUP_STAGE ${stage}:\n${rawError(error)}`, { cause: error })); }
  };
  // Every stage is attempted, including drain/fetch/context after unmount fails.
  await attempt('release', async () => { s.phase = s.phase === 'cancelled' ? 'cancelled' : 'completed'; s.release(); });
  await attempt('original HTTP releases', () => bounded('original HTTP releases', () => Promise.all([...s.handlers]), 2500));
  await attempt('original terminal', async () => {
    if (s.mounted && !s.page.isClosed()) {
      await s.page.waitForFunction(({ kind, submitted }) => {
        const text = document.body.textContent || '';
        if (!submitted) return true;
        if (kind === 'sticker') return text.includes('生成进度 9/9') || !document.querySelector('[data-popup="sticker-assistant"]');
        if (kind === 'psd') return !Array.from(document.querySelectorAll('button')).some(button => button.textContent?.trim() === '取消');
        if (kind === 'effect') return !Array.from(document.querySelectorAll('button')).some(button => button.textContent?.trim() === '取消任务');
        if (kind === 'aspect') return !window.additionalB.state.images.some(image => Boolean((image as Record<string, unknown>).isProcessingPlaceholder));
        return true;
      }, { kind: s.kind, submitted: s.submissions.length > 0 }, { timeout: 2500 });
    }
  });
  await attempt('original settle', async () => {
    if (s.mounted && !s.page.isClosed()) await bounded('original settle', () => s.page.evaluate(() => window.additionalB.settle()), 2500);
  });
  await attempt('root.unmount', async () => {
    if (!s.page.isClosed()) await bounded('root.unmount', () => s.page.evaluate(() => window.additionalB?.unmount()), 2500);
  });
  await attempt('unmount HTTP drain', () => bounded('unmount HTTP drain', () => Promise.all([...s.handlers]), 2500));
  await attempt('unsettled fetch', async () => {
    if (s.fetches.size) fail(`B_FIXTURE_UNSETTLED_FETCH ${[...s.fetches].map(request => request.url()).join(',')}`);
  });
  await attempt('context.close', async () => { s.closing = true; await bounded('context.close', () => s.context.close(), 2500); });
  if (s.effectArtifactServer) await attempt('artifact.close', () => bounded('artifact.close', () => closeEffectArtifact(s), 2500));
  if (failures.length) {
    const causes = new AggregateError(failures, 'All original cleanup stage errors');
    throw new Error(`B_FIXTURE_INFRASTRUCTURE_ERROR cleanup ${s.kind}\n${rawError(causes)}`, { cause: causes });
  }
}
async function withSession(kind: Kind, theme: Theme, run: (s: Session) => Promise<void>): Promise<void> {
  const s = await openSession(kind, theme); let original: unknown; let cleanup: unknown;
  try { await run(s); } catch (error) { original = error; }
  try { await dispose(s); } catch (error) { cleanup = error; }
  if (s.observations.length) console.info('B_READ_ONLY_BOUNDARY_TRACE:' + JSON.stringify(s.observations));
  if (s.faults.length || cleanup) {
    const detail = `B_FIXTURE_INFRASTRUCTURE_ERROR ${kind}\n${s.faults.join('\n')}\n${cleanup ? rawError(cleanup) : ''}\nRAW_ORIGINAL_FAILURE:\n${original ? rawError(original) : 'none'}`;
    const causes = new AggregateError([...(original === undefined ? [] : [original]), ...(cleanup === undefined ? [] : [cleanup]),
      ...s.faults.map(fault => new Error(fault))], 'Original body and all fixture infrastructure errors');
    blockers.set(kind, detail); throw new Error(detail, { cause: causes });
  }
  if (original) {
    // Native numeric expectation failures remain untouched. Locator/host errors
    // are blockers, never repackaged as an AssertionError or allowed RED.
    if (!(original instanceof Error) || original.name !== 'AssertionError') blockers.set(kind, `B_FIXTURE_HOST_BLOCKER ${kind}: ${rawError(original)}`);
    throw original;
  }
}

function panel(s: Session): Locator {
  switch (s.kind) {
    case 'projectdata': return s.page.locator('[data-popup="project-data"]');
    case 'favorites': return s.page.getByText('收藏夹', { exact: true }).locator('xpath=../../..');
    case 'sticker': return s.page.locator('[data-popup="sticker-assistant"]');
    case 'psd': return s.page.locator('[data-floating-panel="true"]').locator('..');
    case 'model3d': return s.page.getByText('3D 模型预览', { exact: true }).locator('xpath=../..');
    case 'effect': return s.page.locator('[data-popup="effect-reverse-engineering"]');
    case 'aspect': return s.page.locator('[data-popup="aspect-recompose"]');
  }
}
function header(s: Session): Locator {
  const root = panel(s);
  switch (s.kind) {
    case 'projectdata': return root.getByText('资产库', { exact: true }).locator('xpath=../..');
    case 'favorites': return root.getByText('收藏夹', { exact: true }).locator('xpath=../..');
    case 'sticker': return root.getByText('表情助手', { exact: true }).locator('xpath=../..');
    case 'psd': return root.getByText('AI PSD 生成器', { exact: true }).locator('..');
    case 'model3d': return root.getByText('3D 模型预览', { exact: true }).locator('..');
    case 'effect': return root.locator('header');
    case 'aspect': return root.locator(':scope > div').first();
  }
}
function iconButton(container: Locator, page: Page, icon: string): Locator {
  return container.locator('button').filter({ has: page.locator(`svg.lucide-${icon}`) });
}
function closeButton(s: Session): Locator {
  return s.kind === 'aspect' ? panel(s).getByRole('button', { name: '关闭', exact: true })
    : s.kind === 'effect' ? header(s).getByTitle('关闭', { exact: true })
      : s.kind === 'sticker' ? header(s).getByRole('button', { name: '关闭', exact: true })
        : iconButton(header(s), s.page, 'x');
}
function minimizeButton(s: Session): Locator | null {
  if (s.kind === 'sticker') return header(s).getByRole('button', { name: '最小化', exact: true });
  if (s.kind === 'psd') return iconButton(header(s), s.page, 'minus');
  if (s.kind === 'effect') return header(s).getByTitle('最小化', { exact: true });
  return null;
}
async function unique(target: Locator): Promise<void> {
  const count = await target.count(); if (count !== 1) fail(`B_FIXTURE_SELECTOR_CARDINALITY ${count}: ${target}`);
}
interface Rect { x: number; y: number; width: number; height: number }
async function rect(target: Locator): Promise<Rect> {
  await unique(target); const value = await target.boundingBox();
  if (!value || !Object.values(value).every(Number.isFinite)) fail(`B_FIXTURE_NO_NUMERIC_DOMRECT ${target}`);
  return value;
}
async function visibleBounds(s: Session, target: Locator, gutter = 0): Promise<Rect> {
  const box = await rect(target);
  const view = await s.page.evaluate(() => ({ x: visualViewport!.offsetLeft, y: visualViewport!.offsetTop, width: visualViewport!.width, height: visualViewport!.height }));
  expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThan(0);
  expect(box.x).toBeGreaterThanOrEqual(view.x + gutter); expect(box.y).toBeGreaterThanOrEqual(view.y + gutter);
  expect(box.x + box.width).toBeLessThanOrEqual(view.x + view.width - gutter);
  expect(box.y + box.height).toBeLessThanOrEqual(view.y + view.height - gutter);
  return box;
}
async function nativeText(target: Locator): Promise<{ rects: Rect[]; hasText: boolean }> {
  return target.evaluate(element => {
    const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
    let hasText = false;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let text: Node | null;
    while ((text = walker.nextNode())) {
      const parent = text.parentElement;
      if (!text.textContent?.trim() || !parent || parent.closest('svg, option, textarea')) continue;
      if (getComputedStyle(parent).visibility !== 'visible') continue;
      let left = 0; let top = 0; let right = innerWidth; let bottom = innerHeight; let hidden = false;
      for (let node: HTMLElement | null = parent; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || Number(style.opacity) === 0) { hidden = true; break; }
        const r = node.getBoundingClientRect();
        const sx = node.offsetWidth ? r.width / node.offsetWidth : 1;
        const sy = node.offsetHeight ? r.height / node.offsetHeight : 1;
        // Only real computed clipping axes constrain text. An overflow-visible
        // label is NOT clipped to its own box to hide overlap with an SVG close.
        if (/^(auto|scroll|hidden|clip)$/.test(style.overflowX)) {
          left = Math.max(left, r.left + node.clientLeft * sx);
          right = Math.min(right, r.left + (node.clientLeft + node.clientWidth) * sx);
        }
        if (/^(auto|scroll|hidden|clip)$/.test(style.overflowY)) {
          top = Math.max(top, r.top + node.clientTop * sy);
          bottom = Math.min(bottom, r.top + (node.clientTop + node.clientHeight) * sy);
        }
      }
      if (hidden) continue;
      hasText = true;
      // Character ranges, not the full unpainted string behind CSS ellipsis.
      for (let start = 0; start < text.textContent.length;) {
        const length = (text.textContent.codePointAt(start) || 0) > 0xffff ? 2 : 1;
        const end = start + length; const character = text.textContent.slice(start, end);
        if (character.trim()) {
          const range = document.createRange(); range.setStart(text, start); range.setEnd(text, end);
          for (const box of range.getClientRects()) {
            const x = Math.max(box.left, left); const y = Math.max(box.top, top);
            const width = Math.min(box.right, right) - x; const height = Math.min(box.bottom, bottom) - y;
            if (width > 0 && height > 0) rects.push({ x, y, width, height });
          }
        }
        start = end;
      }
    }
    return { rects, hasText };
  });
}
function overlap(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}
async function nonOverlap(targets: readonly Locator[]): Promise<void> {
  const boxes: Rect[] = []; const texts: Rect[][] = [];
  for (const target of targets) {
    boxes.push(await rect(target)); const text = await nativeText(target);
    if (text.hasText) expect(text.rects.length).toBeGreaterThan(0);
    texts.push(text.rects);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    expect(overlap(boxes[i], boxes[j])).toBeLessThanOrEqual(1);
    for (const a of texts[i]) expect(overlap(a, boxes[j])).toBeLessThanOrEqual(1);
    for (const b of texts[j]) expect(overlap(b, boxes[i])).toBeLessThanOrEqual(1);
    for (const a of texts[i]) for (const b of texts[j]) expect(overlap(a, b)).toBeLessThanOrEqual(1);
  }
}
async function control(s: Session, target: Locator): Promise<void> {
  await unique(target); await target.scrollIntoViewIfNeeded(); await settle(s);
  const disabled = await target.isDisabled();
  if (!disabled) {
    await target.focus();
    expect(await target.evaluate(element => document.activeElement === element)).toBe(true);
    await settle(s);
  }
  const box = await visibleBounds(s, target);
  expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  const clip = await target.evaluate(element => {
    const r = element.getBoundingClientRect(); let left = r.left; let top = r.top; let right = r.right; let bottom = r.bottom;
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node); const b = node.getBoundingClientRect();
      const sx = node.offsetWidth ? b.width / node.offsetWidth : 1; const sy = node.offsetHeight ? b.height / node.offsetHeight : 1;
      if (/^(auto|scroll|hidden|clip)$/.test(style.overflowX)) { left = Math.max(left, b.left + node.clientLeft * sx); right = Math.min(right, b.left + (node.clientLeft + node.clientWidth) * sx); }
      if (/^(auto|scroll|hidden|clip)$/.test(style.overflowY)) { top = Math.max(top, b.top + node.clientTop * sy); bottom = Math.min(bottom, b.top + (node.clientTop + node.clientHeight) * sy); }
    }
    return { width: right - left, height: bottom - top };
  });
  expect(clip.width).toBeGreaterThanOrEqual(box.width - 1); expect(clip.height).toBeGreaterThanOrEqual(box.height - 1);
  const visibleText = await nativeText(target);
  if (visibleText.hasText) expect(visibleText.rects.length).toBeGreaterThan(0);
  for (const text of visibleText.rects) {
    expect(text.x).toBeGreaterThanOrEqual(box.x - 1); expect(text.x + text.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(text.y).toBeGreaterThanOrEqual(box.y - 1); expect(text.y + text.height).toBeLessThanOrEqual(box.y + box.height + 1);
  }
  const hitWitness = await target.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const describe = (node: Element | null) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect(); const css = getComputedStyle(node);
      return { tag: node.tagName, id: node.id, role: node.getAttribute('role'), title: node.getAttribute('title'),
        label: node.getAttribute('aria-label'), testId: node.getAttribute('data-testid'), classes: node.getAttribute('class'),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        position: css.position, zIndex: css.zIndex, pointerEvents: css.pointerEvents, overflowY: css.overflowY };
    };
    const hitAncestors = []; for (let node = hit; node && hitAncestors.length < 6; node = node.parentElement) hitAncestors.push(describe(node));
    return { matches: hit !== null && (element === hit || element.contains(hit)), target: describe(element), hit: describe(hit),
      hitAncestors, viewport: { width: innerWidth, height: innerHeight } };
  });
  expect(hitWitness.matches, 'B_NATIVE_HIT ' + JSON.stringify(hitWitness)).toBe(true);
  expect(await target.isDisabled()).toBe(disabled);
  if (!disabled) {
    await target.click({ trial: true });
  }
}
async function click(target: Locator): Promise<void> { await unique(target); await target.click({ trial: true }); await target.click(); }
async function submitClick(s: Session, target: Locator, endpoint: string): Promise<void> {
  await control(s, target);
  const response = s.page.waitForResponse(reply => reply.url() === `${ORIGIN}${endpoint}` && reply.request().method() === 'POST')
    .then(reply => ({ reply, error: undefined as unknown }), error => ({ reply: undefined, error }));
  await click(target);
  const observed = await response; if (observed.error || !observed.reply) fail(`B_FIXTURE_SUBMIT_RESPONSE ${rawError(observed.error)}`);
  if (!observed.reply.ok()) fail(`B_FIXTURE_SUBMIT_RESPONSE_STATUS ${endpoint} ${observed.reply.status()}`);
}
async function settle(s: Session): Promise<void> { await s.page.evaluate(() => window.additionalB.settle()); }
async function viewport(s: Session, width: number, height: number): Promise<void> {
  await s.page.setViewportSize({ width, height });
  await s.page.evaluate(({ width, height }) => window.additionalB.viewport(width, height), { width, height });
}
async function state(s: Session): Promise<State> { return s.page.evaluate(() => window.additionalB.state); }
function infrastructure(s: Session): void { if (s.faults.length) fail(`B_FIXTURE_INFRASTRUCTURE_ERROR ${s.faults.join('\n')}`); }
async function modelLoaded(s: Session): Promise<void> {
  try {
    await s.page.waitForFunction(() => {
      const canvas = document.querySelector('canvas'); const text = document.body.textContent || '';
      return canvas !== null && /obj\s*·\s*1\s*面/i.test(text) && !text.includes('加载 3D 模型中...');
    });
    infrastructure(s);
    const info = await panel(s).locator('canvas').evaluate(element => {
      const canvas = element as HTMLCanvasElement;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return { real: gl !== null, lost: gl ? gl.isContextLost() : true, width: canvas.width, height: canvas.height };
    });
    if (!info.real || info.lost || info.width <= 0 || info.height <= 0) fail(`B_FIXTURE_WEBGL_BLOCKER ${JSON.stringify(info)}`);
  } catch (error) {
    const detail = `B_FIXTURE_WEBGL_OR_OBJ_BLOCKER: ${rawError(error)}\n${s.faults.join('\n')}`;
    blockers.set('model3d', detail); fail(detail);
  }
}
async function openAspect(s: Session): Promise<void> {
  const image = s.page.locator(`[data-canvas-image-id="${SOURCE_ID}"]`); await image.waitFor({ state: 'visible' }); await click(image);
  const mobile = s.page.locator('[data-mobile-image-actions]');
  if (await mobile.isVisible()) {
    await click(mobile.getByRole('button', { name: '更多', exact: true }));
    await click(s.page.getByRole('dialog', { name: '图片工具', exact: true }).getByRole('button', { name: '横竖重组', exact: true }));
  } else {
    const toolbar = s.page.locator('[data-toolbar="image-action-toolbar"]');
    let action = toolbar.getByRole('button', { name: '横竖重组', exact: true });
    if (await action.count() === 0 || !await action.isVisible()) {
      await click(toolbar.getByRole('button', { name: /展开更多工具/ })); action = toolbar.getByRole('button', { name: '横竖重组', exact: true });
    }
    await click(action);
  }
  await panel(s).waitFor({ state: 'attached' });
  const anchoring = await panel(s).evaluate((element, sourceId) => ({
    bodyPortal: element.parentElement === document.body,
    fixed: getComputedStyle(element).position === 'fixed',
    canvasMounted: document.querySelector('[data-canvas-viewport]')?.isConnected === true,
    sourceInCanvas: document.querySelector('[data-canvas-image-id="' + sourceId + '"]')?.closest('[data-canvas-viewport]')?.isConnected === true,
  }), SOURCE_ID);
  // The reviewed popup is viewport-fixed outside the transformed Canvas. The
  // original Canvas/source stay mounted; native geometry and hit checks follow.
  expect(anchoring).toEqual({ bodyPortal: true, fixed: true, canvasMounted: true, sourceInCanvas: true });
}
async function mount(s: Session, width: number, height: number): Promise<void> {
  // The viewer loads its real OBJ on desktop, then the SAME renderer is resized.
  // A zero-width mobile scene must not be mistaken for missing WebGL support.
  await viewport(s, s.kind === 'model3d' ? 1440 : width, s.kind === 'model3d' ? 900 : height);
  await s.page.evaluate(theme => window.additionalB.mount(theme), s.theme); s.mounted = true;
  if (s.kind === 'aspect') await openAspect(s); else await panel(s).waitFor({ state: 'visible' });
  if (s.kind === 'favorites') await panel(s).getByText(PROMPT, { exact: true }).waitFor({ state: 'visible' });
  if (s.kind === 'sticker') await s.page.waitForFunction(() => document.querySelectorAll('select option').length >= 4);
  if (s.kind === 'model3d') { await modelLoaded(s); await viewport(s, width, height); }
  if (s.kind === 'effect') {
    const workspace = panel(s).locator('[data-panel="workspace"]'); await unique(workspace);
    // This is the actual parent grid with the actual source panel as sibling.
    expect(await workspace.evaluate(element => element.parentElement?.children.length)).toBe(2);
  }
  await settle(s); infrastructure(s);
}
function selectByLabel(s: Session, label: string): Locator {
  return panel(s).locator('label').filter({ hasText: new RegExp(`^${label}$`) }).locator('..').locator('select');
}
function projectSearch(s: Session): Locator { return panel(s).getByPlaceholder('搜索提示词/模型...'); }
function favoriteSearch(s: Session): Locator { return panel(s).getByPlaceholder('搜索关键词、模型、用户...'); }
function favoriteCard(s: Session): Locator { return panel(s).locator('div.group').filter({ has: s.page.getByText(PROMPT, { exact: true }) }); }
function effectWorkspace(s: Session): Locator { return panel(s).locator('[data-panel="workspace"]'); }

async function fillInput(s: Session, target: Locator, value: string): Promise<void> {
  await control(s, target); await target.fill(value);
}
async function selectInput(s: Session, target: Locator, value: string): Promise<void> {
  await control(s, target); await target.selectOption(value);
}
async function inputGeometry(s: Session): Promise<void> {
  const inputs: Locator[] = [];
  switch (s.kind) {
    case 'projectdata': inputs.push(projectSearch(s)); break;
    case 'favorites': inputs.push(favoriteSearch(s), panel(s).locator('select').first()); break;
    case 'sticker': {
      const subject = panel(s).getByPlaceholder('例如: 橘猫、奶茶杯、小恐龙...');
      if (await subject.count()) {
        inputs.push(subject, panel(s).locator('select').nth(0), panel(s).locator('select').nth(1));
        for (const placeholder of ['输入自定义风格提示词...', '输入自定义主题描述和想要的文案...']) {
          const custom = panel(s).getByPlaceholder(placeholder); if (await custom.count()) inputs.push(custom);
        }
        inputs.push(panel(s).getByRole('button', { name: '生成表情计划', exact: true }));
      } else {
        // Original step 1/2 unmounts settings. Never fabricate editable models.
        inputs.push(panel(s).getByRole('button', { name: /^(开始生成|停止)$/ }));
      }
      break;
    }
    case 'psd': {
      if (await selectByLabel(s, '图像模型').count() === 0) {
        const settings = header(s).getByRole('button', { name: '模型', exact: true });
        await control(s, settings); await click(settings); // Original settings only; no value changes.
      }
      inputs.push(panel(s).getByPlaceholder('描述你想要的画面效果...'), panel(s).getByPlaceholder('主标题', { exact: true }),
        panel(s).getByPlaceholder('副标题', { exact: true }), selectByLabel(s, '图像模型'), selectByLabel(s, 'LLM 模型'));
      inputs.push(panel(s).getByRole('button', { name: /^(开始生成|取消)$/ })); break;
    }
    case 'model3d': inputs.push(panel(s).getByTitle(/^(线框模式|实体模式)$/), panel(s).getByTitle('预设视角', { exact: true })); break;
    case 'effect': inputs.push(effectWorkspace(s).getByPlaceholder('拆图说明与人工复核备注'),
      panel(s).getByPlaceholder('未设置', { exact: true }), panel(s).getByRole('button', { name: '生成拆图文件', exact: true })); break;
    case 'aspect': inputs.push(panel(s).getByRole('button', { name: /^9:16/ }),
      panel(s).getByRole('button', { name: /^(按 .+ 开始重组|正在重组\.\.\.)$/ })); break;
  }
  for (const input of inputs) await control(s, input);
}

async function initialGeometry(s: Session): Promise<void> {
  await visibleBounds(s, panel(s), s.kind === 'effect' ? 0 : 8);
  const title = header(s).getByText(({ projectdata: '资产库', favorites: '收藏夹', sticker: '表情助手', psd: 'AI PSD 生成器',
    model3d: '3D 模型预览', effect: '效果图反向拆图 Pro', aspect: '横竖智能重组' } as const)[s.kind], { exact: true });
  if (s.kind === 'model3d') await control(s, closeButton(s));
  await nonOverlap([title, closeButton(s)]);
  if (s.kind === 'effect') {
    const tools = effectWorkspace(s).getByLabel('预览工具', { exact: true });
    const buttons = ['选择', '移动', '四点标注', '放大', '缩小', '重置视图'].map(name => tools.getByTitle(name, { exact: true }));
    for (const button of buttons) await control(s, button);
    await nonOverlap(buttons);
    const modes = ['原图', '结构层', '对比'].map(name => effectWorkspace(s).getByRole('button', { name, exact: true }));
    for (const button of modes) await control(s, button); await nonOverlap([...buttons, ...modes]);
    await control(s, closeButton(s));
  } else if (s.kind !== 'model3d') {
    await control(s, closeButton(s));
  }
}
async function configure(s: Session): Promise<void> {
  switch (s.kind) {
    case 'projectdata': {
      await fillInput(s, projectSearch(s), PROMPT); await click(panel(s).getByTitle('列表模式', { exact: true }));
      await click(panel(s).getByTitle('大图模式', { exact: true })); break;
    }
    case 'favorites': {
      await fillInput(s, favoriteSearch(s), PROMPT); await selectInput(s, panel(s).locator('select').first(), 'model');
      await click(favoriteCard(s)); await panel(s).getByText('参数详情', { exact: true }).waitFor({ state: 'visible' }); break;
    }
    case 'sticker': {
      await fillInput(s, panel(s).getByPlaceholder('例如: 橘猫、奶茶杯、小恐龙...'), '橘猫');
      await selectInput(s, panel(s).locator('select').nth(0), `${PROVIDER}::${CHAT_MODEL}`);
      await selectInput(s, panel(s).locator('select').nth(1), `${PROVIDER}::${IMAGE_MODEL}`);
      const style = panel(s).locator('label').filter({ hasText: /^风格$/ }).locator('..');
      await control(s, style.getByRole('button', { name: /自定义/ })); await click(style.getByRole('button', { name: /自定义/ }));
      await fillInput(s, panel(s).getByPlaceholder('输入自定义风格提示词...'), '简洁手绘');
      const theme = panel(s).locator('label').filter({ hasText: /^主题$/ }).locator('..');
      await control(s, theme.getByRole('button', { name: /自定义/ })); await click(theme.getByRole('button', { name: /自定义/ }));
      await fillInput(s, panel(s).getByPlaceholder('输入自定义主题描述和想要的文案...'), '日常问候'); break;
    }
    case 'psd': {
      await fillInput(s, panel(s).getByPlaceholder('描述你想要的画面效果...'), PSD_PROMPT);
      await fillInput(s, panel(s).getByPlaceholder('主标题', { exact: true }), '离线主标题');
      await fillInput(s, panel(s).getByPlaceholder('副标题', { exact: true }), '离线副标题');
      await control(s, panel(s).getByRole('button', { name: '9:16', exact: true })); await click(panel(s).getByRole('button', { name: '9:16', exact: true }));
      if (await selectByLabel(s, '图像模型').count() === 0) {
        await control(s, header(s).getByRole('button', { name: '模型', exact: true })); await click(header(s).getByRole('button', { name: '模型', exact: true }));
      }
      await selectInput(s, selectByLabel(s, '图像模型'), 'psd-image-2'); await selectInput(s, selectByLabel(s, 'LLM 模型'), 'psd-chat-2'); break;
    }
    case 'model3d': {
      await click(panel(s).getByTitle('线框模式', { exact: true }));
      await click(panel(s).getByTitle('预设视角', { exact: true }));
      await click(panel(s).getByRole('button', { name: '正面', exact: true })); break;
    }
    case 'effect': {
      await fillInput(s, effectWorkspace(s).getByPlaceholder('拆图说明与人工复核备注'), INSTRUCTION);
      await control(s, panel(s).getByRole('button', { name: '制作深化', exact: true })); await click(panel(s).getByRole('button', { name: '制作深化', exact: true }));
      await fillInput(s, panel(s).getByPlaceholder('未设置', { exact: true }), '1200');
      await control(s, effectWorkspace(s).getByRole('tab', { name: '平面拆图', exact: true })); await click(effectWorkspace(s).getByRole('tab', { name: '平面拆图', exact: true }));
      const frame = effectWorkspace(s).getByTestId('effect-reverse-flat-grid').locator('[data-preview-image-frame]');
      await frame.scrollIntoViewIfNeeded();
      await s.page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>('[data-testid="effect-reverse-flat-grid"] img');
        return image?.complete && image.naturalWidth === 64;
      });
      // Read-only native-event observer: no handler replacement or event synthesis.
      await effectWorkspace(s).getByTestId('effect-reverse-flat-grid').evaluate(element => {
        element.addEventListener('pointerdown', event => {
          const pointer = event as PointerEvent; const r = element.getBoundingClientRect();
          window.additionalB.state.pointerInputs.push({ clientX: pointer.clientX, clientY: pointer.clientY,
            left: r.left, top: r.top, width: r.width, height: r.height });
        }, { passive: true });
      });
      for (const [x, y] of [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]]) {
        // Scroll real clipping ancestors to each intended input point. Never
        // replace their rectangles, draw fake points, or change their styles.
        await frame.evaluate((element, fraction) => {
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            if (!/(auto|scroll)/.test(getComputedStyle(parent).overflowY) || parent.scrollHeight <= parent.clientHeight) continue;
            const b = element.getBoundingClientRect(); const clip = parent.getBoundingClientRect();
            parent.scrollBy({ top: b.y + b.height * fraction - clip.y - clip.height / 2, behavior: 'instant' });
          }
        }, y);
        await settle(s); const box = await rect(frame); const point = { x: box.x + box.width * x, y: box.y + box.height * y };
        const visible = await s.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        expect(point.x).toBeGreaterThanOrEqual(0); expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThan(visible.width); expect(point.y).toBeLessThan(visible.height);
        const pointWitness = await frame.evaluate((element, p) => {
          const hit = document.elementFromPoint(p.x, p.y); const r = element.getBoundingClientRect();
          const describe = (node: Element | null) => node ? { tag: node.tagName, id: node.id,
            testId: node.getAttribute('data-testid'), classes: node.getAttribute('class'), title: node.getAttribute('title'),
            position: getComputedStyle(node).position, zIndex: getComputedStyle(node).zIndex } : null;
          const ancestors = []; for (let node = hit; node && ancestors.length < 6; node = node.parentElement) ancestors.push(describe(node));
          return { matches: !!hit && (element === hit || element.contains(hit)), point: p, frame: { x: r.x, y: r.y, width: r.width, height: r.height }, hit: describe(hit), ancestors };
        }, point);
        expect(pointWitness.matches, 'B_NATIVE_POINT ' + JSON.stringify(pointWitness)).toBe(true);
        await s.page.mouse.click(point.x, point.y);
      }
      const inputs = (await state(s)).pointerInputs;
      if (inputs.length !== 4) fail(`B_FIXTURE_EFFECT_NATIVE_POINTER_COUNT ${inputs.length}`);
      s.effectPoints = inputs.map(p => {
        const side = Math.min(p.width, p.height);
        if (!(side > 0)) fail('B_FIXTURE_EFFECT_NATIVE_RECT_EMPTY');
        return { x: Math.max(0, Math.min(1, (p.clientX - p.left - (p.width - side) / 2) / side)),
          y: Math.max(0, Math.min(1, (p.clientY - p.top - (p.height - side) / 2) / side)) };
      });
      await unique(effectWorkspace(s).getByRole('button', { name: '移动透视点 4', exact: true }));
      await click(effectWorkspace(s).getByRole('tab', { name: '效果预览', exact: true })); break;
    }
    case 'aspect': await control(s, panel(s).getByRole('button', { name: /^9:16/ })); await click(panel(s).getByRole('button', { name: /^9:16/ })); break;
  }
  await settle(s); infrastructure(s);
}
async function retained(s: Session): Promise<void> {
  expect((await state(s)).mounts).toBe(1); expect((await state(s)).closes).toBe(0);
  switch (s.kind) {
    case 'projectdata': expect(await projectSearch(s).inputValue()).toBe(PROMPT); break;
    case 'favorites': expect(await favoriteSearch(s).inputValue()).toBe(PROMPT); await unique(panel(s).getByText('参数详情', { exact: true })); break;
    case 'sticker': {
      expect(await panel(s).getByPlaceholder('例如: 橘猫、奶茶杯、小恐龙...').inputValue()).toBe('橘猫');
      expect(await panel(s).getByPlaceholder('输入自定义风格提示词...').inputValue()).toBe('简洁手绘');
      expect(await panel(s).getByPlaceholder('输入自定义主题描述和想要的文案...').inputValue()).toBe('日常问候');
      expect(await panel(s).locator('select').nth(0).inputValue()).toBe(`${PROVIDER}::${CHAT_MODEL}`);
      expect(await panel(s).locator('select').nth(1).inputValue()).toBe(`${PROVIDER}::${IMAGE_MODEL}`); break;
    }
    case 'psd': {
      expect(await panel(s).getByPlaceholder('描述你想要的画面效果...').inputValue()).toBe(PSD_PROMPT);
      expect(await panel(s).getByPlaceholder('主标题', { exact: true }).inputValue()).toBe('离线主标题');
      expect(await selectByLabel(s, '图像模型').inputValue()).toBe('psd-image-2');
      expect(await selectByLabel(s, 'LLM 模型').inputValue()).toBe('psd-chat-2'); break;
    }
    case 'model3d': await unique(panel(s).getByTitle('实体模式', { exact: true })); await modelLoaded(s); break;
    case 'effect': {
      expect(await effectWorkspace(s).getByPlaceholder('拆图说明与人工复核备注').inputValue()).toBe(INSTRUCTION);
      expect(await panel(s).getByPlaceholder('未设置', { exact: true }).inputValue()).toBe('1200');
      expect(await panel(s).getByRole('button', { name: '制作深化', exact: true }).getAttribute('aria-pressed')).toBe('true'); break;
    }
    case 'aspect': {
      await unique(panel(s).getByRole('button', { name: '按 9:16 开始重组', exact: true }));
      expect((await state(s)).selectedId).toBe(SOURCE_ID); break;
    }
  }
  const persistedPair = await s.page.evaluate(() => JSON.parse(localStorage.getItem('wujie_selected_model') || 'null'));
  expect(persistedPair).toEqual({ model: IMAGE_MODEL, providerId: PROVIDER, quality: 'standard' });
  await inputGeometry(s);
}
async function cycle(s: Session): Promise<void> {
  const carrier = s.kind === 'aspect' ? s.page.locator('[data-canvas-viewport]') : panel(s);
  const original: ElementHandle<SVGElement | HTMLElement> | null = await carrier.elementHandle(); if (!original) fail('B_FIXTURE_CARRIER_MISSING');
  const popup = s.kind === 'aspect' ? await panel(s).elementHandle() : null;
  if (s.kind === 'aspect' && !popup) fail('B_FIXTURE_POPUP_IDENTITY_MISSING');
  try {
    await viewport(s, 390, 780); expect(await original.evaluate(element => element.isConnected)).toBe(true);
    if (popup) expect(await popup.evaluate(element => element.isConnected)).toBe(true);
    await retained(s); await initialGeometry(s);
    // Same real desktop/phone mount; only VV keyboard metrics change here.
    await s.page.evaluate(() => window.additionalB.viewport(390, 300, 0, 24));
    expect(await original.evaluate(element => element.isConnected)).toBe(true);
    if (popup) expect(await popup.evaluate(element => element.isConnected)).toBe(true); await retained(s); await initialGeometry(s);
    await s.page.evaluate(() => window.additionalB.viewport(390, 780));
    const minimize = minimizeButton(s);
    if (minimize) {
      await control(s, minimize); await click(minimize);
      expect(await original.evaluate(element => element.isConnected)).toBe(true);
    if (popup) expect(await popup.evaluate(element => element.isConnected)).toBe(true);
      const restore = s.kind === 'effect' ? header(s).getByTitle('还原', { exact: true }) : minimizeButton(s)!;
      await control(s, restore); await click(restore); await retained(s);
    }
    await viewport(s, 740, 360); await retained(s); await initialGeometry(s); if (popup) expect(await popup.evaluate(element => element.isConnected)).toBe(true);
    await viewport(s, 1440, 900); await retained(s); if (popup) expect(await popup.evaluate(element => element.isConnected)).toBe(true);
  } finally { await original.dispose(); if (popup) await popup.dispose(); }
}
async function close(s: Session): Promise<void> {
  const before = s.cancels.length; await control(s, closeButton(s)); await click(closeButton(s)); await settle(s);
  if (s.kind === 'aspect') {
    expect(await panel(s).count()).toBe(0); expect((await state(s)).mounts).toBe(1);
  } else { expect((await state(s)).closes).toBe(1); expect(await panel(s).count()).toBe(0); }
  expect(s.cancels.length).toBe(before);
}
async function downloadBytes(s: Session, target: Locator, perform: () => Promise<void> = () => click(target)): Promise<Buffer> {
  await control(s, target);
  if (s.kind === 'psd' || s.kind === 'effect') observeBoundary(s, 'download-before-click', await target.evaluate(element => ({ tag: element.tagName,
    href: element instanceof HTMLAnchorElement ? element.href : null, download: element instanceof HTMLAnchorElement ? element.download : null })));
  // Handle the waiter even when a numeric assertion inside perform() fails;
  // preserve that original failure rather than creating an unhandled timeout.
  const download: Promise<{ item?: Download; error?: unknown }> = s.page.waitForEvent('download')
    .then(item => ({ item }), error => ({ error }));
  await perform(); observeBoundary(s, 'download-perform-complete', null); const observed = await download;
  if (observed.error || !observed.item) fail(`B_FIXTURE_DOWNLOAD_EVENT ${rawError(observed.error)}`);
  const item = observed.item;
  const filename = await item.path(); if (!filename) fail('B_FIXTURE_DOWNLOAD_PATH_MISSING');
  const error = await item.failure(); if (error) fail(`B_FIXTURE_DOWNLOAD_FAILED ${error}`);
  return readFile(filename);
}

async function projectAssets(s: Session, deleteAfter: boolean): Promise<void> {
  await control(s, panel(s).getByRole('button', { name: '同款', exact: true }));
  await click(panel(s).getByRole('button', { name: '同款', exact: true }));
  expect((await state(s)).callbacks.filter(item => item.name === 'same').map(item => item.value)).toEqual([SOURCE_IMAGE]);
  const image = panel(s).getByRole('img', { name: PROMPT, exact: true }).locator('..'); await click(image);
  expect((await state(s)).callbacks.filter(item => item.name === 'navigate').map(item => item.value)).toEqual([SOURCE_ID]);
  await click(panel(s).getByTitle('批量管理', { exact: true })); await click(panel(s).getByRole('button', { name: '全选', exact: true }));
  const action = panel(s).getByRole('button', { name: '下载压缩包', exact: true });
  const bytes = await downloadBytes(s, action, async () => {
    s.downloadHeld = true; await click(action);
    const packing = panel(s).getByRole('button', { name: '打包中...', exact: true }); await packing.waitFor({ state: 'visible' });
    await control(s, packing); expect(await packing.isDisabled()).toBe(true); s.release();
  });
  const zip = await JSZip.loadAsync(bytes); const files = Object.values(zip.files).filter(entry => !entry.dir);
  expect(files.length).toBe(1); expect(await files[0].async('nodebuffer')).toEqual(s.media.get('/fixtures/source.png'));
  if (deleteAfter) {
    await click(panel(s).getByRole('button', { name: '删除 (1)', exact: true }));
    expect((await state(s)).callbacks.filter(item => item.name === 'delete').map(item => item.value)).toEqual([[SOURCE_ID]]);
    expect((await state(s)).images.map(imageValue => imageValue.id)).toEqual(['additional-b-second']);
    await panel(s).getByText('暂无图片数据', { exact: true }).waitFor({ state: 'visible' });
  }
  expect(s.submissions.length).toBe(0); expect(s.cancels.length).toBe(0);
}
async function favoriteAssets(s: Session, deleteAfter: boolean): Promise<void> {
  const detail = panel(s).getByText('参数详情', { exact: true }).locator('xpath=../..');
  await favoriteCard(s).hover(); await click(favoriteCard(s).getByRole('button', { name: '预览', exact: true }));
  const preview = panel(s).getByText('图片详情', { exact: true }).locator('xpath=../..');
  await control(s, preview.getByRole('button', { name: '调用参数', exact: true }));
  await click(preview.getByRole('button', { name: '调用参数', exact: true }));
  expect((await state(s)).callbacks.filter(item => item.name === 'apply').map(item => item.value)).toEqual([FAVORITE]);
  // The transient "已调用" grid overlay does not cover the separate details bar.
  // During its original transient feedback the same button is named "已调用".
  const applyAgain = detail.getByRole('button', { name: /^(调用参数|已调用)$/ });
  await control(s, applyAgain); await click(applyAgain);
  expect((await state(s)).callbacks.filter(item => item.name === 'apply').map(item => item.value)).toEqual([FAVORITE, FAVORITE]);
  const bytes = await downloadBytes(s, panel(s).getByTitle('导出收藏', { exact: true }));
  expect(JSON.parse(bytes.toString('utf8'))).toEqual([FAVORITE]);
  if (deleteAfter) {
    await click(panel(s).getByTitle('批量管理', { exact: true }));
    await click(favoriteCard(s));
    const remove = panel(s).getByRole('button', { name: /删除/ }); await unique(remove); await click(remove);
    await panel(s).getByText('暂无收藏', { exact: true }).waitFor({ state: 'visible' });
    expect(await s.page.evaluate(() => JSON.parse(localStorage.getItem('wujie-favorites-local') || '[]'))).toEqual([{ id: 'other-user-sentinel', userId: 'other-user', imageUrl: '/other-user.png' }]);
  }
  expect(s.submissions.length).toBe(0); expect(s.cancels.length).toBe(0);
}
async function stickerTask(s: Session, continuity: boolean): Promise<void> {
  await control(s, panel(s).getByRole('button', { name: '生成表情计划', exact: true }));
  await click(panel(s).getByRole('button', { name: '生成表情计划', exact: true }));
  await panel(s).getByRole('button', { name: '开始生成', exact: true }).waitFor({ state: 'visible' });
  await control(s, panel(s).getByRole('button', { name: '开始生成', exact: true }));
  await click(panel(s).getByRole('button', { name: '开始生成', exact: true }));
  const stop = panel(s).getByRole('button', { name: '停止', exact: true }); await stop.waitFor({ state: 'visible' });
  await s.page.waitForFunction(() => (document.body.textContent || '').includes('生成中'));
  await control(s, stop); await visibleBounds(s, panel(s), 8); expect(s.released).toBe(false);
  await inputGeometry(s);
  if (continuity) {
    await pendingCarry(s);
    const before = s.cancels.length; await click(stop); expect(s.cancels.length).toBe(before);
    await control(s, closeButton(s)); // Closing is checked after the original batch drains, never fake-cancelled.
  }
  s.phase = 'completed'; s.release();
  const add = panel(s).getByRole('button', { name: '添加到画布 (9)', exact: true }); await add.waitFor({ state: 'visible' });
  await control(s, add); await click(add);
  expect((await state(s)).callbacks.filter(item => item.name === 'add').map(item => item.value)).toEqual([{ urls: Array(9).fill(BORDER_URL), meta: { modelName: IMAGE_MODEL, apiProvider: PROVIDER } }]);
  expect(s.generationSeen.size).toBe(9); expect(s.multipartCount).toBe(9); expect(s.cancels).toEqual([]);
  const zipButton = iconButton(panel(s), s.page, 'archive');
  const bytes = await downloadBytes(s, zipButton); const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files).filter(entry => !entry.dir); expect(entries.length).toBe(9);
  for (const entry of entries) expect(await entry.async('nodebuffer')).toEqual(s.media.get('/fixtures/sticker-border.png'));
}
async function psdTaskFlow(s: Session, continuity: boolean): Promise<void> {
  await submitClick(s, panel(s).getByRole('button', { name: '开始生成', exact: true }), '/api/ai-psd/create');
  const cancel = panel(s).getByRole('button', { name: '取消', exact: true }); await cancel.waitFor({ state: 'visible' });
  await panel(s).getByText('离线图层处理中', { exact: true }).last().waitFor({ state: 'visible' });
  await control(s, cancel); await visibleBounds(s, panel(s), 8);
  await inputGeometry(s);
  if (continuity) {
    await pendingCarry(s);
    observeBoundary(s, 'before-original-cancel-click', { taskId: s.taskId });
    await click(cancel); observeBoundary(s, 'after-original-cancel-click', { taskId: s.taskId });
    await panel(s).getByRole('button', { name: '开始生成', exact: true }).waitFor({ state: 'visible' });
    expect(s.cancels).toEqual(['additional-b-psd-1']);
    await retained(s); await submitClick(s, panel(s).getByRole('button', { name: '开始生成', exact: true }), '/api/ai-psd/create');
    await cancel.waitFor({ state: 'visible' });
    await panel(s).getByText('离线图层处理中', { exact: true }).last().waitFor({ state: 'visible' });
  }
  s.phase = 'completed';
  const psd = panel(s).getByRole('button', { name: 'PSD', exact: true }); await psd.waitFor({ state: 'visible' });
  await control(s, psd); await control(s, panel(s).getByRole('button', { name: '添加到画布', exact: true }));
  const bytes = await downloadBytes(s, psd); expect(bytes.subarray(0, 4).toString()).toBe('8BPS'); expect(bytes.length).toBe(43);
  await click(panel(s).getByRole('button', { name: '添加到画布', exact: true }));
  expect((await state(s)).callbacks.filter(item => item.name === 'add').map(item => item.value)).toEqual([{ urls: [RESULT_URL], meta: { modelName: 'psd-image-2', apiProvider: PROVIDER } }]);
  expect(s.submissions).toEqual(continuity ? [psdBody(), psdBody()] : [psdBody()]);
}
async function releaseNaturalTerminal(s: Session): Promise<void> {
  const taskId = s.taskId;
  if (!taskId || (s.kind !== 'effect' && s.kind !== 'aspect')) fail('B_FIXTURE_TERMINAL_OBSERVER_SCOPE');
  // Observe the current task's own natural poll, never send another request or
  // fake an SSE event. One max poll cadence + original1500ms action grace; the
  // original45000ms aggregate ceiling and callback1500ms remain unchanged.
  const pendingResponse = s.page.waitForResponse(async response => {
    const request = response.request();
    const matches = s.kind === 'effect'
      ? response.url() === ORIGIN + '/api/effect-reverse-engineering?taskId=' + taskId && request.method() === 'GET'
      : response.url() === ORIGIN + '/api/poll-task' && request.method() === 'POST' && request.postDataJSON()?.taskId === taskId;
    if (!matches || response.status() !== 200) return false;
    const payload = await response.json() as Record<string, unknown>;
    return payload.status === 'completed' && (s.kind !== 'effect' || payload.taskId === taskId);
  }, { timeout: s.kind === 'effect' ? 3000 : 4000 });
  observeBoundary(s, 'before-natural-completion', { taskId });
  s.phase = 'completed';
  const response = await pendingResponse;
  expect(await response.finished()).toBe(null);
  const payload = await response.json() as Record<string, unknown>;
  exact(payload, s.kind === 'effect' ? effectTask(s) : { status: 'completed', progress: 100, imageUrl: RESULT_URL, taskType: 'edit' }, 'current natural terminal body');
  observeBoundary(s, 'after-natural-completion', { taskId });
}
async function effectTaskFlow(s: Session, continuity: boolean): Promise<void> {
  const submit = panel(s).getByRole('button', { name: '生成拆图文件', exact: true }); await submitClick(s, submit, '/api/effect-reverse-engineering');
  const cancel = effectWorkspace(s).getByRole('button', { name: '取消任务', exact: true }); await cancel.waitFor({ state: 'visible' });
  await effectWorkspace(s).getByTestId('effect-reverse-task-progress').waitFor({ state: 'visible' });
  await control(s, cancel); await visibleBounds(s, panel(s));
  await inputGeometry(s);
  const frozen = structuredClone(s.submissions[0]);
  if (continuity) {
    await pendingCarry(s);
    await click(cancel); await s.page.waitForFunction(() => !(document.body.textContent || '').includes('取消任务'));
    expect(s.cancels).toEqual(['additional-b-effect-1']); expect((await state(s)).callbacks.filter(item => item.name === 'effect-result')).toEqual([]);
    await retained(s); await submitClick(s, submit, '/api/effect-reverse-engineering');
    await s.page.waitForFunction(() => (document.body.textContent || '').includes('离线四点校正处理中'));
    exact(s.submissions[1], frozen, 'effect resubmit keeps exact public points/source');
  }
  await releaseNaturalTerminal(s);
  await s.page.waitForFunction(() => window.additionalB.state.callbacks.some(item => item.name === 'effect-result'));
  expect((await state(s)).callbacks.filter(item => item.name === 'effect-result').map(item => item.value)).toEqual([effectResult(s)]);
  const download = panel(s).getByRole('link', { name: '下载结果', exact: true });
  const bytes = await downloadBytes(s, download);
  expect(bytes).toEqual(s.media.get('/fixtures/result.png'));
}
async function aspectTaskFlow(s: Session, continuity: boolean): Promise<void> {
  const before = (await state(s)).images.find(image => image.id === SOURCE_ID); if (!before) fail('B_FIXTURE_SOURCE_NOT_PRESENT');
  const confirm = panel(s).getByRole('button', { name: '按 9:16 开始重组', exact: true }); await submitClick(s, confirm, '/api/aspect-recompose');
  const pending = panel(s).getByRole('button', { name: '正在重组...', exact: true }); await pending.waitFor({ state: 'visible' });
  await control(s, pending); expect(await pending.isDisabled()).toBe(true);
  await inputGeometry(s);
  const pendingState = await state(s); expect(pendingState.images.find(image => image.id === SOURCE_ID)).toEqual(before);
  expect(pendingState.images.filter(image => image.isProcessingPlaceholder).length).toBe(1);
  if (continuity) { await pendingCarry(s); await close(s); expect(s.cancels).toEqual([]); }
  await releaseNaturalTerminal(s);
  await s.page.waitForFunction(() => window.additionalB.state.images.some(image => image.generatedFromImageId === 'additional-b-source' && typeof image.url === 'string' && image.url.endsWith('/fixtures/result.png') && !image.isProcessingPlaceholder));
  const end = await state(s); expect(end.images.find(image => image.id === SOURCE_ID)).toEqual(before);
  const result = end.images.find(image => image.generatedFromImageId === SOURCE_ID && image.url === RESULT_URL);
  expect(result?.model).toBe(IMAGE_MODEL); expect(result?.apiProvider).toBe(PROVIDER); expect(result?.isProcessingPlaceholder).toBe(false);
  expect(s.cancels).toEqual([]); expect(s.terminalServed).toBe(true); expect(await panel(s).count()).toBe(0);
}
async function pendingCarry(s: Session): Promise<void> {
  const carrier = s.kind === 'aspect' ? s.page.locator('[data-canvas-viewport]') : panel(s);
  const original = await carrier.elementHandle(); if (!original) fail('B_FIXTURE_PENDING_CARRIER_MISSING');
  const task = s.taskId; const beforeCancels = s.cancels.slice();
  const pending = (): Locator => s.kind === 'sticker' ? panel(s).getByRole('button', { name: '停止', exact: true })
    : s.kind === 'psd' ? panel(s).getByRole('button', { name: '取消', exact: true })
      : s.kind === 'effect' ? effectWorkspace(s).getByRole('button', { name: '取消任务', exact: true })
        : panel(s).getByRole('button', { name: '正在重组...', exact: true });
  const check = async (): Promise<void> => {
    expect(await original.evaluate(element => element.isConnected)).toBe(true);
    if (popup) expect(await popup.evaluate(element => element.isConnected)).toBe(true);
    await visibleBounds(s, panel(s), s.kind === 'effect' ? 0 : 8);
    await inputGeometry(s);
    await control(s, pending()); await control(s, closeButton(s)); await nonOverlap([pending(), closeButton(s)]);
    expect(s.taskId).toBe(task); expect(s.cancels).toEqual(beforeCancels); expect(s.phase).toBe('pending');
    observeBoundary(s, 'pending-carry-check-passed', { taskId: s.taskId });
    expect((await state(s)).mounts).toBe(1);
  };
  const popup = s.kind === 'aspect' ? await panel(s).elementHandle() : null;
  if (s.kind === 'aspect' && !popup) fail('B_FIXTURE_POPUP_IDENTITY_MISSING');
  try {
    await viewport(s, 390, 780); await check();
    await s.page.evaluate(() => window.additionalB.viewport(390, 300, 0, 24)); await check();
    await s.page.evaluate(() => window.additionalB.viewport(390, 780));
    const minimize = minimizeButton(s);
    if (minimize) {
      await click(minimize); expect(await original.evaluate(element => element.isConnected)).toBe(true);
    if (popup) expect(await popup.evaluate(element => element.isConnected)).toBe(true);
      const restore = s.kind === 'effect' ? header(s).getByTitle('还原', { exact: true }) : minimizeButton(s)!;
      await control(s, restore); await click(restore); await check();
    }
    await viewport(s, 740, 360); await check(); await viewport(s, 1440, 900); await check();
    const pair = await s.page.evaluate(() => JSON.parse(localStorage.getItem('wujie_selected_model') || 'null'));
    expect(pair).toEqual({ model: IMAGE_MODEL, providerId: PROVIDER, quality: 'standard' });
  } finally { await original.dispose(); if (popup) await popup.dispose(); }
}
async function modelActions(s: Session): Promise<void> {
  const canvas = panel(s).locator('canvas'); const box = await rect(canvas);
  expect(box.width).toBeGreaterThanOrEqual(64); expect(box.height).toBeGreaterThanOrEqual(64);
  const actions = ['实体模式', '影棚光', '柔和光', '户外光', '自动旋转', '网格', '预设视角'].map(name => panel(s).getByTitle(name, { exact: true }));
  for (const action of actions) await control(s, action); await nonOverlap(actions);
  await click(panel(s).getByTitle('重新贴图', { exact: true })); await click(panel(s).getByTitle('减面/重建网格', { exact: true }));
  await click(panel(s).getByTitle('发送到3D构图', { exact: true }));
  await click(panel(s).getByTitle('截图到画布', { exact: true }));
  const events = (await state(s)).callbacks;
  expect(events.filter(item => item.name === 'retexture').map(item => item.value)).toEqual(['additional-b-model']);
  expect(events.filter(item => item.name === 'remesh').map(item => item.value)).toEqual(['additional-b-model']);
  expect(events.filter(item => item.name === 'scene').map(item => item.value)).toEqual([{ model: MODEL_URL, info: { modelTaskId: 'additional-b-model', providerId: PROVIDER, model: IMAGE_MODEL } }]);
  const screenshot = events.find(item => item.name === 'screenshot')?.value;
  if (typeof screenshot !== 'string' || !screenshot.startsWith('data:image/png;base64,')) fail('B_FIXTURE_REAL_GL_SCREENSHOT_MISSING');
  const metadata = await sharp(Buffer.from(screenshot.split(',')[1], 'base64')).metadata(); expect(metadata.width).toBeGreaterThan(0);
  const bytes = await downloadBytes(s, panel(s).getByRole('button', { name: '下载模型', exact: true })); expect(bytes.toString()).toBe(OBJ);
}
async function finishActions(s: Session, continuity: boolean): Promise<void> {
  switch (s.kind) {
    case 'projectdata': await projectAssets(s, continuity); break;
    case 'favorites': await favoriteAssets(s, continuity); break;
    case 'sticker': await stickerTask(s, continuity); break;
    case 'psd': await psdTaskFlow(s, continuity); break;
    case 'model3d': await modelActions(s); break;
    case 'effect': await effectTaskFlow(s, continuity); break;
    case 'aspect': await aspectTaskFlow(s, continuity); return;
  }
  await close(s); infrastructure(s);
}

// Catch: an actual mounted panel/control moves out of the phone viewport, shrinks
// below 44 CSS px, or has overlapping native text/hit targets. No copied HTML.
// This new real-browser file spans multiple bounded public UI actions per case.
// Its 45s aggregate ceiling matches A; action1500/setup30000/drain2500 stay unchanged.
describe('mobile additional-b probe', () => {
  for (const kind of KINDS) {
    it(`${kind} gold ${kind === 'effect' ? '740x360' : '390x780'} native geometry probe`, async () => {
      await withSession(kind, 'gold', async s => {
        await mount(s, kind === 'effect' ? 740 : 390, kind === 'effect' ? 360 : 780);
        await initialGeometry(s);
        await inputGeometry(s);
        if (kind === 'effect') { await click(effectWorkspace(s).getByRole('button', { name: '对比', exact: true })); await click(effectWorkspace(s).getByRole('button', { name: '原图', exact: true })); }
        await close(s);
      });
    }, 45000);
  }
});

// Catch: real idle/pending/result controls become clipped or unusable at a
// requested viewport/theme, or their original public task/asset actions diverge.
describe('mobile additional-b acceptance', () => {
  for (const kind of KINDS) for (const [width, height] of VIEWPORTS) for (const theme of THEMES) {
    it(`${kind} ${theme} ${width}x${height} keeps real states and native controls reachable`, async () => {
      await withSession(kind, theme, async s => {
        await mount(s, width, height); await initialGeometry(s); await configure(s); await retained(s);
        await finishActions(s, false);
      });
    }, 45000);
  }
});

// Catch: resizing, keyboard VV changes, or genuine minimize/restore remounts a
// component, loses user input/source/model identity, or changes cancel/close/
// download/apply semantics. Project data/favorites never acquire invented tasks.
describe('mobile additional-b continuity', () => {
  for (const kind of KINDS) for (const theme of THEMES) {
    it(`${kind} ${theme} retains one mounted user session through viewport and original task actions`, async () => {
      await withSession(kind, theme, async s => {
        await mount(s, 1440, 900); await configure(s); await retained(s); await cycle(s);
        await finishActions(s, true);
      });
    }, 45000);
  }
});
