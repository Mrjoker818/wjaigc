export type VectorTemplateGroup = 'quick' | 'category' | 'design' | 'style';

export interface VectorKeywordTemplate {
  id: string;
  label: string;
  group: VectorTemplateGroup;
  prompt: string;
}

export const VECTOR_KEYWORD_TEMPLATES: VectorKeywordTemplate[] = [
  { id: 'line-art', label: '线条插画', group: 'quick', prompt: 'clean vector line art, precise smooth strokes' },
  { id: 'flat-icon', label: '扁平图标', group: 'quick', prompt: 'flat vector icon, simple geometry, crisp silhouette' },
  { id: 'two-color', label: '双色', group: 'quick', prompt: 'two-color vector palette, strong visual hierarchy' },
  { id: 'transparent', label: '透明背景', group: 'quick', prompt: 'isolated vector artwork on transparent background' },
  { id: 'no-text', label: '无文字', group: 'quick', prompt: 'no text, no letters, no watermark' },
  { id: 'print-ready', label: '印刷级', group: 'quick', prompt: 'print-ready vector artwork, closed paths, clean color separations' },
  { id: 'logo', label: 'Logo标志', group: 'category', prompt: 'professional vector logo mark, memorable silhouette' },
  { id: 'icon', label: '图标', group: 'category', prompt: 'production-ready vector icon' },
  { id: 'mascot', label: 'IP角色', group: 'category', prompt: 'friendly vector mascot character, distinct silhouette' },
  { id: 'decor', label: '装饰元素', group: 'category', prompt: 'decorative vector corner element for a campaign key visual' },
  { id: 'pattern', label: '连续纹样', group: 'category', prompt: 'seamless repeatable vector pattern' },
  { id: 'sticker', label: '贴纸', group: 'category', prompt: 'die-cut vector sticker with a clean outer contour' },
  { id: 'minimal', label: '极简', group: 'design', prompt: 'minimal composition, restrained detail, generous negative space' },
  { id: 'geometric', label: '几何', group: 'design', prompt: 'geometric construction, balanced proportions' },
  { id: 'outline', label: '轮廓描边', group: 'design', prompt: 'consistent outline weight, rounded joins and caps' },
  { id: 'engraving', label: '雕刻线稿', group: 'design', prompt: 'engraving-inspired vector hatching and linework' },
  { id: 'paper-cut', label: '剪纸', group: 'design', prompt: 'layered paper-cut vector shapes' },
  { id: 'imperial-gold', label: '帝王黄', group: 'style', prompt: 'imperial gold and deep black vector palette' },
  { id: 'black-gold', label: '黑金', group: 'style', prompt: 'premium black and metallic gold color direction' },
  { id: 'chinese', label: '国潮', group: 'style', prompt: 'contemporary Chinese visual language, elegant traditional motifs' },
  { id: 'bauhaus', label: '包豪斯', group: 'style', prompt: 'Bauhaus-inspired vector geometry and primary color rhythm' },
  { id: 'retro', label: '复古', group: 'style', prompt: 'refined retro vector illustration, limited palette' },
];

export function buildVectorPrompt(input: { prompt: string; templateIds?: string[] }): string {
  const selected = new Set(input.templateIds || []);
  const fragments = VECTOR_KEYWORD_TEMPLATES
    .filter(template => selected.has(template.id))
    .map(template => template.prompt);
  return [
    input.prompt.trim(),
    ...fragments,
    'native editable SVG vector artwork',
    'separate logical elements into clean groups',
  ].filter(Boolean).join(', ');
}

export function isRecraftVectorModel(modelId: string): boolean {
  return /^recraftv(?:2|3|4|4_1)(?:_utility)?(?:_pro)?_vector$/i.test(modelId.trim());
}

function stripUnsafeSvgBlocks(svg: string): string {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!doctype[\s\S]*?>/gi, '')
    .replace(/<(script|foreignObject|iframe|object|embed|link|meta)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|foreignObject|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/\s+(?:href|xlink:href)\s*=\s*(["'])(?!#|data:image\/)[\s\S]*?\1/gi, '');
}

export function sanitizeEditableSvg(input: string): string {
  const svgStart = input.search(/<svg\b/i);
  const svgEnd = input.toLowerCase().lastIndexOf('</svg>');
  if (svgStart < 0 || svgEnd < 0) throw new Error('模型没有返回有效 SVG');

  let svg = stripUnsafeSvgBlocks(input.slice(svgStart, svgEnd + 6));
  if (!/\sxmlns=/.test(svg.match(/<svg\b[^>]*>/i)?.[0] || '')) {
    svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  let index = 0;
  svg = svg.replace(
    /<(g|path|rect|circle|ellipse|polygon|polyline|line|text)\b(?![^>]*data-vector-element-id=)([^>]*)>/gi,
    (match, tag: string, attrs: string) => {
      if (tag.toLowerCase() === 'g' && /\b(?:defs|clipPath|mask|linearGradient|radialGradient)\b/i.test(attrs)) {
        return match;
      }
      index += 1;
      return `<${tag} data-vector-element-id="vector-element-${index}"${attrs}>`;
    },
  );
  return svg.trim();
}

export type VectorEditOperation =
  | { type: 'delete'; elementId: string }
  | { type: 'recolor'; elementId: string; color: string }
  | { type: 'transform'; elementId: string; transform: string }
  | { type: 'expand'; percent: number }
  | {
      type: 'replace';
      elementId: string;
      replacementSvg: string;
      targetBox?: { x: number; y: number; width: number; height: number };
    }
  | { type: 'append'; replacementSvg: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateElementOpeningTag(
  svg: string,
  elementId: string,
  update: (openingTag: string) => string,
): string {
  const id = escapeRegExp(elementId);
  const pattern = new RegExp(`<([a-z][\\w:-]*)\\b(?=[^>]*data-vector-element-id=["']${id}["'])[^>]*>`, 'i');
  if (!pattern.test(svg)) throw new Error('未找到选中的 SVG 元素');
  return svg.replace(pattern, openingTag => update(openingTag));
}

function extractSvgChildren(svg: string): string {
  const match = sanitizeEditableSvg(svg).match(/<svg\b[^>]*>([\s\S]*)<\/svg>/i);
  return match?.[1]?.trim() || '';
}

function extractSvgViewBox(svg: string): { x: number; y: number; width: number; height: number } {
  const match = svg.match(/\bviewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
  if (!match) return { x: 0, y: 0, width: 1, height: 1 };
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    width: Math.max(0.0001, Number(match[3])),
    height: Math.max(0.0001, Number(match[4])),
  };
}

export function applyVectorEditOperation(svg: string, operation: VectorEditOperation): string {
  if (operation.type === 'expand') {
    const opening = svg.match(/<svg\b[^>]*>/i)?.[0] || '';
    const viewBox = opening.match(/\bviewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
    if (!viewBox) throw new Error('SVG 缺少 viewBox，无法扩展画面');
    const [x, y, width, height] = viewBox.slice(1).map(Number);
    const ratio = Math.max(0, Math.min(200, operation.percent)) / 100;
    const dx = width * ratio / 2;
    const dy = height * ratio / 2;
    const next = `${x - dx} ${y - dy} ${width + dx * 2} ${height + dy * 2}`;
    return svg.replace(opening, opening.replace(viewBox[0], `viewBox="${next}"`));
  }

  if (operation.type === 'append') {
    return sanitizeEditableSvg(svg.replace(/<\/svg>\s*$/i, `${extractSvgChildren(operation.replacementSvg)}</svg>`));
  }

  if (operation.type === 'replace') {
    const id = escapeRegExp(operation.elementId);
    let replacement = extractSvgChildren(operation.replacementSvg);
    if (operation.targetBox) {
      const sourceBox = extractSvgViewBox(operation.replacementSvg);
      const target = operation.targetBox;
      const scaleX = target.width / sourceBox.width;
      const scaleY = target.height / sourceBox.height;
      const translateX = target.x - sourceBox.x * scaleX;
      const translateY = target.y - sourceBox.y * scaleY;
      replacement = `<g transform="translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})">${replacement}</g>`;
    }
    const paired = new RegExp(`<([a-z][\\w:-]*)\\b(?=[^>]*data-vector-element-id=["']${id}["'])[^>]*>[\\s\\S]*?<\\/\\1>`, 'i');
    const single = new RegExp(`<([a-z][\\w:-]*)\\b(?=[^>]*data-vector-element-id=["']${id}["'])[^>]*\\/?>`, 'i');
    if (!paired.test(svg) && !single.test(svg)) throw new Error('未找到选中的 SVG 元素');
    return sanitizeEditableSvg(svg.replace(paired, replacement).replace(single, replacement));
  }

  if (operation.type === 'delete') {
    const id = escapeRegExp(operation.elementId);
    const paired = new RegExp(`<([a-z][\\w:-]*)\\b(?=[^>]*data-vector-element-id=["']${id}["'])[^>]*>[\\s\\S]*?<\\/\\1>`, 'i');
    const single = new RegExp(`<([a-z][\\w:-]*)\\b(?=[^>]*data-vector-element-id=["']${id}["'])[^>]*\\/?>`, 'i');
    if (!paired.test(svg) && !single.test(svg)) throw new Error('未找到选中的 SVG 元素');
    return svg.replace(paired, '').replace(single, '');
  }

  if (operation.type === 'recolor') {
    if (!/^#[0-9a-f]{6}$/i.test(operation.color)) throw new Error('颜色必须是六位十六进制');
    return updateElementOpeningTag(svg, operation.elementId, openingTag => (
      /\sfill=/.test(openingTag)
        ? openingTag.replace(/\sfill=(["'])[^"']*\1/i, ` fill="${operation.color}"`)
        : openingTag.replace(/>$/, ` fill="${operation.color}">`)
    ));
  }

  return updateElementOpeningTag(svg, operation.elementId, openingTag => {
    const existing = openingTag.match(/\stransform=(["'])([^"']*)\1/i);
    if (existing) {
      return openingTag.replace(existing[0], ` transform="${existing[2]} ${operation.transform}"`);
    }
    return openingTag.replace(/>$/, ` transform="${operation.transform}">`);
  });
}

const COLOR_WORDS: Array<[RegExp, string]> = [
  [/黑金|金色|帝王黄/, '#d4af37'],
  [/黑色/, '#111111'],
  [/白色/, '#ffffff'],
  [/红色/, '#dc2626'],
  [/蓝色/, '#2563eb'],
  [/绿色/, '#16a34a'],
];

export function interpretVectorInstruction(
  instruction: string,
  elementId?: string,
): VectorEditOperation | null {
  const text = instruction.trim();
  if (/扩展|扩大画面|留白/.test(text)) return { type: 'expand', percent: 20 };
  if (!elementId) return null;
  if (/删除|去掉|移除/.test(text)) return { type: 'delete', elementId };
  const color = COLOR_WORDS.find(([pattern]) => pattern.test(text))?.[1];
  if (color && /改|换|变|颜色|配色/.test(text)) return { type: 'recolor', elementId, color };
  if (/细长|变细/.test(text)) return { type: 'transform', elementId, transform: 'scale(0.82 1.12)' };
  if (/放大/.test(text)) return { type: 'transform', elementId, transform: 'scale(1.15)' };
  if (/缩小/.test(text)) return { type: 'transform', elementId, transform: 'scale(0.85)' };
  return null;
}
