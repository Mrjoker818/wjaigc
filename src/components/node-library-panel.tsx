'use client';

import React, { useState, useMemo } from 'react';

/** 节点库项定义 */
interface NodeLibraryItem {
  id: string;
  label: string;
  type: string;
  icon: string;
  description: string;
}

/** 节点分类 */
interface NodeCategory {
  id: string;
  label: string;
  icon: string;
  color: string;
  items: NodeLibraryItem[];
}

const NODE_CATEGORIES: NodeCategory[] = [
  {
    id: 'input',
    label: '输入',
    icon: '📥',
    color: '#3b82f6',
    items: [
      { id: 'load-image', label: '加载图片', type: 'load', icon: '🖼️', description: '从本地上传或URL加载图片' },
      { id: 'load-url', label: '加载URL', type: 'load', icon: '🔗', description: '通过网络URL加载图片' },
      { id: 'text-input', label: '文本输入', type: 'load', icon: '📝', description: '输入提示词文本' },
    ],
  },
  {
    id: 'process',
    label: '处理',
    icon: '⚡',
    color: '#8b5cf6',
    items: [
      { id: 'remove-bg', label: '移除背景', type: 'process', icon: '✂️', description: '自动移除图片背景' },
      { id: 'upscale', label: '无损放大', type: 'process', icon: '🔍', description: 'AI放大图片细节' },
      { id: 'img2img', label: '图生图', type: 'generate', icon: '🎨', description: '基于原图生成新图' },
      { id: 'adjust-color', label: '调色', type: 'process', icon: '🌈', description: '调整色彩/亮度/对比度' },
      { id: 'white-bg', label: '白底合成', type: 'process', icon: '⬜', description: '添加白色背景' },
      { id: 'erase', label: '擦除修复', type: 'process', icon: '🧹', description: '涂抹消除并自动修复' },
    ],
  },
  {
    id: 'agent',
    label: 'Agent',
    icon: '🤖',
    color: '#f472b6',
    items: [
      { id: 'ai-check', label: 'AI质检', type: 'agent', icon: '✅', description: 'AI自动检查图片质量' },
      { id: 'ai-optimize', label: 'AI优化', type: 'agent', icon: '⬆️', description: 'AI自动优化图片' },
      { id: 'ai-edit', label: 'AI修图', type: 'agent', icon: '🖌️', description: 'AI自然语言修图' },
      { id: 'image-analyze', label: '图片分析', type: 'agent', icon: '🔬', description: 'AI分析图片内容' },
    ],
  },
  {
    id: 'logic',
    label: '逻辑',
    icon: '🔀',
    color: '#f59e0b',
    items: [
      { id: 'condition', label: '条件分支 If', type: 'condition', icon: '❓', description: '根据条件选择分支' },
      { id: 'else', label: '否则 Else', type: 'condition', icon: '↩️', description: '条件不满足时执行' },
      { id: 'loop', label: '循环 Loop', type: 'loop', icon: '🔄', description: '重复执行操作N次' },
      { id: 'parallel', label: '并行执行', type: 'condition', icon: '⚡', description: '同时执行多个操作' },
      { id: 'switch', label: '开关 Switch', type: 'condition', icon: '🔛', description: '多路分支选择' },
    ],
  },
  {
    id: 'subgraph',
    label: '子图/组合',
    icon: '📦',
    color: '#06b6d4',
    items: [
      { id: 'subgraph', label: '子图节点', type: 'subgraph', icon: '📦', description: '将多个步骤封装为子图' },
      { id: 'batch', label: '批量组合', type: 'subgraph', icon: '📋', description: '批量执行操作组合' },
    ],
  },
  {
    id: 'output',
    label: '输出',
    icon: '📤',
    color: '#2ea043',
    items: [
      { id: 'save-image', label: '保存图片', type: 'output', icon: '💾', description: '保存到本地或云端' },
      { id: 'export-psd', label: '导出PSD', type: 'output', icon: '📄', description: '导出为PSD分层文件' },
      { id: 'export-svg', label: '导出SVG', type: 'output', icon: '📐', description: '导出为矢量图' },
    ],
  },
];

interface NodeLibraryPanelProps {
  isMonochrome?: boolean;
  onAddNode?: (nodeType: string, nodeId: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function NodeLibraryPanel({
  isMonochrome = false,
  onAddNode,
  collapsed = false,
  onToggleCollapse,
}: NodeLibraryPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(NODE_CATEGORIES.map(c => c.id))
  );

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return NODE_CATEGORIES;
    const q = searchQuery.toLowerCase();
    return NODE_CATEGORIES.map(cat => ({
      ...cat,
      items: cat.items.filter(
        item => item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
      ),
    })).filter(cat => cat.items.length > 0);
  }, [searchQuery]);

  const toggleCategory = (catId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-2 gap-1" style={{ width: '48px' }}>
        <button
          onClick={onToggleCollapse}
          className={`p-2 rounded-lg transition-colors ${isMonochrome ? 'hover:bg-gray-200 text-gray-600' : 'hover:bg-white/10 text-white/70'}`}
          title="展开节点库"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="2" width="12" height="3" rx="1" />
            <rect x="2" y="7" width="12" height="3" rx="1" />
            <rect x="2" y="12" width="12" height="3" rx="1" />
            <circle cx="5" cy="3.5" r="1" fill="currentColor" />
            <circle cx="5" cy="8.5" r="1" fill="currentColor" />
            <circle cx="5" cy="13.5" r="1" fill="currentColor" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full border-r"
      style={{
        width: '200px',
        minWidth: '200px',
        background: isMonochrome ? '#fafafa' : '#0e1117',
        borderColor: isMonochrome ? '#e5e7eb' : '#30363d',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: isMonochrome ? '#e5e7eb' : '#30363d' }}>
        <span className={`text-xs font-semibold ${isMonochrome ? 'text-gray-700' : 'text-white/90'}`}>
          节点库
        </span>
        <button
          onClick={onToggleCollapse}
          className={`p-1 rounded transition-colors ${isMonochrome ? 'hover:bg-gray-200 text-gray-500' : 'hover:bg-white/10 text-white/50'}`}
          title="收起节点库"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 3L3 9M3 3l6 6" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5">
        <input
          type="text"
          placeholder="搜索节点..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={`w-full px-2 py-1 rounded text-xs outline-none transition-colors ${
            isMonochrome
              ? 'bg-gray-100 text-gray-800 placeholder:text-gray-400 focus:ring-1 focus:ring-blue-400'
              : 'bg-white/5 text-white/90 placeholder:text-white/30 focus:ring-1 focus:ring-[#d4af37]/50'
          }`}
        />
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto px-2 pb-2" style={{ scrollbarWidth: 'thin' }}>
        {filteredCategories.map(cat => (
          <div key={cat.id} className="mb-1">
            {/* Category header */}
            <button
              onClick={() => toggleCategory(cat.id)}
              className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-xs font-medium transition-colors ${
                isMonochrome ? 'hover:bg-gray-100 text-gray-600' : 'hover:bg-white/5 text-white/70'
              }`}
            >
              <span style={{ color: cat.color }}>{cat.icon}</span>
              <span className="flex-1 text-left">{cat.label}</span>
              <span className={`text-[10px] ${isMonochrome ? 'text-gray-400' : 'text-white/30'}`}>
                {cat.items.length}
              </span>
              <svg
                width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
                className={`transition-transform ${expandedCategories.has(cat.id) ? 'rotate-180' : ''} ${isMonochrome ? 'text-gray-400' : 'text-white/30'}`}
              >
                <path d="M2 4L5 7L8 4" />
              </svg>
            </button>

            {/* Items */}
            {expandedCategories.has(cat.id) && (
              <div className="ml-2 mt-0.5">
                {cat.items.map(item => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('nodeType', item.type);
                      e.dataTransfer.setData('nodeId', item.id);
                    }}
                    onClick={() => onAddNode?.(item.type, item.id)}
                    className={`flex items-center gap-1.5 px-1.5 py-1 rounded cursor-grab active:cursor-grabbing text-xs transition-colors ${
                      isMonochrome
                        ? 'hover:bg-gray-100 text-gray-700'
                        : 'hover:bg-white/5 text-white/80'
                    }`}
                    title={item.description}
                  >
                    <span className="text-[10px]">{item.icon}</span>
                    <span className="flex-1 truncate">{item.label}</span>
                    <span className={`text-[9px] ${isMonochrome ? 'text-gray-300' : 'text-white/20'}`}>⠿</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
