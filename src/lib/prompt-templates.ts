/**
 * 提示词模板管理
 * 支持管理员和用户创建、编辑、删除提示词模板
 * 用户可在提示词输入框中输入 / 触发模板列表
 */

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  category: string;
  tags: string[];
  createdBy: string; // 'admin' | userId
  createdAt: number;
  updatedAt: number;
  isGlobal: boolean; // 管理员创建的全局模板
}

const STORAGE_KEY = 'wujie_prompt_templates';

// 默认模板
const DEFAULT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'template-photo-realistic',
    name: '照片写实风格',
    content: 'A highly detailed, photorealistic image of {subject}, professional photography, 8k resolution, sharp focus, natural lighting, {style}, masterpiece quality',
    category: '风格',
    tags: ['写实', '摄影', '高清'],
    createdBy: 'admin',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isGlobal: true
  },
  {
    id: 'template-anime',
    name: '动漫风格',
    content: 'Anime style illustration of {subject}, vibrant colors, detailed character design, dynamic pose, {style}, high quality anime art, studio ghibli inspired',
    category: '风格',
    tags: ['动漫', '二次元', '插画'],
    createdBy: 'admin',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isGlobal: true
  },
  {
    id: 'template-oil-painting',
    name: '油画风格',
    content: 'Oil painting of {subject}, impressionist style, rich textures, bold brushstrokes, {style}, museum quality artwork, classical composition',
    category: '风格',
    tags: ['油画', '印象派', '艺术'],
    createdBy: 'admin',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isGlobal: true
  },
  {
    id: 'template-cyberpunk',
    name: '赛博朋克',
    content: 'Cyberpunk scene of {subject}, neon lights, futuristic city, rain-soaked streets, {style}, blade runner aesthetic, cinematic lighting, ultra detailed',
    category: '场景',
    tags: ['赛博朋克', '未来', '科幻'],
    createdBy: 'admin',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isGlobal: true
  },
  {
    id: 'template-landscape',
    name: '风景摄影',
    content: 'Breathtaking landscape photography of {subject}, golden hour lighting, dramatic sky, {style}, national geographic quality, 8k ultra HD',
    category: '场景',
    tags: ['风景', '自然', '摄影'],
    createdBy: 'admin',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isGlobal: true
  },
  {
    id: 'template-portrait',
    name: '人像摄影',
    content: 'Professional portrait photography of {subject}, studio lighting, shallow depth of field, {style}, magazine cover quality, sharp details',
    category: '人物',
    tags: ['人像', '肖像', '摄影'],
    createdBy: 'admin',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isGlobal: true
  },
  {
    id: 'template-product',
    name: '产品摄影',
    content: 'Product photography of {subject}, clean white background, professional studio lighting, {style}, commercial quality, high resolution',
    category: '商业',
    tags: ['产品', '商业', '电商'],
    createdBy: 'admin',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isGlobal: true
  },
  {
    id: 'template-fantasy',
    name: '奇幻风格',
    content: 'Fantasy art of {subject}, magical atmosphere, ethereal lighting, {style}, epic composition, detailed environment, concept art quality',
    category: '风格',
    tags: ['奇幻', '魔法', '概念艺术'],
    createdBy: 'admin',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isGlobal: true
  }
];

/**
 * 获取所有提示词模板
 */
export function getPromptTemplates(): PromptTemplate[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const templates = JSON.parse(stored) as PromptTemplate[];
      // 合并默认模板（如果有新增的）
      const storedIds = new Set(templates.map(t => t.id));
      const newDefaults = DEFAULT_TEMPLATES.filter(t => !storedIds.has(t.id));
      if (newDefaults.length > 0) {
        const merged = [...templates, ...newDefaults];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        return merged;
      }
      return templates;
    }
    // 首次使用，初始化默认模板
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_TEMPLATES));
    return DEFAULT_TEMPLATES;
  } catch {
    return DEFAULT_TEMPLATES;
  }
}

/**
 * 保存提示词模板列表
 */
export function savePromptTemplates(templates: PromptTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch (e) {
    console.error('Failed to save prompt templates:', e);
  }
}

/**
 * 添加提示词模板
 */
export function addPromptTemplate(template: Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt'>): PromptTemplate {
  const templates = getPromptTemplates();
  const newTemplate: PromptTemplate = {
    ...template,
    id: `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  templates.push(newTemplate);
  savePromptTemplates(templates);
  return newTemplate;
}

/**
 * 更新提示词模板
 */
export function updatePromptTemplate(id: string, updates: Partial<Omit<PromptTemplate, 'id' | 'createdAt'>>): PromptTemplate | null {
  const templates = getPromptTemplates();
  const index = templates.findIndex(t => t.id === id);
  if (index === -1) return null;
  
  templates[index] = {
    ...templates[index],
    ...updates,
    updatedAt: Date.now()
  };
  savePromptTemplates(templates);
  return templates[index];
}

/**
 * 删除提示词模板
 */
export function deletePromptTemplate(id: string): boolean {
  const templates = getPromptTemplates();
  const filtered = templates.filter(t => t.id !== id);
  if (filtered.length === templates.length) return false;
  savePromptTemplates(filtered);
  return true;
}

/**
 * 根据分类获取模板
 */
export function getTemplatesByCategory(category?: string): PromptTemplate[] {
  const templates = getPromptTemplates();
  if (!category) return templates;
  return templates.filter(t => t.category === category);
}

/**
 * 搜索模板
 */
export function searchTemplates(query: string): PromptTemplate[] {
  const templates = getPromptTemplates();
  const lowerQuery = query.toLowerCase();
  return templates.filter(t => 
    t.name.toLowerCase().includes(lowerQuery) ||
    t.content.toLowerCase().includes(lowerQuery) ||
    t.tags.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
    t.category.toLowerCase().includes(lowerQuery)
  );
}

/**
 * 获取所有分类
 */
export function getTemplateCategories(): string[] {
  const templates = getPromptTemplates();
  const categories = new Set(templates.map(t => t.category));
  return Array.from(categories);
}
