import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const routeFiles = [
  'src/app/api/video/download/route.ts',
  'src/app/api/video/tools/route.ts',
  'src/app/api/video/extract-frame/route.ts',
  'src/app/api/video/extract-frames/route.ts',
];

describe('video remote source security contract', () => {
  it('uses the shared SSRF-safe media URL validator in every video downloader route', () => {
    const missingValidator = routeFiles.filter((routeFile) => {
      const source = readFileSync(path.resolve(process.cwd(), routeFile), 'utf8');
      return !source.includes("from '@/lib/api-validator'") || !source.includes('isSafeVideoSource');
    });

    expect(missingValidator).toEqual([]);
  });
});
