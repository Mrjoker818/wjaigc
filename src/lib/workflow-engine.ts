/**
 * 工作流引擎 — 节点模式数据模型
 * 支持节点图(DAG)、连线、条件分支、循环节点、Agent节点、子图
 */

// ==================== 节点类型 ====================

export type NodeType =
  | 'input-image' | 'input-text' | 'input-param'
  | 'ai-generate' | 'ai-edit' | 'ai-upscale' | 'ai-removebg' | 'ai-vectorize' | 'ai-style-transfer' | 'ai-color-adjust'
  | 'condition-if' | 'condition-switch' | 'loop-for' | 'loop-while' | 'parallel'
  | 'agent-auto' | 'agent-chat'
  | 'subgraph' | 'group'
  | 'output-image' | 'output-save' | 'output-export';

export type NodeCategory = 'input' | 'ai' | 'logic' | 'agent' | 'subgraph' | 'output';

/** 节点分类 → 颜色映射 */
export const NODE_TYPE_COLORS: Record<NodeCategory, string> = {
  input: '#3b82f6',     // 蓝
  ai: '#d4af37',        // 金
  logic: '#f59e0b',     // 黄
  agent: '#f472b6',     // 粉
  subgraph: '#06b6d4',  // 青
  output: '#2ea043',    // 绿
};

/** 节点分类 → 中文名 */
export const NODE_CATEGORY_LABELS: Record<NodeCategory, string> = {
  input: '输入节点',
  ai: 'AI 节点',
  logic: '逻辑控制',
  agent: 'Agent',
  subgraph: '子图/组合',
  output: '输出节点',
};

/** 获取节点所属分类 */
export function getNodeCategory(type: NodeType): NodeCategory {
  if (type.startsWith('input-')) return 'input';
  if (type.startsWith('ai-')) return 'ai';
  if (type.startsWith('condition-') || type.startsWith('loop-') || type === 'parallel') return 'logic';
  if (type.startsWith('agent-')) return 'agent';
  if (type === 'subgraph' || type === 'group') return 'subgraph';
  if (type.startsWith('output-')) return 'output';
  return 'ai';
}

/** 节点类型 → 中文名 */
export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  'input-image': '图片输入',
  'input-text': '文本输入',
  'input-param': '参数输入',
  'ai-generate': '图像生成',
  'ai-edit': '图像编辑',
  'ai-upscale': '无损放大',
  'ai-removebg': '移除背景',
  'ai-vectorize': '矢量化',
  'ai-style-transfer': '风格转换',
  'ai-color-adjust': '调色',
  'condition-if': '条件分支',
  'condition-switch': '开关分支',
  'loop-for': '循环',
  'loop-while': '条件循环',
  'parallel': '并行执行',
  'agent-auto': 'Agent 自动',
  'agent-chat': 'Agent 对话',
  'subgraph': '子图',
  'group': '组合',
  'output-image': '图片输出',
  'output-save': '保存',
  'output-export': '导出',
};

/** 节点类型 → 图标名 */
export const NODE_TYPE_ICONS: Record<NodeType, string> = {
  'input-image': 'Image',
  'input-text': 'Type',
  'input-param': 'SlidersHorizontal',
  'ai-generate': 'Wand2',
  'ai-edit': 'Pencil',
  'ai-upscale': 'Maximize',
  'ai-removebg': 'Scissors',
  'ai-vectorize': 'PenTool',
  'ai-style-transfer': 'Palette',
  'ai-color-adjust': 'Sun',
  'condition-if': 'GitBranch',
  'condition-switch': 'GitMerge',
  'loop-for': 'Repeat',
  'loop-while': 'RefreshCw',
  'parallel': 'Layers',
  'agent-auto': 'Bot',
  'agent-chat': 'MessageSquare',
  'subgraph': 'BoxSelect',
  'group': 'Group',
  'output-image': 'ImageDown',
  'output-save': 'Save',
  'output-export': 'Download',
};

// ==================== 端口类型 ====================

export type PortType = 'image' | 'mask' | 'prompt' | 'condition' | 'any' | 'video' | 'audio' | 'data';

export const PORT_COLORS: Record<PortType, string> = {
  image: '#3b82f6',
  mask: '#f472b6',
  prompt: '#a78bfa',
  condition: '#f59e0b',
  any: '#7d8590',
  video: '#ef4444',
  audio: '#f97316',
  data: '#22d3ee',
};

// ==================== 数据模型 ====================

export interface NodePort {
  id: string;
  label: string;
  type: PortType;
  direction: 'in' | 'out';
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ports: NodePort[];
  config: Record<string, unknown>;
  /** 条件节点: 条件表达式 */
  condition?: string;
  /** 循环节点: 循环次数 */
  loopCount?: number;
  /** Agent节点: 当前决策轮次 */
  agentRound?: number;
  /** 子图节点: 子工作流ID */
  subgraphId?: string;
  /** 调试断点 */
  breakpoint?: boolean;
}

export interface WorkflowConnection {
  id: string;
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
  /** 连线类型 */
  type: PortType;
}

export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export interface Workflow {
  id: string;
  name: string;
  version: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  status: WorkflowStatus;
  createdAt: number;
  updatedAt: number;
  /** 描述 */
  description?: string;
  /** 缩略图URL */
  thumbnailUrl?: string;
  /** 是否收藏 */
  favorited?: boolean;
  /** 执行统计 */
  stats?: {
    totalRuns: number;
    avgDurationMs: number;
    successRate: number;
  };
}

// ==================== 节点模板 ====================

export const NODE_TEMPLATES: { type: NodeType; category: NodeCategory; label: string; desc: string }[] = [
  // 输入
  { type: 'input-image', category: 'input', label: '图片输入', desc: '加载图片到工作流' },
  { type: 'input-text', category: 'input', label: '文本输入', desc: '提示词/描述文本' },
  { type: 'input-param', category: 'input', label: '参数输入', desc: '数值/选项参数' },
  // AI
  { type: 'ai-generate', category: 'ai', label: '图像生成', desc: 'AI生成新图片' },
  { type: 'ai-edit', category: 'ai', label: '图像编辑', desc: '修图/擦除/扩展' },
  { type: 'ai-upscale', category: 'ai', label: '无损放大', desc: '超分辨率放大' },
  { type: 'ai-removebg', category: 'ai', label: '移除背景', desc: '智能抠图去背景' },
  { type: 'ai-vectorize', category: 'ai', label: '矢量化', desc: '位图转矢量图' },
  { type: 'ai-style-transfer', category: 'ai', label: '风格转换', desc: '图生图风格迁移' },
  { type: 'ai-color-adjust', category: 'ai', label: '调色', desc: '亮度/对比度/饱和度' },
  // 逻辑
  { type: 'condition-if', category: 'logic', label: '条件分支', desc: 'If/Else 条件判断' },
  { type: 'condition-switch', category: 'logic', label: '开关分支', desc: '多路选择器' },
  { type: 'loop-for', category: 'logic', label: '循环', desc: '固定次数循环' },
  { type: 'loop-while', category: 'logic', label: '条件循环', desc: '满足条件时循环' },
  { type: 'parallel', category: 'logic', label: '并行执行', desc: '多路并行处理' },
  // Agent
  { type: 'agent-auto', category: 'agent', label: 'Agent 自动', desc: 'AI自主决策执行' },
  { type: 'agent-chat', category: 'agent', label: 'Agent 对话', desc: '对话式Agent交互' },
  // 子图
  { type: 'subgraph', category: 'subgraph', label: '子图', desc: '嵌套工作流' },
  { type: 'group', category: 'subgraph', label: '组合', desc: '节点编组' },
  // 输出
  { type: 'output-image', category: 'output', label: '图片输出', desc: '输出图片结果' },
  { type: 'output-save', category: 'output', label: '保存', desc: '保存到项目/本地' },
  { type: 'output-export', category: 'output', label: '导出', desc: 'PSD/SVG/PNG导出' },
];

/** 创建默认端口 */
function createDefaultPorts(type: NodeType): NodePort[] {
  const cat = getNodeCategory(type);
  const ports: NodePort[] = [];

  // 输入端口
  if (cat !== 'input') {
    if (type.startsWith('ai-')) {
      ports.push({ id: 'in-image', label: '图片', type: 'image', direction: 'in' });
      ports.push({ id: 'in-prompt', label: '提示词', type: 'prompt', direction: 'in' });
    } else if (cat === 'logic') {
      ports.push({ id: 'in-data', label: '输入', type: 'any', direction: 'in' });
    } else if (cat === 'agent') {
      ports.push({ id: 'in-image', label: '图片', type: 'image', direction: 'in' });
      ports.push({ id: 'in-prompt', label: '指令', type: 'prompt', direction: 'in' });
    } else if (cat === 'output') {
      ports.push({ id: 'in-image', label: '图片', type: 'image', direction: 'in' });
    }
  }

  // 输出端口
  if (cat !== 'output') {
    if (cat === 'input') {
      if (type === 'input-image') {
        ports.push({ id: 'out-image', label: '图片', type: 'image', direction: 'out' });
      } else {
        ports.push({ id: 'out-data', label: '数据', type: 'data', direction: 'out' });
      }
    } else if (type.startsWith('ai-')) {
      ports.push({ id: 'out-image', label: '图片', type: 'image', direction: 'out' });
    } else if (type === 'condition-if') {
      ports.push({ id: 'out-true', label: 'True', type: 'condition', direction: 'out' });
      ports.push({ id: 'out-false', label: 'False', type: 'condition', direction: 'out' });
    } else if (type === 'condition-switch') {
      ports.push({ id: 'out-1', label: '分支1', type: 'condition', direction: 'out' });
      ports.push({ id: 'out-2', label: '分支2', type: 'condition', direction: 'out' });
      ports.push({ id: 'out-3', label: '分支3', type: 'condition', direction: 'out' });
    } else if (type.startsWith('loop-')) {
      ports.push({ id: 'out-loop', label: '循环体', type: 'any', direction: 'out' });
      ports.push({ id: 'out-done', label: '完成', type: 'any', direction: 'out' });
    } else if (type === 'parallel') {
      ports.push({ id: 'out-1', label: '通道1', type: 'any', direction: 'out' });
      ports.push({ id: 'out-2', label: '通道2', type: 'any', direction: 'out' });
    } else if (cat === 'agent') {
      ports.push({ id: 'out-image', label: '图片', type: 'image', direction: 'out' });
      ports.push({ id: 'out-data', label: '数据', type: 'data', direction: 'out' });
    } else if (cat === 'subgraph') {
      ports.push({ id: 'out-image', label: '图片', type: 'image', direction: 'out' });
    }
  }

  return ports;
}

/** 创建工作流节点 */
export function createWorkflowNode(type: NodeType, x: number, y: number, label?: string): WorkflowNode {
  const cat = getNodeCategory(type);
  const color = NODE_TYPE_COLORS[cat];
  const defaultLabel = label || NODE_TYPE_LABELS[type];

  const isCondition = type.startsWith('condition-');
  const width = isCondition ? 110 : 180;
  const height = isCondition ? 110 : 60;

  return {
    id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    label: defaultLabel,
    x,
    y,
    width,
    height,
    ports: createDefaultPorts(type),
    config: { color },
    condition: type.startsWith('condition-') ? '' : undefined,
    loopCount: type.startsWith('loop-') ? 3 : undefined,
    agentRound: 0,
    breakpoint: false,
  };
}

/** 创建连线 */
export function createConnection(
  fromNodeId: string, fromPortId: string,
  toNodeId: string, toPortId: string,
  type: PortType = 'any'
): WorkflowConnection {
  return {
    id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fromNodeId,
    fromPortId,
    toNodeId,
    toPortId,
    type,
  };
}

/** 创建空工作流 */
export function createEmptyWorkflow(name: string): Workflow {
  const now = Date.now();
  return {
    id: `wf-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    version: 'v1.0',
    nodes: [],
    connections: [],
    status: 'idle',
    createdAt: now,
    updatedAt: now,
    description: '',
    stats: { totalRuns: 0, avgDurationMs: 0, successRate: 0 },
  };
}

// ==================== 节点属性面板配置 ====================

export interface PropertyField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'slider' | 'toggle' | 'model-select';
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: unknown;
}

/** 获取节点类型的属性面板字段 */
export function getNodePropertyFields(type: NodeType): PropertyField[] {
  const cat = getNodeCategory(type);
  const fields: PropertyField[] = [];

  // 通用: 标签
  fields.push({ key: 'label', label: '名称', type: 'text', defaultValue: NODE_TYPE_LABELS[type] });

  if (cat === 'ai') {
    fields.push({ key: 'model', label: '模型', type: 'model-select' });
    fields.push({ key: 'prompt', label: '提示词', type: 'textarea' });
    if (type === 'ai-generate') {
      fields.push({ key: 'quality', label: '质量', type: 'select', options: [
        { label: '标准', value: 'standard' }, { label: '高清', value: 'hd' }
      ]});
      fields.push({ key: 'size', label: '尺寸', type: 'select', options: [
        { label: '1024x1024', value: '1024x1024' }, { label: '1152x864', value: '1152x864' },
        { label: '1280x720', value: '1280x720' }, { label: '720x1280', value: '720x1280' }
      ]});
    }
    if (type === 'ai-upscale') {
      fields.push({ key: 'scale', label: '倍率', type: 'select', options: [
        { label: '2x', value: '2' }, { label: '4x', value: '4' }
      ], defaultValue: '2' });
    }
  }

  if (type === 'condition-if') {
    fields.push({ key: 'condition', label: '条件表达式', type: 'textarea' });
  }
  if (type === 'condition-switch') {
    fields.push({ key: 'cases', label: '分支数', type: 'number', min: 2, max: 8, defaultValue: 3 });
  }
  if (type.startsWith('loop-')) {
    fields.push({ key: 'loopCount', label: '循环次数', type: 'number', min: 1, max: 100, defaultValue: 3 });
  }
  if (type === 'agent-auto') {
    fields.push({ key: 'maxRounds', label: '最大轮次', type: 'number', min: 1, max: 20, defaultValue: 5 });
    fields.push({ key: 'tools', label: '可用工具', type: 'text', defaultValue: 'image_edit,generate_image,analyze_image' });
  }
  if (type === 'agent-chat') {
    fields.push({ key: 'systemPrompt', label: '系统提示词', type: 'textarea' });
  }

  if (cat === 'input' && type === 'input-image') {
    fields.push({ key: 'source', label: '来源', type: 'select', options: [
      { label: '上传', value: 'upload' }, { label: 'URL', value: 'url' }, { label: '画布选图', value: 'canvas' }
    ]});
  }

  if (cat === 'output' && type === 'output-export') {
    fields.push({ key: 'format', label: '格式', type: 'select', options: [
      { label: 'PNG', value: 'png' }, { label: 'SVG', value: 'svg' }, { label: 'PSD', value: 'psd' }
    ]});
  }

  // 断点
  fields.push({ key: 'breakpoint', label: '断点', type: 'toggle', defaultValue: false });

  return fields;
}
