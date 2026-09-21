export interface ProviderDisplaySource {
  id?: string;
  name?: string;
  displayName?: string;
}

export interface CanvasProviderDisplayIdentity {
  providerId?: unknown;
  providerName?: unknown;
  modelId?: unknown;
  modelName?: unknown;
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A persisted provider ID is authoritative. Old task payloads can contain an
 * outdated providerName when the same model exists under multiple providers.
 */
export function resolveTaskProviderDisplayName(
  providerId: unknown,
  provider: ProviderDisplaySource | null | undefined,
  legacyName: unknown,
): string {
  const normalizedProviderId = nonEmptyString(providerId);
  const providerMatchesTask = Boolean(
    normalizedProviderId
    && provider
    && nonEmptyString(provider.id) === normalizedProviderId,
  );

  if (providerMatchesTask) {
    return nonEmptyString(provider?.displayName)
      || nonEmptyString(provider?.name)
      || normalizedProviderId;
  }

  return nonEmptyString(legacyName) || normalizedProviderId;
}

/**
 * Resolve a canvas badge without guessing from a duplicate model id when the
 * persisted task already carries an exact provider identity.
 */
export function resolveCanvasProviderDisplayName(
  identity: CanvasProviderDisplayIdentity,
  providerNames: ReadonlyMap<string, string>,
): string {
  const providerId = nonEmptyString(identity.providerId);
  const providerName = nonEmptyString(identity.providerName);
  const modelId = nonEmptyString(identity.modelId);
  const modelName = nonEmptyString(identity.modelName);

  if (providerId) {
    return providerNames.get(providerId)
      || (modelId ? providerNames.get(`${providerId}::${modelId}`) : '')
      || providerName
      || providerId;
  }

  if (providerName) {
    return providerNames.get(providerName) || providerName;
  }

  return (modelId ? providerNames.get(modelId) : '')
    || (modelName ? providerNames.get(modelName) : '')
    || '';
}
