'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  WorkflowNode, WorkflowConnection, Workflow as WorkflowData, NodeType, NodeCategory,
  NODE_TYPE_COLORS, NODE_TYPE_LABELS, NODE_TYPE_ICONS, NODE_CATEGORY_LABELS,
  PORT_COLORS, NodePort, PortType, PropertyField,
  createWorkflowNode, createConnection, createEmptyWorkflow, createDemoWorkflow,
  getNodePropertyFields, getNodeCategory, NODE_TEMPLATES,
  canConnectPorts, autoLayoutWorkflow, parseComfyUIWorkflow,
} from '@/lib/workflow-engine';
import {
  Image as ImageIcon, Type, SlidersHorizontal, Wand2, Pencil, Maximize, Scissors,
  PenTool, Palette, Sun, GitBranch, GitMerge, Repeat, RefreshCw, Layers,
  Bot, MessageSquare, ImageDown, Save, Download, Play, Square,
  FileInput,
  ChevronRight, ChevronDown, Plus, Trash2, ZoomIn, ZoomOut, RotateCcw,
  Settings, Upload, X, Check, AlertCircle, Loader2, BoxSelect, Group,
  Search, ScanSearch, Eye, Pause, SkipForward, Workflow as WorkflowIcon, Timer,
  ArrowLeft, LayoutGrid, Sparkles, MessageCircle, Rotate3d, Box, ShoppingBag, Zap,
  Copy, Clipboard, Package, Film,
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

interface ModelOption { id: string; name: string; type: string; provider: string; }

interface MaterialItem {
  id: string;
  type: 'image' | 'prompt' | 'color';
  value: string;
  label: string;
  tags: string[];
  createdAt: number;
}

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
  description: string;
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
}

export default function NodeEditor({ workflow, onBack, onWorkflowChange, onOpenWorkflowHub, canvasImages }: NodeEditorProps) {
  const [wf, setWf] = useState<WorkflowData>(workflow || createDemoWorkflow());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [draggingConn, setDraggingConn] = useState<DraggingConn | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 0.8 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, vx: 0, vy: 0 });
  const [sidebarTab, setSidebarTab] = useState<'nodes' | 'props' | 'ai-build' | 'presets' | 'prompts' | 'assistant' | 'materials'>('nodes');
  const [searchQuery, setSearchQuery] = useState('');
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [execStatus, setExecStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [execResults, setExecResults] = useState<Record<string, { status: string; output?: Record<string, unknown>; error?: string }>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showMinimap, setShowMinimap] = useState(true);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [highlightNodeId, setHighlightNodeId] = useState<string | null>(null);

  // P2: build_mode检测 — 生产环境禁用部分开发功能
  const isBuildMode = typeof process !== 'undefined' && process.env?.COZE_PROJECT_ENV === 'PROD';

  // AI建图状态
  const [aiBuildInput, setAiBuildInput] = useState('');
  const [aiBuildLoading, setAiBuildLoading] = useState(false);
  const [aiBuildError, setAiBuildError] = useState<string | null>(null);

  // P1: 执行日志
  const [execLogs, setExecLogs] = useState<{ time: number; nodeId: string; label: string; status: string; message: string }[]>([]);

  // P1: 节点复制粘贴
  const [clipboard, setClipboard] = useState<{ nodes: WorkflowNode[]; connections: WorkflowConnection[] } | null>(null);

  // P1: 素材库
  const [materials, setMaterials] = useState<MaterialItem[]>(() => {
    try {
      const saved = localStorage.getItem('wujie-workflow-materials');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [materialInput, setMaterialInput] = useState('');
  const [materialLabel, setMaterialLabel] = useState('');
  const [materialType, setMaterialType] = useState<'image' | 'prompt' | 'color'>('prompt');
  const [materialTags, setMaterialTags] = useState('');
  const [materialFilter, setMaterialFilter] = useState<'all' | 'image' | 'prompt' | 'color'>('all');

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
  const isUndoRedoRef = useRef(false);

  // P2: 画布助手 (节点感知)
  const [assistantMessages, setAssistantMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);

  // P2: JSON编辑器
  const [jsonEditorOpen, setJsonEditorOpen] = useState(false);
  const [jsonEditContent, setJsonEditContent] = useState('');

  // P2: 保存历史快照 (每次wf变化时记录)
  const prevWfRef = useRef(wf);
  useEffect(() => {
    if (isUndoRedoRef.current) { isUndoRedoRef.current = false; return; }
    if (prevWfRef.current === wf) return;
    prevWfRef.current = wf;
    const entry: HistoryEntry = { nodes: wf.nodes, connections: wf.connections, label: '变更' };
    setHistoryStack(prev => {
      const newStack = prev.slice(0, historyIndex + 1);
      newStack.push(entry);
      if (newStack.length > 50) newStack.shift();
      return newStack;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [wf, historyIndex]);

  // P2: 撤销/重做函数
  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;
    isUndoRedoRef.current = true;
    const entry = historyStack[historyIndex - 1];
    setWf(prev => ({ ...prev, nodes: entry.nodes, connections: entry.connections }));
    setHistoryIndex(prev => prev - 1);
  }, [historyStack, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex >= historyStack.length - 1) return;
    isUndoRedoRef.current = true;
    const entry = historyStack[historyIndex + 1];
    setWf(prev => ({ ...prev, nodes: entry.nodes, connections: entry.connections }));
    setHistoryIndex(prev => prev + 1);
  }, [historyStack, historyIndex]);

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
  const { models, loading: modelsLoading } = useModelList();

  const selectedNode = useMemo(() => wf.nodes.find(n => n.id === selectedNodeId) || null, [wf.nodes, selectedNodeId]);

  // 同步外部workflow变化
  useEffect(() => {
    if (workflow) setWf(workflow);
  }, [workflow]);

  // 通知外部
  useEffect(() => {
    onWorkflowChange?.(wf);
  }, [wf, onWorkflowChange]);

  // ─── 节点操作 ───

  const handleAddNode = useCallback((type: NodeType) => {
    const node = createWorkflowNode(type, 300 + Math.random() * 200, 200 + Math.random() * 200);
    setWf(prev => ({ ...prev, nodes: [...prev.nodes, node] }));
    setSelectedNodeId(node.id);
    setSidebarTab('props');
  }, []);

  const handleDeleteNode = useCallback((nodeId: string) => {
    setWf(prev => ({
      ...prev,
      nodes: prev.nodes.filter(n => n.id !== nodeId),
      connections: prev.connections.filter(c => c.fromNodeId !== nodeId && c.toNodeId !== nodeId),
    }));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [selectedNodeId]);

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

  // P1: 键盘快捷键 (复制/粘贴/删除)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      // Ctrl+C / Cmd+C 复制选中节点
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selectedNodeId) {
        e.preventDefault();
        const node = wf.nodes.find(n => n.id === selectedNodeId);
        if (node) {
          const relatedConns = wf.connections.filter(c => c.fromNodeId === selectedNodeId || c.toNodeId === selectedNodeId);
          setClipboard({ nodes: [node], connections: relatedConns });
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
          setSelectedNodeId(newNodes[0].id);
          setSidebarTab('props');
        }
      }
      // Delete / Backspace 删除选中节点
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        e.preventDefault();
        handleDeleteNode(selectedNodeId);
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
  }, [selectedNodeId, clipboard, wf, handleDeleteNode, handleUndo, handleRedo]);

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
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY, vx: viewport.x, vy: viewport.y });
    } else if (e.button === 0 && !draggingConn) {
      setSelectedNodeId(null);
      setSidebarTab('nodes');
    }
  }, [viewport, draggingConn]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setViewport(v => ({ ...v, x: panStart.vx + (e.clientX - panStart.x), y: panStart.vy + (e.clientY - panStart.y) }));
    } else if (draggingNode) {
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (!svgRect) return;
      const mx = (e.clientX - svgRect.left - viewport.x) / viewport.zoom;
      const my = (e.clientY - svgRect.top - viewport.y) / viewport.zoom;
      setWf(prev => ({
        ...prev,
        nodes: prev.nodes.map(n => n.id === draggingNode ? { ...n, x: mx - dragOffset.x, y: my - dragOffset.y } : n),
      }));
    } else if (draggingConn) {
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (!svgRect) return;
      const mx = (e.clientX - svgRect.left - viewport.x) / viewport.zoom;
      const my = (e.clientY - svgRect.top - viewport.y) / viewport.zoom;
      setDraggingConn(prev => prev ? { ...prev, toX: mx, toY: my } : null);
    }
  }, [isPanning, panStart, draggingNode, dragOffset, viewport, draggingConn]);

  const handleCanvasMouseUp = useCallback(() => {
    setIsPanning(false);
    setDraggingNode(null);
    setDraggingConn(null);
  }, []);

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
    const interval = setInterval(async () => {
      try {
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
          clearInterval(interval);
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
        clearInterval(interval);
      }
    });
    return () => clearInterval(interval);
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

  const handleImageUpload = useCallback(async (nodeId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/save-image', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.url) {
        handleNodeUpdate(nodeId, { config: { imageUrl: data.url, source: 'upload' } });
      }
    } catch (e) {
      console.error('[NodeEditor] 图片上传失败:', e);
    }
  }, [handleNodeUpdate]);

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
        setSelectedNodeId(null);
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
    setSelectedNodeId(null);
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
    <div className="h-screen w-screen flex bg-[#0d0d0d] text-gray-200 overflow-hidden select-none">
      {/* 左侧栏 */}
      <div className="w-[280px] flex flex-col border-r border-gray-800 bg-[#111] flex-shrink-0">
        {/* 标签切换 */}
        <div className="flex border-b border-gray-800 flex-wrap">
          {([
            { key: 'nodes', label: '节点库' },
            { key: 'props', label: '属性' },
            { key: 'ai-build', label: 'AI建图' },
            { key: 'presets', label: '预设' },
            { key: 'prompts', label: '词库' },
            { key: 'assistant', label: '助手' },
            { key: 'materials', label: '素材' },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setSidebarTab(tab.key)}
              className={`flex-1 py-2 text-[10px] font-medium transition-colors cursor-pointer min-w-0 ${sidebarTab === tab.key ? 'text-[#d4af37] border-b-2 border-[#d4af37]' : 'text-gray-500 hover:text-gray-300'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 节点库 Tab */}
        {sidebarTab === 'nodes' && (
          <div className="flex-1 overflow-y-auto">
            <div className="p-2 sticky top-0 bg-[#111] z-10">
              <div className="relative">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索节点..."
                  className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-7 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#d4af37]/50"
                />
              </div>
            </div>
            {Object.entries(groupedTemplates).map(([cat, templates]) => (
              <div key={cat} className="mb-2">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_TYPE_COLORS[cat as NodeCategory] }} />
                  {NODE_CATEGORY_LABELS[cat as NodeCategory]}
                </div>
                {templates.map(t => (
                  <button
                    key={t.type}
                    onClick={() => handleAddNode(t.type)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/5 transition-colors cursor-pointer group"
                  >
                    <span className="text-gray-400 group-hover:text-[#d4af37] transition-colors">
                      {getNodeIcon(t.type, 14)}
                    </span>
                    <div className="flex-1 text-left">
                      <div className="text-gray-300 group-hover:text-white">{t.label}</div>
                      <div className="text-[10px] text-gray-600">{t.desc}</div>
                    </div>
                    <Plus size={12} className="text-gray-600 group-hover:text-[#d4af37] opacity-0 group-hover:opacity-100 transition-all" />
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
            canvasImages={canvasImages}
          />
        )}

        {/* AI建图 Tab */}
        {sidebarTab === 'ai-build' && (
          <div className="flex-1 flex flex-col p-3">
            <div className="mb-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles size={14} className="text-[#d4af37]" />
                <span className="text-xs font-semibold text-[#d4af37]">AI 自然语言建图</span>
              </div>
              <p className="text-[10px] text-gray-500 mb-2">描述你想要的图像处理需求，AI自动生成完整工作流</p>
            </div>
            <textarea
              value={aiBuildInput}
              onChange={e => setAiBuildInput(e.target.value)}
              placeholder={"例如:\n帮我生成一张赛博朋克风格的城市夜景图，然后去除背景，再放大2倍\n\n或者:\n我要给产品图做商业精修，影棚灯光，白色背景，然后导出PNG"}
              className="flex-1 min-h-[140px] bg-[#1a1a1a] border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#d4af37]/50 resize-none"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAIBuild(); }}
            />
            {aiBuildError && (
              <div className="mt-2 text-[10px] text-red-400 bg-red-900/20 rounded px-2 py-1">{aiBuildError}</div>
            )}
            <button
              onClick={handleAIBuild}
              disabled={aiBuildLoading || !aiBuildInput.trim()}
              className="mt-2 w-full py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed bg-[#d4af37]/20 text-[#d4af37] hover:bg-[#d4af37]/30"
            >
              {aiBuildLoading ? <><Loader2 size={12} className="animate-spin" /> 生成中...</> : <><Sparkles size={12} /> 生成工作流</>}
            </button>
            <div className="mt-3 text-[10px] text-gray-600">
              <p className="mb-1">快捷示例:</p>
              <div className="space-y-1">
                {['生成产品精修图，影棚灯光', '去背景+放大2倍导出PNG', '字境大师生成书法字体Logo', '多角度生成产品四视图'].map(ex => (
                  <button
                    key={ex}
                    onClick={() => setAiBuildInput(ex)}
                    className="block w-full text-left px-2 py-1 rounded bg-[#1a1a1a] hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
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
                  <div className="w-8 h-8 rounded-lg bg-[#1a1a1a] flex items-center justify-center flex-shrink-0 group-hover:bg-[#d4af37]/10 transition-colors">
                    <IconComp size={14} className="text-gray-500 group-hover:text-[#d4af37] transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-300 group-hover:text-white">{preset.name}</div>
                    <div className="text-[10px] text-gray-600">{preset.description}</div>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {preset.tags.map(tag => (
                        <span key={tag} className="text-[8px] px-1 py-0.5 rounded bg-[#1a1a1a] text-gray-500">{tag}</span>
                      ))}
                    </div>
                    <div className="text-[9px] text-gray-700 mt-0.5">{preset.nodes.length} 节点 · {preset.connections.length} 连线</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* P2: 提示词库 Tab */}
        {sidebarTab === 'prompts' && (
          <div className="flex-1 overflow-y-auto flex flex-col">
            <div className="p-2 border-b border-gray-800">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  value={promptSearch}
                  onChange={e => setPromptSearch(e.target.value)}
                  placeholder="搜索提示词..."
                  className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-6 py-1 text-[10px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#d4af37]/50"
                />
              </div>
            </div>
            <div className="p-2 space-y-2 border-b border-gray-800">
              <textarea
                value={newSnippetText}
                onChange={e => setNewSnippetText(e.target.value)}
                placeholder="输入新提示词..."
                className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#d4af37]/50 resize-none h-14"
              />
              <div className="flex gap-1">
                <input
                  value={newSnippetTags}
                  onChange={e => setNewSnippetTags(e.target.value)}
                  placeholder="标签(逗号分隔)"
                  className="flex-1 bg-[#1a1a1a] border border-gray-700 rounded px-2 py-0.5 text-[10px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#d4af37]/50"
                />
                <select
                  value={newSnippetCategory}
                  onChange={e => setNewSnippetCategory(e.target.value)}
                  className="bg-[#1a1a1a] border border-gray-700 rounded px-1 py-0.5 text-[10px] text-gray-200 focus:outline-none"
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
                className="w-full py-1 text-[10px] rounded bg-[#d4af37]/20 text-[#d4af37] hover:bg-[#d4af37]/30 transition-colors cursor-pointer"
              >
                保存提示词
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {promptSnippets
                .filter(s => !promptSearch || s.text.toLowerCase().includes(promptSearch.toLowerCase()) || s.tags.some(t => t.toLowerCase().includes(promptSearch.toLowerCase())))
                .map(snippet => (
                  <div key={snippet.id} className="px-2 py-1.5 border-b border-gray-800/50 hover:bg-white/5 group">
                    <div className="text-[10px] text-gray-300 line-clamp-2">{snippet.text}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[8px] px-1 py-0.5 rounded bg-[#1a1a1a] text-gray-500">{snippet.category}</span>
                      {snippet.tags.map(t => (
                        <span key={t} className="text-[8px] text-gray-600">#{t}</span>
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
                        className="text-[8px] text-[#d4af37] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
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
                        className="text-[8px] text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              {promptSnippets.length === 0 && (
                <div className="p-4 text-center text-[10px] text-gray-600">暂无保存的提示词<br />在上方输入框添加</div>
              )}
            </div>
          </div>
        )}

        {/* P2: 画布助手 (节点感知) Tab */}
        {sidebarTab === 'assistant' && (
          <div className="flex-1 flex flex-col">
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
                  <div className="text-[9px] px-2 py-1.5 rounded bg-[#d4af37]/10 text-[#d4af37]/80 border border-[#d4af37]/20">
                    感知节点: [{selectedNode.type}] {selectedNode.label}
                    <div className="mt-1 text-[#d4af37]/60">
                      上游链路: {upstreamNodes.map(n => `[${n.type}]${n.label}`).join(' → ')} → [{selectedNode.type}]{selectedNode.label}
                    </div>
                  </div>
                ) : (
                  <div className="text-[9px] px-2 py-1 rounded bg-[#d4af37]/10 text-[#d4af37]/80 border border-[#d4af37]/20">
                    感知节点: [{selectedNode.type}] {selectedNode.label}
                  </div>
                );
              })()}
              {assistantMessages.length === 0 && (
                <div className="text-center text-[10px] text-gray-600 py-8">
                  <MessageCircle size={20} className="mx-auto mb-2 text-gray-700" />
                  工作流助手
                  <br />
                  <span className="text-gray-700">选中节点后可获取上下文感知建议</span>
                </div>
              )}
              {assistantMessages.map((msg, i) => (
                <div key={i} className={`text-[10px] px-2 py-1.5 rounded ${msg.role === 'user' ? 'bg-[#1a1a1a] text-gray-300 ml-4' : 'bg-[#d4af37]/10 text-gray-300 mr-4'}`}>
                  <div className="text-[8px] text-gray-600 mb-0.5">{msg.role === 'user' ? '你' : '助手'}</div>
                  {msg.content}
                </div>
              ))}
              {assistantLoading && (
                <div className="text-[10px] px-2 py-1.5 rounded bg-[#d4af37]/10 text-gray-400 mr-4">
                  <Loader2 size={10} className="animate-spin inline mr-1" />思考中...
                </div>
              )}
            </div>
            <div className="p-2 border-t border-gray-800 flex gap-1">
              <input
                value={assistantInput}
                onChange={e => setAssistantInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAssistantMessage(); } }}
                placeholder="输入问题..."
                className="flex-1 bg-[#1a1a1a] border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#d4af37]/50"
              />
              <button onClick={sendAssistantMessage} disabled={assistantLoading || !assistantInput.trim()} className="p-1 rounded bg-[#d4af37]/20 text-[#d4af37] hover:bg-[#d4af37]/30 transition-colors cursor-pointer disabled:opacity-30">
                <Zap size={12} />
              </button>
            </div>
          </div>
        )}

        {/* P1: 素材库 Tab */}
        {sidebarTab === 'materials' && (
          <div className="flex-1 flex flex-col">
            <div className="p-2 border-b border-gray-800">
              <div className="flex gap-1 mb-2">
                {(['all', 'prompt', 'image', 'color'] as const).map(t => (
                  <button key={t} onClick={() => setMaterialFilter(t)}
                    className={`px-2 py-0.5 rounded text-[9px] transition-colors cursor-pointer ${materialFilter === t ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-[#1a1a1a] text-gray-500 hover:text-gray-300'}`}>
                    {t === 'all' ? '全部' : t === 'prompt' ? '提示词' : t === 'image' ? '图片' : '颜色'}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                <select value={materialType} onChange={e => setMaterialType(e.target.value as 'image' | 'prompt' | 'color')}
                  className="bg-[#1a1a1a] border border-gray-700 rounded px-1 py-0.5 text-[9px] text-gray-300 focus:outline-none">
                  <option value="prompt">提示词</option>
                  <option value="image">图片URL</option>
                  <option value="color">颜色</option>
                </select>
                <input value={materialLabel} onChange={e => setMaterialLabel(e.target.value)} placeholder="名称"
                  className="flex-1 bg-[#1a1a1a] border border-gray-700 rounded px-1.5 py-0.5 text-[9px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#d4af37]/50" />
              </div>
              <div className="flex gap-1 mt-1">
                <input value={materialInput} onChange={e => setMaterialInput(e.target.value)}
                  placeholder={materialType === 'color' ? '#ff6600' : materialType === 'image' ? '图片URL' : '提示词内容'}
                  className="flex-1 bg-[#1a1a1a] border border-gray-700 rounded px-1.5 py-0.5 text-[9px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#d4af37]/50" />
                <input value={materialTags} onChange={e => setMaterialTags(e.target.value)} placeholder="标签(逗号分隔)"
                  className="w-20 bg-[#1a1a1a] border border-gray-700 rounded px-1.5 py-0.5 text-[9px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#d4af37]/50" />
              </div>
              <button
                onClick={() => {
                  if (!materialInput.trim()) return;
                  const newMat: MaterialItem = {
                    id: `mat-${Date.now()}`,
                    type: materialType,
                    value: materialInput.trim(),
                    label: materialLabel.trim() || (materialType === 'prompt' ? '提示词' : materialType === 'image' ? '图片' : '颜色'),
                    tags: materialTags.split(',').map(t => t.trim()).filter(Boolean),
                    createdAt: Date.now(),
                  };
                  const next = [...materials, newMat];
                  setMaterials(next);
                  localStorage.setItem('wujie-workflow-materials', JSON.stringify(next));
                  setMaterialInput(''); setMaterialLabel(''); setMaterialTags('');
                }}
                className="w-full mt-1.5 py-1 rounded bg-[#d4af37]/20 text-[#d4af37] text-[10px] font-medium hover:bg-[#d4af37]/30 transition-colors cursor-pointer"
              >
                添加素材
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {materials.filter(m => materialFilter === 'all' || m.type === materialFilter).length === 0 && (
                <div className="text-center text-[10px] text-gray-600 py-8">
                  <Package size={20} className="mx-auto mb-2 text-gray-700" />
                  素材库
                  <br />
                  <span className="text-gray-700">保存常用提示词、图片和颜色</span>
                </div>
              )}
              {materials.filter(m => materialFilter === 'all' || m.type === materialFilter).map(mat => (
                <div key={mat.id} className="bg-[#1a1a1a] border border-gray-800 rounded p-2 group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {mat.type === 'color' ? (
                        <div className="w-3 h-3 rounded-sm border border-gray-700 flex-shrink-0" style={{ backgroundColor: mat.value }} />
                      ) : mat.type === 'image' ? (
                        <ImageIcon size={10} className="text-blue-400 flex-shrink-0" />
                      ) : (
                        <Type size={10} className="text-green-400 flex-shrink-0" />
                      )}
                      <span className="text-[9px] text-gray-300 truncate">{mat.label}</span>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => {
                          // 填入当前选中节点的prompt字段
                          const node = wf.nodes.find(n => n.id === selectedNodeId);
                          if (node && selectedNodeId && (node.config.prompt !== undefined || mat.type === 'prompt')) {
                            const currentPrompt = (node.config.prompt as string) || '';
                            handleNodeUpdate(selectedNodeId, { config: { prompt: currentPrompt ? `${currentPrompt}, ${mat.value}` : mat.value } });
                          }
                        }}
                        className="p-0.5 rounded text-[#d4af37] hover:bg-[#d4af37]/10 cursor-pointer" title="填入节点"
                      >
                        <Zap size={8} />
                      </button>
                      <button
                        onClick={() => {
                          const next = materials.filter(m => m.id !== mat.id);
                          setMaterials(next);
                          localStorage.setItem('wujie-workflow-materials', JSON.stringify(next));
                        }}
                        className="p-0.5 rounded text-red-400 hover:bg-red-400/10 cursor-pointer" title="删除"
                      >
                        <X size={8} />
                      </button>
                    </div>
                  </div>
                  <div className="text-[8px] text-gray-500 mt-0.5 truncate">{mat.value}</div>
                  {mat.tags.length > 0 && (
                    <div className="flex gap-0.5 mt-1 flex-wrap">
                      {mat.tags.map((tag, i) => (
                        <span key={i} className="px-1 py-0 rounded bg-gray-800 text-[7px] text-gray-500">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 主画布 */}
      <div className="flex-1 relative">
        {/* 顶部工具栏 */}
        <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onBack && (
              <button onClick={onBack} className="p-1.5 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 hover:text-white transition-colors cursor-pointer" title="返回画布">
                <ArrowLeft size={14} />
              </button>
            )}
            <span className="text-sm font-semibold text-[#d4af37]">{wf.name}</span>
            <span className="text-[10px] text-gray-600">v{wf.version}</span>
            <span className="text-[10px] text-gray-700">|</span>
            <span className="text-[10px] text-gray-500">{wf.nodes.length} 节点 · {wf.connections.length} 连线</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={handleAutoLayout} className="p-1.5 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 hover:text-white transition-colors cursor-pointer" title="自动布局">
              <LayoutGrid size={14} />
            </button>
            {/* P1: 复制粘贴按钮 */}
            <button
              onClick={() => {
                if (!selectedNodeId) return;
                const node = wf.nodes.find(n => n.id === selectedNodeId);
                if (node) {
                  const relatedConns = wf.connections.filter(c => c.fromNodeId === selectedNodeId || c.toNodeId === selectedNodeId);
                  setClipboard({ nodes: [node], connections: relatedConns });
                }
              }}
              disabled={!selectedNodeId}
              className="p-1.5 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title="复制节点 (Ctrl+C)"
            >
              <Copy size={14} />
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
                if (newNodes.length > 0) { setSelectedNodeId(newNodes[0].id); setSidebarTab('props'); }
              }}
              disabled={!clipboard}
              className="p-1.5 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title="粘贴节点 (Ctrl+V)"
            >
              <Clipboard size={14} />
            </button>
            <button onClick={() => setViewport(v => ({ ...v, zoom: Math.min(3, v.zoom * 1.2) }))} className="p-1.5 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 hover:text-white transition-colors cursor-pointer">
              <ZoomIn size={14} />
            </button>
            <span className="text-[10px] text-gray-500 w-10 text-center">{Math.round(viewport.zoom * 100)}%</span>
            <button onClick={() => setViewport(v => ({ ...v, zoom: Math.max(0.2, v.zoom * 0.8) }))} className="p-1.5 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 hover:text-white transition-colors cursor-pointer">
              <ZoomOut size={14} />
            </button>
            <button onClick={() => setViewport({ x: 0, y: 0, zoom: 0.8 })} className="p-1.5 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 hover:text-white transition-colors cursor-pointer">
              <RotateCcw size={14} />
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
              className="p-1.5 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 hover:text-white transition-colors cursor-pointer"
              title="导入ComfyUI工作流"
            >
              <FileInput size={14} />
            </button>
            <div className="w-px h-4 bg-gray-800 mx-1" />
            {/* P2: 撤销重做按钮 */}
            <button onClick={handleUndo} disabled={historyIndex <= 0} className="p-1.5 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="撤销 (Ctrl+Z)">
              <RotateCcw size={14} />
            </button>
            <button onClick={handleRedo} disabled={historyIndex >= historyStack.length - 1} className="p-1.5 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="重做 (Ctrl+Shift+Z)">
              <RotateCcw size={14} className="scale-x-[-1]" />
            </button>
            {/* P2: JSON编辑器（build_mode下隐藏） */}
            {!isBuildMode && (
            <button
              onClick={() => {
                setJsonEditContent(JSON.stringify({ nodes: wf.nodes, connections: wf.connections }, null, 2));
                setJsonEditorOpen(true);
              }}
              className="p-1.5 rounded bg-[#1a1a1a] hover:bg-[#222] text-gray-400 hover:text-white transition-colors cursor-pointer"
              title="查看/编辑JSON"
            >
              <Settings size={14} />
            </button>
            )}
            <div className="w-px h-4 bg-gray-800 mx-1" />
            <button onClick={handleSaveWorkflow} disabled={saveStatus === 'saving'} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 ${saveStatus === 'saved' ? 'bg-green-900/30 text-green-400' : saveStatus === 'error' ? 'bg-red-900/30 text-red-400' : 'bg-[#1a1a1a] hover:bg-[#222] text-gray-300'}`}>
              {saveStatus === 'saving' ? <Loader2 size={12} className="animate-spin" /> : saveStatus === 'saved' ? <Check size={12} /> : <Save size={12} />}
              {saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存' : '保存'}
            </button>
            <button onClick={execStatus === 'running' ? handleStopWorkflow : handleRunWorkflow} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 ${execStatus === 'running' ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50' : 'bg-[#d4af37]/20 text-[#d4af37] hover:bg-[#d4af37]/30'}`}>
              {execStatus === 'running' ? <><Square size={12} /> 停止</> : <><Play size={12} /> 运行</>}
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
          onWheel={handleWheel}
          style={{ cursor: isPanning ? 'grabbing' : draggingConn ? 'crosshair' : 'default' }}
        >
          {/* 网格背景 */}
          <defs>
            <pattern id="grid" width={20 * viewport.zoom} height={20 * viewport.zoom} patternUnits="userSpaceOnUse" x={viewport.x % (20 * viewport.zoom)} y={viewport.y % (20 * viewport.zoom)}>
              <circle cx={1} cy={1} r={0.5} fill="#333" />
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
              <polygon points="0 0, 8 3, 0 6" fill="#555" />
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
              const color = PORT_COLORS[conn.type] || '#555';
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
                  {/* 发光效果(高亮时) */}
                  {isHighlighted && (
                    <path
                      d={getConnPath(from.x, from.y, to.x, to.y)}
                      fill="none" stroke={color} strokeWidth={6}
                      strokeOpacity={0.15}
                    />
                  )}
                  <path
                    d={getConnPath(from.x, from.y, to.x, to.y)}
                    fill="none" stroke={color} strokeWidth={2}
                    strokeOpacity={isHighlighted ? 1 : isRunning ? 0.9 : 0.4}
                    markerEnd={`url(#${markerId})`}
                    className={isRunning ? 'animate-pulse' : ''}
                  />
                  {/* 数据流动画 (执行中) */}
                  {isRunning && (
                    <circle r={3} fill={color}>
                      <animateMotion dur="1.5s" repeatCount="indefinite" path={getConnPath(from.x, from.y, to.x, to.y)} />
                    </circle>
                  )}
                  {/* 连线类型标签 */}
                  {(conn.type !== 'any' && (isHighlighted || viewport.zoom > 0.6)) && (
                    <text
                      x={(from.x + to.x) / 2}
                      y={(from.y + to.y) / 2 - 6}
                      textAnchor="middle"
                      fill={color}
                      fontSize={8}
                      fillOpacity={0.7}
                      className="pointer-events-none"
                    >
                      {conn.type}
                    </text>
                  )}
                  {/* 点击区域 */}
                  <path
                    d={getConnPath(from.x, from.y, to.x, to.y)}
                    fill="none" stroke="transparent" strokeWidth={10}
                    onClick={() => setWf(prev => ({ ...prev, connections: prev.connections.filter(c => c.id !== conn.id) }))}
                    className="cursor-pointer"
                  />
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

            {/* 节点 */}
            {wf.nodes.map(node => (
              <NodeCard
                key={node.id}
                node={node}
                isSelected={selectedNodeId === node.id}
                isHighlighted={getConnectedNodeIds.has(node.id)}
                execResult={execResults[node.id]}
                isRunning={execStatus === 'running'}
                onSelect={() => { setSelectedNodeId(node.id); setSidebarTab('props'); }}
                onHover={setHighlightNodeId}
                onDragStart={(e) => {
                  const svgRect = svgRef.current?.getBoundingClientRect();
                  if (!svgRect) return;
                  const mx = (e.clientX - svgRect.left - viewport.x) / viewport.zoom;
                  const my = (e.clientY - svgRect.top - viewport.y) / viewport.zoom;
                  setDraggingNode(node.id);
                  setDragOffset({ x: mx - node.x, y: my - node.y });
                }}
                onPortMouseDown={handlePortMouseDown}
                onPortMouseUp={handlePortMouseUp}
                onDelete={() => handleDeleteNode(node.id)}
                onPreviewImage={(url) => setImagePreviewUrl(url)}
              />
            ))}
          </g>
        </svg>

        {/* 端口类型图例 */}
        <div className="absolute bottom-3 left-3 bg-[#111]/90 border border-gray-800 rounded px-2 py-1.5 flex items-center gap-3 text-[9px]">
          {Object.entries(PORT_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-gray-500">{type}</span>
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
              className="absolute bottom-3 right-3 w-[160px] h-[100px] bg-[#111]/90 border border-gray-800 rounded overflow-hidden cursor-pointer"
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
                {wf.connections.map(conn => {
                  const from = wf.nodes.find(n => n.id === conn.fromNodeId);
                  const to = wf.nodes.find(n => n.id === conn.toNodeId);
                  if (!from || !to) return null;
                  return <line key={conn.id} x1={from.x + from.width / 2} y1={from.y + from.height / 2} x2={to.x + to.width / 2} y2={to.y + to.height / 2} stroke={PORT_COLORS[conn.type] || '#444'} strokeWidth={2} opacity={0.6} />;
                })}
                {wf.nodes.map(n => (
                  <rect key={n.id} x={n.x} y={n.y} width={n.width} height={n.height} rx={4}
                    fill={selectedNodeId === n.id ? '#d4af37' : NODE_TYPE_COLORS[getNodeCategory(n.type)]}
                    fillOpacity={0.6} stroke="none"
                  />
                ))}
              </svg>
              {/* 视口指示框 */}
              <div
                className="absolute border border-[#d4af37]/60 bg-[#d4af37]/10 rounded-sm pointer-events-none"
                style={{
                  left: Math.max(0, vpX),
                  top: Math.max(0, vpY),
                  width: Math.min(160, vpW),
                  height: Math.min(100, vpH),
                }}
              />
              <button onClick={(e) => { e.stopPropagation(); setShowMinimap(false); }} className="absolute top-0.5 right-0.5 text-gray-600 hover:text-gray-400 cursor-pointer z-10">
                <X size={10} />
              </button>
            </div>
          );
        })()}

        {/* 执行状态栏 */}
        {execStatus !== 'idle' && (
          <div className="absolute bottom-12 left-3 bg-[#111]/95 border border-gray-800 rounded px-3 py-2 flex items-center gap-3 text-xs">
            {execStatus === 'running' && <Loader2 size={14} className="animate-spin text-[#d4af37]" />}
            {execStatus === 'completed' && <Check size={14} className="text-green-400" />}
            {execStatus === 'failed' && <AlertCircle size={14} className="text-red-400" />}
            <span className={execStatus === 'running' ? 'text-[#d4af37]' : execStatus === 'completed' ? 'text-green-400' : 'text-red-400'}>
              {execStatus === 'running' ? '执行中...' : execStatus === 'completed' ? '执行完成' : '执行失败'}
            </span>
            <span className="text-gray-600">
              {Object.keys(execResults).length}/{wf.nodes.length} 节点
            </span>
            <button onClick={() => { setExecStatus('idle'); setExecResults({}); setExecLogs([]); }} className="text-gray-500 hover:text-gray-300 cursor-pointer">
              <X size={12} />
            </button>
          </div>
        )}

        {/* P1: 执行日志面板 */}
        {execLogs.length > 0 && (
          <div className="absolute bottom-12 right-3 w-[320px] max-h-[240px] bg-[#111]/95 border border-gray-800 rounded overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800">
              <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">执行日志</span>
              <button onClick={() => setExecLogs([])} className="text-gray-600 hover:text-gray-400 cursor-pointer"><X size={10} /></button>
            </div>
            <div className="flex-1 overflow-y-auto text-[10px]">
              {execLogs.map((log, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-1 hover:bg-white/5">
                  {log.status === 'success' ? <Check size={8} className="text-green-400 flex-shrink-0" /> : <AlertCircle size={8} className="text-red-400 flex-shrink-0" />}
                  <span className="text-gray-400 flex-shrink-0">{log.label}</span>
                  <span className={`flex-1 truncate ${log.status === 'success' ? 'text-green-400/60' : 'text-red-400/60'}`}>{log.message}</span>
                  <span className="text-gray-700 flex-shrink-0">{new Date(log.time).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 图片预览弹窗 */}
      {imagePreviewUrl && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={() => setImagePreviewUrl(null)}>
          <div className="relative max-w-[80vw] max-h-[80vh]">
            <img src={imagePreviewUrl} alt="预览" className="max-w-full max-h-[80vh] rounded shadow-2xl" />
            <button onClick={() => setImagePreviewUrl(null)} className="absolute -top-2 -right-2 p-1 bg-[#1a1a1a] rounded-full text-gray-400 hover:text-white cursor-pointer">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* P2: JSON编辑器弹窗 */}
      {jsonEditorOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={() => setJsonEditorOpen(false)}>
          <div className="w-[640px] max-h-[80vh] bg-[#111] border border-gray-800 rounded-lg flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
              <span className="text-xs font-semibold text-[#d4af37]">工作流 JSON 编辑器</span>
              <button onClick={() => setJsonEditorOpen(false)} className="text-gray-500 hover:text-white cursor-pointer"><X size={14} /></button>
            </div>
            <textarea
              value={jsonEditContent}
              onChange={e => setJsonEditContent(e.target.value)}
              className="flex-1 min-h-[400px] bg-[#0d0d0d] text-green-400/80 font-mono text-[10px] p-3 focus:outline-none resize-none"
              spellCheck={false}
            />
            <div className="flex justify-end gap-2 px-4 py-2 border-t border-gray-800">
              <button onClick={() => setJsonEditorOpen(false)} className="px-3 py-1 text-[10px] rounded bg-gray-800 text-gray-400 hover:text-white cursor-pointer">取消</button>
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
                className="px-3 py-1 text-[10px] rounded bg-[#d4af37]/20 text-[#d4af37] hover:bg-[#d4af37]/30 cursor-pointer"
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

interface NodeCardProps {
  node: WorkflowNode;
  isSelected: boolean;
  isHighlighted: boolean;
  execResult?: { status: string; output?: Record<string, unknown>; error?: string };
  isRunning: boolean;
  onSelect: () => void;
  onHover: (id: string | null) => void;
  onDragStart: (e: React.MouseEvent) => void;
  onPortMouseDown: (e: React.MouseEvent, nodeId: string, port: NodePort) => void;
  onPortMouseUp: (nodeId: string, port: NodePort) => void;
  onDelete: () => void;
  onPreviewImage: (url: string) => void;
}

function NodeCard({ node, isSelected, isHighlighted, execResult, isRunning, onSelect, onHover, onDragStart, onPortMouseDown, onPortMouseUp, onDelete, onPreviewImage }: NodeCardProps) {
  const cat = getNodeCategory(node.type);
  const color = NODE_TYPE_COLORS[cat];
  const inputPorts = node.ports.filter(p => p.direction === 'in');
  const outputPorts = node.ports.filter(p => p.direction === 'out');
  const isCondition = node.type.startsWith('condition-');

  const statusColor = execResult?.status === 'success' ? '#22c55e'
    : execResult?.status === 'failed' ? '#ef4444'
    : isRunning ? '#d4af37' : 'transparent';

  const hasImageOutput = execResult?.output?.imageUrl as string | undefined;
  // 画布模式专用节点标记
  const isCanvasFeature = ['ai-font-design', 'ai-refine-engine', 'ai-brand-ecommerce', 'ai-segment', 'ai-multi-angle', 'ai-3d-model'].includes(node.type);

  return (
    <g
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* 高亮光晕 */}
      {isHighlighted && !isSelected && (
        <rect x={node.x - 4} y={node.y - 4} width={node.width + 8} height={node.height + 8} rx={isCondition ? 55 : 12}
          fill="none" stroke={color} strokeWidth={1} strokeOpacity={0.3}
        />
      )}

      {/* 选中边框 */}
      {isSelected && (
        <rect x={node.x - 2} y={node.y - 2} width={node.width + 4} height={node.height + 4} rx={isCondition ? 55 : 10}
          fill="none" stroke="#d4af37" strokeWidth={2} strokeDasharray="4 2" className="animate-pulse" />
      )}

      {/* 节点主体 */}
      <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={isCondition ? 55 : 8}
        fill={isSelected ? '#1e1e1e' : '#161616'}
        stroke={execResult ? statusColor : color}
        strokeWidth={execResult ? 2 : 1}
        strokeOpacity={execResult ? 1 : isHighlighted ? 0.7 : 0.4}
        onMouseDown={(e) => { e.stopPropagation(); onSelect(); onDragStart(e as unknown as React.MouseEvent); }}
        className="cursor-move"
      />

      {/* 执行成功动画光圈 */}
      {execResult?.status === 'success' && (
        <rect x={node.x - 4} y={node.y - 4} width={node.width + 8} height={node.height + 8} rx={isCondition ? 55 : 12}
          fill="none" stroke="#22c55e" strokeWidth={1} strokeOpacity={0.3} className="animate-ping" />
      )}

      {/* 画布模式专用标记 (右上角小徽章) */}
      {isCanvasFeature && !isCondition && (
        <g>
          <circle cx={node.x + node.width - 8} cy={node.y + 8} r={5} fill={color} fillOpacity={0.8} />
          <text x={node.x + node.width - 8} y={node.y + 10.5} textAnchor="middle" fill="#000" fontSize={6} fontWeight={700} className="pointer-events-none">
            {node.type === 'ai-font-design' ? '字' : node.type === 'ai-refine-engine' ? '精' : node.type === 'ai-brand-ecommerce' ? '品' : node.type === 'ai-segment' ? '层' : node.type === 'ai-multi-angle' ? '角' : '3D'}
          </text>
        </g>
      )}

      {/* 节点标题区 */}
      {!isCondition && (
        <g>
          {/* 色条 */}
          <rect x={node.x} y={node.y} width={node.width} height={3} rx={8} fill={color} fillOpacity={0.8} />
          {/* 图标 */}
          <foreignObject x={node.x + 8} y={node.y + 10} width={16} height={16}>
            <div className="flex items-center justify-center" style={{ color }}>{getNodeIcon(node.type, 12)}</div>
          </foreignObject>
          {/* 标题 */}
          <text x={node.x + 28} y={node.y + 22} fill="#ccc" fontSize={11} fontWeight={500} className="pointer-events-none">
            {node.label.length > 12 ? node.label.slice(0, 12) + '...' : node.label}
          </text>
          {/* 图片缩略图 */}
          {hasImageOutput && (
            <foreignObject x={node.x + 8} y={node.y + 32} width={node.width - 16} height={node.height - 44}>
              <div className="w-full h-full relative group cursor-pointer" onClick={() => onPreviewImage(hasImageOutput)}>
                <img src={hasImageOutput} alt="" className="w-full h-full object-cover rounded opacity-70 group-hover:opacity-100 transition-opacity" />
              </div>
            </foreignObject>
          )}
        </g>
      )}

      {/* 条件节点: 菱形内文字 */}
      {isCondition && (
        <text x={node.x + node.width / 2} y={node.y + node.height / 2 + 4} textAnchor="middle" fill="#ccc" fontSize={10} fontWeight={500}>
          {node.label.length > 8 ? node.label.slice(0, 8) + '..' : node.label}
        </text>
      )}

      {/* 输入端口 (颜色按类型区分) */}
      {inputPorts.map((port, i) => {
        const py = node.y + (i + 1) * (node.height / (inputPorts.length + 1));
        const portColor = PORT_COLORS[port.type] || '#555';
        return (
          <g key={port.id} onMouseUp={() => onPortMouseUp(node.id, port)}>
            <circle cx={node.x} cy={py} r={5} fill="#161616" stroke={portColor} strokeWidth={1.5} className="cursor-pointer" />
            <text x={node.x + 8} y={py + 3} fill="#888" fontSize={8} className="pointer-events-none">{port.label}</text>
          </g>
        );
      })}

      {/* 输出端口 (颜色按类型区分, 实心) */}
      {outputPorts.map((port, i) => {
        const py = node.y + (i + 1) * (node.height / (outputPorts.length + 1));
        const portColor = PORT_COLORS[port.type] || '#555';
        return (
          <g key={port.id} onMouseDown={(e) => onPortMouseDown(e as unknown as React.MouseEvent, node.id, port)}>
            <circle cx={node.x + node.width} cy={py} r={5} fill={portColor} stroke="none" className="cursor-pointer hover:r-[7px]" />
            <text x={node.x + node.width - 8} y={py + 3} fill="#888" fontSize={8} textAnchor="end" className="pointer-events-none">{port.label}</text>
          </g>
        );
      })}

      {/* 断点标记 */}
      {node.breakpoint && (
        <circle cx={node.x + node.width - 8} cy={node.y + (isCanvasFeature ? 20 : 8)} r={4} fill="#ef4444" />
      )}

      {/* 删除按钮 (选中时显示) */}
      {isSelected && (
        <g onClick={(e) => { e.stopPropagation(); onDelete(); }} className="cursor-pointer">
          <circle cx={node.x + node.width + 6} cy={node.y - 6} r={8} fill="#1a1a1a" stroke="#555" strokeWidth={1} />
          <foreignObject x={node.x + node.width + 1} y={node.y - 11} width={12} height={12}>
            <X size={10} className="text-gray-400 hover:text-red-400" />
          </foreignObject>
        </g>
      )}

      {/* 执行错误提示 */}
      {execResult?.error && (
        <foreignObject x={node.x} y={node.y + node.height + 2} width={node.width} height={20}>
          <div className="text-[9px] text-red-400 truncate px-1">{execResult.error}</div>
        </foreignObject>
      )}
    </g>
  );
}

// ==================== 属性面板 ====================

interface PropertyPanelProps {
  node: WorkflowNode | null;
  models: { id: string; name: string; type: string; provider: string }[];
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
  // P0: @图片引用弹窗状态 (移到PropertyPanel内部管理)
  const [mentionPopup, setMentionPopup] = useState<MentionPopup>({ visible: false, nodeId: '', fieldKey: '', filter: '', position: { top: 0, left: 0 } });

  if (!node) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-xs">
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
    const value = node.config?.[field.key] ?? (node as unknown as Record<string, unknown>)[field.key] ?? field.defaultValue ?? '';

    const onChange = (val: unknown) => {
      onUpdate(node.id, { config: { [field.key]: val } });
    };

    switch (field.type) {
      case 'text':
        return (
          <input
            type="text"
            value={String(value)}
            onChange={e => onChange(e.target.value)}
            placeholder={field.placeholder}
            className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#d4af37]/50"
          />
        );

      case 'textarea': {
        // P0: 提示词字段支持@图片引用
        const isPromptField = field.key === 'prompt' || field.key === 'text' || field.key === 'stylePrompt' || field.key === 'negativePrompt';
        return (
          <div className="relative">
            <textarea
              value={String(value)}
              onChange={e => {
                onChange(e.target.value);
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
              placeholder={isPromptField && canvasImages && canvasImages.length > 0 ? `${field.placeholder} (输入@引用画布图片)` : field.placeholder}
              rows={3}
              className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#d4af37]/50 resize-y"
            />
            {/* P0: @图片引用弹窗 */}
            {isPromptField && mentionPopup.visible && mentionPopup.nodeId === node.id && mentionPopup.fieldKey === field.key && (
              <div
                className="absolute z-50 bg-[#222] border border-[#d4af37]/30 rounded shadow-lg max-h-40 overflow-y-auto"
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
                      className="w-full text-left px-2 py-1.5 text-xs text-gray-300 hover:bg-[#d4af37]/10 hover:text-[#d4af37] flex items-center gap-2 cursor-pointer"
                      onClick={() => {
                        // 在@位置插入图片引用
                        const currentValue = String(value);
                        const cursorPos = currentValue.length;
                        const beforeAt = currentValue.slice(0, cursorPos).replace(/@[^\s@]*$/, '');
                        const afterCursor = currentValue.slice(cursorPos);
                        const ref = `[img:${img.id}]`;
                        const newValue = beforeAt + ref + afterCursor;
                        onChange(newValue);
                        setMentionPopup(prev => ({ ...prev, visible: false }));
                      }}
                    >
                      <span className="w-6 h-6 rounded bg-[#333] flex-shrink-0 overflow-hidden">
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
                  <div className="px-2 py-1.5 text-xs text-gray-500">无匹配图片</div>
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
            value={value !== undefined && value !== '' ? Number(value) : (field.defaultValue != null ? Number(field.defaultValue) : '')}
            onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            min={field.min}
            max={field.max}
            step={field.step || 1}
            placeholder={field.placeholder}
            className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#d4af37]/50"
          />
        );

      case 'select':
        return (
          <select
            value={String(value)}
            onChange={e => onChange(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-[#d4af37]/50"
          >
            {field.options?.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        );

      case 'slider': {
        const numVal = Number(value) || Number(field.defaultValue) || 0;
        return (
          <div className="flex items-center gap-2">
            <input
              type="range"
              value={numVal}
              onChange={e => onChange(Number(e.target.value))}
              min={field.min || 0}
              max={field.max || 100}
              step={field.step || 1}
              className="flex-1 h-1 accent-[#d4af37]"
            />
            <span className="text-[10px] text-gray-400 w-8 text-right">{numVal}</span>
          </div>
        );
      }

      case 'toggle': {
        const boolVal = Boolean(value) || value === 'true';
        return (
          <button
            onClick={() => onChange(!boolVal)}
            className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${boolVal ? 'bg-[#d4af37]' : 'bg-gray-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${boolVal ? 'translate-x-4' : ''}`} />
          </button>
        );
      }

      case 'model-select':
        return (
          <select
            value={String(value || '')}
            onChange={e => onChange(e.target.value)}
            disabled={modelsLoading}
            className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-[#d4af37]/50 disabled:opacity-50"
          >
            <option value="">{modelsLoading ? '加载中...' : '选择模型'}</option>
            {models.filter(m => m.type === 'image' || m.type === 'chat').map(m => (
              <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
            ))}
          </select>
        );

      case 'image-upload':
        return (
          <div className="space-y-2">
            {node.config?.imageUrl ? (
              <div className="relative group">
                <img src={String(node.config.imageUrl)} alt="预览" className="w-full h-24 object-cover rounded border border-gray-700" />
                <button onClick={() => onChange('')} className="absolute top-1 right-1 p-0.5 bg-black/70 rounded text-gray-400 hover:text-red-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                  <X size={10} />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-20 border-2 border-dashed border-gray-700 rounded flex flex-col items-center justify-center cursor-pointer hover:border-[#d4af37]/50 transition-colors text-gray-600 hover:text-gray-400"
              >
                <Upload size={16} />
                <span className="text-[10px] mt-1">上传图片</span>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => {
              const file = e.target.files?.[0];
              if (file) onImageUpload(node.id, file);
            }} />
            <input
              type="text"
              value={String(value || '')}
              onChange={e => onChange(e.target.value)}
              placeholder="或输入图片URL"
              className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#d4af37]/50"
            />
          </div>
        );

      default:
        return (
          <input
            type="text"
            value={String(value)}
            onChange={e => onChange(e.target.value)}
            placeholder={field.placeholder}
            className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#d4af37]/50"
          />
        );
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* 节点标题 */}
      <div className="p-3 border-b border-gray-800">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-6 h-6 rounded flex items-center justify-center" style={{ backgroundColor: color + '20', color }}>
            {getNodeIcon(node.type, 14)}
          </span>
          <div>
            <div className="text-xs font-medium text-gray-200">{NODE_TYPE_LABELS[node.type]}</div>
            <div className="text-[10px] text-gray-600">{NODE_CATEGORY_LABELS[cat]}</div>
          </div>
          {isCanvasFeature && (
            <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#d4af37]/10 text-[#d4af37] font-medium ml-auto">画布专用</span>
          )}
        </div>
      </div>

      {/* 基础属性 */}
      <div className="border-b border-gray-800">
        <button onClick={() => toggleSection('basic')} className="w-full flex items-center gap-1 px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold hover:text-gray-300 cursor-pointer">
          {expandedSections.basic ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          基础属性
        </button>
        {expandedSections.basic && (
          <div className="px-3 pb-3 space-y-2">
            {basicFields.map(field => (
              <div key={field.key}>
                <label className="block text-[10px] text-gray-500 mb-0.5">{field.label}</label>
                {renderField(field)}
              </div>
            ))}
            {/* 断点开关 */}
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-gray-500">断点</label>
              <button
                onClick={() => onUpdate(node.id, { breakpoint: !node.breakpoint })}
                className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${node.breakpoint ? 'bg-red-500' : 'bg-gray-700'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${node.breakpoint ? 'translate-x-4' : ''}`} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 画布模式专用属性 */}
      {canvasFields.length > 0 && (
        <div className="border-b border-gray-800">
          <button onClick={() => toggleSection('canvas')} className="w-full flex items-center gap-1 px-3 py-2 text-[10px] uppercase tracking-wider text-[#d4af37] font-semibold hover:text-[#d4af37]/80 cursor-pointer">
            {expandedSections.canvas ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            {node.type === 'ai-font-design' ? '字境大师' : node.type === 'ai-refine-engine' ? '精修引擎' : node.type === 'ai-brand-ecommerce' ? '品牌电商' : node.type === 'ai-segment' ? '元素分层' : node.type === 'ai-multi-angle' ? '多角度' : '3D模型'}
          </button>
          {expandedSections.canvas && (
            <div className="px-3 pb-3 space-y-2">
              {canvasFields.map(field => (
                <div key={field.key}>
                  <label className="block text-[10px] text-gray-500 mb-0.5">{field.label}</label>
                  {renderField(field)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 高级属性 */}
      {advancedFields.length > 0 && (
        <div className="border-b border-gray-800">
          <button onClick={() => toggleSection('advanced')} className="w-full flex items-center gap-1 px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold hover:text-gray-300 cursor-pointer">
            {expandedSections.advanced ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            高级属性
          </button>
          {expandedSections.advanced && (
            <div className="px-3 pb-3 space-y-2">
              {advancedFields.map(field => (
                <div key={field.key}>
                  <label className="block text-[10px] text-gray-500 mb-0.5">{field.label}</label>
                  {renderField(field)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 端口信息 */}
      <div className="px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">端口</div>
        <div className="space-y-1">
          {node.ports.filter(p => p.direction === 'in').map(p => (
            <div key={p.id} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PORT_COLORS[p.type] }} />
              <span className="text-gray-500">→</span>
              <span className="text-gray-400">{p.label}</span>
              <span className="text-gray-600 ml-auto">{p.type}</span>
            </div>
          ))}
          {node.ports.filter(p => p.direction === 'out').map(p => (
            <div key={p.id} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PORT_COLORS[p.type] }} />
              <span className="text-gray-400">{p.label}</span>
              <span className="text-gray-600 ml-auto">{p.type} →</span>
            </div>
          ))}
        </div>
      </div>

      {/* 删除按钮 */}
      <div className="p-3 border-t border-gray-800">
        <button
          onClick={() => onDelete(node.id)}
          className="w-full py-1.5 rounded text-xs text-red-400 hover:bg-red-900/20 transition-colors cursor-pointer flex items-center justify-center gap-1"
        >
          <Trash2 size={12} /> 删除节点
        </button>
      </div>
    </div>
  );
}
