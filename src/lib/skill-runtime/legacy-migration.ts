import { createHash } from 'node:crypto';

import type { SkillDefinition, SkillInputField, SkillStepDefinition } from './types';

interface LegacyParamSlot {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
}

interface LegacyStep {
  role: 'user' | 'assistant';
  content: string;
}

interface LegacyChatSkill {
  id: string;
  name: string;
  category: string;
  description: string;
  systemPrompt: string;
  paramSlots: LegacyParamSlot[];
  steps: LegacyStep[];
  createdAt: number;
  updatedAt: number;
  usageCount: number;
}

const LEGACY_CUSTOM_ID = /^skill-[1-9][0-9]{12}$/;
const TOKEN_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const LEGACY_CATEGORIES = new Set(['image', 'design', 'brand', 'editing', 'custom']);
const MAX_LEGACY_RECORDS = 200;
const MAX_ENVELOPE_SKILLS = 256;
const MAX_MIGRATED_IDS = 256;
const MAX_ENVELOPE_BYTES = 1_048_576;

export interface LegacyMigrationResult {
  skills: SkillDefinition[];
  migratedLegacyIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function isLegacyParamSlot(value: unknown): value is LegacyParamSlot {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'name', 'label', 'defaultValue', 'placeholder',
  ])) return false;
  return isBoundedString(value.name, 64, TOKEN_ID)
    && isBoundedString(value.label, 120)
    && (value.defaultValue === undefined || isBoundedString(value.defaultValue, 50))
    && (value.placeholder === undefined || isBoundedString(value.placeholder, 500));
}

function isLegacyStep(value: unknown): value is LegacyStep {
  if (!isRecord(value) || !hasOnlyKeys(value, ['role', 'content'])) return false;
  return (value.role === 'user' || value.role === 'assistant')
    && isBoundedString(value.content, 200);
}

function isLegacyChatSkill(value: unknown): value is LegacyChatSkill {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'id', 'name', 'category', 'description', 'systemPrompt', 'agentId',
    'paramSlots', 'steps', 'createdAt', 'updatedAt', 'usageCount',
  ])) return false;
  if (
    !isBoundedString(value.id, 19, LEGACY_CUSTOM_ID)
    || !isBoundedString(value.name, 120)
    || typeof value.category !== 'string'
    || !LEGACY_CATEGORIES.has(value.category)
    || !isBoundedString(value.description, 2_000)
    || !isBoundedString(value.systemPrompt, 32_768)
    || (value.agentId !== undefined && !isBoundedString(value.agentId, 128))
    || !isNonNegativeSafeInteger(value.createdAt)
    || !isNonNegativeSafeInteger(value.updatedAt)
    || value.updatedAt < value.createdAt
    || !isNonNegativeSafeInteger(value.usageCount)
  ) return false;
  if (
    !Array.isArray(value.paramSlots)
    || value.paramSlots.length > 32
    || !value.paramSlots.every(isLegacyParamSlot)
  ) return false;
  return Array.isArray(value.steps)
    && value.steps.length <= 6
    && value.steps.every(isLegacyStep);
}

function legacyCopyId(userId: string, legacyId: string): string {
  const digest = createHash('sha256')
    .update(userId)
    .update('\0legacy:')
    .update(legacyId)
    .digest('hex')
    .slice(0, 24);
  return `skill-${digest}`;
}

function normalizeInputs(value: unknown): SkillInputField[] {
  if (!Array.isArray(value)) return [];
  return value.map(slot => ({
      key: slot.name,
      label: slot.label,
      kind: 'text' as const,
      required: typeof slot.defaultValue !== 'string',
      ...(typeof slot.defaultValue === 'string' ? { defaultValue: slot.defaultValue } : {}),
  }));
}

function normalizeSteps(value: unknown): SkillStepDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.map((step, index) => ({
      id: `conversation-${index + 1}`,
      label: step.role === 'user' ? '需求输入' : '结果交付',
      toolId: 'generate_image',
      execution: 'sequential' as const,
      promptTemplate: step.content,
      modelRole: 'image' as const,
      qualityGateIds: ['output-exists'],
  }));
}

function fitsEnvelope(
  existingSkills: readonly SkillDefinition[],
  newSkills: readonly SkillDefinition[],
  migratedLegacyIds: readonly string[],
): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify({
      schemaVersion: 1,
      revision: Number.MAX_SAFE_INTEGER,
      skills: [...existingSkills, ...newSkills],
      migratedLegacyIds,
    })).byteLength <= MAX_ENVELOPE_BYTES;
  } catch {
    return false;
  }
}

export function normalizeLegacyChatSkills(input: {
  userId: string;
  legacyValue: unknown;
  migratedLegacyIds: readonly string[];
  existingSkills: readonly SkillDefinition[];
  now: number;
}): LegacyMigrationResult {
  const migrated = new Set(input.migratedLegacyIds);
  const existing = new Set(input.existingSkills.map(skill => skill.id));
  const skills: SkillDefinition[] = [];

  if (!Array.isArray(input.legacyValue)) {
    return { skills, migratedLegacyIds: [...migrated] };
  }

  for (const candidate of input.legacyValue.slice(0, MAX_LEGACY_RECORDS)) {
    if (!isRecord(candidate) || !isBoundedString(candidate.id, 19, LEGACY_CUSTOM_ID)) continue;
    if (migrated.has(candidate.id) || migrated.size >= MAX_MIGRATED_IDS) continue;

    const nextMigratedIds = [...migrated, candidate.id];
    if (!isLegacyChatSkill(candidate)) {
      if (fitsEnvelope(input.existingSkills, skills, nextMigratedIds)) migrated.add(candidate.id);
      continue;
    }

    const id = legacyCopyId(input.userId, candidate.id);
    if (existing.has(id)) {
      migrated.add(candidate.id);
      continue;
    }
    if (input.existingSkills.length + skills.length >= MAX_ENVELOPE_SKILLS) {
      if (fitsEnvelope(input.existingSkills, skills, nextMigratedIds)) migrated.add(candidate.id);
      continue;
    }
    existing.add(id);
    const skill: SkillDefinition = {
      id,
      version: 1,
      name: candidate.name,
      category: candidate.category,
      description: candidate.description,
      systemPrompt: candidate.systemPrompt,
      allowedSurfaces: ['canvas', 'workflow'],
      inputs: normalizeInputs(candidate.paramSlots),
      steps: normalizeSteps(candidate.steps),
      enabled: true,
      builtIn: false,
      ownerId: input.userId,
      sourceSkillId: candidate.id,
      sourceAllowedSurfaces: ['canvas', 'workflow'],
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
      usageCount: candidate.usageCount,
    };
    if (fitsEnvelope(input.existingSkills, [...skills, skill], nextMigratedIds)) {
      migrated.add(candidate.id);
      skills.push(skill);
    } else if (fitsEnvelope(input.existingSkills, skills, nextMigratedIds)) {
      migrated.add(candidate.id);
    }
  }

  return { skills, migratedLegacyIds: [...migrated] };
}

export async function migrateLegacyChatSkills(userId: string): Promise<LegacyMigrationResult> {
  const { migrateLegacyChatSkillsForUser } = await import('./storage');
  return migrateLegacyChatSkillsForUser(userId);
}
