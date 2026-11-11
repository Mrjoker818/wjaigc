import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readDocumentWorkspaceProject: vi.fn(),
  dbGetUserData: vi.fn(),
}));

vi.mock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true }));
vi.mock('@/lib/db-storage', () => ({ dbGetUserData: mocks.dbGetUserData }));
vi.mock('@/lib/collaboration/document-workspace-reference', () => ({
  DocumentWorkspaceReferenceError: class extends Error {
    constructor(readonly status: number) { super('Test document reference error'); }
  },
  readDocumentWorkspaceProject: mocks.readDocumentWorkspaceProject,
}));

import { findOwnedAnnotationSource } from '@/lib/annotation-project-source';

const projectId = 'collaboration-test-project';
const image = {
  id: 'source-image',
  url: '/api/serve-upload/exports/source-image.png',
  annotationVersionId: 'canonical-version',
  mediaAvailability: 'ready',
};

describe('owned layer and annotation sources', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.dbGetUserData.mockResolvedValue([]);
  });

  it('uses the current canonical image when the owner has no legacy copy', async () => {
    mocks.readDocumentWorkspaceProject.mockResolvedValue({ projectId, ownerId: 'owner', canvasImages: [image] });

    await expect(findOwnedAnnotationSource('owner', projectId, image.id)).resolves.toEqual({
      projectId, imageId: image.id, imageUrl: image.url, versionId: image.annotationVersionId,
    });
    expect(mocks.dbGetUserData).not.toHaveBeenCalled();
  });

  it('does not use a document image for an editor of another owner', async () => {
    mocks.readDocumentWorkspaceProject.mockResolvedValue({ projectId, ownerId: 'owner', canvasImages: [image] });

    await expect(findOwnedAnnotationSource('editor', projectId, image.id)).resolves.toBeNull();
    expect(mocks.dbGetUserData).not.toHaveBeenCalled();
  });

  it('does not recover a deleted document image from the old project copy', async () => {
    mocks.readDocumentWorkspaceProject.mockResolvedValue({ projectId, ownerId: 'owner', canvasImages: [] });
    mocks.dbGetUserData.mockResolvedValue([{ id: projectId, userId: 'owner', canvasImages: [image] }]);

    await expect(findOwnedAnnotationSource('owner', projectId, image.id)).resolves.toBeNull();
    expect(mocks.dbGetUserData).not.toHaveBeenCalled();
  });

  it('continues to read the saved image in an older personal project', async () => {
    mocks.readDocumentWorkspaceProject.mockResolvedValue(null);
    mocks.dbGetUserData.mockResolvedValue([{ id: projectId, canvasImages: [image] }]);

    await expect(findOwnedAnnotationSource('owner', projectId, image.id)).resolves.toMatchObject({
      imageUrl: image.url, versionId: image.annotationVersionId,
    });
  });
});
