'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Search,
  Sparkles,
  ArrowRight,
  Users,
  Zap,
} from 'lucide-react';

interface Template {
  id: string;
  name: string;
  desc: string;
  thumbnail: string;
  category: string;
  usageCount: string;
  featured?: boolean;
}

const CATEGORY_TABS = [
  { key: 'all', label: '全部' },
  { key: 'brand', label: '品牌设计' },
  { key: 'ecommerce', label: '电商图' },
  { key: 'poster', label: '创意海报' },
  { key: 'portrait', label: '人物肖像' },
  { key: 'concept', label: '概念场景' },
  { key: 'social', label: '社交媒体' },
];

const MOCK_TEMPLATES: Template[] = [
  { id: 't1', name: '品牌Logo设计套组', desc: '一键生成多场景Logo应用', thumbnail: 'https://images.unsplash.com/photo-1626785774573-4b799315345d?w=400&h=250&fit=crop', category: 'brand', usageCount: '2.3k', featured: true },
  { id: 't2', name: '电商商品主图', desc: '白底/场景/细节三视图', thumbnail: 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=400&h=250&fit=crop', category: 'ecommerce', usageCount: '3.1k', featured: true },
  { id: 't3', name: '创意海报生成', desc: '活动推广海报设计', thumbnail: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&h=250&fit=crop', category: 'poster', usageCount: '1.8k' },
  { id: 't4', name: '人物肖像精修', desc: 'AI人像美化与风格化', thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&h=250&fit=crop', category: 'portrait', usageCount: '4.5k', featured: true },
  { id: 't5', name: '赛博朋克城市场景', desc: '科幻概念场景生成', thumbnail: 'https://images.unsplash.com/photo-1535016120720-40c646be5580?w=400&h=250&fit=crop', category: 'concept', usageCount: '1.2k' },
  { id: 't6', name: '社交媒体九宫格', desc: '多平台适配图组', thumbnail: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=400&h=250&fit=crop', category: 'social', usageCount: '2.7k' },
  { id: 't7', name: '产品样机展示', desc: 'Mockup场景化展示', thumbnail: 'https://images.unsplash.com/photo-1544947950-f2a74c8e3e5b?w=400&h=250&fit=crop', category: 'ecommerce', usageCount: '1.9k' },
  { id: 't8', name: 'IP角色设计', desc: '从草稿到三视图', thumbnail: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=400&h=250&fit=crop', category: 'concept', usageCount: '856' },
  { id: 't9', name: '美食摄影风格', desc: '食物拍摄风格化处理', thumbnail: 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=400&h=250&fit=crop', category: 'poster', usageCount: '1.4k' },
  { id: 't10', name: '杂志封面设计', desc: '时尚杂志封面排版', thumbnail: 'https://images.unsplash.com/photo-1586339949916-3e9457bef6d3?w=400&h=250&fit=crop', category: 'brand', usageCount: '968' },
];

const CATEGORY_MAP: Record<string, string> = {
  brand: '品牌设计',
  ecommerce: '电商图',
  poster: '创意海报',
  portrait: '人物肖像',
  concept: '概念场景',
  social: '社交媒体',
};

export default function TemplatesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  const featuredTemplates = MOCK_TEMPLATES.filter((t) => t.featured);

  const filteredTemplates = useMemo(() => {
    let result = MOCK_TEMPLATES;
    if (activeCategory !== 'all') {
      result = result.filter((t) => t.category === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) => t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q)
      );
    }
    return result;
  }, [activeCategory, searchQuery]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* 顶部标题 */}
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-foreground">模板广场</h1>
        <p className="text-sm text-muted-foreground mt-1">选择模板，快速开始创作</p>
      </div>

      {/* 搜索栏 */}
      <div className="relative mt-4 mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索模板..."
          className="w-full h-9 pl-9 pr-4 rounded-md bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
        />
      </div>

      {/* 分类标签 */}
      <div className="flex items-center gap-1.5 mb-6 flex-wrap">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveCategory(tab.key)}
            className={`h-7 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeCategory === tab.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 精选推荐 */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-foreground mb-3">精选推荐</h2>
        <div className="flex gap-4">
          {/* 大banner */}
          {featuredTemplates[0] && (
            <div className="flex-1 bg-card rounded-lg shadow-card overflow-hidden cursor-pointer hover:border-primary/20 transition-all border border-transparent group min-w-0">
              <div className="aspect-[16/9] overflow-hidden relative">
                <img
                  src={featuredTemplates[0].thumbnail}
                  alt={featuredTemplates[0].name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <span className="absolute top-3 left-3 inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium bg-primary text-primary-foreground">
                  精选
                </span>
              </div>
              <div className="p-4">
                <div className="text-base font-semibold text-foreground">{featuredTemplates[0].name}</div>
                <div className="text-sm text-muted-foreground mt-1">{featuredTemplates[0].desc}</div>
                <Link
                  href={`/projects?action=template&name=${encodeURIComponent(featuredTemplates[0].name)}`}
                  className="mt-3 inline-flex items-center justify-center h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer"
                >
                  立即使用
                </Link>
              </div>
            </div>
          )}
          {/* 右侧2个小卡片 */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            {featuredTemplates.slice(1).map((tpl) => (
              <div
                key={tpl.id}
                className="flex-1 bg-card rounded-lg shadow-card overflow-hidden cursor-pointer hover:border-primary/20 transition-all border border-transparent group min-h-0"
              >
                <div className="flex h-full">
                  <div className="w-[45%] overflow-hidden relative shrink-0">
                    <img
                      src={tpl.thumbnail}
                      alt={tpl.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <span className="absolute top-2 left-2 inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-medium bg-primary text-primary-foreground">
                      精选
                    </span>
                  </div>
                  <div className="flex-1 p-3 flex flex-col justify-center min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{tpl.name}</div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">{tpl.desc}</div>
                    <Link
                      href={`/projects?action=template&name=${encodeURIComponent(tpl.name)}`}
                      className="mt-2 inline-flex items-center justify-center h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors cursor-pointer w-fit"
                    >
                      立即使用
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 模板网格 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">全部模板</h2>
          <div className="text-xs text-muted-foreground">共 {filteredTemplates.length} 个模板</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredTemplates.map((tpl) => (
            <div
              key={tpl.id}
              className="bg-card rounded-lg shadow-card overflow-hidden cursor-pointer hover:border-primary/20 hover:scale-[1.02] transition-all border border-transparent relative group"
            >
              <div className="aspect-[16/10] overflow-hidden relative">
                <img
                  src={tpl.thumbnail}
                  alt={tpl.name}
                  className="w-full h-full object-cover"
                />
                {/* 分类标签 */}
                <div className="absolute bottom-2 left-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium bg-black/50 text-white/90 backdrop-blur-sm">
                    {CATEGORY_MAP[tpl.category]}
                  </span>
                </div>
                {/* 使用人数 */}
                <div className="absolute bottom-2 right-2 flex items-center gap-1 text-xs text-white/80 bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded-sm">
                  <Users className="w-3 h-3" />
                  {tpl.usageCount}
                </div>
              </div>
              <div className="p-3">
                <div className="text-sm font-semibold text-foreground truncate">{tpl.name}</div>
                <div className="text-xs text-muted-foreground mt-1 truncate">{tpl.desc}</div>
                <Link
                  href={`/projects?action=template&name=${encodeURIComponent(tpl.name)}`}
                  className="mt-2 inline-flex items-center justify-center h-7 px-3 rounded-md bg-muted text-foreground text-xs font-medium hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer w-full"
                >
                  使用模板
                </Link>
              </div>
            </div>
          ))}
        </div>

        {filteredTemplates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Search className="w-12 h-12 mb-3 opacity-30" />
            <div className="text-sm">没有找到匹配的模板</div>
          </div>
        )}
      </div>

      {/* AI建图入口 */}
      <div className="bg-card rounded-lg shadow-card p-6 flex items-center justify-between border border-transparent hover:border-primary/20 transition-colors">
        <div>
          <div className="text-base font-semibold text-foreground">没有找到合适的模板？</div>
          <div className="text-sm text-muted-foreground mt-1">试试AI建图，用自然语言描述你想要的工作流</div>
        </div>
        <Link
          href="/?action=ai-build"
          className="flex items-center gap-2 h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer shrink-0"
        >
          <Zap className="w-4 h-4" />
          AI智能建图
        </Link>
      </div>
    </div>
  );
}
