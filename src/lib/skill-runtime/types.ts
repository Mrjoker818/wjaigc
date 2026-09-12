export type SkillSurface = 'canvas' | 'workflow' | 'simple-chat';

export type SkillInputKind =
  | 'text'
  | 'image'
  | 'images'
  | 'brand-kit'
  | 'dataset'
  | 'select'
  | 'multi-select'
  | 'number'
  | 'boolean';

export interface SkillCapabilityOptions {
  modelRole: 'video';
  field: 'durationSeconds' | 'aspectRatio' | 'resolution';
}

export interface SkillInputField {
  key: string;
  label: string;
  kind: SkillInputKind;
  required: boolean;
  defaultValue?: unknown;
  options?: readonly string[];
  maximumItems?: number;
  uniqueItems?: boolean;
  maximumLength?: number;
  dependentOptions?: {
    inputKey: string;
    values: Readonly<Record<string, readonly string[]>>;
  };
  capabilityOptions?: SkillCapabilityOptions;
  bindToSourceVersions?: boolean;
  datasetSchema?: 'sku-v1';
}

export interface SkillModelBinding {
  role: 'orchestrator' | 'image' | 'video' | 'vision' | 'edit' | 'three-d';
  requiredCapabilities: readonly string[];
}

export type SkillStepRuntime = 'model' | 'local';

export interface SkillStepCondition {
  input: string;
  includes: readonly (string | number | boolean)[];
}

export interface SkillStepFanOut {
  inputKey: string;
  itemAlias: string;
  keyField?: string;
  maximumItems: number;
  concurrency: number;
}

export interface SkillApprovalCheckpoint {
  kind: 'user-approval';
  outputSchemaId: string;
  nextStepId: string;
  allowRevision: boolean;
}

export type { SkillApprovalStateV1 } from './approval';

export interface CompiledSkillStepFanOut {
  inputKey: string;
  itemIndex: number;
  itemDigest: string;
}

export interface SkillStepDefinition {
  id: string;
  label: string;
  toolId: string;
  execution: 'sequential' | 'parallel';
  parallelGroup?: string;
  promptTemplate: string;
  promptInstructionTemplate?: string;
  runtime?: SkillStepRuntime;
  modelRole?: SkillModelBinding['role'];
  qualityGateIds: readonly string[];
  when?: SkillStepCondition;
  fanOut?: SkillStepFanOut;
  compiledFanOut?: CompiledSkillStepFanOut;
  approvalCheckpoint?: SkillApprovalCheckpoint;
}

export interface SkillDefinition {
  executionContextVersion?: 1;
  id: string;
  version: number;
  name: string;
  category: string;
  description: string;
  systemPrompt: string;
  allowedSurfaces: readonly SkillSurface[];
  catalogSurfaces?: readonly SkillSurface[];
  inputs: readonly SkillInputField[];
  steps: readonly SkillStepDefinition[];
  enabled: boolean;
  builtIn: boolean;
  ownerId?: string;
  sourceSkillId?: string;
  sourceAllowedSurfaces?: readonly SkillSurface[];
  createdAt: number;
  updatedAt: number;
  usageCount: number;
}

export function skillStepRuntime(step: SkillStepDefinition): SkillStepRuntime {
  return step.runtime ?? 'model';
}

export function skillStepModelRole(
  step: SkillStepDefinition,
): SkillModelBinding['role'] | undefined {
  return skillStepRuntime(step) === 'model' ? step.modelRole : undefined;
}

export function requiredSkillModelRoles(
  skill: SkillDefinition,
): SkillModelBinding['role'][] {
  const roles = new Set<SkillModelBinding['role']>();
  const hasModelSteps = skill.steps.length === 0
    || skill.steps.some(step => skillStepRuntime(step) === 'model');
  if (hasModelSteps) roles.add('orchestrator');
  for (const step of skill.steps) {
    const role = skillStepModelRole(step);
    if (role) roles.add(role);
  }
  return [...roles];
}

export interface SkillResultMedia {
  hasTransparency?: boolean;
  width?: number;
  height?: number;
}

export type DurableSkillOutput =
  | { stepId: string; kind: 'text' | 'html'; content: string }
  | { stepId: string; kind: 'json'; schemaId: string; content: string };

export interface SkillStructuredResult {
  schemaId: string;
  value: unknown;
}

export interface SkillStepResult {
  assetVersionIds: readonly string[];
  media: readonly SkillResultMedia[];
  text?: string;
  html?: string;
  structured?: SkillStructuredResult;
}

export interface SkillQualityContext {
  expectedCount?: number;
  expectedAspectRatio?: string;
}

export interface SkillQualityResult {
  id: string;
  passed: boolean;
  error?: string;
}

export type SkillQualityGate = (
  result: SkillStepResult,
  context: SkillQualityContext,
) => boolean;
