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
});
