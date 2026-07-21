import { loadCreditPricingConfig, saveCreditPricingConfig } from '@/lib/credit-pricing';

// 换算规则：1 积分 = ¥0.01；4sAPI 美元价 × 7.2 × 100 = $×720；取整
// Token 计费：input $/1M = model_ratio × 2；output = input × completion_ratio（已用 Google 官方价交叉验证，4 个模型完全吻合）
// 图像按张折算的标准 token 假设：Gemini Flash 系 1290 tokens/张；Gemini 3 Pro(2K) 1210 tokens/张；gpt-image-2(medium 1024) 1056 tokens/张
const NEW_RULES: Record<string, number | { credits: number; tokenPricing?: { input: number; output: number } }> = {
  // ===== 4sapi 图像 (api_1780636172228_0mhitfd) — 按张 =====
  // gemini-2.5-flash-image-preview: in $0.30/1M, out $30/1M → 1290×30/1e6=$0.0387 → 28
  'api_1780636172228_0mhitfd::gemini-2.5-flash-image-preview': 28,
  // gemini-2.5-flash-image: 同上 → 28
  'api_1780636172228_0mhitfd::gemini-2.5-flash-image': 28,
  // gemini-3.1-flash-image-preview: in $0.50/1M, out $60/1M → 1290×60/1e6=$0.0774 → 56
  'api_1780636172228_0mhitfd::gemini-3.1-flash-image-preview': 56,
  // gemini-3-pro-image-preview: in $2/1M, out $120/1M → 1210×120/1e6=$0.1452 → 105
  'api_1780636172228_0mhitfd::gemini-3-pro-image-preview': 105,
  // gpt-image-2: in $5/1M, out $30/1M → 1056×30/1e6=$0.0317 → 23
  'api_1780636172228_0mhitfd::gpt-image-2': 23,
  // gpt-image-2-c: 按次 $0.05 → 36
  'api_1780636172228_0mhitfd::gpt-image-2-c': 36,
  // ===== 4S API VLM (api_1781689188675_6m49gpe) — 按 Token（4sAPI 列表无此两模型，参考阿里云官方价 ¥×100） =====
  // qwen-vl-max: ¥3/1M 输入, ¥9/1M 输出
  'api_1781689188675_6m49gpe::qwen-vl-max': { credits: 1, tokenPricing: { input: 300, output: 900 } },
  // qwen2.5-vl-72b-instruct: ¥4/1M 输入, ¥12/1M 输出
  'api_1781689188675_6m49gpe::qwen2.5-vl-72b-instruct': { credits: 1, tokenPricing: { input: 400, output: 1200 } },
};

async function main() {
const existing = await loadCreditPricingConfig();
const before = Object.keys(existing.modelCredits).length;
console.log(`existing rules: ${before}`);

const merged = { ...existing.modelCredits, ...NEW_RULES };
await saveCreditPricingConfig({ modelCredits: merged });

const verify = await loadCreditPricingConfig();
const keys = Object.keys(verify.modelCredits);
console.log(`after write: ${keys.length} rules`);

const p4s = keys.filter(k => k.startsWith('api_1780636172228_0mhitfd::') || k.startsWith('api_1781689188675_6m49gpe::'));
console.log(`4sapi rules: ${p4s.length}`);
for (const k of p4s) {
  console.log(`  ${k} => ${JSON.stringify(verify.modelCredits[k])}`);
}
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
