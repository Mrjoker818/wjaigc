import type {
  FrozenComplianceRuleSet,
  PlatformComplianceRule,
  ResolveComplianceRuleSetInput,
} from './types';

const AMAZON_IMAGE_REQUIREMENTS_URL = 'https://sellercentral.amazon.com/help/hub/reference/G1881';
const AMAZON_SNAPSHOT_CAPTURED_AT = '2026-09-07T00:00:00.000Z';
const AMAZON_REGIONS = Object.freeze(['US', 'EU', 'JP']);
const PLATFORM_REGIONS = Object.freeze({
  '通用电商': Object.freeze(['GLOBAL']),
  Amazon: AMAZON_REGIONS,
  '淘宝/天猫': Object.freeze(['CN']),
  '京东': Object.freeze(['CN']),
} satisfies Readonly<Record<PlatformComplianceRule['platform'], readonly string[]>>);
const ALL_ASSET_TYPES = Object.freeze(['main', 'secondary', 'detail', 'a-plus'] as const);
const MAIN_ASSET_TYPE = Object.freeze(['main'] as const);

function freezeRule(rule: PlatformComplianceRule): PlatformComplianceRule {
  if (rule.thresholds !== undefined) Object.freeze(rule.thresholds);
  if (rule.categories !== undefined) Object.freeze(rule.categories);
  Object.freeze(rule.regions);
  Object.freeze(rule.assetTypes);
  return Object.freeze(rule);
}

const commonRuleFields = {
  version: 1,
  platform: 'Amazon',
  regions: AMAZON_REGIONS,
  sourceUrl: AMAZON_IMAGE_REQUIREMENTS_URL,
  sourceUpdatedAt: null,
  effectiveAt: null,
  snapshotCapturedAt: AMAZON_SNAPSHOT_CAPTURED_AT,
} as const;

export const AMAZON_RULES: readonly PlatformComplianceRule[] = Object.freeze([
  freezeRule({
    ...commonRuleFields,
    id: 'amazon-supported-format',
    assetTypes: ALL_ASSET_TYPES,
    title: '支持的图片格式',
    severity: 'blocking',
    evaluator: 'metadata',
    thresholds: { supportedFormats: 'JPEG,TIFF,PNG,GIF', animatedGifAllowed: false },
  }),
  freezeRule({
    ...commonRuleFields,
    id: 'amazon-image-dimensions',
    assetTypes: ALL_ASSET_TYPES,
    title: '图片最长边范围',
    severity: 'blocking',
    evaluator: 'metadata',
    thresholds: { minLongestEdge: 500, maxLongestEdge: 10_000 },
  }),
  freezeRule({
    ...commonRuleFields,
    id: 'amazon-main-white-background',
    assetTypes: MAIN_ASSET_TYPE,
    title: '主图纯白背景',
    severity: 'blocking',
    evaluator: 'pixel',
    thresholds: { backgroundColor: '#FFFFFF' },
  }),
  freezeRule({
    ...commonRuleFields,
    id: 'amazon-main-fill',
    assetTypes: MAIN_ASSET_TYPE,
    title: '商品画面占比',
    severity: 'blocking',
    evaluator: 'vision',
    thresholds: { minProductCoveragePercent: 85 },
  }),
  freezeRule({
    ...commonRuleFields,
    id: 'amazon-main-complete-product',
    assetTypes: MAIN_ASSET_TYPE,
    title: '商品完整且未被裁切',
    severity: 'blocking',
    evaluator: 'vision',
  }),
  freezeRule({
    ...commonRuleFields,
    id: 'amazon-main-no-text',
    assetTypes: MAIN_ASSET_TYPE,
    title: '主图不得包含文字',
    severity: 'blocking',
    evaluator: 'vision',
    thresholds: { allowed: false },
  }),
  freezeRule({
    ...commonRuleFields,
    id: 'amazon-main-no-logos',
    assetTypes: MAIN_ASSET_TYPE,
    title: '主图不得包含徽标',
    severity: 'blocking',
    evaluator: 'vision',
    thresholds: { allowed: false },
  }),
  freezeRule({
    ...commonRuleFields,
    id: 'amazon-main-no-watermarks',
    assetTypes: MAIN_ASSET_TYPE,
    title: '主图不得包含水印',
    severity: 'blocking',
    evaluator: 'vision',
    thresholds: { allowed: false },
  }),
  freezeRule({
    ...commonRuleFields,
    id: 'amazon-main-no-borders',
    assetTypes: MAIN_ASSET_TYPE,
    title: '主图不得包含边框',
    severity: 'blocking',
    evaluator: 'vision',
    thresholds: { allowed: false },
  }),
]);

function canonicalRuleJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRuleJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalRuleJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const SHA256_INITIAL_STATE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;
const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/**
 * Synchronous SHA-256 for deterministic content identity in browser and Node runtimes.
 * This is not a password hashing, authentication, or digital-signature API.
 */
export function stableContentSha256Hex(value: string): string {
  const input = new TextEncoder().encode(value);
  const bitLength = input.length * 8;
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash: number[] = [...SHA256_INITIAL_STATE];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choose + SHA256_ROUND_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return hash.map(part => part.toString(16).padStart(8, '0')).join('');
}

export function resolveComplianceRuleSet(
  input: ResolveComplianceRuleSetInput,
  registry: readonly PlatformComplianceRule[] = AMAZON_RULES,
): FrozenComplianceRuleSet {
  if (!PLATFORM_REGIONS[input.platform].includes(input.region)) {
    throw new Error('UNSUPPORTED_COMPLIANCE_RULESET');
  }
  const productCategory = input.productCategory.trim();
  const applicableRules = registry.filter(rule => (
    rule.platform === input.platform
    && rule.regions.includes(input.region)
    && rule.assetTypes.includes(input.assetType)
  ));
  const categoryRules = applicableRules.filter(rule => rule.categories !== undefined);
  if (productCategory !== '' && categoryRules.length > 0) {
    const categoryIsPublished = categoryRules.some(
      rule => rule.categories?.includes(productCategory) === true,
    );
    if (!categoryIsPublished) throw new Error('UNSUPPORTED_COMPLIANCE_CATEGORY');
  }
  const rules = applicableRules.filter(
    rule => rule.categories === undefined || rule.categories.includes(productCategory),
  );
  const frozenRules = Object.freeze(rules.map(rule => freezeRule({
    ...rule,
    regions: [...rule.regions],
    assetTypes: [...rule.assetTypes],
    ...(rule.categories === undefined ? {} : { categories: [...rule.categories] }),
    ...(rule.thresholds === undefined ? {} : { thresholds: { ...rule.thresholds } }),
  })));
  const digestInput = {
    platform: input.platform,
    region: input.region,
    assetType: input.assetType,
    productCategory,
    rules: frozenRules,
  };
  const digest = stableContentSha256Hex(canonicalRuleJson(digestInput));

  return Object.freeze({
    platform: input.platform,
    region: input.region,
    assetType: input.assetType,
    productCategory,
    digest,
    rules: frozenRules,
  });
}
