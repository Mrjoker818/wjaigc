import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workspaceSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
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
  });

  it('does not serialize images or call UserManager updateProject during beforeunload', () => {
    const handlerStart = workspaceSource.indexOf('const handleBeforeUnload = () => {');
    const handlerEnd = workspaceSource.indexOf("window.addEventListener('beforeunload'", handlerStart);
    const handlerSource = workspaceSource.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerSource).toContain('getPreparedSnapshot(');
    expect(handlerSource).toContain('persistPreparedCanvasUnloadSnapshot(');
    expect(handlerSource).not.toContain('serializeCanvasWorkspacePlacements');
    expect(handlerSource).not.toContain('updateProject(');
    expect(handlerSource).not.toContain('JSON.stringify(');
    expect(handlerSource).not.toContain('keepalive: true');
  });

  it('records a recovery marker instead of sending pending data/blob media', () => {
    expect(workspaceSource).toContain('persistPreparedCanvasUnloadSnapshot(');
  });

  it('cancels an old project schedule and defers server-merge snapshots', () => {
    expect(workspaceSource).toContain('canvasPersistenceScheduler.cancel(previousProjectId)');
    expect(workspaceSource).toContain('if (serverSyncMergeRef.current) return;');
    expect(workspaceSource).toContain('serverSyncMergeRevision');
  });
});
