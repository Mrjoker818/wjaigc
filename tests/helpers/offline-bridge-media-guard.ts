import { lstatSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

export function requireOfflineBridgeTestMediaRoot(candidate: string | undefined): string {
  const error = new Error('Dedicated offline bridge media root required');
  if (!candidate || !isAbsolute(candidate)) throw error;
  try {
    const root = resolve(candidate);
    if (!/^wujie-bridge-test-[a-z0-9-]+$/i.test(basename(root))) throw error;
    const entry = lstatSync(root);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw error;
    const canonical = realpathSync(root);
    const repository = realpathSync(process.cwd());
    const fromRepository = relative(repository, canonical);
    if (fromRepository === '' || (fromRepository !== '..' && !fromRepository.startsWith(`..${sep}`)
      && !isAbsolute(fromRepository))) throw error;
    return root;
  } catch {
    throw error;
  }
}
