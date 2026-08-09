import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Coze startup production contract', () => {
  it('starts the production server instead of a development HMR server', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/coze-start.sh'),
      'utf8',
    );
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.start).toBe('next start -p 5000 -H 0.0.0.0');
    expect(source).toContain('exec ./node_modules/.bin/next start');
    expect(source).not.toContain('exec pnpm run dev');
    expect(source).not.toContain('${COZE_PROJECT_ENV:-DEV}');
  });

  it('recovers missing build prerequisites without switching to a development server', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/coze-start.sh'),
      'utf8',
    );

    expect(source).toContain('.next/BUILD_ID');
    expect(source).toContain('exec ./node_modules/.bin/next start');
    expect(source).toContain('pnpm install --frozen-lockfile');
    expect(source).toContain('pnpm install --ignore-scripts');
    expect(source).toContain('node scripts/prepare-tools.mjs');
    expect(source).toContain('node scripts/patch-pg-ssl.js');
    expect(source).toContain('pnpm run build');
    expect(source).not.toContain('exec pnpm run dev');
  });
});
