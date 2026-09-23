import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production build pipeline contract', () => {
  it('uses Turbopack for production builds while preserving the webpack development workaround', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.build).toBe(
      'node scripts/build-completion-marker.mjs clear && next build --turbopack && node scripts/prune-build-traces.mjs && node scripts/build-completion-marker.mjs seal',
    );
    expect(packageJson.scripts?.dev).toBe('next dev --webpack -p 5000');
  });

  it('keeps local evidence and runtime output trees out of deployment file traces', () => {
    const source = readFileSync(resolve(process.cwd(), 'next.config.ts'), 'utf8');

    expect(source).toContain('outputFileTracingExcludes');
    expect(source).toMatch(/instrumentation:\s*LOCAL_BUILD_ARTIFACT_EXCLUDES/u);
    for (const pattern of [
      '.tmp/**/*',
      '.playwright-cli/**/*',
      'output/**/*',
      'test-results/**/*',
      'playwright-report/**/*',
    ]) {
      expect(source).toContain(`'${pattern}'`);
    }
  });

  it('ships a post-build trace pruner for instrumentation artifacts', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/prune-build-traces.mjs'),
      'utf8',
    );

    expect(source).toContain("'.playwright-cli'");
    expect(source).toContain("'test-results'");
    expect(source).toContain("'playwright-report'");
    expect(source).toContain("'output'");
    expect(source).toContain("'.tmp'");
    expect(source).toContain('path.relative');
  });

  it('does not lint archived build output from the local temporary directory', () => {
    const source = readFileSync(resolve(process.cwd(), 'eslint.config.mjs'), 'utf8');
    expect(source).toContain("'.tmp/**'");
  });
});
