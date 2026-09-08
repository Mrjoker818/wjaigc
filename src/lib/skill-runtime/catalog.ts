import { CANVAS_PRESET_SKILLS } from './canvas-presets';
import { LOVART_CONTENT_COMMERCE_SKILLS } from './content-commerce-presets';
import { LOVART_MARKETING_SKILLS } from './marketing-presets';
import { LOVART_PLATFORM_COMPLIANCE_SKILLS } from './platform-compliance-preset';
import { SIMPLE_CHAT_PRESET_SKILLS } from './simple-chat-presets';
import type { SkillDefinition, SkillSurface } from './types';

export { CANVAS_PRESET_SKILLS } from './canvas-presets';
export { LOVART_CONTENT_COMMERCE_SKILLS } from './content-commerce-presets';
export { LOVART_MARKETING_SKILLS } from './marketing-presets';
export { LOVART_PLATFORM_COMPLIANCE_SKILLS } from './platform-compliance-preset';
export { SIMPLE_CHAT_PRESET_SKILLS } from './simple-chat-presets';
export type { SkillDefinition, SkillSurface } from './types';

export const CANVAS_WORKFLOW_SKILLS: readonly SkillDefinition[] = [
  ...CANVAS_PRESET_SKILLS,
  ...LOVART_MARKETING_SKILLS,
  ...LOVART_CONTENT_COMMERCE_SKILLS,
  ...LOVART_PLATFORM_COMPLIANCE_SKILLS,
];

const ALL_BUILT_IN_SKILLS: readonly SkillDefinition[] = [
  ...CANVAS_WORKFLOW_SKILLS,
  ...SIMPLE_CHAT_PRESET_SKILLS,
];

export class SkillNotFoundError extends Error {
  readonly code = 'SKILL_NOT_FOUND';
  readonly status = 404;

  constructor(id: string) {
    super(`Skill not found: ${id}`);
    this.name = 'SkillNotFoundError';
  }
}

export class SkillSurfaceForbiddenError extends Error {
  readonly code = 'SKILL_SURFACE_FORBIDDEN';
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = 'SkillSurfaceForbiddenError';
  }
}

export function listSkillsForSurface(surface: SkillSurface): SkillDefinition[] {
  return ALL_BUILT_IN_SKILLS.filter(
    skill => skill.enabled && skill.allowedSurfaces.includes(surface),
  );
}

export function requireSkillForSurface(id: string, surface: SkillSurface): SkillDefinition {
  const skill = ALL_BUILT_IN_SKILLS.find(candidate => candidate.id === id);
  if (!skill) throw new SkillNotFoundError(id);
  if (!skill.enabled || !skill.allowedSurfaces.includes(surface)) {
    throw new SkillSurfaceForbiddenError('此 Skill 不适用于当前工作区');
  }
  return skill;
}
