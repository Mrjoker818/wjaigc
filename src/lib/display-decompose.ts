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
  'Perform a professional display and merchandising element decomposition on the reference image.',
  'Identify all display props, advertising materials, shelving units, decorations, product subjects, signage, structural background components, and reusable design elements.',
  'Convert each element into a clean, isolated flat design asset — arranged individually without overlap or occlusion, with even spacing between elements.',
  'Use a straight-on orthographic view for each element; correct any perspective distortion, sharpen edges, enhance material details and overall quality.',
  'Preserve the original color palette, brand character, material craftsmanship, and advertising-industry style — but the output must be a decomposed layout board.',
  'Background must be fully transparent (alpha = 0). Every element floats on a transparent canvas with no background fill, no checkerboard, no shadow, no frame, no white or gray fill.',
  'Do not generate watermarks, extraneous elements, overlapping elements, or low-resolution blurry output.',
  'Output a PNG image with a real transparent alpha channel.',
].join(' ');

export const DISPLAY_DECOMPOSE_NEGATIVE_PROMPT = [
  'background', 'white background', 'gray background', 'solid color background',
  'checkerboard', 'shadow', 'reflection', 'border', 'frame', 'watermark', 'text overlay',
  'overlapping elements', 'low quality', 'blurry', 'artifact', 'halo', 'white fringe',
  'background fill', 'canvas fill',
].join(', ');

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
    negative_prompt: DISPLAY_DECOMPOSE_NEGATIVE_PROMPT,
    n: 1,
    size: aspectRatio,
    image_urls: [params.imageUrl],
    strength: 0.72,
    input_fidelity: 'high',
    response_format: 'url',
    // 支持 background 参数的模型（gpt-image / gemini-image 族）由云端 API 直接输出透明 PNG；
    // 不支持该参数的模型会由 filterRequestForModel 自动删除此字段，
    // 但 prompt 中的透明背景指令仍然生效（尽力输出）。
    background: 'transparent',
    output_format: 'png',
  };
}
