'use client';

import NextImage from 'next/image';
import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo, useReducer } from 'react';
import { createPortal } from 'react-dom';
import {
  WorkflowNode, WorkflowConnection, Workflow as WorkflowData, NodeType, NodeCategory,
  NODE_TYPE_COLORS, NODE_TYPE_LABELS, NODE_TYPE_ICONS, NODE_CATEGORY_LABELS,
  PORT_COLORS, NodePort, PortType, PropertyField,
  createWorkflowNode, createConnection, createEmptyWorkflow,
  getNodePropertyFields, getNodeCategory, NODE_TEMPLATES,
  canConnectPorts, autoLayoutWorkflow, parseComfyUIWorkflow, isImageGeneratingNode, getOutputNodeSize,
  mergeWorkflowNodeUpdate, resolveWorkflowOutputAssetReference, type WorkspaceAssetReference,
} from '@/lib/workflow-engine';
import {
  applyWorkflowCommand,
  createWorkflowClipboardSnapshot,
  createWorkflowEditorState,
  mergeExternalWorkflowWithPositions,
  reduceWorkflowEditorState,
  type WorkflowCommandResult,
  type WorkflowClipboardSnapshot,
  type WorkflowInteractionCommand,
  type WorkflowNodePosition,
} from '@/lib/workflow-renderer/commands';
import { resolveWorkflowRendererMode, type WorkflowRendererMode } from '@/lib/workflow-renderer/mode';
import {
  projectLegacyRenderModel,
  projectReactFlowRenderModel,
} from '@/lib/workflow-renderer/view-model';
import { WorkflowLegacySurface, type WorkflowLegacyCardCallbacks } from '@/components/workflow/WorkflowLegacySurface';
import { WorkflowReactFlowSurface } from '@/components/workflow/WorkflowReactFlowSurface';
import { WorkflowShadowProbe } from '@/components/workflow/WorkflowShadowProbe';
import { getModelDisplayName } from '@/lib/model-name-map';
import { parseExactModelKey, resolvePersistedModelSelection } from '@/lib/model-defaults';
import { computePortPosition } from '@/lib/node-port-position';
import {
  createTaskModelCatalogIndex,
  taskModelKey,
  type TaskModelDescriptor,
} from '@/lib/task-core/model-capability-contract';
import type { TaskModelCatalogModel } from '@/hooks/use-task-model-catalog';
import { WorkspaceSourceTraceDetails } from '@/components/workspace-source-trace';
import { getPromptTemplates, addPromptTemplate, type PromptTemplate } from '@/lib/prompt-templates';
import {
  getVisibleWorkflowNodeIds,
  resolveWorkflowCullingBounds,
} from '@/lib/node-canvas-virtualization';
import {
  CANVAS_ASSET_DRAG_MIME,
  createPendingWorkflowInputReference,
  createWorkflowInputTransferGuard,
  isWorkspaceResultScopeCurrent,
  parseCanvasAssetDragPayload,
  prepareWorkflowCanvasInsertions,
  runGuardedWorkflowInputTransfer,
  serializeCanvasAssetDragPayload,
  shouldInvalidateWorkflowInputTransfer,
  type WorkflowCanvasInsertionItem,
} from '@/lib/asset-core/workspace-transfer';
import {
  buildWorkflowChatReturnIntentUrl,
  navigateToWorkflowChatAfterPersistence,
} from '@/lib/asset-core/workflow-chat-return';
import {
  NodeAnnotationWorkspace,
  type NodeAnnotationSource,
} from '@/features/annotations/node-annotation-workspace';
import {
  collectNodeAnnotationCandidates,
  type NodeAnnotationCandidate,
} from '@/features/annotations/node-annotation-candidates';
import type { EditIntentBundle } from '@/features/annotations/annotation-types';
import {
  Image as ImageIcon, Type, SlidersHorizontal, Wand2, Pencil, Maximize, Scissors,
  PenTool, Palette, Sun, GitBranch, GitMerge, Repeat, RefreshCw, Layers,
  Bot, MessageSquare, ImageDown, Save, Download, Play, Square,
  FileInput,
  ChevronRight, ChevronDown, ChevronLeft, Plus, Trash2, ZoomIn, ZoomOut, RotateCcw,
  Settings, Upload, X, Check, AlertCircle, Loader2, BoxSelect, Group,
  Search, ScanSearch,
  ArrowLeft, LayoutGrid, Sparkles, Rotate3d, Box, ShoppingBag,
  Copy, Clipboard, Film, Bookmark, BookmarkPlus, GitCompare, Grid3X3, ArrowLeftFromLine, ImagePlus, BookOpen, Blocks, FolderOpen, ScrollText, MousePointer2,
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

interface ModelOption { id: string; name: string; type: string; provider: string; providerId?: string; apiDisplayName?: string; }

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
  versionId?: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
  projectId?: string;
}

interface NodeAnnotationSession {
  source: NodeAnnotationSource;
  anchorNodeId: string;
  connectionNodeId: string;
  connectionPortId: string;
  editingNodeId?: string;
  existingBundle?: EditIntentBundle | null;
}

interface NodeAnnotationCandidatePicker {
  sourceNodeId: string;
  candidates: NodeAnnotationCandidate[];
  existingBundle?: EditIntentBundle | null;
}

function parseAnnotationBundle(value: unknown): EditIntentBundle | null {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as EditIntentBundle;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as EditIntentBundle;
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

interface WorkflowExecutionLog {
  time: number;
  nodeId: string;
  label: string;
  status: string;
  message: string;
  duration?: number;
  nodeType?: string;
}

function mergeExecutionLogs(
  current: WorkflowExecutionLog[],
  incoming: WorkflowExecutionLog[],
): WorkflowExecutionLog[] {
  const seen = new Set(
    current.map(log => `${log.nodeId}\u0000${log.status}\u0000${log.message}`),
  );
  return [
    ...current,
    ...incoming.filter(log => {
      const key = `${log.nodeId}\u0000${log.status}\u0000${log.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
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
  taskModelCatalog?: TaskModelDescriptor[];
  taskModelOptions?: TaskModelCatalogModel[];
  catalogStatus?: { loading: boolean; error: string | null };
  workflow?: WorkflowData | null;
  userId?: string;
  projectId?: string;
  onBack?: () => void;
  onWorkflowChange?: (wf: WorkflowData | null) => void;
  onWorkflowSaved?: (wf: WorkflowData) => Promise<void>;
  onWorkflowSaveRequest?: (wf: WorkflowData) => Promise<void>;
  onBeforeWorkflowChatNavigation?: () => Promise<void>;
  onOpenWorkflowHub?: () => void;
  /** P0: 画布图片列表，用于@图片引用 */
  canvasImages?: CanvasImageRef[];
  onCanvasImageAssetReferenceAdopted?: (
    imageId: string,
    reference: WorkspaceAssetReference,
  ) => void;
  /** 主题风格: gold(黑金) / monochrome(单色) */
  themeStyle?: 'gold' | 'monochrome';
  /** 生成图片后回调，将图片添加到项目 */
  onAddImages?: (items: WorkflowCanvasInsertionItem[], meta?: { modelName?: string; apiProvider?: string }) => void;
  preferredAnnotationModelId?: string;
  rendererMode?: WorkflowRendererMode;
}

interface WorkflowDragSynchronizationOptions {
  externalWorkflow?: WorkflowData | null;
  lastEmittedWorkflowRef: React.RefObject<WorkflowData | null>;
  hydrateWorkflow: (workflow: WorkflowData) => void;
  applyDeferredWorkflow: (workflow: WorkflowData, positions: WorkflowNodePosition[]) => void;
}

export function useWorkflowDragSynchronization({
  externalWorkflow,
  lastEmittedWorkflowRef,
  hydrateWorkflow,
  applyDeferredWorkflow,
}: WorkflowDragSynchronizationOptions) {
  const isDraggingRef = useRef(false);
  const pendingExternalWorkflowRef = useRef<WorkflowData | null>(null);
  const synchronizeExternalWorkflow = useCallback((workflow: WorkflowData) => {
    if (workflow === lastEmittedWorkflowRef.current) return;
    if (isDraggingRef.current) {
      pendingExternalWorkflowRef.current = workflow;
      return;
    }
    hydrateWorkflow(workflow);
  }, [hydrateWorkflow, lastEmittedWorkflowRef]);
  useEffect(() => {
    if (externalWorkflow) synchronizeExternalWorkflow(externalWorkflow);
  }, [externalWorkflow, synchronizeExternalWorkflow]);
  const beginWorkflowDrag = useCallback((_positions: WorkflowNodePosition[] = []) => {
    isDraggingRef.current = true;
  }, []);
  const finishWorkflowDrag = useCallback((positions: WorkflowNodePosition[]) => {
    isDraggingRef.current = false;
    const pendingExternalWorkflow = pendingExternalWorkflowRef.current;
    pendingExternalWorkflowRef.current = null;
    if (pendingExternalWorkflow) applyDeferredWorkflow(pendingExternalWorkflow, positions);
  }, [applyDeferredWorkflow]);
  return {
    isDraggingRef,
    beginWorkflowDrag,
    finishWorkflowDrag,
    synchronizeExternalWorkflow,
  };
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

export default function NodeEditor({ taskModelCatalog = [], taskModelOptions = [], catalogStatus = { loading: false, error: null }, workflow, userId, projectId, onBack, onWorkflowChange, onWorkflowSaved, onWorkflowSaveRequest, onBeforeWorkflowChatNavigation, canvasImages, onCanvasImageAssetReferenceAdopted, themeStyle = 'gold', onAddImages, preferredAnnotationModelId = '', rendererMode = 'legacy' }: NodeEditorProps) {
  const T = nodeThemes[themeStyle];
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
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

  const [workflowEditorState, dispatchWorkflowEditorTransition] = useReducer(reduceWorkflowEditorState,
    workflow || createEmptyWorkflow('新工作流'),
    createWorkflowEditorState,
  );
  const wf = workflowEditorState.workflow;
  const wfRef = useRef(wf);
  wfRef.current = wf;
  const editorTransactionCounterRef = useRef(0);
  const [nodePromptPresets, setNodePromptPresets] = useState<{ id: string; name: string; text: string }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('wujie-node-presets') || '[]') as { id: string; name: string; text: string }[];
    } catch {
      return [];
    }
  });
  const workflowRendererMode = resolveWorkflowRendererMode(rendererMode);
  const broadcastWorkflow = useCallback((updatedWf: WorkflowData) => {
    if (!bcRef.current) return;
    if (bcDebounceRef.current) clearTimeout(bcDebounceRef.current);
    bcDebounceRef.current = setTimeout(() => {
      bcIgnoreRef.current = true;
      bcRef.current?.postMessage({ type: 'workflow-update', wf: updatedWf, source: 'tab' });
    }, 500);
  }, []);
  const updateWorkflow = useCallback((updater: WorkflowData | ((prev: WorkflowData) => WorkflowData)) => {
    const current = wfRef.current;
    const next = typeof updater === 'function' ? updater(current) : updater;
    if (next === current) return;
    wfRef.current = next;
    dispatchWorkflowEditorTransition({
      kind: 'user.update',
      workflow: next,
      transactionId: `editor-change:${++editorTransactionCounterRef.current}`,
    });
  }, []);
  const updateWorkflowSystem = useCallback((updater: (prev: WorkflowData) => WorkflowData) => {
    const workflow = updater(wfRef.current);
    if (workflow === wfRef.current) return;
    wfRef.current = workflow;
    dispatchWorkflowEditorTransition({ kind: 'system.update', workflow });
  }, []);
  const dispatchWorkflowStateCommand = useCallback((command: WorkflowInteractionCommand): WorkflowCommandResult => {
    const result = applyWorkflowCommand(wfRef.current, command);
    wfRef.current = result.workflow;
    dispatchWorkflowEditorTransition({ kind: 'command', command });
    return result;
  }, []);
  const saveNodePromptPreset = useCallback((name: string, text: string) => {
    if (!name.trim() || !text.trim()) return;
    setNodePromptPresets(previous => {
      const next = [...previous, { id: `p-${Date.now()}`, name: name.trim(), text }];
      localStorage.setItem('wujie-node-presets', JSON.stringify(next));
      return next;
    });
  }, []);
  const deleteNodePromptPreset = useCallback((presetId: string) => {
    setNodePromptPresets(previous => {
      const next = previous.filter(preset => preset.id !== presetId);
      localStorage.setItem('wujie-node-presets', JSON.stringify(next));
      return next;
    });
  }, []);
  const lastBroadcastRevisionRef = useRef(workflowEditorState.broadcastRevision);
  useEffect(() => {
    if (lastBroadcastRevisionRef.current === workflowEditorState.broadcastRevision) return;
    lastBroadcastRevisionRef.current = workflowEditorState.broadcastRevision;
    broadcastWorkflow(wf);
  }, [broadcastWorkflow, wf, workflowEditorState.broadcastRevision]);
  const [workflowSyncRevision, setWorkflowSyncRevision] = useState(0);

  // BroadcastChannel 接收端
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('wujie-workflow-sync');
    bcRef.current = bc;
    bc.onmessage = (e: MessageEvent) => {
      if (bcIgnoreRef.current) { bcIgnoreRef.current = false; return; }
      const msg = e.data as { type: string; wf: WorkflowData; source: string };
      if (msg.type === 'workflow-update' && msg.wf) {
        dispatchWorkflowStateCommand({
          type: 'workflow.hydrate',
          workflow: msg.wf,
          transactionId: 'broadcast-workflow-hydrate',
        });
      }
    };
    return () => { bc.close(); bcRef.current = null; };
  }, [dispatchWorkflowStateCommand]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  // 兼容：获取单个选中节点ID
  const selectedNodeId = useMemo(() => selectedNodeIds.size > 0 ? [...selectedNodeIds][0] : null, [selectedNodeIds]);
  const lastEmittedRef = useRef<WorkflowData | null>(null);
  const hydrateExternalWorkflow = useCallback((externalWorkflow: WorkflowData) => {
    dispatchWorkflowStateCommand({
      type: 'workflow.hydrate',
      workflow: externalWorkflow,
      transactionId: 'external-workflow-hydrate',
    });
  }, [dispatchWorkflowStateCommand]);
  const applyDeferredExternalWorkflow = useCallback((
    externalWorkflow: WorkflowData,
    positions: WorkflowNodePosition[],
  ) => {
    updateWorkflowSystem(() => mergeExternalWorkflowWithPositions(externalWorkflow, positions));
  }, [updateWorkflowSystem]);
  const {
    isDraggingRef,
    beginWorkflowDrag,
    finishWorkflowDrag,
  } = useWorkflowDragSynchronization({
    externalWorkflow: workflow,
    lastEmittedWorkflowRef: lastEmittedRef,
    hydrateWorkflow: hydrateExternalWorkflow,
    applyDeferredWorkflow: applyDeferredExternalWorkflow,
  });
  // 拖动状态使用ref避免每次mousemove触发重渲染导致闪烁
  const draggingNodeRef = useRef<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const nodeDragInitialPositionsRef = useRef<Array<{ nodeId: string; position: { x: number; y: number } }>>([]);
  const nodeDragPositionRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const nodeDragRafRef = useRef<number | null>(null);
  const [draggingConn, setDraggingConn] = useState<DraggingConn | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 0.8 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, vx: 0, vy: 0 });
  const nodeViewportTransformRef = useRef<HTMLDivElement>(null);
  const svgViewportTransformRef = useRef<SVGGElement>(null);
  const nodePanPreviewRef = useRef(viewport);
  const nodePanRafRef = useRef<number | null>(null);
  const nodePanViewportSyncAtRef = useRef(0);
  const [nodePanViewport, setNodePanViewport] = useState(viewport);
  const nodeWheelDeltaRef = useRef(0);
  const nodeWheelRafRef = useRef<number | null>(null);
  const [nodeViewportSize, setNodeViewportSize] = useState({ width: 0, height: 0 });
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
  const workflowInputTransferGuardRef = useRef(createWorkflowInputTransferGuard());

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
  const [aiBuildOpen, setAiBuildOpen] = useState(false);

  // P1: 执行日志
  const [execLogs, setExecLogs] = useState<WorkflowExecutionLog[]>([]);

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
  const [clipboard, setClipboard] = useState<WorkflowClipboardSnapshot | null>(null);
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ type: 'canvas' | 'node'; x: number; y: number; nodeId?: string } | null>(null);
  const [nodeAnnotationSession, setNodeAnnotationSession] = useState<NodeAnnotationSession | null>(null);
  const [nodeAnnotationError, setNodeAnnotationError] = useState<string | null>(null);
  const [nodeAnnotationCandidates, setNodeAnnotationCandidates] = useState<NodeAnnotationCandidatePicker | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const applyMobileLayout = () => {
      if (!media.matches) return;
      setShowLeftPanel(false);
    };

    applyMobileLayout();
    media.addEventListener('change', applyMobileLayout);
    return () => media.removeEventListener('change', applyMobileLayout);
  }, []);

  // P2: 提示词库 - 使用统一的提示词模板系统
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>(() => getPromptTemplates());
  const [, setPromptSnippets] = useState<PromptSnippet[]>(() => {
    try {
      // 同时兼容旧的提示词库数据
      const oldSnippets: PromptSnippet[] = (() => { try { return JSON.parse(localStorage.getItem('wujie-prompt-snippets') || '[]'); } catch { return []; } })();
      // 合并：模板优先，旧数据补充
      const fromTemplates: PromptSnippet[] = promptTemplates.map(t => ({
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

  // P2: 撤销重做由命令事务直接驱动，避免 effect 和拖拽手工快照双写。
  const historyStack = workflowEditorState.history.entries;
  const historyIndex = workflowEditorState.history.index;
  const handleCascadeRunRef = useRef<(nodeId: string) => Promise<void>>(async () => {});
  const handleDeleteNodeRef = useRef<(nodeId: string) => void>(() => {});
  const getPortPositionLocalRef = useRef<(node: WorkflowNode, port: NodePort) => { x: number; y: number } | null>(() => null);

  // P2: 画布助手 (节点感知)
  const [, setAssistantMessages] = useState<{ role: 'user' | 'assistant'; content: string; suggestions?: { text: string; action: string }[] }[]>([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [, setAssistantLoading] = useState(false);

  // P2: JSON编辑器
  const [jsonEditorOpen, setJsonEditorOpen] = useState(false);
  const [jsonEditContent, setJsonEditContent] = useState('');

  // P2: 撤销/重做函数
  const handleUndo = useCallback(() => {
    dispatchWorkflowEditorTransition({ kind: 'history.undo' });
  }, []);

  const handleRedo = useCallback(() => {
    dispatchWorkflowEditorTransition({ kind: 'history.redo' });
  }, []);

  // P2: 保存提示词到库 - 同时保存到统一的提示词模板系统
  useCallback((text: string, tags: string[], category: string) => {
        const snippet: PromptSnippet = { id: `ps-${Date.now()}`, text, tags, category, createdAt: Date.now() };
        // 保存到统一的提示词模板系统（顶层 import，避免客户端 require）
        const template = addPromptTemplate({
          name: text.slice(0, 30) + (text.length > 30 ? '...' : ''),
          content: text,
          category,
          tags,
          createdBy: 'user',
          isGlobal: false,
        });
        setPromptTemplates(previous => [...previous, template]);
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
                void handleCascadeRunRef.current(node.id);
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
                const selOutPort = node.ports.find(p => p.direction === 'out');
                const newInPort = newNode.ports.find(p => p.direction === 'in');
                const autoConn = (selOutPort && newInPort && canConnectPorts(selOutPort.type, newInPort.type))
                  ? [createConnection(node.id, selOutPort.id, newNode.id, newInPort.id, selOutPort.type)]
                  : [];
                updateWorkflow(prev => ({
                  ...prev,
                  nodes: [...prev.nodes, newNode],
                  connections: [...prev.connections, ...autoConn],
                }));
                setSelectedNodeIds(new Set([newNode.id]));
                operationResult = `已添加新节点 [${NODE_TYPE_LABELS[newNodeType] || newNodeType}] 并自动连线，可在右侧属性面板编辑配置。`;
                break;
              }
              case 'delete': {
                const nodeLabel = node.label;
                handleDeleteNodeRef.current(node.id);
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
      }, [assistantInput, wf.nodes, wf.connections, selectedNodeId, updateWorkflow]);

  const svgRef = useRef<SVGSVGElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport; // 始终保持最新值，避免拖动时stale closure

  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;
    let viewportResizeFrame = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      cancelAnimationFrame(viewportResizeFrame);
      viewportResizeFrame = requestAnimationFrame(() => {
        setNodeViewportSize(previous => (
          previous.width === width && previous.height === height
            ? previous
            : { width, height }
        ));
      });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(viewportResizeFrame);
    };
  }, []);

  const applyNodeViewportPreview = useCallback((nextViewport: { x: number; y: number; zoom: number }) => {
    const htmlTransform = `translate(${nextViewport.x}px, ${nextViewport.y}px) scale(${nextViewport.zoom})`;
    if (nodeViewportTransformRef.current) nodeViewportTransformRef.current.style.transform = htmlTransform;
    if (svgViewportTransformRef.current) {
      svgViewportTransformRef.current.setAttribute('transform', `translate(${nextViewport.x}, ${nextViewport.y}) scale(${nextViewport.zoom})`);
    }
  }, []);

  const updateNodePanPreview = useCallback((nextViewport: { x: number; y: number; zoom: number }) => {
    nodePanPreviewRef.current = nextViewport;
    if (nodePanRafRef.current === null) {
      nodePanRafRef.current = requestAnimationFrame(() => {
        nodePanRafRef.current = null;
        applyNodeViewportPreview(nodePanPreviewRef.current);
      });
    }

    const now = performance.now();
    if (now - nodePanViewportSyncAtRef.current >= 80) {
      nodePanViewportSyncAtRef.current = now;
      setNodePanViewport(nextViewport);
    }
  }, [applyNodeViewportPreview]);

  const nodeRenderViewport = isPanning ? nodePanViewport : viewport;
  const legacyWorkflowRenderModel = useMemo(
    () => projectLegacyRenderModel(wf, nodeRenderViewport, selectedNodeIds),
    [wf, nodeRenderViewport, selectedNodeIds],
  );
  const reactFlowWorkflowRenderModel = useMemo(
    () => projectReactFlowRenderModel(wf, nodeRenderViewport, selectedNodeIds),
    [wf, nodeRenderViewport, selectedNodeIds],
  );
  const handleWorkflowRenderCommand = useCallback((command: WorkflowInteractionCommand): WorkflowCommandResult => {
    if (command.type === 'selection.set') {
      setSelectedNodeIds(new Set(command.nodeIds));
      if (command.nodeIds.length > 0) setSidebarTab('props');
    }
    return dispatchWorkflowStateCommand(command);
  }, [dispatchWorkflowStateCommand]);
  const nodeById = useMemo(() => new Map(wf.nodes.map(node => [node.id, node])), [wf.nodes]);
  const nodeCullingBounds = useMemo(() => resolveWorkflowCullingBounds(
    viewport,
    nodePanViewport,
    nodeViewportSize,
    isPanning,
  ), [viewport, nodePanViewport, nodeViewportSize, isPanning]);
  const pinnedNodeIds = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const visibleNodeIds = useMemo(() => getVisibleWorkflowNodeIds(
    wf.nodes,
    nodeCullingBounds,
    pinnedNodeIds,
    draggingNodeRef.current,
  ), [wf.nodes, nodeCullingBounds, pinnedNodeIds, isPanning]);

  useLayoutEffect(() => {
    if (isPanning) applyNodeViewportPreview(nodePanPreviewRef.current);
  }, [applyNodeViewportPreview, isPanning, nodePanViewport]);

  useEffect(() => () => {
    if (nodePanRafRef.current !== null) cancelAnimationFrame(nodePanRafRef.current);
    if (nodeWheelRafRef.current !== null) cancelAnimationFrame(nodeWheelRafRef.current);
  }, []);

  const modelCatalogIndex = useMemo(
    () => createTaskModelCatalogIndex(taskModelCatalog),
    [taskModelCatalog],
  );
  const models = useMemo<ModelOption[]>(() => taskModelOptions.map(model => ({
    id: model.id,
    name: model.name,
    type: model.type,
    provider: model.providerName || model.providerId,
    providerId: model.providerId,
    apiDisplayName: model.displayName || model.name,
  })), [taskModelOptions]);
  const modelsLoading = catalogStatus.loading || Boolean(catalogStatus.error);
  const chatModels = useMemo(() => models.filter(m => m.type === 'chat'), [models]);
  const imageModels = useMemo(() => models.filter(m => m.type === 'image'), [models]);
  const annotationModels = useMemo(() => imageModels
    .filter((model) => modelCatalogIndex.get(taskModelKey(model.providerId || '', model.id))?.supportsMask)
    .map((model) => ({
      id: model.providerId ? `${model.providerId}::${model.id}` : model.id,
      label: `${model.apiDisplayName || model.name || model.id}${model.provider ? ` · ${model.provider}` : ''}`,
    })), [imageModels, modelCatalogIndex]);

  // 工作流节点图片列表 (用于 @mention 引用和输入引用阻断)
  // 合并: 画布传入的图片 + 工作流内节点输出的图片
  const allCanvasImages = useMemo(() => {
    const nodeImages = wf.nodes
      .filter(n => n.type === 'input-image' || n.type === 'ai-generate' || n.type === 'output-image' || n.type === 'output-image-group')
      .map(n => {
        const cfg = n.config as Record<string, unknown>;
        const url = (cfg?.imageUrl as string) || (cfg?.outputUrl as string) || '';
        const name = (cfg?.label as string) || n.label || n.type;
        return {
          id: n.id,
          url,
          name,
          label: name,
          description: name,
          assetId: typeof cfg.assetId === 'string' ? cfg.assetId : undefined,
          assetVersionId: typeof cfg.assetVersionId === 'string' ? cfg.assetVersionId : undefined,
          placementId: typeof cfg.placementId === 'string' ? cfg.placementId : undefined,
          projectId: typeof cfg.projectId === 'string' ? cfg.projectId : undefined,
        };
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
        const upNode = nodeById.get(c.fromNodeId);
        const url = (upNode?.config?.imageUrl as string) || (execResults[c.fromNodeId]?.output?.imageUrl as string);
        if (url) m.set(c.toNodeId, url);
      }
    }
    return m;
  }, [wf.connections, nodeById, execResults]);

  // 框选状态
  const [boxSelect, setBoxSelect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const isBoxSelectingRef = useRef(false);

  const selectedNode = useMemo(() => wf.nodes.find(n => n.id === selectedNodeId) || null, [wf.nodes, selectedNodeId]);

  const getNodeAnnotationCandidates = useCallback((
    node: WorkflowNode,
    existingBundle?: EditIntentBundle | null,
  ): NodeAnnotationCandidate[] => {
    return collectNodeAnnotationCandidates({
      node,
      nodes: wf.nodes,
      connections: wf.connections,
      results: execResults,
      canvasImages: (canvasImages || []).map((image) => ({
        id: image.id,
        url: image.url,
        versionId: image.versionId,
      })),
      existingBundle,
    });
  }, [canvasImages, execResults, wf.connections, wf.nodes]);

  const openNodeAnnotation = useCallback((
    sourceNode: WorkflowNode,
    candidate: NodeAnnotationCandidate,
    existingBundle: EditIntentBundle | null = null,
  ) => {
    if (!projectId) {
      setNodeAnnotationError('请先保存项目，再使用批注修改');
      return;
    }
    const ownedImage = candidate.sourceImageId
      ? canvasImages?.find((image) =>
          image.id === candidate.sourceImageId
          && image.url === candidate.url,
        )
      : (() => {
          const matches = canvasImages?.filter(
            (image) => image.url === candidate.url,
          ) || [];
          return matches.length === 1 ? matches[0] : undefined;
        })();
    if (!ownedImage?.versionId) {
      setNodeAnnotationError('请先将图片保存到项目画布');
      return;
    }
    if (
      candidate.sourceVersionId
      && candidate.sourceVersionId !== ownedImage.versionId
    ) {
      setNodeAnnotationError('来源图片版本已变化，请重新创建批注');
      return;
    }
    if (
      existingBundle
      && (
        existingBundle.sourceImageId !== ownedImage.id
        || existingBundle.sourceVersionId !== ownedImage.versionId
      )
    ) {
      setNodeAnnotationError('来源图片版本已变化，请重新创建批注');
      return;
    }

    const connectionNode = wf.nodes.find(
      (node) => node.id === candidate.sourceNodeId,
    );
    if (!connectionNode?.ports.some((port) =>
      port.id === candidate.sourcePortId
      && port.direction === 'out'
      && port.type === 'image',
    )) {
      setNodeAnnotationError('请选择包含单张图片的节点');
      return;
    }

    setNodeAnnotationSession({
      source: {
        projectId,
        sourceNodeId: candidate.sourceNodeId,
        sourceImageId: ownedImage.id,
        sourceVersionId: ownedImage.versionId,
        imageUrl: candidate.url,
        label: candidate.label || sourceNode.label,
      },
      anchorNodeId: sourceNode.id,
      connectionNodeId: candidate.sourceNodeId,
      connectionPortId: candidate.sourcePortId,
      editingNodeId: sourceNode.type === 'ai-annotation-edit'
        ? sourceNode.id
        : undefined,
      existingBundle,
    });
    setNodeAnnotationCandidates(null);
    setNodeAnnotationError(null);
  }, [canvasImages, projectId, wf.nodes]);

  const requestNodeAnnotation = useCallback((sourceNode: WorkflowNode | null) => {
    if (!sourceNode) {
      setNodeAnnotationError('请选择包含单张图片的节点');
      return;
    }
    const existingBundle = sourceNode.type === 'ai-annotation-edit'
      ? parseAnnotationBundle(sourceNode.config?.annotationBundle)
      : null;
    if (sourceNode.type === 'ai-annotation-edit' && !existingBundle) {
      setNodeAnnotationError('当前批注节点的数据无效，无法重新编辑');
      return;
    }
    const candidates = getNodeAnnotationCandidates(sourceNode, existingBundle);
    if (candidates.length === 0) {
      setNodeAnnotationError('请选择包含单张图片的节点');
      return;
    }
    if (candidates.length > 1) {
      setNodeAnnotationCandidates({
        sourceNodeId: sourceNode.id,
        candidates,
        existingBundle,
      });
      setNodeAnnotationError(null);
      return;
    }
    openNodeAnnotation(sourceNode, candidates[0], existingBundle);
  }, [getNodeAnnotationCandidates, openNodeAnnotation]);

  const handleCreateAnnotationNode = useCallback((bundle: EditIntentBundle) => {
    const session = nodeAnnotationSession;
    if (!session) return;
    if (session.editingNodeId) {
      updateWorkflow((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => node.id === session.editingNodeId
          ? {
              ...node,
              label: '批注修改',
              config: {
                ...node.config,
                annotationBundle: bundle,
                prompt: bundle.prompt,
                model: bundle.modelId,
                providerId: bundle.providerId,
                sourceImageId: bundle.sourceImageId,
                sourceVersionId: bundle.sourceVersionId,
                sourceImageUrl: session.source.imageUrl,
              },
            }
          : node),
      }));
      setNodeAnnotationSession(null);
      setNodeAnnotationError(null);
      return;
    }

    const anchorNode = wf.nodes.find((node) => node.id === session.anchorNodeId);
    const connectionNode = wf.nodes.find(
      (node) => node.id === session.connectionNodeId,
    );
    const outputPort = connectionNode?.ports.find(
      (port) => port.id === session.connectionPortId,
    );
    if (!anchorNode || !connectionNode || !outputPort) {
      setNodeAnnotationError('无法建立批注节点的图片连线');
      return;
    }

    const annotationNode = createWorkflowNode('ai-annotation-edit',
      anchorNode.x + anchorNode.width + 80,
      anchorNode.y,
    );
    annotationNode.config = {
      ...annotationNode.config,
      annotationBundle: bundle,
      prompt: bundle.prompt,
      model: bundle.modelId,
      providerId: bundle.providerId,
      sourceImageId: bundle.sourceImageId,
      sourceVersionId: bundle.sourceVersionId,
      sourceImageUrl: session.source.imageUrl,
    };
    const inputPort = annotationNode.ports.find((port) =>
      port.id === 'in-image',
    );
    if (!inputPort) {
      setNodeAnnotationError('批注节点缺少图片输入端口');
      return;
    }
    const connection = createConnection(
      connectionNode.id,
      outputPort.id,
      annotationNode.id,
      inputPort.id,
      'image',
    );
    updateWorkflow((prev) => ({
      ...prev,
      nodes: [...prev.nodes, annotationNode],
      connections: [...prev.connections, connection],
    }));
    setSelectedNodeIds(new Set([annotationNode.id]));
    setSidebarTab('props');
    setNodeAnnotationSession(null);
    setNodeAnnotationError(null);
  }, [nodeAnnotationSession, updateWorkflow, wf.nodes]);

  // 图片上传: 全局文件输入框 (foreignObject内动态input.click()不可靠)
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const pendingImageUploadNodeId = useRef<string | null>(null);

  // 通知外部 (拖动期间跳过)
  const onWorkflowChangeRef = useRef(onWorkflowChange);
  onWorkflowChangeRef.current = onWorkflowChange;
  useEffect(() => {
    if (!isDraggingRef.current) {
      lastEmittedRef.current = wf;
      onWorkflowChangeRef.current?.(wf);
    }
  }, [wf, workflowSyncRevision]);

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
    const currentWorkflow = wfRef.current;
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
    const selectedNodes = currentWorkflow.nodes.filter(n => selectedNodeIds.has(n.id));
    if (selectedNodes.length > 0) {
      for (const selNode of selectedNodes) {
        const selOutPorts = selNode.ports.filter(p => p.direction === 'out');
        const newInPorts = node.ports.filter(p => p.direction === 'in');
        for (const outP of selOutPorts) {
          for (const inP of newInPorts) {
            if (canConnectPorts(outP.type, inP.type)) {
              const exists = currentWorkflow.connections.some(c =>
                c.fromNodeId === selNode.id && c.fromPortId === outP.id &&
                c.toNodeId === node.id && c.toPortId === inP.id
              );
              if (!exists) {
                autoConns.push(createConnection(selNode.id, outP.id, node.id, inP.id, outP.type));
                break;
              }
            }
          }
          if (autoConns.length > 0) break;
        }
        if (autoConns.length > 0) break;
      }
    }
    updateWorkflow(prev => {
      const newNodes = outputNode ? [node, outputNode] : [node];
      return { ...prev, nodes: [...prev.nodes, ...newNodes], connections: [...prev.connections, ...autoConns] };
    });
    setSelectedNodeIds(new Set([node.id]));
    setSidebarTab('props');
  }, [selectedNodeIds, updateWorkflow]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    workflowInputTransferGuardRef.current.invalidate(nodeId);
    handleWorkflowRenderCommand({
      type: 'nodes.delete', nodeIds: [nodeId], transactionId: `legacy-node-delete:${nodeId}`,
    });
    setSelectedNodeIds(prev => { const next = new Set(prev); next.delete(nodeId); return next; });
  }, [handleWorkflowRenderCommand]);
  useEffect(() => { handleDeleteNodeRef.current = handleDeleteNode; }, [handleDeleteNode]);

  const transferCanvasImageToWorkflow = useCallback(async (
    nodeId: string,
    image: CanvasImageRef,
  ): Promise<void> => {
    const guard = workflowInputTransferGuardRef.current;
    const token = guard.begin(nodeId);
    const pendingReference = createPendingWorkflowInputReference(image);
    const applyLegacyReference = (): void => {
      updateWorkflow(prev => ({
        ...prev,
        nodes: prev.nodes.map(node => node.id === nodeId
          ? {
              ...node,
              config: {
                ...node.config,
                ...pendingReference,
                assetTransferPending: false,
                projectId: undefined,
                assetId: undefined,
                assetVersionId: undefined,
                placementId: undefined,
              },
            }
          : node),
      }));
    };
    updateWorkflow(prev => ({
      ...prev,
      nodes: prev.nodes.map(node => node.id === nodeId
        ? {
            ...node,
            config: {
              ...node.config,
              ...pendingReference,
              projectId: undefined,
              assetId: undefined,
              assetVersionId: undefined,
              placementId: undefined,
            },
          }
        : node),
    }));
    if (!projectId) {
      if (guard.isCurrent(token)) applyLegacyReference();
      return;
    }
    await runGuardedWorkflowInputTransfer({
      guard,
      token,
      transfer: async () => {
        let sourceReference: WorkspaceAssetReference = image;
        if (!sourceReference.assetVersionId) {
          const adoptionResponse = await fetch('/api/assets/adopt-canvas-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, imageId: image.id }),
          });
          if (!adoptionResponse.ok) {
            throw new Error(`Legacy asset adoption failed (${adoptionResponse.status})`);
          }
          sourceReference = await adoptionResponse.json() as WorkspaceAssetReference;
          if (!sourceReference.assetVersionId) {
            throw new Error('Legacy asset adoption returned no version');
          }
          onCanvasImageAssetReferenceAdopted?.(image.id, sourceReference);
        }
        const response = await fetch('/api/assets/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceVersion: sourceReference.assetVersionId,
            targetProject: projectId,
            targetWorkspace: wf.id,
            entityType: 'workflow-input',
            entityId: nodeId,
            idempotencyKey: `canvas-workflow:${wf.id}:${nodeId}:${sourceReference.assetVersionId}`,
            metadata: { name: image.name, source: 'canvas', sourceImageId: image.id },
          }),
        });
        if (!response.ok) throw new Error(`Asset transfer failed (${response.status})`);
        return response.json() as Promise<WorkspaceAssetReference>;
      },
      onSuccess: transferred => {
        updateWorkflow(prev => ({
          ...prev,
          nodes: prev.nodes.map(node => node.id === nodeId
            ? {
                ...node,
                config: {
                  ...node.config,
                  imageUrl: transferred.url,
                  source: 'canvas',
                  sourceImageId: image.id,
                  assetTransferPending: false,
                  projectId,
                  assetId: transferred.assetId,
                  assetVersionId: transferred.assetVersionId,
                  placementId: transferred.placementId,
                },
              }
            : node),
        }));
      },
      onFailure: applyLegacyReference,
    });
  }, [onCanvasImageAssetReferenceAdopted, projectId, updateWorkflow, wf.id]);


  // 从内容面板拖拽图片到画布 → 创建 input-image 节点
  const handleCanvasImageDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const structuredReference = parseCanvasAssetDragPayload(
      e.dataTransfer.getData(CANVAS_ASSET_DRAG_MIME),
    );
    const imageUrl = structuredReference?.url
      || e.dataTransfer.getData('text/uri-list')
      || e.dataTransfer.getData('text/plain');
    if (!imageUrl) return;
    const rect = canvasContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vp = viewportRef.current;
    const cx = (e.clientX - rect.left - vp.x) / vp.zoom;
    const cy = (e.clientY - rect.top - vp.y) / vp.zoom;

    // 根据图片宽高比计算节点大小
    const refImage: CanvasImageRef | undefined = structuredReference
      ? {
          ...structuredReference,
          name: structuredReference.name || '',
          description: structuredReference.name || '',
        }
      : undefined;
    const imgW = refImage?.width || 1024;
    const imgH = refImage?.height || 1024;
    const ratio = imgW / imgH;
    const nodeW = Math.max(180, Math.min(320, 260 * Math.max(1, ratio)));
    const nodeH = Math.max(140, Math.min(320, nodeW / ratio));

    const node = createWorkflowNode('input-image', cx - nodeW / 2, cy - nodeH / 2);
    node.config = refImage
      ? { ...node.config, ...createPendingWorkflowInputReference(refImage) }
      : { ...node.config, imageUrl, source: 'canvas-ref', assetTransferPending: false };
    node.width = nodeW;
    node.height = nodeH;
    updateWorkflow(prev => ({ ...prev, nodes: [...prev.nodes, node] }));
    setSelectedNodeIds(new Set([node.id]));
    if (refImage) void transferCanvasImageToWorkflow(node.id, refImage);
  }, [transferCanvasImageToWorkflow, updateWorkflow]);

  const handleNodeUpdate = useCallback((nodeId: string, updates: Partial<WorkflowNode>) => {
    const currentImageUrl = wf.nodes.find(node => node.id === nodeId)?.config?.imageUrl;
    if (shouldInvalidateWorkflowInputTransfer(currentImageUrl, updates.config)) {
      workflowInputTransferGuardRef.current.invalidate(nodeId);
    }
    updateWorkflow(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => n.id === nodeId ? mergeWorkflowNodeUpdate(n, updates) : n),
    }));
  }, [updateWorkflow, wf.nodes]);

  // P0: LLM优化提示词
  const handleLlmOptimize = useCallback(async (nodeId: string, _prompt: string, model: string, systemPrompt: string, instruction: string) => {
    const node = wf.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const currentText = String(node.config?.textContent || node.config?.promptText || '');
    if (!currentText.trim()) return; // 空文本不优化
    handleNodeUpdate(nodeId, { config: { ...node.config, llmOptimizing: true } });
    try {
      const exactModel = parseExactModelKey(model || String(node.config?.llmModel || ''));
      if (!exactModel) throw new Error('请重新选择提示词优化模型及供应商');
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt || instruction || '你是一个专业的AI图像提示词优化助手。请优化用户提供的提示词，使其更加详细、精确，适合AI图像生成。请用中文输出优化后的提示词，不要添加任何解释。' },
            { role: 'user', content: currentText },
          ],
          model: exactModel.modelId,
          providerId: exactModel.providerId,
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

  const startWorkflowExecution = useCallback(async (payload: {
    nodes: WorkflowNode[];
    connections: WorkflowConnection[];
    startNodeId?: string;
    tailNodeId?: string;
  }) => {
    const executionNodes: WorkflowNode[] = [];
    for (const node of payload.nodes) {
      if (node.type !== 'ai-generate') {
        executionNodes.push(node);
        continue;
      }
      const model = String(node.config?.model || '');
      const providerId = String(node.config?.providerId || '');
      const persistedKey = model && providerId && !parseExactModelKey(model) ? `${providerId}::${model}` : model;
      const selection = resolvePersistedModelSelection(
        persistedKey,
        imageModels.filter(item => item.providerId).map(item => ({ id: item.id, providerId: item.providerId! })),
      );
      if (!selection.compositeKey) {
        setExecStatus('failed');
        setExecLogs([{ time: Date.now(), nodeId: node.id, label: node.label, status: 'error', message: '请重新选择明确的图像模型及供应商' }]);
        setShowExecLog(true);
        return;
      }
      executionNodes.push({ ...node, config: { ...node.config, model: selection.compositeKey, providerId: selection.providerId } });
    }
    setExecStatus('running');
    setExecutionId(null);
    setExecResults({});
    setExecLogs([]);
    try {
      const res = await fetch('/api/workflow/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', projectId, ...payload, nodes: executionNodes }),
      });
      const data = await res.json();
      if (!res.ok || !data.executionId) {
        setExecStatus('failed');
        return;
      }
      setExecutionId(data.executionId);
      localStorage.setItem(WORKFLOW_EXEC_STATE_KEY, JSON.stringify({
        executionId: data.executionId,
        execStatus: 'running',
        execResults: {},
        execLogs: [],
      }));
    } catch {
      setExecStatus('failed');
    }
  }, [projectId, imageModels]);

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
    await startWorkflowExecution({
      startNodeId,
      tailNodeId: tailId,
      nodes: wf.nodes,
      connections: wf.connections,
    });
  }, [startWorkflowExecution, wf.connections, wf.nodes]);
  useEffect(() => { handleCascadeRunRef.current = handleCascadeRun; }, [handleCascadeRun]);


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
    const sourceConnection = createConnection(sourceNode.id, 'output-image', nodeId, 'input-image', 'image');
    // 清空当前节点的图片
    handleNodeUpdate(nodeId, { config: { ...node.config, imageUrl: '', label: '输出' } });
    // 添加源节点和连线
    updateWorkflow(prev => ({
      ...prev,
      nodes: [...prev.nodes, sourceNode],
      connections: [...prev.connections, sourceConnection],
    }));
  }, [wf.nodes, handleNodeUpdate, updateWorkflow]);

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
    updateWorkflow(prev => ({ ...prev, nodes: [...prev.nodes, ...newNodes], connections: [...prev.connections, ...newConns] }));
  }, [updateWorkflow, wf.nodes]);

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

  const handleSendWorkflowResultToChat = useCallback(async (nodeId: string) => {
    if (!projectId || !executionId) {
      setExecLogs(prev => mergeExecutionLogs(prev, [{
        time: Date.now(), nodeId, label: wf.nodes.find(node => node.id === nodeId)?.label || nodeId,
        status: 'error', message: '工作流结果尚未完成，无法发送到智能对话',
      }]));
      return;
    }
    const reference = resolveWorkflowOutputAssetReference(
      nodeId,
      wf.nodes,
      wf.connections,
      execResults,
    );
    if (!reference?.assetVersionId) {
      setExecLogs(prev => mergeExecutionLogs(prev, [{
        time: Date.now(), nodeId, label: wf.nodes.find(node => node.id === nodeId)?.label || nodeId,
        status: 'error', message: '输出缺少规范素材版本，无法发送到智能对话',
      }]));
      return;
    }
    const targetChatProjectId = localStorage.getItem('wujie_last_simple_chat_project') || undefined;
    const targetUrl = buildWorkflowChatReturnIntentUrl({
      assetProjectId: projectId,
      sourceVersionId: reference.assetVersionId,
      workflowId: wf.id,
      executionId,
      outputNodeId: nodeId,
      outputLabel: wf.nodes.find(node => node.id === nodeId)?.label || '工作流结果',
    }, targetChatProjectId);
    try {
      await navigateToWorkflowChatAfterPersistence(
        targetUrl,
        onBeforeWorkflowChatNavigation || (async () => undefined),
        target => window.location.assign(target),
      );
    } catch (error) {
      setExecLogs(prev => mergeExecutionLogs(prev, [{
        time: Date.now(), nodeId, label: wf.nodes.find(node => node.id === nodeId)?.label || nodeId,
        status: 'error', message: error instanceof Error ? error.message : '保存工作区失败，未跳转到智能对话',
      }]));
    }
  }, [execResults, executionId, onBeforeWorkflowChatNavigation, projectId, wf.connections, wf.id, wf.nodes]);

  // P1: 键盘快捷键 (复制/粘贴/删除)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const event = e;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;

      if (event.key === 'Escape' && nodeAnnotationCandidates) {
        event.preventDefault();
        setNodeAnnotationCandidates(null);
        return;
      }

      if (event.code === 'KeyC' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (nodeAnnotationCandidates) setNodeAnnotationCandidates(null);
        else if (nodeAnnotationSession) setNodeAnnotationSession(null);
        else requestNodeAnnotation(selectedNode);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setAiBuildOpen(true);
        return;
      }

      // Ctrl+C / Cmd+C 复制选中节点（支持多选）
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selectedNodeIds.size > 0) {
        e.preventDefault();
        setClipboard(createWorkflowClipboardSnapshot(wf, [...selectedNodeIds]));
      }
      // Ctrl+V / Cmd+V 粘贴节点
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && clipboard) {
        e.preventDefault();
        const transactionId = `keyboard-node-copy:${++editorTransactionCounterRef.current}`;
        const result = handleWorkflowRenderCommand({
          type: 'clipboard.paste',
          snapshot: clipboard,
          offset: { x: 40, y: 40 },
          transactionId,
        });
        if (result.createdNodeIds.length > 0) {
          setSelectedNodeIds(new Set(result.createdNodeIds));
          setSidebarTab('props');
        }
      }
      // Delete / Backspace 删除选中节点（支持多选）
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeIds.size > 0) {
        e.preventDefault();
        const nodeIds = [...selectedNodeIds];
        nodeIds.forEach(id => workflowInputTransferGuardRef.current.invalidate(id));
        handleWorkflowRenderCommand({
          type: 'nodes.delete',
          nodeIds,
          transactionId: `keyboard-node-delete:${++editorTransactionCounterRef.current}`,
        });
        setSelectedNodeIds(new Set());
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
  }, [selectedNodeIds, selectedNodeId, selectedNode, clipboard, wf, handleWorkflowRenderCommand, handleUndo, handleRedo, nodeAnnotationCandidates, nodeAnnotationSession, requestNodeAnnotation]);

  // ─── 连线操作 (含端口类型约束) ───

  const handlePortMouseDown = useCallback((e: React.MouseEvent, nodeId: string, port: NodePort) => {
    e.stopPropagation();
    if (port.direction !== 'out') return;
    const node = wf.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const pos = getPortPositionLocalRef.current(node, port);
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
    handleWorkflowRenderCommand({
      type: 'connection.create', connection: conn, transactionId: `legacy-connection:${conn.id}`,
    });
    setDraggingConn(null);
  }, [draggingConn, handleWorkflowRenderCommand, wf.connections]);

  // ─── 画布交互 ───

  const applyNodeDragPosition = useCallback((position: { id: string; x: number; y: number }) => {
    updateWorkflowSystem(current => ({
      ...current,
      nodes: current.nodes.map(node => node.id === position.id
        ? { ...node, x: position.x, y: position.y }
        : node),
    }));
  }, [updateWorkflowSystem]);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // 中键或Alt+左键 = 平移
      const vp = viewportRef.current;
      nodePanPreviewRef.current = vp;
      setNodePanViewport(vp);
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
      updateNodePanPreview({
        x: panStart.vx + (e.clientX - panStart.x),
        y: panStart.vy + (e.clientY - panStart.y),
        zoom: viewportRef.current.zoom,
      });
    } else if (draggingNodeRef.current) {
      const canvasRect = canvasContainerRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const vp = viewportRef.current;
      const mx = (e.clientX - canvasRect.left - vp.x) / vp.zoom;
      const my = (e.clientY - canvasRect.top - vp.y) / vp.zoom;
      const nodeId = draggingNodeRef.current;
      const offset = dragOffsetRef.current;
      nodeDragPositionRef.current = { id: nodeId, x: mx - offset.x, y: my - offset.y };
      if (nodeDragRafRef.current === null) {
        nodeDragRafRef.current = requestAnimationFrame(() => {
          nodeDragRafRef.current = null;
          const position = nodeDragPositionRef.current;
          if (position) applyNodeDragPosition(position);
        });
      }
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
  }, [applyNodeDragPosition, isPanning, draggingConn, boxSelect, panStart.vx, panStart.x, panStart.vy, panStart.y, updateNodePanPreview]);

  const handleCanvasMouseUp = useCallback(() => {
    if (isPanning) {
      if (nodePanRafRef.current !== null) {
        cancelAnimationFrame(nodePanRafRef.current);
        nodePanRafRef.current = null;
      }
      const finalViewport = nodePanPreviewRef.current;
      applyNodeViewportPreview(finalViewport);
      setNodePanViewport(finalViewport);
      setViewport(finalViewport);
    }
    setIsPanning(false);
    if (draggingNodeRef.current) {
      const finalPosition = nodeDragPositionRef.current;
      const finalPositions: WorkflowNodePosition[] = finalPosition
        ? [{ nodeId: finalPosition.id, position: { x: finalPosition.x, y: finalPosition.y } }]
        : [];
      if (nodeDragRafRef.current !== null) {
        cancelAnimationFrame(nodeDragRafRef.current);
        nodeDragRafRef.current = null;
      }
      nodeDragPositionRef.current = null;
      draggingNodeRef.current = null;
      if (finalPosition && nodeDragInitialPositionsRef.current.length > 0) {
        dispatchWorkflowStateCommand({
          type: 'nodes.drag.commit',
          initialPositions: nodeDragInitialPositionsRef.current,
          positions: finalPositions,
          transactionId: `legacy-node-drag:${finalPosition.id}:${++editorTransactionCounterRef.current}`,
        });
      }
      finishWorkflowDrag(finalPositions);
      nodeDragInitialPositionsRef.current = [];
      // 让外部同步由 effect 在本次拖拽状态提交后执行，避免在状态更新器中触发父组件更新。
      setWorkflowSyncRevision(revision => revision + 1);
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
  }, [applyNodeViewportPreview, boxSelect, dispatchWorkflowStateCommand, finishWorkflowDrag, isPanning, wf.nodes]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    nodeWheelDeltaRef.current += e.deltaY;
    if (nodeWheelRafRef.current !== null) return;
    nodeWheelRafRef.current = requestAnimationFrame(() => {
      nodeWheelRafRef.current = null;
      const delta = nodeWheelDeltaRef.current;
      nodeWheelDeltaRef.current = 0;
      const factor = Math.exp(-delta * 0.0015);
      setViewport(current => ({
        ...current,
        zoom: Math.max(0.15, Math.min(3, current.zoom * factor)),
      }));
    });
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
          updateWorkflow(prev => ({ ...prev, nodes: [...prev.nodes, newNode] }));
          setSelectedNodeIds(new Set([newNode.id]));
          break;
        }
        case 'paste': {
          if (!clipboard) break;
          const canvasRect2 = canvasContainerRef.current?.getBoundingClientRect();
          const vp2 = viewportRef.current;
          const mx2 = canvasRect2 ? (contextMenu.x - canvasRect2.left - vp2.x) / vp2.zoom : 100;
          const my2 = canvasRect2 ? (contextMenu.y - canvasRect2.top - vp2.y) / vp2.zoom : 100;
          const minX = Math.min(...clipboard.nodes.map(node => node.x));
          const minY = Math.min(...clipboard.nodes.map(node => node.y));
          const transactionId = `context-paste:${++editorTransactionCounterRef.current}`;
          const command: WorkflowInteractionCommand = {
            type: 'clipboard.paste',
            snapshot: clipboard,
            offset: { x: mx2 + 30 - minX, y: my2 + 30 - minY },
            transactionId,
          };
          const result = dispatchWorkflowStateCommand(command);
          setSelectedNodeIds(new Set(result.createdNodeIds));
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
        case 'annotate': {
          requestNodeAnnotation(wf.nodes.find((node) => node.id === nodeId) || null);
          break;
        }
        case 'copy': {
          const selIds = selectedNodeIds.has(nodeId) ? selectedNodeIds : new Set([nodeId]);
          setClipboard(createWorkflowClipboardSnapshot(wf, [...selIds]));
          break;
        }
        case 'duplicate': {
          const selIds = selectedNodeIds.has(nodeId) ? selectedNodeIds : new Set([nodeId]);
          const transactionId = `context-duplicate:${++editorTransactionCounterRef.current}`;
          const command: WorkflowInteractionCommand = {
            type: 'nodes.copy',
            nodeIds: [...selIds],
            offset: { x: 40, y: 40 },
            transactionId,
          };
          const result = dispatchWorkflowStateCommand(command);
          setSelectedNodeIds(new Set(result.createdNodeIds));
          break;
        }
        case 'disconnect': {
          updateWorkflow(prev => ({
            ...prev,
            connections: prev.connections.filter(c => c.fromNodeId !== nodeId && c.toNodeId !== nodeId),
          }));
          break;
        }
        case 'delete': {
          const selIds = selectedNodeIds.has(nodeId) ? selectedNodeIds : new Set([nodeId]);
          dispatchWorkflowStateCommand({
            type: 'nodes.delete',
            nodeIds: [...selIds],
            transactionId: `context-delete:${++editorTransactionCounterRef.current}`,
          });
          setSelectedNodeIds(new Set());
          break;
        }
      }
    }
    closeContextMenu();
  }, [contextMenu, closeContextMenu, clipboard, wf, selectedNodeIds, requestNodeAnnotation, dispatchWorkflowStateCommand, updateWorkflow]);

  // ─── 执行工作流 ───

  const handleRunWorkflow = useCallback(async () => {
    await startWorkflowExecution({ nodes: wf.nodes, connections: wf.connections });
  }, [startWorkflowExecution, wf.connections, wf.nodes]);

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
    const executionProjectId = projectId;
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
        if (!isWorkspaceResultScopeCurrent(executionProjectId, projectIdRef.current)) return;
        if (data.status === 'completed' || data.status === 'failed') {
          setExecStatus(data.status === 'completed' ? 'completed' : 'failed');
          setExecResults(data.results || {});
          // P1: 记录执行日志
          let finalLogs: WorkflowExecutionLog[] = [];
          if (data.results) {
            finalLogs = Object.entries(data.results as Record<string, { status: string; output?: Record<string, unknown>; error?: string }>).map(([nodeId, result]) => {
              const node = wf.nodes.find(n => n.id === nodeId);
              return { time: Date.now(), nodeId, label: node?.label || nodeId, status: result.status, message: result.error || (result.output ? '完成' : '未知') };
            });
            setExecLogs(prev => mergeExecutionLogs(prev, finalLogs));
          }
          // B1: 持久化最终结果，3秒后清除
          const finalState = { executionId, execStatus: data.status, execResults: data.results || {}, execLogs: finalLogs };
          localStorage.setItem(WORKFLOW_EXEC_STATE_KEY, JSON.stringify(finalState));
          setTimeout(() => {
            if (localStorage.getItem(WORKFLOW_EXEC_STATE_KEY) === JSON.stringify(finalState)) {
              localStorage.removeItem(WORKFLOW_EXEC_STATE_KEY);
            }
          }, 3000);
          // 持久化: 将工作流生成的图片添加到项目
          if (data.status === 'completed' && onAddImages && data.results) {
            const workflowResults = data.results as Record<string, { status: string; output?: Record<string, unknown> }>;
            // ★ 收集工作流中使用的模型信息
            let workflowModelName: string | undefined;
            let workflowApiProvider: string | undefined;
            for (const [, result] of Object.entries(workflowResults)) {
              if (result.status === 'success' && result.output) {
                // 尝试从输出获取模型信息
                if (!workflowModelName && result.output.modelName) workflowModelName = result.output.modelName as string;
                if (!workflowApiProvider && result.output.apiProvider) workflowApiProvider = result.output.apiProvider as string;
              }
            }
            const outputCandidates = wf.nodes
              .filter(node => getNodeCategory(node.type) === 'output')
              .flatMap(outputNode => {
                const result = workflowResults[outputNode.id];
                if (result?.status !== 'success' || !result.output) return [];
                const outputReference = resolveWorkflowOutputAssetReference(
                  outputNode.id,
                  wf.nodes,
                  wf.connections,
                  workflowResults,
                );
                if (outputReference?.assetVersionId) {
                  return [{
                    outputNodeId: outputNode.id,
                    url: outputReference.url,
                    managed: true,
                    sourceReference: outputReference,
                  }];
                }
                const hasManagedIdentity = typeof result.output.assetVersionId === 'string'
                  || (Array.isArray(result.output.assetReferences) && result.output.assetReferences.some(value => {
                    if (!value || typeof value !== 'object') return false;
                    const reference = value as Record<string, unknown>;
                    return reference.outputNodeId === outputNode.id && typeof reference.assetVersionId === 'string';
                  }));
                const imageUrls = Array.isArray(result.output.imageUrls)
                  ? result.output.imageUrls.filter((url): url is string => typeof url === 'string')
                  : (typeof result.output.imageUrl === 'string' ? [result.output.imageUrl] : []);
                return imageUrls.map((url, index) => ({
                  outputNodeId: imageUrls.length === 1 ? outputNode.id : `${outputNode.id}:${index}`,
                  url,
                  managed: hasManagedIdentity,
                }));
              });
            if (outputCandidates.length > 0) {
              const insertion = await prepareWorkflowCanvasInsertions(outputCandidates, async (outputReference, candidate) => {
                if (!projectId) throw new Error('Missing target project');
                const outputNodeId = candidate.outputNodeId.split(':')[0];
                const outputNode = wf.nodes.find(node => node.id === outputNodeId);
                const response = await fetch('/api/assets/transfer', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sourceVersion: outputReference.assetVersionId,
                    targetProject: projectId,
                    targetWorkspace: `canvas:${projectId}`,
                    entityType: 'canvas-image',
                    entityId: `${executionId}:${candidate.outputNodeId}`,
                    idempotencyKey: `workflow-canvas:${executionId}:${candidate.outputNodeId}:${outputReference.assetVersionId}`,
                    metadata: {
                      name: outputNode?.label || candidate.outputNodeId,
                      source: 'workflow',
                      workflowId: wf.id,
                      executionId,
                      outputNodeId: candidate.outputNodeId,
                    },
                  }),
                });
                if (!response.ok) throw new Error(`Asset transfer failed (${response.status})`);
                return response.json() as Promise<WorkspaceAssetReference>;
              });
              if (insertion.failedOutputNodeIds.length > 0) {
                setExecLogs(prev => mergeExecutionLogs(prev, insertion.failedOutputNodeIds.map(nodeId => ({
                  time: Date.now(),
                  nodeId,
                  label: wf.nodes.find(node => node.id === nodeId)?.label || nodeId,
                  status: 'error',
                  message: 'Asset transfer failed; retry is available',
                }))));
              }
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
              if (insertion.items.length > 0) {
                onAddImages(insertion.items, Object.keys(meta).length > 0 ? meta : undefined);
              }
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
          if (newLogs.length > 0) setExecLogs(prev => mergeExecutionLogs(prev, newLogs));
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
  }, [execStatus, executionId, onAddImages, projectId, wf.connections, wf.id, wf.nodes]);

  // ─── 保存工作流 ───

  const handleSaveWorkflow = useCallback(async () => {
    setSaveStatus('saving');
    try {
      if (!userId) throw new Error('未登录');
      const savedWorkflow = { ...wfRef.current, updatedAt: Date.now() };
      if (onWorkflowSaveRequest) {
        await onWorkflowSaveRequest(savedWorkflow);
      } else {
        const res = await fetch('/api/workflow/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, workflow: savedWorkflow }),
        });
        if (!res.ok) throw new Error('工作流保存失败');
        await onWorkflowSaved?.(savedWorkflow);
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  }, [onWorkflowSaveRequest, onWorkflowSaved, userId]);

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
      updateWorkflow(prev => ({
        ...prev,
        nodes: prev.nodes.map((n: WorkflowNode) =>
          n.id === nodeId ? { ...n, width: nodeW, height: clampedH + 56 } : n
        ),
      }));
    };
    img.src = imageUrl;
    // 返回清理函数，组件卸载时取消回调
    return () => { cancelled = true; img.onload = null; };
  }, [updateWorkflow]);

  const updateNodeSize = useCallback((nodeId: string, width: number, height: number) => {
    dispatchWorkflowStateCommand({
      type: 'node.measure',
      nodeId,
      size: { width, height },
    });
    // 节点尺寸变化时清除该节点的端口位置缓存，下次取端口位置时重新计算
    for (const key of portPositionCacheRef.current.keys()) {
      if (key.startsWith(nodeId + '-')) {
        portPositionCacheRef.current.delete(key);
      }
    }
  }, [dispatchWorkflowStateCommand]);

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
        handleNodeUpdate(nodeId, { config: {
          imageUrl: data.url,
          source: 'upload',
          projectId: '',
          assetId: '',
          assetVersionId: '',
          placementId: '',
        } });
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
        handleNodeUpdate(nodeId, { config: {
          imageUrl: data.url,
          source: 'upload',
          projectId: '',
          assetId: '',
          assetVersionId: '',
          placementId: '',
        } });
        resizeNodeForImageUrl(nodeId, data.url);
      }
    } catch (e) {
      console.error('[NodeEditor] 图片上传失败:', e);
    }
  }, [handleNodeUpdate, resizeNodeForImageUrl]);

  // ─── AI自然语言建图 ───

  const handleAiBuild = useCallback(async () => {
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
            updateWorkflow(data.workflow);
            setSelectedNodeIds(new Set());
            setSidebarTab('nodes');
            setAiBuildInput('');
            setAiBuildOpen(false);
          } else {
            setAiBuildError(data.error || 'AI建图失败，请重试');
          }
        } catch (e) {
          setAiBuildError('网络错误，请重试');
          console.error('[NodeEditor] AI建图失败:', e);
        } finally {
          setAiBuildLoading(false);
        }
      }, [aiBuildInput, updateWorkflow]);

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
        updateWorkflow(layouted);
        setSelectedNodeIds(new Set());
        setSidebarTab('nodes');
      }, [updateWorkflow]);

  // ─── 自动布局 ───

  useCallback(() => {
        updateWorkflow(prev => autoLayoutWorkflow(prev));
      }, [updateWorkflow]);

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
  useEffect(() => { getPortPositionLocalRef.current = getPortPositionLocal; }, [getPortPositionLocal]);


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

  const workflowCardCallbacks: WorkflowLegacyCardCallbacks = {
    onNodeFieldChange: handleNodeFieldChange,
    onLlmOptimize: handleLlmOptimize,
    onCascadeRun: handleCascadeRun,
    onExtractToSource: handleExtractToSource,
    onGridSplit: handleGridSplit,
    onCompare: handleCompare,
    onSendToChat: handleSendWorkflowResultToChat,
    onTriggerImageUpload: triggerNodeImageUpload,
    onImageFileDrop: handleImageUpload,
    promptPresets: nodePromptPresets,
    onSavePromptPreset: saveNodePromptPreset,
    onDeletePromptPreset: deleteNodePromptPreset,
    onSelect: (nodeId, event) => {
      if (event && (event.ctrlKey || event.metaKey)) {
        setSelectedNodeIds(previous => {
          const next = new Set(previous);
          if (next.has(nodeId)) next.delete(nodeId);
          else next.add(nodeId);
          return next;
        });
      } else {
        setSelectedNodeIds(new Set([nodeId]));
      }
      setSidebarTab('props');
    },
    onHover: nodeId => {
      setHighlightNodeId(nodeId);
      setHoveredNodeId(nodeId);
    },
    onDragStart: (nodeId, event) => {
      const node = wfRef.current.nodes.find(candidate => candidate.id === nodeId);
      const canvasRect = canvasContainerRef.current?.getBoundingClientRect();
      if (!node || !canvasRect) return;
      const currentViewport = viewportRef.current;
      const mouseX = (event.clientX - canvasRect.left - currentViewport.x) / currentViewport.zoom;
      const mouseY = (event.clientY - canvasRect.top - currentViewport.y) / currentViewport.zoom;
      draggingNodeRef.current = nodeId;
      nodeDragInitialPositionsRef.current = [{ nodeId, position: { x: node.x, y: node.y } }];
      nodeDragPositionRef.current = { id: nodeId, x: node.x, y: node.y };
      dragOffsetRef.current = { x: mouseX - node.x, y: mouseY - node.y };
      beginWorkflowDrag(nodeDragInitialPositionsRef.current);
      setBoxSelect(null);
      isBoxSelectingRef.current = false;
    },
    onPortMouseDown: handlePortMouseDown,
    onPortMouseUp: handlePortMouseUp,
    onDelete: () => undefined,
    onDeselect: () => setSelectedNodeIds(new Set()),
    onPreviewImage: setImagePreviewUrl,
    onResizeNode: resizeNodeForImageUrl,
    onUpdateNodeSize: updateNodeSize,
    collapsedNodes,
    onToggleCollapse: toggleNodeCollapse,
    onContextMenu: (nodeId, event) => handleNodeContextMenu(event, nodeId),
    onDoubleClickAnnotation: nodeId => {
      const node = wfRef.current.nodes.find(candidate => candidate.id === nodeId);
      if (node?.type === 'ai-annotation-edit') requestNodeAnnotation(node);
    },
  };

  // ─── 渲染 ───

  return (
    <>
    <div className="node-editor-root h-screen w-screen flex flex-col text-foreground overflow-hidden select-none" data-theme={themeStyle === 'monochrome' ? 'monochrome' : 'gold'} style={{ ...neVars, background: T.canvasBg }}>
      {/* 全局图片上传 (foreignObject内input.click()不可靠, 统一由外部触发) */}
      <input ref={imageFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleGlobalImageUpload} />
      {/* ═══ 顶部工具栏 - 全宽, 与原型对齐 ═══ */}
      <header className="bg-card h-12 flex items-center justify-between gap-3 overflow-x-auto px-3 border-b border-border/20 z-50 shrink-0" role="toolbar" aria-label="工作流工具栏">
        {/* 左侧：工作流操作 */}
        <div className="flex min-w-max items-center gap-1" role="group" aria-label="工作流操作">
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
          <button onClick={handleRedo} disabled={historyIndex >= historyStack.length} className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="重做 Ctrl+Shift+Z" aria-label="重做">
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
                  updateWorkflow(prev => ({ ...prev, nodes: [...prev.nodes, ...result.nodes], connections: [...prev.connections, ...result.connections] }));
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
        <div className="flex min-w-max items-center gap-1" role="group" aria-label="视图控制">
          {/* 工作流名称 + 统计 */}
          <span className="text-sm font-semibold text-primary mr-1">{wf.name}</span>
          <span className="text-[11px] text-muted-foreground mr-2">{wf.nodes.length} 节点 · {wf.connections.length} 连线</span>
          {execStatus !== 'idle' && (
            <div aria-live="polite" className="flex items-center gap-1.5 rounded-md border border-border/20 bg-muted/50 px-2 py-1 text-[11px]">
              {execStatus === 'running' && <Loader2 size={12} className="animate-spin text-primary" />}
              {execStatus === 'completed' && <Check size={12} className="text-green-400" />}
              {execStatus === 'failed' && <AlertCircle size={12} className="text-red-400" />}
              <span className={execStatus === 'running' ? 'text-primary' : execStatus === 'completed' ? 'text-green-400' : 'text-red-400'}>
                {execStatus === 'running' ? '执行中' : execStatus === 'completed' ? '执行完成' : '执行失败'}
              </span>
              <span className="text-muted-foreground">{Object.keys(execResults).length}/{wf.nodes.length}</span>
              <button
                type="button"
                onClick={() => { setExecStatus('idle'); setExecResults({}); setExecLogs([]); }}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="关闭执行状态"
              >
                <X size={11} />
              </button>
            </div>
          )}
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
      <div className="relative flex flex-1 min-h-0">
      {/* ═══ 左侧节点库面板 - 与原型对齐: w-64, 搜索+分类列表 ═══ */}
      {showLeftPanel && (
      <aside className="absolute inset-y-0 left-0 z-40 flex w-[min(18rem,85vw)] shrink-0 flex-col overflow-hidden border-r border-border/20 bg-card shadow-2xl md:relative md:z-auto md:w-64 md:shadow-none">
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
                  data-node-type={t.type}
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

          {workflowRendererMode === 'react-flow-v2' ? (
            <WorkflowReactFlowSurface
              model={reactFlowWorkflowRenderModel}
              onCommand={handleWorkflowRenderCommand}
              onNodeDragStart={beginWorkflowDrag}
              onNodeDragEnd={finishWorkflowDrag}
              onViewportChange={setViewport}
              visibleNodeIds={visibleNodeIds}
              readOnly={false}
              theme={T}
              execResults={execResults}
              execStatus={execStatus}
              highlightedNodeIds={getConnectedNodeIds}
              hoveredNodeId={hoveredNodeId}
              canvasImages={canvasImages}
              llmModels={chatModels}
              imageModels={imageModels}
              promptTemplates={promptTemplates}
              upstreamImageUrls={upstreamImageUrls}
              cardCallbacks={workflowCardCallbacks}
            />
          ) : (
            <>
          <WorkflowLegacySurface
            model={legacyWorkflowRenderModel}
            onCommand={handleWorkflowRenderCommand}
            visibleNodeIds={visibleNodeIds}
            theme={T}
            execResults={execResults}
            execStatus={execStatus}
            highlightedNodeIds={getConnectedNodeIds}
            hoveredNodeId={hoveredNodeId}
            canvasImages={canvasImages}
            llmModels={chatModels}
            imageModels={imageModels}
            promptTemplates={promptTemplates}
            upstreamImageUrls={upstreamImageUrls}
            draggingConnection={draggingConn}
            boxSelect={boxSelect}
            svgViewportTransformRef={svgViewportTransformRef}
            nodeViewportTransformRef={nodeViewportTransformRef}
            getConnectionPath={getConnPath}
            getPortPosition={getPortPositionLocal}
            isConnectionHighlighted={isConnectionHighlighted}
            onToggleConnectionBlocked={(connection, targetNode) => {
              updateWorkflow(prev => {
                const currentTarget = prev.nodes.find(node => node.id === targetNode.id);
                if (!currentTarget) return prev;
                const blocked = Array.isArray(currentTarget.config?.blockedInputs) ? [...(currentTarget.config.blockedInputs as string[])] : [];
                const index = blocked.indexOf(connection.id);
                if (index >= 0) blocked.splice(index, 1);
                else blocked.push(connection.id);
                return {
                  ...prev,
                  nodes: prev.nodes.map(node => node.id === targetNode.id ? { ...node, config: { ...node.config, blockedInputs: blocked } } : node),
                };
              });
            }}
            cardCallbacks={workflowCardCallbacks}
          />
          {workflowRendererMode === 'shadow' ? (
            <WorkflowShadowProbe
              legacyModel={legacyWorkflowRenderModel}
              shadowModel={reactFlowWorkflowRenderModel}
            />
          ) : null}
            </>
          )}
        </div>

        <button
          type="button"
          data-toolbar="node-annotation-entry"
          className={`absolute bottom-3 left-1/2 z-[1] inline-flex h-9 -translate-x-1/2 items-center gap-2 rounded-md border px-3 text-xs font-medium shadow-lg transition-colors ${
            nodeAnnotationSession
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card/95 text-muted-foreground hover:border-primary/50 hover:text-foreground'
          }`}
          onClick={() => {
            if (nodeAnnotationSession) setNodeAnnotationSession(null);
            else requestNodeAnnotation(selectedNode);
          }}
          title="批注修改 (C)"
          aria-label="批注修改"
          aria-pressed={Boolean(nodeAnnotationSession)}
        >
          <MessageSquare size={15} />
          批注修改
        </button>

        {nodeAnnotationError && !nodeAnnotationSession && (
          <div
            className="absolute bottom-14 left-1/2 z-30 max-w-[min(420px,calc(100vw-32px))] -translate-x-1/2 rounded-md border border-destructive/40 bg-card px-3 py-2 text-xs text-destructive shadow-lg"
            role="alert"
          >
            {nodeAnnotationError}
          </div>
        )}

        {/* 端口类型图例 */}
        {selectedNodeIds.size === 0 && (
          <div className="absolute bottom-3 left-3 pointer-events-none bg-card/90 border border-border rounded px-3 py-2 flex items-center gap-3 text-xs">
            {Object.entries(PORT_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-muted-foreground">{type}</span>
              </div>
            ))}
          </div>
        )}

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
              data-workflow-minimap
              data-workflow-ui-occlusion
              className="absolute bottom-3 right-3 hidden h-[100px] w-[160px] cursor-pointer overflow-hidden rounded border border-border bg-card/90 md:block"
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

      </div>{/* 主画布 end */}

      {/* ═══ 右侧属性面板 - 与原型对齐: w-72, 始终可见 ═══ */}
      <aside data-workflow-ui-occlusion className="hidden md:flex w-72 shrink-0 bg-card border-l border-border/20 flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 h-11 border-b border-border/10">
          <span className="text-[11px] uppercase tracking-[0.12em] font-bold text-muted-foreground">节点属性</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {selectedNode ? (
            <PropertyPanel
              node={selectedNode}
              models={models}
              modelCatalogIndex={modelCatalogIndex}
              modelsLoading={modelsLoading}
              onUpdate={handleNodeUpdate}
              onDelete={handleDeleteNode}
              onImageUpload={handleImageUpload}
              canvasImages={allCanvasImages}
              onCanvasImageSelect={transferCanvasImageToWorkflow}
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
      <div data-workflow-ui-occlusion className="shrink-0 border-t border-border/20 bg-card">
        {/* 内容条 */}
        {showContentStrip && (
        <div className="block border-b border-border/10">
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
              <div
                key={img.id}
                data-node-canvas-image={img.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copy';
                  event.dataTransfer.setData(CANVAS_ASSET_DRAG_MIME, serializeCanvasAssetDragPayload(img));
                  event.dataTransfer.setData('text/uri-list', img.url);
                  event.dataTransfer.setData('text/plain', img.url);
                }}
                className="shrink-0 w-14 h-14 rounded border border-border/20 overflow-hidden bg-muted/30 relative group cursor-grab active:cursor-grabbing"
                title={img.description || img.name || `图片 ${i+1}`}
              >
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
      {nodeAnnotationCandidates && (
        <div
          className="fixed inset-0 z-[205] flex items-center justify-center bg-black/65 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="node-annotation-image-picker-title"
          onClick={() => setNodeAnnotationCandidates(null)}
        >
          <div
            className="w-full max-w-2xl rounded-md border border-border bg-card p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="node-annotation-image-picker-title" className="text-sm font-semibold">
                选择要批注的图片
              </h2>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setNodeAnnotationCandidates(null)}
                aria-label="关闭图片选择"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
              {nodeAnnotationCandidates.candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className="overflow-hidden rounded-md border border-border bg-muted text-left transition-colors hover:border-primary"
                  onClick={() => {
                    const sourceNode = wf.nodes.find(
                      (node) => node.id === nodeAnnotationCandidates.sourceNodeId,
                    );
                    if (!sourceNode) return;
                    if (nodeAnnotationCandidates.existingBundle) {
                      openNodeAnnotation(
                        sourceNode,
                        candidate,
                        nodeAnnotationCandidates.existingBundle,
                      );
                    } else {
                      openNodeAnnotation(sourceNode, candidate);
                    }
                  }}
                >
                  <span className="relative block aspect-square bg-[#0d1117]">
                    <NextImage
                      unoptimized
                      fill
                      sizes="220px"
                      src={candidate.url}
                      alt={candidate.label}
                      className="object-contain"
                    />
                  </span>
                  <span className="block truncate px-2 py-1.5 text-xs">
                    {candidate.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {nodeAnnotationSession && (
        <NodeAnnotationWorkspace
          source={nodeAnnotationSession.source}
          models={annotationModels}
          initialBundle={nodeAnnotationSession.existingBundle}
          preferredModelId={preferredAnnotationModelId}
          onCreateNode={handleCreateAnnotationNode}
          onClose={() => setNodeAnnotationSession(null)}
        />
      )}
      {aiBuildOpen && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-build-title"
          onClick={() => setAiBuildOpen(false)}
        >
          <div
            data-modal
            className="w-full max-w-xl rounded-lg border border-border bg-card p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 id="ai-build-title" className="text-base font-semibold text-foreground">AI 建图</h2>
                <p className="mt-1 text-xs text-muted-foreground">描述目标工作流，系统会生成可继续编辑的节点与连线。</p>
              </div>
              <button
                type="button"
                onClick={() => setAiBuildOpen(false)}
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="关闭 AI 建图"
                title="关闭"
              >
                <X size={18} />
              </button>
            </div>
            <textarea
              autoFocus
              value={aiBuildInput}
              onChange={(event) => setAiBuildInput(event.target.value)}
              placeholder="例如：上传商品图，生成电商主图，放大后导出 PNG"
              className="min-h-32 w-full resize-y rounded border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            />
            {aiBuildError && <p className="mt-2 text-xs text-destructive" role="alert">{aiBuildError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAiBuildOpen(false)}
                className="rounded px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleAiBuild()}
                disabled={!aiBuildInput.trim() || aiBuildLoading}
                className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              >
                {aiBuildLoading ? '生成中...' : '生成工作流'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                      updateWorkflow(prev => ({ ...prev, nodes: parsed.nodes, connections: parsed.connections }));
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
                <div className="context-menu-item" onClick={() => handleContextAction('annotate')}>
                  <MessageSquare size={16} className="text-muted-foreground" />
                  批注修改
                </div>
                <div className="context-menu-divider" />
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

// ==================== 属性面板 ====================

interface PropertyPanelProps {
  node: WorkflowNode | null;
  models: ModelOption[];
  modelCatalogIndex: Map<string, TaskModelDescriptor>;
  modelsLoading: boolean;
  onUpdate: (nodeId: string, updates: Partial<WorkflowNode>) => void;
  onDelete: (nodeId: string) => void;
  onImageUpload: (nodeId: string, file: File) => void;
  /** P0: 画布图片列表，用于@图片引用 */
  canvasImages?: CanvasImageRef[];
  onCanvasImageSelect: (nodeId: string, image: CanvasImageRef) => Promise<void>;
}

function PropertyPanel({ node, models, modelCatalogIndex, modelsLoading, onUpdate, onDelete, onImageUpload, canvasImages, onCanvasImageSelect }: PropertyPanelProps) {
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
  const isCanvasFeature = ['ai-font-design', 'ai-refine-engine', 'ai-human-repair', 'ai-brand-ecommerce', 'ai-segment', 'ai-multi-angle', 'ai-3d-model'].includes(node.type);
  const configuredModel = String(node.config?.model || '');
  const configuredModelSeparator = configuredModel.indexOf('::');
  const configuredProviderId = configuredModelSeparator >= 0
    ? configuredModel.slice(0, configuredModelSeparator)
    : String(node.config?.providerId || '');
  const configuredModelId = configuredModelSeparator >= 0
    ? configuredModel.slice(configuredModelSeparator + 2)
    : configuredModel;
  const configuredDescriptor = modelCatalogIndex.get(taskModelKey(configuredProviderId, configuredModelId));

  const renderField = (field: PropertyField) => {
    const externalValue = node.config?.[field.key] ?? (node as unknown as Record<string, unknown>)[field.key] ?? field.defaultValue ?? '';
    const serializedExternalValue = (
      externalValue
      && typeof externalValue === 'object'
    )
      ? JSON.stringify(externalValue, null, 2)
      : String(externalValue);
    // 聚焦时使用本地缓存值，避免每次按键触发 onUpdate → 重渲染 → 闪烁
    const isFocused = focusedField === `${node.id}:${field.key}`;
    const displayValue = isFocused
      ? (localTextValues[field.key] ?? serializedExternalValue)
      : serializedExternalValue;

    const onChangeText = (val: string) => {
      // 更新本地缓存
      setLocalTextValues(prev => ({ ...prev, [field.key]: val }));
    };

    const onFocusField = () => {
      setFocusedField(`${node.id}:${field.key}`);
      setLocalTextValues(prev => ({
        ...prev,
        [field.key]: serializedExternalValue,
      }));
    };

    const onBlurField = () => {
      setFocusedField(null);
      if (field.readOnly) return;
      // 失焦时同步到父组件
      const localVal = localTextValues[field.key];
      if (localVal !== undefined && localVal !== serializedExternalValue) {
        onUpdate(node.id, field.key === 'label'
          ? { label: localVal }
          : { config: { [field.key]: localVal } });
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
            readOnly={field.readOnly}
            placeholder={field.placeholder}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 read-only:cursor-default read-only:opacity-75"
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
              readOnly={field.readOnly}
              placeholder={isPromptField && canvasImages && canvasImages.length > 0 ? `${field.placeholder} (输入@引用画布图片)` : field.placeholder}
              rows={3}
              className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-y read-only:cursor-default read-only:opacity-75"
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
            max={field.key === 'count' || field.key === 'n'
              ? configuredDescriptor?.maxOutputs || field.max
              : field.max}
            step={field.step || 1}
            placeholder={field.placeholder}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        );

      case 'select': {
        let dynamicOptions = field.options;
        const configuredModel = String(node.config?.model || '');
        const separatorIndex = configuredModel.indexOf('::');
        const selectedProviderId = separatorIndex >= 0
          ? configuredModel.slice(0, separatorIndex)
          : String(node.config?.providerId || '');
        const selectedModelId = separatorIndex >= 0
          ? configuredModel.slice(separatorIndex + 2)
          : configuredModel;
        const selectedDescriptor = modelCatalogIndex.get(taskModelKey(selectedProviderId, selectedModelId));
        if (selectedDescriptor && field.key === 'quality') {
          dynamicOptions = selectedDescriptor.qualityOptions.map(value => ({ value, label: value }));
        }
        if (selectedDescriptor && field.key === 'resolution') {
          dynamicOptions = selectedDescriptor.allowedSizes.map(value => ({ value, label: value }));
        }
        if (selectedDescriptor && field.key === 'aspectRatio') {
          dynamicOptions = selectedDescriptor.allowedRatios.map(value => ({ value, label: value }));
        }
        if (selectedDescriptor && (field.key === 'duration' || field.key === 'durationSeconds')) {
          dynamicOptions = (selectedDescriptor.allowedDurationsSeconds || []).map(value => ({
            value: String(value),
            label: `${value} 秒`,
          }));
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
        const cfgProviderId = node.config?.providerId as string | undefined;
        const persistedKey = currentModelId && cfgProviderId && !parseExactModelKey(currentModelId)
          ? `${cfgProviderId}::${currentModelId}`
          : currentModelId;
        const currentCompositeValue = resolvePersistedModelSelection(
          persistedKey,
          models.filter(m => m.type === modelFilterType && m.providerId)
            .map(m => ({ id: m.id, providerId: m.providerId! })),
        ).compositeKey || '';
        return (
          <select
            value={currentCompositeValue}
            onChange={e => {
              const selectedValue = e.target.value;
              // 解析复合键: providerId::modelId
              const sepIdx = selectedValue.indexOf('::');
              const selectedModelId = sepIdx >= 0 ? selectedValue.slice(sepIdx + 2) : selectedValue;
              const selectedProviderId = sepIdx >= 0 ? selectedValue.slice(0, sepIdx) : '';
              const configUpdate: Record<string, string | number> = {};
              configUpdate[field.key] = selectedValue;
              // 保存providerId到节点config
              if (selectedProviderId) {
                configUpdate.providerId = selectedProviderId;
              }
              // 只在旧值不受新模型支持时归一化，保留仍然合法的用户选择。
              if (selectedModelId) {
                const selectedDescriptor = modelCatalogIndex.get(taskModelKey(selectedProviderId, selectedModelId));
                if (selectedDescriptor) {
                  if (
                    selectedDescriptor.qualityOptions.length > 0
                    && !selectedDescriptor.qualityOptions.includes(String(node.config?.quality || ''))
                  ) {
                    configUpdate.quality = selectedDescriptor.qualityOptions[0];
                  }
                  if (
                    selectedDescriptor.allowedSizes.length > 0
                    && !selectedDescriptor.allowedSizes.includes(String(node.config?.resolution || ''))
                  ) {
                    configUpdate.resolution = selectedDescriptor.allowedSizes[0];
                  }
                  if (
                    selectedDescriptor.allowedRatios.length > 0
                    && !selectedDescriptor.allowedRatios.includes(String(node.config?.aspectRatio || ''))
                  ) {
                    configUpdate.aspectRatio = selectedDescriptor.allowedRatios[0];
                  }
                  const durations = selectedDescriptor.allowedDurationsSeconds || [];
                  if (
                    durations.length > 0
                    && !durations.includes(Number(node.config?.duration ?? node.config?.durationSeconds))
                  ) {
                    configUpdate.duration = durations[0];
                  }
                  const currentCount = Number(node.config?.count ?? node.config?.n ?? 1);
                  if (currentCount > selectedDescriptor.maxOutputs) {
                    configUpdate.count = selectedDescriptor.maxOutputs;
                  }
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
                  <div className="relative flex-1 group/canvas">
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
                    <div style={{ display: 'none' }} className="absolute right-0 top-full mt-1 w-64 max-h-40 overflow-y-auto bg-muted border border-border rounded shadow-lg z-50">
                      {canvasImages.map((img, idx) => (
                        <button
                          key={img.id}
                          className="w-full px-3 py-2 text-left text-xs text-foreground hover:bg-primary/10 hover:text-primary cursor-pointer truncate transition-colors"
                          onClick={() => {
                            void onCanvasImageSelect(node.id, img);
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

      <WorkspaceSourceTraceDetails sourceTrace={node.config.sourceTrace} />

      {/* 属性字段 — 与原型对齐: 逐字段垂直排列, px-4 py-2 间距 */}
      {fields.map(field => (
        <div key={field.key} data-node-field={field.key} className="px-4 py-2">
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">{field.label}</label>
          {field.key === 'aspectRatio' ? (
            /* 比例选择器 — 与原型对齐: 4列grid + ratio-btn样式 */
            <div className="grid grid-cols-4 gap-2">
              {(configuredDescriptor?.allowedRatios.map(value => ({ value, label: value })) || field.options || []).map(opt => {
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
              {(configuredDescriptor?.qualityOptions.map(value => ({ value, label: value })) || field.options || []).map(opt => {
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
