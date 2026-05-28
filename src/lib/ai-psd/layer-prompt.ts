/**
 * AI PSD 图层Prompt生成器
 * 根据LayerPlan中每个图层的类型和描述，生成优化的图像生成Prompt
 * 
 * 对照文档: 13.图像生成要求 → 13.2生成要求
 * - 背景层不透明
 * - 光效、装饰、氛围层优先透明背景
 * - 产品图如用户上传，优先使用用户素材，不重新生成
 * - Logo如用户上传，必须作为独立图层
 * - 中文文字默认不由图像模型生成
 */

import type { LayerPlanLayer, AiPsdTask, TextLayerDef } from './types';

/** 图层类型到Prompt模板的映射 */
const LAYER_PROMPT_TEMPLATES: Record<string, (layer: LayerPlanLayer, task: AiPsdTask) => string> = {
  background: generateBackgroundPrompt,
  light: generateLightPrompt,
  subject: generateSubjectPrompt,
  decoration: generateDecorationPrompt,
  texture: generateTexturePrompt,
  atmosphere: generateAtmospherePrompt,
};

/** 生成背景层Prompt */
function generateBackgroundPrompt(layer: LayerPlanLayer, task: AiPsdTask): string {
  const parts: string[] = [];
  parts.push(`A high-quality background for a ${task.sceneType || 'commercial'} design`);
  if (task.style) parts.push(`in ${task.style} style`);
  if (task.colorTone) parts.push(`with ${task.colorTone} color tones`);
  parts.push(layer.prompt || 'elegant gradient background');
  // 背景层不透明
  parts.push('NO transparency, fully opaque background, NO text, NO product, NO logo');
  if (task.ratio === '1:1') parts.push('square composition');
  else if (task.ratio === '16:9') parts.push('horizontal widescreen composition');
  else if (task.ratio === '9:16') parts.push('vertical tall composition');
  else if (task.ratio === '4:3') parts.push('horizontal standard composition');
  else if (task.ratio === '3:4') parts.push('vertical standard composition');
  return parts.join(', ');
}

/** 生成光效层Prompt */
function generateLightPrompt(layer: LayerPlanLayer, task: AiPsdTask): string {
  const parts: string[] = [];
  parts.push('Transparent background PNG, ONLY lighting effects');
  if (task.style) parts.push(`matching ${task.style} style`);
  if (task.colorTone) parts.push(`with ${task.colorTone} glow`);
  parts.push(layer.prompt || 'soft golden light bokeh and lens flare');
  parts.push('TRANSPARENT BACKGROUND, no solid background, no text, no product, isolated light effects only');
  return parts.join(', ');
}

/** 生成主体层Prompt */
function generateSubjectPrompt(layer: LayerPlanLayer, task: AiPsdTask): string {
  const parts: string[] = [];
  parts.push('Transparent background PNG, isolated product/subject');
  if (task.style) parts.push(`in ${task.style} style`);
  parts.push(layer.prompt || 'product main subject');
  parts.push('TRANSPARENT BACKGROUND, clean cutout, no background, no text, professional product photography');
  return parts.join(', ');
}

/** 生成装饰层Prompt */
function generateDecorationPrompt(layer: LayerPlanLayer, task: AiPsdTask): string {
  const parts: string[] = [];
  parts.push('Transparent background PNG, decorative elements only');
  if (task.style) parts.push(`matching ${task.style} aesthetic`);
  if (task.colorTone) parts.push(`with ${task.colorTone} accents`);
  parts.push(layer.prompt || 'elegant decorative ornaments and patterns');
  parts.push('TRANSPARENT BACKGROUND, isolated elements, no solid background, no text, no product');
  return parts.join(', ');
}

/** 生成纹理层Prompt */
function generateTexturePrompt(layer: LayerPlanLayer, task: AiPsdTask): string {
  const parts: string[] = [];
  parts.push('Seamless texture overlay');
  if (task.style) parts.push(`matching ${task.style} style`);
  parts.push(layer.prompt || 'subtle paper texture overlay');
  parts.push('tileable texture, no text, no product');
  if (layer.transparent !== false) {
    parts.push('TRANSPARENT BACKGROUND, semi-transparent overlay');
  }
  return parts.join(', ');
}

/** 生成氛围层Prompt */
function generateAtmospherePrompt(layer: LayerPlanLayer, task: AiPsdTask): string {
  const parts: string[] = [];
  parts.push('Transparent background PNG, atmospheric effects only');
  if (task.style) parts.push(`matching ${task.style} mood`);
  if (task.colorTone) parts.push(`with ${task.colorTone} tint`);
  parts.push(layer.prompt || 'subtle particles, soft vignette, and atmospheric haze');
  parts.push('TRANSPARENT BACKGROUND, isolated atmosphere, no solid background, no text, no product');
  return parts.join(', ');
}

/** 为单个图层生成优化Prompt */
export function generateLayerPrompt(layer: LayerPlanLayer, task: AiPsdTask): string {
  const generator = LAYER_PROMPT_TEMPLATES[layer.type];
  if (generator) return generator(layer, task);
  // 通用回退
  const parts: string[] = [layer.prompt || 'design element'];
  if (layer.transparent) parts.push('TRANSPARENT BACKGROUND');
  parts.push('no text, no product');
  return parts.join(', ');
}

/** 生成整图预览Prompt */
export function generatePreviewPrompt(task: AiPsdTask): string {
  const parts: string[] = [];
  parts.push(`A complete ${task.sceneType || 'commercial'} design composition`);
  if (task.prompt) parts.push(task.prompt);
  if (task.style) parts.push(`in ${task.style} style`);
  if (task.colorTone) parts.push(`with ${task.colorTone} color palette`);
  if (task.title) parts.push(`featuring title "${task.title}"`);
  if (task.subtitle) parts.push(`subtitle "${task.subtitle}"`);
  parts.push('professional quality, print-ready, high detail');
  return parts.join(', ');
}

/** 生成文本层配置（不通过图像模型，而是程序构建） */
export function generateTextLayerConfig(textLayer: TextLayerDef, task: AiPsdTask): {
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  x: number;
  y: number;
  bold: boolean;
  italic: boolean;
} {
  // 根据颜色倾向和风格推断文字颜色
  let textColor = '#ffffff';
  if (task.colorTone) {
    const toneMap: Record<string, string> = {
      redGold: '#d4af37',
      warmGold: '#d4af37',
      coldSilver: '#c0c0c0',
      morandi: '#8e7b7b',
      cyberpunk: '#00ffcc',
      natural: '#3a3a3a',
      highContrast: '#000000',
      pastel: '#6b5b73',
    };
    textColor = toneMap[task.colorTone] || '#ffffff';
  }

  return {
    text: textLayer.text || '',
    fontSize: textLayer.fontSize || 48,
    fontFamily: textLayer.fontFamily || 'sans-serif',
    color: textColor,
    x: textLayer.x ?? 100,
    y: textLayer.y ?? 100,
    bold: textLayer.text?.includes('主标题') ?? true,
    italic: false,
  };
}
