'use client';

import { useState } from 'react';
import { X, Sparkles, Check } from 'lucide-react';
import { PromptTag, getTagsByCategory } from '@/config/prompt-tags';
import { Badge } from '@/components/ui/badge';

interface PromptAssistantProps {
  category: string;
  productCategory?: string;  // 新增：产品品类
  onSelectTags: (tags: string[]) => void;
  selectedTags?: string[];
}

export function PromptAssistant({ category, productCategory = 'none', onSelectTags, selectedTags = [] }: PromptAssistantProps) {
  const [expanded, setExpanded] = useState(false);
  const tags = getTagsByCategory(category, productCategory);
  const [selected, setSelected] = useState<string[]>(selectedTags);

  const toggleTag = (tag: PromptTag) => {
    const newSelected = selected.includes(tag.prompt)
      ? selected.filter(p => p !== tag.prompt)
      : [...selected, tag.prompt];
    setSelected(newSelected);
    onSelectTags(newSelected);
  };

  const clearAll = () => {
    setSelected([]);
    onSelectTags([]);
  };

  const displayTags = expanded ? tags : tags.filter(t => t.hot).slice(0, 8);
  const hasMoreTags = tags.length > 8;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-[#d4af37]" />
          <span className="text-xs font-medium text-[#d4af37] uppercase tracking-wider">
            提示词助手
          </span>
        </div>
        {selected.length > 0 && (
          <button
            onClick={clearAll}
            className="text-xs text-[#666] hover:text-red-400 transition-colors"
          >
            清除全部
          </button>
        )}
      </div>

      {/* Selected Tags Preview */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 bg-[#1a1a1a] rounded-lg border border-[#2a2a2a]">
          {selected.map(prompt => (
            <Badge
              key={prompt}
              variant="secondary"
              className="bg-[#d4af37]/10 text-[#d4af37] border-[#d4af37]/30 text-xs px-2 py-0.5 cursor-pointer hover:bg-[#d4af37]/20"
              onClick={() => {
                const tag = tags.find(t => t.prompt === prompt);
                if (tag) toggleTag(tag);
              }}
            >
              {tags.find(t => t.prompt === prompt)?.label || prompt.slice(0, 10)}
              <X className="h-2.5 w-2.5 ml-1" />
            </Badge>
          ))}
        </div>
      )}

      {/* Hot Tags */}
      {!expanded && tags.filter(t => t.hot).length > 0 && (
        <div className="space-y-2">
          <span className="text-xs text-[#555]">热门标签</span>
          <div className="flex flex-wrap gap-1.5">
            {tags.filter(t => t.hot).slice(0, 6).map(tag => (
              <Badge
                key={tag.prompt}
                variant={selected.includes(tag.prompt) ? "default" : "outline"}
                className={`cursor-pointer transition-all text-xs px-2 py-0.5 ${
                  selected.includes(tag.prompt)
                    ? 'bg-[#d4af37] text-black border-[#d4af37]'
                    : 'bg-[#141414] text-[#888] border-[#333] hover:border-[#d4af37] hover:text-[#d4af37]'
                }`}
                onClick={() => toggleTag(tag)}
              >
                {selected.includes(tag.prompt) && <Check className="h-2.5 w-2.5 mr-1" />}
                {tag.label}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* All Tags */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#555]">
            {expanded ? '全部标签' : `更多标签 (${tags.length})`}
          </span>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-[#666] hover:text-[#d4af37] transition-colors"
          >
            {expanded ? '收起' : '展开'}
          </button>
        </div>

        {expanded && (
          <div className="flex flex-wrap gap-1.5 max-h-[200px] overflow-y-auto custom-scrollbar">
            {tags.map(tag => (
              <Badge
                key={tag.prompt}
                variant={selected.includes(tag.prompt) ? "default" : "outline"}
                className={`cursor-pointer transition-all text-xs px-2 py-0.5 ${
                  selected.includes(tag.prompt)
                    ? 'bg-[#d4af37] text-black border-[#d4af37]'
                    : 'bg-[#141414] text-[#888] border-[#333] hover:border-[#d4af37] hover:text-[#d4af37]'
                }`}
                onClick={() => toggleTag(tag)}
              >
                {selected.includes(tag.prompt) && <Check className="h-2.5 w-2.5 mr-1" />}
                {tag.label}
                {tag.hot && <span className="ml-1 text-[8px] opacity-60">热</span>}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
