import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const autoSaveSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
);

describe('project autosave wiring', () => {
  it('does not reschedule itself by writing currentProject from the autosave callback', () => {
    expect(autoSaveSource).toContain('const project = currentProjectRef.current');
    expect(autoSaveSource).not.toContain('setCurrentProject(prev => prev ?');
    expect(autoSaveSource).not.toMatch(/\}, \[images, currentProject,/);
  });

  it('deduplicates unchanged project payloads before recording cloud autosaves', () => {
    expect(autoSaveSource).toContain('lastAutoSaveSignatureRef');
    expect(autoSaveSource).toContain('if (lastAutoSaveSignatureRef.current === saveSignature) return;');
  });

  it('serializes placements without filtering unavailable managed media from autosave', () => {
    expect(autoSaveSource).toContain('serializeCanvasWorkspacePlacements(resolvedImages)');
    expect(autoSaveSource).toContain('shouldRetainCanvasPlacementDuringMerge(img)');
  });

  it('keeps the unload local draft but skips a competing remote write while sync is in flight', () => {
    const handlerStart = autoSaveSource.indexOf('const handleBeforeUnload = () => {');
    const handlerEnd = autoSaveSource.indexOf("window.addEventListener('beforeunload'", handlerStart);
    const handlerSource = autoSaveSource.slice(handlerStart, handlerEnd);
    const localCommit = handlerSource.indexOf('mgr.updateProject(proj.id');
    const inFlightGuard = handlerSource.indexOf('if (mgr.isProjectSyncInFlight()) return;');
    const beacon = handlerSource.indexOf("navigator.sendBeacon('/api/user-data/sync', blob)");

    expect(handlerStart).toBeGreaterThan(-1);
    expect(localCommit).toBeGreaterThan(-1);
    expect(inFlightGuard).toBeGreaterThan(localCommit);
    expect(beacon).toBeGreaterThan(inFlightGuard);
    expect(handlerSource).toContain('keepalive: true');
  });

  it('preserves the project schema version in the emergency unload snapshot', () => {
    const handlerStart = autoSaveSource.indexOf('const handleBeforeUnload = () => {');
    const handlerEnd = autoSaveSource.indexOf("window.addEventListener('beforeunload'", handlerStart);
    const handlerSource = autoSaveSource.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerSource).toContain('schemaVersion: p.schemaVersion ?? 3');
  });

  it('does not send an emergency project snapshot when the canvas has no pending mutation', () => {
    const handlerStart = autoSaveSource.indexOf('const handleBeforeUnload = () => {');
    const handlerEnd = autoSaveSource.indexOf("window.addEventListener('beforeunload'", handlerStart);
    const handlerSource = autoSaveSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('const hasPendingCanvasSnapshot =');
    expect(handlerSource).toContain('if (!autoSaveRef.current || !hasPendingCanvasSnapshot) return;');
    expect(autoSaveSource).toContain('autoSaveRef.current = null;');
  });

  it('clears cancelled autosave handles and suppresses the matching immediate-save snapshot', () => {
    expect(autoSaveSource).toContain('if (autoSaveRef.current) {');
    expect(autoSaveSource).toContain('clearTimeout(autoSaveRef.current);');
    expect(autoSaveSource).toContain('autoSaveRef.current = null;');
    expect(autoSaveSource).toContain('immediateSaveGuardRef.current = createCanvasHydrationGuard(');
    expect(autoSaveSource).toContain('consumeCanvasHydrationGuard(\n      immediateSaveGuardRef.current,');
    expect(autoSaveSource).toContain('lastImmediateSaveSignatureRef.current = buildCanvasSaveSignature(');
    expect(autoSaveSource).toContain('lastAutoSaveSignatureRef.current = lastImmediateSaveSignatureRef.current;');
    expect(autoSaveSource).toContain('lastAutoSaveSignatureRef.current !== unloadSignature;');

    const immediateGuardStart = autoSaveSource.indexOf('const immediateSaveGuard = consumeCanvasHydrationGuard(');
    const immediateGuardEnd = autoSaveSource.indexOf('if (immediateSaveGuard.suppress)', immediateGuardStart);
    const immediateGuard = autoSaveSource.slice(immediateGuardStart, immediateGuardEnd);
    expect(immediateGuard).toContain('immediateSaveGuardRef.current = immediateSaveGuard.nextGuard;');
  });

  it('includes metadata-only edits in the unload pending-signature decision', () => {
    const handlerStart = autoSaveSource.indexOf('const handleBeforeUnload = () => {');
    const handlerEnd = autoSaveSource.indexOf("window.addEventListener('beforeunload'", handlerStart);
    const handlerSource = autoSaveSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('const unloadSignature = buildCanvasSaveSignature(');
    expect(handlerSource).toContain('const hasPendingCanvasSnapshot = lastImmediateSaveSignatureRef.current !== unloadSignature');
    expect(handlerSource.indexOf('annotationsV2: annotationRecordsRef.current')).toBeLessThan(
      handlerSource.indexOf('const unloadSignature = buildCanvasSaveSignature('),
    );
  });

  it('re-evaluates a deferred user mutation after the server merge window closes', () => {
    expect(autoSaveSource).toContain('const [serverSyncMergeRevision, setServerSyncMergeRevision]');
    expect(autoSaveSource).toContain('setServerSyncMergeRevision(revision => revision + 1);');
    expect(autoSaveSource).toMatch(/\[annotationRevision, images, currentProject\?\.id, currentUser\?\.id, serverSyncMergeRevision, setImages\]/);
    expect(autoSaveSource).toContain('}, [currentUser?.id, currentProject?.id, setImages]);');
  });
});
