import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { imageEditPublicationOutputs } from '@/lib/collaboration/image-edit-publication-output';
import { parseCanvasPublicationIntentProposal, parseCanvasTaskPublicationIntent } from '@/lib/collaboration/task-publication-intent';

function fixture(): { intent: Record<string, unknown>; task: Parameters<typeof imageEditPublicationOutputs>[0] } {
  return { intent: { version: 1, parentVersionIds: ['parent'], projectionMode: 'revision',
    placement: { action: 'attach', transform: { x: 10, y: 20, width: 100, height: 80, rotation: 0, zIndex: 1 }, strideX: 132 },
    imageEditOutputs: { version: 1, includeMask: true, requestDigest: 'a'.repeat(64),
      sourceSnapshot: [{ versionId: 'parent', assetId: 'asset', assetCurrentVersionId: 'parent', fingerprint: 'b'.repeat(64) }],
      maskPlacement: { action: 'attach', transform: { x: 142, y: 20, width: 100, height: 80, rotation: 0, zIndex: 2 }, strideX: 132 } } },
    task: { id: 'image_edit_test', type: 'image-edit', status: 'completed', request_digest: 'a'.repeat(64),
      result: { imageUrl: '/api/serve-upload/same.png', maskUrl: '/api/serve-upload/same.png', imageEditPublicationCheckpoint: {
        version: 1, taskId: 'image_edit_test', requestDigest: 'a'.repeat(64), status: 'persisted', providerId: 'provider', modelId: 'model',
        outputs: [{ outputIndex: 0, role: 'primary', url: '/api/serve-upload/same.png' },
          { outputIndex: 1, role: 'mask', url: '/api/serve-upload/same.png' }],
      } } } };
}
function record(value: unknown): Record<string, unknown> { return value as Record<string, unknown>; }
describe('strict role checkpoint and immutable intent', () => {
  it('preserves same URL twice and separates the revision and derived rules', () => {
    const { task, intent } = fixture();
    const outputs = imageEditPublicationOutputs(task, parseCanvasTaskPublicationIntent(intent));
    expect(outputs.map(output => [output.role, output.url, output.intent.projectionMode])).toEqual([
      ['primary', '/api/serve-upload/same.png', 'revision'], ['mask', '/api/serve-upload/same.png', 'derived'],
    ]);
    expect(outputs[1].intent.placement).toMatchObject({ action: 'attach', transform: { x: 142, y: 20 } });
    record(record(task.result.imageEditPublicationCheckpoint).outputs)[0] = {};
    record(record(intent.imageEditOutputs).sourceSnapshot)[0] = {};
    expect(outputs[0].intent.imageEditOutputs?.sourceSnapshot[0].versionId).toBe('parent');
    expect(Object.isFrozen(outputs[0].intent.imageEditOutputs?.sourceSnapshot[0])).toBe(true);
    expect(Object.isFrozen(outputs[0].intent.imageEditOutputs?.maskPlacement?.transform)).toBe(true);
    expect(outputs[0].url).toBe('/api/serve-upload/same.png');
  });
  const invalid: Array<[string, (task: ReturnType<typeof fixture>['task']) => void]> = [
    ['missing checkpoint', task => { delete task.result.imageEditPublicationCheckpoint; }],
    ['wrong type', task => { task.type = 'generate'; }],
    ['not completed', task => { task.status = 'processing'; }],
    ['wrong task id', task => { record(task.result.imageEditPublicationCheckpoint).taskId = 'image_edit_other'; }],
    ['wrong digest', task => { task.request_digest = 'c'.repeat(64); }],
    ['uppercase digest', task => { record(task.result.imageEditPublicationCheckpoint).requestDigest = 'A'.repeat(64); }],
    ['missing provider', task => { record(task.result.imageEditPublicationCheckpoint).providerId = ''; }],
    ['blank model', task => { record(task.result.imageEditPublicationCheckpoint).modelId = ' '; }],
    ['not persisted', task => { record(task.result.imageEditPublicationCheckpoint).status = 'accepted'; }],
    ['missing mask', task => { record(task.result.imageEditPublicationCheckpoint).outputs = [{ outputIndex: 0, role: 'primary', url: task.result.imageUrl }]; }],
    ['third role', task => { (record(task.result.imageEditPublicationCheckpoint).outputs as unknown[]).push({ outputIndex: 2, role: 'mask', url: task.result.maskUrl }); }],
    ['swapped', task => { (record(task.result.imageEditPublicationCheckpoint).outputs as unknown[]).reverse(); }],
    ['duplicate role', task => { record((record(task.result.imageEditPublicationCheckpoint).outputs as unknown[])[1]).role = 'primary'; }],
    ['duplicate index', task => { record((record(task.result.imageEditPublicationCheckpoint).outputs as unknown[])[1]).outputIndex = 0; }],
    ['wrong primary URL', task => { task.result.imageUrl = '/api/serve-upload/other.png'; }],
    ['wrong mask URL', task => { task.result.maskUrl = '/api/serve-upload/other.png'; }],
    ['extra checkpoint key', task => { record(task.result.imageEditPublicationCheckpoint).assetId = 'asset'; }],
    ['extra output key', task => { record((record(task.result.imageEditPublicationCheckpoint).outputs as unknown[])[0]).assetId = 'asset'; }],
  ];
  it.each(invalid)('rejects %s', (_name, mutate) => {
    const { task, intent } = fixture(); mutate(task);
    expect(() => imageEditPublicationOutputs(task, parseCanvasTaskPublicationIntent(intent))).toThrow();
  });
  it('ignores legacy maskUrl only when the frozen policy excludes mask', () => {
    const { task, intent } = fixture(); const policy = record(intent.imageEditOutputs);
    policy.includeMask = false; delete policy.maskPlacement;
    const parsed = parseCanvasTaskPublicationIntent(intent);
    expect(() => imageEditPublicationOutputs(task, parsed)).toThrow();
    (record(task.result.imageEditPublicationCheckpoint).outputs as unknown[]).pop();
    expect(imageEditPublicationOutputs(task, parsed)).toHaveLength(1);
  });
  it.each(['missing', 'duplicate', 'extra', 'unordered', 'mask absent', 'mask forbidden', 'unknown field'])('rejects malformed canonical extension: %s', mode => {
    const { intent } = fixture(); const policy = record(intent.imageEditOutputs);
    const sources = policy.sourceSnapshot as unknown[];
    if (mode === 'missing') sources.pop();
    if (mode === 'duplicate' || mode === 'extra') sources.push(sources[0]);
    if (mode === 'unordered') record(sources[0]).versionId = 'other';
    if (mode === 'mask absent') delete policy.maskPlacement;
    if (mode === 'mask forbidden') policy.includeMask = false;
    if (mode === 'unknown field') policy.role = 'mask';
    expect(() => parseCanvasTaskPublicationIntent(intent)).toThrow();
  });
  it('keeps client proposal strict and old intents compatible', () => {
    const proposal = { parentVersionIds: ['parent'], projectionMode: 'revision', placement: { action: 'append', selectedEntityIds: [] } };
    expect(() => parseCanvasPublicationIntentProposal({ ...proposal, imageEditOutputs: { version: 1, includeMask: true } })).toThrow();
    const { intent } = fixture(); delete intent.imageEditOutputs;
    expect(parseCanvasTaskPublicationIntent(intent).imageEditOutputs).toBeUndefined();
  });
});
