import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compareTaskEntryFacts,
  createTaskEntryAudit,
  executeTaskEntryMigration,
  resolveTaskCoreMode,
} from '@/lib/task-core/entry-migration';

const root = process.cwd();
const migratedRoutes = [
  'src/app/api/video/generate/route.ts',
  'src/app/api/image-edit/route.ts',
  'src/app/api/edit/route.ts',
  'src/app/api/image-to-3d/route.ts',
  'src/app/api/layered-decompose/route.ts',
  'src/app/api/agent-edit/route.ts',
];

describe('task entry migration contract', () => {
  it('fails closed to legacy for missing or unsupported modes', () => {
    expect(resolveTaskCoreMode(undefined)).toBe('legacy');
    expect(resolveTaskCoreMode('unexpected')).toBe('legacy');
    expect(resolveTaskCoreMode('shadow')).toBe('shadow');
    expect(resolveTaskCoreMode('core-v2')).toBe('core-v2');
  });

  it('records requested and actual routing, billing, request, and handler facts', () => {
    const audit = createTaskEntryAudit({
      entry: 'video',
      mode: 'shadow',
      requestId: 'req-entry-1',
      requestedProviderId: 'provider-requested',
      requestedModelId: 'model-requested',
      actualProviderId: 'provider-actual',
      actualModelId: 'model-actual',
      startedAt: 1_000,
      updatedAt: 1_450,
      creditCost: 12,
      creditStatus: 'charged',
    });

    expect(audit).toMatchObject({
      handlerVersion: 'task-core-v2-shadow',
      requestId: 'req-entry-1',
      requestedProviderId: 'provider-requested',
      actualProviderId: 'provider-actual',
      requestedModelId: 'model-requested',
      actualModelId: 'model-actual',
      durationMs: 450,
      creditCost: 12,
      creditStatus: 'charged',
    });
  });

  it('reports shadow mismatches without changing the legacy task result', () => {
    const comparison = compareTaskEntryFacts(
      { providerId: 'pear', modelId: 'gpt-image-2', creditCost: 3, status: 'completed' },
      { providerId: '302', modelId: 'gpt-image-2', creditCost: 3, status: 'completed' },
    );

    expect(comparison.matches).toBe(false);
    expect(comparison.mismatches).toEqual(['providerId']);
  });

  it.each([
    ['legacy', 1, 0, 0],
    ['shadow', 1, 0, 1],
    ['core-v2', 0, 1, 0],
  ] as const)(
    '%s executes exactly one mutating task path',
    async (mode, expectedLegacy, expectedCore, expectedPreview) => {
      let legacyCalls = 0;
      let coreCalls = 0;
      let previewCalls = 0;

      const result = await executeTaskEntryMigration({
        mode,
        legacy: async () => {
          legacyCalls += 1;
          return { taskId: 'legacy-task', providerId: 'pear', modelId: 'model-1' };
        },
        coreV2: async () => {
          coreCalls += 1;
          return { taskId: 'core-task', providerId: 'pear', modelId: 'model-1' };
        },
        factsFromResult: value => ({
          providerId: value.providerId,
          modelId: value.modelId,
          status: 'processing',
        }),
        previewCoreFacts: async () => {
          previewCalls += 1;
          return { providerId: 'pear', modelId: 'model-1', status: 'processing' };
        },
      });

      expect(legacyCalls).toBe(expectedLegacy);
      expect(coreCalls).toBe(expectedCore);
      expect(previewCalls).toBe(expectedPreview);
      expect(result.value.taskId).toBe(mode === 'core-v2' ? 'core-task' : 'legacy-task');
      expect(result.comparison?.matches).toBe(mode === 'shadow' ? true : undefined);
    },
  );

  it.each(migratedRoutes)('%s is wired to the guarded migration mode', route => {
    const source = readFileSync(join(root, route), 'utf8');
    expect(source).toContain("@/lib/task-core/entry-migration");
    const resolvesConfiguredMode = source.includes('resolveTaskCoreMode(');
    const explicitlyRequiresCoreV2 = source.includes("const editTaskCoreMode = 'core-v2'");
    expect(resolvesConfiguredMode || explicitlyRequiresCoreV2).toBe(true);
    expect(source).toContain('createTaskEntryAudit(');
  });
});
