import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Runtime filesystem discovery stays outside the Next server bundle.
const LOCAL_IMAGE_READER = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const [dataRoot, publicRoot, imageUrl, production, maxBytesText, mode] = process.argv.slice(1);
const maxBytes = Number(maxBytesText);
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function safeRelative(value) {
  if (!value || value.includes('\\') || value.includes('\0')
    || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)
    || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe local media path');
  }
  return value;
}
function candidate(root, name, guard = root) {
  const resolvedRoot = path.resolve(root);
  const file = path.resolve(resolvedRoot, safeRelative(name));
  if (!inside(resolvedRoot, file)) throw new Error('Unsafe local media path');
  return { guard: path.resolve(guard), file };
}
function read(item) {
  let first;
  try { first = fs.lstatSync(item.file, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const rootReal = fs.realpathSync(item.guard);
  let current = item.guard;
  for (const part of path.relative(item.guard, item.file).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stats = fs.lstatSync(current, { bigint: true });
    if (stats.isSymbolicLink() || (stats.isFile() && stats.nlink > 1n)) {
      throw new Error('Unsafe local media path');
    }
  }
  if (!inside(rootReal, fs.realpathSync(item.file))) throw new Error('Unsafe local media path');
  const handle = fs.openSync(item.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stats = fs.fstatSync(handle, { bigint: true });
    if (!first.isFile() || !stats.isFile() || stats.nlink !== 1n
      || stats.dev !== first.dev || stats.ino !== first.ino
      || stats.size !== first.size || stats.size < 1n || stats.size > BigInt(maxBytes)) {
      throw new Error('Invalid local image file');
    }
    const bytes = Buffer.alloc(Number(stats.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(handle, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error('Local image changed while reading');
      offset += count;
    }
    const after = fs.fstatSync(handle, { bigint: true });
    if (after.size !== stats.size || after.mtimeNs !== stats.mtimeNs || after.ctimeNs !== stats.ctimeNs) {
      throw new Error('Local image changed while reading');
    }
    return bytes;
  } finally { fs.closeSync(handle); }
}
try {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid local image limit');
  let candidates;
  if (imageUrl.startsWith('/api/serve-upload/')) {
    const name = safeRelative(imageUrl.slice('/api/serve-upload/'.length));
    if (['users', 'system'].includes(name.split('/')[0].toLowerCase())) {
      throw new Error('Unsafe local media path');
    }
    candidates = mode === 'image-edit'
      ? [candidate(path.join(dataRoot, 'uploads'), name, dataRoot),
        candidate(path.join(dataRoot, 'uploads'), path.basename(name), dataRoot)]
      : [candidate(path.join(dataRoot, 'uploads'), name, dataRoot), candidate(dataRoot, name)];
    if (mode === 'refine') {
      candidates.push(candidate(publicRoot, name));
    } else if (mode === 'ordinary') {
      candidates.push(candidate(publicRoot, name));
      candidates.push(candidate(path.join(publicRoot, 'uploads'), name, publicRoot));
    } else if (mode === 'image-tools' && production !== 'true') {
      candidates.push(candidate(publicRoot, 'api/serve-upload/' + name));
      candidates.push(candidate(publicRoot, name));
    }
  } else if (mode === 'image-edit' && imageUrl.startsWith('/uploads/')) {
    const name = safeRelative(imageUrl.slice('/uploads/'.length));
    candidates = [candidate(path.join(dataRoot, 'uploads'), name, dataRoot),
      candidate(path.join(dataRoot, 'uploads'), path.basename(name), dataRoot)];
  } else if (mode === 'refine' && imageUrl.startsWith('/uploads/')) {
    const name = safeRelative(imageUrl.slice('/uploads/'.length));
    candidates = [candidate(path.join(publicRoot, 'uploads'), name, publicRoot),
      candidate(path.join(dataRoot, 'uploads'), name, dataRoot)];
  } else if (mode === 'ordinary' && imageUrl.startsWith('/uploads/')) {
    const name = safeRelative(imageUrl.slice('/uploads/'.length));
    candidates = [candidate(path.join(publicRoot, 'uploads'), name, publicRoot),
      candidate(path.join(dataRoot, 'uploads'), name, dataRoot)];
  } else if (imageUrl.startsWith('/outputs/')) {
    const name = safeRelative(imageUrl.slice('/outputs/'.length));
    candidates = [candidate(path.join(dataRoot, 'uploads'), name, dataRoot), candidate(path.join(publicRoot, 'outputs'), name, publicRoot)];
  } else if (mode === 'image-edit' && imageUrl.startsWith('/')) {
    const name = safeRelative(imageUrl.slice(1));
    candidates = [candidate(dataRoot, name), candidate(path.join(dataRoot, 'public'), name, dataRoot),
      candidate(publicRoot, name)];
  } else if (imageUrl.startsWith('/')) {
    candidates = [candidate(publicRoot, safeRelative(imageUrl.slice(1)))];
  } else if (path.isAbsolute(imageUrl)) {
    const absolute = path.resolve(imageUrl);
    // Never authorize the whole data root when admitting drive-qualified paths.
    // Keep the original data/public guard so linked media directories are checked.
    const locations = ['uploads', 'exports', 'thumbnails'].map(name => ({
      root: path.resolve(dataRoot, name), guard: path.resolve(dataRoot),
    }));
    locations.push({ root: path.resolve(publicRoot), guard: path.resolve(publicRoot) });
    const location = locations.find(item => inside(item.root, absolute));
    if (!location) throw new Error('Unsafe local media path');
    candidates = [{ guard: location.guard, file: absolute }];
  } else {
    throw new Error('Unsafe local media path');
  }
  let bytes = null;
  for (const item of candidates) {
    bytes = read(item);
    if (bytes) break;
  }
  process.stdout.write(JSON.stringify(bytes ? bytes.toString('base64') : null));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : 'Local image read failed');
  process.exitCode = 1;
}
`;

export async function readImageToolsLocalFile(
  dataRoot: string,
  publicRoot: string,
  imageUrl: string,
  maxBytes: number,
  mode: 'image-tools' | 'refine' | 'image-edit' | 'ordinary' = 'image-tools',
): Promise<Buffer | null> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      '-e', LOCAL_IMAGE_READER, dataRoot, publicRoot, imageUrl,
      String(process.env.COZE_PROJECT_ENV === 'PROD'), String(maxBytes), mode,
    ], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: Math.ceil(maxBytes * 4 / 3) + 1024 * 1024,
      windowsHide: true,
    });
    const base64 = JSON.parse(stdout) as string | null;
    return base64 ? Buffer.from(base64, 'base64') : null;
  } catch (error) {
    if (error && typeof error === 'object' && 'stderr' in error) {
      const message = String(error.stderr);
      if (message.includes('Unsafe local media path')) throw new Error('Unsafe local media path');
      if (message.includes('Invalid local image file')) throw new Error('Invalid local image file');
    }
    throw new Error('Local image read failed');
  }
}

/** Preserve raw path segments until validation; URL parsing would erase traversal. */
export function normalizeImageEditLocalReference(url: string, domainBase: string): string | null {
  const origin = domainBase.replace(/\/+$/, '');
  const raw = url.startsWith(`${origin}/api/serve-upload/`) || url.startsWith(`${origin}/uploads/`)
    ? url.slice(origin.length)
    : url.startsWith('/') ? url : null;
  if (raw === null) return null;
  let pathname: string;
  try { pathname = decodeURIComponent(raw.split(/[?#]/, 1)[0]); }
  catch { throw new Error('Unsafe local media path'); }
  if (!pathname.startsWith('/') || pathname.startsWith('//')
    || pathname.includes('\\') || pathname.includes('\0') || pathname.includes('%')
    || pathname.split('/').slice(1).some(part => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe local media path');
  }
  return pathname;
}
