import 'server-only';

import { getInternalRequestHeaders } from '@/lib/api-auth';
import { getInternalApiUrl } from '@/lib/api-helpers';

export const STRICT_AGENT_GENERATE_HEADER = 'x-wujie-agent-strict-routing';

interface SubmitStrictAgentGenerationInput {
  userId: string;
  userRole: 'user' | 'admin';
  prompt: string;
  aspectRatio: string;
  model: string;
  providerId: string;
  idempotencyKey: string;
  submitOnly?: boolean;
  extraBody?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

export async function submitStrictAgentGeneration(
  input: SubmitStrictAgentGenerationInput,
): Promise<Record<string, unknown>> {
  const internalHeaders = await getInternalRequestHeaders(input.userId, input.userRole);
  const response = await (input.fetchImpl ?? fetch)(getInternalApiUrl('/api/generate'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...internalHeaders,
      [STRICT_AGENT_GENERATE_HEADER]: 'true',
      'idempotency-key': input.idempotencyKey,
    },
    body: JSON.stringify({
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      quality: 'high',
      model: input.model,
      providerId: input.providerId,
      ...(input.submitOnly ? { submitOnly: true, outputCount: 1 } : {}),
      ...(input.extraBody || {}),
    }),
  });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!data) {
    return {
      success: false,
      error: `Agent image generation returned an invalid response (${response.status})`,
    };
  }
  return data;
}
