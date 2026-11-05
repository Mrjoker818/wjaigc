import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { parseUiSource, openingNodes, literalAttr, readUiAttr, evaluateUi, uniqueNode } from '../helpers/ui-source-contracts';

const source = readFileSync(resolve(process.cwd(), 'src/components/node-editor.tsx'), 'utf8');

describe('node editor UI regressions', () => {
  it('renders a controlled AI build dialog from the toolbar entry', () => {
    expect(source).toContain('const [aiBuildOpen, setAiBuildOpen] = useState(false);');
    expect(source).toContain('const [aiBuildLoading, setAiBuildLoading] = useState(false);');
    expect(source).toContain('const handleAiBuild = useCallback(async () => {');
    expect(source).toContain("fetch('/api/workflow/ai-build'");
    expect(source).toContain('body: JSON.stringify({ description: aiBuildInput })');
    expect(source).toContain('onClick={() => void handleAiBuild()}');
    expect(source).toContain('{aiBuildOpen && (');
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-label="关闭 AI 建图"');
  });

  it('keeps the mobile workflow canvas clear of permanent sidebars', () => {
    expect(source).toContain('overflow-x-auto');
    expect(source).toContain('md:relative');
    expect(source).toContain("selectedNode && !legacyPropertiesDeferred ? 'absolute inset-y-0 right-0 z-50 flex w-[min(20rem,90vw)] shadow-2xl' : 'hidden'");
    expect(source).toContain('md:flex md:w-72 md:shadow-none');
    expect(source).toContain('aria-label="关闭节点属性"');
    expect(source).toContain('onClick={() => { setSelectedNodeIds(new Set()); setPortListOpen(false); setPortListSource(null); }}');
  });

  it('marks only known layout chrome as workflow canvas occlusion', () => {
    const actual = parseUiSource(source);
    const marked = openingNodes(actual).filter(node => literalAttr(node, 'data-workflow-ui-occlusion') === true);
    const legend = uniqueNode(marked.filter(node => literalAttr(node, 'data-workflow-port-legend') === true), 'LEGEND');
    const minimap = uniqueNode(marked.filter(node => literalAttr(node, 'data-workflow-minimap') === true), 'MINIMAP');
    const properties = uniqueNode(marked.filter(node => node.tagName.getText(actual.file) === 'aside'), 'PROPERTIES');
    const dock = uniqueNode(marked.filter(node => String(literalAttr(node, 'className')).startsWith('shrink-0 border-t')), 'DOCK');
    const gridStatus = uniqueNode(marked.filter(node => String(literalAttr(node, 'className')).startsWith('flex shrink-0 flex-wrap')), 'GRID_STATUS');
    expect(new Set(marked)).toEqual(new Set([legend, minimap, properties, dock, gridStatus]));
    const gridCondition = uniqueNode(actual.nodes.filter((node): node is ts.BinaryExpression =>
      ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && node.left.getText(actual.file) === "gridClientView.phase !== 'idle'"
      && node.right.pos <= gridStatus.pos && node.right.end >= gridStatus.end), 'GRID_STATUS_CONDITION');
    expect(evaluateUi(actual, gridCondition.left, { gridClientView: { phase: 'idle' } })).toBe(false);
    for (const phase of ['preparing', 'unknown', 'error']) {
      expect(evaluateUi(actual, gridCondition.left, { gridClientView: { phase } })).toBe(true);
    }

    const legendCondition = uniqueNode(actual.nodes.filter((node): node is ts.BinaryExpression =>
      ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && node.left.getText(actual.file).includes('selectedNodeIds.size')
      && node.right.pos <= legend.pos && node.right.end >= legend.end), 'LEGEND_CONDITION');
    expect(evaluateUi(actual, legendCondition.left, { selectedNodeIds: new Set() })).toBe(true);
    expect(evaluateUi(actual, legendCondition.left, { selectedNodeIds: new Set(['chosen']) })).toBe(false);
    // Presence is governed by the actual toggle. Mobile minimap policy remains a separate open contract.
    const minimapCondition = uniqueNode(actual.nodes.filter((node): node is ts.BinaryExpression =>
      ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && node.left.getText(actual.file) === 'showMinimap'
      && node.right.pos <= minimap.pos && node.right.end >= minimap.end), 'MINIMAP_CONDITION');
    expect(evaluateUi(actual, minimapCondition.left, { showMinimap: false })).toBe(false);
    expect(evaluateUi(actual, minimapCondition.left, { showMinimap: true })).toBe(true);
    for (const selectedNode of [null, { id: 'chosen' }]) {
      for (const legacyPropertiesDeferred of [false, true]) {
        const classes = String(readUiAttr(actual, properties, 'className', { selectedNode, legacyPropertiesDeferred })).split(/\s+/);
        const visible = selectedNode !== null && !legacyPropertiesDeferred;
        expect(classes.includes('hidden')).toBe(!visible);
        expect(classes.includes('flex')).toBe(visible);
      }
    }
  });
});
