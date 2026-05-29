/**
 * 工作流引擎 — 节点模式数据模型 + 执行引擎
 * 支持节点图(DAG)、连线、条件分支、循环节点、Agent节点、子图
 * 执行引擎：DAG拓扑排序 → 逐节点调度 → API调用 → 结果传递
 */

// ==================== 节点类型 ====================

export type NodeType =
  | 'input-image' | 'input-text' | 'input-param'
  | 'ai-generate' | 'ai-edit' | 'ai-retouch' | 'ai-upscale' | 'ai-removebg' | 'ai-vectorize' | 'ai-style-transfer' | 'ai-color-adjust' | 'ai-analyze'
  | 'condition-if' | 'condition-switch' | 'loop-for' | 'loop-while' | 'loop-each' | 'parallel'
  | 'agent-auto' | 'agent-chat'
  | 'subgraph' | 'group'
  | 'output-image' | 'output-save' | 'output-export';

export type NodeCategory = 'input' | 'ai' | 'logic' | 'agent' | 'subgraph' | 'output';

/** 节点分类 → 颜色映射 */
export const NODE_TYPE_COLORS: Record<NodeCategory, string> = {
  input: '#3b82f6',
  ai: '#d4af37',
  logic: '#f59e0b',
  agent: '#f472b6',
  subgraph: '#06b6d4',
  output: '#2ea043',
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
  'ai-analyze': 'AI分析',
  'ai-retouch': 'AI修图',
  'condition-if': '条件分支',
  'condition-switch': '开关分支',
  'loop-for': '循环',
  'loop-each': '逐项循环',
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
  'ai-analyze': 'ScanSearch',
  'ai-retouch': 'Wand2',
  'condition-if': 'GitBranch',
  'condition-switch': 'GitMerge',
  'loop-for': 'Repeat',
  'loop-each': 'RepeatOne',
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
  description?: string;
  thumbnailUrl?: string;
  favorited?: boolean;
  stats?: {
    totalRuns: number;
    avgDurationMs: number;
    successRate: number;
  };
}

// ==================== 节点模板 ====================

export const NODE_TEMPLATES: { type: NodeType; category: NodeCategory; label: string; desc: string }[] = [
  { type: 'input-image', category: 'input', label: '图片输入', desc: '加载图片到工作流' },
  { type: 'input-text', category: 'input', label: '文本输入', desc: '提示词/描述文本' },
  { type: 'input-param', category: 'input', label: '参数输入', desc: '数值/选项参数' },
  { type: 'ai-generate', category: 'ai', label: '图像生成', desc: 'AI生成新图片' },
  { type: 'ai-edit', category: 'ai', label: '图像编辑', desc: '修图/擦除/扩展' },
  { type: 'ai-upscale', category: 'ai', label: '无损放大', desc: '超分辨率放大' },
  { type: 'ai-removebg', category: 'ai', label: '移除背景', desc: '智能抠图去背景' },
  { type: 'ai-vectorize', category: 'ai', label: '矢量化', desc: '位图转矢量图' },
  { type: 'ai-style-transfer', category: 'ai', label: '风格转换', desc: '图生图风格迁移' },
  { type: 'ai-color-adjust', category: 'ai', label: '调色', desc: '亮度/对比度/饱和度' },
  { type: 'condition-if', category: 'logic', label: '条件分支', desc: 'If/Else 条件判断' },
  { type: 'condition-switch', category: 'logic', label: '开关分支', desc: '多路选择器' },
  { type: 'loop-for', category: 'logic', label: '循环', desc: '固定次数循环' },
  { type: 'loop-while', category: 'logic', label: '条件循环', desc: '满足条件时循环' },
  { type: 'loop-each', category: 'logic', label: '逐项循环', desc: '遍历列表' },
  { type: 'parallel', category: 'logic', label: '并行执行', desc: '多路并行处理' },
  { type: 'agent-auto', category: 'agent', label: 'Agent 自动', desc: 'AI自主决策执行' },
  { type: 'agent-chat', category: 'agent', label: 'Agent 对话', desc: '对话式Agent交互' },
  { type: 'subgraph', category: 'subgraph', label: '子图', desc: '嵌套工作流' },
  { type: 'group', category: 'subgraph', label: '组合', desc: '节点编组' },
  { type: 'output-image', category: 'output', label: '图片输出', desc: '输出图片结果' },
  { type: 'output-save', category: 'output', label: '保存', desc: '保存到项目/本地' },
  { type: 'output-export', category: 'output', label: '导出', desc: 'PSD/SVG/PNG导出' },
];

/** 创建默认端口 */
function createDefaultPorts(type: NodeType): NodePort[] {
  const cat = getNodeCategory(type);
  const ports: NodePort[] = [];

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
  type: 'text' | 'textarea' | 'number' | 'select' | 'slider' | 'toggle' | 'model-select' | 'image-upload';
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: unknown;
  placeholder?: string;
}

/** 获取节点类型的属性面板字段 */
export function getNodePropertyFields(type: NodeType): PropertyField[] {
  const cat = getNodeCategory(type);
  const fields: PropertyField[] = [];

  // 通用: 标签
  fields.push({ key: 'label', label: '名称', type: 'text', defaultValue: NODE_TYPE_LABELS[type] });

  // ─── 输入节点 ───
  if (type === 'input-image') {
    fields.push({ key: 'source', label: '来源', type: 'select', options: [
      { label: '上传图片', value: 'upload' }, { label: 'URL地址', value: 'url' }, { label: '画布选图', value: 'canvas' }
    ], defaultValue: 'upload' });
    fields.push({ key: 'imageUrl', label: '图片URL', type: 'text', placeholder: '输入图片URL或上传图片' });
  }

  if (type === 'input-text') {
    fields.push({ key: 'text', label: '文本内容', type: 'textarea', placeholder: '输入提示词或描述文本' });
    fields.push({ key: 'negativePrompt', label: '反向提示词', type: 'textarea', placeholder: '低质量, 模糊, 变形...' });
  }

  if (type === 'input-param') {
    fields.push({ key: 'paramType', label: '参数类型', type: 'select', options: [
      { label: '数值', value: 'number' }, { label: '范围', value: 'range' }, { label: '选项', value: 'choice' }
    ], defaultValue: 'number' });
    fields.push({ key: 'value', label: '默认值', type: 'number', defaultValue: 0 });
    fields.push({ key: 'min', label: '最小值', type: 'number' });
    fields.push({ key: 'max', label: '最大值', type: 'number' });
  }

  // ─── AI节点 ───
  if (cat === 'ai') {
    fields.push({ key: 'model', label: '模型', type: 'model-select' });
    fields.push({ key: 'prompt', label: '提示词', type: 'textarea', placeholder: '描述你想要的图像效果' });
    fields.push({ key: 'negativePrompt', label: '反向提示词', type: 'textarea', placeholder: '低质量, 模糊, 变形...' });

    if (type === 'ai-generate') {
      fields.push({ key: 'quality', label: '质量', type: 'select', options: [
        { label: '标准', value: 'standard' }, { label: '高清', value: 'hd' }
      ], defaultValue: 'standard' });
      fields.push({ key: 'size', label: '尺寸', type: 'select', options: [
        { label: '1024×1024', value: '1024x1024' }, { label: '1152×864', value: '1152x864' },
        { label: '1280×720', value: '1280x720' }, { label: '720×1280', value: '720x1280' },
        { label: '864×1152', value: '864x1152' }, { label: '1792×1024', value: '1792x1024' }
      ], defaultValue: '1024x1024' });
      fields.push({ key: 'seed', label: '随机种子', type: 'number', min: -1, max: 2147483647, defaultValue: -1, placeholder: '-1为随机' });
      fields.push({ key: 'n', label: '生成数量', type: 'number', min: 1, max: 4, defaultValue: 1 });
    }

    if (type === 'ai-edit') {
      fields.push({ key: 'action', label: '操作类型', type: 'select', options: [
        { label: '擦除', value: 'erase' }, { label: '蒙版修图', value: 'mask' },
        { label: '扩展画面', value: 'extend' }, { label: '语言修图', value: 'edit' }
      ], defaultValue: 'edit' });
      fields.push({ key: 'strength', label: '强度', type: 'slider', min: 0, max: 100, step: 5, defaultValue: 75 });
    }

    if (type === 'ai-upscale') {
      fields.push({ key: 'scale', label: '放大倍率', type: 'select', options: [
        { label: '2×', value: '2' }, { label: '4×', value: '4' }
      ], defaultValue: '2' });
      fields.push({ key: 'format', label: '输出格式', type: 'select', options: [
        { label: 'PNG', value: 'png' }, { label: 'JPG', value: 'jpg' }, { label: 'WebP', value: 'webp' }
      ], defaultValue: 'png' });
    }

    if (type === 'ai-removebg') {
      fields.push({ key: 'model', label: '模型', type: 'select', options: [
        { label: 'BiRefNet 通用（推荐）', value: 'birefnet-general-lite' },
        { label: 'U2Net 轻量快速', value: 'u2net' },
        { label: 'Silueta 轻量人像', value: 'silueta' }
      ], defaultValue: 'birefnet-general-lite' });
    }

    if (type === 'ai-style-transfer') {
      fields.push({ key: 'strength', label: '风格强度', type: 'slider', min: 0, max: 100, step: 5, defaultValue: 50 });
      fields.push({ key: 'stylePrompt', label: '风格描述', type: 'textarea', placeholder: '如: 赛博朋克, 水彩画...' });
    }

    if (type === 'ai-color-adjust') {
      fields.push({ key: 'brightness', label: '亮度', type: 'slider', min: -100, max: 100, step: 1, defaultValue: 0 });
      fields.push({ key: 'contrast', label: '对比度', type: 'slider', min: -100, max: 100, step: 1, defaultValue: 0 });
      fields.push({ key: 'saturation', label: '饱和度', type: 'slider', min: -100, max: 100, step: 1, defaultValue: 0 });
    }

    if (type === 'ai-vectorize') {
      fields.push({ key: 'mode', label: '模式', type: 'select', options: [
        { label: '彩色矢量化', value: 'color' }, { label: '黑白轮廓', value: 'bw' }
      ], defaultValue: 'color' });
      fields.push({ key: 'quality', label: '质量', type: 'select', options: [
        { label: '快速 (64色)', value: 'fast' }, { label: '均衡 (256色)', value: 'balanced' },
        { label: '高清 (1024色)', value: 'hd' }, { label: '极致 (4096色)', value: 'ultra' }
      ], defaultValue: 'balanced' });
    }

    if (type === 'ai-analyze') {
      fields.push({ key: 'analysisType', label: '分析类型', type: 'select', options: [
        { label: '内容描述', value: 'describe' }, { label: '风格识别', value: 'style' },
        { label: '元素识别', value: 'elements' }, { label: '关键词提取', value: 'keywords' }
      ], defaultValue: 'describe' });
    }

    if (type === 'ai-retouch') {
      fields.push({ key: 'editModel', label: '修图模型', type: 'model-select' });
      fields.push({ key: 'size', label: '输出尺寸', type: 'select', options: [
        { label: '1024', value: '1024' }, { label: '1536', value: '1536' }, { label: '2048', value: '2048' }
      ], defaultValue: '1024' });
    }
  }

  // ─── 逻辑控制节点 ───
  if (type === 'condition-if') {
    fields.push({ key: 'condition', label: '条件表达式', type: 'textarea', placeholder: '如: result.style === "realistic"' });
  }
  if (type === 'condition-switch') {
    fields.push({ key: 'cases', label: '分支数量', type: 'number', min: 2, max: 8, defaultValue: 3 });
    fields.push({ key: 'expression', label: '匹配表达式', type: 'textarea', placeholder: '如: result.category' });
  }
  if (type.startsWith('loop-')) {
    fields.push({ key: 'loopCount', label: '循环次数', type: 'number', min: 1, max: 100, defaultValue: 3 });
  }
  if (type === 'loop-while') {
    fields.push({ key: 'condition', label: '循环条件', type: 'textarea', placeholder: '如: result.score > 0.8' });
  }
  if (type === 'loop-each') {
    fields.push({ key: 'itemsSource', label: '数据源', type: 'select', options: [
      { label: '上游输出', value: 'upstream' }, { label: '手动列表', value: 'manual' }
    ], defaultValue: 'upstream' });
  }
  if (type === 'parallel') {
    fields.push({ key: 'channels', label: '并行通道数', type: 'number', min: 2, max: 8, defaultValue: 2 });
  }

  // ─── Agent节点 ───
  if (type === 'agent-auto') {
    fields.push({ key: 'model', label: '模型', type: 'model-select' });
    fields.push({ key: 'maxRounds', label: '最大轮次', type: 'number', min: 1, max: 20, defaultValue: 5 });
    fields.push({ key: 'systemPrompt', label: '系统指令', type: 'textarea', placeholder: '你是一个专业的图像编辑助手...' });
    fields.push({ key: 'tools', label: '可用工具', type: 'text', defaultValue: 'image_edit,generate_image,analyze_image,adjust_color' });
  }
  if (type === 'agent-chat') {
    fields.push({ key: 'model', label: '模型', type: 'model-select' });
    fields.push({ key: 'systemPrompt', label: '系统提示词', type: 'textarea', placeholder: '你是一个AI图像创作助手...' });
    fields.push({ key: 'temperature', label: '创造性', type: 'slider', min: 0, max: 100, step: 5, defaultValue: 70 });
  }

  // ─── 输出节点 ───
  if (type === 'output-export') {
    fields.push({ key: 'format', label: '导出格式', type: 'select', options: [
      { label: 'PNG', value: 'png' }, { label: 'SVG', value: 'svg' }, { label: 'PSD', value: 'psd' },
      { label: 'JPG', value: 'jpg' }, { label: 'WebP', value: 'webp' }
    ], defaultValue: 'png' });
    fields.push({ key: 'quality', label: '质量', type: 'select', options: [
      { label: '基础', value: 'basic' }, { label: '专业', value: 'pro' }, { label: '工作室', value: 'studio' }
    ], defaultValue: 'basic' });
  }
  if (type === 'output-save') {
    fields.push({ key: 'saveTo', label: '保存位置', type: 'select', options: [
      { label: '当前项目', value: 'project' }, { label: '本地下载', value: 'download' }
    ], defaultValue: 'project' });
  }

  return fields;
}

// ==================== 执行引擎 ====================

export interface ExecutionResult {
  nodeId: string;
  status: 'success' | 'failed' | 'skipped';
  output?: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

export interface WorkflowExecution {
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  results: Map<string, ExecutionResult>;
  currentNodeId: string | null;
  startedAt: number;
  completedAt: number | null;
  error?: string;
}

/**
 * DAG拓扑排序
 * 按依赖关系排序节点，保证上游节点先于下游节点执行
 */
export function topologicalSort(nodes: WorkflowNode[], connections: WorkflowConnection[]): WorkflowNode[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const inDegree = new Map(nodes.map(n => [n.id, 0]));
  const adjacency = new Map<string, string[]>();

  // 初始化邻接表
  nodes.forEach(n => adjacency.set(n.id, []));

  // 构建图
  for (const conn of connections) {
    if (!nodeMap.has(conn.fromNodeId) || !nodeMap.has(conn.toNodeId)) continue;
    adjacency.get(conn.fromNodeId)!.push(conn.toNodeId);
    inDegree.set(conn.toNodeId, (inDegree.get(conn.toNodeId) || 0) + 1);
  }

  // Kahn算法
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: WorkflowNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);

    for (const nextId of adjacency.get(id) || []) {
      const newDeg = (inDegree.get(nextId) || 0) - 1;
      inDegree.set(nextId, newDeg);
      if (newDeg === 0) queue.push(nextId);
    }
  }

  // 如果有环，将剩余节点追加（降级处理）
  if (sorted.length < nodes.length) {
    for (const node of nodes) {
      if (!sorted.find(n => n.id === node.id)) sorted.push(node);
    }
  }

  return sorted;
}

/**
 * 获取节点的上游输入数据
 * 根据连线从已完成节点中提取输入
 */
export function getNodeInputs(
  node: WorkflowNode,
  connections: WorkflowConnection[],
  results: Map<string, ExecutionResult>
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};

  // 从config中获取用户设置的值
  for (const [key, val] of Object.entries(node.config)) {
    if (val !== undefined && val !== '') inputs[key] = val;
  }

  // 从上游连线中获取输入
  const incomingConns = connections.filter(c => c.toNodeId === node.id);
  for (const conn of incomingConns) {
    const upstreamResult = results.get(conn.fromNodeId);
    if (upstreamResult?.output) {
      // 将上游输出映射到当前节点输入
      const fromPort = conn.fromPortId;
      const toPort = conn.toPortId;

      // 尝试从上游输出中获取对应端口数据
      if (upstreamResult.output.imageUrl) {
        inputs.imageUrl = upstreamResult.output.imageUrl;
      }
      if (upstreamResult.output.text || upstreamResult.output.prompt) {
        inputs.prompt = inputs.prompt || upstreamResult.output.text || upstreamResult.output.prompt;
      }
      if (upstreamResult.output.maskUrl) {
        inputs.maskUrl = upstreamResult.output.maskUrl;
      }
      if (upstreamResult.output.analysisResult) {
        inputs.analysisResult = upstreamResult.output.analysisResult;
      }
      // 记录端口映射
      if (!inputs._portMap) inputs._portMap = {};
      (inputs._portMap as Record<string, string>)[toPort] = fromPort;
    }
  }

  // 顶层属性覆盖
  if (node.condition) inputs.condition = node.condition;
  if (node.loopCount) inputs.loopCount = node.loopCount;

  return inputs;
}

/**
 * 构建节点执行请求体
 * 根据节点类型映射到对应的API端点和参数
 */
export function buildNodeExecutionRequest(
  node: WorkflowNode,
  inputs: Record<string, unknown>
): { endpoint: string; method: string; body: Record<string, unknown> } | null {
  const config = { ...node.config, ...inputs };

  switch (node.type) {
    case 'input-image':
      return {
        endpoint: '/api/save-image',
        method: 'POST',
        body: { imageUrl: config.imageUrl || config.source === 'canvas' ? config.canvasImageUrl : '', action: 'passthrough' }
      };

    case 'input-text':
      return {
        endpoint: '/api/optimize-prompt',
        method: 'POST',
        body: { prompt: config.text || '', mode: 'enhance' }
      };

    case 'ai-generate':
      return {
        endpoint: '/api/generate',
        method: 'POST',
        body: {
          prompt: config.prompt || '',
          negativePrompt: config.negativePrompt || '',
          model: config.model || '',
          quality: config.quality || 'standard',
          size: config.size || '1024x1024',
          n: config.n || 1,
          seed: config.seed || -1,
        }
      };

    case 'ai-edit':
      return {
        endpoint: '/api/image-edit',
        method: 'POST',
        body: {
          action: config.action || 'edit',
          imageUrl: config.imageUrl || '',
          prompt: config.prompt || '',
          negativePrompt: config.negativePrompt || '',
          model: config.model || '',
          strength: config.strength || 75,
        }
      };

    case 'ai-upscale':
      return {
        endpoint: '/api/image/upscale',
        method: 'POST',
        body: {
          imageUrl: config.imageUrl || '',
          scale: config.scale || '2',
          outputFormat: config.format || 'png',
        }
      };

    case 'ai-removebg':
      return {
        endpoint: '/api/image-edit',
        method: 'POST',
        body: {
          action: 'removebg',
          imageUrl: config.imageUrl || '',
          model: config.model || 'birefnet-general-lite',
        }
      };

    case 'ai-vectorize':
      return {
        endpoint: '/api/svg-trace',
        method: 'POST',
        body: {
          imageUrl: config.imageUrl || '',
          mode: config.mode || 'color',
          quality: config.quality || 'balanced',
        }
      };

    case 'ai-style-transfer':
      return {
        endpoint: '/api/generate',
        method: 'POST',
        body: {
          prompt: config.stylePrompt ? `in the style of ${config.stylePrompt}` : (config.prompt || ''),
          negativePrompt: config.negativePrompt || '',
          imageUrl: config.imageUrl || '',
          model: config.model || '',
          strength: config.strength || 50,
        }
      };

    case 'ai-color-adjust':
      return {
        endpoint: '/api/image-edit',
        method: 'POST',
        body: {
          action: 'edit',
          imageUrl: config.imageUrl || '',
          prompt: `adjust brightness by ${config.brightness || 0}%, contrast by ${config.contrast || 0}%, saturation by ${config.saturation || 0}%`,
          model: config.model || '',
        }
      };

    case 'ai-analyze':
      return {
        endpoint: '/api/vision-prompt',
        method: 'POST',
        body: {
          imageUrl: config.imageUrl || '',
          mode: config.analysisType || 'describe',
        }
      };

    case 'ai-retouch':
      return {
        endpoint: '/api/edit',
        method: 'POST',
        body: {
          image: config.imageUrl || '',
          prompt: config.prompt || '',
          model: config.editModel || config.model || '',
          size: config.size || '1024',
        }
      };

    case 'agent-auto':
      return {
        endpoint: '/api/agent-edit',
        method: 'POST',
        body: {
          imageUrl: config.imageUrl || '',
          instruction: config.prompt || config.systemPrompt || '',
          model: config.model || '',
          maxRounds: config.maxRounds || 5,
          tools: (config.tools as string || '').split(',').map((t: string) => t.trim()),
        }
      };

    case 'output-save':
      return {
        endpoint: '/api/save-image',
        method: 'POST',
        body: {
          imageUrl: config.imageUrl || '',
          saveTo: config.saveTo || 'project',
        }
      };

    case 'output-export':
      return {
        endpoint: '/api/save-image',
        method: 'POST',
        body: {
          imageUrl: config.imageUrl || '',
          format: config.format || 'png',
          quality: config.quality || 'basic',
        }
      };

    // 逻辑节点不需要API调用，由引擎内部处理
    case 'condition-if':
    case 'condition-switch':
    case 'loop-for':
    case 'loop-while':
    case 'loop-each':
    case 'parallel':
    case 'input-param':
    case 'output-image':
    case 'subgraph':
    case 'group':
      return null;

    default:
      return null;
  }
}

// ==================== 演示工作流 ====================

function makePort(nodeId: string, dir: 'in' | 'out', idx: number, label: string, portType: PortType = 'any'): NodePort {
  return { id: `${nodeId}-${dir}-${idx}`, label, type: portType, direction: dir };
}

/** 创建包含4条预置链的演示工作流 */
export function createDemoWorkflow(): Workflow {
  const wf = createEmptyWorkflow('演示工作流');
  wf.version = 'v1.0';
  wf.description = '包含4条预置节点链的演示工作流';

  let nodeId = 0;
  const nid = () => `demo-n${++nodeId}`;

  // ─── 链1: AI生成链 ───
  const n1 = nid(), n2 = nid(), n3 = nid();
  wf.nodes.push(
    { id: n1, type: 'input-text', x: 80, y: 80, width: 180, height: 80, label: '提示词输入', config: { text: '一只橘色猫咪在阳光下打盹' }, ports: [makePort(n1, 'out', 1, '文本', 'prompt')] },
    { id: n2, type: 'ai-generate', x: 340, y: 60, width: 200, height: 100, label: '图像生成', config: { model: '', quality: 'hd' }, ports: [makePort(n2, 'in', 1, '提示词', 'prompt'), makePort(n2, 'out', 1, '图片', 'image')] },
    { id: n3, type: 'output-image', x: 620, y: 80, width: 180, height: 80, label: '结果图片', config: {}, ports: [makePort(n3, 'in', 1, '图片', 'image')] },
  );
  wf.connections.push(
    { id: 'dc-1', fromNodeId: n1, fromPortId: `${n1}-output-1`, toNodeId: n2, toPortId: `${n2}-input-1`, type: 'data' },
    { id: 'dc-2', fromNodeId: n2, fromPortId: `${n2}-output-1`, toNodeId: n3, toPortId: `${n3}-input-1`, type: 'data' },
  );

  // ─── 链2: 条件分支链 ───
  const n4 = nid(), n5 = nid(), n6 = nid(), n7 = nid(), n8 = nid();
  wf.nodes.push(
    { id: n4, type: 'input-image', x: 80, y: 260, width: 180, height: 80, label: '图片输入', config: { source: 'canvas' }, ports: [makePort(n4, 'out', 1, '图片', 'image')] },
    { id: n5, type: 'ai-analyze', x: 340, y: 240, width: 200, height: 100, label: '风格分析', config: { analysisType: 'style' }, ports: [makePort(n5, 'in', 1, '图片', 'image'), makePort(n5, 'out', 1, '分析结果', 'prompt')] },
    { id: n6, type: 'condition-if', x: 620, y: 230, width: 160, height: 120, label: '风格=写实？', config: { condition: 'style === "realistic"' }, condition: 'style === "realistic"', ports: [makePort(n6, 'in', 1, '输入', 'any'), makePort(n6, 'out', 1, 'True', 'any'), makePort(n6, 'out', 2, 'False', 'any')] },
    { id: n7, type: 'output-image', x: 880, y: 190, width: 180, height: 80, label: '写实增强', config: {}, ports: [makePort(n7, 'in', 1, '图片', 'image')] },
    { id: n8, type: 'output-image', x: 880, y: 320, width: 180, height: 80, label: '风格化处理', config: {}, ports: [makePort(n8, 'in', 1, '图片', 'image')] },
  );
  wf.connections.push(
    { id: 'dc-3', fromNodeId: n4, fromPortId: `${n4}-output-1`, toNodeId: n5, toPortId: `${n5}-input-1`, type: 'data' },
    { id: 'dc-4', fromNodeId: n5, fromPortId: `${n5}-output-1`, toNodeId: n6, toPortId: `${n6}-input-1`, type: 'data' },
    { id: 'dc-5', fromNodeId: n6, fromPortId: `${n6}-output-1`, toNodeId: n7, toPortId: `${n7}-input-1`, type: 'condition' },
    { id: 'dc-6', fromNodeId: n6, fromPortId: `${n6}-output-2`, toNodeId: n8, toPortId: `${n8}-input-1`, type: 'data' },
  );

  // ─── 链3: 循环处理链 ───
  const n9 = nid(), n10 = nid(), n11 = nid(), n12 = nid(), n13 = nid();
  wf.nodes.push(
    { id: n9, type: 'input-image', x: 80, y: 500, width: 180, height: 80, label: '批量图片', config: { source: 'canvas' }, ports: [makePort(n9, 'out', 1, '图片', 'image')] },
    { id: n10, type: 'ai-analyze', x: 340, y: 480, width: 200, height: 100, label: '元素识别', config: { analysisType: 'elements' }, ports: [makePort(n10, 'in', 1, '图片', 'image'), makePort(n10, 'out', 1, '元素', 'prompt')] },
    { id: n11, type: 'loop-each', x: 620, y: 470, width: 160, height: 120, label: '循环 ×3', config: { loopCount: 3 }, loopCount: 3, ports: [makePort(n11, 'in', 1, '输入', 'any'), makePort(n11, 'out', 1, '当前项', 'any'), makePort(n11, 'out', 2, '完成', 'any')] },
    { id: n12, type: 'ai-retouch', x: 880, y: 460, width: 200, height: 100, label: '单图修图', config: {}, ports: [makePort(n12, 'in', 1, '图片', 'image'), makePort(n12, 'out', 1, '图片', 'image')] },
    { id: n13, type: 'output-image', x: 1140, y: 500, width: 180, height: 80, label: '结果集合', config: {}, ports: [makePort(n13, 'in', 1, '图片', 'image')] },
  );
  wf.connections.push(
    { id: 'dc-7', fromNodeId: n9, fromPortId: `${n9}-output-1`, toNodeId: n10, toPortId: `${n10}-input-1`, type: 'data' },
    { id: 'dc-8', fromNodeId: n10, fromPortId: `${n10}-output-1`, toNodeId: n11, toPortId: `${n11}-input-1`, type: 'data' },
    { id: 'dc-9', fromNodeId: n11, fromPortId: `${n11}-output-1`, toNodeId: n12, toPortId: `${n12}-input-1`, type: 'data' },
    { id: 'dc-10', fromNodeId: n12, fromPortId: `${n12}-output-1`, toNodeId: n13, toPortId: `${n13}-input-1`, type: 'data' },
  );

  // ─── 链4: Agent自主链 ───
  const n14 = nid(), n15 = nid();
  wf.nodes.push(
    { id: n14, type: 'agent-auto', x: 80, y: 700, width: 220, height: 120, label: 'AI Agent', config: { maxRounds: 5, tools: 'image_edit,generate_image,analyze_image' }, ports: [makePort(n14, 'out', 1, '结果', 'any')] },
    { id: n15, type: 'output-image', x: 400, y: 720, width: 180, height: 80, label: '输出', config: {}, ports: [makePort(n15, 'in', 1, '图片', 'image')] },
  );
  wf.connections.push(
    { id: 'dc-11', fromNodeId: n14, fromPortId: `${n14}-output-1`, toNodeId: n15, toPortId: `${n15}-input-1`, type: 'data' },
  );

  return wf;
}
