// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { compileSketchHtml } from '@/lib/sketch-to-code/html';

function parse(tree: unknown): Document {
  return new DOMParser().parseFromString(compileSketchHtml(tree), 'text/html');
}

describe('sketch UI-tree HTML compiler', () => {
  it('preserves Chinese text and semantic static controls with bounded layout styles', () => {
    const doc = parse({ type: 'container', style: { display: 'flex', flexDirection: 'column', gap: 16, padding: 24, backgroundColor: '#ffffff' }, children: [
      { type: 'heading', level: 2, text: '创作工作台', style: { color: '#111827', fontSize: 28, fontWeight: 700 } },
      { type: 'label', text: '项目名称' },
      { type: 'input', placeholder: '请输入名称', value: '无界' },
      { type: 'separator' },
      { type: 'button', text: '开始创作' },
    ] });
    expect(doc.querySelector('h2')?.textContent).toBe('创作工作台');
    expect(doc.querySelector('input')?.getAttribute('value')).toBe('无界');
    expect(doc.querySelector('input')?.getAttribute('placeholder')).toBe('请输入名称');
    expect(doc.querySelector('button')?.getAttribute('type')).toBe('button');
    expect(doc.querySelector('hr')).not.toBeNull();
    expect(doc.querySelector('main > div')?.getAttribute('style')).toContain('gap:16px');
  });

  it('escapes markup, entities and quotes as literal text and input attributes', () => {
    const attack = '<img src=x onerror=alert(1)> & "\' </style><script>alert(2)</script>';
    const doc = parse({ type: 'container', children: [
      { type: 'text', text: attack }, { type: 'input', value: attack, placeholder: attack },
    ] });
    expect(doc.querySelector('p')?.textContent).toBe(attack);
    expect(doc.querySelector('input')?.getAttribute('value')).toBe(attack);
    expect(doc.querySelector('input')?.getAttribute('placeholder')).toBe(attack);
    expect(doc.querySelectorAll('img,script,[onerror]')).toHaveLength(0);
  });

  it('places a restrictive CSP before all generated body content', () => {
    const doc = parse({ type: 'text', text: '安全预览' });
    const csp = doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '';
    for (const directive of ["default-src 'none'", "script-src 'none'", "connect-src 'none'", "img-src 'none'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
      expect(csp).toContain(directive);
    }
    expect(doc.head.querySelector('meta[http-equiv]')).not.toBeNull();
    expect(doc.querySelector('main')?.textContent).toBe('安全预览');
  });

  it.each(['script', 'iframe', 'img', 'a', 'form', 'object', 'svg', 'style', 'video'])('rejects unsupported node type %s', (type) => {
    expect(() => compileSketchHtml({ type, text: 'payload' })).toThrow();
  });

  it.each([
    { type: 'text', text: 'x', rawHTML: '<script>alert(1)</script>' },
    { type: 'button', text: 'x', onclick: 'alert(1)' },
    { type: 'text', text: 'x', href: 'https://example.test' },
    { type: 'text', text: 'x', src: 'https://example.test/x' },
    { type: 'text', text: 'x', attrs: { onload: 'alert(1)' } },
    { type: 'text', text: 'x', style: { rawCss: 'url(https://example.test)' } },
    { type: 'text', text: 'x', style: { backgroundImage: 'url(https://example.test)' } },
    { type: 'text', text: 'x', style: { color: '#fff; background:url(https://example.test)' } },
    { type: 'text', text: 'x', style: { fontSize: '12px' } },
    { type: 'text', text: 'x', style: { width: Infinity } },
    { type: 'text', text: 'x', style: { height: NaN } },
    { type: 'text', text: 'x', style: { width: 2049 } },
    { type: 'text', text: 'x', style: { opacity: -0.1 } },
    { type: 'text', text: 'x', style: { display: 'contents; color:red' } },
    { type: 'text', text: 'x', style: { position: 'fixed' } },
    { type: 'heading', level: 7, text: 'x' },
    { type: 'input', inputType: 'image' },
    { type: 'input', formAction: 'https://example.test' },
    { type: 'text', text: 'x', children: [{ type: 'button', text: 'hidden' }] },
    { type: 'container', children: 'not an array' },
  ])('rejects unknown or unsafe fields without silently discarding them: %j', (tree) => {
    expect(() => compileSketchHtml(tree)).toThrow();
  });

  it('accepts the node limit and rejects one extra node', () => {
    expect(parse({ type: 'container', children: Array.from({ length: 199 }, () => ({ type: 'text', text: 'x' })) }).querySelectorAll('p')).toHaveLength(199);
    expect(() => compileSketchHtml({ type: 'container', children: Array.from({ length: 200 }, () => ({ type: 'text', text: 'x' })) })).toThrow();
  });

  it('enforces the total node budget across nested short child arrays', () => {
    const subtree = (count: number): unknown => ({ type: 'container', children: Array.from({ length: count }, () => ({ type: 'text', text: 'x' })) });
    expect(parse({ type: 'container', children: [subtree(98), subtree(99)] }).querySelectorAll('p')).toHaveLength(197);
    expect(() => compileSketchHtml({ type: 'container', children: [subtree(99), subtree(99)] })).toThrow('SKETCH_UI_TREE_LIMIT');
  });

  it('makes checkbox and radio state inert rather than relying on ineffective readonly', () => {
    const doc = parse({ type: 'container', children: [
      { type: 'input', inputType: 'checkbox', checked: true }, { type: 'input', inputType: 'radio' },
    ] });
    const checkbox = doc.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const radio = doc.querySelector<HTMLInputElement>('input[type="radio"]')!;
    checkbox.click(); radio.click();
    expect(checkbox.checked).toBe(true);
    expect(radio.checked).toBe(false);
    expect(checkbox.disabled && radio.disabled).toBe(true);
  });

  it.each([
    { type: 'container', children: null }, { type: 'heading', level: null, text: 'x' },
    { type: 'input', inputType: null },
  ])('rejects explicit null instead of silently substituting a default: %j', (tree) => {
    expect(() => compileSketchHtml(tree)).toThrow('SKETCH_UI_INVALID');
  });

  it('counts root depth as one and rejects depth thirteen', () => {
    let tree: unknown = { type: 'text', text: 'x' };
    for (let depth = 1; depth < 12; depth += 1) tree = { type: 'container', children: [tree] };
    expect(parse(tree).querySelectorAll('main div')).toHaveLength(11);
    expect(() => compileSketchHtml({ type: 'container', children: [tree] })).toThrow();
  });

  it('limits aggregate UTF-8 text bytes, including input attributes', () => {
    expect(parse({ type: 'text', text: 'x'.repeat(65536) }).querySelector('p')?.textContent?.length).toBe(65536);
    expect(() => compileSketchHtml({ type: 'text', text: '界'.repeat(21846) })).toThrow();
    expect(() => compileSketchHtml({ type: 'container', children: [
      { type: 'text', text: 'x'.repeat(32768) }, { type: 'input', value: 'x'.repeat(32768), placeholder: 'x' },
    ] })).toThrow();
  });

  it('rejects escaped output over the HTML byte budget', () => {
    expect(() => compileSketchHtml({ type: 'text', text: '&'.repeat(60000) })).toThrow();
  });

  it('rejects cycles, sparse arrays and inherited or accessor-based payloads', () => {
    const cyclic: { type: string; children: unknown[] } = { type: 'container', children: [] };
    cyclic.children.push(cyclic);
    expect(() => compileSketchHtml(cyclic)).toThrow();
    expect(() => compileSketchHtml({ type: 'container', children: Array(1) })).toThrow();
    expect(() => compileSketchHtml(Object.create({ type: 'text', text: 'inherited' }))).toThrow();
    const getter = Object.defineProperty({ type: 'text' }, 'text', { get: () => { throw new Error('getter invoked'); }, enumerable: true });
    expect(() => compileSketchHtml(getter)).toThrow(/SKETCH_UI/);
  });

  it('renders deterministically without modifying the caller tree', () => {
    const tree = { type: 'text', text: '固定结果', style: { color: '#3b82f6', fontSize: 16 } };
    const before = JSON.stringify(tree);
    const html = compileSketchHtml(tree);
    expect(compileSketchHtml(tree)).toBe(html);
    expect(JSON.stringify(tree)).toBe(before);
  });
});
