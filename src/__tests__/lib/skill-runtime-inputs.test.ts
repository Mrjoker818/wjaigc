import { describe, expect, it } from 'vitest';

import {
  SkillInputError,
  resolveSkillInputs,
} from '@/lib/skill-runtime/input-resolver';
import { compileSkillPrompt } from '@/lib/skill-runtime/prompt-compiler';
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

  it('应用默认值并支持 text、image、images、Brand Kit、dataset、select、number 和 boolean', () => {
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
      heroImageVersionId: 'ver-hero',
      imageVersionIds: ['ver-1'],
      brandKitId: 'brand-1',
      dataset,
      count: 2,
      transparent: true,
    });
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

  it('限制图片为 16 个且尊重更小的 maximumItems', () => {
    const globalDefinition = createDefinition([
      { key: 'images', label: 'Images', kind: 'images', required: true },
    ]);
    expect(resolveSkillInputs(globalDefinition, { images: Array(16).fill('ver') }).images)
      .toHaveLength(16);
    expectInputError(
      () => resolveSkillInputs(globalDefinition, { images: Array(17).fill('ver') }),
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
});
