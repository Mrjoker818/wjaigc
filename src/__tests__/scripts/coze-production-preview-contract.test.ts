import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cozeConfig = readFileSync(resolve(process.cwd(), '.coze'), 'utf8');
const devSection = cozeConfig.match(/\[dev\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? '';

describe('Coze preview runtime contract', () => {
  it('installs dependencies before starting the development preview', () => {
    expect(devSection).toContain('build = [ "pnpm", "install", "--frozen-lockfile" ]');
    expect(devSection).toContain('run = [ "pnpm", "run", "dev" ]');
    expect(devSection).not.toContain('pnpm", "run", "build');
    expect(devSection).not.toContain('pnpm", "run", "start');
  });
});
