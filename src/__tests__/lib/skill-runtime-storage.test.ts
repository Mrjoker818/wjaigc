import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createMemorySkillStorageAdapter,
  createSkillStore,
  SkillRevisionConflictError,
  SKILL_CATALOG_KEY,
} from '@/lib/skill-runtime/storage';

function legacySkill(id: string) {
  return {
    id,
    name: `Legacy ${id}`,
    category: 'custom',
    description: 'A user-authored legacy skill',
    systemPrompt: 'Help the user.',
    paramSlots: [{ name: 'topic', label: 'Topic' }],
    steps: [{ role: 'user' as const, content: 'Create {{topic}}' }],
    createdAt: 10,
    updatedAt: 20,
    usageCount: 3,
  };
}

describe('versioned user skill storage', () => {
  it('copies a built-in skill into an owner-scoped versioned record without persisting presets', async () => {
    const adapter = createMemorySkillStorageAdapter();
    const store = createSkillStore(adapter, { now: () => 100 });

    const copy = await store.copy({
      actorUserId: 'user-1',
      sourceSkillId: 'preset-ecommerce-listing',
    });

    expect(copy).toMatchObject({
      ownerId: 'user-1',
      builtIn: false,
      version: 1,
      allowedSurfaces: ['canvas', 'workflow'],
      createdAt: 100,
      updatedAt: 100,
    });
    expect(copy.id).not.toBe('preset-ecommerce-listing');
    const stored = adapter.inspect('user-1', SKILL_CATALOG_KEY) as { skills: Array<{ id: string }> };
    expect(stored.skills.map(skill => skill.id)).toEqual([copy.id]);
    expect(stored.skills.some(skill => skill.id.startsWith('preset-'))).toBe(false);
  });

  it('keeps the copy id stable and increments its version on an allowed update', async () => {
    const adapter = createMemorySkillStorageAdapter();
    let now = 100;
    const store = createSkillStore(adapter, { now: () => now });
    const copy = await store.copy({ actorUserId: 'user-1', sourceSkillId: 'preset-logo-brand' });

    now = 200;
    const updated = await store.update({
      actorUserId: 'user-1',
      skillId: copy.id,
      enabled: false,
      name: 'My logo workflow',
    });

    expect(updated).toMatchObject({
      id: copy.id,
      ownerId: 'user-1',
      builtIn: false,
      version: 2,
      enabled: false,
      name: 'My logo workflow',
      createdAt: 100,
      updatedAt: 200,
    });
    expect(updated.allowedSurfaces).toEqual(['canvas', 'workflow']);
  });

  it('does not reveal another user copy when it is updated', async () => {
    const adapter = createMemorySkillStorageAdapter();
    const store = createSkillStore(adapter);
    const copy = await store.copy({ actorUserId: 'user-1', sourceSkillId: 'preset-storyboard' });

    await expect(store.update({
      actorUserId: 'user-2',
      skillId: copy.id,
      enabled: false,
    })).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND', status: 404 });
  });

  it('isolates the 21 canvas/workflow and 16 simple-chat built-ins by a strict surface value', async () => {
    const store = createSkillStore(createMemorySkillStorageAdapter());

    await expect(store.load('user-1', 'invalid' as 'canvas')).rejects.toMatchObject({
      code: 'INVALID_SKILL_SURFACE',
      status: 400,
    });
    expect((await store.load('user-1', 'canvas')).filter(skill => skill.builtIn)).toHaveLength(21);
    expect((await store.load('user-1', 'workflow')).filter(skill => skill.builtIn)).toHaveLength(21);
    expect((await store.load('user-1', 'simple-chat')).filter(skill => skill.builtIn)).toHaveLength(16);
    expect((await store.load('user-1', 'simple-chat')).some(skill => skill.id.startsWith('preset-'))).toBe(false);
  });

  it('migrates only owner-authored legacy chat skills once', async () => {
    const adapter = createMemorySkillStorageAdapter({
      'user-1': {
        chat_skills: [legacySkill('legacy-custom'), legacySkill('preset-ecommerce-listing')],
      },
    });
    const store = createSkillStore(adapter, { now: () => 100 });

    const first = await store.migrateLegacy('user-1');
    const second = await store.migrateLegacy('user-1');

    expect(first.skills).toHaveLength(1);
    expect(second.skills).toHaveLength(1);
    expect(second.skills[0]).toMatchObject({
      id: first.skills[0]?.id,
      ownerId: 'user-1',
      builtIn: false,
      version: 1,
      allowedSurfaces: ['canvas', 'workflow'],
    });
    expect(second.migratedLegacyIds).toEqual(['legacy-custom']);
  });

  it('derives distinct stable ids for multiple legacy skills even with a long owner id', async () => {
    const userId = `user-${'x'.repeat(100)}`;
    const adapter = createMemorySkillStorageAdapter({
      [userId]: {
        chat_skills: [legacySkill('custom-a'), legacySkill('custom-b')],
      },
    });
    const store = createSkillStore(adapter, { now: () => 100 });

    const migrated = await store.migrateLegacy(userId);

    expect(migrated.skills).toHaveLength(2);
    expect(new Set(migrated.skills.map(skill => skill.id))).toHaveLength(2);
  });

  it('allows only one in-memory writer to claim the same envelope revision', async () => {
    const adapter = createMemorySkillStorageAdapter();
    const store = createSkillStore(adapter);
    const empty = { schemaVersion: 1 as const, revision: 0, skills: [], migratedLegacyIds: [] };

    const writes = await Promise.allSettled([
      store.saveEnvelope('user-1', 0, empty),
      store.saveEnvelope('user-1', 0, empty),
    ]);

    expect(writes.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = writes.find(result => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.any(SkillRevisionConflictError) });
  });
});
