export interface DefaultableModel {
  id: string;
  isDefault?: boolean;
}

export function selectInitialModel(currentModel: string, models: DefaultableModel[]): string {
  if (currentModel) return currentModel;
  return models.find(model => model.isDefault)?.id || models[0]?.id || '';
}
