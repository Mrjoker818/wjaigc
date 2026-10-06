import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EventEmitter as EventEmitterType } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const fake = vi.hoisted(() => ({ reportedPath: '', requestedPath: '', outputBase64: '' }));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { EventEmitter } = await import('node:events');
  const { writeFileSync: writeFakeOutput } = await import('node:fs');
  return {
    ...actual,
    spawn: (_command: string, args: string[]) => {
      const proc = new EventEmitter() as EventEmitterType & {
        stdout: EventEmitterType;
        stderr: EventEmitterType;
        stdin: EventEmitterType & { write: (chunk: string) => void; end: () => void };
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      let input = '';
      proc.stdin = Object.assign(new EventEmitter(), {
        write: (chunk: string): void => { input += chunk; },
        end: (): void => {
          queueMicrotask(() => {
            const request = JSON.parse(input) as { outputFile: string };
            fake.requestedPath = request.outputFile;
            const reportedPath = fake.reportedPath === '@requested' ? request.outputFile : fake.reportedPath;
            if (fake.reportedPath === '@requested') {
              writeFakeOutput(request.outputFile, Buffer.from(fake.outputBase64, 'base64'));
            }
            proc.stdout.emit('data', Buffer.from(JSON.stringify({ success: true, outputFile: reportedPath })));
            proc.emit('close', 0);
          });
        },
      });
      if (args[0] === '-c') queueMicrotask(() => {
        proc.stdout.emit('data', Buffer.from('1.0.0\n'));
        proc.emit('close', 0);
      });
      return proc;
    },
  };
});

describe('ONNX output file ownership in the real upscale engine', () => {
  const previous = {
    onnxDir: process.env.ONNX_MODELS_DIR,
    projectEnv: process.env.COZE_PROJECT_ENV,
    dataRoot: process.env.SERVER_DATA_ROOT,
  };
  let root = '';
  let sourceUrl = '';

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'wujie-onnx-output-test-'));
    const models = path.join(root, 'models');
    mkdirSync(models);
    writeFileSync(path.join(models, 'realesrgan-x4plus.onnx'), 'fixture');
    process.env.ONNX_MODELS_DIR = models;
    process.env.COZE_PROJECT_ENV = 'PROD';
    process.env.SERVER_DATA_ROOT = path.join(root, 'data');
    const image = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#ff0000' } }).png().toBuffer();
    sourceUrl = `data:image/png;base64,${image.toString('base64')}`;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries({
      ONNX_MODELS_DIR: previous.onnxDir,
      COZE_PROJECT_ENV: previous.projectEnv,
      SERVER_DATA_ROOT: previous.dataRoot,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (root && path.dirname(realpathSync(root)) === realpathSync(tmpdir())) rmSync(root, { recursive: true, force: true });
  });

  it('rejects a Python-reported file other than the path selected by this request', async () => {
    const victim = path.join(root, 'unrelated.png');
    const victimBytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#00ff00' } }).png().toBuffer();
    writeFileSync(victim, victimBytes);
    fake.reportedPath = victim;
    fake.requestedPath = '';

    const { performOnnxUpscale } = await import('@/lib/image-tools/upscayl');
    const result = await performOnnxUpscale({ imageUrl: sourceUrl, scale: 4 });

    expect(fake.requestedPath, result.error).toBeTruthy();
    expect(fake.requestedPath).not.toBe(victim);
    expect(result.success).toBe(false);
    expect(readFileSync(victim)).toEqual(victimBytes);
  });

  it('keeps the normal exact-path file result available for download', async () => {
    const output = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#0000ff' } }).png().toBuffer();
    fake.reportedPath = '@requested';
    fake.outputBase64 = output.toString('base64');
    fake.requestedPath = '';

    const { performOnnxUpscale } = await import('@/lib/image-tools/upscayl');
    const result = await performOnnxUpscale({ imageUrl: sourceUrl, scale: 4 });

    expect(result.success, result.error).toBe(true);
    expect(fake.requestedPath).toBeTruthy();
    const filename = path.basename(result.imageUrl || '');
    expect(filename).toMatch(/^upscale-.+\.png$/);
    const saved = readFileSync(path.join(root, 'data', 'uploads', 'upscale', filename));
    expect((await sharp(saved).metadata()).format).toBe('png');
  });
});
