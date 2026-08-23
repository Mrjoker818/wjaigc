import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLIENT_GENERATION_ENTRIES = [
  'src/components/canvas-workspace.tsx',
  'src/components/infinite-canvas.tsx',
  'src/components/chat-panel.tsx',
  'src/components/scene-studio-panel.tsx',
  'src/components/sticker-assistant-panel.tsx',
];

describe('client generation output entry contract', () => {
  it.each(CLIENT_GENERATION_ENTRIES)('%s resolves the shared output preference', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(source).toContain('withClientImageOutputPreference(');
  });

  it('keeps the main generation panel fields in the canvas submission path', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
      'utf8',
    );
    expect(source).toContain('background: params.background');
    expect(source).toContain('outputFormat: params.outputFormat');
  });
});
