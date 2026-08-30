import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ModelInfo } from '@/lib/universal-api-types';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  updateManagedUser: vi.fn(),
  dbAddAuditLog: vi.fn(),
  getPublicModelCatalogSnapshot: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({
  createManagedUser: vi.fn(),
  deleteManagedUser: vi.fn(),
  deleteManagedUsers: vi.fn(),
  isRootAdminUser: vi.fn(),
  listManagedUsers: vi.fn(),
  repairDuplicateUserIds: vi.fn(),
  requireAdminUser: mocks.requireAdminUser,
  updateManagedUser: mocks.updateManagedUser,
}));

vi.mock('@/lib/db-storage', () => ({
  dbListUserData: vi.fn(),
  dbGetUserData: vi.fn(),
  dbDeleteUserData: vi.fn(),
  dbAddAuditLog: mocks.dbAddAuditLog,
}));

vi.mock('@/lib/db-client', () => ({
  isDatabaseConfigured: vi.fn(() => false),
  execSql: vi.fn(),
}));

vi.mock('@/lib/server-api-config', () => ({
  getPublicModelCatalogSnapshot: mocks.getPublicModelCatalogSnapshot,
}));

import { POST } from '@/app/api/admin/users/route';

function model(providerId: string, id: string, type: ModelInfo['type']): ModelInfo {
  return { providerId, id, name: id, type };
}

const models: ModelInfo[] = [
  model('image-a', 'unique-image', 'image'),
  model('image-a', 'shared-image', 'image'),
  model('image-b', 'shared-image', 'image'),
  model('chat-a', 'chat-model', 'chat'),
];

function updateRequest(updates: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'update', userId: 'user-1', updates }),
  });
}

describe('POST /api/admin/users model authorization boundary', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', name: 'admin', role: 'admin' });
    mocks.updateManagedUser.mockResolvedValue({ id: 'user-1', name: 'user', role: 'user' });
    mocks.dbAddAuditLog.mockResolvedValue(undefined);
    mocks.getPublicModelCatalogSnapshot.mockResolvedValue({
      models,
      providers: [],
      configuredProviders: [],
    });
  });

  it('rejects an ambiguous legacy model before any user write or success audit', async () => {
    const response = await POST(updateRequest({ imageModels: ['shared-image'] }));
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toMatchObject({
      success: false,
      code: 'MODEL_ASSIGNMENT_AMBIGUOUS',
      field: 'imageModels',
      assignment: 'shared-image',
      candidateCount: 2,
    });
    expect(mocks.updateManagedUser).not.toHaveBeenCalled();
    expect(mocks.dbAddAuditLog).not.toHaveBeenCalled();
  });

  it('rejects an invalid exact model before any write', async () => {
    const response = await POST(updateRequest({ chatModels: ['missing::chat-model'] }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'MODEL_ASSIGNMENT_INVALID',
      field: 'chatModels',
    });
    expect(mocks.updateManagedUser).not.toHaveBeenCalled();
    expect(mocks.dbAddAuditLog).not.toHaveBeenCalled();
  });

  it('migrates a unique legacy id and shares one catalog snapshot across both namespaces', async () => {
    const response = await POST(updateRequest({
      name: 'renamed',
      chatModels: ['chat-model'],
      imageModels: ['unique-image'],
    }));

    expect(response.status).toBe(200);
    expect(mocks.getPublicModelCatalogSnapshot).toHaveBeenCalledOnce();
    expect(mocks.updateManagedUser).toHaveBeenCalledWith('user-1', expect.objectContaining({
      name: 'renamed',
      chatModels: ['chat-a::chat-model'],
      imageModels: ['image-a::unique-image'],
    }));
    expect(mocks.dbAddAuditLog).toHaveBeenCalledOnce();
    expect(mocks.dbAddAuditLog.mock.calls[0]?.[0]?.detail).toContain('modelAuthorizationMigrations');
  });

  it('does not load the model catalog for unrelated updates', async () => {
    const response = await POST(updateRequest({ name: 'renamed' }));

    expect(response.status).toBe(200);
    expect(mocks.getPublicModelCatalogSnapshot).not.toHaveBeenCalled();
    expect(mocks.updateManagedUser).toHaveBeenCalledWith('user-1', expect.objectContaining({ name: 'renamed' }));
  });

  it('rejects a non-admin before reading the model catalog', async () => {
    mocks.requireAdminUser.mockResolvedValue(null);

    const response = await POST(updateRequest({ imageModels: ['unique-image'] }));

    expect(response.status).toBe(403);
    expect(mocks.getPublicModelCatalogSnapshot).not.toHaveBeenCalled();
    expect(mocks.updateManagedUser).not.toHaveBeenCalled();
  });
});
