import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface ProbeMessage {
  type: 'written' | 'closed' | 'unlinked' | 'result';
  ok?: boolean;
  root?: string;
  code?: string;
  worker?: number;
  file?: string;
}

describe('private data root concurrent writable probes', () => {
  it('retains the configured root when two real workers overlap their probes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'wujie-data-root-probe-'));
    const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const state = new Int32Array(gate);
    const workers: Worker[] = [];
    let written = 0;
    const events: ProbeMessage[] = [];
    const modulePath = path.resolve('src/lib/server-data-root.ts');
    const helper = path.resolve('src/__tests__/fixtures/data-root-probe-worker.mjs');
    const loader = pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href;
    try {
      const results = await Promise.all([0, 1].map(index => new Promise<ProbeMessage>((resolve, reject) => {
        const worker = new Worker(helper, { workerData: { root: directory, gate, module: modulePath, index },
          execArgv: ['--import', loader], env: { WUJIE_DATA_DIR: directory, TSX_DISABLE_CACHE: '1', SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR } });
        workers.push(worker);
        worker.on('error', reject);
        worker.on('message', (message: ProbeMessage): void => {
          events.push(message);
          if (message.type === 'written') {
            written++;
            if (written === 2) { Atomics.store(state, 0, 1); Atomics.notify(state, 0); }
          } else if (message.type === 'result') resolve(message);
        });
        worker.on('exit', code => { if (code !== 0) reject(new Error(`Probe worker exit ${code}`)); });
      })));
      console.log('PROBE_EVENTS', JSON.stringify(events));
      expect(written, JSON.stringify(events)).toBe(2);
      expect(results, JSON.stringify(events)).toEqual([{ type: 'result', ok: true, root: directory }, { type: 'result', ok: true, root: directory }]);
      expect(events.filter(event => event.type === 'closed').map(event => event.ok)).toEqual([true, true]);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      Atomics.store(state, 0, 1);
      Atomics.notify(state, 0);
      Atomics.store(state, 1, 1);
      Atomics.notify(state, 1);
      await Promise.all(workers.map(worker => worker.terminate()));
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('wujie-data-root-probe-')) throw new Error('Unexpected cleanup target');
      await rm(resolved, { recursive: true, force: true });
    }
  }, 15_000);

  it('closes and removes its owned probe after a real partial write fails, before worker termination', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'wujie-data-root-probe-'));
    const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const state = new Int32Array(gate);
    Atomics.store(state, 0, 1);
    const worker = new Worker(path.resolve('src/__tests__/fixtures/data-root-probe-worker.mjs'), {
      workerData: { root: directory, gate, module: path.resolve('src/lib/server-data-root.ts'), index: 0, writeFailure: true },
      execArgv: [], env: { WUJIE_DATA_DIR: directory, TSX_DISABLE_CACHE: '1', SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR },
    });
    const events: ProbeMessage[] = [];
    try {
      const result = await new Promise<ProbeMessage>((resolve, reject): void => {
        worker.on('error', reject);
        worker.on('message', (message: ProbeMessage): void => {
          events.push(message);
          if (message.type === 'result') resolve(message);
        });
        worker.on('exit', (code: number): void => reject(new Error(`Probe worker exited before result: ${code}`)));
      });
      expect(result).toEqual({ type: 'result', ok: false, code: 'BLOCKED_NON_PRIVATE_DATA_ROOT' });
      expect(events.filter(event => event.type === 'written')).toHaveLength(1);
      expect(events.filter(event => event.type === 'closed').map(event => event.ok)).toEqual([true]);
      expect(events.filter(event => event.type === 'unlinked').map(event => event.ok)).toEqual([true]);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await worker.terminate();
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('wujie-data-root-probe-')) throw new Error('Unexpected cleanup target');
      await rm(resolved, { recursive: true, force: true });
    }
  }, 15_000);
});
