import { z } from 'zod';
import { CanvasPublicationIntentError, parseCanvasTaskPublicationIntent, type CanvasTaskPublicationIntent } from './task-publication-intent';

const text = z.string().min(1).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value));
const outputSchema = z.object({ outputIndex: z.number().int(), role: z.enum(['primary', 'mask']), url: text }).strict();
const checkpointSchema = z.object({ version: z.literal(1), taskId: text,
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/), status: z.literal('persisted'),
  providerId: text, modelId: text, outputs: z.array(outputSchema).min(1).max(2),
}).strict();
export interface TaskPublicationOutput {
  url: string; intent: CanvasTaskPublicationIntent;
  role?: 'primary' | 'mask'; providerId?: string; modelId?: string;
}
export function imageEditPublicationOutputs(task: {
  id: string; type: string; status: string; request_digest: string | null; result: Record<string, unknown>;
}, original: CanvasTaskPublicationIntent): TaskPublicationOutput[] {
  const intent = parseCanvasTaskPublicationIntent(original);
  const policy = intent.imageEditOutputs;
  const parsed = checkpointSchema.safeParse(task.result.imageEditPublicationCheckpoint);
  if (!policy || task.type !== 'image-edit' || !task.id.startsWith('image_edit_') || task.status !== 'completed'
    || !parsed.success) throw new CanvasPublicationIntentError();
  const checkpoint = parsed.data;
  if (checkpoint.taskId !== task.id || checkpoint.requestDigest !== task.request_digest
    || checkpoint.requestDigest !== policy.requestDigest || checkpoint.outputs.length !== (policy.includeMask ? 2 : 1)
    || checkpoint.outputs.some((output, index) => output.outputIndex !== index || output.role !== (index === 0 ? 'primary' : 'mask'))
    || checkpoint.outputs[0].url !== task.result.imageUrl
    || (policy.includeMask && checkpoint.outputs[1].url !== task.result.maskUrl)) throw new CanvasPublicationIntentError();
  return checkpoint.outputs.map(output => ({ url: output.url, role: output.role,
    providerId: checkpoint.providerId, modelId: checkpoint.modelId,
    intent: output.role === 'primary' ? intent : parseCanvasTaskPublicationIntent({ version: 1,
      parentVersionIds: intent.parentVersionIds, projectionMode: 'derived', placement: policy.maskPlacement }),
  }));
}

const publishedReferenceSchema = z.object({
  url: z.string().startsWith('/api/serve-upload/exports/'),
  assetVersionId: text,
}).passthrough();
const completedProjectionSchema = z.object({
  status: z.literal('completed'),
  references: z.tuple([publishedReferenceSchema, publishedReferenceSchema]),
}).passthrough();

/** Adopted asset URLs may differ from task output URLs; the persisted checkpoint must not. */
export function isCoherentPublishedCpuRemoveBgResult(task: {
  id: string; requestDigest?: string | null; result?: Record<string, unknown> | null;
}): boolean {
  const result = task.result;
  if (!result || typeof result.imageUrl !== 'string' || typeof result.maskUrl !== 'string'
    || !result.imageUrl.startsWith('/api/serve-upload/exports/')
    || !result.maskUrl.startsWith('/api/serve-upload/exports/')
    || result.imageUrl === result.maskUrl) return false;
  const checkpoint = checkpointSchema.safeParse(result.imageEditPublicationCheckpoint);
  const projection = completedProjectionSchema.safeParse(result.assetProjection);
  const admission = result.imageEditAdmission as Record<string, unknown> | undefined;
  if (!checkpoint.success || !projection.success || !admission
    || admission.kind !== 'document-cpu-removebg'
    || !/^[a-f0-9]{64}$/.test(task.requestDigest || '')
    || admission.requestDigest !== task.requestDigest
    || checkpoint.data.taskId !== task.id
    || checkpoint.data.requestDigest !== task.requestDigest
    || checkpoint.data.providerId !== 'local-rembg'
    || checkpoint.data.outputs.length !== 2
    || checkpoint.data.outputs[0].outputIndex !== 0
    || checkpoint.data.outputs[0].role !== 'primary'
    || checkpoint.data.outputs[0].url !== result.imageUrl
    || checkpoint.data.outputs[1].outputIndex !== 1
    || checkpoint.data.outputs[1].role !== 'mask'
    || checkpoint.data.outputs[1].url !== result.maskUrl) return false;
  const [primary, mask] = projection.data.references;
  return primary.url !== mask.url && primary.assetVersionId !== mask.assetVersionId;
}
