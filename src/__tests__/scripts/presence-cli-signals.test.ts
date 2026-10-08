import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { requireOfflineBridgeTestDatabaseUrl } from '../../../tests/helpers/offline-bridge-database-guard';

type Signal = 'SIGTERM' | 'SIGINT';
type Mode = 'normal' | 'prepare-blocked' | 'prepare-blocked-fails' | 'close-blocked' | 'close-fails' | 'prepare-fails';
interface Message {
  type: string;
  signal?: Signal;
  id?: number;
  handled?: boolean;
  closeCount?: number;
  port?: number;
}
interface CliRun {
  child: ChildProcess;
  messages: Message[];
  output(): string;
  finished: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  port: number;
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((ready, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', ready);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback address');
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  return address.port;
}

async function startCli(mode: Mode): Promise<CliRun> {
  const database = requireOfflineBridgeTestDatabaseUrl(process.env);
  const port = await reservePort();
  const child = spawn(process.execPath, [
    '--conditions=react-server', '--import', 'tsx', '--import',
    pathToFileURL(resolve('tests/helpers/presence-cli-next-register.mjs')).href,
    resolve('scripts/presence-server.ts'),
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(port),
      WUJIE_PRESENCE_ENABLED: 'true', WUJIE_YJS_ENABLED: 'false', WUJIE_TEST_NEXT_MODE: mode,
      DATABASE_URL: database, PGDATABASE_URL: database,
      POSTGRES_TEST_DATABASE_URL: database, TEST_POSTGRES_URL: database,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  const messages: Message[] = [];
  let output = '';
  child.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
  child.stderr?.on('data', (data: Buffer) => { output += data.toString(); });
  child.on('message', (message: unknown) => {
    if (message && typeof message === 'object' && 'type' in message && typeof message.type === 'string') {
      messages.push(message as Message);
    }
  });
  const finished = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => done({ code, signal }));
  });
  return { child, messages, output: () => output, finished, port };
}

async function waitFor(run: CliRun, condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (run.child.exitCode !== null || run.child.signalCode !== null) {
      throw new Error(`CLI exited before ${label}: ${run.output()}`);
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}: ${run.output()}`);
    await new Promise<void>(done => setTimeout(done, 25));
  }
}

async function send(run: CliRun, message: Record<string, string | number>): Promise<void> {
  await new Promise<void>((done, reject) => run.child.send(message, error => error ? reject(error) : done()));
}

async function ready(run: CliRun): Promise<void> {
  await waitFor(run, () => run.messages.some(message => message.type === 'worker-ready'), 'Next worker');
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${run.port}/`, {
        headers: { Connection: 'close' }, signal: AbortSignal.timeout(500),
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('controlled-next-cli');
      return;
    } catch {
      if (run.child.exitCode !== null) throw new Error(`CLI startup failed: ${run.output()}`);
      await new Promise<void>(done => setTimeout(done, 25));
    }
  }
  throw new Error(`CLI HTTP startup timed out: ${run.output()}`);
}

async function dispatch(run: CliRun, signal: Signal, id = 1): Promise<void> {
  await send(run, { type: 'dispatch-signal', signal, id });
  await waitFor(run, () => run.messages.some(message => message.type === 'signal-dispatched' && message.id === id), 'signal dispatch');
}

async function exitResult(run: CliRun): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run.finished,
      new Promise<never>((_done, reject) => {
        timeout = setTimeout(() => reject(new Error(`CLI did not exit: ${run.output()}`)), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function dispose(run: CliRun): Promise<void> {
  if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGKILL');
  await run.finished;
}

function expectCleanup(run: CliRun): void {
  expect(run.messages.filter(message => message.type === 'cleanup-completed')).toEqual([
    { type: 'cleanup-completed', closeCount: 1 },
  ]);
  expect(run.output()).toContain(JSON.stringify({
    type: 'exit-observed', terminateListeners: 0, interruptListeners: 0,
  }));
}

// A missing CLI handler, early exit, dropped close(), or repeated cleanup must
// fail these actual-entry tests. Only Next is substituted; HTTP and child exit
// are real. Controlled process.emit is NOT OS/POSIX/Coze signal validation.
describe('production presence CLI controlled signal lifecycle', () => {
  it.each([
    ['SIGTERM', 143], ['SIGINT', 130],
  ] as const)('cleans resources before %s exit', async (signal, code) => {
    const run = await startCli('normal');
    try {
      await ready(run);
      await dispatch(run, signal);
      expect(await exitResult(run)).toEqual({ code, signal: null });
      expectCleanup(run);
      expect(run.output().trim()).toBe(JSON.stringify({
        type: 'exit-observed', terminateListeners: 0, interruptListeners: 0,
      }));
    } finally { await dispose(run); }
  }, 15_000);

  it.each([
    ['SIGTERM', 143], ['SIGINT', 130],
  ] as const)('owns startup pending when %s arrives before prepare completes', async (signal, code) => {
    const run = await startCli('prepare-blocked');
    try {
      await waitFor(run, () => run.messages.some(message => message.type === 'prepare-started'), 'blocked prepare');
      await dispatch(run, signal);
      expect(run.messages.some(message => message.type === 'cleanup-started')).toBe(false);
      await send(run, { type: 'release-prepare' });
      expect(await exitResult(run)).toEqual({ code, signal: null });
      expectCleanup(run);
    } finally { await dispose(run); }
  }, 15_000);

  it('waits for owned cleanup and ignores repeated signals without changing the first exit code', async () => {
    const run = await startCli('close-blocked');
    try {
      await ready(run);
      await dispatch(run, 'SIGTERM');
      await waitFor(run, () => run.messages.some(message => message.type === 'cleanup-started'), 'blocked cleanup');
      await dispatch(run, 'SIGTERM', 2);
      await dispatch(run, 'SIGINT', 3);
      for (const id of [2, 3]) {
        expect(run.messages.find(message => message.type === 'signal-dispatched' && message.id === id)?.handled).toBe(true);
      }
      expect(run.child.exitCode).toBeNull();
      expect(run.messages.filter(message => message.type === 'cleanup-started')).toHaveLength(1);
      const workerPort = run.messages.find(message => message.type === 'worker-ready')?.port;
      const worker = await fetch(`http://127.0.0.1:${workerPort}/`, {
        headers: { Connection: 'close' }, signal: AbortSignal.timeout(1_000),
      });
      expect(await worker.text()).toBe('owned-next-worker');
      await send(run, { type: 'release-close' });
      expect(await exitResult(run)).toEqual({ code: 143, signal: null });
      expectCleanup(run);
    } finally { await dispose(run); }
  }, 15_000);

  it('fails closed after cleanup rejects without logging private error detail', async () => {
    const run = await startCli('close-fails');
    try {
      await ready(run);
      await dispatch(run, 'SIGTERM');
      expect(await exitResult(run)).toEqual({ code: 1, signal: null });
      expectCleanup(run);
      expect(run.output()).toContain('PRESENCE_SERVER_SHUTDOWN_FAILED');
      expect(run.output()).not.toContain('PRIVATE_CONTROLLED');
      expect(run.output()).not.toContain('PRESENCE_SERVER_START_FAILED');
    } finally { await dispose(run); }
  }, 15_000);

  it('preserves startup failure cleanup and sanitized startup exit', async () => {
    const run = await startCli('prepare-fails');
    try {
      expect(await exitResult(run)).toEqual({ code: 1, signal: null });
      expectCleanup(run);
      expect(run.output()).toContain('PRESENCE_SERVER_START_FAILED');
      expect(run.output()).not.toContain('PRIVATE_CONTROLLED');
    } finally { await dispose(run); }
  }, 15_000);

  it('owns one sanitized shutdown failure when startup rejects after a signal', async () => {
    const run = await startCli('prepare-blocked-fails');
    try {
      await waitFor(run, () => run.messages.some(message => message.type === 'prepare-started'), 'blocked prepare');
      await dispatch(run, 'SIGTERM');
      await send(run, { type: 'release-prepare' });
      expect(await exitResult(run)).toEqual({ code: 1, signal: null });
      expectCleanup(run);
      expect(run.output().match(/PRESENCE_SERVER_SHUTDOWN_FAILED/g)).toHaveLength(1);
      expect(run.output()).not.toContain('PRESENCE_SERVER_START_FAILED');
      expect(run.output()).not.toContain('PRIVATE_CONTROLLED');
    } finally { await dispose(run); }
  }, 15_000);
});
