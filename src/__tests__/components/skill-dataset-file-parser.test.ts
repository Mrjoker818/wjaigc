// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { parseSkillDatasetFile } from '@/components/skill-runtime/dataset-file-parser';

function datasetFile(name: string, content: string): File {
  return {
    name,
    size: new TextEncoder().encode(content).byteLength,
    type: name.endsWith('.json') ? 'application/json' : 'text/csv',
    text: async () => content,
  } as File;
}

describe('Skill dataset file parser', () => {
  it('parses UTF-8 CSV with quoted commas and blank lines', async () => {
    await expect(parseSkillDatasetFile(datasetFile(
      'sku.csv',
      '\uFEFFsku,name,sellingPoints\r\nA-1,"耳机, 黑色",主动降噪\r\n\r\n',
    ))).resolves.toEqual([
      { sku: 'A-1', name: '耳机, 黑色', sellingPoints: '主动降噪' },
    ]);
  });

  it('parses a JSON object array without changing row order', async () => {
    await expect(parseSkillDatasetFile(datasetFile(
      'sku.json',
      '[{"sku":"A-1","name":"黑色"},{"sku":"B-2","name":"白色"}]',
    ))).resolves.toEqual([
      { sku: 'A-1', name: '黑色' },
      { sku: 'B-2', name: '白色' },
    ]);
  });

  it.each([
    ['duplicate.csv', 'sku,sku,name\nA-1,A-2,耳机', 'SKILL_DATASET_DUPLICATE_HEADER'],
    ['formula.csv', 'sku,name\n=cmd,耳机', 'SKILL_DATASET_FORMULA_VALUE'],
    ['rows.txt', 'sku,name\nA-1,耳机', 'SKILL_DATASET_FILE_TYPE'],
  ])('rejects unsafe dataset file %#', async (name, content, code) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(parseSkillDatasetFile(datasetFile(name, content))).rejects.toMatchObject({ code });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
