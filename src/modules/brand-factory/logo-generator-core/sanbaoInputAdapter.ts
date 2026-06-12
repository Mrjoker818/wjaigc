/**
 * SanbaoAI Input Adapter
 * 将无界AI品牌工厂的 BrandProject 字段转换为 SanbaoAI input-schema 格式
 */

/** SanbaoAI input-schema 输入类型 */
export interface SanbaoInput {
  brand_name: string;
  logo_type?: string;
  brief: string;
  audience?: string;
  preferred_style?: string;
  reference_style?: string;
  output_layout?: 'brand-system-board' | 'identity-board' | 'standalone-logo' | 'square-avatar' | 'transparent-asset';
  target_platform?: 'gpt-image' | 'midjourney' | 'flux' | 'ideogram' | 'all';
  render_image?: boolean;
  revision_notes?: string;
  output_language?: 'zh-CN' | 'en';
}

/** 无界AI品牌项目类型（精简版，用于适配） */
export interface WujieBrandProject {
  brandName: string;
  industry?: string;
  projectType?: string;
  description?: string;
  targetAudience?: string;
  tone?: string;
  keywords?: string[];
  logoUrl?: string;
  referenceUrls?: string[];
  brandDna?: {
    brandKeywords?: string[];
    mainColors?: string[];
    secondaryColors?: string[];
    fontStyle?: string;
    visualTone?: string;
    logoRules?: string[];
    forbiddenRules?: string[];
  } | null;
}

/** Logo 类型映射：项目类型 → SanbaoAI logo_type */
const PROJECT_TYPE_TO_LOGO_TYPE: Record<string, string> = {
  '品牌升级': 'brand',
  '品牌焕新': 'brand',
  '品牌重塑': 'brand',
  '新品上市': 'product',
  '品牌延伸': 'sub-brand',
  'IP打造': 'cultural-creative',
  '节日营销': 'campaign',
  '活动推广': 'event',
};

/** 行业 → 风格建议映射 */
const INDUSTRY_STYLE_HINT: Record<string, string> = {
  '科技互联网': 'tech, modern, minimal',
  '餐饮美食': 'warm, inviting, organic',
  '美妆个护': 'luxury, elegant, refined',
  '潮玩IP': 'playful, bold, expressive',
  '文旅地产': 'heritage, premium, timeless',
  '服饰鞋包': 'fashion-forward, editorial',
  '汽车出行': 'dynamic, precise, modern',
  '金融理财': 'corporate, trustworthy, stable',
  '酒水饮料': 'premium, celebratory, crafted',
};

/**
 * 将无界AI品牌项目转换为 SanbaoAI 输入格式
 */
export function adaptBrandProjectToSanbaoInput(
  project: WujieBrandProject,
  options?: {
    outputLayout?: SanbaoInput['output_layout'];
    targetPlatform?: SanbaoInput['target_platform'];
    revisionNotes?: string;
    renderImage?: boolean;
  }
): SanbaoInput {
  // 1. 确定 logo_type
  const logoType = PROJECT_TYPE_TO_LOGO_TYPE[project.projectType || ''] || inferLogoType(project);

  // 2. 构建 brief（品牌描述 + 行业 + 关键词 + DNA 规则）
  const briefParts: string[] = [];
  if (project.description) {
    briefParts.push(project.description);
  }
  if (project.industry) {
    briefParts.push(`行业: ${project.industry}`);
  }
  if (project.keywords && project.keywords.length > 0) {
    briefParts.push(`品牌关键词: ${project.keywords.join('、')}`);
  }
  if (project.brandDna) {
    if (project.brandDna.brandKeywords && project.brandDna.brandKeywords.length > 0) {
      briefParts.push(`DNA关键词: ${project.brandDna.brandKeywords.join('、')}`);
    }
    if (project.brandDna.visualTone) {
      briefParts.push(`视觉调性: ${project.brandDna.visualTone}`);
    }
    if (project.brandDna.logoRules && project.brandDna.logoRules.length > 0) {
      briefParts.push(`Logo规则: ${project.brandDna.logoRules.join('；')}`);
    }
    if (project.brandDna.forbiddenRules && project.brandDna.forbiddenRules.length > 0) {
      briefParts.push(`禁区规则: ${project.brandDna.forbiddenRules.join('；')}`);
    }
  }
  const brief = briefParts.join('\n') || `${project.brandName}的品牌Logo设计`;

  // 3. 构建风格偏好
  const styleParts: string[] = [];
  if (project.tone) {
    styleParts.push(project.tone);
  }
  if (project.industry && INDUSTRY_STYLE_HINT[project.industry]) {
    styleParts.push(INDUSTRY_STYLE_HINT[project.industry]);
  }
  if (project.brandDna?.fontStyle) {
    styleParts.push(`字体风格: ${project.brandDna.fontStyle}`);
  }
  const preferredStyle = styleParts.length > 0 ? styleParts.join(', ') : undefined;

  // 4. 构建参考风格描述
  const refParts: string[] = [];
  if (project.brandDna?.mainColors && project.brandDna.mainColors.length > 0) {
    refParts.push(`主色: ${project.brandDna.mainColors.join(', ')}`);
  }
  if (project.brandDna?.secondaryColors && project.brandDna.secondaryColors.length > 0) {
    refParts.push(`辅助色: ${project.brandDna.secondaryColors.join(', ')}`);
  }
  const referenceStyle = refParts.length > 0 ? refParts.join('; ') : undefined;

  return {
    brand_name: project.brandName,
    logo_type: logoType as SanbaoInput['logo_type'],
    brief,
    audience: project.targetAudience || undefined,
    preferred_style: preferredStyle,
    reference_style: referenceStyle,
    output_layout: options?.outputLayout || 'brand-system-board',
    target_platform: options?.targetPlatform || 'all',
    render_image: options?.renderImage ?? false,
    revision_notes: options?.revisionNotes || undefined,
    output_language: 'zh-CN',
  };
}

/**
 * 从用户直接输入构建 SanbaoAI 输入
 */
export function buildSanbaoInputFromUserInput(params: {
  brandName: string;
  brief: string;
  logoType?: string;
  audience?: string;
  preferredStyle?: string;
  referenceStyle?: string;
  outputLayout?: SanbaoInput['output_layout'];
  targetPlatform?: SanbaoInput['target_platform'];
  renderImage?: boolean;
  revisionNotes?: string;
}): SanbaoInput {
  return {
    brand_name: params.brandName,
    logo_type: params.logoType as SanbaoInput['logo_type'],
    brief: params.brief,
    audience: params.audience || undefined,
    preferred_style: params.preferredStyle || undefined,
    reference_style: params.referenceStyle || undefined,
    output_layout: params.outputLayout || 'brand-system-board',
    target_platform: params.targetPlatform || 'all',
    render_image: params.renderImage ?? false,
    revision_notes: params.revisionNotes || undefined,
    output_language: 'zh-CN',
  };
}

/**
 * 推断 logo_type
 */
function inferLogoType(project: WujieBrandProject): string {
  const desc = `${project.projectType || ''} ${project.industry || ''} ${project.description || ''}`.toLowerCase();

  if (desc.includes('app') || desc.includes('应用')) return 'app';
  if (desc.includes('活动') || desc.includes('campaign')) return 'campaign';
  if (desc.includes('产品') || desc.includes('新品')) return 'product';
  if (desc.includes('ip') || desc.includes('文创') || desc.includes('潮玩')) return 'cultural-creative';
  if (desc.includes('子品牌') || desc.includes('延伸')) return 'sub-brand';
  if (desc.includes('个人') || desc.includes('创始人')) return 'personal-brand';

  return 'brand';
}
