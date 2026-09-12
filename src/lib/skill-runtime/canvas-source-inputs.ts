import type { SkillInputField } from './types';

interface CanvasSkillSourceCandidate {
  assetVersionId?: string;
}

interface CanvasSkillSourceInput {
  selected?: CanvasSkillSourceCandidate | null;
  pending?: readonly CanvasSkillSourceCandidate[];
  mentions?: readonly CanvasSkillSourceCandidate[];
}

export function collectCanvasSkillSourceVersionIds(
  input: CanvasSkillSourceInput,
): string[] {
  return [...new Set([
    input.selected?.assetVersionId,
    ...(input.pending ?? []).map(item => item.assetVersionId),
    ...(input.mentions ?? []).map(item => item.assetVersionId),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

export function bindCanvasSkillSourceInputs(
  fields: readonly SkillInputField[],
  values: Readonly<Record<string, unknown>>,
  sourceVersionIds: readonly string[],
): Record<string, unknown> {
  const contextualInputs = { ...values };
  let imageSourceIndex = 0;
  for (const field of fields) {
    if (contextualInputs[field.key] !== undefined) continue;
    if (field.kind === 'image' && sourceVersionIds[imageSourceIndex]) {
      contextualInputs[field.key] = sourceVersionIds[imageSourceIndex];
      imageSourceIndex += 1;
    } else if (field.kind === 'images' && sourceVersionIds.length > 0) {
      contextualInputs[field.key] = [...sourceVersionIds];
    }
  }
  return contextualInputs;
}
