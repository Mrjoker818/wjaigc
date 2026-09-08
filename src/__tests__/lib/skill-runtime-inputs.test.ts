import { describe, expect, it } from 'vitest';

import {
  SkillInputError,
  resolveSkillInputOptions,
  resolveSkillInputs,
} from '@/lib/skill-runtime/input-resolver';
import {
  compileSkillPrompt,
  SkillPromptError,
} from '@/lib/skill-runtime/prompt-compiler';
import type { SkillDefinition, SkillInputField } from '@/lib/skill-runtime/types';

function createDefinition(inputs: readonly SkillInputField[]): SkillDefinition {
  return {
    id: 'test-skill',
    version: 1,
    name: 'Test skill',
    category: 'test',
    description: 'Test definition',
    systemPrompt: 'Test system prompt',
    allowedSurfaces: ['canvas'],
    inputs,
    steps: [],
    enabled: true,
    builtIn: true,
    createdAt: 1,
    updatedAt: 1,
    usageCount: 0,
  };
}

const definition = createDefinition([
  { key: 'product', label: 'Product', kind: 'text', required: true },
  {
    key: 'style',
    label: 'Style',
    kind: 'select',
    required: false,
    defaultValue: '高端科技感',
    options: ['高端科技感', '生活方式'],
  },
  {
    key: 'channels',
    label: 'Channels',
    kind: 'multi-select',
    required: false,
    defaultValue: ['Web'],
    options: ['Web', 'Email', 'Social'],
    maximumItems: 2,
  },
  { key: 'heroImageVersionId', label: 'Hero image', kind: 'image', required: false },
  {
    key: 'imageVersionIds',
    label: 'Images',
    kind: 'images',
    required: false,
    maximumItems: 3,
  },
  { key: 'brandKitId', label: 'Brand Kit', kind: 'brand-kit', required: false },
  { key: 'dataset', label: 'Dataset', kind: 'dataset', required: false },
  { key: 'count', label: 'Count', kind: 'number', required: false },
  { key: 'transparent', label: 'Transparent', kind: 'boolean', required: false },
]);

function expectInputError(
  callback: () => unknown,
  code: string,
  field?: string,
): void {
  try {
    callback();
    throw new Error('Expected resolveSkillInputs to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(SkillInputError);
    expect(error).toMatchObject({ code, ...(field ? { field } : {}) });
  }
}

describe('resolveSkillInputs', () => {
  it('applies generic maximumLength and dependentOptions declarations', () => {
    const constrained = createDefinition([
      { key: 'platform', label: 'Platform', kind: 'select', required: true, options: ['Amazon', '京东'] },
      {
        key: 'region', label: 'Region', kind: 'select', required: true,
        dependentOptions: { inputKey: 'platform', values: { Amazon: ['US', 'JP'], '京东': ['CN'] } },
      },
      { key: 'claims', label: 'Claims', kind: 'text', required: false, maximumLength: 4 },
    ]);

    expect(resolveSkillInputOptions(constrained.inputs, { platform: 'Amazon' }, 'region'))
      .toEqual(['US', 'JP']);
    expect(resolveSkillInputs(constrained, {
      platform: 'Amazon', region: 'JP', claims: '1234',
    })).toMatchObject({ region: 'JP', claims: '1234' });
    expectInputError(
      () => resolveSkillInputs(constrained, { platform: 'Amazon', region: 'CN', claims: '' }),
      'SKILL_INPUT_INVALID_VALUE', 'region',
    );
    expectInputError(
      () => resolveSkillInputs(constrained, { platform: 'Amazon', region: 'US', claims: '12345' }),
      'SKILL_INPUT_LIMIT_EXCEEDED', 'claims',
    );
  });

  it('uses all field defaults when resolving dependent options', () => {
    const constrained = createDefinition([
      {
        key: 'platform', label: 'Platform', kind: 'select', required: true,
        options: ['Amazon', '京东'], defaultValue: 'Amazon',
      },
      {
        key: 'region', label: 'Region', kind: 'select', required: true,
        dependentOptions: { inputKey: 'platform', values: { Amazon: ['US'], '京东': ['CN'] } },
      },
    ]);

    expect(resolveSkillInputOptions(constrained.inputs, { region: 'US' }, 'region'))
      .toEqual(['US']);
    expect(resolveSkillInputs(constrained, { region: 'US' }).region).toBe('US');
  });

  it('returns no options without invoking a dependentOptions getter', () => {
    let getterCalls = 0;
    const unsafe: Record<string, unknown> = {
      key: 'region', label: 'Region', kind: 'select', required: true,
    };
    Object.defineProperty(unsafe, 'dependentOptions', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('public helper getter must not run');
      },
    });

    expect(resolveSkillInputOptions(
      [unsafe as unknown as SkillInputField], { region: 'US' }, 'region',
    )).toEqual([]);
    expect(getterCalls).toBe(0);
  });

  it('requires images to contain unique non-empty identities', () => {
    const sources = createDefinition([{
      key: 'sourceImages', label: 'Sources', kind: 'images', required: true,
      maximumItems: 20, bindToSourceVersions: true, uniqueItems: true,
    }]);
    expectInputError(
      () => resolveSkillInputs(sources, { sourceImages: ['asset-version-1', 'asset-version-1'] }),
      'SKILL_INPUT_INVALID_VALUE', 'sourceImages',
    );
    expectInputError(
      () => resolveSkillInputs(sources, { sourceImages: ['asset-version-1', '   '] }),
      'SKILL_INPUT_INVALID_VALUE', 'sourceImages',
    );
  });

  it('preserves duplicate image inputs unless uniqueness is declared', () => {
    const legacy = createDefinition([{
      key: 'images', label: 'Images', kind: 'images', required: true,
    }]);
    expect(resolveSkillInputs(legacy, { images: ['version-1', 'version-1'] }).images)
      .toEqual(['version-1', 'version-1']);
  });

  it('preserves legacy blank and untrimmed image identities without uniqueItems', () => {
    const legacy = createDefinition([{
      key: 'images', label: 'Images', kind: 'images', required: true,
    }]);
    expect(resolveSkillInputs(legacy, { images: ['', ' version-1 '] }).images)
      .toEqual(['', ' version-1 ']);
  });

  it.each([
    { key: 'region', label: 'Region', kind: 'text', required: false,
      dependentOptions: { inputKey: 'platform', values: { Amazon: ['US'] } } },
    { key: 'region', label: 'Region', kind: 'select', required: false,
      dependentOptions: { inputKey: 'missing', values: { Amazon: ['US'] } } },
    { key: 'region', label: 'Region', kind: 'select', required: false,
      dependentOptions: { inputKey: 'platform', values: { Unknown: ['US'] } } },
    { key: 'region', label: 'Region', kind: 'select', required: false,
      dependentOptions: { inputKey: 'platform', values: { Amazon: ['US', 'US'] } } },
  ])('rejects malformed dependent option definitions %#', region => {
    const invalid = createDefinition([
      { key: 'platform', label: 'Platform', kind: 'select', required: true, options: ['Amazon'] },
      region as unknown as SkillInputField,
    ]);
    expectInputError(
      () => resolveSkillInputs(invalid, { platform: 'Amazon', region: 'US' }),
      'SKILL_INPUT_INVALID_DEFINITION', 'region',
    );
  });

  it('rejects dependentOptions accessors without invoking them', () => {
    let getterCalls = 0;
    const region: Record<string, unknown> = {
      key: 'region', label: 'Region', kind: 'select', required: true,
    };
    Object.defineProperty(region, 'dependentOptions', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('dependentOptions getter must not run');
      },
    });
    const invalid = createDefinition([
      { key: 'platform', label: 'Platform', kind: 'select', required: true, options: ['Amazon'] },
      region as unknown as SkillInputField,
    ]);

    expectInputError(
      () => resolveSkillInputs(invalid, { platform: 'Amazon', region: 'US' }),
      'SKILL_INPUT_INVALID_DEFINITION', 'region',
    );
    expect(getterCalls).toBe(0);
  });

  it.each([
    ['extra key', { inputKey: 'platform', values: { Amazon: ['US'] }, extra: true }],
    ['trimmed input key', { inputKey: ' platform ', values: { Amazon: ['US'] } }],
    ['extra mapping key', { inputKey: 'platform', values: { Amazon: ['US'], Other: ['CN'] } }],
  ])('rejects non-canonical dependentOptions objects: %s', (_name, dependentOptions) => {
    const invalid = createDefinition([
      { key: 'platform', label: 'Platform', kind: 'select', required: true, options: ['Amazon'] },
      {
        key: 'region', label: 'Region', kind: 'select', required: true,
        dependentOptions,
      } as unknown as SkillInputField,
    ]);
    expectInputError(
      () => resolveSkillInputs(invalid, { platform: 'Amazon', region: 'US' }),
      'SKILL_INPUT_INVALID_DEFINITION', 'region',
    );
  });

  it('rejects dependent option mapping accessors without invoking them', () => {
    let getterCalls = 0;
    const values: Record<string, unknown> = {};
    Object.defineProperty(values, 'Amazon', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('mapping getter must not run');
      },
    });
    const invalid = createDefinition([
      { key: 'platform', label: 'Platform', kind: 'select', required: true, options: ['Amazon'] },
      {
        key: 'region', label: 'Region', kind: 'select', required: true,
        dependentOptions: { inputKey: 'platform', values },
      } as unknown as SkillInputField,
    ]);

    expectInputError(
      () => resolveSkillInputs(invalid, { platform: 'Amazon', region: 'US' }),
      'SKILL_INPUT_INVALID_DEFINITION', 'region',
    );
    expect(getterCalls).toBe(0);
  });

  it('缺少或提供空白必填输入时返回字段级错误', () => {
    expectInputError(
      () => resolveSkillInputs(definition, { style: '高端科技感' }),
      'SKILL_INPUT_REQUIRED',
      'product',
    );
    expectInputError(
      () => resolveSkillInputs(definition, { product: '   ' }),
      'SKILL_INPUT_REQUIRED',
      'product',
    );
  });

  it('应用默认值并支持 multi-select 及其他结构化字段', () => {
    const dataset = [{ sku: 'A-1', name: '黑色耳机' }];
    const resolved = resolveSkillInputs(definition, {
      product: '耳机',
      heroImageVersionId: 'ver-hero',
      imageVersionIds: ['ver-1'],
      brandKitId: 'brand-1',
      dataset,
      count: 2,
      transparent: true,
    });

    expect(resolved).toEqual({
      product: '耳机',
      style: '高端科技感',
      channels: ['Web'],
      heroImageVersionId: 'ver-hero',
      imageVersionIds: ['ver-1'],
      brandKitId: 'brand-1',
      dataset,
      count: 2,
      transparent: true,
    });
  });

  it('校验 multi-select 的必填、类型、唯一选项和 maximumItems', () => {
    const required = createDefinition([{
      key: 'channels', label: 'Channels', kind: 'multi-select', required: true,
      options: ['Web', 'Email', 'Social'], maximumItems: 2,
    }]);

    expectInputError(() => resolveSkillInputs(required, { channels: [] }), 'SKILL_INPUT_REQUIRED', 'channels');
    expectInputError(() => resolveSkillInputs(required, { channels: 'Web' }), 'SKILL_INPUT_INVALID_TYPE', 'channels');
    expectInputError(() => resolveSkillInputs(required, { channels: ['Web', 1] }), 'SKILL_INPUT_INVALID_TYPE', 'channels');
    expectInputError(() => resolveSkillInputs(required, { channels: ['Web', 'Web'] }), 'SKILL_INPUT_INVALID_VALUE', 'channels');
    expectInputError(() => resolveSkillInputs(required, { channels: ['Unknown'] }), 'SKILL_INPUT_INVALID_VALUE', 'channels');
    expectInputError(() => resolveSkillInputs(required, { channels: ['Web', 'Email', 'Social'] }), 'SKILL_INPUT_LIMIT_EXCEEDED', 'channels');
    expect(resolveSkillInputs(required, { channels: ['Email', 'Web'] }).channels).toEqual(['Email', 'Web']);
  });

  it('拒绝未知字段、错误类型和非法 select 值', () => {
    expectInputError(
      () => resolveSkillInputs(definition, { product: '耳机', surprise: true }),
      'SKILL_INPUT_UNKNOWN_FIELD',
      'surprise',
    );
    expectInputError(
      () => resolveSkillInputs(definition, { product: '耳机', count: '2' }),
      'SKILL_INPUT_INVALID_TYPE',
      'count',
    );
    expectInputError(
      () => resolveSkillInputs(definition, { product: '耳机', style: '未知风格' }),
      'SKILL_INPUT_INVALID_VALUE',
      'style',
    );
  });

  it('顶层 raw 必须是普通对象且继承属性不能满足必填字段', () => {
    const inherited = Object.create({ product: '继承耳机' }) as Record<string, unknown>;

    expectInputError(
      () => resolveSkillInputs(definition, inherited),
      'SKILL_INPUT_INVALID_TYPE',
    );
    expectInputError(
      () => resolveSkillInputs(definition, [] as unknown as Record<string, unknown>),
      'SKILL_INPUT_INVALID_TYPE',
    );
  });

  it('顶层 getter 在读取前被拒绝且不会执行', () => {
    let getterCalls = 0;
    const raw: Record<string, unknown> = {};
    Object.defineProperty(raw, 'product', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('getter must not run');
      },
    });

    expectInputError(
      () => resolveSkillInputs(definition, raw),
      'SKILL_INPUT_INVALID_VALUE',
      'product',
    );
    expect(getterCalls).toBe(0);
  });

  it('dataset 内 getter 在读取前被拒绝且不会执行', () => {
    let getterCalls = 0;
    const row: Record<string, unknown> = {};
    Object.defineProperty(row, 'sku', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('getter must not run');
      },
    });

    expectInputError(
      () => resolveSkillInputs(definition, { product: '耳机', dataset: [row] }),
      'SKILL_INPUT_INVALID_VALUE',
      'dataset',
    );
    expect(getterCalls).toBe(0);
  });

  it('拒绝非枚举声明字段、非枚举未知字段和 Symbol 未知字段', () => {
    const hiddenDeclared: Record<string, unknown> = {};
    Object.defineProperty(hiddenDeclared, 'product', {
      value: '隐藏耳机',
      enumerable: false,
    });
    expectInputError(
      () => resolveSkillInputs(definition, hiddenDeclared),
      'SKILL_INPUT_INVALID_VALUE',
      'product',
    );

    const hiddenUnknown: Record<string, unknown> = { product: '耳机' };
    Object.defineProperty(hiddenUnknown, 'hiddenPayload', {
      value: '界'.repeat(180_000),
      enumerable: false,
    });
    expectInputError(
      () => resolveSkillInputs(definition, hiddenUnknown),
      'SKILL_INPUT_UNKNOWN_FIELD',
      'hiddenPayload',
    );

    const symbolKey = Symbol('hidden');
    const symbolUnknown = { product: '耳机', [symbolKey]: 'secret' };
    expectInputError(
      () => resolveSkillInputs(definition, symbolUnknown),
      'SKILL_INPUT_UNKNOWN_FIELD',
      'Symbol(hidden)',
    );
  });

  it('非枚举原型污染键不能被隐藏', () => {
    const raw: Record<string, unknown> = { product: '耳机' };
    Object.defineProperty(raw, '__proto__', {
      value: { admin: true },
      enumerable: false,
    });

    expectInputError(
      () => resolveSkillInputs(definition, raw),
      'SKILL_INPUT_FORBIDDEN_KEY',
      '__proto__',
    );
  });

  it('限制文本为 16384 字符并拒绝非有限数字', () => {
    expect(resolveSkillInputs(definition, { product: 'x'.repeat(16_384) }).product)
      .toHaveLength(16_384);
    expectInputError(
      () => resolveSkillInputs(definition, { product: 'x'.repeat(16_385) }),
      'SKILL_INPUT_LIMIT_EXCEEDED',
      'product',
    );
    expectInputError(
      () => resolveSkillInputs(definition, { product: '耳机', count: Number.NaN }),
      'SKILL_INPUT_INVALID_VALUE',
      'count',
    );
  });

  it('限制图片为 20 个且尊重更小的 maximumItems', () => {
    const globalDefinition = createDefinition([
      { key: 'images', label: 'Images', kind: 'images', required: true },
    ]);
    expect(resolveSkillInputs(globalDefinition, { images: Array(20).fill('ver') }).images)
      .toHaveLength(20);
    expectInputError(
      () => resolveSkillInputs(globalDefinition, { images: Array(21).fill('ver') }),
      'SKILL_INPUT_LIMIT_EXCEEDED',
      'images',
    );
    expectInputError(
      () => resolveSkillInputs(definition, {
        product: '耳机',
        imageVersionIds: ['1', '2', '3', '4'],
      }),
      'SKILL_INPUT_LIMIT_EXCEEDED',
      'imageVersionIds',
    );
  });

  it.each([
    Number.NaN,
    '3',
    2.5,
    -1,
  ])('拒绝非法 maximumItems 定义 %p', maximumItems => {
    const invalidDefinition = createDefinition([{
      key: 'images',
      label: 'Images',
      kind: 'images',
      required: true,
      maximumItems: maximumItems as number,
    }]);

    expectInputError(
      () => resolveSkillInputs(invalidDefinition, { images: ['ver-1'] }),
      'SKILL_INPUT_INVALID_DEFINITION',
      'images',
    );
  });

  it('maximumItems 大于全局上限时仍限制为 20', () => {
    const looseDefinition = createDefinition([{
      key: 'images',
      label: 'Images',
      kind: 'images',
      required: true,
      maximumItems: 100,
    }]);

    expectInputError(
      () => resolveSkillInputs(looseDefinition, { images: Array(21).fill('ver') }),
      'SKILL_INPUT_LIMIT_EXCEEDED',
      'images',
    );
  });

  it('限制 dataset 为 1000 行且每行必须是普通对象', () => {
    expect(resolveSkillInputs(definition, {
      product: '耳机',
      dataset: Array.from({ length: 1_000 }, (_, index) => ({ index })),
    }).dataset).toHaveLength(1_000);
    expectInputError(
      () => resolveSkillInputs(definition, {
        product: '耳机',
        dataset: Array.from({ length: 1_001 }, (_, index) => ({ index })),
      }),
      'SKILL_INPUT_LIMIT_EXCEEDED',
      'dataset',
    );
    expectInputError(
      () => resolveSkillInputs(definition, { product: '耳机', dataset: ['row'] }),
      'SKILL_INPUT_INVALID_TYPE',
      'dataset',
    );
  });

  it('限制序列化输入为 512 KiB', () => {
    const exactDefinition = createDefinition([
      { key: 'payload', label: 'Payload', kind: 'dataset', required: true },
    ]);
    const emptyPayload = [{ value: '' }];
    const overhead = Buffer.byteLength(JSON.stringify({ payload: emptyPayload }), 'utf8');
    const exact = [{ value: 'x'.repeat((512 * 1024) - overhead) }];

    expect(resolveSkillInputs(exactDefinition, { payload: exact }).payload).toBe(exact);
    expectInputError(
      () => resolveSkillInputs(exactDefinition, {
        payload: [{ value: `${exact[0].value}x` }],
      }),
      'SKILL_INPUT_SERIALIZED_LIMIT_EXCEEDED',
    );
  });

  it('默认值也必须重新执行 512 KiB UTF-8 门禁', () => {
    const oversizedDefault = createDefinition([{
      key: 'dataset',
      label: 'Dataset',
      kind: 'dataset',
      required: false,
      defaultValue: [{ value: '界'.repeat(180_000) }],
    }]);

    expectInputError(
      () => resolveSkillInputs(oversizedDefault, {}),
      'SKILL_INPUT_SERIALIZED_LIMIT_EXCEEDED',
    );
  });

  it('拒绝输出内部无法严格 JSON 序列化的值并保留缺席 optional 的 undefined', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const invalidValues: unknown[] = [
      circular,
      { value: BigInt(1) },
      { value: () => 'hidden' },
      { value: Symbol('hidden') },
      { value: undefined },
      { value: [undefined] },
    ];

    for (const row of invalidValues) {
      expectInputError(
        () => resolveSkillInputs(definition, { product: '耳机', dataset: [row] }),
        'SKILL_INPUT_INVALID_VALUE',
        'dataset',
      );
    }

    const optionalDefinition = createDefinition([{
      key: 'image',
      label: 'Image',
      kind: 'image',
      required: false,
    }]);
    const resolved = resolveSkillInputs(optionalDefinition, {});
    expect(Object.hasOwn(resolved, 'image')).toBe(true);
    expect(resolved.image).toBeUndefined();
  });

  it('默认值内部的非 JSON 值也返回稳定输入错误', () => {
    const invalidDefault = createDefinition([{
      key: 'dataset',
      label: 'Dataset',
      kind: 'dataset',
      required: false,
      defaultValue: [{ value: () => 'hidden' }],
    }]);

    expectInputError(
      () => resolveSkillInputs(invalidDefault, {}),
      'SKILL_INPUT_INVALID_VALUE',
      'dataset',
    );
  });

  it('拒绝任意层级的对象原型键', () => {
    const pollutedTopLevel = JSON.parse('{"product":"耳机","__proto__":{"admin":true}}') as Record<string, unknown>;
    const pollutedDataset = JSON.parse('[{"sku":"A-1","constructor":{"admin":true}}]') as unknown[];

    expectInputError(
      () => resolveSkillInputs(definition, pollutedTopLevel),
      'SKILL_INPUT_FORBIDDEN_KEY',
      '__proto__',
    );
    expectInputError(
      () => resolveSkillInputs(definition, { product: '耳机', dataset: pollutedDataset }),
      'SKILL_INPUT_FORBIDDEN_KEY',
      'constructor',
    );
  });

  it('默认值不能绕过对象原型键检查', () => {
    const unsafeDefault = createDefinition([{
      key: 'dataset',
      label: 'Dataset',
      kind: 'dataset',
      required: false,
      defaultValue: JSON.parse('[{"prototype":{"admin":true}}]'),
    }]);

    expectInputError(
      () => resolveSkillInputs(unsafeDefault, {}),
      'SKILL_INPUT_FORBIDDEN_KEY',
      'prototype',
    );
  });
});

describe('compileSkillPrompt', () => {
  it('仅替换提供的声明字段并将结构值确定性序列化', () => {
    expect(compileSkillPrompt('为{{product}}制作{{platform}}素材，数据：{{dataset}}', {
      product: '耳机',
      platform: '亚马逊',
      dataset: [{ sku: 'A-1' }],
    })).toBe('为耳机制作亚马逊素材，数据：[{"sku":"A-1"}]');
  });

  it('拒绝未解析占位符和对象原型键占位符', () => {
    expect(() => compileSkillPrompt('为{{product}}制作{{platform}}素材', {
      product: '耳机',
    })).toThrowError(expect.objectContaining({ code: 'SKILL_PROMPT_UNRESOLVED' }));
    expect(() => compileSkillPrompt('读取{{constructor}}', {
      constructor: 'blocked',
    })).toThrowError(expect.objectContaining({ code: 'SKILL_PROMPT_FORBIDDEN_KEY' }));
    expect(() => compileSkillPrompt('描述：{{product}}', {
      product: '{{injected}}',
    })).toThrowError(expect.objectContaining({
      code: 'SKILL_PROMPT_UNRESOLVED',
      field: 'injected',
    }));
  });

  it.each([
    ['circular', (() => {
      const value: Record<string, unknown> = {};
      value.self = value;
      return value;
    })()],
    ['bigint', BigInt(1)],
    ['function', () => 'hidden'],
    ['symbol', Symbol('hidden')],
    ['undefined', undefined],
  ])('对 %s 模板值返回稳定 SkillPromptError', (_label, value) => {
    try {
      compileSkillPrompt('值：{{value}}', { value });
      throw new Error('Expected compileSkillPrompt to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SkillPromptError);
      expect(error).toMatchObject({
        code: 'SKILL_PROMPT_INVALID_VALUE',
        field: 'value',
      });
    }
  });

  it('模板 values getter 在读取前被拒绝且不会执行', () => {
    let getterCalls = 0;
    const values: Record<string, unknown> = {};
    Object.defineProperty(values, 'product', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('getter must not run');
      },
    });

    expect(() => compileSkillPrompt('产品：{{product}}', values)).toThrowError(
      expect.objectContaining({
        code: 'SKILL_PROMPT_INVALID_VALUE',
        field: 'product',
      }),
    );
    expect(getterCalls).toBe(0);
  });

  it('模板结构值拒绝非枚举大数据和非枚举原型污染键', () => {
    const hiddenLarge: Record<string, unknown> = { visible: 'ok' };
    Object.defineProperty(hiddenLarge, 'hiddenPayload', {
      value: '界'.repeat(180_000),
      enumerable: false,
    });
    expect(() => compileSkillPrompt('数据：{{data}}', { data: hiddenLarge })).toThrowError(
      expect.objectContaining({
        code: 'SKILL_PROMPT_INVALID_VALUE',
        field: 'data',
      }),
    );

    const polluted: Record<string, unknown> = { visible: 'ok' };
    Object.defineProperty(polluted, '__proto__', {
      value: { admin: true },
      enumerable: false,
    });
    expect(() => compileSkillPrompt('数据：{{data}}', { data: polluted })).toThrowError(
      expect.objectContaining({
        code: 'SKILL_PROMPT_FORBIDDEN_KEY',
        field: '__proto__',
      }),
    );
  });

  it.each([
    '空占位符 {{}}',
    '缺少闭合 {{product',
  ])('拒绝残缺占位符：%s', template => {
    expect(() => compileSkillPrompt(template, { product: '耳机' })).toThrowError(
      expect.objectContaining({ code: 'SKILL_PROMPT_UNRESOLVED' }),
    );
  });
});
