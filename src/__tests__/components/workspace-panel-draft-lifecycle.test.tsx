// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act, useCallback, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ts from 'typescript';
import { afterEach, expect, it } from 'vitest';
import { shouldInitiallyCollapseWorkspacePanel, WORKSPACE_PANEL_RAIL_WIDTH } from '@/lib/workspace-panel-layout';
import { workspacePanelProbeSource } from '../helpers/workspace-panel-lifecycle';

// Regression: removing the retained child or its hidden/inert boundary must
// fail these cases. Synthetic child state, not real accounts or model calls.
const source = readFileSync(path.resolve('src/components/canvas-workspace.tsx'), 'utf8');
const compiled = ts.transpileModule(workspacePanelProbeSource(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
}).outputText;
interface HostProps { actorId?: string; projectId?: string }
let activeRoot: Root | undefined;
let container: HTMLDivElement | undefined;
const actScope = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalAct = actScope.IS_REACT_ACT_ENVIRONMENT;
afterEach(async (): Promise<void> => {
  try { if (activeRoot) await act(async () => activeRoot?.unmount()); }
  finally { activeRoot = undefined; container?.remove(); container = undefined;
    actScope.IS_REACT_ACT_ENVIRONMENT = originalAct; }
});
async function setup(width: number): Promise<{
  counts: { mounts: number; unmounts: number };
  click(selector: string): Promise<void>;
  draft(): HTMLInputElement | null;
  boundary(): HTMLDivElement | null;
  render(props: HostProps): Promise<void>;
}> {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  actScope.IS_REACT_ACT_ENVIRONMENT = true;
  const counts = { mounts: 0, unmounts: 0 };
  function DraftProbe(): React.ReactElement {
    const [value, setValue] = useState('');
    useEffect(() => { counts.mounts++; return (): void => { counts.unmounts++; }; }, []);
    return <><input data-draft value={value} readOnly />
      <button data-seed onClick={() => setValue('unsent sketch and chat draft')}>seed</button></>;
  }
  const icon = (): React.ReactElement => <span />;
  const Host = new Function('React', 'useState', 'useEffect', 'useCallback',
    'shouldInitiallyCollapseWorkspacePanel', 'WORKSPACE_PANEL_RAIL_WIDTH', 'themeStyle',
    'DraftProbe', 'ChevronLeft', 'ChevronRight', compiled + '\nreturn Host;')(
    React, useState, useEffect, useCallback, shouldInitiallyCollapseWorkspacePanel,
    WORKSPACE_PANEL_RAIL_WIDTH, 'gold', DraftProbe, icon, icon,
  ) as React.ComponentType<HostProps>;
  container = document.createElement('div'); document.body.append(container);
  activeRoot = createRoot(container);
  const render = async (props: HostProps): Promise<void> => {
    await act(async () => activeRoot?.render(<Host {...props} />));
  };
  await render({});
  return { counts, render,
    click: async (selector: string): Promise<void> => {
      const button = container?.querySelector<HTMLButtonElement>(selector);
      expect(button, selector).not.toBeNull(); await act(async () => button?.click());
    },
    draft: () => container?.querySelector<HTMLInputElement>('[data-draft]') ?? null,
    boundary: () => container?.querySelector<HTMLDivElement>('[data-workspace-right-panel] > div') ?? null,
  };
}
const toggle = '[data-workspace-right-panel] > button';
function observeEffect(filename: string, event: string, scope: Record<string, unknown>): () => void {
  const text = readFileSync(path.resolve(filename), 'utf8');
  const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect'
      && node.getText(file).includes("addEventListener('" + event + "'")) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file); if (matches.length !== 1) throw Error('PANEL_EVENT_EFFECT:' + event);
  const code = ts.transpileModule(matches[0].getText(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  let cleanup: (() => void) | undefined;
  new Function('useEffect', ...Object.keys(scope), code)(
    (setup: () => void | (() => void)): void => { const result = setup(); if (result) cleanup = result; },
    ...Object.values(scope),
  );
  return (): void => { cleanup?.(); };
}
for (const isVisible of [true, false]) {
  it('responds to the global generate event only when the generation panel is visible=' + isVisible, (): void => {
    let calls = 0;
    const cleanup = observeEffect('src/components/generation-panel.tsx', 'trigger-generate', {
      document, isVisible, handleGenerateRef: { current: (): void => { calls++; } },
    });
    try { document.dispatchEvent(new Event('trigger-generate')); expect(calls).toBe(isVisible ? 1 : 0); }
    finally { cleanup(); }
    document.dispatchEvent(new Event('trigger-generate')); expect(calls).toBe(isVisible ? 1 : 0);
  });
  it('does not intercept image paste in the canvas when the chat panel is visible=' + isVisible, (): void => {
    let reads = 0;
    class OwnedReader { readAsDataURL(): void { reads++; } }
    const cleanup = observeEffect('src/components/chat-panel.tsx', 'paste', {
      document, isVisible, activeTab: 'chat', chatContainerRef: { current: document.createElement('div') },
      FileReader: OwnedReader, setPendingImages: (): void => { throw Error('NO_READER_CALLBACK_EXPECTED'); },
    });
    const paste = new Event('paste', { cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { items: [{ type: 'image/png', getAsFile: (): File => new File(['owned'], 'owned.png') }] } });
    try { document.dispatchEvent(paste); expect(reads).toBe(isVisible ? 1 : 0); expect(paste.defaultPrevented).toBe(isVisible); }
    finally { cleanup(); }
  });
}
it('does not mount hidden mobile children before the first expansion', async (): Promise<void> => {
  const ui = await setup(390);
  expect(ui.draft()).toBeNull(); expect(ui.counts).toEqual({ mounts: 0, unmounts: 0 });
  await ui.click('[data-activate]');
  expect(ui.draft()).toBeNull(); expect(ui.counts.mounts).toBe(0);
});
for (const width of [390, 768]) {
  it('retains child-owned draft across manual hide and restore at ' + width + 'px', async (): Promise<void> => {
    const ui = await setup(width);
    if (width === 390) await ui.click(toggle);
    await ui.click('[data-seed]'); const original = ui.draft();
    await ui.click(toggle); await ui.click(toggle);
    expect(ui.draft()).toBe(original);
    expect(ui.draft()?.value).toBe('unsent sketch and chat draft');
    expect(ui.counts).toEqual({ mounts: 1, unmounts: 0 });
  });
}
it('retains the same draft node through repeated accepted mobile handoffs', async (): Promise<void> => {
  const ui = await setup(390); await ui.click(toggle); await ui.click('[data-seed]');
  const original = ui.draft();
  for (let index = 0; index < 2; index++) {
    await ui.click('[data-activate]');
    expect(ui.boundary()?.style.display).toBe('none');
    expect(ui.boundary()?.getAttribute('aria-hidden')).toBe('true');
    expect(ui.boundary()?.hasAttribute('inert')).toBe(true);
    await ui.click(toggle);
    expect(ui.boundary()?.style.display).not.toBe('none');
    expect(ui.boundary()?.hasAttribute('inert')).toBe(false);
    expect(ui.draft()).toBe(original);
    expect(ui.draft()?.value).toBe('unsent sketch and chat draft');
  }
  expect(ui.counts).toEqual({ mounts: 1, unmounts: 0 });
});
for (const next of [{ actorId: 'actor-b' }, { projectId: 'project-b' }]) {
  it('does not carry a retained draft across ' + Object.keys(next)[0], async (): Promise<void> => {
    const ui = await setup(390); await ui.click(toggle); await ui.click('[data-seed]');
    await ui.click('[data-activate]'); await ui.render(next); await ui.click(toggle);
    expect(ui.draft()?.value).toBe('');
    expect(ui.counts.unmounts).toBe(1);
  });
}
