export interface GenerationRouteParty {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
}

export interface GenerationRouteAudit {
  requested: GenerationRouteParty;
  actual: GenerationRouteParty;
  fallbackReason?: string;
}

interface BuildGenerationRouteAuditInput {
  requested: GenerationRouteParty;
  actual: GenerationRouteParty;
  fallbackReason?: string;
}

function isCompleteParty(value: GenerationRouteParty): boolean {
  return Boolean(
    value.providerId.trim()
    && value.providerName.trim()
    && value.modelId.trim()
    && value.modelName.trim(),
  );
}

export function buildGenerationRouteAudit(
  input: BuildGenerationRouteAuditInput,
): GenerationRouteAudit | null {
  if (!isCompleteParty(input.requested) || !isCompleteParty(input.actual)) {
    return null;
  }

  const routeChanged = input.requested.providerId !== input.actual.providerId
    || input.requested.modelId !== input.actual.modelId;

  return {
    requested: input.requested,
    actual: input.actual,
    ...(routeChanged && input.fallbackReason?.trim()
      ? { fallbackReason: input.fallbackReason.trim() }
      : {}),
  };
}
