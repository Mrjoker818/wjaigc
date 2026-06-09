'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  WorkflowNode, WorkflowConnection, Workflow as WorkflowData, NodeType, NodeCategory,
  NODE_TYPE_COLORS, NODE_TYPE_LABELS, NODE_TYPE_ICONS, NODE_CATEGORY_LABELS,
  PORT_COLORS, NodePort, PortType, PropertyField,
  createWorkflowNode, createConnection, createEmptyWorkflow, createDemoWorkflow,
  getNodePropertyFields, getNodeCategory, NODE_TEMPLATES,
  canConnectPorts, autoLayoutWorkflow, parseComfyUIWorkflow, isImageGeneratingNode, getOutputNodeSize,
} from '@/lib/workflow-engine';
import { getModelDisplayName } from '@/lib/model-name-map';
import { MODEL_QUALITIES, MODEL_ASPECT_RATIOS } from '@/lib/canvas-generation-group';
import {
  Image as ImageIcon, Type, SlidersHorizontal, Wand2, Pencil, Maximize, Scissors,
  PenTool, Palette, Sun, GitBranch, GitMerge, Repeat, RefreshCw, Layers,
  Bot, MessageSquare, ImageDown, Save, Download, Play, Square,
  FileInput,
  ChevronRight, ChevronDown, ChevronLeft, Plus, Trash2, ZoomIn, ZoomOut, RotateCcw,
  Settings, Upload, X, Check, AlertCircle, Loader2, BoxSelect, Group,
  Search, ScanSearch, Eye, Pause, SkipForward, Workflow as WorkflowIcon, Timer,
  ArrowLeft, LayoutGrid, Sparkles, MessageCircle, Rotate3d, Box, ShoppingBag, Zap,
  Copy, Clipboard, Film, Bookmark, BookmarkPlus, GitCompare, Grid3X3, ArrowLeftFromLine, ImagePlus,
  Shapes, BookOpen,
} from 'lucide-react';

// ==================== 图标映射 ====================

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Image: ImageIcon, Type, SlidersHorizontal, Wand2, Pencil, Maximize, Scissors,
  PenTool, Palette, Sun, GitBranch, GitMerge, Repeat, RefreshCw, Layers,
  Bot, MessageSquare, ImageDown, Save, Download, BoxSelect, Group,
  ScanSearch, Sparkles, Rotate3d, Box, ShoppingBag, Film,
};

function getNodeIcon(type: NodeType, size = 14, className = '') {
  const iconName = NODE_TYPE_ICONS[type];
  const IconComp = ICON_MAP[iconName] || Settings;
  return <IconComp size={size} className={className} />;
}

// ==================== 模型列表 Hook ====================

interface ModelOption { id: string; name: string; type: string; provider: string; apiDisplayName?: string; }


function useModelList() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workflow/models?type=all');
      if (res.ok) {
        const data = await res.json();
        setModels(data.models || []);
      }
    } catch (e) { console.error('[NodeEditor] 模型列表加载失败:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchModels(); }, [fetchModels]);
  return { models, loading, fetchModels };
}

// ==================== 连线临时状态 ====================

interface DraggingConn {
  fromNodeId: string;
  fromPortId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  portType: PortType;
}

// ==================== P0: @图片引用 ====================

interface CanvasImageRef {
  id: string;
  url: string;
  name: string;
  description: string;
  label?: string;
  width?: number;
  height?: number;
}

interface MentionPopup {
  visible: boolean;
  nodeId: string;
  fieldKey: string;
  filter: string;
  position: { top: number; left: number };
}

// ==================== P2: 提示词库 ====================

interface PromptSnippet {
  id: string;
  text: string;
  tags: string[];
  category: string;
  createdAt: number;
}

// ==================== P2: 撤销重做历史 ====================

interface HistoryEntry {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  label: string;
}

// ==================== 工作流预设模板 ====================

interface WorkflowPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  tags: string[];
  nodes: { type: NodeType; label: string; config?: Record<string, unknown> }[];
  connections: { from: number; to: number; fromPort: string; toPort: string; type: PortType }[];
}

const WORKFLOW_PRESETS: WorkflowPreset[] = [
  {
    id: 'txt2img',
    name: '文生图',
    description: '文本提示词生成图片',
    icon: 'Wand2',
    tags: ['基础', '生成'],
    nodes: [
      { type: 'input-text', label: '创意描述' },
      { type: 'ai-generate', label: '图像生成' },
      { type: 'output-image', label: '输出结果' },
    ],
    connections: [
      { from: 0, to: 1, fromPort: 'out-prompt', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 2, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
    ],
  },
  {
    id: 'img2img',
    name: '图生图',
    description: '参考图片生成新图',
    icon: 'Palette',
    tags: ['基础', '转换'],
    nodes: [
      { type: 'input-image', label: '参考图' },
      { type: 'input-text', label: '风格描述' },
      { type: 'ai-style-transfer', label: '风格转换', config: { strength: 60 } },
      { type: 'output-image', label: '输出结果' },
    ],
    connections: [
      { from: 0, to: 2, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 1, to: 2, fromPort: 'out-prompt', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 3, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
    ],
  },
  {
    id: 'removebg-upscale',
    name: '抠图+高清放大',
    description: '去背景后超分辨率放大',
    icon: 'Scissors',
    tags: ['修图', '放大'],
    nodes: [
      { type: 'input-image', label: '原始图片' },
      { type: 'ai-removebg', label: '移除背景', config: { model: 'birefnet-general-lite' } },
      { type: 'ai-upscale', label: '无损放大', config: { scale: '2' } },
      { type: 'output-export', label: '导出PNG', config: { format: 'png' } },
    ],
    connections: [
      { from: 0, to: 1, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 1, to: 2, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 2, to: 3, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
    ],
  },
  {
    id: 'font-design',
    name: '字境大师',
    description: 'AI字体设计生成',
    icon: 'Type',
    tags: ['字体', '设计'],
    nodes: [
      { type: 'input-text', label: '文字内容', config: { text: '无界AI' } },
      { type: 'ai-font-design', label: '字境大师', config: { styleCategory: 'calligraphy', scene: 'logo' } },
      { type: 'output-image', label: '字体图' },
    ],
    connections: [
      { from: 0, to: 1, fromPort: 'out-prompt', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 2, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
    ],
  },
  {
    id: 'refine-engine',
    name: '精修引擎',
    description: '产品商业级精修流程',
    icon: 'Sparkles',
    tags: ['修图', '商业'],
    nodes: [
      { type: 'input-image', label: '产品原图' },
      { type: 'input-text', label: '精修需求', config: { text: '专业产品摄影，影棚灯光，纯白背景' } },
      { type: 'ai-refine-engine', label: '精修引擎', config: { category: 'electronics', lighting: 'studio', background: 'white' } },
      { type: 'ai-upscale', label: '高清放大', config: { scale: '2' } },
      { type: 'output-export', label: '导出结果' },
    ],
    connections: [
      { from: 0, to: 2, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 1, to: 2, fromPort: 'out-prompt', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 3, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 3, to: 4, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
    ],
  },
  {
    id: 'brand-ecommerce',
    name: '品牌电商',
    description: '电商视觉内容生成',
    icon: 'ShoppingBag',
    tags: ['电商', '品牌'],
    nodes: [
      { type: 'input-image', label: '商品图' },
      { type: 'input-text', label: '品牌描述' },
      { type: 'ai-brand-ecommerce', label: '品牌电商', config: { templateType: 'product-scene', brandStyle: 'minimal' } },
      { type: 'output-image', label: '电商主图' },
    ],
    connections: [
      { from: 0, to: 2, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 1, to: 2, fromPort: 'out-prompt', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 3, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
    ],
  },
  {
    id: 'segment-psd',
    name: '元素分层+PSD',
    description: '智能分层并导出PSD',
    icon: 'Layers',
    tags: ['分层', 'PSD'],
    nodes: [
      { type: 'input-image', label: '原始图片' },
      { type: 'ai-segment', label: '元素分层', config: { exportFormat: 'psd-pro' } },
      { type: 'output-export', label: '导出PSD', config: { format: 'psd', quality: 'pro' } },
    ],
    connections: [
      { from: 0, to: 1, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 1, to: 2, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
    ],
  },
  {
    id: 'multi-angle',
    name: '多角度生成',
    description: '生成多视角图片',
    icon: 'Rotate3d',
    tags: ['生成', '多视角'],
    nodes: [
      { type: 'input-image', label: '参考图' },
      { type: 'input-text', label: '描述' },
      { type: 'ai-multi-angle', label: '多角度', config: { angles: 'quad', characterRef: true } },
      { type: 'output-image', label: '结果' },
    ],
    connections: [
      { from: 0, to: 2, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 1, to: 2, fromPort: 'out-prompt', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 3, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
    ],
  },
  {
    id: 'analyze-refine',
    name: '分析→优化循环',
    description: 'AI分析图片后自动优化',
    icon: 'ScanSearch',
    tags: ['分析', '优化'],
    nodes: [
      { type: 'input-image', label: '输入图片' },
      { type: 'ai-analyze', label: 'AI分析', config: { analysisType: 'describe' } },
      { type: 'ai-retouch', label: 'AI修图' },
      { type: 'output-image', label: '优化结果' },
    ],
    connections: [
      { from: 0, to: 1, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 2, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 1, to: 2, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 3, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
    ],
  },
  {
    id: 'full-pipeline',
    name: '完整处理流水线',
    description: '去背景→修图→放大→导出',
    icon: 'Zap',
    tags: ['流水线', '完整'],
    nodes: [
      { type: 'input-image', label: '原始图片' },
      { type: 'input-text', label: '修图指令' },
      { type: 'ai-removebg', label: '移除背景', config: { model: 'birefnet-general-lite' } },
      { type: 'ai-retouch', label: 'AI修图' },
      { type: 'ai-upscale', label: '无损放大', config: { scale: '2' } },
      { type: 'output-export', label: '导出', config: { format: 'png' } },
    ],
    connections: [
      { from: 0, to: 2, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 3, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 1, to: 3, fromPort: 'out-prompt', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 4, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 3, to: 4, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 4, to: 5, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
    ],
  },
];

// ==================== 主组件 ====================

interface NodeEditorProps {
  workflow?: WorkflowData | null;
  onBack?: () => void;
  onWorkflowChange?: (wf: WorkflowData | null) => void;
  onOpenWorkflowHub?: () => void;
  /** P0: 画布图片列表，用于@图片引用 */
  canvasImages?: CanvasImageRef[];
  /** 主题风格: gold(黑金) / monochrome(单色) */
  themeStyle?: 'gold' | 'monochrome';
  /** 生成图片后回调，将图片添加到项目 */
  onAddImages?: (imageUrls: string[]) => void;
}

// ==================== 双主题配色 ====================
const nodeThemes = {
  gold: {
    // 侧边栏 — 与窗口模式面板 (#1a1a1a) 统一
    sidebarBg: '#1a1a1a',
    sidebarBorder: 'rgba(212,175,55,0.15)',
    sidebarText: '#e5e5e5',
    sidebarMuted: '#888',
    sidebarDimmed: '#555',
    // 节点 — 与窗口模式浮窗统一 (#1a1a1a 主体 + 金色强调)
    nodeBg: '#1a1a1a',
    nodeBorder: 'rgba(212,175,55,0.3)',
    nodeSelectedBorder: 'var(--ne-accent)',
    nodeHoverBg: '#222',
    nodeHeaderText: '#e5e5e5',
    nodePortText: '#999',
    nodeTitleText: '#ccc',
    nodeBody: '#1a1a1a',
    nodeSelected: '#1e1e1e',
    nodeTitle: '#ccc',
    portFill: '#1a1a1a',
    portLabel: '#999',
    badgeText: '#000',
    gridDot: '#333',
    danger: '#ef4444',
    success: '#22c55e',
    arrowFill: '#555',
    // 强调色
    accent: 'var(--ne-accent)',
    accentHover: '#c9a02e',
    accentDim: 'rgba(212,175,55,0.15)',
    accentMuted: 'rgba(212,175,55,0.25)',
    // 卡片
    cardBg: '#1a1a1a',
    cardBorder: 'rgba(212,175,55,0.15)',
    border: 'rgba(212,175,55,0.15)',
    text: '#e5e5e5',
    textMuted: '#888',
    // 输入框 — 与窗口模式输入框统一
    inputBg: 'rgba(255,255,255,0.05)',
    inputBorder: 'rgba(212,175,55,0.2)',
    inputText: '#e5e5e5',
    inputPlaceholder: '#666',
    // 下拉选项（原生option需要不透明背景）
    optionBg: '#2a2a2a',
    optionText: '#e5e5e5',
    // 按钮 — 与窗口模式按钮统一
    btnBg: 'rgba(212,175,55,0.1)',
    btnHoverBg: 'rgba(212,175,55,0.2)',
    btnText: 'var(--ne-accent)',
    // 画布
    canvasBg: '#111',
    canvasGrid: 'rgba(255,255,255,0.03)',
    canvasDot: 'rgba(255,255,255,0.08)',
    // 连线
    connColor: '#555',
    connHighlight: 'var(--ne-accent)',
    // 工具栏
    toolbarBg: '#1a1a1a',
    toolbarBorder: 'rgba(212,175,55,0.15)',
    toolbarText: '#999',
    // 标签
    tabActiveBg: 'rgba(212,175,55,0.15)',
    tabActiveText: 'var(--ne-accent)',
    tabInactiveText: '#777',
    // 执行状态
    statusRunning: 'var(--ne-accent)',
    statusSuccess: '#4ade80',
    statusError: '#f87171',
    // 滚动条
    scrollbarTrack: '#111',
    scrollbarThumb: 'rgba(212,175,55,0.2)',
  },
  monochrome: {
    // 侧边栏
    sidebarBg: '#f8fafc',
    sidebarBorder: '#e2e8f0',
    sidebarText: '#1e293b',
    sidebarMuted: '#64748b',
    sidebarDimmed: '#94a3b8',
    // 节点
    nodeBg: '#ffffff',
    nodeBorder: '#cbd5e1',
    nodeSelectedBorder: '#3b82f6',
    nodeHoverBg: '#f1f5f9',
    nodeHeaderText: '#1e293b',
    nodePortText: '#64748b',
    nodeTitleText: '#334155',
    nodeBody: '#f8fafc',
    nodeSelected: '#e2e8f0',
    nodeTitle: '#334155',
    portFill: '#e2e8f0',
    portLabel: '#64748b',
    badgeText: '#ffffff',
    gridDot: '#cbd5e1',
    danger: '#ef4444',
    success: '#22c55e',
    arrowFill: '#94a3b8',
    // 强调色
    accent: '#3b82f6',
    accentHover: '#2563eb',
    accentDim: 'rgba(59,130,246,0.08)',
    accentMuted: 'rgba(59,130,246,0.15)',
    // 卡片
    cardBg: '#ffffff',
    cardBorder: '#e2e8f0',
    border: '#e2e8f0',
    text: '#1e293b',
    textMuted: '#64748b',
    // 输入框
    inputBg: '#f1f5f9',
    inputBorder: '#e2e8f0',
    inputText: '#1e293b',
    inputPlaceholder: '#94a3b8',
    // 下拉选项（原生option需要不透明背景）
    optionBg: '#ffffff',
    optionText: '#1e293b',
    // 按钮
    btnBg: 'rgba(59,130,246,0.08)',
    btnHoverBg: 'rgba(59,130,246,0.15)',
    btnText: '#3b82f6',
    // 画布
    canvasBg: '#f0f4f8',
    canvasGrid: 'rgba(0,0,0,0.03)',
    canvasDot: 'rgba(0,0,0,0.06)',
    // 连线
    connColor: '#94a3b8',
    connHighlight: '#3b82f6',
    // 工具栏
    toolbarBg: '#ffffff',
    toolbarBorder: '#e2e8f0',
    toolbarText: '#64748b',
    // 标签
    tabActiveBg: 'rgba(59,130,246,0.08)',
    tabActiveText: '#3b82f6',
    tabInactiveText: '#94a3b8',
    // 执行状态
    statusRunning: '#3b82f6',
    statusSuccess: '#22c55e',
    statusError: '#ef4444',
    // 滚动条
    scrollbarTrack: '#f1f5f9',
    scrollbarThumb: 'rgba(59,130,246,0.2)',
  },
} as const;


// 底部内容面板 - 显示项目图片，支持拖拽到画布创建节点
function ContentPanel({ canvasImages, onDragImage, themeStyle }: { canvasImages?: CanvasImageRef[]; onDragImage: (url: string) => void; themeStyle: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const [selectedImgId, setSelectedImgId] = useState<string | null>(null);
  const images = canvasImages || [];
  const T = nodeThemes[themeStyle as keyof typeof nodeThemes];
  const stripRef = useRef<HTMLDivElement>(null);

  const handleDragStart = (e: React.DragEvent, url: string) => {
    e.dataTransfer.setData('text/uri-list', url);
    e.dataTransfer.setData('text/plain', url);
    e.dataTransfer.effectAllowed = 'copy';
    onDragImage(url);
  };

  return (
    <div
      className={`border-t transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${collapsed ? 'h-[38px]' : 'h-[120px]'}`}
      style={{
        borderColor: T.sidebarBorder,
        background: T.sidebarBg === '#1a1a1a'
          ? 'rgba(22, 27, 34, 0.85)'
          : 'rgba(248, 250, 252, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
      data-popup="content-strip"
      role="region"
      aria-label="内容资产"
    >
      {/* 标题栏 - 固定高度38px */}
      <button
        onClick={() => setCollapsed(prev => !prev)}
        className="w-full h-[38px] flex items-center gap-2 px-4 hover:bg-[var(--ne-input-bg)] transition-colors cursor-pointer"
        aria-expanded={!collapsed}
        aria-label={collapsed ? '展开内容窗口' : '收起内容窗口'}
      >
        <LayoutGrid size={14} style={{ color: T.accent }} />
        <span className="text-xs font-semibold uppercase tracking-wider flex-1 text-left" style={{ color: T.text }}>内容</span>
        {images.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: `${T.accent}18`, color: T.accent }}>{images.length}</span>
        )}
        {/* 下载全部按钮 */}
        {!collapsed && images.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); }}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors cursor-pointer"
            style={{ background: T.btnBg, color: T.btnText }}
            aria-label="下载全部"
          >
            <Download size={10} /> 下载全部
          </button>
        )}
        <ChevronDown size={14} style={{ color: T.textMuted }} className={`transition-transform duration-300 ${collapsed ? '' : 'rotate-180'}`} />
      </button>

      {/* 横向滚动条 - 展开时显示 */}
      {!collapsed && (
        <div className="px-3 pb-2 h-[calc(100%-38px)]">
          {images.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs" style={{ color: T.textMuted }}>
              暂无图片，生成后将自动出现在此处
            </div>
          ) : (
            <div
              ref={stripRef}
              className="flex gap-2 h-full overflow-x-auto overflow-y-hidden pb-1"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: `${T.accent}30 transparent`,
              }}
              onWheel={(e) => {
                // 横向滚动: 将纵向滚轮转为横向
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                  e.currentTarget.scrollLeft += e.deltaY;
                  e.preventDefault();
                }
              }}
            >
              {images.map((img, idx) => {
                const isSelected = selectedImgId === (img.id || idx);
                return (
                <div
                  key={img.id || idx}
                  draggable
                  onDragStart={e => handleDragStart(e, img.url)}
                  onClick={() => setSelectedImgId(prev => prev === (img.id || idx) ? null : String(img.id || idx))}
                  className={`group relative flex-shrink-0 w-[72px] h-[72px] rounded-lg overflow-hidden border cursor-grab active:cursor-grabbing transition-all duration-200 hover:-translate-y-0.5 ${isSelected ? 'ring-2 ring-offset-1' : ''}`}
                  style={{
                    borderColor: isSelected ? T.accent : `${T.accent}25`,
                    background: T.nodeBg === '#1a1a1a'
                      ? 'repeating-conic-gradient(#222 0% 25%, #1a1a1a 0% 50%) 0 0 / 12px 12px'
                      : 'repeating-conic-gradient(#f0f0f0 0% 25%, #fff 0% 50%) 0 0 / 12px 12px',
                    boxShadow: isSelected
                      ? `0 0 0 2px ${T.accent}40, 0 0 12px ${T.accent}20, 0 4px 12px rgba(0,0,0,0.3)`
                      : `0 2px 8px rgba(0,0,0,0.2)`,
                  }}
                  title={img.description || img.name || `图片 ${idx + 1} - 拖拽到画布添加节点`}
                >
                  <img src={img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  {/* 格式标签 */}
                  <span
                    className="absolute top-1 right-1 text-[8px] font-bold px-1 py-0 rounded leading-tight"
                    style={{ background: 'rgba(0,0,0,0.7)', color: '#fff' }}
                  >
                    {img.url?.includes('.svg') ? 'SVG' : img.url?.includes('.png') ? 'PNG' : 'JPG'}
                  </span>
                  {/* 悬停遮罩 */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <ImagePlus size={16} className="text-white" />
                  </div>
                </div>
              );
              })}
              {/* 添加按钮 */}
              <div
                className="flex-shrink-0 w-[72px] h-[72px] rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
                style={{ borderColor: `${T.accent}40`, color: T.textMuted }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = T.accent;
                  (e.currentTarget as HTMLDivElement).style.color = T.accent;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = `${T.accent}40`;
                  (e.currentTarget as HTMLDivElement).style.color = T.textMuted;
                }}
              >
                <Plus size={16} />
                <span className="text-[9px]">添加</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function NodeEditor({ workflow, onBack, onWorkflowChange, onOpenWorkflowHub, canvasImages, themeStyle = 'gold', onAddImages }: NodeEditorProps) {
  const T = nodeThemes[themeStyle];
  // CSS自定义属性，供Tailwind中 var(--ne-xxx) 引用
  const neVars = {
    '--ne-accent': T.accent,
    '--ne-accent-hover': T.accentHover,
    '--ne-accent-dim': T.accentDim,
    '--ne-sidebar-bg': T.sidebarBg,
    '--ne-sidebar-border': T.sidebarBorder,
    '--ne-card-bg': T.cardBg,
    '--ne-card-border': T.cardBorder,
    '--ne-text': T.text,
    '--ne-text-muted': T.textMuted,
    '--ne-input-bg': T.inputBg,
    '--ne-input-border': T.inputBorder,
    '--ne-option-bg': T.optionBg,
    '--ne-option-text': T.optionText,
    '--ne-canvas-bg': T.canvasBg,
    '--ne-toolbar-bg': T.toolbarBg,
    '--ne-toolbar-border': T.toolbarBorder,
    '--ne-toolbar-text': T.toolbarText,
    '--ne-btn-bg': T.btnBg,
    '--ne-btn-hover-bg': T.btnHoverBg,
    '--ne-btn-text': T.btnText,
  } as React.CSSProperties;
  // P2: BroadcastChannel 跨标签同步
  const bcRef = useRef<BroadcastChannel | null>(null);
  const bcIgnoreRef = useRef(false); // 防止自己发的消息回触发
  const bcDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [wfRaw, setWfRaw] = useState<WorkflowData>(workflow || createEmptyWorkflow('新工作流'));
  // P2: 包装setWf以广播变化
  const broadcastWorkflow = useCallback((updatedWf: WorkflowData) => {
    if (!bcRef.current) return;
    if (bcDebounceRef.current) clearTimeout(bcDebounceRef.current);
    bcDebounceRef.current = setTimeout(() => {
      bcIgnoreRef.current = true;
      bcRef.current?.postMessage({ type: 'workflow-update', wf: updatedWf, source: 'tab' });
    }, 500);
  }, []);
  const setWf = useCallback((updater: WorkflowData | ((prev: WorkflowData) => WorkflowData)) => {
    setWfRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      broadcastWorkflow(next);
      return next;
    });
  }, [broadcastWorkflow]);
  const wf = wfRaw;

  // BroadcastChannel 接收端
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('wujie-workflow-sync');
    bcRef.current = bc;
    bc.onmessage = (e: MessageEvent) => {
      if (bcIgnoreRef.current) { bcIgnoreRef.current = false; return; }
      const msg = e.data as { type: string; wf: WorkflowData; source: string };
      if (msg.type === 'workflow-update' && msg.wf) {
        setWfRaw(msg.wf); // 直接更新raw，避免触发广播
      }
    };
    return () => { bc.close(); bcRef.current = null; };
  }, []);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  // 兼容：获取单个选中节点ID
  const selectedNodeId = useMemo(() => selectedNodeIds.size > 0 ? [...selectedNodeIds][0] : null, [selectedNodeIds]);
  // 拖动状态使用ref避免每次mousemove触发重渲染导致闪烁
  const draggingNodeRef = useRef<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false); // 标记正在拖动，跳过历史快照
  const [draggingConn, setDraggingConn] = useState<DraggingConn | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 0.8 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, vx: 0, vy: 0 });
  const [sidebarTab, setSidebarTab] = useState<'nodes' | 'props' | 'ai-build' | 'presets' | 'prompts' | 'assistant'>('nodes');
  const [searchQuery, setSearchQuery] = useState('');
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [execStatus, setExecStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [execResults, setExecResults] = useState<Record<string, { status: string; output?: Record<string, unknown>; error?: string }>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showMinimap, setShowMinimap] = useState(true);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [compareImages, setCompareImages] = useState<{ before: string; after: string } | null>(null);
  const [comparePosition, setComparePosition] = useState(50);
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  const toggleNodeCollapse = useCallback((nodeId: string) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  }, []);
  const [highlightNodeId, setHighlightNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // P2: build_mode检测 — 生产环境禁用部分开发功能
  const isBuildMode = typeof process !== 'undefined' && process.env?.COZE_PROJECT_ENV === 'PROD';

  // AI建图状态
  const [aiBuildInput, setAiBuildInput] = useState('');
  const [aiBuildLoading, setAiBuildLoading] = useState(false);
  const [aiBuildError, setAiBuildError] = useState<string | null>(null);

  // P1: 执行日志
  const [execLogs, setExecLogs] = useState<{ time: number; nodeId: string; label: string; status: string; message: string; duration?: number; nodeType?: string }[]>([]);  // P1: 节点复制粘贴
  const [clipboard, setClipboard] = useState<{ nodes: WorkflowNode[]; connections: WorkflowConnection[] } | null>(null);

  // P2: 提示词库
  const [promptSnippets, setPromptSnippets] = useState<PromptSnippet[]>(() => {
    try { return JSON.parse(localStorage.getItem('wujie-prompt-snippets') || '[]'); } catch { return []; }
  });
  const [promptSearch, setPromptSearch] = useState('');
  const [newSnippetText, setNewSnippetText] = useState('');
  const [newSnippetTags, setNewSnippetTags] = useState('');
  const [newSnippetCategory, setNewSnippetCategory] = useState('通用');

  // P2: 撤销重做
  const [historyStack, setHistoryStack] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyIndexRef = useRef(-1);
  const isUndoRedoRef = useRef(false);

  // P2: 画布助手 (节点感知)
  const [assistantMessages, setAssistantMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);

  // P2: JSON编辑器
  const [jsonEditorOpen, setJsonEditorOpen] = useState(false);
  const [jsonEditContent, setJsonEditContent] = useState('');

  // P2: 保存历史快照 (每次wf变化时记录，拖动期间跳过)
  const prevWfRef = useRef(wf);
  useEffect(() => {
    if (isUndoRedoRef.current) { isUndoRedoRef.current = false; return; }
    if (prevWfRef.current === wf) return;
    if (isDraggingRef.current) return; // 拖动期间不记录历史快照
    prevWfRef.current = wf;
    const entry: HistoryEntry = { nodes: wf.nodes, connections: wf.connections, label: '变更' };
    setHistoryStack(prev => {
      const idx = historyIndexRef.current;
      const newStack = prev.slice(0, idx + 1);
      newStack.push(entry);
      if (newStack.length > 50) newStack.shift();
      return newStack;
    });
    setHistoryIndex(prev => {
      const newIdx = Math.min(prev + 1, 49);
      historyIndexRef.current = newIdx;
      return newIdx;
    });
  }, [wf]);

  // P2: 撤销/重做函数
  const handleUndo = useCallback(() => {
    const idx = historyIndexRef.current;
    if (idx <= 0) return;
    isUndoRedoRef.current = true;
    setHistoryStack(stack => {
      const entry = stack[idx - 1];
      if (entry) setWf(prev => ({ ...prev, nodes: entry.nodes, connections: entry.connections }));
      return stack;
    });
    setHistoryIndex(prev => {
      const newIdx = prev - 1;
      historyIndexRef.current = newIdx;
      return newIdx;
    });
  }, []);

  const handleRedo = useCallback(() => {
    const idx = historyIndexRef.current;
    setHistoryStack(stack => {
      if (idx >= stack.length - 1) return stack;
      isUndoRedoRef.current = true;
      const entry = stack[idx + 1];
      if (entry) setWf(prev => ({ ...prev, nodes: entry.nodes, connections: entry.connections }));
      setHistoryIndex(prev => {
        const newIdx = prev + 1;
        historyIndexRef.current = newIdx;
        return newIdx;
      });
      return stack;
    });
  }, []);

  // P2: 保存提示词到库
  const savePromptSnippet = useCallback((text: string, tags: string[], category: string) => {
    const snippet: PromptSnippet = { id: `ps-${Date.now()}`, text, tags, category, createdAt: Date.now() };
    setPromptSnippets(prev => {
      const next = [...prev, snippet];
      localStorage.setItem('wujie-prompt-snippets', JSON.stringify(next));
      return next;
    });
  }, []);

  // P2: 画布助手发送消息 (P1增强: 上游节点自动引用)
  const sendAssistantMessage = useCallback(async () => {
    if (!assistantInput.trim()) return;
    const userMsg = assistantInput.trim();
    setAssistantInput('');
    setAssistantMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setAssistantLoading(true);
    try {
      const node = wf.nodes.find(n => n.id === selectedNodeId);
      // P1: 自动遍历上游节点构建上下文
      let contextInfo = '';
      if (node) {
        const upstreamChain: string[] = [];
        const visited = new Set<string>();
        const queue = [node.id];
        visited.add(node.id);
        while (queue.length > 0) {
          const currentId = queue.shift()!;
          const upstreamConns = wf.connections.filter(c => c.toNodeId === currentId);
          for (const conn of upstreamConns) {
            if (!visited.has(conn.fromNodeId)) {
              visited.add(conn.fromNodeId);
              const upNode = wf.nodes.find(n => n.id === conn.fromNodeId);
              if (upNode) {
                upstreamChain.push(`  → [${upNode.type}] ${upNode.label}: ${JSON.stringify(upNode.config).slice(0, 150)}`);
                queue.push(conn.fromNodeId);
              }
            }
          }
        }
        contextInfo = `当前选中节点: [${node.type}] ${node.label}, 配置: ${JSON.stringify(node.config).slice(0, 200)}`;
        if (upstreamChain.length > 0) {
          contextInfo += `\n上游节点链路:\n${upstreamChain.join('\n')}`;
        }
      } else {
        contextInfo = '未选中任何节点';
      }
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'system', content: `你是无界AI工作流助手。${contextInfo}` }, { role: 'user', content: userMsg }] }),
      });
      if (res.ok) {
        const data = await res.json();
        setAssistantMessages(prev => [...prev, { role: 'assistant', content: data.content || data.message || '无法获取回复' }]);
      } else {
        setAssistantMessages(prev => [...prev, { role: 'assistant', content: '助手暂时无法回复，请稍后再试。' }]);
      }
    } catch {
      setAssistantMessages(prev => [...prev, { role: 'assistant', content: '网络错误，请稍后再试。' }]);
    } finally { setAssistantLoading(false); }
  }, [assistantInput, selectedNodeId, wf.nodes]);

  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport; // 始终保持最新值，避免拖动时stale closure
  const { models, loading: modelsLoading } = useModelList();
  const chatModels = useMemo(() => models.filter(m => m.type === 'chat'), [models]);

  // 工作流节点图片列表 (用于 @mention 引用和输入引用阻断)
  // 合并: 画布传入的图片 + 工作流内节点输出的图片
  const allCanvasImages = useMemo(() => {
    const nodeImages = wf.nodes
      .filter(n => n.type === 'input-image' || n.type === 'ai-generate' || n.type === 'output-image' || n.type === 'output-image-group')
      .map(n => {
        const cfg = n.config as Record<string, unknown>;
        const url = (cfg?.imageUrl as string) || (cfg?.outputUrl as string) || '';
        const name = (cfg?.label as string) || n.label || n.type;
        return { id: n.id, url, name, label: name, description: name };
      })
      .filter(img => img.url);
    // 合并外部传入的画布图片
    const external = (canvasImages || []).map(img => ({ ...img, name: img.name || img.description || img.label || '', label: img.label || img.description || img.name || '' }));
    return [...external, ...nodeImages];
  }, [wf.nodes, canvasImages]);

  // 框选状态
  const [boxSelect, setBoxSelect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const isBoxSelectingRef = useRef(false);

  const selectedNode = useMemo(() => wf.nodes.find(n => n.id === selectedNodeId) || null, [wf.nodes, selectedNodeId]);

  // 避免循环更新：记录最近一次传出的 wf 引用，跳过自身回写
  const lastEmittedRef = useRef<WorkflowData | null>(null);

  // 图片上传: 全局文件输入框 (foreignObject内动态input.click()不可靠)
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const pendingImageUploadNodeId = useRef<string | null>(null);

  // 同步外部workflow变化 (仅当外部真正改变时才同步，跳过自身回写)
  useEffect(() => {
    if (!workflow) return;
    // 如果是自身回写（引用相同），跳过
    if (workflow === lastEmittedRef.current) return;
    if (!isDraggingRef.current) setWf(workflow);
  }, [workflow]);

  // 通知外部 (拖动期间跳过)
  const onWorkflowChangeRef = useRef(onWorkflowChange);
  onWorkflowChangeRef.current = onWorkflowChange;
  useEffect(() => {
    if (!isDraggingRef.current) {
      lastEmittedRef.current = wf;
      onWorkflowChangeRef.current?.(wf);
    }
  }, [wf]);

  // ─── 节点操作 ───

  const handleAddNode = useCallback((type: NodeType) => {
    const node = createWorkflowNode(type, 300 + Math.random() * 200, 200 + Math.random() * 200);
    // 生图节点自动创建输出图片节点并连接，尺寸与画面比例一致
    const shouldAutoOutput = isImageGeneratingNode(type);
    // 从属性面板配置获取默认画面比例
    const defaultAspectRatio = shouldAutoOutput
      ? (getNodePropertyFields(type).find(f => f.key === 'aspectRatio')?.defaultValue as string | undefined)
      : undefined;
    const outSize = shouldAutoOutput ? getOutputNodeSize(defaultAspectRatio) : null;
    const outputNode = shouldAutoOutput
      ? (() => {
          const on = createWorkflowNode('output-image', node.x + node.width + 80, node.y);
          on.width = Math.max(outSize!.width, 140);
          on.height = Math.max(outSize!.height, 120);
          return on;
        })()
      : null;
    setWf(prev => {
      let autoConns: WorkflowConnection[] = [];
      // 生图节点 → 自动输出节点连线
      if (outputNode) {
        const genOutPort = node.ports.find(p => p.direction === 'out' && p.type === 'image');
        const outInPort = outputNode.ports.find(p => p.direction === 'in' && p.type === 'image');
        if (genOutPort && outInPort) {
          autoConns.push(createConnection(node.id, genOutPort.id, outputNode.id, outInPort.id, 'image'));
        }
      }
      // P2: 拖拽自动连线 — 如果有选中节点，尝试自动连线
      const selectedNodes = prev.nodes.filter(n => selectedNodeIds.has(n.id));
      if (selectedNodes.length > 0) {
        for (const selNode of selectedNodes) {
          // 选中节点的输出端口 → 新节点的输入端口
          const selOutPorts = selNode.ports.filter(p => p.direction === 'out');
          const newInPorts = node.ports.filter(p => p.direction === 'in');
          for (const outP of selOutPorts) {
            for (const inP of newInPorts) {
              if (canConnectPorts(outP.type, inP.type)) {
                const exists = prev.connections.some(c =>
                  c.fromNodeId === selNode.id && c.fromPortId === outP.id &&
                  c.toNodeId === node.id && c.toPortId === inP.id
                );
                if (!exists) {
                  autoConns.push(createConnection(selNode.id, outP.id, node.id, inP.id, outP.type));
                  break; // 每对节点只连一条
                }
              }
            }
            if (autoConns.length > 0) break;
          }
          if (autoConns.length > 0) break; // 只连接第一个选中节点
        }
      }
      const newNodes = outputNode ? [node, outputNode] : [node];
      return { ...prev, nodes: [...prev.nodes, ...newNodes], connections: [...prev.connections, ...autoConns] };
    });
    setSelectedNodeIds(new Set([node.id]));
    setSidebarTab('props');
  }, [selectedNodeIds]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    setWf(prev => ({
      ...prev,
      nodes: prev.nodes.filter(n => n.id !== nodeId),
      connections: prev.connections.filter(c => c.fromNodeId !== nodeId && c.toNodeId !== nodeId),
    }));
    setSelectedNodeIds(prev => { const next = new Set(prev); next.delete(nodeId); return next; });
  }, []);

  // 从内容面板拖拽图片到画布 → 创建 input-image 节点
  const handleCanvasImageDrop = useCallback((e: React.DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const imageUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (!imageUrl) return;
    const svgRect = svgRef.current?.getBoundingClientRect();
    if (!svgRect) return;
    const vp = viewportRef.current;
    const cx = (e.clientX - svgRect.left - vp.x) / vp.zoom;
    const cy = (e.clientY - svgRect.top - vp.y) / vp.zoom;

    // 根据图片宽高比计算节点大小
    const refImage = canvasImages?.find(img => img.url === imageUrl);
    const imgW = refImage?.width || 1024;
    const imgH = refImage?.height || 1024;
    const ratio = imgW / imgH;
    const nodeW = Math.max(180, Math.min(320, 260 * Math.max(1, ratio)));
    const nodeH = Math.max(140, Math.min(320, nodeW / ratio));

    const node = createWorkflowNode('input-image', cx - nodeW / 2, cy - nodeH / 2);
    node.config = { ...node.config, imageUrl, source: 'canvas-ref' };
    node.width = nodeW;
    node.height = nodeH;
    setWf(prev => ({ ...prev, nodes: [...prev.nodes, node] }));
    setSelectedNodeIds(new Set([node.id]));
  }, [canvasImages]);

  const handleNodeUpdate = useCallback((nodeId: string, updates: Partial<WorkflowNode>) => {
    setWf(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (n.id !== nodeId) return n;
        // 深合并config
        const topLevel: Partial<WorkflowNode> = { ...updates };
        delete topLevel.config;
        return { ...n, ...topLevel, config: { ...n.config, ...(updates.config || {}) } };
      }),
    }));
  }, []);

  // P0: LLM优化提示词
  const handleLlmOptimize = useCallback(async (nodeId: string, _prompt: string, model: string, systemPrompt: string, instruction: string) => {
    const node = wf.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const currentText = String(node.config?.textContent || node.config?.promptText || '');
    if (!currentText.trim()) return; // 空文本不优化
    handleNodeUpdate(nodeId, { config: { ...node.config, llmOptimizing: true } });
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt || instruction || '你是一个专业的AI图像提示词优化助手。请优化用户提供的提示词，使其更加详细、精确，适合AI图像生成。请用中文输出优化后的提示词，不要添加任何解释。' },
            { role: 'user', content: currentText },
          ],
          model: model || node.config?.llmModel || '',
          stream: false, // 非流式请求，直接获取JSON结果
        }),
      });
      if (!res.ok) throw new Error('LLM请求失败');
      const data = await res.json();
      // 兼容多种响应格式
      const optimized = data.choices?.[0]?.message?.content || data.content || data.text || data.output || currentText;
      handleNodeUpdate(nodeId, { config: { ...node.config, textContent: optimized, promptText: optimized, llmOptimizing: false } });
    } catch (err) {
      console.error('LLM优化失败:', err);
      handleNodeUpdate(nodeId, { config: { ...node.config, llmOptimizing: false } });
    }
  }, [wf.nodes, handleNodeUpdate]);

  // P0: 级联一键运行 — 找到当前节点的整条链，从上游到下游依次执行
  const handleCascadeRun = useCallback(async (startNodeId: string) => {
    // 找到链尾（最下游的图片输出节点）
    const findChainTail = (nodeId: string, visited: Set<string>): string => {
      if (visited.has(nodeId)) return nodeId;
      visited.add(nodeId);
      const downstream = wf.connections.filter(c => c.fromNodeId === nodeId);
      if (downstream.length === 0) return nodeId;
      return findChainTail(downstream[0].toNodeId, visited);
    };
    const tailId = findChainTail(startNodeId, new Set());
    // 直接调用工作流执行API
    try {
      await fetch('/api/workflow/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', startNodeId, tailNodeId: tailId, nodes: wf.nodes, connections: wf.connections }),
      });
    } catch (e) { console.error('Cascade run failed:', e); }
  }, [wf.connections, wf.nodes]);

  // P0: 节点字段变更（用于节点上直接编辑）
  const handleNodeFieldChange = useCallback((nodeId: string, field: string, value: unknown) => {
    const node = wf.nodes.find(n => n.id === nodeId);
    if (!node) return;
    handleNodeUpdate(nodeId, { config: { ...node.config, [field]: value } });
    // 当生图节点修改画面比例时，同步调整自动创建的输出图片节点尺寸
    if (field === 'aspectRatio' && isImageGeneratingNode(node.type)) {
      const outSize = getOutputNodeSize(value as string | undefined);
      // 查找与此节点通过 image 连线直接相连的 output-image 节点
      const outConn = wf.connections.find(c =>
        c.fromNodeId === nodeId && c.type === 'image'
      );
      if (outConn) {
        const outNode = wf.nodes.find(n => n.id === outConn.toNodeId);
        if (outNode && (outNode.type === 'output-image' || outNode.type === 'output-image-group')) {
          handleNodeUpdate(outNode.id, {
            width: Math.max(outSize.width, 140),
            height: Math.max(outSize.height, 120),
          });
        }
      }
    }
  }, [wf.nodes, wf.connections, handleNodeUpdate]);

  // P2: 抽取图片到上游源节点
  const handleExtractToSource = useCallback((nodeId: string) => {
    const node = wf.nodes.find(n => n.id === nodeId);
    if (!node || node.type !== 'input-image') return;
    const imageUrl = node.config?.imageUrl;
    if (!imageUrl) return;
    // 创建新的源节点
    const sourceNode = createWorkflowNode('input-image', node.x - 280, node.y);
    sourceNode.config = { ...sourceNode.config, imageUrl, label: '源图' };
    // 清空当前节点的图片
    handleNodeUpdate(nodeId, { config: { ...node.config, imageUrl: '', label: '输出' } });
    // 添加源节点和连线
    setWf(prev => ({
      ...prev,
      nodes: [...prev.nodes, sourceNode],
      connections: [...prev.connections, createConnection(sourceNode.id, 'output-image', nodeId, 'input-image', 'image')],
    }));
  }, [wf.nodes, handleNodeUpdate]);

  // P2: 宫格切分
  const handleGridSplit = useCallback((nodeId: string, cols: number, rows: number) => {
    // 在画布上创建 rows*cols 个新的图片节点
    const node = wf.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const newNodes: WorkflowNode[] = [];
    const newConns: WorkflowConnection[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c + 1;
        const newNode = createWorkflowNode('input-image', node.x + (c - 1) * 260, node.y + 260 + r * 200);
        newNode.config = { ...newNode.config, label: `切分 ${idx}`, gridIndex: idx, gridRow: r + 1, gridCol: c + 1 };
        newNodes.push(newNode);
        newConns.push(createConnection(nodeId, 'output-image', newNode.id, 'input-image', 'image'));
      }
    }
    setWf(prev => ({ ...prev, nodes: [...prev.nodes, ...newNodes], connections: [...prev.connections, ...newConns] }));
  }, [wf.nodes]);

  // P2: 对比滑块 — 找到上游原图，与当前节点图片对比
  const handleCompare = useCallback((nodeId: string) => {
    const node = wf.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const imageUrl = (node.config?.imageUrl as string) || (execResults[nodeId]?.output?.imageUrl as string);
    if (!imageUrl) return;
    // 查找上游输入图片
    const upstreamConn = wf.connections.find(c => c.toNodeId === nodeId && (c.type === 'image' || c.type === 'data'));
    let beforeUrl = '';
    if (upstreamConn) {
      const upNode = wf.nodes.find(n => n.id === upstreamConn.fromNodeId);
      beforeUrl = (upNode?.config?.imageUrl as string) || (execResults[upstreamConn.fromNodeId]?.output?.imageUrl as string) || '';
    }
    if (!beforeUrl) return;
    setCompareImages({ before: beforeUrl, after: imageUrl });
    setComparePosition(50);
  }, [wf.nodes, wf.connections, execResults]);

  // P1: 键盘快捷键 (复制/粘贴/删除)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;

      // Ctrl+C / Cmd+C 复制选中节点（支持多选）
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selectedNodeIds.size > 0) {
        e.preventDefault();
        const selectedNodes = wf.nodes.filter(n => selectedNodeIds.has(n.id));
        if (selectedNodes.length > 0) {
          const relatedConns = wf.connections.filter(c =>
            selectedNodeIds.has(c.fromNodeId) && selectedNodeIds.has(c.toNodeId)
          );
          setClipboard({ nodes: selectedNodes, connections: relatedConns });
        }
      }
      // Ctrl+V / Cmd+V 粘贴节点
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && clipboard) {
        e.preventDefault();
        const idMap = new Map<string, string>();
        const newNodes = clipboard.nodes.map(n => {
          const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          idMap.set(n.id, newId);
          return { ...n, id: newId, x: n.x + 40, y: n.y + 40, label: n.label + ' (副本)' };
        });
        const newConns = clipboard.connections
          .map(c => {
            const newFrom = idMap.get(c.fromNodeId);
            const newTo = idMap.get(c.toNodeId);
            if (!newFrom || !newTo) return null;
            return createConnection(newFrom, c.fromPortId, newTo, c.toPortId, c.type);
          })
          .filter((c): c is WorkflowConnection => c !== null);
        setWf(prev => ({ ...prev, nodes: [...prev.nodes, ...newNodes], connections: [...prev.connections, ...newConns] }));
        if (newNodes.length > 0) {
          setSelectedNodeIds(new Set([newNodes[0].id]));
          setSidebarTab('props');
        }
      }
      // Delete / Backspace 删除选中节点（支持多选）
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeIds.size > 0) {
        e.preventDefault();
        [...selectedNodeIds].forEach(id => handleDeleteNode(id));
      }
      // Ctrl+Z / Cmd+Z 撤销
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      // Ctrl+Shift+Z / Cmd+Shift+Z 重做
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeIds, selectedNodeId, clipboard, wf, handleDeleteNode, handleUndo, handleRedo]);

  // ─── 连线操作 (含端口类型约束) ───

  const handlePortMouseDown = useCallback((e: React.MouseEvent, nodeId: string, port: NodePort) => {
    e.stopPropagation();
    if (port.direction !== 'out') return;
    const node = wf.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const pos = getPortPositionLocal(node, port);
    setDraggingConn({ fromNodeId: nodeId, fromPortId: port.id, fromX: pos.x, fromY: pos.y, toX: pos.x, toY: pos.y, portType: port.type });
  }, [wf.nodes]);

  const handlePortMouseUp = useCallback((nodeId: string, port: NodePort) => {
    if (!draggingConn || port.direction !== 'in') return;
    if (draggingConn.fromNodeId === nodeId) return; // 不允许自连

    // P0: 端口类型约束检查
    if (!canConnectPorts(draggingConn.portType, port.type)) {
      console.warn(`[NodeEditor] 端口类型不兼容: ${draggingConn.portType} → ${port.type}`);
      setDraggingConn(null);
      return;
    }

    // 不允许重复连线
    const exists = wf.connections.some(c =>
      c.fromNodeId === draggingConn.fromNodeId && c.fromPortId === draggingConn.fromPortId &&
      c.toNodeId === nodeId && c.toPortId === port.id
    );
    if (exists) { setDraggingConn(null); return; }

    // 确定连线类型 (取输出端口类型)
    const connType = draggingConn.portType;

    const conn = createConnection(draggingConn.fromNodeId, draggingConn.fromPortId, nodeId, port.id, connType);
    setWf(prev => ({ ...prev, connections: [...prev.connections, conn] }));
    setDraggingConn(null);
  }, [draggingConn, wf.connections]);

  // ─── 画布交互 ───

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // 中键或Alt+左键 = 平移
      const vp = viewportRef.current;
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY, vx: vp.x, vy: vp.y });
    } else if (e.button === 0 && !draggingConn) {
      // 左键点击空白区域 = 取消选中 + 开始框选
      setSelectedNodeIds(new Set());
      setSidebarTab('nodes');
      // 开始框选
      const svgRect = svgRef.current?.getBoundingClientRect();
      const vp = viewportRef.current;
      if (svgRect) {
        const mx = (e.clientX - svgRect.left - vp.x) / vp.zoom;
        const my = (e.clientY - svgRect.top - vp.y) / vp.zoom;
        setBoxSelect({ startX: mx, startY: my, endX: mx, endY: my });
        isBoxSelectingRef.current = true;
      }
    }
  }, [draggingConn]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setViewport(v => ({ ...v, x: panStart.vx + (e.clientX - panStart.x), y: panStart.vy + (e.clientY - panStart.y) }));
    } else if (draggingNodeRef.current) {
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (!svgRect) return;
      const vp = viewportRef.current;
      const mx = (e.clientX - svgRect.left - vp.x) / vp.zoom;
      const my = (e.clientY - svgRect.top - vp.y) / vp.zoom;
      const nodeId = draggingNodeRef.current;
      const offset = dragOffsetRef.current;
      setWf(prev => ({
        ...prev,
        nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, x: mx - offset.x, y: my - offset.y } : n),
      }));
    } else if (draggingConn) {
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (!svgRect) return;
      const vp = viewportRef.current;
      const mx = (e.clientX - svgRect.left - vp.x) / vp.zoom;
      const my = (e.clientY - svgRect.top - vp.y) / vp.zoom;
      setDraggingConn(prev => prev ? { ...prev, toX: mx, toY: my } : null);
    } else if (isBoxSelectingRef.current && boxSelect) {
      // 更新框选范围
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (!svgRect) return;
      const vp = viewportRef.current;
      const mx = (e.clientX - svgRect.left - vp.x) / vp.zoom;
      const my = (e.clientY - svgRect.top - vp.y) / vp.zoom;
      setBoxSelect(prev => prev ? { ...prev, endX: mx, endY: my } : null);
    }
  }, [isPanning, panStart, draggingConn, boxSelect]);

  const handleCanvasMouseUp = useCallback(() => {
    setIsPanning(false);
    if (draggingNodeRef.current) {
      // 拖动结束：标记结束，记录一次历史快照，通知外部
      draggingNodeRef.current = null;
      isDraggingRef.current = false;
      // 手动记录一次历史快照 (使用最新的wf状态)
      setWf(currentWf => {
        prevWfRef.current = currentWf;
        const entry: HistoryEntry = { nodes: currentWf.nodes, connections: currentWf.connections, label: '移动节点' };
        setHistoryStack(prev => {
          // 使用最新的historyIndex，从historyIndexRef读取
          const idx = historyIndexRef.current;
          const newStack = prev.slice(0, idx + 1);
          newStack.push(entry);
          if (newStack.length > 50) newStack.shift();
          return newStack;
        });
        setHistoryIndex(prev => {
          const newIdx = Math.min(prev + 1, 49);
          historyIndexRef.current = newIdx;
          return newIdx;
        });
        // 拖动结束后通知外部
        onWorkflowChange?.(currentWf);
        return currentWf; // 不修改状态，只是读取最新值
      });
    }
    setDraggingConn(null);
    // 完成框选：选中框内所有节点
    if (isBoxSelectingRef.current && boxSelect) {
      const minX = Math.min(boxSelect.startX, boxSelect.endX);
      const maxX = Math.max(boxSelect.startX, boxSelect.endX);
      const minY = Math.min(boxSelect.startY, boxSelect.endY);
      const maxY = Math.max(boxSelect.startY, boxSelect.endY);
      // 判断是否有实际框选范围（避免单击误触发）
      const hasArea = (maxX - minX) > 10 || (maxY - minY) > 10;
      if (hasArea) {
        const nodesInBox = wf.nodes.filter(n =>
          n.x + n.width > minX && n.x < maxX && n.y + n.height > minY && n.y < maxY
        );
        if (nodesInBox.length > 0) {
          setSelectedNodeIds(new Set(nodesInBox.map(n => n.id)));
          setSidebarTab('props');
        }
      }
    }
    setBoxSelect(null);
    isBoxSelectingRef.current = false;
  }, [wf, historyIndex, boxSelect]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    setViewport(v => ({ ...v, zoom: Math.max(0.15, Math.min(3, v.zoom * factor)) }));
  }, []);

  // ─── 执行工作流 ───

  const handleRunWorkflow = useCallback(async () => {
    setExecStatus('running');
    setExecResults({});
    try {
      const res = await fetch('/api/workflow/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', nodes: wf.nodes, connections: wf.connections }),
      });
      const data = await res.json();
      if (data.executionId) {
        setExecutionId(data.executionId);
      } else {
        setExecStatus('failed');
      }
    } catch {
      setExecStatus('failed');
    }
  }, [wf]);

  const handleStopWorkflow = useCallback(async () => {
    if (executionId) {
      await fetch('/api/workflow/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', executionId }),
      });
    }
    setExecStatus('idle');
    setExecutionId(null);
  }, [executionId]);

  // 轮询执行状态
  useEffect(() => {
    if (execStatus !== 'running' || !executionId) return;
    let pollCount = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        pollCount++;
        const res = await fetch('/api/workflow/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', executionId }),
        });
        const data = await res.json();
        if (data.status === 'completed' || data.status === 'failed') {
          setExecStatus(data.status === 'completed' ? 'completed' : 'failed');
          setExecResults(data.results || {});
          // P1: 记录执行日志
          if (data.results) {
            const newLogs = Object.entries(data.results as Record<string, { status: string; output?: Record<string, unknown>; error?: string }>).map(([nodeId, result]) => {
              const node = wf.nodes.find(n => n.id === nodeId);
              return { time: Date.now(), nodeId, label: node?.label || nodeId, status: result.status, message: result.error || (result.output ? '完成' : '未知') };
            });
            setExecLogs(prev => [...prev, ...newLogs]);
          }
          // 持久化: 将工作流生成的图片添加到项目
          if (data.status === 'completed' && onAddImages && data.results) {
            const generatedUrls: string[] = [];
            for (const [, result] of Object.entries(data.results as Record<string, { status: string; output?: Record<string, unknown> }>)) {
              if (result.status === 'success' && result.output) {
                const imgUrls = result.output.imageUrls as string[] | undefined;
                const imgUrl = result.output.imageUrl as string | undefined;
                if (Array.isArray(imgUrls) && imgUrls.length > 0) {
                  generatedUrls.push(...imgUrls);
                } else if (imgUrl) {
                  generatedUrls.push(imgUrl);
                }
              }
            }
            if (generatedUrls.length > 0) {
              onAddImages(generatedUrls);
            }
          }
          return; // done, don't schedule next poll
        } else if (data.results) {
          setExecResults(data.results);
          // P1: 记录运行中的日志
          const newLogs = Object.entries(data.results as Record<string, { status: string; output?: Record<string, unknown>; error?: string }>)
            .filter(([, result]) => result.status === 'success' || result.status === 'failed')
            .map(([nodeId, result]) => {
              const node = wf.nodes.find(n => n.id === nodeId);
              return { time: Date.now(), nodeId, label: node?.label || nodeId, status: result.status, message: result.error || (result.output ? '完成' : '运行中') };
            });
          if (newLogs.length > 0) setExecLogs(prev => [...prev, ...newLogs]);
        }
      } catch {
        setExecStatus('failed');
        return; // error, don't schedule next poll
      }
      // ★ 动态间隔：前5次1秒，5-15次1.5秒，之后2秒
      const delay = pollCount <= 5 ? 1000 : pollCount <= 15 ? 1500 : 2000;
      timerId = setTimeout(poll, delay);
    };
    poll();
    return () => { if (timerId) clearTimeout(timerId); };
  }, [execStatus, executionId]);

  // ─── 保存工作流 ───

  const handleSaveWorkflow = useCallback(async () => {
    setSaveStatus('saving');
    try {
      const userId = localStorage.getItem('wujie_user_id') || 'anonymous';
      const res = await fetch('/api/workflow/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, workflow: { ...wf, updatedAt: Date.now() } }),
      });
      setSaveStatus(res.ok ? 'saved' : 'error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  }, [wf]);

  // ─── 图片上传 ───

  const triggerNodeImageUpload = useCallback((nodeId: string) => {
    pendingImageUploadNodeId.current = nodeId;
    imageFileInputRef.current?.click();
  }, []);

  // ─── 根据图片实际尺寸调整节点大小 ───
  const resizeNodeForImageUrl = useCallback((nodeId: string, imageUrl: string) => {
    const img = new Image();
    img.onload = () => {
      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;
      if (!imgW || !imgH) return;
      const ratio = imgW / imgH;
      const nodeW = 220;
      const nodeH = Math.round(nodeW / ratio);
      const clampedH = Math.max(120, Math.min(400, nodeH));
      setWf(prev => ({
        ...prev,
        nodes: prev.nodes.map((n: WorkflowNode) =>
          n.id === nodeId ? { ...n, width: nodeW, height: clampedH + 56 } : n
        ),
      }));
    };
    img.src = imageUrl;
  }, [setWf]);

  const handleGlobalImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const nodeId = pendingImageUploadNodeId.current;
    if (!file || !nodeId) return;
    // 清空 input value 以支持重复选择同一文件
    e.target.value = '';
    pendingImageUploadNodeId.current = null;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/save-image', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.url) {
        handleNodeUpdate(nodeId, { config: { imageUrl: data.url, source: 'upload' } });
        resizeNodeForImageUrl(nodeId, data.url);
      }
    } catch (err) {
      console.error('[NodeEditor] 节点图片上传失败:', err);
    }
  }, [handleNodeUpdate, resizeNodeForImageUrl]);

  const handleImageUpload = useCallback(async (nodeId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/save-image', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.url) {
        handleNodeUpdate(nodeId, { config: { imageUrl: data.url, source: 'upload' } });
        resizeNodeForImageUrl(nodeId, data.url);
      }
    } catch (e) {
      console.error('[NodeEditor] 图片上传失败:', e);
    }
  }, [handleNodeUpdate, resizeNodeForImageUrl]);

  // ─── AI自然语言建图 ───

  const handleAIBuild = useCallback(async () => {
    if (!aiBuildInput.trim()) return;
    setAiBuildLoading(true);
    setAiBuildError(null);
    try {
      const res = await fetch('/api/workflow/ai-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: aiBuildInput }),
      });
      const data = await res.json();
      if (data.success && data.workflow) {
        setWf(data.workflow);
        setSelectedNodeIds(new Set());
        setSidebarTab('nodes');
        setAiBuildInput('');
      } else {
        setAiBuildError(data.error || 'AI建图失败，请重试');
      }
    } catch (e) {
      setAiBuildError('网络错误，请重试');
      console.error('[NodeEditor] AI建图失败:', e);
    } finally {
      setAiBuildLoading(false);
    }
  }, [aiBuildInput]);

  // ─── 加载预设模板 ───

  const handleLoadPreset = useCallback((preset: WorkflowPreset) => {
    const newWf = createEmptyWorkflow(preset.name);
    newWf.description = preset.description;

    // 创建节点
    const createdNodes = preset.nodes.map((n, i) => {
      const node = createWorkflowNode(n.type, 80 + i * 280, 200, n.label);
      if (n.config) node.config = { ...node.config, ...n.config };
      return node;
    });
    newWf.nodes = createdNodes;

    // 创建连线
    for (const c of preset.connections) {
      const fromNode = createdNodes[c.from];
      const toNode = createdNodes[c.to];
      if (!fromNode || !toNode) continue;
      const fromPort = fromNode.ports.find(p => p.id === c.fromPort && p.direction === 'out')
        || fromNode.ports.find(p => p.direction === 'out');
      const toPort = toNode.ports.find(p => p.id === c.toPort && p.direction === 'in')
        || toNode.ports.find(p => p.direction === 'in');
      if (fromPort && toPort) {
        newWf.connections.push(createConnection(fromNode.id, fromPort.id, toNode.id, toPort.id, c.type));
      }
    }

    // 自动布局
    const layouted = autoLayoutWorkflow(newWf);
    setWf(layouted);
    setSelectedNodeIds(new Set());
    setSidebarTab('nodes');
  }, []);

  // ─── 自动布局 ───

  const handleAutoLayout = useCallback(() => {
    setWf(prev => autoLayoutWorkflow(prev));
  }, []);

  // ─── 连线路径计算 ───

  const getConnPath = useCallback((fromX: number, fromY: number, toX: number, toY: number) => {
    const dx = Math.abs(toX - fromX) * 0.5;
    return `M ${fromX} ${fromY} C ${fromX + dx} ${fromY}, ${toX - dx} ${toY}, ${toX} ${toY}`;
  }, []);

  const getPortPositionLocal = useCallback((node: WorkflowNode, port: NodePort) => {
    const portIndex = node.ports.filter(p => p.direction === port.direction).findIndex(p => p.id === port.id);
    const total = node.ports.filter(p => p.direction === port.direction).length;
    if (port.direction === 'in') {
      return { x: node.x, y: node.y + (portIndex + 1) * (node.height / (total + 1)) };
    }
    return { x: node.x + node.width, y: node.y + (portIndex + 1) * (node.height / (total + 1)) };
  }, []);

  // ─── 高亮连线 (选中节点时高亮上下游) ───

  const getConnectedNodeIds = useMemo(() => {
    if (!highlightNodeId) return new Set<string>();
    const ids = new Set<string>();
    ids.add(highlightNodeId);
    // 上游
    for (const c of wf.connections) {
      if (c.toNodeId === highlightNodeId) ids.add(c.fromNodeId);
      if (c.fromNodeId === highlightNodeId) ids.add(c.toNodeId);
    }
    return ids;
  }, [highlightNodeId, wf.connections]);

  const isConnectionHighlighted = useCallback((conn: WorkflowConnection) => {
    if (!highlightNodeId) return false;
    return conn.fromNodeId === highlightNodeId || conn.toNodeId === highlightNodeId;
  }, [highlightNodeId]);

  // ─── 过滤节点模板 ───

  const filteredTemplates = useMemo(() => {
    if (!searchQuery) return NODE_TEMPLATES;
    const q = searchQuery.toLowerCase();
    return NODE_TEMPLATES.filter(t => t.label.includes(q) || t.desc.includes(q) || t.type.includes(q));
  }, [searchQuery]);

  const groupedTemplates = useMemo(() => {
    const groups: Record<NodeCategory, typeof NODE_TEMPLATES> = {} as never;
    for (const t of filteredTemplates) {
      if (!groups[t.category]) groups[t.category] = [];
      groups[t.category].push(t);
    }
    return groups;
  }, [filteredTemplates]);

  // 过滤预设
  const filteredPresets = useMemo(() => {
    if (!searchQuery) return WORKFLOW_PRESETS;
    const q = searchQuery.toLowerCase();
    return WORKFLOW_PRESETS.filter(p => p.name.includes(q) || p.description.includes(q) || p.tags.some(t => t.includes(q)));
  }, [searchQuery]);

  // ─── 渲染 ───

  return (
    <div className="node-editor-root h-screen w-screen flex flex-col text-foreground overflow-hidden select-none" data-theme={themeStyle === 'monochrome' ? 'monochrome' : 'gold'} style={{ ...neVars, background: T.canvasBg }}>
      {/* 全局图片上传 (foreignObject内input.click()不可靠, 统一由外部触发) */}
      <input ref={imageFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleGlobalImageUpload} />
      {/* 主内容行 */}
      <div className="flex flex-1 min-h-0">
      {/* 左侧栏：竖排图标导航 + 内容区 */}
      <div className="flex flex-shrink-0 h-screen overflow-hidden border-r" style={{ borderColor: T.sidebarBorder }}>
        {/* 竖排图标导航 */}
        <div className="w-[46px] flex flex-col items-center py-2 gap-0.5 border-r flex-shrink-0" style={{ background: T.sidebarBg, borderColor: T.sidebarBorder }}>
          {([
            { key: 'nodes', label: '节点库', icon: <Shapes size={16} /> },
            { key: 'props', label: '属性', icon: <Settings size={16} /> },
            { key: 'ai-build', label: 'AI建图', icon: <Sparkles size={16} /> },
            { key: 'presets', label: '预设', icon: <LayoutGrid size={16} /> },
            { key: 'prompts', label: '词库', icon: <BookOpen size={16} /> },
            { key: 'assistant', label: '助手', icon: <MessageCircle size={16} /> },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setSidebarTab(tab.key)}
              className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer relative group ${sidebarTab === tab.key ? '' : ''}`}
              style={sidebarTab === tab.key ? { color: T.accent, background: `${T.accent}18` } : { color: T.tabInactiveText }}
              title={tab.label}
            >
              {tab.icon}
              {/* tooltip */}
              <span className="absolute left-full ml-2 px-2 py-1 rounded text-[11px] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50" style={{ background: T.cardBg, color: T.sidebarText, border: `1px solid ${T.sidebarBorder}` }}>
                {tab.label}
              </span>
              {/* 活跃指示条 */}
              {sidebarTab === tab.key && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full" style={{ background: T.accent }} />
              )}
            </button>
          ))}
        </div>
        {/* 内容区 */}
        <div className="w-[234px] flex flex-col min-h-0" style={{ background: T.sidebarBg }}>

        {/* 节点库 Tab */}
        {sidebarTab === 'nodes' && (
          <div className="flex-1 overflow-y-auto">
            <div className="p-2 sticky top-0 z-10" style={{ background: T.sidebarBg }}>
              <div className="relative">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: T.sidebarDimmed }} />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索节点..."
                  className="w-full border rounded px-7 py-2 text-sm placeholder:text-muted-foreground focus:outline-none"
                  style={{ background: T.inputBg, borderColor: T.sidebarBorder, color: T.sidebarText }}
                />
              </div>
            </div>
            {Object.entries(groupedTemplates).map(([cat, templates]) => (
              <div key={cat} className="mb-2">
                <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_TYPE_COLORS[cat as NodeCategory] }} />
                  {NODE_CATEGORY_LABELS[cat as NodeCategory]}
                </div>
                {templates.map(t => (
                  <button
                    key={t.type}
                    onClick={() => handleAddNode(t.type)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/5 transition-colors cursor-pointer group"
                  >
                    <span className="text-muted-foreground group-hover:text-[var(--ne-accent)] transition-colors">
                      {getNodeIcon(t.type, 16)}
                    </span>
                    <div className="flex-1 text-left">
                      <div className="text-foreground group-hover:text-foreground text-[13px]">{t.label}</div>
                      <div className="text-[11px] text-muted-foreground">{t.desc}</div>
                    </div>
                    <Plus size={14} className="text-muted-foreground group-hover:text-[var(--ne-accent)] opacity-0 group-hover:opacity-100 transition-all" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* 属性面板 Tab */}
        {sidebarTab === 'props' && (
          <PropertyPanel
            node={selectedNode}
            models={models}
            modelsLoading={modelsLoading}
            onUpdate={handleNodeUpdate}
            onDelete={handleDeleteNode}
            onImageUpload={handleImageUpload}
            canvasImages={allCanvasImages}
          />
        )}

        {/* AI建图 Tab */}
        {sidebarTab === 'ai-build' && (
          <div className="flex-1 flex flex-col p-3 min-h-0 overflow-hidden">
            <div className="mb-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles size={16} className="text-[var(--ne-accent)]" />
                <span className="text-sm font-semibold text-[var(--ne-accent)]">AI 自然语言建图</span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">描述你想要的图像处理需求，AI自动生成完整工作流</p>
            </div>
            <textarea
              value={aiBuildInput}
              onChange={e => setAiBuildInput(e.target.value)}
              placeholder={"例如:\n帮我生成一张赛博朋克风格的城市夜景图，然后去除背景，再放大2倍\n\n或者:\n我要给产品图做商业精修，影棚灯光，白色背景，然后导出PNG"}
              className="flex-1 min-h-[140px] bg-[var(--ne-input-bg)] border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[var(--ne-accent)]/50 resize-none"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAIBuild(); }}
            />
            {aiBuildError && (
              <div className="mt-2 text-sm text-red-400 bg-red-900/20 rounded px-2 py-1">{aiBuildError}</div>
            )}
            <button
              onClick={handleAIBuild}
              disabled={aiBuildLoading || !aiBuildInput.trim()}
              className="mt-3 w-full py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed bg-[var(--ne-accent)]/20 text-[var(--ne-accent)] hover:bg-[var(--ne-accent)]/30"
            >
              {aiBuildLoading ? <><Loader2 size={14} className="animate-spin" /> 生成中...</> : <><Sparkles size={14} /> 生成工作流</>}
            </button>
            <div className="mt-3 text-sm text-muted-foreground">
              <p className="mb-1.5">快捷示例:</p>
              <div className="space-y-1">
                {['生成产品精修图，影棚灯光', '去背景+放大2倍导出PNG', '字境大师生成书法字体Logo', '多角度生成产品四视图'].map(ex => (
                  <button
                    key={ex}
                    onClick={() => setAiBuildInput(ex)}
                    className="block w-full text-left px-2.5 py-2 rounded bg-[var(--ne-input-bg)] hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-sm"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 预设模板 Tab */}
        {sidebarTab === 'presets' && (
          <div className="flex-1 overflow-y-auto p-2">
            {filteredPresets.map(preset => {
              const IconComp = ICON_MAP[preset.icon] || Settings;
              return (
                <button
                  key={preset.id}
                  onClick={() => handleLoadPreset(preset)}
                  className="w-full flex items-start gap-2 p-2 mb-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-left group"
                >
                  <div className="w-8 h-8 rounded-lg bg-[var(--ne-input-bg)] flex items-center justify-center flex-shrink-0 group-hover:bg-[var(--ne-accent)]/10 transition-colors">
                    <IconComp size={14} className="text-muted-foreground group-hover:text-[var(--ne-accent)] transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground group-hover:text-foreground">{preset.name}</div>
                    <div className="text-xs text-muted-foreground">{preset.description}</div>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {preset.tags.map(tag => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--ne-input-bg)] text-muted-foreground">{tag}</span>
                      ))}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">{preset.nodes.length} 节点 · {preset.connections.length} 连线</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* P2: 提示词库 Tab */}
        {sidebarTab === 'prompts' && (
          <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={promptSearch}
                  onChange={e => setPromptSearch(e.target.value)}
                  placeholder="搜索提示词..."
                  className="w-full bg-[var(--ne-input-bg)] border border-border rounded px-6 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[var(--ne-accent)]/50"
                />
              </div>
            </div>
            <div className="p-2 space-y-2 border-b border-border">
              <textarea
                value={newSnippetText}
                onChange={e => setNewSnippetText(e.target.value)}
                placeholder="输入新提示词..."
                className="w-full bg-[var(--ne-input-bg)] border border-border rounded px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[var(--ne-accent)]/50 resize-none h-14"
              />
              <div className="flex gap-1">
                <input
                  value={newSnippetTags}
                  onChange={e => setNewSnippetTags(e.target.value)}
                  placeholder="标签(逗号分隔)"
                  className="flex-1 bg-[var(--ne-input-bg)] border border-border rounded px-3 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[var(--ne-accent)]/50"
                />
                <select
                  value={newSnippetCategory}
                  onChange={e => setNewSnippetCategory(e.target.value)}
                  className="bg-[var(--ne-input-bg)] border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none"
                >
                  <option value="通用">通用</option>
                  <option value="人物">人物</option>
                  <option value="风景">风景</option>
                  <option value="产品">产品</option>
                  <option value="风格">风格</option>
                  <option value="质量">质量</option>
                  <option value="反向">反向</option>
                </select>
              </div>
              <button
                onClick={() => {
                  if (!newSnippetText.trim()) return;
                  savePromptSnippet(newSnippetText.trim(), newSnippetTags.split(',').map(t => t.trim()).filter(Boolean), newSnippetCategory);
                  setNewSnippetText('');
                  setNewSnippetTags('');
                }}
                className="w-full py-1 text-[10px] rounded bg-[var(--ne-accent)]/20 text-[var(--ne-accent)] hover:bg-[var(--ne-accent)]/30 transition-colors cursor-pointer"
              >
                保存提示词
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {promptSnippets
                .filter(s => !promptSearch || s.text.toLowerCase().includes(promptSearch.toLowerCase()) || s.tags.some(t => t.toLowerCase().includes(promptSearch.toLowerCase())))
                .map(snippet => (
                  <div key={snippet.id} className="px-2 py-1.5 border-b border-border/50 hover:bg-white/5 group">
                    <div className="text-xs text-foreground line-clamp-2">{snippet.text}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--ne-input-bg)] text-muted-foreground">{snippet.category}</span>
                      {snippet.tags.map(t => (
                        <span key={t} className="text-[10px] text-muted-foreground">#{t}</span>
                      ))}
                      <div className="flex-1" />
                      <button
                        onClick={() => {
                          const node = selectedNode;
                          if (node && (node.type === 'input-text' || node.type === 'ai-generate' || node.type === 'ai-retouch')) {
                            const currentText = String(node.config.text || node.config.prompt || '');
                            handleNodeUpdate(node.id, { config: { text: currentText + (currentText ? ', ' : '') + snippet.text, prompt: currentText + (currentText ? ', ' : '') + snippet.text } });
                          }
                        }}
                        className="text-[10px] text-[var(--ne-accent)] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        填入
                      </button>
                      <button
                        onClick={() => {
                          setPromptSnippets(prev => {
                            const next = prev.filter(s => s.id !== snippet.id);
                            localStorage.setItem('wujie-prompt-snippets', JSON.stringify(next));
                            return next;
                          });
                        }}
                        className="text-[10px] text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              {promptSnippets.length === 0 && (
                <div className="p-4 text-center text-xs text-muted-foreground">暂无保存的提示词<br />在上方输入框添加</div>
              )}
            </div>
          </div>
        )}

        {/* P2: 画布助手 (节点感知) Tab */}
        {sidebarTab === 'assistant' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {selectedNode && (() => {
                // P1: 计算上游节点链
                const upstreamNodes: WorkflowNode[] = [];
                const visited = new Set<string>();
                const queue = [selectedNode.id];
                visited.add(selectedNode.id);
                while (queue.length > 0) {
                  const currentId = queue.shift()!;
                  const upstreamConns = wf.connections.filter(c => c.toNodeId === currentId);
                  for (const conn of upstreamConns) {
                    if (!visited.has(conn.fromNodeId)) {
                      visited.add(conn.fromNodeId);
                      const upNode = wf.nodes.find(n => n.id === conn.fromNodeId);
                      if (upNode) { upstreamNodes.push(upNode); queue.push(conn.fromNodeId); }
                    }
                  }
                }
                return upstreamNodes.length > 0 ? (
                  <div className="text-[10px] px-2 py-1.5 rounded bg-[var(--ne-accent)]/10 text-[var(--ne-accent)]/80 border border-[var(--ne-accent)]/20">
                    感知节点: [{selectedNode.type}] {selectedNode.label}
                    <div className="mt-1 text-[var(--ne-accent)]/60">
                      上游链路: {upstreamNodes.map(n => `[${n.type}]${n.label}`).join(' → ')} → [{selectedNode.type}]{selectedNode.label}
                    </div>
                  </div>
                ) : (
                  <div className="text-[9px] px-2 py-1 rounded bg-[var(--ne-accent)]/10 text-[var(--ne-accent)]/80 border border-[var(--ne-accent)]/20">
                    感知节点: [{selectedNode.type}] {selectedNode.label}
                  </div>
                );
              })()}
              {assistantMessages.length === 0 && (
                <div className="text-center text-xs text-muted-foreground py-8">
                  <MessageCircle size={20} className="mx-auto mb-2 text-muted-foreground" />
                  工作流助手
                  <br />
                  <span className="text-muted-foreground">选中节点后可获取上下文感知建议</span>
                </div>
              )}
              {assistantMessages.map((msg, i) => (
                <div key={i} className={`text-xs px-2 py-1.5 rounded ${msg.role === 'user' ? 'bg-[var(--ne-input-bg)] text-foreground ml-4' : 'bg-[var(--ne-accent)]/10 text-foreground mr-4'}`}>
                  <div className="text-[10px] text-muted-foreground mb-0.5">{msg.role === 'user' ? '你' : '助手'}</div>
                  {msg.content}
                </div>
              ))}
              {assistantLoading && (
                <div className="text-xs px-2 py-1.5 rounded bg-[var(--ne-accent)]/10 text-muted-foreground mr-4">
                  <Loader2 size={10} className="animate-spin inline mr-1" />思考中...
                </div>
              )}
            </div>
            <div className="p-2 border-t border-border flex gap-1">
              <input
                value={assistantInput}
                onChange={e => setAssistantInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAssistantMessage(); } }}
                placeholder="输入问题..."
                className="flex-1 bg-[var(--ne-input-bg)] border border-border rounded px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[var(--ne-accent)]/50"
              />
              <button onClick={sendAssistantMessage} disabled={assistantLoading || !assistantInput.trim()} className="p-1 rounded bg-[var(--ne-accent)]/20 text-[var(--ne-accent)] hover:bg-[var(--ne-accent)]/30 transition-colors cursor-pointer disabled:opacity-30">
                <Zap size={12} />
              </button>
            </div>
          </div>
        )}
        </div>{/* 内容区 end */}
      </div>{/* 左侧栏外层 end */}

      {/* 画布+内容面板 垂直容器 */}
      <div className="flex flex-col flex-1 min-h-0">
      {/* 主画布 */}
      <div className="flex-1 relative min-h-0">
        {/* 顶部工具栏 */}
        <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onBack && (
              <button onClick={onBack} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ne-accent)]/15 hover:bg-[var(--ne-accent)]/25 text-[var(--ne-accent)] transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer text-sm font-medium" title="切换到画布模式">
                <ArrowLeft size={15} />
                <span>画布模式</span>
              </button>
            )}
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ne-input-bg)] hover:bg-[var(--ne-card-bg)] text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer text-sm" title="工作流中心">
              <WorkflowIcon size={15} />
              <span>工作流中心</span>
            </button>
            <span className="text-base font-semibold text-[var(--ne-accent)]">{wf.name}</span>
            <span className="text-sm text-muted-foreground">v{wf.version}</span>
            <span className="text-sm text-muted-foreground">|</span>
            <span className="text-sm text-muted-foreground">{wf.nodes.length} 节点 · {wf.connections.length} 连线</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={handleAutoLayout} className="p-2 rounded bg-[var(--ne-input-bg)] hover:bg-[var(--ne-card-bg)] text-muted-foreground hover:text-foreground transition-colors cursor-pointer" title="自动布局">
              <LayoutGrid size={16} />
            </button>
            {/* P1: 复制粘贴按钮 */}
            <button
              onClick={() => {
                if (selectedNodeIds.size === 0) return;
                const selectedNodes = wf.nodes.filter(n => selectedNodeIds.has(n.id));
                const relatedConns = wf.connections.filter(c => selectedNodeIds.has(c.fromNodeId) && selectedNodeIds.has(c.toNodeId));
                setClipboard({ nodes: selectedNodes, connections: relatedConns });
              }}
              disabled={selectedNodeIds.size === 0}
              className="p-2 rounded bg-[var(--ne-input-bg)] hover:bg-[var(--ne-card-bg)] text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title="复制节点 (Ctrl+C)"
            >
              <Copy size={16} />
            </button>
            <button
              onClick={() => {
                if (!clipboard) return;
                const idMap = new Map<string, string>();
                const newNodes = clipboard.nodes.map(n => {
                  const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  idMap.set(n.id, newId);
                  return { ...n, id: newId, x: n.x + 40, y: n.y + 40, label: n.label + ' (副本)' };
                });
                const newConns = clipboard.connections
                  .map(c => {
                    const newFrom = idMap.get(c.fromNodeId);
                    const newTo = idMap.get(c.toNodeId);
                    if (!newFrom || !newTo) return null;
                    return createConnection(newFrom, c.fromPortId, newTo, c.toPortId, c.type);
                  })
                  .filter((c): c is WorkflowConnection => c !== null);
                setWf(prev => ({ ...prev, nodes: [...prev.nodes, ...newNodes], connections: [...prev.connections, ...newConns] }));
                if (newNodes.length > 0) { setSelectedNodeIds(new Set([newNodes[0].id])); setSidebarTab('props'); }
              }}
              disabled={!clipboard}
              className="p-2 rounded bg-[var(--ne-input-bg)] hover:bg-[var(--ne-card-bg)] text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title="粘贴节点 (Ctrl+V)"
            >
              <Clipboard size={16} />
            </button>
            <button onClick={() => setViewport(v => ({ ...v, zoom: Math.min(3, v.zoom * 1.2) }))} className="p-2 rounded bg-[var(--ne-input-bg)] hover:bg-[var(--ne-card-bg)] text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <ZoomIn size={16} />
            </button>
            <span className="text-xs text-muted-foreground w-12 text-center">{Math.round(viewport.zoom * 100)}%</span>
            <button onClick={() => setViewport(v => ({ ...v, zoom: Math.max(0.2, v.zoom * 0.8) }))} className="p-2 rounded bg-[var(--ne-input-bg)] hover:bg-[var(--ne-card-bg)] text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <ZoomOut size={16} />
            </button>
            <button onClick={() => setViewport({ x: 0, y: 0, zoom: 0.8 })} className="p-2 rounded bg-[var(--ne-input-bg)] hover:bg-[var(--ne-card-bg)] text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer">
              <RotateCcw size={16} />
            </button>
            {/* P2: ComfyUI导入 */}
            <button
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const result = parseComfyUIWorkflow(text);
                    if (!result || result.nodes.length === 0) {
                      alert('未能识别有效的ComfyUI工作流节点');
                      return;
                    }
                    setWf(prev => ({
                      ...prev,
                      nodes: [...prev.nodes, ...result.nodes],
                      connections: [...prev.connections, ...result.connections],
                    }));
                  } catch (err) {
                    alert('导入失败: ' + (err instanceof Error ? err.message : '无效的JSON文件'));
                  }
                };
                input.click();
              }}
              className="p-2 rounded bg-[var(--ne-input-bg)] hover:bg-[var(--ne-card-bg)] text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer"
              title="导入ComfyUI工作流"
            >
              <FileInput size={16} />
            </button>
            <div className="w-px h-5 bg-muted mx-1" />
            {/* P2: 撤销重做按钮 */}
            <button onClick={handleUndo} disabled={historyIndex <= 0} className="p-2 rounded bg-[var(--ne-input-bg)] hover:bg-[var(--ne-card-bg)] text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="撤销 (Ctrl+Z)">
              <RotateCcw size={16} />
            </button>
            <button onClick={handleRedo} disabled={historyIndex >= historyStack.length - 1} className="p-2 rounded bg-[var(--ne-input-bg)] hover:bg-[var(--ne-card-bg)] text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="重做 (Ctrl+Shift+Z)">
              <RotateCcw size={16} className="scale-x-[-1]" />
            </button>
            {/* P2: JSON编辑器（build_mode下隐藏） */}
            {!isBuildMode && (
            <button
              onClick={() => {
                setJsonEditContent(JSON.stringify({ nodes: wf.nodes, connections: wf.connections }, null, 2));
                setJsonEditorOpen(true);
              }}
              className="p-2 rounded bg-[var(--ne-input-bg)] hover:bg-[var(--ne-card-bg)] text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer"
              title="查看/编辑JSON"
            >
              <Settings size={16} />
            </button>
            )}
            <div className="w-px h-5 bg-muted mx-1" />
            <button onClick={handleSaveWorkflow} disabled={saveStatus === 'saving'} className={`px-3 py-2 rounded text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${saveStatus === 'saved' ? 'bg-green-900/30 text-green-400' : saveStatus === 'error' ? 'bg-red-900/30 text-red-400' : 'bg-[var(--ne-input-bg)] hover:bg-[var(--ne-card-bg)] text-foreground'}`}>
              {saveStatus === 'saving' ? <Loader2 size={14} className="animate-spin" /> : saveStatus === 'saved' ? <Check size={14} /> : <Save size={14} />}
              {saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存' : '保存'}
            </button>
            <button onClick={execStatus === 'running' ? handleStopWorkflow : handleRunWorkflow} className={`px-3 py-2 rounded text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-1.5 ${execStatus === 'running' ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50' : 'bg-[var(--ne-accent)]/20 text-[var(--ne-accent)] hover:bg-[var(--ne-accent)]/30'}`}>
              {execStatus === 'running' ? <><Square size={14} /> 停止</> : <><Play size={14} /> 运行</>}
            </button>
          </div>
        </div>

        {/* SVG画布 */}
        <svg
          ref={svgRef}
          className="w-full h-full canvas-bg"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onWheel={handleWheel}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDrop={handleCanvasImageDrop}
          style={{ cursor: isPanning ? 'grabbing' : draggingConn ? 'crosshair' : 'default' }}
        >
          {/* 网格背景 */}
          <defs>
            <pattern id="grid" width={20 * viewport.zoom} height={20 * viewport.zoom} patternUnits="userSpaceOnUse" x={viewport.x % (20 * viewport.zoom)} y={viewport.y % (20 * viewport.zoom)}>
              <circle cx={1} cy={1} r={0.5} fill={T.gridDot} />
            </pattern>
            {/* 端口类型标记 */}
            <marker id="arrow-image" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill={PORT_COLORS.image} />
            </marker>
            <marker id="arrow-prompt" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill={PORT_COLORS.prompt} />
            </marker>
            <marker id="arrow-mask" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill={PORT_COLORS.mask} />
            </marker>
            <marker id="arrow-condition" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill={PORT_COLORS.condition} />
            </marker>
            <marker id="arrow-data" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill={PORT_COLORS.data} />
            </marker>
            <marker id="arrow-default" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill={T.connColor} />
            </marker>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}>
            {/* 连线 */}
            {wf.connections.map(conn => {
              const fromNode = wf.nodes.find(n => n.id === conn.fromNodeId);
              const toNode = wf.nodes.find(n => n.id === conn.toNodeId);
              if (!fromNode || !toNode) return null;
              const fromPort = fromNode.ports.find(p => p.id === conn.fromPortId);
              const toPort = toNode.ports.find(p => p.id === conn.toPortId);
              if (!fromPort || !toPort) return null;
              const from = getPortPositionLocal(fromNode, fromPort);
              const to = getPortPositionLocal(toNode, toPort);
              const color = PORT_COLORS[conn.type] || T.connColor;
              const isHighlighted = isConnectionHighlighted(conn);
              const isRunning = execStatus === 'running' && (execResults[conn.fromNodeId]?.status === 'success');

              // 箭头marker ID
              const markerId = conn.type === 'image' ? 'arrow-image'
                : conn.type === 'prompt' ? 'arrow-prompt'
                : conn.type === 'mask' ? 'arrow-mask'
                : conn.type === 'condition' ? 'arrow-condition'
                : conn.type === 'data' ? 'arrow-data'
                : 'arrow-default';

              return (
                <g key={conn.id}>
                  {/* P1: 输入引用阻断 — 检查是否被阻断 */}
                  {(() => {
                    const isBlocked = Array.isArray(toNode.config?.blockedInputs) && (toNode.config.blockedInputs as string[]).includes(conn.id);
                    return (
                      <>
                        {/* 发光效果(高亮时) */}
                        {isHighlighted && !isBlocked && (
                          <path
                            d={getConnPath(from.x, from.y, to.x, to.y)}
                            fill="none" stroke={color} strokeWidth={6}
                            strokeOpacity={0.15}
                          />
                        )}
                        <path
                          d={getConnPath(from.x, from.y, to.x, to.y)}
                          fill="none" stroke={isBlocked ? '#666' : color} strokeWidth={isHighlighted ? 2.5 : 1.8}
                          strokeOpacity={isBlocked ? 0.3 : isHighlighted ? 1 : isRunning ? 0.9 : 0.45}
                          strokeLinecap="round"
                          strokeDasharray={isBlocked ? '4 4' : undefined}
                          markerEnd={isBlocked ? undefined : `url(#${markerId})`}
                          className={isRunning && !isBlocked ? 'animate-pulse' : 'transition-all duration-200'}
                        />
                        {/* 数据流动画 (执行中, 未阻断) — 双层流动效果 */}
                        {isRunning && !isBlocked && (
                          <>
                            {/* 虚线流动 (与原型对齐) */}
                            <path
                              d={getConnPath(from.x, from.y, to.x, to.y)}
                              fill="none" stroke={color} strokeWidth={1.5}
                              strokeOpacity={0.6}
                              strokeDasharray="8 4"
                              className="ne-conn-flowing"
                            />
                            {/* 流动粒子 */}
                            <circle r={3} fill={color}>
                              <animateMotion dur="1.5s" repeatCount="indefinite" path={getConnPath(from.x, from.y, to.x, to.y)} />
                            </circle>
                          </>
                        )}
                        {/* 连线类型标签 */}
                        {(conn.type !== 'any' && (isHighlighted || viewport.zoom > 0.6)) && (
                          <text
                            x={(from.x + to.x) / 2}
                            y={(from.y + to.y) / 2 - 6}
                            textAnchor="middle"
                            fill={isBlocked ? '#666' : color}
                            fontSize={10}
                            fillOpacity={isBlocked ? 0.4 : 0.7}
                            className="pointer-events-none"
                          >
                            {isBlocked ? 'blocked' : conn.type}
                          </text>
                        )}
                        {/* P1: 阻断切换按钮 (连线中点) */}
                        <g
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            const blocked = Array.isArray(toNode.config?.blockedInputs) ? [...(toNode.config.blockedInputs as string[])] : [];
                            const idx = blocked.indexOf(conn.id);
                            if (idx >= 0) blocked.splice(idx, 1);
                            else blocked.push(conn.id);
                            setWf(prev => ({
                              ...prev,
                              nodes: prev.nodes.map(n =>
                                n.id === toNode.id ? { ...n, config: { ...n.config, blockedInputs: blocked } } : n
                              ),
                            }));
                          }}
                        >
                          <circle
                            cx={(from.x + to.x) / 2}
                            cy={(from.y + to.y) / 2}
                            r={6}
                            fill={isBlocked ? '#ef4444' : 'transparent'}
                            stroke={isBlocked ? '#ef4444' : 'transparent'}
                            strokeWidth={1}
                            opacity={isHighlighted || isBlocked ? 1 : 0}
                            className="transition-opacity"
                          />
                          {isBlocked && (
                            <text
                              x={(from.x + to.x) / 2}
                              y={(from.y + to.y) / 2 + 3.5}
                              textAnchor="middle"
                              fill="white"
                              fontSize={8}
                              fontWeight="bold"
                            >✕</text>
                          )}
                        </g>
                        {/* 点击删除连线 (增大点击区域) */}
                        <path
                          d={getConnPath(from.x, from.y, to.x, to.y)}
                          fill="none" stroke="transparent" strokeWidth={16}
                          onClick={() => {
                            setWf(prev => ({ ...prev, connections: prev.connections.filter(c => c.id !== conn.id) }));
                          }}
                          className="cursor-pointer"
                        />
                      </>
                    );
                  })()}
                </g>
              );
            })}

            {/* 临时连线 (端口类型约束: 临时连线颜色随端口类型) */}
            {draggingConn && (
              <path
                d={getConnPath(draggingConn.fromX, draggingConn.fromY, draggingConn.toX, draggingConn.toY)}
                fill="none" stroke={PORT_COLORS[draggingConn.portType]} strokeWidth={2} strokeDasharray="6 4" strokeOpacity={0.7}
              />
            )}

            {/* 框选矩形 */}
            {boxSelect && (() => {
              const minX = Math.min(boxSelect.startX, boxSelect.endX);
              const minY = Math.min(boxSelect.startY, boxSelect.endY);
              const w = Math.abs(boxSelect.endX - boxSelect.startX);
              const h = Math.abs(boxSelect.endY - boxSelect.startY);
              if (w < 5 && h < 5) return null;
              return (
                <rect
                  x={minX} y={minY} width={w} height={h}
                  fill="rgba(212, 175, 55, 0.08)" stroke="rgba(212, 175, 55, 0.4)"
                  strokeWidth={1} strokeDasharray="4 2" rx={2}
                />
              );
            })()}

            {/* 节点 */}
            {wf.nodes.map(node => (
              <NodeCard
                key={node.id}
                node={node}
                isSelected={selectedNodeIds.has(node.id)}
                isHighlighted={getConnectedNodeIds.has(node.id)}
                isHovered={hoveredNodeId === node.id}
                execResult={execResults[node.id]}
                isRunning={execStatus === 'running'}
                theme={T}
                onSelect={(e) => {
                  if (e && (e.ctrlKey || e.metaKey)) {
                    // Ctrl+点击: 切换多选
                    setSelectedNodeIds(prev => {
                      const next = new Set(prev);
                      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
                      return next;
                    });
                  } else {
                    // 普通点击: 单选
                    setSelectedNodeIds(new Set([node.id]));
                  }
                  setSidebarTab('props');
                }}
                onHover={(id: string | null) => { setHighlightNodeId(id); setHoveredNodeId(id); }}
                onDragStart={(e) => {
                  const svgRect = svgRef.current?.getBoundingClientRect();
                  if (!svgRect) return;
                  const vp = viewportRef.current;
                  const mx = (e.clientX - svgRect.left - vp.x) / vp.zoom;
                  const my = (e.clientY - svgRect.top - vp.y) / vp.zoom;
                  draggingNodeRef.current = node.id;
                  dragOffsetRef.current = { x: mx - node.x, y: my - node.y };
                  isDraggingRef.current = true;
                  // 拖动开始时取消框选
                  setBoxSelect(null);
                  isBoxSelectingRef.current = false;
                }}
                onPortMouseDown={handlePortMouseDown}
                onPortMouseUp={handlePortMouseUp}
                onDelete={() => handleDeleteNode(node.id)}
                onDeselect={() => setSelectedNodeIds(new Set())}
                onPreviewImage={(url) => setImagePreviewUrl(url)}
                onLlmOptimize={handleLlmOptimize}
                onCascadeRun={handleCascadeRun}
                onNodeFieldChange={handleNodeFieldChange}
                onExtractToSource={handleExtractToSource}
                onGridSplit={handleGridSplit}
                onCompare={handleCompare}
                onTriggerImageUpload={triggerNodeImageUpload}
                upstreamImageUrl={(() => {
                  const upConn = wf.connections.find(c => c.toNodeId === node.id && (c.type === 'image' || c.type === 'data'));
                  if (!upConn) return undefined;
                  const upNode = wf.nodes.find(n => n.id === upConn.fromNodeId);
                  const url = (upNode?.config?.imageUrl as string) || (execResults[upConn.fromNodeId]?.output?.imageUrl as string);
                  return url || undefined;
                })()}
                llmModels={chatModels}
                canvasImages={canvasImages}
                onResizeNode={resizeNodeForImageUrl}
                collapsedNodes={collapsedNodes}
                onToggleCollapse={toggleNodeCollapse}
              />
            ))}
          </g>
        </svg>

        {/* 端口类型图例 */}
        <div className="absolute bottom-3 left-3 bg-[var(--ne-card-bg)]/90 border border-border rounded px-3 py-2 flex items-center gap-3 text-xs">
          {Object.entries(PORT_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-muted-foreground">{type}</span>
            </div>
          ))}
        </div>

        {/* 小地图（P2增强：视口指示+点击导航） */}
        {showMinimap && (() => {
          const padding = 100;
          const allX = wf.nodes.map(n => n.x);
          const allY = wf.nodes.map(n => n.y);
          const minX = Math.min(0, ...allX) - padding;
          const minY = Math.min(0, ...allY) - padding;
          const maxX = Math.max(1200, ...allX.map((x, i) => x + wf.nodes[i].width)) + padding;
          const maxY = Math.max(800, ...allY.map((y, i) => y + wf.nodes[i].height)) + padding;
          const vw = maxX - minX;
          const vh = maxY - minY;
          const scale = Math.min(160 / vw, 100 / vh);
          // 视口框坐标（相对于小地图）
          const vpScreenW = (typeof window !== 'undefined' ? window.innerWidth * 0.65 : 800) / viewport.zoom;
          const vpScreenH = (typeof window !== 'undefined' ? window.innerHeight * 0.85 : 600) / viewport.zoom;
          const vpX = (-viewport.x / viewport.zoom - minX) * scale;
          const vpY = (-viewport.y / viewport.zoom - minY) * scale;
          const vpW = vpScreenW * scale;
          const vpH = vpScreenH * scale;
          return (
            <div
              className="absolute bottom-3 right-3 w-[160px] h-[100px] bg-[var(--ne-card-bg)]/90 border border-border rounded overflow-hidden cursor-pointer"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const clickY = e.clientY - rect.top;
                // 点击位置对应的画布坐标
                const canvasX = clickX / scale + minX;
                const canvasY = clickY / scale + minY;
                setViewport(v => ({
                  ...v,
                  x: -(canvasX * v.zoom - (typeof window !== 'undefined' ? window.innerWidth * 0.65 : 800) / 2),
                  y: -(canvasY * v.zoom - (typeof window !== 'undefined' ? window.innerHeight * 0.85 : 600) / 2),
                }));
              }}
            >
              <svg viewBox={`${minX} ${minY} ${vw} ${vh}`} className="w-full h-full">
                <defs>
                  <style>{`@keyframes fadeOut { from { stroke-opacity: 0.6; } to { stroke-opacity: 0; } }`}</style>
                </defs>
                {wf.connections.map(conn => {
                  const from = wf.nodes.find(n => n.id === conn.fromNodeId);
                  const to = wf.nodes.find(n => n.id === conn.toNodeId);
                  if (!from || !to) return null;
                  return <line key={conn.id} x1={from.x + from.width / 2} y1={from.y + from.height / 2} x2={to.x + to.width / 2} y2={to.y + to.height / 2} stroke={PORT_COLORS[conn.type] || T.connColor} strokeWidth={2} opacity={0.6} />;
                })}
                {wf.nodes.map(n => (
                  <rect key={n.id} x={n.x} y={n.y} width={n.width} height={n.height} rx={4}
                    fill={selectedNodeIds.has(n.id) ? 'var(--ne-accent)' : NODE_TYPE_COLORS[getNodeCategory(n.type)]}
                    fillOpacity={0.6} stroke="none"
                  />
                ))}
              </svg>
              {/* 视口指示框 */}
              <div
                className="absolute border border-[var(--ne-accent)]/60 bg-[var(--ne-accent)]/10 rounded-sm pointer-events-none"
                style={{
                  left: Math.max(0, vpX),
                  top: Math.max(0, vpY),
                  width: Math.min(160, vpW),
                  height: Math.min(100, vpH),
                }}
              />
              <button onClick={(e) => { e.stopPropagation(); setShowMinimap(false); }} className="absolute top-0.5 right-0.5 text-muted-foreground hover:text-muted-foreground cursor-pointer z-10">
                <X size={10} />
              </button>
            </div>
          );
        })()}

        {/* 执行状态栏 */}
        {execStatus !== 'idle' && (
          <div className="absolute bottom-12 left-3 bg-[var(--ne-card-bg)]/95 border border-border rounded px-3 py-2 flex items-center gap-3 text-sm">
            {execStatus === 'running' && <Loader2 size={14} className="animate-spin text-[var(--ne-accent)]" />}
            {execStatus === 'completed' && <Check size={14} className="text-green-400" />}
            {execStatus === 'failed' && <AlertCircle size={14} className="text-red-400" />}
            <span className={execStatus === 'running' ? 'text-[var(--ne-accent)]' : execStatus === 'completed' ? 'text-green-400' : 'text-red-400'}>
              {execStatus === 'running' ? '执行中...' : execStatus === 'completed' ? '执行完成' : '执行失败'}
            </span>
            <span className="text-muted-foreground">
              {Object.keys(execResults).length}/{wf.nodes.length} 节点
            </span>
            <button onClick={() => { setExecStatus('idle'); setExecResults({}); setExecLogs([]); }} className="text-muted-foreground hover:text-foreground cursor-pointer">
              <X size={12} />
            </button>
          </div>
        )}

        {/* P2: 执行日志面板 (增强版) */}
        {execLogs.length > 0 && (
          <div className="absolute bottom-12 right-3 w-[380px] max-h-[280px] bg-[var(--ne-card-bg)]/95 border border-border rounded-lg overflow-hidden flex flex-col shadow-lg">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-[var(--ne-input-bg)]/50">
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">执行日志</span>
              <div className="flex items-center gap-2">
                {(() => {
                  const success = execLogs.filter(l => l.status === 'success').length;
                  const failed = execLogs.filter(l => l.status === 'error').length;
                  const total = execLogs.length;
                  return (
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <span className="text-green-400">{success} 通过</span>
                      {failed > 0 && <span className="text-red-400">{failed} 失败</span>}
                      <span className="text-muted-foreground">{total} 总计</span>
                    </div>
                  );
                })()}
                <button onClick={() => setExecLogs([])} className="text-muted-foreground hover:text-foreground cursor-pointer"><X size={10} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto text-[10px]">
              {execLogs.map((log, i) => {
                const nodeIcon = log.nodeType === 'image' ? '🖼' : log.nodeType === 'text' ? '📝' : log.nodeType === 'control' ? '🔄' : '⚙';
                return (
                  <div key={i} className={`flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 ${log.status === 'error' ? 'bg-red-500/5' : ''}`}>
                    <span className="flex-shrink-0 text-[10px]">{nodeIcon}</span>
                    {log.status === 'success' ? <Check size={8} className="text-green-400 flex-shrink-0" /> : log.status === 'running' ? <Loader2 size={8} className="text-yellow-400 flex-shrink-0 animate-spin" /> : <AlertCircle size={8} className="text-red-400 flex-shrink-0" />}
                    <span className="text-foreground/80 flex-shrink-0 font-medium">{log.label}</span>
                    <span className={`flex-1 truncate ${log.status === 'success' ? 'text-green-400/60' : log.status === 'running' ? 'text-yellow-400/60' : 'text-red-400/60'}`}>{log.message}</span>
                    {log.duration != null && <span className="text-muted-foreground/60 flex-shrink-0 tabular-nums">{log.duration >= 1000 ? `${(log.duration / 1000).toFixed(1)}s` : `${log.duration}ms`}</span>}
                    <span className="text-muted-foreground/40 flex-shrink-0">{new Date(log.time).toLocaleTimeString()}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>{/* 主画布 end */}

      {/* 底部内容面板 - 用户项目图片 */}
      <ContentPanel canvasImages={canvasImages} onDragImage={() => {}} themeStyle={themeStyle} />
      </div>{/* 画布+内容面板 垂直容器 end */}
      </div>{/* 主内容行 end */}

      {/* 图片预览弹窗 */}
      {imagePreviewUrl && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={() => setImagePreviewUrl(null)}>
          <div className="relative max-w-[80vw] max-h-[80vh]">
            <img src={imagePreviewUrl} alt="预览" className="max-w-full max-h-[80vh] rounded shadow-2xl" />
            <button onClick={() => setImagePreviewUrl(null)} className="absolute -top-2 -right-2 p-1 bg-[var(--ne-input-bg)] rounded-full text-muted-foreground hover:text-foreground cursor-pointer">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* P2: 对比滑块弹窗 */}
      {compareImages && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center" onClick={() => setCompareImages(null)}>
          <div className="relative w-[80vw] max-w-[900px] aspect-video bg-black rounded-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Before 图片 (底层, 完整显示) */}
            <img src={compareImages.before} alt="原图" className="absolute inset-0 w-full h-full object-contain" />
            {/* After 图片 (顶层, clip 裁切) */}
            <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${comparePosition}%)` }}>
              <img src={compareImages.after} alt="结果" className="w-full h-full object-contain" />
            </div>
            {/* 滑块线 */}
            <div className="absolute top-0 bottom-0 w-0.5 bg-white/80" style={{ left: `${comparePosition}%` }}>
              <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg cursor-ew-resize"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const startX = e.clientX;
                  const startPos = comparePosition;
                  const container = (e.target as HTMLElement).closest('.relative')!;
                  const containerRect = container.getBoundingClientRect();
                  const onMove = (ev: MouseEvent) => {
                    const delta = ev.clientX - startX;
                    const pct = startPos + (delta / containerRect.width) * 100;
                    setComparePosition(Math.max(0, Math.min(100, pct)));
                  };
                  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }}>
                <span className="text-black text-xs font-bold">⟺</span>
              </div>
            </div>
            {/* 标签 */}
            <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 text-white text-xs rounded">原图</div>
            <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/60 text-white text-xs rounded">结果</div>
            <button onClick={() => setCompareImages(null)} className="absolute -top-2 -right-2 p-1 bg-[var(--ne-input-bg)] rounded-full text-muted-foreground hover:text-foreground cursor-pointer z-10">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* P2: JSON编辑器弹窗 */}
      {jsonEditorOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={() => setJsonEditorOpen(false)}>
          <div className="w-[640px] max-h-[80vh] bg-[var(--ne-card-bg)] border border-border rounded-lg flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <span className="text-sm font-semibold text-[var(--ne-accent)]">工作流 JSON 编辑器</span>
              <button onClick={() => setJsonEditorOpen(false)} className="text-muted-foreground hover:text-foreground cursor-pointer"><X size={14} /></button>
            </div>
            <textarea
              value={jsonEditContent}
              onChange={e => setJsonEditContent(e.target.value)}
              className="flex-1 min-h-[400px] bg-[var(--ne-input-bg)] text-green-400/80 font-mono text-[10px] p-3 focus:outline-none resize-none"
              spellCheck={false}
            />
            <div className="flex justify-end gap-2 px-4 py-2 border-t border-border">
              <button onClick={() => setJsonEditorOpen(false)} className="px-3 py-1.5 text-xs rounded bg-muted text-muted-foreground hover:text-foreground cursor-pointer">取消</button>
              <button
                onClick={() => {
                  try {
                    const parsed = JSON.parse(jsonEditContent);
                    if (parsed.nodes && parsed.connections) {
                      setWf(prev => ({ ...prev, nodes: parsed.nodes, connections: parsed.connections }));
                      setJsonEditorOpen(false);
                    }
                  } catch { /* JSON解析失败，不关闭 */ }
                }}
                className="px-3 py-1 text-[10px] rounded bg-[var(--ne-accent)]/20 text-[var(--ne-accent)] hover:bg-[var(--ne-accent)]/30 cursor-pointer"
              >
                应用更改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 节点卡片 ====================

type NodeThemeType = (typeof nodeThemes)[keyof typeof nodeThemes];

interface NodeCardProps {
  node: WorkflowNode;
  isSelected: boolean;
  isHighlighted: boolean;
  isHovered: boolean;
  execResult?: { status: string; output?: Record<string, unknown>; error?: string };
  isRunning: boolean;
  theme: NodeThemeType;
  canvasImages?: CanvasImageRef[];
  llmModels?: ModelOption[];
  onNodeFieldChange?: (nodeId: string, fieldId: string, value: unknown) => void;
  onLlmOptimize?: (nodeId: string, prompt: string, model: string, systemPrompt: string, instruction: string) => void;
  onCascadeRun?: (nodeId: string) => void;
  onExtractToSource?: (nodeId: string) => void;
  onGridSplit?: (nodeId: string, cols: number, rows: number) => void;
  onCompare?: (nodeId: string) => void;
  onTriggerImageUpload?: (nodeId: string) => void;
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
  collapsedNodes?: Set<string>;
  onToggleCollapse?: (nodeId: string) => void;
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
          style={{ background: T.nodeBg === '#1a1a1a' ? '#252525' : '#f0f0f0' }}
          onClick={() => onPreviewImage(currentUrl)}
        >
          <img src={currentUrl} alt={`图片 ${page + 1}`} className="max-w-full max-h-full object-contain transition-opacity opacity-90 group-hover:opacity-100" />
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
            background: T.nodeBg === '#1a1a1a' ? '#1f1f1f' : '#fafafa',
          }}
        >
          <Layers size={22} style={{ color: T.accent, opacity: 0.35 }} />
          <span className="text-[10px] font-medium" style={{ color: T.nodeBg === '#1a1a1a' ? '#555' : '#999' }}>等待图片组</span>
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

function NodeCard({ node, isSelected, isHighlighted, isHovered, execResult, isRunning, theme, canvasImages, llmModels, onNodeFieldChange, onLlmOptimize, onCascadeRun, onExtractToSource, onGridSplit, onCompare, onTriggerImageUpload, upstreamImageUrl, onSelect, onHover, onDragStart, onPortMouseDown, onPortMouseUp, onDelete, onDeselect, onPreviewImage, onResizeNode, collapsedNodes, onToggleCollapse }: NodeCardProps) {
  const T = theme;
  const cat = getNodeCategory(node.type);
  const color = NODE_TYPE_COLORS[cat];
  const inputPorts = node.ports.filter(p => p.direction === 'in');
  const outputPorts = node.ports.filter(p => p.direction === 'out');
  const isCondition = node.type.startsWith('condition-');
  const isInputText = node.type === 'input-text';
  const isInputImage = node.type === 'input-image';
  const isOutputImage = node.type === 'output-image';
  const isOutputImageGroup = node.type === 'output-image-group';

  const statusColor = execResult?.status === 'success' ? T.statusSuccess
    : execResult?.status === 'failed' ? T.statusError
    : isRunning ? 'var(--ne-accent)' : 'transparent';

  // 图片URL: 优先执行结果, 其次节点配置(input-image节点)
  const hasImageOutput = (execResult?.output?.imageUrl || node.config?.imageUrl) as string | undefined;
  // 画布模式专用节点标记
  const isCanvasFeature = ['ai-font-design', 'ai-refine-engine', 'ai-brand-ecommerce', 'ai-segment', 'ai-multi-angle', 'ai-3d-model'].includes(node.type);

  // P0: input-text 节点内嵌功能状态
  const llmEnabled = node.config?.llmEnabled as boolean ?? false;
  const llmModel = node.config?.llmModel as string ?? '';
  const llmInstruction = node.config?.llmInstruction as string ?? '';
  const llmSystemEnabled = node.config?.llmSystemEnabled as boolean ?? false;
  const llmSystemPrompt = node.config?.llmSystemPrompt as string ?? '';
  const textContent = node.config?.textContent as string ?? '';

  // P0: 解析文本中的 [img:id] 引用，渲染为缩略图
  const renderTextWithMentions = (text: string) => {
    if (!canvasImages?.length) return text;
    const parts = text.split(/(\[img:[^\]]+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/^\[img:(.+)\]$/);
      if (match) {
        const imgId = match[1];
        const img = canvasImages.find(ci => ci.id === imgId);
        if (img) {
          return <img key={i} src={img.url} alt={img.name || 'ref'} className="inline-block max-w-[20px] max-h-[20px] rounded mx-0.5 align-middle object-cover border border-border/50" title={img.name || imgId} />;
        }
      }
      return <span key={i}>{part}</span>;
    });
  };

  // P1: 提示词预设列表 (localStorage, 支持增删)
  const [presetList, setPresetList] = useState<{ id: string; name: string; text: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('wujie-node-presets') || '[]'); } catch { return []; }
  });
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetSaving, setPresetSaving] = useState(false);
  const [presetName, setPresetName] = useState('');

  const savePreset = (name: string, text: string) => {
    if (!name.trim() || !text.trim()) return;
    const newList = [...presetList, { id: `p-${Date.now()}`, name: name.trim(), text }];
    setPresetList(newList);
    localStorage.setItem('wujie-node-presets', JSON.stringify(newList));
    setPresetSaving(false);
    setPresetName('');
  };

  const deletePreset = (id: string) => {
    const newList = presetList.filter(p => p.id !== id);
    setPresetList(newList);
    localStorage.setItem('wujie-node-presets', JSON.stringify(newList));
  };

  // 拖拽上传处理 (input-image 节点)
  const handleDragOver = (e: React.DragEvent) => {
    if (!isInputImage) return;
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = async (e: React.DragEvent) => {
    if (!isInputImage) return;
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/save-image', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.url) {
        onNodeFieldChange?.(node.id, 'imageUrl', data.url);
        onNodeFieldChange?.(node.id, 'source', 'upload');
        onResizeNode?.(node.id, data.url);
      }
    } catch (err) { console.error('拖拽上传失败:', err); }
  };

  return (
    <g
      className="ne-node-enter"
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 高亮光晕 */}
      {isHighlighted && !isSelected && (
        <rect x={node.x - 4} y={node.y - 4} width={node.width + 8} height={node.height + 8} rx={isCondition ? 55 : 12}
          fill="none" stroke={color} strokeWidth={1} strokeOpacity={0.3}
        />
      )}

      {/* 选中光晕 (外发光效果) */}
      {isSelected && (
        <rect x={node.x - 6} y={node.y - 6} width={node.width + 12} height={node.height + 12} rx={isCondition ? 55 : 14}
          fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.25} style={{ filter: `blur(4px)` }} />
      )}
      {isSelected && (
        <rect x={node.x - 2} y={node.y - 2} width={node.width + 4} height={node.height + 4} rx={isCondition ? 55 : 10}
          fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.7} />
      )}

      {/* 节点主体 - 带阴影和渐变边框 */}
      <defs>
        <filter id={`node-shadow-${node.id}`} x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy={isSelected || isHovered ? 3 : 2} stdDeviation={isSelected ? 6 : isHovered ? 5 : 4} floodColor={T.cardBg.startsWith('#1') || T.cardBg.startsWith('#0') ? '#000' : color} floodOpacity={isSelected ? 0.3 : isHovered ? 0.2 : 0.12} />
        </filter>
      </defs>
      <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={isCondition ? 55 : 10}
        fill={isSelected ? T.nodeSelected : T.nodeBody}
        stroke={execResult ? statusColor : (isHovered && !isSelected) ? color : color}
        strokeWidth={execResult ? 2 : isSelected ? 2 : isHovered ? 1.5 : isHighlighted ? 1 : 0.5}
        strokeOpacity={execResult ? 1 : isSelected ? 0.9 : isHovered ? 0.6 : isHighlighted ? 0.5 : 0.2}
        filter={`url(#node-shadow-${node.id})`}
        onMouseDown={(e) => { e.stopPropagation(); onSelect(e); onDragStart(e as unknown as React.MouseEvent); }}
        className="cursor-move"
      />

      {/* 分类色条 - 顶部4px色条标识节点类型 */}
      <rect x={node.x + 1} y={node.y + 1} width={node.width - 2} height={4} rx={isCondition ? 55 : 10}
        fill={color} fillOpacity={0.7} className="pointer-events-none" />

      {/* 执行成功光圈 (渐现后消失, 不持续闪烁) */}
      {execResult?.status === 'success' && (
        <rect x={node.x - 3} y={node.y - 3} width={node.width + 6} height={node.height + 6} rx={isCondition ? 55 : 10}
          fill="none" stroke={T.statusSuccess} strokeWidth={1.5} strokeOpacity={0.5} style={{ animation: 'fadeOut 1.5s ease-out forwards' }} />
      )}

      {/* 画布模式专用标记 (右上角小徽章) */}
      {isCanvasFeature && !isCondition && (
        <g>
          <circle cx={node.x + node.width - 10} cy={node.y + 10} r={6} fill={color} fillOpacity={0.8} />
          <text x={node.x + node.width - 10} y={node.y + 13} textAnchor="middle" fill={T.badgeText} fontSize={7} fontWeight={700} className="pointer-events-none">
            {node.type === 'ai-font-design' ? '字' : node.type === 'ai-refine-engine' ? '精' : node.type === 'ai-brand-ecommerce' ? '品' : node.type === 'ai-segment' ? '层' : node.type === 'ai-multi-angle' ? '角' : '3D'}
          </text>
        </g>
      )}

      {/* 节点标题区 — 42px高度, 大写标签, 折叠开关, 状态徽章 (与原型对齐) */}
      {!isCondition && (
        <g>
          {/* 标题栏背景 */}
          <rect x={node.x} y={node.y + 4} width={node.width} height={38}
            fill={color} fillOpacity={0.06} className="pointer-events-none" />
          {/* 图标 - 小圆形背景 */}
          <foreignObject x={node.x + 8} y={node.y + 12} width={22} height={22}>
            <div className="flex items-center justify-center w-[22px] h-[22px] rounded-md" style={{ background: color + '20', color }}>
              {getNodeIcon(node.type, 12)}
            </div>
          </foreignObject>
          {/* 标题 - 大写字母, 11px, 800weight, 0.12em letter-spacing (与原型对齐) */}
          <clipPath id={`title-clip-${node.id}`}>
            <rect x={node.x + 34} y={node.y + 8} width={node.width - 72} height={20} />
          </clipPath>
          <text x={node.x + 34} y={node.y + 24} fill={T.nodeTitle} fontSize={11} fontWeight={800} letterSpacing="0.12em" className="pointer-events-none select-none" clipPath={`url(#title-clip-${node.id})`}>
            {node.label.toUpperCase()}
          </text>
          {/* 折叠开关 (ChevronDown) */}
          <foreignObject x={node.x + node.width - 50} y={node.y + 12} width={18} height={18}>
            <button
              className="flex items-center justify-center w-[18px] h-[18px] rounded hover:bg-white/10 transition-colors"
              onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(node.id); }}
              aria-label={collapsedNodes?.has(node.id) ? '展开节点' : '折叠节点'}
              tabIndex={0}
            >
              <ChevronDown size={12} style={{ color: T.textMuted, transition: 'transform 0.2s ease', transform: collapsedNodes?.has(node.id) ? 'rotate(0deg)' : 'rotate(180deg)' }} />
            </button>
          </foreignObject>
          {/* 状态徽章 (queued/running/done/failed) */}
          <foreignObject x={node.x + node.width - 28} y={node.y + 12} width={20} height={20}>
            <div className="flex items-center justify-center w-[20px] h-[20px]">
              {execResult?.status === 'running' && (
                <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: T.statusRunning }} title="运行中" />
              )}
              {execResult?.status === 'success' && (
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: T.statusSuccess }} title="已完成" />
              )}
              {execResult?.status === 'error' && (
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: T.statusError }} title="失败" />
              )}
              {!execResult && (
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: T.textMuted, opacity: 0.3 }} title="等待执行" />
              )}
            </div>
          </foreignObject>
          {/* ===== input-image 节点: 图片预览 + 拖拽上传区 ===== */}
          {isInputImage && (
            <foreignObject x={node.x + 6} y={node.y + 46} width={node.width - 12} height={node.height - 50}>
              <div className="w-full h-full flex flex-col gap-1" style={{ color: T.nodeTitle, fontSize: 10 }} onWheel={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                {hasImageOutput ? (
                  /* 有图片时显示缩略图 */
                  <div
                    className="flex-1 relative group cursor-pointer flex items-center justify-center rounded overflow-hidden"
                    style={{ background: T.nodeBg === '#1a1a1a' ? '#252525' : '#f0f0f0' }}
                    onClick={() => onPreviewImage(hasImageOutput)}
                  >
                    <img src={hasImageOutput} alt="" className="max-w-full max-h-full object-contain transition-opacity opacity-80 group-hover:opacity-100" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 text-white text-xs bg-black/50 px-2 py-0.5 rounded transition-opacity">预览</span>
                    </div>
                  </div>
                ) : (
                  /* 无图片时显示上传区 */
                  <div
                    className="flex-1 flex flex-col items-center justify-center gap-1 rounded border border-dashed cursor-pointer transition-colors"
                    style={{
                      borderColor: T.accent + '60',
                      background: T.nodeBg === '#1a1a1a' ? '#222222' : '#f5f5f5',
                      color: T.nodeBody === '#1a1a1a' ? '#888' : '#666'
                    }}
                    onClick={() => {
                      onTriggerImageUpload?.(node.id);
                    }}
                  >
                    <ImagePlus size={20} style={{ color: T.accent, opacity: 0.6 }} />
                    <span className="text-[10px]">点击上传图片</span>
                    <span className="text-[9px] opacity-60">或拖拽到节点</span>
                  </div>
                )}
                {/* URL 快捷输入 */}
                {!hasImageOutput && (
                  <input
                    type="text"
                    placeholder="粘贴图片 URL..."
                    className="w-full px-2 py-0.5 rounded text-[10px] border outline-none transition-colors"
                    style={{
                      background: T.nodeBg === '#1a1a1a' ? '#252525' : '#fff',
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
              </div>
            </foreignObject>
          )}

          {/* 图片缩略图 — 非input-image/output-image节点(如ai-generate)执行后显示结果 */}
          {!isInputImage && !isOutputImage && !isOutputImageGroup && hasImageOutput && (
            <foreignObject x={node.x + 8} y={node.y + 46} width={node.width - 16} height={node.height - 50}>
              <div className="w-full h-full relative group cursor-pointer flex items-center justify-center" onClick={() => onPreviewImage(hasImageOutput)} onWheel={(e) => e.stopPropagation()}>
                <img src={hasImageOutput} alt="" className="max-w-full max-h-full object-contain rounded opacity-70 group-hover:opacity-100 transition-opacity" />
              </div>
            </foreignObject>
          )}

          {/* ===== output-image 节点: 图片输出占位 / 预览 (多图自动分页) ===== */}
          {isOutputImage && (() => {
            const imageUrls = (execResult?.output?.imageUrls as string[]) || [];
            const singleUrl = hasImageOutput || '';
            const allUrls = imageUrls.length > 0 ? imageUrls : (singleUrl ? [singleUrl] : []);
            return (
              <foreignObject x={node.x + 6} y={node.y + 46} width={node.width - 12} height={node.height - 50}>
                {allUrls.length > 1 ? (
                  /* 多图: 分页浏览 */
                  <OutputImageGroupContent
                    imageUrls={allUrls}
                    theme={T}
                    onPreviewImage={onPreviewImage}
                  />
                ) : singleUrl ? (
                  /* 单图: 大图预览 */
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1" onWheel={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <div
                      className="flex-1 w-full relative group cursor-pointer flex items-center justify-center rounded overflow-hidden"
                      style={{ background: T.nodeBg === '#1a1a1a' ? '#252525' : '#f0f0f0' }}
                      onClick={() => onPreviewImage(singleUrl)}
                    >
                      <img src={singleUrl} alt="" className="max-w-full max-h-full object-contain transition-opacity opacity-90 group-hover:opacity-100" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <span className="opacity-0 group-hover:opacity-100 text-white text-xs bg-black/50 px-2 py-0.5 rounded transition-opacity">预览</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* 无图: 虚线占位框 */
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1" onWheel={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <div
                      className="flex-1 w-full flex flex-col items-center justify-center gap-1.5 rounded border-2 border-dashed transition-colors"
                      style={{
                        borderColor: T.accent + '40',
                        background: T.nodeBg === '#1a1a1a' ? '#1f1f1f' : '#fafafa',
                      }}
                    >
                      <ImagePlus size={22} style={{ color: T.accent, opacity: 0.35 }} />
                      <span className="text-[10px] font-medium" style={{ color: T.nodeBg === '#1a1a1a' ? '#555' : '#999' }}>等待图片</span>
                    </div>
                  </div>
                )}
              </foreignObject>
            );
          })()}

          {/* ===== output-image-group 节点: 多图输出 + 分页 ===== */}
          {isOutputImageGroup && (() => {
            const imageUrls = (execResult?.output?.imageUrls as string[]) || [];
            const singleUrl = (execResult?.output?.imageUrl as string) || '';
            const allUrls = imageUrls.length > 0 ? imageUrls : (singleUrl ? [singleUrl] : []);
            return (
              <foreignObject x={node.x + 6} y={node.y + 46} width={node.width - 12} height={node.height - 50}>
                <OutputImageGroupContent
                  imageUrls={allUrls}
                  theme={T}
                  onPreviewImage={onPreviewImage}
                />
              </foreignObject>
            );
          })()}

          {/* ===== P0: input-text 节点直接编辑 + LLM 优化 + 预设 ===== */}
          {isInputText && (
            <foreignObject x={node.x + 6} y={node.y + 46} width={node.width - 12} height={node.height - 50}>
              <div className="flex flex-col gap-1 h-full" style={{ color: T.nodeTitle, fontSize: 12 }} onWheel={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                {/* 可编辑文本区域 — 自适应内容 */}
                <div
                  contentEditable
                  suppressContentEditableWarning
                  className="w-full flex-1 min-h-[32px] overflow-y-auto rounded px-2 py-1.5 text-[12px] leading-snug outline-none focus:ring-1 focus:ring-[var(--ne-accent)]"
                  style={{ background: T.inputBg, color: T.text, borderColor: T.border, wordBreak: 'break-word' }}
                  onBlur={(e) => {
                    const text = e.currentTarget.innerText || '';
                    onNodeFieldChange?.(node.id, 'textContent', text);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  onWheel={(e) => e.stopPropagation()}
                >
                  {textContent || ''}
                </div>

                {/* @mention 缩略图预览行 */}
                {canvasImages?.length && textContent.includes('[img:') && (
                  <div className="flex gap-0.5 flex-wrap mt-0.5">
                    {textContent.split(/(\[img:[^\]]+\])/g).filter(p => p.match(/^\[img:/)).map((ref, i) => {
                      const id = ref.match(/^\[img:(.+)\]$/)?.[1];
                      const img = canvasImages.find(ci => ci.id === id);
                      return img ? (
                        <img key={i} src={img.url} alt="" className="w-5 h-5 rounded object-cover border border-border/50"
                          title={img.name || id} onClick={(e) => { e.stopPropagation(); onPreviewImage(img.url); }} />
                      ) : null;
                    })}
                  </div>
                )}

                {/* 工具栏: LLM + 预设 + 级联运行 */}
                <div className="flex items-center gap-1 mt-0.5">
                  {/* LLM 优化开关 */}
                  <button
                    className={`px-1.5 py-0.5 rounded text-[9px] font-medium cursor-pointer transition-colors flex items-center gap-0.5 ${llmEnabled ? 'bg-[var(--ne-accent)] text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                    onClick={(e) => { e.stopPropagation(); onNodeFieldChange?.(node.id, 'llmEnabled', !llmEnabled); }}
                    title="LLM 提示词优化"
                  >
                    <Sparkles size={9} /> LLM
                  </button>

                  {/* 预设按钮 */}
                  <div className="relative">
                    <button
                      className="px-1.5 py-0.5 rounded text-[9px] font-medium cursor-pointer transition-colors bg-muted text-muted-foreground hover:bg-muted/80 flex items-center gap-0.5"
                      onClick={(e) => { e.stopPropagation(); setPresetOpen(!presetOpen); }}
                      title="提示词预设"
                    >
                      <Bookmark size={9} /> 预设
                    </button>
                    {presetOpen && (
                      <div className="absolute left-0 top-full mt-0.5 z-50 bg-popover border border-border rounded shadow-lg min-w-[140px] max-h-[120px] overflow-y-auto"
                        onMouseDown={(e) => e.stopPropagation()}>
                        {/* 保存为预设 */}
                        {!presetSaving ? (
                          <button className="block w-full text-left px-2 py-1 text-[10px] hover:bg-muted text-[var(--ne-accent)] flex items-center gap-1"
                            onClick={(e) => { e.stopPropagation(); setPresetSaving(true); }}>
                            <BookmarkPlus size={9} /> 保存为预设
                          </button>
                        ) : (
                          <div className="flex items-center gap-1 px-2 py-1">
                            <input type="text" className="flex-1 text-[9px] rounded px-1 py-0.5 outline-none min-w-0"
                              style={{ background: T.nodeBody, color: T.text, border: `1px solid ${T.border}` }}
                              placeholder="预设名称" value={presetName}
                              onChange={(e) => setPresetName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') { savePreset(presetName, textContent); } if (e.key === 'Escape') { setPresetSaving(false); setPresetName(''); } }}
                              autoFocus />
                            <button className="text-[9px] text-[var(--ne-accent)] hover:opacity-80 shrink-0"
                              onClick={() => savePreset(presetName, textContent)}>✓</button>
                          </div>
                        )}
                        {presetList.length > 0 && <div className="border-t border-border" />}
                        {presetList.map(p => (
                          <div key={p.id} className="flex items-center gap-0.5 px-1 py-0.5 hover:bg-muted group">
                            <button className="flex-1 text-left text-[10px] truncate cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); onNodeFieldChange?.(node.id, 'textContent', p.text); setPresetOpen(false); }}>
                              {p.name}
                            </button>
                            <button className="text-[8px] text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 shrink-0 cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); deletePreset(p.id); }}
                              title="删除预设">×</button>
                          </div>
                        ))}
                        {presetList.length === 0 && !presetSaving && (
                          <div className="px-2 py-1 text-[9px] text-muted-foreground">暂无预设</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 级联运行按钮 */}
                  <button
                    className="px-1.5 py-0.5 rounded text-[9px] font-medium cursor-pointer transition-colors bg-muted text-muted-foreground hover:bg-muted/80 flex items-center gap-0.5"
                    onClick={(e) => { e.stopPropagation(); onCascadeRun?.(node.id); }}
                    title="运行此链"
                  >
                    <Play size={9} /> 运行链
                  </button>
                </div>

                {/* LLM 展开区域 */}
                {llmEnabled && (
                  <div className="mt-1 flex flex-col gap-1 p-1.5 rounded" style={{ background: T.inputBg, border: `1px solid ${T.border}` }}>
                    {/* LLM 模型选择 */}
                    <select
                      className="w-full text-[9px] rounded px-1 py-0.5 outline-none"
                      style={{ background: T.nodeBody, color: T.text, border: `1px solid ${T.border}` }}
                      value={llmModel}
                      onChange={(e) => { e.stopPropagation(); onNodeFieldChange?.(node.id, 'llmModel', e.target.value); }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <option value="">选择模型</option>
                      {(llmModels ?? []).map(m => <option key={m.id} value={m.id} style={{ background: T.optionBg, color: T.optionText }}>{m.apiDisplayName || m.name || getModelDisplayName(m.id)}{m.provider ? ` (${m.provider})` : ''}</option>)}
                    </select>
                    {/* LLM 指令 */}
                    <input
                      type="text"
                      className="w-full text-[9px] rounded px-1 py-0.5 outline-none"
                      style={{ background: T.nodeBody, color: T.text, border: `1px solid ${T.border}` }}
                      placeholder="优化指令 (如: 优化为英文)"
                      value={llmInstruction}
                      onChange={(e) => { e.stopPropagation(); onNodeFieldChange?.(node.id, 'llmInstruction', e.target.value); }}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                    {/* 系统提示词开关 */}
                    <div className="flex items-center gap-1">
                      <button
                        className={`text-[8px] cursor-pointer ${llmSystemEnabled ? 'text-[var(--ne-accent)]' : 'text-muted-foreground'}`}
                        onClick={(e) => { e.stopPropagation(); onNodeFieldChange?.(node.id, 'llmSystemEnabled', !llmSystemEnabled); }}
                      >
                        {llmSystemEnabled ? '●' : '○'} 系统提示
                      </button>
                      <button
                        className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-medium cursor-pointer bg-[var(--ne-accent)] text-white hover:opacity-80 flex items-center gap-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={(e) => { e.stopPropagation(); onLlmOptimize?.(node.id, String(node.config?.textContent || ''), String(node.config?.llmModel || ''), String(node.config?.llmSystemPrompt || ''), String(node.config?.llmInstruction || '')); }}
                        disabled={isRunning || !!node.config?.llmOptimizing}
                        title="运行 LLM 优化"
                      >
                        {node.config?.llmOptimizing ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />} {node.config?.llmOptimizing ? '优化中...' : '优化'}
                      </button>
                    </div>
                    {/* 系统提示词输入 */}
                    {llmSystemEnabled && (
                      <input
                        type="text"
                        className="w-full text-[9px] rounded px-1 py-0.5 outline-none"
                        style={{ background: T.nodeBody, color: T.text, border: `1px solid ${T.border}` }}
                        placeholder="系统提示词"
                        value={llmSystemPrompt}
                        onChange={(e) => { e.stopPropagation(); onNodeFieldChange?.(node.id, 'llmSystemPrompt', e.target.value); }}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                    )}
                  </div>
                )}
              </div>
            </foreignObject>
          )}

          {/* ===== P2: input-image 节点操作按钮 ===== */}
          {isInputImage && hasImageOutput && (
            <foreignObject x={node.x + 6} y={node.y + node.height - 24} width={node.width - 12} height={18}>
              <div className="flex gap-0.5 items-center" onWheel={(e) => e.stopPropagation()}>
                <button
                  className="px-1 py-0 rounded text-[8px] font-medium cursor-pointer bg-muted/60 text-muted-foreground hover:bg-muted flex items-center gap-0.5"
                  onClick={(e) => { e.stopPropagation(); onExtractToSource?.(node.id); }}
                  title="抽取为源节点"
                >
                  <ArrowLeftFromLine size={8} /> 抽取
                </button>
                <button
                  className="px-1 py-0 rounded text-[8px] font-medium cursor-pointer bg-muted/60 text-muted-foreground hover:bg-muted flex items-center gap-0.5"
                  onClick={(e) => { e.stopPropagation(); onGridSplit?.(node.id, Number(node.config?.gridCols || 2), Number(node.config?.gridRows || 2)); }}
                  title="宫格切分"
                >
                  <Grid3X3 size={8} /> 切分
                </button>
                {/* P2: 对比滑块 */}
                {upstreamImageUrl && (
                  <button
                    className="px-1 py-0 rounded text-[8px] font-medium cursor-pointer bg-muted/60 text-muted-foreground hover:bg-muted flex items-center gap-0.5"
                    onClick={(e) => { e.stopPropagation(); onCompare?.(node.id); }}
                    title="对比原图"
                  >
                    <GitCompare size={8} /> 对比
                  </button>
                )}
                {/* P0: 级联运行 */}
                <button
                  className="px-1 py-0 rounded text-[8px] font-medium cursor-pointer bg-muted/60 text-muted-foreground hover:bg-muted flex items-center gap-0.5 ml-auto"
                  onClick={(e) => { e.stopPropagation(); onCascadeRun?.(node.id); }}
                  title="运行此链"
                >
                  <Play size={8} /> 运行链
                </button>
              </div>
            </foreignObject>
          )}

          {/* ===== P0: 非AI/非图片节点显示级联运行 ===== */}
          {!isInputText && !isInputImage && !hasImageOutput && !isCondition && !(node.type.startsWith('ai-') || node.type === 'output-image') && (
            <foreignObject x={node.x + 6} y={node.y + node.height - 18} width={node.width - 12} height={14}>
              <div className="flex justify-end" onWheel={(e) => e.stopPropagation()}>
                <button
                  className="px-1 py-0 rounded text-[8px] font-medium cursor-pointer bg-muted/60 text-muted-foreground hover:bg-muted flex items-center gap-0.5"
                  onClick={(e) => { e.stopPropagation(); onCascadeRun?.(node.id); }}
                  title="运行此链"
                >
                  <Play size={8} /> 运行链
                </button>
              </div>
            </foreignObject>
          )}
        </g>
      )}

      {/* 全宽 RUN 按钮 — AI生成类节点 (与原型对齐) */}
      {!isCondition && !isInputText && !isInputImage && (node.type.startsWith('ai-') || node.type === 'output-image') && (
        <foreignObject x={node.x + 8} y={node.y + node.height - 24} width={node.width - 16} height={18}>
          <button
            className="w-full h-full rounded text-[9px] font-bold tracking-wider cursor-pointer flex items-center justify-center gap-1 transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
            style={{
              background: `linear-gradient(135deg, ${color}22, ${color}44)`,
              color: color,
              border: `1px solid ${color}55`,
            }}
            onClick={(e) => { e.stopPropagation(); onCascadeRun?.(node.id); }}
            title="运行此节点"
          >
            <Play size={9} /> RUN
          </button>
        </foreignObject>
      )}

      {/* 条件节点: 菱形内文字 */}
      {isCondition && (
        <g>
          <clipPath id={`cond-clip-${node.id}`}>
            <rect x={node.x + 10} y={node.y + node.height / 2 - 10} width={node.width - 20} height={20} />
          </clipPath>
          <text x={node.x + node.width / 2} y={node.y + node.height / 2 + 4} textAnchor="middle" fill={T.nodeTitle} fontSize={12} fontWeight={500} clipPath={`url(#cond-clip-${node.id})`}>
            {node.label}
          </text>
        </g>
      )}

      {/* 输入端口 (颜色按类型区分) */}
      {inputPorts.map((port, i) => {
        const py = node.y + (i + 1) * (node.height / (inputPorts.length + 1));
        const portColor = PORT_COLORS[port.type] || T.connColor;
        return (
          <g key={port.id} onMouseUp={() => onPortMouseUp(node.id, port)} className="group/port">
            {/* 端口发光背景 */}
            <circle cx={node.x} cy={py} r={10} fill={portColor} opacity={0.12} className="group-hover/port:opacity-30 transition-opacity" />
            {/* 端口外圈 */}
            <circle cx={node.x} cy={py} r={5.5} fill={T.portFill} stroke={portColor} strokeWidth={1.5} className="cursor-pointer" />
            {/* 端口内点 */}
            <circle cx={node.x} cy={py} r={2} fill={portColor} opacity={0.6} className="pointer-events-none" />
            {/* 端口标签 */}
            <text x={node.x + 12} y={py + 3.5} fill={T.portLabel} fontSize={9} className="pointer-events-none select-none" style={{ fontWeight: 500 }}>{port.label}</text>
          </g>
        );
      })}

      {/* 输出端口 (颜色按类型区分, 实心+发光) */}
      {outputPorts.map((port, i) => {
        const py = node.y + (i + 1) * (node.height / (outputPorts.length + 1));
        const portColor = PORT_COLORS[port.type] || T.connColor;
        return (
          <g key={port.id} onMouseDown={(e) => onPortMouseDown(e as unknown as React.MouseEvent, node.id, port)} className="group/port">
            {/* 端口发光背景 */}
            <circle cx={node.x + node.width} cy={py} r={10} fill={portColor} opacity={0.15} className="group-hover/port:opacity-35 transition-opacity" />
            {/* 端口外圈 */}
            <circle cx={node.x + node.width} cy={py} r={5.5} fill={portColor} opacity={0.9} className="cursor-pointer" />
            {/* 端口内点(白色) */}
            <circle cx={node.x + node.width} cy={py} r={2} fill="white" opacity={0.7} className="pointer-events-none" />
            {/* 端口标签 */}
            <text x={node.x + node.width - 12} y={py + 3.5} fill={T.portLabel} fontSize={9} textAnchor="end" className="pointer-events-none select-none" style={{ fontWeight: 500 }}>{port.label}</text>
          </g>
        );
      })}

      {/* 断点标记 */}
      {node.breakpoint && (
        <circle cx={node.x + node.width - 8} cy={node.y + (isCanvasFeature ? 20 : 8)} r={4} fill={T.statusError} />
      )}

      {/* 关闭编辑按钮 (选中时显示) */}
      {isSelected && (
        <foreignObject x={node.x + node.width + 2} y={node.y - 14} width={22} height={22}>
          <button
            title="关闭编辑"
            onClick={(e) => { e.stopPropagation(); onDeselect(); }}
            className="w-full h-full rounded-full bg-[var(--ne-input-bg)] border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/30 cursor-pointer transition-colors"
            style={{ fontSize: 0, lineHeight: 0 }}
          >
            <X size={12} />
          </button>
        </foreignObject>
      )}

      {/* 执行错误提示 */}
      {execResult?.error && (
        <foreignObject x={node.x} y={node.y + node.height + 2} width={node.width} height={20}>
          <div className="text-[10px] text-red-400 truncate px-1">{execResult.error}</div>
        </foreignObject>
      )}
    </g>
  );
}

// ==================== 属性面板 ====================

interface PropertyPanelProps {
  node: WorkflowNode | null;
  models: { id: string; name: string; type: string; provider: string; apiDisplayName?: string }[];
  modelsLoading: boolean;
  onUpdate: (nodeId: string, updates: Partial<WorkflowNode>) => void;
  onDelete: (nodeId: string) => void;
  onImageUpload: (nodeId: string, file: File) => void;
  /** P0: 画布图片列表，用于@图片引用 */
  canvasImages?: CanvasImageRef[];
}

function PropertyPanel({ node, models, modelsLoading, onUpdate, onDelete, onImageUpload, canvasImages }: PropertyPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ basic: true, advanced: true, canvas: true });
  // 文本输入本地缓存：避免每次按键触发 onUpdate → setWf → 重渲染 → 闪烁
  const [localTextValues, setLocalTextValues] = useState<Record<string, string>>({});
  const [focusedField, setFocusedField] = useState<string | null>(null);
  // P0: @图片引用弹窗状态 (移到PropertyPanel内部管理)
  const [mentionPopup, setMentionPopup] = useState<MentionPopup>({ visible: false, nodeId: '', fieldKey: '', filter: '', position: { top: 0, left: 0 } });

  if (!node) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <Settings size={24} className="mx-auto mb-2 opacity-30" />
          <p>选择节点查看属性</p>
        </div>
      </div>
    );
  }

  const cat = getNodeCategory(node.type);
  const color = NODE_TYPE_COLORS[cat];
  const fields = getNodePropertyFields(node.type);
  const isCanvasFeature = ['ai-font-design', 'ai-refine-engine', 'ai-brand-ecommerce', 'ai-segment', 'ai-multi-angle', 'ai-3d-model'].includes(node.type);

  // 分组: basic(前3个) + canvas(画布模式专用字段) + advanced(其余)
  const basicFields = fields.slice(0, 3);
  const restFields = fields.slice(3);

  // 画布模式专用字段
  const canvasFeatureKeys: Record<string, string[]> = {
    'ai-font-design': ['textContent', 'styleCategory', 'scene', 'mode'],
    'ai-refine-engine': ['mode', 'category', 'lighting', 'viewAngle', 'background'],
    'ai-brand-ecommerce': ['templateType', 'brandName', 'brandStyle', 'productCategory'],
    'ai-segment': ['model', 'exportFormat'],
    'ai-multi-angle': ['angles', 'characterRef'],
    'ai-3d-model': ['model', 'quality'],
  };
  const canvasKeys = canvasFeatureKeys[node.type] || [];
  const canvasFields = isCanvasFeature ? restFields.filter(f => canvasKeys.includes(f.key)) : [];
  const advancedFields = isCanvasFeature ? restFields.filter(f => !canvasKeys.includes(f.key)) : restFields;

  const toggleSection = (key: string) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

  const renderField = (field: PropertyField) => {
    const externalValue = node.config?.[field.key] ?? (node as unknown as Record<string, unknown>)[field.key] ?? field.defaultValue ?? '';
    // 聚焦时使用本地缓存值，避免每次按键触发 onUpdate → 重渲染 → 闪烁
    const isFocused = focusedField === `${node.id}:${field.key}`;
    const displayValue = isFocused ? (localTextValues[field.key] ?? String(externalValue)) : String(externalValue);

    const onChangeText = (val: string) => {
      // 更新本地缓存
      setLocalTextValues(prev => ({ ...prev, [field.key]: val }));
    };

    const onFocusField = () => {
      setFocusedField(`${node.id}:${field.key}`);
      setLocalTextValues(prev => ({ ...prev, [field.key]: String(externalValue) }));
    };

    const onBlurField = () => {
      setFocusedField(null);
      // 失焦时同步到父组件
      const localVal = localTextValues[field.key];
      if (localVal !== undefined && localVal !== String(externalValue)) {
        onUpdate(node.id, { config: { [field.key]: localVal } });
      }
      setLocalTextValues(prev => {
        const next = { ...prev };
        delete next[field.key];
        return next;
      });
    };

    switch (field.type) {
      case 'text':
        return (
          <input
            type="text"
            value={displayValue}
            onChange={e => onChangeText(e.target.value)}
            onFocus={onFocusField}
            onBlur={onBlurField}
            placeholder={field.placeholder}
            className="w-full bg-[var(--ne-input-bg)] border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[var(--ne-accent)]/50"
          />
        );

      case 'textarea': {
        // P0: 提示词字段支持@图片引用
        const isPromptField = field.key === 'prompt' || field.key === 'text' || field.key === 'stylePrompt' || field.key === 'negativePrompt';
        return (
          <div className="relative">
            <textarea
              value={displayValue}
              onChange={e => {
                onChangeText(e.target.value);
                // P0: 检测@符号触发图片引用弹窗
                if (isPromptField && canvasImages && canvasImages.length > 0) {
                  const text = e.target.value;
                  const cursorPos = e.target.selectionStart || text.length;
                  const textBeforeCursor = text.slice(0, cursorPos);
                  const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);
                  if (atMatch) {
                    const textarea = e.target;
                    const rect = textarea.getBoundingClientRect();
                    setMentionPopup({
                      visible: true,
                      nodeId: node.id,
                      fieldKey: field.key,
                      filter: atMatch[1].toLowerCase(),
                      position: { top: rect.bottom - rect.top + 4, left: 16 },
                    });
                  } else {
                    if (mentionPopup.visible) setMentionPopup(prev => ({ ...prev, visible: false }));
                  }
                }
              }}
              onFocus={onFocusField}
              onBlur={onBlurField}
              placeholder={isPromptField && canvasImages && canvasImages.length > 0 ? `${field.placeholder} (输入@引用画布图片)` : field.placeholder}
              rows={3}
              className="w-full bg-[var(--ne-input-bg)] border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[var(--ne-accent)]/50 resize-y"
            />
            {/* P0: @图片引用弹窗 */}
            {isPromptField && mentionPopup.visible && mentionPopup.nodeId === node.id && mentionPopup.fieldKey === field.key && (
              <div
                className="absolute z-50 bg-[var(--ne-card-bg)] border border-[var(--ne-accent)]/30 rounded shadow-lg max-h-40 overflow-y-auto"
                style={{ top: mentionPopup.position.top, left: mentionPopup.position.left, minWidth: 180 }}
              >
                {canvasImages
                  ?.filter(img => {
                    const desc = img.description || img.url;
                    return !mentionPopup.filter || desc.toLowerCase().includes(mentionPopup.filter);
                  })
                  .slice(0, 6)
                  .map(img => (
                    <button
                      key={img.id}
                      className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-[var(--ne-accent)]/10 hover:text-[var(--ne-accent)] flex items-center gap-2 cursor-pointer"
                      onMouseDown={e => {
                        // 用 onMouseDown 替代 onClick，在 blur 之前触发
                        e.preventDefault();
                        // 在@位置插入图片引用
                        const currentValue = displayValue;
                        const cursorPos = currentValue.length;
                        const beforeAt = currentValue.slice(0, cursorPos).replace(/@[^\s@]*$/, '');
                        const afterCursor = currentValue.slice(cursorPos);
                        const ref = `[img:${img.id}]`;
                        const newValue = beforeAt + ref + afterCursor;
                        onChangeText(newValue);
                        // 立即同步到父组件
                        onUpdate(node.id, { config: { [field.key]: newValue } });
                        setMentionPopup(prev => ({ ...prev, visible: false }));
                      }}
                    >
                      <span className="w-6 h-6 rounded bg-[var(--ne-card-bg)] flex-shrink-0 overflow-hidden">
                        {img.url && <img src={img.url} alt="" className="w-full h-full object-cover" />}
                      </span>
                      <span className="truncate">{img.description || img.url.slice(-20)}</span>
                    </button>
                  ))
                }
                {(!canvasImages || canvasImages.filter(img => {
                  const desc = img.description || img.url;
                  return !mentionPopup.filter || desc.toLowerCase().includes(mentionPopup.filter);
                }).length === 0) && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">无匹配图片</div>
                )}
              </div>
            )}
          </div>
        );
      }

      case 'number':
        return (
          <input
            type="number"
            value={externalValue !== undefined && externalValue !== '' ? Number(externalValue) : (field.defaultValue != null ? Number(field.defaultValue) : '')}
            onChange={e => onUpdate(node.id, { config: { [field.key]: e.target.value === '' ? '' : Number(e.target.value) } })}
            min={field.min}
            max={field.max}
            step={field.step || 1}
            placeholder={field.placeholder}
            className="w-full bg-[var(--ne-input-bg)] border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[var(--ne-accent)]/50"
          />
        );

      case 'select': {
        // 动态解析 quality 和 aspectRatio 选项
        let dynamicOptions = field.options;
        if (field.key === 'quality' && node.config?.model) {
          const modelId = String(node.config.model);
          const modelKey = Object.keys(MODEL_QUALITIES).find(k => modelId.includes(k));
          const qualities = modelKey ? MODEL_QUALITIES[modelKey as keyof typeof MODEL_QUALITIES] : [];
          if (qualities.length > 0) {
            dynamicOptions = qualities.map(q => ({ value: q, label: q }));
          }
        }
        if (field.key === 'aspectRatio' && node.config?.model) {
          const modelId = String(node.config.model);
          const modelKey = Object.keys(MODEL_ASPECT_RATIOS).find(k => modelId.includes(k));
          const ratios = modelKey ? MODEL_ASPECT_RATIOS[modelKey as keyof typeof MODEL_ASPECT_RATIOS] : [];
          if (ratios.length > 0) {
            dynamicOptions = ratios.map(r => ({ value: r, label: r }));
          }
        }
        return (
          <select
            value={String(externalValue)}
            onChange={e => onUpdate(node.id, { config: { [field.key]: e.target.value } })}
            className="w-full bg-[var(--ne-input-bg)] border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[var(--ne-accent)]/50"
          >
            {dynamicOptions?.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        );
      }

      case 'slider': {
        const numVal = Number(externalValue) || Number(field.defaultValue) || 0;
        return (
          <div className="flex items-center gap-2">
            <input
              type="range"
              value={numVal}
              onChange={e => onUpdate(node.id, { config: { [field.key]: Number(e.target.value) } })}
              min={field.min || 0}
              max={field.max || 100}
              step={field.step || 1}
              className="flex-1 h-1 accent-[var(--ne-accent)]"
            />
            <span className="text-xs text-muted-foreground w-8 text-right">{numVal}</span>
          </div>
        );
      }

      case 'toggle': {
        const boolVal = Boolean(externalValue) || externalValue === 'true';
        return (
          <button
            onClick={() => onUpdate(node.id, { config: { [field.key]: !boolVal } })}
            className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${boolVal ? 'bg-[var(--ne-accent)]' : 'bg-muted'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${boolVal ? 'translate-x-4' : ''}`} />
          </button>
        );
      }

      case 'model-select': {
        const modelFilterType = field.modelFilter || 'image'; // 默认只显示图像模型
        return (
          <select
            value={String(externalValue || '')}
            onChange={e => {
              const newModelId = e.target.value;
              const configUpdate: Record<string, string> = { [field.key]: newModelId };
              // 模型变更时，动态更新 quality 和 aspectRatio 为新模型的默认值
              if (newModelId) {
                const supportedQualities = MODEL_QUALITIES[newModelId as keyof typeof MODEL_QUALITIES] || [];
                // 尝试找到匹配的模型配置
                const modelKey = Object.keys(MODEL_QUALITIES).find(k => newModelId.includes(k));
                const qualities = modelKey ? MODEL_QUALITIES[modelKey as keyof typeof MODEL_QUALITIES] : supportedQualities;
                if (qualities.length > 0) {
                  configUpdate.quality = qualities[0];
                }
                const supportedRatios = MODEL_ASPECT_RATIOS[newModelId as keyof typeof MODEL_ASPECT_RATIOS] || [];
                const ratioKey = Object.keys(MODEL_ASPECT_RATIOS).find(k => newModelId.includes(k));
                const ratios = ratioKey ? MODEL_ASPECT_RATIOS[ratioKey as keyof typeof MODEL_ASPECT_RATIOS] : supportedRatios;
                if (ratios.length > 0) {
                  configUpdate.aspectRatio = ratios[0];
                }
              }
              onUpdate(node.id, { config: configUpdate });
            }}
            disabled={modelsLoading}
            className="w-full bg-[var(--ne-input-bg)] border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[var(--ne-accent)]/50 disabled:opacity-50"
          >
            <option value="">{modelsLoading ? '加载中...' : '选择模型'}</option>
            {models.filter(m => m.type === modelFilterType).map(m => (
              <option key={`${m.id}-${m.provider}`} value={m.id}>{m.apiDisplayName || m.name || getModelDisplayName(m.id)} ({m.provider})</option>
            ))}
          </select>
        );
      }

      case 'image-upload':
        return (
          <div className="space-y-2">
            {node.config?.imageUrl ? (
              <div className="relative group">
                <img src={String(node.config.imageUrl)} alt="预览" className="w-full h-24 object-cover rounded border border-border" />
                <button onClick={() => onUpdate(node.id, { config: { [field.key]: '' } })} className="absolute top-1 right-1 p-0.5 bg-black/70 rounded text-muted-foreground hover:text-red-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                  <X size={10} />
                </button>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 h-16 border-2 border-dashed border-border rounded flex flex-col items-center justify-center cursor-pointer hover:border-[var(--ne-accent)]/50 transition-colors text-muted-foreground hover:text-muted-foreground"
                >
                  <Upload size={14} />
                  <span className="text-[10px] mt-0.5">上传</span>
                </div>
                {canvasImages && canvasImages.length > 0 && (
                  <div className="relative group/canvas">
                    <div
                      className="flex-1 h-16 border-2 border-dashed border-border rounded flex flex-col items-center justify-center cursor-pointer hover:border-[var(--ne-accent)]/50 transition-colors text-muted-foreground hover:text-muted-foreground"
                      onClick={(e) => {
                        const dropdown = (e.currentTarget.nextElementSibling as HTMLElement);
                        if (dropdown) dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
                      }}
                    >
                      <ImageIcon size={14} />
                      <span className="text-[10px] mt-0.5">画布</span>
                    </div>
                    <div style={{ display: 'none' }} className="absolute left-0 top-full mt-1 w-full max-h-40 overflow-y-auto bg-[var(--ne-input-bg)] border border-border rounded shadow-lg z-50">
                      {canvasImages.map((img, idx) => (
                        <button
                          key={img.id}
                          className="w-full px-3 py-2 text-left text-xs text-foreground hover:bg-[var(--ne-accent)]/10 hover:text-[var(--ne-accent)] cursor-pointer truncate transition-colors"
                          onClick={() => {
                            onUpdate(node.id, { config: { [field.key]: img.url, source: 'canvas' } });
                            const dropdown = document.querySelector('.group\\/canvas > div:last-child') as HTMLElement;
                            if (dropdown) dropdown.style.display = 'none';
                          }}
                          title={img.description}
                        >
                          {idx + 1}. {img.description?.slice(0, 25) || '图片 ' + (idx + 1)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => {
              const file = e.target.files?.[0];
              if (file) onImageUpload(node.id, file);
            }} />
            <input
              type="text"
              value={String(externalValue || '')}
              onChange={e => onUpdate(node.id, { config: { [field.key]: e.target.value } })}
              placeholder="或输入图片URL"
              className="w-full bg-[var(--ne-input-bg)] border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[var(--ne-accent)]/50"
            />
          </div>
        );

      default:
        return (
          <input
            type="text"
            value={String(externalValue)}
            onChange={e => onUpdate(node.id, { config: { [field.key]: e.target.value } })}
            placeholder={field.placeholder}
            className="w-full bg-[var(--ne-input-bg)] border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[var(--ne-accent)]/50"
          />
        );
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* 节点标题 */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-6 h-6 rounded flex items-center justify-center" style={{ backgroundColor: color + '20', color }}>
            {getNodeIcon(node.type, 14)}
          </span>
          <div>
            <div className="text-sm font-medium text-foreground">{NODE_TYPE_LABELS[node.type]}</div>
            <div className="text-xs text-muted-foreground">{NODE_CATEGORY_LABELS[cat]}</div>
          </div>
          {isCanvasFeature && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--ne-accent)]/10 text-[var(--ne-accent)] font-medium ml-auto">画布专用</span>
          )}
        </div>
      </div>

      {/* 基础属性 */}
      <div className="border-b border-border">
        <button onClick={() => toggleSection('basic')} className="w-full flex items-center gap-1 px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold hover:text-foreground cursor-pointer">
          {expandedSections.basic ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          基础属性
        </button>
        {expandedSections.basic && (
          <div className="px-3 pb-3 space-y-2">
            {basicFields.map(field => (
              <div key={field.key}>
                <label className="block text-xs text-muted-foreground mb-1">{field.label}</label>
                {renderField(field)}
              </div>
            ))}
            {/* 断点开关 */}
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">断点</label>
              <button
                onClick={() => onUpdate(node.id, { breakpoint: !node.breakpoint })}
                className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${node.breakpoint ? 'bg-red-500' : 'bg-muted'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${node.breakpoint ? 'translate-x-4' : ''}`} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 画布模式专用属性 */}
      {canvasFields.length > 0 && (
        <div className="border-b border-border">
          <button onClick={() => toggleSection('canvas')} className="w-full flex items-center gap-1 px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--ne-accent)] font-semibold hover:text-[var(--ne-accent)]/80 cursor-pointer">
            {expandedSections.canvas ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            {node.type === 'ai-font-design' ? '字境大师' : node.type === 'ai-refine-engine' ? '精修引擎' : node.type === 'ai-brand-ecommerce' ? '品牌电商' : node.type === 'ai-segment' ? '元素分层' : node.type === 'ai-multi-angle' ? '多角度' : '3D模型'}
          </button>
          {expandedSections.canvas && (
            <div className="px-3 pb-3 space-y-2">
              {canvasFields.map(field => (
                <div key={field.key}>
                  <label className="block text-xs text-muted-foreground mb-1">{field.label}</label>
                  {renderField(field)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 高级属性 */}
      {advancedFields.length > 0 && (
        <div className="border-b border-border">
          <button onClick={() => toggleSection('advanced')} className="w-full flex items-center gap-1 px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold hover:text-foreground cursor-pointer">
            {expandedSections.advanced ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            高级属性
          </button>
          {expandedSections.advanced && (
            <div className="px-3 pb-3 space-y-2">
              {advancedFields.map(field => (
                <div key={field.key}>
                  <label className="block text-xs text-muted-foreground mb-1">{field.label}</label>
                  {renderField(field)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 端口信息 */}
      <div className="px-3 py-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">端口</div>
        <div className="space-y-1">
          {node.ports.filter(p => p.direction === 'in').map(p => (
            <div key={p.id} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PORT_COLORS[p.type] }} />
              <span className="text-muted-foreground">→</span>
              <span className="text-muted-foreground">{p.label}</span>
              <span className="text-muted-foreground ml-auto">{p.type}</span>
            </div>
          ))}
          {node.ports.filter(p => p.direction === 'out').map(p => (
            <div key={p.id} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PORT_COLORS[p.type] }} />
              <span className="text-muted-foreground">{p.label}</span>
              <span className="text-muted-foreground ml-auto">{p.type} →</span>
            </div>
          ))}
        </div>
      </div>

      {/* 删除按钮 */}
      <div className="p-3 border-t border-border">
        <button
          onClick={() => onDelete(node.id)}
          className="w-full py-2 rounded text-sm text-red-400 hover:bg-red-900/20 transition-colors cursor-pointer flex items-center justify-center gap-1"
        >
          <Trash2 size={12} /> 删除节点
        </button>
      </div>
    </div>
  );
}
