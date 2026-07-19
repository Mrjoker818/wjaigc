import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cozeConfig = readFileSync(resolve(process.cwd(), '.coze'), 'utf8');
const devSection = cozeConfig.match(/\[dev\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? '';

describe('Coze preview runtime contract', () => {
  it('builds the preview after a locked install and runs the production server', () => {
    expect(devSection).toContain('build = [ "bash", "./scripts/coze-preview-build.sh" ]');
    expect(devSection).toContain('run = [ "pnpm", "run", "start" ]');
    expect(devSection).not.toContain('pnpm", "run", "dev');

    const buildScript = readFileSync(resolve(process.cwd(), 'scripts/coze-preview-build.sh'), 'utf8');
    expect(buildScript).toContain('pnpm install --frozen-lockfile');
    expect(buildScript).toContain('pnpm run build');
  });
});
