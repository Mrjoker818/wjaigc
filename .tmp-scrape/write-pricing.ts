/**
 * 一次性脚本：按 PearAPI / APIB 供应商价格写入积分定价配置
 * 换算规则：1 积分 = ¥0.01；APIB 美元价 × 7.2 汇率 → ¥ → ×100 = 积分；四舍五入取整
 * 运行：npx tsx .tmp-scrape/write-pricing.ts
 */
import { saveCreditPricingConfig, loadCreditPricingConfig } from '../src/lib/credit-pricing';

const modelCredits = {
  // ========== PearAPI（¥ × 100） ==========
  // Pear视频 (video, 每秒)
  'api_1781140778520_hmu8s39::seedance-2.0': 62, // PearAPI ¥0.62/秒
  'api_1781140778520_hmu8s39::wan2.7': 60, // PearAPI 无此视频模型，跨参考 APIB $0.083/秒 × 7.2
  // PearAPI 图像 (image, 每张)
  'api_1780630178347_rjqlmam::doubao-seedream-4-0-250828': 14, // ¥0.14
  'api_1780630178347_rjqlmam::doubao-seedream-4-5-251128': 18, // ¥0.175 → 17.5 → 18
  'api_1780630178347_rjqlmam::doubao-seedream-5-0-260128': 15, // ¥0.154 → 15.4 → 15
  'api_1780630178347_rjqlmam::gpt-image-2': 6, // ¥0.06
  'api_1780630178347_rjqlmam::gpt-image-2-4k': 14, // ¥0.14
  'api_1780630178347_rjqlmam::nano-banana': 9, // ¥0.09
  'api_1780630178347_rjqlmam::nano-banana-2-4k': 22, // ¥0.22
  'api_1780630178347_rjqlmam::nano-banana-2-lite': 8, // ¥0.08
  'api_1780630178347_rjqlmam::nano-banana-pro-4k': 32, // ¥0.32
  // jimeng-5.0 两平台均无定价 → 不写入，沿用内置默认
  // Pear放大接口 (upscaler, 每次)
  'api_1782550826289_eg6d3h9::Real-ESRGAN': 2, // ¥0.015 → 1.5 → 2
  'api_1782550826289_eg6d3h9::SeedVR2-Upscaler': 15, // ¥0.15

  // ========== APIB / Apimart（$ × 7.2 × 100） ==========
  // APImartLLM (chat, token 计费；credits 为按次预估预扣额)
  'api_1778428130626_2qpg71v::gemini-3.1-flash-lite-preview': {
    credits: 1,
    tokenPricing: { input: 180, output: 1080 }, // ratio 0.125 → $0.25/1M 输入, completion×6 → $1.5/1M 输出
  },
  'api_1778428130626_2qpg71v::gemini-2.5-pro': {
    credits: 5,
    tokenPricing: { input: 900, output: 7200 }, // ratio 0.625 → $1.25/1M 输入, completion×8 → $10/1M 输出
  },
  'api_1778428130626_2qpg71v::deepseek-v4-flash': {
    credits: 1,
    tokenPricing: { input: 103, output: 206 }, // ratio 0.0714 → $0.143/1M 输入, completion×2
  },
  'api_1778428130626_2qpg71v::gpt-5.5': {
    credits: 30,
    tokenPricing: { input: 3600, output: 21600 }, // ratio 2.5 → $5/1M 输入, completion×6 → $30/1M 输出
  },
  // Apimart视频 (video, 每秒)
  'api_1781141128851_jry72yo::doubao-seedance-2.0': 156, // ratio 5 → $10/1M tokens；720p ≈ 21.7K tokens/秒 → ¥1.56/秒
  'api_1781141128851_jry72yo::doubao-seedance-2.0-mini': 156, // 同上（APIB 对该模型同为 ratio 5）
  'api_1781141128851_jry72yo::kling-v3-motion-control': 93, // $0.1286/秒 → ¥0.926/秒
  // APImart imgae (image, 每张)
  'api_1778430731224_533e09a::gemini-3-pro-image-preview': 36, // $0.05
  'api_1778430731224_533e09a::gemini-2.5-flash-image-preview': 11, // $0.015625 → ¥0.1125
  'api_1778430731224_533e09a::gemini-3.1-flash-image-preview': 27, // $0.0375
  'api_1778430731224_533e09a::doubao-seedream-5-0-lite': 25, // $0.035
  'api_1778430731224_533e09a::gpt-image-2': 8, // $0.010625 → ¥0.0765
  'api_1778430731224_533e09a::gpt-image-2-official': 152, // $0.2109
  'api_1778430731224_533e09a::midjourney': 41, // $0.0563 → ¥0.405
  'api_1778430731224_533e09a::doubao-seedream-5-0-pro': 32, // $0.045 → ¥0.324
  'api_1778430731224_533e09a::gemini-3.1-flash-lite-image': 29, // $0.04 → ¥0.288
};

async function main() {
  // 1. 校验 + 写入（saveCreditPricingConfig 内部会做 normalize 校验，非法值抛错）
  const keyCount = Object.keys(modelCredits).length;
  await saveCreditPricingConfig({ modelCredits });
  console.log(`[validate+write] OK, ${keyCount} 条模型定价规则已通过校验并写入`);
  console.log('[write] 已写入 wujie_system_settings.credit_pricing_config');

  // 3. 回读验证
  const loaded = await loadCreditPricingConfig();
  const loadedKeys = Object.keys(loaded.modelCredits);
  console.log(`[verify] 回读 ${loadedKeys.length} 条规则`);
  for (const k of loadedKeys) {
    console.log(' ', k, '=>', JSON.stringify(loaded.modelCredits[k]));
  }
  process.exit(0);
}

main().catch(err => {
  console.error('[error]', err);
  process.exit(1);
});
