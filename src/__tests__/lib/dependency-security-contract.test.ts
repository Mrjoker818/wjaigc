import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  pnpm?: { overrides?: Record<string, string> };
};

const projectRoot = process.cwd();
const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
) as PackageManifest;
const lockfileSource = readFileSync(resolve(projectRoot, 'pnpm-lock.yaml'), 'utf8');

describe('production dependency security baseline', () => {
  it('pins direct production packages to the audited patched releases', () => {
    expect(packageJson.dependencies).toMatchObject({
      '@aws-sdk/client-s3': '^3.1090.0',
      '@aws-sdk/lib-storage': '^3.1090.0',
      '@langchain/core': '^1.2.3',
      '@langchain/openai': '^1.5.5',
      '@supabase/supabase-js': '2.110.7',
      'coze-coding-dev-sdk': '^0.7.24',
      'drizzle-orm': '^0.45.2',
      next: '16.2.11',
      openai: '^6.48.0',
      sharp: '^0.35.0',
      svgo: '^4.0.2',
      ws: '8.21.1',
    });
    expect(packageJson.devDependencies).toMatchObject({
      'drizzle-kit': '^0.31.8',
      'eslint-config-next': '16.2.11',
      'form-data': '^4.0.6',
    });
    expect(packageJson.dependencies).not.toHaveProperty('drizzle-kit');
  });

  it('overrides audited vulnerable transitive packages with patched releases', () => {
    expect(packageJson.pnpm?.overrides).toMatchObject({
      axios: '1.18.1',
      '@babel/core': '7.29.6',
      'brace-expansion@1.1.12': '1.1.18',
      'brace-expansion@2.0.2': '2.1.4',
      'fast-xml-parser': '5.10.1',
      langsmith: '0.8.3',
      lodash: '4.18.1',
      'minimatch@3.1.2': '3.1.4',
      'nanoid@3.3.16': '3.3.18',
      postcss: '8.5.23',
      'sharp@0.34.5': '0.35.3',
      uuid: '11.1.1',
      ws: '8.21.1',
    });
    expect(lockfileSource).toContain('ws@8.21.1:');
    expect(lockfileSource).not.toContain('ws@8.19.0:');
    expect(lockfileSource).toContain('uuid@11.1.1:');
    expect(lockfileSource).not.toContain('uuid@8.3.2:');
  });

  it('removes only pptxgenjs unused vulnerable image-size dependency', () => {
    const hookPath = resolve(projectRoot, '.pnpmfile.cjs');
    expect(existsSync(hookPath)).toBe(true);
    const hooks = createRequire(import.meta.url)(hookPath).hooks as {
      readPackage: (pkg: Record<string, unknown>) => Record<string, unknown>;
    };
    const pptx = hooks.readPackage({
      name: 'pptxgenjs',
      version: '4.0.1',
      dependencies: { 'image-size': '^1.2.1', jszip: '^3.10.1' },
    }) as { dependencies: Record<string, string> };
    const unrelated = { name: 'other', version: '1.0.0', dependencies: { 'image-size': '^1.2.1' } };

    expect(pptx.dependencies).toEqual({ jszip: '^3.10.1' });
    expect(hooks.readPackage(unrelated)).toEqual(unrelated);
  });

  it('still creates a valid presentation after dependency pruning', async () => {
    const PptxGenJS = (await import('pptxgenjs')).default;
    const presentation = new PptxGenJS();
    presentation.addSlide().addText('Wujie dependency regression', { x: 1, y: 1, w: 6, h: 1 });

    const output = await presentation.write({ outputType: 'nodebuffer' }) as Buffer;

    expect(Buffer.isBuffer(output)).toBe(true);
    expect(output.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(output.byteLength).toBeGreaterThan(1_000);
  });
});
