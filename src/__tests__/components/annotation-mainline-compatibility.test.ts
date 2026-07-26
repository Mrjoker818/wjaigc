import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('annotation upgrade compatibility with latest main', () => {
  test('keeps the display decompose workflow alongside the annotation composer', () => {
    const source = readSource('src/components/infinite-canvas.tsx');

    expect(source).toContain("import { AnnotationComposer } from '@/features/annotations/annotation-composer'");
    expect(source).toContain('DISPLAY_DECOMPOSE_SUPPORTED_RATIOS');
    expect(source).toContain('handleDisplayDecomposeConfirm');
    expect(source).toContain('<AnnotationComposer');
  });

  test('keeps vision results in Oh My Prompt until the user chooses to send them', () => {
    const source = readSource('src/components/canvas-workspace.tsx');
    const handlerStart = source.indexOf('const handleVisionPrompt = useCallback');
    const handlerEnd = source.indexOf('const handleCanvasExtractKeywords', handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handler).toContain('setVisionResult(data)');
    expect(handler).toContain('关键词已生成，请在灵感工坊中选择发送');
    expect(handler).not.toContain('setExternalPrompt(promptText)');
  });

  test('wires database idempotency into the real edit and credit boundary', () => {
    const source = readSource('src/app/api/edit/route.ts');
    const idempotencySource = readSource('src/lib/annotation-idempotency.ts');

    expect(source).toContain("request.headers.get('x-idempotency-key')");
    expect(source).toContain('claimAnnotationEditTask');
    expect(source).toContain('terminateCloudTaskAndRefund');
    expect(idempotencySource).toContain('createCloudTask');
    expect(idempotencySource).toContain('getCloudTaskForUserByIdempotencyKey');
  });

  test('uses the shared pinned downloader for every annotation image fetch', () => {
    const maskSource = readSource('src/lib/annotation-mask.ts');
    const identifySource = readSource('src/lib/identify-subject.ts');

    expect(maskSource).toContain('loadSafeImageInput');
    expect(maskSource).toContain('safeSharp');
    expect(identifySource).toContain('loadSafeImageInput');
    expect(identifySource).toContain('safeSharp');
    expect(identifySource).not.toContain('const resp = await fetch(imageUrl');
  });

  test('uses one abortable safe input path throughout the real edit route', () => {
    const source = readSource('src/app/api/edit/route.ts');

    expect(source).toContain('registerTaskAbortController');
    expect(source).toContain('loadSafeImageInput');
    expect(source).toContain('safeSharp');
    expect(source).toContain('completeCloudTask');
    expect(source).toContain('terminateCloudTaskAndRefund');
    expect(source).not.toContain('await fetch(image)');
    expect(source).not.toContain('await fetch(mask)');
    expect(source).not.toContain('await fetch(refFullUrl)');
  });
});
