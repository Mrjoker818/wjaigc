import { createCanvas } from '@napi-rs/canvas';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { crc32 } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import { generateSketchCode, prepareSketchCode, type SketchGenerationDependencies } from '@/lib/sketch-to-code/generation';
import { compileSketchHtml } from '@/lib/sketch-to-code/html';

const imageDataUrl = createCanvas(8, 8).toDataURL('image/png');
const input = { projectId: 'project-a', imageDataUrl, instruction: '还原草图', providerId: 'p1', modelId: 'vision-1', idempotencyKey: 'request-1' };
const descriptor: TaskModelDescriptor = {
  providerId: 'p1', modelId: 'vision-1', kind: 'chat', sourceType: 'vlm', protocol: 'chat-completions', executionMode: 'sync',
  allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1, supportsVision: true,
  supportsReferenceImages: true, supportsMask: false, outputKinds: ['text'], capabilitySources: { supportsVision: 'admin' },
};
const analysis = { summary: '登录页', layout: '垂直排列', controls: ['名称输入', '确认按钮'], text: ['欢迎'] };
const tree = { type: 'container', children: [{ type: 'heading', text: '欢迎' }, { type: 'input', placeholder: '名称' }, { type: 'button', text: '确认' }] };

function dependencies(events: string[] = []): SketchGenerationDependencies {
  return {
    authorizeProject: async (actorUserId, projectId) => { events.push(`authorize:${actorUserId}:${projectId}`); return { kind: 'personal', actorUserId, ownerId: actorUserId, projectId }; },
    resolveTaskModel: async (providerId, modelId, actorUserId) => { events.push(`model:${providerId}:${modelId}:${actorUserId}`); return structuredClone(descriptor); },
    analyze: async () => { events.push('analyze'); return JSON.stringify(analysis); },
    reconstruct: async () => { events.push('reconstruct'); return JSON.stringify(tree); },
  };
}

function context(signal = new AbortController().signal): { actorUserId: string; signal: AbortSignal } {
  return { actorUserId: 'user-a', signal };
}

afterEach(() => { vi.useRealTimers(); });

describe('HTTP integration real phase callback', () => {
  it('awaits each phase immediately before its actual adapter', async () => {
    const events: string[] = []; const prepared = await prepareSketchCode(input, dependencies(events), context());
    events.length = 0;
    await prepared.compute(context().signal, async phase => { events.push(phase); });
    expect(events).toEqual(['analysis', 'analyze', 'reconstruction', 'reconstruct']);
  });
  it.each(['analysis', 'reconstruction'] as const)('checks abort after the %s callback before a paid call', async phase => {
    const events: string[] = []; const controller = new AbortController();
    const prepared = await prepareSketchCode(input, dependencies(events), context()); events.length = 0;
    await expect(prepared.compute(controller.signal, async actual => {
      events.push(actual); if (actual === phase) controller.abort(new Error('explicit-stop'));
    })).rejects.toThrow('explicit-stop');
    expect(events).toEqual(phase === 'analysis' ? ['analysis'] : ['analysis', 'analyze', 'reconstruction']);
  });
  it('does not start analysis if the phase fence fails', async () => {
    const events: string[] = []; const prepared = await prepareSketchCode(input, dependencies(events), context()); events.length = 0;
    await expect(prepared.compute(context().signal, async () => { throw new Error('fence-unknown'); })).rejects.toThrow('fence-unknown');
    expect(events).toEqual([]);
  });
  it('late analysis fulfillment after abort never enters reconstruction or its callback', async () => {
    const events: string[] = []; const controller = new AbortController(); let finish!: (value: string) => void;
    const dep = dependencies(events); dep.analyze = async () => new Promise<string>(resolve => { finish = resolve; });
    const prepared = await prepareSketchCode(input, dep, context()); events.length = 0;
    const running = prepared.compute(controller.signal, async phase => { events.push(phase); });
    const rejected = expect(running).rejects.toThrow('stop');
    await nextTurn(); controller.abort(new Error('stop')); await rejected;
    finish(JSON.stringify(analysis)); await nextTurn(); expect(events).toEqual(['analysis']);
  });
});

describe('publication source retained by the default computation', () => {
  it.each(['both-string', 'both-wrapper', 'analysis-only', 'reconstruction-only', 'zero'] as const)(
    'usage preserves explicit missing/zero semantics for %s', async variant => {
      const dep = dependencies();
      if (variant !== 'both-string') {
        dep.analyze = async () => ({ content: JSON.stringify(analysis), ...(variant === 'analysis-only' || variant === 'zero' ? { usage: { inputTokens: 0, outputTokens: 0 } } : {}) });
        dep.reconstruct = async () => ({ content: JSON.stringify(tree), ...(variant === 'reconstruction-only' || variant === 'zero' ? { usage: { inputTokens: 3, outputTokens: 4 } } : {}) });
      }
      const result = await generateSketchCode(input, dep, context());
      if (variant.startsWith('both')) expect(result).not.toHaveProperty('usage');
      else expect(result).toHaveProperty('usage', {
        analysis: variant === 'reconstruction-only' ? null : { inputTokens: 0, outputTokens: 0 },
        reconstruction: variant === 'analysis-only' ? null : { inputTokens: 3, outputTokens: 4 },
        total: variant === 'zero' ? { inputTokens: 3, outputTokens: 4 } : null,
      });
      expect(result.html).toBe(compileSketchHtml(tree));
    },
  );
  it.each(['usage', 'price'] as const)('usage rejects injected client %s before authorization', async field => {
    const events: string[] = [];
    await expect(generateSketchCode({ ...input, [field]: { inputTokens: 1, outputTokens: 2 } }, dependencies(events), context())).rejects.toThrow('SKETCH_INPUT_INVALID');
    expect(events).toEqual([]);
  });
  it.each(['analysis', 'reconstruction'] as const)('usage preserves provider %s failure without producing a draft', async stage => {
    const events: string[] = []; const dep = dependencies(events); const reason = new Error('fixture-provider-failed');
    dep.analyze = async () => { events.push('analyze'); if (stage === 'analysis') throw reason; return { content: JSON.stringify(analysis), usage: { inputTokens: 7, outputTokens: 8 } }; };
    dep.reconstruct = async () => { events.push('reconstruct'); throw reason; };
    await expect(generateSketchCode(input, dep, context())).rejects.toBe(reason);
    expect(events.filter(e => e === 'analyze' || e === 'reconstruct')).toEqual(stage === 'analysis' ? ['analyze'] : ['analyze', 'reconstruct']);
  });
  it.each(['analysis', 'reconstruction'] as const)('usage keeps wrapped %s JSON byte budget unchanged', async stage => {
    const dep = dependencies(); const json = JSON.stringify(stage === 'analysis' ? analysis : tree);
    const content = json + ' '.repeat(256 * 1024 - Buffer.byteLength(json));
    const response = { content, usage: { inputTokens: 1, outputTokens: 2 } };
    if (stage === 'analysis') dep.analyze = async () => response; else dep.reconstruct = async () => response;
    expect((await generateSketchCode(input, dep, context())).html).toBe(compileSketchHtml(tree));
    response.content += ' ';
    await expect(generateSketchCode(input, dep, context())).rejects.toThrow('SKETCH_MODEL_INVALID_JSON');
  });
  it.each(['content', 'usage'] as const)('usage rejects stage %s accessor before next phase without running it', async field => {
    const events: string[] = []; let invoked = 0; const dep = dependencies(events);
    const response = { content: JSON.stringify(analysis), usage: { inputTokens: 1, outputTokens: 2 } };
    Object.defineProperty(response, field, { get: () => { invoked++; return field === 'content' ? JSON.stringify(analysis) : {}; } });
    dep.analyze = async () => response;
    await expect(generateSketchCode(input, dep, context())).rejects.toThrow('SKETCH_USAGE_INVALID');
    expect(invoked).toBe(0); expect(events).not.toContain('reconstruct');
  });
  it.each(['incomplete-analysis', 'unsafe-tree', 'invalid-usage', 'extra-wrapper'] as const)('usage cannot bless %s into a successful draft', async variant => {
    const events: string[] = []; const dep = dependencies(events);
    dep.analyze = async () => ({ content: JSON.stringify(variant === 'incomplete-analysis' ? { summary: 'only' } : analysis),
      usage: { inputTokens: variant === 'invalid-usage' ? -1 : 1, outputTokens: 2 }, ...(variant === 'extra-wrapper' ? { html: '<script>' } : {}) });
    dep.reconstruct = async () => { events.push('reconstruct'); return { content: '{"type":"script","text":"unsafe"}', usage: { inputTokens: 3, outputTokens: 4 } }; };
    await expect(generateSketchCode(input, dep, context())).rejects.toThrow(variant === 'incomplete-analysis' ? 'SKETCH_ANALYSIS_INVALID' : variant === 'unsafe-tree' ? 'SKETCH_UI_INVALID' : 'SKETCH_USAGE_INVALID');
    expect(events.includes('reconstruct')).toBe(variant === 'unsafe-tree');
  });
  it.each([['analysis', 'cancel'], ['reconstruction', 'cancel'], ['analysis', 'timeout'], ['reconstruction', 'timeout']] as const)(
    'usage discards late wrapped %s counts after %s without an extra phase', async (stage, stop) => {
      vi.useFakeTimers(); const abort = new AbortController(); const reason = new Error('usage-cancel');
      let start!: () => void; const ready = new Promise<void>(resolve => { start = resolve; });
      let finish!: (value: unknown) => void; const calls: string[] = []; const dep = dependencies();
      const invoke = async (phase: string): Promise<unknown> => {
        calls.push(phase);
        if (phase === stage) { start(); return new Promise(resolve => { finish = resolve; }); }
        return { content: JSON.stringify(analysis), usage: { inputTokens: 7, outputTokens: 8 } };
      };
      dep.analyze = async () => invoke('analysis'); dep.reconstruct = async () => invoke('reconstruction');
      const pending = generateSketchCode(input, dep, context(abort.signal));
      const outcome = pending.then(draft => ({ draft }), (error: unknown) => ({ error }));
      const reached = await Promise.race([ready.then(() => true), outcome.then(() => false)]);
      if (reached) { if (stop === 'cancel') abort.abort(reason); else await vi.advanceTimersByTimeAsync(60000); }
      const settled = await outcome;
      expect(settled).toHaveProperty('error');
      if (!('error' in settled)) throw new Error('unexpected usage draft');
      if (stop === 'cancel') expect(settled.error).toBe(reason);
      else expect(settled.error).toMatchObject({ message: 'SKETCH_MODEL_TIMEOUT' });
      finish({ content: JSON.stringify(stage === 'analysis' ? analysis : tree), usage: { inputTokens: 99, outputTokens: 99 } });
      await nextTurn(); expect(calls).toEqual(stage === 'analysis' ? ['analysis'] : ['analysis', 'reconstruction']); expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('usage accepts wrapped phases and returns detached frozen actual counts without changing HTML', async () => {
    const dep = dependencies();
    const first = { content: JSON.stringify(analysis), usage: { inputTokens: 101, outputTokens: 17 } };
    const second = { content: JSON.stringify(tree), usage: { inputTokens: 203, outputTokens: 29 } };
    dep.analyze = async () => first; dep.reconstruct = async () => second;
    const draft = await generateSketchCode(input, dep, context());
    expect(draft).toHaveProperty('usage', { analysis: { inputTokens: 101, outputTokens: 17 }, reconstruction: { inputTokens: 203, outputTokens: 29 }, total: { inputTokens: 304, outputTokens: 46 } });
    first.usage.inputTokens = 999; second.usage.outputTokens = 999;
    expect(draft).toHaveProperty('usage.total', { inputTokens: 304, outputTokens: 46 });
    const usage = (draft as unknown as { usage: { analysis: object; reconstruction: object; total: object } }).usage;
    expect([usage, usage.analysis, usage.reconstruction, usage.total].every(Object.isFrozen)).toBe(true);
    expect(draft.html).toBe(compileSketchHtml(tree));
  });

  it('returns a deeply frozen JSON source whose execution clone recompiles to the exact HTML', async () => {
    const draft = await generateSketchCode(input, dependencies(), context());
    const source = (draft as unknown as Record<string, unknown>).uiTree;
    expect(source).toEqual(tree);
    expect(Object.isFrozen(source)).toBe(true);
    const root = source as { children: object[] };
    expect(Object.isFrozen(root.children)).toBe(true);
    expect(root.children.every(Object.isFrozen)).toBe(true);
    expect(compileSketchHtml(structuredClone(source))).toBe(draft.html);
  });

  it('does not allow external edits to change the delivered compilation source', async () => {
    const draft = await generateSketchCode(input, dependencies(), context());
    const source = (draft as unknown as Record<string, unknown>).uiTree as { children: { text: string }[] };
    expect(() => { source.children[0].text = '<script>changed</script>'; }).toThrow();
    expect(compileSketchHtml(source)).toBe(draft.html);
    expect(draft.html).toContain('<h1>欢迎</h1>');
  });
});

describe('sketch two-stage generation draft', () => {
  it('prepares a decoded immutable admission snapshot without starting provider work', async () => {
    const events: string[] = [];
    const prepared = await prepareSketchCode(input, dependencies(events), context());
    expect(events).toEqual(['authorize:user-a:project-a', 'model:p1:vision-1:user-a']);
    expect(prepared.input).toEqual(input);
    expect(prepared.binding).toEqual({ providerId: 'p1', modelId: 'vision-1' });
    expect(prepared.access).toEqual({ kind: 'personal', actorUserId: 'user-a', ownerId: 'user-a', projectId: 'project-a' });
    expect([prepared, prepared.input, prepared.binding, prepared.access].every(Object.isFrozen)).toBe(true);
    expect((await prepared.compute(new AbortController().signal)).html).toContain('<h1>欢迎</h1>');
    expect(events).toEqual(['authorize:user-a:project-a', 'model:p1:vision-1:user-a', 'analyze', 'reconstruct']);
  });

  it('does not expose a prepared task for a PNG that fails complete decoding', async () => {
    const events: string[] = [];
    await expect(prepareSketchCode({ ...input, imageDataUrl: 'data:image/png;base64,bm90IGEgcG5n' }, dependencies(events), context()))
      .rejects.toThrow('ASSET_BINARY_FORMAT_INVALID');
    expect(events).toEqual(['authorize:user-a:project-a', 'model:p1:vision-1:user-a']);
  });

  it.each(['project', 'model'] as const)('does not expose a preparation when the %s admission is invalid', async stage => {
    const events: string[] = [];
    const dep = dependencies(events);
    if (stage === 'project') dep.authorizeProject = async actorUserId => ({ kind: 'unscoped', actorUserId });
    else dep.resolveTaskModel = async () => ({ ...descriptor, supportsVision: false });
    await expect(prepareSketchCode(input, dep, context())).rejects.toThrow(stage === 'project' ? 'SKETCH_PROJECT_UNAVAILABLE' : 'SKETCH_MODEL_UNAVAILABLE');
    expect(events).not.toContain('analyze'); expect(events).not.toContain('reconstruct');
  });

  it('uses the task execution signal rather than the disconnected admission request', async () => {
    const requestAbort = new AbortController(); const taskAbort = new AbortController();
    const dep = dependencies();
    dep.analyze = async (_image, _instruction, _binding, signal) => {
      expect(signal.aborted).toBe(false); expect(signal).not.toBe(requestAbort.signal); return JSON.stringify(analysis);
    };
    const prepared = await prepareSketchCode(input, dep, context(requestAbort.signal));
    requestAbort.abort(new Error('request-disconnected-after-admission'));
    expect((await prepared.compute(taskAbort.signal)).html).toContain('欢迎');
  });

  it('does not begin prepared computation when the task has already been cancelled', async () => {
    const events: string[] = []; const abort = new AbortController(); const reason = new Error('task-cancelled-before-worker');
    const prepared = await prepareSketchCode(input, dependencies(events), context());
    abort.abort(reason);
    await expect(prepared.compute(abort.signal)).rejects.toBe(reason);
    expect(events).toEqual(['authorize:user-a:project-a', 'model:p1:vision-1:user-a']);
  });

  it('freezes the prepared input, access, descriptor binding and stage functions across admission', async () => {
    const dep = dependencies(); const mutableInput = { ...input }; const mutableDescriptor = structuredClone(descriptor);
    const mutableAccess = { kind: 'personal' as const, actorUserId: 'user-a', ownerId: 'user-a', projectId: 'project-a' };
    dep.authorizeProject = async () => mutableAccess; dep.resolveTaskModel = async () => mutableDescriptor;
    dep.analyze = async (image, instruction, binding) => {
      expect([image, instruction, binding.providerId, binding.modelId]).toEqual([input.imageDataUrl, input.instruction, 'p1', 'vision-1']);
      return JSON.stringify(analysis);
    };
    const prepared = await prepareSketchCode(mutableInput, dep, context());
    mutableInput.imageDataUrl = ''; mutableInput.providerId = 'other'; mutableInput.instruction = 'changed';
    mutableDescriptor.modelId = 'other'; mutableAccess.projectId = 'other'; mutableAccess.ownerId = 'other';
    dep.analyze = async () => { throw new Error('unexpected adapter substitution'); };
    dep.reconstruct = async () => { throw new Error('unexpected adapter substitution'); };
    expect(prepared.access.projectId).toBe('project-a'); expect(prepared.access.ownerId).toBe('user-a');
    expect((await prepared.compute(new AbortController().signal)).html).toContain('欢迎');
  });

  it.each(['personal', 'document'] as const)('freezes %s access before model resolution can mutate the admission object', async kind => {
    const dep = dependencies();
    const mutableAccess = { kind, actorUserId: 'user-a', projectId: 'project-a', ownerId: 'owner-a', grantGeneration: '3' };
    dep.authorizeProject = async () => mutableAccess;
    dep.resolveTaskModel = async () => {
      mutableAccess.actorUserId = 'other'; mutableAccess.projectId = 'other'; mutableAccess.ownerId = 'other'; mutableAccess.grantGeneration = '4';
      return structuredClone(descriptor);
    };
    const prepared = await prepareSketchCode(input, dep, context());
    expect(prepared.access).toEqual({ kind, actorUserId: 'user-a', projectId: 'project-a', ownerId: 'owner-a', grantGeneration: '3' });
    expect(Object.isFrozen(prepared.access)).toBe(true);
    expect((await prepared.compute(new AbortController().signal)).html).toContain('欢迎');
  });

  it('authorizes before model calls and compiles real structured output, never raw HTML', async () => {
    const events: string[] = [];
    const result = await generateSketchCode(input, dependencies(events), context());
    expect(events).toEqual(['authorize:user-a:project-a', 'model:p1:vision-1:user-a', 'analyze', 'reconstruct']);
    expect(result.analysis).toEqual(analysis);
    expect(result.html).toContain('<h1>欢迎</h1>');
    expect(result.html).toContain('Content-Security-Policy');
  });

  it('takes one immutable exact model binding for both phases', async () => {
    const dep = dependencies();
    const mutableDescriptor = structuredClone(descriptor);
    dep.resolveTaskModel = async () => mutableDescriptor;
    dep.analyze = async (image, instruction, binding) => {
      expect([image, instruction, binding.providerId, binding.modelId]).toEqual([imageDataUrl, '还原草图', 'p1', 'vision-1']);
      expect(Object.isFrozen(binding)).toBe(true);
      mutableDescriptor.providerId = 'p2'; mutableDescriptor.modelId = 'different';
      return JSON.stringify(analysis);
    };
    dep.reconstruct = async (parsed, binding) => {
      expect(parsed).toEqual(analysis);
      expect([binding.providerId, binding.modelId]).toEqual(['p1', 'vision-1']);
      return JSON.stringify(tree);
    };
    expect((await generateSketchCode(input, dep, context())).html).toContain('欢迎');
  });

  it('preserves an authorization refusal and does not reach provider work', async () => {
    const denied = new Error('GENERATION_PROJECT_FORBIDDEN');
    const dep = dependencies();
    dep.authorizeProject = async () => { throw denied; };
    dep.resolveTaskModel = async () => { throw new Error('unexpected model resolution'); };
    await expect(generateSketchCode(input, dep, context())).rejects.toBe(denied);
  });

  it.each([
    { ...descriptor, providerId: 'p2' }, { ...descriptor, modelId: 'other' },
    { ...descriptor, supportsVision: false }, { ...descriptor, kind: 'image' as const },
  ])('rejects a changed or non-vision catalog descriptor before analysis: %j', async (model) => {
    const dep = dependencies(); dep.resolveTaskModel = async () => model;
    dep.analyze = async () => { throw new Error('unexpected provider call'); };
    await expect(generateSketchCode(input, dep, context())).rejects.toThrow('SKETCH_MODEL_UNAVAILABLE');
  });

  it.each([
    { ...input, apiKey: 'client-secret' }, { ...input, actorUserId: 'other-user' },
    { ...input, providerId: '' }, { ...input, modelId: ' padded ' },
    { ...input, instruction: 'x'.repeat(4097) }, { ...input, idempotencyKey: '' },
  ])('rejects unsafe input before admission: %j', async (value) => {
    await expect(generateSketchCode(value, dependencies(), context())).rejects.toThrow('SKETCH_INPUT_INVALID');
  });

  it.each(['data:image/jpeg;base64,aGVsbG8=', 'data:image/png;base64,bm90IGEgcG5n', 'data:image/png;base64,!!!!'])('rejects invalid PNG input %s', async (imageDataUrl) => {
    await expect(generateSketchCode({ ...input, imageDataUrl }, dependencies(), context())).rejects.toThrow();
  });

  it('rejects an actual decoded PNG wider than the sketch limit', async () => {
    const tooWide = createCanvas(2049, 1).toDataURL('image/png');
    await expect(generateSketchCode({ ...input, imageDataUrl: tooWide }, dependencies(), context())).rejects.toThrow('SKETCH_IMAGE_LIMIT');
  });

  it.each(['analysis', 'reconstruction'] as const)('refuses non-JSON %s output without fallback', async (stage) => {
    const dep = dependencies();
    if (stage === 'analysis') dep.analyze = async () => '<html>not JSON</html>';
    else dep.reconstruct = async () => '<html>unsafe HTML</html>';
    await expect(generateSketchCode(input, dep, context())).rejects.toThrow('SKETCH_MODEL_INVALID_JSON');
  });

  it('rejects incomplete analysis and unsafe reconstructed trees', async () => {
    const dep = dependencies(); dep.analyze = async () => '{"summary":"only"}';
    await expect(generateSketchCode(input, dep, context())).rejects.toThrow('SKETCH_ANALYSIS_INVALID');
    dep.analyze = async () => JSON.stringify(analysis); dep.reconstruct = async () => '{"type":"script","text":"alert(1)"}';
    await expect(generateSketchCode(input, dep, context())).rejects.toThrow('SKETCH_UI_INVALID');
  });

  it('preserves a real provider error identity and prevents the second phase', async () => {
    const providerError = new Error('provider request-42 HTTP 429');
    const dep = dependencies(); dep.analyze = async () => { throw providerError; };
    dep.reconstruct = async () => { throw new Error('unexpected second phase'); };
    await expect(generateSketchCode(input, dep, context())).rejects.toBe(providerError);
  });

  it('rejects pre-cancellation without invoking admission', async () => {
    const abort = new AbortController(); const reason = new Error('cancelled'); abort.abort(reason);
    const dep = dependencies(); dep.authorizeProject = async () => { throw new Error('unexpected admission'); };
    await expect(generateSketchCode(input, dep, context(abort.signal))).rejects.toBe(reason);
  });

  it('does not reconstruct from a late analysis after cancellation', async () => {
    const abort = new AbortController(); const reason = new Error('cancelled');
    const dep = dependencies();
    dep.analyze = async () => { abort.abort(reason); return JSON.stringify(analysis); };
    dep.reconstruct = async () => { throw new Error('unexpected late reconstruction'); };
    await expect(generateSketchCode(input, dep, context(abort.signal))).rejects.toBe(reason);
  });

  it.each(['analysis', 'reconstruction'] as const)('cleans both phase timers and listeners on success or %s failure', async (failureStage) => {
    vi.useFakeTimers();
    const cleanups: ReturnType<typeof vi.spyOn>[] = [];
    const error = new Error('provider-failed');
    const dep = dependencies();
    const execute = async (stage: string, signal: AbortSignal, fail: boolean): Promise<string> => {
      cleanups.push(vi.spyOn(signal, 'removeEventListener'));
      expect(vi.getTimerCount()).toBe(1);
      if (fail && stage === failureStage) throw error;
      return JSON.stringify(stage === 'analysis' ? analysis : tree);
    };
    dep.analyze = async (_image, _instruction, _binding, signal) => execute('analysis', signal, false);
    dep.reconstruct = async (_analysis, _binding, signal) => execute('reconstruction', signal, false);
    await generateSketchCode(input, dep, context());
    expect(vi.getTimerCount()).toBe(0);
    expect(cleanups).toHaveLength(2);
    for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledWith('abort', expect.any(Function));
    cleanups.length = 0;
    dep.analyze = async (_image, _instruction, _binding, signal) => execute('analysis', signal, true);
    dep.reconstruct = async (_analysis, _binding, signal) => execute('reconstruction', signal, true);
    await expect(generateSketchCode(input, dep, context())).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
    expect(cleanups).toHaveLength(failureStage === 'analysis' ? 1 : 2);
    for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it.each([
    ['analysis', 'fulfill'], ['analysis', 'reject'], ['reconstruction', 'fulfill'], ['reconstruction', 'reject'],
  ] as const)('times out an ignoring %s adapter and discards late %s', async (stage, lateOutcome) => {
    vi.useFakeTimers();
    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => { markReady = resolve; });
    let fulfillLate!: (value: unknown) => void;
    let rejectLate!: (reason: Error) => void;
    let boundSignal: AbortSignal | undefined;
    const stall = (signal: AbortSignal): Promise<unknown> => {
      boundSignal = signal; markReady();
      return new Promise((resolve, reject) => { fulfillLate = resolve; rejectLate = reject; });
    };
    const dep = dependencies();
    const reconstruct = vi.fn(dep.reconstruct);
    dep.reconstruct = reconstruct;
    if (stage === 'analysis') dep.analyze = async (_image, _instruction, _binding, signal) => stall(signal);
    else dep.reconstruct = async (_analysis, _binding, signal) => stall(signal);
    const pending = generateSketchCode(input, dep, context());
    const rejected = expect(pending).rejects.toThrow('SKETCH_MODEL_TIMEOUT');
    await ready;
    await vi.advanceTimersByTimeAsync(60000);
    await rejected;
    expect(boundSignal?.aborted).toBe(true);
    if (lateOutcome === 'fulfill') fulfillLate(JSON.stringify(stage === 'analysis' ? analysis : tree));
    else rejectLate(new Error('late-provider-failed'));
    await nextTurn();
    if (stage === 'analysis') expect(reconstruct).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['analysis', 'fulfill'], ['analysis', 'reject'], ['reconstruction', 'fulfill'], ['reconstruction', 'reject'],
  ] as const)('cancels pending %s, immediately cleans resources and discards late %s', async (stage, lateOutcome) => {
    vi.useFakeTimers();
    const abort = new AbortController(); const reason = new Error('cancelled-mid-request');
    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => { markReady = resolve; });
    let fulfillLate!: (value: unknown) => void;
    let rejectLate!: (reason: Error) => void;
    let boundSignal: AbortSignal | undefined;
    let cleanup: ReturnType<typeof vi.spyOn> | undefined;
    const stall = (signal: AbortSignal): Promise<unknown> => {
      boundSignal = signal; cleanup = vi.spyOn(signal, 'removeEventListener'); markReady();
      return new Promise((resolve, reject) => { fulfillLate = resolve; rejectLate = reject; });
    };
    const dep = dependencies();
    const reconstruct = vi.fn(dep.reconstruct);
    dep.reconstruct = reconstruct;
    if (stage === 'analysis') dep.analyze = async (_image, _instruction, _binding, signal) => stall(signal);
    else dep.reconstruct = async (_analysis, _binding, signal) => stall(signal);
    const pending = generateSketchCode(input, dep, context(abort.signal));
    const rejected = expect(pending).rejects.toBe(reason);
    await ready;
    expect(vi.getTimerCount()).toBe(1);
    abort.abort(reason); await rejected;
    expect(boundSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(cleanup).toHaveBeenCalledWith('abort', expect.any(Function));
    if (lateOutcome === 'fulfill') fulfillLate(JSON.stringify(stage === 'analysis' ? analysis : tree));
    else rejectLate(new Error('late-provider-failed'));
    await nextTurn();
    if (stage === 'analysis') expect(reconstruct).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects corrupt pixel data despite a valid PNG header and chunk checksums', async () => {
    const bytes = Buffer.from(imageDataUrl.slice('data:image/png;base64,'.length), 'base64');
    for (let offset = 8; offset < bytes.length; offset += bytes.readUInt32BE(offset) + 12) {
      const length = bytes.readUInt32BE(offset);
      if (bytes.toString('ascii', offset + 4, offset + 8) !== 'IDAT') continue;
      bytes.fill(0, offset + 8, offset + 8 + length);
      bytes.writeUInt32BE(crc32(bytes.subarray(offset + 4, offset + 8 + length)), offset + 8 + length);
    }
    await expect(generateSketchCode({ ...input, imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}` }, dependencies(), context()))
      .rejects.toThrow('ASSET_BINARY_FORMAT_INVALID');
  });

  it('accepts a fully decoded PNG at 4 MiB and refuses one byte over', async () => {
    const original = Buffer.from(imageDataUrl.slice('data:image/png;base64,'.length), 'base64');
    const pad = (size: number): string => {
      const chunk = Buffer.alloc(size - original.length);
      chunk.writeUInt32BE(chunk.length - 12, 0); chunk.write('npAD', 4, 'ascii');
      chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)), chunk.length - 4);
      const bytes = Buffer.concat([original.subarray(0, original.length - 12), chunk, original.subarray(original.length - 12)]);
      expect(bytes.length).toBe(size);
      return `data:image/png;base64,${bytes.toString('base64')}`;
    };
    expect((await generateSketchCode({ ...input, imageDataUrl: pad(4 * 1024 * 1024) }, dependencies(), context())).html).toContain('欢迎');
    await expect(generateSketchCode({ ...input, imageDataUrl: pad(4 * 1024 * 1024 + 1) }, dependencies(), context()))
      .rejects.toThrow('SKETCH_IMAGE_INVALID');
  });

  it.each(['controls', 'text'] as const)('enforces the %s analysis array at 200 versus 201 items', async (field) => {
    const dep = dependencies();
    dep.analyze = async () => JSON.stringify({ ...analysis, [field]: Array.from({ length: 200 }, () => '') });
    expect((await generateSketchCode(input, dep, context())).analysis[field]).toHaveLength(200);
    dep.analyze = async () => JSON.stringify({ ...analysis, [field]: Array.from({ length: 201 }, () => '') });
    await expect(generateSketchCode(input, dep, context())).rejects.toThrow('SKETCH_ANALYSIS_INVALID');
  });

  it.each(['analysis', 'reconstruction'] as const)('enforces %s JSON bytes at 256 KiB versus one byte over', async (stage) => {
    const dep = dependencies();
    const json = JSON.stringify(stage === 'analysis' ? analysis : tree);
    const bounded = json + ' '.repeat(256 * 1024 - Buffer.byteLength(json, 'utf8'));
    expect(Buffer.byteLength(bounded, 'utf8')).toBe(256 * 1024);
    if (stage === 'analysis') dep.analyze = async () => bounded;
    else dep.reconstruct = async () => bounded;
    expect((await generateSketchCode(input, dep, context())).html).toContain('欢迎');
    if (stage === 'analysis') dep.analyze = async () => bounded + ' ';
    else dep.reconstruct = async () => bounded + ' ';
    await expect(generateSketchCode(input, dep, context())).rejects.toThrow('SKETCH_MODEL_INVALID_JSON');
  });

  it('rejects model JSON and aggregate analysis beyond bounded response budgets', async () => {
    const dep = dependencies(); dep.analyze = async () => JSON.stringify({ ...analysis, summary: '界'.repeat(100000) });
    await expect(generateSketchCode(input, dep, context())).rejects.toThrow('SKETCH_MODEL_INVALID_JSON');
    dep.analyze = async () => JSON.stringify({ ...analysis, controls: ['界'.repeat(22000)] });
    await expect(generateSketchCode(input, dep, context())).rejects.toThrow('SKETCH_ANALYSIS_INVALID');
  });
});
