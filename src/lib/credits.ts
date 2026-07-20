/**
 * Credits (积分) helper for server-side API routes
 * Handles credit deduction for AI generation operations
 * 
 * 积分定价体系：1积分 = ¥0.01
 * 不同模型根据实际API成本扣除不同积分
 * 
 * 注意：纯常量定义在 credits-constants.ts 中（可安全在客户端组件中导入）
 * 此文件仅包含服务端函数（依赖 db-storage）
 */

import { dbGetCredits, dbAdjustCredits, dbInitCredits, dbRecordCreditTransaction } from './db-storage';
export {
  CREDITS_TO_CNY, CNY_TO_CREDITS,
  IMAGE_MODEL_CREDITS, VIDEO_MODEL_CREDITS, CHAT_MODEL_CREDITS,
  OTHER_OPERATION_CREDITS, RECHARGE_PACKAGES,
} from './credits-constants';
import {
  IMAGE_MODEL_CREDITS, VIDEO_MODEL_CREDITS, CHAT_MODEL_CREDITS,
  OTHER_OPERATION_CREDITS, CREDITS_TO_CNY,
} from './credits-constants';
import { loadCreditPricingConfig, resolveConfiguredCreditCost, resolveTokenPricingFromConfig } from './credit-pricing';
import type { TokenCreditPricing } from './credit-pricing';

// ========== 查找模型积分消耗 ==========

/**
 * 根据图像模型名称获取积分消耗
 * 支持模糊匹配（包含关键词即可）
 */
export function getImageModelCredits(model: string, quality?: string, resolution?: string): number {
  if (!model) return 10; // 默认10积分
  
  // 精确匹配
  const exact = IMAGE_MODEL_CREDITS[model];
  if (exact) {
    if (quality && exact.quality && exact.quality[quality]) {
      return exact.quality[quality];
    }
    if (resolution && exact.resolution && exact.resolution[resolution]) {
      return exact.resolution[resolution];
    }
    return exact.credits;
  }

  // 模糊匹配：检查模型名是否包含注册表中的key
  const modelLower = model.toLowerCase();
  for (const [key, val] of Object.entries(IMAGE_MODEL_CREDITS)) {
    if (modelLower.includes(key) || key.split('-').some(k => modelLower.includes(k) && k.length > 2)) {
      if (quality && val.quality && val.quality[quality]) {
        return val.quality[quality];
      }
      if (resolution && val.resolution && val.resolution[resolution]) {
        return val.resolution[resolution];
      }
      return val.credits;
    }
  }

  // 基于模型名关键词的智能推断
  if (modelLower.includes('dall-e') || modelLower.includes('dalle')) return 28;
  if (modelLower.includes('gpt-image') || modelLower.includes('gpt-image')) return 60;
  if (modelLower.includes('seedream') || modelLower.includes('doubao')) return 6;
  if (modelLower.includes('kling')) return 15;
  if (modelLower.includes('gemini') || modelLower.includes('nano-banana')) return 4;
  if (modelLower.includes('midjourney') || modelLower.includes('mj')) return 35;
  if (modelLower.includes('flux-pro') || modelLower.includes('flux-1.1')) return 30;
  if (modelLower.includes('flux')) return 4;
  if (modelLower.includes('ideogram')) return 6;
  if (modelLower.includes('stable') || modelLower.includes('sdxl') || modelLower.includes('sd3')) return 2;
  
  return 10; // 默认10积分
}

/**
 * 根据视频模型名称获取积分消耗（按秒）
 */
export function getVideoModelCreditsPerSecond(model: string): number {
  if (!model) return 30;

  // 精确匹配
  const exact = VIDEO_MODEL_CREDITS[model];
  if (exact) return exact.creditsPerSecond;

  // 模糊匹配
  const modelLower = model.toLowerCase();
  for (const [key, val] of Object.entries(VIDEO_MODEL_CREDITS)) {
    if (modelLower.includes(key)) return val.creditsPerSecond;
  }

  // 基于关键词推断
  if (modelLower.includes('kling') || modelLower.includes('可灵')) return 30;
  if (modelLower.includes('seedance') || modelLower.includes('豆包')) return 50;
  if (modelLower.includes('sora')) return 100;
  if (modelLower.includes('veo')) return 150;
  if (modelLower.includes('runway') || modelLower.includes('gen-')) return 60;
  if (modelLower.includes('vidu')) return 25;
  if (modelLower.includes('pika')) return 50;
  if (modelLower.includes('luma')) return 40;
  if (modelLower.includes('minimax') || modelLower.includes('hailuo') || modelLower.includes('海螺')) return 30;

  return 30; // 默认30积分/秒
}

/**
 * 根据聊天模型名称获取积分消耗
 */
export function getChatModelCredits(model: string): number {
  if (!model) return 2;

  // 精确匹配
  const exact = CHAT_MODEL_CREDITS[model];
  if (exact) return exact.creditsPerCall;

  // 模糊匹配
  const modelLower = model.toLowerCase();
  for (const [key, val] of Object.entries(CHAT_MODEL_CREDITS)) {
    if (modelLower.includes(key)) return val.creditsPerCall;
  }

  // 基于关键词推断
  if (modelLower.includes('gpt-4') || modelLower.includes('gpt4')) return 10;
  if (modelLower.includes('gpt-3.5') || modelLower.includes('gpt3')) return 2;
  if (modelLower.includes('o3') || modelLower.includes('o4')) return 12;
  if (modelLower.includes('gemini-pro')) return 15;
  if (modelLower.includes('gemini-flash') || modelLower.includes('gemini-2')) return 2;
  if (modelLower.includes('deepseek')) return 3;
  if (modelLower.includes('qwen')) return 3;
  if (modelLower.includes('claude') && (modelLower.includes('sonnet') || modelLower.includes('opus'))) return 15;
  if (modelLower.includes('claude') && modelLower.includes('haiku')) return 3;
  if (modelLower.includes('claude')) return 10;

  return 2; // 默认2积分
}

/**
 * 获取其他操作的积分消耗
 */
export function getOtherOperationCredits(operation: string): number {
  return OTHER_OPERATION_CREDITS[operation]?.credits ?? 10;
}

// ========== 核心：检查并扣除积分 ==========

export type CreditOperation = 'image_generate' | 'image_edit' | 'image_upscale' | 'image_remove_bg' | 'image_retouch' | 'video_generate' | 'video_extend' | 'chat' | 'vectorize' | 'segment' | '3d_model' | 'agent_edit' | 'font_design' | 'svg_trace';

/**
 * Calculate credit cost based on model and operation type
 */
export function calculateCreditCost(
  operation: CreditOperation | string,
  model?: string,
  options?: { quality?: string; resolution?: string; durationSeconds?: number }
): number {
  if (operation === 'image_generate') {
    return getImageModelCredits(model || '', options?.quality, options?.resolution);
  }
  if (operation === 'video_generate' || operation === 'video_extend') {
    const perSecond = getVideoModelCreditsPerSecond(model || '');
    const duration = options?.durationSeconds || 5;
    return perSecond * duration;
  }
  if (operation === 'chat') {
    return getChatModelCredits(model || '');
  }
  return getOtherOperationCredits(operation);
}

export async function calculateConfiguredCreditCost(
  operation: CreditOperation | string,
  model?: string,
  options?: { quality?: string; resolution?: string; durationSeconds?: number; providerId?: string },
): Promise<number> {
  if (!model) return calculateCreditCost(operation, model, options);
  const config = await loadCreditPricingConfig();
  if (operation === 'video_generate' || operation === 'video_extend') {
    const fallbackPerSecond = getVideoModelCreditsPerSecond(model);
    const perSecond = resolveConfiguredCreditCost(config, model, undefined, undefined, fallbackPerSecond, options?.providerId);
    return perSecond * Math.max(1, options?.durationSeconds || 5);
  }
  const fallback = calculateCreditCost(operation, model, options);
  const configured = resolveConfiguredCreditCost(config, model, options?.quality, options?.resolution, fallback, options?.providerId);
  return configured;
}

// ========== Token 计费（LLM 按量计费） ==========

/** LLM 单次调用的 Token 用量 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * 按 Token 用量计算积分成本。
 * 单价单位：积分 / 1M tokens（输入、输出独立计价）。
 * 结果向上取整，最低 1 积分（balance 为 INTEGER，必须取整）。
 */
export function calculateTokenCredits(
  usage: TokenUsage,
  pricing: TokenCreditPricing
): number {
  const raw =
    (Math.max(0, usage.inputTokens) * pricing.input +
      Math.max(0, usage.outputTokens) * pricing.output) /
    1_000_000;
  return Math.max(1, Math.ceil(raw));
}

/**
 * 解析模型的 Token 计费配置；未配置时返回 null（按次计费兜底）。
 */
export async function resolveConfiguredTokenPricing(
  model: string,
  providerId?: string
): Promise<TokenCreditPricing | null> {
  const config = await loadCreditPricingConfig();
  return resolveTokenPricingFromConfig(config, model, providerId);
}

/**
 * Token 计费结算：请求前已按预估金额 preChargedCredits 预扣，
 * 请求完成后根据实际 usage 多退少补。
 * 结算失败不抛出异常（响应已产出，仅记录日志），返回实际成本。
 */
export async function settleTokenCharge(
  userId: string,
  model: string,
  providerId: string | undefined,
  usage: TokenUsage,
  preChargedCredits: number,
  description: string
): Promise<number> {
  const pricing = await resolveConfiguredTokenPricing(model, providerId);
  if (!pricing) return preChargedCredits;

  const actualCost = calculateTokenCredits(usage, pricing);
  const diff = actualCost - preChargedCredits;

  try {
    if (diff > 0) {
      // 实际成本高于预扣：补扣差额（余额不足时仅记录，不影响已产出的响应）
      const result = await consumeCredits(
        userId,
        'chat',
        diff,
        `${description}（Token补扣 ${usage.inputTokens}+${usage.outputTokens}）`,
        model,
        { providerId }
      );
      if (!result.success) {
        console.warn(
          `[credits] Token settlement top-up failed for user ${userId}: ` +
          `need +${diff}, balance ${result.balance}`
        );
        return preChargedCredits;
      }
    } else if (diff < 0) {
      // 实际成本低于预扣：返还差额
      await refundCredits(
        userId,
        -diff,
        `${description}（Token返还 ${usage.inputTokens}+${usage.outputTokens}）`
      );
    }
  } catch (error) {
    console.error('[credits] Token settlement error:', error);
    return preChargedCredits;
  }

  return actualCost;
}

/**
 * Get the display label for an operation type
 */
function getOperationLabel(operation: CreditOperation | string, model?: string): string {
  if (operation === 'image_generate' && model) {
    const info = IMAGE_MODEL_CREDITS[model];
    return info ? info.label : '图像生成';
  }
  if ((operation === 'video_generate' || operation === 'video_extend') && model) {
    const info = VIDEO_MODEL_CREDITS[model];
    return info ? info.label : (operation === 'video_extend' ? '视频延长' : '视频生成');
  }
  if (operation === 'chat' && model) {
    const info = CHAT_MODEL_CREDITS[model];
    return info ? info.label : 'AI聊天';
  }
  const labels: Record<string, string> = {
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
 * Check if user has enough credits and deduct them.
 * Returns { success, balance, cost, message }
 * If credits system is not configured (no database), always succeeds.
 */
export async function consumeCredits(
  userId: string,
  operation: CreditOperation | string,
  customAmount?: number,
  description?: string,
  model?: string,
  options?: { quality?: string; resolution?: string; durationSeconds?: number; providerId?: string }
): Promise<{ success: boolean; balance: number; cost: number; message?: string }> {
  const cost = customAmount ?? await calculateConfiguredCreditCost(operation, model, options);
  if (cost <= 0) return { success: true, balance: 0, cost: 0 };

  try {
    const opLabel = getOperationLabel(operation, model);
    const modelInfo = model ? ` [${model}]` : '';

    // Atomic deduction: UPDATE ... WHERE balance >= cost
    // This avoids race condition where concurrent requests both pass the balance check
    const { execSql } = await import('@/lib/db-client');
    const now = Date.now();
    const deductResult = await execSql(
      `UPDATE wujie_credits 
       SET balance = balance - $1, 
           total_used = total_used + $2, 
           updated_at = $3 
       WHERE user_id = $4 AND balance >= $1 
       RETURNING balance`,
      [cost, cost, now, userId]
    );

    if (!deductResult || !deductResult.rows || deductResult.rows.length === 0) {
      // Either user doesn't exist or balance insufficient
      // Try auto-init for new users, then check again
      let credits = await dbGetCredits(userId);
      if (!credits) {
        credits = await dbInitCredits(userId);
      }
      const currentBalance = credits?.balance ?? 0;
      return {
        success: false,
        balance: currentBalance,
        cost,
        message: `积分不足，需要 ${cost} 积分（≈¥${(cost * CREDITS_TO_CNY).toFixed(2)}），当前余额 ${currentBalance} 积分`,
      };
    }

    const newBalance = Number(deductResult.rows[0].balance);

    // Record the transaction in history — 使用事务保证一致性
    try {
      const { execSql: execSql2 } = await import('@/lib/db-client');
      const txId = 'ctx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
      // 尝试在同一事务中插入记录
      await execSql2(
        `INSERT INTO wujie_credit_transactions (id, user_id, amount, type, balance_after, description, reference_id, created_at)
         VALUES ($1, $2, $3, 'consume', $4, $5, $6, $7)`,
        [txId, userId, -cost, newBalance, description || `${opLabel}${modelInfo} 扣除 ${cost} 积分`, `${operation}${modelInfo}`, Date.now()]
      );
    } catch {
      // 事务记录是非关键的，如果插入失败不影响扣费结果
      try {
        await dbRecordCreditTransaction(
          userId,
          -cost,
          'consume',
          newBalance,
          description || `${opLabel}${modelInfo} 扣除 ${cost} 积分`,
          `${operation}${modelInfo}`
        );
      } catch { /* history recording is non-critical */ }
    }

    return { success: true, balance: newBalance, cost };
  } catch (e) {
    console.error('[credits] consumeCredits error:', e);
    // If credits system fails, we cannot verify balance — reject the operation
    // to prevent unauthorized free usage when the database is down.
    // Admin can set MANDATORY_API_AUTH=false to bypass this in emergencies.
    return { success: false, balance: 0, cost, message: '积分系统暂时不可用，请稍后重试' };
  }
}

/**
 * Check if a user has enough credits for an operation without deducting
 */
export async function checkCredits(
  userId: string,
  operation: CreditOperation | string,
  customAmount?: number,
  model?: string,
  options?: { quality?: string; resolution?: string; durationSeconds?: number; providerId?: string }
): Promise<{ sufficient: boolean; balance: number; cost: number }> {
  const cost = customAmount ?? await calculateConfiguredCreditCost(operation, model, options);
  if (cost <= 0) return { sufficient: true, balance: 0, cost: 0 };

  try {
    let credits = await dbGetCredits(userId);
    if (!credits) {
      credits = await dbInitCredits(userId);
    }
    const balance = credits?.balance ?? 0;
    return { sufficient: balance >= cost, balance, cost };
  } catch (e) {
    console.error('[credits] checkCredits error:', e);
    return { sufficient: true, balance: 0, cost };
  }
}

/**
 * Refund credits for a failed or cancelled operation.
 * This is the counterpart to consumeCredits — should be called when:
 * 1. The AI provider returns an error (generation failed)
 * 2. The task is cancelled before completion
 * 3. The result is empty/invalid
 *
 * Uses atomic SQL UPDATE to avoid race conditions.
 */
export async function refundCredits(
  userId: string,
  amount: number,
  reason: string,
  referenceId?: string
): Promise<{ success: boolean; balance: number }> {
  if (amount <= 0) return { success: true, balance: 0 };

  try {
    const { execSql } = await import('@/lib/db-client');
    const now = Date.now();
    const refundTxId = 'ctx_' + now + '_' + Math.random().toString(36).substring(2, 10);

    // 事务保护：UPDATE balance + INSERT transaction record 在同一事务中
    // 如果事务记录插入失败，余额更新也会回滚，保证数据一致性
    const refundResult = await execSql(
      `BEGIN;
       UPDATE wujie_credits 
       SET balance = balance + $1, 
           total_used = GREATEST(total_used - $2, 0),
           updated_at = $3 
       WHERE user_id = $4 
       RETURNING balance;
       INSERT INTO wujie_credit_transactions (id, user_id, amount, type, balance_after, description, reference_id, created_at)
       VALUES ($7, $4, $1, 'refund', (SELECT balance FROM wujie_credits WHERE user_id = $4), $5, $6, $3);
       COMMIT;`,
      [amount, amount, now, userId, reason, referenceId || null, refundTxId]
    );

    if (!refundResult || !refundResult.rows || refundResult.rows.length === 0) {
      // 可能BEGIN/COMMIT不支持多语句，尝试单语句模式
      try {
        const singleResult = await execSql(
          `UPDATE wujie_credits 
           SET balance = balance + $1, 
               total_used = GREATEST(total_used - $2, 0),
               updated_at = $3 
           WHERE user_id = $4 
           RETURNING balance`,
          [amount, amount, now, userId]
        );
        if (singleResult && singleResult.rows && singleResult.rows.length > 0) {
          const newBalance = Number(singleResult.rows[0].balance);
          // 记录退款事务（非关键，失败不影响退款）
          try {
            await dbRecordCreditTransaction(userId, amount, 'refund', newBalance, reason, referenceId);
          } catch { /* non-critical */ }
          return { success: true, balance: newBalance };
        }
      } catch { /* fallback also failed */ }
      
      console.error('[credits] refundCredits: user not found or update failed', userId);
      return { success: false, balance: 0 };
    }

    const newBalance = Number(refundResult.rows[0].balance);
    return { success: true, balance: newBalance };
  } catch (e) {
    console.error('[credits] refundCredits error:', e);
    return { success: false, balance: 0 };
  }
}

/**
 * Format credits as CNY amount string
 */
export function creditsToCNY(credits: number): string {
  return `¥${(credits * CREDITS_TO_CNY).toFixed(2)}`;
}

/**
 * Get model display info for frontend pricing display
 */
export function getModelPricingInfo(model: string, type: 'image' | 'video' | 'chat'): { credits: number; label: string; cny: string } | null {
  if (type === 'image') {
    const info = IMAGE_MODEL_CREDITS[model];
    if (info) return { credits: info.credits, label: info.label, cny: creditsToCNY(info.credits) };
  } else if (type === 'video') {
    const info = VIDEO_MODEL_CREDITS[model];
    if (info) return { credits: info.creditsPerSecond * 5, label: info.label, cny: creditsToCNY(info.creditsPerSecond * 5) + '/5秒' };
  } else if (type === 'chat') {
    const info = CHAT_MODEL_CREDITS[model];
    if (info) return { credits: info.creditsPerCall, label: info.label, cny: creditsToCNY(info.creditsPerCall) + '/次' };
  }
  return null;
}
