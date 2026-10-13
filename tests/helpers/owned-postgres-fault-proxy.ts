import { createRequire } from 'node:module';
import type { Server, Socket } from 'node:net';
import { resolve } from 'node:path';

interface OwnedProxyBootstrap {
  registerFaultProxy: (server: Server, upstream: string, creator: string) => () => void;
}

// Native CJS cache survives Vitest module resets; absent preload means no new permission.
const nativeRequire = createRequire(import.meta.url);
const bootstrapPath = 'J:/无界本地版/projects/_upstream-wjaigc-restore/.superpowers/sdd/2026-10-09-sketch-to-code/task6-pg-bootstrap-proxy-compat-20261010.cjs';

export function registerOwnedFaultProxy(server: Server, upstream: string, creator: string): () => void {
  const cached = nativeRequire.cache[resolve(bootstrapPath)];
  if (!cached) return (): void => {};
  const bootstrap = cached.exports as Partial<OwnedProxyBootstrap>;
  if (typeof bootstrap.registerFaultProxy !== 'function') throw new Error('OWNED_PROXY_BOOTSTRAP_API');
  return bootstrap.registerFaultProxy(server, upstream, creator);
}

interface ProxyCleanup {
  server: Server;
  sockets: Set<Socket>;
  revoke: () => void;
  closePool: () => Promise<void>;
  restoreEnvironment: () => void;
  beforePool?: () => void;
  primaryError?: unknown;
}

// Cleanup attempts are independent: an earlier failure must not leave new permissions alive.
export async function cleanupOwnedFaultProxy(options: ProxyCleanup): Promise<void> {
  const errors: unknown[] = Object.hasOwn(options, 'primaryError') ? [options.primaryError] : [];
  const steps: Array<() => void | Promise<void>> = [
    options.revoke, options.beforePool ?? ((): void => {}), options.closePool, options.restoreEnvironment,
    (): void => { options.sockets.forEach((socket: Socket): void => { socket.destroy(); }); },
    (): Promise<void> => new Promise<void>((resolveClose, reject) => {
      options.server.close((error?: Error): void => { if (error) reject(error); else resolveClose(); });
    }),
  ];
  for (const step of steps) { try { await step(); } catch (error) { errors.push(error); } }
  if (errors.length) {
    const details = errors.map((error: unknown): string => error instanceof Error ? error.message : String(error)).join('; ');
    throw new AggregateError(errors, 'PG fault proxy cleanup failed (listenerAlive=' + options.server.listening + '): ' + details);
  }
}
