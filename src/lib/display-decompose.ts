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

export const DEFAULT_DISPLAY_DECOMPOSE_RATIO: DisplayDecomposeRatio = '16:9';

export const DISPLAY_DECOMPOSE_PROMPT = [
  '对参考图进行专业美陈拆解和物料拆解，不要照搬原始场景。',
  '识别图中的所有美陈元素、广告物料、展架、装饰、主体产品、文字牌、道具、背景结构和可复用设计元素。',
  '将每个元素转换为干净的平面设计素材，单独陈列，不重叠、无遮挡，元素之间留出整齐间距。',
  '统一使用正视平面视角，矫正透视和倾斜，增强边缘清晰度、材质细节和画质。',
  '保留原图的主色调、品牌气质、材质工艺和广告行业美陈风格，但输出必须是拆解展示版。',
  '背景尽量透明或使用极浅的中性背景，整体像专业广告物料拆解板、元素清单板、设计复盘图。',
  '不要生成水印，不要生成多余杂乱元素，不要让元素互相遮挡，不要输出低清模糊图片。',
].join('\n');

export function normalizeDisplayDecomposeRatio(value: unknown): DisplayDecomposeRatio {
  const ratio = typeof value === 'string' ? value.trim() : '';
  return DISPLAY_DECOMPOSE_SUPPORTED_RATIOS.includes(ratio as DisplayDecomposeRatio)
    ? ratio as DisplayDecomposeRatio
    : DEFAULT_DISPLAY_DECOMPOSE_RATIO;
}

export function buildDisplayDecomposePrompt(extraPrompt?: string): string {
  const extra = typeof extraPrompt === 'string' ? extraPrompt.trim() : '';
  return extra ? `${DISPLAY_DECOMPOSE_PROMPT} User additional requirements: ${extra}` : DISPLAY_DECOMPOSE_PROMPT;
}

export function buildDisplayDecomposeRequestBody(params: {
  model: string;
  imageUrl: string;
  aspectRatio?: unknown;
  extraPrompt?: string;
}): Record<string, unknown> {
  const aspectRatio = normalizeDisplayDecomposeRatio(params.aspectRatio);
  return {
    model: params.model,
    prompt: buildDisplayDecomposePrompt(params.extraPrompt),
    n: 1,
    size: aspectRatio,
    image_urls: [params.imageUrl],
    strength: 0.72,
    input_fidelity: 'high',
    response_format: 'url',
    // 支持 background 参数的模型（gpt-image / gemini-image 族）由云端 API 直接输出透明 PNG；
    // 不支持该参数的模型会由 filterRequestForModel 自动删除此字段，不影响正常生成。
    background: 'transparent',
  };
}
