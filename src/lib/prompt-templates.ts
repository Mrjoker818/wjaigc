// 提示词模板管理
// 支持管理员预设模板（从 JSON 文件加载）+ 用户自定义模板（localStorage）

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  category: string;
  tags: string[];
  thumbnail?: string;
  createdBy?: string;
  createdAt?: number;
  updatedAt?: number;
  isGlobal?: boolean;
}

const STORAGE_KEY = 'wujie_prompt_templates';
const LOADED_FLAG_KEY = 'wujie_prompt_templates_loaded';

// 8 个内置默认模板（作为兜底）
const BUILTIN_TEMPLATES: PromptTemplate[] = [
  { id: 'default-1', name: '照片写实风格', content: 'Photorealistic, 8K, ultra-detailed, sharp focus, natural lighting, realistic textures, professional photography', category: '风格', tags: ['写实', '摄影'], createdBy: 'admin', isGlobal: true, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'default-2', name: '动漫风格', content: 'Anime style, Studio Ghibli inspired, vibrant colors, cel-shaded, clean lines, whimsical atmosphere, hand-drawn aesthetic', category: '风格', tags: ['动漫', '二次元'], createdBy: 'admin', isGlobal: true, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'default-3', name: '油画风格', content: 'Oil painting style, impasto technique, rich brushstrokes, canvas texture, classical composition, warm palette, artistic', category: '风格', tags: ['油画', '古典'], createdBy: 'admin', isGlobal: true, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'default-4', name: '赛博朋克', content: 'Cyberpunk aesthetic, neon lights, rain-slicked streets, high-tech low-life, dystopian cityscape, purple and cyan palette, holographic ads', category: '场景', tags: ['赛博朋克', '未来'], createdBy: 'admin', isGlobal: true, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'default-5', name: '风景摄影', content: 'Landscape photography, National Geographic style, golden hour, dramatic skies, majestic mountains, serene lakes, natural beauty', category: '场景', tags: ['风景', '自然'], createdBy: 'admin', isGlobal: true, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'default-6', name: '人像摄影', content: 'Portrait photography, professional lighting, shallow depth of field, bokeh background, natural skin tones, studio quality', category: '人物', tags: ['人像', '摄影'], createdBy: 'admin', isGlobal: true, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'default-7', name: '产品摄影', content: 'Product photography, white background, studio lighting, sharp details, clean composition, commercial quality, 360-degree view', category: '商业', tags: ['产品', '电商'], createdBy: 'admin', isGlobal: true, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'default-8', name: '奇幻风格', content: 'Fantasy art, epic scene, magical atmosphere, mythical creatures, glowing effects, ethereal lighting, concept art quality', category: '风格', tags: ['奇幻', '概念艺术'], createdBy: 'admin', isGlobal: true, createdAt: Date.now(), updatedAt: Date.now() },
];

/**
 * 从 JSON 数据文件加载管理员预设模板到 localStorage
 * 仅在首次加载时生效（由 LOADED_FLAG_KEY 控制）
 */
export async function initPromptTemplates(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const alreadyLoaded = localStorage.getItem(LOADED_FLAG_KEY);
    if (alreadyLoaded === 'true') return;

    const res = await fetch('/data/prompt-library-defaults.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const remoteTemplates: PromptTemplate[] = await res.json();

    // 合并已有模板，去重（按 id）
    const existing = getLocalTemplates();
    const existingIds = new Set(existing.map(t => t.id));
    const newTemplates = remoteTemplates.filter(t => !existingIds.has(t.id));

    if (newTemplates.length > 0) {
      const merged = [...newTemplates, ...existing];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    }

    localStorage.setItem(LOADED_FLAG_KEY, 'true');
    console.log(`[prompt-templates] Loaded ${newTemplates.length} new templates from library`);
  } catch (e) {
    console.warn('[prompt-templates] Failed to load library defaults:', e);
  }
}

function getLocalTemplates(): PromptTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

/**
 * 获取所有提示词模板（合并内置 + localStorage 用户自定义）
 */
export function getPromptTemplates(): PromptTemplate[] {
  if (typeof window === 'undefined') return BUILTIN_TEMPLATES;

  const local = getLocalTemplates();
  // 如果 localStorage 有数据，用 localStorage 的数据（包含已加载的远程模板）
  if (local.length > 0) return local;
  // 兜底返回内置模板
  return BUILTIN_TEMPLATES;
}

export function getTemplateCategories(): string[] {
  const templates = getPromptTemplates();
  return [...new Set(templates.map(t => t.category).filter(Boolean))];
}

/**
 * 搜索模板（按名称和内容模糊匹配）
 */
export function searchTemplates(query: string): PromptTemplate[] {
  if (!query.trim()) return getPromptTemplates();
  const q = query.toLowerCase();
  return getPromptTemplates().filter(
    t => t.name.toLowerCase().includes(q) || t.content.toLowerCase().includes(q) || t.tags.some(tag => tag.toLowerCase().includes(q))
  );
}

/**
 * 添加自定义模板
 */
export function addPromptTemplate(template: Omit<PromptTemplate, 'id' | 'createdAt'>): PromptTemplate {
  const newTemplate: PromptTemplate = {
    ...template,
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isGlobal: false,
  };

  const existing = getLocalTemplates();
  existing.unshift(newTemplate);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  return newTemplate;
}

/**
 * 删除模板
 */
export function deletePromptTemplate(id: string): void {
  const existing = getLocalTemplates();
  const filtered = existing.filter(t => t.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

/**
 * 更新模板
 */
export function updatePromptTemplate(id: string, updates: Partial<PromptTemplate>): PromptTemplate | null {
  const existing = getLocalTemplates();
  const idx = existing.findIndex(t => t.id === id);
  if (idx === -1) return null;
  existing[idx] = { ...existing[idx], ...updates, updatedAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  return existing[idx];
}