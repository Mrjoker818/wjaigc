export interface DefaultableModel {
  id: string;
  isDefault?: boolean;
}

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
  if (!allowedModels?.length) return false;
  return allowedModels.includes(modelId) || allowedModels.includes(`${providerId}::${modelId}`);
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
