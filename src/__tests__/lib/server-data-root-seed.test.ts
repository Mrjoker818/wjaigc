import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let workspace: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'wujie-deployment-data-'));
  vi.stubEnv('COZE_WORKSPACE_PATH', workspace);
  vi.stubEnv('WUJIE_DATA_DIR', '');
  vi.stubEnv('WUJIE_DEPLOYMENT_DB_ONLY', '1');
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(workspace, { recursive: true, force: true });
});

it('does not copy a historical bundle into the runtime filesystem fallback', async () => {
  const seedDir = path.join(workspace, 'deploy-seed', 'system');
  fs.mkdirSync(seedDir, { recursive: true });
  for (const name of ['users.json', 'api-providers.json']) {
    fs.writeFileSync(path.join(seedDir, name), 'synthetic legacy credential');
  }
  const mkdir = fs.mkdirSync;
  vi.spyOn(fs, 'mkdirSync').mockImplementation((directory, options) => {
    if (String(directory) === '/space/wujie-data') throw Object.assign(new Error('No mounted volume'), { code: 'EACCES' });
    return mkdir(directory, options);
  });

  const { getServerDataRoot } = await import('@/lib/server-data-root');
  const root = getServerDataRoot();
  expect(root).toBe(path.join(workspace, 'data'));
  expect(fs.existsSync(path.join(root, 'system'))).toBe(false);
});

it('keeps non-credential system settings when copying existing local data', async () => {
  const local = path.join(workspace, 'data');
  const persistent = path.join(workspace, 'durable');
  fs.mkdirSync(path.join(local, 'system'), { recursive: true });
  for (const name of ['users.json', 'api-providers.json', 'auth-secret', 'settings.json']) {
    fs.writeFileSync(path.join(local, 'system', name), 'synthetic local file');
  }

  const { migrateLocalDataIfNeeded } = await import('@/lib/server-data-root');
  migrateLocalDataIfNeeded(local, persistent);
  expect(fs.readdirSync(path.join(persistent, 'system'))).toEqual(['settings.json']);
});
