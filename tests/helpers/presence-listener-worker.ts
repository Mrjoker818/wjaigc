import { closePool } from '../../src/lib/db-client';
import { readPresenceSnapshot, subscribePresence } from '../../src/lib/collaboration/presence-leases';

async function main(): Promise<void> {
  const projectId = process.argv[2];
  if (!projectId) throw new Error('Project ID is required');
  const unsubscribe = await subscribePresence(projectId, async () => {
    const snapshot = await readPresenceSnapshot(projectId);
    process.stdout.write(`${JSON.stringify({ type: 'snapshot', snapshot })}\n`);
  }, 30_000);
  process.stdout.write('READY\n');
  process.once('SIGTERM', () => {
    void (async () => {
      await unsubscribe();
      await closePool();
      process.exit(0);
    })();
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
