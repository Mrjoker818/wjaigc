import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);

describe('upscale terminal state contract', () => {
  it('keeps all failed upscale requests as actionable failed processing cards', () => {
    const handlerStart = source.indexOf('const handleUpscaleConfirm = useCallback');
    const handlerEnd = source.indexOf('// Engine selection helper', handlerStart);
    const handlerSource = source.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('const failUpscale');
    expect(handlerSource).toContain('buildFailedProcessingFrame');
    expect(handlerSource).toContain('toast.error(failure.error)');
    expect(handlerSource).toContain('extractImageEditErrorMessage(JSON.stringify(data), res.status)');
    expect(handlerSource).not.toContain('alert(');
    expect(handlerSource).not.toContain('String(data.error');
    expect(handlerSource).not.toContain('setTimeout(() => removeProcessingFrame(placeholderId), 5000)');
    expect((handlerSource.match(/failUpscale\(/g) || []).length).toBeGreaterThanOrEqual(6);
  });
});
