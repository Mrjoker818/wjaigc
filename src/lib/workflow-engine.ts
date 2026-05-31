/**
 * 工作流引擎 — 节点模式数据模型 + 执行引擎
 * 支持节点图(DAG)、连线、条件分支、循环节点、Agent节点、子图
 * 执行引擎：DAG拓扑排序 → 逐节点调度 → API调用 → 结果传递
 * 
 * P0升级:
 * - 连线语义类型约束 (image→image, prompt→prompt)
 * - 节点间真实数据传递 (上游output→下游input)
 * - 画布模式专用节点 (字境大师/精修引擎/品牌电商/元素分层/多角度/3D)
 * - AI自然语言建图支持
 * - 节点自动布局
 */

import { MODEL_QUALITIES, QUALITY_TO_SIZE, MODEL_ASPECT_RATIOS, calculateActualPixels } from './canvas-generation-group';

/** 通用宽高比选项（用于节点字段定义） */
const SHARED_ASPECT_RATIOS = [
  { label: '1:1 (正方形)', value: '1:1' },
  { label: '4:3 (横向)', value: '4:3' },
  { label: '3:4 (纵向)', value: '3:4' },
  { label: '16:9 (宽屏)', value: '16:9' },
  { label: '9:16 (竖屏)', value: '9:16' },
  { label: '3:2 (横向)', value: '3:2' },
  { label: '2:3 (纵向)', value: '2:3' },
  { label: '4:5 (纵向)', value: '4:5' },
  { label: '5:4 (横向)', value: '5:4' },
  { label: '21:9 (超宽)', value: '21:9' },
];

// ==================== 节点类型 ====================

export type NodeType =
  | 'input-image' | 'input-text' | 'input-param'
  | 'ai-generate' | 'ai-edit' | 'ai-retouch' | 'ai-upscale' | 'ai-removebg' | 'ai-vectorize' | 'ai-style-transfer' | 'ai-color-adjust' | 'ai-analyze'
  | 'ai-font-design' | 'ai-refine-engine' | 'ai-brand-ecommerce' | 'ai-segment' | 'ai-multi-angle' | 'ai-3d-model'
  | 'condition-if' | 'condition-switch' | 'loop-for' | 'loop-while' | 'loop-each' | 'parallel'
  | 'agent-auto' | 'agent-chat'
  | 'subgraph' | 'group' | 'storyboard-sequence'
  | 'output-image' | 'output-save' | 'output-export' | 'output-image-group';

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
  'ai-font-design': '字境大师',
  'ai-refine-engine': '精修引擎',
  'ai-brand-ecommerce': '品牌电商',
  'ai-segment': '元素分层',
  'ai-multi-angle': '多角度生成',
  'ai-3d-model': '3D模型',
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
  'storyboard-sequence': '分镜串行',
  'output-image': '图片输出',
  'output-save': '保存',
  'output-export': '导出',
  'output-image-group': '图片组',
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
  'ai-font-design': 'Type',
  'ai-refine-engine': 'Sparkles',
  'ai-brand-ecommerce': 'ShoppingBag',
  'ai-segment': 'Layers',
  'ai-multi-angle': 'Rotate3d',
  'ai-3d-model': 'Box',
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
  'storyboard-sequence': 'Film',
  'output-image': 'ImageDown',
  'output-save': 'Save',
  'output-export': 'Download',
  'output-image-group': 'Layers',
};

// ==================== 端口类型 ====================

export type PortType = 'image' | 'mask' | 'prompt' | 'condition' | 'any' | 'data';

export const PORT_COLORS: Record<PortType, string> = {
  image: '#3b82f6',
  mask: '#f472b6',
  prompt: '#a78bfa',
  condition: '#f59e0b',
  any: '#7d8590',
  data: '#22d3ee',
};

/** 端口类型兼容矩阵：哪些输出类型可以连到哪些输入类型 */
export const PORT_COMPATIBILITY: Record<PortType, PortType[]> = {
  image: ['image', 'any'],
  mask: ['mask', 'any'],
  prompt: ['prompt', 'any'],
  condition: ['condition', 'any'],
  any: ['any'],
  data: ['data', 'any', 'prompt', 'image'],
};

/** 检查两个端口是否可以连线 */
export function canConnectPorts(fromPortType: PortType, toPortType: PortType): boolean {
  return PORT_COMPATIBILITY[fromPortType]?.includes(toPortType) ?? false;
}

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
  /** 执行结果 (运行时填充) */
  execResult?: { status: string; output?: Record<string, unknown>; error?: string };
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
  { type: 'ai-retouch', category: 'ai', label: 'AI修图', desc: '自然语言修图' },
  { type: 'ai-analyze', category: 'ai', label: 'AI分析', desc: '图像内容分析' },
  { type: 'ai-font-design', category: 'ai', label: '字境大师', desc: 'AI字体设计与生成' },
  { type: 'ai-refine-engine', category: 'ai', label: '精修引擎', desc: '产品商业级精修' },
  { type: 'ai-brand-ecommerce', category: 'ai', label: '品牌电商', desc: '电商视觉内容生成' },
  { type: 'ai-segment', category: 'ai', label: '元素分层', desc: '智能分层+PSD导出' },
  { type: 'ai-multi-angle', category: 'ai', label: '多角度生成', desc: '多视角旋转生成' },
  { type: 'ai-3d-model', category: 'ai', label: '3D模型', desc: '图片转3D模型预览' },
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
  { type: 'storyboard-sequence', category: 'logic', label: '分镜串行', desc: '多场景按序串行生成，每步可指定角色/场景/动作' },
  { type: 'output-image', category: 'output', label: '图片输出', desc: '输出图片结果' },
  { type: 'output-save', category: 'output', label: '保存', desc: '保存到项目/本地' },
  { type: 'output-export', category: 'output', label: '导出', desc: 'PSD/SVG/PNG导出' },
  { type: 'output-image-group', category: 'output', label: '图片组', desc: '批量图片叠卡预览' },
];

/** 创建默认端口 */
function createDefaultPorts(type: NodeType): NodePort[] {
  const cat = getNodeCategory(type);
  const ports: NodePort[] = [];

  if (cat !== 'input') {
    if (type.startsWith('ai-')) {
      // AI节点都有图片输入和提示词输入
      ports.push({ id: 'in-image', label: '图片', type: 'image', direction: 'in' });
      ports.push({ id: 'in-prompt', label: '提示词', type: 'prompt', direction: 'in' });
    } else if (cat === 'logic') {
      ports.push({ id: 'in-data', label: '输入', type: 'any', direction: 'in' });
    } else if (cat === 'agent') {
      ports.push({ id: 'in-image', label: '图片', type: 'image', direction: 'in' });
      ports.push({ id: 'in-prompt', label: '指令', type: 'prompt', direction: 'in' });
    } else if (cat === 'output') {
      ports.push({ id: 'in-image', label: '图片', type: 'image', direction: 'in' });
      if (type === 'output-image-group') {
        ports.push({ id: 'in-image-2', label: '图片2', type: 'image', direction: 'in' });
        ports.push({ id: 'in-image-3', label: '图片3', type: 'image', direction: 'in' });
        ports.push({ id: 'in-image-4', label: '图片4', type: 'image', direction: 'in' });
      }
    }
  }

  if (cat !== 'output') {
    if (cat === 'input') {
      if (type === 'input-image') {
        ports.push({ id: 'out-image', label: '图片', type: 'image', direction: 'out' });
      } else {
        ports.push({ id: 'out-data', label: '数据', type: 'data', direction: 'out' });
        if (type === 'input-text') {
          ports.push({ id: 'out-prompt', label: '提示词', type: 'prompt', direction: 'out' });
        }
      }
    } else if (type.startsWith('ai-')) {
      ports.push({ id: 'out-image', label: '图片', type: 'image', direction: 'out' });
      if (type === 'ai-analyze' || type === 'ai-font-design') {
        ports.push({ id: 'out-text', label: '文本', type: 'prompt', direction: 'out' });
      }
      if (type === 'ai-segment') {
        ports.push({ id: 'out-layers', label: '图层', type: 'data', direction: 'out' });
      }
      if (type === 'ai-removebg') {
        ports.push({ id: 'out-mask', label: '蒙版', type: 'mask', direction: 'out' });
      }
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
  // 根据节点类型确定尺寸：文字/图片节点需要更大的空间来展示内容
  const isTextNode = type === 'input-text';
  const isImageNode = type === 'input-image' || type === 'output-image' || type === 'output-image-group';
  const isEditorNode = type.startsWith('ai-') && type !== 'ai-generate';
  let width: number;
  let height: number;
  if (isCondition) {
    width = 120; height = 110;
  } else if (isTextNode) {
    width = 280; height = 200;
  } else if (isImageNode) {
    width = 260; height = 200;
  } else if (isEditorNode) {
    width = 260; height = 160;
  } else {
    width = 240; height = 100;
  }

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
  type: 'text' | 'textarea' | 'number' | 'select' | 'slider' | 'toggle' | 'model-select' | 'image-upload' | 'color';
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: unknown;
  modelFilter?: 'image' | 'chat' | '3d' | 'vector' | 'segment'; // model-select 字段过滤模型类型
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
    fields.push({ key: 'imageUrl', label: '图片', type: 'image-upload', placeholder: '输入图片URL或上传图片' });
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

  // ─── AI节点 (通用) ───
  if (cat === 'ai') {
    // 不为有专用model字段的节点添加通用model
    if (type !== 'ai-removebg' && type !== 'ai-font-design' && type !== 'ai-refine-engine' && type !== 'ai-brand-ecommerce') {
      fields.push({ key: 'model', label: '模型', type: 'model-select', modelFilter: 'image' });
    }
    fields.push({ key: 'prompt', label: '提示词', type: 'textarea', placeholder: '描述你想要的图像效果' });
    fields.push({ key: 'negativePrompt', label: '反向提示词', type: 'textarea', placeholder: '低质量, 模糊, 变形...' });
  }

  // ─── AI节点 (各类型特定字段) ───
  if (type === 'ai-generate') {
    // 画面比例（通用，所有模型共享）
    const aspectRatioOptions = [
      { label: '1:1', value: '1:1' }, { label: '4:3', value: '4:3' }, { label: '3:4', value: '3:4' },
      { label: '16:9', value: '16:9' }, { label: '9:16', value: '9:16' }, { label: '3:2', value: '3:2' },
      { label: '2:3', value: '2:3' }, { label: '21:9', value: '21:9' }, { label: '4:5', value: '4:5' },
      { label: '5:4', value: '5:4' },
    ];
    fields.push({ key: 'aspectRatio', label: '画面比例', type: 'select', options: aspectRatioOptions, defaultValue: '1:1' });
    // 图片质量（默认通用选项，节点编辑器会根据所选模型动态更新）
    fields.push({ key: 'quality', label: '图片质量', type: 'select', options: [
      { label: '1K', value: '1K' }, { label: '2K', value: '2K' }, { label: '4K', value: '4K' },
      { label: '标准 standard', value: 'standard' }, { label: '高清 hd', value: 'hd' },
    ], defaultValue: '1K' });
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
    fields.push({ key: 'editModel', label: '修图模型', type: 'model-select', modelFilter: 'image' });
    fields.push({ key: 'aspectRatio', label: '画面比例', type: 'select', options: SHARED_ASPECT_RATIOS, defaultValue: '1:1' });
    // 质量选项由节点编辑器根据模型动态更新
    fields.push({ key: 'quality', label: '图片质量', type: 'select', options: [{ label: '标准', value: 'standard' }], defaultValue: 'standard' });
  }

  // ─── 画布模式专用节点 ───
  if (type === 'ai-font-design') {
    fields.push({ key: 'model', label: '生图模型', type: 'model-select', modelFilter: 'image' });
    fields.push({ key: 'textContent', label: '文字内容', type: 'text', placeholder: '如: 无界AI' });
    fields.push({ key: 'styleCategory', label: '字体风格', type: 'select', options: [
      { label: '书法行楷', value: 'calligraphy' }, { label: '科技未来', value: 'tech' },
      { label: '文艺清新', value: 'artsy' }, { label: '国潮新中式', value: 'guochao' },
      { label: '立体3D', value: '3d' }, { label: '手写涂鸦', value: 'handwrite' },
      { label: '像素复古', value: 'pixel' }, { label: '霓虹灯效', value: 'neon' },
      { label: '金属质感', value: 'metal' }
    ], defaultValue: 'calligraphy' });
    fields.push({ key: 'scene', label: '使用场景', type: 'select', options: [
      { label: '品牌Logo', value: 'logo' }, { label: '海报标题', value: 'poster' },
      { label: '包装设计', value: 'package' }, { label: '社交媒体', value: 'social' }
    ], defaultValue: 'logo' });
    fields.push({ key: 'mode', label: '提示词模式', type: 'select', options: [
      { label: '完整版', value: 'full' }, { label: '黑底白字', value: 'dark' }, { label: '透明Logo', value: 'transparent' }
    ], defaultValue: 'full' });
  }

  if (type === 'ai-refine-engine') {
    fields.push({ key: 'model', label: '生图模型', type: 'model-select', modelFilter: 'image' });
    fields.push({ key: 'mode', label: '精修模式', type: 'select', options: [
      { label: '标准模式', value: 'standard' }, { label: '专家模式', value: 'expert' }
    ], defaultValue: 'standard' });
    fields.push({ key: 'category', label: '产品类型', type: 'select', options: [
      { label: '电子产品', value: 'electronics' }, { label: '美妆护肤', value: 'beauty' },
      { label: '食品饮料', value: 'food' }, { label: '服装配饰', value: 'fashion' },
      { label: '家居用品', value: 'home' }, { label: '珠宝首饰', value: 'jewelry' }
    ], defaultValue: 'electronics' });
    fields.push({ key: 'lighting', label: '灯光预设', type: 'select', options: [
      { label: '影棚灯光', value: 'studio' }, { label: '自然光线', value: 'natural' },
      { label: '窗口侧光', value: 'window' }, { label: '柔光箱', value: 'softbox' },
      { label: '戏剧性打光', value: 'dramatic' }
    ], defaultValue: 'studio' });
    fields.push({ key: 'viewAngle', label: '视角', type: 'select', options: [
      { label: '正面', value: 'front' }, { label: '45度角', value: 'angle45' },
      { label: '俯视', value: 'top' }, { label: '侧面', value: 'side' }
    ], defaultValue: 'front' });
    fields.push({ key: 'background', label: '背景', type: 'select', options: [
      { label: '纯白', value: 'white' }, { label: '渐变', value: 'gradient' },
      { label: '场景', value: 'scene' }, { label: '透明', value: 'transparent' }
    ], defaultValue: 'white' });
    fields.push({ key: 'aspectRatio', label: '画面比例', type: 'select', options: SHARED_ASPECT_RATIOS, defaultValue: '1:1' });
    fields.push({ key: 'quality', label: '图片质量', type: 'select', options: [{ label: '自动', value: 'auto' }], defaultValue: 'auto' });
  }

  if (type === 'ai-brand-ecommerce') {
    fields.push({ key: 'model', label: '生图模型', type: 'model-select', modelFilter: 'image' });
    fields.push({ key: 'templateType', label: '模板类型', type: 'select', options: [
      { label: '商品场景图', value: 'product-scene' }, { label: '模特展示', value: 'model-show' },
      { label: '营销Banner', value: 'banner' }, { label: '详情页', value: 'detail' },
      { label: '社交媒体', value: 'social' }, { label: '节日营销', value: 'holiday' }
    ], defaultValue: 'product-scene' });
    fields.push({ key: 'brandName', label: '品牌名', type: 'text', placeholder: '输入品牌名称' });
    fields.push({ key: 'brandStyle', label: '品牌风格', type: 'select', options: [
      { label: '简约现代', value: 'minimal' }, { label: '轻奢优雅', value: 'luxury' },
      { label: '活力时尚', value: 'vibrant' }, { label: '温馨亲和', value: 'warm' }
    ], defaultValue: 'minimal' });
    fields.push({ key: 'productCategory', label: '商品类别', type: 'select', options: [
      { label: '服装', value: 'clothing' }, { label: '美妆', value: 'beauty' },
      { label: '食品', value: 'food' }, { label: '数码', value: 'digital' },
      { label: '家居', value: 'home' }, { label: '配饰', value: 'accessories' }
    ], defaultValue: 'clothing' });
    fields.push({ key: 'aspectRatio', label: '画面比例', type: 'select', options: SHARED_ASPECT_RATIOS, defaultValue: '1:1' });
    fields.push({ key: 'quality', label: '图片质量', type: 'select', options: [{ label: '自动', value: 'auto' }], defaultValue: 'auto' });
  }

  if (type === 'ai-segment') {
    fields.push({ key: 'model', label: '分层模型', type: 'model-select', modelFilter: 'segment' });
    fields.push({ key: 'exportFormat', label: '导出格式', type: 'select', options: [
      { label: 'PSD (Pro)', value: 'psd-pro' }, { label: 'PSD (Studio)', value: 'psd-studio' },
      { label: 'SVG', value: 'svg' }, { label: '仅分层', value: 'layers-only' }
    ], defaultValue: 'psd-pro' });
  }

  if (type === 'ai-multi-angle') {
    fields.push({ key: 'model', label: '生图模型', type: 'model-select', modelFilter: 'image' });
    fields.push({ key: 'angles', label: '视角选择', type: 'select', options: [
      { label: '四宫格 (正/侧/后/俯)', value: 'quad' },
      { label: '前后对比', value: 'front-back' },
      { label: '360度旋转', value: '360' }
    ], defaultValue: 'quad' });
    fields.push({ key: 'characterRef', label: '角色一致性', type: 'toggle', defaultValue: true });
    fields.push({ key: 'aspectRatio', label: '画面比例', type: 'select', options: SHARED_ASPECT_RATIOS, defaultValue: '1:1' });
    fields.push({ key: 'quality', label: '图片质量', type: 'select', options: [{ label: '自动', value: 'auto' }], defaultValue: 'auto' });
  }

  if (type === 'ai-3d-model') {
    fields.push({ key: 'model', label: '3D模型', type: 'model-select', modelFilter: '3d' });
    fields.push({ key: 'quality', label: '模型质量', type: 'select', options: [
      { label: '标准', value: 'standard' }, { label: '高清', value: 'hd' }
    ], defaultValue: 'standard' });
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
    fields.push({ key: 'model', label: '模型', type: 'model-select', modelFilter: 'chat' });
    fields.push({ key: 'maxRounds', label: '最大轮次', type: 'number', min: 1, max: 20, defaultValue: 5 });
    fields.push({ key: 'systemPrompt', label: '系统指令', type: 'textarea', placeholder: '你是一个专业的图像编辑助手...' });
    fields.push({ key: 'tools', label: '可用工具', type: 'text', defaultValue: 'image_edit,generate_image,analyze_image,adjust_color' });
  }
  if (type === 'agent-chat') {
    fields.push({ key: 'model', label: '模型', type: 'model-select', modelFilter: 'chat' });
    fields.push({ key: 'systemPrompt', label: '系统提示词', type: 'textarea', placeholder: '你是一个AI图像创作助手...' });
    fields.push({ key: 'temperature', label: '创造性', type: 'slider', min: 0, max: 100, step: 5, defaultValue: 70 });
  }

  // ─── 分镜串行节点 ───
  if (type === 'storyboard-sequence') {
    fields.push({ key: 'model', label: '生图模型', type: 'model-select', modelFilter: 'image' });
    fields.push({ key: 'scenes', label: '场景列表', type: 'textarea', placeholder: '每行一个场景描述，如:\n场景1: 角色A站在山顶\n场景2: 角色A走向远方\n场景3: 角色A回眸微笑' });
    fields.push({ key: 'character', label: '角色描述', type: 'textarea', placeholder: '角色外观/服饰/特征描述，保持角色一致性' });
    fields.push({ key: 'style', label: '整体风格', type: 'text', placeholder: '如: 日系动漫/写实摄影/水墨画' });
    fields.push({ key: 'aspectRatio', label: '画面比例', type: 'select', options: [
      { label: '16:9 横屏', value: '16:9' }, { label: '9:16 竖屏', value: '9:16' },
      { label: '1:1 方形', value: '1:1' }, { label: '4:3 标准', value: '4:3' }
    ], defaultValue: '16:9' });
    fields.push({ key: 'negativePrompt', label: '反向提示词', type: 'textarea', placeholder: '低质量, 模糊, 变形...' });
    fields.push({ key: 'continueMode', label: '续图策略', type: 'select', options: [
      { label: '独立生成', value: 'independent' }, { label: '图生图续接', value: 'img2img' }
    ], defaultValue: 'independent' });
    fields.push({ key: 'strength', label: '续接强度', type: 'slider', min: 0, max: 100, step: 5, defaultValue: 50 });
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
  if (type === 'output-image-group') {
    fields.push({ key: 'layout', label: '排列方式', type: 'select', options: [
      { label: '叠卡翻页', value: 'stack' }, { label: '网格', value: 'grid' }, { label: '横向滚动', value: 'horizontal' }
    ], defaultValue: 'stack' });
    fields.push({ key: 'columns', label: '列数(网格)', type: 'number', defaultValue: 3, min: 1, max: 6 });
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
 * 获取节点的上游输入数据 (P0: 真实数据传递)
 * 根据连线从已完成节点中提取输入，区分端口类型
 * P0升级: 解析[img:xxx]引用 — 在prompt字段中替换为上游图片URL
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

  // 构建图片URL映射 (用于[img:xxx]引用解析)
  const imageUrlMap = new Map<string, string>();
  for (const [, result] of results) {
    if (result.output?.imageUrl) {
      // nodeId → imageUrl
      imageUrlMap.set(result.nodeId, result.output.imageUrl as string);
    }
  }

  // 从上游连线中获取输入 (按端口类型映射)
  const incomingConns = connections.filter(c => c.toNodeId === node.id);
  // P1: 输入引用阻断 — 获取被阻断的连接ID列表
  const blockedInputs = new Set<string>(Array.isArray(node.config?.blockedInputs) ? node.config.blockedInputs as string[] : []);
  for (const conn of incomingConns) {
    // P1: 跳过被阻断的输入连接
    if (blockedInputs.has(conn.id)) continue;
    const upstreamResult = results.get(conn.fromNodeId);
    if (!upstreamResult?.output) continue;

    const upstreamOutput = upstreamResult.output;

    // P0: 记录上游节点的imageUrl到映射
    if (upstreamOutput.imageUrl) {
      imageUrlMap.set(conn.fromNodeId, upstreamOutput.imageUrl as string);
    }

    // 根据连线类型和目标端口ID智能映射
    switch (conn.type) {
      case 'image':
        // 图片连线: 优先传递imageUrl
        if (upstreamOutput.imageUrl) inputs.imageUrl = upstreamOutput.imageUrl;
        break;
      case 'prompt':
        // 提示词连线: 传递prompt/text/textContent
        const promptVal = upstreamOutput.prompt || upstreamOutput.text || upstreamOutput.textContent;
        if (promptVal) {
          inputs.prompt = inputs.prompt ? `${inputs.prompt}, ${promptVal}` : promptVal;
        }
        break;
      case 'mask':
        // 蒙版连线
        if (upstreamOutput.maskUrl) inputs.maskUrl = upstreamOutput.maskUrl;
        break;
      case 'data':
        // 数据连线: 传递所有输出
        if (upstreamOutput.imageUrl) inputs.imageUrl = upstreamOutput.imageUrl;
        if (upstreamOutput.prompt || upstreamOutput.text) {
          inputs.prompt = inputs.prompt || upstreamOutput.prompt || upstreamOutput.text;
        }
        if (upstreamOutput.analysisResult) inputs.analysisResult = upstreamOutput.analysisResult;
        if (upstreamOutput.layers) inputs.layers = upstreamOutput.layers;
        break;
      default: {
        // any类型: 智能推断
        if (upstreamOutput.imageUrl) inputs.imageUrl = upstreamOutput.imageUrl;
        // 提示词传递: 支持prompt/text/textContent三种键名
        const defaultPrompt = upstreamOutput.prompt || upstreamOutput.text || upstreamOutput.textContent;
        if (defaultPrompt) {
          inputs.prompt = inputs.prompt || defaultPrompt;
        }
        if (upstreamOutput.maskUrl) inputs.maskUrl = upstreamOutput.maskUrl;
        if (upstreamOutput.analysisResult) inputs.analysisResult = upstreamOutput.analysisResult;
        if (upstreamOutput.layers) inputs.layers = upstreamOutput.layers;
        break;
      }
    }
  }

  // P0: 解析[img:xxx]引用 — 替换为实际的图片URL
  for (const [key, val] of Object.entries(inputs)) {
    if (typeof val === 'string' && val.includes('[img:')) {
      inputs[key] = val.replace(/\[img:([^\]]+)\]/g, (match, refId) => {
        const url = imageUrlMap.get(refId);
        return url || match; // 找到URL则替换，否则保留原文
      });
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
      // 图片输入节点：直接输出图片URL，不需要调用API
      return null;

    case 'input-text':
      // 文本输入节点：直接输出文本，不需要调用API优化
      return null;

    case 'ai-generate': {
      const aspectRatio = config.aspectRatio || '1:1';
      const quality = config.quality || '1K';
      const modelId = config.model || '';
      // 使用模型专用像素映射计算实际尺寸
      const actualSize = calculateActualPixels(aspectRatio, quality, modelId);
      return {
        endpoint: '/api/generate',
        method: 'POST',
        body: {
          prompt: config.prompt || config.textContent || config.text || '',
          negativePrompt: config.negativePrompt || '',
          model: modelId,
          quality,
          aspectRatio,
          size: actualSize || '1024x1024',
          n: config.n || 1,
          seed: config.seed || -1,
        }
      };
    }

    case 'ai-edit':
      return {
        endpoint: '/api/image-edit',
        method: 'POST',
        body: {
          action: config.action || 'edit',
          imageUrl: config.imageUrl || '',
          prompt: config.prompt || config.textContent || config.text || '',
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

    case 'ai-retouch': {
      const retouchModel = config.editModel || config.model || '';
      const retouchQuality = config.quality || '1K';
      const retouchAspectRatio = config.aspectRatio || '1:1';
      const retouchSize = calculateActualPixels(retouchAspectRatio, retouchQuality, retouchModel);
      return {
        endpoint: '/api/edit',
        method: 'POST',
        body: {
          image: config.imageUrl || '',
          prompt: config.prompt || config.textContent || config.text || '',
          model: retouchModel,
          size: retouchSize || '1024x1024',
        }
      };
    }

    // ─── 画布模式专用节点 ───
    case 'ai-font-design':
      return {
        endpoint: '/api/font-design/generate-image',
        method: 'POST',
        body: {
          textContent: config.textContent || '',
          styleCategory: config.styleCategory || 'calligraphy',
          scene: config.scene || 'logo',
          mode: config.mode || 'full',
          model: config.model || '',
          prompt: config.prompt || config.textContent || config.text || '',
        }
      };

    case 'ai-refine-engine': {
      const refineModel = config.model || '';
      const refineQuality = config.quality || '1K';
      const refineAspectRatio = config.aspectRatio || '1:1';
      const refineSize = calculateActualPixels(refineAspectRatio, refineQuality, refineModel);
      return {
        endpoint: '/api/edit',
        method: 'POST',
        body: {
          image: config.imageUrl || '',
          prompt: config.prompt || `Professional product photography, ${config.lighting || 'studio'} lighting, ${config.viewAngle || 'front'} view, ${config.background || 'white'} background, ${config.category || 'electronics'} product, commercial quality, 8k`,
          model: refineModel,
          size: refineSize || '1024x1024',
        }
      };
    }

    case 'ai-brand-ecommerce': {
      const brandModel = config.model || '';
      const brandQuality = config.quality || '1K';
      const brandAspectRatio = config.aspectRatio || '1:1';
      const brandSize = calculateActualPixels(brandAspectRatio, brandQuality, brandModel);
      return {
        endpoint: '/api/generate',
        method: 'POST',
        body: {
          prompt: config.prompt || `E-commerce product photo for ${config.brandName || 'brand'}, ${config.templateType || 'product-scene'} style, ${config.brandStyle || 'minimal'} aesthetic, ${config.productCategory || 'clothing'} category, professional lighting, commercial quality`,
          negativePrompt: config.negativePrompt || 'low quality, blurry, watermark, text, signature',
          model: brandModel,
          quality: brandQuality,
          size: brandSize || '1024x1024',
        }
      };
    }

    case 'ai-segment':
      return {
        endpoint: '/api/segment-elements',
        method: 'POST',
        body: {
          imageUrl: config.imageUrl || '',
          model: config.model || '',
          exportFormat: config.exportFormat || 'psd-pro',
        }
      };

    case 'ai-multi-angle': {
      const maModel = config.model || '';
      const maQuality = config.quality || '1K';
      const maAspectRatio = config.aspectRatio || '1:1';
      const maSize = calculateActualPixels(maAspectRatio, maQuality, maModel);
      return {
        endpoint: '/api/generate',
        method: 'POST',
        body: {
          prompt: config.prompt || `Multi-angle view, ${config.angles || 'quad'} layout, same subject from different angles, consistent style`,
          negativePrompt: config.negativePrompt || '',
          model: maModel,
          imageUrl: config.imageUrl || '',
          quality: maQuality,
          size: maSize || '1024x1024',
        }
      };
    }

    case 'ai-3d-model':
      return {
        endpoint: '/api/poll-3d-task',
        method: 'POST',
        body: {
          imageUrl: config.imageUrl || '',
          model: config.model || '',
          quality: config.quality || 'standard',
        }
      };

    case 'storyboard-sequence': {
      const sbModel = config.model || '';
      const sbQuality = config.quality || '1K';
      const sbAspectRatio = config.aspectRatio || '1:1';
      const sbSize = calculateActualPixels(sbAspectRatio, sbQuality, sbModel);
      return {
        endpoint: '/api/generate',
        method: 'POST',
        body: {
          prompt: config.scenes || config.prompt || '',
          negativePrompt: config.negativePrompt || '',
          model: sbModel,
          quality: sbQuality,
          size: sbSize || '1024x1024',
          // 分镜串行元数据
          _storyboard: {
            scenes: (config.scenes as string || '').split('\n').filter((s: string) => s.trim()),
            character: config.character || '',
            style: config.style || '',
            continueMode: config.continueMode || 'independent',
            strength: config.strength || 50,
          },
          imageUrl: config.imageUrl || '',
          strength: config.continueMode === 'img2img' ? (config.strength || 50) : undefined,
        }
      };
    }

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
    case 'output-image-group':
      // 输出节点：直接传递结果，不需要API调用
      return null;

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

// ==================== 循环节点变量替换 ====================

/** 替换循环变量 {{index}}/{{total}}/{{progress}} 为实际值 */
export function replaceLoopVariables(text: string, index: number, total: number): string {
  return text
    .replace(/\{\{index\}\}/g, String(index))
    .replace(/\{\{total\}\}/g, String(total))
    .replace(/\{\{progress\}\}/g, `${index}/${total}`)
    .replace(/《计数》/g, String(index))
    .replace(/《总数》/g, String(total))
    .replace(/《进度》/g, `${index}/${total}`);
}

// ==================== 节点自动布局 ====================

/** 自动布局：按DAG层级排列节点 */
export function autoLayoutWorkflow(wf: Workflow): Workflow {
  const sorted = topologicalSort(wf.nodes, wf.connections);
  if (sorted.length === 0) return wf;

  // 计算每个节点的层级（最长路径）
  const levels = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const n of wf.nodes) adjacency.set(n.id, []);
  for (const c of wf.connections) {
    adjacency.get(c.fromNodeId)?.push(c.toNodeId);
  }

  // BFS分层
  const nodeMap = new Map(wf.nodes.map(n => [n.id, n]));
  for (const node of sorted) {
    let maxLevel = 0;
    // 找所有上游节点
    for (const c of wf.connections.filter(c => c.toNodeId === node.id)) {
      const upLevel = levels.get(c.fromNodeId) ?? 0;
      maxLevel = Math.max(maxLevel, upLevel + 1);
    }
    levels.set(node.id, maxLevel);
  }

  // 按层分组
  const layerGroups = new Map<number, WorkflowNode[]>();
  for (const node of sorted) {
    const level = levels.get(node.id) ?? 0;
    if (!layerGroups.has(level)) layerGroups.set(level, []);
    layerGroups.get(level)!.push(node);
  }

  // 计算位置
  const H_GAP = 280;
  const V_GAP = 120;
  const START_X = 80;
  const START_Y = 80;

  const newNodes = wf.nodes.map(n => {
    const level = levels.get(n.id) ?? 0;
    const group = layerGroups.get(level) || [];
    const indexInGroup = group.findIndex(g => g.id === n.id);
    return {
      ...n,
      x: START_X + level * H_GAP,
      y: START_Y + indexInGroup * V_GAP,
    };
  });

  return { ...wf, nodes: newNodes };
}

// ==================== AI自然语言建图 ====================

/** AI建图请求的Prompt模板 */
export const AI_BUILD_PROMPT = `你是一个AI图像工作流设计助手。用户会描述他们想要的图像处理需求，你需要根据需求生成一个节点工作流。

可用节点类型:
- input-image: 图片输入（来源: upload/url/canvas）
- input-text: 文本输入（文本内容、反向提示词）
- ai-generate: AI图像生成（模型、尺寸、质量、数量）
- ai-edit: 图像编辑（擦除/蒙版/扩展/语言修图）
- ai-upscale: 无损放大（2x/4x，输出格式）
- ai-removebg: 移除背景（BiRefNet/U2Net/Silueta）
- ai-vectorize: 矢量化（彩色/黑白，质量）
- ai-style-transfer: 风格转换（风格描述、强度）
- ai-color-adjust: 调色（亮度/对比度/饱和度）
- ai-retouch: AI修图（自然语言描述修图）
- ai-analyze: AI分析（内容描述/风格识别/元素识别/关键词提取）
- ai-font-design: 字境大师（文字内容、字体风格、场景、模式）
- ai-refine-engine: 精修引擎（精修模式、产品类型、灯光、视角、背景）
- ai-brand-ecommerce: 品牌电商（模板类型、品牌名、品牌风格、商品类别）
- ai-segment: 元素分层（导出PSD/SVG）
- ai-multi-angle: 多角度生成（视角选择、角色一致性）
- ai-3d-model: 3D模型生成
- agent-auto: Agent自动编排
- output-image: 图片输出
- output-save: 保存
- output-export: 导出（PNG/SVG/PSD）
- condition-if: 条件分支
- loop-for: 循环

请根据用户需求，输出JSON格式的工作流定义，严格遵循以下格式:
{
  "name": "工作流名称",
  "description": "简短描述",
  "nodes": [
    {
      "id": "node-1",
      "type": "节点类型",
      "label": "节点名称",
      "config": { "key": "value", ... }
    }
  ],
  "connections": [
    {
      "fromNodeId": "node-1",
      "fromPortId": "端口ID",
      "toNodeId": "node-2",
      "toPortId": "端口ID",
      "type": "image|prompt|mask|condition|data"
    }
  ]
}

规则:
1. 端口ID格式: 输入端口 in-image/in-prompt/in-data, 输出端口 out-image/out-prompt/out-text/out-data/out-mask/out-layers/out-true/out-false/out-loop/out-done
2. 连线类型必须与端口类型匹配: image→image, prompt→prompt, data→any
3. 条件节点有两个输出: out-true 和 out-false
4. 循环节点有: out-loop（循环体）和 out-done（完成）
5. 每个工作流必须至少有一个输入节点
6. 尽量减少节点数量，保持工作流简洁
7. 只输出JSON，不要其他文本`;

/** P0: AI建图二次修正追问提示词 */
export const AI_BUILD_REFINE_PROMPT = `你上次生成的工作流节点太少，不够完整。请重新设计一个更详细的工作流，要求:
1. 至少包含3个节点（输入→处理→输出）
2. 根据用户需求，增加必要的中间处理步骤
3. 填充每个节点的config配置（如模型、参数等）
4. 确保连线完整，数据能从输入流到输出
5. 只输出JSON，不要其他文本`;

/** 解析AI建图响应 */
export function parseAIBuildResponse(response: string): { name: string; description: string; nodes: { id: string; type: NodeType; label: string; config: Record<string, unknown> }[]; connections: { fromNodeId: string; fromPortId: string; toNodeId: string; toPortId: string; type: PortType }[] } | null {
  try {
    // 提取JSON块
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.nodes || !Array.isArray(parsed.nodes)) return null;

    // 验证节点类型
    const validTypes = new Set<string>(Object.keys(NODE_TYPE_LABELS));
    const validNodes = parsed.nodes.filter((n: { type: string }) => validTypes.has(n.type));
    if (validNodes.length === 0) return null;

    return {
      name: parsed.name || 'AI生成工作流',
      description: parsed.description || '',
      nodes: validNodes,
      connections: parsed.connections || [],
    };
  } catch {
    return null;
  }
}

/** 从AI建图结果创建完整工作流 */
export function createWorkflowFromAIResult(result: NonNullable<ReturnType<typeof parseAIBuildResponse>>): Workflow {
  const wf = createEmptyWorkflow(result.name);
  wf.description = result.description;

  // 创建节点 (自动布局)
  const H_GAP = 280;
  const V_GAP = 120;
  const START_X = 80;
  const START_Y = 80;

  // 先创建所有节点
  for (let i = 0; i < result.nodes.length; i++) {
    const n = result.nodes[i];
    const node = createWorkflowNode(n.type as NodeType, START_X, START_Y + i * V_GAP, n.label);
    node.id = n.id; // 保持AI指定的ID，以便连线匹配
    node.config = { ...node.config, ...n.config };
    wf.nodes.push(node);
  }

  // 自动布局
  const layouted = autoLayoutWorkflow(wf);
  wf.nodes = layouted.nodes;

  // 创建连线
  for (const c of result.connections) {
    const fromNode = wf.nodes.find(n => n.id === c.fromNodeId);
    const toNode = wf.nodes.find(n => n.id === c.toNodeId);
    if (fromNode && toNode) {
      // 查找匹配的端口
      const fromPort = fromNode.ports.find(p => p.id === c.fromPortId && p.direction === 'out')
        || fromNode.ports.find(p => p.direction === 'out');
      const toPort = toNode.ports.find(p => p.id === c.toPortId && p.direction === 'in')
        || toNode.ports.find(p => p.direction === 'in');

      if (fromPort && toPort) {
        wf.connections.push(createConnection(
          fromNode.id, fromPort.id,
          toNode.id, toPort.id,
          c.type as PortType
        ));
      }
    }
  }

  return wf;
}

// ==================== ComfyUI 工作流导入 ====================

/** ComfyUI节点 → 无界节点类型映射 */
const COMFYUI_NODE_MAP: Record<string, NodeType> = {
  'KSampler': 'ai-generate',
  'KSamplerAdvanced': 'ai-generate',
  'SamplerCustom': 'ai-generate',
  'SamplerCustomAdvanced': 'ai-generate',
  'CLIPTextEncode': 'input-text',
  'CLIPTextEncodePositive': 'input-text',
  'CLIPTextEncodeNegative': 'input-text',
  'CheckpointLoaderSimple': 'input-param',
  'CheckpointLoader': 'input-param',
  'UNETLoader': 'input-param',
  'CLIPLoader': 'input-param',
  'VAELoader': 'input-param',
  'VAEDecode': 'ai-generate',
  'VAEEncode': 'ai-edit',
  'SaveImage': 'output-save',
  'PreviewImage': 'output-image',
  'LoadImage': 'input-image',
  'ImageScale': 'ai-upscale',
  'ImageScaleBy': 'ai-upscale',
  'InpaintModelConditioning': 'ai-edit',
  'SetLatentNoiseMask': 'ai-edit',
  'CLIPVisionEncode': 'ai-style-transfer',
  'StyleModelLoader': 'ai-style-transfer',
};

/** 从ComfyUI类名推断无界节点类型 */
function comfyToWujieType(classType: string): NodeType {
  // 精确匹配
  if (COMFYUI_NODE_MAP[classType]) return COMFYUI_NODE_MAP[classType];
  // 模糊匹配
  const lower = classType.toLowerCase();
  if (lower.includes('sampler') || lower.includes('generate')) return 'ai-generate';
  if (lower.includes('text') || lower.includes('prompt') || lower.includes('clip_encode')) return 'input-text';
  if (lower.includes('load') && lower.includes('image')) return 'input-image';
  if (lower.includes('load') && (lower.includes('model') || lower.includes('checkpoint') || lower.includes('lora'))) return 'input-param';
  if (lower.includes('save') || lower.includes('preview')) return 'output-image';
  if (lower.includes('scale') || lower.includes('upscale')) return 'ai-upscale';
  if (lower.includes('inpaint') || lower.includes('mask')) return 'ai-edit';
  if (lower.includes('controlnet')) return 'ai-style-transfer';
  if (lower.includes('style')) return 'ai-style-transfer';
  return 'ai-generate'; // 默认
}

/** ComfyUI widgets_values 中提取关键字段 */
function extractComfyFields(classType: string, widgetsValues: unknown[]): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const lower = classType.toLowerCase();

  // KSampler类: [seed, control_after_generate, steps, cfg, sampler_name, scheduler, denoise]
  if (lower.includes('sampler')) {
    if (widgetsValues[0] !== undefined) config.seed = widgetsValues[0];
    if (widgetsValues[2] !== undefined) config.steps = widgetsValues[2];
    if (widgetsValues[3] !== undefined) config.cfg = widgetsValues[3];
    if (widgetsValues[6] !== undefined) config.strength = Math.round((widgetsValues[6] as number) * 100);
  }

  // CLIPTextEncode: [text]
  if (lower.includes('text') || lower.includes('prompt') || lower.includes('clip_encode')) {
    if (widgetsValues[0] !== undefined) {
      const text = String(widgetsValues[0]);
      if (lower.includes('negative')) {
        config.negativePrompt = text;
        config.label = '反向提示词';
      } else {
        config.prompt = text;
        config.text = text;
      }
    }
  }

  // CheckpointLoader: [ckpt_name]
  if (lower.includes('checkpoint') || lower.includes('loader')) {
    if (widgetsValues[0] !== undefined) config.model = String(widgetsValues[0]);
  }

  // ImageScale: [upscale_method, width, height, crop]
  if (lower.includes('scale')) {
    if (widgetsValues[1] !== undefined) config.targetWidth = widgetsValues[1];
    if (widgetsValues[2] !== undefined) config.targetHeight = widgetsValues[2];
  }

  return config;
}

/** 解析ComfyUI工作流JSON，生成无界工作流 */
export function parseComfyUIWorkflow(json: string): Workflow | null {
  try {
    const data = JSON.parse(json);

    // ComfyUI格式检测: 顶层是 {nodeId: {class_type, inputs, ...}}
    const isComfyAPIFormat = !data.nodes && typeof data === 'object';
    // ComfyUI前端格式检测: 顶层有 {nodes: [...], links: [...]}
    const isComfyFrontendFormat = Array.isArray(data.nodes) && Array.isArray(data.links);

    if (!isComfyAPIFormat && !isComfyFrontendFormat) return null;

    const wf = createEmptyWorkflow('ComfyUI导入工作流');
    const nodeIdMap = new Map<string, string>(); // comfyId → wujieId

    if (isComfyFrontendFormat) {
      // 前端格式: nodes数组 + links数组
      for (const comfyNode of data.nodes) {
        const wujieType = comfyToWujieType(comfyNode.type || '');
        const wujieId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        nodeIdMap.set(String(comfyNode.id), wujieId);

        const config: Record<string, unknown> = {
          color: NODE_TYPE_COLORS[getNodeCategory(wujieType)],
          comfyType: comfyNode.type,
        };

        // 提取widgets_values中的字段
        if (comfyNode.widgets_values) {
          Object.assign(config, extractComfyFields(comfyNode.type, comfyNode.widgets_values));
        }

        const node: WorkflowNode = {
          id: wujieId,
          type: wujieType,
          label: config.label as string || comfyNode.title || comfyNode.type || NODE_TYPE_LABELS[wujieType],
          x: comfyNode.pos?.[0] || 100,
          y: comfyNode.pos?.[1] || 100,
          width: comfyNode.size?.[0] || 180,
          height: comfyNode.size?.[1] || 60,
          config,
          ports: createDefaultPorts(wujieType),
          condition: undefined,
          loopCount: undefined,
          agentRound: 0,
          breakpoint: false,
        };
        wf.nodes.push(node);
      }

      // 解析links: [link_id, from_node, from_slot, to_node, to_slot, type]
      if (data.links) {
        for (const link of data.links) {
          const fromWujieId = nodeIdMap.get(String(link[1]));
          const toWujieId = nodeIdMap.get(String(link[3]));
          if (!fromWujieId || !toWujieId) continue;

          const fromNode = wf.nodes.find(n => n.id === fromWujieId);
          const toNode = wf.nodes.find(n => n.id === toWujieId);
          const fromPort = fromNode?.ports.find(p => p.direction === 'out');
          const toPort = toNode?.ports.find(p => p.direction === 'in');

          if (fromPort && toPort) {
            wf.connections.push(createConnection(
              fromWujieId, fromPort.id,
              toWujieId, toPort.id,
              'any'
            ));
          }
        }
      }
    } else {
      // API格式: {nodeId: {class_type, inputs, _meta}}
      let yOffset = 0;
      for (const [comfyId, nodeData] of Object.entries(data)) {
        const nd = nodeData as { class_type?: string; inputs?: Record<string, unknown>; _meta?: { title?: string } };
        if (!nd.class_type) continue;

        const wujieType = comfyToWujieType(nd.class_type);
        const wujieId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        nodeIdMap.set(comfyId, wujieId);

        const config: Record<string, unknown> = {
          color: NODE_TYPE_COLORS[getNodeCategory(wujieType)],
          comfyType: nd.class_type,
        };

        // 从inputs中提取prompt等字段
        if (nd.inputs) {
          if (nd.inputs.text) config.prompt = String(nd.inputs.text);
          if (nd.inputs.prompt) config.prompt = String(nd.inputs.prompt);
          if (nd.inputs.negative_prompt || nd.inputs.negative) config.negativePrompt = String(nd.inputs.negative_prompt || nd.inputs.negative);
          if (nd.inputs.ckpt_name || nd.inputs.checkpoint) config.model = String(nd.inputs.ckpt_name || nd.inputs.checkpoint);
          if (nd.inputs.seed !== undefined) config.seed = nd.inputs.seed;
          if (nd.inputs.steps) config.steps = nd.inputs.steps;
          if (nd.inputs.cfg) config.cfg = nd.inputs.cfg;
          if (nd.inputs.denoise) config.strength = Math.round((nd.inputs.denoise as number) * 100);
          if (nd.inputs.image) config.imageUrl = String(nd.inputs.image);
        }

        const node: WorkflowNode = {
          id: wujieId,
          type: wujieType,
          label: nd._meta?.title || nd.class_type || NODE_TYPE_LABELS[wujieType],
          x: 80,
          y: yOffset,
          width: 180,
          height: 60,
          config,
          ports: createDefaultPorts(wujieType),
          condition: undefined,
          loopCount: undefined,
          agentRound: 0,
          breakpoint: false,
        };
        wf.nodes.push(node);
        yOffset += 100;
      }

      // 从inputs中解析连线 (引用格式的 ["nodeId", slotIndex])
      for (const [comfyId, nodeData] of Object.entries(data)) {
        const nd = nodeData as { inputs?: Record<string, unknown> };
        if (!nd.inputs) continue;
        const toWujieId = nodeIdMap.get(comfyId);
        if (!toWujieId) continue;

        for (const [inputName, inputValue] of Object.entries(nd.inputs)) {
          if (Array.isArray(inputValue) && typeof inputValue[0] === 'string' && typeof inputValue[1] === 'number') {
            const fromWujieId = nodeIdMap.get(inputValue[0]);
            if (!fromWujieId) continue;

            const fromNode = wf.nodes.find(n => n.id === fromWujieId);
            const toNode = wf.nodes.find(n => n.id === toWujieId);
            const fromPort = fromNode?.ports.find(p => p.direction === 'out');
            const toPort = toNode?.ports.find(p => p.direction === 'in');

            if (fromPort && toPort) {
              const existing = wf.connections.find(c => c.fromNodeId === fromWujieId && c.toNodeId === toWujieId);
              if (!existing) {
                wf.connections.push(createConnection(fromWujieId, fromPort.id, toWujieId, toPort.id, 'any'));
              }
            }
          }
        }
      }

      // 自动布局
      if (wf.nodes.length > 0) {
        autoLayoutWorkflow(wf);
      }
    }

    wf.description = '从ComfyUI工作流导入';
    return wf.nodes.length > 0 ? wf : null;
  } catch {
    return null;
  }
}

// ==================== build_mode 检测 ====================

/** 检测当前是否运行在构建/生产环境 */
export function isBuildMode(): boolean {
  return (process.env.COZE_PROJECT_ENV || '').toUpperCase() === 'PROD';
}

/** 检测当前是否运行在开发环境 */
export function isDevMode(): boolean {
  return (process.env.COZE_PROJECT_ENV || '').toUpperCase() !== 'PROD';
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
    { id: 'dc-1', fromNodeId: n1, fromPortId: `${n1}-output-1`, toNodeId: n2, toPortId: `${n2}-input-1`, type: 'prompt' },
    { id: 'dc-2', fromNodeId: n2, fromPortId: `${n2}-output-1`, toNodeId: n3, toPortId: `${n3}-input-1`, type: 'image' },
  );

  // ─── 链2: 条件分支链 ───
  const n4 = nid(), n5 = nid(), n6 = nid(), n7 = nid(), n8 = nid();
  wf.nodes.push(
    { id: n4, type: 'input-image', x: 80, y: 260, width: 180, height: 80, label: '图片输入', config: { source: 'canvas' }, ports: [makePort(n4, 'out', 1, '图片', 'image')] },
    { id: n5, type: 'ai-analyze', x: 340, y: 240, width: 200, height: 100, label: '风格分析', config: { analysisType: 'style' }, ports: [makePort(n5, 'in', 1, '图片', 'image'), makePort(n5, 'out', 1, '分析结果', 'prompt')] },
    { id: n6, type: 'condition-if', x: 620, y: 230, width: 160, height: 120, label: '风格=写实？', config: { condition: 'style === "realistic"' }, condition: 'style === "realistic"', ports: [makePort(n6, 'in', 1, '输入', 'any'), makePort(n6, 'out', 1, 'True', 'condition'), makePort(n6, 'out', 2, 'False', 'condition')] },
    { id: n7, type: 'output-image', x: 880, y: 190, width: 180, height: 80, label: '写实增强', config: {}, ports: [makePort(n7, 'in', 1, '图片', 'image')] },
    { id: n8, type: 'output-image', x: 880, y: 320, width: 180, height: 80, label: '风格化处理', config: {}, ports: [makePort(n8, 'in', 1, '图片', 'image')] },
  );
  wf.connections.push(
    { id: 'dc-3', fromNodeId: n4, fromPortId: `${n4}-output-1`, toNodeId: n5, toPortId: `${n5}-input-1`, type: 'image' },
    { id: 'dc-4', fromNodeId: n5, fromPortId: `${n5}-output-1`, toNodeId: n6, toPortId: `${n6}-input-1`, type: 'data' },
    { id: 'dc-5', fromNodeId: n6, fromPortId: `${n6}-output-1`, toNodeId: n7, toPortId: `${n7}-input-1`, type: 'condition' },
    { id: 'dc-6', fromNodeId: n6, fromPortId: `${n6}-output-2`, toNodeId: n8, toPortId: `${n8}-input-1`, type: 'condition' },
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
    { id: 'dc-7', fromNodeId: n9, fromPortId: `${n9}-output-1`, toNodeId: n10, toPortId: `${n10}-input-1`, type: 'image' },
    { id: 'dc-8', fromNodeId: n10, fromPortId: `${n10}-output-1`, toNodeId: n11, toPortId: `${n11}-input-1`, type: 'data' },
    { id: 'dc-9', fromNodeId: n11, fromPortId: `${n11}-output-1`, toNodeId: n12, toPortId: `${n12}-input-1`, type: 'data' },
    { id: 'dc-10', fromNodeId: n12, fromPortId: `${n12}-output-1`, toNodeId: n13, toPortId: `${n13}-input-1`, type: 'image' },
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
