import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Coze startup production contract', () => {
  it('starts the production build instead of a development HMR server', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/coze-start.sh'),
      'utf8',
    );

    expect(source).toContain('pnpm run doctor -- --startup');
    expect(source).toContain('exec pnpm run start');
    expect(source).not.toContain('exec pnpm run dev');
    expect(source).not.toContain('${COZE_PROJECT_ENV:-DEV}');
  });
});
