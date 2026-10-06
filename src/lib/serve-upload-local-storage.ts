import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import type { FileHandle } from 'node:fs/promises';

export interface OpenExportFile {
  handle: FileHandle;
  size: number;
  identity: string;
  assertUnchanged(): Promise<void>;
}

/** Hold the checked descriptor across integrity validation and range reads. */
export async function openServeUploadExportLocal(dataRoot: string, filename: string, maxBytes: number): Promise<OpenExportFile | null> {
  const candidate = resolveLocalCandidate(path.resolve(dataRoot, 'exports'), filename);
  try { await assertExistingUnlinked(dataRoot, candidate); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const before = await fs.lstat(candidate, { bigint: true });
  const handle = await fs.open(candidate, fsSync.constants.O_RDONLY | (fsSync.constants.O_NOFOLLOW ?? 0));
  const identityOf = (stats: typeof before): string => [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs, stats.nlink].join(':');
  const identity = identityOf(before);
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile() || stats.nlink !== BigInt(1) || stats.size < BigInt(1) || stats.size > BigInt(maxBytes)
      || identityOf(stats) !== identity) throw new Error('Invalid export file');
    const assertUnchanged = async (): Promise<void> => {
      await assertExistingUnlinked(dataRoot, candidate);
      if (identityOf(await handle.stat({ bigint: true })) !== identity || identityOf(await fs.lstat(candidate, { bigint: true })) !== identity) {
        throw new Error('Export identity changed');
      }
    };
    await assertUnchanged();
    return { handle, size: Number(stats.size), identity, assertUnchanged };
  } catch (error) { await handle.close(); throw error; }
}

function assertInside(root: string, candidate: string, allowRoot = false): void {
  const relative = path.relative(root, candidate);
  if ((!relative && !allowRoot) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Unsafe local media path');
  }
}

function resolveLocalCandidate(root: string, relativePath: string): string {
  if (!relativePath || relativePath.includes('\\') || relativePath.includes('\0')
    || path.win32.isAbsolute(relativePath) || path.posix.isAbsolute(relativePath)
    || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe local media path');
  }
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, relativePath);
  assertInside(resolvedRoot, candidate);
  return candidate;
}

async function assertExistingUnlinked(root: string, candidate: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  assertInside(resolvedRoot, candidate);
  const rootReal = await fs.realpath(resolvedRoot);
  const parts = path.relative(resolvedRoot, candidate).split(path.sep).filter(Boolean);
  let current = resolvedRoot;
  for (const part of parts) {
    current = path.join(current, part);
    const stats = await fs.lstat(current);
    if (stats.isSymbolicLink() || (stats.isFile() && stats.nlink > 1)) {
      throw new Error('Unsafe local media path');
    }
  }
  assertInside(rootReal, await fs.realpath(candidate));
}

export async function readServeUploadExportLocal(
  dataRoot: string,
  filename: string,
  maxBytes: number,
): Promise<Buffer | null> {
  const exportsRoot = path.resolve(dataRoot, 'exports');
  const candidate = resolveLocalCandidate(exportsRoot, filename);
  if (!fsSync.existsSync(candidate)) return null;
  await assertExistingUnlinked(dataRoot, candidate);
  const stats = await fs.stat(candidate);
  if (!stats.isFile() || stats.size < 1 || stats.size > maxBytes) throw new Error('Invalid export file');
  return fs.readFile(candidate);
}

export async function readServeUploadMediaLocal(
  dataRoot: string,
  workspaceRoot: string,
  relativePath: string,
): Promise<Buffer | null> {
  for (const root of [path.join(dataRoot, 'uploads'), dataRoot]) {
    const candidate = resolveLocalCandidate(root, relativePath);
    if (fsSync.existsSync(candidate)) {
      await assertExistingUnlinked(dataRoot, candidate);
      return fs.readFile(candidate);
    }
  }

  const legacyRoot = path.join(workspaceRoot, 'public', 'uploads');
  const legacyName = path.basename(relativePath);
  for (const name of new Set([relativePath, legacyName])) {
    const legacyCandidate = resolveLocalCandidate(legacyRoot, name);
    if (!fsSync.existsSync(legacyCandidate)) continue;

    await assertExistingUnlinked(workspaceRoot, legacyCandidate);
    const bytes = await fs.readFile(legacyCandidate);
    try {
      cacheServeUploadMediaLocal(dataRoot, `uploads/${legacyName}`, bytes);
    } catch {
      // A readable legacy file remains available when optional caching fails.
    }
    return bytes;
  }
  return null;
}

export function cacheServeUploadMediaLocal(dataRoot: string, relativePath: string, bytes: Buffer): void {
  const root = fsSync.realpathSync(dataRoot);
  const target = resolveLocalCandidate(root, relativePath);
  const parentParts = path.relative(root, path.dirname(target)).split(path.sep).filter(Boolean);

  let current = root;
  for (const part of parentParts) {
    current = path.join(current, part);
    const stats = fsSync.lstatSync(current, { throwIfNoEntry: false });
    if (stats?.isSymbolicLink() || (stats && !stats.isDirectory())) {
      throw new Error('Unsafe local media path');
    }
    if (!stats) fsSync.mkdirSync(current);
  }

  const targetStats = fsSync.lstatSync(target, { throwIfNoEntry: false });
  if (targetStats?.isSymbolicLink() || (targetStats?.isFile() && targetStats.nlink > 1)) {
    throw new Error('Unsafe local media path');
  }
  fsSync.writeFileSync(target, bytes);
}
