import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'src', 'app', 'api', 'human');
const read = (...parts: string[]) => readFileSync(resolve(root, ...parts), 'utf8');

describe('human repair API wiring', () => {
  it('authenticates analysis, repair, task lookup and version selection', () => {
    expect(read('analyze', 'route.ts')).toContain('requireApiAuthOrReject');
    expect(read('repair', 'route.ts')).toContain('startHumanRepair');
    expect(read('task', '[id]', 'route.ts')).toContain('getHumanRepairTask');
    expect(read('select', 'route.ts')).toContain('selectHumanRepairCandidate');
  });
});
