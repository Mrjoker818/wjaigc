import {
  ModelCapabilityError,
  type CapabilityMismatch,
  type TaskModelDescriptor,
  type TaskModelSelection,
} from './model-capability-contract';
import { validateTaskModelSelection } from './model-capability-resolution';

export interface ExactImageCandidateInput {
  providerId: string;
  modelId: string;
  selection: TaskModelSelection;
  resolveTaskModel: (providerId: string, modelId: string) => Promise<TaskModelDescriptor>;
}

export type ExactImageCandidateAdmission =
  | { ok: true; descriptor: TaskModelDescriptor }
  | { ok: false; error: ModelCapabilityError | CapabilityMismatch };

export async function admitExactImageCandidate(
  input: ExactImageCandidateInput,
): Promise<ExactImageCandidateAdmission> {
  let descriptor: TaskModelDescriptor;
  try {
    descriptor = await input.resolveTaskModel(input.providerId, input.modelId);
  } catch (error) {
    if (error instanceof ModelCapabilityError) return { ok: false, error };
    throw error;
  }

  const validation = validateTaskModelSelection(descriptor, input.selection);
  return validation.ok
    ? { ok: true, descriptor }
    : { ok: false, error: validation.error };
}

export async function admitImageFallbackCandidates<
  TCandidate extends { providerId: string; modelId: string },
>(input: {
  candidates: TCandidate[];
  admit: (candidate: TCandidate) => Promise<ExactImageCandidateAdmission>;
}): Promise<{
  candidates: Array<TCandidate & { descriptor: TaskModelDescriptor }>;
  firstRejection: {
    candidate: TCandidate;
    error: ModelCapabilityError | CapabilityMismatch;
  } | null;
}> {
  const candidates: Array<TCandidate & { descriptor: TaskModelDescriptor }> = [];
  let firstRejection: {
    candidate: TCandidate;
    error: ModelCapabilityError | CapabilityMismatch;
  } | null = null;

  for (const candidate of input.candidates) {
    const admission = await input.admit(candidate);
    if (admission.ok) {
      candidates.push({ ...candidate, descriptor: admission.descriptor });
    } else if (!firstRejection) {
      firstRejection = { candidate, error: admission.error };
    }
  }

  return { candidates, firstRejection };
}
