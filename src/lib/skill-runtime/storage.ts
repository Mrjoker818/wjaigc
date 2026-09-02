import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

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
const INPUT_KINDS = new Set(['text', 'image', 'images', 'brand-kit', 'dataset', 'select', 'number', 'boolean']);
const MODEL_ROLES = new Set(['orchestrator', 'image', 'video', 'vision', 'edit', 'three-d']);
const MAX_ENVELOPE_BYTES = 1_048_576;
const LEGACY_CUSTOM_ID = /^skill-[1-9][0-9]{12}$/;
const GENERATED_SKILL_ID = /^skill-[a-f0-9]{24}$/;
const TOKEN_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

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

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function isBoundedString(value: unknown, maximum: number, pattern?: RegExp): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value.trim().length > 0
    && (!pattern || pattern.test(value));
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedJsonValue(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return typeof value !== 'string' || value.length <= 4_096;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= 8) return false;
  if (Array.isArray(value)) {
    return value.length <= 64 && value.every(item => isBoundedJsonValue(item, depth + 1));
  }
  if (!isRecord(value) || Object.keys(value).length > 64) return false;
  return Object.entries(value).every(([key, item]) =>
    key.length > 0 && key.length <= 128 && isBoundedJsonValue(item, depth + 1));
}

function isStoredInput(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'key', 'label', 'kind', 'required', 'defaultValue', 'options', 'maximumItems',
  ])) return false;
  if (
    !isBoundedString(value.key, 64, TOKEN_ID)
    || !isBoundedString(value.label, 120)
    || typeof value.kind !== 'string'
    || !INPUT_KINDS.has(value.kind)
    || typeof value.required !== 'boolean'
  ) return false;
  if ('defaultValue' in value && !isBoundedJsonValue(value.defaultValue)) return false;
  if ('options' in value) {
    if (
      value.kind !== 'select'
      || !Array.isArray(value.options)
      || value.options.length === 0
      || value.options.length > 100
      || !value.options.every(option => isBoundedString(option, 200))
    ) return false;
  } else if (value.kind === 'select') return false;
  if ('maximumItems' in value) {
    if (
      value.kind !== 'images'
      || !Number.isSafeInteger(value.maximumItems)
      || (value.maximumItems as number) < 1
      || (value.maximumItems as number) > 1_000
    ) return false;
  }
  return true;
}

function isStoredStep(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'id', 'label', 'toolId', 'execution', 'parallelGroup', 'promptTemplate',
    'modelRole', 'qualityGateIds',
  ])) return false;
  if (
    !isBoundedString(value.id, 128, TOKEN_ID)
    || !isBoundedString(value.label, 120)
    || !isBoundedString(value.toolId, 128, TOKEN_ID)
    || (value.execution !== 'sequential' && value.execution !== 'parallel')
    || !isBoundedString(value.promptTemplate, 32_768)
    || typeof value.modelRole !== 'string'
    || !MODEL_ROLES.has(value.modelRole)
    || !Array.isArray(value.qualityGateIds)
    || value.qualityGateIds.length > 32
    || !value.qualityGateIds.every(id => isBoundedString(id, 128, TOKEN_ID))
  ) return false;
  return !('parallelGroup' in value) || isBoundedString(value.parallelGroup, 128, TOKEN_ID);
}

function hasUniqueSurfaces(value: unknown): value is SkillSurface[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= SURFACES.length
    && value.every(isSurface)
    && new Set(value).size === value.length;
}

function sameSurfaces(left: readonly SkillSurface[], right: readonly SkillSurface[]): boolean {
  return left.length === right.length && left.every(surface => right.includes(surface));
}

function expectedSourceSurfaces(sourceSkillId: string): readonly SkillSurface[] | null {
  const builtIn = BUILT_INS.find(skill => skill.id === sourceSkillId);
  if (builtIn) return builtIn.allowedSurfaces;
  if (LEGACY_CUSTOM_ID.test(sourceSkillId)) return ['canvas', 'workflow'];
  return null;
}

function isStoredSkill(value: unknown): value is SkillDefinition {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'id', 'version', 'name', 'category', 'description', 'systemPrompt',
    'allowedSurfaces', 'inputs', 'steps', 'enabled', 'builtIn', 'ownerId',
    'sourceSkillId', 'sourceAllowedSurfaces', 'createdAt', 'updatedAt', 'usageCount',
  ])) return false;
  if (
    !isBoundedString(value.sourceSkillId, 128)
    || !hasUniqueSurfaces(value.sourceAllowedSurfaces)
    || !hasUniqueSurfaces(value.allowedSurfaces)
  ) return false;
  const sourceAllowedSurfaces = value.sourceAllowedSurfaces;
  const allowedSurfaces = value.allowedSurfaces;
  const expectedSurfaces = expectedSourceSurfaces(value.sourceSkillId);
  if (
    !expectedSurfaces
    || !sameSurfaces(sourceAllowedSurfaces, expectedSurfaces)
    || !allowedSurfaces.every(surface => sourceAllowedSurfaces.includes(surface))
  ) return false;
  return isBoundedString(value.id, 30, GENERATED_SKILL_ID)
    && Number.isSafeInteger(value.version)
    && (value.version as number) >= 1
    && isBoundedString(value.name, 120)
    && isBoundedString(value.category, 64)
    && isBoundedString(value.description, 2_000)
    && isBoundedString(value.systemPrompt, 32_768)
    && Array.isArray(value.inputs)
    && value.inputs.length <= 64
    && value.inputs.every(isStoredInput)
    && new Set(value.inputs.map(input => (input as { key: string }).key)).size === value.inputs.length
    && Array.isArray(value.steps)
    && value.steps.length <= 64
    && value.steps.every(isStoredStep)
    && new Set(value.steps.map(step => (step as { id: string }).id)).size === value.steps.length
    && typeof value.enabled === 'boolean'
    && value.builtIn === false
    && isBoundedString(value.ownerId, 128)
    && isNonNegativeSafeInteger(value.createdAt)
    && isNonNegativeSafeInteger(value.updatedAt)
    && (value.updatedAt as number) >= (value.createdAt as number)
    && isNonNegativeSafeInteger(value.usageCount);
}

export function parseUserSkillEnvelope(value: unknown): UserSkillEnvelope {
  if (value === null || value === undefined) return emptyEnvelope();
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 0
    || !Array.isArray(value.skills)
    || value.skills.length > 256
    || !value.skills.every(isStoredSkill)
    || !Array.isArray(value.migratedLegacyIds)
    || value.migratedLegacyIds.length > 256
    || !value.migratedLegacyIds.every(id => isBoundedString(id, 19, LEGACY_CUSTOM_ID))
    || new Set(value.migratedLegacyIds).size !== value.migratedLegacyIds.length
  ) {
    throw new SkillStorageError();
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_ENVELOPE_BYTES) {
      throw new SkillStorageError();
    }
  } catch (error) {
    if (error instanceof SkillStorageError) throw error;
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
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new Error('Invalid expected revision');
      }
      const identity = `${userId}\0${key}`;
      const previous = queues.get(identity) ?? Promise.resolve();
      let release: () => void = () => undefined;
      const current = new Promise<void>(resolve => { release = resolve; });
      queues.set(identity, previous.then(() => current));
      await previous;
      try {
        const exists = values.has(identity);
        const stored = values.get(identity);
        if (!exists) {
          if (expectedRevision !== 0) return false;
          values.set(identity, structuredClone(value));
          return true;
        }
        if (
          !isRecord(stored)
          || !Number.isSafeInteger(stored.revision)
          || (stored.revision as number) < 0
        ) return false;
        const revision = stored.revision as number;
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
  parseUserSkillEnvelope(savedEnvelope);
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
  options: { now?: () => number; createId?: () => string } = {},
) {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => `skill-${randomUUID().replaceAll('-', '').slice(0, 24)}`);

  const migrateLegacy = async (userId: string): Promise<LegacyMigrationResult> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const envelope = await readEnvelope(adapter, userId);
      const legacyValue = await adapter.get(userId, LEGACY_CHAT_SKILLS_KEY);
      const migration = normalizeLegacyChatSkills({
        userId,
        legacyValue,
        migratedLegacyIds: envelope.migratedLegacyIds,
        existingSkills: envelope.skills,
        now: now(),
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
        && skill.allowedSurfaces.includes(surface),
      );
      return [...cloneBuiltIns(surface), ...structuredClone(userSkills)];
    },
    async createConversation(input: {
      actorUserId: string;
      name: string;
      description: string;
      conversation: string;
    }): Promise<SkillDefinition> {
      const source = CANVAS_PRESET_SKILLS.find(skill => skill.id === 'preset-concept-art');
      if (!source) throw new SkillStorageError();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const envelope = await readEnvelope(adapter, input.actorUserId);
        const timestamp = now();
        const id = createId();
        if (!GENERATED_SKILL_ID.test(id) || envelope.skills.some(skill => skill.id === id)) {
          if (attempt === 4) throw new SkillRevisionConflictError();
          continue;
        }
        const skill: SkillDefinition = {
          id,
          version: 1,
          name: input.name,
          category: source.category,
          description: input.description,
          systemPrompt: `${source.systemPrompt}\n\nSaved conversation context:\n${input.conversation}`,
          allowedSurfaces: [...source.allowedSurfaces],
          inputs: source.inputs.map(field => ({
            key: field.key,
            label: field.label,
            kind: field.kind,
            required: field.required,
            ...(field.defaultValue === undefined ? {} : { defaultValue: structuredClone(field.defaultValue) }),
            ...(field.options === undefined ? {} : { options: [...field.options] }),
            ...(field.maximumItems === undefined ? {} : { maximumItems: field.maximumItems }),
          })),
          steps: source.steps.map(step => ({
            id: step.id,
            label: step.label,
            toolId: step.toolId,
            execution: step.execution,
            ...(step.parallelGroup === undefined ? {} : { parallelGroup: step.parallelGroup }),
            promptTemplate: step.promptTemplate,
            modelRole: step.modelRole,
            qualityGateIds: [...step.qualityGateIds],
          })),
          enabled: true,
          builtIn: false,
          ownerId: input.actorUserId,
          sourceSkillId: source.id,
          sourceAllowedSurfaces: [...source.allowedSurfaces],
          createdAt: timestamp,
          updatedAt: timestamp,
          usageCount: 0,
        };
        try {
          await saveEnvelope(adapter, input.actorUserId, envelope.revision, {
            ...envelope,
            skills: [...envelope.skills, skill],
          });
          return structuredClone(skill);
        } catch (error) {
          if (!(error instanceof SkillRevisionConflictError) || attempt === 4) throw error;
        }
      }
      throw new SkillRevisionConflictError();
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
        const sourceSkillId = source.sourceSkillId ?? source.id;
        const sourceAllowedSurfaces = source.sourceAllowedSurfaces ?? source.allowedSurfaces;
        const copy: SkillDefinition = {
          id,
          version: 1,
          name: source.name,
          category: source.category,
          description: source.description,
          systemPrompt: source.systemPrompt,
          allowedSurfaces: [...source.allowedSurfaces],
          inputs: source.inputs.map(field => ({
            key: field.key,
            label: field.label,
            kind: field.kind,
            required: field.required,
            ...(field.defaultValue === undefined ? {} : { defaultValue: structuredClone(field.defaultValue) }),
            ...(field.options === undefined ? {} : { options: [...field.options] }),
            ...(field.maximumItems === undefined ? {} : { maximumItems: field.maximumItems }),
          })),
          steps: source.steps.map(step => ({
            id: step.id,
            label: step.label,
            toolId: step.toolId,
            execution: step.execution,
            ...(step.parallelGroup === undefined ? {} : { parallelGroup: step.parallelGroup }),
            promptTemplate: step.promptTemplate,
            modelRole: step.modelRole,
            qualityGateIds: [...step.qualityGateIds],
          })),
          enabled: true,
          builtIn: false,
          ownerId: input.actorUserId,
          sourceSkillId,
          sourceAllowedSurfaces: [...sourceAllowedSurfaces],
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
    async remove(input: { actorUserId: string; skillId: string }): Promise<void> {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const envelope = await readEnvelope(adapter, input.actorUserId);
        const index = envelope.skills.findIndex(skill => (
          skill.id === input.skillId && skill.ownerId === input.actorUserId
        ));
        if (index < 0) throw new UserSkillNotFoundError();
        const skills = envelope.skills.filter((_, candidateIndex) => candidateIndex !== index);
        try {
          await saveEnvelope(adapter, input.actorUserId, envelope.revision, { ...envelope, skills });
          return;
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
export const createConversationSkillForUser = (
  actorUserId: string,
  input: { name: string; description: string; conversation: string },
): Promise<SkillDefinition> => defaultStore.createConversation({ actorUserId, ...input });
export const updateUserSkill = (
  actorUserId: string,
  skillId: string,
  patch: { enabled?: boolean; name?: string; description?: string },
): Promise<SkillDefinition> => defaultStore.update({ actorUserId, skillId, ...patch });
export const deleteUserSkill = (
  actorUserId: string,
  skillId: string,
): Promise<void> => defaultStore.remove({ actorUserId, skillId });
export const migrateLegacyChatSkillsForUser = defaultStore.migrateLegacy;
export const loadUserSkillEnvelope = defaultStore.loadEnvelope;
export const saveUserSkillEnvelope = defaultStore.saveEnvelope;
