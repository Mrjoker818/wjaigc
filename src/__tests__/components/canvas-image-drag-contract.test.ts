import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);

describe('canvas image drag activation', () => {
  it('activates a selected image drag on pointer down instead of requiring a long press', () => {
    expect(source).toContain('imageDragReadyRef.current = true;');
    expect(source).not.toContain('Start long press timer for drag');
    expect(source).not.toContain('imageDragReadyRef.current = true;\n      }, 200);');
  });

  it('publishes and force-saves the same committed drag snapshot', () => {
    expect(source).toContain('imagesRef.current = updatedImages;');
    expect(source).toContain('onForceSave?.(updatedImages);');
  });
});
