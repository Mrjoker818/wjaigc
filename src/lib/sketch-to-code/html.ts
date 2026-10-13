export const SKETCH_PREVIEW_SANDBOX = '';

export interface SketchUiStyle {
  display?: 'block' | 'flex' | 'grid';
  position?: 'relative' | 'absolute';
  flexDirection?: 'row' | 'column';
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
  justifyContent?: 'start' | 'center' | 'end' | 'space-between' | 'space-around';
  textAlign?: 'left' | 'center' | 'right';
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  padding?: number;
  margin?: number;
  gap?: number;
  borderRadius?: number;
  borderWidth?: number;
  fontSize?: number;
  fontWeight?: 400 | 500 | 600 | 700;
  lineHeight?: number;
  opacity?: number;
  gridColumns?: number;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
}

export interface SketchUiNode {
  type: 'container' | 'heading' | 'text' | 'button' | 'label' | 'input' | 'separator';
  style?: SketchUiStyle;
  children?: readonly SketchUiNode[];
  text?: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  inputType?: 'text' | 'email' | 'password' | 'number' | 'checkbox' | 'radio';
  value?: string;
  placeholder?: string;
  checked?: boolean;
}

const MAX_NODES = 200;
const MAX_DEPTH = 12;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_HTML_BYTES = 256 * 1024;
const encoder = new TextEncoder();
const NODE_FIELDS: Readonly<Record<SketchUiNode['type'], readonly string[]>> = {
  container: ['type', 'style', 'children'],
  heading: ['type', 'style', 'level', 'text'],
  text: ['type', 'style', 'text'],
  button: ['type', 'style', 'text'],
  label: ['type', 'style', 'text'],
  input: ['type', 'style', 'inputType', 'value', 'placeholder', 'checked'],
  separator: ['type', 'style'],
};
const ENUM_STYLES: Readonly<Record<string, readonly (string | number)[]>> = {
  display: ['block', 'flex', 'grid'], position: ['relative', 'absolute'],
  flexDirection: ['row', 'column'], alignItems: ['start', 'center', 'end', 'stretch'],
  justifyContent: ['start', 'center', 'end', 'space-between', 'space-around'],
  textAlign: ['left', 'center', 'right'], fontWeight: [400, 500, 600, 700],
};
const NUMBER_STYLES: Readonly<Record<string, readonly [number, number, string]>> = {
  width: [0, 2048, 'px'], height: [0, 2048, 'px'], left: [-2048, 2048, 'px'], top: [-2048, 2048, 'px'],
  padding: [0, 256, 'px'], margin: [0, 256, 'px'], gap: [0, 256, 'px'], borderRadius: [0, 256, 'px'],
  borderWidth: [0, 16, 'px'], fontSize: [8, 96, 'px'], lineHeight: [1, 3, ''], opacity: [0, 1, ''],
};
const COLOR_STYLES = ['color', 'backgroundColor', 'borderColor'];
const STYLE_FIELDS = [...Object.keys(ENUM_STYLES), ...Object.keys(NUMBER_STYLES), ...COLOR_STYLES, 'gridColumns'];
const CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function invalid(): never {
  throw new Error('SKETCH_UI_INVALID');
}

// Model output must be plain JSON data. Do not execute accessors while validating it.
function readRecord(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || (allowed && !allowed.includes(key))) return invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return invalid();
    result[key] = descriptor.value as unknown;
  }
  return result;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character: string): string => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? invalid());
}

function finiteNumber(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return invalid();
  return value;
}

function compileStyle(value: unknown): string {
  const style = readRecord(value, STYLE_FIELDS);
  const declarations: string[] = [];
  // Fixed property order makes the delivered HTML stable across JSON key ordering.
  for (const key of STYLE_FIELDS) {
    if (!Object.hasOwn(style, key)) continue;
    const item = style[key];
    const cssKey = key.replace(/[A-Z]/g, (letter: string): string => `-${letter.toLowerCase()}`);
    if (Object.hasOwn(ENUM_STYLES, key)) {
      if ((typeof item !== 'string' && typeof item !== 'number') || !ENUM_STYLES[key].includes(item)) return invalid();
      declarations.push(`${cssKey}:${item}`);
    } else if (Object.hasOwn(NUMBER_STYLES, key)) {
      const [min, max, unit] = NUMBER_STYLES[key];
      declarations.push(`${cssKey}:${finiteNumber(item, min, max)}${unit}`);
    } else if (COLOR_STYLES.includes(key)) {
      if (typeof item !== 'string' || !/^#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i.test(item)) return invalid();
      declarations.push(`${cssKey}:${item.toLowerCase()}`);
    } else {
      const columns = finiteNumber(item, 1, 12);
      if (!Number.isInteger(columns)) return invalid();
      declarations.push(`grid-template-columns:repeat(${columns},minmax(0,1fr))`);
    }
  }
  if (Object.hasOwn(style, 'borderWidth')) declarations.push('border-style:solid');
  return declarations.join(';');
}

/** Compile only a bounded static UI tree, never arbitrary model HTML or CSS. */
export function compileSketchHtml(tree: unknown): string {
  let nodes = 0;
  let textBytes = 0;
  const ancestors = new WeakSet<object>();
  function text(value: unknown): string {
    if (typeof value !== 'string' || value.length > MAX_TEXT_BYTES) return invalid();
    textBytes += encoder.encode(value).byteLength;
    if (textBytes > MAX_TEXT_BYTES) throw new Error('SKETCH_UI_TEXT_LIMIT');
    return escapeHtml(value);
  }
  function visit(value: unknown, depth: number): string {
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error('SKETCH_UI_TREE_LIMIT');
    const initial = readRecord(value);
    const type = initial.type;
    if (typeof type !== 'string' || !Object.hasOwn(NODE_FIELDS, type)) return invalid();
    const node = readRecord(value, NODE_FIELDS[type as SketchUiNode['type']]);
    const identity = value as object;
    if (ancestors.has(identity)) return invalid();
    ancestors.add(identity);
    try {
      const style = Object.hasOwn(node, 'style') ? ` style="${compileStyle(node.style)}"` : '';
      if (type === 'container') {
        const children: unknown = Object.hasOwn(node, 'children') ? node.children : [];
        if (!Array.isArray(children) || children.length >= MAX_NODES) return invalid();
        const parts: string[] = [];
        for (let index = 0; index < children.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(children, String(index));
          if (!descriptor || !('value' in descriptor)) return invalid();
          parts.push(visit(descriptor.value as unknown, depth + 1));
        }
        return `<div${style}>${parts.join('')}</div>`;
      }
      if (type === 'separator') return `<hr${style}>`;
      if (type === 'input') {
        const inputType: unknown = Object.hasOwn(node, 'inputType') ? node.inputType : 'text';
        if (typeof inputType !== 'string' || !['text', 'email', 'password', 'number', 'checkbox', 'radio'].includes(inputType)) return invalid();
        if (Object.hasOwn(node, 'checked') && typeof node.checked !== 'boolean') return invalid();
        const valueAttribute = Object.hasOwn(node, 'value') ? ` value="${text(node.value)}"` : '';
        const placeholder = Object.hasOwn(node, 'placeholder') ? ` placeholder="${text(node.placeholder)}"` : '';
        const inert = inputType === 'checkbox' || inputType === 'radio' ? ' disabled' : ' readonly';
        return `<input type="${inputType}"${inert} autocomplete="off"${node.checked ? ' checked' : ''}${valueAttribute}${placeholder}${style}>`;
      }
      const content = text(node.text);
      if (type === 'heading') {
        const level = finiteNumber(Object.hasOwn(node, 'level') ? node.level : 1, 1, 6);
        if (!Number.isInteger(level)) return invalid();
        return `<h${level}${style}>${content}</h${level}>`;
      }
      const tag = type === 'text' ? 'p' : type;
      return `<${tag}${type === 'button' ? ' type="button"' : ''}${style}>${content}</${tag}>`;
    } finally {
      ancestors.delete(identity);
    }
  }
  const body = visit(tree, 1);
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>草图界面</title><style>*{box-sizing:border-box}body{margin:0;background:#fff;color:#111827;font-family:system-ui,sans-serif}main{position:relative;padding:16px;overflow-wrap:anywhere}p,button,label{white-space:pre-wrap}input,button{font:inherit}</style></head><body><main>${body}</main></body></html>`;
  if (encoder.encode(html).byteLength > MAX_HTML_BYTES) throw new Error('SKETCH_UI_HTML_LIMIT');
  return html;
}
