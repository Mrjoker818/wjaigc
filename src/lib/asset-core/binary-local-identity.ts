import { lstat, realpath, type FileHandle } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import path from 'node:path';

interface InodeIdentity { dev: string; ino: string; birthtimeNs: string }
export interface BinaryLocalIdentity { version: 1; directory: InodeIdentity; file: InodeIdentity }
export interface ExportDirectoryBinding { path: string; root: string; identity: InodeIdentity }

function changed(): never { throw new TypeError('ASSET_FILE_IDENTITY_CHANGED'); }

function inode(stats: BigIntStats): InodeIdentity {
  // Filesystems without a usable inode cannot establish ownership.
  if (stats.ino <= BigInt(0) || stats.birthtimeNs <= BigInt(0)) changed();
  return { dev: String(stats.dev), ino: String(stats.ino), birthtimeNs: String(stats.birthtimeNs) };
}

function same(left: InodeIdentity, right: InodeIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

export function isBinaryLocalIdentity(value: unknown): value is BinaryLocalIdentity {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<BinaryLocalIdentity>;
  const valid = (part: InodeIdentity | undefined): boolean => !!part
    && [part.dev, part.ino, part.birthtimeNs].every(item => typeof item === 'string' && /^\d{1,30}$/u.test(item))
    && BigInt(part.ino) > BigInt(0) && BigInt(part.birthtimeNs) > BigInt(0);
  return data.version === 1 && valid(data.directory) && valid(data.file);
}

export async function bindExportDirectory(directory: string): Promise<ExportDirectoryBinding> {
  const stats = await lstat(directory, { bigint: true });
  const root = await realpath(path.dirname(directory));
  const actual = await realpath(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || path.dirname(actual) !== root) changed();
  const binding = { path: directory, root, identity: inode(stats) };
  await assertExportDirectoryBinding(binding);
  return binding;
}

export async function assertExportDirectoryBinding(binding: ExportDirectoryBinding): Promise<void> {
  const stats = await lstat(binding.path, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink() || !same(inode(stats), binding.identity)
    || path.dirname(await realpath(binding.path)) !== binding.root
    || await realpath(path.dirname(binding.path)) !== binding.root) changed();
}

/** Capture from the exclusively-created descriptor, never from a pathname at enqueue time. */
export async function identityOfCreatedFile(handle: FileHandle, directory: ExportDirectoryBinding): Promise<BinaryLocalIdentity> {
  const stats = await handle.stat({ bigint: true });
  if (!stats.isFile() || stats.nlink !== BigInt(1)) changed();
  return { version: 1, directory: directory.identity, file: inode(stats) };
}

export async function assertExportFileIdentity(
  target: string, identity: BinaryLocalIdentity, handle?: FileHandle,
): Promise<void> {
  if (!isBinaryLocalIdentity(identity)) changed();
  const directory = await bindExportDirectory(path.dirname(target));
  if (!same(directory.identity, identity.directory)) changed();
  const stats = await lstat(target, { bigint: true });
  if (!stats.isFile() || stats.isSymbolicLink() || !same(inode(stats), identity.file)) changed();
  if (handle && !same(inode(await handle.stat({ bigint: true })), identity.file)) changed();
}

/** Absence is a non-delete success. Missing/mismatched ownership is retained, not adopted. */
export async function checkExportCleanupIdentity(target: string, identity?: BinaryLocalIdentity): Promise<boolean> {
  try { await lstat(target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  if (!identity) throw new TypeError('ASSET_CLEANUP_LOCAL_IDENTITY_REQUIRED');
  await assertExportFileIdentity(target, identity);
  return true;
}
