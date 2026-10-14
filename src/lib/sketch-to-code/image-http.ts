import { readSketchBody } from './http';

const REQUIRED = Object.freeze(['projectId', 'imageDataUrl', 'instruction', 'visionProviderId', 'visionModelId',
  'imageProviderId', 'imageModelId', 'idempotencyKey', 'aspectRatio']);
const CONTRACT = Object.freeze({ required: REQUIRED, fields: Object.freeze([...REQUIRED, 'size', 'quality']) });
/** Both modes share the original bounded ingress reader. */
export function readSketchImageBody(request: { body: ReadableStream<Uint8Array> | null; headers: Headers; signal: AbortSignal }): Promise<Record<string, unknown>> {
  return readSketchBody(request, CONTRACT);
}
