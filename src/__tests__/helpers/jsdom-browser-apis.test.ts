// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  installJsdomElementScroll,
  installJsdomMediaQueries,
  runJsdomFixtureCleanup,
  type JsdomBrowserWindow,
  type JsdomMediaPreferences,
} from './jsdom-browser-apis';

const frames: HTMLIFrameElement[] = [];
const disposers: Array<() => void> = [];

function realm(width = 1024): JsdomBrowserWindow {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  frames.push(frame);
  const host = frame.contentWindow as JsdomBrowserWindow | null;
  if (!host) throw new Error('JSDOM_TEST_REALM_REQUIRED');
  Object.defineProperty(host, 'innerWidth', { configurable: true, value: width });
  return host;
}

function installMedia(
  host: JsdomBrowserWindow,
  preferences: JsdomMediaPreferences = { colorScheme: 'light', reducedMotion: false },
): () => void {
  const dispose = installJsdomMediaQueries(host, preferences);
  disposers.push(dispose);
  expect(typeof host.matchMedia).toBe('function');
  return dispose;
}

afterEach(() => {
  runJsdomFixtureCleanup([
    ...disposers.splice(0).reverse(),
    ...frames.splice(0).map(frame => (): void => frame.remove()),
  ]);
});

describe('fixture cleanup failures remain observable', () => {
  it('attempts every action and retains both original errors in order', () => {
    const first = new Error('react-unmount-failure');
    const second = new Error('api-restore-failure');
    const visited: string[] = [];
    let caught: unknown;
    try {
      runJsdomFixtureCleanup([
        () => { visited.push('react'); throw first; },
        () => { visited.push('api'); throw second; },
        () => { visited.push('frame'); },
      ]);
    } catch (error) { caught = error; }
    expect(visited).toEqual(['react', 'api', 'frame']);
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([first, second]);
  });

  it('keeps the API present for unmount then restores it despite the unmount error', () => {
    const host = realm();
    const original = Object.getOwnPropertyDescriptor(host, 'matchMedia');
    const dispose = installMedia(host);
    const failure = new Error('react-unmount-failure');
    let presentAtUnmount = false;
    let caught: unknown;
    try {
      runJsdomFixtureCleanup([
        () => { presentAtUnmount = typeof host.matchMedia === 'function'; throw failure; },
        dispose,
      ]);
    } catch (error) { caught = error; }
    expect(presentAtUnmount).toBe(true);
    expect(caught).toBe(failure);
    expect(Object.getOwnPropertyDescriptor(host, 'matchMedia')).toEqual(original);
  });
});

describe('failed API restoration never becomes an empty success', () => {
  it.each(['media', 'scroll'] as const)('reports refused deletion and retains the %s failure', kind => {
    const host = realm();
    const target = kind === 'media' ? host : host.Element.prototype;
    const key = kind === 'media' ? 'matchMedia' : 'scrollTo';
    const dispose = kind === 'media'
      ? installJsdomMediaQueries(host, { colorScheme: 'light', reducedMotion: false })
      : installJsdomElementScroll(host);
    Object.defineProperty(target, key, { configurable: false });
    let first: unknown;
    let second: unknown;
    try { dispose(); } catch (error) { first = error; }
    try { dispose(); } catch (error) { second = error; }
    expect(first).toBeDefined();
    expect(first).toHaveProperty('message', expect.stringContaining('JSDOM_API_RESTORE_FAILED'));
    expect(second).toBe(first);
  });

  it.each(['media', 'scroll'] as const)('retains the original thrown %s restoration error', kind => {
    const host = realm();
    const target = kind === 'media' ? host : host.Element.prototype;
    const key = kind === 'media' ? 'matchMedia' : 'scrollTo';
    Object.defineProperty(target, key, { configurable: true, writable: true, value: undefined });
    const dispose = kind === 'media'
      ? installJsdomMediaQueries(host, { colorScheme: 'light', reducedMotion: false })
      : installJsdomElementScroll(host);
    Object.defineProperty(target, key, { configurable: false });
    let first: unknown;
    let second: unknown;
    try { dispose(); } catch (error) { first = error; }
    try { dispose(); } catch (error) { second = error; }
    expect(first).toHaveProperty('name', 'TypeError');
    expect(second).toBe(first);
  });

  it('still clears query listeners and restores the API if window listener cleanup throws', () => {
    const host = realm();
    const previous = Object.getOwnPropertyDescriptor(host, 'matchMedia');
    const removeDescriptor = Object.getOwnPropertyDescriptor(host, 'removeEventListener');
    const originalRemove = host.removeEventListener;
    const failure = new Error('window-listener-cleanup-failure');
    const dispose = installJsdomMediaQueries(host, { colorScheme: 'light', reducedMotion: false });
    const query = host.matchMedia('(max-width: 767px)');
    let seen = false;
    query.addEventListener('change', () => { seen = true; });
    Object.defineProperty(host, 'removeEventListener', { configurable: true, writable: true,
      value: (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void => {
        if (type === 'resize') throw failure;
        if (listener) originalRemove.call(host, type, listener, options);
      } });
    try {
      let caught: unknown;
      try { dispose(); } catch (error) { caught = error; }
      expect(caught).toBe(failure);
      query.dispatchEvent(new host.Event('change'));
      expect(seen).toBe(false);
      expect(Object.getOwnPropertyDescriptor(host, 'matchMedia')).toEqual(previous);
    } finally {
      if (removeDescriptor) Object.defineProperty(host, 'removeEventListener', removeDescriptor);
      else Reflect.deleteProperty(host, 'removeEventListener');
    }
  });
});

describe('explicit JSDOM media-query boundary', () => {
  it.each([
    [640, '(width < 641px)', true],
    [641, '(width < 641px)', false],
    [767, '(max-width: 767px)', true],
    [768, '(max-width: 767px)', false],
    [767, '(min-width: 48rem)', false],
    [768, '(min-width: 48rem)', true],
    [390, '(width >= 641px)', false],
    [844, '(width >= 641px)', true],
  ] as const)('matches width %s for %s as %s', (width, query, want) => {
    const host = realm(width);
    installMedia(host);
    expect(host.matchMedia(query).matches).toBe(want);
  });

  it.each([
    ['light', false, '(prefers-color-scheme: dark)', false],
    ['dark', false, '(prefers-color-scheme: dark)', true],
    ['light', false, '(prefers-reduced-motion: reduce)', false],
    ['light', true, '(prefers-reduced-motion: reduce)', true],
  ] as const)('keeps declared %s / reduced %s independent for %s', (colorScheme, reducedMotion, query, want) => {
    const host = realm(390);
    host.document.documentElement.className = 'theme-gold dark';
    installMedia(host, { colorScheme, reducedMotion });
    expect(host.matchMedia(query).matches).toBe(want);
  });

  it('reads current width and emits only an actual media-state transition', () => {
    const host = realm(390);
    installMedia(host);
    const query = host.matchMedia('(width < 641px)');
    const changes: Array<[boolean, string]> = [];
    query.addEventListener('change', event => changes.push([event.matches, event.media]));
    Object.defineProperty(host, 'innerWidth', { configurable: true, value: 500 });
    host.dispatchEvent(new host.Event('resize'));
    expect(changes).toEqual([]);
    Object.defineProperty(host, 'innerWidth', { configurable: true, value: 700 });
    expect(query.matches).toBe(false);
    host.dispatchEvent(new host.Event('resize'));
    host.dispatchEvent(new host.Event('resize'));
    expect(changes).toEqual([[false, '(width < 641px)']]);
  });

  it('removes modern and legacy listeners and disposes its own descriptors', () => {
    const host = realm(390);
    const original = Object.getOwnPropertyDescriptor(host, 'matchMedia');
    const dispose = installMedia(host);
    const query = host.matchMedia('(max-width: 767px)');
    const changes: boolean[] = [];
    const listener = (event: MediaQueryListEvent): void => { changes.push(event.matches); };
    query.addListener(listener);
    query.removeListener(listener);
    query.addEventListener('change', listener);
    query.removeEventListener('change', listener);
    Object.defineProperty(host, 'innerWidth', { configurable: true, value: 800 });
    host.dispatchEvent(new host.Event('resize'));
    expect(changes).toEqual([]);
    dispose();
    dispose();
    expect(Object.getOwnPropertyDescriptor(host, 'matchMedia')).toEqual(original);
  });

  it('rejects unsupported queries instead of inventing a false result', () => {
    const host = realm();
    installMedia(host);
    expect(() => host.matchMedia('(unknown-fixture-feature: enabled)')).toThrow('UNSUPPORTED_JSDOM_MEDIA_QUERY');
  });

  it('remembers registration-time capture even when the options object changes', () => {
    const host = realm();
    const dispose = installMedia(host);
    const query = host.matchMedia('(max-width: 767px)');
    const seen: string[] = [];
    const options = { capture: true };
    query.addEventListener('change', () => { seen.push('retained-listener'); }, options);
    options.capture = false;
    dispose();
    query.dispatchEvent(new host.Event('change'));
    expect(seen).toEqual([]);
  });

  it('preserves an explicitly supplied API and a later replacement owner', () => {
    const host = realm();
    installMedia(host);
    const existing = host.matchMedia;
    const dispose = installJsdomMediaQueries(host, { colorScheme: 'dark', reducedMotion: true });
    expect(host.matchMedia).toBe(existing);
    dispose();
    expect(host.matchMedia).toBe(existing);
    const replacement = (query: string): MediaQueryList => existing(query);
    Object.defineProperty(host, 'matchMedia', { configurable: true, writable: true, value: replacement });
    disposers[0]();
    expect(host.matchMedia).toBe(replacement);
  });
});

describe('explicit JSDOM instant element scroll boundary', () => {
  it('updates real fixture scroll state while preserving an omitted coordinate', () => {
    const host = realm();
    disposers.push(installJsdomElementScroll(host));
    const scroller = host.document.createElement('div');
    scroller.scrollLeft = 7;
    scroller.scrollTop = 3;
    expect(typeof scroller.scrollTo).toBe('function');
    scroller.scrollTo({ top: 18, behavior: 'instant' });
    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([7, 18]);
    scroller.scrollTo({ left: 11 });
    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([11, 18]);
    scroller.scrollTo(4, 5);
    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([4, 5]);
  });

  it('restores a missing API and preserves an existing implementation', () => {
    const host = realm();
    const original = Object.getOwnPropertyDescriptor(host.Element.prototype, 'scrollTo');
    const dispose = installJsdomElementScroll(host);
    disposers.push(dispose);
    expect(typeof host.Element.prototype.scrollTo).toBe('function');
    const existing = host.Element.prototype.scrollTo;
    installJsdomElementScroll(host)();
    expect(host.Element.prototype.scrollTo).toBe(existing);
    dispose();
    expect(Object.getOwnPropertyDescriptor(host.Element.prototype, 'scrollTo')).toEqual(original);
  });

  it('does not claim smooth animation or accept nonfinite coordinates', () => {
    const host = realm();
    disposers.push(installJsdomElementScroll(host));
    const scroller = host.document.createElement('div');
    expect(typeof scroller.scrollTo).toBe('function');
    expect(() => scroller.scrollTo({ top: 10, behavior: 'smooth' })).toThrow('UNSUPPORTED_JSDOM_SCROLL_ANIMATION');
    expect(() => scroller.scrollTo({ top: Number.NaN })).toThrow('INVALID_JSDOM_SCROLL_COORDINATE');
  });
});


describe('height-dependent ChatPanel fixture contract', () => {
  it('uses actual height independently of width at the 400px inclusive boundary', () => {
    const host = realm(375); Object.defineProperty(host, 'innerHeight', { configurable: true, value: 401 });
    installMedia(host);
    const compact = host.matchMedia('(max-height: 400px)');
    expect(compact.matches).toBe(false);
    expect(host.matchMedia('(min-height: 25rem)').matches).toBe(true);
    expect(host.matchMedia('(max-width: 767px)').matches).toBe(true);
    Object.defineProperty(host, 'innerHeight', { configurable: true, value: 400 });
    expect(compact.matches).toBe(true);
    expect(host.matchMedia('(height >= 25rem)').matches).toBe(true);
    expect(host.matchMedia('(height < 400px)').matches).toBe(false);
    Object.defineProperty(host, 'innerHeight', { configurable: true, value: 320 });
    expect(host.matchMedia('(height < 400px)').matches).toBe(true);
    expect(host.matchMedia('(min-height: 400px)').matches).toBe(false);
    expect(host.matchMedia('(min-width: 768px)').matches).toBe(false);
  });
  it('emits height changes once on resize and detaches both listener APIs and onchange on cleanup', () => {
    const host = realm(); Object.defineProperty(host, 'innerHeight', { configurable: true, value: 844 });
    const prior = Object.getOwnPropertyDescriptor(host, 'matchMedia'), dispose = installMedia(host);
    const query = host.matchMedia('(max-height: 400px)'), modern: boolean[] = [], legacy: boolean[] = [], changed: boolean[] = [];
    const modernListener = (event: Event): void => { modern.push((event as MediaQueryListEvent).matches); };
    const legacyListener = (event: MediaQueryListEvent): void => { legacy.push(event.matches); };
    query.addEventListener('change', modernListener); query.addListener(legacyListener);
    query.onchange = event => { changed.push(event.matches); };
    Object.defineProperty(host, 'innerHeight', { configurable: true, value: 320 });
    host.dispatchEvent(new host.Event('resize')); host.dispatchEvent(new host.Event('resize'));
    expect(modern).toEqual([true]); expect(legacy).toEqual([true]); expect(changed).toEqual([true]);
    query.removeEventListener('change', modernListener); query.removeListener(legacyListener);
    Object.defineProperty(host, 'innerHeight', { configurable: true, value: 844 }); host.dispatchEvent(new host.Event('resize'));
    expect(modern).toEqual([true]); expect(legacy).toEqual([true]); expect(changed).toEqual([true, false]);
    dispose(); expect(Object.getOwnPropertyDescriptor(host, 'matchMedia')).toEqual(prior); expect(query.onchange).toBeNull();
    query.dispatchEvent(new host.Event('change')); expect(changed).toEqual([true, false]);
  });
});
