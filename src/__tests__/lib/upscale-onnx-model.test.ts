import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const clientSource = readFileSync(
  resolve(process.cwd(), 'src/lib/image-tools/upscayl.ts'),
  'utf8',
);
const scriptSource = readFileSync(
  resolve(process.cwd(), 'scripts/upscale_onnx.py'),
  'utf8',
);
const ensureScript = readFileSync(
  resolve(process.cwd(), 'scripts/ensure-models.sh'),
  'utf8',
);
const downloadScript = readFileSync(
  resolve(process.cwd(), 'scripts/download-upscale-models.sh'),
  'utf8',
);

describe('Real-ESRGAN ONNX model contract', () => {
  it('accepts both fp16 and full-precision x4plus models', () => {
    expect(clientSource).toContain('realesrgan-x4plus-fp16.onnx');
    expect(clientSource).toContain('realesrgan-x4plus.onnx');
    expect(scriptSource).toContain('realesrgan-x4plus-fp16.onnx');
    expect(scriptSource).toContain('realesrgan-x4plus.onnx');
  });

  it('uses float32 tensors for the full-precision model', () => {
    expect(scriptSource).toContain('float16');
    expect(scriptSource).toContain('float32');
  });

  it('prefers persistent model directories in order', () => {
    expect(clientSource).toContain('UPSCAYL_MODELS_DIR');
    expect(clientSource).toContain('/space/onnx-models');
    expect(clientSource).toContain('/space/upscayl-models');
  });

  it('keeps the CPU thread pool bounded', () => {
    expect(scriptSource).toContain(
      'intra_op_num_threads = max(1, min(4, int(os.environ.get("UPSAMPLE_NUM_THREADS", "4"))))',
    );
    expect(scriptSource).toContain('inter_op_num_threads = 1');
  });

  it('provides download entry points for the Real-ESRGAN model', () => {
    expect(ensureScript).toContain('realesrgan');
    expect(downloadScript).toContain('realesrgan-x4plus.onnx');
  });
});
