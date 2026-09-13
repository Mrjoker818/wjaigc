import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('mobile canvas CSS contract', () => {
  it('scopes touch capture to the canvas interaction surface', () => {
    expect(css).toMatch(/\[data-canvas-interaction-surface\][^{]*\{[^}]*touch-action:\s*none/);
    expect(css).not.toMatch(/(?:^|,)\s*(?:body|html)\s*\{[^}]*touch-action:\s*none/);
  });

  it('keeps mobile drawers and quick create inside the safe viewport', () => {
    expect(css).toContain('@media (max-width: 767px)');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toMatch(/\[data-mobile-canvas-toolbar-drawer\][^{]*\{[^}]*max-height:/);
    expect(css).toMatch(/\[data-mobile-image-actions-drawer\][^{]*\{[^}]*max-height:/);
    expect(css).toMatch(/\[data-simple-create-page\][^{]*\{[^}]*overflow-y:\s*auto/);
  });

  it('removes mobile drawer motion when reduced motion is requested', () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/\[data-mobile-canvas-toolbar-drawer\][\s\S]*transition-duration:\s*0ms\s*!important/);
    expect(css).toMatch(/\[data-mobile-image-actions\][\s\S]*transition-duration:\s*0ms\s*!important/);
  });
});
