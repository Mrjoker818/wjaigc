import 'server-only';

import { acceptWorkflowEditResult, readWorkflowEditAcceptedResult,
  type WorkflowEditAcceptanceInput } from './workflow-edit-acceptance';
import { recordWorkflowEditAcceptanceRejection, settleAcceptedWorkflowEditTask,
  settleWorkflowEditSourceDenial } from './workflow-edit-output';

export type WorkflowEditCompletion = 'completed' | 'denied' | 'rejected' | 'pending' | 'terminal';

/** Never complete a charged workflow task before its result has durable private acceptance. */
export async function completeWorkflowEditTask(input: {
  actorId: string;
  taskId: string;
  requestDigest: string;
  providerId: string;
  modelId: string;
  result: Record<string, unknown>;
}): Promise<WorkflowEditCompletion> {
  try {
    await acceptWorkflowEditResult({ taskId: input.taskId, actorId: input.actorId,
      requestDigest: input.requestDigest, providerId: input.providerId, modelId: input.modelId,
      result: input.result as WorkflowEditAcceptanceInput['result'] });
  } catch (error) {
    console.error('[workflow-edit-terminal] Result acceptance unavailable', error);
    try {
      const prior = await readWorkflowEditAcceptedResult({ taskId: input.taskId,
        actorId: input.actorId, requestDigest: input.requestDigest,
        providerId: input.providerId, modelId: input.modelId });
      if (prior) return settleAcceptedWorkflowEditTask(input.actorId, input.taskId);
    } catch (readError) {
      console.error('[workflow-edit-terminal] Prior accepted result unavailable', readError);
      return settleWorkflowEditSourceDenial(input.actorId, input.taskId);
    }
    const checkpoint = await recordWorkflowEditAcceptanceRejection(input.actorId, input.taskId);
    if (checkpoint !== 'recorded') return checkpoint;
    return settleWorkflowEditSourceDenial(input.actorId, input.taskId, true);
  }
  return settleAcceptedWorkflowEditTask(input.actorId, input.taskId);
}
