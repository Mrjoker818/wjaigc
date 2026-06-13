/**
 * Credits (积分) helper for server-side API routes
 * Handles credit deduction for AI generation operations
 */

import { dbGetCredits, dbAdjustCredits, dbInitCredits } from './db-storage';

// Credit costs for different operations
export const CREDIT_COSTS: Record<string, number> = {
  image_generate: 10,       // 图像生成
  image_edit: 15,           // 图像编辑（擦除/蒙版/扩展）
  image_upscale: 8,         // 无损放大
  image_remove_bg: 5,       // 移除背景
  image_retouch: 12,        // 语言修图
  video_generate: 30,       // 视频生成
  video_extend: 25,         // 视频延长
  chat: 2,                  // AI聊天
  vectorize: 10,            // 矢量化
  segment: 15,              // 元素分层
  '3d_model': 20,           // 3D模型
  agent_edit: 20,           // Agent编排
  font_design: 15,          // 字体设计
  svg_trace: 5,             // SVG描摹
} as const;

export type CreditOperation = keyof typeof CREDIT_COSTS;

/**
 * Check if user has enough credits and deduct them.
 * Returns { success, balance, message }
 * If credits system is not configured (no database), always succeeds.
 */
export async function consumeCredits(
  userId: string,
  operation: CreditOperation,
  customAmount?: number,
  description?: string
): Promise<{ success: boolean; balance: number; cost: number; message?: string }> {
  const cost = customAmount ?? CREDIT_COSTS[operation] ?? 0;
  if (cost <= 0) return { success: true, balance: 0, cost: 0 };

  try {
    // Check current balance
    let credits = await dbGetCredits(userId);
    if (!credits) {
      // Auto-init credits for new users
      credits = await dbInitCredits(userId);
    }

    if (credits && credits.balance < cost) {
      return {
        success: false,
        balance: credits.balance,
        cost,
        message: `积分不足，需要 ${cost} 积分，当前余额 ${credits.balance} 积分`,
      };
    }

    // Deduct credits
    const result = await dbAdjustCredits(
      userId,
      -cost,
      'consume',
      description || `${getOperationLabel(operation)} 扣除 ${cost} 积分`,
      operation
    );

    if (!result.success) {
      return { success: false, balance: 0, cost, message: result.message || '积分扣除失败' };
    }

    return { success: true, balance: result.balance, cost };
  } catch (e) {
    console.error('[credits] consumeCredits error:', e);
    // If credits system fails, allow the operation to proceed
    return { success: true, balance: 0, cost };
  }
}

/**
 * Get the display label for an operation type
 */
function getOperationLabel(operation: CreditOperation): string {
  const labels: Record<CreditOperation, string> = {
    image_generate: '图像生成',
    image_edit: '图像编辑',
    image_upscale: '无损放大',
    image_remove_bg: '移除背景',
    image_retouch: '语言修图',
    video_generate: '视频生成',
    video_extend: '视频延长',
    chat: 'AI聊天',
    vectorize: '矢量化',
    segment: '元素分层',
    '3d_model': '3D模型',
    agent_edit: 'Agent编排',
    font_design: '字体设计',
    svg_trace: 'SVG描摹',
  };
  return labels[operation] || operation;
}

/**
 * Check if a user has enough credits for an operation without deducting
 */
export async function checkCredits(
  userId: string,
  operation: CreditOperation,
  customAmount?: number
): Promise<{ sufficient: boolean; balance: number; cost: number }> {
  const cost = customAmount ?? CREDIT_COSTS[operation] ?? 0;
  if (cost <= 0) return { sufficient: true, balance: 0, cost: 0 };

  try {
    let credits = await dbGetCredits(userId);
    if (!credits) {
      credits = await dbInitCredits(userId);
    }
    const balance = credits?.balance ?? 0;
    return { sufficient: balance >= cost, balance, cost };
  } catch {
    return { sufficient: true, balance: 0, cost };
  }
}
