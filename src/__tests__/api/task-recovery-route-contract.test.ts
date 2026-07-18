import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('task recovery response contract', () => {
  it('returns a sanitized recovery task and only exposes unassigned legacy image tasks on explicit opt-in', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/tasks/recover/route.ts'), 'utf8');

    expect(source).toContain("get('includeLegacyUnassigned') === '1'");
    expect(source).toContain("task.type === 'generate' || task.type === 'generate-async'");
    expect(source).toContain('function toRecoveryTask');
    expect(source).not.toContain('return NextResponse.json({ success: true, tasks: allTasks });');
  });
});
