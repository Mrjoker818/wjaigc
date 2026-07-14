export interface RequestedImageModelInput {
  requestedModel?: string;
  providerModels?: string[];
  fallbackModel?: string;
}

export function resolveRequestedImageModel({ requestedModel, providerModels = [], fallbackModel = '' }: RequestedImageModelInput): string {
  return requestedModel?.trim() || providerModels.find(Boolean) || fallbackModel;
}

export function isServerReadableImageUrl(value: unknown): value is string {
  return typeof value === 'string' && (value.startsWith('data:image/') || value.startsWith('/') || /^https?:\/\//i.test(value));
}
