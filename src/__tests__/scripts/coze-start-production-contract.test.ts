import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Coze startup production contract', () => {
  it('starts the production server instead of a development HMR server', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/coze-start.sh'),
      'utf8',
    );

    expect(source).toContain('exec ./node_modules/.bin/next start');
    expect(source).not.toContain('exec pnpm run dev');
    expect(source).not.toContain('${COZE_PROJECT_ENV:-DEV}');
  });

  it('starts only an already-built production server without install, build, or doctor work', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/coze-start.sh'),
      'utf8',
    );

    expect(source).toContain('.next/BUILD_ID');
    expect(source).toContain('node_modules/.bin/next');
    expect(source).toContain('exec ./node_modules/.bin/next start -p "${PORT:-5000}" -H 0.0.0.0');
    expect(source).not.toContain('pnpm install');
    expect(source).not.toContain('pnpm run build');
    expect(source).not.toContain('pnpm run doctor');
  });
});
