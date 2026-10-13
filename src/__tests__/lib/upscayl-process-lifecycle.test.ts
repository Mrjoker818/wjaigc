import childProcess, { type ChildProcess, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate as nextTurn, setTimeout as realDelay } from 'node:timers/promises';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, expect, it, vi, type TestContext } from 'vitest';

interface PhaseFacts { exitCode?: number | null; signal?: NodeJS.Signals | null; childCreated?: boolean }
const phaseTrace = vi.hoisted(() => ({ startedAt: BigInt(0), mode: '', events: [] as Array<{ event: string; ms: number } & PhaseFacts> }));
function recordPhase(event: string, facts: PhaseFacts = {}): void {
  if (phaseTrace.startedAt) phaseTrace.events.push({ event, ms: Number(process.hrtime.bigint() - phaseTrace.startedAt) / 1e6, ...facts });
}
vi.mock('@/lib/image-tools/image-input', async importOriginal => {
  recordPhase('image-input-import-start');
  const actual = await importOriginal<typeof import('@/lib/image-tools/image-input')>();
  recordPhase('image-input-import-end');
  return actual;
});

const fixture = vi.hoisted(() => ({ root: '', output: '' }));
// Forward the named import through the native default object so the observer
// controls the interpreter boundary while still spawning a real OS process.
vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process') & { default: typeof import('node:child_process') }>();
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>): ReturnType<typeof actual.spawn> => actual.default.spawn(...args) };
});
vi.mock('@/lib/image-tools/config', () => ({
  PYTHON_BIN: process.execPath,
  UPSCALE_DEFAULT_SCALE: 2,
  UPSCALE_TIMEOUT_MS: 300_000,
  UPSCALE_OUTPUT_DIR: `${fixture.root}/output`,
  UPSCALE_OUTPUT_URL_PREFIX: '/fixture-output',
  IMAGE_MAX_SIZE_MB: 20,
  IMAGE_MAX_EDGE: 2048,
  PUBLIC_DIR: `${fixture.root}/public`,
}));
// The actual interpreter/model health probe is outside this lifecycle contract.
vi.mock('@/lib/image-tools/onnx-health', () => ({
  isOnnxUpscaleAvailable: async () => { recordPhase('health-resolved'); return { available: true, model: 'fixture' }; },
  getOnnxModelsDir: () => `${fixture.root}/models`,
}));

let smallImage = '';
let largeImage = '';
let pipeImage = '';
beforeAll(async () => {
  fixture.root = mkdtempSync(path.join(tmpdir(), 'wujie-onnx-lifecycle-'));
  fixture.output = (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#abcdef' } }).png().toBuffer()).toString('base64');
  smallImage = `data:image/png;base64,${fixture.output}`;
  pipeImage = `data:image/png;base64,${(await sharp(randomBytes(256 * 256 * 3), { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer()).toString('base64')}`;
  largeImage = `data:image/png;base64,${(await sharp({ create: { width: 600, height: 600, channels: 3, background: '#123456' } }).png().toBuffer()).toString('base64')}`;
});
afterAll(() => {
  if (fixture.root && path.dirname(realpathSync(fixture.root)) === realpathSync(tmpdir())
    && path.basename(fixture.root).startsWith('wujie-onnx-lifecycle-')) rmSync(fixture.root, { recursive: true, force: true });
});
afterEach((context: TestContext): void => {
  process.stdout.write('TASK6_LIFECYCLE_PHASES:' + JSON.stringify({ caseName: context.task.name, mode: phaseTrace.mode, events: phaseTrace.events }) + '\n');
  phaseTrace.startedAt = BigInt(0); phaseTrace.events = [];
  vi.restoreAllMocks(); vi.useRealTimers();
});

function observeFixture<T>(pending: Promise<T>, label: string): Promise<T> {
  const watchdog = new AbortController();
  const observed = Promise.race([
    pending,
    realDelay(2000, undefined, { signal: watchdog.signal }).then(() => {
      throw new Error(`fixture observation timed out: ${label}`);
    }),
  ]).finally(() => watchdog.abort());
  // Some cases do not use every observation; still own their rejections.
  void observed.catch(() => undefined);
  return observed;
}

function controlInterpreter(mode: 'success' | 'hang' | 'spawn-error' | 'closed-input' | 'early-exit', holdClose = false): {
  ready: Promise<{ inputFile?: string }>;
  actualClose: Promise<void>;
  stdinError: Promise<Error>;
  child: () => ChildProcess;
  requestInput: () => string | undefined;
  release: () => void;
  cleanup: () => Promise<void>;
} {
  phaseTrace.startedAt = process.hrtime.bigint(); phaseTrace.mode = mode; phaseTrace.events = [];
  recordPhase('control-created');
  const spawn = childProcess.spawn;
  let child!: ChildProcess;
  let signalReady!: (request: { inputFile?: string }) => void;
  let rejectReady!: (error: Error) => void;
  let signalClosed!: () => void;
  let signalStdinError!: (error: Error) => void;
  let rejectStdinError!: (error: Error) => void;
  const ready = new Promise<{ inputFile?: string }>((resolve, reject) => { signalReady = resolve; rejectReady = reject; });
  const actualClose = new Promise<void>(resolve => { signalClosed = resolve; });
  const stdinError = new Promise<Error>((resolve, reject) => { signalStdinError = resolve; rejectStdinError = reject; });
  const readyObservation = observeFixture(ready, 'READY');
  const closeObservation = observeFixture(actualClose, 'close');
  const stdinObservation = observeFixture(stdinError, 'stdin error');
  let deliverClose: (() => void) | undefined;
  let requestInput: string | undefined;
  vi.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
    const options = args[2] as SpawnOptionsWithoutStdio;
    recordPhase('native-spawn-start');
    child = spawn(mode === 'spawn-error' ? `${process.execPath}.missing` : process.execPath,
      [path.resolve('tests/helpers/upscayl-lifecycle-worker.mjs'), mode, fixture.output],
      { ...options, env: { ...options.env, NODE_ENV: process.env.NODE_ENV, NODE_OPTIONS: '', NODE_PATH: '' } });
    recordPhase('native-spawn-return');
    child.once('spawn', () => recordPhase('native-spawn-event'));
    child.once('exit', (exitCode: number | null, signal: NodeJS.Signals | null) => recordPhase('native-exit-event', { exitCode, signal }));
    const emit = child.emit.bind(child);
    child.emit = ((event: string | symbol, ...values: unknown[]): boolean => {
      if (event !== 'close') return emit(event, ...values);
      recordPhase('native-close-event', { exitCode: child.exitCode, signal: child.signalCode });
      // Real OS process exited; delay only delivery of its lifecycle boundary.
      if (holdClose) deliverClose = () => { emit(event, ...values); };
      else emit(event, ...values);
      rejectReady(new Error('fixture closed before READY'));
      rejectStdinError(new Error('fixture closed without stdin error'));
      signalClosed();
      return true;
    }) as typeof child.emit;
    child.on('error', error => { rejectReady(error); rejectStdinError(error); });
    // Observe a real pipe failure without crashing Vitest when production has no owner.
    const stdin = child.stdin!;
    stdin.on('error', error => signalStdinError(error));
    let diagnostics = '';
    let queued: string | Uint8Array = '';
    const write = stdin.write.bind(stdin);
    const end = stdin.end.bind(stdin);
    stdin.write = ((chunk: string | Uint8Array): boolean => {
      recordPhase('stdin-write');
      requestInput = (JSON.parse(String(chunk)) as { inputFile?: string }).inputFile;
      return write(chunk);
    }) as typeof stdin.write;
    if (mode === 'closed-input') {
      // Send actual bytes only once the external interpreter closed FD0.
      stdin.write = ((chunk: string | Uint8Array): boolean => { queued = chunk; return true; }) as typeof stdin.write;
      stdin.end = (() => stdin) as typeof stdin.end;
    }
    child.stderr!.on('data', (chunk: Buffer) => {
      diagnostics += chunk.toString();
      const match = /ONNX_FIXTURE_READY:(.+)\n/.exec(diagnostics);
      if (match) signalReady(JSON.parse(match[1]) as { inputFile?: string });
      if (mode === 'closed-input' && diagnostics.includes('ONNX_FIXTURE_PIPE_CLOSED\n')) {
        write(queued); end(); signalReady({}); diagnostics = '';
      }
    });
    return child as ReturnType<typeof spawn>;
  });
  return {
    ready: readyObservation, actualClose: closeObservation, stdinError: stdinObservation,
    child: () => child, requestInput: () => requestInput,
    release: () => { deliverClose?.(); deliverClose = undefined; },
    cleanup: async (): Promise<void> => {
      recordPhase('cleanup-start', { childCreated: Boolean(child), exitCode: child?.exitCode ?? null, signal: child?.signalCode ?? null });
      if (child && child.exitCode === null && child.signalCode === null) {
        recordPhase('cleanup-kill-request', { exitCode: child.exitCode, signal: child.signalCode });
        child.kill('SIGKILL');
      }
      if (child) await actualClose;
      deliverClose?.(); deliverClose = undefined;
    },
  };
}

it('drains an interpreter that exits before READY without abandoning the lease or temporary input', async () => {
  const run = controlInterpreter('early-exit', true);
  const { performOnnxUpscale } = await import('@/lib/image-tools/upscayl');
  const { withLocalInferenceLock } = await import('@/lib/image-tools/concurrency-gate');
  recordPhase('perform-start');
  const pending = performOnnxUpscale({ imageUrl: largeImage, scale: 4 });
  recordPhase('500ms-observation-start');
  const watchdog = new AbortController();
  try {
    const observed = await Promise.race([
      run.ready.then(() => 'unexpected READY', error => String(error.message)),
      realDelay(500, 'OBSERVATION_STUCK', { signal: watchdog.signal }).catch(() => 'cancelled'),
    ]);
    recordPhase('500ms-observation-result:' + observed);
    expect(observed).toMatch(/fixture.*closed.*READY/i);
  } finally { watchdog.abort(); await run.cleanup(); await pending; }
  expect(run.requestInput()).toBeTruthy();
  expect(existsSync(run.requestInput()!)).toBe(false);
  await expect(withLocalInferenceLock(async () => 'lease recovered')).resolves.toBe('lease recovered');
});

it('retains the inference lease and actual input until the timed-out child close is delivered', async () => {
  const run = controlInterpreter('hang', true);
  const { performOnnxUpscale } = await import('@/lib/image-tools/upscayl');
  const { withLocalInferenceLock } = await import('@/lib/image-tools/concurrency-gate');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let settled = false;
  let nextStarted = false;
  const pending = performOnnxUpscale({ imageUrl: largeImage, scale: 4 }).finally(() => { settled = true; });
  let next: Promise<void> | undefined;
  try {
    const request = await run.ready;
    expect(request.inputFile).toBeTruthy();
    vi.advanceTimersByTime(300_000);
    await nextTurn(); await nextTurn();
    next = withLocalInferenceLock(async () => { nextStarted = true; });
    await nextTurn();
    expect.soft(settled).toBe(false);
    expect.soft(nextStarted).toBe(false);
    expect.soft(existsSync(request.inputFile!)).toBe(true);
    // Production must terminate it; the test kills only in its failure cleanup.
    const watchdog = new AbortController();
    try {
      const retired = await Promise.race([
        run.actualClose.then(() => true),
        realDelay(2000, false, { signal: watchdog.signal }).catch(() => false),
      ]);
      expect(retired).toBe(true);
    } finally { watchdog.abort(); }
    expect(() => process.kill(run.child().pid!, 0)).toThrow();
    expect.soft(settled).toBe(false);
    run.release();
    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/超时/);
    await next;
    expect(nextStarted).toBe(true);
    expect(existsSync(request.inputFile!)).toBe(false);
  } finally { await run.cleanup(); await pending; await next; }
});

it('returns a failed spawn only after real child close delivery', async () => {
  const run = controlInterpreter('spawn-error', true);
  const { performOnnxUpscale } = await import('@/lib/image-tools/upscayl');
  let settled = false;
  const pending = performOnnxUpscale({ imageUrl: smallImage, scale: 4 }).finally(() => { settled = true; });
  try {
    await run.actualClose;
    await nextTurn();
    expect.soft(settled).toBe(false);
    run.release();
    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ENOENT/);
  } finally { await run.cleanup(); await pending; }
});

it('preserves a real stdin failure even if the interpreter subsequently reports success', async () => {
  const run = controlInterpreter('closed-input');
  const { performOnnxUpscale } = await import('@/lib/image-tools/upscayl');
  const pending = performOnnxUpscale({ imageUrl: pipeImage, scale: 4 });
  try {
    const error = await run.stdinError;
    expect(error.message).toMatch(/EPIPE|EIO|write/i);
    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/EPIPE|EIO|write/i);
    await run.actualClose;
    expect(() => process.kill(run.child().pid!, 0)).toThrow();
  } finally { await run.cleanup(); await pending; }
});

it.each([['base64', () => smallImage], ['file', () => largeImage]] as const)('preserves a normal real %s interpreter result', async (_mode, source) => {
  const run = controlInterpreter('success');
  const { performOnnxUpscale } = await import('@/lib/image-tools/upscayl');
  const pending = performOnnxUpscale({ imageUrl: source(), scale: 4 });
  try {
    await run.actualClose;
    const result = await pending;
    expect(result.success, result.error).toBe(true);
    await run.actualClose;
    expect(() => process.kill(run.child().pid!, 0)).toThrow();
    const saved = readFileSync(path.join(fixture.root, 'output', path.basename(result.imageUrl!)));
    expect((await sharp(saved).metadata()).format).toBe('png');
  } finally { await run.cleanup(); await pending; }
});
