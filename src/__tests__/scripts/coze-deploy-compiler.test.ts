import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
};

describe('Coze legacy Next deployment compiler compatibility', () => {
  it('uses the Webpack artifact format for Coze without downgrading Next or dropping the build seals', () => {
    expect(pkg.dependencies.next).toBe('16.4.6');
    expect(pkg.scripts['build:coze']).toContain('next build --webpack');
    expect(pkg.scripts['build:coze']).not.toContain('--turbopack');
    expect(pkg.scripts['build:coze']).toMatch(/build-completion-marker\.mjs clear[\s\S]+next build --webpack[\s\S]+prune-build-traces\.mjs[\s\S]+build-completion-marker\.mjs seal/);
    expect(pkg.scripts.build).toContain('next build --turbopack');
  });

  it('routes only deployment builds through that compiler and retains the package checks', () => {
    const deploy = readFileSync('scripts/coze-deploy-build.sh', 'utf8');
    const preview = readFileSync('scripts/coze-preview-build.sh', 'utf8');
    expect(deploy).toMatch(/verify-deploy-package\.mjs --source[\s\S]+pnpm run build:coze[\s\S]+verify-deploy-package\.mjs --built/);
    expect(preview).not.toContain('pnpm run build:coze');
  });
});
