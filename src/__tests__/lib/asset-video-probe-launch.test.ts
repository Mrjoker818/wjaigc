import childProcess, { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { AssetVideoValidatorUnavailableError } from '@/lib/asset-core/binary-media-contract';
import { inspectNewBinaryMedia } from '@/lib/asset-core/binary-media-validation';

vi.mock('@/lib/safe-image-input', () => ({ readSafeBmpDimensions: vi.fn() }));

it('reports an OS failure to start ffprobe as validator unavailability for a valid MP4', async () => {
  const fixture = await readFile('tests/fixtures/yjs-task8b1-tiny-valid.mp4.base64', 'utf8');
  const child = new EventEmitter() as ChildProcess;
  const launchFailure = Object.assign(new Error('spawn ffprobe EAGAIN'), { code: 'EAGAIN' });
  const execFile = vi.spyOn(childProcess, 'execFile').mockImplementationOnce((_file, _args, _options, callback) => {
    queueMicrotask(() => {
      callback?.(launchFailure, '', '');
      child.emit('error', launchFailure);
      child.emit('close', -1, null);
    });
    return child;
  });

  try {
    await expect(inspectNewBinaryMedia(Buffer.from(fixture, 'base64'), 'video/mp4'))
      .rejects.toBeInstanceOf(AssetVideoValidatorUnavailableError);
    expect(execFile).toHaveBeenCalledTimes(1);
  } finally {
    execFile.mockRestore();
  }
});
