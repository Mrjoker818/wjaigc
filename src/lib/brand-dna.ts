/**
 * BrandDNA - 品牌资产系统性沉淀模块
 * 
 * 核心能力：
 * 1. 品牌DNA结构化定义（色彩/字体/调性/禁区规则）
 * 2. @品牌引用注入 systemPrompt
 * 3. 品牌色彩/字体自动应用到生成参数
 * 4. 品牌一致性检查与评分
 */

// ========== BrandDNA 类型定义 ==========

export interface BrandColorPalette {
  /** 主品牌色 */
  primary: string;
  /** 辅助品牌色 */
  secondary: string;
  /** 强调色/点缀色 */
  accent: string;
  /** 背景色 */
  background: string;
  /** 主文字色 */
  text: string;
  /** 品牌色心理含义（可选） */
  primaryMeaning?: string;
  secondaryMeaning?: string;
}

export interface BrandTypography {
  /** 主字体（标题用） */
  primaryFont: string;
  /** 辅字体（正文用） */
  secondaryFont: string;
  /** 字体风格分类 */
  style: 'serif' | 'sans-serif' | 'display' | 'handwriting' | 'monospace' | 'mixed';
  /** 字重范围 */
  weightRange: [number, number]; // e.g., [400, 700]
  /** 行高偏好 */
  lineHeight: 'compact' | 'normal' | 'relaxed';
}

export interface BrandVoice {
  /** 品牌调性关键词 */
  toneKeywords: string[];
  /** 品牌个性描述 */
  personality: string;
  /** 文案风格 */
  writingStyle: 'formal' | 'casual' | 'playful' | 'professional' | 'inspirational' | 'minimal';
  /** 禁用词汇 */
  prohibitedWords: string[];
  /** 推荐词汇 */
  recommendedWords: string[];
}

export interface BrandConstraints {
  /** 禁止使用的颜色 */
  prohibitedColors: string[];
  /** 禁止使用的风格 */
  prohibitedStyles: string[];
  /** 禁止出现的元素 */
  prohibitedElements: string[];
  /** Logo安全区域（边距） */
  logoSafeMargin: number;
  /** 最小Logo尺寸 */
  minLogoSize: number;
}

export interface BrandVisualStyle {
  /** 视觉风格关键词 */
  styleKeywords: string[];
  /** 参考图片URL */
  referenceImages: string[];
  /** 构图偏好 */
  compositionPreference: 'centered' | 'asymmetric' | 'dynamic' | 'minimal' | 'layered';
  /** 光影风格 */
  lightingStyle: 'soft' | 'dramatic' | 'natural' | 'studio' | 'mixed';
  /** 质感偏好 */
  texturePreference: 'smooth' | 'grainy' | 'glossy' | 'matte' | 'mixed';
}

export interface BrandIndustryInfo {
  /** 行业类型 */
  industry: string;
  /** 子行业/细分 */
  subIndustry?: string;
  /** 目标受众 */
  targetAudience: string[];
  /** 品牌定位 */
  positioning: 'premium' | 'mass-market' | 'niche' | 'lifestyle' | 'professional';
}

export interface BrandDNA {
  /** 品牌ID */
  id: string;
  /** 品牌名称 */
  name: string;
  /** 品牌描述 */
  description?: string;
  /** Logo URL */
  logo?: string;
  /** 色彩体系 */
  colors: BrandColorPalette;
  /** 字体体系 */
  typography: BrandTypography;
  /** 品牌调性 */
  voice: BrandVoice;
  /** 禁区规则 */
  constraints: BrandConstraints;
  /** 视觉风格 */
  visualStyle: BrandVisualStyle;
  /** 行业信息 */
  industryInfo: BrandIndustryInfo;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 品牌DNA摘要（AI生成的完整描述） */
  dnaSummary?: string;
}

// ========== 默认品牌DNA模板 ==========

export const DEFAULT_BRAND_DNA: Partial<BrandDNA> = {
  colors: {
    primary: '#1a1a2e',
    secondary: '#16213e',
    accent: '#d4af37',
    background: '#ffffff',
    text: '#1a1a1a',
  },
  typography: {
    primaryFont: 'Inter',
    secondaryFont: 'Inter',
    style: 'sans-serif',
    weightRange: [400, 700],
    lineHeight: 'normal',
  },
  voice: {
    toneKeywords: ['专业', '现代', '简洁'],
    personality: '现代专业品牌',
    writingStyle: 'professional',
    prohibitedWords: ['廉价', '低端', '山寨'],
    recommendedWords: ['高品质', '创新', '精致'],
  },
  constraints: {
    prohibitedColors: ['#FF0000', '#00FF00'], // 禁止纯红纯绿
    prohibitedStyles: ['卡通', '幼稚', '廉价感'],
    prohibitedElements: ['水印', '二维码'],
    logoSafeMargin: 10,
    minLogoSize: 50,
  },
  visualStyle: {
    styleKeywords: ['现代', '简约', '专业'],
    referenceImages: [],
    compositionPreference: 'centered',
    lightingStyle: 'soft',
    texturePreference: 'smooth',
  },
  industryInfo: {
    industry: '科技',
    targetAudience: ['专业人士', '年轻白领'],
    positioning: 'premium',
  },
};

// ========== BrandDNA SystemPrompt 生成 ==========

/**
 * 生成品牌注入的 SystemPrompt 片段
 * 用于 @品牌 引用时自动注入到生成请求
 */
export function generateBrandSystemPrompt(brand: BrandDNA): string {
  const sections: string[] = [];
  
  // 品牌基本信息
  sections.push(`【品牌身份】
品牌名称：${brand.name}
${brand.description ? `品牌描述：${brand.description}` : ''}
${brand.dnaSummary ? `品牌DNA：${brand.dnaSummary}` : ''}`);

  // 色彩体系
  sections.push(`【品牌色彩体系】
主色：${brand.colors.primary}${brand.colors.primaryMeaning ? ` (${brand.colors.primaryMeaning})` : ''}
辅助色：${brand.colors.secondary}${brand.colors.secondaryMeaning ? ` (${brand.colors.secondaryMeaning})` : ''}
强调色：${brand.colors.accent}
背景色：${brand.colors.background}
文字色：${brand.colors.text}
禁止使用：${brand.constraints.prohibitedColors.join('、')}`);

  // 字体体系
  sections.push(`【品牌字体体系】
主字体：${brand.typography.primaryFont}
辅助字体：${brand.typography.secondaryFont}
风格：${brand.typography.style}
字重范围：${brand.typography.weightRange[0]}-${brand.typography.weightRange[1]}`);

  // 视觉风格
  sections.push(`【品牌视觉风格】
风格关键词：${brand.visualStyle.styleKeywords.join('、')}
构图偏好：${brand.visualStyle.compositionPreference}
光影风格：${brand.visualStyle.lightingStyle}
质感偏好：${brand.visualStyle.texturePreference}
禁止风格：${brand.constraints.prohibitedStyles.join('、')}
禁止元素：${brand.constraints.prohibitedElements.join('、')}`);

  // 品牌调性
  sections.push(`【品牌调性与文案】
调性关键词：${brand.voice.toneKeywords.join('、')}
品牌个性：${brand.voice.personality}
文案风格：${brand.voice.writingStyle}
推荐词汇：${brand.voice.recommendedWords.join('、')}
禁用词汇：${brand.voice.prohibitedWords.join('、')}`);

  // 行业信息
  sections.push(`【行业与受众】
行业：${brand.industryInfo.industry}${brand.industryInfo.subIndustry ? ` / ${brand.industryInfo.subIndustry}` : ''}
目标受众：${brand.industryInfo.targetAudience.join('、')}
品牌定位：${brand.industryInfo.positioning}`);

  // 一致性规则
  sections.push(`【品牌一致性规则】
1. 保持品牌色彩体系一致，禁止使用禁止色
2. 文字风格需符合品牌调性
3. 视觉风格需遵循品牌视觉指南
4. Logo使用需遵守安全边距（${brand.constraints.logoSafeMargin}px）和最小尺寸（${brand.constraints.minLogoSize}px）
5. 生成内容需符合目标受众审美`);

  return sections.join('\n\n');
}

// ========== BrandDNA 提示词增强 ==========

/**
 * 将 BrandDNA 注入到生成提示词中
 * 用于图像生成、视频生成等场景
 */
export function enhancePromptWithBrand(prompt: string, brand: BrandDNA): string {
  const brandPrefix: string[] = [];
  
  // 色彩注入
  brandPrefix.push(`色彩风格：以${brand.colors.primary}为主色，${brand.colors.secondary}为辅助色`);
  
  // 视觉风格注入
  if (brand.visualStyle.styleKeywords.length > 0) {
    brandPrefix.push(`视觉风格：${brand.visualStyle.styleKeywords.join('、')}`);
  }
  
  // 构图注入
  brandPrefix.push(`构图：${brand.visualStyle.compositionPreference}构图`);
  
  // 光影注入
  brandPrefix.push(`光影：${brand.visualStyle.lightingStyle}光效`);
  
  // 禁区提醒
  if (brand.constraints.prohibitedStyles.length > 0) {
    brandPrefix.push(`避免：${brand.constraints.prohibitedStyles.join('、')}风格`);
  }
  
  return `${brandPrefix.join('，')}。${prompt}`;
}

/**
 * 将 BrandDNA 注入到视频生成提示词中
 */
export function enhanceVideoPromptWithBrand(prompt: string, brand: BrandDNA): string {
  const enhancements: string[] = [];
  
  // 色彩
  enhancements.push(`画面色调遵循品牌色彩体系（${brand.colors.primary}主色系）`);
  
  // 视觉风格
  if (brand.visualStyle.styleKeywords.length > 0) {
    enhancements.push(`整体视觉风格${brand.visualStyle.styleKeywords.join('、')}`);
  }
  
  // 光影
  enhancements.push(`${brand.visualStyle.lightingStyle}光影效果`);
  
  // 调性
  enhancements.push(`符合${brand.voice.toneKeywords.slice(0, 3).join('、')}调性`);
  
  return `${prompt}，${enhancements.join('，')}`;
}

// ========== BrandDNA 一致性检查 ==========

export interface ConsistencyCheckResult {
  score: number; // 0-100
  issues: {
    type: 'color' | 'style' | 'tone' | 'composition' | 'element';
    severity: 'high' | 'medium' | 'low';
    description: string;
    suggestion: string;
  }[];
  passed: boolean;
}

/**
 * 检查生成内容与 BrandDNA 的一致性
 * 用于生成后质量检查
 */
export function checkBrandConsistency(
  generatedContent: {
    colors?: string[];
    styleKeywords?: string[];
    toneKeywords?: string[];
    composition?: string;
    elements?: string[];
  },
  brand: BrandDNA
): ConsistencyCheckResult {
  const issues: ConsistencyCheckResult['issues'] = [];
  let score = 100;
  
  // 色彩检查
  if (generatedContent.colors) {
    for (const color of generatedContent.colors) {
      if (brand.constraints.prohibitedColors.some(pc => 
        color.toLowerCase().includes(pc.toLowerCase())
      )) {
        issues.push({
          type: 'color',
          severity: 'high',
          description: `使用了禁止色 ${color}`,
          suggestion: `替换为品牌色 ${brand.colors.primary} 或 ${brand.colors.secondary}`,
        });
        score -= 20;
      }
    }
  }
  
  // 风格检查
  if (generatedContent.styleKeywords) {
    for (const style of generatedContent.styleKeywords) {
      if (brand.constraints.prohibitedStyles.some(ps => 
        style.includes(ps)
      )) {
        issues.push({
          type: 'style',
          severity: 'high',
          description: `包含禁止风格 ${style}`,
          suggestion: `调整为 ${brand.visualStyle.styleKeywords[0]} 风格`,
        });
        score -= 15;
      }
    }
  }
  
  // 调性检查
  if (generatedContent.toneKeywords) {
    const hasBrandTone = generatedContent.toneKeywords.some(tk => 
      brand.voice.toneKeywords.includes(tk)
    );
    if (!hasBrandTone && brand.voice.toneKeywords.length > 0) {
      issues.push({
        type: 'tone',
        severity: 'medium',
        description: '调性与品牌不一致',
        suggestion: `增加 ${brand.voice.toneKeywords.slice(0, 2).join('或')} 调性`,
      });
      score -= 10;
    }
  }
  
  // 构图检查
  if (generatedContent.composition && brand.visualStyle.compositionPreference) {
    if (!generatedContent.composition.includes(brand.visualStyle.compositionPreference)) {
      issues.push({
        type: 'composition',
        severity: 'low',
        description: '构图未遵循品牌偏好',
        suggestion: `采用 ${brand.visualStyle.compositionPreference} 构图`,
      });
      score -= 5;
    }
  }
  
  // 元素检查
  if (generatedContent.elements) {
    for (const element of generatedContent.elements) {
      if (brand.constraints.prohibitedElements.some(pe => 
        element.includes(pe)
      )) {
        issues.push({
          type: 'element',
          severity: 'high',
          description: `包含禁止元素 ${element}`,
          suggestion: '移除该元素',
        });
        score -= 15;
      }
    }
  }
  
  return {
    score: Math.max(0, score),
    issues,
    passed: score >= 70,
  };
}

// ========== BrandDNA 存储 ==========

const BRAND_DNA_STORAGE_KEY = 'wujie_brand_dna_registry';

/**
 * 保存 BrandDNA 到 localStorage
 */
export function saveBrandDNA(brand: BrandDNA): void {
  const registry = loadBrandDNARegistry();
  const existingIndex = registry.findIndex(b => b.id === brand.id);
  
  if (existingIndex >= 0) {
    registry[existingIndex] = { ...brand, updatedAt: Date.now() };
  } else {
    registry.push({ ...brand, createdAt: Date.now(), updatedAt: Date.now() });
  }
  
  localStorage.setItem(BRAND_DNA_STORAGE_KEY, JSON.stringify(registry));
}

/**
 * 加载所有 BrandDNA
 */
export function loadBrandDNARegistry(): BrandDNA[] {
  try {
    const data = localStorage.getItem(BRAND_DNA_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * 删除 BrandDNA
 */
export function deleteBrandDNA(brandId: string): void {
  const registry = loadBrandDNARegistry();
  const filtered = registry.filter(b => b.id !== brandId);
  localStorage.setItem(BRAND_DNA_STORAGE_KEY, JSON.stringify(filtered));
}

/**
 * 获取单个 BrandDNA
 */
export function getBrandDNA(brandId: string): BrandDNA | null {
  const registry = loadBrandDNARegistry();
  return registry.find(b => b.id === brandId) || null;
}

// ========== 从 BrandKit 转换为 BrandDNA ==========

/**
 * 将现有的 BrandKit 格式转换为完整的 BrandDNA
 */
export function convertBrandKitToDNA(brandKit: {
  id: string;
  name: string;
  description?: string;
  logo?: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  fontStyle: 'serif' | 'sans-serif' | 'display' | 'handwriting' | 'monospace';
  styleKeywords: string[];
  referenceImages: string[];
  brandDna?: string;
  industry?: string;
  mood?: string;
}): BrandDNA {
  return {
    id: brandKit.id,
    name: brandKit.name,
    description: brandKit.description,
    logo: brandKit.logo,
    colors: {
      primary: brandKit.colors.primary,
      secondary: brandKit.colors.secondary,
      accent: brandKit.colors.accent,
      background: brandKit.colors.background,
      text: brandKit.colors.text,
    },
    typography: {
      primaryFont: 'Inter',
      secondaryFont: 'Inter',
      style: brandKit.fontStyle,
      weightRange: [400, 700],
      lineHeight: 'normal',
    },
    voice: {
      toneKeywords: brandKit.styleKeywords.slice(0, 5),
      personality: brandKit.name,
      writingStyle: 'professional',
      prohibitedWords: [],
      recommendedWords: [],
    },
    constraints: {
      prohibitedColors: [],
      prohibitedStyles: [],
      prohibitedElements: [],
      logoSafeMargin: 10,
      minLogoSize: 50,
    },
    visualStyle: {
      styleKeywords: brandKit.styleKeywords,
      referenceImages: brandKit.referenceImages,
      compositionPreference: 'centered',
      lightingStyle: 'soft',
      texturePreference: 'smooth',
    },
    industryInfo: {
      industry: brandKit.industry || '通用',
      targetAudience: [],
      positioning: 'premium',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dnaSummary: brandKit.brandDna,
  };
}

// ========== AI 生成的 BrandDNA 摘要 ==========

/**
 * 使用 LLM 生成品牌 DNA 摘要
 * 用于品牌创建后的系统性总结
 */
export async function generateBrandDNASummary(
  brand: BrandDNA,
  llmApiEndpoint: string,
  llmApiKey: string
): Promise<string> {
  const prompt = `请根据以下品牌信息，生成一段完整的品牌DNA摘要（100-200字）：
品牌名称：${brand.name}
${brand.description ? `品牌描述：${brand.description}` : ''}
色彩体系：主色${brand.colors.primary}、辅助色${brand.colors.secondary}
字体风格：${brand.typography.style}
视觉风格：${brand.visualStyle.styleKeywords.join('、')}
调性：${brand.voice.toneKeywords.join('、')}
行业：${brand.industryInfo.industry}
定位：${brand.industryInfo.positioning}
请直接输出摘要。`;

  try {
    const response = await fetch(llmApiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      }),
    });
    
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (error) {
    console.error('生成品牌DNA摘要失败:', error);
    return '';
  }
}

export default BrandDNA;