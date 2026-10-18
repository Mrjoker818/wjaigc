// @vitest-environment node
// TEST-ONLY. Authoring is not a RED receipt. Main owns compilation/admission/execution.
// Breaks caught: off-screen floating controls, clipped short-screen tasks, vertical
// control text, lost public inputs/model bindings, and changed cancel/apply semantics.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Request, type Route } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// This literal is independently extractable by main's preflight. Every component,
// hook, React renderer and R3F/Three dependency is the installed real implementation.
const BROWSER_ENTRY = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrandEcommercePanel } from '@/components/brand-ecommerce-panel';
import BrandFactoryPanel from '@/components/brand-factory-panel';
import BrandPackagingPanel from '@/components/brand-packaging-panel';
import LogoSkillPanel from '@/components/logo-skill-panel';
import SceneStudioPanel from '@/components/scene-studio-panel';
import { AgentEditor } from '@/components/agent-editor';
type Kind = 'ecommerce' | 'factory' | 'packaging' | 'logo' | 'scene' | 'agent';
type Theme = 'gold' | 'mono';
type Meta = { modelName?: string; apiProvider?: string };
const root = createRoot(document.getElementById('fixture-root')!);
let mounted = false; let unmounted = false;
const state = { closes: 0, adds: [] as Array<{ urls: string[]; meta?: Meta }>,
  applies: [] as Array<{ url: string; prompt?: string }>, errors: [] as string[] };
function png(color: string): string {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A_FIXTURE_NO_2D_CONTEXT');
  context.fillStyle = color; context.fillRect(0, 0, 64, 64);
  context.fillStyle = '#ffffff'; context.fillRect(12, 12, 24, 36);
  return canvas.toDataURL('image/png');
}
const media = { original: png('#3276a8'), results: [png('#338a54'), png('#8b48a4')] };
// Only keyboard visualViewport metrics/events are synthesized, never DOM geometry.
const visual = Object.assign(new EventTarget(), { width: innerWidth, height: innerHeight,
  offsetLeft: 0, offsetTop: 0, scale: 1 });
Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
const settle = async (): Promise<void> => {
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
};
class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  componentDidCatch(error: Error): void { state.errors.push(error.message); }
  render(): React.ReactNode { return this.state.failed ? null : this.props.children; }
}
const close = (): void => { state.closes++; root.render(null); };
const add = (urls: string[], meta?: Meta): void => { state.adds.push({ urls, meta }); };
Object.assign(window, { additionalAFixture: {
  state, media, settle,
  mount(kind: Kind, theme: Theme): void {
    if (mounted) throw new Error('A_FIXTURE_REMOUNT_FORBIDDEN');
    mounted = true;
    document.documentElement.classList.toggle('dark', theme === 'gold');
    document.documentElement.classList.toggle('theme-monochrome', theme === 'mono');
    // Public generation-panel selection, not a private component state slot.
    localStorage.setItem('wujie_selected_model', JSON.stringify({ model: 'offline-a::image-a',
      providerId: 'offline-a', quality: '2K', aspectRatio: '1:1' }));
    const common = { onClose: close, onAddImages: add, isMonochrome: theme === 'mono' };
    let element: React.ReactNode;
    switch (kind) {
      case 'ecommerce': element = <BrandEcommercePanel {...common} referenceImageUrl={media.original} />; break;
      case 'factory': element = <BrandFactoryPanel {...common} />; break;
      case 'packaging': element = <BrandPackagingPanel {...common} />; break;
      case 'logo': element = <LogoSkillPanel {...common} />; break;
      case 'scene': element = <SceneStudioPanel {...common} />; break;
      case 'agent': element = <AgentEditor projectId="fixture-project" selectedEntityId="fixture-entity"
        sourceVersionId="fixture-version" imageUrl={media.original} imagePrompt="离线原图"
        imageWidth={64} imageHeight={64} onClose={close} isMonochrome={theme === 'mono'}
        onApply={(url, prompt) => { state.applies.push({ url, prompt }); root.render(null); }} />; break;
    }
    root.render(<Boundary>{element}</Boundary>);
  },
  async viewport(width: number, height: number, left = 0, top = 0): Promise<void> {
    Object.assign(visual, { width, height, offsetLeft: left, offsetTop: top });
    window.dispatchEvent(new Event('resize')); visual.dispatchEvent(new Event('resize'));
    visual.dispatchEvent(new Event('scroll')); await settle();
  },
  async unmount(): Promise<void> { if (!unmounted) { root.unmount(); unmounted = true; } await settle(); },
} });
`;

type Kind = 'ecommerce' | 'factory' | 'packaging' | 'logo' | 'scene' | 'agent';
type Theme = 'gold' | 'mono';
type Suite = 'probe' | 'acceptance' | 'continuity';
interface Rect { x: number; y: number; width: number; height: number }
interface Meta { modelName?: string; apiProvider?: string }
interface BridgeState {
  closes: number; adds: Array<{ urls: string[]; meta?: Meta }>;
  applies: Array<{ url: string; prompt?: string }>; errors: string[];
}
interface Media { original: string; results: string[] }
interface Bridge {
  state: BridgeState; media: Media;
  mount: (kind: Kind, theme: Theme) => void;
  viewport: (width: number, height: number, left?: number, top?: number) => Promise<void>;
  settle: () => Promise<void>; unmount: () => Promise<void>;
}
declare global { interface Window { additionalAFixture: Bridge } }
interface Run {
  index: number; taskId: string; runId: string; key: string;
  phase: 'pending' | 'completed' | 'cancelled'; polls: number; terminalServed: boolean;
  gate: Promise<void>; release: () => void;
}
interface Session {
  kind: Kind; suite: Suite; context: BrowserContext; page: Page; media: Media;
  mounted: boolean; closing: boolean; directions: number;
  faults: string[]; requests: string[]; submissions: Record<string, unknown>[];
  cancels: string[]; keys: string[]; runs: Run[]; handlers: Set<Promise<void>>;
  inFlight: Set<Request>;
}
const KINDS: readonly Kind[] = ['ecommerce', 'factory', 'packaging', 'logo', 'scene', 'agent'];
const THEMES: readonly Theme[] = ['gold', 'mono'];
const VIEWS = [[320, 640], [390, 780], [740, 360], [1440, 900]] as const;
const ACCEPTANCE = KINDS.flatMap(kind => VIEWS.flatMap(([width, height]) => THEMES.map(theme => ({ kind, width, height, theme }))));
const CONTINUITY = KINDS.flatMap(kind => THEMES.map(theme => ({ kind, theme })));
const ORIGIN = 'https://additional-a.invalid';
const BRAND = '离线品牌长名称用于验证移动端窗口及标题';
const PROMPT = '保留主体构图与品牌配色，改善光影质感';
const IMAGE_A = '离线图像模型甲';
const IMAGE_B = '离线图像模型乙较长名称';
const CHAT_A = '离线分析模型甲';
const CHAT_B = '离线分析模型乙较长名称';
const PROVIDERS = [{ id: 'offline-a', name: '离线供应商甲', isEnabled: true },
  { id: 'offline-b', name: '离线供应商乙', isEnabled: true }];
const TEMPLATES = [
  { id: 'white-bg', name: '白底主图', icon: '⬜', description: '离线白底图', promptTemplate: '{productDesc}', negativePrompt: '', aspectRatio: '1:1', category: 'product' },
  { id: 'scene-lifestyle', name: '场景氛围图', icon: '🏞️', description: '离线场景图', promptTemplate: '{productDesc}', negativePrompt: '', aspectRatio: '1:1', category: 'scene' },
];
const PROJECT = { id: 'fixture-brand', project_name: '离线既有项目', brand_name: BRAND,
  industry: '家居生活', project_type: '品牌升级', keywords: '[]', target_audience: '', tone: '', description: '',
  logo_url: '', product_url: '', ip_url: '', reference_urls: '[]', brand_dna: 'null',
  creative_directions: '[]', kv_image_url: '', batch_results: '[]', consistency_scores: 'null',
  status: 'active', is_archived: false, created_at: '2026-10-18T00:00:00Z', updated_at: '2026-10-18T00:00:00Z' };
const DIRECTION = { positioning: '现代生活品牌', visualMood: '清晰亲和', colorPalette: ['#123456'],
  typography: '现代黑体', composition: '图形与文字横排', fitReason: '适合离线品牌' };
const DIRECTIONS_REPLY = { success: true, direction: DIRECTION,
  symbol: { coreMetaphor: '连接', iconForm: '几何环', negativeSpaceIdea: '留白', alternativeRoutes: ['单色'] },
  visualNotes: { oneColorBehavior: '单色清晰', smallSizeBehavior: '小尺寸可辨', recommendedLockups: ['横排'] },
  boardLayout: { canvasSpec: '1:1', modules: ['标志'], footerValues: ['清晰'] },
  platformPrompts: [{ platform: 'GPT Image', prompt: '离线品牌标志，几何图形，清晰横排' }], rawResponse: '' };
const STEPS = [{ round: 1, toolName: 'analyze_image', params: {}, result: '离线分析完成', success: true },
  { round: 2, toolName: 'image_edit', params: { prompt: PROMPT }, result: '离线编辑完成', success: true }];
// Hand-written wire expectation, never imported from the production prompt builder.
const PACKAGING_PROMPT = `为品牌「${BRAND}」设计一套商业级包装。
产品名称：
品类：美妆 / 护肤
包装结构：天地盖盒
规格尺寸：?×?×?mm
材质：未指定
工艺：未指定

设计要求：
1. 包装需要具有真实商业落地感。
2. 保持品牌名清晰可见。
3. 视觉风格高级、干净、专业。
4. 材质表现真实，包括纸张、哑膜、烫金、压纹、局部UV等细节。
5. 输出适合品牌提案、电商展示和线下货架展示。
6. 不要生成乱码文字，不要出现错误品牌名，不要出现无关品牌。
输出方向：包装效果图
`;
const SCENE_PROMPT = `请根据用户需求生成一张商业级场景视觉图。用户需求：${PROMPT}。视觉风格：平衡优化。构图要求：主体明确，空间层次清晰，前景、中景、背景关系明确，适合商业广告展示。输出要求：高质量商业广告画面，真实光影，高级质感，画面整洁，品牌感强。[negative: 低质量, 模糊, 变形, 畸形, 水印, 文字]`;
let browser: Browser | undefined;
let css = ''; let bundle = '';
const live = new Set<Session>();

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const componentFiles = KINDS.map(kind => `src/components/${({ ecommerce: 'brand-ecommerce-panel', factory: 'brand-factory-panel', packaging: 'brand-packaging-panel', logo: 'logo-skill-panel', scene: 'scene-studio-panel', agent: 'agent-editor' } as const)[kind]}.tsx`);
  const styleFiles = [...componentFiles, 'src/components/brand-ecommerce/BrandTemplateSelector.tsx',
    'src/components/brand-ecommerce/BrandSettingsForm.tsx', 'src/components/brand-ecommerce/BrandResultGallery.tsx',
    'src/components/brand-ecommerce/BrandAssetManager.tsx', 'src/components/brand-ecommerce/template-fields.ts',
    'src/components/agent-runtime/AgentProgressTimeline.tsx'];
  const sources = await Promise.all(styleFiles.map(file => readFile(path.resolve(file), 'utf8')));
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), {
    base: process.cwd(), loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
          : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  css = compiler.build(new Scanner({}).scanFiles(sources.map(content => ({ content, extension: 'tsx' }))));
  const output = await build({ write: false, metafile: true, bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    stdin: { contents: BROWSER_ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'additional-a-browser-entry.tsx' } });
  bundle = output.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => {
  const failures: string[] = [];
  for (const session of live) {
    try { await dispose(session); } catch (error) { failures.push(String(error)); }
  }
  try { if (browser) await bounded(browser.close(), 5000, 'BROWSER_CLOSE'); }
  finally { browser = undefined; }
  if (failures.length) throw new Error(`A_FIXTURE_FINAL_CLEANUP: ${failures.join('\n')}`);
}, 20000);

async function bounded<T>(operation: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`A_FIXTURE_TIMEOUT:${label}`)), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
function objectBody(request: Request): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(request.postData() || 'null');
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
function generationBody(s: Session): Record<string, unknown> {
  switch (s.kind) {
    case 'ecommerce': return { action: 'generate', templateIds: ['white-bg', 'scene-lifestyle'],
      productDesc: PROMPT, styleExtra: '', sceneDesc: 'modern minimalist interior',
      model: 'image-b', providerId: 'offline-b', llmModel: 'chat-b', llmProviderId: 'offline-b',
      referenceImageUrl: s.media.original, productImageUrl: '', brandColors: [], variantCount: 2, templateFieldValues: {} };
    case 'factory': return { action: 'generate-kv', projectId: 'fixture-brand', theme: PROMPT,
      slogan: '', ratio: '16:9', direction: '', brandDna: null,
      imageModel: 'image-b', imageProviderId: 'offline-b', llmModel: 'chat-b', llmProviderId: 'offline-b', quality: '2K', aspectRatio: '1:1' };
    case 'packaging': return { brandName: BRAND, productName: '', category: 'beauty',
      skuMatrix: [{ id: '1', name: '基础版', spec: '100g', isHero: true }],
      brandAssets: { logoUrl: '', brandColors: [] }, structure: { type: '天地盖盒' }, materialCraft: { materials: [], crafts: [] },
      uploads: [], extendScenes: [], outputModes: ['package_render'], advancedOptions: {
        enableCopywriting: false, enableInfoLayout: false, enableBrandConsistency: true,
        enableCostAnalysis: false, enableFeasibilityAnalysis: false, enableDecompose: false },
      prompt: PACKAGING_PROMPT, exportFormat: 'PNG', model: 'image-b', providerId: 'offline-b',
      chatModel: 'chat-b', chatProviderId: 'offline-b', showcaseSpec: 'standard', quality: '2K', aspectRatio: '1:1' };
    case 'logo': return { action: 'generate-image', prompt: '离线品牌标志，几何图形，清晰横排',
      imageModel: 'image-b', imageProviderId: 'offline-b', quality: '2K', aspectRatio: '1:1', n: 1 };
    case 'scene': return { mode: 'text_to_image', prompt: SCENE_PROMPT,
      negativePrompt: '低质量, 模糊, 变形, 畸形, 水印, 文字', screenshotData: null,
      structureStrength: 60, aspectRatio: '16:9', imageCount: 1, model: 'image-b', providerId: 'offline-b' };
    case 'agent': return { image: s.media.original, projectId: 'fixture-project', assetParentVersionIds: ['fixture-version'],
      selectedEntityId: 'fixture-entity', assetProjectionMode: 'revision', prompt: PROMPT,
      imagePrompt: '离线原图', maskDataUrl: '', maxRounds: 5, model: 'chat-b', providerId: 'offline-b',
      imageModel: 'image-a', imageProviderId: 'offline-a', quality: '2K', aspectRatio: '1:1' };
  }
}
function newRun(s: Session, request: Request): Run {
  const limit = s.suite === 'continuity' ? (s.kind === 'agent' ? 3 : s.kind === 'ecommerce' ? 2 : 1)
    : s.kind === 'agent' ? 1 : 0;
  if (s.runs.length >= limit) throw new Error('A_FIXTURE_EXTRA_SUBMISSION');
  const key = request.headers()['idempotency-key'] || '';
  if (s.kind === 'ecommerce' && !/^brand-ecommerce:[A-Za-z0-9.-]+$/.test(key)) throw new Error('A_FIXTURE_ECOMMERCE_KEY');
  if (s.kind === 'agent' && !/^agent-editor:fixture-project:fixture-entity:[A-Za-z0-9.-]+$/.test(key)) throw new Error('A_FIXTURE_AGENT_KEY');
  if (!['agent', 'ecommerce'].includes(s.kind) && key) throw new Error('A_FIXTURE_UNEXPECTED_KEY');
  if (key && s.keys.includes(key)) throw new Error('A_FIXTURE_REUSED_SUBMISSION_KEY');
  if (key) s.keys.push(key);
  let releaseHold: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { releaseHold = resolve; });
  const index = s.runs.length + 1;
  const run: Run = { index, taskId: `offline-${s.kind}-task-${index}`, runId: `offline-agent-run-${index}`,
    key, phase: 'pending', polls: 0, terminalServed: false, gate, release: () => releaseHold?.() };
  s.runs.push(run); return run;
}
function completed(s: Session, run: Run): Record<string, unknown> {
  switch (s.kind) {
    case 'ecommerce': return { success: true, status: 'completed', result: { results: TEMPLATES.map((template, index) => ({
      templateId: template.id, templateName: template.name, imageUrl: s.media.results[index], variantIndex: 0,
      providerId: 'offline-b', providerName: '离线供应商乙', modelName: 'image-b' })) } };
    case 'factory': return { success: true, imageUrl: s.media.results[0] };
    case 'packaging': return { results: [{ id: 'offline-package-result', type: 'package_render', url: s.media.results[0], prompt: PROMPT }] };
    case 'logo': return { success: true, imageUrls: [s.media.results[0]] };
    case 'scene': return { result: { data: [{ url: s.media.results[0] }] } };
    case 'agent': return { status: 'completed', durableTerminal: true, progress: 100,
      result: { imageUrl: s.media.results[0], prompt: PROMPT, steps: STEPS }, taskId: run.taskId };
  }
}
function events(run: Run, after: number): Array<Record<string, unknown>> {
  const records = [
    { eventId: `${run.runId}-1`, runId: run.runId, sequence: 1, type: 'run.created', timestamp: '2026-10-18T00:00:00Z', payload: {} },
    { eventId: `${run.runId}-2`, runId: run.runId, sequence: 2, type: 'plan.updated', timestamp: '2026-10-18T00:00:01Z',
      payload: { plan: [{ id: 'offline-step', label: '保留主体并完成编辑', status: 'pending' }] } },
    { eventId: `${run.runId}-3`, runId: run.runId, sequence: 3, type: 'tool.progress', timestamp: '2026-10-18T00:00:02Z',
      payload: { stepId: 'offline-step', progress: 47 } },
  ];
  const tail = run.phase === 'pending' ? [] : [{ eventId: `${run.runId}-4`, runId: run.runId,
    sequence: 4, type: run.phase === 'cancelled' ? 'run.cancelled' : 'run.completed',
    timestamp: '2026-10-18T00:00:03Z', payload: {} }];
  return [...records, ...tail].filter(event => event.sequence > after);
}
async function handleRoute(s: Session, route: Route): Promise<void> {
  const request = route.request(); const url = new URL(request.url());
  const method = request.method(); const raw = request.postData(); const body = objectBody(request);
  const headers = request.headers();
  s.requests.push(`${method} ${url.href}`);
  if (s.requests.length > 128) throw new Error('A_FIXTURE_REQUEST_BUDGET_EXHAUSTED');
  if (url.origin !== ORIGIN || url.username || url.password || headers.authorization || headers['x-api-key']) {
    throw new Error(`A_FIXTURE_ORIGIN_OR_CREDENTIAL:${method} ${url.href}`);
  }
  const get = method === 'GET' && raw === null && !headers['idempotency-key'];
  const post = method === 'POST' && headers['content-type']?.toLowerCase() === 'application/json';
  if (get && url.href === `${ORIGIN}/` && request.isNavigationRequest()) {
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="fixture-root"></div></body></html>` }); return;
  }
  if (get && url.href === `${ORIGIN}/logo.png` && s.kind === 'factory') {
    await route.fulfill({ contentType: 'image/png', body: Buffer.from(s.media.original.split(',')[1], 'base64') }); return;
  }
  if (get && (url.href === `${ORIGIN}/api/models?type=image` || url.href === `${ORIGIN}/api/models?type=chat`)) {
    const type = url.searchParams.get('type');
    if (s.kind === 'agent' && type !== 'chat') throw new Error('A_FIXTURE_UNEXPECTED_AGENT_IMAGE_CATALOG');
    await route.fulfill({ json: { success: true, providers: PROVIDERS, models: [
      { id: type === 'image' ? 'image-a' : 'chat-a', name: type === 'image' ? IMAGE_A : CHAT_A,
        providerId: 'offline-a', providerName: '离线供应商甲', type, isDefault: true },
      { id: type === 'image' ? 'image-b' : 'chat-b', name: type === 'image' ? IMAGE_B : CHAT_B,
        providerId: 'offline-b', providerName: '离线供应商乙', type, isDefault: false },
    ] } }); return;
  }
  if (s.kind === 'ecommerce') {
    if (get && url.href === `${ORIGIN}/api/brand-assets?userId=default`) {
      await route.fulfill({ json: { success: true, assets: [] } }); return;
    }
    if (post && !headers['idempotency-key'] && url.href === `${ORIGIN}/api/brand-ecommerce` && isDeepStrictEqual(body, { action: 'templates' })) {
      await route.fulfill({ json: { success: true, templates: TEMPLATES } }); return;
    }
  }
  if (get && s.kind === 'factory' && url.href === `${ORIGIN}/api/brand-factory`) {
    await route.fulfill({ json: { success: true, projects: [PROJECT] } }); return;
  }
  if (get && s.kind === 'scene' && url.href === `${ORIGIN}/api/scene-studio`) {
    await route.fulfill({ json: { scenes: [] } }); return;
  }
  if (post && !headers['idempotency-key'] && s.kind === 'logo' && url.href === `${ORIGIN}/api/logo-skill`
    && isDeepStrictEqual(body, { action: 'generate-directions', brandName: BRAND, brief: PROMPT,
      logoType: 'brand', outputLayout: 'brand-system-board', targetPlatform: 'all', llmModel: 'chat-b', llmProviderId: 'offline-b' })) {
    if (s.directions++ !== 0) throw new Error('A_FIXTURE_EXTRA_DIRECTION');
    await route.fulfill({ json: DIRECTIONS_REPLY }); return;
  }
  const endpoint: Record<Kind, string> = { ecommerce: '/api/brand-ecommerce', factory: '/api/brand-factory',
    packaging: '/api/brand-packaging/generate', logo: '/api/logo-skill', scene: '/api/scene-studio/generate', agent: '/api/agent-edit' };
  if (post && url.href === ORIGIN + endpoint[s.kind] && isDeepStrictEqual(body, generationBody(s))) {
    const run = newRun(s, request); s.submissions.push(body!);
    if (s.kind === 'ecommerce' || s.kind === 'agent') {
      await route.fulfill({ json: { success: true, taskId: run.taskId,
        ...(s.kind === 'agent' ? { runId: run.runId } : {}) } }); return;
    }
    await run.gate;
    if (run.phase !== 'completed') throw new Error('A_FIXTURE_UNSUPPORTED_SYNC_TERMINAL');
    await route.fulfill({ json: completed(s, run) }); run.terminalServed = true; return;
  }
  // An admitted older run may still have an already-dispatched event request.
  // Match only its exact recorded identity; never accept arbitrary task/run IDs.
  const run = s.kind === 'agent' ? s.runs.find(candidate =>
    url.href === `${ORIGIN}/api/agent-edit?taskId=${candidate.taskId}`
    || url.href === `${ORIGIN}/api/agent-edit?taskId=${candidate.taskId}&action=cancel`
    || url.href === `${ORIGIN}/api/agent-runs/${candidate.runId}`
    || [0, 3, 4].some(after => url.href === `${ORIGIN}/api/agent-runs/${candidate.runId}/events?after=${after}`))
    : s.runs.at(-1);
  if (run && s.kind === 'ecommerce' && post && !headers['idempotency-key'] && url.href === `${ORIGIN}/api/poll-task`
    && isDeepStrictEqual(body, { taskId: run.taskId, model: 'image-b', providerId: 'offline-b' })) {
    run.polls++;
    if (run.phase === 'pending') {
      await route.fulfill({ json: { success: true, status: 'processing', progress: 47, label: '离线任务处理中' } }); return;
    }
    await route.fulfill({ json: run.phase === 'cancelled' ? { status: 'cancelled' } : completed(s, run) });
    run.terminalServed = true; return;
  }
  if (run && s.kind === 'ecommerce' && post && !headers['idempotency-key'] && url.href === `${ORIGIN}/api/cancel-task`
    && isDeepStrictEqual(body, { taskId: run.taskId }) && run.phase === 'pending') {
    s.cancels.push(`footer:${run.taskId}`); run.phase = 'cancelled';
    // Poll responses are finite, not held open. Drain an already-dispatched poll
    // before the original client's confirmed-cancel abort; no failed HTTP allowed.
    run.release();
    await bounded(Promise.all([...s.inFlight].filter(candidate => candidate.url() === `${ORIGIN}/api/poll-task`)
      .map(async candidate => { const response = await candidate.response(); if (response) await response.finished(); })), 2000, 'CANCEL_POLL_DRAIN');
    run.terminalServed = true;
    await route.fulfill({ json: { success: true, cancelled: true } }); return;
  }
  if (run && s.kind === 'agent') {
    if (get && url.href === `${ORIGIN}/api/agent-edit?taskId=${run.taskId}`) {
      run.polls++;
      if (run.phase === 'pending') {
        await route.fulfill({ json: { status: 'processing', progress: 47, label: '离线任务处理中', result: { steps: STEPS } } });
      } else {
        await route.fulfill({ json: run.phase === 'cancelled'
          ? { status: 'cancelled', durableTerminal: true } : completed(s, run) }); run.terminalServed = true;
      }
      return;
    }
    if (get && url.href === `${ORIGIN}/api/agent-edit?taskId=${run.taskId}&action=cancel` && run.phase === 'pending') {
      s.cancels.push(`footer:${run.taskId}`); run.phase = 'cancelled'; run.release(); run.terminalServed = true;
      await route.fulfill({ json: { status: 'cancelled', durableTerminal: true } }); return;
    }
    if (get && [0, 3, 4].some(after => url.href === `${ORIGIN}/api/agent-runs/${run.runId}/events?after=${after}`)) {
      const after = Number(url.searchParams.get('after'));
      await route.fulfill({ json: { events: events(run, after) } }); return;
    }
    if (method === 'DELETE' && raw === null && !headers['idempotency-key'] && url.href === `${ORIGIN}/api/agent-runs/${run.runId}` && run.phase === 'pending') {
      s.cancels.push(`timeline:${run.taskId}`); run.phase = 'cancelled'; run.release(); run.terminalServed = true;
      await route.fulfill({ json: { projection: { runId: run.runId, status: 'cancelled', lastSequence: 4,
        plan: [], assetVersionIds: [], ignoredEventIds: [], missingSequences: [], qualityChecks: [] } } }); return;
    }
  }
  throw new Error(`A_FIXTURE_UNEXPECTED_HTTP:${method} ${url.href} body=${raw}`);
}

async function open(kind: Kind, suite: Suite): Promise<Session> {
  if (!browser) throw new Error('A_FIXTURE_BROWSER_NOT_INITIALIZED');
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(2000);
  const s: Session = { kind, suite, context, page, media: { original: '', results: [] }, mounted: false, closing: false,
    directions: 0, faults: [], requests: [], submissions: [], cancels: [], keys: [], runs: [], handlers: new Set(), inFlight: new Set() };
  live.add(s);
  page.on('pageerror', error => s.faults.push(`PAGEERROR:${error.message}`));
  page.on('console', message => { if (message.type() === 'error') s.faults.push(`CONSOLE:${message.text()}`); });
  page.on('dialog', dialog => { s.faults.push(`DIALOG:${dialog.type()}:${dialog.message()}`); void dialog.dismiss(); });
  page.on('request', request => s.inFlight.add(request));
  page.on('requestfinished', request => s.inFlight.delete(request));
  page.on('requestfailed', request => { s.inFlight.delete(request); s.faults.push(`REQUESTFAILED:${request.method()} ${request.url()}:${request.failure()?.errorText}`); });
  page.on('response', response => { if (response.status() >= 400) s.faults.push(`HTTP_ERROR:${response.status()} ${response.url()}`); });
  await context.routeWebSocket('**/*', socket => {
    s.faults.push(`UNEXPECTED_WEBSOCKET:${socket.url()}`); socket.close({ code: 1008, reason: 'offline fixture forbids sockets' });
  });
  await context.route('**/*', async route => {
    const handler = handleRoute(s, route); s.handlers.add(handler);
    try { await handler; }
    catch (error) {
      s.faults.push(`ROUTE:${String(error)}`);
      try { await route.abort('blockedbyclient'); } catch (abortError) { s.faults.push(`ABORT:${String(abortError)}`); }
    } finally { s.handlers.delete(handler); }
  });
  try {
    await page.goto(`${ORIGIN}/`); await page.addScriptTag({ content: bundle });
    s.media = await page.evaluate(() => window.additionalAFixture.media);
    await page.evaluate(async () => {
      for (const url of [window.additionalAFixture.media.original, ...window.additionalAFixture.media.results]) {
        const image = new Image(); image.src = url; await image.decode();
        if (image.naturalWidth !== 64 || image.naturalHeight !== 64) throw new Error('A_FIXTURE_IMAGE_DECODE');
      }
    });
    return s;
  } catch (error) {
    try { await dispose(s); } catch (cleanupError) { throw new Error(`A_FIXTURE_BOOTSTRAP:${String(error)}; ${String(cleanupError)}`); }
    throw error;
  }
}
async function dispose(s: Session): Promise<void> {
  const failures: string[] = [];
  try {
    for (const run of s.runs) {
      if (run.phase === 'pending') run.phase = 'completed';
      run.release();
    }
    await bounded(Promise.all([...s.handlers]), 4000, 'HTTP_DRAIN');
    if (s.mounted && !s.page.isClosed()) {
      await s.page.waitForFunction(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return !buttons.some(button => /^(生成中\.{3}|取消)$/.test(button.textContent?.trim() || ''));
      }, undefined, { timeout: 5000 });
    }
    await waitIdle(s);
  } catch (error) { failures.push(`DRAIN:${String(error)}`); }
  // Unmount is attempted even if a drain/readiness check failed. Closing the
  // context alone is not reported as successful React cleanup.
  try {
    if (s.mounted && !s.page.isClosed()) await bounded(s.page.evaluate(() => window.additionalAFixture.unmount()), 3000, 'UNMOUNT');
    await bounded(Promise.all([...s.handlers]), 3000, 'AFTER_UNMOUNT_DRAIN'); await waitIdle(s);
    if (!s.page.isClosed()) {
      const errors = await s.page.evaluate(() => window.additionalAFixture?.state.errors || []);
      failures.push(...errors.map(error => `REACT:${error}`));
    }
    if (s.inFlight.size) failures.push(`UNSETTLED_REQUESTS:${[...s.inFlight].map(request => request.url()).join(',')}`);
  } catch (error) { failures.push(`UNMOUNT:${String(error)}`); }
  finally {
    s.closing = true;
    try { await bounded(s.context.close(), 5000, 'CONTEXT_CLOSE'); }
    catch (error) { failures.push(String(error)); }
    live.delete(s);
  }
  if (failures.length) throw new Error(`A_FIXTURE_CLEANUP:${failures.join('\n')}`);
}
async function waitIdle(s: Session): Promise<void> {
  const deadline = Date.now() + 1500;
  while ((s.inFlight.size || s.handlers.size) && Date.now() < deadline) {
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  if (s.inFlight.size || s.handlers.size) throw new Error('A_FIXTURE_NETWORK_DID_NOT_DRAIN');
}
async function withSession(kind: Kind, suite: Suite, body: (s: Session) => Promise<void>): Promise<void> {
  const s = await open(kind, suite); let failure: unknown; let failed = false; let cleanup: unknown;
  try { await body(s); } catch (error) { failed = true; failure = error; }
  try { await dispose(s); } catch (error) { cleanup = error; }
  // Infrastructure takes precedence over geometry failures. Never forge a RED.
  if (s.faults.length || cleanup) throw new Error(`A_FIXTURE_INFRASTRUCTURE_ERROR:\n${s.faults.join('\n')}\n${cleanup ? String(cleanup) : ''}`);
  if (failed) throw failure;
}
async function settle(s: Session): Promise<void> { await s.page.evaluate(() => window.additionalAFixture.settle()); }
async function viewport(s: Session, width: number, height: number, visualHeight = height): Promise<void> {
  await s.page.setViewportSize({ width, height });
  await s.page.evaluate(([w, h]) => window.additionalAFixture.viewport(w, h), [width, visualHeight]);
}
function title(s: Session): Locator {
  const names: Record<Kind, string> = { ecommerce: '品牌电商', factory: '品牌工厂', packaging: '品牌包装系统 Pro',
    logo: 'Logo Generator Pro', scene: '3D构图', agent: 'Agent 编排' };
  return s.page.getByText(names[s.kind], { exact: true });
}
function panel(s: Session): Locator {
  switch (s.kind) {
    case 'ecommerce': return s.page.locator('div.fixed[data-floating-panel="true"]');
    case 'factory': return title(s).locator('xpath=../..');
    case 'packaging': case 'scene': return s.page.locator('[data-popup]').filter({ has: title(s) });
    case 'logo': return s.page.locator('div.fixed[data-popup]').filter({ has: title(s) });
    case 'agent': return s.page.locator('[data-popup="agent-editor"]');
  }
}
function header(s: Session): Locator {
  return ['logo', 'packaging', 'scene'].includes(s.kind) ? title(s).locator('xpath=../..') : title(s).locator('xpath=..');
}
function closeControl(s: Session): Locator {
  return header(s).locator('button').filter({ has: s.page.locator('svg.lucide-x') });
}
function minimizeControl(s: Session): Locator {
  if (s.kind === 'agent') throw new Error('A_FIXTURE_AGENT_HAS_NO_MINIMIZE');
  if (s.kind === 'packaging' || s.kind === 'scene') return header(s).getByTitle(/^(?:最小化|展开)$/);
  return header(s).locator('button').filter({ has: s.page.locator('svg.lucide-minus,svg.lucide-maximize-2') });
}
function input(s: Session): Locator {
  switch (s.kind) {
    case 'ecommerce': return panel(s).getByPlaceholder(/描述你的商品/);
    case 'factory': return panel(s).getByPlaceholder('主题文案', { exact: true });
    case 'packaging': return panel(s).getByPlaceholder('例如：山茶记', { exact: true });
    case 'logo': return panel(s).getByPlaceholder('描述你的品牌：做什么、服务谁、有什么独特价值...', { exact: true });
    case 'scene': return panel(s).getByPlaceholder('描述你想要生成的图像...', { exact: true });
    case 'agent': return panel(s).getByPlaceholder('描述你想要的编辑效果... (输入 / 使用模板)', { exact: true });
  }
}
function mainControl(s: Session): Locator {
  if (s.kind === 'factory') return panel(s).getByRole('button', { name: /^生成主KV(?:\s*\([^)]*\))?$/ });
  const name: Record<Kind, string> = { ecommerce: '批量生成', factory: '生成主KV', packaging: '生成方案',
    logo: '生成 Logo 方向', scene: '开始生成', agent: '执行' };
  return panel(s).getByRole('button', { name: name[s.kind], exact: true });
}
function modelSelect(s: Session, type: 'image' | 'chat'): Locator {
  if (s.kind === 'agent') return panel(s).getByTitle('Agent 编排的思考模型（LLM）', { exact: true });
  const value = type === 'image' ? 'image-b' : 'chat-b';
  return panel(s).locator('select').filter({ has: s.page.locator(`option[value="${s.kind === 'factory' ? value : `offline-b::${value}`}"]`) });
}
async function click(target: Locator): Promise<void> {
  await unique(target); await target.scrollIntoViewIfNeeded(); await target.click({ trial: true }); await target.click();
}
async function unique(target: Locator): Promise<void> {
  const count = await target.count();
  if (count !== 1) throw new Error(`A_FIXTURE_SELECTOR_CARDINALITY:${count}:${target}`);
}
async function rect(target: Locator): Promise<Rect> {
  await unique(target); const box = await target.boundingBox();
  if (!box) throw new Error(`A_FIXTURE_ELEMENT_NOT_RENDERED:${target}`);
  return box;
}
async function realWebGL(s: Session): Promise<void> {
  try {
    await s.page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.scene-studio-canvas canvas');
      if (!canvas || canvas.width < 1 || canvas.height < 1) return false;
      const gl = canvas.getContext('webgl2');
      return Boolean(gl && !gl.isContextLost() && gl.getParameter(gl.VERSION));
    }, undefined, { timeout: 5000 });
    await s.page.locator('.scene-studio-canvas canvas').evaluate(canvas => {
      canvas.addEventListener('webglcontextlost', () => { window.additionalAFixture.state.errors.push('WEBGL_CONTEXT_LOST'); });
    });
    const result = await s.page.locator('.scene-studio-canvas canvas').evaluate(async element => {
      const canvas = element as HTMLCanvasElement;
      const image = new Image(); image.src = canvas.toDataURL('image/png'); await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    });
    if (result.width < 1 || result.height < 1) throw new Error('NO_NATIVE_WEBGL_PNG');
  } catch (error) { throw new Error(`A_FIXTURE_SCENE_RENDERER_BLOCKED:${String(error)}`); }
}
async function mount(s: Session, theme: Theme): Promise<void> {
  // Establish real controls/renderer at desktop, then measure the requested view.
  // This separates mobile geometry failure from a zero-size R3F initialization.
  await s.page.evaluate(({ kind, theme }) => window.additionalAFixture.mount(kind, theme), { kind: s.kind, theme });
  s.mounted = true; await title(s).waitFor({ state: 'visible' });
  if (s.kind === 'agent') await modelSelect(s, 'chat').waitFor({ state: 'visible' });
  else if (s.kind === 'ecommerce') await panel(s).getByText('场景氛围图', { exact: true }).waitFor();
  else if (s.kind === 'factory') await panel(s).getByText(BRAND, { exact: true }).waitFor();
  else if (s.kind === 'scene') await realWebGL(s);
  await settle(s);
}
async function chooseDropdown(s: Session, type: 'image' | 'chat'): Promise<void> {
  const a = type === 'image' ? IMAGE_A : CHAT_A; const b = type === 'image' ? IMAGE_B : CHAT_B;
  const trigger = panel(s).locator('button').filter({ has: s.page.locator('svg.lucide-chevron-down') }).filter({ hasText: a });
  await trigger.waitFor({ state: 'visible' }); await click(trigger);
  // Logo options portal into body; ecommerce options remain in the real panel.
  await click(s.page.getByRole('button', { name: new RegExp(`^${b}`) }));
}
async function prepare(s: Session): Promise<void> {
  switch (s.kind) {
    case 'ecommerce':
      await click(panel(s).getByRole('button', { name: '生成设置', exact: true }));
      await chooseDropdown(s, 'image'); await chooseDropdown(s, 'chat'); await input(s).fill(PROMPT); break;
    case 'factory':
      await click(panel(s).getByText(BRAND, { exact: true }));
      await click(panel(s).getByRole('button', { name: '模型', exact: true }));
      await modelSelect(s, 'image').selectOption('image-b'); await modelSelect(s, 'chat').selectOption('chat-b');
      await click(panel(s).getByRole('button', { name: '模型', exact: true }));
      await click(panel(s).getByRole('button', { name: '主KV', exact: true })); await input(s).fill(PROMPT); break;
    case 'packaging':
      await input(s).fill(BRAND); await modelSelect(s, 'image').selectOption('offline-b::image-b');
      await modelSelect(s, 'chat').selectOption('offline-b::chat-b'); break;
    case 'logo':
      await panel(s).getByPlaceholder('中文品牌名称', { exact: true }).fill(BRAND);
      await input(s).fill(PROMPT); await chooseDropdown(s, 'chat'); await chooseDropdown(s, 'image'); break;
    case 'scene':
      await click(panel(s).getByTitle('立方体', { exact: true }));
      await panel(s).getByText('属性 - 立方体', { exact: true }).waitFor();
      await realWebGL(s);
      await click(panel(s).getByRole('button', { name: '生成', exact: true }));
      await modelSelect(s, 'image').selectOption('offline-b::image-b');
      await click(panel(s).getByRole('button', { name: '文生图', exact: true })); await input(s).fill(PROMPT); break;
    case 'agent':
      await modelSelect(s, 'chat').selectOption('offline-b::chat-b');
      await click(panel(s).getByRole('button', { name: '5', exact: true })); await input(s).fill(PROMPT); break;
  }
  await settle(s);
  await mainControl(s).waitFor({ state: 'visible' });
  if (await mainControl(s).isDisabled()) throw new Error('A_FIXTURE_PUBLIC_PREPARATION_NOT_READY');
}
async function snapshot(s: Session): Promise<Record<string, unknown>> {
  const value = await input(s).inputValue();
  if (s.kind === 'ecommerce' || s.kind === 'logo') {
    const buttonText = await panel(s).locator('button').filter({ has: s.page.locator('svg.lucide-chevron-down') }).allTextContents();
    return { value, buttonText: buttonText.map(text => text.trim()) };
  }
  const selects = await panel(s).locator('select').evaluateAll(elements => elements.map(element => (element as HTMLSelectElement).value));
  return { value, selects };
}
async function minimizeRestore(s: Session): Promise<void> {
  if (s.kind === 'agent') return; // No invented minimize capability.
  const before = await snapshot(s);
  await click(minimizeControl(s)); await settle(s);
  if (await input(s).isVisible()) throw new Error('A_FIXTURE_ORIGINAL_MINIMIZE_NOT_OBSERVED');
  await click(minimizeControl(s)); await input(s).waitFor({ state: 'visible' });
  if (s.kind === 'scene') await realWebGL(s);
  expect(await snapshot(s)).toEqual(before);
}
async function start(s: Session): Promise<Run> {
  const previousRuns = s.runs.length;
  if (s.kind === 'logo') {
    await click(mainControl(s));
    await panel(s).getByRole('button', { name: '生成 Logo', exact: true }).waitFor({ state: 'visible' });
    await click(panel(s).getByRole('button', { name: '生成 Logo', exact: true }));
  } else await click(mainControl(s));
  const deadline = Date.now() + 2000;
  while (s.runs.length !== previousRuns + 1 && Date.now() < deadline) await new Promise<void>(resolve => setTimeout(resolve, 10));
  if (s.runs.length !== previousRuns + 1) throw new Error('A_FIXTURE_SUBMISSION_NOT_OBSERVED');
  const run = s.runs.at(-1)!;
  if (s.kind === 'agent' || s.kind === 'ecommerce') {
    await panel(s).getByRole('button', { name: '取消', exact: true }).waitFor({ state: 'visible' });
    await panel(s).getByText('离线任务处理中', { exact: true }).waitFor({ state: 'visible' });
  } else if (s.kind === 'logo') await panel(s).getByRole('heading', { name: '正在生成 Logo', exact: true }).waitFor();
  else if (s.kind === 'factory') {
    if (!(await mainControl(s).isDisabled())) throw new Error('A_FIXTURE_FACTORY_NOT_PENDING');
  } else await panel(s).getByRole('button', { name: '生成中...', exact: true }).waitFor();
  return run;
}
function resultImage(s: Session): Locator {
  if (s.kind === 'logo') return panel(s).getByAltText('Logo 预览', { exact: true });
  if (s.kind === 'factory') return panel(s).getByAltText('KV主视觉', { exact: true });
  return panel(s).locator(`img[src="${s.media.results[0]}"]`);
}
function applyControl(s: Session): Locator {
  if (s.kind === 'agent') return panel(s).getByRole('button', { name: '应用', exact: true });
  if (s.kind === 'ecommerce') return panel(s).getByRole('button', { name: '全部添加到画布 (2)', exact: true });
  if (s.kind === 'packaging') return panel(s).getByTitle('发送到画布', { exact: true });
  return panel(s).getByRole('button', { name: s.kind === 'scene' ? '加入画布' : '添加到画布', exact: true });
}
async function finish(s: Session, run: Run): Promise<void> {
  run.phase = 'completed'; run.release();
  await resultImage(s).waitFor({ state: 'visible' });
  await resultImage(s).evaluate(async element => {
    const image = element as HTMLImageElement; await image.decode();
    if (image.naturalWidth !== 64 || image.naturalHeight !== 64) throw new Error('A_FIXTURE_RESULT_DECODE');
  });
  await applyControl(s).waitFor({ state: 'visible' }); await settle(s);
}
async function revealPackagingResult(s: Session): Promise<void> {
  // The original sibling overlay intercepts the image even at opacity zero.
  // Its enclosing card owns group-hover; never bypass that real hit target.
  const card = resultImage(s).locator('xpath=..');
  await unique(card); await card.scrollIntoViewIfNeeded(); await card.hover();
  const overlay = applyControl(s).locator('xpath=../..');
  await overlay.waitFor({ state: 'visible' }); await applyControl(s).waitFor({ state: 'visible' });
  const handle = await overlay.elementHandle();
  if (!handle) throw new Error('A_FIXTURE_PACKAGING_OVERLAY_MISSING');
  try {
    await s.page.waitForFunction(element => Number(getComputedStyle(element).opacity) >= 0.99, handle);
  } finally { await handle.dispose(); }
}

// All product geometry expectations below are literal policy thresholds. No
// production positioning/sizing helper is used to manufacture its expectation.
async function screenBox(s: Session, target: Locator, hitTarget = false, minimum = 44): Promise<Rect> {
  const box = await rect(target);
  const view = await s.page.evaluate(() => ({ x: visualViewport!.offsetLeft, y: visualViewport!.offsetTop,
    width: visualViewport!.width, height: visualViewport!.height }));
  expect(box.width).toBeGreaterThanOrEqual(minimum); expect(box.height).toBeGreaterThanOrEqual(minimum);
  expect(box.x).toBeGreaterThanOrEqual(view.x + 8); expect(box.y).toBeGreaterThanOrEqual(view.y + 8);
  expect(box.x + box.width).toBeLessThanOrEqual(view.x + view.width - 8);
  expect(box.y + box.height).toBeLessThanOrEqual(view.y + view.height - 8);
  if (hitTarget) {
    const visible = await target.evaluate(element => {
      const r = element.getBoundingClientRect(); let left = r.left; let right = r.right; let top = r.top; let bottom = r.bottom;
      for (let p = element.parentElement; p; p = p.parentElement) {
        const c = p.getBoundingClientRect(); const style = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, c.left); right = Math.min(right, c.right); }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom); }
      }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { width: right - left, height: bottom - top, hit: Number(Boolean(hit && (hit === element || element.contains(hit)))) };
    });
    expect(visible.width).toBeGreaterThanOrEqual(box.width - 1);
    expect(visible.height).toBeGreaterThanOrEqual(box.height - 1); expect(visible.hit).toBe(1);
  }
  return box;
}
function overlap(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}
async function horizontal(target: Locator): Promise<void> {
  await unique(target);
  const metrics = await target.evaluate(element => {
    const tops: number[] = []; const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      for (let i = 0; i < (node.textContent?.length || 0); i++) {
        if (!node.textContent?.[i]?.trim()) continue;
        const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width && rect.height && !tops.some(top => Math.abs(top - rect.top) < 3)) tops.push(rect.top);
      }
      node = walker.nextNode();
    }
    return { lines: tops.length, vertical: Number(!getComputedStyle(element).writingMode.startsWith('horizontal')) };
  });
  // Icon-only controls and native field values have no rendered text Range.
  // Their visibility/clipping/44px/hit checks still run in reach().
  if (metrics.lines > 0) { expect(metrics.lines).toBe(1); expect(metrics.vertical).toBe(0); }
}
async function rootChecks(s: Session): Promise<void> {
  await screenBox(s, panel(s)); const close = await screenBox(s, closeControl(s), true);
  expect(overlap(close, await rect(title(s)))).toBe(0);
  if (s.kind !== 'agent') expect(overlap(close, await rect(minimizeControl(s)))).toBe(0);
}
async function reach(s: Session, target: Locator, enabled = true): Promise<void> {
  await unique(target); await target.scrollIntoViewIfNeeded(); await settle(s);
  const box = await screenBox(s, target, true);
  expect(overlap(box, await rect(closeControl(s)))).toBe(0);
  await horizontal(target);
  if (enabled) { if (await target.isDisabled()) throw new Error('A_FIXTURE_EXPECTED_ENABLED_CONTROL'); await target.click({ trial: true }); }
}
type PublicStep = 'input' | 'pending' | 'result';
async function publicControls(s: Session, step: PublicStep, focus = false): Promise<void> {
  // Logo's generating/result steps do not render the original input/models.
  // Their input-step accessibility is checked before the public transition.
  if (s.kind === 'logo' && step !== 'input') return;
  const restoreResults = s.kind === 'ecommerce' && step !== 'input';
  let restoreModelPanel = false;
  if (restoreResults) {
    const settings = panel(s).getByRole('button', { name: '生成设置', exact: true });
    await reach(s, settings); await click(settings);
  }
  try {
    const fields = s.kind === 'logo'
      ? [panel(s).getByPlaceholder('中文品牌名称', { exact: true }), input(s)] : [input(s)];
    const disabled = s.kind === 'agent' && step === 'pending';
    for (const field of fields) {
      expect(await field.isDisabled()).toBe(disabled); await reach(s, field, !disabled);
    }
    if (s.kind === 'factory' && !(await modelSelect(s, 'image').isVisible())) {
      const toggle = panel(s).getByRole('button', { name: '模型', exact: true });
      await reach(s, toggle); await click(toggle); restoreModelPanel = true;
    }
    const models = s.kind === 'ecommerce' || s.kind === 'logo'
      ? [IMAGE_B, CHAT_B].map(name => panel(s).locator('button')
        .filter({ has: s.page.locator('svg.lucide-chevron-down') }).filter({ hasText: name }))
      : s.kind === 'agent' ? [modelSelect(s, 'chat')]
        : s.kind === 'scene' ? [modelSelect(s, 'image')]
          : [modelSelect(s, 'image'), modelSelect(s, 'chat')];
    for (const model of models) { expect(await model.isDisabled()).toBe(false); await reach(s, model); }
    if (restoreModelPanel) {
      await click(panel(s).getByRole('button', { name: '模型', exact: true })); restoreModelPanel = false;
    }
    if (focus && !disabled) {
      await reach(s, input(s)); await input(s).click();
      expect(await input(s).evaluate(element => Number(document.activeElement === element))).toBe(1);
      // Focus may natively scroll: measure the focused control again at the
      // current (including keyboard) visual viewport, without changing its value.
      await settle(s); await screenBox(s, input(s), true);
    }
  } finally {
    if (restoreModelPanel) await click(panel(s).getByRole('button', { name: '模型', exact: true }));
    if (restoreResults) await click(panel(s).getByRole('button', { name: /^生成结果(?: \(\d+\))?$/ }));
  }
}
async function keyboardControls(s: Session, step: 'input' | 'result', width: number, height: number): Promise<void> {
  await publicControls(s, step, true);
  if (width === 1440) return;
  const keyboardHeight = height === 360 ? 240 : height === 640 ? 360 : 480;
  try {
    // Focus was established through the original field before keyboard metrics.
    await viewport(s, width, height, keyboardHeight); await rootChecks(s);
    await publicControls(s, step, true);
  } finally { await viewport(s, width, height); }
}
async function scrollChecks(s: Session): Promise<void> {
  const overflow = await panel(s).evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
  const containers = panel(s).locator('div,main,aside,section');
  const count = await containers.count();
  for (let i = 0; i < count; i++) {
    const target = containers.nth(i);
    const info = await target.evaluate(element => ({ visible: element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0,
      scroll: /^(auto|scroll)$/.test(getComputedStyle(element).overflowY), capacity: element.scrollHeight - element.clientHeight }));
    if (!info.visible || !info.scroll || info.capacity < 2) continue;
    await target.scrollIntoViewIfNeeded();
    const before = await target.evaluate(element => element.scrollTop);
    await target.hover(); await s.page.mouse.wheel(0, before >= info.capacity - 1 ? -180 : 180); await settle(s);
    const after = await target.evaluate(element => element.scrollTop);
    expect(Math.abs(after - before)).toBeGreaterThan(0);
    break;
  }
}
async function geometry(s: Session, control: Locator): Promise<void> {
  await rootChecks(s); await horizontal(title(s)); await reach(s, control); await scrollChecks(s);
  if (s.kind === 'scene') {
    const canvas = await rect(panel(s).locator('.scene-studio-canvas canvas'));
    expect(canvas.width).toBeGreaterThanOrEqual(96); expect(canvas.height).toBeGreaterThanOrEqual(96);
  }
  if (s.page.viewportSize()?.width === 1440) {
    const box = await rect(panel(s)); expect(box.width).toBeLessThanOrEqual(1360); expect(box.height).toBeLessThanOrEqual(840);
  }
}
async function closeNormally(s: Session): Promise<void> {
  const before = s.cancels.length; await click(closeControl(s)); await settle(s);
  const state = await s.page.evaluate(() => window.additionalAFixture.state);
  if (state.closes !== 1 || s.cancels.length !== before) throw new Error('A_FIXTURE_CLOSE_CALLBACK_OR_CANCEL_MISMATCH');
}
async function assertPublicRetained(s: Session, before: Record<string, unknown>): Promise<void> {
  expect(await snapshot(s)).toEqual(before);
}
async function pendingControl(s: Session): Promise<Locator> {
  if (s.kind === 'agent' || s.kind === 'ecommerce') return panel(s).getByRole('button', { name: '取消', exact: true });
  if (s.kind === 'logo') return panel(s).getByRole('heading', { name: '正在生成 Logo', exact: true });
  if (s.kind === 'factory') return mainControl(s);
  return panel(s).getByRole('button', { name: '生成中...', exact: true });
}

describe('mobile additional-a probe', () => {
  it.each(KINDS)('%s actual root/close hit targets remain on screen', async kind => {
    await withSession(kind, 'probe', async s => {
      await mount(s, 'gold'); await prepare(s);
      if (kind === 'agent') {
        const run = await start(s); await viewport(s, 740, 360);
        // Sample BOTH the original running panel and result panel before numeric
        // assertions, so the short-screen probe is never an idle-only fixture.
        await reach(s, panel(s).getByRole('button', { name: '取消', exact: true }));
        const pending = { root: await rect(panel(s)), close: await rect(closeControl(s)),
          cancel: await rect(panel(s).getByRole('button', { name: '取消', exact: true })) };
        await finish(s, run);
        await reach(s, applyControl(s));
        const result = { root: await rect(panel(s)), close: await rect(closeControl(s)), apply: await rect(applyControl(s)) };
        for (const sample of [pending, result]) {
          expect(sample.root.width).toBeGreaterThanOrEqual(44); expect(sample.root.height).toBeGreaterThanOrEqual(44);
          expect(sample.root.x).toBeGreaterThanOrEqual(8); expect(sample.root.y).toBeGreaterThanOrEqual(8);
          expect(sample.root.x + sample.root.width).toBeLessThanOrEqual(732);
          expect(sample.root.y + sample.root.height).toBeLessThanOrEqual(352);
          expect(sample.close.width).toBeGreaterThanOrEqual(44); expect(sample.close.height).toBeGreaterThanOrEqual(44);
          expect(sample.close.x).toBeGreaterThanOrEqual(8); expect(sample.close.y).toBeGreaterThanOrEqual(8);
          expect(sample.close.x + sample.close.width).toBeLessThanOrEqual(732);
          expect(sample.close.y + sample.close.height).toBeLessThanOrEqual(352);
        }
        for (const control of [pending.cancel, result.apply]) {
          expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44);
          expect(control.x).toBeGreaterThanOrEqual(8); expect(control.y).toBeGreaterThanOrEqual(8);
          expect(control.x + control.width).toBeLessThanOrEqual(732);
          expect(control.y + control.height).toBeLessThanOrEqual(352);
        }
        expect(overlap(pending.cancel, pending.close)).toBe(0); expect(overlap(result.apply, result.close)).toBe(0);
        await rootChecks(s); await reach(s, applyControl(s)); await closeNormally(s);
      } else {
        await viewport(s, 390, 780); await rootChecks(s);
        await closeControl(s).click({ trial: true }); await closeNormally(s);
      }
    });
  }, 25000);
});

describe('mobile additional-a acceptance', () => {
  it.each(ACCEPTANCE)('$kind $theme $width x $height keeps controls horizontal/reachable', async ({ kind, theme, width, height }) => {
    await withSession(kind, 'acceptance', async s => {
      await mount(s, theme); await prepare(s);
      const run = kind === 'agent' ? await start(s) : undefined;
      await viewport(s, width, height);
      await geometry(s, run ? await pendingControl(s) : mainControl(s));
      await publicControls(s, run ? 'pending' : 'input');
      if (run) {
        await finish(s, run); await geometry(s, applyControl(s));
        await keyboardControls(s, 'result', width, height);
      } else await keyboardControls(s, 'input', width, height);
      await closeNormally(s);
    });
  }, 25000);
});

describe('mobile additional-a continuity', () => {
  it.each(CONTINUITY)('$kind $theme retains one mounted session and original pending/result controls', async ({ kind, theme }) => {
    await withSession(kind, 'continuity', async s => {
      await mount(s, theme); await prepare(s);
      const before = await snapshot(s); await minimizeRestore(s);
      // Public inputs/model controls survive resize/VV before step-specific
      // content is lawfully replaced (Logo direction/generation, ecommerce tab).
      for (const [width, height, visualHeight] of [[390, 780, 780], [390, 780, 480], [740, 360, 360], [1440, 900, 900]]) {
        await viewport(s, width, height, visualHeight); await assertPublicRetained(s, before);
        await publicControls(s, 'input', true); await assertPublicRetained(s, before);
      }
      // Running state is established through original public HTTP before shrinking.
      let run = await start(s);
      for (const [width, height, visualHeight] of [[1440, 900, 900], [390, 780, 780], [390, 780, 480], [740, 360, 360]]) {
        await viewport(s, width, height, visualHeight);
        const control = await pendingControl(s);
        await rootChecks(s);
        if (kind !== 'logo' && kind !== 'ecommerce') await assertPublicRetained(s, before);
        if (kind === 'logo') {
          await control.scrollIntoViewIfNeeded(); await settle(s);
          await screenBox(s, control, false, 1); await horizontal(control);
        } else await reach(s, control, kind === 'agent' || kind === 'ecommerce');
        await publicControls(s, 'pending');
        if (width === 390 && visualHeight === 780 && kind !== 'agent') {
          await reach(s, minimizeControl(s)); await click(minimizeControl(s));
          await rootChecks(s); await click(minimizeControl(s));
          await (await pendingControl(s)).waitFor({ state: 'visible' });
          if (kind === 'scene') await realWebGL(s);
          if (kind !== 'logo' && kind !== 'ecommerce') await assertPublicRetained(s, before);
        }
        if (kind === 'scene') {
          const box = await rect(panel(s).locator('.scene-studio-canvas canvas'));
          expect(box.width).toBeGreaterThanOrEqual(96); expect(box.height).toBeGreaterThanOrEqual(96);
        }
      }
      await viewport(s, 1440, 900);
      if (kind === 'agent' || kind === 'ecommerce') {
        await click(panel(s).getByRole('button', { name: '取消', exact: true }));
        await mainControl(s).waitFor({ state: 'visible' });
        expect(s.cancels).toEqual([`footer:${run.taskId}`]);
        if (kind === 'ecommerce') {
          await click(panel(s).getByRole('button', { name: '生成设置', exact: true }));
          await assertPublicRetained(s, before);
        } else {
          await assertPublicRetained(s, before);
          const attempt = await s.page.evaluate(() => localStorage.getItem('wujie_agent_attempt:fixture-project:fixture-entity'));
          expect(attempt).toBeNull();
        }
        run = await start(s);
        if (kind === 'agent') {
          await click(panel(s).getByRole('button', { name: '取消任务', exact: true }));
          await mainControl(s).waitFor({ state: 'visible' });
          expect(s.cancels).toEqual(['footer:offline-agent-task-1', 'timeline:offline-agent-task-2']);
          run = await start(s);
        }
      } else expect(s.cancels.length).toBe(0);
      await finish(s, run);
      for (const [width, height] of [[390, 780], [740, 360]]) {
        await viewport(s, width, height);
        if (kind === 'packaging') await revealPackagingResult(s);
        await geometry(s, applyControl(s));
      }
      await viewport(s, 1440, 900);
      if (kind === 'packaging') await revealPackagingResult(s);
      await reach(s, applyControl(s)); await click(applyControl(s)); await settle(s);
      const state = await s.page.evaluate(() => window.additionalAFixture.state);
      if (kind === 'agent') {
        expect(state.applies).toEqual([{ url: s.media.results[0], prompt: PROMPT }]);
        expect(state.adds).toEqual([]);
        expect(await s.page.evaluate(() => localStorage.getItem('wujie_agent_attempt:fixture-project:fixture-entity'))).toBeNull();
      } else {
        expect(state.adds).toEqual([{ urls: kind === 'ecommerce' ? s.media.results : [s.media.results[0]],
          meta: { modelName: 'image-b', apiProvider: 'offline-b' } }]);
        await closeNormally(s);
      }
      expect(s.submissions).toEqual(Array.from({ length: kind === 'agent' ? 3 : kind === 'ecommerce' ? 2 : 1 }, () => generationBody(s)));
      if (kind === 'agent' || kind === 'ecommerce') expect(new Set(s.keys).size).toBe(s.submissions.length);
      else expect(s.keys).toEqual([]);
    });
  }, 45000);
});
