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
  paramSlots?: LegacyParamSlot[];
  steps?: LegacyStep[];
  createdAt?: number;
  updatedAt?: number;
  usageCount?: number;
}

export interface LegacyMigrationResult {
  skills: SkillDefinition[];
  migratedLegacyIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLegacyChatSkill(value: unknown): value is LegacyChatSkill {
  if (!isRecord(value)) return false;
  return ['id', 'name', 'category', 'description', 'systemPrompt']
    .every(key => typeof value[key] === 'string' && value[key].length > 0);
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
  return value.filter(isRecord).flatMap(slot => {
    if (typeof slot.name !== 'string' || typeof slot.label !== 'string') return [];
    return [{
      key: slot.name,
      label: slot.label,
      kind: 'text' as const,
      required: typeof slot.defaultValue !== 'string',
      ...(typeof slot.defaultValue === 'string' ? { defaultValue: slot.defaultValue } : {}),
    }];
  });
}

function normalizeSteps(value: unknown): SkillStepDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((step, index) => {
    if (
      (step.role !== 'user' && step.role !== 'assistant')
      || typeof step.content !== 'string'
    ) return [];
    return [{
      id: `conversation-${index + 1}`,
      label: step.role === 'user' ? '需求输入' : '结果交付',
      toolId: 'generate_image',
      execution: 'sequential' as const,
      promptTemplate: step.content,
      modelRole: 'image' as const,
      qualityGateIds: ['output-exists'],
    }];
  });
}

export function normalizeLegacyChatSkills(input: {
  userId: string;
  legacyValue: unknown;
  migratedLegacyIds: readonly string[];
  existingSkillIds: readonly string[];
  now: number;
  builtInIds: ReadonlySet<string>;
}): LegacyMigrationResult {
  const migrated = new Set(input.migratedLegacyIds);
  const existing = new Set(input.existingSkillIds);
  const skills: SkillDefinition[] = [];

  if (!Array.isArray(input.legacyValue)) {
    return { skills, migratedLegacyIds: [...migrated] };
  }

  for (const candidate of input.legacyValue) {
    if (!isLegacyChatSkill(candidate)) continue;
    if (candidate.id.startsWith('preset-') || input.builtInIds.has(candidate.id)) continue;
    if (migrated.has(candidate.id)) continue;

    const id = legacyCopyId(input.userId, candidate.id);
    migrated.add(candidate.id);
    if (existing.has(id)) continue;
    existing.add(id);
    skills.push({
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
      createdAt: Number.isSafeInteger(candidate.createdAt) ? candidate.createdAt as number : input.now,
      updatedAt: Number.isSafeInteger(candidate.updatedAt) ? candidate.updatedAt as number : input.now,
      usageCount: Number.isSafeInteger(candidate.usageCount) && (candidate.usageCount as number) >= 0
        ? candidate.usageCount as number
        : 0,
    });
  }

  return { skills, migratedLegacyIds: [...migrated] };
}

export async function migrateLegacyChatSkills(userId: string): Promise<LegacyMigrationResult> {
  const { migrateLegacyChatSkillsForUser } = await import('./storage');
  return migrateLegacyChatSkillsForUser(userId);
}
