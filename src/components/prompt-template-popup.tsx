/**
 * 提示词模板弹窗组件
 * 可复用于所有支持 / 触发模板的文本输入框
 */

import { FileText } from 'lucide-react';
import type { PromptTemplate } from '@/lib/prompt-templates';

export interface PromptTemplatePopupProps {
  /** 是否显示 */
  show: boolean;
  /** 模板列表 */
  templates: PromptTemplate[];
  /** 当前选中索引 */
  selectedIndex: number;
  /** 搜索关键词 */
  searchQuery: string;
  /** 选择模板回调 */
  onSelect: (template: PromptTemplate) => void;
  /** 是否为浅色模式 */
  isMonochrome?: boolean;
}

export function PromptTemplatePopup({
  show,
  templates,
  selectedIndex,
  searchQuery,
  onSelect,
  isMonochrome = false,
}: PromptTemplatePopupProps) {
  const mc = isMonochrome;
  
  if (!show || templates.length === 0) return null;
  
  return (
    <div className={`absolute left-0 right-0 top-full mt-1 z-[100] rounded-xl shadow-2xl overflow-hidden ${
      mc ? 'bg-white border border-gray-200' : 'bg-[#1a1a1a] border border-white/[0.12]'
    }`}>
      <div className={`px-3 py-2 border-b ${mc ? 'border-gray-100' : 'border-white/[0.06]'}`}>
        <span className={`text-xs ${mc ? 'text-gray-500' : 'text-gold-muted/70'}`}>
          提示词模板 {searchQuery && `· 搜索: "${searchQuery}"`}
        </span>
      </div>
      <div className="max-h-60 overflow-y-auto">
        {templates.map((template, index) => (
          <button
            key={template.id}
            onClick={() => onSelect(template)}
            className={`w-full text-left px-3 py-2.5 transition-colors ${
              index === selectedIndex
                ? mc ? 'bg-gray-100' : 'bg-white/[0.06]'
                : mc ? 'hover:bg-gray-50' : 'hover:bg-white/[0.03]'
            }`}
          >
            <div className="flex items-center gap-2">
              <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${mc ? 'text-gray-400' : 'text-gold-muted/50'}`} />
              <span className={`text-sm font-medium truncate ${mc ? 'text-gray-900' : 'text-foreground'}`}>
                {template.name}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                mc ? 'bg-gray-100 text-gray-500' : 'bg-white/[0.06] text-gold-muted/70'
              }`}>
                {template.category}
              </span>
            </div>
            <p className={`text-xs mt-1 line-clamp-1 pl-5.5 ${mc ? 'text-gray-500' : 'text-gold-muted/50'}`}>
              {template.content}
            </p>
          </button>
        ))}
      </div>
      <div className={`px-3 py-2 border-t ${mc ? 'border-gray-100' : 'border-white/[0.06]'}`}>
        <span className={`text-[10px] ${mc ? 'text-gray-400' : 'text-gold-muted/40'}`}>
          ↑↓ 选择 · Enter 确认 · Esc 关闭
        </span>
      </div>
    </div>
  );
}
