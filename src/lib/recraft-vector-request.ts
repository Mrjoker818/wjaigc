import { getVectorModelCapabilities } from '@/lib/vector-design';

interface RecraftGenerationInput {
  model: string;
  prompt: string;
  size: string;
  count: number;
  style?: string;
  styleId?: string;
  negativePrompt?: string;
  noText?: boolean;
  artisticLevel?: number;
  colors?: string[];
  backgroundColor?: string;
  randomSeed?: number;
}

interface RecraftColor {
  rgb: [number, number, number];
}

interface RecraftControls {
  colors?: RecraftColor[];
  background_color?: RecraftColor;
  no_text?: boolean;
  artistic_level?: number;
}

export interface RecraftGenerationPayload {
  prompt: string;
  model: string;
  size: string;
  n: number;
  response_format: 'b64_json';
  style?: string;
  style_id?: string;
  negative_prompt?: string;
  random_seed?: number;
  controls?: RecraftControls;
}

export interface RecraftVectorSource {
  inlineSvg?: string;
  url?: string;
  sourceImageId?: string;
}

const MAX_VECTOR_RESULTS = 8;
const MAX_INLINE_SVG_BYTES = 12 * 1024 * 1024;
const MAX_INLINE_SVG_BASE64_CHARS = Math.ceil(MAX_INLINE_SVG_BYTES / 3) * 4 + 128;

function parseHexColor(value: string): RecraftColor | null {
  const match = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  return {
    rgb: [
      Number.parseInt(match[1].slice(0, 2), 16),
      Number.parseInt(match[1].slice(2, 4), 16),
      Number.parseInt(match[1].slice(4, 6), 16),
    ],
  };
}

export function buildRecraftGenerationPayload(
  input: RecraftGenerationInput,
): RecraftGenerationPayload {
  const capabilities = getVectorModelCapabilities(input.model);
  const controls: RecraftControls = {};
  const colors = (input.colors || [])
    .map(parseHexColor)
    .filter((color): color is RecraftColor => Boolean(color))
    .slice(0, 8);
  if (colors.length > 0) controls.colors = colors;

  const backgroundColor = input.backgroundColor
    ? parseHexColor(input.backgroundColor)
    : null;
  if (backgroundColor) controls.background_color = backgroundColor;

  if (capabilities.supportsNoTextControl && typeof input.noText === 'boolean') {
    controls.no_text = input.noText;
  }
  if (capabilities.family === 'v3' && Number.isFinite(input.artisticLevel)) {
    controls.artistic_level = Math.max(0, Math.min(5, Math.round(input.artisticLevel!)));
  }

  const payload: RecraftGenerationPayload = {
    prompt: input.prompt.trim(),
    model: input.model,
    size: input.size,
    n: Math.max(1, Math.min(capabilities.maxCount, Math.round(input.count || 1))),
    response_format: 'b64_json',
  };
  if (Object.keys(controls).length > 0) payload.controls = controls;

  const style = input.style?.trim();
  const styleId = input.styleId?.trim();
  if (capabilities.supportsStyles && styleId) payload.style_id = styleId;
  else if (capabilities.supportsStyles && style) payload.style = style;

  const negativePrompt = input.negativePrompt?.trim();
  if (capabilities.supportsNegativePrompt && negativePrompt) {
    payload.negative_prompt = negativePrompt;
  }
  if (capabilities.supportsRandomSeed && Number.isInteger(input.randomSeed)) {
    payload.random_seed = input.randomSeed;
  }
  return payload;
}

function decodeSvgBase64(value: string): string | undefined {
  const normalized = value.replace(/^data:image\/svg\+xml;base64,/i, '');
  if (
    normalized.length > MAX_INLINE_SVG_BASE64_CHARS
    || !/^[a-z0-9+/=\s]+$/i.test(normalized)
  ) {
    throw new Error('Recraft SVG 数据超过安全上限');
  }
  const decodedBuffer = Buffer.from(normalized, 'base64');
  if (decodedBuffer.length > MAX_INLINE_SVG_BYTES) {
    throw new Error('Recraft SVG 数据超过安全上限');
  }
  const decoded = decodedBuffer.toString('utf8');
  return decoded.includes('<svg') ? decoded : undefined;
}

export function extractRecraftVectorSources(data: Record<string, unknown>): RecraftVectorSource[] {
  const candidates = Array.isArray(data.data)
    ? data.data
    : data.image
      ? [data.image]
      : [data];
  if (candidates.length > MAX_VECTOR_RESULTS) {
    throw new Error('Recraft 返回了过多的矢量结果');
  }

  return candidates.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Record<string, unknown>;
    const directSvg = typeof item.svg === 'string' ? item.svg : '';
    if (Buffer.byteLength(directSvg, 'utf8') > MAX_INLINE_SVG_BYTES) {
      throw new Error('Recraft SVG 数据超过安全上限');
    }
    const inlineSvg = directSvg.includes('<svg')
      ? directSvg
      : typeof item.b64_json === 'string'
        ? decodeSvgBase64(item.b64_json)
        : undefined;
    const url = typeof item.url === 'string' && item.url.trim()
      ? item.url.trim()
      : undefined;
    if (!inlineSvg && !url) return [];
    const sourceImageId = typeof item.id === 'string'
      ? item.id
      : typeof item.image_id === 'string'
        ? item.image_id
        : undefined;
    return [{ inlineSvg, url, sourceImageId }];
  });
}

export function validateRecraftVectorSourceCount(
  sources: RecraftVectorSource[],
  expectedCount: number,
): void {
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > MAX_VECTOR_RESULTS) {
    throw new Error('无效的 Recraft 预期结果数量');
  }
  if (sources.length !== expectedCount) {
    throw new Error(`Recraft 结果数量不一致：预期 ${expectedCount}，实际 ${sources.length}`);
  }
}
