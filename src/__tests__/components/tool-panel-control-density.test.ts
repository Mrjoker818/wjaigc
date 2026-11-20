// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const panels = [
  'agent-editor.tsx', 'ai-psd/ai-psd-panel.tsx', 'brand-ecommerce-panel.tsx',
  'brand-factory-panel.tsx', 'brand-packaging-panel.tsx', 'project-data-panel.tsx',
  'refine-engine-panel.tsx', 'scene-studio-panel.tsx', 'sticker-assistant-panel.tsx',
  'third-party-model-dialog.tsx', 'dashboard/dashboard-view.tsx', 'dashboard/admin-tabs.tsx',
  'effect-reverse-engineering/source-panel.tsx',
];
let browser: Browser;
let css: string;
const roots: Array<{ file: string; classes: string }> = [];
let reverseModeClasses = '';
const controls = '<button data-probe="compact" class="size-7">X</button>'
  + '<button data-probe="tall" class="min-h-28 min-w-28">预览资产</button>'
  + '<button data-probe="checkbox" role="checkbox" aria-checked="false" class="size-4"></button>'
  + '<button data-probe="switch" role="switch" aria-checked="false" class="h-[1.15rem] w-8"></button>'
  + '<input data-probe="native-checkbox" type="checkbox" class="size-4">'
  + '<input data-probe="range" type="range" class="h-1 w-32">'
  + '<select data-probe="select" class="h-8"><option>验收模型</option></select>';

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const sources: string[] = [];
  for (const file of panels) {
    const source = await readFile(path.resolve('src/components', file), 'utf8');
    sources.push(source);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node): void {
      if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'className' && node.initializer) {
        const init = node.initializer;
        const expression = ts.isJsxExpression(init) ? init.expression : undefined;
        const classes = ts.isStringLiteral(init) ? init.text
          : expression && ts.isTemplateExpression(expression)
            ? [expression.head.text, ...expression.templateSpans.map(span => span.literal.text)].join(' ')
            : '';
        if (classes.includes('touch-button-targets')) roots.push({ file, classes });
        if (file === 'effect-reverse-engineering/source-panel.tsx' && classes.includes('min-h-9')) reverseModeClasses = classes;
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  expect(new Set(roots.map(root => root.file)).size).toBe(panels.length);
  expect(reverseModeClasses).toContain('min-h-9');
  const compiler = await compile(await readFile('src/app/globals.css', 'utf8'), {
    base: process.cwd(),
    loadStylesheet: async (id, base) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
          : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  css = compiler.build(new Scanner({}).scanFiles([...sources, controls].map(content => ({ content, extension: 'tsx' }))));
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

describe('real tool-panel wrapper control sizing', () => {
  it.each([
    { width: 1440, touch: false, floor: 28 },
    { width: 390, touch: false, floor: 44 },
    { width: 1280, touch: true, floor: 44 },
  ])('preserves control shape at $width px, touch=$touch', async ({ width, touch, floor }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch });
    try {
      const page = await context.newPage();
      await page.route('**/*', route => route.abort());
      for (const root of roots) {
        // Only panel positioning is neutralized; actual wrapper selectors and
        // shipped CSS control dimensions remain intact. This is CSS integration,
        // not a claim that the panel's paid/server workflows were executed.
        const mode = root.file === 'effect-reverse-engineering/source-panel.tsx'
          ? `<button data-probe="mode" class="${reverseModeClasses}">拆解模式</button>` : '';
        await page.setContent(`<style>${css}</style><section class="${root.classes}" style="position:relative;display:block;width:360px;height:auto;max-height:none">${controls}${mode}</section>`);
        const sizes = await page.locator('[data-probe]').evaluateAll(elements => Object.fromEntries(elements.map(element => {
          const rect = element.getBoundingClientRect();
          return [element.getAttribute('data-probe'), { width: rect.width, height: rect.height }];
        })));
        expect(sizes.compact.height, root.file).toBe(floor);
        expect(sizes.compact.width, root.file).toBe(floor);
        expect(sizes.tall.height, root.file).toBeGreaterThanOrEqual(112);
        expect(sizes.checkbox.height, root.file).toBe(16);
        expect(sizes.switch.height, root.file).toBeLessThan(20);
        expect(sizes['native-checkbox'].height, root.file).toBe(16);
        expect(sizes.range.height, root.file).toBe(4);
        if (mode) expect(sizes.mode.height, root.file).toBe(floor === 44 ? 44 : 36);
        if (root.classes.includes('touch-field-targets')) {
          expect(sizes.select.height, root.file).toBe(floor === 44 ? 44 : 32);
        }
      }
    } finally { await context.close(); }
  });
});
