import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);

describe('image edit HTTP error contract', () => {
  it('keeps structured backend errors visible instead of replacing them with a generic HTTP error', () => {
    const handlerStart = source.indexOf('const controller = new AbortController();');
    const handlerEnd = source.indexOf('let data: ImageEditResponse', handlerStart);
    const handlerSource = source.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('extractImageEditErrorMessage');
    expect(handlerSource).toContain('translateErrorFrontend');
  });
});
