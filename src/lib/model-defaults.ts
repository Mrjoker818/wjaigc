export interface DefaultableModel {
  id: string;
  isDefault?: boolean;
}

export interface PersistedModelCandidate {
  id: string;
  providerId: string;
}

export interface ExactModelKey {
  providerId: string;
  modelId: string;
}

interface PersistedImageModelRecord {
  model?: unknown;
  providerId?: unknown;
  apiProvider?: unknown;
  compositeKey?: unknown;
}

export type PersistedModelSelectionResolution =
  | {
      status: 'exact' | 'migrated';
      compositeKey: string;
      modelId: string;
      providerId: string;
    }
  | {
      status: 'ambiguous' | 'not-found';
      compositeKey: null;
      modelId: string;
      providerId: null;
    };

export interface QuickCreateModelCandidate extends DefaultableModel {
  providerId: string;
  modelId: string;
  name?: string;
  providerName?: string;
}

export type QuickCreateModelSource =
  | 'task-override'
  | 'quick-create-default'
  | 'global-default'
  | 'recent-selection'
  | 'first-available'
  | 'none';

export interface ResolveQuickCreateModelInput {
  taskOverride?: string;
  quickCreateDefault?: string;
  globalDefault?: string;
  recentSelection?: string;
  models: QuickCreateModelCandidate[];
  allowFirstAvailable?: boolean;
}

export interface ResolvedQuickCreateModel {
  id: string;
  model: QuickCreateModelCandidate | null;
  source: QuickCreateModelSource;
}

export function isModelAssignedToUser(
  allowedModels: string[] | undefined,
  providerId: string,
  modelId: string,
): boolean {
  // An empty assignment is the default "inherit the enabled system catalog"
  // state. Only a non-empty list acts as a per-user restriction.
  if (!allowedModels?.length) return true;
  return allowedModels.includes(modelId) || allowedModels.includes(`${providerId}::${modelId}`);
}

export function parseExactModelKey(selection: string): ExactModelKey | null {
  const separatorIndex = selection.indexOf('::');
  if (separatorIndex <= 0) return null;

  const providerId = selection.slice(0, separatorIndex);
  const modelId = selection.slice(separatorIndex + 2);
  return modelId ? { providerId, modelId } : null;
}

export function readPersistedImageModelSelection(value: unknown): (ExactModelKey & { compositeKey: string }) | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as PersistedImageModelRecord;
  if (typeof record.compositeKey === 'string') {
    const exact = parseExactModelKey(record.compositeKey.trim());
    if (exact) return { ...exact, compositeKey: `${exact.providerId}::${exact.modelId}` };
  }

  const modelId = typeof record.model === 'string' ? record.model.trim() : '';
  const canonicalProviderId = typeof record.providerId === 'string' ? record.providerId.trim() : '';
  const legacyProviderId = typeof record.apiProvider === 'string' ? record.apiProvider.trim() : '';
  const providerId = canonicalProviderId || legacyProviderId;
  if (!modelId || !providerId) return null;
  return { providerId, modelId, compositeKey: `${providerId}::${modelId}` };
}

export function resolvePersistedModelSelection(
  persistedSelection: string,
  candidates: PersistedModelCandidate[],
): PersistedModelSelectionResolution {
  const selection = persistedSelection.trim();
  const exactKey = parseExactModelKey(selection);
  if (exactKey) {
    const { providerId, modelId } = exactKey;
    const exact = candidates.some(candidate => (
      candidate.providerId === providerId && candidate.id === modelId
    ));
    if (exact) {
      return {
        status: 'exact',
        compositeKey: `${providerId}::${modelId}`,
        modelId,
        providerId,
      };
    }
  }

  const matches = new Map(
    candidates
      .filter(candidate => candidate.id === selection)
      .map(candidate => [`${candidate.providerId}::${candidate.id}`, candidate]),
  );
  if (matches.size === 1) {
    const [compositeKey, candidate] = matches.entries().next().value!;
    return {
      status: 'migrated',
      compositeKey,
      modelId: candidate.id,
      providerId: candidate.providerId,
    };
  }
  return {
    status: matches.size > 1 ? 'ambiguous' : 'not-found',
    compositeKey: null,
    modelId: matches.size > 0 || !exactKey ? selection : exactKey.modelId,
    providerId: null,
  };
}

export function selectInitialModel(currentModel: string, models: DefaultableModel[]): string {
  if (currentModel && models.some(model => model.id === currentModel)) return currentModel;
  return models.find(model => model.isDefault)?.id || models[0]?.id || '';
}

export function resolveQuickCreateModel({
  taskOverride,
  quickCreateDefault,
  globalDefault,
  recentSelection,
  models,
  allowFirstAvailable = true,
}: ResolveQuickCreateModelInput): ResolvedQuickCreateModel {
  const modelsById = new Map(models.map(model => [model.id, model]));
  const candidates: Array<{ id?: string; source: QuickCreateModelSource }> = [
    { id: taskOverride, source: 'task-override' },
    { id: quickCreateDefault, source: 'quick-create-default' },
    { id: globalDefault, source: 'global-default' },
    { id: recentSelection, source: 'recent-selection' },
  ];

  for (const candidate of candidates) {
    const id = candidate.id?.trim();
    const model = id ? modelsById.get(id) : undefined;
    if (id && model) {
      return { id, model, source: candidate.source };
    }
  }

  const firstModel = allowFirstAvailable ? models[0] : undefined;
  if (firstModel) {
    return { id: firstModel.id, model: firstModel, source: 'first-available' };
  }

  return { id: '', model: null, source: 'none' };
}
