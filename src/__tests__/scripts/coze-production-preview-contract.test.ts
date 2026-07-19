import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cozeConfig = readFileSync(resolve(process.cwd(), '.coze'), 'utf8');
const devSection = cozeConfig.match(/\[dev\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? '';

describe('Coze preview runtime contract', () => {
  it('uses a production build and production server for the cloud preview', () => {
    expect(devSection).toContain('build = [ "pnpm", "run", "build" ]');
    expect(devSection).toContain('run = [ "pnpm", "run", "start" ]');
    expect(devSection).not.toContain('run = [ "pnpm", "run", "dev" ]');
  });
});
