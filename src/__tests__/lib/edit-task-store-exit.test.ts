import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const exec = promisify(execFile);

describe('edit task cleanup lifecycle', () => {
  it('does not keep an otherwise idle real Node process alive', async () => {
    const moduleUrl = pathToFileURL(path.resolve('src/lib/edit-task-store.ts')).href;
    const outcome = await exec(process.execPath, [
      '--import', 'tsx', '--input-type=module', '--eval',
      `await import(${JSON.stringify(moduleUrl)}); console.log('EDIT_STORE_LOADED');`,
    ], { cwd: process.cwd(), timeout: 3_000, windowsHide: true }).then(
      result => ({ status: 'exited', stdout: result.stdout, stderr: result.stderr }),
      (error: unknown) => ({ status: 'failed', error }),
    );
    if ('error' in outcome) {
      expect(outcome.error).toHaveProperty('killed', true);
      expect(outcome.error).toHaveProperty('stdout', 'EDIT_STORE_LOADED\n');
    }
    expect(outcome.status).toBe('exited');
    if ('stdout' in outcome) {
      expect(outcome.stdout.trim()).toBe('EDIT_STORE_LOADED');
      expect(outcome.stderr).toBe('');
    }
  }, 10_000);

  it('still cleans stale tasks while retaining fresh processing tasks', async () => {
    const keys = ['__wujie_edit_task_store__', '__wujie_edit_task_cleanup__'] as const;
    const previous = keys.map(key => ({ key, value: Reflect.get(globalThis, key) as unknown, present: Reflect.has(globalThis, key) }));
    vi.useFakeTimers();
    try {
      for (const key of keys) Reflect.deleteProperty(globalThis, key);
      vi.resetModules();
      const { getEditTask, setEditTask } = await import('@/lib/edit-task-store');
      for (const [id, status, ageMinutes] of [
        ['stale-completed', 'completed', 31],
        ['stale-processing', 'processing', 31],
        ['fresh-processing', 'processing', 0],
      ] as const) {
        setEditTask(id, { id, status, progress: status === 'completed' ? 100 : 5,
          stage: status, createdAt: Date.now() - ageMinutes * 60_000 });
      }
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(getEditTask('stale-completed')).toBeUndefined();
      expect(getEditTask('stale-processing')).toBeUndefined();
      expect(getEditTask('fresh-processing')).toMatchObject({ status: 'processing', progress: 5 });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.resetModules();
      for (const entry of previous) {
        if (entry.present) Reflect.set(globalThis, entry.key, entry.value);
        else Reflect.deleteProperty(globalThis, entry.key);
      }
    }
  });
});
