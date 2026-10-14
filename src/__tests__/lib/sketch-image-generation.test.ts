import { createCanvas } from '@napi-rs/canvas';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { crc32 } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import { prepareSketchImage, type SketchImageGenerationDependencies, type SketchImageExecutionHooks } from '@/lib/sketch-to-code/image-generation';
import { freezeSketchImageInput } from '@/lib/sketch-to-code/image-contract';
vi.mock('server-only', () => ({}));

const imageDataUrl = createCanvas(8, 8).toDataURL('image/png');
const input = { projectId: 'project-a', imageDataUrl, instruction: '海边木屋，水彩', visionProviderId: 'vision-p', visionModelId: 'same-model',
  imageProviderId: 'image-p', imageModelId: 'same-model', idempotencyKey: 'nonce-a', aspectRatio: '4:3' };
const vision: TaskModelDescriptor = { providerId: 'vision-p', modelId: 'same-model', kind: 'chat', sourceType: 'vlm', protocol: 'chat-completions',
  executionMode: 'sync', allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1, supportsVision: true,
  supportsReferenceImages: true, supportsMask: false, outputKinds: ['text'], capabilitySources: { supportsVision: 'admin' } };
const image: TaskModelDescriptor = { ...vision, providerId: 'image-p', kind: 'image', sourceType: 'image', protocol: 'images',
  executionMode: 'async', allowedRatios: ['4:3'], supportsReferenceImages: true, maxReferenceImages: 1, supportedOperations: ['image-to-image'], outputKinds: ['image'] };
const analysis = { summary: '木屋与海', composition: '木屋在左，海在右', prompt: '水彩海边木屋', negativePrompt: '水印' };
const receipt = { taskIds: ['remote-one'], directImageUrls: [] as string[], usedModel: 'same-model', usedProviderId: 'image-p' };
function context(signal = new AbortController().signal): { actorUserId: string; signal: AbortSignal } { return { actorUserId: 'user-a', signal }; }
function dependencies(events: string[] = []): SketchImageGenerationDependencies {
  return {
    authorizeProject: async (actorUserId, projectId) => { events.push('authorize'); return { kind: 'personal', actorUserId, projectId, ownerId: actorUserId }; },
    resolveTaskModel: async (providerId, modelId, actorUserId) => { events.push(`resolve:${providerId}:${modelId}:${actorUserId}`);
      return structuredClone(providerId === 'vision-p' ? vision : image); },
    analyze: async () => { events.push('analyze'); return { analysis: structuredClone(analysis), usage: { inputTokens: 2, outputTokens: 3 } }; },
    generate: async () => { events.push('generate'); return structuredClone(receipt); },
  };
}
function hooks(events: string[] = []): SketchImageExecutionHooks {
  return { beforePhase: async phase => { events.push(`fence:${phase}`); }, afterAnalysis: async () => { events.push('persist-analysis'); } };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('authorized sketch image preparation and guarded two-stage draft', () => {
  it('prepares decoded input and two exact bindings with zero provider work', async () => {
    const events: string[] = [], prepared = await prepareSketchImage(input, dependencies(events), context());
    expect(events).toEqual(['authorize', 'resolve:vision-p:same-model:user-a', 'resolve:image-p:same-model:user-a']);
    expect(prepared.input).toEqual(input); expect(prepared.visionBinding).toEqual({ providerId: 'vision-p', modelId: 'same-model' });
    expect(prepared.imageBinding).toEqual({ providerId: 'image-p', modelId: 'same-model' });
    expect([prepared, prepared.input, prepared.access, prepared.visionBinding, prepared.imageBinding].every(Object.isFrozen)).toBe(true);
  });
  it('waits for actual analysis persistence before sending the original PNG to the image model', async () => {
    const events: string[] = [], dep = dependencies(events); let sentBody: unknown;
    dep.analyze = async (png, words, binding) => { events.push('analyze'); expect(png).toBe(imageDataUrl); expect(words).toBe(input.instruction);
      expect(binding).toEqual({ providerId: 'vision-p', modelId: 'same-model' }); return { analysis, usage: { inputTokens: 2, outputTokens: 3 } }; };
    dep.generate = async (body, binding) => { events.push('generate'); sentBody = body;
      expect(binding).toEqual({ providerId: 'image-p', modelId: 'same-model' }); return receipt; };
    const prepared = await prepareSketchImage(input, dep, context()); events.length = 0;
    const draft = await prepared.compute(new AbortController().signal, hooks(events));
    expect(events).toEqual(['fence:analysis', 'analyze', 'persist-analysis', 'fence:generation', 'generate']);
    expect(sentBody).toMatchObject({ projectId: 'project-a', model: 'same-model', providerId: 'image-p', referenceImages: [imageDataUrl],
      imageUrl: imageDataUrl, referenceDescriptions: [analysis.summary], negativePrompt: '水印', outputCount: 1, submitOnly: true });
    expect((sentBody as { prompt: string }).prompt).toContain(input.instruction);
    expect((sentBody as { prompt: string }).prompt).toContain(analysis.composition);
    expect((sentBody as { prompt: string }).prompt).toContain(analysis.prompt);
    expect(draft).toEqual({ analysis, usage: { inputTokens: 2, outputTokens: 3 }, receipt });
    expect([draft, draft.analysis, draft.usage, draft.receipt, draft.receipt.taskIds, draft.receipt.directImageUrls].every(Object.isFrozen)).toBe(true);
  });
  it('retains detached input/access/functions after admission and uses the execution signal', async () => {
    const requestAbort = new AbortController(), mutableInput = { ...input }, dep = dependencies();
    const access = { kind: 'personal' as const, actorUserId: 'user-a', ownerId: 'user-a', projectId: 'project-a' };
    dep.authorizeProject = async () => access;
    const prepared = await prepareSketchImage(mutableInput, dep, context(requestAbort.signal));
    mutableInput.instruction = 'changed'; mutableInput.imageProviderId = 'wrong'; access.projectId = 'another';
    dep.analyze = async () => { throw new Error('replaced-adapter'); }; dep.generate = async () => { throw new Error('replaced-adapter'); };
    requestAbort.abort(new Error('request-disconnected'));
    expect(await prepared.compute(new AbortController().signal, hooks())).toMatchObject({ analysis, receipt });
    expect(prepared.input).toEqual(input); expect(prepared.access.projectId).toBe('project-a');
  });
  it('accepts one direct image receipt instead of one asynchronous ID', async () => {
    const dep = dependencies(); dep.generate = async () => ({ ...receipt, taskIds: [], directImageUrls: ['https://synthetic.invalid/result.png'] });
    expect((await (await prepareSketchImage(input, dep, context())).compute(new AbortController().signal, hooks())).receipt.directImageUrls).toEqual(['https://synthetic.invalid/result.png']);
  });
  it('missing provider usage remains absent, never fabricated as zero', async () => {
    const dep = dependencies(); dep.analyze = async () => ({ analysis });
    let observed: unknown;
    const hook = hooks(); hook.afterAnalysis = async value => { observed = value; };
    const draft = await (await prepareSketchImage(input, dep, context())).compute(new AbortController().signal, hook);
    expect(draft).not.toHaveProperty('usage'); expect(observed).not.toHaveProperty('usage');
  });
  it.each(['wrong-actor', 'wrong-project', 'wrong-owner', 'unscoped'])(
    'refuses project access %s before model work', async variant => {
      const dep = dependencies(); const resolve = vi.spyOn(dep, 'resolveTaskModel');
      dep.authorizeProject = async () => variant === 'unscoped' ? { kind: 'unscoped', actorUserId: 'user-a', projectId: 'project-a' }
        : { kind: 'personal', actorUserId: variant === 'wrong-actor' ? 'other' : 'user-a', projectId: variant === 'wrong-project' ? 'other' : 'project-a',
          ownerId: variant === 'wrong-owner' ? 'other' : 'user-a' };
      await expect(prepareSketchImage(input, dep, context())).rejects.toThrow(); expect(resolve).not.toHaveBeenCalled();
    });
  it.each(['wrong-vision-provider', 'wrong-image-provider', 'non-vision', 'non-reference'])(
    'rejects capability/binding %s before paid work', async variant => {
      const dep = dependencies(); const generate = vi.spyOn(dep, 'generate'), analyze = vi.spyOn(dep, 'analyze');
      dep.resolveTaskModel = async providerId => providerId === 'vision-p'
        ? { ...vision, providerId: variant === 'wrong-vision-provider' ? 'other-p' : 'vision-p', supportsVision: variant !== 'non-vision' }
        : { ...image, providerId: variant === 'wrong-image-provider' ? 'other-p' : 'image-p', supportsReferenceImages: variant !== 'non-reference' };
      await expect(prepareSketchImage(input, dep, context())).rejects.toThrow(); expect(generate).not.toHaveBeenCalled(); expect(analyze).not.toHaveBeenCalled();
    });
  it('rejects invalid PNG without exposing a preparation or starting provider work', async () => {
    const dep = dependencies(), analyze = vi.spyOn(dep, 'analyze');
    await expect(prepareSketchImage({ ...input, imageDataUrl: 'data:image/png;base64,bm90LWEtcG5n' }, dep, context())).rejects.toThrow();
    expect(analyze).not.toHaveBeenCalled();
  });
  it('really decodes pixels before admission, not just the valid PNG container and CRC', async () => {
    const bytes = Buffer.from(imageDataUrl.split(',')[1], 'base64'); let corrupted = false;
    for (let offset = 8; offset < bytes.length; ) {
      const size = bytes.readUInt32BE(offset), data = offset + 8;
      if (bytes.toString('ascii', offset + 4, data) === 'IDAT') {
        bytes[data + 2] = (bytes[data + 2] & 0xf8) | 6; // Reserved DEFLATE BTYPE, zlib header remains valid.
        bytes.writeUInt32BE(crc32(bytes.subarray(offset + 4, data + size)), data + size); corrupted = true; break;
      }
      offset = data + size + 4;
    }
    expect(corrupted).toBe(true);
    const bad = { ...input, imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
    expect(() => freezeSketchImageInput(bad, vision, image)).not.toThrow();
    const dep = dependencies(), analyze = vi.spyOn(dep, 'analyze');
    await expect(prepareSketchImage(bad, dep, context())).rejects.toThrow('SKETCH_IMAGE_DECODE_INVALID'); expect(analyze).not.toHaveBeenCalled();
  });
  it('rejects caller accessors/unknown fields before authorization', async () => {
    let reads = 0; const dep = dependencies(), authorize = vi.spyOn(dep, 'authorizeProject');
    const evil = Object.defineProperty({ ...input }, 'projectId', { enumerable: true, get: () => { reads++; return 'project-a'; } });
    await expect(prepareSketchImage(evil, dep, context())).rejects.toThrow();
    await expect(prepareSketchImage({ ...input, pricing: {} }, dep, context())).rejects.toThrow();
    expect(reads).toBe(0); expect(authorize).not.toHaveBeenCalled();
  });
  it('pre-aborted preparation never reaches authorization', async () => {
    const controller = new AbortController(), reason = new Error('before-admission'); controller.abort(reason);
    const dep = dependencies(), authorize = vi.spyOn(dep, 'authorizeProject');
    await expect(prepareSketchImage(input, dep, context(controller.signal))).rejects.toBe(reason); expect(authorize).not.toHaveBeenCalled();
  });
  it.each(['beforePhase', 'afterAnalysis'] as const)('requires actual %s hookup and refuses bare compute', async field => {
    const dep = dependencies(), analyze = vi.spyOn(dep, 'analyze');
    const prepared = await prepareSketchImage(input, dep, context()); const incomplete = { ...hooks(), [field]: undefined };
    await expect(prepared.compute(new AbortController().signal, incomplete as unknown as SketchImageExecutionHooks)).rejects.toThrow('SKETCH_IMAGE_EXECUTION_HOOKS_REQUIRED');
    expect(analyze).not.toHaveBeenCalled();
  });
  it.each(['analysis', 'persistence', 'generation-fence'])(
    'failure at %s cannot submit the image request', async phase => {
      const dep = dependencies(), generate = vi.spyOn(dep, 'generate'), reason = new Error(`failure:${phase}`), hook = hooks();
      if (phase === 'analysis') dep.analyze = async () => { throw reason; };
      if (phase === 'persistence') hook.afterAnalysis = async () => { throw reason; };
      if (phase === 'generation-fence') hook.beforePhase = async value => { if (value === 'generation') throw reason; };
      const prepared = await prepareSketchImage(input, dep, context());
      await expect(prepared.compute(new AbortController().signal, hook)).rejects.toBe(reason); expect(generate).not.toHaveBeenCalled();
    });
  it.each(['raw-html', 'unknown-analysis', 'bad-usage', 'wrapper-extra', 'wrapper-getter'])(
    'rejects analysis response %s before image submission', async variant => {
      const dep = dependencies(), generate = vi.spyOn(dep, 'generate'); let reads = 0;
      dep.analyze = async () => {
        if (variant === 'raw-html') return '<html>unsafe</html>';
        if (variant === 'unknown-analysis') return { analysis: { ...analysis, extra: true } };
        if (variant === 'bad-usage') return { analysis, usage: { inputTokens: '2', outputTokens: 3 } };
        if (variant === 'wrapper-extra') return { analysis, extra: true };
        return Object.defineProperty({}, 'analysis', { enumerable: true, get: () => { reads++; return analysis; } });
      };
      await expect((await prepareSketchImage(input, dep, context())).compute(new AbortController().signal, hooks())).rejects.toThrow();
      expect(generate).not.toHaveBeenCalled(); expect(reads).toBe(0);
    });
  it.each(['analysis', 'persistence', 'generation'] as const)(
    'late %s success after cancellation cannot advance or deliver', async phase => {
      const dep = dependencies(), controller = new AbortController(), reason = new Error('cancel-now'), hook = hooks();
      let release!: (value: unknown) => void; let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
      if (phase === 'analysis') dep.analyze = async () => { enter(); return new Promise(resolve => { release = resolve; }); };
      if (phase === 'persistence') hook.afterAnalysis = async () => { enter(); await new Promise(resolve => { release = resolve; }); };
      if (phase === 'generation') dep.generate = async () => { enter(); return new Promise(resolve => { release = resolve; }); };
      const generate = vi.spyOn(dep, 'generate'), prepared = await prepareSketchImage(input, dep, context());
      const result = prepared.compute(controller.signal, hook); const rejected = expect(result).rejects.toBe(reason);
      await entered; controller.abort(reason);
      // Release persistence too: no late ACK may cross the next phase fence.
      release(phase === 'generation' ? receipt : { analysis });
      await rejected; await nextTurn(); if (phase !== 'generation') expect(generate).not.toHaveBeenCalled();
    });
  it.each(['analysis', 'generation'] as const)('uses the correct bounded %s budget even for signal-ignoring adapters', async phase => {
    const dep = dependencies(); let entered = false;
    if (phase === 'analysis') dep.analyze = async () => { entered = true; return new Promise<never>(() => undefined); };
    else dep.generate = async () => { entered = true; return new Promise<never>(() => undefined); };
    const prepared = await prepareSketchImage(input, dep, context()); vi.useFakeTimers();
    const result = prepared.compute(new AbortController().signal, hooks()); const rejected = expect(result).rejects.toThrow('SKETCH_MODEL_TIMEOUT');
    for (let count = 0; count < 10 && !entered; count++) await nextTurn();
    expect(entered).toBe(true); await vi.advanceTimersByTimeAsync(phase === 'analysis' ? 60_000 : 120_000); await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancellation does not wait for a hung analysis persistence ACK', async () => {
    const dep = dependencies(), generate = vi.spyOn(dep, 'generate'), controller = new AbortController(), reason = new Error('cancel-during-ack');
    let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
    const hook = hooks(); hook.afterAnalysis = async () => { enter(); await new Promise<never>(() => undefined); };
    const prepared = await prepareSketchImage(input, dep, context());
    const result = prepared.compute(controller.signal, hook), rejected = expect(result).rejects.toBe(reason);
    await entered; controller.abort(reason); await rejected; expect(generate).not.toHaveBeenCalled();
  });
  it.each(['analysis', 'persistence', 'generation'] as const)('preserves the exact same-message callback error and cause at %s', async phase => {
    const dep = dependencies(), generate = vi.spyOn(dep, 'generate'), reason = new Error('SKETCH_MODEL_TIMEOUT', { cause: new Error('original-db-result') });
    const hook = hooks();
    if (phase === 'persistence') hook.afterAnalysis = async () => { throw reason; };
    else hook.beforePhase = async value => { if (value === phase) throw reason; };
    const prepared = await prepareSketchImage(input, dep, context());
    let observed: unknown; try { await prepared.compute(new AbortController().signal, hook); } catch (error) { observed = error; }
    expect(observed).toBe(reason); expect((observed as Error).cause).toBe(reason.cause); expect(generate).not.toHaveBeenCalled();
  });
  it('an analysis persistence deadline is unconfirmed, not a definite provider failure', async () => {
    const dep = dependencies(), generate = vi.spyOn(dep, 'generate'); let entered = false;
    const hook = hooks(); hook.afterAnalysis = async () => { entered = true; await new Promise<never>(() => undefined); };
    const prepared = await prepareSketchImage(input, dep, context()); vi.useFakeTimers();
    const result = prepared.compute(new AbortController().signal, hook), rejected = expect(result).rejects.toThrow('SKETCH_IMAGE_CHECKPOINT_UNCONFIRMED');
    for (let count = 0; count < 10 && !entered; count++) await nextTurn();
    expect(entered).toBe(true); await vi.advanceTimersByTimeAsync(10_000); await rejected;
    expect(generate).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['empty', 'multiple', 'mixed', 'wrong-provider', 'wrong-model', 'unsafe-url', 'credentials-url', 'control-id', 'getter', 'extra'])(
    'rejects generation receipt %s instead of publishing a draft', async variant => {
      const dep = dependencies(); let reads = 0;
      dep.generate = async () => {
        const value = structuredClone(receipt);
        if (variant === 'empty') value.taskIds = [];
        if (variant === 'multiple') value.taskIds.push('second');
        if (variant === 'mixed') value.directImageUrls = ['https://synthetic.invalid/a.png'];
        if (variant === 'wrong-provider') value.usedProviderId = 'other-provider';
        if (variant === 'wrong-model') value.usedModel = 'other-model';
        if (variant === 'unsafe-url') { value.taskIds = []; value.directImageUrls = ['javascript:alert(1)']; }
        if (variant === 'credentials-url') { value.taskIds = []; value.directImageUrls = ['https://secret:password@synthetic.invalid/a.png']; }
        if (variant === 'control-id') value.taskIds = ['id\u0000'];
        if (variant === 'getter') Object.defineProperty(value, 'taskIds', { enumerable: true, get: () => { reads++; return ['remote-one']; } });
        if (variant === 'extra') Object.assign(value, { status: 'completed' });
        return value;
      };
      await expect((await prepareSketchImage(input, dep, context())).compute(new AbortController().signal, hooks())).rejects.toThrow(); expect(reads).toBe(0);
    });
});
