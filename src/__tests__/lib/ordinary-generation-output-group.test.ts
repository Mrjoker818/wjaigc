import { describe, expect, it } from 'vitest';
import { parseOrdinaryGenerationOutputGroup } from '@/lib/task-core/ordinary-generation-output-group';

const marker = { version: 1, kind: 'ordinary-generation', taskId: 'ordinary-root', requestedCount: 2 };
describe('ordinary group identity boundary', () => {
  it('admits exact one-root multi-output identity without retaining a mutable caller object', () => {
    const parsed = parseOrdinaryGenerationOutputGroup(marker, 'ordinary-root');
    expect(parsed).toEqual(marker); expect(parsed).not.toBe(marker);
  });
  it.each([null, [], '', { ...marker, extra: 1 }, { ...marker, version: 2 }, { ...marker, kind: 'batch' },
    { ...marker, taskId: '' }, { ...marker, taskId: 'other' }, { ...marker, requestedCount: '2' },
    ...[0, -1, 1.2, 11, Infinity, NaN].map(requestedCount => ({ ...marker, requestedCount }))])('rejects invalid marker %#', value => {
    expect(parseOrdinaryGenerationOutputGroup(value, 'ordinary-root')).toBeNull();
  });
});
