'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserManager } from '@/lib/user-manager';
import {
  Search, Zap, Users, ArrowRight, Palette, ShoppingBag,
  Film, UserCircle, Mountain, Share2, Package, PenTool,
  Utensils, BookOpen
} from 'lucide-react';

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: React.ReactNode;
  prompt: string;
  usageCount: string;
  featured?: boolean;
}

const TEMPLATES: Template[] = [
  {
    id: 'brand-logo',
    name: '品牌Logo设计套组',
    description: '一键生成多场景Logo，含黑白稿、彩色稿、应用场景展示',
    category: '品牌设计',
    icon: <Palette className="w-5 h-5" />,
    prompt: 'professional brand logo design, clean vector style, multiple variations',
    usageCount: '2.1k',
    featured: true,
  },
  {
    id: 'ecommerce-main',
    name: '电商商品主图',
    description: '白底/场景/细节三视图，适配淘宝京东拼多多',
    category: '电商图',
    icon: <ShoppingBag className="w-5 h-5" />,
    prompt: 'e-commerce product photography, white background, studio lighting, high detail',
    usageCount: '3.5k',
    featured: true,
  },
  {
    id: 'creative-poster',
    name: '创意海报生成',
    description: '活动推广海报设计，支持多种风格和尺寸',
    category: '创意海报',
    icon: <Film className="w-5 h-5" />,
    prompt: 'creative promotional poster design, bold typography, eye-catching layout',
    usageCount: '1.8k',
  },
  {
    id: 'portrait-retouch',
    name: '人物肖像精修',
    description: 'AI人像美化与风格化，支持多种艺术风格',
    category: '人物肖像',
    icon: <UserCircle className="w-5 h-5" />,
    prompt: 'professional portrait photography, retouched, soft lighting, bokeh background',
    usageCount: '2.9k',
  },
  {
    id: 'concept-scene',
    name: '概念场景设计',
    description: '科幻/奇幻/写实概念场景，支持多角度生成',
    category: '概念场景',
    icon: <Mountain className="w-5 h-5" />,
    prompt: 'concept art, cinematic scene, detailed environment, dramatic lighting',
    usageCount: '1.4k',
    featured: true,
  },
  {
    id: 'social-media',
    name: '社交媒体套图',
    description: '九宫格/小红书/微博多平台适配图组',
    category: '社交媒体',
    icon: <Share2 className="w-5 h-5" />,
    prompt: 'social media content, cohesive visual style, multiple formats',
    usageCount: '2.3k',
  },
  {
    id: 'product-mockup',
    name: '产品样机展示',
    description: 'Mockup场景化展示，手机/电脑/印刷品多种载体',
    category: '电商图',
    icon: <Package className="w-5 h-5" />,
    prompt: 'product mockup, realistic scene, professional presentation, clean background',
    usageCount: '1.7k',
  },
  {
    id: 'ip-character',
    name: 'IP角色设计',
    description: '从草稿到三视图，完整的IP角色设计方案',
    category: '创意海报',
    icon: <PenTool className="w-5 h-5" />,
    prompt: 'IP character design, character sheet, multiple views, consistent style',
    usageCount: '1.2k',
  },
  {
    id: 'food-photography',
    name: '美食摄影风格',
    description: '食物拍摄风格化，餐厅菜单/社交媒体适配',
    category: '人物肖像',
    icon: <Utensils className="w-5 h-5" />,
    prompt: 'food photography, appetizing, natural lighting, restaurant style, top-down view',
    usageCount: '980',
  },
  {
    id: 'magazine-cover',
    name: '杂志封面设计',
    description: '时尚杂志封面排版，含标题和版式设计',
    category: '品牌设计',
    icon: <BookOpen className="w-5 h-5" />,
    prompt: 'magazine cover design, editorial layout, fashion photography, bold typography',
    usageCount: '860',
  },
];

const CATEGORIES = ['全部', '品牌设计', '电商图', '创意海报', '人物肖像', '概念场景', '社交媒体'];

export default function TemplatesPage() {
  const router = useRouter();
  const [category, setCategory] = useState('全部');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = TEMPLATES.filter(t => {
    const matchCategory = category === '全部' || t.category === category;
    const matchSearch = !searchQuery.trim() ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });

  const featured = TEMPLATES.filter(t => t.featured);

  const handleUseTemplate = (template: Template) => {
    const um = UserManager.getInstance();
    const project = um.createProject(template.name, template.description);
    // 设置项目模型配置
    um.updateProject(project.id, {
      settings: {
        ...project.settings,
        model: template.prompt,
      },
    });
    router.push(`/?projectId=${project.id}`);
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* 顶部标题区 */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">模板广场</h1>
        <p className="text-sm text-muted-foreground mt-1">选择模板，快速开始创作</p>
      </div>

      {/* 搜索与分类 */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索模板..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-all cursor-pointer ${
                category === cat
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* 精选推荐 */}
      {!searchQuery && category === '全部' && featured.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-4">精选推荐</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* 大卡片 */}
            <div className="relative bg-card rounded-xl border border-border shadow-card overflow-hidden group">
              <div className="p-6 flex flex-col justify-between h-full">
                <div>
                  <span className="inline-block px-2 py-0.5 text-[10px] font-semibold bg-primary/15 text-primary rounded-md mb-3">精选</span>
                  <h3 className="text-xl font-bold text-foreground mb-2">{featured[0].name}</h3>
                  <p className="text-sm text-muted-foreground">{featured[0].description}</p>
                </div>
                <div className="flex items-center justify-between mt-6">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="w-3.5 h-3.5" />
                    {featured[0].usageCount} 人使用
                  </div>
                  <button
                    onClick={() => handleUseTemplate(featured[0])}
                    className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all cursor-pointer"
                  >
                    立即使用
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
            {/* 右侧小卡片 */}
            <div className="flex flex-col gap-5">
              {featured.slice(1).map(template => (
                <div key={template.id} className="flex items-center gap-4 bg-card rounded-xl border border-border shadow-card p-4 group hover:border-primary/30 transition-all">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                    {template.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-foreground">{template.name}</h3>
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-primary/15 text-primary rounded">精选</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{template.description}</p>
                  </div>
                  <button
                    onClick={() => handleUseTemplate(template)}
                    className="px-4 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors cursor-pointer flex-shrink-0"
                  >
                    使用
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 模板网格 */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-4">
          {category === '全部' ? '全部模板' : category}
          <span className="text-sm font-normal text-muted-foreground ml-2">({filtered.length})</span>
        </h2>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Search className="w-16 h-16 text-muted-foreground/20 mb-4" />
            <p className="text-muted-foreground text-lg mb-2">没有找到匹配的模板</p>
            <p className="text-muted-foreground/60 text-sm">试试其他关键词或分类</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map(template => (
              <div
                key={template.id}
                className="bg-card rounded-xl border border-border shadow-card hover:border-primary/30 hover:shadow-lg transition-all overflow-hidden group"
              >
                {/* 图标区域 */}
                <div className="aspect-[16/10] bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center relative">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                    {template.icon}
                  </div>
                  {/* 分类标签 */}
                  <span className="absolute top-3 left-3 px-2 py-0.5 text-[10px] font-medium bg-card/80 backdrop-blur-sm text-muted-foreground rounded-md border border-border">
                    {template.category}
                  </span>
                </div>

                {/* 信息区 */}
                <div className="p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-1">{template.name}</h3>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{template.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {template.usageCount} 人使用
                    </span>
                    <button
                      onClick={() => handleUseTemplate(template)}
                      className="px-3 py-1.5 text-xs font-medium bg-muted text-foreground rounded-lg hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer"
                    >
                      使用模板
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI 建图入口 */}
      <div className="flex items-center justify-center py-6">
        <div className="flex items-center gap-4 px-8 py-4 bg-card rounded-2xl border border-border shadow-card">
          <p className="text-sm text-muted-foreground">没有找到合适的模板？</p>
          <button
            onClick={() => {
              const um = UserManager.getInstance();
              const project = um.createProject('AI 智能建图项目');
              router.push(`/?projectId=${project.id}`);
            }}
            className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all cursor-pointer"
          >
            <Zap className="w-4 h-4" />
            试试 AI 建图
          </button>
        </div>
      </div>
    </div>
  );
}
