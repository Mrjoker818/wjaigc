import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createMemorySkillStorageAdapter,
  createSkillStore,
  SkillRevisionConflictError,
  SKILL_CATALOG_KEY,
  SkillStorageError,
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
      sourceSkillId: 'preset-ecommerce-listing',
      sourceAllowedSurfaces: ['canvas', 'workflow'],
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
    const customId = 'skill-1700000000000';
    const adapter = createMemorySkillStorageAdapter({
      'user-1': {
        chat_skills: [legacySkill(customId), legacySkill('preset-ecommerce-listing')],
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
      sourceSkillId: customId,
      sourceAllowedSurfaces: ['canvas', 'workflow'],
    });
    expect(second.migratedLegacyIds).toEqual([customId]);
  });

  it('derives distinct stable ids for multiple legacy skills even with a long owner id', async () => {
    const userId = `user-${'x'.repeat(100)}`;
    const adapter = createMemorySkillStorageAdapter({
      [userId]: {
        chat_skills: [legacySkill('skill-1700000000001'), legacySkill('skill-1700000000002')],
      },
    });
    const store = createSkillStore(adapter, { now: () => 100 });

    const migrated = await store.migrateLegacy(userId);

    expect(migrated.skills).toHaveLength(2);
    expect(new Set(migrated.skills.map(skill => skill.id))).toHaveLength(2);
  });

  it('skips legacy records that do not prove the historical skill-Date.now custom id shape', async () => {
    const adapter = createMemorySkillStorageAdapter({
      'user-1': { chat_skills: [legacySkill('legacy-custom')] },
    });
    const store = createSkillStore(adapter);

    const migrated = await store.migrateLegacy('user-1');

    expect(migrated.skills).toEqual([]);
    expect(migrated.migratedLegacyIds).toEqual([]);
  });

  it('does not let oversized or excessive legacy records block catalog reads', async () => {
    const oversized = {
      ...legacySkill('skill-1700000000100'),
      systemPrompt: 'x'.repeat(2_000_000),
    };
    const many = Array.from({ length: 205 }, (_, index) =>
      legacySkill(`skill-${1700000001000 + index}`));
    const adapter = createMemorySkillStorageAdapter({
      'user-1': { chat_skills: [oversized, ...many] },
    });
    const store = createSkillStore(adapter);

    await expect(store.load('user-1', 'canvas')).resolves.toHaveLength(21 + 199);
    const stored = adapter.inspect('user-1', SKILL_CATALOG_KEY) as { skills: unknown[] };
    expect(stored.skills).toHaveLength(199);
    expect(new TextEncoder().encode(JSON.stringify(stored)).byteLength).toBeLessThanOrEqual(1_048_576);
  });

  it('skips partial historical timestamp records without blocking catalog reads', async () => {
    const partial = legacySkill('skill-1700000000200') as Record<string, unknown>;
    delete partial.createdAt;
    const adapter = createMemorySkillStorageAdapter({
      'user-1': { chat_skills: [partial] },
    });
    const store = createSkillStore(adapter);

    await expect(store.load('user-1', 'canvas')).resolves.toHaveLength(21);
    const stored = adapter.inspect('user-1', SKILL_CATALOG_KEY) as {
      skills: unknown[];
      migratedLegacyIds: string[];
    };
    expect(stored.skills).toEqual([]);
    expect(stored.migratedLegacyIds).toEqual(['skill-1700000000200']);
  });

  async function overwriteFirstStoredSkill(
    mutation: (skill: {
      allowedSurfaces: string[];
      sourceAllowedSurfaces: string[];
      steps: Array<{ modelRole: string }>;
    }) => void,
  ) {
    const adapter = createMemorySkillStorageAdapter();
    const store = createSkillStore(adapter);
    await store.copy({ actorUserId: 'user-1', sourceSkillId: 'preset-storyboard' });
    const envelope = adapter.inspect('user-1', SKILL_CATALOG_KEY) as {
      revision: number;
      skills: Array<{
        allowedSurfaces: string[];
        sourceAllowedSurfaces: string[];
        steps: Array<{ modelRole: string }>;
      }>;
    };
    mutation(envelope.skills[0]!);
    await adapter.compareAndSet('user-1', SKILL_CATALOG_KEY, envelope.revision, {
      ...envelope,
      revision: envelope.revision + 1,
    } as never);
    return store;
  }

  it('rejects recursively forged stored step enums', async () => {
    const store = await overwriteFirstStoredSkill(skill => {
      skill.steps[0]!.modelRole = 'root';
    });

    await expect(store.loadEnvelope('user-1')).rejects.toBeInstanceOf(SkillStorageError);
  });

  it('rejects allowed surfaces expanded beyond persisted source permissions', async () => {
    const store = await overwriteFirstStoredSkill(skill => {
      skill.allowedSurfaces.push('simple-chat');
      expect(skill.sourceAllowedSurfaces).toEqual(['canvas', 'workflow']);
    });

    await expect(store.loadEnvelope('user-1')).rejects.toBeInstanceOf(SkillStorageError);
  });

  it('does not treat a damaged existing in-memory revision as missing revision zero', async () => {
    const adapter = createMemorySkillStorageAdapter({
      'user-1': { [SKILL_CATALOG_KEY]: { revision: '0', attacker: true } },
    });

    await expect(adapter.compareAndSet('user-1', SKILL_CATALOG_KEY, 0, {
      schemaVersion: 1,
      revision: 1,
      skills: [],
      migratedLegacyIds: [],
    })).resolves.toBe(false);
    expect(adapter.inspect('user-1', SKILL_CATALOG_KEY)).toEqual({ revision: '0', attacker: true });
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
