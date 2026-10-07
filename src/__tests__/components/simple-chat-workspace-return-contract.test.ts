import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import {
  clearSimpleChatWorkspaceHandoffParams,
  getInitialWorkspaceModeFromSearch,
  replaceWorkspaceHistoryState,
  WORKSPACE_LOCATION_CHANGE_EVENT,
} from '@/lib/project-workspace-url';

const simpleChatPage = readFileSync(
  resolve(process.cwd(), 'src/app/simple-chat/page.tsx'),
  'utf8',
);
const homePage = readFileSync(
  resolve(process.cwd(), 'src/app/page.tsx'),
  'utf8',
);
const canvasWorkspace = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
);
const chatArea = readFileSync(
  resolve(process.cwd(), 'src/components/simple-chat/chat-area.tsx'),
  'utf8',
);

describe('simple-chat workspace return contract', () => {
  it('returns directly to an authenticated dashboard state', () => {
    expect(simpleChatPage).toContain("router.replace('/?view=dashboard')");
    expect(simpleChatPage).not.toContain("onBackToWorkspace={() => window.location.href = '/'}");

    expect(homePage).toContain("searchParams.get('view') === 'dashboard'");
    expect(homePage).toContain('useState(!returningToDashboard)');

    expect(canvasWorkspace).toContain('getInitialWorkspaceModeFromSearch,');
    expect(canvasWorkspace).toContain(
      'return getInitialWorkspaceModeFromSearch(window.location.search);',
    );
    expect(canvasWorkspace).toContain('useState<WorkspaceMode>(getInitialWorkspaceMode)');
    expect(canvasWorkspace).toContain('const workspaceLocationSearch = useWorkspaceLocationSearch();');
    expect(canvasWorkspace).toContain(
      'const intent = parseSimpleChatWorkspaceHandoffIntent(workspaceLocationSearch);',
    );
    const source = ts.createSourceFile(
      'canvas-workspace.tsx', canvasWorkspace, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
    );
    const findConsumers = (node: ts.Node): ts.CallExpression[] => {
      const calls: ts.CallExpression[] = [];
      const visit = (child: ts.Node): void => {
        if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)
          && child.expression.text === 'consumeSimpleChatWorkspaceHandoffForProject') calls.push(child);
        ts.forEachChild(child, visit);
      };
      visit(node);
      return calls;
    };
    const effects: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && node.expression.text === 'useEffect' && node.arguments[0]
        && findConsumers(node.arguments[0]).length > 0) effects.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(effects).toHaveLength(1);
    const effect = effects[0];
    const dependencies = effect.arguments[1];
    if (!dependencies || !ts.isArrayLiteralExpression(dependencies)) {
      throw new Error('Actual handoff effect requires a dependency array');
    }
    const printer = ts.createPrinter({ removeComments: true });
    const dependencyNames = new Set(dependencies.elements.map(node =>
      printer.printNode(ts.EmitHint.Expression, node, source).replace(/\s+/g, '')));
    for (const required of [
      'currentProject?.id', 'handoffRetryRevision', 'persistNodeWorkflow', 'workspaceLocationSearch',
      'currentUser?.id', 'collaborativeCanvas.projectId', 'collaborativeCanvas.authority',
      'collaborativeCanvas.refreshMedia', 'loadedDocumentWorkflowScope', 'documentWorkflowScope',
    ]) expect(dependencyNames.has(required), `Missing handoff dependency: ${required}`).toBe(true);

    const consumers = findConsumers(effect.arguments[0]);
    expect(consumers).toHaveLength(1);
    const options = consumers[0].arguments[0];
    if (!options || !ts.isObjectLiteralExpression(options)) throw new Error('Actual handoff options missing');
    const cleaners = options.properties.filter((node): node is ts.PropertyAssignment =>
      ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'cleanUrl');
    expect(cleaners).toHaveLength(1);
    const cleaner = cleaners[0].initializer;
    expect(ts.isArrowFunction(cleaner)).toBe(true);
    const compiled = ts.transpileModule(`const actualCleanUrl = ${cleaner.getText(source)};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
      reportDiagnostics: true,
    });
    expect((compiled.diagnostics ?? []).filter(row => row.category === ts.DiagnosticCategory.Error)).toEqual([]);
    let current = true;
    const replaceState = vi.fn();
    const target = Object.assign(new EventTarget(), {
      location: new URL('http://127.0.0.1:5012/?projectId=shared&mode=node&chatProjectId=chat&chatTaskId=task&chatMessageId=message#node'),
      history: { replaceState },
    });
    const locationChanged = vi.fn();
    target.addEventListener(WORKSPACE_LOCATION_CHANGE_EVENT, locationChanged);
    const clearParams = vi.fn(clearSimpleChatWorkspaceHandoffParams);
    const replaceHistory = vi.fn(replaceWorkspaceHistoryState);
    const cleanUrl = new Function(
      'isCurrent', 'replaceWorkspaceHistoryState', 'window', 'clearSimpleChatWorkspaceHandoffParams',
      compiled.outputText + '; return actualCleanUrl;',
    )(() => current, replaceHistory, target, clearParams) as () => void;
    cleanUrl();
    expect(clearParams).toHaveBeenCalledExactlyOnceWith(target.location.href);
    expect(replaceHistory).toHaveBeenCalledExactlyOnceWith(target, '/?projectId=shared&mode=node#node');
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, '', '/?projectId=shared&mode=node#node');
    expect(locationChanged).toHaveBeenCalledTimes(1);
    current = false;
    expect(() => cleanUrl()).toThrow('HANDOFF_SCOPE_CHANGED');
    expect(clearParams).toHaveBeenCalledTimes(1);
    expect(replaceHistory).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(locationChanged).toHaveBeenCalledTimes(1);
  });

  it('derives the initial workspace mode through the shared search parser', () => {
    expect(getInitialWorkspaceModeFromSearch('?view=dashboard')).toBe('dashboard');
    expect(getInitialWorkspaceModeFromSearch('?projectId=canvas-1&mode=node')).toBe('node');
    expect(getInitialWorkspaceModeFromSearch('?projectId=canvas-1')).toBe('canvas');
    expect(getInitialWorkspaceModeFromSearch('')).toBe('dashboard');
  });

  it('opens the explicitly selected canvas project without routing through login or bare Canvas', () => {
    expect(chatArea).toMatch(/window\.location\.assign\(\s*`\/\?projectId=\$\{encodeURIComponent\(targetProjectId\)\}`\s*\)/);
    expect(chatArea).not.toContain('window.open(');
    expect(simpleChatPage).not.toMatch(/router\.(?:push|replace)\(\s*['"]\/(?:login|canvas)['"]/);
    expect(simpleChatPage).not.toContain("onBackToWorkspace={() => window.location.href = '/'}");
  });
});
