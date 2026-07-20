/**
 * Credits (积分) 纯常量定义
 * 此文件不依赖任何服务端模块（db-storage等），可安全在客户端组件中导入
 */

// ========== 积分与金额换算 ==========
export const CREDITS_TO_CNY = 0.01; // 1积分 = ¥0.01
export const CNY_TO_CREDITS = 100;   // ¥1 = 100积分

// ========== 图像模型积分消耗（基于官方API定价） ==========
export const IMAGE_MODEL_CREDITS: Record<string, { credits: number; label: string; quality?: Record<string, number>; resolution?: Record<string, number> }> = {
  // --- OpenAI ---
  'dall-e-3': {
    credits: 28, // ¥0.28/张 (standard 1024px)
    label: 'DALL-E 3',
    quality: { standard: 28, hd: 56 }, // HD ¥0.56/张
    resolution: { '1K': 28, '2K': 56, '4K': 112 },
  },
  'gpt-image-2': {
    credits: 60, // ¥0.40-1.00/张，取中间值
    label: 'GPT Image 2',
    quality: { low: 40, medium: 60, high: 100 },
    resolution: { '1K': 60, '2K': 120, '4K': 240 },
  },
  'gpt-image-2-c': {
    credits: 40,
    label: 'GPT Image 2C',
    quality: { low: 30, medium: 40, high: 70 },
    resolution: { '1K': 40, '2K': 80, '4K': 160 },
  },
  'gpt-image-1.5': {
    credits: 35,
    label: 'GPT Image 1.5',
    quality: { low: 10, medium: 35, high: 100 },
    resolution: { '1K': 35, '2K': 70, '4K': 140 },
  },

  // --- 豆包/字节跳动 Seedream ---
  'seedream-3-0': {
    credits: 6, // ¥0.04-0.06/张
    label: 'Seedream 3.0',
    quality: { standard: 6, hd: 10 },
    resolution: { '1K': 6, '2K': 12, '4K': 24 },
  },
  'seedream-3-0-lite': {
    credits: 3, // ¥0.02-0.03/张
    label: 'Seedream 3.0 Lite',
    resolution: { '1K': 3, '2K': 6, '4K': 12 },
  },
  'doubao-seedream-3-0': {
    credits: 6,
    label: '豆包 Seedream 3.0',
    quality: { standard: 6, hd: 10 },
    resolution: { '1K': 6, '2K': 12, '4K': 24 },
  },
  'doubao-seedream-3-0-lite': {
    credits: 3,
    label: '豆包 Seedream 3.0 Lite',
    resolution: { '1K': 3, '2K': 6, '4K': 12 },
  },
  'seedream-4-5': {
    credits: 30, // Reference cost: Volcengine Ark public pricing, with platform margin.
    label: 'Seedream 4.5',
    quality: { standard: 30, hd: 45 },
    resolution: { '1K': 30, '2K': 60, '4K': 120 },
  },
  'doubao-seedream-4-5': {
    credits: 30,
    label: '豆包 Seedream 4.5',
    quality: { standard: 30, hd: 45 },
    resolution: { '1K': 30, '2K': 60, '4K': 120 },
  },
  'seedream-5-lite': {
    credits: 28,
    label: 'Seedream 5 Lite',
    resolution: { '1K': 28, '2K': 56, '4K': 112 },
  },

  // --- 快手可灵 ---
  'kling-v3': {
    credits: 15, // ¥0.10-0.15/张
    label: '可灵 V3',
    quality: { standard: 15, hd: 25 },
    resolution: { '1K': 15, '2K': 30, '4K': 60 },
  },
  'kling-v3-omni': {
    credits: 15,
    label: '可灵 V3 Omni',
    quality: { standard: 15, hd: 25 },
    resolution: { '1K': 15, '2K': 30, '4K': 60 },
  },

  // --- Google Gemini ---
  'gemini-2.5-flash-image': {
    credits: 40,
    label: 'Gemini Flash 图片',
    resolution: { '1K': 40, '2K': 80, '4K': 160 },
  },
  'gemini-3-pro-image-preview': {
    credits: 140,
    label: 'Gemini Pro 图片',
    quality: { standard: 140, hd: 250 },
    resolution: { '1K': 140, '2K': 280, '4K': 560 },
  },
  'gemini-3.1-flash-image-preview': {
    credits: 70,
    label: 'Gemini 3.1 Flash 图片',
    quality: { standard: 70, hd: 160 },
    resolution: { '1K': 70, '2K': 140, '4K': 280 },
  },
  'nano-banana': {
    credits: 40,
    label: 'Nano Banana',
    resolution: { '1K': 40, '2K': 80, '4K': 160 },
  },
  'nano-banana-pro': {
    credits: 140,
    label: 'Nano Banana Pro',
    resolution: { '1K': 140, '2K': 280, '4K': 560 },
  },
  'nano-banana-2': {
    credits: 70,
    label: 'Nano Banana 2',
    resolution: { '1K': 70, '2K': 140, '4K': 280 },
  },

  // --- Midjourney ---
  'midjourney': {
    credits: 35, // ¥0.30-0.40/张 (Basic套餐约$0.05/张)
    label: 'Midjourney',
    quality: { standard: 35, hd: 50 },
    resolution: { '1K': 35, '2K': 70, '4K': 140 },
  },

  // --- Flux ---
  'flux-pro': {
    credits: 30, // ¥0.25-0.35/张
    label: 'Flux Pro',
    resolution: { '1K': 30, '2K': 60, '4K': 120 },
  },
  'flux-1.1-pro': {
    credits: 30,
    label: 'Flux 1.1 Pro',
    resolution: { '1K': 30, '2K': 60, '4K': 120 },
  },
  'flux-schnell': {
    credits: 4, // 快速模型很便宜
    label: 'Flux Schnell',
    resolution: { '1K': 4, '2K': 8, '4K': 16 },
  },

  // --- Ideogram ---
  'ideogram': {
    credits: 6, // ¥0.04-0.06/张
    label: 'Ideogram',
    resolution: { '1K': 6, '2K': 12, '4K': 24 },
  },

  // --- Stable Diffusion ---
  'stable-diffusion-xl': {
    credits: 2, // 开源模型极低
    label: 'SD XL',
    resolution: { '1K': 2, '2K': 4, '4K': 8 },
  },
  'stable-diffusion-3': {
    credits: 2,
    label: 'SD 3',
    resolution: { '1K': 2, '2K': 4, '4K': 8 },
  },
  'sdxl': {
    credits: 2,
    label: 'SDXL',
    resolution: { '1K': 2, '2K': 4, '4K': 8 },
  },

  // --- HiDream ---
  'hidream': {
    credits: 8,
    label: 'HiDream',
    resolution: { '1K': 8, '2K': 16, '4K': 32 },
  },

  // --- 通义万相 ---
  'wanx-v3': {
    credits: 6,
    label: '通义万相 V3',
    resolution: { '1K': 6, '2K': 12, '4K': 24 },
  },
  'wanx-v2': {
    credits: 4,
    label: '通义万相 V2',
    resolution: { '1K': 4, '2K': 8, '4K': 16 },
  },
};

// ========== 视频模型积分消耗（基于官方API定价） ==========
export const VIDEO_MODEL_CREDITS: Record<string, { creditsPerSecond: number; label: string; minDuration?: number }> = {
  // --- 可灵 (快手) ---
  'kling-v3': {
    creditsPerSecond: 30,
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
    creditsPerSecond: 50,
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
    creditsPerSecond: 80,
    label: 'Sora',
    minDuration: 5,
  },
  'sora-2': {
    creditsPerSecond: 100,
    label: 'Sora 2',
    minDuration: 5,
  },

  // --- Veo (Google) ---
  'veo-3': {
    creditsPerSecond: 150,
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
    creditsPerSecond: 60,
    label: 'Runway Gen-3',
    minDuration: 5,
  },
  'runway-gen-4': {
    creditsPerSecond: 90,
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
    creditsPerCall: 8,
    label: 'GPT-4o',
  },
  'gpt-4o-mini': {
    creditsPerCall: 2,
    label: 'GPT-4o Mini',
  },
  'gpt-4.1': {
    creditsPerCall: 12,
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
    creditsPerCall: 30,
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
    creditsPerCall: 2,
    label: 'Gemini 2.5 Flash',
  },
  'gemini-2.5-pro': {
    creditsPerCall: 15,
    label: 'Gemini 2.5 Pro',
  },
  'gemini-3-pro': {
    creditsPerCall: 20,
    label: 'Gemini 3 Pro',
  },

  // --- DeepSeek ---
  'deepseek-chat': {
    creditsPerCall: 2,
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
  image_edit: { credits: 15, label: '图像编辑' },
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
