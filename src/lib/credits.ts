/**
 * Credits (积分) helper for server-side API routes
 * Handles credit deduction for AI generation operations
 * 
 * 积分定价体系：1积分 = ¥0.01
 * 不同模型根据实际API成本扣除不同积分
 */

import { dbGetCredits, dbAdjustCredits, dbInitCredits } from './db-storage';

// ========== 积分与金额换算 ==========
export const CREDITS_TO_CNY = 0.01; // 1积分 = ¥0.01
export const CNY_TO_CREDITS = 100;   // ¥1 = 100积分

// ========== 图像模型积分消耗（基于官方API定价） ==========
// 定价来源：各供应商官网 2025-2026 年公开价格
export const IMAGE_MODEL_CREDITS: Record<string, { credits: number; label: string; quality?: Record<string, number> }> = {
  // --- OpenAI ---
  'dall-e-3': {
    credits: 28, // ¥0.28/张 (standard 1024px)
    label: 'DALL-E 3',
    quality: { standard: 28, hd: 56 }, // HD ¥0.56/张
  },
  'gpt-image-2': {
    credits: 60, // ¥0.40-1.00/张，取中间值
    label: 'GPT Image 2',
    quality: { low: 40, medium: 60, high: 100 },
  },
  'gpt-image-2-c': {
    credits: 40,
    label: 'GPT Image 2C',
    quality: { low: 30, medium: 40, high: 70 },
  },

  // --- 豆包/字节跳动 Seedream ---
  'seedream-3-0': {
    credits: 6, // ¥0.04-0.06/张
    label: 'Seedream 3.0',
    quality: { standard: 6, hd: 10 },
  },
  'seedream-3-0-lite': {
    credits: 3, // ¥0.02-0.03/张
    label: 'Seedream 3.0 Lite',
  },
  'doubao-seedream-3-0': {
    credits: 6,
    label: '豆包 Seedream 3.0',
    quality: { standard: 6, hd: 10 },
  },
  'doubao-seedream-3-0-lite': {
    credits: 3,
    label: '豆包 Seedream 3.0 Lite',
  },
  'seedream-4-5': {
    credits: 10, // ¥0.06-0.10/张
    label: 'Seedream 4.5',
    quality: { standard: 10, hd: 16 },
  },
  'doubao-seedream-4-5': {
    credits: 10,
    label: '豆包 Seedream 4.5',
    quality: { standard: 10, hd: 16 },
  },

  // --- 快手可灵 ---
  'kling-v3': {
    credits: 15, // ¥0.10-0.15/张
    label: '可灵 V3',
    quality: { standard: 15, hd: 25 },
  },
  'kling-v3-omni': {
    credits: 15,
    label: '可灵 V3 Omni',
    quality: { standard: 15, hd: 25 },
  },

  // --- Google Gemini ---
  'gemini-2.5-flash-image': {
    credits: 4, // Flash级别定价很低
    label: 'Gemini Flash 图片',
  },
  'gemini-3-pro-image-preview': {
    credits: 20, // Pro级别
    label: 'Gemini Pro 图片',
  },
  'gemini-3.1-flash-image-preview': {
    credits: 6,
    label: 'Gemini 3.1 Flash 图片',
  },
  'nano-banana': {
    credits: 4,
    label: 'Nano Banana',
  },
  'nano-banana-pro': {
    credits: 20,
    label: 'Nano Banana Pro',
  },
  'nano-banana-2': {
    credits: 6,
    label: 'Nano Banana 2',
  },

  // --- Midjourney ---
  'midjourney': {
    credits: 35, // ¥0.30-0.40/张 (Basic套餐约$0.05/张)
    label: 'Midjourney',
    quality: { standard: 35, hd: 50 },
  },

  // --- Flux ---
  'flux-pro': {
    credits: 30, // ¥0.25-0.35/张
    label: 'Flux Pro',
  },
  'flux-1.1-pro': {
    credits: 30,
    label: 'Flux 1.1 Pro',
  },
  'flux-schnell': {
    credits: 4, // 快速模型很便宜
    label: 'Flux Schnell',
  },

  // --- Ideogram ---
  'ideogram': {
    credits: 6, // ¥0.04-0.06/张
    label: 'Ideogram',
  },

  // --- Stable Diffusion ---
  'stable-diffusion-xl': {
    credits: 2, // 开源模型极低
    label: 'SD XL',
  },
  'stable-diffusion-3': {
    credits: 2,
    label: 'SD 3',
  },
  'sdxl': {
    credits: 2,
    label: 'SDXL',
  },

  // --- HiDream ---
  'hidream': {
    credits: 8,
    label: 'HiDream',
  },

  // --- 通义万相 ---
  'wanx-v3': {
    credits: 6,
    label: '通义万相 V3',
  },
  'wanx-v2': {
    credits: 4,
    label: '通义万相 V2',
  },
};

// ========== 视频模型积分消耗（基于官方API定价） ==========
export const VIDEO_MODEL_CREDITS: Record<string, { creditsPerSecond: number; label: string; minDuration?: number }> = {
  // --- 可灵 (快手) ---
  'kling-v3': {
    creditsPerSecond: 30, // ¥0.21/秒 ≈ 21积分/秒, 取整30
    label: '可灵 V3',
    minDuration: 5,
  },
  'kling-v3-omni': {
    creditsPerSecond: 30,
    label: '可灵 V3 Omni',
    minDuration: 5,
  },
  'kling-v2': {
    creditsPerSecond: 20,
    label: '可灵 V2',
    minDuration: 5,
  },
  'kling-v1-5': {
    creditsPerSecond: 15,
    label: '可灵 V1.5',
    minDuration: 5,
  },
  'kling-v1': {
    creditsPerSecond: 10,
    label: '可灵 V1',
    minDuration: 5,
  },

  // --- Seedance (字节跳动) ---
  'seedance-2.0': {
    creditsPerSecond: 50, // ¥0.50/秒 ≈ 50积分/秒 (第三方API价格范围)
    label: 'Seedance 2.0',
    minDuration: 5,
  },
  'seedance-2.3': {
    creditsPerSecond: 60,
    label: 'Seedance 2.3',
    minDuration: 5,
  },
  'doubao-seedance-2.0': {
    creditsPerSecond: 50,
    label: '豆包 Seedance 2.0',
    minDuration: 5,
  },
  'doubao-seedance-2.3': {
    creditsPerSecond: 60,
    label: '豆包 Seedance 2.3',
    minDuration: 5,
  },

  // --- Sora (OpenAI) ---
  'sora': {
    creditsPerSecond: 80, // ¥0.50-1.00/秒
    label: 'Sora',
    minDuration: 5,
  },
  'sora-2': {
    creditsPerSecond: 100, // ¥0.72-3.60/秒
    label: 'Sora 2',
    minDuration: 5,
  },

  // --- Veo (Google) ---
  'veo-3': {
    creditsPerSecond: 150, // ¥5.40/秒 = 540积分/秒 (最贵)
    label: 'Veo 3',
    minDuration: 5,
  },
  'veo-3.1': {
    creditsPerSecond: 180,
    label: 'Veo 3.1',
    minDuration: 5,
  },
  'veo-2': {
    creditsPerSecond: 100,
    label: 'Veo 2',
    minDuration: 5,
  },

  // --- Runway ---
  'runway-gen-3': {
    creditsPerSecond: 60, // 订阅制折算
    label: 'Runway Gen-3',
    minDuration: 5,
  },
  'runway-gen-4': {
    creditsPerSecond: 90, // Gen-4 更贵
    label: 'Runway Gen-4',
    minDuration: 5,
  },

  // --- Vidu ---
  'vidu-q1': {
    creditsPerSecond: 25,
    label: 'Vidu Q1',
    minDuration: 4,
  },
  'vidu-q2': {
    creditsPerSecond: 40,
    label: 'Vidu Q2',
    minDuration: 4,
  },

  // --- Pika ---
  'pika': {
    creditsPerSecond: 50,
    label: 'Pika',
    minDuration: 3,
  },

  // --- Luma Dream Machine ---
  'luma-dream-machine': {
    creditsPerSecond: 40,
    label: 'Luma Dream Machine',
    minDuration: 5,
  },

  // --- 海螺AI (MiniMax) ---
  'hailuo-video': {
    creditsPerSecond: 30,
    label: '海螺视频',
    minDuration: 5,
  },
  'minimax-video': {
    creditsPerSecond: 30,
    label: 'MiniMax 视频',
    minDuration: 5,
  },
};

// ========== LLM聊天模型积分消耗 ==========
export const CHAT_MODEL_CREDITS: Record<string, { creditsPerCall: number; label: string }> = {
  // --- OpenAI ---
  'gpt-4o': {
    creditsPerCall: 8, // ~¥0.05-0.08/次
    label: 'GPT-4o',
  },
  'gpt-4o-mini': {
    creditsPerCall: 2, // ~¥0.01-0.02/次
    label: 'GPT-4o Mini',
  },
  'gpt-4.1': {
    creditsPerCall: 12, // ~¥0.08-0.12/次
    label: 'GPT-4.1',
  },
  'gpt-4.1-mini': {
    creditsPerCall: 4,
    label: 'GPT-4.1 Mini',
  },
  'gpt-4.1-nano': {
    creditsPerCall: 1,
    label: 'GPT-4.1 Nano',
  },
  'gpt-4-turbo': {
    creditsPerCall: 10,
    label: 'GPT-4 Turbo',
  },
  'o3': {
    creditsPerCall: 30, // 推理模型较贵
    label: 'o3',
  },
  'o3-mini': {
    creditsPerCall: 10,
    label: 'o3 Mini',
  },
  'o4-mini': {
    creditsPerCall: 12,
    label: 'o4 Mini',
  },

  // --- Google Gemini ---
  'gemini-2.5-flash': {
    creditsPerCall: 2, // Flash很便宜
    label: 'Gemini 2.5 Flash',
  },
  'gemini-2.5-pro': {
    creditsPerCall: 15, // Pro较贵
    label: 'Gemini 2.5 Pro',
  },
  'gemini-3-pro': {
    creditsPerCall: 20,
    label: 'Gemini 3 Pro',
  },

  // --- DeepSeek ---
  'deepseek-chat': {
    creditsPerCall: 2, // 非常便宜
    label: 'DeepSeek Chat',
  },
  'deepseek-reasoner': {
    creditsPerCall: 8,
    label: 'DeepSeek Reasoner',
  },

  // --- 通义千问 ---
  'qwen-max': {
    creditsPerCall: 6,
    label: '通义千问 Max',
  },
  'qwen-plus': {
    creditsPerCall: 3,
    label: '通义千问 Plus',
  },
  'qwen-turbo': {
    creditsPerCall: 1,
    label: '通义千问 Turbo',
  },

  // --- Claude ---
  'claude-sonnet-4': {
    creditsPerCall: 15,
    label: 'Claude Sonnet 4',
  },
  'claude-3.5-sonnet': {
    creditsPerCall: 12,
    label: 'Claude 3.5 Sonnet',
  },
  'claude-3.5-haiku': {
    creditsPerCall: 3,
    label: 'Claude 3.5 Haiku',
  },
};

// ========== 其他操作积分消耗（固定价格） ==========
export const OTHER_OPERATION_CREDITS: Record<string, { credits: number; label: string }> = {
  image_edit: { credits: 15, label: '图像编辑' },        // 擦除/蒙版/扩展
  image_upscale: { credits: 8, label: '无损放大' },
  image_remove_bg: { credits: 5, label: '移除背景' },
  image_retouch: { credits: 12, label: '语言修图' },
  vectorize: { credits: 10, label: '矢量化' },
  segment: { credits: 15, label: '元素分层' },
  '3d_model': { credits: 20, label: '3D模型' },
  agent_edit: { credits: 20, label: 'Agent编排' },
  font_design: { credits: 15, label: '字体设计' },
  svg_trace: { credits: 5, label: 'SVG描摹' },
};

// ========== 充值套餐 ==========
export const RECHARGE_PACKAGES: Array<{ amount: number; bonus: number; price: number; label: string; popular?: boolean }> = [
  { amount: 100,  bonus: 0,   price: 1,    label: '100积分' },
  { amount: 500,  bonus: 25,  price: 5,    label: '500+25积分' },
  { amount: 1000, bonus: 100, price: 10,   label: '1000+100积分', popular: true },
  { amount: 5000, bonus: 800, price: 50,   label: '5000+800积分' },
  { amount: 10000, bonus: 2000, price: 100, label: '10000+2000积分' },
  { amount: 50000, bonus: 12000, price: 500, label: '50000+12000积分' },
];

// ========== 查找模型积分消耗 ==========

/**
 * 根据图像模型名称获取积分消耗
 * 支持模糊匹配（包含关键词即可）
 */
export function getImageModelCredits(model: string, quality?: string): number {
  if (!model) return 10; // 默认10积分
  
  // 精确匹配
  const exact = IMAGE_MODEL_CREDITS[model];
  if (exact) {
    if (quality && exact.quality && exact.quality[quality]) {
      return exact.quality[quality];
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
  options?: { quality?: string; durationSeconds?: number }
): number {
  if (operation === 'image_generate') {
    return getImageModelCredits(model || '', options?.quality);
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
  options?: { quality?: string; durationSeconds?: number }
): Promise<{ success: boolean; balance: number; cost: number; message?: string }> {
  const cost = customAmount ?? calculateCreditCost(operation, model, options);
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
        message: `积分不足，需要 ${cost} 积分（≈¥${(cost * CREDITS_TO_CNY).toFixed(2)}），当前余额 ${credits.balance} 积分`,
      };
    }

    const opLabel = getOperationLabel(operation, model);
    const modelInfo = model ? ` [${model}]` : '';

    // Deduct credits
    const result = await dbAdjustCredits(
      userId,
      -cost,
      'consume',
      description || `${opLabel}${modelInfo} 扣除 ${cost} 积分`,
      `${operation}${modelInfo}`
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
 * Check if a user has enough credits for an operation without deducting
 */
export async function checkCredits(
  userId: string,
  operation: CreditOperation | string,
  customAmount?: number,
  model?: string,
  options?: { quality?: string; durationSeconds?: number }
): Promise<{ sufficient: boolean; balance: number; cost: number }> {
  const cost = customAmount ?? calculateCreditCost(operation, model, options);
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
