import { describe, expect, it } from 'vitest';

import {
  compactDataLossSnapshots,
  dataLossSnapshotSignature,
  type DataLossSnapshotRecord,
} from '@/lib/user-manager';

const snapshotSource = (imageOverrides: Record<string, unknown> = {}) => ({
  userData: {
    'user-1': {
      projects: [{
        id: 'project-1',
        canvasImages: [{ id: 'image-1', x: 20, y: 40, width: 96, ...imageOverrides }],
      }],
    },
  },
});

describe('UserManager data-loss snapshots', () => {
  it('does not refresh a recovery snapshot for coordinate-only canvas changes', () => {
    const initial = dataLossSnapshotSignature(snapshotSource());
    const moved = dataLossSnapshotSignature(snapshotSource({ x: 420, y: 240, width: 192 }));
    const replaced = dataLossSnapshotSignature(snapshotSource({ id: 'image-2' }));

    expect(moved).toBe(initial);
    expect(replaced).not.toBe(initial);
  });

  it('keeps the persisted topology signature bounded for large canvases', () => {
    const largeSource = {
      userData: {
        'user-1': {
          projects: [{
            id: 'project-1',
            canvasImages: Array.from({ length: 2_000 }, (_, index) => ({
              id: `image-${index}-${'x'.repeat(40)}`,
            })),
          }],
        },
      },
    };

    expect(dataLossSnapshotSignature(largeSource).length).toBeLessThan(128);
  });

  it('keeps the newest snapshots within both count and serialized-byte budgets', () => {
    const snapshots: DataLossSnapshotRecord[] = Array.from({ length: 4 }, (_, index) => ({
      t: index,
      payload: `${index}-${'x'.repeat(80)}`,
      signature: `signature-${index}`,
    }));
    const newestTwo = snapshots.slice(-2);
    const newestTwoBytes = new TextEncoder().encode(JSON.stringify(newestTwo)).byteLength;

    expect(compactDataLossSnapshots(snapshots, 4, newestTwoBytes)).toEqual(newestTwo);
    expect(compactDataLossSnapshots(snapshots, 1, Number.MAX_SAFE_INTEGER)).toEqual(snapshots.slice(-1));
    expect(compactDataLossSnapshots(snapshots, 0, Number.MAX_SAFE_INTEGER)).toEqual([]);
    expect(compactDataLossSnapshots(snapshots, 4, 0)).toEqual([]);
  });

  it('returns no snapshot when the newest recovery payload alone exceeds the budget', () => {
    const oversized: DataLossSnapshotRecord = {
      t: 1,
      payload: 'x'.repeat(200),
      signature: 'oversized',
    };

    expect(compactDataLossSnapshots([oversized], 4, 32)).toEqual([]);
  });
});
