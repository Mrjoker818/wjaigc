import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');

describe('image-to-3d performance wiring', () => {
  it('uses a bounded wall-clock polling loop and forwards the selected 3D mode', () => {
    const handler = source.slice(
      source.indexOf('const handle3DConfirm'),
      source.indexOf('// 4. ERASE'),
    );

    expect(handler).toContain('THREE_D_TASK_TIMEOUT_MS');
    expect(handler).toContain('THREE_D_POLL_INTERVAL_MS');
    expect(handler).not.toContain('const maxAttempts = 300');
    expect(handler).toContain('mode: threeDMode');
  });

  it('uses the Meshy stream as an immediate completion signal with polling fallback', () => {
    expect(source).toContain('/api/image-to-3d/meshy-stream');
    expect(source).toContain('EventSource');
    expect(source).toContain('streamTerminalResult');
  });
});
