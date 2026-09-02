export type SkillSurface = 'canvas' | 'workflow' | 'simple-chat';

export type SkillInputKind =
  | 'text'
  | 'image'
  | 'images'
  | 'brand-kit'
  | 'dataset'
  | 'select'
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
}

export interface SkillModelBinding {
  role: 'orchestrator' | 'image' | 'video' | 'vision' | 'edit' | 'three-d';
  requiredCapabilities: readonly string[];
}

export interface SkillStepDefinition {
  id: string;
  label: string;
  toolId: string;
  execution: 'sequential' | 'parallel';
  parallelGroup?: string;
  promptTemplate: string;
  modelRole: SkillModelBinding['role'];
  qualityGateIds: readonly string[];
}

export interface SkillDefinition {
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
  createdAt: number;
  updatedAt: number;
  usageCount: number;
}
