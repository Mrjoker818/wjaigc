// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as autoSkill from '@/lib/simple-chat-auto-skill';
import { SkillTraceCard } from '@/components/simple-chat/skill-trace-card';

const jsonReply = (data: unknown) => `\`\`\`json\n${JSON.stringify(data)}\n\`\`\``;

// Execute the actual composer's callbacks, without importing its unrelated panels or services.
function downloadGate(name: string): (content: string) => boolean {
  const file = resolve('src/components/simple-chat/chat-area.tsx');
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer
      && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!callback) throw new Error(`Missing ChatArea callback: ${name}`);
  const js = ts.transpileModule(`return (${callback.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('readSimpleChatFileData', js)(
    (autoSkill as unknown as Record<string, unknown>).readSimpleChatFileData,
  );
}

function trace(skillId: string, content: string, finished = true) {
  const html = renderToStaticMarkup(<SkillTraceCard skill={{ id: skillId, name: skillId, source: 'auto' }} content={content} finished={finished} />);
  return html.match(/<li\b[\s\S]*?<\/li>/g)?.[3] || '';
}

describe('simple-chat residual file readiness', () => {
  it.each([
    ['title only', 'ppt-master', 'hasPptJson', { title: '季度汇报' }],
    ['empty slides', 'ppt-master', 'hasPptJson', { slides: [] }],
    ['non-slide JSON', 'ppt-master', 'hasPptJson', { sheets: [{ name: '数据', rows: [[1]] }] }],
    ['null', 'ppt-master', 'hasPptJson', null],
    ['empty sheets', 'excel-master', 'hasExcelJson', { sheets: [] }],
    ['empty sections', 'word-master', 'hasWordJson', { sections: [] }],
    ['missing map title', 'mindmap-master', 'hasMindmapJson', { root: { text: '主题' } }],
    ['empty flowchart', 'flowchart-master', 'hasFlowchartJson', { title: '流程', mermaid: '' }],
  ])('does not claim downloadable %s', (_name, skillId, gate, data) => {
    const content = jsonReply(data);
    expect(trace(skillId, content)).not.toContain('可以下载');
    expect(downloadGate(gate)(content)).toBe(false);
  });

  it.each([
    ['ppt-master', 'hasPptJson', { slides: [{ title: '季度汇报', layout: 'title' }] }],
    ['excel-master', 'hasExcelJson', { sheets: [{ name: '数据', rows: [[1]] }] }],
    ['word-master', 'hasWordJson', { sections: [{ type: 'paragraph', text: '正文' }] }],
    ['mindmap-master', 'hasMindmapJson', { title: '主题', root: { text: '主题' } }],
    ['flowchart-master', 'hasFlowchartJson', { title: '流程', mermaid: 'graph TD; A-->B' }],
  ])('keeps valid %s data ready for click-to-generate', (skillId, gate, data) => {
    const content = jsonReply(data);
    expect(trace(skillId, content)).toContain('：已完成');
    expect(downloadGate(gate)(content)).toBe(true);
  });

  it('keeps truncated data pending while streaming, then reports the failed data step', () => {
    const content = '```json\n{"slides":';
    expect(trace('ppt-master', content, false)).not.toContain('：已完成');
    expect(downloadGate('hasPptJson')(content)).toBe(false);
    const html = renderToStaticMarkup(<SkillTraceCard skill={{ id: 'ppt-master', name: 'PPT', source: 'auto' }} content={'```json\n{"slides":\n```'} finished />);
    expect(html).toContain('文件数据不完整，无法下载');
  });
});
