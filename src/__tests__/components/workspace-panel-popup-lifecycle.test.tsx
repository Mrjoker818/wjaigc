// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act, useCallback, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { installJsdomMediaQueries, runJsdomFixtureCleanup } from '../helpers/jsdom-browser-apis';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { shouldInitiallyCollapseWorkspacePanel, WORKSPACE_PANEL_RAIL_WIDTH } from '@/lib/workspace-panel-layout';
import { panelPopupRootProps, panelPortalProbeSource, panelEscapeEffect } from '../helpers/workspace-panel-popups';
import { workspacePanelProbeSource } from '../helpers/workspace-panel-lifecycle';

const source = readFileSync(path.resolve('src/components/chat-panel.tsx'), 'utf8');
const actScope = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const oldAct = actScope.IS_REACT_ACT_ENVIRONMENT;
let root: Root | undefined, container: HTMLDivElement | undefined;
let outside: HTMLButtonElement | undefined;
const oldScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
const oldWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
afterEach(async (): Promise<void> => {
  try { if (root) await act(async () => root?.unmount()); await settleOriginalClose(); }
  finally { root = undefined; container?.remove(); container = undefined; outside?.remove(); outside = undefined;
    if (oldScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', oldScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    if (oldWidth) Object.defineProperty(window, 'innerWidth', oldWidth);
    actScope.IS_REACT_ACT_ENVIRONMENT = oldAct; }
});
function mount(): void {
  actScope.IS_REACT_ACT_ENVIRONMENT = true;
  // Private JSDOM has no layout/scroll implementation. This is only a missing
  // layout-method adapter, not a lock/focus/ARIA cleanup or a native gesture proof.
  if (!oldScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: (): void => {} });
  outside = document.createElement('button'); outside.textContent = 'owned outside'; document.body.append(outside); outside.focus();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
}
async function settleOriginalClose(): Promise<void> {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function openThroughActualTrigger(): Promise<void> {
  const trigger = container?.querySelector('button'); expect(trigger).not.toBeNull();
  expect(trigger?.getAttribute('data-state')).toBe('closed');
  await act(async () => trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
}
function readGlobalState(): unknown[] {
  return [document.body.style.pointerEvents, document.body.getAttribute('data-scroll-locked'),
    container?.getAttribute('aria-hidden'), outside?.getAttribute('aria-hidden')];
}

// Run the actual controlled state and hide/short-screen effect, not a forced open prop.
const useSourceAgentPickerState = (() => {
  const file = ts.createSourceFile('chat-panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const states = new Map<string, ts.VariableStatement[]>();
  const effects: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isArrayBindingPattern(declaration.name)) {
          const first = declaration.name.elements[0];
          if (first && ts.isBindingElement(first) && ts.isIdentifier(first.name)
            && ['agentPickerOpen', 'compactControlsOpen'].includes(first.name.text)) {
            const found = states.get(first.name.text) ?? []; found.push(node); states.set(first.name.text, found);
          }
        }
      }
    }
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect'
      && node.getText(file).includes('closeUnavailableAgentPicker')) effects.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const declarations = ['compactControlsOpen', 'agentPickerOpen'].map(name => {
    const matches = states.get(name); if (matches?.length !== 1) throw new Error('AGENT_PICKER_STATE_UNIQUE:' + name);
    return matches[0].getText(file);
  });
  if (effects.length !== 1) throw new Error('AGENT_PICKER_EFFECT_UNIQUE');
  const code = ['function useAgentPickerState(isVisible) {', ...declarations, effects[0].getText(file), ';return {agentPickerOpen,setAgentPickerOpen};}'].join(String.fromCharCode(10));
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true });
  if (compiled.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error('AGENT_PICKER_STATE_SYNTAX');
  return new Function('useState', 'useEffect', compiled.outputText + '\nreturn useAgentPickerState;')(useState, useEffect) as (isVisible: boolean) => Record<string, unknown>;
})();
let restoreMediaApis: (() => void) | undefined;
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
beforeEach((): void => { restoreMediaApis = installJsdomMediaQueries(window, { colorScheme: 'light', reducedMotion: false }); });
afterEach((): void => {
  runJsdomFixtureCleanup([(): void => { const restore = restoreMediaApis; restoreMediaApis = undefined; restore?.(); }]);
  expect(Object.getOwnPropertyDescriptor(window, 'matchMedia')).toEqual(originalMatchMedia);
  expect(document.querySelector('[role="menu"], [role="listbox"]')).toBeNull();
  expect(document.body.style.pointerEvents).not.toBe('none');
  expect(document.body.getAttribute('data-scroll-locked')).toBeNull();
});

const bindingScope = (isVisible: boolean): Record<string, unknown> => ({ isVisible, model: 'owned-model', setModel: vi.fn() });
// Each actual source menu root is tested, not a single representative. The
// original keyboard trigger opens the transient root; no forced defaultOpen,
// model/task callback, synthetic successful result or native touch claim.
for (const index of [0, 1, 2, 3, 4]) {
  it('releases popup and body pointer lock when chat dropdown ' + index + ' becomes hidden', async (): Promise<void> => {
    mount(); const before = readGlobalState();
    function SourceDropdownProbe({ isVisible }: { isVisible: boolean }): React.ReactElement {
      const props = panelPopupRootProps(source, 'DropdownMenu', index, { ...bindingScope(isVisible), ...useSourceAgentPickerState(isVisible) });
      const { key, ...attributes } = props;
      return (<div style={{ display: isVisible ? undefined : 'none' }} inert={!isVisible}>
        <DropdownMenu key={key as React.Key | undefined} {...attributes}>
        <DropdownMenuTrigger>owned menu</DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuItem>owned action</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu></div>);
    }
    const render = async (isVisible: boolean): Promise<void> => {
      await act(async () => root?.render(<SourceDropdownProbe isVisible={isVisible} />));
    };
    await render(true);
    await openThroughActualTrigger();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(document.body.style.pointerEvents).toBe('none');
    await render(false);
    await settleOriginalClose();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(readGlobalState()).toEqual(before);
    expect(container?.contains(document.activeElement)).toBe(false);
    await render(true);
    expect(container?.querySelector('button')?.getAttribute('data-state')).toBe('closed');
  });
}
it('closes the chat model Select root on hide without changing its selected value', async (): Promise<void> => {
  mount(); const before = readGlobalState(), setModel = vi.fn();
  const render = async (isVisible: boolean): Promise<void> => {
    const props = panelPopupRootProps(source, 'Select', 0, { ...bindingScope(isVisible), setModel });
    const { key, ...attributes } = props;
    await act(async () => root?.render(<div style={{ display: isVisible ? undefined : 'none' }} inert={!isVisible}>
      <Select key={key as React.Key | undefined} {...attributes}>
      <SelectTrigger><SelectValue placeholder="owned-model" /></SelectTrigger>
      <SelectContent position="popper"><SelectItem value="owned-model">owned-model</SelectItem></SelectContent>
    </Select></div>));
  };
  await render(true); await openThroughActualTrigger();
  expect(container?.querySelector('button')?.getAttribute('data-state')).toBe('open');
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  await render(false); await settleOriginalClose();
  expect(container?.querySelector('button')?.getAttribute('data-state')).toBe('closed');
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(readGlobalState()).toEqual(before); expect(container?.contains(document.activeElement)).toBe(false);
  expect(setModel).not.toHaveBeenCalled();
  expect(panelPopupRootProps(source, 'Select', 0, bindingScope(false)).value).toBe('owned-model');
  await render(true); expect(container?.querySelector('button')?.getAttribute('data-state')).toBe('closed');
  expect(setModel).not.toHaveBeenCalled();
});
it('ignores Escape for an open but inactive third-party form without invoking close', (): void => {
  let cleanup: (() => void) | undefined; const close = vi.fn();
  const code = panelEscapeEffect(readFileSync(path.resolve('src/components/third-party-model-dialog.tsx'), 'utf8'));
  new Function('useEffect', 'window', 'isOpen', 'interactive', 'onClose', code)(
    (setup: () => void | (() => void)): void => { const next = setup(); if (next) cleanup = next; },
    window, true, false, close,
  );
  try {
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }); window.dispatchEvent(event);
    expect(close).not.toHaveBeenCalled(); expect(event.defaultPrevented).toBe(false);
  } finally { cleanup?.(); }
});
for (const disposeFirst of [false, true]) {
  it('third-party Escape lifecycle responds only while visible and subscribed disposeFirst=' + disposeFirst, (): void => {
    let cleanup: (() => void) | undefined; const close = vi.fn();
    const code = panelEscapeEffect(readFileSync(path.resolve('src/components/third-party-model-dialog.tsx'), 'utf8'));
    new Function('useEffect', 'window', 'isOpen', 'interactive', 'onClose', code)(
      (setup: () => void | (() => void)): void => { const next = setup(); if (next) cleanup = next; },
      window, true, true, close,
    );
    try {
      if (disposeFirst) cleanup?.();
      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }); window.dispatchEvent(event);
      expect(close).toHaveBeenCalledTimes(disposeFirst ? 0 : 1); expect(event.defaultPrevented).toBe(!disposeFirst);
    } finally { cleanup?.(); }
  });
}
for (const child of ['AgentBuilderDialog', 'MultiPlatformExportDrawer']) {
  it('hides ' + child + ' portal while retaining its child draft and actual open state', async (): Promise<void> => {
    mount(); const opens: boolean[] = []; const lifecycle = { mounts: 0, unmounts: 0 };
    function Leaf({ open }: { open: boolean }): React.ReactElement {
      const [draft, setDraft] = useState(''); opens.push(open);
      useEffect(() => { lifecycle.mounts++; return (): void => { lifecycle.unmounts++; }; }, []);
      return <div data-portal-child><input data-child-draft value={draft} readOnly />
        <button onClick={() => setDraft('unsent dialog values')}>seed</button></div>;
    }
    const PortalProbe = new Function('React', 'Leaf', 'createPortal', 'document', 'showAgentBuilder', 'portalReady',
      'activeSkill', 'MULTI_PLATFORM_EXPORT_SKILL_ID', 'projectId', panelPortalProbeSource(source, child) + '\nreturn PortalProbe;')(
      React, Leaf, createPortal, document, true, true, { id: 'owned-export' }, 'owned-export', 'owned-project',
    ) as React.ComponentType<{ isVisible: boolean }>;
    const render = async (isVisible: boolean): Promise<void> => {
      await act(async () => root?.render(<PortalProbe isVisible={isVisible} />));
    };
    await render(true);
    const leaf = document.querySelector<HTMLElement>('[data-portal-child]');
    expect(leaf).not.toBeNull(); expect(container?.contains(leaf ?? null)).toBe(false);
    await act(async () => leaf?.querySelector('button')?.click());
    const input = leaf?.querySelector<HTMLInputElement>('[data-child-draft]');
    const wrapper = leaf?.parentElement;
    expect(input?.value).toBe('unsent dialog values');
    await render(false);
    const hidden = leaf?.closest<HTMLElement>('[data-workspace-panel-portal]');
    expect(leaf?.parentElement).toBe(wrapper);
    expect(hidden?.style.display).toBe('none'); expect(hidden?.getAttribute('aria-hidden')).toBe('true');
    expect(hidden?.contains(input ?? null)).toBe(true); expect(opens.every(Boolean)).toBe(true);
    await render(true);
    expect(document.querySelector('[data-child-draft]')).toBe(input);
    expect(input?.value).toBe('unsent dialog values'); expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });
  });
}
for (const next of [{ actorId: 'actor-b' }, { projectId: 'project-b' }]) {
  it('does not eagerly mount a newly hidden scope after ' + Object.keys(next)[0] + ' changes', async (): Promise<void> => {
    mount(); Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    const lifecycle = { mounts: 0, unmounts: 0 };
    function DraftProbe(): React.ReactElement {
      useEffect(() => { lifecycle.mounts++; return (): void => { lifecycle.unmounts++; }; }, []);
      return <input data-owned-child readOnly value="owned" />;
    }
    const workspace = readFileSync(path.resolve('src/components/canvas-workspace.tsx'), 'utf8');
    const ts = await import('typescript');
    const code = ts.transpileModule(workspacePanelProbeSource(workspace), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
    }).outputText;
    const icon = (): React.ReactElement => <span />;
    const Host = new Function('React', 'useState', 'useEffect', 'useCallback',
      'shouldInitiallyCollapseWorkspacePanel', 'WORKSPACE_PANEL_RAIL_WIDTH', 'themeStyle', 'DraftProbe', 'ChevronLeft', 'ChevronRight',
      code + '\nreturn Host;')(React, useState, useEffect, useCallback, shouldInitiallyCollapseWorkspacePanel,
      WORKSPACE_PANEL_RAIL_WIDTH, 'gold', DraftProbe, icon, icon) as React.ComponentType<{ actorId?: string; projectId?: string }>;
    await act(async () => root?.render(<Host />)); expect(lifecycle.mounts).toBe(0);
    const toggle = async (): Promise<void> => { await act(async () => container?.querySelector<HTMLButtonElement>('[data-workspace-right-panel] > button')?.click()); };
    await toggle(); expect(lifecycle.mounts).toBe(1); await toggle();
    await act(async () => root?.render(<Host {...next} />));
    expect(container?.querySelector('[data-owned-child]')).toBeNull(); expect(lifecycle.mounts).toBe(1);
    await toggle(); expect(lifecycle.mounts).toBe(2); expect(container?.querySelector('[data-owned-child]')).not.toBeNull();
  });
}
