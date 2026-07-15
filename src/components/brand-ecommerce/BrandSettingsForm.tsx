'use client';

import NextImage from 'next/image';
import { useRef, useCallback } from 'react';
import { Upload, Palette, Sparkles, Loader2, ChevronDown, Package, ShieldCheck, Plus, AlertCircle } from 'lucide-react';
import { getTemplateFieldGroups, getTemplateDisplayName, type TemplateFieldValues, type TemplateFieldDef } from './template-fields';

// ─── Types ────────────────────────────────────────────────────────

interface ImageModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
}

interface LlmModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
}

interface Props {
  // Models
  models: ImageModel[];
  selectedModel: string;
  onSelectModel: (id: string) => void;
  showModelDropdown: boolean;
  onToggleModelDropdown: () => void;
  modelDropdownRef: React.RefObject<HTMLDivElement | null>;

  // LLM
  llmModels: LlmModel[];
  selectedLlmModel: string;
  onSelectLlmModel: (id: string) => void;
  showLlmDropdown: boolean;
  onToggleLlmDropdown: () => void;
  llmDropdownRef: React.RefObject<HTMLDivElement | null>;
  isAssisting: boolean;
  assistError?: string;
  onAiAssist: () => void;

  // Form fields
  productDesc: string;
  onProductDescChange: (v: string) => void;
  mainText: string;
  onMainTextChange: (v: string) => void;
  secondaryText: string;
  onSecondaryTextChange: (v: string) => void;
  accentSymbol: string;
  onAccentSymbolChange: (v: string) => void;
  sceneDesc: string;
  onSceneDescChange: (v: string) => void;
  styleExtra: string;
  onStyleExtraChange: (v: string) => void;

  // Brand colors
  brandColors: string[];
  colorInput: string;
  onColorInputChange: (v: string) => void;
  onAddBrandColor: () => void;
  onRemoveBrandColor: (c: string) => void;

  // Reference image
  refImage: string;
  onFileUpload: (file: File) => void;
  onRemoveRefImage: () => void;

  // Product image
  productImage: string;
  onProductImageUpload: (file: File) => void;
  onRemoveProductImage: () => void;

  // Product consistency
  productConsistencyMode: 'text' | 'fusion' | 'compose';
  onConsistencyModeChange: (mode: 'text' | 'fusion' | 'compose') => void;
  productConsistencyStrength: number;
  onConsistencyStrengthChange: (strength: number) => void;

  // Template-specific fields
  selectedTemplateIds: string[];
  templateFieldValues: TemplateFieldValues;
  onTemplateFieldChange: (templateId: string, fieldKey: string, value: string) => void;
  onAddDetailPage?: () => void;

  isMonochrome?: boolean;
}

// ─── Section wrapper for consistent visual grouping ──────────

function FormSection({
  title,
  required,
  hint,
  children,
  isMonochrome,
}: {
  title: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  isMonochrome?: boolean;
}) {
  return (
    <div>
      <label className={`flex items-center gap-1 text-sm font-medium mb-1.5 ${isMonochrome ? 'text-gray-600' : 'text-gray-400'}`}>
        {title}
        {required && <span className="text-red-400">*</span>}
        {hint && <span className={`text-xs font-normal ${isMonochrome ? 'text-gray-400' : 'text-gray-500'}`}>{hint}</span>}
      </label>
      {children}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────

export function BrandSettingsForm({
  models,
  selectedModel,
  onSelectModel,
  showModelDropdown,
  onToggleModelDropdown,
  modelDropdownRef,

  llmModels,
  selectedLlmModel,
  onSelectLlmModel,
  showLlmDropdown,
  onToggleLlmDropdown,
  llmDropdownRef,
  isAssisting,
  assistError,
  onAiAssist,

  productDesc,
  onProductDescChange,
  mainText,
  onMainTextChange,
  secondaryText,
  onSecondaryTextChange,
  accentSymbol,
  onAccentSymbolChange,
  sceneDesc,
  onSceneDescChange,
  styleExtra,
  onStyleExtraChange,

  brandColors,
  colorInput,
  onColorInputChange,
  onAddBrandColor,
  onRemoveBrandColor,

  refImage,
  onFileUpload,
  onRemoveRefImage,

  productImage,
  onProductImageUpload,
  onRemoveProductImage,

  productConsistencyMode,
  onConsistencyModeChange,
  productConsistencyStrength,
  onConsistencyStrengthChange,

  selectedTemplateIds,
  templateFieldValues,
  onTemplateFieldChange,
  onAddDetailPage,

  isMonochrome = false,
}: Props) {
  const text = isMonochrome ? 'text-gray-900' : 'text-gray-100';
  const textMuted = isMonochrome ? 'text-gray-400' : 'text-gray-500';
  const accent = isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]';
  const accentHover = isMonochrome ? 'hover:bg-blue-600' : 'hover:bg-[#e0b840]';
  const inputBg = isMonochrome ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-white/[0.08]';
  const inputFocus = isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30';
  const border = isMonochrome ? 'border-gray-200' : 'border-white/[0.08]';
  const divider = isMonochrome ? 'border-gray-200' : 'border-white/[0.06]';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const productFileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.[0]) onFileUpload(e.target.files[0]);
    },
    [onFileUpload],
  );

  const handleProductFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onProductImageUpload(file);
      e.target.value = '';
    },
    [onProductImageUpload],
  );

  // Reusable input class
  const inputClass = `w-full px-3 py-2.5 rounded-lg border text-sm ${inputBg} ${text} ${inputFocus} focus:outline-none focus:ring-2 transition-colors`;

  // ─── Template-specific field rendering ───

  /** Render a single template field input */
  const renderFieldInput = (templateId: string, field: TemplateFieldDef) => {
    const currentValue = templateFieldValues[templateId]?.[field.key] ?? field.defaultValue ?? '';
    const handleValueChange = (value: string) => onTemplateFieldChange(templateId, field.key, value);

    if (field.type === 'select' && field.options) {
      return (
        <div className="space-y-1.5">
          <select
            value={currentValue}
            onChange={e => handleValueChange(e.target.value)}
            className={`w-full px-3 py-2.5 rounded-lg border text-sm cursor-pointer ${inputBg} ${text} ${inputFocus} focus:outline-none focus:ring-2 transition-colors appearance-none`}
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
          >
            <option value="">— 请选择 —</option>
            {field.options.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      );
    }

    if (field.type === 'textarea') {
      return (
        <textarea
          value={currentValue}
          onChange={e => handleValueChange(e.target.value)}
          placeholder={field.placeholder}
          rows={field.rows ?? 3}
          className={`w-full px-3 py-2.5 rounded-lg border text-sm ${inputBg} ${text} ${inputFocus} focus:outline-none focus:ring-2 transition-colors resize-y`}
        />
      );
    }

    // Default: text input
    return (
      <input
        type="text"
        value={currentValue}
        onChange={e => handleValueChange(e.target.value)}
        placeholder={field.placeholder}
        className={inputClass}
      />
    );
  };

  /** Render all template-specific field groups for selected templates */
  const renderTemplateFields = () => {
    // Collect unique field groups across all selected templates
    const seenGroupKeys = new Set<string>();
    const renderedGroups: { templateId: string; templateName: string; group: typeof import('./template-fields').TEMPLATE_FIELD_GROUPS[string][number] }[] = [];

    for (const tplId of selectedTemplateIds) {
      const groups = getTemplateFieldGroups(tplId);
      if (groups.length === 0) continue;

      // Get template name from API templates if available
      const tplName = tplId; // Fallback to ID
      for (const group of groups) {
        const groupKey = `${tplId}:${group.title}`;
        if (!seenGroupKeys.has(groupKey)) {
          seenGroupKeys.add(groupKey);
          renderedGroups.push({ templateId: tplId, templateName: tplName, group });
        }
      }
    }

    if (renderedGroups.length === 0) return null;

    return (
      <div className="space-y-4">
        {/* Section header */}
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-1 h-4 rounded-full ${isMonochrome ? 'bg-amber-500' : 'bg-[#d4af37]'}`} />
          <span className={`text-xs font-semibold uppercase tracking-wider ${isMonochrome ? 'text-gray-500' : 'text-gray-400'}`}>
            模板内容定制
          </span>
          <span className={`text-[10px] ${textMuted}`}>
            · {selectedTemplateIds.length} 个已选模板
          </span>
        </div>

        {/* Render each template's field groups */}
        {selectedTemplateIds.map(tplId => {
          const groups = getTemplateFieldGroups(tplId);
          if (groups.length === 0) return null;

          return (
            <div key={tplId} className={`rounded-lg border ${border} overflow-hidden`}>
              {/* Template header */}
              <div className={`flex items-center gap-2 px-3 py-2 ${isMonochrome ? 'bg-gray-50' : 'bg-[#0d0d0d]'}`}>
                <Package size={13} className={isMonochrome ? 'text-gray-400' : 'text-gray-500'} />
                <span className={`text-xs font-semibold ${isMonochrome ? 'text-gray-700' : 'text-gray-300'}`}>
                  {getTemplateDisplayName(tplId)}
                </span>
                {/* 添加详情页按钮 - 仅竖版详情页系列显示 */}
                {(tplId === 'detail-vertical' || tplId.startsWith('detail-vertical-')) && (
                  <button
                    type="button"
                    onClick={() => onAddDetailPage?.()}
                    className={`ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                      isMonochrome
                        ? 'text-amber-600 hover:bg-amber-50 border border-amber-200'
                        : 'text-[#d4af37] hover:bg-[#d4af37]/10 border border-[#d4af37]/30'
                    }`}
                  >
                    <Plus size={10} />
                    添加详情页
                  </button>
                )}
              </div>

              {/* Field groups */}
              <div className="px-3 py-3 space-y-4">
                {groups.map(group => (
                  <div key={group.title}>
                    {/* Group title */}
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-sm">{group.icon}</span>
                      <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-600' : 'text-gray-400'}`}>
                        {group.title}
                      </span>
                    </div>

                    {/* Fields */}
                    <div className="space-y-3 pl-1">
                      {group.fields.map(field => (
                        <div key={field.key}>
                          <label className={`flex items-center gap-1 text-xs font-medium mb-1 ${textMuted}`}>
                            {field.label}
                            {field.required && <span className="text-red-400">*</span>}
                          </label>
                          {renderFieldInput(tplId, field)}
                          {field.hint && (
                            <p className={`text-[10px] mt-1 ${textMuted} opacity-70`}>{field.hint}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* ─── Section: Model Configuration ─── */}
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-1 h-4 rounded-full ${accent}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${isMonochrome ? 'text-gray-500' : 'text-gray-400'}`}>
          模型配置
        </span>
      </div>

      <FormSection title="生成模型" required isMonochrome={isMonochrome}>
        <div className="relative" ref={modelDropdownRef}>
          <button
            onClick={onToggleModelDropdown}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm ${inputBg} ${text} transition-colors cursor-pointer`}
          >
            <span className="truncate">
              {selectedModel ? (models.find(m => m.id === selectedModel)?.name || selectedModel) : '选择模型...'}
            </span>
            <ChevronDown size={14} className={textMuted} />
          </button>
          {showModelDropdown && (
            <div className={`absolute z-50 top-full mt-1 w-full rounded-lg border shadow-xl max-h-64 overflow-y-auto ${
              isMonochrome ? 'bg-white border-gray-200' : 'bg-[#222] border-white/[0.1]'
            }`}>
              {models.length ? models.map(m => (
                <button
                  key={m.id}
                  onClick={() => { onSelectModel(m.id); onToggleModelDropdown(); try { const existing = JSON.parse(localStorage.getItem('wujie_selected_model') || '{}'); localStorage.setItem('wujie_selected_model', JSON.stringify({ ...existing, model: m.id.split('::').pop() || m.id, providerId: m.providerId || '' })); } catch {} }}
                  className={`w-full text-left px-3 py-2.5 text-sm transition-colors cursor-pointer ${
                    m.id === selectedModel
                      ? isMonochrome ? 'bg-blue-50 text-blue-600' : 'bg-[#d4af37]/10 text-[#d4af37]'
                      : isMonochrome ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-[#2a2a2a]'
                  }`}
                >
                  <div className="font-medium">{m.name}</div>
                  {m.providerName && (
                    <div className={`text-xs mt-0.5 ${textMuted}`}>
                      <span className="inline-flex items-center gap-1">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${isMonochrome ? 'bg-gray-400' : 'bg-primary'}`} />
                        {m.providerName}
                      </span>
                    </div>
                  )}
                </button>
              )) : (
                <div className={`px-3 py-4 text-center text-sm ${textMuted}`}>暂无可用模型，请在管理员后台配置图像模型</div>
              )}
            </div>
          )}
        </div>
      </FormSection>

      <FormSection title="LLM 辅助模型" hint="(可选，AI优化提示词)" isMonochrome={isMonochrome}>
        <div className="relative" ref={llmDropdownRef}>
          <button
            onClick={onToggleLlmDropdown}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm ${inputBg} ${text} transition-colors cursor-pointer`}
          >
            <span className="truncate">
              {selectedLlmModel ? (llmModels.find(m => m.id === selectedLlmModel)?.name || selectedLlmModel) : '选择LLM模型...'}
            </span>
            <ChevronDown size={14} className={textMuted} />
          </button>
          {showLlmDropdown && (
            <div className={`absolute z-50 top-full mt-1 w-full rounded-lg border shadow-xl max-h-64 overflow-y-auto ${
              isMonochrome ? 'bg-white border-gray-200' : 'bg-[#222] border-white/[0.1]'
            }`}>
              {llmModels.length ? llmModels.map(m => (
                <button
                  key={m.id}
                  onClick={() => { onSelectLlmModel(m.id); onToggleLlmDropdown(); }}
                  className={`w-full text-left px-3 py-2.5 text-sm transition-colors cursor-pointer ${
                    m.id === selectedLlmModel
                      ? isMonochrome ? 'bg-blue-50 text-blue-600' : 'bg-[#d4af37]/10 text-[#d4af37]'
                      : isMonochrome ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-[#2a2a2a]'
                  }`}
                >
                  <div className="font-medium">{m.name}</div>
                  {m.providerName && (
                    <div className={`text-xs mt-0.5 ${textMuted}`}>
                      <span className="inline-flex items-center gap-1">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${isMonochrome ? 'bg-gray-400' : 'bg-primary'}`} />
                        {m.providerName}
                      </span>
                    </div>
                  )}
                </button>
              )) : (
                <div className={`px-3 py-4 text-center text-sm ${textMuted}`}>暂无可用LLM模型，请在管理员后台配置</div>
              )}
            </div>
          )}
        </div>
      </FormSection>

      {/* AI Assist */}
      {selectedLlmModel && (
        <div>
          <button
            onClick={onAiAssist}
            disabled={isAssisting || !productDesc.trim()}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all duration-200 cursor-pointer ${
              isAssisting
                ? isMonochrome ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-[#2a2a2a] text-gray-500 border-white/[0.05] cursor-not-allowed'
                : isMonochrome ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100' : 'bg-[#d4af37]/10 text-[#d4af37] border-[#d4af37]/20 hover:bg-[#d4af37]/20'
            } ${!productDesc.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isAssisting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {isAssisting ? 'AI 优化中...' : 'AI 辅助优化设计'}
          </button>
          {!productDesc.trim() && (
            <p className={`text-xs mt-1 ${isMonochrome ? 'text-amber-600' : 'text-amber-400'}`}>
              请先填写商品描述后再使用AI辅助
            </p>
          )}
          {productDesc.trim() && (
            <p className={`text-xs mt-1 ${textMuted}`}>LLM将优化商品描述、补充场景和风格关键词</p>
          )}
          {assistError && (
            <p className="text-xs mt-1 text-red-400 flex items-center gap-1">
              <AlertCircle size={12} />
              {assistError}
            </p>
          )}
        </div>
      )}

      {/* ─── Divider ─── */}
      <div className={`border-t ${divider}`} />

      {/* ─── Section: Product Info ─── */}
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-1 h-4 rounded-full ${accent}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${isMonochrome ? 'text-gray-500' : 'text-gray-400'}`}>
          商品信息
        </span>
      </div>

      <FormSection title="商品描述" required isMonochrome={isMonochrome}>
        <textarea
          value={productDesc}
          onChange={e => onProductDescChange(e.target.value)}
          placeholder="描述你的商品，如：高端无线降噪耳机，磨砂黑色，金属质感..."
          rows={3}
          className={`${inputClass} resize-none placeholder:${isMonochrome ? 'text-gray-400' : 'text-gray-600'}`}
        />
      </FormSection>

      <div className="grid grid-cols-2 gap-3">
        <FormSection title="主标题文字" isMonochrome={isMonochrome}>
          <input type="text" value={mainText} onChange={e => onMainTextChange(e.target.value)} placeholder="如：新品上市" className={inputClass} />
        </FormSection>
        <FormSection title="副标题文字" isMonochrome={isMonochrome}>
          <input type="text" value={secondaryText} onChange={e => onSecondaryTextChange(e.target.value)} placeholder="如：限时特惠" className={inputClass} />
        </FormSection>
      </div>

      <FormSection title="强调符号" isMonochrome={isMonochrome}>
        <input type="text" value={accentSymbol} onChange={e => onAccentSymbolChange(e.target.value)} placeholder="如：✦ ★ ♦ ◆ →" className={inputClass} />
      </FormSection>

      {/* ─── Divider ─── */}
      <div className={`border-t ${divider}`} />

      {/* ─── Section: Style & Brand ─── */}
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-1 h-4 rounded-full ${accent}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${isMonochrome ? 'text-gray-500' : 'text-gray-400'}`}>
          风格与品牌
        </span>
      </div>

      <FormSection title="场景描述" isMonochrome={isMonochrome}>
        <input type="text" value={sceneDesc} onChange={e => onSceneDescChange(e.target.value)} placeholder="场景图使用的环境描述，如：现代简约客厅、清新花园..." className={inputClass} />
      </FormSection>

      <FormSection title="风格补充" isMonochrome={isMonochrome}>
        <input type="text" value={styleExtra} onChange={e => onStyleExtraChange(e.target.value)} placeholder="额外的风格关键词，如：高级感、奢华、清新自然..." className={inputClass} />
      </FormSection>

      {/* Brand colors */}
      <FormSection title="品牌色" hint="(最多5个)" isMonochrome={isMonochrome}>
        <div className="flex items-center gap-1.5 mb-2">
          <Palette size={12} className={textMuted} />
          {brandColors.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {brandColors.map(c => (
                <div key={c} className="flex items-center gap-1.5 group">
                  <div className="w-5 h-5 rounded border border-white/10 shadow-sm" style={{ backgroundColor: c }} />
                  <span className={`text-xs font-mono ${isMonochrome ? 'text-gray-500' : 'text-gray-400'}`}>{c}</span>
                  <button
                    onClick={() => onRemoveBrandColor(c)}
                    className={`opacity-0 group-hover:opacity-100 text-xs ${textMuted} hover:text-red-400 transition-opacity cursor-pointer`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <span className={`text-xs ${textMuted}`}>未设置</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="color"
            value={colorInput || '#000000'}
            onChange={e => onColorInputChange(e.target.value)}
            className="w-9 h-9 rounded-lg border cursor-pointer p-0.5"
          />
          <input
            type="text"
            value={colorInput}
            onChange={e => onColorInputChange(e.target.value)}
            placeholder="#HEX 或颜色名"
            className={`flex-1 px-3 py-2 rounded-lg border text-sm ${inputBg} ${text} ${inputFocus} focus:outline-none focus:ring-2`}
            onKeyDown={e => { if (e.key === 'Enter') onAddBrandColor(); }}
          />
          <button
            onClick={onAddBrandColor}
            className={`px-3 py-2 rounded-lg text-sm font-medium ${accent} ${accentHover} ${isMonochrome ? 'text-white' : 'text-black'} transition-colors cursor-pointer`}
          >
            添加
          </button>
        </div>
      </FormSection>

      {/* ─── Divider ─── */}
      <div className={`border-t ${divider}`} />

      {/* ─── Section: Template-specific fields ─── */}
      {selectedTemplateIds.length > 0 && renderTemplateFields()}

      {/* ─── Divider ─── */}
      <div className={`border-t ${divider}`} />
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-1 h-4 rounded-full ${accent}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${isMonochrome ? 'text-gray-500' : 'text-gray-400'}`}>
          参考图片
        </span>
      </div>

      {/* Reference image upload */}
      <FormSection title="参考图" hint="(风格/版式参考)" isMonochrome={isMonochrome}>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        {refImage ? (
          <div className={`relative rounded-lg overflow-hidden border ${border} group`}>
            <NextImage unoptimized width={1} height={1} src={refImage} alt="参考图" className="w-full h-28 object-cover" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${accent} ${isMonochrome ? 'text-white' : 'text-black'} cursor-pointer`}
              >
                更换
              </button>
              <button
                onClick={onRemoveRefImage}
                className="px-2.5 py-1 rounded-md text-xs font-medium bg-red-500/90 text-white cursor-pointer hover:bg-red-500 transition-colors"
              >
                移除
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`w-full h-20 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
              isMonochrome ? 'border-gray-300 hover:border-gray-400 text-gray-400 hover:bg-gray-50' : 'border-white/[0.08] hover:border-white/[0.15] text-gray-500 hover:bg-white/[0.02]'
            }`}
          >
            <Upload size={16} />
            <span className="text-xs">上传风格参考图</span>
          </button>
        )}
      </FormSection>

      {/* Product image upload */}
      <FormSection title="产品图" hint="(保持产品一致性)" isMonochrome={isMonochrome}>
        <input ref={productFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleProductFileChange} />
        {productImage ? (
          <div className="relative group">
            <NextImage unoptimized width={1} height={1} src={productImage} alt="产品图" className="w-full h-28 object-contain rounded-lg border border-white/[0.08]" />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
              <button
                onClick={() => productFileInputRef.current?.click()}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${accent} ${accentHover} ${isMonochrome ? 'text-white' : 'text-black'} transition-colors cursor-pointer`}
              >
                更换
              </button>
              <button
                onClick={onRemoveProductImage}
                className="px-2.5 py-1 rounded-md text-xs font-medium bg-red-500/80 hover:bg-red-500 text-white transition-colors cursor-pointer"
              >
                删除
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => productFileInputRef.current?.click()}
            className={`w-full h-20 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
              isMonochrome ? 'border-gray-300 hover:border-gray-400 text-gray-400 hover:bg-gray-50' : 'border-white/[0.08] hover:border-white/[0.15] text-gray-500 hover:bg-white/[0.02]'
            }`}
          >
            <Package size={16} />
            <span className="text-xs">上传产品实物图</span>
            <span className={`text-[10px] ${textMuted}`}>确保生成图中产品外观一致</span>
          </button>
        )}
      </FormSection>

      {/* Product consistency mode — only shown when product image is uploaded */}
      {productImage && (
        <div className={`rounded-lg border p-3 space-y-3 ${isMonochrome ? 'border-blue-200 bg-blue-50/50' : 'border-[#d4af37]/20 bg-[#d4af37]/5'}`}>
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'} />
            <span className={`text-sm font-medium ${isMonochrome ? 'text-blue-700' : 'text-[#d4af37]'}`}>
              产品一致性
            </span>
          </div>

          {/* Mode selector */}
          <div className="flex gap-1.5">
            {([
              { mode: 'text' as const, label: '文本提示', desc: '关键词描述' },
              { mode: 'fusion' as const, label: '图生图融合', desc: '风格迁移' },
              { mode: 'compose' as const, label: '精准合成', desc: '蒙版保护' },
            ]).map(({ mode, label, desc }) => (
              <button
                key={mode}
                onClick={() => onConsistencyModeChange(mode)}
                className={`flex-1 flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg border text-xs transition-all cursor-pointer ${
                  productConsistencyMode === mode
                    ? isMonochrome
                      ? 'border-blue-400 bg-blue-100 text-blue-700'
                      : 'border-[#d4af37]/50 bg-[#d4af37]/15 text-[#d4af37]'
                    : isMonochrome
                      ? 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                      : 'border-white/[0.06] bg-[#111] text-gray-400 hover:border-white/[0.12]'
                }`}
              >
                <span className="font-medium">{label}</span>
                <span className="text-[10px] opacity-60">{desc}</span>
              </button>
            ))}
          </div>

          {/* Mode description */}
          <p className={`text-xs leading-relaxed ${textMuted}`}>
            {productConsistencyMode === 'text' && '通过文本提示词引导AI保持产品外观一致，兼容性最好，但一致性较弱'}
            {productConsistencyMode === 'fusion' && '将产品图作为图生图输入，AI在产品基础上生成新场景，一致性中等'}
            {productConsistencyMode === 'compose' && '自动提取产品蒙版，先生成场景图，再将原始产品精准合成回画面，一致性最强'}
          </p>

          {/* Strength slider — only for fusion mode */}
          {productConsistencyMode === 'fusion' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className={`text-xs ${textMuted}`}>融合强度</span>
                <span className={`text-xs font-mono ${isMonochrome ? 'text-blue-600' : 'text-[#d4af37]'}`}>
                  {productConsistencyStrength}%
                </span>
              </div>
              <input
                type="range"
                min={20}
                max={90}
                step={5}
                value={productConsistencyStrength}
                onChange={e => onConsistencyStrengthChange(Number(e.target.value))}
                className={`w-full h-1.5 rounded-full appearance-none cursor-pointer ${
                  isMonochrome ? 'accent-blue-500' : 'accent-[#d4af37]'
                }`}
              />
              <div className={`flex justify-between text-[10px] ${textMuted}`}>
                <span>弱（更创意）</span>
                <span>强（更忠实）</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
