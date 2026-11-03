import ts from 'typescript';

// Execute the actual sidebar's state, effects, callback, toggle and content
// boundary with controlled children. This is not a full Workspace substitute.
export function workspacePanelProbeSource(source: string): string {
  const file = ts.createSourceFile('canvas-workspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const all: ts.Node[] = [];
  const visit = (node: ts.Node): void => { all.push(node); ts.forEachChild(node, visit); };
  visit(file);
  const unique = <T,>(values: T[], name: string): T => {
    if (values.length !== 1) throw Error('PANEL_PROBE_UNIQUE:' + name + ':' + values.length);
    return values[0];
  };
  const state = (name: string, optional = false): string => {
    const matches = all.filter((node): node is ts.VariableDeclaration => ts.isVariableDeclaration(node)
      && ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.getText(file) === name);
    if (optional && matches.length === 0) return '';
    const node = unique(matches, name);
    if (!ts.isVariableDeclarationList(node.parent) || node.parent.declarations.length !== 1
      || !ts.isVariableStatement(node.parent.parent)) throw Error('PANEL_PROBE_STATE:' + name);
    return node.parent.parent.getText(file);
  };
  const panel = unique(all.filter((node): node is ts.JsxOpeningElement => ts.isJsxOpeningElement(node)
    && node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(file) === 'data-workspace-right-panel')), 'panel');
  if (!ts.isJsxElement(panel.parent)) throw Error('PANEL_PROBE_ELEMENT');
  const toggle = unique(panel.parent.children.filter((node): node is ts.JsxElement => ts.isJsxElement(node)
    && node.openingElement.tagName.getText(file) === 'button'), 'toggle');
  const conditional = unique(panel.parent.children.filter((node): node is ts.JsxExpression => ts.isJsxExpression(node)
    && !!node.expression && ts.isBinaryExpression(node.expression)
    && node.expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken), 'content').expression as ts.BinaryExpression;
  let content = conditional.right;
  while (ts.isParenthesizedExpression(content)) content = content.expression;
  if (!ts.isJsxElement(content) || content.openingElement.tagName.getText(file) !== 'div') throw Error('PANEL_PROBE_CONTENT');
  const callback = unique(all.filter((node): node is ts.VariableDeclaration => ts.isVariableDeclaration(node)
    && node.name.getText(file) === 'handleCanvasToolActivated'), 'activation');
  if (!ts.isVariableDeclarationList(callback.parent) || !ts.isVariableStatement(callback.parent.parent)) throw Error('PANEL_PROBE_CALLBACK');
  const retentionEffects = all.filter((node): node is ts.CallExpression => ts.isCallExpression(node)
    && node.expression.getText(file) === 'useEffect' && node.getText(file).includes('setPanelHasOpened'));
  if (retentionEffects.length > 1) throw Error('PANEL_PROBE_RETENTION_EFFECT');
  return `function Host({actorId='actor-a', projectId='project-a'}) {
    const currentUser={id:actorId}, currentProject={id:projectId};
    ${state('panelCollapsed')}
    ${state('panelHasOpened', true)}
    ${retentionEffects.map(node => node.getText(file) + ';').join('\n')}
    ${callback.parent.parent.getText(file)}
    return <div><button data-activate onClick={handleCanvasToolActivated}>open tool</button>
      ${panel.getText(file)}${toggle.getText(file)}
      {${conditional.left.getText(file)} && (${content.openingElement.getText(file)}<DraftProbe/></div>)}
      </div></div>;
  }`;
}
