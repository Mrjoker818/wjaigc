import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('image-to-3d terminal state contract', () => {
  it('keeps failed 3D tasks visible instead of deleting their processing card', () => {
    const handlerStart = componentSource.indexOf('const handle3DConfirm = useCallback');
    const handlerEnd = componentSource.indexOf('// 4. ERASE', handlerStart);
    const handlerSource = componentSource.slice(handlerStart, handlerEnd);
    const submittedTaskPath = handlerSource.slice(handlerSource.indexOf('let placeholderId ='));

    expect(submittedTaskPath).toContain('const failThreeDGeneration');
    expect(submittedTaskPath).toContain('buildFailedProcessingFrame');
    expect(submittedTaskPath).toContain('updateProcessingFrame(placeholderId, failure)');
    expect(submittedTaskPath).toContain('toast.error(failure.error)');
    expect(submittedTaskPath).not.toContain('alert(');
    expect(submittedTaskPath).not.toContain('removeProcessingFrame(placeholderId)');
    expect((submittedTaskPath.match(/failThreeDGeneration\(/g) || []).length).toBeGreaterThanOrEqual(5);
  });

  it('closes the provider event stream before returning a terminal failure', () => {
    const handlerStart = componentSource.indexOf('const handle3DConfirm = useCallback');
    const handlerEnd = componentSource.indexOf('// 4. ERASE', handlerStart);
    const handlerSource = componentSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('streamSource?.close();\n            failThreeDGeneration');
  });
});
