/**
 * 供应商价格表：积分 = 供应商价格（人民币）× 1.01，按 1 积分 = ¥0.01 向上取整。
 *
 * 价格来源（2026-11-16 读取）：
 * - Pear：GET https://api.pearapi.ai/api/pricing 的 model_price（人民币；图片按张，视频按秒，
 *   seedance-1.x-pro 为固定时长按条）。
 * - APIMart：GET https://api.apib.ai/api/pricing/model?model=<id> 的实付价
 *   （paid_price / resolution_paid_prices，美元），按 /api/status 的 usd_exchange_rate 7.3 换算。
 *   按 token 计费的模型使用平台公布的预扣单价。
 * 键为 `${供应商族}::${模型 id 小写}`，供应商族见 classifyProviderCapabilityFamily。
 */
import { CNY_TO_CREDITS } from './credits-constants';

export const VENDOR_PRICE_MARKUP = 1.01;
export const APIMART_USD_TO_CNY = 7.3;

export interface VendorPrice {
  currency: 'CNY' | 'USD';
  /** call：每次调用（每张图 / 每条视频）；second：视频每秒。 */
  unit: 'call' | 'second';
  price: number;
  /** 按清晰度的价格（键为大写，如 1K、720P）。 */
  tiers?: Readonly<Record<string, number>>;
  /** 无界清晰度到供应商价格档的映射（如 Flux 的 1MP/4MP）。 */
  tierAliases?: Readonly<Record<string, string>>;
  /** 开启声音（generate_audio / audio）时的按清晰度价格。 */
  audioTiers?: Readonly<Record<string, number>>;
}

type Extra = Pick<VendorPrice, 'tiers' | 'tierAliases' | 'audioTiers'>;
const usd = (unit: VendorPrice['unit'], price: number, extra: Extra = {}): VendorPrice => ({ currency: 'USD', unit, price, ...extra });
const cny = (unit: VendorPrice['unit'], price: number, extra: Extra = {}): VendorPrice => ({ currency: 'CNY', unit, price, ...extra });

export const VENDOR_PRICES: Readonly<Record<string, VendorPrice>> = {
  'apib::minimax-hailuo-02': usd('second', 0.04, { tiers: { '512P': 0.0104, '768P': 0.04, '1080P': 0.08 } }),
  'apib::flux-2-flex': usd('call', 0.04, { tiers: { '1MP': 0.04, '2MP': 0.08, '3MP': 0.12, '4MP': 0.16 }, tierAliases: { '1K': '1MP', '2K': '4MP', '4K': '4MP' } }),
  'apib::flux-2-max': usd('call', 0.08, { tiers: { '1MP': 0.056, '2MP': 0.08, '3MP': 0.104, '4MP': 0.128 }, tierAliases: { '1K': '1MP', '2K': '4MP', '4K': '4MP' } }),
  'apib::flux-2-pro': usd('call', 0.024, { tiers: { '1MP': 0.024, '2MP': 0.036, '3MP': 0.048, '4MP': 0.06 }, tierAliases: { '1K': '1MP', '2K': '4MP', '4K': '4MP' } }),
  'apib::flux-3-image': usd('call', 0.0384, { tiers: { '1K': 0.0384, '2K': 0.08, '4K': 0.4856, '1.5K': 0.056, '768SQ': 0.0328 } }),
  'apib::flux-3-image-klein': usd('call', 0.0072, { tiers: { '1K': 0.0072, '2K': 0.0112, '4K': 0.0288, '1.5K': 0.0088, '768SQ': 0.0064 } }),
  'apib::flux-kontext-max': usd('call', 0.064),
  'apib::flux-kontext-pro': usd('call', 0.032),
  'apib::gemini-2.5-flash-image-preview': usd('call', 0.008),
  'apib::gemini-2.5-flash-image-preview-official': usd('call', 0.0312),
  'apib::gemini-3-pro-image-preview': usd('call', 0.02, { tiers: { '4K': 0.03 } }),
  'apib::gemini-3-pro-image-preview-official': usd('call', 0.1072, { tiers: { '4K': 0.192 } }),
  'apib::gemini-3.1-flash-image-preview': usd('call', 0.015, { tiers: { '0.5K': 0.015, '1K': 0.012, '2K': 0.014, '4K': 0.018 } }),
  'apib::gemini-3.1-flash-image-preview-official': usd('call', 0.0536, { tiers: { '0.5K': 0.0536, '1K': 0.0536, '2K': 0.0808, '4K': 0.1208 } }),
  'apib::gemini-3.1-flash-lite-image': usd('call', 0.032),
  'apib::gemini-3.1-flash-lite-image-ext': usd('call', 0.008),
  'apib::gemini-nano-banana-2.1': usd('call', 0.02688, { tiers: { '1K': 0.02688, '2K': 0.04032, '4K': 0.09072 } }),
  'apib::gemini-nano-banana-2.1-ext': usd('call', 0.02, { tiers: { '1K': 0.012, '2K': 0.014, '4K': 0.018 } }),
  'apib::gemini-omni-flash-preview': usd('second', 0.088, { tiers: { '720P': 0.088 } }),
  'apib::gpt-image-1-official': usd('call', 0.16, { tiers: { '1K': 0.16 } }),
  'apib::gpt-image-1.5-official': usd('call', 0.128, { tiers: { '1K': 0.128 } }),
  'apib::gpt-image-2': usd('call', 0.0085, { tiers: { '1K': 0.0085, '2K': 0.015, '4K': 0.022 } }),
  'apib::gpt-image-2-ext': usd('call', 0.0085, { tiers: { '1K': 0.0085, '2K': 0.015, '4K': 0.022 } }),
  'apib::gpt-image-2-official': usd('call', 0.16872),
  'apib::gpt-image-2.5-ext': usd('call', 0.0085, { tiers: { '1K': 0.0085, '2K': 0.03, '4K': 0.04 } }),
  'apib::gpt-image-2.5-flare': usd('call', 0.168576, { tiers: { '1K': 0.168576, '2K': 0.342528, '4K': 0.569256 } }),
  'apib::gpt-image-2.5-sunburst': usd('call', 0.168576, { tiers: { '1K': 0.168576, '2K': 0.342528, '4K': 0.569256 } }),
  'apib::gpt-image-2.6-ext': usd('call', 0.0085, { tiers: { '1K': 0.0085, '2K': 0.03, '4K': 0.04 } }),
  'apib::gpt-image-2.6-flare': usd('call', 0.168576, { tiers: { '1K': 0.168576, '2K': 0.342528, '4K': 0.569256 } }),
  'apib::gpt-image-2.6-sunburst': usd('call', 0.168576, { tiers: { '1K': 0.168576, '2K': 0.342528, '4K': 0.569256 } }),
  'apib::grok-imagine-1.5-apimart': usd('call', 0.015),
  'apib::grok-imagine-1.5-ext': usd('call', 0.015),
  'apib::grok-imagine-1.5-video-apimart': usd('second', 0.01912, { tiers: { '480P': 0.0102, '720P': 0.01912 } }),
  'apib::grok-imagine-2.0-ext': usd('call', 0.015),
  'apib::grok-imagine-image': usd('call', 0.016, { tiers: { '1K': 0.016, '2K': 0.016 } }),
  'apib::grok-imagine-image-2.0': usd('call', 0.048, { tiers: { '1K': 0.048, '2K': 0.064 } }),
  'apib::grok-imagine-image-quality': usd('call', 0.04, { tiers: { '1K': 0.04, '2K': 0.056 } }),
  'apib::hy-image-v3.5-preview': usd('call', 0.0192, { tiers: { '1K': 0.0192, '2K': 0.0192, '4K': 0.0256 } }),
  'apib::imagen-4.0-apimart': usd('call', 0.04),
  'apib::kling-3.0-turbo': usd('second', 0.1144, { tiers: { '720P': 0.1144, '1080P': 0.1432 } }),
  // billing_tier_paid_prices：std=默认 $0.0672、sound $0.0896、pro $0.0896、pro-sound $0.112、4k / 4k-sound $0.42856；
  // 请求按 720p→std、1080p→pro、4k→4k 发送 mode
  'apib::kling-v3-omni': usd('second', 0.0672, {
    tiers: { '720P': 0.0672, '1080P': 0.0896, '4K': 0.42856 },
    audioTiers: { '720P': 0.0896, '1080P': 0.112, '4K': 0.42856 },
    tierAliases: { '1K': '720P', '2K': '1080P' },
  }),
  'apib::mai-image-2.6': usd('call', 0.032, { tiers: { '1K': 0.032, '2K': 0.072 } }),
  'apib::mai-image-2.6-flash': usd('call', 0.016, { tiers: { '1K': 0.016, '2K': 0.036 } }),
  'apib::minimax-h3-image': usd('call', 0.08, { tiers: { '1K': 0.024, '2K': 0.024, '4K': 0.08 } }),
  'apib::minimax-h3-image-highspeed': usd('call', 0.152, { tiers: { '1K': 0.04, '2K': 0.04, '4K': 0.152 } }),
  'apib::muse-image-ext': usd('call', 0.0048),
  'apib::nano-banana': usd('call', 0.0312),
  'apib::nano-banana-2': usd('call', 0.0536, { tiers: { '0.5K': 0.0536, '1K': 0.0536, '2K': 0.0808, '4K': 0.1208 } }),
  'apib::nano-banana-2-ext': usd('call', 0.015, { tiers: { '0.5K': 0.015, '1K': 0.012, '2K': 0.014, '4K': 0.018 } }),
  'apib::nano-banana-2-lite': usd('call', 0.032),
  'apib::nano-banana-2-lite-ext': usd('call', 0.008),
  'apib::nano-banana-ext': usd('call', 0.008),
  'apib::nano-banana-pro': usd('call', 0.1072, { tiers: { '4K': 0.192 } }),
  'apib::nano-banana-pro-ext': usd('call', 0.02, { tiers: { '4K': 0.03 } }),
  'apib::qwen-image-2.0': usd('call', 0.02),
  'apib::qwen-image-2.0-pro': usd('call', 0.05),
  'apib::qwen-image-3.0': usd('call', 0.0205712, { tiers: { '1K': 0.0205712, '2K': 0.0205712 } }),
  'apib::qwen-image-3.0-pro': usd('call', 0.0285712, { tiers: { '1K': 0.0285712, '2K': 0.0571432 } }),
  'apib::seedance-2.0': usd('second', 0.142, { tiers: { '480P': 0.066, '720P': 0.142, '1080P': 0.3544, '4K': 0.722 } }),
  'apib::seedance-2.0-face': usd('second', 0.2136, { tiers: { '480P': 0.0992, '720P': 0.2136, '1080P': 0.5 } }),
  'apib::seedance-2.0-fast': usd('second', 0.0856, { tiers: { '480P': 0.03984, '720P': 0.0856 } }),
  'apib::seedance-2.0-fast-face': usd('second', 0.172, { tiers: { '480P': 0.08, '720P': 0.172 } }),
  'apib::seedance-2.0-mini': usd('second', 0.0390344, { tiers: { '480P': 0.0181512, '720P': 0.0390344 } }),
  'apib::seedance-2.5': usd('second', 0.216, { tiers: { '480P': 0.09608, '720P': 0.216, '1080P': 0.5346 } }),
  // 文档：seedream-4.0 与 seedream-4-0 是同一模型；官网价格表只列 seedream-4-0（$0.0195），
  // 价格接口对 seedream-4.0 这个别名返回的 $0.8 与官网不符，按官网计价
  'apib::seedream-4.0': usd('call', 0.0195),
  'apib::seedream-4.5': usd('call', 0.026),
  'apib::seedream-5-0-flash': usd('call', 0.0137144),
  'apib::seedream-5-0-lite': usd('call', 0.028),
  'apib::seedream-5-0-pro': usd('call', 0.036, { tiers: { '1K': 0.02925, '2K': 0.0585, '1.5K': 0.02925 } }),
  'apib::seedream-5-5': usd('call', 0.02275, { tiers: { '1K': 0.013, '2K': 0.02275, '1.5K': 0.013 } }),
  'apib::veo3.1-fast': usd('call', 0.14, { tiers: { '4K': 0.64 } }),
  'apib::veo3.1-lite': usd('call', 0.07, { tiers: { '4K': 0.57 } }),
  'apib::veo3.1-quality': usd('call', 1, { tiers: { '4K': 1.5 } }),
  'apib::wan2.5-preview': usd('second', 0.0664, { tiers: { '480P': 0.0336, '720P': 0.0664, '1080P': 0.1096 } }),
  'apib::wan2.7-image': usd('call', 0.0216),
  'apib::wan2.7-image-pro': usd('call', 0.0544),
  'apib::z-image-turbo': usd('call', 0.01),
  'pear::boogu-image-0.1': cny('call', 0.1),
  'pear::doubao-seedance-2-0-260128': cny('second', 0.32),
  'pear::doubao-seedance-2-0-fast-260128': cny('second', 0.26),
  'pear::doubao-seedance-2-0-mini-260615': cny('second', 0.4),
  'pear::doubao-seedance-2-5-260628': cny('second', 0.5),
  'pear::doubao-seedream-4-0-250828': cny('call', 0.09),
  'pear::doubao-seedream-4-5-251128': cny('call', 0.1125),
  'pear::doubao-seedream-5-0-260128': cny('call', 0.099),
  'pear::doubao-seedream-5-0-pro-260628': cny('call', 0.135),
  'pear::firered-image-edit1.1': cny('call', 0.1),
  'pear::flux2-klein-9b': cny('call', 0.007),
  'pear::gpt-image-2': cny('call', 0.032),
  'pear::gpt-image-2.5': cny('call', 0.032),
  'pear::gpt-image-2.5-flare': cny('call', 0.032),
  'pear::gpt-image-2.5-sunburst': cny('call', 0.032),
  'pear::gpt-image-2.6': cny('call', 0.032),
  'pear::gpt-image-2.6-flare': cny('call', 0.032),
  'pear::gpt-image-2.6-sunburst': cny('call', 0.032),
  'pear::grok-imagine-image-2.0': cny('call', 0.12),
  'pear::hailuo-2.3': cny('second', 0.06),
  'pear::happyhorse-1.0': cny('second', 0.56),
  'pear::image-layered': cny('call', 0.3),
  // 模型广场：768P ¥0.2/秒，2K ¥0.29/秒
  'pear::minimax-h3': cny('second', 0.2, { tiers: { '768P': 0.2, '2K': 0.29 } }),
  'pear::nano-banana': cny('call', 0.08),
  'pear::nano-banana-2': cny('call', 0.1),
  'pear::nano-banana-2-lite': cny('call', 0.06),
  'pear::nano-banana-2.1': cny('call', 0.08),
  'pear::nano-banana-pro': cny('call', 0.14),
  'pear::real-esrgan': cny('call', 0.015),
  'pear::rmbg-2.0': cny('call', 0.02),
  'pear::seedance-1.0-pro': cny('call', 1.52),
  'pear::seedance-1.5-pro': cny('call', 1.93),
  'pear::seedvr2-upscaler': cny('call', 0.15),
  'pear::wan2.7-image': cny('call', 0.2),
  'pear::z-image': cny('call', 0.07),
};

export function getVendorPrice(family: string, modelId: string): VendorPrice | undefined {
  const key = `${family}::${modelId.trim().toLowerCase()}`;
  return Object.hasOwn(VENDOR_PRICES, key) ? VENDOR_PRICES[key] : undefined;
}

function tierPrice(entry: VendorPrice, resolution: string | undefined, audio: boolean): number {
  const tier = resolution?.trim().toUpperCase();
  const key = tier ? entry.tierAliases?.[tier] ?? tier : undefined;
  if (audio && entry.audioTiers) {
    // 未指定清晰度时取默认档（与 price 同价的档位）的有声价格
    const defaultTier = Object.entries(entry.tiers ?? {}).find(([, value]) => value === entry.price)?.[0];
    const audioKey = key ?? defaultTier;
    return (audioKey ? entry.audioTiers[audioKey] : undefined) ?? Math.max(...Object.values(entry.audioTiers));
  }
  if (!key || !entry.tiers) return entry.price;
  return entry.tiers[key] ?? entry.price;
}

/**
 * 一次调用的积分：按秒计价时乘以时长（默认 5 秒），总价 × 1.01 后向上取整，最低 1 积分。
 */
export function vendorCreditCost(
  entry: VendorPrice,
  options: { resolution?: string; durationSeconds?: number; audio?: boolean } = {},
): number {
  const unitPrice = tierPrice(entry, options.resolution, options.audio === true);
  const units = entry.unit === 'second' ? Math.max(1, options.durationSeconds || 5) : 1;
  const cnyPrice = unitPrice * units * (entry.currency === 'USD' ? APIMART_USD_TO_CNY : 1);
  // toFixed 去掉浮点误差，避免 1.01 × 100 这类整数结果被多进一位
  const credits = Number((cnyPrice * VENDOR_PRICE_MARKUP * CNY_TO_CREDITS).toFixed(6));
  return Math.max(1, Math.ceil(credits));
}
