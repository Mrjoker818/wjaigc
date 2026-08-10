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
});
