import { describe, expect, it } from 'vitest';

import {
  AMAZON_RULES,
  resolveComplianceRuleSet,
  stableContentSha256Hex,
} from '@/lib/platform-compliance/rules';
import type { PlatformComplianceRule } from '@/lib/platform-compliance/types';

describe('platform compliance rules', () => {
  it.each(['US', 'EU', 'JP'])('freezes non-empty Amazon main rules for %s', region => {
    const frozen = resolveComplianceRuleSet({
      platform: 'Amazon', region, assetType: 'main', productCategory: '',
    });

    expect(frozen.rules.map(rule => rule.id)).toEqual(AMAZON_RULES.map(rule => rule.id));
    expect(frozen.rules.length).toBeGreaterThan(0);
    expect(frozen.rules.every(rule => (
      rule.platform === 'Amazon'
      && rule.regions.includes(region)
      && rule.assetTypes.includes('main')
    ))).toBe(true);
    expect(frozen.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.rules)).toBe(true);
    expect(frozen.rules.every(rule => Object.isFrozen(rule))).toBe(true);
  });

  it('rejects Amazon regions outside the audited first-release contract', () => {
    expect(() => resolveComplianceRuleSet({
      platform: 'Amazon', region: 'CA', assetType: 'main', productCategory: '',
    })).toThrow('UNSUPPORTED_COMPLIANCE_RULESET');
  });

  it('publishes the complete first Amazon rule set with auditable source metadata', () => {
    expect(AMAZON_RULES.map(rule => rule.id)).toEqual([
      'amazon-supported-format',
      'amazon-image-dimensions',
      'amazon-main-white-background',
      'amazon-main-fill',
      'amazon-main-complete-product',
      'amazon-main-no-text',
      'amazon-main-no-logos',
      'amazon-main-no-watermarks',
      'amazon-main-no-borders',
    ]);
    expect(AMAZON_RULES.find(rule => rule.id === 'amazon-image-dimensions')?.thresholds)
      .toMatchObject({ minLongestEdge: 500, maxLongestEdge: 10_000 });
    expect(AMAZON_RULES.length).toBeGreaterThan(0);
    expect(AMAZON_RULES.every(rule => (
      rule.sourceUrl.startsWith('https://sellercentral.amazon.com/')
      && rule.sourceUpdatedAt === null
      && rule.effectiveAt === null
      && rule.snapshotCapturedAt === '2026-09-07T00:00:00.000Z'
    ))).toBe(true);
  });

  it('normalizes product categories before filtering and digesting', () => {
    const input = {
      platform: 'Amazon' as const,
      region: 'US',
      assetType: 'main' as const,
      productCategory: 'shoes',
    };
    const categoryRule = Object.freeze({
      ...AMAZON_RULES[0],
      id: 'amazon-shoes-category-example',
      categories: Object.freeze(['shoes']),
    });
    const registry = Object.freeze([...AMAZON_RULES, categoryRule]);
    const first = resolveComplianceRuleSet({ ...input, productCategory: '  shoes  ' }, registry);
    const second = resolveComplianceRuleSet(input, registry);
    const emptyCategory = resolveComplianceRuleSet({ ...input, productCategory: '' }, registry);

    expect(first.rules.map(rule => rule.id)).toContain(categoryRule.id);
    expect(first.productCategory).toBe('shoes');
    expect(() => resolveComplianceRuleSet({ ...input, productCategory: 'bags' }, registry))
      .toThrow('UNSUPPORTED_COMPLIANCE_CATEGORY');
    expect(emptyCategory.rules.map(rule => rule.id)).not.toContain(categoryRule.id);
    expect(first.digest).toBe(second.digest);
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('keeps descriptive product categories when the published rules are category-agnostic', () => {
    const resolved = resolveComplianceRuleSet({
      platform: 'Amazon',
      region: 'US',
      assetType: 'main',
      productCategory: '  马克杯与饮具  ',
    });

    expect(resolved.productCategory).toBe('马克杯与饮具');
    expect(resolved.rules.map(rule => rule.id)).toEqual(AMAZON_RULES.map(rule => rule.id));
  });

  it('copies and recursively freezes mutable registry rules at the resolution boundary', () => {
    const regions = ['US'];
    const assetTypes: PlatformComplianceRule['assetTypes'][number][] = ['main'];
    const categories = ['shoes'];
    const thresholds = { allowed: true };
    const mutableRule: PlatformComplianceRule = {
      ...AMAZON_RULES[0],
      id: 'amazon-mutable-category-example',
      title: 'Original title',
      regions,
      assetTypes,
      categories,
      thresholds,
    };
    const registry = [...AMAZON_RULES, mutableRule];
    const frozen = resolveComplianceRuleSet({
      platform: 'Amazon', region: 'US', assetType: 'main', productCategory: 'shoes',
    }, registry);
    const resolved = frozen.rules.find(rule => rule.id === mutableRule.id);
    const originalDigest = frozen.digest;

    mutableRule.title = 'Changed title';
    regions.push('EU');
    assetTypes.push('secondary');
    categories.push('bags');
    thresholds.allowed = false;

    expect(resolved).toMatchObject({
      title: 'Original title',
      regions: ['US'],
      assetTypes: ['main'],
      categories: ['shoes'],
    });
    expect(resolved?.thresholds).toEqual({ allowed: true });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved?.regions)).toBe(true);
    expect(Object.isFrozen(resolved?.assetTypes)).toBe(true);
    expect(Object.isFrozen(resolved?.categories)).toBe(true);
    expect(Object.isFrozen(resolved?.thresholds)).toBe(true);
    expect(frozen.digest).toBe(originalDigest);
  });

  it.each([
    ['Amazon', 'CN'],
    ['通用电商', 'CN'],
    ['淘宝/天猫', 'US'],
    ['京东', 'EU'],
  ] as const)('rejects unsupported %s region %s', (platform, region) => {
    expect(() => resolveComplianceRuleSet({
      platform, region, assetType: 'main', productCategory: '',
    })).toThrow('UNSUPPORTED_COMPLIANCE_RULESET');
  });

  it('keeps known valid ruleless platform-region combinations explicit and empty', () => {
    expect(resolveComplianceRuleSet({
      platform: '通用电商', region: 'GLOBAL', assetType: 'main', productCategory: '',
    }).rules).toEqual([]);
    expect(resolveComplianceRuleSet({
      platform: '淘宝/天猫', region: 'CN', assetType: 'main', productCategory: '',
    }).rules).toEqual([]);
    expect(resolveComplianceRuleSet({
      platform: '京东', region: 'CN', assetType: 'main', productCategory: '',
    }).rules).toEqual([]);
  });

  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    ['你好，世界🌍', '169bff907bb53e1729d762bdd0a854735201cbeff533aa9712b97d93be364d85'],
  ])('matches the published SHA-256 vector for %j', (value, expected) => {
    expect(stableContentSha256Hex(value)).toBe(expected);
  });

  it('pins the canonical Amazon US main rule-set digest', () => {
    expect(resolveComplianceRuleSet({
      platform: 'Amazon', region: 'US', assetType: 'main', productCategory: '',
    }).digest).toBe('e43879473545f3a54e7d0b5ed7274b5bd5827fa5d441d919b1420756b4374e0f');
  });
});
