import { extractTaskResultImageUrl } from '@/lib/task-result-url';

export function extractFontDesignPollImageUrl(payload: unknown): string | undefined {
  return extractTaskResultImageUrl(payload);
}
