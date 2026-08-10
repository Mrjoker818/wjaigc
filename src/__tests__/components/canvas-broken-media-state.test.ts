import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);

describe('canvas broken managed media state', () => {
  it('models managed-media failure without removing the canvas placement', () => {
    expect(source).toContain("mediaAvailability?: MediaAvailability;");
    expect(source).toContain('mediaErrorCode?: string;');
    expect(source).toContain("mediaAvailability: 'missing'");
  });

  it('renders a selectable fixed-size missing-media placeholder with retry and recovery actions', () => {
    expect(source).toContain('data-canvas-missing-media');
    expect(source).toContain('重试');
    expect(source).toContain('恢复');
    expect(source).toContain('retryMissingMedia(image);');
  });
});
