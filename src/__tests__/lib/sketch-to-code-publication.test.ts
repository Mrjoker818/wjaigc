import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it, vi } from 'vitest';
import { publishSketchTask } from '@/lib/sketch-to-code/publication';
import type { SketchPublicationInput } from '@/lib/sketch-to-code/execution';
vi.mock('server-only', () => ({}));
import { generateSketchCode, type SketchGenerationDependencies } from '@/lib/sketch-to-code/generation';
import { compileSketchHtml } from '@/lib/sketch-to-code/html';
import { validateSketchDraft } from '@/lib/sketch-to-code/document';

// Originally the publication-contract seam RED: compilation source must survive execution's
// structuredClone boundary so logical documents can recompile and verify bytes.
// PostgreSQL publication evidence is separately exercised by the integration suite.
describe('sketch publication compilation-source seam', () => {
  it.each([1, 12])('retains depth%d source through default compute, execution snapshot and publication validation', async depth => {
    let tree: unknown = { type: 'text', text: '安全草图', style: { color: '#111827' } };
    for (let nodeDepth = 1; nodeDepth < depth; nodeDepth++) tree = { type: 'container', children: [tree] };
    const dependencies: SketchGenerationDependencies = {
      authorizeProject: async (actorUserId, projectId) => ({ kind: 'personal', actorUserId, projectId, ownerId: actorUserId }),
      resolveTaskModel: async (providerId, modelId) => ({
        providerId, modelId, kind: 'chat', sourceType: 'vlm', protocol: 'chat-completions', executionMode: 'sync',
        allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1, supportsVision: true,
        supportsReferenceImages: true, supportsMask: false, outputKinds: ['text'], capabilitySources: { supportsVision: 'admin' },
      }),
      analyze: async () => JSON.stringify({ summary: '草图', layout: '单列', controls: [], text: ['安全草图'] }),
      reconstruct: async () => JSON.stringify(tree),
    };
    const draft = structuredClone(await generateSketchCode({
      projectId: 'publication-project', providerId: 'p1', modelId: 'vision-1', idempotencyKey: 'publication-nonce',
      imageDataUrl: createCanvas(2, 2).toDataURL('image/png'), instruction: '还原草图',
    }, dependencies, { actorUserId: 'publication-actor', signal: new AbortController().signal }));
    expect(draft.html).toContain('<p style="color:#111827">安全草图</p>');
    // The adjudicated internal source must survive the existing execution snapshot.
    const source = draft.uiTree;
    expect(() => compileSketchHtml(source)).not.toThrow();
    expect(compileSketchHtml(source)).toBe(draft.html);
    expect(validateSketchDraft(draft).html).toBe(draft.html);
  });
});
it('does not freeze or break a caller native abort capability even when rejecting invalid input', async () => {
  const controller = new AbortController();
  const value = { task: {}, input: {}, access: {}, lease: {}, signal: controller.signal,
    draft: { html: compileSketchHtml({ type: 'text', text: 'x' }), uiTree: { type: 'text', text: 'x' },
      analysis: { summary: 'x', layout: 'x', controls: [], text: [] } } } as unknown as SketchPublicationInput;
  expect(await publishSketchTask(value)).toBe(false);
  expect(Object.isFrozen(controller.signal)).toBe(false);
  expect(() => controller.abort()).not.toThrow();
});
it('never executes a usage getter while withholding publication on an invalid authority', async () => {
  let called = 0;
  const draft = { html: compileSketchHtml({ type: 'text', text: 'x' }), uiTree: { type: 'text', text: 'x' },
    analysis: { summary: 'x', layout: 'x', controls: [], text: [] } };
  Object.defineProperty(draft, 'usage', { enumerable: true, get: () => { called++; return {}; } });
  expect(await publishSketchTask({ task: {}, access: {}, input: {}, lease: {}, draft,
    signal: new AbortController().signal } as unknown as SketchPublicationInput)).toBe(false);
  expect(called).toBe(0);
});
