/**
 * Platform Prompt Selector
 * 根据目标平台选择和格式化对应的 Prompt 变体
 * 支持 GPT Image / Midjourney / Flux / Ideogram / Universal 五种平台
 */

import type { LogoDirection, SymbolConcept, VisualSystemNotes } from './sanbaoPromptParser';

/** 平台类型 */
export type TargetPlatform = 'gpt-image' | 'midjourney' | 'flux' | 'ideogram' | 'all';

/** 输出布局类型 */
export type OutputLayout = 'brand-system-board' | 'identity-board' | 'standalone-logo' | 'square-avatar' | 'transparent-asset';

/** 平台 Prompt 结果 */
export interface PlatformPrompt {
  platform: string;
  prompt: string;
  notes?: string;
}

/** Prompt 选择器输入 */
export interface PromptSelectorInput {
  brandName: string;
  direction: LogoDirection;
  symbol: SymbolConcept;
  visualNotes: VisualSystemNotes;
  targetPlatform: TargetPlatform;
  outputLayout: OutputLayout;
  /** 是否包含英文名称（可选） */
  includeEnglishName?: boolean;
  /** 英文品牌名称（可选，brandName 默认为中文） */
  englishName?: string;
  /** @deprecated 使用 englishName 代替，向后兼容 */
  includeChineseName?: boolean;
  /** @deprecated 使用 englishName 代替，向后兼容 */
  chineseName?: string;
}

/**
 * 规范化新旧字段：优先使用 englishName，向后兼容 chineseName
 * brandName 默认为中文，englishName 为可选英文名
 */
function resolveSecondaryName(input: PromptSelectorInput): { hasSecondary: boolean; secondaryName: string; namePart: string } {
  // 优先 englishName（新字段），兼容 chineseName（旧字段）
  const secondaryName = input.englishName || input.chineseName || '';
  const hasSecondary = !!(input.includeEnglishName || input.includeChineseName) && !!secondaryName;
  const namePart = hasSecondary ? `"${input.brandName}" (English: "${secondaryName}")` : `"${input.brandName}"`;
  return { hasSecondary, secondaryName, namePart };
}

/**
 * 根据平台选择生成所有需要的 Prompt
 */
export function selectPlatformPrompts(input: PromptSelectorInput): PlatformPrompt[] {
  const platforms: TargetPlatform[] = input.targetPlatform === 'all'
    ? ['gpt-image', 'midjourney', 'flux', 'ideogram']
    : [input.targetPlatform];

  const results: PlatformPrompt[] = [];

  // 始终包含 Universal prompt
  results.push({
    platform: 'Universal',
    prompt: buildUniversalPrompt(input),
    notes: '模型无关的通用提示词，适用于大多数图像生成模型',
  });

  for (const platform of platforms) {
    switch (platform) {
      case 'gpt-image':
        results.push({
          platform: 'GPT Image',
          prompt: buildGptImagePrompt(input),
          notes: '针对 GPT Image / DALL-E 3 优化，使用自然语言描述布局和排版',
        });
        break;
      case 'midjourney':
        results.push({
          platform: 'Midjourney',
          prompt: buildMidjourneyPrompt(input),
          notes: '针对 Midjourney v6 优化，紧凑视觉语言 + --ar 1:1 --v 6 --style raw',
        });
        break;
      case 'flux':
        results.push({
          platform: 'Flux',
          prompt: buildFluxPrompt(input),
          notes: '针对 Flux 模型优化，简洁关键词风格 + 强风格约束',
        });
        break;
      case 'ideogram':
        results.push({
          platform: 'Ideogram',
          prompt: buildIdeogramPrompt(input),
          notes: '针对 Ideogram 优化，强调精确可读文字和干净矢量风格',
        });
        break;
    }
  }

  return results;
}

/**
 * 获取用于实际图像生成的最佳 Prompt（优先 GPT Image）
 */
export function getBestGenerationPrompt(input: PromptSelectorInput): string {
  if (input.targetPlatform === 'midjourney') {
    return buildMidjourneyPrompt(input);
  }
  if (input.targetPlatform === 'flux') {
    return buildFluxPrompt(input);
  }
  if (input.targetPlatform === 'ideogram') {
    return buildIdeogramPrompt(input);
  }
  // 默认使用 GPT Image prompt（最适合品牌系统板）
  return buildGptImagePrompt(input);
}

// ─── 内部构建函数 ─────────────────────────────────────────────────

function buildUniversalPrompt(input: PromptSelectorInput): string {
  const { brandName, direction, symbol, visualNotes, outputLayout } = input;
  const { hasSecondary, secondaryName } = resolveSecondaryName(input);
  const parts: string[] = [];

  parts.push(`Logo design for "${brandName}"`);
  if (hasSecondary) {
    parts.push(`with English name "${secondaryName}"`);
  }

  // 方向
  parts.push(`Visual mood: ${direction.visualMood}`);
  parts.push(`Color palette: ${direction.colorPalette.join(', ')}`);
  parts.push(`Typography: ${direction.typography}`);

  // 符号
  parts.push(`Symbol concept: ${symbol.coreMetaphor}`);
  parts.push(`Icon form: ${symbol.iconForm}`);
  if (symbol.negativeSpaceIdea) {
    parts.push(`Negative space: ${symbol.negativeSpaceIdea}`);
  }

  // 布局
  if (outputLayout === 'brand-system-board') {
    parts.push('Present as a professional brand system board with numbered modules: main logo, favicon, seal version, wordmark lockup, black and ivory applications, editorial mockup, embossed application, symbol meaning diagram, and footer value strip. Square canvas on ivory background with thin grid lines.');
  } else if (outputLayout === 'standalone-logo') {
    parts.push('Clean standalone logo on pure white background, centered composition, vector-like finish.');
  } else if (outputLayout === 'square-avatar') {
    parts.push('Square app icon/avatar version, centered symbol, simple silhouette, favicon-friendly.');
  } else if (outputLayout === 'transparent-asset') {
    parts.push('Logo on transparent background, no background elements, clean vector-like edges.');
  } else if (outputLayout === 'identity-board') {
    parts.push('Simple identity board showing main logo, color palette swatches, and typography specimen. Clean layout on white background.');
  }

  // 视觉系统
  parts.push(`One-color behavior: ${visualNotes.oneColorBehavior}`);
  parts.push('Timeless, premium, scalable design. No gradients, no 3D effects, no decorative elements.');

  return parts.join('. ') + '.';
}

function buildGptImagePrompt(input: PromptSelectorInput): string {
  const { brandName, direction, symbol, visualNotes, outputLayout } = input;
  const { namePart } = resolveSecondaryName(input);

  if (outputLayout === 'brand-system-board') {
    return `Create a professional brand system board for the logo of ${namePart}.

The board should be a square canvas on an ivory or warm-white background, with a thin outer border and fine internal grid lines creating numbered module sections.

MODULE 1 "MAIN LOGO": Large hero area showing the primary symbol above or beside the exact wordmark "${brandName}". The symbol should be ${symbol.iconForm}, inspired by ${symbol.coreMetaphor}. ${symbol.negativeSpaceIdea ? `Use negative space to suggest ${symbol.negativeSpaceIdea}.` : ''} Use ${direction.colorPalette.join(' and ')} as the primary colors with a ${direction.visualMood} mood. Typography: ${direction.typography}.

MODULE 2 "FAVICON": A reduced standalone symbol version, simple silhouette.

MODULE 3 "SEAL VERSION": A circular seal or badge using the same symbol and brand name.

MODULE 4 "WORDMARK LOCKUP": Horizontal symbol-plus-wordmark lockup with a thin vertical separator.

MODULE 5 "BLACK AND IVORY APPLICATIONS": Two cards — one black with ivory artwork, one ivory with black artwork.

MODULE 6 "EDITORIAL COVER MOCKUP": A restrained print or interface mockup using the identity.

MODULE 7 "EMBOSSED PRINT APPLICATION": Monochrome debossed or embossed paper texture mockup.

MODULE 8 "SYMBOL MEANING": A compact diagram with arrows and labels explaining how the symbol expresses the brand idea, with small red accent ticks.

Footer strip: Four compact value blocks (OUR MISSION, OUR VIEW, OUR STANDARD, OUR PROMISE) each with a minimal line icon and short brand-specific copy.

Style: ${direction.visualMood}, premium, disciplined alignment, generous whitespace. Mostly black and ivory with only a very small deep red accent line or dot. Serif or refined wordmark typography. No bright colors, no glossy effects, no 3D renders, no decorative gradients.`;
  }

  if (outputLayout === 'standalone-logo') {
    return `Create a clean standalone logo for ${namePart} on a pure white background.

The symbol should be ${symbol.iconForm}, inspired by ${symbol.coreMetaphor}. ${symbol.negativeSpaceIdea ? `Use negative space to suggest ${symbol.negativeSpaceIdea}.` : ''} The wordmark "${brandName}" should use ${direction.typography} typography. Primary colors: ${direction.colorPalette.join(', ')}. Visual mood: ${direction.visualMood}.

Centered composition, vector-like finish, premium and timeless. ${visualNotes.oneColorBehavior}. No gradients, no 3D effects, no shadows, no decorative elements. Scalable and favicon-friendly.`;
  }

  if (outputLayout === 'square-avatar') {
    return `Create a square app icon for ${namePart}.

The icon should feature a simplified version of the ${symbol.iconForm} symbol inspired by ${symbol.coreMetaphor}. Simple silhouette, centered, favicon-friendly. Single primary color (${direction.colorPalette[0]}) on a solid background. ${direction.visualMood} mood.

No text, no gradients, no 3D effects. Clean, bold, recognizable at small sizes.`;
  }

  if (outputLayout === 'transparent-asset') {
    return `Create a logo for ${namePart} on a transparent background.

The symbol should be ${symbol.iconForm}, inspired by ${symbol.coreMetaphor}. ${symbol.negativeSpaceIdea ? `Use negative space: ${symbol.negativeSpaceIdea}.` : ''} The wordmark "${brandName}" should use ${direction.typography} typography. Primary colors: ${direction.colorPalette.join(', ')}.

No background elements whatsoever. Clean vector-like edges. Premium and timeless. ${visualNotes.oneColorBehavior}.`;
  }

  // identity-board
  return `Create a simple identity board for ${namePart} on a white background.

Show the main logo (symbol + wordmark "${brandName}") prominently at the top. Below, display color palette swatches: ${direction.colorPalette.join(', ')}. At the bottom, show a typography specimen using ${direction.typography} style.

Clean layout, generous whitespace, ${direction.visualMood} mood. The symbol is ${symbol.iconForm}, inspired by ${symbol.coreMetaphor}. No gradients, no 3D effects.`;
}

function buildMidjourneyPrompt(input: PromptSelectorInput): string {
  const { brandName, direction, symbol, outputLayout } = input;
  const paletteStr = direction.colorPalette.slice(0, 3).join(', ');

  if (outputLayout === 'brand-system-board') {
    return `brand system board for "${brandName}", ${symbol.iconForm} logo inspired by ${symbol.coreMetaphor}, ${direction.visualMood} mood, ${paletteStr}, ivory background, numbered modules, main logo, favicon, seal, wordmark lockup, black and ivory applications, embossed mockup, symbol meaning diagram, footer values, premium editorial layout, disciplined alignment, generous whitespace, thin grid lines, small red accent, serif wordmark, vector-like finish --ar 1:1 --v 6 --style raw`;
  }

  if (outputLayout === 'standalone-logo') {
    return `logo design for "${brandName}", ${symbol.iconForm} symbol inspired by ${symbol.coreMetaphor}, ${direction.visualMood}, ${paletteStr}, ${direction.typography} typography, centered on white, vector-like, premium, timeless, scalable --ar 1:1 --v 6 --style raw`;
  }

  if (outputLayout === 'square-avatar') {
    return `app icon for "${brandName}", ${symbol.iconForm} symbol, ${direction.visualMood}, ${paletteStr}, simple silhouette, centered, favicon-friendly, no text, bold --ar 1:1 --v 6 --style raw`;
  }

  return `identity board for "${brandName}", ${symbol.iconForm} logo, ${direction.visualMood}, ${paletteStr}, ${direction.typography}, color swatches, typography specimen, white background, clean layout --ar 1:1 --v 6 --style raw`;
}

function buildFluxPrompt(input: PromptSelectorInput): string {
  const { brandName, direction, symbol, outputLayout } = input;
  const paletteStr = direction.colorPalette.slice(0, 2).join(' and ');

  const base = `Logo for "${brandName}", ${symbol.iconForm}, ${symbol.coreMetaphor}, ${direction.visualMood}, ${paletteStr}, ${direction.typography}`;

  if (outputLayout === 'brand-system-board') {
    return `${base}, brand system board layout, numbered modules, ivory background, premium editorial grid, main logo hero, favicon, seal, lockup, applications, embossed, symbol meaning, minimal red accent, vector-like, timeless`;
  }

  if (outputLayout === 'standalone-logo') {
    return `${base}, standalone logo, white background, centered, vector-like, clean, premium, no shadows, no gradients`;
  }

  if (outputLayout === 'square-avatar') {
    return `${base}, app icon, square, simple silhouette, centered, bold, favicon-friendly, no text`;
  }

  return `${base}, identity board, color swatches, typography specimen, white background, clean layout`;
}

function buildIdeogramPrompt(input: PromptSelectorInput): string {
  const { brandName, direction, symbol, outputLayout } = input;
  const { hasSecondary, secondaryName } = resolveSecondaryName(input);
  const namePart = hasSecondary ? `${brandName} ${secondaryName}` : brandName;
  const paletteStr = direction.colorPalette.slice(0, 3).join(', ');

  if (outputLayout === 'brand-system-board') {
    return `A professional brand system board for the logo of "${namePart}". The text "${namePart}" must be rendered exactly and legibly. ${symbol.iconForm} symbol inspired by ${symbol.coreMetaphor}. ${direction.visualMood} mood. Colors: ${paletteStr}. ${direction.typography} typography. Square ivory background with thin grid lines. Numbered modules: 1.MAIN LOGO with symbol and exact wordmark, 2.FAVICON, 3.SEAL VERSION, 4.WORDMARK LOCKUP, 5.BLACK AND IVORY APPLICATIONS, 6.EDITORIAL MOCKUP, 7.EMBOSSED APPLICATION, 8.SYMBOL MEANING diagram. Footer with OUR MISSION, OUR VIEW, OUR STANDARD, OUR PROMISE. Premium, vector-like, disciplined alignment, generous whitespace, minimal red accent.`;
  }

  if (outputLayout === 'standalone-logo') {
    return `A clean standalone logo for "${namePart}". The text "${namePart}" must be rendered exactly and legibly. ${symbol.iconForm} symbol inspired by ${symbol.coreMetaphor}. ${direction.visualMood} mood. Colors: ${paletteStr}. ${direction.typography} typography. Centered on white background, vector-like finish, premium and timeless. No shadows, no gradients, no 3D effects.`;
  }

  if (outputLayout === 'square-avatar') {
    return `A square app icon for "${namePart}". ${symbol.iconForm} symbol inspired by ${symbol.coreMetaphor}. Simple silhouette, centered, bold. Color: ${paletteStr}. ${direction.visualMood} mood. No text, no gradients, clean vector-like.`;
  }

  return `An identity board for "${namePart}". The text "${namePart}" must be rendered exactly and legibly. ${symbol.iconForm} symbol, ${direction.visualMood}, ${paletteStr}, ${direction.typography} typography. Color palette swatches and typography specimen. White background, clean layout.`;
}
