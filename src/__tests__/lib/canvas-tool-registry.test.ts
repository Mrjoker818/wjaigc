import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CLOSED_CANVAS_TOOL_SESSION,
  canvasToolRegistry,
  closeCanvasToolSession,
  openCanvasToolSession,
  reconcileCanvasToolSession,
} from '@/lib/canvas-kernel/tool-registry';

const protectedCanvasToolFeatureIds = [
  'workspace.canvas.core',
  'workspace.canvas.upload',
  'workspace.canvas.generate',
  'workspace.canvas.reference-groups',
  'workspace.canvas.image-tools',
  'workspace.canvas.annotation',
  'workspace.canvas.layers-history-export',
  'workspace.canvas.video',
  'workspace.canvas.three-d',
  'workspace.canvas.specialized-tools',
  'workspace.canvas.refine',
];
const protectedCanvasFeatures = JSON.parse(readFileSync(
  resolve(process.cwd(), 'docs/testing/baselines/protected-features.json'),
  'utf8',
)) as Array<{ featureId: string; workspace: string | null; actions: string[] }>;

describe('canvas tool registry', () => {
  it('covers every protected Canvas feature without duplicate tool ids', () => {
    expect(canvasToolRegistry.featureIds()).toEqual(
      expect.arrayContaining(protectedCanvasToolFeatureIds),
    );
    expect(canvasToolRegistry.duplicates()).toEqual([]);
    expect(canvasToolRegistry.definitions.every(tool => tool.entryPoints.length > 0)).toBe(true);
  });

  it('keeps all established Canvas entry-point families explicit', () => {
    const entryPoints = new Set(canvasToolRegistry.definitions.flatMap(tool => tool.entryPoints));
    expect(entryPoints).toEqual(expect.objectContaining({
      size: expect.any(Number),
    }));
    expect([...entryPoints]).toEqual(expect.arrayContaining([
      'bottom-toolbar',
      'image-toolbar',
      'context-menu',
      'shortcut',
    ]));
  });

  it('maps every protected Canvas action to an explicit registered capability', () => {
    for (const feature of protectedCanvasFeatures.filter(item => item.workspace === 'canvas')) {
      expect(canvasToolRegistry.capabilities(feature.featureId)).toEqual(
        expect.arrayContaining(feature.actions),
      );
    }
  });

  it('opens only one tool session and locks its source selection', () => {
    const erase = openCanvasToolSession(CLOSED_CANVAS_TOOL_SESSION, 'erase', {
      projectId: 'project-a',
      sourceImageIds: ['image-a'],
      entryPoint: 'image-toolbar',
    });
    const mask = openCanvasToolSession(erase, 'mask', {
      projectId: 'project-a',
      sourceImageIds: ['image-b'],
      entryPoint: 'context-menu',
    });

    expect(erase).toMatchObject({ toolId: 'erase', sourceImageIds: ['image-a'], status: 'open' });
    expect(mask).toMatchObject({ toolId: 'mask', sourceImageIds: ['image-b'], status: 'open' });
    expect(closeCanvasToolSession(mask)).toEqual(CLOSED_CANVAS_TOOL_SESSION);
  });

  it('fails closed when a selection-required tool has no source image', () => {
    expect(() => openCanvasToolSession(CLOSED_CANVAS_TOOL_SESSION, 'erase', {
      projectId: 'project-a',
      sourceImageIds: [],
      entryPoint: 'image-toolbar',
    })).toThrow('CANVAS_TOOL_SELECTION_REQUIRED');

    expect(openCanvasToolSession(CLOSED_CANVAS_TOOL_SESSION, 'chatcanvas', {
      projectId: 'project-a',
      sourceImageIds: [],
      entryPoint: 'shortcut',
    }).toolId).toBe('chatcanvas');
  });

  it('closes on escape, outside click, project switch and source deletion', () => {
    const active = openCanvasToolSession(CLOSED_CANVAS_TOOL_SESSION, 'mask', {
      projectId: 'project-a',
      sourceImageIds: ['image-a'],
      entryPoint: 'image-toolbar',
    });

    expect(reconcileCanvasToolSession(active, { type: 'escape' })).toEqual(CLOSED_CANVAS_TOOL_SESSION);
    expect(reconcileCanvasToolSession(active, { type: 'external-pointer' })).toEqual(CLOSED_CANVAS_TOOL_SESSION);
    expect(reconcileCanvasToolSession(active, { type: 'project-change', projectId: 'project-b' }))
      .toEqual(CLOSED_CANVAS_TOOL_SESSION);
    expect(reconcileCanvasToolSession(active, { type: 'images-change', imageIds: [] }))
      .toEqual(CLOSED_CANVAS_TOOL_SESSION);
  });

  it('keeps an active session when its project and locked sources still exist', () => {
    const active = openCanvasToolSession(CLOSED_CANVAS_TOOL_SESSION, 'mask', {
      projectId: 'project-a',
      sourceImageIds: ['image-a'],
      entryPoint: 'image-toolbar',
    });

    expect(reconcileCanvasToolSession(active, {
      type: 'images-change',
      imageIds: ['image-a', 'image-b'],
    })).toBe(active);
    expect(reconcileCanvasToolSession(active, {
      type: 'project-change',
      projectId: 'project-a',
    })).toBe(active);
  });
});
