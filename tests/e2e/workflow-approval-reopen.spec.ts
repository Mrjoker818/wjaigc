import { expect, test } from '../helpers/brief-to-video';

test.use({ trace: 'off', video: 'on' });
test.skip(!process.env.WORKFLOW_APPROVAL_QA_DATABASE, 'Requires the isolated workflow approval interruption fixture');

test('reopening the editor recovers the same approval after the parent checkpoint is interrupted', async ({
  briefToVideo,
}) => {
  test.setTimeout(180_000);
  const result = await briefToVideo.runWorkflowThroughUi({ reopenAfterInterruptedCheckpoint: true });
  expect(result.videoAssetVersionId).not.toBe('');
  expect(briefToVideo.videoSubmissions()).toHaveLength(1);
  await briefToVideo.writeMachineEvidence({
    workflowExecutionId: result.executionId,
    workflowRunId: result.runId,
    workflowVideoAssetVersionId: result.videoAssetVersionId,
  });
});
