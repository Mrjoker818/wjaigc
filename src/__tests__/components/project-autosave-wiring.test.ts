import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workspaceSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');
const infiniteCanvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('project autosave wiring', () => {
  it('schedules structural canvas snapshots through the persistence scheduler', () => {
    expect(workspaceSource).toContain("from '@/lib/canvas-kernel/persistence'");
    expect(workspaceSource).toContain('new CanvasPersistenceScheduler(');
    expect(workspaceSource).toContain('canvasPersistenceScheduler.schedule(snapshot)');
    expect(workspaceSource).toContain("void canvasPersistenceScheduler.flush('immediate')");
  });

  it('consumes the command persistence hint for immediate mutations', () => {
    expect(workspaceSource).toContain('commandResult.persistence');
    expect(workspaceSource).toContain("persistenceHint === 'immediate'");
    expect(workspaceSource).toContain("persistenceHint === 'skip'");
  });

  it('does not debounce or serialize the whole project on the interaction path', () => {
    expect(workspaceSource).not.toContain('const autoSaveRef = useRef');
    expect(workspaceSource).not.toContain('lastAutoSaveSignatureRef');
    expect(workspaceSource).not.toContain('buildCanvasSaveSignature(');
    const builderStart = workspaceSource.indexOf('const buildCanvasPersistenceSnapshot = useCallback');
    const builderEnd = workspaceSource.indexOf('if (!canvasPersistenceSchedulerRef.current)', builderStart);
    const snapshotBuilder = workspaceSource.slice(builderStart, builderEnd);
    expect(snapshotBuilder).toContain('images: nextImages as unknown as ReadonlyArray<PersistableCanvasImage>');
    expect(snapshotBuilder).not.toContain('serializeCanvasWorkspacePlacements(');
    expect(workspaceSource.slice(builderEnd)).toContain('images: serializeCanvasWorkspacePlacements(');
  });

  it('keeps media persistence asynchronous and reschedules resolved URLs at a newer revision', () => {
    expect(workspaceSource).toContain('persistCanvasSnapshotMedia(');
    expect(workspaceSource).toContain('revision: nextCanvasPersistenceRevision()');
    expect(workspaceSource).toContain("img.url.startsWith('data:') || img.url.startsWith('blob:')");
    expect(workspaceSource).toContain('void persistDataUrls()');
    expect(workspaceSource).not.toContain('setTimeout(persistDataUrls, 2000)');
  });

  it('does not serialize images or call UserManager updateProject during beforeunload', () => {
    const handlerStart = workspaceSource.indexOf('const handleBeforeUnload =');
    const handlerEnd = workspaceSource.indexOf("window.addEventListener('beforeunload'", handlerStart);
    const handlerSource = workspaceSource.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerSource).toContain('preparePendingSnapshotForUnload(');
    expect(handlerSource).toContain('persistPreparedCanvasUnloadSnapshot(');
    expect(handlerSource).not.toContain('serializeCanvasWorkspacePlacements');
    expect(handlerSource).not.toContain('updateProject(');
    expect(handlerSource).not.toContain('JSON.stringify(');
    expect(handlerSource).not.toContain('keepalive: true');
  });

  it('records a recovery marker instead of sending pending data/blob media', () => {
    expect(workspaceSource).toContain('persistPreparedCanvasUnloadSnapshot(');
  });

  it('warns before leaving while temporary media is still being persisted', () => {
    const handlerStart = workspaceSource.indexOf('const handleBeforeUnload =');
    const handlerEnd = workspaceSource.indexOf("window.addEventListener('beforeunload'", handlerStart);
    const handlerSource = workspaceSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('prepared.hasPendingMedia');
    expect(handlerSource).toContain('event.preventDefault()');
    expect(handlerSource).toContain("event.returnValue = ''");
    expect(handlerSource.indexOf('event.preventDefault()'))
      .toBeLessThan(handlerSource.indexOf('persistPreparedCanvasUnloadSnapshot('));
    const catchSource = handlerSource.slice(handlerSource.indexOf('} catch (error) {'));
    expect(catchSource).toContain('event.preventDefault()');
    expect(catchSource).toContain("event.returnValue = ''");
  });

  it('consumes a newer emergency Canvas snapshot when a project is loaded', () => {
    expect(workspaceSource).toContain('consumePreparedCanvasUnloadSnapshot(');
    expect(workspaceSource).toContain('recoveredCanvasSnapshot');
    expect(workspaceSource).toContain('Boolean(recoveredCanvasSnapshot && pendingMediaMarker)');
  });

  it('forces the committed resize snapshot into the immediate persistence path', () => {
    const resizeStart = infiniteCanvasSource.indexOf('// Apply resize preview to images');
    const resizeEnd = infiniteCanvasSource.indexOf('setResizePreview(null)', resizeStart);
    const resizeSource = infiniteCanvasSource.slice(resizeStart, resizeEnd);

    expect(resizeStart).toBeGreaterThan(-1);
    expect(resizeSource).toContain("type: 'resize'");
    expect(resizeSource).toContain('onForceSave?.(');
  });

  it('keeps small user-data audit records alive across navigation without queuing large bodies', () => {
    const recordStart = workspaceSource.indexOf('function recordUserData(');
    const recordEnd = workspaceSource.indexOf('function getCanvasImageDisplaySize', recordStart);
    const recordSource = workspaceSource.slice(recordStart, recordEnd);

    expect(recordStart).toBeGreaterThan(-1);
    expect(workspaceSource).toContain('USER_DATA_RECORD_KEEPALIVE_BYTES');
    expect(recordSource).toContain('const requestBody = JSON.stringify(input);');
    expect(recordSource).toContain('new Blob([requestBody]).size <= USER_DATA_RECORD_KEEPALIVE_BYTES');
    expect(recordSource).toContain('sendUserDataRecord({ requestBody, keepalive: keepAliveAcrossNavigation })');
    expect(recordSource).toContain('if (keepAliveAcrossNavigation)');
    expect(recordSource.indexOf('if (keepAliveAcrossNavigation)'))
      .toBeLessThan(recordSource.indexOf('recordUserDataQueue ='));
    expect(recordSource).toContain('recordUserDataQueue');
    expect(recordSource).toContain('.finally(');
  });

  it('cancels an old project schedule and defers server-merge snapshots', () => {
    expect(workspaceSource).toContain('canvasPersistenceScheduler.cancel(previousProjectId)');
    expect(workspaceSource).toContain('if (serverSyncMergeRef.current) return;');
    expect(workspaceSource).toContain('serverSyncMergeRevision');
  });

  it('does not reload the model catalog when the same authenticated user object is rehydrated', () => {
    const loaderStart = workspaceSource.indexOf('const loadQuickCreateModels = async');
    const nextStateStart = workspaceSource.indexOf("const [ohMyPromptOpen", loaderStart);
    const loaderSource = workspaceSource.slice(loaderStart, nextStateStart);

    expect(loaderStart).toBeGreaterThan(-1);
    expect(workspaceSource).toContain('const quickCreateUserId = currentUser?.id;');
    expect(workspaceSource).toContain('const quickCreateModelAccessSignature = useMemo(');
    expect(loaderSource).toContain('[authChecked, quickCreateUserId, quickCreateModelAccessSignature]');
    expect(loaderSource).not.toContain('}, [authChecked, currentUser]);');
  });
});
