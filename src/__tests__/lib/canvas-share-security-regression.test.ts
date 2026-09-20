import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { projectCanvasShareForPublic } from '@/lib/canvas-share/public-projection';
import { canvasSharePublicErrorResponse } from '@/lib/canvas-share/request';
import type { CanvasShareItemRecord, CanvasShareRecord } from '@/lib/canvas-share/types';

const PRIVATE_MARKERS = {
  rawToken: `raw_canvas_share_${'t'.repeat(43)}`,
  storageKey: 'private/canvas-share/storage-key.png',
  providerUrl: 'https://provider.private.example/v1/images',
  prompt: 'private-canvas-share-prompt-marker',
  taskId: 'task-private-canvas-share',
  providerId: 'provider-private-canvas-share',
  modelId: 'model-private-canvas-share',
  apiKey: 'sk-private-canvas-share-api-key',
  ownerId: 'owner-private-canvas-share',
  projectId: 'project-private-canvas-share',
  shareId: 'share-private-canvas-share',
  placementId: 'placement-private-canvas-share',
  assetId: 'asset-private-canvas-share',
  assetVersionId: 'version-private-canvas-share',
} as const;

async function listArtifactFiles(root: string, current = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listArtifactFiles(root, entryPath));
    } else if (entry.isFile()) {
      files.push(path.relative(root, entryPath).replaceAll('\\', '/'));
    }
  }
  return files.sort();
}

async function scanArtifactsForPrivateMarkers(
  root: string,
  markers: readonly string[],
): Promise<Array<{ file: string; marker: string }>> {
  const findings: Array<{ file: string; marker: string }> = [];
  for (const file of await listArtifactFiles(root)) {
    const contents = await readFile(path.join(root, file), 'utf8');
    for (const marker of markers) {
      if (contents.includes(marker)) findings.push({ file, marker });
    }
  }
  return findings;
}

function privateRecord(): CanvasShareRecord {
  return {
    id: PRIVATE_MARKERS.shareId,
    ownerId: PRIVATE_MARKERS.ownerId,
    projectId: PRIVATE_MARKERS.projectId,
    projectRevision: 17,
    tokenHash: createHash('sha256').update(PRIVATE_MARKERS.rawToken).digest('hex'),
    title: '安全共享画布',
    status: 'active',
    expiresAt: '2099-09-19T00:00:00.000Z',
    allowDownload: false,
    viewport: { offsetX: 12, offsetY: -8, zoom: 1.25 },
    snapshotDigest: 'd'.repeat(64),
    viewCount: 0,
    lastViewedAt: null,
    createdAt: '2026-09-19T00:00:00.000Z',
    revokedAt: null,
  };
}

function privateItem(): CanvasShareItemRecord {
  return {
    id: 'item-private-canvas-share',
    shareId: PRIVATE_MARKERS.shareId,
    placementId: PRIVATE_MARKERS.placementId,
    assetId: PRIVATE_MARKERS.assetId,
    assetVersionId: PRIVATE_MARKERS.assetVersionId,
    entityType: 'canvas-image',
    assetKind: 'image',
    transform: { x: 1, y: 2, width: 320, height: 180, rotation: 0, zIndex: 1 },
    displayMetadata: { label: '公开图片', altText: '安全说明' },
    mimeType: 'image/png',
    width: 320,
    height: 180,
    byteSize: 256,
    checksum: 'private-checksum-that-is-not-public',
    availability: 'ready',
    sortOrder: 0,
    createdAt: '2026-09-19T00:00:00.000Z',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('canvas-share public security regression', () => {
  it('keeps public JSON, captured logs, errors, and serialized artifacts free of private markers', async () => {
    const artifactRoot = await mkdtemp(path.join(tmpdir(), 'canvas-share-security-'));
    const capturedLogs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
      capturedLogs.push(values.map(String).join(' '));
    });
    vi.spyOn(console, 'warn').mockImplementation((...values: unknown[]) => {
      capturedLogs.push(values.map(String).join(' '));
    });

    try {
      const publicDocument = projectCanvasShareForPublic(privateRecord(), [privateItem()]);
      const privateContext = Object.values(PRIVATE_MARKERS).join(' | ');
      const errorResponse = canvasSharePublicErrorResponse(
        new NextRequest(`http://localhost/api/public/canvas-shares/${PRIVATE_MARKERS.rawToken}`),
        new Error(privateContext),
      );
      const errorBody = await errorResponse.json() as unknown;
      const artifact = {
        publicDocument,
        errorBody,
        capturedLogs,
        privateContextWasHandled: true,
      };
      await writeFile(
        path.join(artifactRoot, 'public-run.json'),
        `${JSON.stringify(artifact, null, 2)}\n`,
        'utf8',
      );

      expect(publicDocument).toMatchObject({
        title: '安全共享画布',
        allowDownload: false,
        items: [{ display: { label: '公开图片', altText: '安全说明' } }],
      });
      expect(errorBody).toMatchObject({
        success: false,
        code: 'CANVAS_SHARE_REQUEST_FAILED',
        message: '画布分享请求失败',
      });
      expect(capturedLogs).toEqual([]);
      expect(await scanArtifactsForPrivateMarkers(
        artifactRoot,
        Object.values(PRIVATE_MARKERS),
      )).toEqual([]);
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when a test artifact contains any forbidden private marker', async () => {
    const artifactRoot = await mkdtemp(path.join(tmpdir(), 'canvas-share-security-leak-'));
    try {
      await writeFile(
        path.join(artifactRoot, 'leaked.log'),
        `unexpected=${PRIVATE_MARKERS.apiKey}\n`,
        'utf8',
      );
      await expect(scanArtifactsForPrivateMarkers(
        artifactRoot,
        Object.values(PRIVATE_MARKERS),
      )).resolves.toEqual([{
        file: 'leaked.log',
        marker: PRIVATE_MARKERS.apiKey,
      }]);
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });
});
