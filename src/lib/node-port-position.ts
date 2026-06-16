/**
 * 纯数据驱动的节点端口位置计算
 * 替代 DOM 查询方式，消除时序问题和性能瓶颈
 * 
 * 端口布局规则（基于实际渲染的 CSS 结构）：
 * - node-card-header: 高度约 32px (padding 6+6, icon 18px, gap 6px)
 * - port-row (普通输入/输出端口): padding 4px 12px, port-dot 10px, 约 20px/行
 * - input-card (AI 节点输入端口): padding 6px 8px, icon 28px, 约 34px/行
 * - 节点最小高度约束: header + 至少一个端口行
 */

import type { NodePort, NodeType, WorkflowNode } from './workflow-engine';

// ========== 布局常量 ==========

const HEADER_HEIGHT = 32;
const PORT_ROW_HEIGHT = 20;      // port-row: padding 4px + dot 12px + padding 4px
const INPUT_CARD_HEIGHT = 34;    // input-card: padding 6px + icon 28px
const INPUT_CARD_MARGIN_BOTTOM = 6;
const FIELD_ROW_HEIGHT = 28;     // 字段行
const NODE_MIN_HEIGHT = 80;

// ========== 节点分类辅助 ==========

type NodeCategory = 'input' | 'output' | 'ai' | 'control' | 'group';

function getNodeCategory(type: NodeType): NodeCategory {
  if (type === 'input-text' || type === 'input-image') return 'input';
  if (type === 'output-image' || type === 'output-export' || type === 'output-image-group' || type === 'output-video') return 'output';
  if (type.startsWith('condition-') || type.startsWith('loop-') || type === 'parallel' || type.startsWith('agent-') || type === 'storyboard-sequence') return 'control';
  if (type === 'group') return 'group';
  return 'ai'; // ai-generate, ai-remove-bg, ai-upscale, etc.
}

/** 是否使用 input-card 布局（AI 节点） */
function usesInputCardLayout(type: NodeType): boolean {
  return getNodeCategory(type) === 'ai';
}

// ========== 端口位置计算 ==========

export interface PortPosition {
  x: number;
  y: number;
}

/**
 * 计算单个端口在节点局部坐标系中的位置
 * @param node 工作流节点
 * @param portId 端口ID
 * @returns 端口在节点内的局部坐标 { x, y }，或 null 如果未找到
 */
export function computePortPosition(
  node: WorkflowNode,
  portId: string
): PortPosition | null {
  const port = node.ports.find(p => p.id === portId);
  if (!port) return null;

  const inputPorts = node.ports.filter(p => p.direction === 'in');
  const outputPorts = node.ports.filter(p => p.direction === 'out');
  const nodeWidth = node.width || 260;

  let y = HEADER_HEIGHT;

  const isAI = usesInputCardLayout(node.type);

  if (port.direction === 'in') {
    const portIndex = inputPorts.findIndex(p => p.id === portId);
    if (portIndex < 0) return null;

    if (isAI) {
      // AI 节点: 输入端口使用 input-card 布局
      y += portIndex * (INPUT_CARD_HEIGHT + INPUT_CARD_MARGIN_BOTTOM) + INPUT_CARD_HEIGHT / 2;
      return { x: 0, y };
    } else {
      // 普通节点: 输入端口使用 port-row 布局
      y += portIndex * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2;
      return { x: 0, y };
    }
  } else {
    // 输出端口: 所有节点都用 port-row 布局
    const portIndex = outputPorts.findIndex(p => p.id === portId);
    if (portIndex < 0) return null;

    if (isAI) {
      // AI 节点: 输出端口在输入卡片之后
      const inputSectionHeight = inputPorts.length * (INPUT_CARD_HEIGHT + INPUT_CARD_MARGIN_BOTTOM);
      y += inputSectionHeight + portIndex * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2;
    } else {
      // 普通节点: 输出端口在输入端口之后
      const inputSectionHeight = inputPorts.length * PORT_ROW_HEIGHT;
      y += inputSectionHeight + portIndex * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2;
    }

    return { x: nodeWidth, y };
  }
}

/**
 * 批量计算节点所有端口位置
 * @param node 工作流节点
 * @returns Map<portId, PortPosition>
 */
export function computeAllPortPositions(node: WorkflowNode): Map<string, PortPosition> {
  const positions = new Map<string, PortPosition>();
  for (const port of node.ports) {
    const pos = computePortPosition(node, port.id);
    if (pos) {
      positions.set(port.id, pos);
    }
  }
  return positions;
}

/**
 * 计算节点的预期高度（基于端口数量）
 * 用于验证和初始化节点高度
 */
export function computeExpectedNodeHeight(node: WorkflowNode): number {
  const inputPorts = node.ports.filter(p => p.direction === 'in');
  const outputPorts = node.ports.filter(p => p.direction === 'out');
  const isAI = usesInputCardLayout(node.type);

  let height = HEADER_HEIGHT;

  if (isAI) {
    height += inputPorts.length * (INPUT_CARD_HEIGHT + INPUT_CARD_MARGIN_BOTTOM);
    height += outputPorts.length * PORT_ROW_HEIGHT;
  } else {
    height += (inputPorts.length + outputPorts.length) * PORT_ROW_HEIGHT;
  }

  return Math.max(height, NODE_MIN_HEIGHT);
}
