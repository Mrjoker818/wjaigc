export type BillingModelCategory = 'image' | 'video' | 'llm' | 'edit';

const LLM_MODEL_TYPES = new Set(['chat', 'vlm', 'universal', 'general']);
const EDIT_MODEL_TYPES = new Set(['imageedit', 'upscaler', 'vectorize', 'layer', 'removebg', 'audio']);

export function getBillingModelCategory(modelType: string | undefined): BillingModelCategory {
  const normalized = (modelType || 'image').trim().toLowerCase();

  if (normalized === 'video') return 'video';
  if (LLM_MODEL_TYPES.has(normalized)) return 'llm';
  if (EDIT_MODEL_TYPES.has(normalized)) return 'edit';
  return 'image';
}
