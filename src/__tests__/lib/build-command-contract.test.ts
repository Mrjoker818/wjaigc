import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('production build command', () => {
  it('uses a Webpack build with the WASM support required by vectorization', () => {
    const packageJson = JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const nextConfig = readFileSync(path.resolve(process.cwd(), 'next.config.ts'), 'utf8');

    expect(packageJson.scripts?.build).toBe('next build --webpack');
    expect(nextConfig).toContain("'@aws-sdk/client-s3'");
    expect(nextConfig).toContain("'@aws-sdk/lib-storage'");
    expect(nextConfig).toContain("request?.startsWith('@aws-sdk/')");
    expect(nextConfig).toContain("request?.startsWith('@langchain/')");
    expect(nextConfig).toContain("request === 'coze-coding-dev-sdk'");
    expect(readFileSync(path.resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8')).toContain("import('@/lib/vtracer-wasm-disabled')");
  });

  it('keeps preview startup off the Turbopack HMR path', () => {
    const packageJson = JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.dev).toBe('next dev --webpack -p 5000');
  });
});
