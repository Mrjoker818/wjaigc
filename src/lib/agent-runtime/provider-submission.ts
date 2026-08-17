import { fetchWithV1Retry } from '@/lib/api-helpers';

export type AgentProviderFetcher = (
  baseUrl: string,
  path: string,
  options: RequestInit & { skipV1Retry?: boolean },
) => Promise<Response>;

export interface SubmitAgentImageProviderRequestInput {
  baseUrl: string;
  path: string;
  exactModel: string;
  body: FormData | Record<string, unknown>;
  headers: Record<string, string>;
  strictProviderModel: boolean;
  signal?: AbortSignal;
  fetcher?: AgentProviderFetcher;
}

export function submitAgentImageProviderRequest({
  baseUrl,
  path,
  exactModel,
  body,
  headers,
  strictProviderModel,
  signal,
  fetcher = fetchWithV1Retry,
}: SubmitAgentImageProviderRequestInput): Promise<Response> {
  let submittedBody: BodyInit;
  if (body instanceof FormData) {
    body.set('model', exactModel);
    submittedBody = body;
  } else {
    submittedBody = JSON.stringify({ ...body, model: exactModel });
  }
  return fetcher(baseUrl, path, {
    method: 'POST',
    headers,
    body: submittedBody,
    signal,
    skipV1Retry: strictProviderModel,
  });
}
