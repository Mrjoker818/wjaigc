import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';

export function toAgentModelCapabilitySet(model: TaskModelDescriptor): Set<string> {
  const capabilities = new Set<string>([model.kind]);
  if (model.kind === 'image' || model.kind === 'edit') capabilities.add('image');
  if (model.kind === 'edit') capabilities.add('edit');
  if (model.supportsReferenceImages) capabilities.add('reference-images');
  if (model.supportsMask) capabilities.add('edit');
  if (model.supportsVision || model.sourceType === 'vlm') capabilities.add('vision');
  for (const operation of model.supportedOperations || []) capabilities.add(operation);
  return capabilities;
}
