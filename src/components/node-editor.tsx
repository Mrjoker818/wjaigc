'use client';

import NextImage from 'next/image';
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  WorkflowNode, WorkflowConnection, Workflow as WorkflowData, NodeType, NodeCategory,
  NODE_TYPE_COLORS, NODE_TYPE_LABELS, NODE_TYPE_ICONS, NODE_CATEGORY_LABELS,
  PORT_COLORS, NodePort, PortType, PropertyField,
  createWorkflowNode, createConnection, createEmptyWorkflow,
  getNodePropertyFields, getNodeCategory, NODE_TEMPLATES,
  canConnectPorts, autoLayoutWorkflow, parseComfyUIWorkflow, isImageGeneratingNode, getOutputNodeSize,
} from '@/lib/workflow-engine';
import { getModelDisplayName } from '@/lib/model-name-map';
import { computePortPosition } from '@/lib/node-port-position';
import { MODEL_QUALITIES, MODEL_ASPECT_RATIOS } from '@/lib/canvas-generation-group';
import { getPromptTemplates, searchTemplates, addPromptTemplate } from '@/lib/prompt-templates';
import {
  Image as ImageIcon, Type, SlidersHorizontal, Wand2, Pencil, Maximize, Scissors,
  PenTool, Palette, Sun, GitBranch, GitMerge, Repeat, RefreshCw, Layers,
  Bot, MessageSquare, ImageDown, Save, Download, Play, Square,
  FileInput,
  ChevronRight, ChevronDown, ChevronLeft, Plus, Trash2, ZoomIn, ZoomOut, RotateCcw,
  Settings, Upload, X, Check, AlertCircle, Loader2, BoxSelect, Group,
  Search, ScanSearch,
  ArrowLeft, LayoutGrid, Sparkles, Rotate3d, Box, ShoppingBag,
  Copy, Clipboard, Film, Bookmark, BookmarkPlus, GitCompare, Grid3X3, ArrowLeftFromLine, ImagePlus, BookOpen, Blocks, FolderOpen, ScrollText, MousePointer2, Maximize2,
  CopyPlus, Unlink, Shuffle, Paintbrush, Video, FileVideo, FileText,
  Mic, Volume2, Music, Camera, Clapperboard, Scissors as CutIcon, Globe, AudioLines, Brain,
} from 'lucide-react';

// ==================== 图标映射 ====================

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Image: ImageIcon, Type, SlidersHorizontal, Wand2, Pencil, Maximize, Scissors,
  PenTool, Palette, Sun, GitBranch, GitMerge, Repeat, RefreshCw, Layers,
  Bot, MessageSquare, ImageDown, Save, Download, BoxSelect, Group,
  ScanSearch, Sparkles, Rotate3d, Box, ShoppingBag, Film, Video, FileVideo,
  Mic, Volume2, Music, Camera, Clapperboard, CutIcon, Globe, AudioLines, Brain,
};

function getNodeIcon(type: NodeType, size = 14, className = '') {
  const iconName = NODE_TYPE_ICONS[type];
  const IconComp = ICON_MAP[iconName] || Settings;
  return <IconComp size={size} className={className} />;
}

// ==================== 模型列表 Hook ====================

interface ModelOption { id: string; name: string; type: string; provider: string; providerId?: string; apiDisplayName?: string; }


function useModelList() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workflow/models?type=all');
      if (res.ok) {
        const data = await res.json();
        setModels((data.models || []) as ModelOption[]);
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
  // ─── P1-1 新增模板 ───
  {
    id: 'ecom-product-grid',
    name: '电商主图6宫格',
    description: '产品参考图 + LLM策划 → 6张不同场景电商主图',
    icon: 'LayoutGrid',
    tags: ['电商', '批量'],
    nodes: [
      { type: 'input-image', label: '产品图' },
      { type: 'ai-llm', label: '文案策划', config: { systemPrompt: '你是电商视觉策划专家，为产品生成6个不同卖点场景的图片描述', temperature: 0.7 } },
      { type: 'ai-generate', label: '主图1-场景1' },
      { type: 'ai-generate', label: '主图2-场景2' },
      { type: 'ai-generate', label: '主图3-场景3' },
      { type: 'ai-generate', label: '主图4-场景4' },
      { type: 'ai-generate', label: '主图5-场景5' },
      { type: 'ai-generate', label: '主图6-场景6' },
      { type: 'output-image-group', label: '6宫格结果' },
    ],
    connections: [
      { from: 0, to: 2, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 3, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 4, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 5, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 6, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 7, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 1, to: 2, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 3, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 4, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 5, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 6, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 7, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 8, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 3, to: 8, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 4, to: 8, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 5, to: 8, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 6, to: 8, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 7, to: 8, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
    ],
  },
  {
    id: 'ecom-video-storyboard',
    name: '电商广告7段分镜',
    description: '7段分镜 → 生成视频 → 配音 → 合成广告片',
    icon: 'Clapperboard',
    tags: ['视频', '电商'],
    nodes: [
      { type: 'input-text', label: '产品卖点', config: { text: '产品核心卖点，7段分镜广告' } },
      { type: 'ai-llm', label: '分镜脚本', config: { systemPrompt: '你是短视频导演，将产品卖点拆为7段分镜脚本，每段5秒', temperature: 0.8 } },
      { type: 'ai-video-generate', label: '开场钩子', config: { duration: 5 } },
      { type: 'ai-video-generate', label: '痛点场景', config: { duration: 5 } },
      { type: 'ai-video-generate', label: '产品出场', config: { duration: 5 } },
      { type: 'ai-video-generate', label: '功能演示', config: { duration: 5 } },
      { type: 'ai-video-generate', label: '效果对比', config: { duration: 5 } },
      { type: 'ai-video-generate', label: '信任背书', config: { duration: 5 } },
      { type: 'ai-video-generate', label: '行动召唤', config: { duration: 5 } },
      { type: 'ai-audio', label: '旁白配音', config: { voice: 'female-calm', speed: 1.0 } },
      { type: 'video-concat', label: '视频拼接' },
      { type: 'video-compose', label: '音视频合成' },
      { type: 'output-video', label: '广告成片' },
    ],
    connections: [
      { from: 0, to: 1, fromPort: 'out-prompt', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 10, fromPort: 'out-text', toPort: 'in-video', type: 'video' },
      { from: 2, to: 10, fromPort: 'out-video', toPort: 'in-video', type: 'video' },
      { from: 3, to: 10, fromPort: 'out-video', toPort: 'in-video', type: 'video' },
      { from: 4, to: 10, fromPort: 'out-video', toPort: 'in-video', type: 'video' },
      { from: 5, to: 10, fromPort: 'out-video', toPort: 'in-video', type: 'video' },
      { from: 6, to: 10, fromPort: 'out-video', toPort: 'in-video', type: 'video' },
      { from: 7, to: 10, fromPort: 'out-video', toPort: 'in-video', type: 'video' },
      { from: 8, to: 10, fromPort: 'out-video', toPort: 'in-video', type: 'video' },
      { from: 1, to: 9, fromPort: 'out-text', toPort: 'in-text', type: 'prompt' },
      { from: 10, to: 11, fromPort: 'out-video', toPort: 'in-video', type: 'video' },
      { from: 9, to: 11, fromPort: 'out-audio', toPort: 'in-audio', type: 'audio' },
      { from: 11, to: 12, fromPort: 'out-video', toPort: 'in-video', type: 'video' },
    ],
  },
  {
    id: 'social-9grid',
    name: '社交媒体9宫格',
    description: '产品/主题图 → LLM策划 → 9张社交媒体配图',
    icon: 'Grid3X3',
    tags: ['社媒', '批量'],
    nodes: [
      { type: 'input-image', label: '主题图' },
      { type: 'input-text', label: '主题描述', config: { text: '新品发布，社交媒体宣传' } },
      { type: 'ai-llm', label: '内容策划', config: { systemPrompt: '你是社交媒体运营专家，生成9张配图的不同角度描述', temperature: 0.7 } },
      { type: 'ai-generate', label: '图1' },
      { type: 'ai-generate', label: '图2' },
      { type: 'ai-generate', label: '图3' },
      { type: 'ai-generate', label: '图4' },
      { type: 'ai-generate', label: '图5' },
      { type: 'ai-generate', label: '图6' },
      { type: 'ai-generate', label: '图7' },
      { type: 'ai-generate', label: '图8' },
      { type: 'ai-generate', label: '图9' },
      { type: 'output-image-group', label: '9宫格' },
    ],
    connections: [
      { from: 0, to: 2, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 1, to: 2, fromPort: 'out-prompt', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 3, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 4, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 5, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 6, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 7, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 8, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 9, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 10, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 11, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 0, to: 3, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 4, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 5, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 6, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 7, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 8, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 9, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 10, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 11, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 3, to: 12, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 4, to: 12, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 5, to: 12, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 6, to: 12, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 7, to: 12, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 8, to: 12, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 9, to: 12, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 10, to: 12, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 11, to: 12, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
    ],
  },
  {
    id: 'brand-vi',
    name: '品牌VI应用',
    description: 'Logo + 品牌DNA → 名片/海报/包装等VI应用',
    icon: 'Shapes',
    tags: ['品牌', 'VI'],
    nodes: [
      { type: 'input-image', label: 'Logo' },
      { type: 'input-text', label: '品牌调性', config: { text: '高端简约现代风格' } },
      { type: 'ai-generate', label: '名片设计', config: { aspectRatio: '3:2' } },
      { type: 'ai-generate', label: '海报设计', config: { aspectRatio: '3:4' } },
      { type: 'ai-generate', label: '包装设计', config: { aspectRatio: '1:1' } },
      { type: 'ai-generate', label: '社交媒体头像', config: { aspectRatio: '1:1' } },
      { type: 'output-image-group', label: 'VI套件' },
    ],
    connections: [
      { from: 0, to: 2, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 3, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 4, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 5, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 1, to: 2, fromPort: 'out-prompt', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 3, fromPort: 'out-prompt', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 4, fromPort: 'out-prompt', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 5, fromPort: 'out-prompt', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 6, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 3, to: 6, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 4, to: 6, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 5, to: 6, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
    ],
  },
  {
    id: 'storyboard-comic',
    name: '故事板分镜',
    description: '故事描述 → LLM拆分 → 多格漫画/故事板',
    icon: 'BookOpen',
    tags: ['漫画', '分镜'],
    nodes: [
      { type: 'input-text', label: '故事大纲', config: { text: '一个简短的故事，分4格漫画表现' } },
      { type: 'ai-llm', label: '分镜脚本', config: { systemPrompt: '你是漫画分镜师，将故事拆为4个分镜描述', temperature: 0.8 } },
      { type: 'ai-generate', label: '格1-开场', config: { aspectRatio: '4:3' } },
      { type: 'ai-generate', label: '格2-发展', config: { aspectRatio: '4:3' } },
      { type: 'ai-generate', label: '格3-高潮', config: { aspectRatio: '4:3' } },
      { type: 'ai-generate', label: '格4-结局', config: { aspectRatio: '4:3' } },
      { type: 'output-image-group', label: '故事板' },
    ],
    connections: [
      { from: 0, to: 1, fromPort: 'out-prompt', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 2, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 3, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 4, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 5, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 6, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 3, to: 6, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 4, to: 6, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 5, to: 6, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
    ],
  },
  {
    id: 'magic-brush',
    name: '神奇画笔',
    description: '草图 → AI识别 → 高清重绘',
    icon: 'Paintbrush',
    tags: ['草图', '重绘'],
    nodes: [
      { type: 'input-image', label: '草图' },
      { type: 'ai-analyze', label: 'AI识别', config: { analysisType: 'describe' } },
      { type: 'ai-generate', label: '高清重绘', config: { quality: '4K' } },
      { type: 'ai-upscale', label: '无损放大', config: { scale: '2' } },
      { type: 'output-image', label: '成品' },
    ],
    connections: [
      { from: 0, to: 1, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 0, to: 2, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 1, to: 2, fromPort: 'out-text', toPort: 'in-prompt', type: 'prompt' },
      { from: 2, to: 3, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 3, to: 4, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
    ],
  },
  {
    id: 'img2video-with-audio',
    name: '图生视频+配音',
    description: '图片 → 生成视频 → AI配音 → 合成',
    icon: 'Video',
    tags: ['视频', '配音'],
    nodes: [
      { type: 'input-image', label: '首帧图片' },
      { type: 'input-text', label: '视频描述', config: { text: '镜头缓慢推进，电影质感' } },
      { type: 'ai-video-i2v', label: '图生视频', config: { duration: 5 } },
      { type: 'ai-audio', label: 'AI配音', config: { voice: 'male-professional', speed: 1.0 } },
      { type: 'video-compose', label: '音视频合成' },
      { type: 'output-video', label: '成片' },
    ],
    connections: [
      { from: 0, to: 2, fromPort: 'out-image', toPort: 'in-image', type: 'image' },
      { from: 1, to: 2, fromPort: 'out-prompt', toPort: 'in-prompt', type: 'prompt' },
      { from: 1, to: 3, fromPort: 'out-prompt', toPort: 'in-text', type: 'prompt' },
      { from: 2, to: 4, fromPort: 'out-video', toPort: 'in-video', type: 'video' },
      { from: 3, to: 4, fromPort: 'out-audio', toPort: 'in-audio', type: 'audio' },
      { from: 4, to: 5, fromPort: 'out-video', toPort: 'in-video', type: 'video' },
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
  onAddImages?: (imageUrls: string[], meta?: { modelName?: string; apiProvider?: string }) => void;
}

// ==================== 双主题配色 ====================
const nodeThemes = {
  gold: {
    // 侧边栏 — 与原型对齐 (#161b22)
    sidebarBg: '#161b22',
    sidebarBorder: 'rgba(212,175,55,0.15)',
    sidebarText: '#f0f6fc',
    sidebarMuted: '#8b949e',
    sidebarDimmed: '#484f58',
    // 节点 — 与原型对齐 (毛玻璃 rgba(22,27,34,0.96) + 金色强调)
    nodeBg: '#161b22',
    nodeBorder: 'rgba(212,175,55,0.3)',
    nodeSelectedBorder: 'var(--ne-accent)',
    nodeHoverBg: '#1c2128',
    nodeHeaderText: '#f0f6fc',
    nodePortText: '#8b949e',
    nodeBody: '#0d1117',
    nodeSelected: '#1c2128',
    nodeTitle: '#f0f6fc',
    portFill: '#161b22',
    portLabel: '#8b949e',
    badgeText: '#000',
    gridDot: '#21262d',
    danger: '#f85149',
    success: '#3fb950',
    arrowFill: '#484f58',
    // 强调色
    accent: '#d4af37',
    accentHover: '#c9a02e',
    accentDim: 'rgba(212,175,55,0.15)',
    accentMuted: 'rgba(212,175,55,0.25)',
    // 卡片 — 与原型对齐 (rgba(15,23,42,0.96))
    cardBg: '#1c2128',
    cardBorder: 'rgba(212,175,55,0.15)',
    border: 'rgba(48,54,61,0.6)',
    text: '#f0f6fc',
    textMuted: '#8b949e',
    // 输入框 — 与原型对齐
    inputBg: 'rgba(13,17,23,0.9)',
    inputBorder: 'rgba(48,54,61,0.8)',
    inputText: '#f0f6fc',
    inputPlaceholder: '#484f58',
    // 下拉选项
    optionBg: '#21262d',
    optionText: '#f0f6fc',
    // 按钮 — 与原型对齐
    btnBg: 'rgba(212,175,55,0.1)',
    btnHoverBg: 'rgba(212,175,55,0.2)',
    btnText: 'var(--ne-accent)',
    // 画布 — 与原型对齐 (#0d1117 点阵网格)
    canvasBg: '#0d1117',
    canvasGrid: 'rgba(48,54,61,0.3)',
    canvasDot: 'rgba(48,54,61,0.5)',
    // 连线 — 与原型对齐 (金色流动)
    connColor: '#30363d',
    connHighlight: 'var(--ne-accent)',
    // 工具栏 — 与原型对齐
    toolbarBg: '#161b22',
    toolbarBorder: 'rgba(48,54,61,0.6)',
    toolbarText: '#8b949e',
    // 标签
    tabActiveBg: 'rgba(212,175,55,0.15)',
    tabActiveText: 'var(--ne-accent)',
    tabInactiveText: '#484f58',
    // 执行状态 — 与原型对齐
    statusRunning: '#58a6ff',
    statusSuccess: '#3fb950',
    statusError: '#f85149',
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

export default function NodeEditor({ workflow, onBack, onWorkflowChange, canvasImages, themeStyle = 'gold', onAddImages }: NodeEditorProps) {
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
  const [sidebarTab, setSidebarTab] = useState<'nodes' | 'props' | 'ai-build' | 'presets' | 'prompts' | 'assistant' | 'material' | 'prompt'>('nodes');
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
  const [, setAiBuildLoading] = useState(false);
  const [, setAiBuildError] = useState<string | null>(null);
  const [, setAiBuildOpen] = useState(false);

  // P1: 执行日志
  const [execLogs, setExecLogs] = useState<{ time: number; nodeId: string; label: string; status: string; message: string; duration?: number; nodeType?: string }[]>([]);
  
  // B1: 工作流执行状态持久化 — 切页/刷新后恢复执行进度
  const WORKFLOW_EXEC_STATE_KEY = 'wujie_workflow_exec_state';
  useEffect(() => {
    try {
      const saved = localStorage.getItem(WORKFLOW_EXEC_STATE_KEY);
      if (saved) {
        const state = JSON.parse(saved);
        if (state.executionId && state.execStatus === 'running') {
          setExecutionId(state.executionId);
          setExecStatus('running');
          setExecLogs(state.execLogs || []);
          setExecResults(state.execResults || {});
          // 清除已持久化的running状态，由polling恢复
          localStorage.removeItem(WORKFLOW_EXEC_STATE_KEY);
        }
      }
    } catch {}
  }, []);  // P1: 节点复制粘贴
  const [showContentStrip, setShowContentStrip] = useState(true);
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showExecLog, setShowExecLog] = useState(false);
  const [clipboard, setClipboard] = useState<{ nodes: WorkflowNode[]; connections: WorkflowConnection[] } | null>(null);
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ type: 'canvas' | 'node'; x: number; y: number; nodeId?: string } | null>(null);

  // P2: 提示词库 - 使用统一的提示词模板系统
  const [, setPromptSnippets] = useState<PromptSnippet[]>(() => {
    try {
      // 从统一的提示词模板系统加载
      const templates = getPromptTemplates();
      // 同时兼容旧的提示词库数据
      const oldSnippets: PromptSnippet[] = (() => { try { return JSON.parse(localStorage.getItem('wujie-prompt-snippets') || '[]'); } catch { return []; } })();
      // 合并：模板优先，旧数据补充
      const fromTemplates: PromptSnippet[] = templates.map(t => ({
        id: t.id,
        text: t.content,
        tags: t.tags,
        category: t.category,
        createdAt: t.createdAt,
      }));
      const fromOld = oldSnippets.filter(s => !fromTemplates.some(t => t.id === s.id));
      return [...fromTemplates, ...fromOld];
    } catch { return []; }
  });
  const [, ] = useState('');
  const [, ] = useState('');
  const [, ] = useState('');
  const [, ] = useState('通用');

  // P2: 撤销重做
  const [historyStack, setHistoryStack] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyIndexRef = useRef(-1);
  const isUndoRedoRef = useRef(false);

  // P2: 画布助手 (节点感知)
  const [, setAssistantMessages] = useState<{ role: 'user' | 'assistant'; content: string; suggestions?: { text: string; action: string }[] }[]>([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [, setAssistantLoading] = useState(false);

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
  }, [setWf]);

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
  }, [setWf]);

  // P2: 保存提示词到库 - 同时保存到统一的提示词模板系统
  useCallback((text: string, tags: string[], category: string) => {
        const snippet: PromptSnippet = { id: `ps-${Date.now()}`, text, tags, category, createdAt: Date.now() };
        // 保存到统一的提示词模板系统（顶层 import，避免客户端 require）
        addPromptTemplate({
          name: text.slice(0, 30) + (text.length > 30 ? '...' : ''),
          content: text,
          category,
          tags,
          createdBy: 'user',
          isGlobal: false,
        });
        // 同时保存到旧的存储（向后兼容）
        setPromptSnippets(prev => {
          const next = [...prev, snippet];
          localStorage.setItem('wujie-prompt-snippets', JSON.stringify(next));
          return next;
        });
      }, []);

  // P2: 画布助手发送消息 (P1增强: 上游节点自动引用 + P0增强: 意图分类+操作执行+建议)
  useCallback(async () => {
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
          
          // P0增强: 检测操作意图并执行
          const operationKeywords = {
            execute: ['执行', '运行', '跑一下', '生成', '开始'],
            connect: ['连接', '连线', '接到', '连到'],
            add: ['添加', '新增', '创建', '增加', '加一个'],
            delete: ['删除', '移除', '去掉', '删掉'],
            modify: ['修改', '改一下', '调整', '设置', '配置']
          };
          
          let detectedOperation: string | null = null;
          for (const [op, keywords] of Object.entries(operationKeywords)) {
            if (keywords.some(kw => userMsg.toLowerCase().includes(kw))) {
              detectedOperation = op;
              break;
            }
          }
          
          // 如果检测到操作意图，先执行操作再回复
          if (detectedOperation && node) {
            let operationResult = '';
            switch (detectedOperation) {
              case 'execute':
                // 执行当前选中的节点（级联执行选中节点的下游链路）
                handleCascadeRun(node.id);
                operationResult = `已触发执行节点 "${node.label}"，请在工作流执行面板查看进度。`;
                break;
              case 'add': {
                // 解析要添加的节点类型
                const nodeTypeKeywords: Record<string, string> = {
                  '生成': 'ai-generate', '图像': 'ai-generate', '图片': 'ai-generate',
                  '视频': 'ai-video-generate', '音频': 'ai-audio',
                  '文字': 'input-text', '输入': 'input-text', '提示词': 'input-text',
                  '条件': 'condition', '循环': 'loop',
                  '输出': 'output-image', '导出': 'output-export'
                };
                let newNodeType = 'ai-generate' as NodeType;
                for (const [kw, type] of Object.entries(nodeTypeKeywords)) {
                  if (userMsg.includes(kw)) {
                    newNodeType = type as NodeType;
                    break;
                  }
                }
                // 在选中节点右侧创建新节点
                const newNode = createWorkflowNode(newNodeType, node.x + node.width + 80, node.y);
                setWf(prev => {
                  // 自动连线：选中节点输出 → 新节点输入
                  const selOutPort = node.ports.find(p => p.direction === 'out');
                  const newInPort = newNode.ports.find(p => p.direction === 'in');
                  const autoConn = (selOutPort && newInPort && canConnectPorts(selOutPort.type, newInPort.type))
                    ? [createConnection(node.id, selOutPort.id, newNode.id, newInPort.id, selOutPort.type)]
                    : [];
                  return { ...prev, nodes: [...prev.nodes, newNode], connections: [...prev.connections, ...autoConn] };
                });
                setSelectedNodeIds(new Set([newNode.id]));
                operationResult = `已添加新节点 [${NODE_TYPE_LABELS[newNodeType] || newNodeType}] 并自动连线，可在右侧属性面板编辑配置。`;
                break;
              }
              case 'delete': {
                const nodeLabel = node.label;
                handleDeleteNode(node.id);
                setSelectedNodeIds(new Set());
                operationResult = `已删除节点 "${nodeLabel}" 及其所有连线。`;
                break;
              }
              default:
                operationResult = `已识别操作意图: ${detectedOperation}，请确认具体参数。`;
            }
            setAssistantMessages(prev => [...prev, { 
              role: 'assistant', 
              content: `✅ ${operationResult}\n\n有什么其他需要帮助的吗？`,
              suggestions: [
                { text: '执行整个工作流', action: 'execute-all' },
                { text: '查看节点配置', action: 'view-config' },
                { text: '继续对话', action: 'chat' }
              ]
            }]);
            setAssistantLoading(false);
            return;
          }
          
          // P0增强: 智能系统提示词
          const enhancedSystemPrompt = `你是无界AI工作流助手，具备以下能力：
1. 节点配置指导：帮助用户理解和配置各类节点参数
2. 工作流优化建议：分析节点链路，提出效率或质量改进建议
3. 操作执行：识别用户操作意图并执行（如添加节点、连线、删除等）
4. 错误诊断：分析工作流执行失败原因并提供修复方案

当前上下文：
${contextInfo}

可用节点类型：ai-generate(图像生成), ai-video-generate(视频生成), ai-audio(音频), input-text(文字输入), condition(条件分支), loop(循环), output-image(输出图片), output-export(导出)等30+类型。

回复格式要求：
- 如果用户请求执行操作，回复格式为 "✅ [操作结果]\n\n[后续建议]"
- 如果用户询问问题，直接回答并附上"💡 建议下一步"
- 如果意图模糊，追问具体需求（如"您想添加什么类型的节点？"）`;
          
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'system', content: enhancedSystemPrompt }, { role: 'user', content: userMsg }] }),
          });
          if (res.ok) {
            const data = await res.json();
            const assistantContent = data.content || data.message || '无法获取回复';
            
            // P0增强: 根据回复内容自动生成建议
            const suggestions: Array<{ text: string; action: string }> = [];
            if (node) {
              if (node.type.startsWith('ai-')) {
                suggestions.push({ text: '执行此节点', action: 'execute-node' });
                suggestions.push({ text: '查看参数说明', action: 'view-params' });
              }
              if (assistantContent.includes('建议') || assistantContent.includes('可以')) {
                suggestions.push({ text: '应用建议', action: 'apply-suggestion' });
              }
            }
            suggestions.push({ text: '添加相关节点', action: 'add-related' });
            
            setAssistantMessages(prev => [...prev, { 
              role: 'assistant', 
              content: assistantContent,
              suggestions: suggestions.length > 0 ? suggestions : undefined
            }]);
          } else {
            setAssistantMessages(prev => [...prev, { role: 'assistant', content: '助手暂时无法回复，请稍后再试。' }]);
          }
        } catch {
          setAssistantMessages(prev => [...prev, { role: 'assistant', content: '网络错误，请稍后再试。' }]);
        } finally { setAssistantLoading(false); }
      }, [assistantInput, wf.nodes, wf.connections, selectedNodeId, setWf]);

  const svgRef = useRef<SVGSVGElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport; // 始终保持最新值，避免拖动时stale closure
  const { models, loading: modelsLoading } = useModelList();
  const chatModels = useMemo(() => models.filter(m => m.type === 'chat'), [models]);
  const imageModels = useMemo(() => models.filter(m => m.type === 'image'), [models]);

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

  // P1-4: 上游图片URL缓存 — 避免每个NodeCard内联IIFE重复计算
  const upstreamImageUrls = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of wf.connections) {
      if (c.type === 'image' || c.type === 'data') {
        const upNode = wf.nodes.find(n => n.id === c.fromNodeId);
        const url = (upNode?.config?.imageUrl as string) || (execResults[c.fromNodeId]?.output?.imageUrl as string);
        if (url) m.set(c.toNodeId, url);
      }
    }
    return m;
  }, [wf.connections, wf.nodes, execResults]);

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
  }, [setWf, workflow]);

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
      const autoConns: WorkflowConnection[] = [];
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
  }, [selectedNodeIds, setWf]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    setWf(prev => ({
      ...prev,
      nodes: prev.nodes.filter(n => n.id !== nodeId),
      connections: prev.connections.filter(c => c.fromNodeId !== nodeId && c.toNodeId !== nodeId),
    }));
    setSelectedNodeIds(prev => { const next = new Set(prev); next.delete(nodeId); return next; });
  }, [setWf]);

  // 从内容面板拖拽图片到画布 → 创建 input-image 节点
  const handleCanvasImageDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const imageUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (!imageUrl) return;
    const rect = canvasContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vp = viewportRef.current;
    const cx = (e.clientX - rect.left - vp.x) / vp.zoom;
    const cy = (e.clientY - rect.top - vp.y) / vp.zoom;

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
  }, [canvasImages, setWf]);

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
  }, [setWf]);

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
  }, [wf.nodes, handleNodeUpdate, setWf]);

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
  }, [setWf, wf.nodes]);

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
  }, [selectedNodeIds, selectedNodeId, clipboard, wf, handleDeleteNode, handleUndo, handleRedo, setWf]);

  // ─── 连线操作 (含端口类型约束) ───

  const handlePortMouseDown = useCallback((e: React.MouseEvent, nodeId: string, port: NodePort) => {
    e.stopPropagation();
    if (port.direction !== 'out') return;
    const node = wf.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const pos = getPortPositionLocal(node, port);
    if (!pos) return;
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
  }, [draggingConn, setWf, wf.connections]);

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
      const canvasRect = canvasContainerRef.current?.getBoundingClientRect();
      const vp = viewportRef.current;
      if (canvasRect) {
        const mx = (e.clientX - canvasRect.left - vp.x) / vp.zoom;
        const my = (e.clientY - canvasRect.top - vp.y) / vp.zoom;
        setBoxSelect({ startX: mx, startY: my, endX: mx, endY: my });
        isBoxSelectingRef.current = true;
      }
    }
  }, [draggingConn]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setViewport(v => ({ ...v, x: panStart.vx + (e.clientX - panStart.x), y: panStart.vy + (e.clientY - panStart.y) }));
    } else if (draggingNodeRef.current) {
      const canvasRect = canvasContainerRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const vp = viewportRef.current;
      const mx = (e.clientX - canvasRect.left - vp.x) / vp.zoom;
      const my = (e.clientY - canvasRect.top - vp.y) / vp.zoom;
      const nodeId = draggingNodeRef.current;
      const offset = dragOffsetRef.current;
      setWf(prev => ({
        ...prev,
        nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, x: mx - offset.x, y: my - offset.y } : n),
      }));
    } else if (draggingConn) {
      const canvasRect = canvasContainerRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const vp = viewportRef.current;
      const mx = (e.clientX - canvasRect.left - vp.x) / vp.zoom;
      const my = (e.clientY - canvasRect.top - vp.y) / vp.zoom;
      setDraggingConn(prev => prev ? { ...prev, toX: mx, toY: my } : null);
    } else if (isBoxSelectingRef.current && boxSelect) {
      // 更新框选范围
      const canvasRect = canvasContainerRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const vp = viewportRef.current;
      const mx = (e.clientX - canvasRect.left - vp.x) / vp.zoom;
      const my = (e.clientY - canvasRect.top - vp.y) / vp.zoom;
      setBoxSelect(prev => prev ? { ...prev, endX: mx, endY: my } : null);
    }
  }, [isPanning, draggingConn, boxSelect, panStart.vx, panStart.x, panStart.vy, panStart.y, setWf]);

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
  }, [boxSelect, setWf, onWorkflowChange, wf.nodes]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    setViewport(v => ({ ...v, zoom: Math.max(0.15, Math.min(3, v.zoom * factor)) }));
  }, []);

  // ─── 右键菜单 ───
  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ type: 'canvas', x: e.clientX, y: e.clientY });
  }, []);

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ type: 'node', x: e.clientX, y: e.clientY, nodeId });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // ESC关闭右键菜单
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && contextMenu) closeContextMenu(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [contextMenu, closeContextMenu]);

  const handleContextAction = useCallback((action: string) => {
    if (!contextMenu) return;
    if (contextMenu?.type === 'canvas') {
      switch (action) {
        case 'add-node': {
          // 在右键位置添加一个AI生成节点
          const canvasRect = canvasContainerRef.current?.getBoundingClientRect();
          const vp = viewportRef.current;
          const mx = canvasRect ? (contextMenu.x - canvasRect.left - vp.x) / vp.zoom : 100;
          const my = canvasRect ? (contextMenu.y - canvasRect.top - vp.y) / vp.zoom : 100;
          const newNode = createWorkflowNode('ai-generate', mx - 160, my - 60);
          setWf(prev => ({ ...prev, nodes: [...prev.nodes, newNode] }));
          setSelectedNodeIds(new Set([newNode.id]));
          break;
        }
        case 'paste': {
          if (!clipboard) break;
          const canvasRect2 = canvasContainerRef.current?.getBoundingClientRect();
          const vp2 = viewportRef.current;
          const mx2 = canvasRect2 ? (contextMenu.x - canvasRect2.left - vp2.x) / vp2.zoom : 100;
          const my2 = canvasRect2 ? (contextMenu.y - canvasRect2.top - vp2.y) / vp2.zoom : 100;
          // 偏移粘贴避免完全重叠
          const offset = 30;
          const idMap = new Map<string, string>();
          const newNodes = clipboard.nodes.map(n => {
            const newId = n.id + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            idMap.set(n.id, newId);
            return { ...n, id: newId, x: mx2 + offset, y: my2 + offset };
          });
          const newConns = clipboard.connections
            .map(c => {
              const newFromId = idMap.get(c.fromNodeId);
              const newToId = idMap.get(c.toNodeId);
              if (!newFromId || !newToId) return null;
              return { ...c, id: c.id + '_' + Date.now().toString(36), fromNodeId: newFromId, toNodeId: newToId };
            })
            .filter(Boolean) as WorkflowConnection[];
          setWf(prev => ({ ...prev, nodes: [...prev.nodes, ...newNodes], connections: [...prev.connections, ...newConns] }));
          setSelectedNodeIds(new Set(newNodes.map(n => n.id)));
          break;
        }
        case 'select-all': {
          setSelectedNodeIds(new Set(wf.nodes.map(n => n.id)));
          break;
        }
      }
    } else if (contextMenu?.type === 'node' && contextMenu.nodeId) {
      const nodeId = contextMenu.nodeId;
      switch (action) {
        case 'copy': {
          const selIds = selectedNodeIds.has(nodeId) ? selectedNodeIds : new Set([nodeId]);
          const selNodes = wf.nodes.filter(n => selIds.has(n.id));
          const selConns = wf.connections.filter(c => selIds.has(c.fromNodeId) && selIds.has(c.toNodeId));
          setClipboard({ nodes: selNodes, connections: selConns });
          break;
        }
        case 'duplicate': {
          const selIds = selectedNodeIds.has(nodeId) ? selectedNodeIds : new Set([nodeId]);
          const selNodes = wf.nodes.filter(n => selIds.has(n.id));
          const selConns = wf.connections.filter(c => selIds.has(c.fromNodeId) && selIds.has(c.toNodeId));
          const idMap = new Map<string, string>();
          const newNodes = selNodes.map(n => {
            const newId = n.id + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            idMap.set(n.id, newId);
            return { ...n, id: newId, x: n.x + 40, y: n.y + 40 };
          });
          const newConns = selConns
            .map(c => {
              const newFromId = idMap.get(c.fromNodeId);
              const newToId = idMap.get(c.toNodeId);
              if (!newFromId || !newToId) return null;
              return { ...c, id: c.id + '_' + Date.now().toString(36), fromNodeId: newFromId, toNodeId: newToId };
            })
            .filter(Boolean) as WorkflowConnection[];
          setWf(prev => ({ ...prev, nodes: [...prev.nodes, ...newNodes], connections: [...prev.connections, ...newConns] }));
          setSelectedNodeIds(new Set(newNodes.map(n => n.id)));
          break;
        }
        case 'disconnect': {
          setWf(prev => ({
            ...prev,
            connections: prev.connections.filter(c => c.fromNodeId !== nodeId && c.toNodeId !== nodeId),
          }));
          break;
        }
        case 'delete': {
          const selIds = selectedNodeIds.has(nodeId) ? selectedNodeIds : new Set([nodeId]);
          setWf(prev => ({
            ...prev,
            nodes: prev.nodes.filter(n => !selIds.has(n.id)),
            connections: prev.connections.filter(c => !selIds.has(c.fromNodeId) && !selIds.has(c.toNodeId)),
          }));
          setSelectedNodeIds(new Set());
          break;
        }
      }
    }
    closeContextMenu();
  }, [contextMenu?.type, contextMenu?.nodeId, contextMenu?.x, contextMenu?.y, closeContextMenu, setWf, clipboard, wf.nodes, wf.connections, selectedNodeIds]);

  // ─── 执行工作流 ───

  const handleRunWorkflow = useCallback(async () => {
    setExecStatus('running');
    setExecResults({});
    setExecLogs([]);
    try {
      const res = await fetch('/api/workflow/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', nodes: wf.nodes, connections: wf.connections }),
      });
      const data = await res.json();
      if (data.executionId) {
        setExecutionId(data.executionId);
        // B1: 持久化执行状态（切页不丢失）
        localStorage.setItem(WORKFLOW_EXEC_STATE_KEY, JSON.stringify({
          executionId: data.executionId, execStatus: 'running', execResults: {}, execLogs: [],
        }));
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
    localStorage.removeItem(WORKFLOW_EXEC_STATE_KEY);
  }, [executionId]);

  // B2: 节点一键重试 — 仅重试单个失败节点，不重跑全流程
  const handleRetryNode = useCallback(async (nodeId: string) => {
    if (!executionId) return;
    setExecLogs(prev => prev.map(l => l.nodeId === nodeId && l.status === 'error' ? { ...l, status: 'running', message: '重试中...' } : l));
    try {
      const res = await fetch('/api/workflow/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry', executionId, nodeId, nodes: wf.nodes, connections: wf.connections }),
      });
      const data = await res.json();
      if (data.success) {
        setExecLogs(prev => prev.map(l => l.nodeId === nodeId && l.status === 'running' ? { ...l, status: 'success', message: '重试成功', time: Date.now() } : l));
        setExecResults(prev => ({ ...prev, [nodeId]: { status: 'success', output: data.output } }));
      } else {
        setExecLogs(prev => prev.map(l => l.nodeId === nodeId && l.status === 'running' ? { ...l, status: 'error', message: data.error || '重试失败', time: Date.now() } : l));
      }
    } catch {
      setExecLogs(prev => prev.map(l => l.nodeId === nodeId && l.status === 'running' ? { ...l, status: 'error', message: '重试网络错误', time: Date.now() } : l));
    }
  }, [executionId, wf]);

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
          // B1: 持久化最终结果，3秒后清除
          const finalState = { executionId, execStatus: data.status, execResults: data.results || {}, execLogs };
          localStorage.setItem(WORKFLOW_EXEC_STATE_KEY, JSON.stringify(finalState));
          setTimeout(() => {
            if (localStorage.getItem(WORKFLOW_EXEC_STATE_KEY) === JSON.stringify(finalState)) {
              localStorage.removeItem(WORKFLOW_EXEC_STATE_KEY);
            }
          }, 3000);
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
            // ★ 收集工作流中使用的模型信息
            let workflowModelName: string | undefined;
            let workflowApiProvider: string | undefined;
            for (const [, result] of Object.entries(data.results as Record<string, { status: string; output?: Record<string, unknown> }>)) {
              if (result.status === 'success' && result.output) {
                const imgUrls = result.output.imageUrls as string[] | undefined;
                const imgUrl = result.output.imageUrl as string | undefined;
                if (Array.isArray(imgUrls) && imgUrls.length > 0) {
                  generatedUrls.push(...imgUrls);
                } else if (imgUrl) {
                  generatedUrls.push(imgUrl);
                }
                // 尝试从输出获取模型信息
                if (!workflowModelName && result.output.modelName) workflowModelName = result.output.modelName as string;
                if (!workflowApiProvider && result.output.apiProvider) workflowApiProvider = result.output.apiProvider as string;
              }
            }
            if (generatedUrls.length > 0) {
              // ★ 如果输出没有模型信息，从工作流节点中查找
              if (!workflowModelName && wf.nodes) {
                const genNode = wf.nodes.find(n => n.type === 'ai-generate' && n.config?.model);
                if (genNode?.config?.model) {
                  const model = genNode.config.model as string;
                  workflowModelName = model.includes('::') ? model.split('::').pop()! : model;
                  if (!workflowApiProvider && model.includes('::')) workflowApiProvider = model.split('::')[0];
                }
              }
              const meta: { modelName?: string; apiProvider?: string } = {};
              if (workflowModelName) meta.modelName = workflowModelName;
              if (workflowApiProvider) meta.apiProvider = workflowApiProvider;
              onAddImages(generatedUrls, Object.keys(meta).length > 0 ? meta : undefined);
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
      } catch (err) {
        // 临时网络错误不直接终止轮询，允许重试
        console.error('[workflow-poll] Error polling workflow status:', err);
        const delay = pollCount <= 5 ? 1000 : pollCount <= 15 ? 1500 : 2000;
        if (pollCount >= 180) {
          setExecStatus('failed');
          return;
        }
        timerId = setTimeout(poll, delay);
        return;
      }
      // ★ 动态间隔：前5次1秒，5-15次1.5秒，之后2秒
      const delay = pollCount <= 5 ? 1000 : pollCount <= 15 ? 1500 : 2000;
      // ★ 轮询上限：180次（约5分钟），防止无限轮询
      if (pollCount >= 180) {
        setExecStatus('failed');
        return;
      }
      timerId = setTimeout(poll, delay);
    };
    poll();
    return () => { if (timerId) clearTimeout(timerId); };
  }, [execLogs, execStatus, executionId, onAddImages, wf.nodes]);

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
    let cancelled = false;
    img.onload = () => {
      if (cancelled) return;
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
    // 返回清理函数，组件卸载时取消回调
    return () => { cancelled = true; img.onload = null; };
  }, [setWf]);

  const updateNodeSize = useCallback((nodeId: string, width: number, height: number) => {
    setWf(prev => ({
      ...prev,
      nodes: prev.nodes.map((n: WorkflowNode) =>
        n.id === nodeId ? { ...n, width, height } : n
      ),
    }));
    // 节点尺寸变化时清除该节点的端口位置缓存，下次取端口位置时重新计算
    for (const key of portPositionCacheRef.current.keys()) {
      if (key.startsWith(nodeId + '-')) {
        portPositionCacheRef.current.delete(key);
      }
    }
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

  useCallback(async () => {
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
      }, [aiBuildInput, setWf]);

  // ─── 加载预设模板 ───

  useCallback((preset: WorkflowPreset) => {
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
      }, [setWf]);

  // ─── 自动布局 ───

  useCallback(() => {
        setWf(prev => autoLayoutWorkflow(prev));
      }, [setWf]);

  // ─── 连线路径计算 ───

  const getConnPath = useCallback((fromX: number, fromY: number, toX: number, toY: number) => {
    const dx = Math.abs(toX - fromX) * 0.5;
    return `M ${fromX} ${fromY} C ${fromX + dx} ${fromY}, ${toX - dx} ${toY}, ${toX} ${toY}`;
  }, []);

  // 端口位置缓存: 避免每次渲染连线时查询DOM
  const portPositionCacheRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // 节点变化时清除端口位置缓存（确保计算结果与最新数据一致）
  const prevNodesRef = useRef(wf.nodes);
  useEffect(() => {
    if (prevNodesRef.current !== wf.nodes) {
      portPositionCacheRef.current.clear();
      prevNodesRef.current = wf.nodes;
    }
  }, [wf.nodes]);

  // 纯数据驱动的端口位置计算（不依赖DOM查询）
  const getPortPositionLocal = useCallback((node: WorkflowNode, port: NodePort) => {
    const cacheKey = `${node.id}-${port.direction}-${port.id}`;
    const cached = portPositionCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const result = computePortPosition(node, port.id);
    if (result) {
      portPositionCacheRef.current.set(cacheKey, result);
    }
    return result;
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
  useMemo(() => {
        if (!searchQuery) return WORKFLOW_PRESETS;
        const q = searchQuery.toLowerCase();
        return WORKFLOW_PRESETS.filter(p => p.name.includes(q) || p.description.includes(q) || p.tags.some(t => t.includes(q)));
      }, [searchQuery]);

  // ─── 渲染 ───

  return (
    <>
    <div className="node-editor-root h-screen w-screen flex flex-col text-foreground overflow-hidden select-none" data-theme={themeStyle === 'monochrome' ? 'monochrome' : 'gold'} style={{ ...neVars, background: T.canvasBg }}>
      {/* 全局图片上传 (foreignObject内input.click()不可靠, 统一由外部触发) */}
      <input ref={imageFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleGlobalImageUpload} />
      {/* ═══ 顶部工具栏 - 全宽, 与原型对齐 ═══ */}
      <header className="bg-card h-12 flex items-center justify-between px-3 border-b border-border/20 z-50 shrink-0" role="toolbar" aria-label="工作流工具栏">
        {/* 左侧：工作流操作 */}
        <div className="flex items-center gap-1" role="group" aria-label="工作流操作">
          {onBack && (
            <button onClick={onBack} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-sm transition-colors cursor-pointer" title="返回画布 (Esc)" aria-label="返回画布">
              <ArrowLeft size={16} />
              <span>画布</span>
            </button>
          )}
          <div className="w-px h-6 bg-border/20 mx-1" aria-hidden="true" />
          {/* AI建图 */}
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-sm font-medium transition-colors cursor-pointer" title="AI自然语言建图 (Ctrl+L)" aria-label="AI建图" onClick={() => setAiBuildOpen(true)}>
            <Sparkles size={16} />
            <span>AI 建图</span>
          </button>
          {/* 执行/停止 */}
          <button onClick={execStatus === 'running' ? handleStopWorkflow : handleRunWorkflow} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${execStatus === 'running' ? 'bg-destructive/10 text-destructive hover:bg-destructive/20' : 'bg-[var(--color-success,#3fb950)]/10 text-[var(--color-success,#3fb950)] hover:bg-[var(--color-success,#3fb950)]/20'}`} title={execStatus === 'running' ? '停止执行 (Ctrl+.)' : '执行工作流 (Ctrl+Enter)'} aria-label={execStatus === 'running' ? '停止执行' : '执行工作流'}>
            {execStatus === 'running' ? <Square size={16} /> : <Play size={16} />}
            <span>{execStatus === 'running' ? '停止' : '执行'}</span>
          </button>
          <div className="w-px h-6 bg-border/20 mx-1" aria-hidden="true" />
          {/* 撤销/重做 */}
          <button onClick={handleUndo} disabled={historyIndex <= 0} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="撤销 Ctrl+Z" aria-label="撤销">
            <RotateCcw size={16} />
          </button>
          <button onClick={handleRedo} disabled={historyIndex >= historyStack.length - 1} className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="重做 Ctrl+Shift+Z" aria-label="重做">
            <RotateCcw size={16} className="scale-x-[-1]" />
          </button>
          <div className="w-px h-6 bg-border/20 mx-1" aria-hidden="true" />
          {/* 预设 */}
          <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-sm transition-colors cursor-pointer" title="预设工作流模板 (Ctrl+P)" aria-label="预设工作流" onClick={() => setSidebarTab(sidebarTab === 'presets' ? 'nodes' : 'presets')}>
            <LayoutGrid size={16} />
            <span>预设</span>
          </button>
          {/* 保存 */}
          <button onClick={handleSaveWorkflow} disabled={saveStatus === 'saving'} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${saveStatus === 'saved' ? 'text-[var(--color-success,#3fb950)]' : saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title="保存工作流">
            {saveStatus === 'saving' ? <Loader2 size={16} className="animate-spin" /> : saveStatus === 'saved' ? <Check size={16} /> : <Save size={16} />}
            <span>{saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存' : '保存'}</span>
          </button>
          {/* 导入 */}
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
                  if (!result || result.nodes.length === 0) { alert('未能识别有效的ComfyUI工作流节点'); return; }
                  setWf(prev => ({ ...prev, nodes: [...prev.nodes, ...result.nodes], connections: [...prev.connections, ...result.connections] }));
                } catch (err) { alert('导入失败: ' + (err instanceof Error ? err.message : '无效的JSON文件')); }
              };
              input.click();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-sm transition-colors cursor-pointer" title="导入工作流 (Ctrl+I)" aria-label="导入工作流"
          >
            <FileInput size={16} />
          </button>
          {/* JSON编辑器 (build_mode下隐藏) */}
          {!isBuildMode && (
            <button
              onClick={() => { setJsonEditContent(JSON.stringify({ nodes: wf.nodes, connections: wf.connections }, null, 2)); setJsonEditorOpen(true); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-sm transition-colors cursor-pointer" title="查看/编辑JSON"
            >
              <Settings size={16} />
            </button>
          )}
        </div>
        {/* 右侧：工作流信息 + 缩放控制 + 面板切换 */}
        <div className="flex items-center gap-1" role="group" aria-label="视图控制">
          {/* 工作流名称 + 统计 */}
          <span className="text-sm font-semibold text-primary mr-1">{wf.name}</span>
          <span className="text-[11px] text-muted-foreground mr-2">{wf.nodes.length} 节点 · {wf.connections.length} 连线</span>
          <div className="w-px h-6 bg-border/20 mx-1" aria-hidden="true" />
          {/* 缩放控制 */}
          <button onClick={() => setViewport(v => ({ ...v, zoom: Math.max(0.2, v.zoom * 0.8) }))} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer" title="缩小 (Ctrl+-)" aria-label="缩小">
            <ZoomOut size={16} />
          </button>
          <span className="text-xs text-muted-foreground font-mono w-12 text-center" aria-live="polite" aria-label="当前缩放">{Math.round(viewport.zoom * 100)}%</span>
          <button onClick={() => setViewport(v => ({ ...v, zoom: Math.min(3, v.zoom * 1.2) }))} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer" title="放大 (Ctrl++)" aria-label="放大">
            <ZoomIn size={16} />
          </button>
          <button onClick={() => setViewport({ x: 0, y: 0, zoom: 0.8 })} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer" title="重置视图 (Ctrl+0)" aria-label="重置视图">
            <Maximize size={16} />
          </button>
          <div className="w-px h-6 bg-border/20 mx-1" aria-hidden="true" />
          {/* 面板切换按钮组 - 与原型对齐 */}
          <button className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showLeftPanel ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title="节点库" aria-label="切换节点库面板" aria-pressed={showLeftPanel} onClick={() => setShowLeftPanel(!showLeftPanel)}>
            <Blocks size={16} />
          </button>
          <button className={`p-1.5 rounded-lg transition-colors cursor-pointer ${sidebarTab === 'material' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title="素材库" aria-label="切换素材库面板" aria-pressed={sidebarTab === 'material'} onClick={() => setSidebarTab(sidebarTab === 'material' ? 'nodes' : 'material')}>
            <FolderOpen size={16} />
          </button>
          <button className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showContentStrip ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title="内容窗口" aria-label="切换内容窗口" aria-pressed={showContentStrip} onClick={() => setShowContentStrip(!showContentStrip)}>
            <LayoutGrid size={16} />
          </button>
          <button className={`p-1.5 rounded-lg transition-colors cursor-pointer ${sidebarTab === 'prompts' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title="提示词库" aria-label="切换提示词库面板" aria-pressed={sidebarTab === 'prompts'} onClick={() => setSidebarTab(sidebarTab === 'prompts' ? 'nodes' : 'prompts')}>
            <BookOpen size={16} />
          </button>
          <button className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showExecLog ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title="执行日志" aria-label="切换执行日志面板" aria-pressed={showExecLog} onClick={() => setShowExecLog(!showExecLog)}>
            <ScrollText size={16} />
          </button>
        </div>
      </header>

      {/* ═══ 主体三栏布局 - 与原型对齐 ═══ */}
      <div className="flex flex-1 min-h-0">
      {/* ═══ 左侧节点库面板 - 与原型对齐: w-64, 搜索+分类列表 ═══ */}
      {showLeftPanel && (
      <aside className="w-64 shrink-0 bg-card border-r border-border/20 flex flex-col overflow-hidden">
        {/* 搜索框 */}
        <div className="p-3 sticky top-0 z-10 bg-card border-b border-border/10">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索节点..."
              className="w-full border border-border rounded-xl px-8 py-2 text-sm bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>
        {/* 节点分类列表 */}
        <div className="flex-1 overflow-y-auto">
          {Object.entries(groupedTemplates).map(([cat, templates]) => (
            <div key={cat} className="mb-1">
              <div className="px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-bold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_TYPE_COLORS[cat as NodeCategory] }} />
                {NODE_CATEGORY_LABELS[cat as NodeCategory]}
              </div>
              {templates.map(t => (
                <button
                  key={t.type}
                  onClick={() => handleAddNode(t.type)}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 cursor-pointer group hover:bg-muted/60 active:scale-[0.98]"
                >
                  <span className="text-muted-foreground group-hover:text-primary transition-colors">
                    {getNodeIcon(t.type, 16)}
                  </span>
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-foreground text-[13px] leading-tight">{t.label}</div>
                    <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{t.desc}</div>
                  </div>
                  <Plus size={14} className="text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0" />
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>
      )}



      {/* ═══ 中间区域: 画布 + 右侧属性面板 ═══ */}
      <div className="flex flex-1 min-h-0">

      {/* 主画布区域 */}
      <div className="flex-1 relative min-h-0 overflow-hidden">
        {/* 画布容器 - HTML架构 (SVG连线层 + HTML节点层, 与原型对齐) */}
        <div
          ref={canvasContainerRef}
          className="w-full h-full relative overflow-hidden canvas-bg"
          style={{
            cursor: isPanning ? 'grabbing' : draggingConn ? 'crosshair' : 'default',
            background: T.nodeBg === '#161b22' ? '#0d1117' : '#f8fafc',
          }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onWheel={handleWheel}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDrop={handleCanvasImageDrop}
          onContextMenu={handleCanvasContextMenu}
        >
          {/* 网格背景 - 独立层, 不随viewport transform变化 */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: `radial-gradient(circle, ${T.gridDot} 0.5px, transparent 0.5px)`,
            backgroundSize: `${20 * viewport.zoom}px ${20 * viewport.zoom}px`,
            backgroundPosition: `${viewport.x % (20 * viewport.zoom)}px ${viewport.y % (20 * viewport.zoom)}px`,
          }} />

          {/* SVG连线层 (z-index:1, pointer-events:stroke仅对hit-area) */}
          <svg
            ref={svgRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: 1 }}
            aria-hidden="true"
          >
            <defs>
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
                if (!from || !to) return null;
                const color = PORT_COLORS[conn.type] || T.connColor;
                const isHighlighted = isConnectionHighlighted(conn);
                const isRunning = execStatus === 'running' && (execResults[conn.fromNodeId]?.status === 'success');

                const markerId = conn.type === 'image' ? 'arrow-image'
                  : conn.type === 'prompt' ? 'arrow-prompt'
                  : conn.type === 'mask' ? 'arrow-mask'
                  : conn.type === 'condition' ? 'arrow-condition'
                  : conn.type === 'data' ? 'arrow-data'
                  : 'arrow-default';

                return (
                  <g key={conn.id}>
                    {(() => {
                      const isBlocked = Array.isArray(toNode.config?.blockedInputs) && (toNode.config.blockedInputs as string[]).includes(conn.id);
                      return (
                        <>
                          {isHighlighted && !isBlocked && (
                            <path d={getConnPath(from.x, from.y, to.x, to.y)} fill="none" stroke={color} strokeWidth={6} strokeOpacity={0.15} />
                          )}
                          <path
                            d={getConnPath(from.x, from.y, to.x, to.y)}
                            fill="none" stroke={isBlocked ? '#666' : color} strokeWidth={isHighlighted ? 3 : 2}
                            strokeOpacity={isBlocked ? 0.3 : isHighlighted ? 1 : isRunning ? 0.9 : 0.5}
                            strokeLinecap="round"
                            strokeDasharray={isBlocked ? '4 4' : undefined}
                            markerEnd={isBlocked ? undefined : `url(#${markerId})`}
                            className={isRunning && !isBlocked ? 'animate-pulse' : 'transition-all duration-200'}
                          />
                          {isRunning && !isBlocked && (
                            <>
                              <path d={getConnPath(from.x, from.y, to.x, to.y)} fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.5} strokeDasharray="10 5" className="ne-conn-flowing" />
                              <circle r={3} fill={color}>
                                <animateMotion dur="1.2s" repeatCount="indefinite" path={getConnPath(from.x, from.y, to.x, to.y)} />
                              </circle>
                            </>
                          )}
                          {(conn.type !== 'any' && (isHighlighted || viewport.zoom > 0.6)) && (
                            <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 6} textAnchor="middle" fill={isBlocked ? '#666' : color} fontSize={10} fillOpacity={isBlocked ? 0.4 : 0.7} className="pointer-events-none">
                              {isBlocked ? 'blocked' : conn.type}
                            </text>
                          )}
                          <g
                            className="cursor-pointer"
                            style={{ pointerEvents: 'stroke' }}
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
                            <circle cx={(from.x + to.x) / 2} cy={(from.y + to.y) / 2} r={6} fill={isBlocked ? '#ef4444' : 'transparent'} stroke={isBlocked ? '#ef4444' : 'transparent'} strokeWidth={1} opacity={isHighlighted || isBlocked ? 1 : 0} className="transition-opacity" />
                            {isBlocked && (
                              <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 + 3.5} textAnchor="middle" fill="white" fontSize={8} fontWeight="bold">✕</text>
                            )}
                          </g>
                          <path d={getConnPath(from.x, from.y, to.x, to.y)} fill="none" stroke="transparent" strokeWidth={16} style={{ pointerEvents: 'stroke' }} onClick={() => { setWf(prev => ({ ...prev, connections: prev.connections.filter(c => c.id !== conn.id) })); }} className="cursor-pointer" />
                        </>
                      );
                    })()}
                  </g>
                );
              })}

              {/* 临时连线 */}
              {draggingConn && (
                <path d={getConnPath(draggingConn.fromX, draggingConn.fromY, draggingConn.toX, draggingConn.toY)} fill="none" stroke={PORT_COLORS[draggingConn.portType]} strokeWidth={2} strokeDasharray="6 4" strokeOpacity={0.7} />
              )}

              {/* 框选矩形 */}
              {boxSelect && (() => {
                const minX = Math.min(boxSelect.startX, boxSelect.endX);
                const minY = Math.min(boxSelect.startY, boxSelect.endY);
                const w = Math.abs(boxSelect.endX - boxSelect.startX);
                const h = Math.abs(boxSelect.endY - boxSelect.startY);
                if (w < 5 && h < 5) return null;
                return (
                  <rect x={minX} y={minY} width={w} height={h} fill="rgba(212, 175, 55, 0.08)" stroke="rgba(212, 175, 55, 0.4)" strokeWidth={1} strokeDasharray="4 2" rx={2} />
                );
              })()}
            </g>
          </svg>

          {/* HTML节点层 (z-index:2, 绝对定位div元素, 与原型对齐) */}
          <div
            className="absolute inset-0"
            style={{
              zIndex: 2,
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
              transformOrigin: '0 0',
            }}
          >
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
                    setSelectedNodeIds(prev => {
                      const next = new Set(prev);
                      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
                      return next;
                    });
                  } else {
                    setSelectedNodeIds(new Set([node.id]));
                  }
                  setSidebarTab('props');
                }}
                onHover={(id: string | null) => { setHighlightNodeId(id); setHoveredNodeId(id); }}
                onDragStart={(e) => {
                  const canvasRect = canvasContainerRef.current?.getBoundingClientRect();
                  if (!canvasRect) return;
                  const vp = viewportRef.current;
                  const mx = (e.clientX - canvasRect.left - vp.x) / vp.zoom;
                  const my = (e.clientY - canvasRect.top - vp.y) / vp.zoom;
                  draggingNodeRef.current = node.id;
                  dragOffsetRef.current = { x: mx - node.x, y: my - node.y };
                  isDraggingRef.current = true;
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
                upstreamImageUrl={upstreamImageUrls.get(node.id)}
                llmModels={chatModels}
                imageModels={imageModels}
                canvasImages={canvasImages}
                onResizeNode={resizeNodeForImageUrl}
                onUpdateNodeSize={updateNodeSize}
                collapsedNodes={collapsedNodes}
                onToggleCollapse={toggleNodeCollapse}
                onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
              />
            ))}
          </div>
        </div>

        {/* 端口类型图例 */}
        <div className="absolute bottom-3 left-3 bg-card/90 border border-border rounded px-3 py-2 flex items-center gap-3 text-xs">
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
              className="absolute bottom-3 right-3 w-[160px] h-[100px] bg-card/90 border border-border rounded overflow-hidden cursor-pointer"
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
                className="absolute border border-primary/60 bg-primary/10 rounded-sm pointer-events-none"
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
          <div className="absolute bottom-12 left-3 bg-card/95 border border-border rounded px-3 py-2 flex items-center gap-3 text-sm">
            {execStatus === 'running' && <Loader2 size={14} className="animate-spin text-primary" />}
            {execStatus === 'completed' && <Check size={14} className="text-green-400" />}
            {execStatus === 'failed' && <AlertCircle size={14} className="text-red-400" />}
            <span className={execStatus === 'running' ? 'text-primary' : execStatus === 'completed' ? 'text-green-400' : 'text-red-400'}>
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
        {(showExecLog || execLogs.length > 0) && (
          <div className="absolute bottom-12 right-3 w-[380px] max-h-[280px] bg-card/95 border border-border rounded-lg overflow-hidden flex flex-col shadow-lg">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
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
                  <div key={i} className={`flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 group ${log.status === 'error' ? 'bg-red-500/5' : ''}`}>
                    <span className="flex-shrink-0 text-[10px]">{nodeIcon}</span>
                    {log.status === 'success' ? <Check size={8} className="text-green-400 flex-shrink-0" /> : log.status === 'running' ? <Loader2 size={8} className="text-yellow-400 flex-shrink-0 animate-spin" /> : <AlertCircle size={8} className="text-red-400 flex-shrink-0" />}
                    <span className="text-foreground/80 flex-shrink-0 font-medium">{log.label}</span>
                    <span className={`flex-1 truncate ${log.status === 'success' ? 'text-green-400/60' : log.status === 'running' ? 'text-yellow-400/60' : 'text-red-400/60'}`}>{log.message}</span>
                    {log.duration != null && <span className="text-muted-foreground/60 flex-shrink-0 tabular-nums">{log.duration >= 1000 ? `${(log.duration / 1000).toFixed(1)}s` : `${log.duration}ms`}</span>}
                    <span className="text-muted-foreground/40 flex-shrink-0">{new Date(log.time).toLocaleTimeString()}</span>
                    {/* B2: 失败节点一键重试 */}
                    {log.status === 'error' && (
                      <button onClick={(e) => { e.stopPropagation(); handleRetryNode(log.nodeId); }} className="opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-all cursor-pointer flex-shrink-0" title="重试此节点">
                        <RefreshCw size={10} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>{/* 主画布 end */}

      {/* ═══ 右侧属性面板 - 与原型对齐: w-72, 始终可见 ═══ */}
      <aside className="w-72 shrink-0 bg-card border-l border-border/20 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 h-11 border-b border-border/10">
          <span className="text-[11px] uppercase tracking-[0.12em] font-bold text-muted-foreground">节点属性</span>
          <button className="text-muted-foreground hover:text-foreground cursor-pointer"><Maximize2 size={12} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {selectedNode ? (
            <PropertyPanel
              node={selectedNode}
              models={models}
              modelsLoading={modelsLoading}
              onUpdate={handleNodeUpdate}
              onDelete={handleDeleteNode}
              onImageUpload={handleImageUpload}
              canvasImages={allCanvasImages}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <MousePointer2 size={24} className="opacity-40" />
              <p className="text-xs">选中节点查看属性</p>
            </div>
          )}
        </div>
      </aside>
      </div>{/* 中间区域 end */}
      </div>{/* 主体水平行 end */}

      {/* ═══ 底部面板: 内容条 + 执行日志 - 与原型对齐: 全宽底部 ═══ */}
      <div className="shrink-0 border-t border-border/20 bg-card">
        {/* 内容条 */}
        {showContentStrip && (
        <div className="border-b border-border/10">
          <div className="flex items-center justify-between px-4 h-8">
            <div className="flex items-center gap-2">
              <FolderOpen size={12} className="text-primary" />
              <span className="text-[11px] uppercase tracking-[0.12em] font-bold text-muted-foreground">内容</span>
              <span className="text-[10px] text-muted-foreground/60">{canvasImages?.length || 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <button className="text-muted-foreground hover:text-foreground cursor-pointer p-0.5"><Download size={10} /></button>
              <button onClick={() => setShowContentStrip(false)} className="text-muted-foreground hover:text-foreground cursor-pointer p-0.5"><ChevronDown size={10} /></button>
            </div>
          </div>
          <div className="flex gap-2 px-4 pb-2 overflow-x-auto">
            {(canvasImages || []).map((img, i) => (
              <div key={i} className="shrink-0 w-14 h-14 rounded border border-border/20 overflow-hidden bg-muted/30 relative group cursor-pointer" title={img.description || img.name || `图片 ${i+1}`}>
                <NextImage unoptimized width={1} height={1} src={img.url} alt="" className="w-full h-full object-cover" />
                <span className="absolute bottom-0 left-0 right-0 text-[7px] text-center text-muted-foreground bg-card/80 py-px">
                  {(img.url?.split('.').pop() || 'PNG').toUpperCase()}
                </span>
              </div>
            ))}
            <button className="shrink-0 w-14 h-14 rounded border border-dashed border-border/30 flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors cursor-pointer">
              <Plus size={14} />
            </button>
          </div>
        </div>
        )}

        {/* 执行日志 */}
        {showExecLog && (
        <div>
          <div className="flex items-center justify-between px-4 h-8">
            <div className="flex items-center gap-2">
              <ScrollText size={12} className="text-primary" />
              <span className="text-[11px] uppercase tracking-[0.12em] font-bold text-muted-foreground">执行日志</span>
              <span className="text-[10px] text-muted-foreground/60">{execLogs.length}条记录</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setExecLogs([])} className="text-muted-foreground hover:text-foreground cursor-pointer p-0.5"><Trash2 size={10} /></button>
              <button onClick={() => setShowExecLog(false)} className="text-muted-foreground hover:text-foreground cursor-pointer p-0.5"><ChevronDown size={10} /></button>
            </div>
          </div>
          <div className="max-h-[120px] overflow-y-auto text-[10px] px-4 pb-2">
            {execLogs.length === 0 ? (
              <div className="text-muted-foreground/50 py-2 text-center">暂无执行记录</div>
            ) : (
              execLogs.map((log, i) => (
                <div key={i} className={`flex items-center gap-2 py-1 group ${log.status === 'error' ? 'text-red-400/80' : ''}`}>
                  {log.status === 'success' ? <Check size={8} className="text-green-400 shrink-0" /> : log.status === 'running' ? <Loader2 size={8} className="text-yellow-400 shrink-0 animate-spin" /> : <AlertCircle size={8} className="text-red-400 shrink-0" />}
                  <span className="text-foreground/80 shrink-0 font-medium">{log.label}</span>
                  <span className={`flex-1 truncate ${log.status === 'success' ? 'text-green-400/60' : log.status === 'running' ? 'text-yellow-400/60' : 'text-red-400/60'}`}>{log.message}</span>
                  {log.duration != null && <span className="text-muted-foreground/40 shrink-0 tabular-nums">{log.duration >= 1000 ? `${(log.duration / 1000).toFixed(1)}s` : `${log.duration}ms`}</span>}
                  {/* B2: 失败节点一键重试 */}
                  {log.status === 'error' && (
                    <button onClick={(e) => { e.stopPropagation(); handleRetryNode(log.nodeId); }} className="opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-all cursor-pointer shrink-0" title="重试此节点">
                      <RefreshCw size={10} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        )}
      </div>
      {/* 图片预览弹窗 */}
      {imagePreviewUrl && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={() => setImagePreviewUrl(null)}>
          <div className="relative max-w-[80vw] max-h-[80vh]">
            <NextImage unoptimized width={1} height={1} src={imagePreviewUrl} alt="预览" className="max-w-full max-h-[80vh] rounded shadow-2xl" />
            <button onClick={() => setImagePreviewUrl(null)} className="absolute -top-2 -right-2 p-1 bg-muted rounded-full text-muted-foreground hover:text-foreground cursor-pointer">
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
            <NextImage unoptimized width={1} height={1} src={compareImages.before} alt="原图" className="absolute inset-0 w-full h-full object-contain" />
            {/* After 图片 (顶层, clip 裁切) */}
            <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${comparePosition}%)` }}>
              <NextImage unoptimized width={1} height={1} src={compareImages.after} alt="结果" className="w-full h-full object-contain" />
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
            <button onClick={() => setCompareImages(null)} className="absolute -top-2 -right-2 p-1 bg-muted rounded-full text-muted-foreground hover:text-foreground cursor-pointer z-10">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* P2: JSON编辑器弹窗 */}
      {jsonEditorOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={() => setJsonEditorOpen(false)}>
          <div className="w-[640px] max-h-[80vh] bg-card border border-border rounded-lg flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <span className="text-sm font-semibold text-primary">工作流 JSON 编辑器</span>
              <button onClick={() => setJsonEditorOpen(false)} className="text-muted-foreground hover:text-foreground cursor-pointer"><X size={14} /></button>
            </div>
            <textarea
              value={jsonEditContent}
              onChange={e => setJsonEditContent(e.target.value)}
              className="flex-1 min-h-[400px] bg-muted text-green-400/80 font-mono text-[10px] p-3 focus:outline-none resize-none"
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
                className="px-3 py-1 text-[10px] rounded bg-primary/20 text-primary hover:bg-primary/30 cursor-pointer"
              >
                应用更改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 右键菜单 — 与原型对齐 ═══ */}
      {contextMenu && (
        <div className="fixed inset-0 z-[199]" onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }}>
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={e => e.stopPropagation()}
          >
            {contextMenu.type === 'canvas' ? (
              <>
                <div className="context-menu-item" onClick={() => handleContextAction('add-node')}>
                  <Plus size={16} className="text-muted-foreground" />
                  添加节点
                </div>
                <div className={`context-menu-item ${!clipboard ? 'opacity-40 pointer-events-none' : ''}`} onClick={() => handleContextAction('paste')}>
                  <Clipboard size={16} className="text-muted-foreground" />
                  粘贴
                </div>
                <div className="context-menu-divider" />
                <div className="context-menu-item" onClick={() => handleContextAction('select-all')}>
                  <BoxSelect size={16} className="text-muted-foreground" />
                  全选
                </div>
              </>
            ) : (
              <>
                <div className="context-menu-item" onClick={() => handleContextAction('copy')}>
                  <Copy size={16} className="text-muted-foreground" />
                  复制
                </div>
                <div className="context-menu-item" onClick={() => handleContextAction('duplicate')}>
                  <CopyPlus size={16} className="text-muted-foreground" />
                  副本
                </div>
                <div className="context-menu-divider" />
                <div className="context-menu-item" onClick={() => handleContextAction('disconnect')}>
                  <Unlink size={16} className="text-muted-foreground" />
                  断开连线
                </div>
                <div className="context-menu-divider" />
                <div className="context-menu-item danger" onClick={() => handleContextAction('delete')}>
                  <Trash2 size={16} />
                  删除节点
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
    </>
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
  imageModels?: ModelOption[];
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
  onUpdateNodeSize?: (nodeId: string, width: number, height: number) => void;
  collapsedNodes?: Set<string>;
  onToggleCollapse?: (nodeId: string) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
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

const NodeCard = React.memo(function NodeCard({ node, isSelected, isHovered, execResult, isRunning, theme, canvasImages, llmModels, imageModels, onNodeFieldChange, onLlmOptimize, onCascadeRun, onExtractToSource, onGridSplit, onCompare, onTriggerImageUpload, upstreamImageUrl, onSelect, onHover, onDragStart, onPortMouseDown, onPortMouseUp, onDeselect, onPreviewImage, onResizeNode, onUpdateNodeSize, collapsedNodes, onToggleCollapse, onContextMenu }: NodeCardProps) {
  const T = theme;
  const cat = getNodeCategory(node.type);
  const color = NODE_TYPE_COLORS[cat];
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
  const isCondition = node.type.startsWith('condition-');
  const isInputText = node.type === 'input-text';
  const isInputImage = node.type === 'input-image';
  const isOutputImage = node.type === 'output-image';
  const isOutputImageGroup = node.type === 'output-image-group';

  // 图片URL: 优先执行结果, 其次节点配置(input-image节点)
  const hasImageOutput = (execResult?.output?.imageUrl || node.config?.imageUrl) as string | undefined;
  // 画布模式专用节点标记
  const isCanvasFeature = ['ai-font-design', 'ai-refine-engine', 'ai-brand-ecommerce', 'ai-segment', 'ai-multi-angle', 'ai-3d-model'].includes(node.type);
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
  const filteredTemplates = templateSearch ? searchTemplates(templateSearch) : getPromptTemplates();

  // P0: 解析文本中的 [img:id] 引用，渲染为缩略图
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
    <div
      ref={nodeRef}
      data-node-id={node.id}
      className={`node-card ${isSelected ? 'selected' : ''} ${isCollapsed ? 'collapsed' : ''} ${isInputText ? 'prompt-node' : isInputImage || isOutputImage ? 'image-node' : 'generator-node'}`}
      style={{
        left: node.x,
        top: node.y,
        height: isCollapsed ? 45 : 'auto',
        zIndex: isSelected ? 10 : isHovered ? 5 : 1,
      }}
      tabIndex={0}
      onMouseDown={(e) => { e.stopPropagation(); onSelect(e); onDragStart(e); }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onContextMenu={onContextMenu}
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
                      {presetList.length > 0 && <div className="border-t border-border" />}
                      {presetList.map(p => (
                        <div key={p.id} className="flex items-center gap-0.5 px-1 py-0.5 hover:bg-muted group">
                          <button className="flex-1 text-left text-[10px] truncate cursor-pointer" onClick={(e) => { e.stopPropagation(); onNodeFieldChange?.(node.id, 'textContent', p.text); setPresetOpen(false); }}>{p.name}</button>
                          <button className="text-[8px] text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 shrink-0 cursor-pointer" onClick={(e) => { e.stopPropagation(); deletePreset(p.id); }} title="删除预设">×</button>
                        </div>
                      ))}
                      {presetList.length === 0 && !presetSaving && (<div className="px-2 py-1 text-[9px] text-muted-foreground">暂无预设</div>)}
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
                    <div
                      className="port-dot output-port"
                      data-port-id={`${node.id}-out-${port.id}`}
                      style={{ borderColor: portColor, color: portColor }}
                      onMouseDown={(e) => { e.stopPropagation(); onPortMouseDown(e, node.id, port); }}
                      title={port.label}
                    />
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
                    <div className="port-dot output-port"
                      data-port-id={`${node.id}-out-${port.id}`}
                      style={{ borderColor: portColor, color: portColor }}
                      onMouseDown={(e) => { e.stopPropagation(); onPortMouseDown(e, node.id, port); }}
                    />
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
                    <div
                      className="port-dot input-port"
                      data-port-id={`${node.id}-in-${port.id}`}
                      style={{ borderColor: portColor, color: portColor, flexShrink: 0 }}
                      onMouseUp={(e) => { e.stopPropagation(); onPortMouseUp(node.id, port); }}
                      title={port.label}
                    />
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
                    <div
                      className="port-dot output-port"
                      data-port-id={`${node.id}-out-${port.id}`}
                      style={{ borderColor: portColor, color: portColor }}
                      onMouseDown={(e) => { e.stopPropagation(); onPortMouseDown(e, node.id, port); }}
                      title={port.label}
                    />
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
                    <div
                      className="port-dot input-port"
                      data-port-id={`${node.id}-in-${imageInputPort.id}`}
                      style={{ borderColor: PORT_COLORS[imageInputPort.type] || T.connColor, color: PORT_COLORS[imageInputPort.type] || T.connColor }}
                      onMouseUp={(e) => { e.stopPropagation(); onPortMouseUp(node.id, imageInputPort); }}
                      title={imageInputPort.label}
                    />
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
          {node.type === 'ai-font-design' ? '字' : node.type === 'ai-refine-engine' ? '精' : node.type === 'ai-brand-ecommerce' ? '品' : node.type === 'ai-segment' ? '层' : node.type === 'ai-multi-angle' ? '角' : '3D'}
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

// ==================== 属性面板 ====================

interface PropertyPanelProps {
  node: WorkflowNode | null;
  models: ModelOption[];
  modelsLoading: boolean;
  onUpdate: (nodeId: string, updates: Partial<WorkflowNode>) => void;
  onDelete: (nodeId: string) => void;
  onImageUpload: (nodeId: string, file: File) => void;
  /** P0: 画布图片列表，用于@图片引用 */
  canvasImages?: CanvasImageRef[];
}

function PropertyPanel({ node, models, modelsLoading, onUpdate, onDelete, onImageUpload, canvasImages }: PropertyPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localTextValues, setLocalTextValues] = useState<Record<string, string>>({});
  const [focusedField, setFocusedField] = useState<string | null>(null);
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
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
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
              className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-y"
            />
            {/* P0: @图片引用弹窗 */}
            {isPromptField && mentionPopup.visible && mentionPopup.nodeId === node.id && mentionPopup.fieldKey === field.key && (
              <div
                className="absolute z-50 bg-card border border-primary/30 rounded shadow-lg max-h-40 overflow-y-auto"
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
                      className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-primary/10 hover:text-primary flex items-center gap-2 cursor-pointer"
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
                      <span className="w-6 h-6 rounded bg-card flex-shrink-0 overflow-hidden">
                        {img.url && <NextImage unoptimized width={1} height={1} src={img.url} alt="" className="w-full h-full object-cover" />}
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
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
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
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50"
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
              className="flex-1 h-1 accent-primary"
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
            className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${boolVal ? 'bg-primary' : 'bg-muted'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${boolVal ? 'translate-x-4' : ''}`} />
          </button>
        );
      }

      case 'model-select': {
        const modelFilterType = field.modelFilter || 'image'; // 默认只显示图像模型
        // 支持复合键 providerId::modelId 和纯 modelId
        const currentModelId = String(externalValue || '');
        const currentCompositeValue = (() => {
          if (!currentModelId) return '';
          // 如果config中有providerId，用复合键匹配
          const cfgProviderId = node.config?.providerId as string | undefined;
          if (cfgProviderId) return `${cfgProviderId}::${currentModelId}`;
          // 否则只用modelId匹配
          const match = models.find(m => m.id === currentModelId && m.type === modelFilterType);
          return match && match.providerId ? `${match.providerId}::${match.id}` : currentModelId;
        })();
        return (
          <select
            value={currentCompositeValue}
            onChange={e => {
              const selectedValue = e.target.value;
              // 解析复合键: providerId::modelId
              const sepIdx = selectedValue.indexOf('::');
              const selectedModelId = sepIdx >= 0 ? selectedValue.slice(sepIdx + 2) : selectedValue;
              const selectedProviderId = sepIdx >= 0 ? selectedValue.slice(0, sepIdx) : '';
              const configUpdate: Record<string, string> = { [field.key]: selectedModelId };
              // 保存providerId到节点config
              if (selectedProviderId) {
                configUpdate.providerId = selectedProviderId;
              }
              // 模型变更时，动态更新 quality 和 aspectRatio 为新模型的默认值
              if (selectedModelId) {
                const supportedQualities = MODEL_QUALITIES[selectedModelId as keyof typeof MODEL_QUALITIES] || [];
                // 尝试找到匹配的模型配置
                const modelKey = Object.keys(MODEL_QUALITIES).find(k => selectedModelId.includes(k));
                const qualities = modelKey ? MODEL_QUALITIES[modelKey as keyof typeof MODEL_QUALITIES] : supportedQualities;
                if (qualities.length > 0) {
                  configUpdate.quality = qualities[0];
                }
                const supportedRatios = MODEL_ASPECT_RATIOS[selectedModelId as keyof typeof MODEL_ASPECT_RATIOS] || [];
                const ratioKey = Object.keys(MODEL_ASPECT_RATIOS).find(k => selectedModelId.includes(k));
                const ratios = ratioKey ? MODEL_ASPECT_RATIOS[ratioKey as keyof typeof MODEL_ASPECT_RATIOS] : supportedRatios;
                if (ratios.length > 0) {
                  configUpdate.aspectRatio = ratios[0];
                }
              }
              onUpdate(node.id, { config: configUpdate });
            }}
            disabled={modelsLoading}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 disabled:opacity-50"
          >
            <option value="">{modelsLoading ? '加载中...' : '选择模型'}</option>
            {models.filter(m => m.type === modelFilterType).map(m => {
              const compositeValue = m.providerId ? `${m.providerId}::${m.id}` : m.id;
              return (
                <option key={compositeValue} value={compositeValue}>{m.apiDisplayName || m.name || getModelDisplayName(m.id)} ({m.provider})</option>
              );
            })}
          </select>
        );
      }

      case 'image-upload':
        return (
          <div className="space-y-2">
            {node.config?.imageUrl ? (
              <div className="relative group">
                <NextImage unoptimized width={1} height={1} src={String(node.config.imageUrl)} alt="预览" className="w-full h-24 object-cover rounded border border-border" />
                <button onClick={() => onUpdate(node.id, { config: { [field.key]: '' } })} className="absolute top-1 right-1 p-0.5 bg-black/70 rounded text-muted-foreground hover:text-red-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                  <X size={10} />
                </button>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 h-16 border-2 border-dashed border-border rounded flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors text-muted-foreground hover:text-muted-foreground"
                >
                  <Upload size={14} />
                  <span className="text-[10px] mt-0.5">上传</span>
                </div>
                {canvasImages && canvasImages.length > 0 && (
                  <div className="relative group/canvas">
                    <div
                      className="flex-1 h-16 border-2 border-dashed border-border rounded flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors text-muted-foreground hover:text-muted-foreground"
                      onClick={(e) => {
                        const dropdown = (e.currentTarget.nextElementSibling as HTMLElement);
                        if (dropdown) dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
                      }}
                    >
                      <ImageIcon size={14} />
                      <span className="text-[10px] mt-0.5">画布</span>
                    </div>
                    <div style={{ display: 'none' }} className="absolute left-0 top-full mt-1 w-full max-h-40 overflow-y-auto bg-muted border border-border rounded shadow-lg z-50">
                      {canvasImages.map((img, idx) => (
                        <button
                          key={img.id}
                          className="w-full px-3 py-2 text-left text-xs text-foreground hover:bg-primary/10 hover:text-primary cursor-pointer truncate transition-colors"
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
              className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
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
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        );
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* 节点类型标识 — 与原型对齐: 彩色圆点 + 类型名 + 描述 */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-sm font-semibold text-foreground">{NODE_TYPE_LABELS[node.type]}</span>
          {isCanvasFeature && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium ml-auto">画布专用</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{NODE_CATEGORY_LABELS[cat]}</span>
      </div>

      {/* 属性字段 — 与原型对齐: 逐字段垂直排列, px-4 py-2 间距 */}
      {fields.map(field => (
        <div key={field.key} className="px-4 py-2">
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">{field.label}</label>
          {field.key === 'aspectRatio' ? (
            /* 比例选择器 — 与原型对齐: 4列grid + ratio-btn样式 */
            <div className="grid grid-cols-4 gap-2">
              {(field.options || [{ value: '1:1', label: '1:1' }, { value: '4:3', label: '4:3' }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }]).map(opt => {
                const isActive = String(node.config?.aspectRatio ?? field.defaultValue ?? '1:1') === opt.value;
                const ratioMap: Record<string, { w: number; h: number }> = { '1:1': { w: 20, h: 20 }, '4:3': { w: 24, h: 18 }, '16:9': { w: 28, h: 16 }, '9:16': { w: 14, h: 24 }, '3:4': { w: 18, h: 24 }, '3:2': { w: 24, h: 16 }, '2:3': { w: 16, h: 24 } };
                const dim = ratioMap[opt.value] || { w: 20, h: 20 };
                return (
                  <button key={opt.value} className={`ratio-btn ${isActive ? 'active' : ''}`} onClick={() => onUpdate(node.id, { config: { aspectRatio: opt.value } })}>
                    <div className="ratio-preview" style={{ width: dim.w, height: dim.h }} />
                    <span className="text-[10px] text-muted-foreground">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          ) : field.key === 'quality' ? (
            /* 质量选择器 — 与原型对齐: 3按钮横排 */
            <div className="flex gap-2">
              {(field.options || [{ value: 'standard', label: '标准' }, { value: 'hd', label: '高清' }, { value: 'ultra', label: '极致' }]).map(opt => {
                const isActive = String(node.config?.quality ?? field.defaultValue ?? 'hd') === opt.value;
                return (
                  <button key={opt.value} className={`quality-btn flex-1 ${isActive ? 'active' : ''}`} onClick={() => onUpdate(node.id, { config: { quality: opt.value } })}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          ) : field.key === 'seed' ? (
            /* 种子输入 — 与原型对齐: 输入框 + 随机按钮 */
            <div className="flex gap-2">
              <input
                type="text"
                value={String(node.config?.seed ?? field.defaultValue ?? '')}
                onChange={e => onUpdate(node.id, { config: { seed: e.target.value } })}
                placeholder={field.placeholder}
                className="flex-1 bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                onClick={() => onUpdate(node.id, { config: { seed: Math.floor(Math.random() * 99999999).toString() } })}
                className="px-2 py-1.5 rounded-md bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                title="随机种子"
              >
                <Shuffle size={16} />
              </button>
            </div>
          ) : field.key === 'cfg' || field.key === 'guidanceScale' ? (
            /* CFG/引导系数 — 与原型对齐: 滑块 + 数值显示 */
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={Number(field.min) || 1}
                max={Number(field.max) || 20}
                step={Number(field.step) || 0.5}
                value={Number(node.config?.[field.key] ?? field.defaultValue ?? 7)}
                onChange={e => onUpdate(node.id, { config: { [field.key]: Number(e.target.value) } })}
                className="flex-1 accent-primary"
              />
              <span className="text-xs font-mono text-foreground w-8 text-right">{Number(node.config?.[field.key] ?? field.defaultValue ?? 7)}</span>
            </div>
          ) : (
            renderField(field)
          )}
        </div>
      ))}

      {/* 端口信息 */}
      <div className="px-4 py-2 border-t border-border/10 mt-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">端口</div>
        <div className="space-y-1">
          {node.ports.filter(p => p.direction === 'in').map(p => (
            <div key={p.id} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PORT_COLORS[p.type] }} />
              <span className="text-muted-foreground">→</span>
              <span className="text-muted-foreground">{p.label}</span>
              <span className="text-muted-foreground/50 ml-auto">{p.type}</span>
            </div>
          ))}
          {node.ports.filter(p => p.direction === 'out').map(p => (
            <div key={p.id} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PORT_COLORS[p.type] }} />
              <span className="text-muted-foreground">{p.label}</span>
              <span className="text-muted-foreground/50 ml-auto">{p.type} →</span>
            </div>
          ))}
        </div>
      </div>

      {/* 删除按钮 — 与原型对齐 */}
      <div className="px-4 py-3">
        <button
          onClick={() => onDelete(node.id)}
          className="w-full py-2 rounded-md text-sm text-red-400 hover:bg-red-900/20 transition-colors cursor-pointer flex items-center justify-center gap-1.5 border border-dashed border-red-400/20"
        >
          <Trash2 size={12} /> 删除节点
        </button>
      </div>
    </div>
  );
}
