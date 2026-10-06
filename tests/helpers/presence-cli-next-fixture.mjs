import { createServer } from 'node:http';
import { writeSync } from 'node:fs';

const mode = process.env.WUJIE_TEST_NEXT_MODE;
let releasePrepare;
let releaseClose;
const prepareGate = new Promise(resolve => { releasePrepare = resolve; });
const closeGate = new Promise(resolve => { releaseClose = resolve; });

process.on('exit', () => {
  // Synchronous observer only: no cleanup, signal handler, or exit decision.
  writeSync(1, JSON.stringify({ type: 'exit-observed',
    terminateListeners: process.listenerCount('SIGTERM'),
    interruptListeners: process.listenerCount('SIGINT'),
  })+'\n');
});

async function report(message) {
  await new Promise((resolve, reject) => {
    process.send(message, error => { if (error) reject(error); else resolve(); });
  });
}

// Windows kill() cannot deliver a graceful POSIX signal. Dispatch the event in
// this controlled process; this installs no shutdown handlers or exit behavior.
process.on('message', message => {
  if (message?.type === 'release-prepare') releasePrepare();
  if (message?.type === 'release-close') releaseClose();
  if (message?.type === 'dispatch-signal') {
    const handled = process.emit(message.signal);
    void report({ type: 'signal-dispatched', signal: message.signal, handled, id: message.id });
  }
});

export default function createNextFixture() {
  const worker = createServer((_request, response) => response.end('owned-next-worker'));
  let closeCount = 0;
  return {
    async prepare() {
      await report({ type: 'prepare-started' });
      if (mode === 'prepare-blocked' || mode === 'prepare-blocked-fails') await prepareGate;
      await new Promise((resolve, reject) => {
        worker.once('error', reject);
        worker.listen(0, '127.0.0.1', resolve);
      });
      await report({ type: 'worker-ready', port: worker.address().port });
      if (mode === 'prepare-fails' || mode === 'prepare-blocked-fails') throw new Error('PRIVATE_CONTROLLED_PREPARE_ERROR');
    },
    getRequestHandler() {
      return (_request, response) => response.end('controlled-next-cli');
    },
    getUpgradeHandler() {
      return (_request, socket) => socket.destroy();
    },
    async close() {
      closeCount++;
      await report({ type: 'cleanup-started', closeCount });
      if (mode === 'close-blocked') await closeGate;
      await new Promise((resolve, reject) => worker.close(error => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
        else resolve();
      }));
      await report({ type: 'cleanup-completed', closeCount });
      // The startup-failure control must not keep the old CLI alive solely for
      // the fixture's IPC channel after all owned resources have been closed.
      if (mode === 'prepare-fails') process.disconnect();
      if (mode === 'close-fails') throw new Error('PRIVATE_CONTROLLED_CLEANUP_ERROR');
    },
  };
}
