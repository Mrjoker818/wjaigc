import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cozeConfig = readFileSync(resolve(process.cwd(), '.coze'), 'utf8');
const devSection = cozeConfig.match(/\[dev\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? '';

describe('Coze preview runtime contract', () => {
  it('fails the preview startup before exposing a production server with missing required secrets', () => {
    expect(devSection).toContain('build = [ "bash", "./scripts/coze-preview-build.sh" ]');
    expect(devSection).toContain('run = [ "bash", "./scripts/coze-start.sh" ]');
    expect(devSection).not.toContain('pnpm", "run", "dev');

    const buildScript = readFileSync(resolve(process.cwd(), 'scripts/coze-preview-build.sh'), 'utf8');
    expect(buildScript).toContain('pnpm install --frozen-lockfile');
    expect(buildScript).toContain('pnpm run build');

    const startScript = readFileSync(resolve(process.cwd(), 'scripts/coze-start.sh'), 'utf8');
    expect(startScript).toContain('pnpm run doctor -- --production');
    expect(startScript).toContain('exec pnpm run start');
  });
});
