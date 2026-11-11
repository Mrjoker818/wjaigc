import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCanvasViewState } from '@/lib/canvas-view-state';
import { actualTransferCallback, contractDeferred } from '../helpers/canvas-chat-transfer-contract-fixture';

const workspace = readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');
const canvas = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');
const zoomCluster = readFileSync(resolve(process.cwd(), 'src/components/canvas/CanvasZoomCluster.tsx'), 'utf8');

describe('canvas project reopen contract', () => {
  it.each(['unavailable', 'cancelled'] as const)('keeps the original canvas history when a project load is %s', async result => {
    const response = contractDeferred<unknown>();
    const activeLoad = { current: null as object | null };
    const history = { current: { clear: vi.fn() } };
    const epoch = { current: 3 };
    const compile = { current: { abort: vi.fn() } };
    const setImages = vi.fn();
    const load = actualTransferCallback<(id: string) => Promise<boolean | undefined>>('loadProjectById', {
      projectLoadActiveRef: { current: true }, canvasChatProjectLoadRef: activeLoad,
      selectedHubWorkflowScopeRef: { current: 'actor:original' },
      historyTransitionEpochRef: epoch, activeHistoryTransitionRef: { current: null },
      historyLifecyclePendingRef: { current: false }, setHistoryTransitionPending: vi.fn(),
      queuedCanvasHistoryChangeRef: { current: null }, historyProjectIdRef: { current: 'original' },
      incrementalHistoryRef: history, prevImagesRef: { current: [] },
      quickCreateCompileControllerRef: compile, setQuickCreateCompileState: vi.fn(), EMPTY_QUICK_CREATE_COMPILE_STATE: {},
      UserManagerCore: { getInstance: () => ({ getProjects: () => [] }) },
      readInvitedCollaborativeWorkspace: () => response.promise,
      projectLoadGateRef: { current: { resolve: async (read: () => Promise<unknown>) => ({ value: await read(), isCurrent: () => true }) } },
      setImages,
    });

    const pending = load('other');
    if (result === 'cancelled') activeLoad.current = null;
    response.release(result === 'cancelled' ? { id: 'other' } : null);
    expect(await pending).toBeUndefined();
    expect(history.current.clear).not.toHaveBeenCalled();
    expect(epoch.current).toBe(3);
    expect(compile.current.abort).not.toHaveBeenCalled();
    expect(setImages).not.toHaveBeenCalled();
  });

  it('restores saved project viewport state on every project-load path', () => {
    const loadProjectStart = workspace.indexOf('const loadProjectById = useCallback');
    const loadProjectEnd = workspace.indexOf('const [appMode', loadProjectStart);
    const loadProject = workspace.slice(loadProjectStart, loadProjectEnd);

    expect(loadProject).toContain('normalizeCanvasViewState(targetProject.metadata?.viewState)');
    expect(loadProject).toContain('viewStateRef.current = restoredViewState');
  });

  it('persists the viewport state in immediate image-change saves', () => {
    const snapshotStart = workspace.indexOf('const buildCanvasPersistenceSnapshot = useCallback');
    const snapshotEnd = workspace.indexOf('if (!canvasPersistenceSchedulerRef.current)', snapshotStart);
    const snapshotBuilder = workspace.slice(snapshotStart, snapshotEnd);
    const persistenceStart = workspace.indexOf('const persistCanvasImagesNow = useCallback');
    const persistenceEnd = workspace.indexOf('const handleDeleteCanvasImages', persistenceStart);
    const persistence = workspace.slice(persistenceStart, persistenceEnd);
    const forceSaveStart = workspace.indexOf('onForceSave={(nextImages) => {');
    const forceSaveEnd = workspace.indexOf('onEditImage={handleEditImage}', forceSaveStart);
    const forceSave = workspace.slice(forceSaveStart, forceSaveEnd);

    expect(snapshotBuilder).toContain('viewState: viewStateRef.current');
    expect(persistence).toContain('buildCanvasPersistenceSnapshot(nextImages, project)');
    expect(forceSave).toContain('persistCanvasImagesNow(nextImages)');
  });

  it('uses content fitting rather than resetting every populated project to the origin', () => {
    expect(canvas).toContain("import { normalizeCanvasViewState, resolveCanvasUsableViewportSize } from '@/lib/canvas-view-state';");
    expect(canvas).toMatch(/import\s*\{[\s\S]*?\buseCanvasViewport\b[\s\S]*?\}\s*from\s*['"]@\/components\/canvas\/use-canvas-viewport['"]/);
    expect(canvas).toContain('fitContent: fitViewportContent');
    expect(canvas).toContain('const resetViewToContent = useCallback');
    expect(canvas).toContain('fitViewportContent(');
    expect(canvas).toContain('imagesRef.current.filter((image) => !image.isProcessingPlaceholder)');
    expect(canvas).toContain('onResetView={resetViewToContent}');
    expect(zoomCluster).toContain('onClick={onResetView}');
    expect(canvas).not.toContain('onClick={() => { setZoom(1); setViewOffset({ x: 0, y: 0 }); }}');
  });

  it.each(['untouched', 'manual pan', 'saved view'] as const)(
    'handles late document media after an initially empty %s viewport', scenario => {
      const start = canvas.indexOf('const initialProjectViewRef = useRef');
      const end = canvas.indexOf('// Keep the stable index', start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const { outputText } = ts.transpileModule(`(() => { ${canvas.slice(start, end)} })()`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      });
      const initialization = { current: null };
      const scope = {
        useRef: () => initialization,
        useEffect: (effect: () => void) => effect(),
        requestAnimationFrame: (effect: () => void) => effect(),
        canvasContainerRef: { current: {} },
        viewportPanPointerIdRef: { current: null },
        projectId: 'collaboration-test-project',
        images: [] as Array<{ isProcessingPlaceholder: boolean }>,
        zoom: 1,
        viewOffset: { x: 0, y: 0 },
        initialViewState: scenario === 'saved view' ? { offsetX: -20, offsetY: 40, zoom: 0.5 } : undefined,
        normalizeCanvasViewState,
        applyViewState: vi.fn(),
        resetViewToContent: vi.fn(),
      };

      runInNewContext(outputText, scope);
      expect(scope.resetViewToContent).not.toHaveBeenCalled();
      if (scenario === 'manual pan') scope.viewOffset = { x: 15, y: 35 };
      scope.images = [{ isProcessingPlaceholder: false }];
      runInNewContext(outputText, scope);
      runInNewContext(outputText, scope);

      expect(scope.resetViewToContent).toHaveBeenCalledTimes(scenario === 'untouched' ? 1 : 0);
      expect(scope.applyViewState).toHaveBeenCalledTimes(scenario === 'saved view' ? 1 : 0);
    },
  );

  it('hydrates persisted canvas images through the asset placement adapter', () => {
    expect(workspace).toContain("from '@/lib/asset-core/canvas-adapter';");
    expect(workspace).toContain('hydrateCanvasPlacements');
    expect(workspace).toContain('const visibleTargetImages = hydratedTargetImages.filter(shouldPersistCanvasPlacement);');
    expect(workspace).toContain('setImages(visibleTargetImages.map(img => ({');
  });
});
