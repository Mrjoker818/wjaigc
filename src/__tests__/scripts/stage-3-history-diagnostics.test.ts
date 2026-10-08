// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as diagnostics from '../../../tests/helpers/stage-3-history-diagnostics';

const install = Reflect.get(diagnostics, 'installStage3HistoryDiagnostics') as
  ((input: { projectId: string }) => () => void) | undefined;
const summarize = Reflect.get(diagnostics, 'summarizeStage3HistorySync') as
  ((value: unknown, projectId: string) => unknown) | undefined;
const key = 'wujie:canvas:prepared-snapshot:v1';
let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('Stage 3 history boundary diagnostics', () => {
  it('reports the latest unload geometry and revision window without logging identities or media', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    dispose = install?.({ projectId: 'fixture-project' });
    localStorage.setItem(key, JSON.stringify({
      version: 4, ownerId: 'private-owner', baseProjectRevision: 7,
      maxRecoverableProjectRevision: 9,
      snapshot: { projectId: 'fixture-project', revision: 12, images: [{
        id: 'private-image', url: 'https://private.invalid?token=secret',
        x: 216, y: 72, width: 160, height: 160,
      }], metadata: { secret: 'private-metadata' } },
    }));
    window.dispatchEvent(new Event('pagehide'));
    expect(info.mock.calls.at(-1)?.[0]).toBe('STAGE3_HISTORY_STORAGE {"phase":"pagehide","snapshot":{"version":4,"base":7,"max":9,"revision":12,"geometry":{"x":216,"y":72,"width":160,"height":160}}}');
    expect(localStorage.getItem(key)).toContain('private-image');
  });

  it('observes recovery removal without preventing or duplicating the real storage operation', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    localStorage.setItem(key, JSON.stringify({ version: 4, baseProjectRevision: 7,
      maxRecoverableProjectRevision: 9,
      snapshot: { projectId: 'fixture-project', revision: 12, images: [] },
    }));
    dispose = install?.({ projectId: 'fixture-project' });
    localStorage.removeItem(key);
    expect(info.mock.calls.at(-1)?.[0]).toBe('STAGE3_HISTORY_STORAGE {"phase":"remove","snapshot":{"version":4,"base":7,"max":9,"revision":12,"geometry":null}}');
    expect(localStorage.getItem(key)).toBeNull();
    dispose?.();
    const count = info.mock.calls.length;
    window.dispatchEvent(new Event('beforeunload'));
    expect(info.mock.calls).toHaveLength(count);
  });

  it('keeps unrelated projects and malformed storage opaque and leaves them untouched', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    dispose = install?.({ projectId: 'fixture-project' });
    for (const raw of ['secret invalid JSON', JSON.stringify({ snapshot: { projectId: 'other-private-project' } })]) {
      localStorage.setItem(key, raw);
      window.dispatchEvent(new Event('pagehide'));
      expect(info.mock.calls.at(-1)?.[0]).toBe('STAGE3_HISTORY_STORAGE {"phase":"pagehide","snapshot":null}');
      expect(localStorage.getItem(key)).toBe(raw);
    }
  });

  it('reports only hand-checked sync geometry and its optimistic revision', () => {
    expect(summarize?.({ key: 'projects', projectRevision: 8, secret: 'no-log', value: [{
      id: 'fixture-project', userId: 'no-log', canvasImages: [{
        url: 'https://no-log.invalid', x: 280, y: 136, width: 96, height: 96,
      }], metadata: { password: 'no-log' },
    }] }, 'fixture-project')).toEqual({ base: 8, geometry: { x: 280, y: 136, width: 96, height: 96 } });
    expect(summarize?.({ key: 'projects', projectRevision: 'secret', value: [{
      id: 'fixture-project', canvasImages: [{ x: 'secret', y: Infinity, width: null, height: NaN }],
    }] }, 'fixture-project')).toEqual({ base: null, geometry: { x: null, y: null, width: null, height: null } });
    expect(summarize?.({ key: 'private-key', value: 'secret' }, 'fixture-project')).toBeNull();
  });

  it('shows the persisted adoption boundary at recovery removal without exposing the owner', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    localStorage.setItem('unbounded_ai_current_user', 'private-owner');
    localStorage.setItem('unbounded_ai_project_adoption_commit_v2:private-owner', JSON.stringify({ revision: 10, password: 'secret' }));
    localStorage.setItem(key, JSON.stringify({ version: 4, ownerId: 'private-owner',
      baseProjectRevision: 7, maxRecoverableProjectRevision: 9,
      snapshot: { projectId: 'fixture-project', revision: 12, images: [] },
    }));
    dispose = install?.({ projectId: 'fixture-project' });
    localStorage.removeItem(key);
    expect(info.mock.calls.at(-1)?.[0]).toBe('STAGE3_HISTORY_STORAGE {"phase":"remove","snapshot":{"version":4,"base":7,"max":9,"revision":12,"geometry":null,"ownerMatches":true,"persistedAdoptionRevision":10}}');
  });

  it('indicates truncation instead of silently pretending the whole lifecycle was captured', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    dispose = install?.({ projectId: 'fixture-project' });
    for (let index = 0; index < 24; index++) window.dispatchEvent(new Event('pagehide'));
    expect(info.mock.calls).toHaveLength(17);
    expect(info.mock.calls.at(-1)?.[0]).toBe('STAGE3_HISTORY_STORAGE {"phase":"truncated","limit":16}');
  });

  it('preserves real storage writes and removals when the localStorage getter throws', () => {
    const storage = localStorage;
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    dispose = install?.({ projectId: 'fixture-project' });
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation((): Storage => {
      throw new Error('storage lookup denied');
    });
    expect(() => storage.setItem(key, 'original-value')).not.toThrow();
    expect(storage.getItem(key)).toBe('original-value');
    expect(() => storage.removeItem(key)).not.toThrow();
    expect(storage.getItem(key)).toBeNull();
  });

  it('propagates the native removal error rather than an unrelated diagnostic lookup error', () => {
    const storage = localStorage;
    const nativeError = new Error('native removal failed');
    const nativeRemove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((): void => { throw nativeError; });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    dispose = install?.({ projectId: 'fixture-project' });
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation((): Storage => {
      throw new Error('storage lookup denied');
    });
    let thrown: unknown;
    try { storage.removeItem(key); } catch (error) { thrown = error; }
    expect(thrown).toBe(nativeError);
    expect(nativeRemove).toHaveBeenCalledExactlyOnceWith(key);
  });

  it('reads the product-encoded adoption key for an owner with path-sensitive characters', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    localStorage.setItem('unbounded_ai_current_user', 'private/owner');
    localStorage.setItem('unbounded_ai_project_adoption_commit_v2:private%2Fowner', JSON.stringify({ revision: 10 }));
    localStorage.setItem(key, JSON.stringify({ version: 4, ownerId: 'private/owner',
      baseProjectRevision: 7, maxRecoverableProjectRevision: 9,
      snapshot: { projectId: 'fixture-project', revision: 12, images: [] },
    }));
    dispose = install?.({ projectId: 'fixture-project' });
    localStorage.removeItem(key);
    expect(info.mock.calls.at(-1)?.[0]).toBe('STAGE3_HISTORY_STORAGE {"phase":"remove","snapshot":{"version":4,"base":7,"max":9,"revision":12,"geometry":null,"ownerMatches":true,"persistedAdoptionRevision":10}}');
  });
});
