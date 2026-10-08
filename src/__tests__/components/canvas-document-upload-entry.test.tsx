// @vitest-environment jsdom
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InfiniteCanvas } from '@/components/infinite-canvas';
import type { CanvasImage } from '@/components/infinite-canvas';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { jsdomCrypto as webcrypto } from '../helpers/jsdom-native-web-boundary';
import ts from 'typescript';
import { commitDocumentCanvasFile, DocumentCanvasUploadError, loadDocumentCanvasVideoSize,
  uniqueDocumentCanvasFiles } from '@/lib/collaboration/document-canvas-upload';

beforeEach(() => {
  const items = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
    clear: () => { items.clear(); },
  });
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });

// Execute the actual Workspace callback and its size/layout functions. Only
// HTTP, React refs, and browser decoding are controlled external boundaries.
function workspaceFunction<T>(name: string, bindings: Record<string, unknown> = {}): T {
  const path = resolve('src/components/canvas-workspace.tsx');
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let text: string | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(source);
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name
      && node.initializer && ts.isCallExpression(node.initializer)) {
      text = `const ${name} = ${node.initializer.arguments[0].getText(source)};`;
    }
    if ((name === 'cleanupDocumentUpload' || name === 'cleanupDocumentUploadLayout') && ts.isCallExpression(node)
      && node.expression.getText(source) === (name === 'cleanupDocumentUploadLayout' ? 'useLayoutEffect' : 'useEffect')
      && node.arguments[0]?.getText(source).includes('documentUploadControllerRef')) {
      text = `const ${name} = (${node.arguments[0].getText(source)})();`;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!text && name.startsWith('cleanupDocumentUpload')) return (() => {}) as T;
  if (!text) throw new Error(`Workspace function missing: ${name}`);
  const js = ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
  } }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return ${name};`)(...Object.values(bindings)) as T;
}

interface WorkspaceUploadFixture {
  upload: (files: File[]) => Promise<void>;
  actor: { current: { id: string } }; project: { current: { id: string } };
  epoch: { current: number }; historyProject: { current: string };
  pending: { current: boolean }; recovery: { current: boolean };
  liveWritable: { current: boolean };
  documentRef: { current: { projectId: string; authority: string; status: string; recordMediaHistory: () => void;
    isWritable: () => boolean;
    refreshMedia: (input: { projectId: string; documentSequence: number }) => Promise<CanvasImage[]> } };
  requests: RequestInit[]; successes: string[]; messages: string[]; decoded: HTMLElement[];
  refreshCalls: Array<{ projectId: string; documentSequence: number }>;
  stop: () => void; decode: () => void; confirm: () => void; unmount: () => void; layoutUnmount: () => void;
}

function workspaceUploadFixture(options: { manualDecode?: boolean; deferProjection?: boolean;
  staleRenderOnRefresh?: boolean } = {}): WorkspaceUploadFixture {
  vi.stubGlobal('crypto', webcrypto);
  const decoded: HTMLElement[] = [];
  const createElement = document.createElement.bind(document);
  vi.spyOn(document as { createElement: (tag: string, options?: ElementCreationOptions) => HTMLElement }, 'createElement')
    .mockImplementation((tag: string, elementOptions?: ElementCreationOptions): HTMLElement => {
    const element = createElement(tag, elementOptions);
    if (tag === 'video') {
      Object.defineProperties(element, { videoWidth: { value: 32 }, videoHeight: { value: 24 } });
      decoded.push(element);
      if (!options.manualDecode) queueMicrotask(() => element.dispatchEvent(new Event('loadedmetadata')));
    }
    return element;
  });
  vi.stubGlobal('Image', function (): HTMLImageElement {
    const image = createElement('img'); decoded.push(image);
    if (!options.manualDecode) queueMicrotask(() => image.dispatchEvent(new Event('error')));
    return image;
  });
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:decode', revokeObjectURL: (): void => {} });
  const actor = { current: { id: 'actor-a' } }, project = { current: { id: 'project-a' } };
  const epoch = { current: 7 }, historyProject = { current: 'project-a' };
  const pending = { current: false }, recovery = { current: false };
  const liveWritable = { current: true };
  const uploadController = { current: null as AbortController | null };
  const requests: RequestInit[] = [], successes: string[] = [], messages: string[] = [];
  let stop: (() => void) | undefined;
  let confirm: ((images: CanvasImage[]) => void) | undefined;
  const projection: CanvasImage[] = [{ id: 'placement-a', placementId: 'placement-a', assetVersionId: 'version-a',
    url: '', videoUrl: '/api/serve-upload/clip.mp4', mediaType: 'video', x: 584, y: 388, width: 32, height: 24,
    originalWidth: 32, originalHeight: 24, rotation: 0, zIndex: 1, createdAt: 1 }];
  const refreshCalls: Array<{ projectId: string; documentSequence: number }> = [];
  const documentRef = { current: { projectId: 'project-a', authority: 'document', status: 'saved',
    isWritable: (): boolean => liveWritable.current,
    recordMediaHistory: (): void => {},
    refreshMedia: async (input: { projectId: string; documentSequence: number }): Promise<CanvasImage[]> => {
      refreshCalls.push(input);
      if (options.staleRenderOnRefresh) documentRef.current.status = 'unavailable';
      return options.deferProjection ? new Promise<CanvasImage[]>(resolve => { confirm = resolve; }) : projection;
    } } };
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit): Promise<Response> => {
    requests.push(init);
    return new Response(JSON.stringify({ success: true, placementId: 'placement-a', assetVersionId: 'version-a',
      documentSequence: 9, assetReference: { assetId: 'asset-a', assetVersionId: 'version-a', placementId: 'placement-a',
        entityId: 'entity-a', kind: 'video', url: '/api/serve-upload/clip.mp4' } }), { status: 200 });
  });
  const upload = workspaceFunction<(files: File[]) => Promise<void>>('handleDocumentCanvasFiles', {
    currentUserRef: actor, currentProjectRef: project, historyProjectIdRef: historyProject,
    historyTransitionEpochRef: epoch, collaborativeCanvasRef: documentRef,
    historyLifecyclePendingRef: pending, isDocumentHistoryRecoveryPending: (): boolean => recovery.current,
    documentUploadControllerRef: uploadController,
    documentUploadBusyRef: { current: false }, latestImagesRef: { current: [] },
    uniqueDocumentCanvasFiles, commitDocumentCanvasFile, DocumentCanvasUploadError, loadDocumentCanvasVideoSize,
    loadCanvasImageSize: workspaceFunction('loadCanvasImageSize'),
    getCanvasImageDisplaySize: workspaceFunction('getCanvasImageDisplaySize'),
    autoLayoutImages: workspaceFunction('autoLayoutImages'),
    toast: { warning: (message: string): void => { messages.push(message); },
      error: (message: string): void => { messages.push(message); }, info: (message: string): void => { messages.push(message); },
      success: (message: string): void => { successes.push(message); }, dismiss: (): void => {},
      loading: (_message: string, input: { action: { onClick: () => void } }): string => { stop = input.action.onClick; return 'busy'; } },
  });
  const layoutUnmount = workspaceFunction<() => void>('cleanupDocumentUploadLayout', { documentUploadControllerRef: uploadController });
  const passiveUnmount = workspaceFunction<() => void>('cleanupDocumentUpload', { documentUploadControllerRef: uploadController });
  return { upload, actor, project, epoch, historyProject, pending, recovery, liveWritable, documentRef, requests, successes,
    refreshCalls, messages, decoded, stop: (): void => stop?.(),
    decode: (): void => { for (const node of decoded) node.dispatchEvent(new Event(node.tagName === 'VIDEO' ? 'loadedmetadata' : 'error')); },
    confirm: (): void => confirm?.(projection),
    layoutUnmount, unmount: (): void => { layoutUnmount(); passiveUnmount(); } };
}

describe('actual Workspace document video intake', () => {
  const video = (): File => new File(['video'], 'clip.mp4', { type: 'video/mp4' });
  it('confirms uploaded media using live readiness rather than a stale unavailable render', async () => {
    const f = workspaceUploadFixture({ staleRenderOnRefresh: true });
    await f.upload([video()]);
    expect(f.documentRef.current.status).toBe('unavailable');
    expect(f.requests).toHaveLength(1); expect(f.successes).toHaveLength(1);
    expect(sessionStorage.length).toBe(0);
  });
  it('blocks a saved-looking but disconnected live session before POST', async () => {
    const f = workspaceUploadFixture({ manualDecode: true });
    const operation = f.upload([video()]).catch(() => undefined);
    await waitFor(() => expect(f.decoded).toHaveLength(1));
    f.liveWritable.current = false; f.decode(); await operation;
    expect(f.documentRef.current.status).toBe('saved');
    expect(f.requests).toHaveLength(0); expect(f.successes).toHaveLength(0);
  });
  it('cancels preparation in the layout-to-passive unmount window', async () => {
    const f = workspaceUploadFixture({ manualDecode: true });
    const operation = f.upload([video()]).catch(() => undefined);
    await waitFor(() => expect(f.decoded).toHaveLength(1));
    f.layoutUnmount(); f.decode(); await operation;
    expect(f.requests).toHaveLength(0); expect(f.successes).toHaveLength(0);
  });
  it('lays out a 32 by 24 video at its decoded size rather than the image-error square', async () => {
    const f = workspaceUploadFixture(); await f.upload([video()]);
    const headers = new Headers(f.requests[0].headers);
    const metadata = JSON.parse(atob(headers.get('x-wujie-asset-import')!.replace(/-/g, '+').replace(/_/g, '/')));
    expect(metadata.command.transform).toEqual({ x: 584, y: 388, width: 32, height: 24, rotation: 0, zIndex: 1 });
  });
  it('submits native video geometry and the frozen actor, then confirms the exact projection', async () => {
    const f = workspaceUploadFixture(); const file = video();
    await f.upload([file]);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].body).toBe(file);
    const headers = new Headers(f.requests[0].headers);
    expect(headers.get('x-wujie-expected-actor-id')).toBe('actor-a');
    const metadata = JSON.parse(atob(headers.get('x-wujie-asset-import')!.replace(/-/g, '+').replace(/_/g, '/')));
    expect(metadata.command.transform).toEqual({ x: 584, y: 388, width: 32, height: 24, rotation: 0, zIndex: 1 });
    expect(f.refreshCalls).toEqual([{ projectId: 'project-a', documentSequence: 9 }]);
    expect(f.successes).toHaveLength(1);
  });
  it.each(['actor', 'project', 'epoch', 'generation', 'refresh'] as const)('does not submit after %s changes during decoding', async (scope) => {
    const f = workspaceUploadFixture({ manualDecode: true });
    const operation = f.upload([video()]).catch(() => undefined);
    await waitFor(() => expect(f.decoded).toHaveLength(1));
    if (scope === 'actor') f.actor.current = { id: 'actor-b' };
    if (scope === 'project') f.project.current = { id: 'project-b' };
    if (scope === 'epoch') f.epoch.current += 1;
    if (scope === 'generation') f.documentRef.current = { ...f.documentRef.current, recordMediaHistory: (): void => {} };
    if (scope === 'refresh') f.documentRef.current = { ...f.documentRef.current, refreshMedia: async () => [] };
    f.decode(); await operation;
    expect(f.requests).toHaveLength(0); expect(f.successes).toHaveLength(0);
  });
  it.each(['pending', 'recovery'] as const)('does not upload while history %s is unresolved', async (state) => {
    const f = workspaceUploadFixture(); f[state].current = true;
    await f.upload([video()]).catch(() => undefined);
    expect(f.requests).toHaveLength(0); expect(f.successes).toHaveLength(0);
  });
  it('does not upload when recovery starts while decoding', async () => {
    const f = workspaceUploadFixture({ manualDecode: true });
    const operation = f.upload([video()]).catch(() => undefined);
    await waitFor(() => expect(f.decoded).toHaveLength(1));
    f.recovery.current = true; f.decode(); await operation;
    expect(f.requests).toHaveLength(0); expect(f.successes).toHaveLength(0);
  });
  it('does not announce success or clear the intent if the actor changes during projection confirmation', async () => {
    const f = workspaceUploadFixture({ deferProjection: true });
    const operation = f.upload([video()]).catch(() => undefined);
    await waitFor(() => expect(f.refreshCalls).toHaveLength(1));
    f.actor.current = { id: 'actor-b' }; f.confirm(); await operation;
    expect(f.successes).toHaveLength(0);
    expect(sessionStorage.length).toBe(1);
  });
  it('waits for authoritative media confirmation before announcing success', async () => {
    const f = workspaceUploadFixture({ deferProjection: true });
    const operation = f.upload([video()]);
    await waitFor(() => expect(f.refreshCalls).toHaveLength(1));
    expect(f.successes).toHaveLength(0); f.confirm(); await operation;
    expect(f.successes).toHaveLength(1);
  });
  it('stops during decoding without an upload or a success message', async () => {
    const f = workspaceUploadFixture({ manualDecode: true });
    const operation = f.upload([video()]).catch(() => undefined);
    await waitFor(() => expect(f.decoded).toHaveLength(1));
    f.stop(); f.decode(); await operation;
    expect(f.requests).toHaveLength(0); expect(f.successes).toHaveLength(0);
  });
  it.each(['fingerprint', 'metadata'] as const)('never submits after Workspace unmounts during %s preparation', async (stage) => {
    const f = workspaceUploadFixture({ manualDecode: stage === 'metadata' });
    const operation = f.upload([video()]).catch(() => undefined);
    if (stage === 'metadata') await waitFor(() => expect(f.decoded).toHaveLength(1));
    f.unmount(); f.decode(); await operation;
    expect(f.requests).toHaveLength(0); expect(f.successes).toHaveLength(0);
  });
});

function renderUploadCanvas(authority: 'document' | 'legacy' | 'unknown') {
  const onUploadFiles = vi.fn(async () => undefined);
  const onAddImages = vi.fn();
  const view = render(<InfiniteCanvas
    images={[]}
    onImagesChange={() => undefined}
    selectedImage={null}
    onSelectImage={() => undefined}
    onPreviewImage={() => undefined}
    onGenerateVariation={() => undefined}
    onExtractKeywords={() => undefined}
    onFusion={() => undefined}
    onAddImages={onAddImages}
    onUploadFiles={onUploadFiles}
    uploadAuthority={authority}
    projectId="project-a"
    onRequestTaskPoll={async () => new Response('{}')}
  />);
  return { ...view, onUploadFiles, onAddImages };
}

describe('InfiniteCanvas file entry in document mode', () => {
  it('offers existing server video formats in the document file picker only', async () => {
    const documentView = renderUploadCanvas('document');
    await act(async () => { await Promise.resolve(); });
    const accept = documentView.getByTestId('canvas-image-upload-input').getAttribute('accept')?.split(',');
    expect(accept).toEqual(expect.arrayContaining(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']));
    documentView.unmount();
    const personalView = renderUploadCanvas('legacy');
    await act(async () => { await Promise.resolve(); });
    expect(personalView.getByTestId('canvas-image-upload-input').getAttribute('accept')).toBe('image/*');
  });

  it('delivers a dropped video/image batch without creating legacy image data URLs', async () => {
    const { container, onUploadFiles, onAddImages } = renderUploadCanvas('document');
    const video = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    const image = new File(['png'], 'a.png', { type: 'image/png' });
    fireEvent.drop(container.querySelector('[data-canvas-viewport]')!, { dataTransfer: { files: [video, image] } });
    await waitFor(() => expect(onUploadFiles).toHaveBeenCalledWith([video, image]));
    expect(onAddImages).not.toHaveBeenCalled();
  });

  it('never treats a personal-canvas video selection as a base64 image', async () => {
    const { getByTestId, onUploadFiles, onAddImages } = renderUploadCanvas('legacy');
    fireEvent.change(getByTestId('canvas-image-upload-input'), {
      target: { files: [new File(['video'], 'clip.mp4', { type: 'video/mp4' })] },
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(onAddImages).not.toHaveBeenCalled();
    expect(onUploadFiles).not.toHaveBeenCalled();
  });

  it('delivers the selected original File to the document uploader without adding a legacy image', async () => {
    const { getByTestId, onUploadFiles, onAddImages } = renderUploadCanvas('document');
    const file = new File(['png'], 'a.png', { type: 'image/png' });
    fireEvent.change(getByTestId('canvas-image-upload-input'), { target: { files: [file] } });
    await waitFor(() => expect(onUploadFiles).toHaveBeenCalledWith([file]));
    expect(onAddImages).not.toHaveBeenCalled();
  });

  it('delivers a dropped original File to the document uploader without adding a legacy image', async () => {
    const { container, onUploadFiles, onAddImages } = renderUploadCanvas('document');
    const file = new File(['png'], 'a.png', { type: 'image/png' });
    fireEvent.drop(container.querySelector('[data-canvas-viewport]')!, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(onUploadFiles).toHaveBeenCalledWith([file]));
    expect(onAddImages).not.toHaveBeenCalled();
  });

  it('does not route to legacy while document authority is unresolved', async () => {
    const { getByTestId, onUploadFiles, onAddImages } = renderUploadCanvas('unknown');
    fireEvent.change(getByTestId('canvas-image-upload-input'), {
      target: { files: [new File(['png'], 'a.png', { type: 'image/png' })] },
    });
    await act(async () => { await Promise.resolve(); });
    expect(onUploadFiles).not.toHaveBeenCalled();
    expect(onAddImages).not.toHaveBeenCalled();
  });

  it('does not fall back to a legacy image when document upload rejects', async () => {
    const { getByTestId, onUploadFiles, onAddImages } = renderUploadCanvas('document');
    onUploadFiles.mockRejectedValueOnce(new Error('not authorized'));
    fireEvent.change(getByTestId('canvas-image-upload-input'), {
      target: { files: [new File(['png'], 'a.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(onUploadFiles).toHaveBeenCalledTimes(1));
    expect(onAddImages).not.toHaveBeenCalled();
  });

  it('keeps the existing personal canvas upload path', async () => {
    const { getByTestId, onUploadFiles, onAddImages } = renderUploadCanvas('legacy');
    fireEvent.change(getByTestId('canvas-image-upload-input'), {
      target: { files: [new File(['png'], 'a.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(onAddImages).toHaveBeenCalledWith(['data:image/png;base64,cG5n']));
    expect(onUploadFiles).not.toHaveBeenCalled();
  });
});
