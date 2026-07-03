/**
 * StyleDNA - 风格一致性系统
 * 确保同一会话中的生成结果风格一致，解决Lovart Style Consistency的核心差距
 */

import type { CanvasImage } from '@/lib/user-types';

// ============ 类型定义 ============

/**
 * 风格DNA数据结构
 * 包含颜色、字体、质感、构图等风格要素
 */
export interface StyleDNA {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  
  // 核心风格要素
  elements: {
    // 色彩体系
    colors: {
      primary: string;          // 主色调 (hex或描述)
      secondary: string;        // 次色调
      accent: string;           // 强调色
      palette: string[];        // 色板 (最多5色)
      mood: string;             // 色彩情绪 (warm/cool/neutral/vibrant)
    };
    
    // 视觉风格
    visual: {
      style: string;            // 核心风格词 (minimalist/maximalist/realistic/abstract等)
      subStyles: string[];      // 子风格标签 (水彩/赛博朋克/日系等)
      texture: string;          // 质感 (smooth/grainy/glossy/matte)
      lighting: string;         // 光照 (soft/hard/dramatic/natural)
      contrast: string;         // 对比度 (high/medium/low)
    };
    
    // 构图偏好
    composition: {
      layout: string;           // 布局类型 (centered/asymmetric/dynamic/static)
      spacing: string;          // 间距风格 (tight/balanced/spacious)
      focus: string;            // 焦点位置 (center/off-center/multiple)
      depth: string;            // 空间感 (flat/layered/3D)
    };
    
    // 细节特征
    details: {
      lineWeight: string;       // 线条粗细 (thin/medium/thick/varied)
      edgeStyle: string;        // 边缘风格 (sharp/soft/gradient)
      patternDensity: string;   // 图案密度 (sparse/moderate/dense)
      ornamentLevel: string;    // 装饰程度 (minimal/moderate/elaborate)
    };
  };
  
  // 参考图片
  referenceImages: string[];
  
  // 风格关键词（用于提示词增强）
  styleKeywords: string[];
  negativeKeywords: string[];
  
  // 元数据
  metadata: {
    source: 'template' | 'ai_extracted' | 'user_defined' | 'image_analyzed';
    templateId?: string;
    confidence: number;         // AI分析置信度 0-1
    extractedAt?: number;
  };
}

/**
 * 风格模板
 */
export interface StyleTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  dna: {
    elements: Partial<StyleDNA['elements']>;
    styleKeywords: string[];
    negativeKeywords: string[];
  };
}

// ============ 预设风格模板库 ============

export const STYLE_TEMPLATES: StyleTemplate[] = [
  {
    id: 'minimal-clean',
    name: '极简纯净',
    category: 'minimal',
    description: '简洁、留白、低饱和度、现代感',
    dna: {
      elements: {
        colors: { mood: 'neutral', primary: '#F5F5F5', secondary: '#333333', accent: '#888888', palette: ['#F5F5F5', '#333333', '#888888', '#FFFFFF', '#CCCCCC'] },
        visual: { style: 'minimalist', subStyles: ['modern', 'clean'], texture: 'smooth', lighting: 'soft', contrast: 'low' },
        composition: { layout: 'centered', spacing: 'spacious', focus: 'center', depth: 'flat' },
        details: { lineWeight: 'thin', edgeStyle: 'sharp', patternDensity: 'sparse', ornamentLevel: 'minimal' },
      },
      styleKeywords: ['minimal', 'clean', 'simple', 'modern', 'elegant', 'white space', 'uncluttered'],
      negativeKeywords: ['cluttered', 'busy', 'ornate', 'complex', 'vibrant colors'],
    },
  },
  {
    id: 'cinematic-moody',
    name: '电影质感',
    category: 'cinematic',
    description: '戏剧性光照、高对比度、情绪化、电影感',
    dna: {
      elements: {
        colors: { mood: 'cool', primary: '#1A1A2E', secondary: '#16213E', accent: '#E94560', palette: ['#1A1A2E', '#16213E', '#E94560', '#0F3460', '#533A71'] },
        visual: { style: 'cinematic', subStyles: ['film', 'dramatic'], texture: 'grainy', lighting: 'dramatic', contrast: 'high' },
        composition: { layout: 'dynamic', spacing: 'tight', focus: 'off-center', depth: 'layered' },
        details: { lineWeight: 'varied', edgeStyle: 'soft', patternDensity: 'moderate', ornamentLevel: 'moderate' },
      },
      styleKeywords: ['cinematic', 'moody', 'dramatic lighting', 'film look', 'atmospheric', 'deep shadows', 'movie poster'],
      negativeKeywords: ['bright', 'flat lighting', 'cartoon', 'anime', 'illustration'],
    },
  },
  {
    id: 'watercolor-soft',
    name: '水彩柔美',
    category: 'artistic',
    description: '水彩效果、柔和边缘、透明感、艺术性',
    dna: {
      elements: {
        colors: { mood: 'warm', primary: '#FFE4C4', secondary: '#DEB887', accent: '#87CEEB', palette: ['#FFE4C4', '#DEB887', '#87CEEB', '#F5DEB3', '#FAEBD7'] },
        visual: { style: 'watercolor', subStyles: ['artistic', 'painting'], texture: 'grainy', lighting: 'soft', contrast: 'low' },
        composition: { layout: 'asymmetric', spacing: 'balanced', focus: 'off-center', depth: 'flat' },
        details: { lineWeight: 'thin', edgeStyle: 'gradient', patternDensity: 'sparse', ornamentLevel: 'minimal' },
      },
      styleKeywords: ['watercolor', 'soft edges', 'transparent', 'painting', 'artistic', 'flowing', 'delicate', 'pastel'],
      negativeKeywords: ['sharp edges', 'digital', 'hard lines', 'solid colors', '3D render'],
    },
  },
  {
    id: 'cyberpunk-neon',
    name: '赛博朋克',
    category: 'maximal',
    description: '霓虹灯光、高对比、科技感、未来城市',
    dna: {
      elements: {
        colors: { mood: 'vibrant', primary: '#FF00FF', secondary: '#00FFFF', accent: '#FFFF00', palette: ['#FF00FF', '#00FFFF', '#FFFF00', '#FF6B6B', '#4ECDC4'] },
        visual: { style: 'cyberpunk', subStyles: ['neon', 'futuristic'], texture: 'glossy', lighting: 'hard', contrast: 'high' },
        composition: { layout: 'dynamic', spacing: 'tight', focus: 'multiple', depth: '3D' },
        details: { lineWeight: 'medium', edgeStyle: 'sharp', patternDensity: 'dense', ornamentLevel: 'elaborate' },
      },
      styleKeywords: ['cyberpunk', 'neon lights', 'futuristic', 'glowing', 'tech', 'urban night', 'blade runner style', 'holographic'],
      negativeKeywords: ['natural lighting', 'rustic', 'traditional', 'soft', 'pastel'],
    },
  },
  {
    id: 'japanese-clean',
    name: '日系清新',
    category: 'artistic',
    description: '日系风格、清新淡雅、柔和光影、自然感',
    dna: {
      elements: {
        colors: { mood: 'warm', primary: '#FFF5EE', secondary: '#FAEBD7', accent: '#87CEEB', palette: ['#FFF5EE', '#FAEBD7', '#87CEEB', '#F0FFF0', '#E6E6FA'] },
        visual: { style: 'japanese', subStyles: ['zen', 'natural'], texture: 'smooth', lighting: 'natural', contrast: 'medium' },
        composition: { layout: 'balanced', spacing: 'balanced', focus: 'center', depth: 'flat' },
        details: { lineWeight: 'thin', edgeStyle: 'soft', patternDensity: 'sparse', ornamentLevel: 'minimal' },
      },
      styleKeywords: ['japanese style', 'clean', 'soft lighting', 'pastel colors', 'serene', 'zen', 'minimalist asian', 'natural'],
      negativeKeywords: ['dark', 'gritty', 'western', 'bold colors', 'complex patterns'],
    },
  },
  {
    id: 'commercial-product',
    name: '商业产品',
    category: 'commercial',
    description: '产品摄影风格、高质感、专业商业感',
    dna: {
      elements: {
        colors: { mood: 'neutral', primary: '#FFFFFF', secondary: '#F0F0F0', accent: '#333333', palette: ['#FFFFFF', '#F0F0F0', '#333333', '#E0E0E0', '#CCCCCC'] },
        visual: { style: 'product photography', subStyles: ['professional', 'studio'], texture: 'glossy', lighting: 'soft', contrast: 'medium' },
        composition: { layout: 'centered', spacing: 'balanced', focus: 'center', depth: '3D' },
        details: { lineWeight: 'medium', edgeStyle: 'sharp', patternDensity: 'sparse', ornamentLevel: 'minimal' },
      },
      styleKeywords: ['product photography', 'professional', 'studio lighting', 'clean background', 'high quality', 'commercial', 'catalog'],
      negativeKeywords: ['casual', 'snapshot', 'amateur', 'cluttered background', 'low quality'],
    },
  },
  {
    id: 'vintage-retro',
    name: '复古怀旧',
    category: 'artistic',
    description: '复古风格、怀旧质感、暖色调、年代感',
    dna: {
      elements: {
        colors: { mood: 'warm', primary: '#D2691E', secondary: '#8B4513', accent: '#FFD700', palette: ['#D2691E', '#8B4513', '#FFD700', '#CD853F', '#A0522D'] },
        visual: { style: 'vintage', subStyles: ['retro', 'nostalgic'], texture: 'grainy', lighting: 'soft', contrast: 'medium' },
        composition: { layout: 'centered', spacing: 'balanced', focus: 'center', depth: 'flat' },
        details: { lineWeight: 'varied', edgeStyle: 'soft', patternDensity: 'moderate', ornamentLevel: 'moderate' },
      },
      styleKeywords: ['vintage', 'retro', 'nostalgic', 'film grain', 'warm tones', 'classic', 'aged', 'antique feel'],
      negativeKeywords: ['modern', 'digital', 'sharp', 'clean', 'futuristic'],
    },
  },
  {
    id: '3d-realistic',
    name: '3D写实',
    category: 'realistic',
    description: '3D渲染风格、高写实度、精细建模、材质真实',
    dna: {
      elements: {
        colors: { mood: 'neutral', primary: '#808080', secondary: '#404040', accent: '#C0C0C0', palette: ['#808080', '#404040', '#C0C0C0', '#A0A0A0', '#606060'] },
        visual: { style: '3D render', subStyles: ['realistic', 'CGI'], texture: 'varied', lighting: 'natural', contrast: 'medium' },
        composition: { layout: 'centered', spacing: 'balanced', focus: 'center', depth: '3D' },
        details: { lineWeight: 'thick', edgeStyle: 'sharp', patternDensity: 'dense', ornamentLevel: 'moderate' },
      },
      styleKeywords: ['3D render', 'realistic', 'high detail', 'CGI', 'octane render', 'unreal engine', 'hyperrealistic', 'volumetric lighting'],
      negativeKeywords: ['flat', 'illustration', 'cartoon', 'low poly', 'stylized'],
    },
  },
];

// ============ 核心功能函数 ============

/**
 * 创建空白StyleDNA
 */
export function createEmptyStyleDNA(name: string = '自定义风格'): StyleDNA {
  const now = Date.now();
  return {
    id: `style-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: now,
    updatedAt: now,
    elements: {
      colors: { primary: '', secondary: '', accent: '', palette: [], mood: 'neutral' },
      visual: { style: '', subStyles: [], texture: '', lighting: '', contrast: '' },
      composition: { layout: '', spacing: '', focus: '', depth: '' },
      details: { lineWeight: '', edgeStyle: '', patternDensity: '', ornamentLevel: '' },
    },
    referenceImages: [],
    styleKeywords: [],
    negativeKeywords: [],
    metadata: { source: 'user_defined', confidence: 0 },
  };
}

/**
 * 从模板创建StyleDNA
 */
export function createStyleDNAFromTemplate(templateId: string): StyleDNA | null {
  const template = STYLE_TEMPLATES.find(t => t.id === templateId);
  if (!template) return null;
  
  const now = Date.now();
  return {
    id: `style-${templateId}-${now}`,
    name: template.name,
    createdAt: now,
    updatedAt: now,
    elements: template.dna.elements as StyleDNA['elements'],
    referenceImages: [],
    styleKeywords: template.dna.styleKeywords || [],
    negativeKeywords: template.dna.negativeKeywords || [],
    metadata: { source: 'template', templateId, confidence: 1 },
  };
}

/**
 * 从图片提取StyleDNA（AI分析）
 * 传入图片URL，调用LLM分析风格要素
 */
export async function extractStyleDNAFromImage(
  imageUrl: string,
  imageDescription: string,
  llmProvider: { model: string; providerId: string }
): Promise<StyleDNA | null> {
  // 调用 /api/chat 进行风格分析
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `分析这张图片的设计风格，提取以下风格要素：
        
图片描述：${imageDescription}

请按以下格式输出JSON：
{
  "colors": { "primary": "...", "secondary": "...", "accent": "...", "palette": [...], "mood": "..." },
  "visual": { "style": "...", "subStyles": [...], "texture": "...", "lighting": "...", "contrast": "..." },
  "composition": { "layout": "...", "spacing": "...", "focus": "...", "depth": "..." },
  "details": { "lineWeight": "...", "edgeStyle": "...", "patternDensity": "...", "ornamentLevel": "..." },
  "styleKeywords": [...],
  "negativeKeywords": [...]
}

只输出JSON，不要其他解释。`,
        model: llmProvider.model,
        providerId: llmProvider.providerId,
        stream: false,
      }),
    });
    
    const data = await response.json();
    const content = data.content || data.message || '';
    
    // 解析JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    const parsed = JSON.parse(jsonMatch[0]);
    const now = Date.now();
    
    return {
      id: `style-extracted-${now}`,
      name: `提取风格-${imageDescription.slice(0, 20)}`,
      createdAt: now,
      updatedAt: now,
      elements: {
        colors: parsed.colors || { primary: '', secondary: '', accent: '', palette: [], mood: 'neutral' },
        visual: parsed.visual || { style: '', subStyles: [], texture: '', lighting: '', contrast: '' },
        composition: parsed.composition || { layout: '', spacing: '', focus: '', depth: '' },
        details: parsed.details || { lineWeight: '', edgeStyle: '', patternDensity: '', ornamentLevel: '' },
      },
      referenceImages: [imageUrl],
      styleKeywords: parsed.styleKeywords || [],
      negativeKeywords: parsed.negativeKeywords || [],
      metadata: { source: 'image_analyzed', confidence: 0.8, extractedAt: now },
    };
  } catch (error) {
    console.error('提取StyleDNA失败:', error);
    return null;
  }
}

/**
 * 合并多个StyleDNA（用于多图参考）
 */
export function mergeStyleDNAs(dnas: StyleDNA[]): StyleDNA {
  if (dnas.length === 0) return createEmptyStyleDNA();
  if (dnas.length === 1) return dnas[0];
  
  // 合并策略：取高频出现的风格词，平均色值
  const allKeywords = dnas.flatMap(d => d.styleKeywords);
  const uniqueKeywords = [...new Set(allKeywords)].slice(0, 10);
  
  const allNegatives = dnas.flatMap(d => d.negativeKeywords);
  const uniqueNegatives = [...new Set(allNegatives)].slice(0, 5);
  
  // 合并色板
  const allPalettes = dnas.flatMap(d => d.elements.colors.palette);
  const uniquePalette = [...new Set(allPalettes)].slice(0, 5);
  
  const now = Date.now();
  return {
    id: `style-merged-${now}`,
    name: `合并风格-${dnas.length}图`,
    createdAt: now,
    updatedAt: now,
    elements: {
      colors: {
        primary: dnas[0].elements.colors.primary,
        secondary: dnas[1]?.elements.colors.secondary || dnas[0].elements.colors.secondary,
        accent: dnas[2]?.elements.colors.accent || dnas[0].elements.colors.accent,
        palette: uniquePalette,
        mood: dnas[0].elements.colors.mood,
      },
      visual: dnas[0].elements.visual,
      composition: dnas[0].elements.composition,
      details: dnas[0].elements.details,
    },
    referenceImages: dnas.flatMap(d => d.referenceImages),
    styleKeywords: uniqueKeywords,
    negativeKeywords: uniqueNegatives,
    metadata: { source: 'user_defined', confidence: 0.9 },
  };
}

/**
 * 将StyleDNA注入到生成提示词中
 * 用于图像生成、视频生成等场景
 */
export function injectStyleDNAIntoPrompt(prompt: string, styleDNA: StyleDNA | null): string {
  if (!styleDNA) return prompt;
  
  const stylePrefix: string[] = [];
  
  // 色彩注入
  const { colors } = styleDNA.elements;
  if (colors.primary) {
    stylePrefix.push(`主色调${colors.primary}`);
  }
  if (colors.mood) {
    stylePrefix.push(`色彩情绪${colors.mood}`);
  }
  
  // 视觉风格注入
  const { visual } = styleDNA.elements;
  if (visual.style) {
    stylePrefix.push(`${visual.style}风格`);
  }
  if (visual.subStyles && visual.subStyles.length > 0) {
    stylePrefix.push(visual.subStyles.join('、'));
  }
  if (visual.texture) {
    stylePrefix.push(`${visual.texture}质感`);
  }
  if (visual.lighting) {
    stylePrefix.push(`${visual.lighting}光照`);
  }
  if (visual.contrast) {
    stylePrefix.push(`${visual.contrast}对比度`);
  }
  
  // 构图注入
  const { composition } = styleDNA.elements;
  if (composition.layout) {
    stylePrefix.push(`${composition.layout}构图`);
  }
  if (composition.depth) {
    stylePrefix.push(`${composition.depth}空间感`);
  }
  
  // 关键词注入
  if (styleDNA.styleKeywords.length > 0) {
    stylePrefix.push(styleDNA.styleKeywords.slice(0, 5).join('、'));
  }
  
  // 组合提示词
  const injectedPrompt = stylePrefix.length > 0 
    ? `${stylePrefix.join('，')}。${prompt}`
    : prompt;
  
  // 负向关键词
  if (styleDNA.negativeKeywords.length > 0) {
    return `${injectedPrompt} [negative: ${styleDNA.negativeKeywords.join(', ')}]`;
  }
  
  return injectedPrompt;
}

/**
 * 将StyleDNA注入到视频生成提示词中
 */
export function injectStyleDNAIntoVideoPrompt(prompt: string, styleDNA: StyleDNA | null): string {
  if (!styleDNA) return prompt;
  
  const enhancements: string[] = [];
  
  // 色彩
  if (styleDNA.elements.colors.primary) {
    enhancements.push(`画面色调以${styleDNA.elements.colors.primary}为主`);
  }
  
  // 视觉风格
  if (styleDNA.elements.visual.style) {
    enhancements.push(`${styleDNA.elements.visual.style}视觉风格`);
  }
  
  // 光影
  if (styleDNA.elements.visual.lighting) {
    enhancements.push(`${styleDNA.elements.visual.lighting}光影效果`);
  }
  
  // 空间感
  if (styleDNA.elements.composition.depth) {
    enhancements.push(`${styleDNA.elements.composition.depth}空间感`);
  }
  
  // 关键词
  if (styleDNA.styleKeywords.length > 0) {
    enhancements.push(styleDNA.styleKeywords.slice(0, 3).join('、'));
  }
  
  return `${prompt}，${enhancements.join('，')}`;
}

// ============ StyleDNA 存储管理 ============

const STYLE_DNA_STORAGE_KEY = 'wujie_style_dna_registry';

/**
 * 保存StyleDNA到localStorage
 */
export function saveStyleDNA(styleDNA: StyleDNA): void {
  const registry = loadStyleDNARegistry();
  const existingIndex = registry.findIndex(s => s.id === styleDNA.id);
  
  if (existingIndex >= 0) {
    registry[existingIndex] = { ...styleDNA, updatedAt: Date.now() };
  } else {
    registry.push(styleDNA);
  }
  
  localStorage.setItem(STYLE_DNA_STORAGE_KEY, JSON.stringify(registry));
}

/**
 * 加载所有StyleDNA
 */
export function loadStyleDNARegistry(): StyleDNA[] {
  try {
    const data = localStorage.getItem(STYLE_DNA_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * 删除StyleDNA
 */
export function deleteStyleDNA(styleId: string): void {
  const registry = loadStyleDNARegistry();
  const filtered = registry.filter(s => s.id !== styleId);
  localStorage.setItem(STYLE_DNA_STORAGE_KEY, JSON.stringify(filtered));
}

/**
 * 获取单个StyleDNA
 */
export function getStyleDNA(styleId: string): StyleDNA | null {
  const registry = loadStyleDNARegistry();
  return registry.find(s => s.id === styleId) || null;
}

/**
 * 从CanvasImage的styleDNAId加载StyleDNA
 */
export function getStyleDNAFromImage(image: CanvasImage): StyleDNA | null {
  const styleDNAId = (image as CanvasImage & { styleDNAId?: string }).styleDNAId;
  if (!styleDNAId) return null;
  return getStyleDNA(styleDNAId);
}

/**
 * 为CanvasImage设置StyleDNA
 */
export function setStyleDNAForImage(image: CanvasImage, styleDNA: StyleDNA): CanvasImage & { styleDNAId: string } {
  return {
    ...image,
    styleDNAId: styleDNA.id,
  };
}

/**
 * 批量为图片设置相同StyleDNA
 */
export function setStyleDNAForImages(images: CanvasImage[], styleDNA: StyleDNA): CanvasImage[] {
  return images.map(img => setStyleDNAForImage(img, styleDNA));
}

// ============ 风格一致性检查 ============

export interface StyleConsistencyResult {
  score: number;         // 0-100
  matchedKeywords: string[];
  mismatchedKeywords: string[];
  suggestions: string[];
}

/**
 * 检查生成内容与StyleDNA的一致性
 */
export function checkStyleConsistency(
  generatedKeywords: string[],
  styleDNA: StyleDNA
): StyleConsistencyResult {
  const matchedKeywords: string[] = [];
  const mismatchedKeywords: string[] = [];
  
  // 检查正向关键词匹配
  for (const keyword of generatedKeywords) {
    if (styleDNA.styleKeywords.some(sk => keyword.toLowerCase().includes(sk.toLowerCase()))) {
      matchedKeywords.push(keyword);
    }
  }
  
  // 检查负向关键词
  for (const keyword of generatedKeywords) {
    if (styleDNA.negativeKeywords.some(nk => keyword.toLowerCase().includes(nk.toLowerCase()))) {
      mismatchedKeywords.push(keyword);
    }
  }
  
  // 计算分数
  const matchScore = matchedKeywords.length * 10;
  const mismatchPenalty = mismatchedKeywords.length * 20;
  const score = Math.max(0, Math.min(100, 50 + matchScore - mismatchPenalty));
  
  // 生成建议
  const suggestions: string[] = [];
  if (mismatchedKeywords.length > 0) {
    suggestions.push(`避免使用${mismatchedKeywords.join('、')}风格元素`);
  }
  if (matchedKeywords.length < 3) {
    suggestions.push(`建议增加${styleDNA.styleKeywords.slice(0, 3).join('、')}风格元素`);
  }
  
  return {
    score,
    matchedKeywords,
    mismatchedKeywords,
    suggestions,
  };
}

export default StyleDNA;