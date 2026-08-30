import {
  resolveModelAuthorizationNamespace,
  type ModelAuthorizationNamespace,
} from './model-type-classification';
import type { ModelInfo } from './universal-api-types';

export interface NormalizeAdminModelAssignmentsInput {
  assignments: unknown;
  namespace: ModelAuthorizationNamespace;
  models: ModelInfo[];
}

export type NormalizeAdminModelAssignmentsResult =
  | {
      ok: true;
      assignments: string[];
      migrated: Array<{ from: string; to: string }>;
    }
  | {
      ok: false;
      code: 'MODEL_ASSIGNMENT_INVALID' | 'MODEL_ASSIGNMENT_AMBIGUOUS';
      assignment: string;
      candidateCount: number;
    };

function invalidResult(assignment: string): NormalizeAdminModelAssignmentsResult {
  return {
    ok: false,
    code: 'MODEL_ASSIGNMENT_INVALID',
    assignment,
    candidateCount: 0,
  };
}

export function normalizeAdminModelAssignments(
  input: NormalizeAdminModelAssignmentsInput,
): NormalizeAdminModelAssignmentsResult {
  if (!Array.isArray(input.assignments)) {
    return invalidResult('');
  }

  const models = input.models.filter(model => (
    resolveModelAuthorizationNamespace(model.type) === input.namespace
  ));
  const exactModels = new Map(models.map(model => [
    `${model.providerId}::${model.id}`,
    model,
  ]));
  const modelsById = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const candidates = modelsById.get(model.id) ?? [];
    candidates.push(model);
    modelsById.set(model.id, candidates);
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  const migrated: Array<{ from: string; to: string }> = [];

  for (const rawAssignment of input.assignments) {
    if (typeof rawAssignment !== 'string') {
      return invalidResult('');
    }
    const assignment = rawAssignment.trim();
    if (!assignment) {
      return invalidResult(assignment);
    }

    const separatorCount = assignment.split('::').length - 1;
    let exactAssignment = assignment;
    if (separatorCount > 0) {
      if (separatorCount !== 1 || !exactModels.has(assignment)) {
        return invalidResult(assignment);
      }
    } else {
      const candidates = modelsById.get(assignment) ?? [];
      if (candidates.length === 0) {
        return invalidResult(assignment);
      }
      if (candidates.length > 1) {
        return {
          ok: false,
          code: 'MODEL_ASSIGNMENT_AMBIGUOUS',
          assignment,
          candidateCount: candidates.length,
        };
      }
      exactAssignment = `${candidates[0].providerId}::${candidates[0].id}`;
      migrated.push({ from: assignment, to: exactAssignment });
    }

    if (!seen.has(exactAssignment)) {
      seen.add(exactAssignment);
      normalized.push(exactAssignment);
    }
  }

  return { ok: true, assignments: normalized, migrated };
}
