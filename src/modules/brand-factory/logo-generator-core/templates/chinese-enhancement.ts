/**
 * 中文 Logo 增强层模板
 * 在 SanbaoAI Prompt Core 之上新增中文品牌名称保护和中文字标风格
 */

export interface ChineseTitleEnhancement {
  /** 中文字标风格 */
  chineseFontStyle: string;
  /** 中文布局策略 */
  layoutStrategy: string;
  /** 中文组合规则 */
  compositionRules: string[];
  /** 中文保护规则 */
  protectionRules: string[];
}

/**
 * 根据品牌调性和行业生成中文增强 Prompt 片段
 */
export function buildChineseTitlePrompt(
  chineseName: string,
  preferredStyle: string,
  industry?: string,
): string {
  if (!chineseName) return '';

  const fontMap: Record<string, string> = {
    '简约': 'Simplified Chinese sans-serif, clean strokes, modern geometric structure',
    '传统': 'Traditional Chinese calligraphy, elegant brush strokes, cultural heritage',
    '科技': 'Tech-oriented Chinese typeface, uniform stroke width, digital precision',
    '活泼': 'Playful Chinese typeface, rounded strokes, friendly personality',
    '高端': 'Premium Chinese serif, refined stroke contrast, sophisticated presence',
    '年轻': 'Youthful Chinese typeface, semi-bold weight, contemporary feel',
  };

  const layoutMap: Record<string, string> = {
    '简约': 'stacked vertical alignment, Chinese below English, balanced spacing',
    '传统': 'side-by-side horizontal, Chinese right of mark, traditional proportions',
    '科技': 'integrated horizontal, Chinese aligned baseline with English',
    '活泼': 'dynamic offset, Chinese at playful angle, energetic composition',
    '高端': 'centered stacked, Chinese prominent below mark, generous whitespace',
    '年轻': 'compact horizontal, Chinese left-aligned, modern asymmetric layout',
  };

  const style = preferredStyle || '简约';
  const fontDesc = fontMap[style] || fontMap['简约'];
  const layoutDesc = layoutMap[style] || layoutMap['简约'];

  return [
    `CHINESE TITLE INTEGRATION: The brand Chinese name "${chineseName}" must be rendered as an integral part of the logo design.`,
    `Chinese font style: ${fontDesc}.`,
    `Layout: ${layoutDesc}.`,
    `CRITICAL: Ensure Chinese characters are legible, well-proportioned, and harmonious with the symbol/wordmark.`,
    `Do NOT distort, stretch, or overlay the Chinese characters.`,
    `The Chinese title must be readable at small sizes (16px minimum).`,
    industry ? `Industry context (${industry}): choose appropriate stroke weight and character width accordingly.` : '',
  ].filter(Boolean).join('\n');
}

/**
 * 生成中文品牌名称保护规则
 */
export function buildChineseProtectionRules(chineseName: string): string[] {
  return [
    `中文字标"${chineseName}"必须保持完整，不可拆分单字使用`,
    `中文与英文/符号组合时，中文字号不得小于英文的 80%`,
    `深色背景上使用浅色中文，浅色背景上使用深色中文，确保可读性`,
    `中文字标最小尺寸：印刷 5mm，屏幕 16px`,
    `中文字标禁止拉伸、倾斜超过 5°、添加描边超过字重 10%`,
  ];
}
