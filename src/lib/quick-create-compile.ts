import { z } from 'zod';

export const QUICK_CREATE_ASPECT_RATIOS = ['1:1', '4:5', '3:4', '2:3', '16:9', '9:16', '3:2', '4:3'] as const;
export const QUICK_CREATE_QUALITIES = ['standard', 'high'] as const;

export type QuickCreateAspectRatio = (typeof QUICK_CREATE_ASPECT_RATIOS)[number];
export type QuickCreateQuality = (typeof QUICK_CREATE_QUALITIES)[number];
export type QuickCreateModelSource = 'task-override' | 'quick-create-default' | 'global-default' | 'recent-selection' | 'first-available';
export type QuickCreateCompilePhase = 'validating' | 'routing' | 'understanding' | 'strategizing' | 'finalizing' | 'ready';

export interface QuickCreateImageCapability {
  allowedSizes: string[];
  qualityOptions: string[];
}

export interface QuickCreateGenerationQuality {
  quality?: string;
  resolution?: string;
}

export function resolveQuickCreateGenerationQuality(
  requested: QuickCreateQuality,
  capability?: QuickCreateImageCapability,
): QuickCreateGenerationQuality {
  if (!capability) return {};

  const result: QuickCreateGenerationQuality = {};
  const qualityPreference = requested === 'high'
    ? ['high', 'hd', 'quality', 'max', 'medium', 'auto', 'standard', 'low']
    : ['standard', 'auto', 'medium', 'low', 'high', 'hd', 'quality', 'max'];
  const quality = qualityPreference.find(value => capability.qualityOptions.includes(value));
  if (quality) result.quality = quality;

  const resolutionPreference = requested === 'high'
    ? ['2K', '4K', '1K']
    : ['1K', '2K', '4K'];
  const resolution = resolutionPreference.find(value => capability.allowedSizes.includes(value));
  if (resolution) result.resolution = resolution;

  return result;
}

export interface QuickCreateCompileRequest {
  prompt: string;
  aspectRatio: QuickCreateAspectRatio;
  quality: QuickCreateQuality;
  outputCount: number;
  referenceImages: string[];
  chatModelOverride?: string;
  recentChatModel?: string;
}

const referenceImageSchema = z.string().trim().min(1).max(8_000_000).refine((value: string) => {
  if (value.startsWith('/')) return !value.startsWith('//');
  if (/^data:image\/(?:jpeg|png|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) return true;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}, '参考图片必须是 HTTP/HTTPS 地址、站内绝对路径或受支持的图片 Data URI');

export const quickCreateCompileRequestSchema = z.object({
  prompt: z.string().trim().min(2).max(8_000),
  aspectRatio: z.enum(QUICK_CREATE_ASPECT_RATIOS),
  quality: z.enum(QUICK_CREATE_QUALITIES),
  outputCount: z.number().int().min(1).max(4),
  referenceImages: z.array(referenceImageSchema).max(8).default([]),
  chatModelOverride: z.string().trim().min(1).max(300).optional(),
  recentChatModel: z.string().trim().min(1).max(300).optional(),
}).strict();

export interface QuickCreateCreativeDirection {
  title: string;
  description: string;
  visualKeywords: string[];
}

export interface QuickCreateCompileResult {
  summary: string;
  strategy: string;
  directions: QuickCreateCreativeDirection[];
  positivePrompt: string;
  negativePrompt: string;
  aspectRatio: QuickCreateAspectRatio;
  quality: QuickCreateQuality;
  outputCount: number;
  model: string;
  providerId: string;
  providerName: string;
  modelSource: QuickCreateModelSource;
  mode: 'compiled' | 'fallback';
}

export type QuickCreateCompileSseEvent =
  | { type: 'status'; phase: QuickCreateCompilePhase; message: string }
  | { type: 'delta'; content: string }
  | { type: 'result'; result: QuickCreateCompileResult }
  | { type: 'error'; message: string; code?: string }
  | { type: 'done' };

const creativeDirectionSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(600),
  visualKeywords: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
}).strict();

const compilePayloadSchema = z.object({
  summary: z.string().trim().min(1).max(800),
  strategy: z.string().trim().min(1).max(2_000),
  directions: z.array(creativeDirectionSchema).min(1).max(6),
  positivePrompt: z.string().trim().min(1).max(8_000),
  negativePrompt: z.string().trim().min(1).max(4_000),
  aspectRatio: z.enum(QUICK_CREATE_ASPECT_RATIOS),
  quality: z.enum(QUICK_CREATE_QUALITIES),
  outputCount: z.number().int().min(1).max(4),
}).strict();

const compileResultSchema = compilePayloadSchema.extend({
  model: z.string().trim().min(1).max(300),
  providerId: z.string().trim().min(1).max(300),
  providerName: z.string().trim().min(1).max(300),
  modelSource: z.enum([
    'task-override',
    'quick-create-default',
    'global-default',
    'recent-selection',
    'first-available',
  ]),
  mode: z.enum(['compiled', 'fallback']),
}).strict();

export const quickCreateCompileSseEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('status'),
    phase: z.enum(['validating', 'routing', 'understanding', 'strategizing', 'finalizing', 'ready']),
    message: z.string().min(1).max(500),
  }).strict(),
  z.object({ type: z.literal('delta'), content: z.string().max(20_000) }).strict(),
  z.object({ type: z.literal('result'), result: compileResultSchema }).strict(),
  z.object({
    type: z.literal('error'),
    message: z.string().min(1).max(2_000),
    code: z.string().min(1).max(100).optional(),
  }).strict(),
  z.object({ type: z.literal('done') }).strict(),
]);

export type QuickCreateCompilePayload = z.infer<typeof compilePayloadSchema>;

export function parseQuickCreateCompileRequest(value: unknown): QuickCreateCompileRequest {
  const result = quickCreateCompileRequestSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new Error(`快速创作请求字段无效：${field} ${issue.message}`);
  }
  return result.data;
}

export function parseQuickCreateCompileSseEvent(value: unknown): QuickCreateCompileSseEvent {
  const result = quickCreateCompileSseEventSchema.safeParse(value);
  if (!result.success) throw new Error('快速创作服务返回了无效的 SSE 事件');
  return result.data;
}

export function stripMarkdownCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function extractFirstJsonObject(value: string): string {
  const source = stripMarkdownCodeFence(value);
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (character === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return source.slice(start, index + 1);
    }
  }

  throw new Error('模型未返回完整的 JSON 对象');
}

export function parseQuickCreateCompilePayload(value: string): QuickCreateCompilePayload {
  const jsonObject = extractFirstJsonObject(value);
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonObject) as unknown;
  } catch {
    throw new Error('模型返回的创作方案不是合法 JSON');
  }

  const result = compilePayloadSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.length > 0 ? issue.path.join('.') : 'result';
    throw new Error(`模型返回的创作方案字段无效：${field} ${issue.message}`);
  }

  return result.data;
}

export function createQuickCreateFallbackResult(
  request: QuickCreateCompileRequest,
  metadata: Pick<QuickCreateCompileResult, 'model' | 'providerId' | 'providerName' | 'modelSource'>,
): QuickCreateCompileResult {
  return {
    summary: '已按原始创作需求提交生成。',
    strategy: '专业提示词编译暂不可用，保留原始提示词和已选生成参数。',
    directions: [{
      title: '原始需求',
      description: request.prompt,
      visualKeywords: ['原始提示词'],
    }],
    positivePrompt: request.prompt,
    negativePrompt: '',
    aspectRatio: request.aspectRatio,
    quality: request.quality,
    outputCount: request.outputCount,
    ...metadata,
    mode: 'fallback',
  };
}

export function shouldFallbackQuickCreateCompile(
  error: unknown,
  terminalCode?: string | null,
): boolean {
  if (terminalCode) return false;

  const message = error instanceof Error
    ? error.message.toLowerCase()
    : String(error).toLowerCase();

  // The proxy can return a malformed SSE frame without a terminal backend code.
  // In that case, submit the original request through the established generator.
  if (message.includes('sse')) return true;

  return error instanceof TypeError
    || /network error|网络错误|failed to fetch|load failed|未返回可读取的流|http\s+404/.test(message);
}

const VISION_MODEL_PATTERNS = [
  /doubao-seed-(?:1-8|2-0)/i,
  /kimi-k2-5/i,
  /qwen-3-5-plus/i,
  /gemini/i,
  /gpt-4o/i,
  /gpt-4\.1/i,
  /vision/i,
  /vlm/i,
];

export function supportsQuickCreateVision(modelId: string, capabilities: string[] = []): boolean {
  const normalizedCapabilities = capabilities.map((capability: string) => capability.trim().toLowerCase());
  if (normalizedCapabilities.some((capability: string) => [
    'vision',
    'image',
    'image_input',
    'image-input',
    'multimodal',
    'vlm',
  ].includes(capability))) {
    return true;
  }

  return VISION_MODEL_PATTERNS.some((pattern: RegExp) => pattern.test(modelId));
}

export function buildQuickCreateCompilerPrompt(request: QuickCreateCompileRequest): string {
  return [
    '你是资深视觉创意总监。请把用户的自然语言需求编译为可直接交给图像生成模型的专业创作方案。',
    '只输出一个 JSON 对象，不要输出 Markdown、代码围栏、解释或额外文字。',
    `JSON 字段必须严格为：summary, strategy, directions, positivePrompt, negativePrompt, aspectRatio, quality, outputCount。`,
    'directions 必须是 1-6 项数组，每项严格包含 title、description、visualKeywords；visualKeywords 是 1-12 个字符串。',
    `aspectRatio 只能是：${QUICK_CREATE_ASPECT_RATIOS.join(', ')}。`,
    `quality 只能是：${QUICK_CREATE_QUALITIES.join(', ')}。outputCount 必须是 1-4 的整数。`,
    '正向提示词应明确主体、构图、空间、材质、光线、色彩、镜头、细节和最终用途；负向提示词应避免低质量、结构错误、文字水印和与需求冲突的视觉元素。',
    '尊重用户明确指定的参数；仅在参数不合理时选择最接近的合法值。',
    '',
    `用户需求：${request.prompt.trim()}`,
    `用户当前画面比例：${request.aspectRatio}`,
    `用户当前输出质量：${request.quality}`,
    `用户当前生成数量：${request.outputCount}`,
    `参考图片数量：${request.referenceImages.length}`,
  ].join('\n');
}
