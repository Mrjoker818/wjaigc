import ts from 'typescript';

function nodes(file: ts.SourceFile): ts.Node[] {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node): void => { result.push(node); ts.forEachChild(node, visit); };
  visit(file); return result;
}
function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
export function evaluatePanelExpression(source: string, scope: Record<string, unknown>): unknown {
  const result = ts.transpileModule('const value=(' + source + ');', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true,
  });
  if (result.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw Error('POPUP_BINDING_SYNTAX');
  return new Function(...Object.keys(scope), result.outputText + '\nreturn value;')(...Object.values(scope)) as unknown;
}
export function panelPopupRootProps(source: string, tag: string, index: number, scope: Record<string, unknown>): Record<string, unknown> {
  const file = parse(source);
  const roots = nodes(file).filter((node): node is ts.JsxOpeningElement => ts.isJsxOpeningElement(node)
    && node.tagName.getText(file) === tag);
  const root = roots[index]; if (!root) throw Error('POPUP_ROOT_MISSING:' + tag + ':' + index);
  const result: Record<string, unknown> = {};
  for (const attr of root.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) throw Error('POPUP_UNOBSERVED_SPREAD');
    const init = attr.initializer;
    result[attr.name.getText(file)] = !init ? true : ts.isStringLiteral(init) ? init.text
      : ts.isJsxExpression(init) && init.expression ? evaluatePanelExpression(init.expression.getText(file), scope)
        : undefined;
  }
  return result;
}
// Keep the actual portal wrapper and the real child's open expression. Only the
// child body is replaced by a controlled local draft witness (no model/task UI).
export function panelPortalProbeSource(source: string, childTag: string): string {
  const file = parse(source);
  const calls = nodes(file).filter((node): node is ts.CallExpression => ts.isCallExpression(node)
    && node.expression.getText(file) === 'createPortal'
    && !!node.arguments[0] && nodes(fileFor(node.arguments[0].getText(file))).some(n =>
      (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText() === childTag));
  if (calls.length !== 1) throw Error('PORTAL_PROBE_UNIQUE:' + childTag + ':' + calls.length);
  const expression = calls[0].arguments[0];
  let boundary: ts.Node | undefined = calls[0].parent;
  while (boundary && !ts.isJsxExpression(boundary)) boundary = boundary.parent;
  if (!boundary || !ts.isJsxExpression(boundary) || !boundary.expression) throw Error('PORTAL_PROBE_MOUNT_CONDITION');
  const children = nodes(file).filter((node): node is ts.JsxSelfClosingElement => ts.isJsxSelfClosingElement(node)
    && node.pos >= expression.pos && node.end <= expression.end && node.tagName.getText(file) === childTag);
  if (children.length !== 1) throw Error('PORTAL_PROBE_CHILD');
  const child = children[0], open = child.attributes.properties.find((attr): attr is ts.JsxAttribute =>
    ts.isJsxAttribute(attr) && attr.name.getText(file) === 'open');
  if (!open) throw Error('PORTAL_PROBE_OPEN');
  const original = boundary.getText(file), childText = child.getText(file);
  if (original.split(childText).length !== 2) throw Error('PORTAL_PROBE_AMBIGUOUS');
  const jsx = original.replace(childText, () => '<Leaf ' + open.getText(file) + ' />');
  return ts.transpileModule('function PortalProbe({isVisible}) {return (<>' + jsx + '</>);}', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText;
}
function fileFor(expression: string): ts.SourceFile { return parse('const probe=(' + expression + ');'); }
export function panelEscapeEffect(source: string): string {
  const file = parse(source);
  const matches = nodes(file).filter((node): node is ts.CallExpression => ts.isCallExpression(node)
    && node.expression.getText(file) === 'useEffect' && node.getText(file).includes("addEventListener('keydown'"));
  if (matches.length !== 1) throw Error('PANEL_ESCAPE_EFFECT_UNIQUE');
  return ts.transpileModule(matches[0].getText(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}
