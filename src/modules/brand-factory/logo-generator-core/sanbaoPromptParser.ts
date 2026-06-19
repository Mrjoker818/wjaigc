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
  positioningEn: string;
  visualMood: string;
  visualMoodEn: string;
  colorPalette: string[];
  typography: string;
  typographyEn: string;
  composition: string;
  compositionEn: string;
  fitReason: string;
  fitReasonEn: string;
}

export interface SymbolConcept {
  coreMetaphor: string;
  coreMetaphorEn: string;
  iconForm: string;
  iconFormEn: string;
  negativeSpaceIdea: string;
  negativeSpaceIdeaEn: string;
  alternativeRoutes: string[];
  alternativeRoutesEn: string[];
}

export interface VisualSystemNotes {
  recommendedLockups: string[];
  recommendedLockupsEn: string[];
  oneColorBehavior: string;
  oneColorBehaviorEn: string;
  smallSizeBehavior: string;
  smallSizeBehaviorEn: string;
  usageNotes: string;
  usageNotesEn: string;
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

OUTPUT FORMAT — respond with EXACTLY these sections in this order, using these exact markdown headers.
IMPORTANT: Provide EVERY field in BILINGUAL format — Chinese first, then English in parentheses.

# Logo Direction
Include: positioning (中英双语), visual mood (中英双语), color palette (list exactly 3-5 specific colors with hex codes + Chinese color name), typography (中英双语), composition (中英双语), and why this direction fits the logo type (中英双语).
Format example: "定位：高端奢华 (Premium luxury)" 

# Symbol Concept
Include: core metaphor (中英双语), icon form (中英双语), negative-space idea (中英双语), and 2-3 alternative symbolic routes (中英双语).

# Visual System Notes
Include: recommended lockups (中英双语), one-color behavior (中英双语), small-size behavior (中英双语), and usage notes for the relevant surfaces (中英双语).

# Brand System Board Layout
Describe the final brand-system-board image layout: square board grid on ivory background, module labels, main logo area, favicon, seal version, wordmark lockup, black/ivory applications, mockup, embossed application, symbol meaning, footer values, spacing, background, and one-color behavior. Include specific module numbering.

RESPOND IN CHINESE (Simplified) with English translation in parentheses for each key field.`;
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

  const positioning = extractLine(section, /positioning|定位/i) || extractFirstMeaningfulLine(section);
  const visualMood = extractLine(section, /visual mood|视觉氛围|视觉调性/i) || '高端奢华';
  const typography = extractLine(section, /typography|字体/i) || '精致衬线体或几何无衬线体';
  const composition = extractLine(section, /composition|构图/i) || '居中平衡，图标在文字上方';
  const fitReason = extractLine(section, /why this direction|为什么|适配原因/i) || '';

  return {
    positioning,
    positioningEn: extractEnglish(positioning),
    visualMood,
    visualMoodEn: extractEnglish(visualMood),
    colorPalette: colorPalette.length > 0 ? colorPalette : ['#1A1A1A', '#D4AF37', '#FAFAF5'],
    typography,
    typographyEn: extractEnglish(typography),
    composition,
    compositionEn: extractEnglish(composition),
    fitReason,
    fitReasonEn: extractEnglish(fitReason),
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
  const finalRoutes = altRoutes.length > 0 ? altRoutes : ['极简几何符号', '字母与图形融合'];

  const coreMetaphor = extractLine(section, /core metaphor|核心隐喻|核心概念/i) || extractFirstMeaningfulLine(section);
  const iconForm = extractLine(section, /icon form|图标形式|图标形态/i) || '几何符号';
  const negativeSpaceIdea = extractLine(section, /negative.space|负空间/i) || '';

  return {
    coreMetaphor,
    coreMetaphorEn: extractEnglish(coreMetaphor),
    iconForm,
    iconFormEn: extractEnglish(iconForm),
    negativeSpaceIdea,
    negativeSpaceIdeaEn: extractEnglish(negativeSpaceIdea),
    alternativeRoutes: finalRoutes,
    alternativeRoutesEn: finalRoutes.map(r => extractEnglish(r)),
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
  const finalLockups = lockups.length > 0 ? lockups : ['横排：符号在文字左侧', '竖排：符号在文字上方', '仅符号'];

  const oneColorBehavior = extractLine(section, /one.color|单色/i) || '纯黑白均可使用';
  const smallSizeBehavior = extractLine(section, /small.size|小尺寸/i) || '16px 下符号仍可辨识';
  const usageNotes = extractLine(section, /usage|使用说明/i) || '';

  return {
    recommendedLockups: finalLockups,
    recommendedLockupsEn: finalLockups.map(l => extractEnglish(l)),
    oneColorBehavior,
    oneColorBehaviorEn: extractEnglish(oneColorBehavior),
    smallSizeBehavior,
    smallSizeBehaviorEn: extractEnglish(smallSizeBehavior),
    usageNotes,
    usageNotesEn: extractEnglish(usageNotes),
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

/**
 * 从中英双语文本中提取英文部分
 * 支持格式："中文内容 (English content)" 或 "中文内容（English content）"
 * 如果没有英文部分则返回原文
 */
function extractEnglish(text: string): string {
  if (!text) return '';
  // Match content inside (parentheses) or （full-width parentheses）
  const match = text.match(/[（(]([^(）)]+)[）)]/);
  if (match) {
    const inner = match[1].trim();
    // Check if the content looks like English (contains Latin letters)
    if (/[a-zA-Z]{2,}/.test(inner)) {
      return inner;
    }
  }
  // If no parentheses, check if text itself is mostly English
  if (/^[a-zA-Z0-9\s,.\-':;!?/()]+$/.test(text)) {
    return text;
  }
  return text;
}
