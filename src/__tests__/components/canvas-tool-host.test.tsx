import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CanvasToolHost } from '@/components/canvas/CanvasToolHost';
import {
  CLOSED_CANVAS_TOOL_SESSION,
  openCanvasToolSession,
} from '@/lib/canvas-kernel/tool-registry';

const hostSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas/CanvasToolHost.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');
const canvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('CanvasToolHost', () => {
  it('renders one active panel inside a stable floating-panel boundary', () => {
    const session = openCanvasToolSession(CLOSED_CANVAS_TOOL_SESSION, 'erase', {
      projectId: 'project-a',
      sourceImageIds: ['image-a'],
      entryPoint: 'image-toolbar',
    });
    const markup = renderToStaticMarkup(createElement(
      CanvasToolHost,
      { session, onRequestClose: () => undefined },
      createElement('div', { 'data-testid': 'erase-panel' }),
    ));

    expect(markup).toContain('data-canvas-tool-host="true"');
    expect(markup).toContain('data-floating-panel="canvas-tool-host"');
    expect(markup).toContain('data-tool-id="erase"');
    expect(markup).toContain('data-panel-placement="floating"');
    expect(markup).toContain('data-testid="erase-panel"');
  });

  it('renders nothing when the session is closed', () => {
    expect(renderToStaticMarkup(createElement(CanvasToolHost, {
      session: CLOSED_CANVAS_TOOL_SESSION,
      onRequestClose: () => undefined,
    }))).toBe('');
  });

  it('owns Escape, outside-pointer and portal event boundaries', () => {
    expect(hostSource).toContain("event.key === 'Escape'");
    expect(hostSource).toContain("document.addEventListener('pointerdown'");
    expect(hostSource).toContain("closest('[data-canvas-tool-host]')");
    expect(hostSource).toContain('createPortal(');
    expect(hostSource).toContain('document.body');
    expect(hostSource).toContain('event.stopPropagation()');
  });

  it('is wired into the existing Canvas without replacing business panels', () => {
    expect(canvasSource).toContain("from '@/lib/canvas-kernel/tool-registry'");
    expect(canvasSource).toContain("from '@/components/canvas/CanvasToolHost'");
    expect(canvasSource).toContain('const [canvasToolSession, setCanvasToolSession]');
    expect(canvasSource).toContain('openCanvasToolSession(');
    expect(canvasSource).toContain('closeCanvasToolSession(');
    expect(canvasSource).toContain('<CanvasToolHost');
    expect(canvasSource).toContain('<EffectReverseEngineeringPanel');
    expect(canvasSource).toContain('<HumanRepairPanel');
    expect(canvasSource).toContain('<AgentEditor');
  });
});
