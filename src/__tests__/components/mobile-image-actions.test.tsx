// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  MobileImageActions,
  type MobileImageAction,
} from '@/components/canvas/mobile-image-actions';

function actions(): MobileImageAction[] {
  return [
    { id: 'preview', label: '预览', icon: <span>P</span>, onActivate: vi.fn() },
    { id: 'upscale', label: '放大', icon: <span>U</span>, onActivate: vi.fn() },
    { id: 'download', label: '下载', icon: <span>D</span>, onActivate: vi.fn() },
    { id: 'delete', label: '删除', icon: <span>X</span>, onActivate: vi.fn() },
  ];
}

describe('MobileImageActions', () => {
  it('keeps preview, download, and delete fixed while exposing every action in more', () => {
    const items = actions();
    render(<MobileImageActions actions={items} viewportWidth={320} />);

    expect(screen.getByRole('button', { name: '预览' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下载' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    for (const action of items) {
      expect(screen.getAllByRole('button', { name: action.label }).length).toBeGreaterThan(0);
    }
  });

  it('runs the original action once, closes the drawer, and returns focus to more', () => {
    const items = actions();
    render(<MobileImageActions actions={items} viewportWidth={320} />);
    const more = screen.getByRole('button', { name: '更多' });

    fireEvent.click(more);
    fireEvent.click(screen.getByRole('dialog', { name: '图片工具' }).querySelector('[data-mobile-image-action="upscale"]')!);

    expect(items[1].onActivate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '图片工具' })).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('isolates pointer and wheel events and does not overflow a 320px viewport', () => {
    const onPointerDown = vi.fn();
    const onWheel = vi.fn();
    const { container } = render(
      <div onPointerDown={onPointerDown} onWheel={onWheel}>
        <MobileImageActions actions={actions()} viewportWidth={320} />
      </div>,
    );
    const bar = container.querySelector('[data-mobile-image-actions]');
    expect(bar?.className).toContain('max-w-[calc(100vw-16px)]');
    if (!bar) return;

    fireEvent.pointerDown(bar);
    fireEvent.wheel(bar);
    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onWheel).not.toHaveBeenCalled();
  });
});


interface IntentFixture {
  items: MobileImageAction[];
  activated: string[];
  a(): HTMLButtonElement;
  b(): HTMLButtonElement;
  disableA(): void;
}
type IntentPointerKind = 'pointerdown' | 'pointerup' | 'pointercancel' | 'lostpointercapture' | 'click';
function intentPointer(
  target: Element,
  kind: IntentPointerKind,
  pointerId: number = 4,
  pointerType: 'touch' | 'mouse' = 'touch',
  isPrimary: boolean = true,
  detail: number = kind === 'click' ? 1 : 0,
): void {
  // Local event fields only: never patch window.PointerEvent or the app.
  const event = new MouseEvent(kind, { bubbles: true, cancelable: true, button: 0, detail });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
  });
  // MA did not observe click.isPrimary; do not invent it as a native fact.
  if (kind !== 'click') Object.defineProperty(event, 'isPrimary', { value: isPrimary });
  fireEvent(target, event);
}
function intentFixture(): IntentFixture {
  const activated: string[] = [];
  const items: MobileImageAction[] = [
    { id: 'preview', label: '预览', icon: <span>P</span>, onActivate: () => { activated.push('preview'); } },
    { id: 'add-reference-group', label: '加入参考图组', icon: <span>A</span>, onActivate: () => { activated.push('A'); } },
    { id: 'svg-trace', label: 'SVG智能描摹', icon: <span>B</span>, onActivate: () => { activated.push('B'); } },
    { id: 'download', label: '下载', icon: <span>D</span>, onActivate: () => { activated.push('download'); } },
    { id: 'delete', label: '删除', icon: <span>X</span>, onActivate: () => { activated.push('delete'); } },
  ];
  const view = render(<MobileImageActions actions={items} viewportWidth={390} />);
  const button = (id: string): HTMLButtonElement => {
    const value = screen.getByRole('dialog', { name: '图片工具' })
      .querySelector<HTMLButtonElement>('[data-mobile-image-action="' + id + '"]');
    if (!value) throw Error('INTENT_FIXTURE_ACTION_MISSING ' + id);
    return value;
  };
  fireEvent.click(screen.getByRole('button', { name: '更多' }));
  return {
    items, activated,
    a: () => button('add-reference-group'),
    b: () => button('svg-trace'),
    disableA: () => view.rerender(<MobileImageActions
      actions={items.map(item => item.id === 'add-reference-group'
        ? { ...item, disabled: true, description: '当前模型不支持参考图' } : item)}
      viewportWidth={390}
    />),
  };
}

describe('MobileImageActions pointer intent regression', () => {
  it('characterizes local pointer fields received by React capture, including the associated compatibility click', () => {
    const received: Array<{ kind: string; id: number; pointerType: string; primary?: boolean }> = [];
    render(<div
      onPointerDownCapture={(event: import('react').PointerEvent<HTMLDivElement>) => {
        received.push({ kind: event.type, id: event.pointerId, pointerType: event.pointerType, primary: event.isPrimary });
      }}
      onClickCapture={(event: import('react').MouseEvent<HTMLDivElement>) => {
        if (event.detail !== 1) return;
        const native = event.nativeEvent as PointerEvent;
        received.push({ kind: event.type, id: native.pointerId, pointerType: native.pointerType });
      }}
    ><MobileImageActions actions={actions()} viewportWidth={390} /></div>);
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    const button = screen.getByRole('dialog', { name: '图片工具' })
      .querySelector<HTMLButtonElement>('[data-mobile-image-action="upscale"]');
    if (!button) throw Error('INTENT_CHARACTERIZATION_ACTION_MISSING');
    intentPointer(button, 'pointerdown');
    intentPointer(button, 'pointerup');
    intentPointer(button, 'click');
    expect(received).toEqual([
      { kind: 'pointerdown', id: 4, pointerType: 'touch', primary: true },
      { kind: 'click', id: 4, pointerType: 'touch' },
    ]);
  });

  it('does not run a different action after the pressed action becomes disabled before its compatibility click', () => {
    const f = intentFixture();
    intentPointer(f.a(), 'pointerdown'); intentPointer(f.a(), 'pointerup');
    f.disableA();
    expect(f.a().disabled).toBe(true);
    intentPointer(f.b(), 'click');
    expect(f.activated).toEqual([]);
    expect(screen.getByRole('dialog', { name: '图片工具' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('当前模型不支持参考图');
  });

  it('does not bypass an associated touch intent merely because the click detail is zero', () => {
    const f = intentFixture();
    intentPointer(f.a(), 'pointerdown'); intentPointer(f.a(), 'pointerup');
    f.disableA();
    intentPointer(f.b(), 'click', 4, 'touch', true, 0);
    expect(f.activated).toEqual([]);
    expect(screen.getByRole('dialog', { name: '图片工具' })).toBeTruthy();
  });

  it('activates the same button once after release and normal automatic capture loss', () => {
    const f = intentFixture();
    intentPointer(f.a(), 'pointerdown'); intentPointer(f.a(), 'pointerup');
    intentPointer(f.a(), 'lostpointercapture'); intentPointer(f.a(), 'click');
    expect(f.activated).toEqual(['A']);
    expect(screen.queryByRole('dialog', { name: '图片工具' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '更多' }));
  });

  it('allows a valid same-target touch click with detail zero exactly once', () => {
    const f = intentFixture();
    intentPointer(f.a(), 'pointerdown'); intentPointer(f.a(), 'pointerup');
    intentPointer(f.a(), 'click', 4, 'touch', true, 0);
    expect(f.activated).toEqual(['A']);
    expect(screen.queryByRole('dialog', { name: '图片工具' })).toBeNull();
  });

  it('rejects a late touch click after pointer cancellation', () => {
    const f = intentFixture();
    intentPointer(f.a(), 'pointerdown'); intentPointer(f.a(), 'pointercancel');
    intentPointer(f.a(), 'click');
    expect(f.activated).toEqual([]);
    expect(screen.getByRole('dialog', { name: '图片工具' })).toBeTruthy();
  });

  it('rejects capture loss before release instead of treating it as an unassociated click', () => {
    const f = intentFixture();
    intentPointer(f.a(), 'pointerdown'); intentPointer(f.a(), 'lostpointercapture');
    intentPointer(f.a(), 'click');
    expect(f.activated).toEqual([]);
  });

  it('does not replace the first touch intent when another finger presses a different button', () => {
    const f = intentFixture();
    intentPointer(f.a(), 'pointerdown');
    intentPointer(f.b(), 'pointerdown', 5, 'touch', false);
    intentPointer(f.b(), 'pointerup', 5, 'touch', false); intentPointer(f.a(), 'pointerup');
    intentPointer(f.a(), 'click');
    expect(f.activated).toEqual([]);
    intentPointer(f.b(), 'pointerdown', 6); intentPointer(f.b(), 'pointerup', 6);
    intentPointer(f.b(), 'click', 6);
    expect(f.activated).toEqual(['B']);
  });

  it('recovers on the next new touch gesture after cancellation without reloading', () => {
    const f = intentFixture();
    intentPointer(f.a(), 'pointerdown'); intentPointer(f.a(), 'pointercancel');
    intentPointer(f.b(), 'pointerdown', 5); intentPointer(f.b(), 'pointerup', 5);
    intentPointer(f.b(), 'click', 5);
    expect(f.activated).toEqual(['B']);
  });

  it('requires the compatibility click to belong to the same pointer even on the same button', () => {
    const f = intentFixture();
    intentPointer(f.a(), 'pointerdown'); intentPointer(f.a(), 'pointerup');
    intentPointer(f.a(), 'click', 5);
    expect(f.activated).toEqual([]);
  });

  it('preserves genuine keyboard activation after a cancelled touch', () => {
    const f = intentFixture();
    intentPointer(f.a(), 'pointerdown'); intentPointer(f.a(), 'pointercancel');
    fireEvent.keyDown(f.b(), { key: 'Enter' });
    fireEvent.click(f.b(), { detail: 0 });
    expect(f.activated).toEqual(['B']);
  });

  it('preserves unassociated assistive detail-zero activation without inventing a pointer gesture', () => {
    const f = intentFixture();
    intentPointer(f.a(), 'pointerdown'); intentPointer(f.a(), 'pointercancel');
    fireEvent.click(f.b(), { detail: 0 });
    expect(f.activated).toEqual(['B']);
  });

  it('preserves normal same-button mouse activation', () => {
    const f = intentFixture();
    intentPointer(f.a(), 'pointerdown', 1, 'mouse');
    intentPointer(f.a(), 'pointerup', 1, 'mouse'); intentPointer(f.a(), 'click', 1, 'mouse');
    expect(f.activated).toEqual(['A']);
  });

  it('does not execute a pending touch after the window loses focus', () => {
    const f = intentFixture();
    intentPointer(f.a(), 'pointerdown');
    fireEvent(window, new Event('blur'));
    intentPointer(f.a(), 'pointerup'); intentPointer(f.a(), 'click');
    expect(f.activated).toEqual([]);
  });

  it('rejects the old drawer gesture after close and reopen, then accepts a fresh touch', () => {
    const f = intentFixture();
    intentPointer(f.a(), 'pointerdown'); intentPointer(f.a(), 'pointerup');
    fireEvent.click(screen.getByRole('button', { name: '关闭图片工具' }));
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    intentPointer(f.a(), 'click');
    expect(f.activated).toEqual([]);
    intentPointer(f.b(), 'pointerdown', 5); intentPointer(f.b(), 'pointerup', 5);
    intentPointer(f.b(), 'click', 5);
    expect(f.activated).toEqual(['B']);
  });
});

it('MobileImageActions accepts a fresh same-pointer press after release outside the drawer', () => {
  const f = intentFixture();
  intentPointer(f.a(), 'pointerdown', 1, 'mouse');
  intentPointer(document.body, 'pointerup', 1, 'mouse');
  intentPointer(f.b(), 'pointerdown', 1, 'mouse');
  intentPointer(f.b(), 'pointerup', 1, 'mouse');
  intentPointer(f.b(), 'click', 1, 'mouse');
  expect(f.activated).toEqual(['B']);
  expect(screen.queryByRole('dialog', { name: '图片工具' })).toBeNull();
});


function incompleteIntentClick(target: HTMLButtonElement, missing: 'pointerId' | 'pointerType'): {
  pointerId: number | undefined; pointerType: string | undefined;
} {
  let observed: { pointerId: number | undefined; pointerType: string | undefined } | undefined;
  const capture = (event: Event): void => {
    const native = event as MouseEvent & Partial<Pick<PointerEvent, 'pointerId' | 'pointerType'>>;
    observed = { pointerId: native.pointerId, pointerType: native.pointerType };
  };
  const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 });
  if (missing !== 'pointerId') Object.defineProperty(click, 'pointerId', { value: 4 });
  if (missing !== 'pointerType') Object.defineProperty(click, 'pointerType', { value: 'touch' });
  // Read native delivery before the component capture guard; never patch globals.
  document.addEventListener('click', capture, { capture: true, once: true });
  try { fireEvent(target, click); }
  finally { document.removeEventListener('click', capture, true); }
  if (!observed) throw Error('INTENT_FIXTURE_INCOMPLETE_CLICK_NOT_OBSERVED');
  return observed;
}
it('MobileImageActions rejects a same-target touch click missing its pointer identity', () => {
  const f = intentFixture();
  intentPointer(f.a(), 'pointerdown'); intentPointer(f.a(), 'pointerup');
  expect(incompleteIntentClick(f.a(), 'pointerId')).toEqual({ pointerId: undefined, pointerType: 'touch' });
  expect(f.activated).toEqual([]);
  expect(screen.getByRole('dialog', { name: '图片工具' })).toBeTruthy();
});
it('MobileImageActions rejects a same-target physical click missing its pointer type', () => {
  const f = intentFixture();
  intentPointer(f.a(), 'pointerdown'); intentPointer(f.a(), 'pointerup');
  expect(incompleteIntentClick(f.a(), 'pointerType')).toEqual({ pointerId: 4, pointerType: undefined });
  expect(f.activated).toEqual([]);
  expect(screen.getByRole('dialog', { name: '图片工具' })).toBeTruthy();
});


function legacyIntentClick(target: HTMLButtonElement): void {
  let observed: { hasId: boolean; hasType: boolean } | undefined;
  const capture = (event: Event): void => {
    observed = { hasId: 'pointerId' in event, hasType: 'pointerType' in event };
  };
  document.addEventListener('click', capture, { capture: true, once: true });
  try { fireEvent(target, new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 })); }
  finally { document.removeEventListener('click', capture, true); }
  expect(observed).toEqual({ hasId: false, hasType: false });
}
function legacyMouseDown(target: HTMLButtonElement): void {
  fireEvent.mouseDown(target, { button: 0, detail: 1 });
}
function legacyMouseUp(target: HTMLButtonElement): void {
  fireEvent.mouseUp(target, { button: 0, detail: 1 });
}
function completeLegacyWitness(f: IntentFixture, delayed: boolean = false): void {
  intentPointer(f.a(), 'pointerdown');
  if (!delayed) legacyMouseDown(f.a());
  intentPointer(f.a(), 'pointerup');
  if (delayed) legacyMouseDown(f.a());
  legacyMouseUp(f.a());
}
const legacyIncompleteSequences = [
  { name: 'no mouse witnesses', down: null, up: null },
  { name: 'mouse-down only', down: 'A', up: null },
  { name: 'mouse-up only', down: null, up: 'A' },
  { name: 'wrong mouse-down target', down: 'B', up: 'A' },
  { name: 'wrong mouse-up target', down: 'A', up: 'B' },
] as const;
for (const sequence of legacyIncompleteSequences) {
  it('MobileImageActions legacy rejects ' + sequence.name + ' on the same intended button', () => {
    const f = intentFixture();
    intentPointer(f.a(), 'pointerdown');
    if (sequence.down) legacyMouseDown(sequence.down === 'A' ? f.a() : f.b());
    intentPointer(f.a(), 'pointerup');
    if (sequence.up) legacyMouseUp(sequence.up === 'A' ? f.a() : f.b());
    legacyIntentClick(f.a());
    expect(f.activated).toEqual([]);
    expect(screen.getByRole('dialog', { name: '图片工具' })).toBeTruthy();
  });
}
for (const delayed of [false, true]) {
  it('MobileImageActions legacy accepts one complete ' + (delayed ? 'delayed' : 'normal') + ' same-intent sequence', () => {
    const f = intentFixture();
    completeLegacyWitness(f, delayed);
    legacyIntentClick(f.a());
    expect(f.activated).toEqual(['A']);
    expect(screen.queryByRole('dialog', { name: '图片工具' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '更多' }));
  });
}
const legacyInvalidations = [
  { name: 'new intent instance', before: [], afterRecovery: ['A'] },
  { name: 'cancel', before: [], afterRecovery: ['A'] },
  { name: 'another finger', before: [], afterRecovery: ['A'] },
  { name: 'window blur', before: [], afterRecovery: ['A'] },
  { name: 'close and reopen', before: [], afterRecovery: ['A'] },
] as const;
for (const entry of legacyInvalidations) {
  it('MobileImageActions legacy invalidates old witnesses on ' + entry.name + ' and allows a fresh complete gesture', () => {
    const f = intentFixture();
    completeLegacyWitness(f);
    if (entry.name === 'new intent instance') {
      intentPointer(f.a(), 'pointerdown'); intentPointer(f.a(), 'pointerup');
    } else if (entry.name === 'cancel') {
      intentPointer(f.a(), 'pointercancel');
    } else if (entry.name === 'another finger') {
      intentPointer(f.b(), 'pointerdown', 5, 'touch', false);
      intentPointer(f.b(), 'pointerup', 5, 'touch', false);
    } else if (entry.name === 'window blur') {
      fireEvent(window, new Event('blur'));
    } else if (entry.name === 'close and reopen') {
      fireEvent.click(screen.getByRole('button', { name: '关闭图片工具' }));
      fireEvent.click(screen.getByRole('button', { name: '更多' }));
    }
    legacyIntentClick(f.a());
    expect(f.activated).toEqual(entry.before);
    expect(screen.getByRole('dialog', { name: '图片工具' })).toBeTruthy();
    completeLegacyWitness(f, true);
    legacyIntentClick(f.a());
    expect(f.activated).toEqual(entry.afterRecovery);
    expect(screen.queryByRole('dialog', { name: '图片工具' })).toBeNull();
  });
}

it('MobileImageActions legacy consumes a gesture before its callback can synchronously click again', () => {
  const activated: string[] = [];
  let nested = false;
  const button = (): HTMLButtonElement => {
    const value = screen.getByRole('dialog', { name: '图片工具' })
      .querySelector<HTMLButtonElement>('[data-mobile-image-action="upscale"]');
    if (!value) throw Error('LEGACY_CONSUMPTION_ACTION_MISSING');
    return value;
  };
  const items: MobileImageAction[] = actions().map((item: MobileImageAction): MobileImageAction => item.id === 'upscale'
    ? { ...item, onActivate: (): void => {
      activated.push('A');
      if (!nested) {
        nested = true;
        // The outer onActivate has not returned, so closeDrawer has not run.
        expect(screen.getByRole('dialog', { name: '图片工具' })).toBeTruthy();
        legacyIntentClick(button());
      }
    } } : item);
  render(<MobileImageActions actions={items} viewportWidth={390} />);
  fireEvent.click(screen.getByRole('button', { name: '更多' }));
  intentPointer(button(), 'pointerdown'); legacyMouseDown(button());
  intentPointer(button(), 'pointerup'); legacyMouseUp(button());
  legacyIntentClick(button());
  expect(nested).toBe(true);
  expect(activated).toEqual(['A']);
  expect(screen.queryByRole('dialog', { name: '图片工具' })).toBeNull();
});



