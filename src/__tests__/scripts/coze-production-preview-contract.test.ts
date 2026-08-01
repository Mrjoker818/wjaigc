import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cozeConfig = readFileSync(resolve(process.cwd(), '.coze'), 'utf8');
const devSection = cozeConfig.match(/\[dev\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? '';
const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};

describe('Coze preview runtime contract', () => {
  it('fails the preview startup before exposing a production server with missing required secrets', () => {
    expect(devSection).toContain('build = [ "bash", "./scripts/coze-preview-build.sh" ]');
    expect(devSection).toContain('run = [ "bash", "./scripts/coze-start.sh" ]');
    expect(devSection).not.toContain('pnpm", "run", "dev');

    const buildScript = readFileSync(resolve(process.cwd(), 'scripts/coze-preview-build.sh'), 'utf8');
    expect(buildScript).toContain('pnpm install --frozen-lockfile');
    expect(buildScript).toContain('pnpm run build');

    const startScript = readFileSync(resolve(process.cwd(), 'scripts/coze-start.sh'), 'utf8');
    expect(packageJson.scripts?.doctor).toBe('node scripts/doctor.mjs');
    expect(startScript).toContain('exec ./node_modules/.bin/next start -p "${PORT:-5000}" -H 0.0.0.0');
    expect(startScript).not.toContain('pnpm install');
    expect(startScript).not.toContain('pnpm run build');
    expect(startScript).not.toContain('pnpm run doctor');
  });
});
