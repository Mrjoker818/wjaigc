import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createMemorySkillStorageAdapter,
  createSkillStore,
  parseUserSkillEnvelope,
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

  it('copies the complete omnichannel input contract without losing source bindings', async () => {
    const adapter = createMemorySkillStorageAdapter();
    const store = createSkillStore(adapter, { now: () => 100 });
    const source = (await store.load('user-1', 'canvas'))
      .find(skill => skill.id === 'preset-omnichannel-campaign');

    expect(source).toBeDefined();
    const copy = await store.copy({
      actorUserId: 'user-1',
      sourceSkillId: 'preset-omnichannel-campaign',
    });

    expect(copy.inputs).toEqual(source!.inputs);
    expect(copy.steps).toEqual(source!.steps);
    expect(copy.executionContextVersion).toBe(1);
    expect(copy.inputs.find(field => field.key === 'channels')).toMatchObject({
      kind: 'multi-select',
      maximumItems: 6,
    });
    expect(copy.inputs.find(field => field.key === 'sourceImages')).toMatchObject({
      kind: 'images',
      maximumItems: 6,
      bindToSourceVersions: true,
    });
    expect((adapter.inspect('user-1', SKILL_CATALOG_KEY) as {
      skills: Array<{ executionContextVersion?: number; inputs: unknown[] }>;
    }).skills[0]).toMatchObject({
      executionContextVersion: 1,
      inputs: source!.inputs,
    });
  });

  it('preserves a conditional step when a built-in Skill is copied', async () => {
    const adapter = createMemorySkillStorageAdapter();
    const store = createSkillStore(adapter, { now: () => 100 });

    const copy = await store.copy({
      actorUserId: 'user-1',
      sourceSkillId: 'preset-pinterest-pins',
    });

    expect(copy.steps.find(step => step.id === 'pin-conversion')?.when).toEqual({
      input: 'seriesCount',
      includes: ['3'],
    });
  });

  it('preserves a dataset fan-out contract when a built-in Skill is copied', async () => {
    const adapter = createMemorySkillStorageAdapter();
    const store = createSkillStore(adapter, { now: () => 100 });

    const copy = await store.copy({
      actorUserId: 'user-1',
      sourceSkillId: 'preset-batch-sku-assets',
    });

    expect(copy.steps.find(step => step.id === 'sku-creative')?.fanOut).toEqual({
      inputKey: 'rows',
      itemAlias: 'sku',
      keyField: 'sku',
      maximumItems: 20,
      concurrency: 3,
    });
  });

  it('preserves platform compliance input constraints when copied', async () => {
    const store = createSkillStore(createMemorySkillStorageAdapter(), { now: () => 100 });
    const source = (await store.load('user-1', 'canvas'))
      .find(skill => skill.id === 'preset-platform-compliance-audit');
    const copy = await store.copy({
      actorUserId: 'user-1', sourceSkillId: 'preset-platform-compliance-audit',
    });

    expect(copy.inputs).toEqual(source?.inputs);
    expect(copy.inputs.find(field => field.key === 'sourceImages')).toMatchObject({ uniqueItems: true });
    expect(copy.inputs.find(field => field.key === 'claims')).toMatchObject({ maximumLength: 4_000 });
    expect(copy.inputs.find(field => field.key === 'region')).toMatchObject({
      dependentOptions: { inputKey: 'platform', values: { Amazon: ['US', 'EU', 'JP'] } },
    });
  });

  it('rejects stored dependentOptions accessors without invoking them', async () => {
    let getterCalls = 0;
    const store = createSkillStore(createMemorySkillStorageAdapter(), { now: () => 100 });
    const copy = await store.copy({
      actorUserId: 'user-1', sourceSkillId: 'preset-platform-compliance-audit',
    });
    const inputs = copy.inputs.map(field => {
      if (field.key !== 'region') return structuredClone(field);
      const unsafe: Record<string, unknown> = {
        key: field.key, label: field.label, kind: field.kind, required: field.required,
      };
      Object.defineProperty(unsafe, 'dependentOptions', {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          throw new Error('stored getter must not run');
        },
      });
      return unsafe;
    });

    expect(() => parseUserSkillEnvelope({
      schemaVersion: 1, revision: 1, migratedLegacyIds: [],
      skills: [{ ...copy, inputs }],
    })).toThrow(SkillStorageError);
    expect(getterCalls).toBe(0);
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

  it('creates independent persisted conversation Skills and keeps disabled records manageable', async () => {
    const adapter = createMemorySkillStorageAdapter();
    let sequence = 0;
    const store = createSkillStore(adapter, {
      now: () => 100 + sequence,
      createId: () => `skill-${String(++sequence).padStart(24, '0')}`,
    });

    const first = await store.createConversation({
      actorUserId: 'user-1', name: 'First', description: 'One', category: '品牌视觉',
      systemPrompt: '你是品牌视觉智能体', conversation: 'User: first',
    });
    const second = await store.createConversation({
      actorUserId: 'user-1', name: 'Second', description: 'Two', category: '产品设计',
      systemPrompt: '你是产品设计智能体', conversation: 'User: second',
    });
    await store.update({ actorUserId: 'user-1', skillId: first.id, enabled: false });

    expect(first.id).not.toBe(second.id);
    expect((await store.load('user-1', 'canvas')).filter(skill => !skill.builtIn)).toEqual([
      expect.objectContaining({ id: first.id, enabled: false, systemPrompt: expect.stringContaining('User: first') }),
      expect.objectContaining({ id: second.id, enabled: true, systemPrompt: expect.stringContaining('User: second') }),
    ]);
    expect((adapter.inspect('user-1', SKILL_CATALOG_KEY) as { skills: unknown[] }).skills).toHaveLength(2);
    expect(first).toMatchObject({
      category: '品牌视觉',
      sourceSkillId: 'conversation-canvas',
      allowedSurfaces: ['canvas', 'workflow'],
      sourceAllowedSurfaces: ['canvas', 'workflow'],
      inputs: [{ key: 'request', kind: 'text', required: true }],
      steps: [{ toolId: 'chat', modelRole: 'orchestrator' }],
    });
    expect(first.systemPrompt).toContain('你是品牌视觉智能体');
    expect(first.systemPrompt).toContain('User: first');
    expect(first.systemPrompt).not.toContain('概念场景');
    expect(second.category).toBe('产品设计');
    expect(second.steps).toEqual(first.steps);
    expect(second.systemPrompt).not.toBe(first.systemPrompt);
  });

  it('authorizes executable user Skills by owner, surface and enabled state', async () => {
    const store = createSkillStore(createMemorySkillStorageAdapter(), {
      createId: () => 'skill-000000000000000000000001',
    });
    const skill = await store.createConversation({
      actorUserId: 'user-1', name: 'Executable', description: 'Saved', category: '保存对话',
      systemPrompt: 'Continue the saved conversation', conversation: 'User: private prompt',
    });
    await expect(store.resolveExecutable('user-1', skill.id, 'canvas')).resolves.toMatchObject({ id: skill.id });
    await expect(store.resolveExecutable('user-2', skill.id, 'canvas')).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
    await expect(store.resolveExecutable('user-1', skill.id, 'simple-chat')).rejects.toMatchObject({ code: 'SKILL_SURFACE_FORBIDDEN' });
    await store.update({ actorUserId: 'user-1', skillId: skill.id, enabled: false });
    await expect(store.resolveExecutable('user-1', skill.id, 'canvas')).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
  });

  it('deletes an owned Skill from durable storage without exposing another owner', async () => {
    const adapter = createMemorySkillStorageAdapter();
    const store = createSkillStore(adapter, { createId: () => 'skill-000000000000000000000001' });
    const skill = await store.createConversation({
      actorUserId: 'user-1', name: 'Delete me', description: 'Disposable', category: '保存对话',
      systemPrompt: 'Continue the saved conversation', conversation: 'User: delete',
    });

    await expect(store.remove({ actorUserId: 'user-2', skillId: skill.id }))
      .rejects.toMatchObject({ code: 'SKILL_NOT_FOUND', status: 404 });
    await expect(store.remove({ actorUserId: 'user-1', skillId: skill.id })).resolves.toBeUndefined();
    expect((await store.load('user-1', 'canvas')).filter(item => !item.builtIn)).toEqual([]);
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

  it('isolates the 28 canvas/workflow and 16 simple-chat built-ins by a strict surface value', async () => {
    const store = createSkillStore(createMemorySkillStorageAdapter());

    await expect(store.load('user-1', 'invalid' as 'canvas')).rejects.toMatchObject({
      code: 'INVALID_SKILL_SURFACE',
      status: 400,
    });
    expect((await store.load('user-1', 'canvas')).filter(skill => skill.builtIn)).toHaveLength(28);
    expect((await store.load('user-1', 'workflow')).filter(skill => skill.builtIn)).toHaveLength(28);
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

    await expect(store.load('user-1', 'canvas')).resolves.toHaveLength(28 + 199);
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

    await expect(store.load('user-1', 'canvas')).resolves.toHaveLength(28);
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
      inputs: Array<{ key: string; kind: string; bindToSourceVersions?: unknown }>;
      steps: Array<{
        id: string;
        modelRole: string;
        fanOut?: unknown;
        compiledFanOut?: unknown;
      }>;
    }) => void,
    sourceSkillId = 'preset-storyboard',
  ) {
    const adapter = createMemorySkillStorageAdapter();
    const store = createSkillStore(adapter);
    await store.copy({ actorUserId: 'user-1', sourceSkillId });
    const envelope = adapter.inspect('user-1', SKILL_CATALOG_KEY) as {
      revision: number;
      skills: Array<{
        allowedSurfaces: string[];
        sourceAllowedSurfaces: string[];
        inputs: Array<{ key: string; kind: string; bindToSourceVersions?: unknown }>;
        steps: Array<{
          id: string;
          modelRole: string;
          fanOut?: unknown;
          compiledFanOut?: unknown;
        }>;
      }>;
    };
    mutation(envelope.skills[0]!);
    await adapter.compareAndSet('user-1', SKILL_CATALOG_KEY, envelope.revision, {
      ...envelope,
      revision: envelope.revision + 1,
    } as never);
    return store;
  }

  it('accepts and preserves a validated compiled image fan-out identity', async () => {
    const compiledFanOut = {
      inputKey: 'sourceImages', itemIndex: 0, itemDigest: '0123456789abcdef',
    };
    const store = await overwriteFirstStoredSkill(skill => {
      const step = skill.steps.find(candidate => candidate.id === 'sku-creative')!;
      delete step.fanOut;
      step.id = `sku-creative:${compiledFanOut.itemDigest}`;
      step.compiledFanOut = compiledFanOut;
    }, 'preset-batch-sku-assets');

    const envelope = await store.loadEnvelope('user-1');
    expect(envelope.skills[0]?.steps.find(
      step => step.id === `sku-creative:${compiledFanOut.itemDigest}`,
    )?.compiledFanOut)
      .toEqual(compiledFanOut);
  });

  it.each([
    { inputKey: '', itemIndex: 0, itemDigest: '0123456789abcdef' },
    { inputKey: 'sourceImages', itemIndex: -1, itemDigest: '0123456789abcdef' },
    { inputKey: 'sourceImages', itemIndex: 0, itemDigest: 'not-a-digest' },
    { inputKey: 'sourceImages', itemIndex: 0, itemDigest: '0123456789abcdef', extra: true },
  ])('rejects malformed stored compiled fan-out identity %#', async compiledFanOut => {
    const store = await overwriteFirstStoredSkill(skill => {
      const step = skill.steps.find(candidate => candidate.id === 'sku-creative')!;
      delete step.fanOut;
      step.compiledFanOut = compiledFanOut;
    }, 'preset-batch-sku-assets');

    await expect(store.loadEnvelope('user-1')).rejects.toBeInstanceOf(SkillStorageError);
  });

  it('rejects a stored compiled fan-out detached from its step id or bound image field', async () => {
    const forgedIdStore = await overwriteFirstStoredSkill(skill => {
      const step = skill.steps.find(candidate => candidate.id === 'sku-creative')!;
      delete step.fanOut;
      step.id = 'sku-creative:ffffffffffffffff';
      step.compiledFanOut = {
        inputKey: 'sourceImages', itemIndex: 0, itemDigest: '0123456789abcdef',
      };
    }, 'preset-batch-sku-assets');
    const unboundStore = await overwriteFirstStoredSkill(skill => {
      const sourceImages = skill.inputs.find(field => field.key === 'sourceImages')!;
      sourceImages.bindToSourceVersions = false;
      const step = skill.steps.find(candidate => candidate.id === 'sku-creative')!;
      delete step.fanOut;
      step.id = 'sku-creative:0123456789abcdef';
      step.compiledFanOut = {
        inputKey: 'sourceImages', itemIndex: 0, itemDigest: '0123456789abcdef',
      };
    }, 'preset-batch-sku-assets');

    await expect(forgedIdStore.loadEnvelope('user-1')).rejects.toBeInstanceOf(SkillStorageError);
    await expect(unboundStore.loadEnvelope('user-1')).rejects.toBeInstanceOf(SkillStorageError);
  });

  it('rejects stored compiled steps that reuse the same frozen input index', async () => {
    const store = await overwriteFirstStoredSkill(skill => {
      const step = skill.steps.find(candidate => candidate.id === 'sku-creative')!;
      delete step.fanOut;
      step.id = 'sku-creative:0123456789abcdef';
      step.compiledFanOut = {
        inputKey: 'sourceImages', itemIndex: 0, itemDigest: '0123456789abcdef',
      };
      skill.steps.push({
        ...structuredClone(step),
        id: 'sku-creative-copy:0123456789abcdef',
      });
    }, 'preset-batch-sku-assets');

    await expect(store.loadEnvelope('user-1')).rejects.toBeInstanceOf(SkillStorageError);
  });

  it.each([
    { execution: 'sequential' },
    { parallelGroup: undefined },
  ])('rejects stored compiled fan-out outside a named parallel group %#', async override => {
    const store = await overwriteFirstStoredSkill(skill => {
      const step = skill.steps.find(candidate => candidate.id === 'sku-creative')! as
        typeof skill.steps[number] & { execution?: unknown; parallelGroup?: unknown };
      delete step.fanOut;
      step.compiledFanOut = {
        inputKey: 'sourceImages', itemIndex: 0, itemDigest: '0123456789abcdef',
      };
      Object.assign(step, override);
    }, 'preset-batch-sku-assets');

    await expect(store.loadEnvelope('user-1')).rejects.toBeInstanceOf(SkillStorageError);
  });

  it('rejects recursively forged stored step enums', async () => {
    const store = await overwriteFirstStoredSkill(skill => {
      skill.steps[0]!.modelRole = 'root';
    });

    await expect(store.loadEnvelope('user-1')).rejects.toBeInstanceOf(SkillStorageError);
  });

  it('rejects non-boolean source-version bindings in stored inputs', async () => {
    const store = await overwriteFirstStoredSkill(skill => {
      skill.inputs[0]!.bindToSourceVersions = 'true';
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
