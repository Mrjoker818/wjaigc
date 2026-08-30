import { describe, expect, it } from 'vitest';
import { normalizeAdminModelAssignments } from '@/lib/admin-model-authorization';
import type { ModelInfo } from '@/lib/universal-api-types';

function model(providerId: string, id: string, type: ModelInfo['type']): ModelInfo {
  return { providerId, id, name: id, type };
}

const catalog: ModelInfo[] = [
  model('image-a', 'unique-image', 'image'),
  model('image-a', 'shared-image', 'image'),
  model('image-b', 'shared-image', 'image'),
  model('chat-a', 'chat-model', 'chat'),
  model('vlm-a', 'vision-model', 'vlm'),
  model('layer-a', 'layer-model', 'layer'),
];

describe('normalizeAdminModelAssignments', () => {
  it('migrates a unique legacy image model id to an exact provider key', () => {
    expect(normalizeAdminModelAssignments({
      assignments: ['unique-image'],
      namespace: 'image',
      models: catalog,
    })).toEqual({
      ok: true,
      assignments: ['image-a::unique-image'],
      migrated: [{ from: 'unique-image', to: 'image-a::unique-image' }],
    });
  });

  it('rejects a duplicate legacy model id as ambiguous', () => {
    expect(normalizeAdminModelAssignments({
      assignments: ['shared-image'],
      namespace: 'image',
      models: catalog,
    })).toEqual({
      ok: false,
      code: 'MODEL_ASSIGNMENT_AMBIGUOUS',
      assignment: 'shared-image',
      candidateCount: 2,
    });
  });

  it.each([
    ['missing::model', 'image'],
    ['chat-a::chat-model', 'image'],
    ['image-a::unique-image', 'chat'],
    ['image-a::unique-image::extra', 'image'],
    ['', 'image'],
  ] as const)('rejects invalid or wrong-namespace assignment %s', (assignment, namespace) => {
    expect(normalizeAdminModelAssignments({
      assignments: [assignment],
      namespace,
      models: catalog,
    })).toEqual({
      ok: false,
      code: 'MODEL_ASSIGNMENT_INVALID',
      assignment,
      candidateCount: 0,
    });
  });

  it('rejects non-array and non-string input without coercion', () => {
    expect(normalizeAdminModelAssignments({
      assignments: ['unique-image', 42],
      namespace: 'image',
      models: catalog,
    })).toMatchObject({ ok: false, code: 'MODEL_ASSIGNMENT_INVALID' });
    expect(normalizeAdminModelAssignments({
      assignments: 'unique-image',
      namespace: 'image',
      models: catalog,
    })).toMatchObject({ ok: false, code: 'MODEL_ASSIGNMENT_INVALID' });
  });

  it('keeps exact assignments in stable first-seen order and removes duplicates', () => {
    expect(normalizeAdminModelAssignments({
      assignments: [
        ' layer-a::layer-model ',
        'image-a::unique-image',
        'layer-a::layer-model',
      ],
      namespace: 'image',
      models: catalog,
    })).toEqual({
      ok: true,
      assignments: ['layer-a::layer-model', 'image-a::unique-image'],
      migrated: [],
    });
  });

  it('preserves the existing empty-array unrestricted contract', () => {
    expect(normalizeAdminModelAssignments({
      assignments: [],
      namespace: 'chat',
      models: catalog,
    })).toEqual({ ok: true, assignments: [], migrated: [] });
  });
});
