import { readFileSync } from 'node:fs';
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
      next: '16.2.10',
      openai: '^6.48.0',
      ws: '8.21.1',
    });
    expect(packageJson.devDependencies).toMatchObject({
      'drizzle-kit': '^0.31.8',
      'eslint-config-next': '16.2.10',
      'form-data': '^4.0.6',
    });
    expect(packageJson.dependencies).not.toHaveProperty('drizzle-kit');
  });

  it('overrides audited vulnerable transitive packages with patched releases', () => {
    expect(packageJson.pnpm?.overrides).toMatchObject({
      axios: '1.18.1',
      '@babel/core': '7.29.6',
      'brace-expansion@1.1.12': '1.1.13',
      'brace-expansion@2.0.2': '2.0.3',
      'fast-xml-parser': '5.10.1',
      langsmith: '0.8.3',
      lodash: '4.18.1',
      'minimatch@3.1.2': '3.1.4',
      postcss: '8.5.20',
      ws: '8.21.1',
    });
    expect(lockfileSource).toContain('ws@8.21.1:');
    expect(lockfileSource).not.toContain('ws@8.19.0:');
  });
});
