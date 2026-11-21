import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

function readThreeDHandlerSource(): string {
  const handlerStart = componentSource.indexOf('const handle3DConfirm = useCallback');
  const handlerEnd = componentSource.indexOf('const colorAdjustingRef = useRef(false);', handlerStart);
  expect(handlerStart).toBeGreaterThanOrEqual(0);
  expect(handlerEnd).toBeGreaterThan(handlerStart);
  return componentSource.slice(handlerStart, handlerEnd);
}

describe('image-to-3d terminal state contract', () => {
  it('keeps failed 3D tasks visible instead of deleting their processing card', () => {
    const handlerSource = readThreeDHandlerSource();
    const submittedTaskStart = handlerSource.indexOf('let placeholderId =');
    expect(submittedTaskStart).toBeGreaterThanOrEqual(0);
    const submittedTaskPath = handlerSource.slice(submittedTaskStart);

    expect(submittedTaskPath).toContain('const failThreeDGeneration');
    expect(submittedTaskPath).toContain('buildFailedProcessingFrame');
    expect(submittedTaskPath).toContain('updateProcessingFrame(placeholderId, failure)');
    expect(submittedTaskPath).toContain('toast.error(failure.error)');
    expect(submittedTaskPath).not.toContain('alert(');
    expect(submittedTaskPath).not.toContain('removeProcessingFrame(placeholderId)');
    expect((submittedTaskPath.match(/failThreeDGeneration\(/g) || []).length).toBeGreaterThanOrEqual(5);
  });

  it('closes the provider event stream before returning a terminal failure', () => {
    const handlerSource = readThreeDHandlerSource();

    expect(handlerSource).toContain('streamSource?.close();\n            failThreeDGeneration');
    expect(handlerSource).toContain('while (Date.now() - taskStartedAt < THREE_D_TASK_TIMEOUT_MS)');
    expect(handlerSource).toMatch(
      /streamSource\?\.close\(\);\s+if \(!previewUrl\) \{\s+failThreeDGeneration\([^\n]+\);\s+setThreeDProgress\(null\);\s+return;\s+\}/,
    );
  });
});
