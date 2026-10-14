import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import {
  buildSketchImageGenerationBody, freezeSketchImageInput, parseSketchImageAnalysis,
  sketchImageModels, type SketchCreationMode, type SketchImageInput,
} from '@/lib/sketch-to-code/image-contract';

// Fixtures encode PNG containers; no image decoder, services or environment loader.
function chunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const content = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, content, checksum]);
}
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function header(overrides: { width?: number; height?: number; depth?: number; color?: number; compression?: number; filter?: number; interlace?: number } = {}): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(overrides.width ?? 1, 0); data.writeUInt32BE(overrides.height ?? 1, 4);
  data[8] = overrides.depth ?? 8; data[9] = overrides.color ?? 6;
  data[10] = overrides.compression ?? 0; data[11] = overrides.filter ?? 0; data[12] = overrides.interlace ?? 0;
  return chunk('IHDR', data);
}
const idat = chunk('IDAT', deflateSync(Buffer.from([0, 255, 255, 255, 255])));
const iend = chunk('IEND');
function png(...chunks: Buffer[]): string {
  return `data:image/png;base64,${Buffer.concat([signature, ...chunks]).toString('base64')}`;
}
const originalPng = png(header(), idat, iend);
function model(patch: Partial<TaskModelDescriptor> = {}): TaskModelDescriptor {
  return { providerId: 'image-provider', modelId: 'same-name', kind: 'image', sourceType: 'image',
    protocol: 'custom-image', executionMode: 'async', allowedRatios: ['1:1', '4:3'],
    allowedSizes: ['1024x1024'], qualityOptions: ['high'], maxOutputs: 1,
    supportsReferenceImages: true, maxReferenceImages: 1, supportsMask: false,
    supportedOperations: ['image-to-image'], outputKinds: ['image'], capabilitySources: {}, ...patch };
}
function vision(patch: Partial<TaskModelDescriptor> = {}): TaskModelDescriptor {
  return model({ providerId: 'vision-provider', kind: 'chat', sourceType: 'chat',
    supportsVision: true, protocol: 'chat-completions', executionMode: 'sync', ...patch });
}
function input(patch: Partial<SketchImageInput> = {}): SketchImageInput {
  return { projectId: 'project-1', imageDataUrl: originalPng, instruction: '保留青绿色小屋与星星',
    visionProviderId: 'vision-provider', visionModelId: 'same-name', imageProviderId: 'image-provider',
    imageModelId: 'same-name', idempotencyKey: 'nonce-1', aspectRatio: '1:1',
    size: '1024x1024', quality: 'high', ...patch };
}
function analysis(): { summary: string; composition: string; prompt: string; negativePrompt: string } {
  return { summary: '本次草图：小屋和星星', composition: '小屋居中，星星位于右上角',
    prompt: '水彩质感的青绿色小屋，柔和光线', negativePrompt: '水印、模糊' };
}
function accessor(value: object, field: string, onRead: () => void): object {
  return Object.defineProperty(value, field, { enumerable: true, get: (): never => { onRead(); throw new Error('getter read'); } });
}

describe('sketch image input and two exact model bindings', () => {
  it('freezes a copied input including the original PNG, both providers and all parameters', () => {
    const mode: SketchCreationMode = 'image'; expect(mode).toBe('image');
    const raw = input(), llm = vision(), image = model();
    const frozen = freezeSketchImageInput(raw, llm, image);
    expect(frozen).toEqual(input()); expect(frozen).not.toBe(raw); expect(Object.isFrozen(frozen)).toBe(true);
    raw.imageDataUrl = png(header(), chunk('tEXt', Buffer.from('new')), idat, iend);
    raw.instruction = 'changed'; raw.projectId = 'new-project'; raw.imageProviderId = 'other'; raw.quality = 'other';
    llm.providerId = 'other'; image.modelId = 'other'; image.allowedRatios.length = 0;
    expect(frozen).toEqual(input());
  });
  it('accepts empty instruction and omitted optional parameters without inventing defaults', () => {
    const raw = input({ instruction: '' }); delete raw.size; delete raw.quality;
    const frozen = freezeSketchImageInput(raw, vision(), model());
    expect(frozen).toEqual(raw); expect(frozen).not.toHaveProperty('size'); expect(frozen).not.toHaveProperty('quality');
  });
  it('accepts 4096 instruction characters and bounded Unicode identifiers', () => {
    expect(freezeSketchImageInput(input({ instruction: '字'.repeat(4096), projectId: '项目:一' }), vision(), model()).projectId).toBe('项目:一');
  });
  it.each(['projectId', 'visionProviderId', 'visionModelId', 'imageProviderId', 'imageModelId', 'idempotencyKey', 'aspectRatio'] as const)('rejects missing %s', field => {
    const raw: Record<string, unknown> = { ...input() }; delete raw[field];
    expect(() => freezeSketchImageInput(raw, vision(), model())).toThrow();
  });
  it.each(['imageDataUrl', 'instruction'])('rejects missing %s', field => {
    const raw: Record<string, unknown> = { ...input() }; delete raw[field];
    expect(() => freezeSketchImageInput(raw, vision(), model())).toThrow();
  });
  it.each(['', ' ', ' padded', 'padded ', 'a\n', 'a\u0000b', 'a\u007fb', 'a\u0085b', 'x'.repeat(257)])('rejects invalid identifier %j', projectId => {
    expect(() => freezeSketchImageInput(input({ projectId }), vision(), model())).toThrow();
  });
  it.each([{ instruction: 'x'.repeat(4097) }, { instruction: 'a\u0000b' }, { aspectRatio: '1:1\n' },
    { size: '' }, { quality: '\u007fhigh' }])('rejects invalid input text %j', patch => {
    expect(() => freezeSketchImageInput(input(patch), vision(), model())).toThrow();
  });
  it.each([null, [], new Array(2), new Date(), Object.create(input()) as unknown,
    { ...input(), extra: true }, { ...input(), [Symbol('extra')]: true }])('rejects non-plain, inherited or unknown input %j', value => {
    expect(() => freezeSketchImageInput(value, vision(), model())).toThrow();
  });
  it('rejects input accessors, including unknown non-enumerable fields, without reading getters', () => {
    let reads = 0;
    for (const field of ['instruction', 'extra']) {
      const raw = accessor(input(), field, () => { reads++; });
      expect(() => freezeSketchImageInput(raw, vision(), model())).toThrow();
    }
    expect(() => freezeSketchImageInput(Object.defineProperty(input(), 'hidden', { value: 'unknown' }), vision(), model())).toThrow();
    expect(reads).toBe(0);
  });
  it.each([{ kind: 'image' }, { supportsVision: false }, { supportsVision: undefined },
    { protocol: 'responses' }, { executionMode: 'async' }])('rejects an incompatible vision catalog entry %j', patch => {
    expect(() => freezeSketchImageInput(input(), vision(patch as Partial<TaskModelDescriptor>), model())).toThrow();
  });
  it.each([{ kind: 'edit' }, { supportsReferenceImages: false }, { maxReferenceImages: 0 },
    { supportedOperations: [] }, { supportedOperations: ['text-to-image'] }, { outputKinds: ['video'] },
    { maxOutputs: 0 }])('rejects an incompatible image catalog entry %j', patch => {
    expect(() => freezeSketchImageInput(input(), vision(), model(patch as Partial<TaskModelDescriptor>))).toThrow();
  });
  it('allows reference-capable image entries when operations and reference limits are undeclared', () => {
    const image = model(); delete image.supportedOperations; delete image.maxReferenceImages;
    expect(freezeSketchImageInput(input(), vision(), image)).toEqual(input());
    expect(sketchImageModels([image])).toEqual([image]);
  });
  it.each(['visionProviderId', 'visionModelId', 'imageProviderId', 'imageModelId'] as const)('rejects a different exact %s even when another provider has the same model name', field => {
    expect(() => freezeSketchImageInput(input({ [field]: 'other' }), vision(), model())).toThrow();
  });
  it.each([{ aspectRatio: '16:9' }, { size: '2048x2048' }, { quality: 'low' }])('enforces the original capability validator for %j', patch => {
    expect(() => freezeSketchImageInput(input(patch), vision(), model())).toThrow();
  });
  it('filters capabilities without guessing model names, protocols or alternative providers', () => {
    const one = model(), two = model({ providerId: 'second', modelId: 'same-name', protocol: 'unfamiliar' });
    expect(sketchImageModels([one, vision(), two, model({ supportsReferenceImages: false }),
      model({ maxReferenceImages: 0 }), model({ supportedOperations: ['text-to-image'] }),
      model({ outputKinds: [] }), model({ maxOutputs: 0 })]).map(value => value.providerId)).toEqual(['image-provider', 'second']);
  });
  it('preserves declared catalog metadata when returning filtered image descriptors', () => {
    const image = model({ allowedDurationsSeconds: [6], maxDurationSeconds: 12 });
    expect(sketchImageModels([image])).toEqual([image]);
  });
  it('rejects malformed catalog objects and sparse or accessor arrays without reading getters', () => {
    let reads = 0;
    const badModels = [Object.create(model()) as TaskModelDescriptor, { ...model(), extra: true },
      accessor(model(), 'supportsReferenceImages', () => { reads++; }) as TaskModelDescriptor,
      model({ outputKinds: new Array<string>(1) }),
      model({ allowedRatios: accessor(['1:1'], '0', () => { reads++; }) as string[] }),
      model({ capabilitySources: accessor({}, 'protocol', () => { reads++; }) })];
    for (const bad of badModels) {
      expect(() => freezeSketchImageInput(input(), vision(), bad)).toThrow();
      expect(() => sketchImageModels([bad])).toThrow();
    }
    expect(() => sketchImageModels(new Array<TaskModelDescriptor>(1))).toThrow();
    expect(() => sketchImageModels(accessor([model()], '0', () => { reads++; }) as TaskModelDescriptor[])).toThrow();
    expect(reads).toBe(0);
  });
  it('does not coerce hostile catalog field values or execute their conversion getters', () => {
    let reads = 0;
    const hostile = accessor({}, 'toString', () => { reads++; });
    for (const field of ['kind', 'capabilitySources']) {
      const bad = { ...model(), [field]: field === 'kind' ? hostile : { protocol: hostile } } as TaskModelDescriptor;
      expect(() => freezeSketchImageInput(input(), vision(), bad)).toThrow();
      expect(() => sketchImageModels([bad])).toThrow();
    }
    expect(reads).toBe(0);
  });
});

describe('original PNG structural contract (full CPU decoding belongs to Task8)', () => {
  it.each([
    ['mime', originalPng.replace('image/png', 'image/jpeg')], ['url', 'https://example.invalid/sketch.png'],
    ['not PNG', 'data:image/png;base64,aA=='], ['whitespace', originalPng + '\n'],
    ['bad base64', 'data:image/png;base64,!!!!'], ['noncanonical padding', 'data:image/png;base64,aB=='],
    ['truncated', png(header(), idat)], ['no IDAT', png(header(), iend)],
    ['empty IDAT', png(header(), chunk('IDAT'), iend)], ['no IHDR', png(idat, iend)],
    ['duplicate IHDR', png(header(), header(), idat, iend)], ['wrong first chunk', png(chunk('tEXt'), header(), idat, iend)],
    ['trailing bytes', png(header(), idat, iend, Buffer.from([1]))],
    ['nonempty IEND', png(header(), idat, chunk('IEND', Buffer.from([1])))],
    ['split IDAT', png(header(), idat, chunk('raNd'), idat, iend)],
    ['unknown critical', png(header(), chunk('ABCD'), idat, iend)],
    ['reserved chunk bit', png(header(), chunk('abca'), idat, iend)],
    ['zero width', png(header({ width: 0 }), idat, iend)], ['large edge', png(header({ height: 2049 }), idat, iend)],
    ['illegal depth/color', png(header({ depth: 4, color: 6 }), idat, iend)],
    ['compression', png(header({ compression: 1 }), idat, iend)], ['filter', png(header({ filter: 1 }), idat, iend)],
    ['interlace', png(header({ interlace: 2 }), idat, iend)],
    ['palette missing', png(header({ color: 3 }), idat, iend)],
    ['palette late', png(header(), idat, chunk('PLTE', Buffer.from([0, 0, 0])), iend)],
    ['palette size', png(header(), chunk('PLTE', Buffer.from([0, 0])), idat, iend)],
    ['empty first IDAT split', png(header(), chunk('IDAT'), chunk('raNd'), idat, iend)],
    ['palette after empty IDAT', png(header(), chunk('IDAT'), chunk('PLTE', Buffer.from([0, 0, 0])), idat, iend)],
    ['invalid zlib envelope', png(header(), chunk('IDAT', Buffer.from([0, 0, 1, 2, 3, 4])), iend)],
    ['truncated zlib envelope', png(header(), chunk('IDAT', Buffer.from([0x78, 0x9c])), iend)],
  ])('rejects %s', (_label, imageDataUrl) => {
    expect(() => freezeSketchImageInput(input({ imageDataUrl }), vision(), model())).toThrow();
  });
  it('rejects broken CRC and chunk lengths before returning a frozen input', () => {
    const bytes = Buffer.from(originalPng.split(',')[1], 'base64'); bytes[29] ^= 1;
    expect(() => freezeSketchImageInput(input({ imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}` }), vision(), model())).toThrow();
    bytes.writeUInt32BE(0x7fffffff, 8);
    expect(() => freezeSketchImageInput(input({ imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}` }), vision(), model())).toThrow();
  });
  it('accepts a canonical PNG with ancillary chunks and preserves exact bytes', () => {
    const imageDataUrl = png(header(), chunk('tEXt', Buffer.from('Description\0sketch')), idat, iend);
    expect(freezeSketchImageInput(input({ imageDataUrl }), vision(), model()).imageDataUrl).toBe(imageDataUrl);
  });
  it('accepts contiguous empty and split IDAT chunks without decoding pixels', () => {
    const compressed = deflateSync(Buffer.from([0, 255, 255, 255, 255]));
    const imageDataUrl = png(header(), chunk('IDAT'), chunk('IDAT', compressed.subarray(0, 1)), chunk('IDAT', compressed.subarray(1)), iend);
    expect(freezeSketchImageInput(input({ imageDataUrl }), vision(), model()).imageDataUrl).toBe(imageDataUrl);
  });
  it('enforces decoded-byte and base64 encoding budgets at exactly 4 MiB', () => {
    const padding = 4 * 1024 * 1024 - Buffer.from(originalPng.split(',')[1], 'base64').length - 12;
    const atLimit = png(header(), chunk('raNd', Buffer.alloc(padding, 65)), idat, iend);
    const overLimit = png(header(), chunk('raNd', Buffer.alloc(padding + 1, 65)), idat, iend);
    expect(freezeSketchImageInput(input({ imageDataUrl: atLimit }), vision(), model()).imageDataUrl).toBe(atLimit);
    expect(() => freezeSketchImageInput(input({ imageDataUrl: overLimit }), vision(), model())).toThrow();
    expect(() => freezeSketchImageInput(input({ imageDataUrl: `data:image/png;base64,${'A'.repeat(Math.ceil(4 * 1024 * 1024 / 3) * 4 + 4)}` }), vision(), model())).toThrow();
  });
});

describe('strict analysis JSON and generation body', () => {
  it.each(['object', 'JSON'] as const)('parses and freezes a copied %s analysis with empty negative text allowed', form => {
    const raw = { ...analysis(), negativePrompt: '' };
    const parsed = parseSketchImageAnalysis(form === 'JSON' ? JSON.stringify(raw) : raw);
    expect(parsed).toEqual(raw); expect(parsed).not.toBe(raw); expect(Object.isFrozen(parsed)).toBe(true);
    raw.prompt = 'later'; expect(parsed.prompt).toBe('水彩质感的青绿色小屋，柔和光线');
  });
  it.each([null, [], new Array(4), new Date(), Object.create(analysis()) as unknown,
    { ...analysis(), extra: 'unknown' }, { ...analysis(), [Symbol('extra')]: true },
    '```json\n{}\n```', 'raw provider prose', 'null', '[]'])('rejects invalid analysis %j', value => {
    expect(() => parseSketchImageAnalysis(value)).toThrow();
  });
  it.each(['summary', 'composition', 'prompt', 'negativePrompt'] as const)('requires own string %s without executing accessors', field => {
    let reads = 0; const raw: Record<string, unknown> = { ...analysis() }; delete raw[field];
    expect(() => parseSketchImageAnalysis(raw)).toThrow();
    expect(() => parseSketchImageAnalysis({ ...analysis(), [field]: 5 })).toThrow();
    expect(() => parseSketchImageAnalysis(accessor(analysis(), field, () => { reads++; }))).toThrow();
    expect(reads).toBe(0);
  });
  it.each(['summary', 'composition', 'prompt'] as const)('rejects empty or whitespace %s', field => {
    expect(() => parseSketchImageAnalysis({ ...analysis(), [field]: ' \n\t' })).toThrow();
  });
  it('rejects unknown hidden fields without reading getters', () => {
    let reads = 0;
    expect(() => parseSketchImageAnalysis(accessor(analysis(), 'extra', () => { reads++; }))).toThrow();
    expect(() => parseSketchImageAnalysis(Object.defineProperty(analysis(), 'hidden', { value: 'unknown' }))).toThrow();
    expect(reads).toBe(0);
  });
  it('enforces a combined 64 KiB UTF-8 budget rather than a per-field character budget', () => {
    const raw = { summary: 'a', composition: 'b', prompt: '字'.repeat(21844) + 'cd', negativePrompt: '' };
    expect(parseSketchImageAnalysis(raw)).toEqual(raw); // 1 + 1 + 21844*3 + 2 = 65536
    expect(() => parseSketchImageAnalysis({ ...raw, negativePrompt: 'x' })).toThrow();
    expect(() => parseSketchImageAnalysis({ ...raw, prompt: '字'.repeat(21845) })).toThrow();
  });
  it('bounds serialized JSON to 256 KiB before parsing, including surrounding UTF-8 whitespace', () => {
    const json = JSON.stringify(analysis());
    const budget = 256 * 1024 - Buffer.byteLength(json, 'utf8');
    expect(parseSketchImageAnalysis(' '.repeat(budget) + json)).toEqual(analysis());
    expect(() => parseSketchImageAnalysis(' '.repeat(budget + 1) + json)).toThrow();
    expect(() => parseSketchImageAnalysis('\u3000'.repeat(Math.floor(budget / 3) + 1) + json)).toThrow();
  });
  it('builds one exact reference-image request with user keywords, composition, analysis prompt and explicit negative text', () => {
    const frozen = freezeSketchImageInput(input(), vision(), model());
    const parsed = parseSketchImageAnalysis(analysis());
    const body = buildSketchImageGenerationBody(frozen, parsed);
    expect(body).toMatchObject({ projectId: 'project-1', model: 'same-name', providerId: 'image-provider',
      referenceImages: [originalPng], imageUrl: originalPng, referenceDescriptions: ['本次草图：小屋和星星'],
      aspectRatio: '1:1', size: '1024x1024', quality: 'high', outputCount: 1, submitOnly: true,
      negativePrompt: '水印、模糊' });
    expect(body.prompt).toContain('保留青绿色小屋与星星'); expect(body.prompt).toContain('小屋居中，星星位于右上角');
    expect(body.prompt).toContain('水彩质感的青绿色小屋，柔和光线');
    expect(body).not.toHaveProperty('visionProviderId'); expect(body).not.toHaveProperty('apiKey');
  });
  it('builds empty-keyword requests without inventing optional parameters or negative text', () => {
    const raw = input({ instruction: '' }); delete raw.size; delete raw.quality;
    const body = buildSketchImageGenerationBody(freezeSketchImageInput(raw, vision(), model()), parseSketchImageAnalysis({ ...analysis(), negativePrompt: '' }));
    expect(body.prompt).toContain('小屋居中，星星位于右上角'); expect(body.prompt).toContain('水彩质感的青绿色小屋，柔和光线');
    expect(body.negativePrompt).toBe(''); expect(body).not.toHaveProperty('size'); expect(body).not.toHaveProperty('quality');
  });
});

describe('analysis C0/C1 control-character boundary (I1)', () => {
  const forbiddenCodes = [
    ...Array.from({ length: 32 }, (_, code) => code),
    ...Array.from({ length: 33 }, (_, index) => 0x7f + index),
  ].filter(code => ![0x09, 0x0a, 0x0d].includes(code));

  describe.each(['object', 'JSON'] as const)('%s analysis', form => {
    describe.each(['summary', 'composition', 'prompt', 'negativePrompt'] as const)('%s', field => {
      it.each(forbiddenCodes)('rejects control code %i before accepting analysis', code => {
        const raw = { ...analysis(), [field]: `before${String.fromCharCode(code)}after` };
        expect(() => parseSketchImageAnalysis(form === 'JSON' ? JSON.stringify(raw) : raw))
          .toThrow('SKETCH_IMAGE_ANALYSIS_INVALID');
      });
      it.each([['LF', 'before\nafter'], ['Tab', 'before\tafter'], ['CR', 'before\rafter']] as const)
        ('preserves %s byte for byte', (_label, text) => {
          const raw = { ...analysis(), [field]: text };
          expect(parseSketchImageAnalysis(form === 'JSON' ? JSON.stringify(raw) : raw)[field]).toBe(text);
        });
      it('rejects NUL before constructing a generation body', () => {
        const frozen = freezeSketchImageInput(input(), vision(), model());
        const raw = { ...analysis(), [field]: 'before\u0000after' };
        expect(() => buildSketchImageGenerationBody(frozen,
          form === 'JSON' ? parseSketchImageAnalysis(JSON.stringify(raw)) : raw))
          .toThrow('SKETCH_IMAGE_ANALYSIS_INVALID');
      });
    });
    it('preserves LF, Tab and CR from instruction and all analysis fields in the generation body', () => {
      const frozen = freezeSketchImageInput(input({ instruction: '关键词\n第二行\t列\r第三行' }), vision(), model());
      const raw = { summary: '摘要\n第二行\t列\r第三行', composition: '构图\n第二行\t列\r第三行',
        prompt: '提示词\n第二行\t列\r第三行', negativePrompt: '反向\n第二行\t列\r第三行' };
      const body = buildSketchImageGenerationBody(frozen, parseSketchImageAnalysis(form === 'JSON' ? JSON.stringify(raw) : raw));
      expect(body.prompt).toBe('用户原关键词：关键词\n第二行\t列\r第三行\n构图：构图\n第二行\t列\r第三行\n生成提示词：提示词\n第二行\t列\r第三行');
      expect(body.negativePrompt).toBe('反向\n第二行\t列\r第三行');
      expect(body.referenceDescriptions).toEqual(['摘要\n第二行\t列\r第三行']);
    });
  });
});
