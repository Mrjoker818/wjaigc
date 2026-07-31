export const DISPLAY_DECOMPOSE_SUPPORTED_RATIOS = [
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '4:5',
  '5:4',
  '16:9',
  '9:16',
] as const;

export type DisplayDecomposeRatio = typeof DISPLAY_DECOMPOSE_SUPPORTED_RATIOS[number];
export type DisplayBoardBackground = 'light-gray' | 'transparent';

export const DEFAULT_DISPLAY_DECOMPOSE_RATIO: DisplayDecomposeRatio = '16:9';

const DISPLAY_DECOMPOSE_BASE_PROMPT = [
  '对参考图进行专业元素拆解，识别画面中所有可区分的视觉元素，不要照搬原始场景构图。',
  '识别图中所有主体对象、附属配件、文字标识、图案纹理、装饰元素、背景结构和可复用的视觉素材。',
  '将每个元素转换为干净的平面展示素材，单独陈列，不重叠、无遮挡，元素之间留出整齐间距。',
  '统一使用正视平面视角，矫正透视和倾斜，增强边缘清晰度、细节表现和画质。',
  '保留原图的主色调、整体视觉风格和材质质感，但输出必须是完整的元素拆解展示版。',
  '不要生成水印，不要生成多余杂乱元素，不要让元素互相遮挡，不要输出低清模糊图片。',
].join('\n');

const DISPLAY_BACKGROUND_PROMPTS: Record<DisplayBoardBackground, string> = {
  'light-gray': '背景使用浅灰色极简背景，整体像专业素材清单板、设计元素拆解图和视觉复盘参考图。',
  transparent: '背景必须为真实透明 alpha=0；所有拆解元素保持完整、边缘干净，并保留真实透明通道。',
};

export function normalizeDisplayDecomposeRatio(value: unknown): DisplayDecomposeRatio {
  const ratio = typeof value === 'string' ? value.trim() : '';
  return DISPLAY_DECOMPOSE_SUPPORTED_RATIOS.includes(ratio as DisplayDecomposeRatio)
    ? ratio as DisplayDecomposeRatio
    : DEFAULT_DISPLAY_DECOMPOSE_RATIO;
}

export function buildDisplayDecomposePrompt(
  extraPrompt?: string,
  background: DisplayBoardBackground = 'light-gray',
): string {
  const extra = typeof extraPrompt === 'string' ? extraPrompt.trim() : '';
  const prompt = `${DISPLAY_DECOMPOSE_BASE_PROMPT}\n${DISPLAY_BACKGROUND_PROMPTS[background]}`;
  return extra ? `${prompt}\n\n用户补充要求：${extra}` : prompt;
}

export function buildDisplayDecomposeRequestBody(params: {
  model: string;
  imageUrl: string;
  sourceHash: string;
  aspectRatio?: unknown;
  background: DisplayBoardBackground;
  extraPrompt?: string;
}): Record<string, unknown> {
  const aspectRatio = normalizeDisplayDecomposeRatio(params.aspectRatio);
  return {
    model: params.model,
    prompt: buildDisplayDecomposePrompt(params.extraPrompt, params.background),
    n: 1,
    size: aspectRatio,
    image_urls: [params.imageUrl],
    strength: 0.72,
    input_fidelity: 'high',
    response_format: 'url',
    source_hash: params.sourceHash,
  };
}
