import type { ExecuteAgentEditContinuationInput } from './agent-edit-continuation';

export async function executeDescriptor(
  input: ExecuteAgentEditContinuationInput,
): Promise<void> {
  const service = await import('./agent-edit-execution-service');
  await service.executePersistedAgentEditDescriptor(input);
}
