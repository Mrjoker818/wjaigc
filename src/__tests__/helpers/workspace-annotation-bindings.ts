import ts from 'typescript';
import { createElement, type CSSProperties, type ReactElement } from 'react';
import { WORKSPACE_PANEL_RAIL_WIDTH, shouldInitiallyCollapseWorkspacePanel } from '@/lib/workspace-panel-layout';

export interface WorkspaceBindingSources { workspace: string; canvas: string }
export interface WorkspaceBindingSnapshot {
  collapsed: boolean; canvasCollapsed: boolean; rightInset: number;
  panelStyle: CSSProperties; buttonProps: Record<string, unknown>;
  contentContainer: ReactElement | null; contentVisible: boolean;
}
export interface ObservedWorkspaceBindings {
  read(): WorkspaceBindingSnapshot; clickToggle(): void;
}
type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
function unique<T>(values: T[], label: string): T {
  if (values.length !== 1) throw Error('MD_UNIQUE_' + label + ':' + values.length);
  return values[0];
}
function find<T extends ts.Node>(file: ts.SourceFile, predicate: (node: ts.Node) => node is T): T[] {
  const values: T[] = [];
  const visit = (node: ts.Node): void => { if (predicate(node)) values.push(node); ts.forEachChild(node, visit); };
  visit(file); return values;
}
function opening(node: ts.Node): node is Opening {
  return ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);
}
function attribute(node: Opening, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find((value): value is ts.JsxAttribute =>
    ts.isJsxAttribute(value) && value.name.getText() === name);
}
function expression(node: Opening, name: string, file: ts.SourceFile): string {
  const value = attribute(node, name)?.initializer;
  if (value && ts.isStringLiteral(value)) return JSON.stringify(value.text);
  if (value && ts.isJsxExpression(value) && value.expression) return value.expression.getText(file);
  throw Error('MD_ATTRIBUTE_EXPRESSION:' + name);
}
function evaluate(text: string, scope: Record<string, unknown>): unknown {
  const compiled = ts.transpileModule('const value = (' + text + ');', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    reportDiagnostics: true,
  });
  if (compiled.diagnostics?.some(value => value.category === ts.DiagnosticCategory.Error)) throw Error('MD_BINDING_SYNTAX');
  return new Function(...Object.keys(scope), compiled.outputText + '\nreturn value;')(...Object.values(scope)) as unknown;
}
function importName(file: ts.SourceFile, exported: string, module: string): string {
  const names: string[] = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== module) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const value of bindings.elements) {
      if ((value.propertyName?.text ?? value.name.text) === exported) names.push(value.name.text);
    }
  }
  return unique(names, 'IMPORT_' + exported);
}
function attributes(node: Opening, names: string[], file: ts.SourceFile, scope: Record<string, unknown>): Record<string, unknown> {
  if (node.attributes.properties.some(value => ts.isJsxSpreadAttribute(value))) throw Error('MD_UNOBSERVED_SPREAD');
  return Object.fromEntries(names.map(name => [name, evaluate(expression(node, name, file), scope)]));
}
function parse(name: string, text: string): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
export function observeWorkspaceBindings(sources: WorkspaceBindingSources, viewportWidth?: number): ObservedWorkspaceBindings {
  const workspace = parse('canvas-workspace.tsx', sources.workspace);
  const canvas = parse('infinite-canvas.tsx', sources.canvas);
  const workspaceRail = importName(workspace, 'WORKSPACE_PANEL_RAIL_WIDTH', '@/lib/workspace-panel-layout');
  const canvasRail = importName(canvas, 'WORKSPACE_PANEL_RAIL_WIDTH', '@/lib/workspace-panel-layout');
  const initialRule = importName(workspace, 'shouldInitiallyCollapseWorkspacePanel', '@/lib/workspace-panel-layout');
  const stateRule = importName(workspace, 'useState', 'react');
  const state = unique(find(workspace, (node): node is ts.VariableDeclaration =>
    ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name)
    && node.name.elements[0]?.getText(workspace) === 'panelCollapsed'), 'PANEL_STATE');
  if (!state.initializer || !ts.isCallExpression(state.initializer)
    || state.initializer.expression.getText(workspace) !== stateRule
    || state.initializer.arguments.length !== 1) throw Error('MD_ACTUAL_INITIALIZER_REQUIRED');
  const statePattern = state.name as ts.ArrayBindingPattern;
  const setter = statePattern.elements[1];
  if (!setter || !ts.isBindingElement(setter) || !ts.isIdentifier(setter.name)) throw Error('MD_ACTUAL_SETTER_REQUIRED');
  const setterName = setter.name.text;
  const initial = evaluate(state.initializer.arguments[0].getText(workspace), {
    window: viewportWidth === undefined ? undefined : { innerWidth: viewportWidth },
    [initialRule]: shouldInitiallyCollapseWorkspacePanel,
  });
  let collapsed = (typeof initial === 'function' ? Reflect.apply(initial, undefined, []) : initial) as unknown;
  if (typeof collapsed !== 'boolean') throw Error('MD_INITIAL_BOOLEAN_REQUIRED');
  const retainedState = unique(find(workspace, (node): node is ts.VariableDeclaration =>
    ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name)
    && node.name.elements[0]?.getText(workspace) === 'panelHasOpened'), 'RETAINED_STATE');
  if (!retainedState.initializer || !ts.isCallExpression(retainedState.initializer)) throw Error('MD_RETAINED_INITIALIZER');
  let retained: unknown = evaluate(retainedState.initializer.arguments[0].getText(workspace), {});
  const retentionEffect = unique(find(workspace, (node): node is ts.CallExpression => ts.isCallExpression(node)
    && node.expression.getText(workspace) === 'useEffect' && node.getText(workspace).includes('setPanelHasOpened')), 'RETENTION_EFFECT');
  const setRetained = (next: unknown): void => { retained = typeof next === 'function' ? Reflect.apply(next, undefined, [retained]) : next; };
  const panel = unique(find(workspace, (node): node is Opening => opening(node)
    && attribute(node, 'data-workspace-right-panel') !== undefined), 'RIGHT_PANEL');
  if (!ts.isJsxElement(panel.parent)) throw Error('MD_PANEL_ELEMENT_REQUIRED');
  const buttonElement = unique(panel.parent.children.filter((node): node is ts.JsxElement =>
    ts.isJsxElement(node) && node.openingElement.tagName.getText(workspace) === 'button'), 'DIRECT_TOGGLE');
  const content = unique(panel.parent.children.filter((node): node is ts.JsxExpression =>
    ts.isJsxExpression(node) && !!node.expression && ts.isBinaryExpression(node.expression)
    && node.expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken), 'CONTENT_CONDITION');
  const contentExpression = content.expression as ts.BinaryExpression;
  let contentNode = contentExpression.right;
  while (ts.isParenthesizedExpression(contentNode)) contentNode = contentNode.expression;
  if (!ts.isJsxElement(contentNode) || contentNode.openingElement.tagName.getText(workspace) !== 'div') throw Error('MD_CONTENT_CONTAINER_REQUIRED');
  const contentOpening = contentNode.openingElement;
  const canvasEntry = unique(find(workspace, (node): node is Opening => opening(node)
    && node.tagName.getText(workspace) === 'InfiniteCanvas'), 'CANVAS_ENTRY');
  const composerEntry = unique(find(canvas, (node): node is Opening => opening(node)
    && node.tagName.getText(canvas) === 'AnnotationComposer'), 'COMPOSER_ENTRY');
  const setCollapsed = (next: unknown): void => {
    const value: unknown = typeof next === 'function' ? Reflect.apply(next, undefined, [collapsed]) : next;
    if (typeof value !== 'boolean') throw Error('MD_TOGGLE_BOOLEAN_REQUIRED');
    collapsed = value;
  };
  const read = (): WorkspaceBindingSnapshot => {
    const scope = { panelCollapsed: collapsed, [setterName]: setCollapsed, themeStyle: 'colorful',
      panelHasOpened: retained, setPanelHasOpened: setRetained, currentUser: { id: 'binding-actor' },
      currentProject: { id: 'binding-project' }, [workspaceRail]: WORKSPACE_PANEL_RAIL_WIDTH };
    evaluate(retentionEffect.getText(workspace), { ...scope, useEffect: (setup: () => void): void => setup() });
    scope.panelHasOpened = retained;
    const canvasCollapsed = evaluate(expression(canvasEntry, 'isPanelCollapsed', workspace), scope);
    if (typeof canvasCollapsed !== 'boolean') throw Error('MD_CANVAS_FLAG_REQUIRED');
    const rightInset = evaluate(expression(composerEntry, 'rightInset', canvas), {
      isPanelCollapsed: canvasCollapsed, [canvasRail]: WORKSPACE_PANEL_RAIL_WIDTH,
    });
    if (typeof rightInset !== 'number' || !Number.isFinite(rightInset)) throw Error('MD_FINITE_INSET_REQUIRED');
    const panelStyle = evaluate(expression(panel, 'style', workspace), scope) as CSSProperties;
    const buttonProps = attributes(buttonElement.openingElement,
      ['style', 'title', 'aria-label', 'aria-expanded', 'onClick'], workspace, scope);
    const renderContent = evaluate(contentExpression.left.getText(workspace), scope);
    if (typeof renderContent !== 'boolean') throw Error('MD_CONTENT_BOOLEAN_REQUIRED');
    // Observe the actual outer content condition/attributes, not its child modules or whole lifecycle.
    const contentProps = attributes(contentOpening, ['className', 'key', 'style', 'inert', 'aria-hidden'], workspace, scope);
    const contentContainer = renderContent ? createElement('div', contentProps) : null;
    const contentVisible = renderContent && (contentProps.style as CSSProperties).display !== 'none';
    return { collapsed: collapsed as boolean, canvasCollapsed, rightInset, panelStyle, buttonProps, contentContainer, contentVisible };
  };
  return { read, clickToggle: (): void => {
    const handler = read().buttonProps.onClick;
    if (typeof handler !== 'function') throw Error('MD_ACTUAL_CLICK_REQUIRED');
    Reflect.apply(handler, undefined, []);
  } };
}
