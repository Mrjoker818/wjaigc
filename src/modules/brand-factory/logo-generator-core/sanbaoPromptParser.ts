/**
 * SanbaoAI Prompt Parser
 * 调用 LLM 生成 Logo 方向，并将响应解析为结构化数据
 *
 * 输出结构：
 *   - Logo Direction（定位、视觉氛围、配色、字体、构图）
 *   - Symbol Concept（核心隐喻、图标形式、负空间、替代路线）
 *   - Visual System Notes（组合方式、单色行为、小尺寸行为、使用说明）
 *   - Brand System Board Layout（编号模块网格布局规范）
 */

import type { SanbaoInput } from './sanbaoInputAdapter';

// ─── 结构化输出类型 ─────────────────────────────────────────────────

export interface LogoDirection {
  positioning: string;
  visualMood: string;
  colorPalette: string[];
  typography: string;
  composition: string;
  fitReason: string;
}

export interface SymbolConcept {
  coreMetaphor: string;
  iconForm: string;
  negativeSpaceIdea: string;
  alternativeRoutes: string[];
}

export interface VisualSystemNotes {
  recommendedLockups: string[];
  oneColorBehavior: string;
  smallSizeBehavior: string;
  usageNotes: string;
}

export interface BrandSystemBoardLayout {
  canvasSpec: string;
  modules: string[];
  footerValues: string[];
  styleNotes: string;
}

/** 完整的 Logo 方向结果 */
export interface LogoDirectionResult {
  direction: LogoDirection;
  symbol: SymbolConcept;
  visualNotes: VisualSystemNotes;
  boardLayout: BrandSystemBoardLayout;
  /** 原始 LLM 响应文本 */
  rawResponse: string;
}

// ─── LLM Prompt 构建 ─────────────────────────────────────────────────

/**
 * 构建 Logo 方向生成的系统提示词
 * 基于 SanbaoAI prompt.md 的专业设计师经验
 */
export function buildDirectionSystemPrompt(input: SanbaoInput): string {
  const logoTypeLabel = getLogoTypeLabel(input.logo_type);

  return `You are a senior logo strategist and visual identity designer.

Your task is to generate a logo creative package for a ${logoTypeLabel}.

BRAND: ${input.brand_name}
BRIEF: ${input.brief}
${input.audience ? `AUDIENCE: ${input.audience}` : ''}
${input.preferred_style ? `PREFERRED STYLE: ${input.preferred_style}` : ''}
${input.reference_style ? `REFERENCE STYLE: ${input.reference_style}` : ''}
${input.revision_notes ? `REVISION NOTES: ${input.revision_notes}` : ''}

CRITICAL RULES:
- Avoid generic symbols: robot heads, brains, globes, wifi icons, circuit boards, AI symbols, light bulbs, handshakes, swooshes, shield/checkmark cliches, direct imitation of existing trademarks.
- Prefer: symbolic fusion, negative space, geometric forms, memorable silhouettes, culturally meaningful but not literal motifs, typography that matches the brand personality, marks that work in one color.
- The logo must be timeless, premium, scalable, favicon-friendly, usable in black and white, and suitable for real production refinement.
- If reference_style is provided, use it as layout/spacing/mood guidance only. Never copy the reference mark, exact wordmark, or protected silhouette.
${input.revision_notes ? '- Preserve the useful parts of the prior direction and revise ONLY the requested aspects.' : ''}

OUTPUT FORMAT — respond with EXACTLY these sections in this order, using these exact markdown headers:

# Logo Direction
Include: positioning, visual mood, color palette (list exactly 3-5 specific colors with hex codes), typography, composition, and why this direction fits the logo type.

# Symbol Concept
Include: core metaphor, icon form, negative-space idea, and 2-3 alternative symbolic routes.

# Visual System Notes
Include: recommended lockups, one-color behavior, small-size behavior, and usage notes for the relevant surfaces.

# Brand System Board Layout
Describe the final brand-system-board image layout: square board grid on ivory background, module labels, main logo area, favicon, seal version, wordmark lockup, black/ivory applications, mockup, embossed application, symbol meaning, footer values, spacing, background, and one-color behavior. Include specific module numbering.

RESPOND IN ${input.output_language === 'en' ? 'English' : 'Chinese (Simplified)'}.`;
}

/**
 * 构建 Logo 方向生成的用户消息
 */
export function buildDirectionUserMessage(input: SanbaoInput): string {
  const parts: string[] = [];

  parts.push(`为"${input.brand_name}"设计Logo创意方向。`);
  parts.push(`品牌简报: ${input.brief}`);

  if (input.audience) {
    parts.push(`目标受众: ${input.audience}`);
  }
  if (input.preferred_style) {
    parts.push(`偏好风格: ${input.preferred_style}`);
  }
  if (input.reference_style) {
    parts.push(`参考风格: ${input.reference_style}`);
  }
  if (input.revision_notes) {
    parts.push(`修订意见: ${input.revision_notes}`);
  }

  return parts.join('\n');
}

// ─── LLM 响应解析 ─────────────────────────────────────────────────

/**
 * 解析 LLM 响应为结构化 Logo 方向数据
 */
export function parseDirectionResponse(rawResponse: string): LogoDirectionResult {
  const direction = parseLogoDirection(rawResponse);
  const symbol = parseSymbolConcept(rawResponse);
  const visualNotes = parseVisualSystemNotes(rawResponse);
  const boardLayout = parseBrandSystemBoardLayout(rawResponse);

  return {
    direction,
    symbol,
    visualNotes,
    boardLayout,
    rawResponse,
  };
}

function parseLogoDirection(text: string): LogoDirection {
  const section = extractSection(text, 'Logo Direction');
  const colorPalette = extractColorPalette(section);

  return {
    positioning: extractLine(section, /positioning|定位/i) || extractFirstMeaningfulLine(section),
    visualMood: extractLine(section, /visual mood|视觉氛围|视觉调性/i) || 'Premium, timeless',
    colorPalette: colorPalette.length > 0 ? colorPalette : ['#1A1A1A', '#D4AF37', '#FAFAF5'],
    typography: extractLine(section, /typography|字体/i) || 'Refined serif or geometric sans',
    composition: extractLine(section, /composition|构图/i) || 'Centered, balanced, icon above wordmark',
    fitReason: extractLine(section, /why this direction|为什么|适配原因/i) || '',
  };
}

function parseSymbolConcept(text: string): SymbolConcept {
  const section = extractSection(text, 'Symbol Concept');

  const altRoutes: string[] = [];
  const altMatch = section.match(/alternative[^:]*:?\s*([\s\S]*?)(?=\n\n|\n#|$)/i);
  if (altMatch) {
    const routes = altMatch[1].split(/\n/).filter(l => l.trim().match(/^[-•*\d]/));
    routes.forEach(r => altRoutes.push(r.replace(/^[-•*\d.)\s]+/, '').trim()));
  }

  return {
    coreMetaphor: extractLine(section, /core metaphor|核心隐喻|核心概念/i) || extractFirstMeaningfulLine(section),
    iconForm: extractLine(section, /icon form|图标形式|图标形态/i) || 'Geometric symbol',
    negativeSpaceIdea: extractLine(section, /negative.space|负空间/i) || '',
    alternativeRoutes: altRoutes.length > 0 ? altRoutes : ['Minimalist geometric mark', 'Lettermark with symbol fusion'],
  };
}

function parseVisualSystemNotes(text: string): VisualSystemNotes {
  const section = extractSection(text, 'Visual System Notes');

  const lockups: string[] = [];
  const lockupMatch = section.match(/lockups?[^:]*:?\s*([\s\S]*?)(?=\n\n|\n#|$)/i);
  if (lockupMatch) {
    const items = lockupMatch[1].split(/\n/).filter(l => l.trim().match(/^[-•*\d]/));
    items.forEach(i => lockups.push(i.replace(/^[-•*\d.)\s]+/, '').trim()));
  }

  return {
    recommendedLockups: lockups.length > 0 ? lockups : ['Horizontal: symbol left of wordmark', 'Stacked: symbol above wordmark', 'Symbol-only'],
    oneColorBehavior: extractLine(section, /one.color|单色/i) || 'Works in pure black on white and reverse',
    smallSizeBehavior: extractLine(section, /small.size|小尺寸/i) || 'Symbol remains recognizable at 16px',
    usageNotes: extractLine(section, /usage|使用说明/i) || '',
  };
}

function parseBrandSystemBoardLayout(text: string): BrandSystemBoardLayout {
  const section = extractSection(text, 'Brand System Board Layout');

  const modules: string[] = [];
  const moduleMatches = section.matchAll(/module\s*(\d+)[:.\s]+([^\n]+)/gi);
  for (const m of moduleMatches) {
    modules.push(`${m[1]}. ${m[2].trim()}`);
  }
  if (modules.length === 0) {
    const cnMatches = section.matchAll(/模块\s*(\d+)[:：\s]+([^\n]+)/g);
    for (const m of cnMatches) {
      modules.push(`${m[1]}. ${m[2].trim()}`);
    }
  }

  const footerValues: string[] = [];
  const footerMatch = section.match(/footer[^:]*:?\s*([\s\S]*?)(?=\n\n|\n#|$)/i);
  if (footerMatch) {
    const items = footerMatch[1].split(/[,，、\n]/).filter(s => s.trim().length > 2);
    items.forEach(i => footerValues.push(i.trim()));
  }

  return {
    canvasSpec: extractLine(section, /canvas|square|画布/i) || 'Square canvas, ivory background, thin outer border, fine internal grid lines',
    modules: modules.length > 0 ? modules : [
      '1. MAIN LOGO: Large hero with symbol and wordmark',
      '2. FAVICON: Reduced standalone symbol',
      '3. SEAL VERSION: Circular seal/badge',
      '4. WORDMARK LOCKUP: Horizontal lockup with separator',
      '5. BLACK AND IVORY APPLICATIONS: Two application cards',
      '6. EDITORIAL COVER MOCKUP: Context mockup',
      '7. EMBOSSED PRINT APPLICATION: Debossed paper texture',
      '8. SYMBOL MEANING: Diagram with arrows and labels',
    ],
    footerValues: footerValues.length > 0 ? footerValues : ['OUR MISSION', 'OUR VIEW', 'OUR STANDARD', 'OUR PROMISE'],
    styleNotes: extractLine(section, /style|风格/i) || 'Mostly black and ivory, small deep red accent, generous whitespace, disciplined alignment',
  };
}

// ─── 辅助函数 ─────────────────────────────────────────────────

function extractSection(text: string, header: string): string {
  const regex = new RegExp(`^#\\s+${header}[\\s\\S]*?(?=^#\\s+|#\\s+Final|#\\s+Direct|$)`, 'mi');
  const match = text.match(regex);
  return match ? match[0] : text;
}

function extractLine(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  if (!match) return '';
  const lineRegex = new RegExp(`${match[0]}[^:]*[:：]\\s*([^\n]+)`, 'i');
  const lineMatch = text.match(lineRegex);
  return lineMatch ? lineMatch[1].trim() : '';
}

function extractFirstMeaningfulLine(text: string): string {
  const lines = text.split('\n').filter(l => l.trim().length > 10 && !l.trim().startsWith('#'));
  return lines.length > 0 ? lines[0].replace(/^[-•*\d.)\s]+/, '').trim() : '';
}

function extractColorPalette(text: string): string[] {
  const colors: string[] = [];
  const hexMatches = text.matchAll(/#[0-9A-Fa-f]{6}\b/g);
  for (const m of hexMatches) {
    if (!colors.includes(m[0])) colors.push(m[0]);
  }
  if (colors.length < 3) {
    const colorNames = ['black', 'ivory', 'white', 'gold', 'red', 'navy', 'charcoal', 'silver', 'cream', 'copper', 'bronze', 'emerald', 'sapphire', 'crimson'];
    const lower = text.toLowerCase();
    for (const name of colorNames) {
      if (lower.includes(name) && colors.length < 5) {
        colors.push(name);
      }
    }
  }
  return colors;
}

function getLogoTypeLabel(logoType?: string): string {
  const labels: Record<string, string> = {
    'company': 'company logo',
    'brand': 'brand logo',
    'product': 'product logo',
    'cultural-creative': 'cultural/creative merchandise logo',
    'campaign': 'campaign/advertising logo',
    'advertising': 'advertising logo',
    'event': 'event logo',
    'app': 'app logo',
    'sub-brand': 'sub-brand logo',
    'personal-brand': 'personal brand logo',
    'other': 'logo',
  };
  return labels[logoType || ''] || 'brand logo';
}
