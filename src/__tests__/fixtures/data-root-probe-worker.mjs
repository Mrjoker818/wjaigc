import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { register } from 'tsx/cjs/api';

const root = path.resolve(workerData.root);
const gate = new Int32Array(workerData.gate);
const nativeMkdir = fs.mkdirSync.bind(fs);
const nativeWrite = fs.writeFileSync.bind(fs);
const nativeOpen = fs.openSync.bind(fs);
const nativeUnlink = fs.unlinkSync.bind(fs);
const nativeClose = fs.closeSync.bind(fs);
const probeFiles = new Map();
fs.mkdirSync = (directory, options) => {
  if (path.resolve(String(directory)) !== root) throw new Error('BLOCKED_NON_PRIVATE_DATA_ROOT');
  return nativeMkdir(directory, options);
};
fs.openSync = (file, flags, mode) => {
  if (flags !== 'wx') return nativeOpen(file, flags, mode);
  const resolved = path.resolve(String(file));
  if (path.dirname(resolved) !== root) throw new Error('BLOCKED_NON_PRIVATE_OPEN');
  const descriptor = nativeOpen(file, flags, mode);
  probeFiles.set(descriptor, resolved);
  return descriptor;
};
fs.closeSync = descriptor => {
  const result = nativeClose(descriptor);
  if (probeFiles.has(descriptor)) {
    let closed = false;
    try { fs.fstatSync(descriptor); }
    catch (error) { closed = error.code === 'EBADF'; }
    parentPort.postMessage({ type: 'closed', worker: workerData.index, ok: closed });
  }
  return result;
};
fs.writeFileSync = (file, ...args) => {
  const resolved = typeof file === 'number' ? probeFiles.get(file) : path.resolve(String(file));
  if (!resolved) throw new Error('UNOWNED_PROBE_DESCRIPTOR');
  if (path.dirname(resolved) !== root) throw new Error('BLOCKED_NON_PRIVATE_PROBE');
  const result = nativeWrite(file, ...args);
  if (path.basename(resolved).startsWith('.write_test')) {
    parentPort.postMessage({ type: 'written', worker: workerData.index, file: resolved });
    if (workerData.writeFailure) throw Object.assign(new Error('CONTROLLED_WRITE_FAILURE'), { code: 'EIO' });
    if (Atomics.wait(gate, 0, 0, 5_000) === 'timed-out') throw new Error('PROBE_BARRIER_TIMEOUT');
  }
  return result;
};
fs.unlinkSync = (file) => {
  const resolved = path.resolve(String(file));
  if (path.dirname(resolved) !== root) throw new Error('BLOCKED_NON_PRIVATE_UNLINK');
  if (workerData.index === 1 && Atomics.wait(gate, 1, 0, 5_000) === 'timed-out') throw new Error('UNLINK_BARRIER_TIMEOUT');
  try {
    const result = nativeUnlink(file);
    parentPort.postMessage({ type: 'unlinked', worker: workerData.index, file: resolved, ok: true });
    return result;
  } catch (error) {
    parentPort.postMessage({ type: 'unlinked', worker: workerData.index, file: resolved, ok: false, code: error.code });
    throw error;
  } finally {
    if (workerData.index === 0) { Atomics.store(gate, 1, 1); Atomics.notify(gate, 1); }
  }
};
const unregister = register();
try {
  const { getServerDataRoot } = createRequire(import.meta.url)(workerData.module);
  parentPort.postMessage({ type: 'result', ok: true, root: getServerDataRoot() });
} catch (error) {
  parentPort.postMessage({ type: 'result', ok: false, code: error.message });
} finally { unregister(); }
