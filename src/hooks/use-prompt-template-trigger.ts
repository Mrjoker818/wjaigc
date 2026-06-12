/**
 * 提示词模板触发 Hook
 * 用于在 textarea/input 中实现输入 / 触发模板列表的功能
 */

import { useState, useCallback, useRef, useEffect, type KeyboardEvent, type ChangeEvent, type RefObject } from 'react';
import { getPromptTemplates, searchTemplates, type PromptTemplate } from '@/lib/prompt-templates';

export interface UsePromptTemplateTriggerOptions {
  /** 当前文本值 */
  value: string;
  /** 更新文本值的回调 */
  onChange: (newValue: string) => void;
  /** textarea/input 的 ref */
  inputRef?: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
}

export interface UsePromptTemplateTriggerReturn {
  /** 是否显示模板弹窗 */
  showPopup: boolean;
  /** 过滤后的模板列表 */
  filteredTemplates: PromptTemplate[];
  /** 当前选中的模板索引 */
  selectedIndex: number;
  /** 搜索关键词 */
  searchQuery: string;
  /** 处理文本变化 */
  handleChange: (e: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  /** 处理键盘事件 */
  handleKeyDown: (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  /** 选择模板 */
  selectTemplate: (template: PromptTemplate) => void;
  /** 关闭弹窗 */
  closePopup: () => void;
}

export function usePromptTemplateTrigger({
  value,
  onChange,
  inputRef,
}: UsePromptTemplateTriggerOptions): UsePromptTemplateTriggerReturn {
  const [showPopup, setShowPopup] = useState(false);
  const [filteredTemplates, setFilteredTemplates] = useState<PromptTemplate[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  
  // 保存原始 onChange 的 ref
  const originalValueRef = useRef(value);
  useEffect(() => {
    originalValueRef.current = value;
  }, [value]);

  const closePopup = useCallback(() => {
    setShowPopup(false);
    setSearchQuery('');
  }, []);

  const selectTemplate = useCallback((template: PromptTemplate) => {
    const input = inputRef?.current;
    const cursorPos = input?.selectionStart || value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastSlashIndex = textBeforeCursor.lastIndexOf('/');
    const textAfterCursor = value.slice(cursorPos);
    
    if (lastSlashIndex >= 0) {
      const newValue = value.slice(0, lastSlashIndex) + template.content + textAfterCursor;
      onChange(newValue);
    }
    
    closePopup();
    // 延迟聚焦，确保 DOM 更新完成
    setTimeout(() => input?.focus(), 0);
  }, [value, onChange, inputRef, closePopup]);

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    
    // 检测 / 触发
    const cursorPos = e.target.selectionStart ?? newValue.length;
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const lastSlashIndex = textBeforeCursor.lastIndexOf('/');
    
    if (lastSlashIndex >= 0) {
      const charBeforeSlash = lastSlashIndex > 0 ? textBeforeCursor[lastSlashIndex - 1] : ' ';
      // 如果 / 在开头或前面是空白，则触发
      if (lastSlashIndex === 0 || /\s/.test(charBeforeSlash)) {
        const query = textBeforeCursor.slice(lastSlashIndex + 1);
        // 如果 / 后面已经有换行或太多字符，不触发
        if (query.includes('\n') || query.length > 30) {
          setShowPopup(false);
          return;
        }
        setSearchQuery(query);
        const results = query ? searchTemplates(query) : getPromptTemplates();
        setFilteredTemplates(results.slice(0, 8));
        setSelectedIndex(0);
        setShowPopup(results.length > 0);
      } else {
        setShowPopup(false);
      }
    } else {
      setShowPopup(false);
    }
  }, [onChange]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (!showPopup || filteredTemplates.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % filteredTemplates.length);
      return;
    }
    
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredTemplates.length) % filteredTemplates.length);
      return;
    }
    
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const selected = filteredTemplates[selectedIndex];
      if (selected) {
        selectTemplate(selected);
      }
      return;
    }
    
    if (e.key === 'Escape') {
      e.preventDefault();
      closePopup();
      return;
    }
  }, [showPopup, filteredTemplates, selectedIndex, selectTemplate, closePopup]);

  return {
    showPopup,
    filteredTemplates,
    selectedIndex,
    searchQuery,
    handleChange,
    handleKeyDown,
    selectTemplate,
    closePopup,
  };
}
