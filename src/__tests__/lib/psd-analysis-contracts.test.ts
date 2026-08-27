import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createPsdAnalysisRequestDigest,
  parsePsdAnalysisOutput,
  PSD_ANALYSIS_MAX_BODY_BYTES,
  PSD_ANALYSIS_MAX_RESPONSE_BYTES,
  readPsdAnalysisRequest,
} from '@/lib/psd-analysis/contracts';

const validAnalysis = {
  backgroundColor: [255, 255, 255],
  backgroundMode: 'white',
  layers: [
    { name: 'Background', role: 'bg', description: 'White background' },
    { name: 'Main Subject', role: 'subject', description: 'Primary subject' },
  ],
};

function requestWith(
  body: Record<string, unknown>,
  idempotencyKey = 'psd-analysis-request-1',
): Request {
  return new Request('http://localhost/api/analyze-psd', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

describe('PSD analysis request contract', () => {
  it('rejects a declared body larger than 28 MiB before reading JSON', async () => {
    const request = new Request('http://localhost/api/analyze-psd', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(PSD_ANALYSIS_MAX_BODY_BYTES + 1),
        'Idempotency-Key': 'psd-analysis-request-1',
      },
      body: '{}',
    });

    await expect(readPsdAnalysisRequest(request)).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_BODY_TOO_LARGE',
      status: 413,
    });
  });

  it('rejects a streamed body when actual bytes cross the limit', async () => {
    const first = new Uint8Array(PSD_ANALYSIS_MAX_BODY_BYTES);
    const request = new Request('http://localhost/api/analyze-psd', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'psd-analysis-request-1' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(first);
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    await expect(readPsdAnalysisRequest(request)).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_BODY_TOO_LARGE',
      status: 413,
    });
  });

  it('requires one valid Idempotency-Key header', async () => {
    await expect(readPsdAnalysisRequest(requestWith({ image: 'data:image/png;base64,AAAA' }, 'short')))
      .rejects.toMatchObject({ code: 'PSD_ANALYSIS_IDEMPOTENCY_INVALID', status: 400 });
  });

  it('cancels a stalled streaming body through the shared request signal', async () => {
    const controller = new AbortController();
    const request = new Request('http://localhost/api/analyze-psd', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'psd-analysis-request-1' },
      body: new ReadableStream<Uint8Array>({ start() {} }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    const pending = readPsdAnalysisRequest(request, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_CANCELLED',
      status: 499,
    });
  });

  it('accepts exactly one supported media source', async () => {
    await expect(readPsdAnalysisRequest(requestWith({
      image: 'data:image/png;base64,AAAA',
      projectId: 'project-1',
      sourceVersionId: 'version-1',
    }))).rejects.toMatchObject({ code: 'PSD_ANALYSIS_REQUEST_INVALID' });

    const assetRequest = await readPsdAnalysisRequest(requestWith({
      projectId: 'project-1',
      sourceVersionId: 'version-1',
      providerId: 'provider-1',
      model: 'gpt-4o',
    }));
    expect(assetRequest).toMatchObject({
      projectId: 'project-1',
      sourceVersionId: 'version-1',
      providerId: 'provider-1',
      model: 'gpt-4o',
      idempotencyKey: 'psd-analysis-request-1',
    });
  });

  it('requires providerId and model together and rejects unknown fields', async () => {
    await expect(readPsdAnalysisRequest(requestWith({
      image: 'data:image/png;base64,AAAA',
      providerId: 'provider-1',
    }))).rejects.toMatchObject({ code: 'PSD_ANALYSIS_MODEL_PAIR_INVALID' });

    await expect(readPsdAnalysisRequest(requestWith({
      image: 'data:image/png;base64,AAAA',
      debug: true,
    }))).rejects.toMatchObject({ code: 'PSD_ANALYSIS_REQUEST_INVALID' });
  });
});

describe('PSD analysis output contract', () => {
  it('accepts one fenced JSON object and normalizes no defaults', () => {
    const result = parsePsdAnalysisOutput(`\`\`\`json\n${JSON.stringify(validAnalysis)}\n\`\`\``);
    expect(result).toEqual(validAnalysis);
  });

  it('rejects malformed JSON instead of manufacturing default layers', () => {
    expect(() => parsePsdAnalysisOutput('not json')).toThrowError(
      expect.objectContaining({ code: 'PSD_ANALYSIS_OUTPUT_INVALID', status: 502 }),
    );
  });

  it.each([
    { ...validAnalysis, backgroundColor: [256, 0, 0] },
    { ...validAnalysis, backgroundMode: 'transparent' },
    { ...validAnalysis, layers: [{ name: 'Subject', role: 'subject', description: 'No background first' }] },
    { ...validAnalysis, layers: Array.from({ length: 9 }, (_, index) => ({ name: `Layer ${index}`, role: index === 0 ? 'bg' : 'deco', description: 'Layer' })) },
    { ...validAnalysis, layers: [{ name: 'x'.repeat(81), role: 'bg', description: 'Too long' }] },
    { ...validAnalysis, layers: [{ name: 'Background', role: 'bg', description: 'x'.repeat(301) }] },
  ])('rejects an output outside semantic budgets', value => {
    expect(() => parsePsdAnalysisOutput(JSON.stringify(value))).toThrowError(
      expect.objectContaining({ code: 'PSD_ANALYSIS_OUTPUT_INVALID' }),
    );
  });

  it('rejects upstream text larger than 256 KiB', () => {
    expect(() => parsePsdAnalysisOutput('x'.repeat(PSD_ANALYSIS_MAX_RESPONSE_BYTES + 1)))
      .toThrowError(expect.objectContaining({ code: 'PSD_ANALYSIS_OUTPUT_TOO_LARGE' }));
  });
});

describe('PSD analysis request digest', () => {
  it('is stable across object key order and binds the image hash and exact model pair', () => {
    const left = createPsdAnalysisRequestDigest({
      imageSha256: 'a'.repeat(64),
      providerId: 'provider-1',
      model: 'gpt-4o',
      sourceVersionId: 'version-1',
    });
    const right = createPsdAnalysisRequestDigest({
      model: 'gpt-4o',
      sourceVersionId: 'version-1',
      providerId: 'provider-1',
      imageSha256: 'a'.repeat(64),
    });
    const changed = createPsdAnalysisRequestDigest({
      imageSha256: 'b'.repeat(64),
      providerId: 'provider-1',
      model: 'gpt-4o',
      sourceVersionId: 'version-1',
    });

    expect(left).toBe(right);
    expect(left).not.toBe(changed);
    expect(left).toHaveLength(createHash('sha256').digest('hex').length);
  });
});
