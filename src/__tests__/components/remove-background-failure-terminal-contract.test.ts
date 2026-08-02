import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);

describe('remove-background processing terminal contract', () => {
  it('routes every submit failure exit through an explicit failed processing state', () => {
    const handlerStart = componentSource.indexOf('const handleRemoveBackground = useCallback');
    const handlerEnd = componentSource.indexOf('const handleOpenDisplayDecompose', handlerStart);
    const handlerSource = componentSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('const failRemoveBackground');
    expect(handlerSource).toContain('buildFailedProcessingFrame');
    expect(handlerSource).toContain('updateProcessingFrame(placeholderId, failure)');
    expect(handlerSource).toContain('toast.error(failure.error)');
    expect(handlerSource).not.toContain('alert(failRemoveBackground');
    expect(handlerSource).not.toContain('setTimeout(() => removeProcessingFrame(placeholderId), 5000)');
    expect((handlerSource.match(/failRemoveBackground\(/g) || []).length).toBeGreaterThanOrEqual(5);
    expect((handlerSource.match(/setIsEditProcessing\(false\);\s+return;/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
