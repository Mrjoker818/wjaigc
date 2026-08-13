import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function runDoctor(mode?: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DOCTOR_SKIP_ENV_FILE: '1',
    DEPLOY_RUN_PORT: '1',
    WUJIE_DATA_DIR: process.cwd(),
  };
  delete env.DATABASE_URL;
  delete env.PGDATABASE_URL;
  if (mode === undefined) delete env.WUJIE_CANVAS_KERNEL_MODE;
  else env.WUJIE_CANVAS_KERNEL_MODE = mode;
  return spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/doctor.mjs')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
    timeout: 20_000,
  });
}

describe('canvas kernel doctor contract', () => {
  it('reports the legacy default without exposing unrelated environment values', () => {
    const result = runDoctor();
    expect(result.error).toBeUndefined();
    expect(result.stdout).toContain('[PASS] canvas-kernel-mode: legacy (default)');
  });

  it('warns and falls back to legacy for an unsupported value', () => {
    const result = runDoctor('unsupported-mode');
    expect(result.error).toBeUndefined();
    expect(result.stdout).toContain('[WARN] canvas-kernel-mode: unsupported value; runtime falls back to legacy');
    expect(result.stdout).not.toContain('unsupported-mode');
  });
});
