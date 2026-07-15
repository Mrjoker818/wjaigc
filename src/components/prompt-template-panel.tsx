'use client';

import NextImage from 'next/image';
import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Plus, Edit2, Trash2, Search, Tag, FileText, Save, ChevronDown, Image as ImageIcon, Upload } from 'lucide-react';
import { 
  PromptTemplate, 
  getPromptTemplates, 
  addPromptTemplate, 
  updatePromptTemplate, 
  deletePromptTemplate,
  getTemplateCategories
} from '@/lib/prompt-templates';

interface PromptTemplatePanelProps {
  isOpen: boolean;
  onClose: () => void;
  isMonochrome: boolean;
  isAdmin?: boolean;
  onUseTemplate?: (content: string) => void;
}

export default function PromptTemplatePanel({ 
  isOpen, 
  onClose, 
  isMonochrome,
  isAdmin = false,
  onUseTemplate 
}: PromptTemplatePanelProps) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);

  // 表单状态
  const [formName, setFormName] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formIsGlobal, setFormIsGlobal] = useState(false);
  const [formThumbnail, setFormThumbnail] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mc = isMonochrome;

  // 加载模板
  const loadTemplates = useCallback(() => {
    const all = getPromptTemplates();
    setTemplates(all);
    setCategories(getTemplateCategories());
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadTemplates();
    }
  }, [isOpen, loadTemplates]);

  // 过滤模板
  const filteredTemplates = templates.filter(t => {
    const matchCategory = !selectedCategory || t.category === selectedCategory;
    const matchSearch = !searchQuery || 
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchCategory && matchSearch;
  });

  // 重置表单
  const resetForm = () => {
    setFormName('');
    setFormContent('');
    setFormCategory('');
    setFormTags('');
    setFormIsGlobal(false);
    setFormThumbnail('');
    setEditingTemplate(null);
    setIsEditing(false);
    setShowAddForm(false);
  };

  // 开始编辑
  const startEdit = (template: PromptTemplate) => {
    setEditingTemplate(template);
    setFormName(template.name);
    setFormContent(template.content);
    setFormCategory(template.category);
    setFormTags(template.tags.join(', '));
    setFormIsGlobal(template.isGlobal);
    setFormThumbnail(template.thumbnail || '');
    setIsEditing(true);
    setShowAddForm(true);
  };

  // 处理图片上传
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // 限制文件大小 (最大 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('图片大小不能超过 2MB');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      // 压缩图片到合适大小
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 200;
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > maxSize) {
            height = (height * maxSize) / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = (width * maxSize) / height;
            height = maxSize;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        setFormThumbnail(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  };

  // 保存模板
  const handleSave = () => {
    if (!formName.trim() || !formContent.trim()) return;

    const tags = formTags.split(',').map(t => t.trim()).filter(Boolean);

    if (isEditing && editingTemplate) {
      updatePromptTemplate(editingTemplate.id, {
        name: formName,
        content: formContent,
        category: formCategory || '自定义',
        tags,
        thumbnail: formThumbnail || undefined,
        isGlobal: isAdmin ? formIsGlobal : false
      });
    } else {
      addPromptTemplate({
        name: formName,
        content: formContent,
        category: formCategory || '自定义',
        tags,
        thumbnail: formThumbnail || undefined,
        createdBy: isAdmin && formIsGlobal ? 'admin' : 'user',
        isGlobal: isAdmin ? formIsGlobal : false
      });
    }

    resetForm();
    loadTemplates();
  };

  // 删除模板
  const handleDelete = (id: string) => {
    if (confirm('确定要删除这个模板吗？')) {
      deletePromptTemplate(id);
      loadTemplates();
    }
  };

  // 使用模板
  const handleUseTemplate = (template: PromptTemplate) => {
    if (onUseTemplate) {
      onUseTemplate(template.content);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className={`relative w-full max-w-2xl max-h-[80vh] rounded-2xl shadow-2xl flex flex-col ${
        mc ? 'bg-white border border-gray-200' : 'bg-[#1a1a1a] border border-white/[0.12]'
      }`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${
          mc ? 'border-gray-200' : 'border-white/[0.08]'
        }`}>
          <div className="flex items-center gap-3">
            <FileText className={`w-5 h-5 ${mc ? 'text-gray-700' : 'text-gold'}`} />
            <h2 className={`text-lg font-semibold ${mc ? 'text-gray-900' : 'text-foreground'}`}>
              提示词模板
            </h2>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              mc ? 'bg-gray-100 text-gray-600' : 'bg-white/[0.06] text-gold-muted'
            }`}>
              {filteredTemplates.length} 个模板
            </span>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${
              mc ? 'hover:bg-gray-100 text-gray-500' : 'hover:bg-white/[0.06] text-gold-muted'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className={`flex items-center gap-3 px-6 py-3 border-b ${
          mc ? 'border-gray-200' : 'border-white/[0.08]'
        }`}>
          {/* Search */}
          <div className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg ${
            mc ? 'bg-gray-50' : 'bg-white/[0.04]'
          }`}>
            <Search className={`w-4 h-4 ${mc ? 'text-gray-400' : 'text-gold-muted/50'}`} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索模板..."
              className={`flex-1 bg-transparent text-sm outline-none ${
                mc ? 'text-gray-900 placeholder:text-gray-400' : 'text-text-bright placeholder:text-gold-muted/50'
              }`}
            />
          </div>

          {/* Category Filter */}
          <div className="relative">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className={`appearance-none pl-3 pr-8 py-2 rounded-lg text-sm cursor-pointer ${
                mc 
                  ? 'bg-gray-50 text-gray-700 border border-gray-200' 
                  : 'bg-white/[0.04] text-gold-muted border border-white/[0.08]'
              }`}
            >
              <option value="">全部分类</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <ChevronDown className={`absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${
              mc ? 'text-gray-400' : 'text-gold-muted/50'
            }`} />
          </div>

          {/* Add Button */}
          <button
            onClick={() => { resetForm(); setShowAddForm(true); }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              mc 
                ? 'bg-gray-900 text-white hover:bg-gray-800' 
                : 'bg-gold/15 text-gold hover:bg-gold/25 border border-gold/30'
            }`}
          >
            <Plus className="w-4 h-4" />
            新建
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Add/Edit Form */}
          {showAddForm && (
            <div className={`mx-6 my-4 p-4 rounded-xl ${
              mc ? 'bg-gray-50 border border-gray-200' : 'bg-white/[0.03] border border-white/[0.08]'
            }`}>
              <h3 className={`text-sm font-medium mb-3 ${mc ? 'text-gray-700' : 'text-gold'}`}>
                {isEditing ? '编辑模板' : '新建模板'}
              </h3>
              
              <div className="space-y-3">
                {/* Name */}
                <div>
                  <label className={`text-xs mb-1 block ${mc ? 'text-gray-500' : 'text-gold-muted'}`}>
                    模板名称 *
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="例如：照片写实风格"
                    className={`w-full px-3 py-2 rounded-lg text-sm ${
                      mc 
                        ? 'bg-white border border-gray-200 text-gray-900' 
                        : 'bg-[#1a1a1a] border border-white/[0.12] text-text-bright'
                    }`}
                  />
                </div>

                {/* Content */}
                <div>
                  <label className={`text-xs mb-1 block ${mc ? 'text-gray-500' : 'text-gold-muted'}`}>
                    模板内容 * <span className="opacity-60">（使用 {'{subject}'} 作为占位符）</span>
                  </label>
                  <textarea
                    value={formContent}
                    onChange={(e) => setFormContent(e.target.value)}
                    placeholder="A highly detailed image of {subject}, professional photography..."
                    rows={3}
                    className={`w-full px-3 py-2 rounded-lg text-sm resize-none ${
                      mc 
                        ? 'bg-white border border-gray-200 text-gray-900' 
                        : 'bg-[#1a1a1a] border border-white/[0.12] text-text-bright'
                    }`}
                  />
                </div>

                {/* Category & Tags */}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className={`text-xs mb-1 block ${mc ? 'text-gray-500' : 'text-gold-muted'}`}>
                      分类
                    </label>
                    <input
                      type="text"
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      placeholder="例如：风格、场景、人物"
                      className={`w-full px-3 py-2 rounded-lg text-sm ${
                        mc 
                          ? 'bg-white border border-gray-200 text-gray-900' 
                          : 'bg-[#1a1a1a] border border-white/[0.12] text-text-bright'
                      }`}
                    />
                  </div>
                  <div className="flex-1">
                    <label className={`text-xs mb-1 block ${mc ? 'text-gray-500' : 'text-gold-muted'}`}>
                      标签 <span className="opacity-60">（逗号分隔）</span>
                    </label>
                    <input
                      type="text"
                      value={formTags}
                      onChange={(e) => setFormTags(e.target.value)}
                      placeholder="写实, 摄影, 高清"
                      className={`w-full px-3 py-2 rounded-lg text-sm ${
                        mc 
                          ? 'bg-white border border-gray-200 text-gray-900' 
                          : 'bg-[#1a1a1a] border border-white/[0.12] text-text-bright'
                      }`}
                    />
                  </div>
                </div>

                {/* Thumbnail Image Upload */}
                <div>
                  <label className={`text-xs mb-1 block ${mc ? 'text-gray-500' : 'text-gold-muted'}`}>
                    效果图 <span className="opacity-60">（可选，最大 2MB）</span>
                  </label>
                  <div className="flex items-center gap-3">
                    {/* Preview */}
                    <div className={`w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 ${
                      mc ? 'bg-gray-100 border border-gray-200' : 'bg-[#1a1a1a] border border-white/[0.12]'
                    }`}>
                      {formThumbnail ? (
                        <NextImage unoptimized width={1} height={1} src={formThumbnail} alt="预览" className="w-full h-full object-cover" />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center ${
                          mc ? 'text-gray-400' : 'text-white/30'
                        }`}>
                          <ImageIcon className="w-6 h-6" />
                        </div>
                      )}
                    </div>
                    {/* Upload Button */}
                    <div className="flex-1 flex flex-col gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 ${
                          mc 
                            ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' 
                            : 'bg-white/[0.06] hover:bg-white/[0.1] text-gold-muted'
                        }`}
                      >
                        <Upload className="w-3 h-3" />
                        上传图片
                      </button>
                      {formThumbnail && (
                        <button
                          onClick={() => setFormThumbnail('')}
                          className={`px-3 py-1 rounded-lg text-xs ${
                            mc ? 'text-red-500 hover:text-red-600' : 'text-red-400 hover:text-red-300'
                          }`}
                        >
                          移除图片
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Admin: Global toggle */}
                {isAdmin && (
                  <label className={`flex items-center gap-2 text-sm cursor-pointer ${
                    mc ? 'text-gray-700' : 'text-gold-muted'
                  }`}>
                    <input
                      type="checkbox"
                      checked={formIsGlobal}
                      onChange={(e) => setFormIsGlobal(e.target.checked)}
                      className="w-4 h-4 rounded"
                    />
                    全局模板（所有用户可见）
                  </label>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={resetForm}
                    className={`px-4 py-2 rounded-lg text-sm ${
                      mc ? 'text-gray-600 hover:bg-gray-200' : 'text-gold-muted hover:bg-white/[0.06]'
                    }`}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!formName.trim() || !formContent.trim()}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      !formName.trim() || !formContent.trim()
                        ? mc ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white/[0.06] text-gold-muted/50 cursor-not-allowed'
                        : mc ? 'bg-gray-900 text-white hover:bg-gray-800' : 'bg-gold text-black hover:bg-gold/90'
                    }`}
                  >
                    <Save className="w-4 h-4" />
                    保存
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Template List */}
          <div className="px-6 py-4 space-y-2">
            {filteredTemplates.length === 0 ? (
              <div className={`text-center py-12 ${mc ? 'text-gray-400' : 'text-gold-muted/50'}`}>
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">暂无模板</p>
                <p className="text-xs mt-1 opacity-60">点击&ldquo;新建&rdquo;创建你的第一个模板</p>
              </div>
            ) : (
              filteredTemplates.map(template => (
                <div
                  key={template.id}
                  className={`group p-4 rounded-xl transition-all ${
                    mc 
                      ? 'bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm' 
                      : 'bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Thumbnail */}
                    <div className={`w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 ${
                      mc ? 'bg-gray-100 border border-gray-200' : 'bg-[#1a1a1a] border border-white/[0.12]'
                    }`}>
                      {template.thumbnail ? (
                        <NextImage unoptimized width={1} height={1} src={template.thumbnail} alt={template.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center ${
                          mc ? 'text-gray-300' : 'text-white/20'
                        }`}>
                          <ImageIcon className="w-6 h-6" />
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className={`text-sm font-medium truncate ${mc ? 'text-gray-900' : 'text-foreground'}`}>
                          {template.name}
                        </h4>
                        {template.isGlobal && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            mc ? 'bg-blue-100 text-blue-700' : 'bg-blue-500/20 text-blue-400'
                          }`}>
                            全局
                          </span>
                        )}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          mc ? 'bg-gray-100 text-gray-600' : 'bg-white/[0.06] text-gold-muted'
                        }`}>
                          {template.category}
                        </span>
                      </div>
                      <p className={`text-xs line-clamp-2 ${mc ? 'text-gray-500' : 'text-gold-muted/70'}`}>
                        {template.content}
                      </p>
                      {template.tags.length > 0 && (
                        <div className="flex items-center gap-1 mt-2">
                          <Tag className={`w-3 h-3 ${mc ? 'text-gray-400' : 'text-gold-muted/50'}`} />
                          {template.tags.map(tag => (
                            <span
                              key={tag}
                              className={`text-[10px] px-1.5 py-0.5 rounded ${
                                mc ? 'bg-gray-100 text-gray-600' : 'bg-white/[0.04] text-gold-muted/70'
                              }`}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleUseTemplate(template)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        mc ? 'hover:bg-gray-100 text-gray-500' : 'hover:bg-white/[0.06] text-gold-muted'
                      }`}
                      title="使用模板"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => startEdit(template)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        mc ? 'hover:bg-gray-100 text-gray-500' : 'hover:bg-white/[0.06] text-gold-muted'
                      }`}
                      title="编辑"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(template.id)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        mc ? 'hover:bg-red-50 text-gray-500 hover:text-red-600' : 'hover:bg-red-500/10 text-gold-muted hover:text-red-400'
                      }`}
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={`px-6 py-3 border-t text-xs ${
          mc ? 'border-gray-200 text-gray-400' : 'border-white/[0.08] text-gold-muted/50'
        }`}>
          提示：在提示词输入框中输入 <kbd className={`px-1.5 py-0.5 rounded ${
            mc ? 'bg-gray-100 text-gray-600' : 'bg-white/[0.06] text-gold-muted'
          }`}>/</kbd> 可快速选择模板
        </div>
      </div>
    </div>
  );
}
