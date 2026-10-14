// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SketchPanelSession, SketchScope } from '@/lib/sketch-to-code/client';
import type { SketchImagePanelSession } from '@/lib/sketch-to-code/image-client';

const observed = vi.hoisted(() => ({ panel: undefined as {
  session: SketchPanelSession; imageSession?: SketchImagePanelSession; onClose: () => void;
} | undefined }));
vi.mock('@/components/sketch-to-code-panel', () => ({
  SketchToCodePanel: (props: NonNullable<typeof observed.panel>) => {
    observed.panel = props;
    return React.createElement('section', { role: 'region', 'aria-label': 'entry observation only' });
  },
}));
import { InfiniteCanvas } from '@/components/infinite-canvas';

type CanvasProps = React.ComponentProps<typeof InfiniteCanvas>;
/** Execute only the two actual product JSX bindings; mount the real canvas.
 * This is entry wiring proof, not a full CanvasWorkspace/runtime or panel test. */
function actualProductBindings(scope: SketchScope, insert: NonNullable<CanvasProps['sketchContext']>['insert']):
  Pick<CanvasProps, 'sketchContext' | 'sketchImageEnabled'> {
  const source = readFileSync(path.resolve('src/components/canvas-workspace.tsx'), 'utf8');
  const file = ts.createSourceFile('canvas-workspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements: ts.JsxSelfClosingElement[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'InfiniteCanvas') elements.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (elements.length !== 1) throw new Error('Expected one actual product canvas entry');
  const fields = elements[0].attributes.properties.flatMap(attribute => {
    if (!ts.isJsxAttribute(attribute)) return [];
    const name = attribute.name.getText(file);
    if (name !== 'sketchContext' && name !== 'sketchImageEnabled') return [];
    if (!attribute.initializer) return [name + ': true'];
    if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) {
      throw new Error('Unexpected product sketch binding');
    }
    return [name + ': (' + attribute.initializer.expression.getText(file) + ')'];
  });
  const compiled = ts.transpileModule('return ({' + fields.join(',') + '});', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function('sketchContextKey', 'captureSketchScope', 'insertSketchResult', compiled)(
    scope.key, () => scope, insert,
  ) as Pick<CanvasProps, 'sketchContext' | 'sketchImageEnabled'>;
}

beforeEach((): void => {
  observed.panel = undefined;
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => { values.set(key, value); },
    removeItem: (key: string): void => { values.delete(key); },
  });
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {} unobserve(): void {} disconnect(): void {}
  });
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (): Promise<Response> => Response.json({})));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach((): void => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('actual product sketch entry bindings with real InfiniteCanvas and controlled panel', () => {
  it('opens dual creation from the product entry with the original project scope and no implicit paid work', async (): Promise<void> => {
    const current: SketchScope = { key: 'original-entry-key', actorId: 'original-actor',
      projectId: 'original-project', authority: 'legacy', assertCurrent: (): void => {} };
    const insert = vi.fn(async (): Promise<void> => {});
    const bindings = actualProductBindings(current, insert);
    const view = render(<InfiniteCanvas projectId={current.projectId} images={[]} selectedImage={null}
      onImagesChange={() => true} onSelectImage={() => {}} onPreviewImage={() => {}}
      onGenerateVariation={() => {}} onExtractKeywords={() => {}} onFusion={() => {}}
      onAddImages={() => {}} onRequestTaskPoll={async () => Response.json({})} {...bindings} />);
    const toolbar = view.container.querySelector('[data-toolbar="bottom-toolbar"]');
    if (!toolbar) throw new Error('Actual canvas toolbar missing');
    fireEvent.click(within(toolbar as HTMLElement).getByRole('button', { name: '全部工具' }));
    const drawer = document.getElementById('canvas-bottom-toolbar-drawer');
    if (!drawer) throw new Error('Actual canvas actions missing');
    fireEvent.click(within(drawer).getByRole('button', { name: '草图创作' }));
    await screen.findByRole('region', { name: 'entry observation only' });
    const panel = observed.panel;
    if (!panel?.imageSession) throw new Error('Product entry must pass the independent image session');
    expect(panel.session.client.scope).toBe(current);
    expect(panel.imageSession.client.scope).toEqual(current);
    expect(panel.imageSession.client.scope.assertCurrent).toBe(current.assertCurrent);
    expect(panel.imageSession.client).not.toBe(panel.session.client);
    expect(panel.imageSession).not.toHaveProperty('history');
    expect(bindings.sketchContext?.insert).toBe(insert);
    expect(insert).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => /sketch-to-|cancel-task/.test(String(url)))).toBe(false);
  });
});
