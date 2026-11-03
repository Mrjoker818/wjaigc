import { describe, expect, it } from 'vitest';

import {
  CANVAS_CROP_OPERATION,
  IncrementalHistoryManager,
} from '@/lib/canvas-incremental-history';

interface TestImage {
  id: string;
  url: string;
  isProcessingPlaceholder?: boolean;
  processing?: { label: string; [CANVAS_CROP_OPERATION]?: object };
  originalWidth?: number;
  originalHeight?: number;
}

const source: TestImage = { id: 'source', url: 'memory:original' };

function pending(operation: object): TestImage {
  return {
    id: 'crop',
    url: 'memory:original',
    isProcessingPlaceholder: true,
    processing: { label: '裁切中', [CANVAS_CROP_OPERATION]: operation },
  };
}

function result(url: string): Partial<TestImage> {
  return {
    url,
    isProcessingPlaceholder: false,
    processing: undefined,
    originalWidth: 48,
    originalHeight: 48,
  };
}

describe('crop creation in incremental history', () => {
  it('settles the matching creation without adding a history step', () => {
    const history = new IncrementalHistoryManager<TestImage>();
    const operation = {};
    const placeholder = pending(operation);
    history.recordChange([source], [source, placeholder]);

    expect(history.updateCropCreation('crop', result('memory:cropped'), false, operation)).toBe(true);
    expect(history.updateCropCreation('crop', result('memory:duplicate'), false, operation)).toBe(false);
    expect(history.getNumUndos()).toBe(1);

    const completed = { ...placeholder, ...result('memory:cropped') };
    const afterUndo = history.undo([source, completed]);
    expect(afterUndo).toEqual([source]);
    expect(history.canUndo()).toBe(false);
    expect(history.redo(afterUndo)).toEqual([source, completed]);
    expect(history.canRedo()).toBe(false);
  });

  it('applies a late completion to the redo entry after undo', () => {
    const history = new IncrementalHistoryManager<TestImage>();
    const operation = {};
    const placeholder = pending(operation);
    history.recordChange([source], [source, placeholder]);

    const afterUndo = history.undo([source, placeholder]);
    expect(afterUndo).toEqual([source]);
    expect(history.getNumUndos()).toBe(0);
    expect(history.getNumRedos()).toBe(1);
    expect(history.updateCropCreation('crop', result('memory:cropped'), true, operation)).toBe(true);
    expect(afterUndo).toEqual([source]);

    const completed = { ...placeholder, ...result('memory:cropped') };
    expect(history.redo(afterUndo)).toEqual([source, completed]);
    expect(history.undo([source, completed])).toEqual([source]);
    expect(history.canUndo()).toBe(false);
  });

  it('rejects an older operation when a new crop reuses the same ID', () => {
    const history = new IncrementalHistoryManager<TestImage>();
    const oldOperation = {};
    const newOperation = {};
    const oldPlaceholder = pending(oldOperation);
    const newPlaceholder = pending(newOperation);
    history.recordChange([source], [source, oldPlaceholder]);
    const afterUndo = history.undo([source, oldPlaceholder]);
    expect(afterUndo).toEqual([source]);

    history.recordChange(afterUndo, [source, newPlaceholder]);
    expect(history.canRedo()).toBe(false);
    expect(history.updateCropCreation('crop', result('memory:old'), false, oldOperation)).toBe(false);
    expect(history.updateCropCreation('crop', result('memory:new'), false, newOperation)).toBe(true);
    expect(history.getNumUndos()).toBe(1);

    const completed = { ...newPlaceholder, ...result('memory:new') };
    const afterNewUndo = history.undo([source, completed]);
    expect(afterNewUndo).toEqual([source]);
    expect(history.redo(afterNewUndo)).toEqual([source, completed]);
  });

  it('does not apply redo-only completion to an active creation', () => {
    const history = new IncrementalHistoryManager<TestImage>();
    const operation = {};
    const placeholder = pending(operation);
    history.recordChange([source], [source, placeholder]);

    expect(history.updateCropCreation('crop', result('memory:cropped'), true, operation)).toBe(false);
    const afterUndo = history.undo([source, placeholder]);
    expect(afterUndo).toEqual([source]);
    expect(history.redo(afterUndo)).toEqual([source, placeholder]);
  });
});
