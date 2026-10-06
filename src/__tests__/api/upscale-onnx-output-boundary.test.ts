import { describe, expect, it } from 'vitest';
import { resolveOnnxReportedOutput } from '@/lib/image-tools/onnx-output-boundary';

describe('ONNX upscale output ownership', () => {
  const expected = '/tmp/upscale-onnx-request-123.png';

  it('accepts only the exact output file requested by the caller', () => {
    expect(resolveOnnxReportedOutput?.({ outputFile: expected }, expected)).toEqual({
      kind: 'file', path: expected,
    });
    expect(resolveOnnxReportedOutput?.({ outputFile: '/tmp/../etc/passwd' }, expected)).toBeNull();
    expect(resolveOnnxReportedOutput?.({ outputFile: '/tmp/upscale-onnx-other.png' }, expected)).toBeNull();
  });

  it('keeps base64 output for small images but never accepts a file path from that mode', () => {
    expect(resolveOnnxReportedOutput?.({ image: 'aGVsbG8=' }, null)).toEqual({
      kind: 'data', url: 'data:image/png;base64,aGVsbG8=',
    });
    expect(resolveOnnxReportedOutput?.({ outputFile: expected }, null)).toBeNull();
  });
});
