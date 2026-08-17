'use client';

import NextImage from 'next/image';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeftFromLine, Bookmark, BookmarkPlus, ChevronDown, ChevronLeft, ChevronRight,
  FileText, GitBranch, GitMerge, Globe, Grid3X3, Image as ImageIcon, ImageDown,
  ImagePlus, Layers, Loader2, Maximize, MessageSquare, Mic, Paintbrush, Palette,
  PenTool, Play, RefreshCw, Repeat, Rotate3d, ScanSearch, Scissors, Settings,
  ShoppingBag, Sparkles, Sun, Type, Video, FileVideo, Volume2, Music, Camera,
  Clapperboard, Scissors as CutIcon, AudioLines, Brain, Bot, Wand2, Pencil,
  SlidersHorizontal, Box, X, GitCompare,
} from 'lucide-react';

import type { NodePort, NodeType, WorkflowNode } from '@/lib/workflow-engine';
import { getModelDisplayName } from '@/lib/model-name-map';
import {
  getWorkflowRenderNodeCategory,
  WORKFLOW_RENDER_NODE_COLORS,
  WORKFLOW_RENDER_NODE_ICONS,
  WORKFLOW_RENDER_PORT_COLORS as PORT_COLORS,
} from '@/lib/workflow-renderer/presentation';

export interface WorkflowLegacyModelOption {
  id: string;
  name: string;
  type: string;
  provider: string;
  providerId?: string;
  apiDisplayName?: string;
}

export interface WorkflowLegacyCanvasImageRef {
  id: string;
  url: string;
  name: string;
  description: string;
  label?: string;
  width?: number;
  height?: number;
  versionId?: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
  projectId?: string;
}

export interface WorkflowLegacyPromptPreset {
  id: string;
  name: string;
  text: string;
}

export interface WorkflowLegacyPortRenderProps {
  nodeId: string;
  port: NodePort;
  direction: 'in' | 'out';
  className: string;
  style: React.CSSProperties;
  title: string;
}

export interface WorkflowLegacyPromptTemplate {
  id: string;
  name: string;
  content: string;
  category: string;
  tags: string[];
  thumbnail?: string;
}

export function filterWorkflowPromptTemplates(
  templates: ReadonlyArray<WorkflowLegacyPromptTemplate>,
  query: string,
): WorkflowLegacyPromptTemplate[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...templates];
  return templates.filter(template => (
    template.name.toLocaleLowerCase().includes(normalizedQuery)
    || template.content.toLocaleLowerCase().includes(normalizedQuery)
    || template.category.toLocaleLowerCase().includes(normalizedQuery)
    || template.tags.some(tag => tag.toLocaleLowerCase().includes(normalizedQuery))
  ));
}

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Image: ImageIcon, Type, SlidersHorizontal, Wand2, Pencil, Maximize, Scissors,
  PenTool, Palette, Sun, GitBranch, GitMerge, Repeat, RefreshCw, Layers,
  Bot, MessageSquare, ImageDown, ScanSearch, Sparkles, Rotate3d, Box, ShoppingBag,
  Video, FileVideo, Mic, Volume2, Music, Camera, Clapperboard, CutIcon, Globe, AudioLines, Brain,
};

function getNodeIcon(type: NodeType, size = 14, className = '') {
  const iconName = WORKFLOW_RENDER_NODE_ICONS[type];
  const IconComp = ICON_MAP[iconName] || Settings;
  return <IconComp size={size} className={className} />;
}
// ==================== 节点卡片 ====================

export type WorkflowLegacyNodeTheme = Record<string, string>;

export interface WorkflowLegacyNodeCardProps {
  node: WorkflowNode;
  isSelected: boolean;
  isHighlighted: boolean;
  isHovered: boolean;
  execResult?: { status: string; output?: Record<string, unknown>; error?: string };
  isRunning: boolean;
  theme: WorkflowLegacyNodeTheme;
  canvasImages?: WorkflowLegacyCanvasImageRef[];
  llmModels?: WorkflowLegacyModelOption[];
  imageModels?: WorkflowLegacyModelOption[];
  onNodeFieldChange?: (nodeId: string, fieldId: string, value: unknown) => void;
  onLlmOptimize?: (nodeId: string, prompt: string, model: string, systemPrompt: string, instruction: string) => void;
  onCascadeRun?: (nodeId: string) => void;
  onExtractToSource?: (nodeId: string) => void;
  onGridSplit?: (nodeId: string, cols: number, rows: number) => void;
  onCompare?: (nodeId: string) => void;
  onTriggerImageUpload?: (nodeId: string) => void;
  onImageFileDrop?: (nodeId: string, file: File) => void;
  promptPresets?: WorkflowLegacyPromptPreset[];
  promptTemplates?: WorkflowLegacyPromptTemplate[];
  onSavePromptPreset?: (name: string, text: string) => void;
  onDeletePromptPreset?: (presetId: string) => void;
  upstreamImageUrl?: string;
  onSelect: (e?: React.MouseEvent) => void;
  onHover: (id: string | null) => void;
  onDragStart: (e: React.MouseEvent) => void;
  onPortMouseDown: (e: React.MouseEvent, nodeId: string, port: NodePort) => void;
  onPortMouseUp: (nodeId: string, port: NodePort) => void;
  onDelete: () => void;
  onDeselect: () => void;
  onPreviewImage: (url: string) => void;
  onResizeNode?: (nodeId: string, imageUrl: string) => void;
  onUpdateNodeSize?: (nodeId: string, width: number, height: number) => void;
  collapsedNodes?: Set<string>;
  onToggleCollapse?: (nodeId: string) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDoubleClickAnnotation?: () => void;
  layout?: 'canvas' | 'embedded';
  renderPortHandle?: (props: WorkflowLegacyPortRenderProps) => React.ReactNode;
}

/** output-image-group 节点内容: 多图分页浏览 */
function OutputImageGroupContent({ imageUrls, theme: T, onPreviewImage }: {
  imageUrls: string[];
  theme: Record<string, string>;
  onPreviewImage: (url: string) => void;
}) {
  const [page, setPage] = useState(0);
  const total = imageUrls.length;
  const currentUrl = total > 0 ? imageUrls[page] : '';

  return (
    <div className="w-full h-full flex flex-col gap-1" onWheel={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {total > 0 && currentUrl ? (
        /* 有图片时显示当前页图片 */
        <div
          className="flex-1 w-full relative group cursor-pointer flex items-center justify-center rounded overflow-hidden"
          style={{ background: T.nodeBg === '#161b22' ? '#1c2128' : '#f0f0f0' }}
          onClick={() => onPreviewImage(currentUrl)}
        >
          <NextImage unoptimized width={1} height={1} src={currentUrl} alt={`图片 ${page + 1}`} className="max-w-full max-h-full object-contain transition-opacity opacity-90 group-hover:opacity-100" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <span className="opacity-0 group-hover:opacity-100 text-white text-xs bg-black/50 px-2 py-0.5 rounded transition-opacity">预览</span>
          </div>
        </div>
      ) : (
        /* 无图片时显示虚线占位框 */
        <div
          className="flex-1 w-full flex flex-col items-center justify-center gap-1.5 rounded border-2 border-dashed transition-colors"
          style={{
            borderColor: T.accent + '40',
            background: T.nodeBg === '#161b22' ? '#1c2128' : '#fafafa',
          }}
        >
          <Layers size={22} style={{ color: T.accent, opacity: 0.35 }} />
          <span className="text-[10px] font-medium" style={{ color: T.nodeBg === '#161b22' ? '#8b949e' : '#999' }}>等待图片组</span>
        </div>
      )}
      {/* 分页控件 */}
      {total > 1 && (
        <div className="flex items-center justify-center gap-1 shrink-0">
          <button
            className="w-5 h-5 flex items-center justify-center rounded transition-colors cursor-pointer"
            style={{ background: T.btnBg, color: T.btnText }}
            onClick={(e) => { e.stopPropagation(); setPage(Math.max(0, page - 1)); }}
            disabled={page === 0}
          >
            <ChevronLeft size={12} />
          </button>
          <span className="text-[9px] font-mono min-w-[28px] text-center" style={{ color: T.textMuted }}>
            {page + 1}/{total}
          </span>
          <button
            className="w-5 h-5 flex items-center justify-center rounded transition-colors cursor-pointer"
            style={{ background: T.btnBg, color: T.btnText }}
            onClick={(e) => { e.stopPropagation(); setPage(Math.min(total - 1, page + 1)); }}
            disabled={page >= total - 1}
          >
            <ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

export const WorkflowLegacyNodeCard = React.memo(function WorkflowLegacyNodeCard({ node, isSelected, isHovered, execResult, isRunning, theme, canvasImages, llmModels, imageModels, onNodeFieldChange, onLlmOptimize, onCascadeRun, onExtractToSource, onGridSplit, onCompare, onTriggerImageUpload, onImageFileDrop, promptPresets = [], promptTemplates = [], onSavePromptPreset, onDeletePromptPreset, upstreamImageUrl, onSelect, onHover, onDragStart, onPortMouseDown, onPortMouseUp, onDeselect, onPreviewImage, onResizeNode, onUpdateNodeSize, collapsedNodes, onToggleCollapse, onContextMenu, onDoubleClickAnnotation, layout = 'canvas', renderPortHandle }: WorkflowLegacyNodeCardProps) {
  const T = theme;
  const cat = getWorkflowRenderNodeCategory(node.type);
  const color = WORKFLOW_RENDER_NODE_COLORS[cat];
  const nodeRef = useRef<HTMLDivElement>(null);

  // 自动测量节点实际尺寸并同步到node.width/height
  useEffect(() => {
    if (!nodeRef.current || !onUpdateNodeSize) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (Math.abs(width - node.width) > 2 || Math.abs(height - node.height) > 2) {
          onUpdateNodeSize(node.id, width, height);
        }
      }
    });
    observer.observe(nodeRef.current);
    return () => observer.disconnect();
  }, [node.id, node.width, node.height, onUpdateNodeSize]);
  const inputPorts = node.ports.filter(p => p.direction === 'in');
  const outputPorts = node.ports.filter(p => p.direction === 'out');
  const renderPortDot = (port: NodePort, direction: 'in' | 'out', style: React.CSSProperties) => {
    const props: WorkflowLegacyPortRenderProps = {
      nodeId: node.id,
      port,
      direction,
      className: `port-dot ${direction === 'in' ? 'input-port' : 'output-port'}`,
      style,
      title: port.label,
    };
    if (renderPortHandle) return renderPortHandle(props);
    return <div
      className={props.className}
      data-port-id={`${node.id}-${direction}-${port.id}`}
      style={style}
      onMouseDown={direction === 'out' ? event => { event.stopPropagation(); onPortMouseDown(event, node.id, port); } : undefined}
      onMouseUp={direction === 'in' ? event => { event.stopPropagation(); onPortMouseUp(node.id, port); } : undefined}
      title={port.label}
    />;
  };
  const isCondition = node.type.startsWith('condition-');
  const isInputText = node.type === 'input-text';
  const isInputImage = node.type === 'input-image';
  const isOutputImage = node.type === 'output-image';
  const isOutputImageGroup = node.type === 'output-image-group';

  // 图片URL: 优先执行结果, 其次节点配置(input-image节点)
  const hasImageOutput = (execResult?.output?.imageUrl || node.config?.imageUrl) as string | undefined;
  // 画布模式专用节点标记
  const isCanvasFeature = ['ai-font-design', 'ai-refine-engine', 'ai-human-repair', 'ai-brand-ecommerce', 'ai-segment', 'ai-multi-angle', 'ai-3d-model'].includes(node.type);
  const isCollapsed = collapsedNodes?.has(node.id) ?? false;

  // P0: input-text 节点内嵌功能状态
  const llmEnabled = node.config?.llmEnabled as boolean ?? false;
  const llmModel = node.config?.llmModel as string ?? '';
  const llmInstruction = node.config?.llmInstruction as string ?? '';
  const llmSystemEnabled = node.config?.llmSystemEnabled as boolean ?? false;
  const llmSystemPrompt = node.config?.llmSystemPrompt as string ?? '';
  const textContent = node.config?.textContent as string ?? '';

  // 提示词模板触发状态
  const [showTemplatePopup, setShowTemplatePopup] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templatePopupIndex, setTemplatePopupIndex] = useState(0);
  const [hoveredTemplateId, setHoveredTemplateId] = useState<string | null>(null);
  const [thumbnailRect, setThumbnailRect] = useState<DOMRect | null>(null);
  const filteredTemplates = useMemo(
    () => filterWorkflowPromptTemplates(promptTemplates, templateSearch),
    [promptTemplates, templateSearch],
  );

  // P0: 解析文本中的 [img:id] 引用，渲染为缩略图
  // P1: The host owns persistence; this renderer keeps only popup state.
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetSaving, setPresetSaving] = useState(false);
  const [presetName, setPresetName] = useState('');

  const savePreset = (name: string, text: string) => {
    if (!name.trim() || !text.trim()) return;
    onSavePromptPreset?.(name.trim(), text);
    setPresetSaving(false);
    setPresetName('');
  };

  const deletePreset = (id: string) => {
    onDeletePromptPreset?.(id);
  };

  // 拖拽上传处理 (input-image 节点)
  const handleDragOver = (e: React.DragEvent) => {
    if (!isInputImage) return;
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!isInputImage) return;
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    onImageFileDrop?.(node.id, file);
  };

  return (
    <div
      ref={nodeRef}
      data-node-id={node.id}
      className={`node-card ${isSelected ? 'selected' : ''} ${isCollapsed ? 'collapsed' : ''} ${isInputText ? 'prompt-node' : isInputImage || isOutputImage ? 'image-node' : 'generator-node'}`}
      style={{
        left: layout === 'canvas' ? node.x : 0,
        top: layout === 'canvas' ? node.y : 0,
        width: node.width,
        minHeight: isCollapsed ? 45 : node.height,
        height: isCollapsed ? 45 : 'auto',
        zIndex: isSelected ? 10 : isHovered ? 5 : 1,
      }}
      aria-label={node.label}
      tabIndex={0}
      onMouseDown={(e) => {
        e.stopPropagation();
        onSelect(e);
        if (layout === 'canvas') onDragStart(e);
      }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onContextMenu={onContextMenu}
      onDoubleClick={(event) => {
        if (node.type !== 'ai-annotation-edit') return;
        event.stopPropagation();
        onDoubleClickAnnotation?.();
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 分类色条 - 顶部3px */}
      <div className="node-type-bar" style={{ background: color, opacity: 0.85 }} />

      {/* 执行成功光圈 */}
      {execResult?.status === 'success' && !isSelected && (
        <div className="absolute -inset-[3px] rounded-[18px] pointer-events-none" style={{ border: `1.5px solid ${T.statusSuccess}`, opacity: 0.5, animation: 'fadeOut 1.5s ease-out forwards' }} />
      )}

      {/* ===== 节点标题区 — 42px高度 ===== */}
      {!isCondition && (
        <div className="node-header" style={{ background: `${color}0F` }}>
          <div className="node-header-left">
            <div className="flex items-center justify-center w-[22px] h-[22px] rounded-md" style={{ background: color + '20', color }}>
              {getNodeIcon(node.type, 12)}
            </div>
            <div className="node-header-title">
              <span className="truncate block">{node.label.toUpperCase()}</span>
            </div>
          </div>
          {/* 折叠开关 */}
          <button
            className="collapse-toggle"
            onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(node.id); }}
            aria-label={collapsedNodes?.has(node.id) ? '展开节点' : '折叠节点'}
            tabIndex={0}
          >
            <ChevronDown size={12} style={{ transition: 'transform 0.2s ease', transform: collapsedNodes?.has(node.id) ? 'rotate(0deg)' : 'rotate(180deg)' }} />
          </button>
          {/* 状态徽章 */}
          {execResult?.status === 'running' && (
            <span className="status-badge running"><span className="status-dot" />运行中</span>
          )}
          {execResult?.status === 'success' && (
            <span className="status-badge done"><span className="status-dot" />完成</span>
          )}
          {execResult?.status === 'error' && (
            <span className="status-badge failed"><span className="status-dot" />失败</span>
          )}
          {!execResult && !isRunning && (
            <span className="status-badge queued"><span className="status-dot" />就绪</span>
          )}
          {isRunning && !execResult && (
            <span className="status-badge running"><span className="status-dot" />运行中</span>
          )}
        </div>
      )}

      {/* ===== 节点体内容 (非折叠时显示) ===== */}
      {!isCollapsed && !isCondition && (
        <div className="node-body">
          {/* input-text 节点: 文本编辑 + LLM优化 + 预设 */}
          {isInputText && (
            <div className="flex flex-col gap-1.5 relative" style={{ color: T.nodeTitle, fontSize: 12 }} onWheel={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <textarea
                className="prompt-textarea"
                placeholder="输入提示词... (输入 / 使用模板)"
                value={textContent}
                onChange={(e) => {
                  e.stopPropagation();
                  const val = e.target.value;
                  onNodeFieldChange?.(node.id, 'textContent', val);
                  if (val.endsWith('/')) {
                    setShowTemplatePopup(true);
                    setTemplateSearch('');
                    setTemplatePopupIndex(0);
                  } else if (showTemplatePopup) {
                    const slashIdx = val.lastIndexOf('/');
                    if (slashIdx >= 0) {
                      const afterSlash = val.slice(slashIdx + 1);
                      if (!afterSlash.includes(' ') && !afterSlash.includes('\n')) {
                        setTemplateSearch(afterSlash);
                        setTemplatePopupIndex(0);
                      } else {
                        setShowTemplatePopup(false);
                      }
                    } else {
                      setShowTemplatePopup(false);
                    }
                  }
                }}
                onKeyDown={(e) => {
                  if (showTemplatePopup && filteredTemplates.length > 0) {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      e.stopPropagation();
                      setTemplatePopupIndex((i) => (i - 1 + filteredTemplates.length) % filteredTemplates.length);
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      e.stopPropagation();
                      setTemplatePopupIndex((i) => (i + 1) % filteredTemplates.length);
                    } else if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      e.stopPropagation();
                      const tpl = filteredTemplates[templatePopupIndex];
                      if (tpl) {
                        const val = textContent;
                        const slashIdx = val.lastIndexOf('/');
                        const before = val.slice(0, slashIdx);
                        onNodeFieldChange?.(node.id, 'textContent', before + tpl.content);
                        setShowTemplatePopup(false);
                      }
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowTemplatePopup(false);
                    }
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                rows={3}
              />
              {showTemplatePopup && filteredTemplates.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-white/10 bg-[#1a1a1a] shadow-xl z-50">
                  <div className="max-h-48 overflow-y-auto overscroll-contain rounded-lg">
                  {filteredTemplates.slice(0, 20).map((tpl, i) => (
                    <button
                      key={tpl.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        const val = textContent;
                        const slashIdx = val.lastIndexOf('/');
                        const before = val.slice(0, slashIdx);
                        onNodeFieldChange?.(node.id, 'textContent', before + tpl.content);
                        setShowTemplatePopup(false);
                      }}
                      onMouseEnter={(e) => {
                        if (tpl.thumbnail) {
                          setHoveredTemplateId(tpl.id);
                          setThumbnailRect(e.currentTarget.getBoundingClientRect());
                        }
                      }}
                      onMouseLeave={() => setHoveredTemplateId(null)}
                      className={`w-full text-left px-3 py-2 text-sm border-b border-white/5 last:border-0 transition-colors relative ${i === templatePopupIndex ? 'bg-[#d4af37]/20 text-white' : 'text-gray-300 hover:bg-white/5'}`}
                    >
                      <div className="flex items-center gap-2">
                        {tpl.thumbnail ? (
                          <NextImage unoptimized width={1} height={1} src={tpl.thumbnail} alt={tpl.name} className="w-6 h-6 rounded object-cover flex-shrink-0 border border-white/10" />
                        ) : (
                          <FileText className="w-3.5 h-3.5 flex-shrink-0 text-gold-muted/50" />
                        )}
                        <span className="font-medium truncate">{tpl.name}</span>
                      </div>
                      <div className="text-xs text-gray-500 truncate mt-0.5 pl-8">{tpl.content}</div>
                    </button>
                  ))}
                  </div>
                  {/* Floating thumbnail - portal to body to avoid overflow clipping */}
                  {hoveredTemplateId && (() => {
                    const tpl = filteredTemplates.find(t => t.id === hoveredTemplateId);
                    if (!tpl?.thumbnail || !thumbnailRect) return null;
                    return createPortal(
                      <div
                        className="fixed z-[9999] pointer-events-none"
                        style={{
                          left: thumbnailRect.left - 160,
                          top: Math.max(8, thumbnailRect.top - 40),
                        }}
                      >
                        <div className="rounded-lg shadow-2xl overflow-hidden border border-white/10 bg-[#1a1a1a]">
                          <NextImage unoptimized width={1} height={1} src={tpl.thumbnail} alt={tpl.name} className="w-36 h-36 object-cover" />
                          <div className="px-2 py-1 text-[10px] truncate text-gold-muted">{tpl.name}</div>
                        </div>
                      </div>,
                      document.body
                    );
                  })()}
                </div>
              )}
              {canvasImages?.length && textContent.includes('[img:') && (
                <div className="flex gap-0.5 flex-wrap">
                  {textContent.split(/(\[img:[^\]]+\])/g).filter(p => p.match(/^\[img:/)).map((ref, i) => {
                    const id = ref.match(/^\[img:(.+)\]$/)?.[1];
                    const img = canvasImages.find(ci => ci.id === id);
                    return img ? (
                      <NextImage unoptimized width={1} height={1} key={i} src={img.url} alt="" className="w-5 h-5 rounded object-cover border border-border/50" title={img.name || id} onClick={(e) => { e.stopPropagation(); onPreviewImage(img.url); }} />
                    ) : null;
                  })}
                </div>
              )}
              <div className="flex items-center gap-1">
                <button
                  className={`px-1.5 py-0.5 rounded text-[9px] font-medium cursor-pointer transition-colors flex items-center gap-0.5 ${llmEnabled ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                  onClick={(e) => { e.stopPropagation(); onNodeFieldChange?.(node.id, 'llmEnabled', !llmEnabled); }}
                  title="LLM 提示词优化"
                >
                  <Sparkles size={9} /> LLM
                </button>
                <div className="relative">
                  <button
                    className="px-1.5 py-0.5 rounded text-[9px] font-medium cursor-pointer transition-colors bg-muted text-muted-foreground hover:bg-muted/80 flex items-center gap-0.5"
                    onClick={(e) => { e.stopPropagation(); setPresetOpen(!presetOpen); }}
                    title="提示词预设"
                  >
                    <Bookmark size={9} /> 预设
                  </button>
                  {presetOpen && (
                    <div className="absolute left-0 top-full mt-0.5 z-50 bg-popover border border-border rounded shadow-lg min-w-[140px] max-h-[120px] overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
                      {!presetSaving ? (
                        <button className="block w-full text-left px-2 py-1 text-[10px] hover:bg-muted text-primary flex items-center gap-1" onClick={(e) => { e.stopPropagation(); setPresetSaving(true); }}>
                          <BookmarkPlus size={9} /> 保存为预设
                        </button>
                      ) : (
                        <div className="flex items-center gap-1 px-2 py-1">
                          <input type="text" className="flex-1 text-[9px] rounded px-1 py-0.5 outline-none min-w-0" style={{ background: T.nodeBody, color: T.text, border: `1px solid ${T.border}` }} placeholder="预设名称" value={presetName} onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { savePreset(presetName, textContent); } if (e.key === 'Escape') { setPresetSaving(false); setPresetName(''); } }} autoFocus />
                          <button className="text-[9px] text-primary hover:opacity-80 shrink-0" onClick={() => savePreset(presetName, textContent)}>✓</button>
                        </div>
                      )}
                      {promptPresets.length > 0 && <div className="border-t border-border" />}
                      {promptPresets.map(p => (
                        <div key={p.id} className="flex items-center gap-0.5 px-1 py-0.5 hover:bg-muted group">
                          <button className="flex-1 text-left text-[10px] truncate cursor-pointer" onClick={(e) => { e.stopPropagation(); onNodeFieldChange?.(node.id, 'textContent', p.text); setPresetOpen(false); }}>{p.name}</button>
                          <button className="text-[8px] text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 shrink-0 cursor-pointer" onClick={(e) => { e.stopPropagation(); deletePreset(p.id); }} title="删除预设">×</button>
                        </div>
                      ))}
                      {promptPresets.length === 0 && !presetSaving && (<div className="px-2 py-1 text-[9px] text-muted-foreground">暂无预设</div>)}
                    </div>
                  )}
                </div>
                <button className="px-1.5 py-0.5 rounded text-[9px] font-medium cursor-pointer transition-colors bg-muted text-muted-foreground hover:bg-muted/80 flex items-center gap-0.5" onClick={(e) => { e.stopPropagation(); onCascadeRun?.(node.id); }} title="运行此链">
                  <Play size={9} /> 运行链
                </button>
              </div>

              {llmEnabled && (
                <div className="mt-1 flex flex-col gap-1 p-1.5 rounded" style={{ background: T.inputBg, border: `1px solid ${T.border}` }}>
                  <select className="w-full text-[9px] rounded px-1 py-0.5 outline-none" style={{ background: T.nodeBody, color: T.text, border: `1px solid ${T.border}` }} value={llmModel} onChange={(e) => { e.stopPropagation(); onNodeFieldChange?.(node.id, 'llmModel', e.target.value); }} onMouseDown={(e) => e.stopPropagation()}>
                    <option value="">选择模型</option>
                    {(llmModels ?? []).map(m => <option key={m.id} value={m.id} style={{ background: T.optionBg, color: T.optionText }}>{m.apiDisplayName || m.name || getModelDisplayName(m.id)}{m.provider ? ` (${m.provider})` : ''}</option>)}
                  </select>
                  <input type="text" className="w-full text-[9px] rounded px-1 py-0.5 outline-none" style={{ background: T.nodeBody, color: T.text, border: `1px solid ${T.border}` }} placeholder="优化指令 (如: 优化为英文)" value={llmInstruction} onChange={(e) => { e.stopPropagation(); onNodeFieldChange?.(node.id, 'llmInstruction', e.target.value); }} onMouseDown={(e) => e.stopPropagation()} />
                  <div className="flex items-center gap-1">
                    <button className={`text-[8px] cursor-pointer ${llmSystemEnabled ? 'text-primary' : 'text-muted-foreground'}`} onClick={(e) => { e.stopPropagation(); onNodeFieldChange?.(node.id, 'llmSystemEnabled', !llmSystemEnabled); }}>
                      {llmSystemEnabled ? '●' : '○'} 系统提示
                    </button>
                    <button className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-medium cursor-pointer bg-primary text-white hover:opacity-80 flex items-center gap-0.5 disabled:opacity-50 disabled:cursor-not-allowed" onClick={(e) => { e.stopPropagation(); onLlmOptimize?.(node.id, String(node.config?.textContent || ''), String(node.config?.llmModel || ''), String(node.config?.llmSystemPrompt || ''), String(node.config?.llmInstruction || '')); }} disabled={isRunning || !!node.config?.llmOptimizing} title="运行 LLM 优化">
                      {node.config?.llmOptimizing ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />} {node.config?.llmOptimizing ? '优化中...' : '优化'}
                    </button>
                  </div>
                  {llmSystemEnabled && (
                    <input type="text" className="w-full text-[9px] rounded px-1 py-0.5 outline-none" style={{ background: T.nodeBody, color: T.text, border: `1px solid ${T.border}` }} placeholder="系统提示词" value={llmSystemPrompt} onChange={(e) => { e.stopPropagation(); onNodeFieldChange?.(node.id, 'llmSystemPrompt', e.target.value); }} onMouseDown={(e) => e.stopPropagation()} />
                  )}
                </div>
              )}
              {/* 输出端口行 */}
              {outputPorts.map((port) => {
                const portColor = PORT_COLORS[port.type] || T.connColor;
                return (
                  <div key={port.id} className="port-row" style={{ marginTop: 8 }}>
                    <div className="port-dot input-port" style={{ visibility: 'hidden' }} />
                    <span className="port-label">{port.label}</span>
                    {renderPortDot(port, 'out', { borderColor: portColor, color: portColor })}
                  </div>
                );
              })}
            </div>
          )}

          {/* input-image 节点: 图片预览 + 拖拽上传区 */}
          {isInputImage && (
            <div className="flex flex-col gap-1.5" style={{ color: T.nodeTitle, fontSize: 10 }} onWheel={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <div className="image-preview has-image">
                {hasImageOutput ? (
                  <div
                    className="w-full h-full relative group cursor-pointer"
                    style={{ background: '#1c2128' }}
                    onClick={() => onPreviewImage(hasImageOutput)}
                  >
                    <NextImage unoptimized width={1} height={1} src={hasImageOutput} alt="" className="image-preview img" style={{ objectFit: 'cover' }} />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 text-white text-xs bg-black/50 px-2 py-0.5 rounded transition-opacity">预览</span>
                    </div>
                  </div>
                ) : (
                  <div
                    className="image-preview empty cursor-pointer"
                    style={{ aspectRatio: '4/3' }}
                    onClick={() => onTriggerImageUpload?.(node.id)}
                  >
                    <div className="flex flex-col items-center gap-1.5 text-muted-foreground/50">
                      <ImagePlus size={24} />
                      <span className="text-[10px]">拖拽或点击上传</span>
                    </div>
                  </div>
                )}
              </div>
              {!hasImageOutput && (
                <input
                  type="text"
                  placeholder="粘贴图片 URL..."
                  className="w-full px-2 py-0.5 rounded text-[10px] border outline-none transition-colors"
                  style={{
                    background: '#1c2128',
                    borderColor: T.cardBorder,
                    color: T.nodeTitle,
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const url = (e.target as HTMLInputElement).value.trim();
                      if (url) {
                        onNodeFieldChange?.(node.id, 'imageUrl', url);
                        onNodeFieldChange?.(node.id, 'source', 'url');
                        onResizeNode?.(node.id, url);
                        (e.target as HTMLInputElement).value = '';
                      }
                    }
                  }}
                />
              )}
              {hasImageOutput && (
                <div className="flex gap-0.5 items-center">
                  <button className="px-1 py-0 rounded text-[8px] font-medium cursor-pointer bg-muted/60 text-muted-foreground hover:bg-muted flex items-center gap-0.5" onClick={(e) => { e.stopPropagation(); onExtractToSource?.(node.id); }} title="抽取为源节点">
                    <ArrowLeftFromLine size={8} /> 抽取
                  </button>
                  <button className="px-1 py-0 rounded text-[8px] font-medium cursor-pointer bg-muted/60 text-muted-foreground hover:bg-muted flex items-center gap-0.5" onClick={(e) => { e.stopPropagation(); onGridSplit?.(node.id, Number(node.config?.gridCols || 2), Number(node.config?.gridRows || 2)); }} title="宫格切分">
                    <Grid3X3 size={8} /> 切分
                  </button>
                  {upstreamImageUrl && (
                    <button className="px-1 py-0 rounded text-[8px] font-medium cursor-pointer bg-muted/60 text-muted-foreground hover:bg-muted flex items-center gap-0.5" onClick={(e) => { e.stopPropagation(); onCompare?.(node.id); }} title="对比原图">
                      <GitCompare size={8} /> 对比
                    </button>
                  )}
                  <button className="px-1 py-0 rounded text-[8px] font-medium cursor-pointer bg-muted/60 text-muted-foreground hover:bg-muted flex items-center gap-0.5 ml-auto" onClick={(e) => { e.stopPropagation(); onCascadeRun?.(node.id); }} title="运行此链">
                    <Play size={8} /> 运行链
                  </button>
                </div>
              )}
              {/* 输出端口行 */}
              {outputPorts.map((port) => {
                const portColor = PORT_COLORS[port.type] || T.connColor;
                return (
                  <div key={port.id} className="port-row" style={{ padding: '4px 12px' }}>
                    <div className="port-dot hidden" />
                    <span className="port-label" style={{ color: T.nodePortText, fontSize: 10 }}>{port.label}</span>
                    {renderPortDot(port, 'out', { borderColor: portColor, color: portColor })}
                  </div>
                );
              })}
            </div>
          )}

          {/* AI 生成类节点: input-card + port-row + 下拉选择 + RUN按钮 */}
          {!isInputText && !isInputImage && !isOutputImage && !isOutputImageGroup && !hasImageOutput && (node.type.startsWith('ai-') || node.type === 'output-image') && (
            <div className="flex flex-col gap-0">
              {/* 输入端口行 - input-card 模式（带图标+名称+端口点） */}
              {inputPorts.map((port, idx) => {
                const portColor = PORT_COLORS[port.type] || T.connColor;
                const iconBg = portColor + '12';
                return (
                  <div key={port.id} className="input-card" style={{ marginBottom: idx < inputPorts.length - 1 ? 6 : 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 4, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {port.type === 'prompt' ? <Type size={14} style={{ color: portColor }} /> :
                       port.type === 'image' ? <ImageIcon size={14} style={{ color: portColor }} /> :
                       port.type === 'mask' ? <Paintbrush size={14} style={{ color: portColor }} /> :
                       <Bookmark size={14} style={{ color: portColor }} />}
                    </div>
                    <span className="input-card-name">{port.label}</span>
                    {renderPortDot(port, 'in', { borderColor: portColor, color: portColor, flexShrink: 0 })}
                  </div>
                );
              })}
              {/* 模型选择 */}
              {node.type === 'ai-generate' && (
                <div style={{ marginBottom: 6 }}>
                  <select className="node-select" value={String(node.config?.model || '')} onChange={(e) => { e.stopPropagation(); onNodeFieldChange?.(node.id, 'model', e.target.value); }} onMouseDown={(e) => e.stopPropagation()}>
                    <option value="">选择模型</option>
                    {(imageModels ?? []).map(m => <option key={m.id} value={m.id} style={{ background: '#2a2a2a', color: '#e0e0e0' }}>{m.apiDisplayName || m.name || m.id}{m.provider ? ` (${m.provider})` : ''}</option>)}
                  </select>
                </div>
              )}
              {node.type === 'ai-generate' && (
                <div style={{ marginBottom: 8 }}>
                  <select className="node-select" value={String(node.config?.aspectRatio || '16:9')} onChange={(e) => { e.stopPropagation(); onNodeFieldChange?.(node.id, 'aspectRatio', e.target.value); }} onMouseDown={(e) => e.stopPropagation()}>
                    <option value="1:1">1:1 正方形</option>
                    <option value="4:3">4:3 横版</option>
                    <option value="16:9">16:9 宽屏</option>
                    <option value="9:16">9:16 竖版</option>
                    <option value="3:4">3:4 竖版</option>
                    <option value="21:9">21:9 超宽</option>
                  </select>
                </div>
              )}
              {/* 输出端口行 - port-row 模式（左隐藏+标签+右端口） */}
              {outputPorts.map((port) => {
                const portColor = PORT_COLORS[port.type] || T.connColor;
                return (
                  <div key={port.id} className="port-row">
                    <div className="port-dot input-port" style={{ visibility: 'hidden' }} />
                    <span className="port-label">{port.label}</span>
                    {renderPortDot(port, 'out', { borderColor: portColor, color: portColor })}
                  </div>
                );
              })}
              {/* 运行中进度条 */}
              {isRunning && (
                <div className="progress-bar" style={{ marginTop: 8 }}>
                  <div className="progress-bar-fill" style={{ width: '60%' }} />
                </div>
              )}
              {/* RUN 按钮 */}
              <button
                className="run-btn"
                style={{ marginTop: 8 }}
                onClick={(e) => { e.stopPropagation(); onCascadeRun?.(node.id); }}
                title="运行此节点"
              >
                RUN
              </button>
            </div>
          )}

          {/* 非AI/非图片节点: 执行后显示结果图 */}
          {!isInputText && !isInputImage && !isOutputImage && !isOutputImageGroup && hasImageOutput && (
            <div className="w-full h-full px-2 py-1">
              <div className="w-full h-full relative group cursor-pointer flex items-center justify-center" onClick={() => onPreviewImage(hasImageOutput)} onWheel={(e) => e.stopPropagation()}>
                <NextImage unoptimized width={1} height={1} src={hasImageOutput} alt="" className="max-w-full max-h-full object-contain rounded opacity-70 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          )}

          {/* output-image 节点 */}
          {isOutputImage && (() => {
            const imageUrls = (execResult?.output?.imageUrls as string[]) || [];
            const singleUrl = hasImageOutput || '';
            const allUrls = imageUrls.length > 0 ? imageUrls : (singleUrl ? [singleUrl] : []);
            // 输入端口行
            const imageInputPort = inputPorts.find(p => p.type === 'image' || p.label === '图片');
            return (
              <div className="w-full h-full flex flex-col">
                {imageInputPort && (
                  <div className="port-row" style={{ marginBottom: 8 }}>
                    {renderPortDot(imageInputPort, 'in', { borderColor: PORT_COLORS[imageInputPort.type] || T.connColor, color: PORT_COLORS[imageInputPort.type] || T.connColor })}
                    <span className="port-label">{imageInputPort.label}</span>
                    <div className="port-dot output-port" style={{ visibility: 'hidden' }} />
                  </div>
                )}
                {allUrls.length > 1 ? (
                  <OutputImageGroupContent imageUrls={allUrls} theme={T} onPreviewImage={onPreviewImage} />
                ) : singleUrl ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1" onWheel={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <div className="image-preview has-image cursor-pointer" onClick={() => onPreviewImage(singleUrl)}>
                      <NextImage unoptimized width={1} height={1} src={singleUrl} alt="" style={{ objectFit: 'cover' }} />
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1" onWheel={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <div className="image-preview empty" style={{ aspectRatio: '4/3' }}>
                      <div className="flex flex-col items-center gap-1.5 text-muted-foreground/40">
                        <ImagePlus size={22} />
                        <span className="text-[10px] font-medium">等待图片</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* output-image-group 节点 */}
          {isOutputImageGroup && (() => {
            const imageUrls = (execResult?.output?.imageUrls as string[]) || [];
            const singleUrl = (execResult?.output?.imageUrl as string) || '';
            const allUrls = imageUrls.length > 0 ? imageUrls : (singleUrl ? [singleUrl] : []);
            return (
              <div className="w-full h-full">
                <OutputImageGroupContent imageUrls={allUrls} theme={T} onPreviewImage={onPreviewImage} />
              </div>
            );
          })()}

          {/* 非AI/非图片节点显示级联运行 */}
          {!isInputText && !isInputImage && !hasImageOutput && !isCondition && !(node.type.startsWith('ai-') || node.type === 'output-image') && (
            <div className="flex justify-end">
              <button className="px-1 py-0 rounded text-[8px] font-medium cursor-pointer bg-muted/60 text-muted-foreground hover:bg-muted flex items-center gap-0.5" onClick={(e) => { e.stopPropagation(); onCascadeRun?.(node.id); }} title="运行此链">
                <Play size={8} /> 运行链
              </button>
            </div>
          )}
        </div>
      )}

      {/* 条件节点: 文字 */}
      {isCondition && (
        <div className="w-full h-full flex items-center justify-center">
          <span className="text-[12px] font-medium truncate px-2" style={{ color: T.nodeTitle }}>{node.label}</span>
        </div>
      )}

      {/* 画布模式专用标记 (右上角小徽章) */}
      {isCanvasFeature && !isCondition && (
        <div className="absolute top-[3px] right-2 w-6 h-6 flex items-center justify-center rounded-full text-[7px] font-bold z-10" style={{ background: color, color: T.badgeText, opacity: 0.8 }}>
          {node.type === 'ai-font-design' ? '字' : node.type === 'ai-refine-engine' ? '精' : node.type === 'ai-human-repair' ? '人' : node.type === 'ai-brand-ecommerce' ? '品' : node.type === 'ai-segment' ? '层' : node.type === 'ai-multi-angle' ? '角' : '3D'}
        </div>
      )}

      {/* 断点标记 */}
      {node.breakpoint && (
        <div className="absolute top-[3px] right-2 w-2 h-2 rounded-full" style={{ background: T.statusError }} />
      )}

      {/* 关闭编辑按钮 (选中时显示) */}
      {isSelected && (
        <div className="absolute -right-[12px] -top-[14px] z-20">
          <button
            title="关闭编辑"
            onClick={(e) => { e.stopPropagation(); onDeselect(); }}
            className="w-[22px] h-[22px] rounded-full bg-muted border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/30 cursor-pointer transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* 执行错误提示 */}
      {execResult?.error && (
        <div className="absolute top-full left-0 w-full mt-0.5 text-[10px] text-red-400 truncate px-1 z-20">{execResult.error}</div>
      )}
    </div>
  );
});
