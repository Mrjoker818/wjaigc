import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import * as database from '@/lib/db-client';
import * as legacySource from '@/lib/annotation-project-source';
import * as storage from '@/lib/db-storage';

// Runtime marker only; authorization, projection validation and legacy lookup stay real.
vi.mock('server-only', () => ({}));
import {
  AnnotationSourceAdmissionError,
  assertAnnotationSourceUnchanged,
  findAuthorizedAnnotationSource,
  type AuthorizedAnnotationSource,
} from '@/lib/annotation-authorized-source';

type Step = 'begin' | 'actor' | 'project' | 'editor' | 'projection' | 'placements' | 'commit' | 'rollback';
type Consumer = 'lookup' | 'revalidation';
const VERSION = '11111111-1111-4111-8111-111111111111';
const SOURCE: AuthorizedAnnotationSource = {
  actorUserId: 'editor', projectId: 'shared', imageId: 'entity-a',
  imageUrl: '/api/serve-upload/images/source.png',
  versionId: 'entity-a:asset:11111111-1111-4111-8111-111111111111',
  assetId: 'asset-a', assetVersionId: VERSION, placementId: 'placement-a',
  access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner', projectId: 'shared', grantGeneration: '7' },
};
const INTERNAL = 'SELECT private_secret FROM wujie_user_data; fault-only-secret-token';
const READ_STEPS: Step[] = ['begin', 'actor', 'project', 'editor', 'projection', 'placements', 'commit'];

function result(rows: QueryResultRow[], command = 'SELECT'): QueryResult<QueryResultRow> {
  return { rows, rowCount: rows.length, command, oid: 0, fields: [] };
}

/** Only PG acquisition/query results are substituted; records expose real caller side effects. */
function pgBoundary(): {
  pool: Pool; steps: Step[]; releases: boolean[];
  fault?: Step | 'connect'; rollbackBroken: boolean; actorActive: boolean;
  connectCount: number; legacyQueries: number;
} {
  const state = {
    pool: undefined as unknown as Pool, steps: [] as Step[], releases: [] as boolean[],
    fault: undefined as Step | 'connect' | undefined, rollbackBroken: false, actorActive: true,
    connectCount: 0, legacyQueries: 0,
  };
  const client = {
    async query(sql: string, params?: unknown[]): Promise<QueryResult<QueryResultRow>> {
      let step: Step;
      let rows: QueryResultRow[] = [];
      if (sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY') step = 'begin';
      else if (sql === 'COMMIT') step = 'commit';
      else if (sql === 'ROLLBACK') step = 'rollback';
      else if (sql === 'SELECT status FROM wujie_users WHERE id = $1') {
        step = 'actor';
        expect(params).toEqual(['editor']);
        rows = [{ status: state.actorActive ? 'active' : 'disabled' }];
      } else if (sql.includes('FROM wujie_projects p')) {
        step = 'project';
        expect(params).toEqual(['shared']);
        rows = [{ owner_id: 'owner', status: 'active', owner_status: 'active', enabled: true, has_document: true }];
      } else if (sql.includes('FROM wujie_project_document_editors')) {
        step = 'editor';
        expect(params).toEqual(['shared', 'owner', 'editor']);
        rows = [{ grant_generation: '7' }];
      } else if (sql === 'SELECT projection FROM wujie_project_canvas_documents WHERE project_id=$1 AND owner_id=$2') {
        step = 'projection';
        expect(params).toEqual(['shared', 'owner']);
        rows = [{ projection: { placements: { 'placement-a': {
          assetVersionId: VERSION, x: 0, y: 0, width: 512, height: 512, rotation: 0, zIndex: 1,
        } } } }];
      } else if (sql.includes('FROM wujie_workspace_placements p')) {
        step = 'placements';
        expect(params).toEqual(['owner', 'shared', 'entity-a']);
        rows = [{ placement_id: 'placement-a', asset_id: 'asset-a', asset_version_id: VERSION,
          file_url: '/api/serve-upload/images/source.png' }];
      } else {
        if (sql.includes('wujie_user_data')) state.legacyQueries++;
        throw new Error(`Unexpected PG query: ${sql}`);
      }
      state.steps.push(step);
      if (state.fault === step || (step === 'rollback' && state.rollbackBroken)) {
        throw Object.assign(new Error(INTERNAL), { detail: INTERNAL, query: INTERNAL, code: 'XX000' });
      }
      return result(rows, step === 'begin' || step === 'commit' || step === 'rollback' ? step.toUpperCase() : 'SELECT');
    },
    release(discard = false): void { state.releases.push(discard); },
  };
  state.pool = {
    async connect(): Promise<PoolClient> {
      state.connectCount++;
      if (state.fault === 'connect') throw new Error(INTERNAL);
      return client as unknown as PoolClient;
    },
    async query(): Promise<never> {
      state.legacyQueries++;
      throw new Error('Unexpected pool-level legacy read');
    },
  } as unknown as Pool;
  return state;
}

async function expectPublic503(operation: Promise<unknown>): Promise<void> {
  const error: unknown = await operation.then(() => undefined, (reason: unknown): unknown => reason);
  expect(error).toBeInstanceOf(AnnotationSourceAdmissionError);
  expect(error).toMatchObject({ status: 503, code: 'ANNOTATION_SOURCE_UNAVAILABLE',
    message: '批注来源验证暂不可用，请稍后重试' });
  expect(error).not.toHaveProperty('cause');
  expect(error).not.toHaveProperty('detail');
  expect(error).not.toHaveProperty('query');
  // Include non-enumerable message/stack, not just JSON.stringify(Error).
  const publicError = error as Error;
  const serialized = JSON.stringify(publicError, Object.getOwnPropertyNames(publicError));
  expect(serialized).not.toMatch(/SELECT|private_secret|wujie_user_data|fault-only-secret-token|XX000/);
}

async function invoke(consumer: Consumer, source: AuthorizedAnnotationSource): Promise<unknown> {
  return consumer === 'lookup'
    ? findAuthorizedAnnotationSource('editor', 'shared', 'entity-a')
    : assertAnnotationSourceUnchanged(source);
}

beforeEach((): void => {
  // Non-routable placeholder; getPool acquisition below is intercepted before network I/O.
  vi.stubEnv('DATABASE_URL', 'postgresql://fault-only.invalid/fault_test');
  vi.stubEnv('PGDATABASE_URL', undefined);
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
});
afterEach((): void => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('configured PG fault boundaries (existing behavior protection, not new RED-GREEN)', () => {
  // Break caught: returning null/a stale private source or leaking the original PG error.
  for (const consumer of ['lookup', 'revalidation'] as const) {
    it.each(['DATABASE_URL', 'PGDATABASE_URL'] as const)(`${consumer}: %s connection failure is public 503 with no legacy fallback`, async (alias): Promise<void> => {
      const pg = pgBoundary();
      vi.spyOn(database, 'getPool').mockReturnValue(pg.pool);
      const owned = vi.spyOn(legacySource, 'findOwnedAnnotationSource');
      const userData = vi.spyOn(storage, 'dbGetUserData');
      vi.stubEnv('DATABASE_URL', undefined);
      vi.stubEnv('PGDATABASE_URL', undefined);
      vi.stubEnv(alias, 'postgresql://fault-only.invalid/fault_test');
      let source = SOURCE;
      if (consumer === 'revalidation') {
        const admitted = await findAuthorizedAnnotationSource('editor', 'shared', 'entity-a');
        expect(admitted).toEqual(SOURCE);
        source = admitted!;
        pg.steps.length = 0;
        pg.releases.length = 0;
        pg.connectCount = 0;
      }
      pg.fault = 'connect';
      expect(database.isDatabaseConfigured()).toBe(true);
      await expectPublic503(invoke(consumer, source));
      expect(pg.connectCount).toBe(1);
      expect(pg.steps).toEqual([]);
      expect(pg.releases).toEqual([]); // No acquired client to release.
      expect(owned).not.toHaveBeenCalled();
      expect(userData).not.toHaveBeenCalled();
      expect(pg.legacyQueries).toBe(0);
    });

    for (const rollbackBroken of [false, true]) {
      // Break caught: early success at COMMIT, non-read-only BEGIN, skipped rollback,
      // reusing a broken connection, or falling back to a private/legacy source.
      it.each(READ_STEPS)(`${consumer}: %s failure is public 503; rollbackBroken=${rollbackBroken}`, async (step): Promise<void> => {
        const pg = pgBoundary();
        vi.spyOn(database, 'getPool').mockReturnValue(pg.pool);
        const owned = vi.spyOn(legacySource, 'findOwnedAnnotationSource');
        const userData = vi.spyOn(storage, 'dbGetUserData');
        let source = SOURCE;
        if (consumer === 'revalidation') {
          const admitted = await findAuthorizedAnnotationSource('editor', 'shared', 'entity-a');
          expect(admitted).toEqual(SOURCE);
          source = admitted!;
          pg.steps.length = 0;
          pg.releases.length = 0;
          pg.connectCount = 0;
        }
        pg.fault = step;
        pg.rollbackBroken = rollbackBroken;
        await expectPublic503(invoke(consumer, source));
        expect(pg.steps).toEqual([...READ_STEPS.slice(0, READ_STEPS.indexOf(step) + 1), 'rollback']);
        expect(pg.connectCount).toBe(1);
        expect(pg.releases).toEqual([rollbackBroken]);
        expect(owned).not.toHaveBeenCalled();
        expect(userData).not.toHaveBeenCalled();
        expect(pg.legacyQueries).toBe(0);
      });
    }

    it(`${consumer}: rollback failure overrides access denial with 503 and discards the client`, async (): Promise<void> => {
      const pg = pgBoundary();
      vi.spyOn(database, 'getPool').mockReturnValue(pg.pool);
      const owned = vi.spyOn(legacySource, 'findOwnedAnnotationSource');
      const userData = vi.spyOn(storage, 'dbGetUserData');
      pg.actorActive = false;
      pg.rollbackBroken = true;
      await expectPublic503(invoke(consumer, SOURCE));
      expect(pg.steps).toEqual(['begin', 'actor', 'rollback']);
      expect(pg.releases).toEqual([true]);
      expect(owned).not.toHaveBeenCalled();
      expect(userData).not.toHaveBeenCalled();
      expect(pg.legacyQueries).toBe(0);
    });
  }

  it('admits and revalidates the canonical source through read-only transactions when PG queries succeed', async (): Promise<void> => {
    const pg = pgBoundary();
    vi.spyOn(database, 'getPool').mockReturnValue(pg.pool);
    const source = await findAuthorizedAnnotationSource('editor', 'shared', 'entity-a');
    expect(source).toEqual(SOURCE);
    await expect(assertAnnotationSourceUnchanged(source!)).resolves.toBeUndefined();
    expect(pg.steps).toEqual([...READ_STEPS, ...READ_STEPS]);
    expect(pg.releases).toEqual([false, false]);
    expect(pg.legacyQueries).toBe(0);
  });
});

describe('unconfigured PG source lookup remains unavailable without database I/O', () => {
  // This gate does not pretend to be a seeded legal-file positive control: the real
  // legacy reader has no file backend. Any PG dependency blocks that control.
  // Break caught: a supposedly file-only lookup/revalidation produces a PG config error.
  // Observe the real diagnostic: spying on exported getPool cannot see execSql's
  // same-module lexical call to getPool, and would give a false passing assertion.
  it.each(['lookup', 'revalidation'] as const)('%s must not fail on missing PG configuration in file-only mode', async (consumer): Promise<void> => {
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('PGDATABASE_URL', undefined);
    const diagnostic = vi.spyOn(console, 'error'); // Call through, retain the actual output.
    const owned = vi.spyOn(legacySource, 'findOwnedAnnotationSource');
    const userData = vi.spyOn(storage, 'dbGetUserData');
    expect(database.isDatabaseConfigured()).toBe(false);
    const outcome: unknown = await invoke(consumer, SOURCE).catch((error: unknown): unknown => error);
    // Record the actual caller-visible loss of a source; do not call it a positive control.
    if (consumer === 'lookup') expect(outcome).toBeNull();
    else expect(outcome).toMatchObject({ status: 404, code: 'ANNOTATION_PROJECT_NOT_FOUND' });
    expect(owned).toHaveBeenCalledWith('editor', 'shared', 'entity-a');
    expect(userData).not.toHaveBeenCalled();
    const messages = diagnostic.mock.calls.flat().map((value: unknown): string =>
      value instanceof Error ? value.message : String(value));
    expect(messages.join('\n')).not.toContain('No DATABASE_URL or PGDATABASE_URL environment variable set');
  });
});
