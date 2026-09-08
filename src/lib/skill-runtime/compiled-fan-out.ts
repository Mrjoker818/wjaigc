import type { CompiledSkillStepFanOut, SkillInputField } from './types';

const TOKEN_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const ITEM_DIGEST = /^[a-f0-9]{16}$/;
const COMPILED_KEYS = new Set(['inputKey', 'itemIndex', 'itemDigest']);

export class CompiledSkillFanOutContractError extends Error {
  constructor() {
    super('Compiled Skill fan-out contract is invalid');
    this.name = 'CompiledSkillFanOutContractError';
  }
}

export function parseCompiledSkillFanOut(
  step: Readonly<Record<string, unknown>>,
): CompiledSkillStepFanOut | undefined {
  if (!Object.hasOwn(step, 'compiledFanOut')) return undefined;
  const value = step.compiledFanOut;
  if (
    Object.hasOwn(step, 'fanOut')
    || step.execution !== 'parallel'
    || typeof step.parallelGroup !== 'string'
    || !step.parallelGroup
    || !value
    || typeof value !== 'object'
    || Array.isArray(value)
  ) throw new CompiledSkillFanOutContractError();

  const compiled = value as Record<string, unknown>;
  const keys = Object.keys(compiled);
  if (
    keys.length !== COMPILED_KEYS.size
    || keys.some(key => !COMPILED_KEYS.has(key))
    || typeof compiled.inputKey !== 'string'
    || !TOKEN_ID.test(compiled.inputKey)
    || !Number.isSafeInteger(compiled.itemIndex)
    || Number(compiled.itemIndex) < 0
    || typeof compiled.itemDigest !== 'string'
    || !ITEM_DIGEST.test(compiled.itemDigest)
  ) throw new CompiledSkillFanOutContractError();

  return {
    inputKey: compiled.inputKey,
    itemIndex: Number(compiled.itemIndex),
    itemDigest: compiled.itemDigest,
  };
}

export function assertCompiledSkillFanOutFieldContract(
  step: Readonly<Record<string, unknown>>,
  inputs: readonly unknown[],
): CompiledSkillStepFanOut | undefined {
  const compiled = parseCompiledSkillFanOut(step);
  if (!compiled) return undefined;
  if (typeof step.id !== 'string' || !step.id.endsWith(`:${compiled.itemDigest}`)) {
    throw new CompiledSkillFanOutContractError();
  }
  const field = inputs.find(candidate => (
    candidate !== null
    && typeof candidate === 'object'
    && !Array.isArray(candidate)
    && (candidate as Record<string, unknown>).key === compiled.inputKey
  )) as SkillInputField | undefined;
  if (
    !field
    || (field.kind !== 'dataset' && field.kind !== 'images')
    || (field.kind === 'images' && field.bindToSourceVersions !== true)
  ) {
    throw new CompiledSkillFanOutContractError();
  }
  return compiled;
}

export function assertCompiledSkillFanOutContracts(definition: {
  inputs: readonly unknown[];
  steps: readonly unknown[];
}): void {
  const records = definition.steps.map(step => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      throw new CompiledSkillFanOutContractError();
    }
    return step as Readonly<Record<string, unknown>>;
  });
  if (!records.some(step => Object.hasOwn(step, 'compiledFanOut'))) return;

  const stepIds = new Set<string>();
  const itemIdentities = new Set<string>();
  for (const step of records) {
    if (typeof step.id !== 'string' || stepIds.has(step.id)) {
      throw new CompiledSkillFanOutContractError();
    }
    stepIds.add(step.id);
    const compiled = assertCompiledSkillFanOutFieldContract(step, definition.inputs);
    if (!compiled) continue;
    const itemIdentity = `${compiled.inputKey}:${compiled.itemIndex}`;
    if (itemIdentities.has(itemIdentity)) {
      throw new CompiledSkillFanOutContractError();
    }
    itemIdentities.add(itemIdentity);
  }
}
