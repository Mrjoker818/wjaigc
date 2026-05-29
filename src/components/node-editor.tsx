'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Workflow, WorkflowNode, WorkflowConnection, NodeType, NodeCategory, PortType,
  NODE_TYPE_COLORS, NODE_TYPE_LABELS, NODE_TYPE_ICONS, NODE_CATEGORY_LABELS,
  getNodeCategory, createWorkflowNode, createConnection, createEmptyWorkflow,
  NODE_TEMPLATES, PORT_COLORS, getNodePropertyFields, PropertyField,
  createDemoWorkflow,
} from '@/lib/workflow-engine';

// ==================== 图标组件 ====================

function NodeIcon({ type, size = 16 }: { type: NodeType; size?: number }) {
  const cat = getNodeCategory(type);
  const color = NODE_TYPE_COLORS[cat];
  const iconName = NODE_TYPE_ICONS[type];

  const iconPaths: Record<string, string> = {
    'Image': 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l2-2 4 4 2-2 5 5M14 2H5a2 2 0 0 0-2 2v10l5-5 3 3 3-3 5 5',
    'Type': 'M4 7V4h16v3M9 20h6M12 4v16',
    'SlidersHorizontal': 'M21 4H14M10 4H3M21 12H12M8 12H3M21 20H16M12 20H3M14 2v4M8 10v4M16 18v4',
    'Wand2': 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M12.2 11.8L11 13M12.2 6.2L11 5M9 20l3-3 3 3M12 17v4',
    'Pencil': 'M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z',
    'Maximize': 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
    'Scissors': 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 4 8.6 15.4M14.5 14.5 20 20M8.6 8.6l5.9 5.9',
    'PenTool': 'M12 19l7-7 3 3-7 7-3-3z M5 2l7 7 M2 5l7 7',
    'Palette': 'M2 12a10 10 0 1 0 20 0 10 10 0 0 0-20 0ZM8 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM11 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM16 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM17 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
    'Sun': 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    'GitBranch': 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9c0 4-6 6-6 12',
    'GitMerge': 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 15c0-3 6-3 6-6',
    'Repeat': 'M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
    'RefreshCw': 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M1 1h5v5M21 21h-5v-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16',
    'Layers': 'M12 2L2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
    'Bot': 'M12 8V4H8M16 4h-4M12 4V2M8 4v4M16 4v4M6 12h12M6 12v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6M6 12l-2-2M18 12l2-2',
    'MessageSquare': 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    'BoxSelect': 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    'Group': 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    'ImageDown': 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l2-2 4 4 2-2 5 5M14 2H5a2 2 0 0 0-2 2v10M21 7l-5 5M16 7h5v5',
    'Save': 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8',
    'Download': 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  };

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={iconPaths[iconName] || iconPaths['BoxSelect']} />
    </svg>
  );
}

// ==================== 节点组件 ====================

interface NodeCardProps {
  node: WorkflowNode;
  isSelected: boolean;
  isRunning: boolean;
  onSelect: (id: string) => void;
  onDrag: (id: string, dx: number, dy: number) => void;
  onPortClick: (nodeId: string, portId: string, portType: PortType, direction: 'in' | 'out') => void;
  onToggleBreakpoint: (id: string) => void;
}

function NodeCard({ node, isSelected, isRunning, onSelect, onDrag, onPortClick, onToggleBreakpoint }: NodeCardProps) {
  const cat = getNodeCategory(node.type);
  const color = NODE_TYPE_COLORS[cat];
  const isCondition = node.type.startsWith('condition-');
  const dragRef = useRef<{ startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(node.id);
    dragRef.current = { startX: e.clientX, startY: e.clientY, nodeX: node.x, nodeY: node.y };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      onDrag(node.id, dragRef.current.nodeX + dx, dragRef.current.nodeY + dy);
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [node.id, node.x, node.y, onSelect, onDrag]);

  // 条件节点：菱形
  if (isCondition) {
    return (
      <g transform={`translate(${node.x}, ${node.y})`} onMouseDown={handleMouseDown} style={{ cursor: 'grab' }}>
        <polygon
          points="55,0 110,55 55,110 0,55"
          fill="#161b22"
          stroke={isSelected ? '#d4af37' : isRunning ? color : '#30363d'}
          strokeWidth={isSelected ? 2.5 : 1.5}
          style={{ filter: isRunning ? `drop-shadow(0 0 8px ${color})` : isSelected ? 'drop-shadow(0 0 6px #d4af37)' : undefined }}
        />
        {node.breakpoint && <circle cx="55" cy="-4" r="5" fill="#f85149" className="animate-pulse" />}
        <text x="55" y="50" textAnchor="middle" fill={color} fontSize="11" fontWeight="600">{node.label}</text>
        {node.condition && <text x="55" y="68" textAnchor="middle" fill="#7d8590" fontSize="9">{node.condition}</text>}
        {/* 端口 */}
        {node.ports.filter(p => p.direction === 'in').map((port, i) => (
          <circle key={port.id} cx={0} cy={55} r={5} fill={PORT_COLORS[port.type]} stroke="#0e1117" strokeWidth={1.5}
            onMouseDown={(e) => { e.stopPropagation(); onPortClick(node.id, port.id, port.type, 'in'); }}
            style={{ cursor: 'crosshair' }} />
        ))}
        {node.ports.filter(p => p.direction === 'out').map((port, i) => {
          const outPorts = node.ports.filter(p => p.direction === 'out');
          const angle = -60 + (120 / (outPorts.length - 1 || 1)) * i;
          const rad = (angle * Math.PI) / 180;
          const px = 110 + Math.cos(rad) * 5;
          const py = 55 + Math.sin(rad) * 5;
          return (
            <circle key={port.id} cx={px} cy={py} r={5} fill={PORT_COLORS[port.type]} stroke="#0e1117" strokeWidth={1.5}
              onMouseDown={(e) => { e.stopPropagation(); onPortClick(node.id, port.id, port.type, 'out'); }}
              style={{ cursor: 'crosshair' }} />
          );
        })}
      </g>
    );
  }

  // 常规矩形节点
  return (
    <g transform={`translate(${node.x}, ${node.y})`} onMouseDown={handleMouseDown} style={{ cursor: 'grab' }}>
      {/* 选中ring / 运行glow */}
      {isSelected && <rect x="-4" y="-4" width={node.width + 8} height={node.height + 8} rx="10" fill="none" stroke="#d4af37" strokeWidth="1.5" opacity="0.5" />}
      {/* 主体 */}
      <rect
        width={node.width} height={node.height} rx="8"
        fill="#161b22"
        stroke={isRunning ? color : isSelected ? '#d4af37' : '#30363d'}
        strokeWidth={1.5}
        style={{ filter: isRunning ? `drop-shadow(0 0 10px ${color})` : isSelected ? 'drop-shadow(0 0 6px #d4af3780)' : undefined }}
      />
      {/* 顶部色条 */}
      <rect width={node.width} height="3" rx="8" fill={color} />
      {/* 断点 */}
      {node.breakpoint && <circle cx={node.width / 2} cy="-4" r="5" fill="#f85149" className="animate-pulse" />}
      {/* 图标 + 标签 */}
      <foreignObject x="10" y="10" width={node.width - 20} height={node.height - 16}>
        <div className="flex items-center gap-2 h-full">
          <div className="shrink-0"><NodeIcon type={node.type} size={16} /></div>
          <span className="text-xs font-medium text-[#e6edf3] truncate">{node.label}</span>
        </div>
      </foreignObject>
      {/* 循环/Agent标记 */}
      {node.type.startsWith('loop-') && (
        <circle cx={node.width - 14} cy={node.height - 14} r="10" fill="#f59e0b20" stroke="#f59e0b" strokeWidth="1" />
      )}
      {node.type.startsWith('agent-') && (
        <circle cx={node.width - 14} cy={node.height - 14} r="10" fill="#f472b620" stroke="#f472b6" strokeWidth="1" className="animate-pulse" />
      )}
      {/* 输入端口 */}
      {node.ports.filter(p => p.direction === 'in').map((port, i) => (
        <g key={port.id} onMouseDown={(e) => { e.stopPropagation(); onPortClick(node.id, port.id, port.type, 'in'); }} style={{ cursor: 'crosshair' }}>
          <circle cx={0} cy={20 + i * 22} r={5} fill={PORT_COLORS[port.type]} stroke="#0e1117" strokeWidth={1.5} />
          <text x="10" y={24 + i * 22} fill="#7d8590" fontSize="8">{port.label}</text>
        </g>
      ))}
      {/* 输出端口 */}
      {node.ports.filter(p => p.direction === 'out').map((port, i) => (
        <g key={port.id} onMouseDown={(e) => { e.stopPropagation(); onPortClick(node.id, port.id, port.type, 'out'); }} style={{ cursor: 'crosshair' }}>
          <circle cx={node.width} cy={20 + i * 22} r={5} fill={PORT_COLORS[port.type]} stroke="#0e1117" strokeWidth={1.5} />
          <text x={node.width - 10} y={24 + i * 22} fill="#7d8590" fontSize="8" textAnchor="end">{port.label}</text>
        </g>
      ))}
    </g>
  );
}

// ==================== 连线组件 ====================

interface ConnectionLineProps {
  conn: WorkflowConnection;
  nodes: WorkflowNode[];
  isSelected: boolean;
  onSelect: (id: string) => void;
}

function ConnectionLine({ conn, nodes, isSelected, onSelect }: ConnectionLineProps) {
  const fromNode = nodes.find(n => n.id === conn.fromNodeId);
  const toNode = nodes.find(n => n.id === conn.toNodeId);
  if (!fromNode || !toNode) return null;

  // 起点端口坐标
  const fromPort = fromNode.ports.find(p => p.id === conn.fromPortId);
  const toPort = toNode.ports.find(p => p.id === conn.toPortId);
  if (!fromPort || !toPort) return null;

  const fromOutIdx = fromNode.ports.filter(p => p.direction === 'out').findIndex(p => p.id === conn.fromPortId);
  const toInIdx = toNode.ports.filter(p => p.direction === 'in').findIndex(p => p.id === conn.toPortId);

  const x1 = fromNode.x + (fromNode.type.startsWith('condition-') ? 110 : fromNode.width);
  const y1 = fromNode.y + (fromNode.type.startsWith('condition-') ? 55 : 20 + fromOutIdx * 22);
  const x2 = toNode.x;
  const y2 = toNode.y + 20 + toInIdx * 22;

  const midX = (x1 + x2) / 2;
  const path = `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`;

  return (
    <g onClick={() => onSelect(conn.id)} style={{ cursor: 'pointer' }}>
      <path d={path} fill="none" stroke={PORT_COLORS[conn.type]} strokeWidth={isSelected ? 3 : 2}
        strokeDasharray={conn.type === 'mask' ? '6 3' : undefined} opacity={isSelected ? 1 : 0.7} />
      {/* 端口圆点 */}
      <circle cx={x1} cy={y1} r="3" fill={PORT_COLORS[conn.type]} />
      <circle cx={x2} cy={y2} r="3" fill={PORT_COLORS[conn.type]} />
    </g>
  );
}

// ==================== 属性面板 ====================

interface PropertyPanelProps {
  node: WorkflowNode | null;
  onUpdate: (id: string, updates: Partial<WorkflowNode>) => void;
  onToggleBreakpoint: (id: string) => void;
}

function PropertyPanel({ node, onUpdate, onToggleBreakpoint }: PropertyPanelProps) {
  if (!node) {
    return (
      <div className="h-full flex items-center justify-center text-[#7d8590] text-sm">
        选择节点查看属性
      </div>
    );
  }

  const fields = getNodePropertyFields(node.type);
  const cat = getNodeCategory(node.type);
  const color = NODE_TYPE_COLORS[cat];

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* 节点类型标签 */}
      <div className="flex items-center gap-2 pb-3 border-b border-[#30363d]">
        <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: `${color}20` }}>
          <NodeIcon type={node.type} size={14} />
        </div>
        <div>
          <p className="text-xs font-medium text-[#e6edf3]">{node.label}</p>
          <p className="text-[10px] text-[#7d8590]">{NODE_CATEGORY_LABELS[cat]}</p>
        </div>
      </div>

      {/* 属性字段 */}
      {fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <label className="text-xs text-[#7d8590] font-medium">{field.label}</label>
          {renderField(field, node, (val) => {
            // 部分字段需要同步更新到节点顶层属性（而非仅config）
            const topLevelKey = field.key as 'label' | 'condition' | 'loopCount';
            const needsTopLevel = ['label', 'condition', 'loopCount'].includes(field.key);
            const updates: Partial<WorkflowNode> = { config: { [field.key]: val } };
            if (needsTopLevel) {
              (updates as Record<string, unknown>)[topLevelKey] = val;
            }
            onUpdate(node.id, updates);
          })}
        </div>
      ))}

      {/* 断点 */}
      <div className="flex items-center justify-between pt-2 border-t border-[#30363d]">
        <span className="text-xs text-[#7d8590]">调试断点</span>
        <button onClick={() => onToggleBreakpoint(node.id)}
          className={`w-8 h-4 rounded-full transition-colors ${node.breakpoint ? 'bg-[#f85149]' : 'bg-[#30363d]'}`}>
          <div className={`w-3 h-3 rounded-full bg-white transition-transform ${node.breakpoint ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
        </button>
      </div>
    </div>
  );
}

function renderField(field: PropertyField, node: WorkflowNode, onChange: (val: unknown) => void) {
  // 统一从 config 读取值，部分字段（label/condition/loopCount）也兼容顶层属性
  const configVal = node.config?.[field.key];
  // 对于 label/condition/loopCount，如果 config 中没有，尝试从节点顶层读取
  const topLevelVal = (node as unknown as Record<string, unknown>)[field.key];
  const rawVal = configVal !== undefined ? configVal : (topLevelVal !== undefined ? topLevelVal : field.defaultValue);

  switch (field.type) {
    case 'text':
      return <input type="text" value={String(rawVal ?? '')} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#1c2333] border border-[#30363d] rounded-md px-2.5 py-1.5 text-xs text-[#e6edf3] focus:outline-none focus:ring-1 focus:ring-[#d4af37]/50" />;

    case 'textarea':
      return <textarea value={String(rawVal ?? '')} onChange={(e) => onChange(e.target.value)} rows={3}
        className="w-full bg-[#1c2333] border border-[#30363d] rounded-md px-2.5 py-1.5 text-xs text-[#e6edf3] resize-y focus:outline-none focus:ring-1 focus:ring-[#d4af37]/50" />;

    case 'number': {
      const numVal = typeof rawVal === 'number' ? rawVal : Number(rawVal) || (field.defaultValue as number) || 0;
      return <input type="number" value={numVal} min={field.min} max={field.max} step={field.step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-[#1c2333] border border-[#30363d] rounded-md px-2.5 py-1.5 text-xs text-[#e6edf3] focus:outline-none focus:ring-1 focus:ring-[#d4af37]/50" />;
    }

    case 'select':
      return (
        <select value={String(rawVal ?? '')} onChange={(e) => onChange(e.target.value)}
          className="w-full bg-[#1c2333] border border-[#30363d] rounded-md px-2.5 py-1.5 text-xs text-[#e6edf3] focus:outline-none focus:ring-1 focus:ring-[#d4af37]/50 appearance-none cursor-pointer">
          {field.options?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      );

    case 'toggle': {
      const boolVal = Boolean(rawVal);
      return (
        <button onClick={() => onChange(!boolVal)}
          className={`w-8 h-4 rounded-full transition-colors ${boolVal ? 'bg-[#d4af37]' : 'bg-[#30363d]'}`}>
          <div className={`w-3 h-3 rounded-full bg-white transition-transform ${boolVal ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
        </button>
      );
    }

    case 'slider':
      return <input type="range" value={Number(rawVal) || 0} min={field.min ?? 0} max={field.max ?? 100} step={field.step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#d4af37]" />;

    case 'model-select':
      return <input type="text" value={String(rawVal ?? '')} placeholder="选择模型..." onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#1c2333] border border-[#30363d] rounded-md px-2.5 py-1.5 text-xs text-[#e6edf3] focus:outline-none focus:ring-1 focus:ring-[#d4af37]/50" />;

    default:
      return null;
  }
}

// ==================== 节点库面板 ====================

interface NodeLibrarySidebarProps {
  onAddNode: (type: NodeType) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function NodeLibrarySidebar({ onAddNode, collapsed, onToggleCollapse }: NodeLibrarySidebarProps) {
  const [search, setSearch] = useState('');
  const [expandedCats, setExpandedCats] = useState<Set<NodeCategory>>(new Set(['ai', 'logic', 'agent']));

  const filtered = NODE_TEMPLATES.filter(t =>
    !search || t.label.includes(search) || t.desc.includes(search)
  );

  const toggleCat = (cat: NodeCategory) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  if (collapsed) return null;

  const categories: NodeCategory[] = ['input', 'ai', 'logic', 'agent', 'subgraph', 'output'];

  return (
    <div className="w-[200px] h-full bg-[#161b22] border-r border-[#30363d] flex flex-col shrink-0">
      {/* 搜索 */}
      <div className="p-2 border-b border-[#30363d]">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索节点..."
          className="w-full bg-[#1c2333] border border-[#30363d] rounded-md px-2.5 py-1.5 text-xs text-[#e6edf3] placeholder:text-[#7d8590]/50 focus:outline-none focus:ring-1 focus:ring-[#d4af37]/50" />
      </div>
      {/* 分类列表 */}
      <div className="flex-1 overflow-y-auto">
        {categories.map(cat => {
          const items = filtered.filter(t => t.category === cat);
          if (items.length === 0) return null;
          const isExpanded = expandedCats.has(cat);
          return (
            <div key={cat}>
              <button onClick={() => toggleCat(cat)}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#7d8590] hover:text-[#e6edf3] hover:bg-[#1c2333] transition-colors">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                  <path d="M2 1l4 3-4 3" fill="currentColor" />
                </svg>
                <span style={{ color: NODE_TYPE_COLORS[cat] }}>{NODE_CATEGORY_LABELS[cat]}</span>
                <span className="ml-auto text-[10px]">{items.length}</span>
              </button>
              {isExpanded && items.map(t => (
                <button key={t.type} onClick={() => onAddNode(t.type)}
                  className="w-full flex items-center gap-2 px-5 py-1.5 text-xs text-[#e6edf3] hover:bg-[#1c2333] transition-colors cursor-grab">
                  <div className="w-4 h-4 rounded flex items-center justify-center shrink-0" style={{ backgroundColor: `${NODE_TYPE_COLORS[t.category]}20` }}>
                    <NodeIcon type={t.type} size={10} />
                  </div>
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {/* 收起按钮 */}
      <button onClick={onToggleCollapse} className="p-2 border-t border-[#30363d] text-[#7d8590] hover:text-[#e6edf3] text-xs text-center transition-colors">
        收起
      </button>
    </div>
  );
}

// ==================== 主编辑器 ====================

interface NodeEditorProps {
  workflow: Workflow | null;
  onBack: () => void;
  onWorkflowChange: (wf: Workflow) => void;
  onOpenWorkflowHub?: () => void;
}

/* CSS动画定义 */
const NODE_EDITOR_STYLES = `
@keyframes agentGlow {
  0%, 100% { filter: drop-shadow(0 0 6px rgba(244,114,182,0.4)); }
  50% { filter: drop-shadow(0 0 14px rgba(244,114,182,0.8)); }
}
@keyframes goldPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(212,175,55,0); }
  50% { box-shadow: 0 0 0 6px rgba(212,175,55,0.3); }
}
@keyframes dashFlow {
  to { stroke-dashoffset: -20; }
}
@keyframes breakpointPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}
@keyframes selectRing {
  0%, 100% { stroke-opacity: 0.6; }
  50% { stroke-opacity: 1; }
}
@keyframes progressFill {
  from { width: 0; }
  to { width: 100%; }
}
@keyframes condFlash {
  0%, 100% { stroke: #22c55e; }
  50% { stroke: #ef4444; }
}
@keyframes subgraphBreathe {
  0%, 100% { stroke-dasharray: 6 3; opacity: 0.4; }
  50% { stroke-dasharray: 8 2; opacity: 0.8; }
}
.node-agent { animation: agentGlow 2s ease-in-out infinite; }
.node-running { animation: goldPulse 1.2s ease-in-out infinite; }
.conn-dash-flow { animation: dashFlow 0.6s linear infinite; }
.conn-cond-flash { animation: condFlash 1.5s ease-in-out infinite; }
.subgraph-breathe { animation: subgraphBreathe 2s ease-in-out infinite; }
.breakpoint-pulse { animation: breakpointPulse 1s ease-in-out infinite; }
`;

export default function NodeEditor({ workflow, onBack, onWorkflowChange, onOpenWorkflowHub }: NodeEditorProps) {
  const [wf, setWf] = useState<Workflow>(workflow || createDemoWorkflow());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
  const [libCollapsed, setLibCollapsed] = useState(false);
  const [connecting, setConnecting] = useState<{ nodeId: string; portId: string; type: PortType; direction: 'in' | 'out' } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (workflow) setWf(workflow);
  }, [workflow]);

  const updateWf = useCallback((updates: Partial<Workflow>) => {
    setWf(prev => {
      const next = { ...prev, ...updates, updatedAt: Date.now() };
      onWorkflowChange(next);
      return next;
    });
  }, [onWorkflowChange]);

  // 添加节点
  const handleAddNode = useCallback((type: NodeType) => {
    const x = 200 + Math.random() * 300;
    const y = 100 + Math.random() * 200;
    const node = createWorkflowNode(type, x, y);
    updateWf({ nodes: [...wf.nodes, node] });
    setSelectedNodeId(node.id);
  }, [wf, updateWf]);

  // 拖动节点
  const handleNodeDrag = useCallback((id: string, x: number, y: number) => {
    setWf(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => n.id === id ? { ...n, x, y } : n),
      updatedAt: Date.now(),
    }));
  }, []);

  // 连接端口
  const handlePortClick = useCallback((nodeId: string, portId: string, type: PortType, direction: 'in' | 'out') => {
    if (!connecting) {
      setConnecting({ nodeId, portId, type, direction });
    } else {
      // 完成连接
      if (connecting.direction === direction) {
        setConnecting(null);
        return; // 同方向不连接
      }
      const fromNodeId = direction === 'in' ? connecting.nodeId : nodeId;
      const fromPortId = direction === 'in' ? connecting.portId : portId;
      const toNodeId = direction === 'out' ? connecting.nodeId : nodeId;
      const toPortId = direction === 'out' ? connecting.portId : portId;

      if (fromNodeId === toNodeId) { setConnecting(null); return; }

      const conn = createConnection(fromNodeId, fromPortId, toNodeId, toPortId, connecting.type);
      updateWf({ connections: [...wf.connections, conn] });
      setConnecting(null);
    }
  }, [connecting, wf, updateWf]);

  // 更新节点属性
  const handleNodeUpdate = useCallback((id: string, updates: Partial<WorkflowNode>) => {
    setWf(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (n.id !== id) return n;
        // 深度合并config，保留非config的顶级字段直接展开
        const newConfig = { ...n.config, ...(updates.config || {}) };
        const { config: _cfg, ...topLevel } = updates as Record<string, unknown>;
        return { ...n, ...topLevel, config: newConfig };
      }),
      updatedAt: Date.now(),
    }));
  }, []);

  // 切换断点
  const handleToggleBreakpoint = useCallback((id: string) => {
    setWf(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => n.id === id ? { ...n, breakpoint: !n.breakpoint } : n),
      updatedAt: Date.now(),
    }));
  }, []);

  // 删除选中
  const handleDelete = useCallback(() => {
    if (selectedNodeId) {
      setWf(prev => ({
        ...prev,
        nodes: prev.nodes.filter(n => n.id !== selectedNodeId),
        connections: prev.connections.filter(c => c.fromNodeId !== selectedNodeId && c.toNodeId !== selectedNodeId),
        updatedAt: Date.now(),
      }));
      setSelectedNodeId(null);
    } else if (selectedConnId) {
      setWf(prev => ({
        ...prev,
        connections: prev.connections.filter(c => c.id !== selectedConnId),
        updatedAt: Date.now(),
      }));
      setSelectedConnId(null);
    }
  }, [selectedNodeId, selectedConnId]);

  // 画布平移
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 && e.target === svgRef.current) {
      isPanning.current = true;
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      setSelectedNodeId(null);
      setSelectedConnId(null);
    }
  }, [pan]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) {
      setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
    }
  }, []);

  const handleCanvasMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  // 缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.min(3, Math.max(0.2, prev * delta)));
  }, []);

  // 键盘事件
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
        handleDelete();
      }
      if (e.key === 'Escape') {
        setConnecting(null);
        setSelectedNodeId(null);
        setSelectedConnId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleDelete]);

  const selectedNode = wf.nodes.find(n => n.id === selectedNodeId) || null;

  // 模拟运行
  const handleRun = useCallback(() => {
    if (wf.nodes.length === 0) return;
    setRunning(true);
    let idx = 0;
    const interval = setInterval(() => {
      if (idx < wf.nodes.length) {
        setRunningNodeId(wf.nodes[idx].id);
        idx++;
      } else {
        setRunningNodeId(null);
        setRunning(false);
        updateWf({ status: 'completed' });
        clearInterval(interval);
      }
    }, 800);
  }, [wf.nodes, updateWf]);

  return (
    <div className="fixed inset-0 bg-[#0e1117] z-[100] flex flex-col">
      <style>{`
        @keyframes agentGlow {
          0%, 100% { filter: drop-shadow(0 0 4px rgba(244,114,182,0.3)); }
          50% { filter: drop-shadow(0 0 12px rgba(244,114,182,0.7)); }
        }
        @keyframes goldPulse {
          0%, 100% { box-shadow: 0 0 4px rgba(212,175,55,0.3); }
          50% { box-shadow: 0 0 16px rgba(212,175,55,0.7); }
        }
        @keyframes dashFlow {
          to { stroke-dashoffset: -20; }
        }
        @keyframes breakpointPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.4); opacity: 0.6; }
        }
        @keyframes selectRing {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        @keyframes condFlash {
          0%, 45% { stroke: #f59e0b; }
          50%, 95% { stroke: #ef4444; }
          100% { stroke: #f59e0b; }
        }
        @keyframes subgraphBreathe {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.6; }
        }
        .node-agent { animation: agentGlow 2s ease-in-out infinite; }
        .node-running { animation: goldPulse 1.5s ease-in-out infinite; }
        .dash-flow { animation: dashFlow 0.8s linear infinite; }
        .breakpoint-pulse { animation: breakpointPulse 1.2s ease-in-out infinite; }
        .select-ring { animation: selectRing 2s ease-in-out infinite; }
        .cond-flash { animation: condFlash 2s ease-in-out infinite; }
        .subgraph-breathe { animation: subgraphBreathe 3s ease-in-out infinite; }
      `}</style>
      {/* 顶部工具栏 */}
      <div className="h-11 bg-[#161b22] border-b border-[#30363d] flex items-center px-3 gap-3 shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-md hover:bg-[#1c2333] text-[#7d8590] hover:text-[#e6edf3] transition-colors" title="返回画布">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-px h-5 bg-[#30363d]" />
        <span className="text-sm font-medium text-[#e6edf3]">{wf.name}</span>
        <span className="text-[10px] text-[#7d8590]">{wf.version}</span>
        <div className="flex-1" />
        <button onClick={() => setLibCollapsed(!libCollapsed)}
          className="px-2.5 py-1 rounded-md text-xs text-[#7d8590] hover:text-[#e6edf3] hover:bg-[#1c2333] transition-colors">
          节点库
        </button>
        <button className="px-2.5 py-1 rounded-md text-xs text-[#7d8590] hover:text-[#e6edf3] hover:bg-[#1c2333] transition-colors">
          保存
        </button>
        <button onClick={handleRun} disabled={running}
          className="px-4 py-1.5 rounded-md text-xs font-medium bg-[#d4af37] text-[#0e1117] hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50">
          {running ? '执行中...' : '运行工作流'}
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧节点库 */}
        <NodeLibrarySidebar onAddNode={handleAddNode} collapsed={libCollapsed} onToggleCollapse={() => setLibCollapsed(!libCollapsed)} />

        {/* 中间画布 */}
        <div className="flex-1 relative overflow-hidden">
          {/* 连接提示 */}
          {connecting && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-[#d4af37] text-[#0e1117] text-xs font-medium px-3 py-1 rounded-full">
              点击目标端口完成连接 · ESC 取消
            </div>
          )}

          <svg ref={svgRef} className="w-full h-full"
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onWheel={handleWheel}>
            {/* 网格背景 */}
            <defs>
              <pattern id="node-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.5" fill="#30363d" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="#0e1117" />
            <rect width="100%" height="100%" fill="url(#node-grid)" />

            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* 连线 */}
              {wf.connections.map(conn => (
                <ConnectionLine key={conn.id} conn={conn} nodes={wf.nodes}
                  isSelected={conn.id === selectedConnId} onSelect={setSelectedConnId} />
              ))}
              {/* 节点 */}
              {wf.nodes.map(node => (
                <NodeCard key={node.id} node={node}
                  isSelected={node.id === selectedNodeId}
                  isRunning={node.id === runningNodeId}
                  onSelect={setSelectedNodeId}
                  onDrag={handleNodeDrag}
                  onPortClick={handlePortClick}
                  onToggleBreakpoint={handleToggleBreakpoint} />
              ))}
            </g>
          </svg>

          {/* 缩放控制 */}
          <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-[#161b22] border border-[#30363d] rounded-lg px-2 py-1">
            <button onClick={() => setZoom(z => Math.max(0.2, z * 0.8))} className="p-1 text-[#7d8590] hover:text-[#e6edf3]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14" /></svg>
            </button>
            <span className="text-[10px] text-[#7d8590] min-w-[36px] text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(3, z * 1.2))} className="p-1 text-[#7d8590] hover:text-[#e6edf3]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-1 text-[#7d8590] hover:text-[#e6edf3]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>
            </button>
          </div>

          {/* 空态提示 */}
          {wf.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-lg font-bold text-[#e6edf3]">节点编辑器</p>
                <p className="text-sm text-[#7d8590] mt-1">从左侧节点库拖入节点，或点击添加</p>
              </div>
            </div>
          )}
        </div>

        {/* 右侧属性面板 */}
        <div className="w-[280px] bg-[#161b22] border-l border-[#30363d] shrink-0">
          <div className="h-8 border-b border-[#30363d] flex items-center px-3">
            <span className="text-xs font-medium text-[#7d8590]">属性</span>
          </div>
          <PropertyPanel node={selectedNode} onUpdate={handleNodeUpdate} onToggleBreakpoint={handleToggleBreakpoint} />
        </div>
      </div>

      {/* 底部调试栏 */}
      <div className="h-11 bg-[#161b22] border-t border-[#30363d] flex items-center px-3 gap-2 shrink-0">
        {/* 控制按钮 */}
        <button onClick={handleRun} disabled={running}
          className="p-1.5 rounded text-[#7d8590] hover:text-[#2ea043] hover:bg-[#1c2333] disabled:opacity-50 transition-colors" title="运行">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
        </button>
        <button disabled={!running} className="p-1.5 rounded text-[#7d8590] hover:text-[#d4af37] hover:bg-[#1c2333] disabled:opacity-50 transition-colors" title="暂停">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
        </button>
        <button className="p-1.5 rounded text-[#7d8590] hover:text-[#3b82f6] hover:bg-[#1c2333] transition-colors" title="单步执行">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" /></svg>
        </button>
        <button onClick={() => { setRunning(false); setRunningNodeId(null); }} className="p-1.5 rounded text-[#7d8590] hover:text-[#f85149] hover:bg-[#1c2333] transition-colors" title="重置">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
        </button>

        <div className="w-px h-5 bg-[#30363d]" />

        {/* 断点标记 */}
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-full bg-[#f85149] opacity-60" style={{ animation: 'breakpointPulse 2s infinite' }} />
          <span className="text-[10px] text-[#7d8590]">断点: {wf.nodes.filter(n => n.breakpoint).length}</span>
        </div>

        <div className="w-px h-5 bg-[#30363d]" />

        {/* 进度条 */}
        <div className="flex items-center gap-2 flex-1 max-w-xs">
          <div className="flex-1 h-1.5 bg-[#30363d] rounded-full overflow-hidden">
            <div className="h-full bg-[#d4af37] rounded-full transition-all duration-300"
              style={{ width: `${wf.nodes.length > 0 ? ((wf.nodes.findIndex(n => n.id === runningNodeId) + 1) / wf.nodes.length * 100) : 0}%`, animation: running ? 'progressFill 2s infinite' : 'none' }} />
          </div>
          <span className="text-[10px] text-[#7d8590] whitespace-nowrap">
            {running && runningNodeId
              ? `${wf.nodes.findIndex(n => n.id === runningNodeId) + 1}/${wf.nodes.length}`
              : `0/${wf.nodes.length}`}
          </span>
        </div>

        {/* 计时器 */}
        {running && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-[#2ea043]" style={{ animation: 'agentGlow 1.5s infinite' }} />
            <span className="text-[10px] text-[#2ea043] font-mono">
              {Math.floor((Date.now() % 60000) / 1000)}s
            </span>
          </div>
        )}

        <div className="flex-1" />

        {/* 当前执行节点 */}
        {running && runningNodeId && (
          <span className="text-[10px] text-[#d4af37] flex items-center gap-1" style={{ animation: 'goldPulse 2s infinite' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" /></svg>
            {wf.nodes.find(n => n.id === runningNodeId)?.label}
          </span>
        )}

        {!running && (
          <span className="text-[10px] text-[#7d8590]">就绪</span>
        )}

        <div className="w-px h-5 bg-[#30363d]" />

        <span className="text-[10px] text-[#7d8590]">节点: {wf.nodes.length} · 连线: {wf.connections.length}</span>
      </div>

      {/* 小地图 - 右下角 */}
      {(() => {
        // 计算节点边界框
        const nodesBBox = wf.nodes.length > 0 ? {
          minX: Math.min(...wf.nodes.map(n => n.x)) - 50,
          minY: Math.min(...wf.nodes.map(n => n.y)) - 50,
          maxX: Math.max(...wf.nodes.map(n => n.x + n.width)) + 50,
          maxY: Math.max(...wf.nodes.map(n => n.y + n.height)) + 50,
        } : { minX: 0, minY: 0, maxX: 800, maxY: 600 };
        const bboxW = nodesBBox.maxX - nodesBBox.minX;
        const bboxH = nodesBBox.maxY - nodesBBox.minY;
        return (
          <div className="absolute bottom-14 right-2 w-40 h-28 bg-[#161b22]/90 border border-[#30363d] rounded-lg overflow-hidden z-20">
            <svg width="100%" height="100%" viewBox={`${nodesBBox.minX} ${nodesBBox.minY} ${bboxW} ${bboxH}`}>
              {/* 节点缩略图 */}
              {wf.nodes.map(node => {
                const catColor = Object.values(NODE_TYPE_COLORS).find(() => false);
                const nodeCat = Object.entries(NODE_TYPE_COLORS).find(([cat]) => {
                  const types = NODE_TEMPLATES.filter(t => t.category === cat);
                  return types.some(t => t.type === node.type);
                });
                const color = nodeCat ? nodeCat[1] : '#7d8590';
                const isRunning = node.id === runningNodeId;
                return (
                  <rect
                    key={node.id}
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    fill={color}
                    fillOpacity={isRunning ? 0.9 : 0.5}
                    rx="2"
                    stroke={isRunning ? '#d4af37' : 'none'}
                    strokeWidth={isRunning ? 1 : 0}
                  />
                );
              })}
              {/* 视口矩形 */}
              <rect
                x={-pan.x / zoom}
                y={-pan.y / zoom}
                width={160 / zoom}
                height={112 / zoom}
                fill="none"
                stroke="#d4af37"
                strokeWidth="2"
                strokeOpacity="0.6"
                rx="1"
              />
            </svg>
            <div className="absolute top-1 left-1 text-[8px] text-[#7d8590] bg-[#161b22]/80 px-1 rounded">
              {Math.round(zoom * 100)}%
            </div>
          </div>
        );
      })()}
    </div>
  );
}
