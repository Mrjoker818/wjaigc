import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seedBundledSystemFiles } from '@/lib/server-data-root';

let workspace: string;
let dataRoot: string;
let seedDir: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'wujie-seed-'));
  dataRoot = path.join(workspace, 'data-root');
  seedDir = path.join(workspace, 'deploy-seed', 'system');
  fs.mkdirSync(seedDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('seedBundledSystemFiles', () => {
  it('copies bundled seed files into the data root system dir', () => {
    fs.writeFileSync(path.join(seedDir, 'users.json'), '{"users":[],"updatedAt":1}');
    fs.writeFileSync(path.join(seedDir, 'api-providers.json'), '[]');

    seedBundledSystemFiles(dataRoot, seedDir);

    const targetDir = path.join(dataRoot, 'system');
    expect(fs.readFileSync(path.join(targetDir, 'users.json'), 'utf8')).toBe('{"users":[],"updatedAt":1}');
    expect(fs.readFileSync(path.join(targetDir, 'api-providers.json'), 'utf8')).toBe('[]');
  });

  it('never overwrites an existing data-root file', () => {
    const targetDir = path.join(dataRoot, 'system');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'users.json'), '{"existing":true}');

    fs.writeFileSync(path.join(seedDir, 'users.json'), '{"users":[],"updatedAt":1}');
    fs.writeFileSync(path.join(seedDir, 'api-providers.json'), '[]');

    seedBundledSystemFiles(dataRoot, seedDir);

    expect(fs.readFileSync(path.join(targetDir, 'users.json'), 'utf8')).toBe('{"existing":true}');
    expect(fs.existsSync(path.join(targetDir, 'api-providers.json'))).toBe(true);
  });

  it('is a no-op when the bundled seed directory is absent', () => {
    seedBundledSystemFiles(dataRoot, path.join(workspace, 'deploy-seed-missing', 'system'));
    expect(fs.existsSync(path.join(dataRoot, 'system'))).toBe(false);
  });
});
