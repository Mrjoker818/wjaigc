import childProcess, { type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { validateNewBinaryMedia } from '@/lib/asset-core/binary-media-validation';
import { validateBinaryImage } from '@/lib/asset-core/binary-image-validation';

it.each(['png', 'jpeg', 'webp'] as const)('fully decodes real %s and rejects MIME mismatch, damaged contents and unknown MIME', async (format): Promise<void> => {
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } })[format]().toBuffer();
  await expect(validateBinaryImage(bytes, `image/${format}`)).resolves.toBeUndefined();
  await expect(validateBinaryImage(bytes, format === 'png' ? 'image/jpeg' : 'image/png')).rejects.toThrow();
  await expect(validateBinaryImage(bytes.subarray(0, Math.floor(bytes.length / 2)), `image/${format}`)).rejects.toThrow();
  await expect(validateBinaryImage(bytes, 'image/unknown')).rejects.toThrow();
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(['gif', 'avif'] as const)('validates %s in a real bounded child and resolves only after its close', async format => {
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#135791' } })[format]().toBuffer();
  const spawn = childProcess.spawn;
  const children: ChildProcess[] = [];
  const closed: ChildProcess[] = [];
  const inputs: string[] = [];
  vi.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
    const child = spawn(...args); children.push(child);
    const argv = args[1] as string[];
    inputs.push(argv.at(-2)!);
    child.once('close', () => closed.push(child));
    return child;
  });
  await validateNewBinaryMedia(bytes, `image/${format}`);
  expect(children).toHaveLength(1);
  expect(closed).toEqual(children);
  for (const child of children) expect(() => process.kill(child.pid!, 0)).toThrow();
  for (const input of inputs) expect(existsSync(input)).toBe(false);
});

it.each(['metadata', 'decode'] as const)('kills and reaps the actual native child on abort during %s', async phase => {
  const bytes = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: '#123456' } }).gif().toBuffer();
  const controller = new AbortController();
  const spawn = childProcess.spawn;
  let child: ChildProcess | undefined;
  let closed = false;
  let sawPhase = false;
  vi.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
    child = spawn(...args);
    child.once('close', () => { closed = true; });
    child.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes(phase)) { sawPhase = true; controller.abort(new Error('stop native decoder')); }
    });
    return child;
  });
  const result = await validateNewBinaryMedia(bytes, 'image/gif', controller.signal).then(() => 'resolved', error => error.message);
  expect(sawPhase).toBe(true);
  expect(result).toBe('stop native decoder');
  expect(closed).toBe(true);
  expect(() => process.kill(child!.pid!, 0)).toThrow();
});

it('enforces the internal deadline against a real decoder and waits for process close', async () => {
  const bytes = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: '#abcdef' } }).gif().toBuffer();
  const spawn = childProcess.spawn;
  let child: ChildProcess | undefined;
  let closed = false;
  let timed = false;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
    child = spawn(...args);
    child.once('close', () => { closed = true; });
    child.stdout!.on('data', () => { if (!timed) { timed = true; vi.advanceTimersByTime(15_000); } });
    return child;
  });
  await expect(validateNewBinaryMedia(bytes, 'image/gif')).rejects.toThrow('ASSET_IMAGE_DECODER_TIMEOUT');
  expect(timed).toBe(true);
  expect(closed).toBe(true);
  expect(() => process.kill(child!.pid!, 0)).toThrow();
});

it('retains decoder admission and input files until actual child close is delivered', async () => {
  const bytes = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#111111' } }).gif().toBuffer();
  const spawn = childProcess.spawn;
  const held: Array<() => void> = [];
  const inputs: string[] = [];
  let bothClosed!: () => void;
  const reached = new Promise<void>(resolve => { bothClosed = resolve; });
  vi.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
    const child = spawn(...args);
    inputs.push((args[1] as string[]).at(-2)!);
    const emit = child.emit.bind(child);
    child.emit = ((event: string | symbol, ...args: unknown[]): boolean => {
      if (event !== 'close') return emit(event, ...args);
      // Real process already exited; only delay delivery of its lifecycle boundary.
      expect(() => process.kill(child.pid!, 0)).toThrow();
      held.push(() => { emit(event, ...args); });
      if (held.length === 2) bothClosed();
      return true;
    }) as typeof child.emit;
    return child;
  });
  let settled = 0;
  const pending = [0, 1].map(() => validateNewBinaryMedia(bytes, 'image/gif').finally(() => { settled++; }));
  try {
    await reached;
    expect(settled).toBe(0);
    expect(inputs.every(input => existsSync(input))).toBe(true);
    await expect(validateNewBinaryMedia(bytes, 'image/gif')).rejects.toThrow('ASSET_MEDIA_BUSY');
  } finally { held.forEach(release => release()); await Promise.all(pending); }
  expect(settled).toBe(2);
  expect(inputs.every(input => !existsSync(input))).toBe(true);
});

it('releases the real failed-spawn lifecycle without leaking temporary input files', async () => {
  const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).gif().toBuffer();
  const spawn = childProcess.spawn;
  let input = '';
  let closed = false;
  const spy = vi.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
    input = (args[1] as string[]).at(-2)!;
    const child = spawn(`${process.execPath}.does-not-exist`, args[1] as string[], args[2]);
    child.once('close', () => { closed = true; });
    return child;
  });
  await expect(validateNewBinaryMedia(bytes, 'image/gif')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(closed).toBe(true);
  expect(existsSync(input)).toBe(false);
  spy.mockRestore();
  await expect(validateNewBinaryMedia(bytes, 'image/gif')).resolves.toBeUndefined();
});
