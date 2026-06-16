/**
 * 纯数据驱动的节点端口位置计算
 * 替代从 DOM 查询端口位置的方式，消除时序问题和性能开销
 *
 * 布局参数来源（globals.css + node-editor.tsx 渲染逻辑）：
 * - node-header: height 42px
 * - port-row: padding 4px 上下, dot 12px → 行高 ~20px, dot中心 = rowTop + 10
 * - input-card: height ~34px (28px icon + margin)
 * - input-port dot: margin-left -18px → dot center x = -12
 * - output-port dot: margin-right -18px → dot center x = nodeWidth + 12
 */

/** 节点头部高度 (px) */
const HEADER_HEIGHT = 42;

/** 端口行高度 (px)：4px padding-top + 12px dot + 4px padding-bottom */
const PORT_ROW_HEIGHT = 20;

/** 端口圆点垂直中心相对于行顶部的偏移 */
const PORT_DOT_CENTER_Y = 10;

/** 输入端口圆点中心 x 坐标 (相对节点左边) */
const INPUT_PORT_X = -12;

/** 输出端口圆点中心 x 坐标偏移 (相对节点右边) */
const OUTPUT_PORT_X_OFFSET = 12;

/** 输入卡片高度 (AI 节点用) */
const INPUT_CARD_HEIGHT = 34;

/** 条件节点特殊端口区域高度 */
const CONDITION_BRANCH_HEIGHT = 28;

/** AI 节点类型前缀 */
const AI_NODE_PREFIX = 'ai-';

/** 使用 input-card 布局的节点类型 */
const INPUT_CARD_NODE_TYPES = new Set([
  'ai-generate',
  'ai-remove-bg',
  'ai-upscale',
  'ai-retouch',
  'ai-font-design',
  'ai-refine-engine',
  'ai-brand-ecommerce',
  'ai-segment',
  'ai-multi-angle',
  'ai-3d-model',
  'ai-video-generate',
  'ai-video-i2v',
  'agent',
  'storyboard-sequence',
]);

/** 使用 input-card 布局的输出端口类型 */
const INPUT_CARD_OUTPUT_TYPES = new Set([
  'image',
  'images',
  'video',
]);

export interface PortPosition {
  x: number;
  y: number;
}

/**
 * 判断节点是否使用 input-card 布局渲染输入端口
 */
function isInputCardNode(nodeType: string): boolean {
  return INPUT_CARD_NODE_TYPES.has(nodeType) || nodeType.startsWith(AI_NODE_PREFIX);
}

/**
 * 获取节点的输入端口数量
 */
function getInputPortCount(node: { type: string; ports?: { inputs?: unknown[] } }): number {
  if (node.ports?.inputs) return node.ports.inputs.length;
  // 根据 node type 推断
  switch (node.type) {
    case 'input-text':
    case 'input-image':
      return 0; // 输入节点没有输入端口
    case 'output-image':
    case 'output-export':
    case 'output-video':
    case 'output-image-group':
      return 1;
    case 'condition':
      return 1;
    case 'loop':
      return 1;
    case 'agent':
      return 1;
    case 'storyboard-sequence':
      return 1;
    default:
      if (node.type?.startsWith(AI_NODE_PREFIX)) return 1;
      return 1;
  }
}

/**
 * 获取节点的输出端口数量
 */
function getOutputPortCount(node: { type: string; ports?: { outputs?: unknown[] } }): number {
  if (node.ports?.outputs) return node.ports.outputs.length;
  switch (node.type) {
    case 'input-text':
      return 1;
    case 'input-image':
      return 1;
    case 'output-image':
    case 'output-export':
    case 'output-video':
    case 'output-image-group':
      return 0;
    case 'condition':
      return 2; // true/false
    case 'loop':
      return 1;
    case 'agent':
      return 1;
    case 'storyboard-sequence':
      return 1;
    default:
      if (node.type?.startsWith(AI_NODE_PREFIX)) return 1;
      return 1;
  }
}

/**
 * 计算输入端口在节点坐标系中的位置
 *
 * @param nodeType 节点类型
 * @param portIndex 端口在输入列表中的索引
 * @param nodeWidth 节点宽度
 * @param nodeHeight 节点高度（已知时使用，用于条件节点的分支端口定位）
 */
export function computeInputPortPosition(
  nodeType: string,
  portIndex: number,
  nodeWidth: number,
  _nodeHeight?: number
): PortPosition {
  const x = INPUT_PORT_X;

  if (isInputCardNode(nodeType)) {
    // AI 节点：使用 input-card 布局
    // 每个 input-card 高度 34px，从 header 下方开始
    const y = HEADER_HEIGHT + portIndex * INPUT_CARD_HEIGHT + INPUT_CARD_HEIGHT / 2;
    return { x, y };
  }

  // 通用节点：使用 port-row 布局
  const y = HEADER_HEIGHT + portIndex * PORT_ROW_HEIGHT + PORT_DOT_CENTER_Y;
  return { x, y };
}

/**
 * 计算输出端口在节点坐标系中的位置
 *
 * @param nodeType 节点类型
 * @param portIndex 端口在输出列表中的索引
 * @param nodeWidth 节点宽度
 * @param nodeHeight 节点高度（已知时使用，用于底部对齐输出端口）
 * @param inputPortCount 输入端口数量（用于计算输出端口起始 y）
 */
export function computeOutputPortPosition(
  nodeType: string,
  portIndex: number,
  nodeWidth: number,
  nodeHeight?: number,
  inputPortCount?: number
): PortPosition {
  const x = nodeWidth + OUTPUT_PORT_X_OFFSET;

  // 条件节点：true/false 两个输出端口在底部区域
  if (nodeType === 'condition') {
    // 条件节点特殊布局：底部两个分支
    const branchY = (nodeHeight || 200) - 40; // 距底部 40px
    const y = branchY + portIndex * CONDITION_BRANCH_HEIGHT + 14;
    return { x, y };
  }

  if (isInputCardNode(nodeType)) {
    // AI 节点：输出端口在 input-cards 下方，使用 port-row 布局
    const inputsHeight = (inputPortCount || 1) * INPUT_CARD_HEIGHT;
    const y = HEADER_HEIGHT + inputsHeight + portIndex * PORT_ROW_HEIGHT + PORT_DOT_CENTER_Y;
    return { x, y };
  }

  // 通用节点：输出端口在输入端口下方
  const effectiveInputCount = inputPortCount ?? getInputPortCount({ type: nodeType });
  const y = HEADER_HEIGHT + effectiveInputCount * PORT_ROW_HEIGHT + portIndex * PORT_ROW_HEIGHT + PORT_DOT_CENTER_Y;
  return { x, y };
}

/**
 * 统一计算任意端口在节点坐标系中的位置
 *
 * @param node 节点数据（至少包含 type, width, height）
 * @param direction 'input' 或 'output'
 * @param portIndex 端口索引
 */
export function computePortPosition(
  node: { type: string; width: number; height: number; ports?: { inputs?: unknown[]; outputs?: unknown[] } },
  direction: 'input' | 'output',
  portIndex: number
): PortPosition {
  const nodeWidth = node.width || 260;
  const inputCount = getInputPortCount(node);

  if (direction === 'input') {
    return computeInputPortPosition(node.type, portIndex, nodeWidth, node.height);
  } else {
    return computeOutputPortPosition(node.type, portIndex, nodeWidth, node.height, inputCount);
  }
}
