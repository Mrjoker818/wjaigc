import 'server-only';

import { createHash } from 'node:crypto';

import {
  dbCompareAndSetUserDataRevision,
  dbGetUserData,
} from '@/lib/db-storage';
import { CANVAS_PRESET_SKILLS, SIMPLE_CHAT_PRESET_SKILLS } from './catalog';
import { normalizeLegacyChatSkills, type LegacyMigrationResult } from './legacy-migration';
import type { SkillDefinition, SkillSurface } from './types';

export const SKILL_CATALOG_KEY = 'skill_catalog_v1';
const LEGACY_CHAT_SKILLS_KEY = 'chat_skills';
const SURFACES: readonly SkillSurface[] = ['canvas', 'workflow', 'simple-chat'];
const BUILT_INS: readonly SkillDefinition[] = [...CANVAS_PRESET_SKILLS, ...SIMPLE_CHAT_PRESET_SKILLS];
const BUILT_IN_IDS = new Set(BUILT_INS.map(skill => skill.id));

export interface UserSkillEnvelope {
  schemaVersion: 1;
  revision: number;
  skills: SkillDefinition[];
  migratedLegacyIds: string[];
}

export interface SkillStorageAdapter {
  get(userId: string, key: string): Promise<unknown>;
  compareAndSet(
    userId: string,
    key: string,
    expectedRevision: number,
    value: UserSkillEnvelope,
  ): Promise<boolean>;
}

export class SkillRevisionConflictError extends Error {
  readonly code = 'SKILL_REVISION_CONFLICT';
  readonly status = 409;

  constructor() {
    super('Skill catalog revision conflict');
    this.name = 'SkillRevisionConflictError';
  }
}

export class SkillStorageError extends Error {
  readonly code = 'SKILL_STORAGE_ERROR';
  readonly status = 500;

  constructor() {
    super('Skill storage failed');
    this.name = 'SkillStorageError';
  }
}

export class InvalidSkillSurfaceError extends Error {
  readonly code = 'INVALID_SKILL_SURFACE';
  readonly status = 400;

  constructor() {
    super('surface must be canvas, workflow, or simple-chat');
    this.name = 'InvalidSkillSurfaceError';
  }
}

export class UserSkillNotFoundError extends Error {
  readonly code = 'SKILL_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Skill not found');
    this.name = 'UserSkillNotFoundError';
  }
}

function emptyEnvelope(): UserSkillEnvelope {
  return { schemaVersion: 1, revision: 0, skills: [], migratedLegacyIds: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSurface(value: unknown): value is SkillSurface {
  return typeof value === 'string' && SURFACES.includes(value as SkillSurface);
}

function isStoredSkill(value: unknown): value is SkillDefinition {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && !value.id.startsWith('preset-')
    && Number.isSafeInteger(value.version)
    && (value.version as number) >= 1
    && typeof value.name === 'string'
    && typeof value.category === 'string'
    && typeof value.description === 'string'
    && typeof value.systemPrompt === 'string'
    && Array.isArray(value.allowedSurfaces)
    && value.allowedSurfaces.length > 0
    && value.allowedSurfaces.every(isSurface)
    && Array.isArray(value.inputs)
    && Array.isArray(value.steps)
    && typeof value.enabled === 'boolean'
    && value.builtIn === false
    && typeof value.ownerId === 'string'
    && Number.isSafeInteger(value.createdAt)
    && Number.isSafeInteger(value.updatedAt)
    && Number.isSafeInteger(value.usageCount);
}

export function parseUserSkillEnvelope(value: unknown): UserSkillEnvelope {
  if (value === null || value === undefined) return emptyEnvelope();
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 0
    || !Array.isArray(value.skills)
    || !value.skills.every(isStoredSkill)
    || !Array.isArray(value.migratedLegacyIds)
    || !value.migratedLegacyIds.every(id => typeof id === 'string')
  ) {
    throw new SkillStorageError();
  }
  return {
    schemaVersion: 1,
    revision: value.revision as number,
    skills: structuredClone(value.skills) as SkillDefinition[],
    migratedLegacyIds: [...value.migratedLegacyIds] as string[],
  };
}

const databaseAdapter: SkillStorageAdapter = {
  get: dbGetUserData,
  compareAndSet: dbCompareAndSetUserDataRevision,
};

export function createMemorySkillStorageAdapter(
  seed: Record<string, Record<string, unknown>> = {},
): SkillStorageAdapter & { inspect(userId: string, key: string): unknown } {
  const values = new Map<string, unknown>();
  for (const [userId, entries] of Object.entries(seed)) {
    for (const [key, value] of Object.entries(entries)) {
      values.set(`${userId}\0${key}`, structuredClone(value));
    }
  }
  const queues = new Map<string, Promise<void>>();
  const adapter = {
    async get(userId: string, key: string): Promise<unknown> {
      return structuredClone(values.get(`${userId}\0${key}`) ?? null);
    },
    async compareAndSet(
      userId: string,
      key: string,
      expectedRevision: number,
      value: UserSkillEnvelope,
    ): Promise<boolean> {
      const identity = `${userId}\0${key}`;
      const previous = queues.get(identity) ?? Promise.resolve();
      let release: () => void = () => undefined;
      const current = new Promise<void>(resolve => { release = resolve; });
      queues.set(identity, previous.then(() => current));
      await previous;
      try {
        const stored = values.get(identity);
        const revision = isRecord(stored) && Number.isSafeInteger(stored.revision)
          ? stored.revision as number
          : 0;
        if (revision !== expectedRevision) return false;
        values.set(identity, structuredClone(value));
        return true;
      } finally {
        release();
      }
    },
    inspect(userId: string, key: string): unknown {
      return structuredClone(values.get(`${userId}\0${key}`) ?? null);
    },
  };
  return adapter;
}

function copyId(userId: string, sourceSkillId: string): string {
  const digest = createHash('sha256')
    .update(userId)
    .update('\0')
    .update(sourceSkillId)
    .digest('hex')
    .slice(0, 24);
  return `skill-${digest}`;
}

function cloneBuiltIns(surface: SkillSurface): SkillDefinition[] {
  return BUILT_INS
    .filter(skill => skill.enabled && skill.allowedSurfaces.includes(surface))
    .map(skill => structuredClone(skill));
}

async function readEnvelope(adapter: SkillStorageAdapter, userId: string): Promise<UserSkillEnvelope> {
  try {
    return parseUserSkillEnvelope(await adapter.get(userId, SKILL_CATALOG_KEY));
  } catch (error) {
    if (error instanceof SkillStorageError) throw error;
    throw new SkillStorageError();
  }
}

async function saveEnvelope(
  adapter: SkillStorageAdapter,
  userId: string,
  expectedRevision: number,
  next: UserSkillEnvelope,
): Promise<UserSkillEnvelope> {
  const savedEnvelope = {
    ...structuredClone(next),
    schemaVersion: 1 as const,
    revision: expectedRevision + 1,
  };
  let saved: boolean;
  try {
    saved = await adapter.compareAndSet(
      userId,
      SKILL_CATALOG_KEY,
      expectedRevision,
      savedEnvelope,
    );
  } catch {
    throw new SkillStorageError();
  }
  if (!saved) throw new SkillRevisionConflictError();
  return savedEnvelope;
}

export function createSkillStore(
  adapter: SkillStorageAdapter,
  options: { now?: () => number } = {},
) {
  const now = options.now ?? Date.now;

  const migrateLegacy = async (userId: string): Promise<LegacyMigrationResult> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const envelope = await readEnvelope(adapter, userId);
      const legacyValue = await adapter.get(userId, LEGACY_CHAT_SKILLS_KEY);
      const migration = normalizeLegacyChatSkills({
        userId,
        legacyValue,
        migratedLegacyIds: envelope.migratedLegacyIds,
        existingSkillIds: envelope.skills.map(skill => skill.id),
        now: now(),
        builtInIds: BUILT_IN_IDS,
      });
      const changed = migration.skills.length > 0
        || migration.migratedLegacyIds.length !== envelope.migratedLegacyIds.length;
      if (!changed) {
        return { skills: envelope.skills, migratedLegacyIds: envelope.migratedLegacyIds };
      }
      try {
        const saved = await saveEnvelope(adapter, userId, envelope.revision, {
          ...envelope,
          skills: [...envelope.skills, ...migration.skills],
          migratedLegacyIds: migration.migratedLegacyIds,
        });
        return { skills: saved.skills, migratedLegacyIds: saved.migratedLegacyIds };
      } catch (error) {
        if (!(error instanceof SkillRevisionConflictError) || attempt === 4) throw error;
      }
    }
    throw new SkillRevisionConflictError();
  };

  return {
    async load(userId: string, surface: SkillSurface): Promise<SkillDefinition[]> {
      if (!isSurface(surface)) throw new InvalidSkillSurfaceError();
      await migrateLegacy(userId);
      const envelope = await readEnvelope(adapter, userId);
      const userSkills = envelope.skills.filter(skill =>
        skill.ownerId === userId
        && skill.enabled
        && skill.allowedSurfaces.includes(surface),
      );
      return [...cloneBuiltIns(surface), ...structuredClone(userSkills)];
    },
    async copy(input: { actorUserId: string; sourceSkillId: string }): Promise<SkillDefinition> {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const envelope = await readEnvelope(adapter, input.actorUserId);
        const source = BUILT_INS.find(skill => skill.id === input.sourceSkillId)
          ?? envelope.skills.find(skill =>
            skill.id === input.sourceSkillId && skill.ownerId === input.actorUserId,
          );
        if (!source) throw new UserSkillNotFoundError();
        const id = copyId(input.actorUserId, input.sourceSkillId);
        const existing = envelope.skills.find(skill => skill.id === id);
        if (existing) return structuredClone(existing);
        const timestamp = now();
        const copy: SkillDefinition = {
          ...structuredClone(source),
          id,
          version: 1,
          enabled: true,
          builtIn: false,
          ownerId: input.actorUserId,
          createdAt: timestamp,
          updatedAt: timestamp,
          usageCount: 0,
        };
        try {
          await saveEnvelope(adapter, input.actorUserId, envelope.revision, {
            ...envelope,
            skills: [...envelope.skills, copy],
          });
          return copy;
        } catch (error) {
          if (!(error instanceof SkillRevisionConflictError) || attempt === 4) throw error;
        }
      }
      throw new SkillRevisionConflictError();
    },
    async update(input: {
      actorUserId: string;
      skillId: string;
      enabled?: boolean;
      name?: string;
      description?: string;
    }): Promise<SkillDefinition> {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const envelope = await readEnvelope(adapter, input.actorUserId);
        const index = envelope.skills.findIndex(skill =>
          skill.id === input.skillId && skill.ownerId === input.actorUserId,
        );
        if (index < 0) throw new UserSkillNotFoundError();
        const current = envelope.skills[index] as SkillDefinition;
        const updated: SkillDefinition = {
          ...current,
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          version: current.version + 1,
          updatedAt: now(),
        };
        const skills = [...envelope.skills];
        skills[index] = updated;
        try {
          await saveEnvelope(adapter, input.actorUserId, envelope.revision, { ...envelope, skills });
          return structuredClone(updated);
        } catch (error) {
          if (!(error instanceof SkillRevisionConflictError) || attempt === 4) throw error;
        }
      }
      throw new SkillRevisionConflictError();
    },
    migrateLegacy,
    loadEnvelope: (userId: string) => readEnvelope(adapter, userId),
    saveEnvelope: (
      userId: string,
      expectedRevision: number,
      next: UserSkillEnvelope,
    ) => saveEnvelope(adapter, userId, expectedRevision, next),
  };
}

const defaultStore = createSkillStore(databaseAdapter);

export const loadUserSkillCatalog = defaultStore.load;
export const copySkillForUser = (
  actorUserId: string,
  sourceSkillId: string,
): Promise<SkillDefinition> => defaultStore.copy({ actorUserId, sourceSkillId });
export const updateUserSkill = (
  actorUserId: string,
  skillId: string,
  patch: { enabled?: boolean; name?: string; description?: string },
): Promise<SkillDefinition> => defaultStore.update({ actorUserId, skillId, ...patch });
export const migrateLegacyChatSkillsForUser = defaultStore.migrateLegacy;
export const loadUserSkillEnvelope = defaultStore.loadEnvelope;
export const saveUserSkillEnvelope = defaultStore.saveEnvelope;
