import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const routeFile = path.resolve(process.cwd(), 'src/app/api/video/extract-frames/route.ts');

describe('video extract-frames storage contract', () => {
  it('stores returned frame URLs in the persistent public-media directory', () => {
    const source = readFileSync(routeFile, 'utf8');

    expect(source).toContain("import { getServerDataRoot } from '@/lib/server-data-root';");
    expect(source).toContain("join(getServerDataRoot(), 'uploads', 'video-frames')");
    expect(source).not.toContain("join(process.cwd(), 'public', 'api', 'serve-upload', 'video-frames')");
    expect(source).toContain('`/api/serve-upload/video-frames/${destName}`');
  });

  it('reads platform video URLs from the same persistent media storage', () => {
    const source = readFileSync(routeFile, 'utf8');

    expect(source).toContain('async function readPlatformVideo(videoUrl: string): Promise<Buffer | null>');
    expect(source).toContain("const uploadPath = resolveWithinDirectory(join(dataRoot, 'uploads'), requestedPath);");
    expect(source).toContain("const legacyPath = resolveWithinDirectory(dataRoot, requestedPath);");
    expect(source).toContain('const localBuffer = await readPlatformVideo(videoUrl);');
    expect(source).not.toContain("const localPath = join(process.cwd(), 'public', videoUrl.replace(/^\\//, ''));" );
  });
});
