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

export interface SkillInputField {
  key: string;
  label: string;
  kind: SkillInputKind;
  required: boolean;
  defaultValue?: unknown;
  options?: readonly string[];
  maximumItems?: number;
  bindToSourceVersions?: boolean;
  datasetSchema?: 'sku-v1';
}

export interface SkillModelBinding {
  role: 'orchestrator' | 'image' | 'video' | 'vision' | 'edit' | 'three-d';
  requiredCapabilities: readonly string[];
}

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
  modelRole: SkillModelBinding['role'];
  qualityGateIds: readonly string[];
  when?: SkillStepCondition;
  fanOut?: SkillStepFanOut;
  compiledFanOut?: CompiledSkillStepFanOut;
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

export interface SkillResultMedia {
  hasTransparency?: boolean;
  width?: number;
  height?: number;
}

export interface DurableSkillOutput {
  stepId: string;
  kind: 'text' | 'html';
  content: string;
}

export interface SkillStepResult {
  assetVersionIds: readonly string[];
  media: readonly SkillResultMedia[];
  text?: string;
  html?: string;
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
