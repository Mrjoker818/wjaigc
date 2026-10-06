import childProcess, { type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, realpath, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { setTimeout as realDelay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, it, vi } from 'vitest';
import type { AssetVersion } from '@/lib/asset-core/types';
import { createAssetStorageTransaction } from '@/lib/asset-core/storage';
import { getManagedAssetMediaDescriptor, readManagedAssetVersionBytes,
  type ManagedMediaReadDependencies } from '@/lib/asset-core/managed-media-read';

const roots: string[] = [];
afterEach(async (): Promise<void> => {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('wujie-legacy-managed-')) {
      throw new Error('Unsafe fixture cleanup target');
    }
    await rm(root, { recursive: true, force: true });
  }
});

function checksum(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function version(bytes: Buffer): AssetVersion {
  return { id: 'legacy-version', assetId: 'asset', ownerId: 'owner', projectId: 'project',
    parentVersionIds: [], createdAt: '2026-10-05T00:00:00Z',
    file: { url: '/api/serve-upload/original.bin', availability: 'ready', byteSize: bytes.length,
      width: 3, height: 2, checksum: checksum(bytes) } };
}
async function local(bytes: Buffer): Promise<{ dataRoot: string; file: string; asset: AssetVersion }> {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'wujie-legacy-managed-'));
  roots.push(dataRoot);
  const file = path.join(dataRoot, 'original.bin');
  await writeFile(file, bytes, { flag: 'wx' });
  return { dataRoot, file, asset: version(bytes) };
}
async function png(): Promise<Buffer> {
  return sharp({ create: { width: 3, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
}
function bmp(): Buffer {
  // Two full 12-byte padded rows, not a metadata-only BMP header.
  const bytes = Buffer.alloc(78, 0);
  bytes.write('BM'); bytes.writeUInt32LE(78, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(3, 18); bytes.writeInt32LE(2, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(24, 34);
  bytes.fill(0x36, 54); return bytes;
}

// The same precisely stalled native boundary is injected into the old parent I/O
// and the new real child. This catches non-cancellable I/O, not just child existence.
it.each((['realpathSync', 'openSync', 'fstatSync', 'statSync', 'readSync', 'closeSync'] as const)
  .flatMap(phase => ['abort', 'deadline'].map(mode => ({ phase, mode }))))(
  'cancels stalled local $phase I/O on $mode and reaps its process before returning', async ({ phase, mode }): Promise<void> => {
    const fixture = await local(await png()); const before = structuredClone(fixture.asset);
    const controller = new AbortController();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let reached!: () => void; const entered = new Promise<void>(resolve => { reached = resolve; });
    let sawPhase = false; let closed = false; let child: ChildProcess | undefined;
    const originals: Array<() => Promise<void>> = [];
    const stalled = async (): Promise<void> => { sawPhase = true; reached(); await gate; };
    const dependencies: ManagedMediaReadDependencies = {
      realpathLocal: (async (value: string): Promise<string> => {
        if (phase === 'realpathSync') await stalled(); return realpath(value);
      }) as typeof realpath,
      statLocal: async (value): Promise<import('node:fs').BigIntStats> => {
        if (phase === 'statSync') await stalled(); return stat(value, { bigint: true });
      },
      openLocal: (async (...args: Parameters<typeof open>): ReturnType<typeof open> => {
        if (phase === 'openSync') await stalled();
        const file = await open(...args);
        const originalClose = file.close.bind(file); originals.push(originalClose);
        if (phase === 'fstatSync') {
          const actual = file.stat.bind(file);
          file.stat = (async (...values: Parameters<typeof actual>): ReturnType<typeof actual> => {
            await stalled(); return actual(...values);
          }) as typeof file.stat;
        }
        if (phase === 'readSync') {
          const actual = file.read.bind(file);
          file.read = (async (...values: Parameters<typeof actual>): ReturnType<typeof actual> => {
            await stalled(); return actual(...values);
          }) as typeof file.read;
        }
        if (phase === 'closeSync') file.close = async (): Promise<void> => { await stalled(); await originalClose(); };
        return file;
      }) as typeof open,
    };
    const spawn = childProcess.spawn;
    vi.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
      const argv = [...args[1] as string[]];
      if (!argv[2]?.includes('MANAGED_LOCAL_READ')) return spawn(...args);
      // Instrument only the selected native operation; production guards stay real.
      argv[2] = `const testFs=require('node:fs'); testFs[${JSON.stringify(phase)}]=()=>{testFs.writeSync(2,'stalled\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};\n${argv[2]}`;
      child = spawn(args[0], argv, args[2]);
      child.once('close', (): void => { closed = true; });
      child.stderr!.on('data', (chunk: Buffer): void => {
        if (chunk.toString().includes('stalled')) { sawPhase = true; reached(); }
      });
      return child;
    });
    if (mode === 'deadline') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = readManagedAssetVersionBytes(fixture.asset, 'image', { ...fixture, signal: controller.signal }, dependencies)
      .then(() => 'success', (error: { code: string }) => error.code);
    try {
      await entered;
      if (mode === 'abort') controller.abort(new Error('stop stalled local I/O'));
      else vi.advanceTimersByTime(30_000);
      const result = await Promise.race([pending, realDelay(1000).then(() => 'still-pending')]);
      expect(result).toBe('CANVAS_SHARE_MEDIA_UNAVAILABLE');
      expect(sawPhase).toBe(true); expect(closed).toBe(true);
      expect(() => process.kill(child!.pid!, 0)).toThrow();
    } finally {
      release(); await pending; for (const close of originals) await close().catch(() => undefined);
    }
    expect(fixture.asset).toEqual(before);
    expect(await readFile(fixture.file)).toEqual(await png());
  });

it('rejects an actual junction that resolves outside the managed root', async (): Promise<void> => {
  const bytes = await png(); const fixture = await local(bytes); const outside = await local(bytes);
  await symlink(outside.dataRoot, path.join(fixture.dataRoot, 'escape'), 'junction');
  fixture.asset.file.url = '/api/serve-upload/escape/original.bin';
  await expect(readManagedAssetVersionBytes(fixture.asset, 'image', fixture))
    .rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE' });
  expect(await readFile(outside.file)).toEqual(bytes);
});

it('preserves actual Chinese root and filename identity when metadata UTF8 characters split across pipe chunks', async (): Promise<void> => {
  const bytes = await png(); const fixture = await local(bytes);
  const dataRoot = path.join(fixture.dataRoot, '中文目录'); await mkdir(dataRoot);
  const filename = path.join(dataRoot, 'original.bin'); await writeFile(filename, bytes, { flag: 'wx' });
  const spawn = childProcess.spawn;
  vi.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
    const child = spawn(...args);
    if (!(args[1] as string[])[2]?.includes('MANAGED_LOCAL_READ')) return child;
    const emit = child.stderr!.emit.bind(child.stderr!);
    child.stderr!.emit = ((event: string | symbol, ...values: unknown[]): boolean => {
      if (event !== 'data' || !Buffer.isBuffer(values[0])) return emit(event, ...values);
      const chunk = values[0];
      for (let offset = 0; offset < chunk.length; offset++) emit('data', chunk.subarray(offset, offset + 1));
      return true;
    }) as typeof emit;
    return child;
  });
  const descriptor = await getManagedAssetMediaDescriptor(fixture.asset, 'image', { dataRoot });
  if (descriptor.source.kind !== 'local') throw new Error('Expected actual local source');
  // Windows sync/async realpath may choose 8.3 vs expanded spellings. Compare
  // actual filesystem identity and a literal Unicode basename, not that spelling.
  expect(path.basename(descriptor.source.dataRoot)).toBe('中文目录');
  expect(await realpath(descriptor.source.absolutePath)).toBe(await realpath(filename));
  expect((await readManagedAssetVersionBytes(fixture.asset, 'image', { dataRoot })).bytes).toEqual(bytes);
  expect(await readFile(filename)).toEqual(bytes);
});

it.each(['identity', 'short-read', 'extra-output', 'failed-spawn'])(
  'rejects local worker %s and releases admission only after close', async (fault): Promise<void> => {
    const bytes = await png(); const fixture = await local(bytes); const spawn = childProcess.spawn;
    let child: ChildProcess | undefined; let closed = false;
    const spy = vi.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
      const argv = [...args[1] as string[]];
      if (!argv[2]?.includes('MANAGED_LOCAL_READ')) return spawn(...args);
      if (fault === 'identity') argv[2] = `const f=require('node:fs'); const original=f.fstatSync; f.fstatSync=(...args)=>{const s=original(...args); s.ino+=1n; return s;};\n${argv[2]}`;
      if (fault === 'short-read') argv[2] = `require('node:fs').readSync=()=>0;\n${argv[2]}`;
      if (fault === 'extra-output') argv[2] = `process.stdout.write(Buffer.alloc(${bytes.length + 1}));\n${argv[2]}`;
      child = spawn(fault === 'failed-spawn' ? `${process.execPath}.does-not-exist` : args[0], argv, args[2]);
      child.once('close', (): void => { closed = true; }); return child;
    });
    await expect(readManagedAssetVersionBytes(fixture.asset, 'image', fixture))
      .rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE' });
    expect(closed).toBe(true);
    if (child!.pid) expect(() => process.kill(child!.pid!, 0)).toThrow();
    spy.mockRestore();
    expect((await readManagedAssetVersionBytes(fixture.asset, 'image', fixture)).bytes).toEqual(bytes);
  });

it('holds both local read leases until actual close delivery and refuses a third full input', async (): Promise<void> => {
  const bytes = await png(); const fixture = await local(bytes); const spawn = childProcess.spawn;
  const releases: Array<() => void> = []; const children: ChildProcess[] = [];
  let reached!: () => void; const entered = new Promise<void>(resolve => { reached = resolve; });
  const spy = vi.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
    const child = spawn(...args);
    if (!(args[1] as string[])[2]?.includes('MANAGED_LOCAL_READ')) return child;
    children.push(child); const emit = child.emit.bind(child);
    child.emit = ((event: string | symbol, ...values: unknown[]): boolean => {
      if (event !== 'close') return emit(event, ...values);
      expect(() => process.kill(child.pid!, 0)).toThrow();
      releases.push((): void => { emit(event, ...values); });
      if (releases.length === 2) reached(); return true;
    }) as typeof child.emit;
    return child;
  });
  let settled = 0;
  const pending = [0, 1].map(() => readManagedAssetVersionBytes(fixture.asset, 'image', fixture)
    .finally((): void => { settled++; }));
  try {
    await entered; expect(settled).toBe(0);
    await expect(readManagedAssetVersionBytes(fixture.asset, 'image', fixture))
      .rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE' });
    expect(children).toHaveLength(2);
  } finally { releases.forEach(release => release()); await Promise.all(pending); }
  spy.mockRestore(); expect(settled).toBe(2);
  expect((await readManagedAssetVersionBytes(fixture.asset, 'image', fixture)).bytes).toEqual(bytes);
});

it.each(['png', 'jpeg', 'webp', 'gif', 'avif', 'bmp'] as const)(
  'derives and serves real %s bytes with missing MIME without changing the registered version or file',
  async (format): Promise<void> => {
    const bytes = format === 'bmp' ? bmp()
      : await sharp({ create: { width: 3, height: 2, channels: 3, background: '#123456' } })[format]().toBuffer();
    const fixture = await local(bytes); const before = structuredClone(fixture.asset);
    expect(await getManagedAssetMediaDescriptor(fixture.asset, 'image', fixture)).toMatchObject({
      assetVersionId: 'legacy-version', assetKind: 'image', mimeType: `image/${format}`,
      width: 3, height: 2, byteSize: bytes.length, checksum: checksum(bytes), source: { kind: 'local' },
    });
    const result = await readManagedAssetVersionBytes(fixture.asset, 'image', fixture);
    expect(result.bytes).toEqual(bytes); expect(result.mimeType).toBe(`image/${format}`);
    expect(result.totalBytes).toBe(bytes.length); expect(fixture.asset).toEqual(before);
    expect(await readFile(fixture.file)).toEqual(bytes);
  });

it('derives missing checksum and dimensions without inventing or persisting original metadata', async (): Promise<void> => {
  const bytes = await png(); const fixture = await local(bytes);
  delete fixture.asset.file.checksum; delete fixture.asset.file.width; delete fixture.asset.file.height;
  const before = structuredClone(fixture.asset);
  expect(await getManagedAssetMediaDescriptor(fixture.asset, 'image', fixture)).toMatchObject({
    checksum: checksum(bytes), width: 3, height: 2, mimeType: 'image/png',
  });
  expect(fixture.asset).toEqual(before);
});

it('accepts a matching SHA256-prefixed registered checksum', async (): Promise<void> => {
  const bytes = await png(); const fixture = await local(bytes);
  fixture.asset.file.checksum = `sha256:${checksum(bytes)}`;
  expect((await readManagedAssetVersionBytes(fixture.asset, 'image', fixture)).bytes).toEqual(bytes);
});

it.each([
  { name: 'checksum mismatch', patch: { checksum: '0'.repeat(64) } },
  { name: 'invalid checksum', patch: { checksum: 'sha256:not-a-hash' } },
  { name: 'width mismatch', patch: { width: 4 } },
  { name: 'height mismatch', patch: { height: 3 } },
  { name: 'empty MIME is not missing MIME', patch: { mimeType: '' } },
  { name: 'explicit nonimage MIME', patch: { mimeType: 'video/mp4' } },
  { name: 'unknown image MIME', patch: { mimeType: 'image/unknown' } },
  { name: 'missing size', patch: { byteSize: undefined } },
  { name: 'size mismatch', patch: { byteSize: 1 } },
  { name: 'oversize', patch: { byteSize: 32 * 1024 * 1024 + 1 } },
  { name: 'not ready', patch: { availability: 'missing' as const } },
])('rejects $name instead of guessing legacy metadata', async ({ patch }): Promise<void> => {
  const fixture = await local(await png()); Object.assign(fixture.asset.file, patch);
  await expect(getManagedAssetMediaDescriptor(fixture.asset, 'image', fixture))
    .rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_NOT_READY' });
  await expect(readManagedAssetVersionBytes(fixture.asset, 'image', fixture))
    .rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE' });
});

it.each(['nonimage', 'truncated-png', 'truncated-bmp'])(
  'rejects %s actual contents even when registered size and checksum match', async (name): Promise<void> => {
    const bytes = name === 'nonimage' ? Buffer.from('not an image')
      : name === 'truncated-bmp' ? bmp().subarray(0, 70) : (await png()).subarray(0, 55);
    const fixture = await local(bytes);
    await expect(readManagedAssetVersionBytes(fixture.asset, 'image', fixture))
      .rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE' });
  });

it('keeps Range and response limits after full legacy byte verification', async (): Promise<void> => {
  const bytes = await png(); const fixture = await local(bytes);
  const result = await readManagedAssetVersionBytes(fixture.asset, 'image', { ...fixture, range: { start: 4, end: 9 }, maxBytes: 6 });
  expect(result).toMatchObject({ totalBytes: bytes.length, mimeType: 'image/png', range: { start: 4, end: 9 } });
  expect(result.bytes).toEqual(bytes.subarray(4, 10));
  await expect(readManagedAssetVersionBytes(fixture.asset, 'image', { ...fixture, maxBytes: 5, range: { start: 4, end: 9 } }))
    .rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE' });
});

it('delivers the validated buffer, not bytes replaced on disk after decode', async (): Promise<void> => {
  const bytes = await png(); const fixture = await local(bytes);
  const replacement = Buffer.alloc(bytes.length, 0x78);
  const spawn = childProcess.spawn; let replacing: Promise<void> | undefined;
  vi.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
    const child = spawn(...args); const emit = child.emit.bind(child);
    child.stdout!.on('data', (chunk: Buffer): void => {
      if (chunk.toString().includes('decode')) replacing ??= writeFile(fixture.file, replacement);
    });
    child.emit = ((event: string | symbol, ...values: unknown[]): boolean => {
      if (event === 'close' && replacing) { void replacing.then(() => { emit(event, ...values); }); return true; }
      return emit(event, ...values);
    }) as typeof child.emit;
    return child;
  });
  const result = await readManagedAssetVersionBytes(fixture.asset, 'image', fixture);
  expect(replacing).toBeDefined(); expect(await readFile(fixture.file)).toEqual(replacement);
  expect(result.bytes).toEqual(bytes);
  await expect(getManagedAssetMediaDescriptor(fixture.asset, 'image', fixture)).rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_NOT_READY' });
});

function s3(bytes: Buffer, contentType: string | null): ManagedMediaReadDependencies {
  return { inspectS3Exact: async (): Promise<import('@/lib/s3-storage').S3ExactObjectMetadata> => ({
    byteSize: bytes.length, contentType, eTag: '"pinned"', versionId: 'version-1',
  }), readS3RangeExact: async (key, range, options): Promise<import('@/lib/s3-storage').S3ExactRangeReadResult> => {
    expect(key).toBe('images/legacy/original.bin'); expect(range).toEqual({ start: 0, end: bytes.length - 1 });
    expect(options).toMatchObject({ eTag: '"pinned"', versionId: 'version-1', expectedTotalBytes: bytes.length, maxBytes: bytes.length });
    return { bytes, totalBytes: bytes.length };
  } };
}

it.each([null, 'application/octet-stream', 'image/png'])(
  'derives actual S3 bytes with %s Content-Type using pinned exact reads', async (contentType): Promise<void> => {
    const bytes = await png(); const asset = version(bytes); asset.file.storageKey = 'images/legacy/original.bin';
    const before = structuredClone(asset);
    expect(await getManagedAssetMediaDescriptor(asset, 'image', {}, s3(bytes, contentType))).toMatchObject({
      mimeType: 'image/png', checksum: checksum(bytes), width: 3, height: 2, source: { kind: 's3', eTag: '"pinned"' },
    });
    expect((await readManagedAssetVersionBytes(asset, 'image', { range: { start: 1, end: 5 } }, s3(bytes, contentType))).bytes)
      .toEqual(bytes.subarray(1, 6));
    expect(asset).toEqual(before);
  });

it.each(['image/jpeg', 'video/mp4', 'text/html'])(
  'does not silently override conflicting S3 Content-Type %s', async (contentType): Promise<void> => {
    const bytes = await png(); const asset = version(bytes); asset.file.storageKey = 'images/legacy/original.bin';
    await expect(readManagedAssetVersionBytes(asset, 'image', {}, s3(bytes, contentType)))
      .rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE' });
  });

it('rejects aborted and invalid-deadline legacy requests before object I/O', async (): Promise<void> => {
  const asset = version(await png()); asset.file.storageKey = 'images/legacy/original.bin';
  const inspectS3Exact = vi.fn(async (): Promise<never> => { throw new Error('I/O must not start'); });
  const controller = new AbortController(); controller.abort();
  for (const options of [{ signal: controller.signal }, { timeoutMs: 0 }, { timeoutMs: 30_001 }]) {
    await expect(getManagedAssetMediaDescriptor(asset, 'image', options, { inspectS3Exact }))
      .rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_NOT_READY' });
  }
  expect(inspectS3Exact).not.toHaveBeenCalled();
});

it('bounds concurrent legacy full reads until the active buffers settle', async (): Promise<void> => {
  const bytes = await png(); const asset = version(bytes); asset.file.storageKey = 'images/legacy/original.bin';
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let bothEntered!: () => void; const entered = new Promise<void>(resolve => { bothEntered = resolve; });
  let reads = 0; const dependencies = s3(bytes, null); const exact = dependencies.readS3RangeExact!;
  dependencies.readS3RangeExact = async (...args): ReturnType<typeof exact> => {
    if (++reads === 2) bothEntered(); await gate; return exact(...args);
  };
  const pending = [0, 1].map(() => readManagedAssetVersionBytes(asset, 'image', {}, dependencies));
  try {
    await entered;
    await expect(readManagedAssetVersionBytes(asset, 'image', {}, dependencies))
      .rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE' });
    expect(reads).toBe(2);
  } finally { release(); await Promise.all(pending); }
});

it('aborts a stalled exact S3 read at the legacy request deadline', async (): Promise<void> => {
  const bytes = await png(); const asset = version(bytes); asset.file.storageKey = 'images/legacy/original.bin';
  const dependencies = s3(bytes, null); let cancelled = false;
  dependencies.readS3RangeExact = async (_key, _range, options): Promise<never> => new Promise((_, reject) => {
    const abort = (): void => { cancelled = true; reject(options.signal!.reason); };
    options.signal!.addEventListener('abort', abort, { once: true });
    if (options.signal!.aborted) abort();
  });
  await expect(readManagedAssetVersionBytes(asset, 'image', { timeoutMs: 20 }, dependencies))
    .rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE' });
  expect(cancelled).toBe(true);
  // The failed read must not hold admission; the subsequent real decode works.
  expect((await readManagedAssetVersionBytes(asset, 'image', {}, s3(bytes, null))).bytes).toEqual(bytes);
});

it.each(['truncated-body', 'missing-object-identity'])(
  'rejects legacy S3 %s without falling back to unpinned or local media', async (failure): Promise<void> => {
    const bytes = await png(); const asset = version(bytes); asset.file.storageKey = 'images/legacy/original.bin';
    const dependencies = s3(bytes, null);
    if (failure === 'truncated-body') dependencies.readS3RangeExact = async (): Promise<import('@/lib/s3-storage').S3ExactRangeReadResult> => ({
      bytes: bytes.subarray(0, 10), totalBytes: bytes.length,
    });
    else dependencies.inspectS3Exact = async (): Promise<import('@/lib/s3-storage').S3ExactObjectMetadata> => ({
      byteSize: bytes.length, contentType: null, eTag: null, versionId: null,
    });
    await expect(readManagedAssetVersionBytes(asset, 'image', {}, dependencies))
      .rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE' });
  });

it('does not infer a missing video MIME from PNG contents', async (): Promise<void> => {
  const fixture = await local(await png());
  await expect(readManagedAssetVersionBytes(fixture.asset, 'video', fixture))
    .rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE' });
});

it.each(['mime_type', 'checksum'] as const)(
  'preserves and rejects database empty %s through the actual AssetCore mapper', async (field): Promise<void> => {
    const fixture = await local(await png());
    const row = { id: 'legacy-version', asset_id: 'asset', owner_id: 'owner', project_id: 'project',
      file_url: fixture.asset.file.url, availability: 'ready', byte_size: fixture.asset.file.byteSize,
      checksum: null as string | null, mime_type: null as string | null, storage_key: null,
      width: 3, height: 2, recovery_source_url: null, task_id: null, idempotency_key: null,
      metadata: {}, parent_version_ids: [], created_at: new Date('2026-10-05T00:00:00Z') };
    row[field] = '';
    const storage = createAssetStorageTransaction({ query: async (sql: string, values: unknown[]): Promise<unknown> => {
      expect(sql).toContain('FROM wujie_asset_versions v');
      expect(values).toEqual(['legacy-version', 'owner', 'project']);
      return { rows: [row], rowCount: 1 };
    } } as never);
    const mapped = await storage.findVersion('owner', 'project', 'legacy-version');
    expect(mapped!.file[field === 'mime_type' ? 'mimeType' : 'checksum']).toBe('');
    await expect(readManagedAssetVersionBytes(mapped!, 'image', fixture))
      .rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE' });
  });

it.each(['gif', 'webp'] as const)(
  'fully decodes both %s frames but derives the single-frame display dimensions', async (format): Promise<void> => {
    const raw = Buffer.alloc(3 * 4 * 3);
    raw.fill(0x26, 0, 18); raw.fill(0xd3, 18);
    const bytes = await sharp(raw, { raw: { width: 3, height: 4, channels: 3, pageHeight: 2 } })
      [format]({ loop: 0, delay: [100, 100] }).toBuffer();
    const metadata = await sharp(bytes, { animated: true }).metadata();
    expect(metadata.pages).toBe(2); expect(metadata.height).toBe(4); expect(metadata.pageHeight).toBe(2);
    const fixture = await local(bytes);
    expect(await getManagedAssetMediaDescriptor(fixture.asset, 'image', fixture)).toMatchObject({ width: 3, height: 2 });
    delete fixture.asset.file.width; delete fixture.asset.file.height;
    expect(await getManagedAssetMediaDescriptor(fixture.asset, 'image', fixture)).toMatchObject({ width: 3, height: 2 });
    expect((await readManagedAssetVersionBytes(fixture.asset, 'image', fixture)).bytes).toEqual(bytes);
  });

it('does not allocate a second full input buffer just to recognize the legacy format', async (): Promise<void> => {
  const bytes = await png(); const fixture = await local(bytes);
  const allocate = Buffer.allocUnsafe; let copiedInputBuffers = 0;
  vi.spyOn(Buffer, 'allocUnsafe').mockImplementation((size: number): ReturnType<typeof allocate> => {
    if (size === bytes.length) copiedInputBuffers++;
    return allocate(size);
  });
  expect((await readManagedAssetVersionBytes(fixture.asset, 'image', fixture)).bytes).toEqual(bytes);
  expect(copiedInputBuffers).toBe(0);
});
