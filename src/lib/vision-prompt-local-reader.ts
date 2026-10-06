import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAllowedPublicMediaPath } from '@/lib/media-validation';

const execFileAsync = promisify(execFile);
const MAX_LOCAL_IMAGE_BYTES = 20 * 1024 * 1024;

// Keep runtime filesystem discovery outside the Next server bundle.
const LOCAL_IMAGE_READER = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const [dataRoot, workspaceRoot, relativePath, maxBytesText] = process.argv.slice(1);
const maxBytes = Number(maxBytesText);
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function resolve(root, name) {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, name);
  if (!inside(resolvedRoot, candidate)) throw new Error('Unsafe local media path');
  return candidate;
}
function readCandidate(root, candidate) {
  try { fs.lstatSync(candidate); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const resolvedRoot = path.resolve(root);
  if (!inside(resolvedRoot, candidate)) throw new Error('Unsafe local media path');
  const rootReal = fs.realpathSync(resolvedRoot);
  let current = resolvedRoot;
  for (const part of path.relative(resolvedRoot, candidate).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stats = fs.lstatSync(current);
    if (stats.isSymbolicLink() || (stats.isFile() && stats.nlink > 1)) throw new Error('Unsafe local media path');
  }
  if (!inside(rootReal, fs.realpathSync(candidate))) throw new Error('Unsafe local media path');
  const before = fs.lstatSync(candidate, { bigint: true });
  const fd = fs.openSync(candidate, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stats = fs.fstatSync(fd, { bigint: true });
    if (!stats.isFile() || stats.nlink !== 1n || stats.dev !== before.dev || stats.ino !== before.ino
      || stats.size !== before.size || stats.size < 1n || stats.size > BigInt(maxBytes)) {
      throw new Error('Invalid local image file');
    }
    const bytes = Buffer.alloc(Number(stats.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error('Local image changed while reading');
      offset += count;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    if (after.size !== stats.size || after.mtimeNs !== stats.mtimeNs || after.ctimeNs !== stats.ctimeNs) {
      throw new Error('Local image changed while reading');
    }
    return bytes;
  } finally { fs.closeSync(fd); }
}
try {
  if (!relativePath || relativePath.includes('\\') || relativePath.includes('\0')
    || path.win32.isAbsolute(relativePath) || path.posix.isAbsolute(relativePath)
    || relativePath.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe local media path');
  }
  const publicRoot = path.join(workspaceRoot, 'public');
  const candidates = [
    { root: publicRoot, name: relativePath, guard: workspaceRoot, svg: true },
    { root: dataRoot, name: relativePath, guard: dataRoot, svg: false },
    { root: path.join(dataRoot, 'uploads'), name: relativePath, guard: dataRoot, svg: false },
    { root: path.join(publicRoot, 'uploads'), name: path.basename(relativePath), guard: workspaceRoot, svg: false },
  ];
  let result = null;
  for (const item of candidates) {
    const candidate = resolve(item.root, item.name);
    const bytes = readCandidate(item.guard, candidate);
    if (!bytes) continue;
    const ext = path.extname(candidate).toLowerCase();
    const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif'
      : item.svg && ext === '.svg' ? 'image/svg+xml'
      : 'image/png';
    result = { base64: bytes.toString('base64'), mimeType };
    break;
  }
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : 'Local image read failed');
  process.exitCode = 1;
}
`;

export async function readVisionPromptLocalImage(
  dataRoot: string,
  workspaceRoot: string,
  relativePath: string,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  if (!isAllowedPublicMediaPath(relativePath.split('/'))) {
    throw new Error('Unsafe local media path');
  }
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      '-e', LOCAL_IMAGE_READER, dataRoot, workspaceRoot, relativePath, String(MAX_LOCAL_IMAGE_BYTES),
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    const result = JSON.parse(stdout) as { base64: string; mimeType: string } | null;
    return result ? { bytes: Buffer.from(result.base64, 'base64'), mimeType: result.mimeType } : null;
  } catch (error) {
    if (error && typeof error === 'object' && 'stderr' in error
      && String(error.stderr).includes('Unsafe local media path')) {
      throw new Error('Unsafe local media path');
    }
    throw new Error('Local image read failed');
  }
}
