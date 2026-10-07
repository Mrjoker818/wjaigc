import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const source = readFileSync(resolve(process.cwd(), 'src/components/chat-panel.tsx'), 'utf8');

describe('Canvas Brief 到视频成片 UI wiring', () => {
  it('1397 fix1 actual Chat JSX passes current authority/account to both consumers', () => {
    const ast = ts.createSourceFile('chat.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const values: Record<string, Record<string, unknown>> = {};
    const visit = (node: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(node) && ['BriefToVideoResultCard', 'MultiPlatformExportDrawer'].includes(node.tagName.getText(ast))) {
        const evaluated: Record<string, unknown> = {};
        for (const prop of node.attributes.properties) {
          if (!ts.isJsxAttribute(prop) || !['authority', 'expectedActorId', 'accountKey', 'projectId'].includes(prop.name.getText(ast))) continue;
          if (!prop.initializer || !ts.isJsxExpression(prop.initializer) || !prop.initializer.expression) throw new Error('Missing actual prop expression');
          evaluated[prop.name.getText(ast)] = new Function('canvasAuthority', 'skillAccountKey', 'projectId', 'return (' + prop.initializer.expression.getText(ast) + ');')('document', 'editor', 'target');
        }
        values[node.tagName.getText(ast)] = evaluated;
      }
      ts.forEachChild(node, visit);
    }; visit(ast);
    expect(values.BriefToVideoResultCard).toEqual({ authority: 'document', expectedActorId: 'editor', projectId: 'target' });
    expect(values.MultiPlatformExportDrawer).toEqual({ authority: 'document', accountKey: 'editor', projectId: 'target' });
  });
  it('keeps approval and finished-video UI inside Canvas Skill runtime', () => {
    expect(source).toContain("import { BriefToVideoApprovalCard } from '@/components/skill-runtime/BriefToVideoApprovalCard';");
    expect(source).toContain("import { BriefToVideoResultCard } from '@/components/skill-runtime/BriefToVideoResultCard';");
    expect(source).toContain('activeSkill.id === BRIEF_TO_VIDEO_SKILL_ID');
    expect(source).toContain('onApprove={skillRun.approve}');
    expect(source).toContain('onRevise={skillRun.revise}');
    expect(source).toContain('onCancel={skillRun.cancel}');
    expect(source).toContain('<BriefToVideoResultCard');
  });

  it('loads a video capability catalog and freezes the selected video model for the Skill', () => {
    expect(source).toContain("loadCatalog('video')");
    expect(source).toContain('discoveredVideoModels');
    expect(source).toContain("role === 'video'");
    expect(source).toContain('modelBindings.video =');
    expect(source).toContain('capabilityDescriptors={{ video: selectedVideoDescriptor }}');
    expect(source).toContain('aria-label="video 模型"');
    expect(source).toMatch(/aria-label="video 模型"[\s\S]*?className="[^"]*min-h-\[44px\][^"]*"/u);
  });
});
