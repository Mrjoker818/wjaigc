import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import { sketchFields, sketchHttpId } from './http';
export interface SketchImageKnownFailure {
  readonly phase: 'analysis' | 'generation' | 'result';
  readonly providerId: string; readonly modelId: string;
  readonly kind: 'not-submitted' | 'rejected' | 'remote-failed'; readonly remoteId?: string;
}
const proven = new WeakMap<Error, Readonly<SketchImageKnownFailure>>();
/** Trusted server seams only; never infer this proof from public error strings.
 * Not current access, a lease, a refund receipt or a serialization format. */
export function markSketchImageKnownFailure(error: Error, evidence: Readonly<SketchImageKnownFailure>): Error {
  try {
    if (!(error instanceof Error)) throw new Error();
    const raw = sketchFields(evidence, ['phase', 'providerId', 'modelId', 'kind', 'remoteId']);
    const providerId = sketchHttpId(raw.providerId), modelId = sketchHttpId(raw.modelId);
    if (raw.phase !== 'analysis' && raw.phase !== 'generation' && raw.phase !== 'result') throw new Error();
    if (raw.phase === 'result' ? raw.kind !== 'remote-failed' || Object.keys(raw).length !== 5
      : !['not-submitted', 'rejected'].includes(raw.kind as string) || Object.keys(raw).length !== 4) throw new Error();
    const captured = Object.freeze({ phase: raw.phase, providerId, modelId, kind: raw.kind as SketchImageKnownFailure['kind'],
      ...(raw.phase === 'result' ? { remoteId: sketchHttpId(raw.remoteId) } : {}) });
    const previous = proven.get(error);
    if (previous && !isDeepStrictEqual(previous, captured)) throw new Error();
    if (!previous) proven.set(error, captured);
    return error;
  } catch { throw new Error('SKETCH_IMAGE_FAILURE_EVIDENCE_INVALID'); }
}
export function readSketchImageKnownFailure(error: unknown): Readonly<SketchImageKnownFailure> | undefined {
  return error && typeof error === 'object' ? proven.get(error as Error) : undefined;
}
