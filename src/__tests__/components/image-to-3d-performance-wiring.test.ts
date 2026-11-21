import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');

describe('image-to-3d performance wiring', () => {
  it('uses a bounded wall-clock polling loop and forwards the selected 3D mode', () => {
    const handlerStart = source.indexOf('const handle3DConfirm = useCallback');
    const handlerEnd = source.indexOf('const colorAdjustingRef = useRef(false);', handlerStart);
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handler).toContain('THREE_D_TASK_TIMEOUT_MS');
    expect(handler).toContain('THREE_D_POLL_INTERVAL_MS');
    expect(handler).toContain('const taskStartedAt = Date.now();');
    expect(handler).toContain('while (Date.now() - taskStartedAt < THREE_D_TASK_TIMEOUT_MS)');
    expect(handler).not.toContain('const maxAttempts = 300');
    expect(handler).toContain('mode: threeDMode');
  });

  it('uses the Meshy stream as an immediate completion signal with polling fallback', () => {
    expect(source).toContain('/api/image-to-3d/meshy-stream');
    expect(source).toContain('EventSource');
    expect(source).toContain('streamTerminalResult');
  });
});
