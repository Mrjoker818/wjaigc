export interface QuoteTouchPoint { x: number; y: number }
export interface QuoteNativePoint extends QuoteTouchPoint { id: number; force: number }
export interface QuoteTouchCommand { type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel'; touchPoints: QuoteNativePoint[] }
export interface QuoteTouchTransport { send(method: 'Input.dispatchTouchEvent', command: QuoteTouchCommand): Promise<unknown> }
export interface QuoteTouchPage { viewportSize(): { width: number; height: number } | null; evaluate(callback: () => Promise<void>): Promise<void> }
export interface QuoteTouchList { evaluate(callback: (element: Element, point: QuoteTouchPoint) => boolean, point: QuoteTouchPoint): Promise<boolean> }
export interface QuoteTouchCloser { detach(): Promise<void> }
export interface QuoteTouchOutcome { threw: boolean; error: unknown }

export async function swipeQuoteList(transport: QuoteTouchTransport, page: QuoteTouchPage, list: QuoteTouchList, point: QuoteTouchPoint): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x <= 0 || point.x >= viewport.width || point.y <= 8 || point.y >= viewport.height) throw new Error('QUOTE_TOUCH_POINT');
  const hit = await list.evaluate((element: Element, position: QuoteTouchPoint): boolean => {
    const target = document.elementFromPoint(position.x, position.y);
    return Boolean(target && element.contains(target));
  }, point);
  if (!hit) throw new Error('QUOTE_TOUCH_START_HIT');
  const distance = Math.min(220, point.y - 8);
  const primary: QuoteTouchOutcome = { threw: false, error: undefined }, cleanup: QuoteTouchOutcome = { threw: false, error: undefined };
  let active = false;
  try {
    active = true;
    await transport.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1, force: 1 }] });
    for (let step = 1; step <= 12; step++) {
      await transport.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - distance * step / 12, id: 1, force: 1 }] });
      await page.evaluate((): Promise<void> => new Promise<void>((resolve: () => void): void => { requestAnimationFrame((): void => resolve()); }));
    }
    await transport.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); active = false;
  } catch (error) { primary.threw = true; primary.error = error; }
  if (active) { try { await transport.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); } catch (error) { cleanup.threw = true; cleanup.error = error; } }
  if (primary.threw && cleanup.threw) throw new AggregateError([primary.error, cleanup.error], 'QUOTE_TOUCH_AND_CANCEL');
  if (primary.threw) throw quoteFailure(primary.error);
  if (cleanup.threw) throw quoteFailure(cleanup.error);
}
export async function finishQuoteTouchSession(closer: QuoteTouchCloser, outcome: QuoteTouchOutcome): Promise<void> {
  const cleanup: QuoteTouchOutcome = { threw: false, error: undefined };
  try { await closer.detach(); } catch (error) { cleanup.threw = true; cleanup.error = error; }
  if (outcome.threw && cleanup.threw) throw new AggregateError([outcome.error, cleanup.error], 'QUOTE_INPUT_AND_DETACH');
  if (outcome.threw) throw quoteFailure(outcome.error);
  if (cleanup.threw) throw quoteFailure(cleanup.error);
}
// Some inherited test runners inspect truthiness; preserve falsey causes in a truthful error container.
function quoteFailure(reason: unknown): unknown { return reason || new AggregateError([reason], 'QUOTE_FALSEY_NATIVE_FAILURE'); }
