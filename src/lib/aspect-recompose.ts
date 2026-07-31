export const ASPECT_RECOMPOSE_RATIOS = [
  { value: '9:16', label: '竖屏', width: 9, height: 16 },
  { value: '3:4', label: '竖版', width: 3, height: 4 },
  { value: '4:5', label: '社交竖版', width: 4, height: 5 },
  { value: '1:1', label: '方形', width: 1, height: 1 },
  { value: '4:3', label: '横版', width: 4, height: 3 },
  { value: '16:9', label: '横屏', width: 16, height: 9 },
] as const;

export type AspectRecomposeRatio = (typeof ASPECT_RECOMPOSE_RATIOS)[number]['value'];

export interface AspectRecomposeAnalysis {
  summary: string;
  protectedText: string[];
  protectedElements: string[];
  layout: string;
}

export interface AspectRatioValidation {
  valid: boolean;
  expected: number;
  actual: number;
  error: number;
}

export function parseAspectRatio(value: string): { width: number; height: number } {
  const match = value.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) throw new Error(`无效的目标比例：${value}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`无效的目标比例：${value}`);
  }
  return { width, height };
}

export function isAspectRecomposeRatio(value: string): value is AspectRecomposeRatio {
  return ASPECT_RECOMPOSE_RATIOS.some((ratio) => ratio.value === value);
}

export function recommendOppositeRatio(width: number, height: number): AspectRecomposeRatio {
  if (width > height * 1.08) return '9:16';
  if (height > width * 1.08) return '16:9';
  return '4:5';
}

export function validateAspectRatioDimensions(
  width: number,
  height: number,
  targetRatio: string,
  tolerance = 0.01,
): AspectRatioValidation {
  const ratio = parseAspectRatio(targetRatio);
  const expected = ratio.width / ratio.height;
  const actual = width / height;
  const error = Math.abs(actual - expected) / expected;
  return { valid: error <= tolerance, expected, actual, error };
}

export function buildAspectRecomposePrompt(input: {
  targetRatio: AspectRecomposeRatio;
  analysis: AspectRecomposeAnalysis;
  retryFeedback?: string;
}): string {
  const text = input.analysis.protectedText.length
    ? input.analysis.protectedText.map((item) => `“${item}”`).join('、')
    : '无明确文字';
  const elements = input.analysis.protectedElements.length
    ? input.analysis.protectedElements.join('、')
    : '原图全部可见内容元素';

  return [
    `将参考图进行内容比例调整与元素重排，目标画幅为 ${input.targetRatio}。`,
    '这是版式重构任务：在目标画幅内重新组织原图已有元素的位置、大小、层级和留白。',
    `原图内容摘要：${input.analysis.summary || '保持参考图全部信息'}`,
    `原始版式：${input.analysis.layout || '按参考图识别'}`,
    `必须完整保留的元素：${elements}。`,
    `必须逐字保持且清晰可读的文字：${text}。不得改写、翻译、漏字、增字或生成乱码。`,
    '保持主体身份、产品外观、品牌标识、颜色、纹理、装饰、信息层级和视觉风格一致。',
    '所有内容必须自然地重新布局到目标画幅内部，不生成原图不存在的新主体或新文案。',
    input.retryFeedback ? `上次校验反馈：${input.retryFeedback}。请逐项修正。` : '',
    '输出仅包含重组后的完整成图。',
  ].filter(Boolean).join('\n');
}
