/** Test-only browser API boundaries. Never imported by production components. */
export interface JsdomMediaPreferences {
  readonly colorScheme: 'light' | 'dark';
  readonly reducedMotion: boolean;
}

export type JsdomBrowserWindow = Window & typeof globalThis;

export function runJsdomFixtureCleanup(actions: readonly (() => void)[]): void {
  const failures: unknown[] = [];
  for (const action of actions) {
    try { action(); } catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'JSDOM_FIXTURE_CLEANUP_FAILED');
}

function onceCleanup(action: () => void): () => void {
  let attempted = false;
  let failure: { error: unknown } | undefined;
  return (): void => {
    if (attempted) {
      if (failure) throw failure.error;
      return;
    }
    attempted = true;
    try { action(); } catch (error) { failure = { error }; throw error; }
  };
}

/** A deliberately bounded fixture, not a CSS parser or native layout oracle. */
function mediaPredicate(query: string, preferences: JsdomMediaPreferences): (width: number, height: number) => boolean {
  const text = query.trim();
  const classic = /^\((min|max)-(width|height):\s*(\d+(?:\.\d+)?)(px|rem)\)$/.exec(text);
  if (classic) {
    const boundary = Number(classic[3]) * (classic[4] === 'rem' ? 16 : 1);
    const dimension = (width: number, height: number): number => classic[2] === 'width' ? width : height;
    return classic[1] === 'min'
      ? (width, height) => dimension(width, height) >= boundary
      : (width, height) => dimension(width, height) <= boundary;
  }
  const range = /^\((width|height)\s*(<|>=)\s*(\d+(?:\.\d+)?)(px|rem)\)$/.exec(text);
  if (range) {
    const boundary = Number(range[3]) * (range[4] === 'rem' ? 16 : 1);
    const dimension = (width: number, height: number): number => range[1] === 'width' ? width : height;
    return range[2] === '<'
      ? (width, height) => dimension(width, height) < boundary
      : (width, height) => dimension(width, height) >= boundary;
  }
  const color = /^\(prefers-color-scheme:\s*(light|dark)\)$/.exec(text);
  if (color) return () => preferences.colorScheme === color[1];
  const motion = /^\(prefers-reduced-motion:\s*(reduce|no-preference)\)$/.exec(text);
  if (motion) return () => preferences.reducedMotion === (motion[1] === 'reduce');
  throw new Error(`UNSUPPORTED_JSDOM_MEDIA_QUERY: ${query}`);
}

function restoreOwnedProperty(
  target: object,
  key: string,
  previous: PropertyDescriptor | undefined,
  owned: unknown,
): void {
  if (Object.getOwnPropertyDescriptor(target, key)?.value !== owned) return;
  if (previous) Object.defineProperty(target, key, previous);
  else if (!Reflect.deleteProperty(target, key)) throw new Error(`JSDOM_API_RESTORE_FAILED: ${key}`);
}

export function installJsdomMediaQueries(
  host: JsdomBrowserWindow,
  preferences: JsdomMediaPreferences,
): () => void {
  if (typeof host.matchMedia === 'function') return () => undefined;
  const previous = Object.getOwnPropertyDescriptor(host, 'matchMedia');
  const declared = { ...preferences };
  const queries = new Set<FixtureQuery>();
  let disposed = false;

  class FixtureQuery extends host.EventTarget {
    readonly media: string;
    onchange: MediaQueryList['onchange'] = null;
    private readonly evaluate: (width: number, height: number) => boolean;
    private lastMatch: boolean;
    private readonly listeners: Array<{
      type: string;
      listener: EventListenerOrEventListenerObject;
      capture: boolean;
    }> = [];

    constructor(query: string) {
      super();
      this.media = query;
      this.evaluate = mediaPredicate(query, declared);
      this.lastMatch = this.matches;
    }

    get matches(): boolean {
      return this.evaluate(host.innerWidth, host.innerHeight);
    }

    override addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void {
      if (!listener) return;
      const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
      const forwarded = options && typeof options === 'object'
        ? { capture, once: options.once, passive: options.passive, signal: options.signal }
        : capture;
      super.addEventListener(type, listener, forwarded);
      this.listeners.push({ type, listener, capture });
    }

    addListener(listener: Parameters<MediaQueryList['addListener']>[0]): void {
      this.addEventListener('change', listener as EventListener | null);
    }

    removeListener(listener: Parameters<MediaQueryList['removeListener']>[0]): void {
      this.removeEventListener('change', listener as EventListener | null);
    }

    refresh(): void {
      const next = this.matches;
      if (next === this.lastMatch) return;
      this.lastMatch = next;
      const event = new host.Event('change');
      Object.defineProperties(event, { matches: { value: next }, media: { value: this.media } });
      this.dispatchEvent(event);
      this.onchange?.call(this as unknown as MediaQueryList, event as MediaQueryListEvent);
    }

    dispose(): void {
      runJsdomFixtureCleanup([
        ...this.listeners.splice(0).map(record => (): void => {
          super.removeEventListener(record.type, record.listener, record.capture);
        }),
        (): void => { this.onchange = null; },
      ]);
    }
  }

  const matchMedia = (query: string): MediaQueryList => {
    if (disposed) throw new Error('DISPOSED_JSDOM_MEDIA_FIXTURE');
    const value = new FixtureQuery(query);
    queries.add(value);
    return value as unknown as MediaQueryList;
  };
  const resize = (): void => { for (const query of queries) query.refresh(); };
  Object.defineProperty(host, 'matchMedia', { configurable: true, writable: true, value: matchMedia });
  host.addEventListener('resize', resize);
  return onceCleanup((): void => {
    disposed = true;
    runJsdomFixtureCleanup([
      (): void => host.removeEventListener('resize', resize),
      ...[...queries].map(query => (): void => query.dispose()),
      (): void => queries.clear(),
      (): void => restoreOwnedProperty(host, 'matchMedia', previous, matchMedia),
    ]);
  });
}

/** Models instant fixture scroll state only: no geometry, animation or native event claims. */
export function installJsdomElementScroll(host: JsdomBrowserWindow): () => void {
  const target = host.Element.prototype;
  if (typeof target.scrollTo === 'function') return () => undefined;
  const previous = Object.getOwnPropertyDescriptor(target, 'scrollTo');
  function scrollTo(this: Element, first: number | ScrollToOptions = {}, second?: number): void {
    const options: ScrollToOptions = typeof first === 'number' ? { left: first, top: second } : first;
    if (options.behavior === 'smooth') throw new Error('UNSUPPORTED_JSDOM_SCROLL_ANIMATION');
    if ((options.left !== undefined && !Number.isFinite(options.left))
      || (options.top !== undefined && !Number.isFinite(options.top))) throw new Error('INVALID_JSDOM_SCROLL_COORDINATE');
    if (options.left !== undefined) this.scrollLeft = options.left;
    if (options.top !== undefined) this.scrollTop = options.top;
  }
  Object.defineProperty(target, 'scrollTo', { configurable: true, writable: true, value: scrollTo });
  return onceCleanup((): void => restoreOwnedProperty(target, 'scrollTo', previous, scrollTo));
}
