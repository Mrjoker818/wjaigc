import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export type VectorTemplateGroup = 'quick' | 'category' | 'design' | 'style';

export interface VectorKeywordTemplate {
  id: string;
  label: string;
  group: VectorTemplateGroup;
  prompt: string;
}

export interface VectorPresetSelection {
  quickIds: string[];
  categoryId?: string;
  designId?: string;
  styleId?: string;
}

export interface VectorAspectRatio {
  value: string;
  label: string;
}

export const VECTOR_ASPECT_RATIOS: VectorAspectRatio[] = [
  { value: '1:1', label: '方形' },
  { value: '2:1', label: '超宽横版' },
  { value: '1:2', label: '超长竖版' },
  { value: '3:2', label: '经典横版' },
  { value: '2:3', label: '经典竖版' },
  { value: '4:3', label: '标准横版' },
  { value: '3:4', label: '标准竖版' },
  { value: '5:4', label: '紧凑横版' },
  { value: '4:5', label: '社媒竖版' },
  { value: '6:10', label: '海报竖版' },
  { value: '14:10', label: '展示横版' },
  { value: '10:14', label: '展示竖版' },
  { value: '16:9', label: '宽屏' },
  { value: '9:16', label: '手机竖屏' },
];

export const VECTOR_KEYWORD_TEMPLATES: VectorKeywordTemplate[] = [
  { id: 'transparent', label: '透明背景', group: 'quick', prompt: 'isolated vector artwork on a transparent background' },
  { id: 'no-text', label: '无文字', group: 'quick', prompt: 'no text, no letters, no watermark' },
  { id: 'mono', label: '单色', group: 'quick', prompt: 'single-color vector palette' },
  { id: 'two-color', label: '双色', group: 'quick', prompt: 'two-color vector palette with strong visual hierarchy' },
  { id: 'limited-palette', label: '限定色盘', group: 'quick', prompt: 'limited harmonious vector color palette' },
  { id: 'flat-fill', label: '纯色填充', group: 'quick', prompt: 'flat solid fills without photographic shading' },
  { id: 'uniform-outline', label: '统一描边', group: 'quick', prompt: 'consistent outline weight with clean joins and caps' },
  { id: 'no-outline', label: '无描边', group: 'quick', prompt: 'shape-driven vector artwork without outlines' },
  { id: 'no-gradient', label: '无渐变', group: 'quick', prompt: 'no gradients, use clean separated color fields' },
  { id: 'gradient-allowed', label: '允许渐变', group: 'quick', prompt: 'controlled editable vector gradients where they improve depth' },
  { id: 'small-size-clarity', label: '小尺寸清晰', group: 'quick', prompt: 'legible silhouette and details at small display sizes' },
  { id: 'print-ready', label: '印刷友好', group: 'quick', prompt: 'print-ready vector artwork with clean color separations' },
  { id: 'closed-paths', label: '闭合路径', group: 'quick', prompt: 'closed clean vector paths suitable for production' },
  { id: 'symmetric', label: '对称构图', group: 'quick', prompt: 'precise symmetrical composition' },
  { id: 'centered', label: '居中构图', group: 'quick', prompt: 'centered balanced composition' },
  { id: 'whitespace', label: '留白充足', group: 'quick', prompt: 'generous controlled negative space' },
  { id: 'seamless', label: '无缝平铺', group: 'quick', prompt: 'seamless repeatable vector edges' },
  { id: 'line-art', label: '线条插画', group: 'quick', prompt: 'clean vector line art with precise smooth strokes' },
  { id: 'flat-icon', label: '扁平图标', group: 'quick', prompt: 'flat vector icon with simple geometry and a crisp silhouette' },

  { id: 'logo', label: 'Logo 标志', group: 'category', prompt: 'professional vector logo mark with a memorable silhouette' },
  { id: 'mark', label: '图形标', group: 'category', prompt: 'standalone professional vector brand mark' },
  { id: 'wordmark', label: '字标', group: 'category', prompt: 'professional vector wordmark with custom letterform construction' },
  { id: 'combination-logo', label: '组合标', group: 'category', prompt: 'professional combination logo with an integrated symbol and wordmark' },
  { id: 'app-icon', label: '应用图标', group: 'category', prompt: 'production-ready app icon with a strong focal symbol' },
  { id: 'icon', label: '单枚图标', group: 'category', prompt: 'production-ready vector icon' },
  { id: 'icon-set', label: '图标组', group: 'category', prompt: 'cohesive vector icon set with consistent visual grammar' },
  { id: 'mascot', label: 'IP 角色', group: 'category', prompt: 'friendly vector mascot character with a distinct silhouette' },
  { id: 'character-sheet', label: '角色设定', group: 'category', prompt: 'vector character design sheet with consistent proportions' },
  { id: 'sticker', label: '贴纸徽章', group: 'category', prompt: 'die-cut vector sticker or badge with a clean outer contour' },
  { id: 'packaging-label', label: '包装标签', group: 'category', prompt: 'print-ready vector packaging label system' },
  { id: 'poster-kv', label: '海报主视觉', group: 'category', prompt: 'campaign key visual composed as editable vector artwork' },
  { id: 'social-illustration', label: '社媒插画', group: 'category', prompt: 'social media vector illustration with a clear focal point' },
  { id: 'infographic', label: '信息图', group: 'category', prompt: 'structured vector infographic with clear information hierarchy' },
  { id: 'map-signage', label: '地图导视', group: 'category', prompt: 'legible vector map and wayfinding system' },
  { id: 'pattern', label: '连续纹样', group: 'category', prompt: 'seamless repeatable vector pattern' },
  { id: 'textile', label: '纺织图案', group: 'category', prompt: 'production-ready repeat vector motif for textiles' },
  { id: 'border', label: '边框花边', group: 'category', prompt: 'modular vector border and ornamental trim' },
  { id: 'decor', label: '装饰元素', group: 'category', prompt: 'decorative vector element for a campaign key visual' },

  { id: 'minimal', label: '极简', group: 'design', prompt: 'minimal composition with restrained detail and generous negative space' },
  { id: 'flat-illustration', label: '扁平插画', group: 'design', prompt: 'flat vector illustration with layered solid shapes' },
  { id: 'monoline', label: '单线条', group: 'design', prompt: 'continuous monoline vector construction with consistent stroke weight' },
  { id: 'geometric', label: '几何构成', group: 'design', prompt: 'geometric construction with balanced proportions' },
  { id: 'negative-space', label: '负形设计', group: 'design', prompt: 'clever negative-space vector construction' },
  { id: 'badge', label: '徽章构图', group: 'design', prompt: 'compact emblematic badge composition' },
  { id: 'monogram', label: '字母组合', group: 'design', prompt: 'custom vector monogram with interlocking letterforms' },
  { id: 'paper-cut', label: '剪纸层叠', group: 'design', prompt: 'layered paper-cut vector shapes' },
  { id: 'isometric', label: '等距视角', group: 'design', prompt: 'precise isometric vector construction' },
  { id: 'silhouette', label: '剪影', group: 'design', prompt: 'bold silhouette-first vector construction' },
  { id: 'engraving', label: '雕刻线稿', group: 'design', prompt: 'engraving-inspired vector hatching and linework' },
  { id: 'point-line-plane', label: '点线面', group: 'design', prompt: 'balanced point-line-plane visual construction' },
  { id: 'modular-grid', label: '模块网格', group: 'design', prompt: 'modular vector system aligned to a consistent grid' },
  { id: 'bold-outline-cartoon', label: '粗描边卡通', group: 'design', prompt: 'bold-outline vector cartoon with expressive simple forms' },
  { id: 'minimal-symbol', label: '极简符号', group: 'design', prompt: 'minimal symbolic vector design reduced to essential shapes' },
  { id: 'detailed-vector', label: '精细矢量', group: 'design', prompt: 'detailed vector illustration with organized editable groups' },
  { id: 'technical-line', label: '技术线稿', group: 'design', prompt: 'precise technical vector line drawing' },
  { id: 'outline', label: '轮廓描边', group: 'design', prompt: 'consistent outline weight with rounded joins and caps' },

  { id: 'modern-minimal', label: '现代极简', group: 'style', prompt: 'modern minimal vector art direction' },
  { id: 'swiss', label: '瑞士国际主义', group: 'style', prompt: 'Swiss International Style with disciplined grid rhythm' },
  { id: 'bauhaus', label: '包豪斯', group: 'style', prompt: 'Bauhaus-inspired vector geometry and primary color rhythm' },
  { id: 'memphis', label: '孟菲斯', group: 'style', prompt: 'Memphis design with playful geometric motifs' },
  { id: 'art-deco', label: '装饰艺术', group: 'style', prompt: 'Art Deco symmetry, stepped geometry and refined ornament' },
  { id: 'mid-century', label: '中世纪现代', group: 'style', prompt: 'mid-century modern vector illustration' },
  { id: 'y2k', label: 'Y2K', group: 'style', prompt: 'Y2K graphic language with chrome-inspired vector forms' },
  { id: 'retro', label: '复古', group: 'style', prompt: 'refined retro vector illustration with a limited palette' },
  { id: 'retro-print', label: '复古印刷', group: 'style', prompt: 'retro printmaking look with controlled vector misregistration' },
  { id: 'cyberpunk', label: '赛博朋克', group: 'style', prompt: 'cyberpunk vector graphics with high-contrast luminous accents' },
  { id: 'chinese', label: '国潮', group: 'style', prompt: 'contemporary Chinese visual language with elegant traditional motifs' },
  { id: 'neo-chinese', label: '新中式', group: 'style', prompt: 'restrained contemporary Chinese vector art direction' },
  { id: 'japanese', label: '日式平面', group: 'style', prompt: 'Japanese graphic vector style with calm composition' },
  { id: 'folk-paper-cut', label: '民俗剪纸', group: 'style', prompt: 'folk paper-cut vector language with rhythmic symmetry' },
  { id: 'children-book', label: '儿童绘本', group: 'style', prompt: 'warm children-book vector illustration' },
  { id: 'street-toy', label: '潮玩街头', group: 'style', prompt: 'street-art toy design with bold vector character forms' },
  { id: 'tech-future', label: '科技未来', group: 'style', prompt: 'precise futuristic technology vector art direction' },
  { id: 'black-gold', label: '黑金奢华', group: 'style', prompt: 'premium black and metallic gold color direction' },
  { id: 'imperial-gold', label: '帝王金', group: 'style', prompt: 'imperial gold and deep black vector palette' },
  { id: 'organic', label: '自然有机', group: 'style', prompt: 'organic vector forms inspired by natural growth' },
  { id: 'soft-gradient', label: '柔和渐变', group: 'style', prompt: 'soft controlled vector gradients with gentle depth' },
  { id: 'pop', label: '波普', group: 'style', prompt: 'bold pop-art vector language with energetic color blocking' },
  { id: 'continuous-line', label: '连续线艺术', group: 'style', prompt: 'elegant continuous-line vector art direction' },
];

const QUICK_CONFLICTS: Record<string, string[]> = {
  mono: ['two-color', 'limited-palette', 'gradient-allowed'],
  'two-color': ['mono', 'limited-palette'],
  'limited-palette': ['mono', 'two-color'],
  'flat-fill': ['gradient-allowed'],
  'uniform-outline': ['no-outline'],
  'no-outline': ['uniform-outline'],
  'no-gradient': ['gradient-allowed'],
  'gradient-allowed': ['no-gradient', 'flat-fill', 'mono'],
};

const TEXT_REQUIRED_CATEGORIES = new Set(['wordmark', 'combination-logo']);

function isTemplateInGroup(id: string | undefined, group: VectorTemplateGroup): boolean {
  return Boolean(id && VECTOR_KEYWORD_TEMPLATES.some(template => template.id === id && template.group === group));
}

export function normalizeVectorSelection(input: VectorPresetSelection): VectorPresetSelection {
  const quickIds: string[] = [];
  for (const id of input.quickIds) {
    if (!isTemplateInGroup(id, 'quick')) continue;
    const conflicts = new Set(QUICK_CONFLICTS[id] || []);
    for (let index = quickIds.length - 1; index >= 0; index -= 1) {
      if (conflicts.has(quickIds[index])) quickIds.splice(index, 1);
    }
    if (!quickIds.includes(id)) quickIds.push(id);
  }

  const categoryId = isTemplateInGroup(input.categoryId, 'category') ? input.categoryId : undefined;
  if (categoryId && TEXT_REQUIRED_CATEGORIES.has(categoryId)) {
    const noTextIndex = quickIds.indexOf('no-text');
    if (noTextIndex >= 0) quickIds.splice(noTextIndex, 1);
  }

  return {
    quickIds,
    categoryId,
    designId: isTemplateInGroup(input.designId, 'design') ? input.designId : undefined,
    styleId: isTemplateInGroup(input.styleId, 'style') ? input.styleId : undefined,
  };
}

export function buildVectorPrompt(input: {
  prompt: string;
  templateIds?: string[];
  selection?: VectorPresetSelection;
}): string {
  const normalized = input.selection ? normalizeVectorSelection(input.selection) : null;
  const selectedIds = normalized
    ? [
        normalized.categoryId,
        normalized.designId,
        normalized.styleId,
        ...normalized.quickIds,
      ].filter((id): id is string => Boolean(id))
    : input.templateIds || [];
  const templateById = new Map(VECTOR_KEYWORD_TEMPLATES.map(template => [template.id, template]));
  const fragments = selectedIds
    .map(id => templateById.get(id)?.prompt)
    .filter((fragment): fragment is string => Boolean(fragment));
  return [
    input.prompt.trim(),
    ...fragments,
    'native editable SVG vector artwork',
    'separate logical elements into clean groups',
  ].filter(Boolean).join(', ');
}

export type RecraftModelFamily = 'v2' | 'v3' | 'v4' | 'v4.1';
export type RecraftModelTier = 'standard' | 'pro' | 'utility' | 'utility_pro';

export interface VectorModelCapabilities {
  family: RecraftModelFamily;
  tier: RecraftModelTier;
  maxCount: number;
  megapixels: 1 | 4;
  supportsStyles: boolean;
  supportsCustomStyles: boolean;
  supportsImageToImage: boolean;
  supportsExplore: boolean;
  supportsNegativePrompt: boolean;
  supportsNoTextControl: boolean;
  supportsColors: boolean;
  supportsBackgroundColor: boolean;
  supportsRandomSeed: boolean;
  promptLimit: 1000 | 10000;
}

export function getVectorModelCapabilities(modelId: string): VectorModelCapabilities {
  const normalized = modelId.trim().toLowerCase();
  if (!isRecraftVectorModel(normalized)) throw new Error('不是受支持的 Recraft Vector 模型');

  const family: RecraftModelFamily = normalized.includes('recraftv4_1')
    ? 'v4.1'
    : normalized.includes('recraftv4')
      ? 'v4'
      : normalized.includes('recraftv3')
        ? 'v3'
        : 'v2';
  const tier: RecraftModelTier = normalized.includes('_utility_pro_')
    ? 'utility_pro'
    : normalized.includes('_utility_')
      ? 'utility'
      : normalized.includes('_pro_')
        ? 'pro'
        : 'standard';
  const isV4Family = family === 'v4' || family === 'v4.1';

  return {
    family,
    tier,
    maxCount: 6,
    megapixels: tier === 'pro' || tier === 'utility_pro' ? 4 : 1,
    supportsStyles: family === 'v2' || family === 'v3',
    supportsCustomStyles: family === 'v3',
    supportsImageToImage: family !== 'v2',
    supportsExplore: isV4Family,
    supportsNegativePrompt: family === 'v2' || family === 'v3',
    supportsNoTextControl: family === 'v3',
    supportsColors: true,
    supportsBackgroundColor: true,
    supportsRandomSeed: true,
    promptLimit: isV4Family ? 10000 : 1000,
  };
}

export function isRecraftVectorModel(modelId: string): boolean {
  return new Set([
    'recraftv2_vector',
    'recraftv3_vector',
    'recraftv4_vector',
    'recraftv4_pro_vector',
    'recraftv4_1_vector',
    'recraftv4_1_pro_vector',
    'recraftv4_1_utility_vector',
    'recraftv4_1_utility_pro_vector',
  ]).has(modelId.trim().toLowerCase());
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const MAX_SVG_SOURCE_LENGTH = 12 * 1024 * 1024;
const MAX_SVG_ELEMENTS = 5_000;
const MAX_SVG_DEPTH = 64;
const MAX_SVG_ATTRIBUTE_LENGTH = 200_000;

const ALLOWED_SVG_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
  'desc',
  'clippath',
  'mask',
  'pattern',
  'lineargradient',
  'radialgradient',
  'stop',
  'filter',
  'fegaussianblur',
  'feoffset',
  'fecolormatrix',
  'feblend',
  'fecomposite',
  'feflood',
  'femerge',
  'femergenode',
]);

const ALLOWED_SVG_ATTRIBUTES = new Set([
  'xmlns',
  'viewbox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'id',
  'href',
  'xlink:href',
  'transform',
  'gradienttransform',
  'gradientunits',
  'patterntransform',
  'patternunits',
  'patterncontentunits',
  'preserveaspectratio',
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'color',
  'color-interpolation',
  'color-interpolation-filters',
  'vector-effect',
  'paint-order',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'offset',
  'stop-color',
  'stop-opacity',
  'flood-color',
  'flood-opacity',
  'stddeviation',
  'dx',
  'dy',
  'in',
  'in2',
  'result',
  'operator',
  'mode',
  'values',
  'type',
  'k1',
  'k2',
  'k3',
  'k4',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'alignment-baseline',
  'letter-spacing',
  'word-spacing',
  'text-decoration',
  'writing-mode',
  'lengthadjust',
  'textlength',
  'data-vector-element-id',
]);

const LOCAL_REFERENCE_ATTRIBUTES = new Set([
  'href',
  'xlink:href',
  'clip-path',
  'mask',
  'filter',
]);

function isSafeSvgAttributeValue(name: string, value: string): boolean {
  if (value.length > MAX_SVG_ATTRIBUTE_LENGTH) return false;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return false;
  if (/(?:javascript|vbscript|data)\s*:|@import|expression\s*\(/i.test(value)) return false;

  const urlReferences = value.match(/url\s*\(([^)]*)\)/gi) || [];
  if (urlReferences.some(reference => !/^url\s*\(\s*["']?#[A-Za-z_][\w.-]*["']?\s*\)$/i.test(reference))) {
    return false;
  }
  if (LOCAL_REFERENCE_ATTRIBUTES.has(name)) {
    if (name === 'href' || name === 'xlink:href') {
      return /^#[A-Za-z_][\w.-]*$/.test(value);
    }
    return /^url\s*\(\s*["']?#[A-Za-z_][\w.-]*["']?\s*\)$/i.test(value);
  }
  if (name === 'id') return /^[A-Za-z_][\w.-]*$/.test(value);
  if (name === 'xmlns') return value === SVG_NAMESPACE;
  return !/(?:https?|ftp|file)\s*:/i.test(value);
}

export function sanitizeEditableSvg(input: string): string {
  const svgStart = input.search(/<svg\b/i);
  const svgEnd = input.toLowerCase().lastIndexOf('</svg>');
  if (svgStart < 0 || svgEnd < 0) throw new Error('模型没有返回有效 SVG');
  const source = input.slice(svgStart, svgEnd + 6);
  if (source.length > MAX_SVG_SOURCE_LENGTH) throw new Error('SVG 数据超过安全上限');
  if (/<!doctype|<!entity|<\?xml-stylesheet/i.test(source)) {
    throw new Error('SVG 包含不允许的文档声明');
  }

  const parseErrors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: message => parseErrors.push(message),
      error: message => parseErrors.push(message),
      fatalError: message => parseErrors.push(message),
    },
  }).parseFromString(source, 'image/svg+xml');
  if (parseErrors.length > 0 || document.documentElement.localName.toLowerCase() !== 'svg') {
    throw new Error('模型没有返回有效 SVG');
  }

  let elementCount = 0;
  let index = 0;
  const sanitizeNode = (element: Element, depth: number): void => {
    const tag = element.localName.toLowerCase();
    if (
      depth > MAX_SVG_DEPTH
      || !ALLOWED_SVG_ELEMENTS.has(tag)
      || (element.namespaceURI && element.namespaceURI !== SVG_NAMESPACE)
    ) {
      element.parentNode?.removeChild(element);
      return;
    }
    elementCount += 1;
    if (elementCount > MAX_SVG_ELEMENTS) throw new Error('SVG 结构过于复杂');

    for (let attributeIndex = element.attributes.length - 1; attributeIndex >= 0; attributeIndex -= 1) {
      const attribute = element.attributes.item(attributeIndex);
      if (!attribute) continue;
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith('on')
        || name === 'style'
        || !ALLOWED_SVG_ATTRIBUTES.has(name)
        || !isSafeSvgAttributeValue(name, attribute.value.trim())
      ) {
        element.removeAttributeNode(attribute);
      }
    }

    const children = Array.from({ length: element.childNodes.length }, (_, childIndex) => (
      element.childNodes.item(childIndex)
    ));
    for (const child of children) {
      if (child.nodeType === 1) {
        sanitizeNode(child as Element, depth + 1);
      } else if (child.nodeType === 3) {
        if (!['text', 'tspan', 'title', 'desc'].includes(tag)) element.removeChild(child);
      } else {
        element.removeChild(child);
      }
    }

    if (['g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'text'].includes(tag)) {
      index += 1;
      element.setAttribute('data-vector-element-id', `vector-element-${index}`);
    }
  };

  sanitizeNode(document.documentElement, 0);
  document.documentElement.setAttribute('xmlns', SVG_NAMESPACE);
  return new XMLSerializer().serializeToString(document.documentElement).trim();
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
