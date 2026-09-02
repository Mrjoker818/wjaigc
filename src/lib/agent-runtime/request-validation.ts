export const AGENT_PROMPT_MAX_BYTES = 32_000;

export class AgentPromptValidationError extends Error {
  readonly code = 'AGENT_RUN_REQUEST_INVALID';
  readonly status = 400;

  constructor(message = 'prompt is invalid') {
    super(message);
    this.name = 'AgentPromptValidationError';
  }
}

export function readAgentPrompt(value: unknown): string {
  if (typeof value !== 'string') throw new AgentPromptValidationError();
  const normalized = value.trim();
  if (
    !normalized
    || new TextEncoder().encode(normalized).byteLength > AGENT_PROMPT_MAX_BYTES
  ) {
    throw new AgentPromptValidationError();
  }
  return normalized;
}
