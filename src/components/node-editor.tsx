'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  WorkflowNode, WorkflowConnection, Workflow as WorkflowData, NodeType, NodeCategory,
  NODE_TYPE_COLORS, NODE_TYPE_LABELS, NODE_TYPE_ICONS, NODE_CATEGORY_LABELS,
  PORT_COLORS, NodePort, PortType, PropertyField,
  createWorkflowNode, createConnection, createEmptyWorkflow, createDemoWorkflow,
  getNodePropertyFields, getNodeCategory, NODE_TEMPLATES,
} from '@/lib/workflow-engine';
import {
  Image, Type, SlidersHorizontal, Wand2, Pencil, Maximize, Scissors,
  PenTool, Palette, Sun, GitBranch, GitMerge, Repeat, RefreshCw, Layers,
  Bot, MessageSquare, ImageDown, Save, Download, Play, Square,
  ChevronRight, ChevronDown, Plus, Trash2, ZoomIn, ZoomOut, RotateCcw,
  Settings, Upload, X, Check, AlertCircle, Loader2, BoxSelect, Group,
  Search, ScanSearch, Eye, Pause, SkipForward, Workflow as WorkflowIcon, Timer,
  ArrowLeft, LayoutGrid,
} from 'lucide-react';

// ==================== 图标映射 ====================

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Image, Type, SlidersHorizontal, Wand2, Pencil, Maximize, Scissors,
  PenTool, Palette, Sun, GitBranch, GitMerge, Repeat, RefreshCw, Layers,
  Bot, MessageSquare, ImageDown, Save, Download, BoxSelect, Group,
  ScanSearch,
};

function getNodeIcon(type: NodeType, size = 14, className = '') {
  const iconName = NODE_TYPE_ICONS[type];
  const IconComp = ICON_MAP[iconName] || Settings;
  return <IconComp size={size} className={className} />;
}

// ==================== 模型列表 Hook ====================

interface ModelOption { id: string; name: string; type: string; provider: string; }

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

// ==================== 主组件 ====================

interface NodeEditorProps {
  workflow?: WorkflowData | null;
  onBack?: () => void;
  onWorkflowChange?: (wf: WorkflowData | null) => void;
  onOpenWorkflowHub?: () => void;
}

export default function NodeEditor({ workflow, onBack, onWorkflowChange, onOpenWorkflowHub }: NodeEditorProps) {
  const [wf, setWf] = useState<WorkflowData>(workflow || createDemoWorkflow());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [draggingConn, setDraggingConn] = useState<DraggingConn | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 0.8 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, vx: 0, vy: 0 });
  const [sidebarTab, setSidebarTab] = useState<'nodes' | 'props'>('nodes');
  const [searchQuery, setSearchQuery] = useState('');
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [execStatus, setExecStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [execResults, setExecResults] = useState<Record<string, { status: string; output?: Record<string, unknown>; error?: string }>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showMinimap, setShowMinimap] = useState(true);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const { models, loading: modelsLoading } = useModelList();

  const selectedNode = useMemo(() => wf.nodes.find(n => n.id === selectedNodeId) || null, [wf.nodes, selectedNodeId]);

  // 同步工作流变更到父组件
  useEffect(() => {
    onWorkflowChange?.(wf);
  }, [wf, onWorkflowChange]);

  // ─── 节点操作 ───

  const handleAddNode = useCallback((type: NodeType) => {
    const node = createWorkflowNode(type, 400 - viewport.x / viewport.zoom, 300 - viewport.y / viewport.zoom);
    setWf(prev => ({ ...prev, nodes: [...prev.nodes, node] }));
    setSelectedNodeId(node.id);
    setSidebarTab('props');
  }, [viewport]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    setWf(prev => ({
      ...prev,
      nodes: prev.nodes.filter(n => n.id !== nodeId),
      connections: prev.connections.filter(c => c.fromNodeId !== nodeId && c.toNodeId !== nodeId),
    }));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [selectedNodeId]);

  const handleNodeUpdate = useCallback((nodeId: string, updates: Partial<WorkflowNode>) => {
    setWf(prev => {
      const nodes = prev.nodes.map(n => {
        if (n.id !== nodeId) return n;
        // 需要同时更新到节点顶层属性的字段
        const topLevelKeys = ['label', 'condition', 'loopCount', 'breakpoint', 'agentRound'];
        const topLevel: Record<string, unknown> = {};
        const configUpdates: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(updates)) {
          if (k === 'config') {
            Object.assign(configUpdates, v as Record<string, unknown>);
          } else if (topLevelKeys.includes(k)) {
            topLevel[k] = v;
          } else {
            configUpdates[k] = v;
          }
        }
        const newConfig = { ...n.config, ...configUpdates };
        // 同步config中的字段到顶层
        for (const key of topLevelKeys) {
          if (configUpdates[key] !== undefined) {
            (topLevel as Record<string, unknown>)[key] = configUpdates[key];
          }
        }
        return { ...n, ...topLevel, config: newConfig };
      });
      return { ...prev, nodes };
    });
  }, []);

  // ─── 连线操作 ───

  const handlePortMouseDown = useCallback((e: React.MouseEvent, nodeId: string, port: NodePort) => {
    e.stopPropagation();
    if (port.direction === 'out') {
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (!svgRect) return;
      const x = (e.clientX - svgRect.left - viewport.x) / viewport.zoom;
      const y = (e.clientY - svgRect.top - viewport.y) / viewport.zoom;
      setDraggingConn({ fromNodeId: nodeId, fromPortId: port.id, fromX: x, fromY: y, toX: x, toY: y, portType: port.type });
    }
  }, [viewport]);

  const handlePortMouseUp = useCallback((nodeId: string, port: NodePort) => {
    if (draggingConn && port.direction === 'in' && draggingConn.fromNodeId !== nodeId) {
      // 检查是否已存在连线
      const exists = wf.connections.some(c =>
        c.fromNodeId === draggingConn.fromNodeId && c.toNodeId === nodeId
      );
      if (!exists) {
        const conn = createConnection(draggingConn.fromNodeId, draggingConn.fromPortId, nodeId, port.id, draggingConn.portType);
        setWf(prev => ({ ...prev, connections: [...prev.connections, conn] }));
      }
    }
    setDraggingConn(null);
  }, [draggingConn, wf.connections]);

  // ─── 画布操作 ───

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === svgRef.current || (e.target as Element).classList.contains('canvas-bg')) {
      if (e.button === 0) {
        setSelectedNodeId(null);
      }
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY, vx: viewport.x, vy: viewport.y });
        e.preventDefault();
      }
    }
  }, [viewport]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setViewport(v => ({ ...v, x: panStart.vx + dx, y: panStart.vy + dy }));
    }
    if (draggingConn) {
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (svgRect) {
        const x = (e.clientX - svgRect.left - viewport.x) / viewport.zoom;
        const y = (e.clientY - svgRect.top - viewport.y) / viewport.zoom;
        setDraggingConn(prev => prev ? { ...prev, toX: x, toY: y } : null);
      }
    }
    if (draggingNode) {
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (svgRect) {
        const mx = (e.clientX - svgRect.left - viewport.x) / viewport.zoom;
        const my = (e.clientY - svgRect.top - viewport.y) / viewport.zoom;
        setWf(prev => ({
          ...prev,
          nodes: prev.nodes.map(n => n.id === draggingNode ? { ...n, x: mx - dragOffset.x, y: my - dragOffset.y } : n),
        }));
      }
    }
  }, [isPanning, panStart, draggingConn, draggingNode, dragOffset, viewport]);

  const handleCanvasMouseUp = useCallback(() => {
    setIsPanning(false);
    setDraggingNode(null);
    if (draggingConn) setDraggingConn(null);
  }, [draggingConn]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    setViewport(v => {
      const newZoom = Math.max(0.2, Math.min(3, v.zoom * factor));
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (!svgRect) return { ...v, zoom: newZoom };
      const mx = e.clientX - svgRect.left;
      const my = e.clientY - svgRect.top;
      const newX = mx - (mx - v.x) * (newZoom / v.zoom);
      const newY = my - (my - v.y) * (newZoom / v.zoom);
      return { x: newX, y: newY, zoom: newZoom };
    });
  }, []);

  // ─── 执行工作流 ───

  const handleRunWorkflow = useCallback(async () => {
    if (wf.nodes.length === 0) return;
    setExecStatus('running');
    setExecResults({});

    try {
      const res = await fetch('/api/workflow/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          nodes: wf.nodes,
          connections: wf.connections,
        }),
      });
      const data = await res.json();
      if (data.executionId) {
        setExecutionId(data.executionId);
        // 开始轮询
        const pollInterval = setInterval(async () => {
          try {
            const statusRes = await fetch('/api/workflow/execute', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'status', executionId: data.executionId }),
            });
            const statusData = await statusRes.json();
            setExecStatus(statusData.status === 'running' ? 'running' : statusData.status);
            setExecResults(statusData.results || {});

            if (statusData.status !== 'running') {
              clearInterval(pollInterval);
            }
          } catch {
            clearInterval(pollInterval);
            setExecStatus('failed');
          }
        }, 2000);
      }
    } catch (err) {
      console.error('[NodeEditor] 执行失败:', err);
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
  }, [executionId]);

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

  // ─── 连线路径计算 ───

  const getConnPath = useCallback((fromX: number, fromY: number, toX: number, toY: number) => {
    const dx = Math.abs(toX - fromX) * 0.5;
    return `M ${fromX} ${fromY} C ${fromX + dx} ${fromY}, ${toX - dx} ${toY}, ${toX} ${toY}`;
  }, []);

  const getPortPosition = useCallback((node: WorkflowNode, port: NodePort) => {
    const portIndex = node.ports.filter(p => p.direction === port.direction).findIndex(p => p.id === port.id);
    const total = node.ports.filter(p => p.direction === port.direction).length;
    if (port.direction === 'in') {
      return { x: node.x, y: node.y + (portIndex + 1) * (node.height / (total + 1)) };
    }
    return { x: node.x + node.width, y: node.y + (portIndex + 1) * (node.height / (total + 1)) };
  }, []);

  // ─── 过滤节点模板 ───

  const filteredTemplates = useMemo(() => {
    if (!searchQuery) return NODE_TEMPLATES;
    const q = searchQuery.toLowerCase();
    return NODE_TEMPLATES.filter(t => t.label.includes(q) || t.desc.includes(q) || t.type.includes(q));
  }, [searchQuery]);

  // 按分类分组
  const groupedTemplates = useMemo(() => {
    const groups: Record<NodeCategory, typeof NODE_TEMPLATES> = {} as never;
    for (const t of filteredTemplates) {
      if (!groups[t.category]) groups[t.category] = [];
      groups[t.category].push(t);
    }
    return groups;
  }, [filteredTemplates]);

  // ─── 渲染 ───

  return (
    <div className="h-screen w-screen flex bg-[#0d0d0d] text-gray-200 overflow-hidden select-none">
      {/* 左侧栏: 节点库 + 属性面板 */}
      <div className="w-[280px] flex flex-col border-r border-gray-800 bg-[#111] flex-shrink-0">
        {/* 标签切换 */}
        <div className="flex border-b border-gray-800">
          <button
            onClick={() => setSidebarTab('nodes')}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${sidebarTab === 'nodes' ? 'text-[#d4af37] border-b-2 border-[#d4af37]' : 'text-gray-500 hover:text-gray-300'}`}
          >
            节点库
          </button>
          <button
            onClick={() => setSidebarTab('props')}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${sidebarTab === 'props' ? 'text-[#d4af37] border-b-2 border-[#d4af37]' : 'text-gray-500 hover:text-gray-300'}`}
          >
            属性面板
          </button>
        </div>

        {sidebarTab === 'nodes' ? (
          <div className="flex-1 overflow-y-auto">
            {/* 搜索 */}
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

            {/* 节点分类列表 */}
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
        ) : (
          <PropertyPanel
            node={selectedNode}
            models={models}
            modelsLoading={modelsLoading}
            onUpdate={handleNodeUpdate}
            onDelete={handleDeleteNode}
            onImageUpload={handleImageUpload}
          />
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
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
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
              const from = getPortPosition(fromNode, fromPort);
              const to = getPortPosition(toNode, toPort);
              const color = PORT_COLORS[conn.type] || '#555';

              // 检查此连线的源/目标节点是否有执行结果
              const isRunning = execStatus === 'running' && (execResults[conn.fromNodeId]?.status === 'success' || execResults[conn.toNodeId]);

              return (
                <g key={conn.id}>
                  <path
                    d={getConnPath(from.x, from.y, to.x, to.y)}
                    fill="none" stroke={color} strokeWidth={2}
                    strokeOpacity={isRunning ? 1 : 0.5}
                    markerEnd="url(#arrowhead)"
                    className={isRunning ? 'animate-pulse' : ''}
                  />
                  <path
                    d={getConnPath(from.x, from.y, to.x, to.y)}
                    fill="none" stroke="transparent" strokeWidth={10}
                    onClick={() => setWf(prev => ({ ...prev, connections: prev.connections.filter(c => c.id !== conn.id) }))}
                    className="cursor-pointer"
                  />
                </g>
              );
            })}

            {/* 临时连线 */}
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
                execResult={execResults[node.id]}
                isRunning={execStatus === 'running'}
                onSelect={() => { setSelectedNodeId(node.id); setSidebarTab('props'); }}
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

        {/* 小地图 */}
        {showMinimap && (
          <div className="absolute bottom-3 right-3 w-[160px] h-[100px] bg-[#111]/90 border border-gray-800 rounded overflow-hidden">
            <svg viewBox="0 0 1200 800" className="w-full h-full">
              {wf.connections.map(conn => {
                const from = wf.nodes.find(n => n.id === conn.fromNodeId);
                const to = wf.nodes.find(n => n.id === conn.toNodeId);
                if (!from || !to) return null;
                return <line key={conn.id} x1={from.x + from.width / 2} y1={from.y + from.height / 2} x2={to.x + to.width / 2} y2={to.y + to.height / 2} stroke="#444" strokeWidth={1} />;
              })}
              {wf.nodes.map(n => (
                <rect key={n.id} x={n.x} y={n.y} width={n.width} height={n.height} rx={4}
                  fill={selectedNodeId === n.id ? '#d4af37' : NODE_TYPE_COLORS[getNodeCategory(n.type)]}
                  fillOpacity={0.6} stroke="none"
                />
              ))}
            </svg>
            <button onClick={() => setShowMinimap(false)} className="absolute top-0.5 right-0.5 text-gray-600 hover:text-gray-400 cursor-pointer">
              <X size={10} />
            </button>
          </div>
        )}

        {/* 执行状态栏 */}
        {execStatus !== 'idle' && (
          <div className="absolute bottom-3 left-3 bg-[#111]/95 border border-gray-800 rounded px-3 py-2 flex items-center gap-3 text-xs">
            {execStatus === 'running' && <Loader2 size={14} className="animate-spin text-[#d4af37]" />}
            {execStatus === 'completed' && <Check size={14} className="text-green-400" />}
            {execStatus === 'failed' && <AlertCircle size={14} className="text-red-400" />}
            <span className={execStatus === 'running' ? 'text-[#d4af37]' : execStatus === 'completed' ? 'text-green-400' : 'text-red-400'}>
              {execStatus === 'running' ? '执行中...' : execStatus === 'completed' ? '执行完成' : '执行失败'}
            </span>
            <span className="text-gray-600">
              {Object.keys(execResults).length}/{wf.nodes.length} 节点
            </span>
            <button onClick={() => { setExecStatus('idle'); setExecResults({}); }} className="text-gray-500 hover:text-gray-300 cursor-pointer">
              <X size={12} />
            </button>
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
    </div>
  );
}

// ==================== 节点卡片 ====================

interface NodeCardProps {
  node: WorkflowNode;
  isSelected: boolean;
  execResult?: { status: string; output?: Record<string, unknown>; error?: string };
  isRunning: boolean;
  onSelect: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onPortMouseDown: (e: React.MouseEvent, nodeId: string, port: NodePort) => void;
  onPortMouseUp: (nodeId: string, port: NodePort) => void;
  onDelete: () => void;
  onPreviewImage: (url: string) => void;
}

function NodeCard({ node, isSelected, execResult, isRunning, onSelect, onDragStart, onPortMouseDown, onPortMouseUp, onDelete, onPreviewImage }: NodeCardProps) {
  const cat = getNodeCategory(node.type);
  const color = NODE_TYPE_COLORS[cat];
  const inputPorts = node.ports.filter(p => p.direction === 'in');
  const outputPorts = node.ports.filter(p => p.direction === 'out');
  const isCondition = node.type.startsWith('condition-');

  // 执行结果状态颜色
  const statusColor = execResult?.status === 'success' ? '#22c55e'
    : execResult?.status === 'failed' ? '#ef4444'
    : isRunning ? '#d4af37' : 'transparent';

  const hasImageOutput = execResult?.output?.imageUrl as string | undefined;

  return (
    <g>
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
        strokeOpacity={execResult ? 1 : 0.4}
        onMouseDown={(e) => { e.stopPropagation(); onSelect(); onDragStart(e as unknown as React.MouseEvent); }}
        className="cursor-move"
      />

      {/* 执行成功动画光圈 */}
      {execResult?.status === 'success' && (
        <rect x={node.x - 4} y={node.y - 4} width={node.width + 8} height={node.height + 8} rx={isCondition ? 55 : 12}
          fill="none" stroke="#22c55e" strokeWidth={1} strokeOpacity={0.3} className="animate-ping" />
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

      {/* 输入端口 */}
      {inputPorts.map((port, i) => {
        const py = node.y + (i + 1) * (node.height / (inputPorts.length + 1));
        return (
          <g key={port.id} onMouseUp={() => onPortMouseUp(node.id, port)}>
            <circle cx={node.x} cy={py} r={5} fill="#161616" stroke={PORT_COLORS[port.type] || '#555'} strokeWidth={1.5} className="cursor-pointer" />
            <text x={node.x + 8} y={py + 3} fill="#888" fontSize={8} className="pointer-events-none">{port.label}</text>
          </g>
        );
      })}

      {/* 输出端口 */}
      {outputPorts.map((port, i) => {
        const py = node.y + (i + 1) * (node.height / (outputPorts.length + 1));
        return (
          <g key={port.id} onMouseDown={(e) => onPortMouseDown(e as unknown as React.MouseEvent, node.id, port)}>
            <circle cx={node.x + node.width} cy={py} r={5} fill={PORT_COLORS[port.type] || '#555'} stroke="none" className="cursor-pointer hover:r-[7px]" />
            <text x={node.x + node.width - 8} y={py + 3} fill="#888" fontSize={8} textAnchor="end" className="pointer-events-none">{port.label}</text>
          </g>
        );
      })}

      {/* 断点标记 */}
      {node.breakpoint && (
        <circle cx={node.x + node.width - 8} cy={node.y + 8} r={4} fill="#ef4444" />
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
}

function PropertyPanel({ node, models, modelsLoading, onUpdate, onDelete, onImageUpload }: PropertyPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ basic: true, advanced: true });

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

  // 分组字段: basic(前3个) + advanced(其余)
  const basicFields = fields.slice(0, 3);
  const advancedFields = fields.slice(3);

  const toggleSection = (key: string) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

  const renderField = (field: PropertyField) => {
    // 优先从config读取，兼容从顶层属性读取
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

      case 'textarea':
        return (
          <textarea
            value={String(value)}
            onChange={e => onChange(e.target.value)}
            placeholder={field.placeholder}
            rows={3}
            className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#d4af37]/50 resize-y"
          />
        );

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
        <div className="flex items-center gap-2 mb-2">
          <span className="w-6 h-6 rounded flex items-center justify-center" style={{ backgroundColor: color + '20', color }}>
            {getNodeIcon(node.type, 14)}
          </span>
          <div>
            <div className="text-xs font-medium text-gray-200">{NODE_TYPE_LABELS[node.type]}</div>
            <div className="text-[10px] text-gray-600">{NODE_CATEGORY_LABELS[cat]}</div>
          </div>
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
