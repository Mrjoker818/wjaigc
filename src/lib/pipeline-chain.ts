/**
 * Pipeline Chain — 操作链数据模型
 * 
 * 每张画布图片可以拥有一条操作链（Pipeline），
 * 记录该图片经历的所有操作步骤（加载/处理/条件/循环/Agent等）。
 */

/** 操作步骤类型 */
export type PipelineStepType =
  | 'load'          // 加载图片
  | 'process'       // 处理操作（移除背景/放大/擦除/蒙版/扩展等）
  | 'generate'      // AI生成（图生图/从零生成）
  | 'condition'     // 条件分支
  | 'loop'          // 循环
  | 'agent'         // Agent自主执行
  | 'subgraph'      // 子图/组合
  | 'output'        // 输出
  | 'edit';         // 语言修图

/** 操作步骤状态 */
export type PipelineStepStatus = 
  | 'completed'     // 已完成
  | 'running'       // 执行中
  | 'pending'       // 待执行
  | 'failed'        // 失败
  | 'cancelled';    // 已取消

/** 条件分支结果 */
export interface ConditionBranch {
  label: string;          // 分支标签（如 "True → 白底合成"）
  targetStepIndex?: number; // 指向的步骤索引
  isTrue: boolean;        // 是否为 True 分支
}

/** 单个操作步骤 */
export interface PipelineStep {
  /** 唯一ID */
  id: string;
  /** 步骤类型 */
  type: PipelineStepType;
  /** 步骤状态 */
  status: PipelineStepStatus;
  /** 步骤名称（如"移除背景"、"图生图"） */
  label: string;
  /** 步骤描述/参数摘要 */
  description?: string;
  /** 结果缩略图URL */
  resultThumbnailUrl?: string;
  /** 执行进度 0-100 */
  progress?: number;
  /** 执行耗时（秒） */
  duration?: number;
  /** 条件分支（仅 type='condition'） */
  branches?: ConditionBranch[];
  /** 循环次数（仅 type='loop'） */
  loopCount?: number;
  /** 循环当前迭代（仅 type='loop' 且 status='running'） */
  loopCurrent?: number;
  /** 错误信息（仅 status='failed'） */
  error?: string;
  /** 关联的图片ID（如生成的新图片ID） */
  outputImageId?: string;
  /** 创建时间 */
  createdAt: number;
}

/** 完整的操作链 */
export interface PipelineChain {
  /** 关联的画布图片ID */
  imageId: string;
  /** 操作步骤列表 */
  steps: PipelineStep[];
  /** 原图URL（用于对比） */
  originalUrl?: string;
  /** 当前URL（最新结果） */
  currentUrl?: string;
  /** 创建时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
}

/** 节点类型分类（用于左侧节点库面板） */
export interface NodeCategory {
  id: string;
  label: string;
  icon: string; // Lucide icon name
  colorVariable: string; // 如 'node-input', 'node-process' 等
  items: NodeItem[];
}

/** 节点库单项 */
export interface NodeItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  stepType: PipelineStepType;
}

/** 预置节点库 */
export const NODE_CATEGORIES: NodeCategory[] = [
  {
    id: 'input',
    label: '输入',
    icon: 'log-in',
    colorVariable: 'node-input',
    items: [
      { id: 'load-image', label: '加载图片', description: '从本地上传或URL加载', icon: 'image', stepType: 'load' },
      { id: 'load-url', label: '加载URL', description: '从网络地址加载图片', icon: 'link', stepType: 'load' },
      { id: 'text-input', label: '文本输入', description: '输入提示词文本', icon: 'type', stepType: 'generate' },
    ],
  },
  {
    id: 'process',
    label: '处理',
    icon: 'layers',
    colorVariable: 'node-process',
    items: [
      { id: 'remove-bg', label: '移除背景', description: '自动分离主体与背景', icon: 'scissors', stepType: 'process' },
      { id: 'upscale', label: '无损放大', description: '放大图片同时增强细节', icon: 'maximize-2', stepType: 'process' },
      { id: 'img2img', label: '图生图', description: '基于原图生成新图', icon: 'image-plus', stepType: 'generate' },
      { id: 'adjust-color', label: '调色', description: '调整色彩/亮度/对比度', icon: 'palette', stepType: 'process' },
      { id: 'white-bg', label: '白底合成', description: '将透明背景替换为白色', icon: 'square', stepType: 'process' },
      { id: 'erase-repair', label: '擦除修复', description: '涂抹消除并智能修补', icon: 'eraser', stepType: 'process' },
    ],
  },
  {
    id: 'agent',
    label: 'Agent',
    icon: 'bot',
    colorVariable: 'node-agent',
    items: [
      { id: 'ai-check', label: 'AI质检', description: '自动检测图片质量问题', icon: 'scan', stepType: 'agent' },
      { id: 'ai-optimize', label: 'AI优化', description: '智能优化图片效果', icon: 'sparkles', stepType: 'agent' },
      { id: 'ai-retouch', label: 'AI修图', description: '自然语言描述修改图片', icon: 'pencil', stepType: 'edit' },
      { id: 'image-analysis', label: '图片分析', description: 'AI分析图片内容与标签', icon: 'eye', stepType: 'agent' },
    ],
  },
  {
    id: 'logic',
    label: '逻辑控制',
    icon: 'git-branch',
    colorVariable: 'node-logic',
    items: [
      { id: 'condition', label: '条件分支 If/Else', description: '根据条件选择执行路径', icon: 'git-branch', stepType: 'condition' },
      { id: 'loop', label: '循环 Loop', description: '重复执行一组操作', icon: 'repeat', stepType: 'loop' },
      { id: 'parallel', label: '并行执行', description: '同时执行多个操作', icon: 'git-merge', stepType: 'process' },
      { id: 'switch', label: '开关 Switch', description: '多路选择执行', icon: 'toggle-right', stepType: 'condition' },
    ],
  },
  {
    id: 'subgraph',
    label: '子图/组合',
    icon: 'package',
    colorVariable: 'node-subgraph',
    items: [
      { id: 'subgraph', label: '子图', description: '将多个步骤封装为子图', icon: 'package', stepType: 'subgraph' },
      { id: 'group', label: '组合操作', description: '批量组合多个处理步骤', icon: 'layers', stepType: 'process' },
    ],
  },
  {
    id: 'output',
    label: '输出',
    icon: 'download',
    colorVariable: 'node-output',
    items: [
      { id: 'save-image', label: '保存图片', description: '保存到本地或云端', icon: 'download', stepType: 'output' },
      { id: 'export-svg', label: '导出SVG', description: '矢量化导出', icon: 'file-code', stepType: 'output' },
      { id: 'export-psd', label: '导出PSD', description: '分层导出PSD文件', icon: 'file-image', stepType: 'output' },
    ],
  },
];

/** 获取步骤类型的默认颜色 */
export function getStepTypeColor(type: PipelineStepType): string {
  const colorMap: Record<PipelineStepType, string> = {
    load: '#3b82f6',       // node-input
    process: '#8b5cf6',    // node-process
    generate: '#d4af37',   // node-ai / primary
    condition: '#f59e0b',  // node-logic
    loop: '#f59e0b',       // node-logic
    agent: '#f472b6',      // node-agent
    subgraph: '#06b6d4',   // node-subgraph
    output: '#2ea043',     // node-output
    edit: '#d4af37',       // node-ai
  };
  return colorMap[type] || '#7d8590';
}

/** 获取步骤状态的颜色 */
export function getStepStatusColor(status: PipelineStepStatus): string {
  const statusMap: Record<PipelineStepStatus, string> = {
    completed: '#2ea043',  // success
    running: '#d4af37',    // primary
    pending: '#7d8590',    // muted
    failed: '#f85149',     // error
    cancelled: '#7d8590',  // muted
  };
  return statusMap[status] || '#7d8590';
}

/** 创建空的Pipeline Chain */
export function createPipelineChain(imageId: string, imageUrl?: string): PipelineChain {
  const now = Date.now();
  return {
    imageId,
    steps: [
      {
        id: `step-${now}`,
        type: 'load',
        status: 'completed',
        label: '加载图片',
        createdAt: now,
      },
    ],
    originalUrl: imageUrl,
    currentUrl: imageUrl,
    createdAt: now,
    updatedAt: now,
  };
}

/** 生成唯一步骤ID */
export function generateStepId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

/** 向操作链添加一个步骤 */
export function addStepToChain(
  chain: PipelineChain,
  partial: { type: PipelineStepType; label: string; description?: string }
): PipelineChain {
  const now = Date.now();
  const step: PipelineStep = {
    id: generateStepId(),
    type: partial.type,
    status: 'pending',
    label: partial.label,
    description: partial.description,
    createdAt: now,
  };
  return {
    ...chain,
    steps: [...chain.steps, step],
    updatedAt: now,
  };
}
