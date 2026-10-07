import { z } from 'zod';
import { mediaImportCommandSchema, type DocumentMediaImportResult } from './canvas-asset-command';

const id = z.string().min(1).max(256).refine(value => !!value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
const version = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/)
  .refine(value => !/^(?:data|blob|https?|processing)(?:[:_-]|$)/i.test(value));
const item = z.object({ sourceVersionId: version, command: mediaImportCommandSchema.options[0],
  placementId: version.optional(), restore: z.object({placementId: version,
    expectedRemovalSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).strict().optional() }).strict();
const schema = z.object({ projectId: id, idempotencyKey: id, items: z.array(item).min(1).max(100),
  skillRunId: id.optional() }).strict()
  .refine(value => new Set(value.items.map(entry => entry.sourceVersionId)).size === value.items.length)
  .refine(value => value.items.every(entry => !entry.restore || (!!value.skillRunId && !entry.placementId)));
export type DocumentMediaBatchRequest = z.infer<typeof schema>;
export interface DocumentMediaBatchItemResult extends DocumentMediaImportResult {
  sourceVersionId: string; mode: 'confirm' | 'import' | 'attach' | 'restore'; childKey: string | null;
}
export interface DocumentMediaBatchResult {
  projectId: string; documentSequence: number; items: DocumentMediaBatchItemResult[];
}
export class DocumentMediaBatchInvalidError extends Error {
  readonly code = 'DOCUMENT_MEDIA_INVALID';
  constructor() { super('Invalid document media batch'); }
}
export function parseDocumentMediaBatchRequest(value: unknown): DocumentMediaBatchRequest {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DocumentMediaBatchInvalidError();
  return parsed.data;
}
