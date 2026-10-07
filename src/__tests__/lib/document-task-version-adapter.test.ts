import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const database = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('@/lib/db-client', () => ({ getPool: () => database }));
import * as access from '@/lib/collaboration/document-access';
import * as request from '@/lib/collaboration/document-media-request';
import * as source from '@/lib/collaboration/document-media-source';
import * as publication from '@/lib/collaboration/task-publication-output';
import { CanvasTaskPublicationError } from '@/lib/collaboration/task-publication';
import type { PreparedPrivateTaskVersion } from '@/lib/collaboration/document-task-version-adapter';

const command = { action: 'attach' as const, transform: { x: 3, y: 4, width: 20, height: 10, rotation: 0, zIndex: 1 } };
const input = { projectId: 'target', sourceVersionId: 'private-version', idempotencyKey: 'key', command };
const task = { id: 'generate-private', user_id: 'actor', project_id: 'private-project', type: 'generate', status: 'completed',
  result: { imageUrls: ['https://media.example/first.png', 'https://media.example/second.png'] } as Record<string, unknown> };
const version = { id: 'private-version', asset_id: 'private-asset', owner_id: 'actor', project_id: 'private-project',
  task_id: 'generate-private' as string | null, metadata: { source: 'task-projection', outputIndex: 1 } as Record<string, unknown>, availability: 'ready',
  file_url: 'https://media.example/second.png', recovery_source_url: null as string | null, storage_key: null, checksum: null,
  mime_type: 'image/png', byte_size: null };
const asset = { id: 'private-asset', owner_id: 'actor', project_id: 'private-project', kind: 'image', status: 'active' };
const project = { id: 'private-project', owner_id: 'actor', status: 'active' };
let rows: { task: typeof task; version: typeof version; asset: typeof asset; project: typeof project };
let stored: Record<string, unknown> | undefined;
let lineage: Record<string, unknown> | undefined;
let authorized: boolean;
let sourceUnavailable: boolean;
let published: boolean;
let beforePreparation: (() => void) | undefined;
const dispatched: request.MediaAdoptionRequest[] = [];
function sourceRow(): Record<string, unknown> {
  return { ...rows.version, kind: rows.asset.kind, version_record: structuredClone(rows.version),
    asset_record: structuredClone(rows.asset), project_record: structuredClone(rows.project) };
}
beforeEach(() => {
  rows = structuredClone({ task, version, asset, project }); stored = undefined; lineage = undefined; authorized = true;
  sourceUnavailable = false; published = false;
  dispatched.length = 0; beforePreparation = undefined; vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
  database.query.mockReset().mockImplementation(async (sql: string) => {
    if (/FROM wujie_canvas_asset_commands c/u.test(sql)) return { rows: stored ? [stored] : [], rowCount: stored ? 1 : 0 };
    if (/FROM wujie_canvas_media_lineage/u.test(sql)) return { rows: lineage ? [lineage] : [], rowCount: lineage ? 1 : 0 };
    if (/FROM wujie_asset_versions version/u.test(sql)) {
      if (sourceUnavailable) throw new Error('archived source must not be read during replay');
      return { rows: /task_id IS NULL/u.test(sql) && rows.version.task_id !== null ? [] : [sourceRow()], rowCount: 1 };
    }
    if (/FROM cloud_tasks/u.test(sql)) return { rows: [rows.task], rowCount: 1 };
    if (/FROM wujie_canvas_task_publications/u.test(sql)) return { rows: published ? [{ task_id: rows.task.id }] : [], rowCount: published ? 1 : 0 };
    if (/FROM wujie_project_document_settings/u.test(sql)) return { rows: [{ enabled: true }], rowCount: 1 };
    if (/FROM wujie_projects p/u.test(sql)) return { rows: authorized ? [{ owner_id: 'actor' }] : [], rowCount: authorized ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  });
  database.connect.mockResolvedValue({ query: database.query, release: (): void => undefined });
});
afterEach(() => vi.unstubAllEnvs());
// Execute the actual production dispatcher and its authorization/replay functions.
// Only media/transaction execution is bounded here; preparation below is real.
async function entry(): Promise<(actor: string, value: unknown) => Promise<unknown>> {
  const filename = path.resolve('src/lib/collaboration/document-media-import.ts');
  const tree = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set(['digest', 'conflict', 'authorize', 'resultRow', 'replay', 'authorizedResult',
    'importDocumentAssetVersion', 'replayTaskVersionImport', 'adoptDocumentTaskResult', 'publishPreparedDocumentTaskOutput']);
  const code = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text))
    .map(node => node.getText(tree).replace(/^export\s+/u, '')).join('\n');
  const adapterPath = path.resolve('src/lib/collaboration/document-task-version-adapter.ts');
  const adapter = existsSync(adapterPath) ? await import('@/lib/collaboration/document-task-version-adapter') : {};
  const executeImport = async (actor: string, value: request.MediaVersionImportRequest | request.MediaAdoptionRequest,
    _request?: Request, _mime?: string, _publication?: unknown, privateVersion?: PreparedPrivateTaskVersion): Promise<unknown> => {
    beforePreparation?.();
    if ('taskId' in value) { await source.prepareMediaTaskSource(actor, value, undefined, privateVersion); dispatched.push(value);
      return { adoptedTask: value.taskId, adoptedOutput: value.outputIndex, sourceVersion: value.sourceVersionId, command: value.command }; }
    await source.prepareMediaVersionSource(actor, value); return { taskless: true };
  };
  const bindings = { ...access, ...request, ...adapter, ...publication, createHash, isDeepStrictEqual,
    CanvasTaskPublicationError, getPool: () => database, executeImport };
  const js = ts.transpileModule(code + '\nreturn importDocumentAssetVersion;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), js)(...Object.values(bindings));
}
describe('private task version through actual version entry', () => {
  it.each(['changed', 'removed'] as const)('rejects persisted outputIndex %s between adapter and real preparation even when both slots share a URL', async (mutation) => {
    rows.task.result.imageUrls = ['https://media.example/second.png', 'https://media.example/second.png'];
    beforePreparation = (): void => {
      if (mutation === 'changed') rows.version.metadata.outputIndex = 0;
      else delete rows.version.metadata.outputIndex;
    };
    const importVersion = await entry();
    await expect(importVersion('actor', input)).rejects.toThrow('DOCUMENT_MEDIA_CONFLICT');
    expect(dispatched).toEqual([]);
  });
  it('accepts a persisted private task version rather than demanding task_id NULL', async () => {
    const importVersion = await entry();
    await expect(importVersion('actor', input)).resolves.toMatchObject({ adoptedTask: 'generate-private', adoptedOutput: 1 });
  });
  it('dispatches the persisted nonzero output identity and preserves source version and command', async () => {
    const importVersion = await entry();
    await importVersion('actor', input);
    expect(dispatched).toEqual([{ projectId: 'target', idempotencyKey: 'key', sourceVersionId: 'private-version',
      taskId: 'generate-private', outputIndex: 1, command: { action: 'attach', transform: { x: 3, y: 4, width: 20, height: 10, rotation: 0, zIndex: 1 } } }]);
  });
});

function committed(kind: 'task' | 'version' = 'task'): void {
  // Independent historical request fixture, including the schema's field order.
  const accepted = kind === 'task'
    ? { projectId: 'target', idempotencyKey: 'key', command, taskId: 'generate-private', outputIndex: 1, sourceVersionId: 'private-version' }
    : { projectId: 'target', idempotencyKey: 'key', command, sourceVersionId: 'private-version' };
  const sourceDigest = createHash('sha256').update(JSON.stringify({ kind, input: accepted })).digest('hex');
  stored = { source_request_digest: sourceDigest, source_kind: kind, owner_id: 'actor', asset_id: 'target-asset',
    placement_id: 'placement', asset_version_id: 'target-version', document_sequence: '7',
    registered_asset_id: 'target-asset', registered_version_id: 'target-version', registered_placement_id: 'placement',
    entity_id: 'canvas-entity', file_url: '/api/serve-upload/result.png', kind: 'image' };
  lineage = { task_id: 'generate-private', output_index: 1, source_version_id: 'private-version', source_request_digest: sourceDigest };
}
describe('private version admission and durable replay boundaries', () => {
  it('keeps a normal taskless version on its original preparation path', async () => {
    rows.version.task_id = null;
    await expect((await entry())('actor', input)).resolves.toEqual({ taskless: true });
    expect(dispatched).toEqual([]);
  });
  it('admits a video from its actual persisted slot without using image heuristics', async () => {
    rows.task.type = 'video_generate'; rows.task.result = { videoUrl: 'https://media.example/movie.mp4' };
    rows.asset.kind = 'video'; rows.version.metadata.outputIndex = 0; rows.version.file_url = 'https://media.example/movie.mp4';
    rows.version.mime_type = 'video/mp4';
    await expect((await entry())('actor', input)).resolves.toMatchObject({ adoptedTask: 'generate-private', adoptedOutput: 0 });
  });
  it.each([
    ['string index', (): void => { (rows.version.metadata as Record<string, unknown>).outputIndex = '1'; }],
    ['missing index', (): void => { delete (rows.version.metadata as Partial<typeof version.metadata>).outputIndex; }],
    ['negative index', (): void => { rows.version.metadata.outputIndex = -1; }],
    ['out of range index', (): void => { rows.version.metadata.outputIndex = 2; }],
    ['wrong slot URL', (): void => { rows.version.file_url = 'https://media.example/first.png'; }],
    ['wrong task id', (): void => { rows.task.id = 'another-task'; }],
    ['wrong task actor', (): void => { rows.task.user_id = 'other'; }],
    ['wrong task project', (): void => { rows.task.project_id = 'other'; }],
    ['wrong version actor', (): void => { rows.version.owner_id = 'other'; }],
    ['wrong version asset', (): void => { rows.version.asset_id = 'other'; }],
    ['wrong asset project', (): void => { rows.asset.project_id = 'other'; }],
    ['inactive source project', (): void => { rows.project.status = 'closed'; }],
    ['archived version', (): void => { rows.version.availability = 'archived'; }],
    ['inactive asset', (): void => { rows.asset.status = 'archived'; }],
    ['kind mismatch', (): void => { rows.asset.kind = 'video'; }],
    ['model task', (): void => { rows.task.type = 'model_3d'; }],
    ['published shared task', (): void => { published = true; }],
    ['document result not private projection', (): void => { rows.version.metadata.source = 'document-media-import'; }],
    ...['failed', 'cancelled', 'processing'].map(status => [status + ' task', (): void => { rows.task.status = status; }] as const),
  ] as const)('refuses %s before media preparation', async (_label, mutate) => {
    mutate();
    await expect((await entry())('actor', input)).rejects.toThrow('DOCUMENT_MEDIA_SOURCE_FORBIDDEN');
    expect(dispatched).toEqual([]);
  });
  it('accepts the exact recovery source URL for its slot, not an arbitrary other URL', async () => {
    rows.version.file_url = '/api/serve-upload/private.png';
    rows.version.recovery_source_url = 'https://media.example/second.png';
    await expect((await entry())('actor', input)).resolves.toMatchObject({ adoptedOutput: 1 });
  });
  it('replays a committed task command with archived source and changed metadata without redispatch', async () => {
    committed(); sourceUnavailable = true; rows.version.metadata.outputIndex = 0;
    await expect((await entry())('actor', input)).resolves.toEqual({ placementId: 'placement', assetVersionId: 'target-version', documentSequence: 7,
      assetReference: { assetId: 'target-asset', assetVersionId: 'target-version', placementId: 'placement', entityId: 'canvas-entity',
        url: '/api/serve-upload/result.png', kind: 'image' } });
    expect(dispatched).toEqual([]);
  });
  it.each(['source', 'command', 'lineage', 'missing-lineage'] as const)('conflicts on reused key with changed %s', async (change) => {
    committed(); sourceUnavailable = true;
    if (change === 'lineage') lineage!.output_index = 0;
    if (change === 'missing-lineage') lineage = undefined;
    const changed = change === 'source' ? { ...input, sourceVersionId: 'another-version' }
      : change === 'command' ? { ...input, command: { ...command, transform: { ...command.transform, x: 99 } } } : input;
    await expect((await entry())('actor', changed)).rejects.toThrow('DOCUMENT_MEDIA_CONFLICT');
    expect(dispatched).toEqual([]);
  });
  it.each(['revoked', 'other actor', 'feature off'] as const)('does not ACK a committed command when %s', async (change) => {
    committed(); sourceUnavailable = true;
    if (change === 'revoked' || change === 'other actor') authorized = false;
    else vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
    await expect((await entry())(change === 'other actor' ? 'other' : 'actor', input))
      .rejects.toThrow(change === 'feature off' ? '文档协作当前只读' : '无权编辑此项目文档');
    expect(dispatched).toEqual([]);
  });
  it('keeps the taskless committed replay source-free', async () => {
    committed('version'); sourceUnavailable = true;
    // The real version executeImport replay functions, rather than our media boundary.
    const tree = ts.createSourceFile('import.ts', readFileSync('src/lib/collaboration/document-media-import.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    const names = new Set(['digest', 'conflict', 'replay', 'executeImport']);
    const code = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text))
      .map(node => node.getText(tree)).join('\n');
    const bindings = { ...request, createHash, authorizedResult: async (): Promise<unknown> => ({ ownerId: 'actor', row: { ...stored,
      assetReference: { assetId: 'target-asset', assetVersionId: 'target-version', placementId: 'placement',
        entityId: 'canvas-entity', url: '/api/serve-upload/result.png', kind: 'image' } } }),
      acquireKey: async (): Promise<unknown> => ({ release: async (): Promise<void> => undefined }) };
    const js = ts.transpileModule(code + '\nreturn executeImport;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const execute = new Function(...Object.keys(bindings), js)(...Object.values(bindings));
    await expect(execute('actor', request.parseMediaVersionImport(input), new Request('http://localhost/internal')))
      .resolves.toMatchObject({ placementId: 'placement', documentSequence: 7 });
  });
  it('does not bypass image_edit prepared publication and exact-request restriction', async () => {
    rows.task.id = 'image_edit_private'; rows.version.task_id = 'image_edit_private'; rows.task.type = 'image_edit';
    await expect((await entry())('actor', input)).rejects.toMatchObject({ code: 'CANVAS_TASK_PUBLICATION_CONFLICT' });
    expect(dispatched).toEqual([]);
  });
  it('rechecks the bound persisted index in the actual final source assertion', async () => {
    const adapter = await import('@/lib/collaboration/document-task-version-adapter');
    const derived = await adapter.resolvePrivateTaskVersion('actor', input);
    if (!derived) throw new Error('private fixture did not resolve');
    const prepared = await source.prepareMediaTaskSource('actor', derived.input, undefined, derived.source);
    rows.version.metadata.outputIndex = 0;
    await expect(source.assertMediaTaskSource({ query: database.query } as unknown as Parameters<typeof source.assertMediaTaskSource>[0],
      'actor', derived.input, prepared)).rejects.toThrow('DOCUMENT_MEDIA_CONFLICT');
  });
  it('keeps the old explicit adopt contract without task-projection metadata', async () => {
    delete (rows.version.metadata as Partial<typeof version.metadata>).outputIndex;
    const prepared = await source.prepareMediaTaskSource('actor', { ...input, taskId: 'generate-private', outputIndex: 1 });
    expect(source.mediaSourceKind(prepared)).toBe('image');
  });
  it.each(['task', 'asset'] as const)('rejects %s drift between resolution and preparation', async (change) => {
    beforePreparation = (): void => { if (change === 'task') rows.task.project_id = 'other'; else rows.asset.owner_id = 'other'; };
    await expect((await entry())('actor', input)).rejects.toThrow('DOCUMENT_MEDIA_CONFLICT');
    expect(dispatched).toEqual([]);
  });
});
