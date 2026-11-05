import { it as test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { swipeQuoteList, finishQuoteTouchSession, type QuoteTouchCommand, type QuoteTouchList, type QuoteTouchPage, type QuoteTouchPoint, type QuoteTouchTransport } from './quote-touch-input';

interface FixtureOptions { fail?: 'touchStart' | 'touchMove' | 'touchEnd'; inputError?: unknown; failCancel?: boolean; cancelError?: unknown; hit?: boolean }
interface Fixture { transport: QuoteTouchTransport; page: QuoteTouchPage; list: QuoteTouchList; calls: { method: string; command: QuoteTouchCommand }[]; frames(): number; primary: unknown; cleanup: unknown }
function fixture(options: FixtureOptions = {}): Fixture {
  const calls: Fixture['calls'] = []; let frames = 0;
  const primary = Object.hasOwn(options, 'inputError') ? options.inputError : new Error('native input');
  const cleanup = Object.hasOwn(options, 'cancelError') ? options.cancelError : new Error('touch cancel');
  const transport: QuoteTouchTransport = { async send(method: 'Input.dispatchTouchEvent', command: QuoteTouchCommand): Promise<unknown> {
    calls.push({ method, command });
    if (command.type === options.fail) throw primary;
    if (options.failCancel && command.type === 'touchCancel') throw cleanup;
    return {};
  } };
  const content = {}, other = {}, element = { contains: (target: unknown): boolean => target === content };
  const list: QuoteTouchList = { async evaluate(callback: (element: Element, position: QuoteTouchPoint) => boolean, point: QuoteTouchPoint): Promise<boolean> {
    return vm.runInNewContext('(' + callback.toString() + ')(element,point)', { element, point, document: { elementFromPoint: (): object => options.hit === false ? other : content } }) as boolean;
  } };
  const page: QuoteTouchPage = { viewportSize: (): { width: number; height: number } => ({ width: 390, height: 844 }), async evaluate(): Promise<void> { frames++; } };
  return { transport, page, list, calls, frames: (): number => frames, primary, cleanup };
}
test('native quote input sends a bounded twelve-move touch sequence, not a DOM click', async (): Promise<void> => {
  const f = fixture(); await swipeQuoteList(f.transport, f.page, f.list, { x: 195, y: 417 });
  assert.equal(f.calls.length, 14); assert.equal(f.frames(), 12);
  assert.ok(f.calls.every(call => call.method === 'Input.dispatchTouchEvent'));
  assert.deepEqual(f.calls[0].command, { type: 'touchStart', touchPoints: [{ x: 195, y: 417, id: 1, force: 1 }] });
  assert.deepEqual(f.calls.at(-2)?.command, { type: 'touchMove', touchPoints: [{ x: 195, y: 197, id: 1, force: 1 }] });
  assert.deepEqual(f.calls.at(-1)?.command, { type: 'touchEnd', touchPoints: [] });
});
test('short-screen native quote input keeps its endpoint inside the viewport', async (): Promise<void> => {
  const f = fixture(); await swipeQuoteList(f.transport, f.page, f.list, { x: 195, y: 140 });
  assert.equal(f.calls.length, 14); assert.equal(f.calls.at(-2)?.command.touchPoints[0].y, 8);
  assert.ok(f.calls.filter(call => call.command.type === 'touchMove').every(call => call.command.touchPoints[0].y >= 8));
});
test('another dialog list cannot satisfy the actual quote-list hit boundary', async (): Promise<void> => {
  const f = fixture({ hit: false }); await assert.rejects(() => swipeQuoteList(f.transport, f.page, f.list, { x: 195, y: 417 }), /QUOTE_TOUCH_START_HIT/); assert.equal(f.calls.length, 0);
});
test('an invalid native quote start point fails before any input', async (): Promise<void> => {
  const f = fixture(); await assert.rejects(() => swipeQuoteList(f.transport, f.page, f.list, { x: 391, y: 417 }), /QUOTE_TOUCH_POINT/); assert.equal(f.calls.length, 0);
});
test('move failure cancels active touch and retains the original error', async (): Promise<void> => {
  const f = fixture({ fail: 'touchMove' }); await assert.rejects(() => swipeQuoteList(f.transport, f.page, f.list, { x: 195, y: 417 }), (error: unknown): boolean => error === f.primary); assert.equal(f.calls.at(-1)?.command.type, 'touchCancel');
});
test('move and cancellation failures preserve both causes in order', async (): Promise<void> => {
  const f = fixture({ fail: 'touchMove', failCancel: true }); await assert.rejects(() => swipeQuoteList(f.transport, f.page, f.list, { x: 195, y: 417 }), (error: unknown): boolean => error instanceof AggregateError && error.errors[0] === f.primary && error.errors[1] === f.cleanup);
});
test('a rejected touch start still attempts cancellation', async (): Promise<void> => {
  const f = fixture({ fail: 'touchStart' }); await assert.rejects(() => swipeQuoteList(f.transport, f.page, f.list, { x: 195, y: 417 }), (error: unknown): boolean => error === f.primary); assert.equal(f.calls.at(-1)?.command.type, 'touchCancel');
});
test('a rejected touch end still attempts cancellation', async (): Promise<void> => {
  const f = fixture({ fail: 'touchEnd' }); await assert.rejects(() => swipeQuoteList(f.transport, f.page, f.list, { x: 195, y: 417 }), (error: unknown): boolean => error === f.primary); assert.equal(f.calls.at(-1)?.command.type, 'touchCancel');
});
test('finishing native quote touch detaches the session', async (): Promise<void> => {
  let detached = false; await finishQuoteTouchSession({ async detach(): Promise<void> { detached = true; } }, { threw: false, error: undefined }); assert.equal(detached, true);
});
test('input and detach failures are both retained after independent detach attempt', async (): Promise<void> => {
  const primary = new Error('input'), cleanup = new Error('detach'); let detached = false;
  await assert.rejects(() => finishQuoteTouchSession({ async detach(): Promise<void> { detached = true; throw cleanup; } }, { threw: true, error: primary }), (error: unknown): boolean => error instanceof AggregateError && error.errors[0] === primary && error.errors[1] === cleanup); assert.equal(detached, true);
});
test('falsey input and cancel causes keep their original ordered values', async (): Promise<void> => {
  const f = fixture({ fail: 'touchMove', inputError: undefined, failCancel: true, cancelError: null });
  await assert.rejects(() => swipeQuoteList(f.transport, f.page, f.list, { x: 195, y: 417 }), (error: unknown): boolean => error instanceof AggregateError && error.errors.length === 2 && error.errors[0] === undefined && error.errors[1] === null);
});
test('falsey input survives successful detach as a non-falsey failure', async (): Promise<void> => {
  await assert.rejects(() => finishQuoteTouchSession({ async detach(): Promise<void> {} }, { threw: true, error: undefined }), (error: unknown): boolean => error instanceof AggregateError && error.errors.length === 1 && error.errors[0] === undefined);
});

const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');
const original = fs.readFileSync(path.resolve('src/__tests__/components/node-skill-quote-mobile-native.test.tsx'), 'utf8');
const begin = original.indexOf('async function withSession('), end = original.indexOf('function toolbar(', begin);
assert.ok(begin >= 0 && end > begin);
const actualWrapper = ts.transpileModule(original.slice(begin, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
interface SessionWrapper { (theme: string, width: number, height: number, options: object, run: () => Promise<void>): Promise<void> }
for (const value of [undefined, null, false, 0, '']) for (const seam of ['input', 'detach']) {
  test('actual quote-session wrapper retains ' + seam + ' falsey reason ' + (value === '' ? 'empty-string' : String(value)), async (): Promise<void> => {
    let disposed = 0, continued = false;
    const withSession = vm.runInNewContext(actualWrapper + '; withSession', { session: async (): Promise<object> => ({}), dispose: async (): Promise<void> => { disposed++; }, AggregateError }) as SessionWrapper;
    await assert.rejects(() => withSession('gold', 390, 844, { quoteCount: 12 }, async (): Promise<void> => {
      if (seam === 'input') { const f = fixture({ fail: 'touchMove', inputError: value }); await swipeQuoteList(f.transport, f.page, f.list, { x: 195, y: 417 }); }
      else await finishQuoteTouchSession({ async detach(): Promise<void> { throw value; } }, { threw: false, error: undefined });
      continued = true;
    }), (error: unknown): boolean => error instanceof AggregateError && error.errors.length === 1 && Object.is(error.errors[0], value));
    assert.equal(disposed, 1); assert.equal(continued, false);
  });
}
