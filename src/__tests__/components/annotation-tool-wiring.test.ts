import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');

describe('annotation tool wiring', () => {
  it('isolates the annotation toolbar from canvas pointer handling', () => {
    expect(source).toContain('data-toolbar="annotation-tools"');
    expect(source).toMatch(/data-toolbar="annotation-tools"[\s\S]{0,300}onMouseDown=\{\(e\) => e\.stopPropagation\(\)\}/);
    expect(source).toMatch(/data-toolbar="annotation-tools"[\s\S]{0,400}onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);
  });

  it('keeps brush annotation identity synchronous and does not render a mask overlay', () => {
    expect(source).toContain('brushDrawingAnnIdRef');
    expect(source).not.toContain('Brush mask overlay');
  });

  it('keeps annotation tool state in the canvas mouse-down callback dependencies', () => {
    const callback = source.slice(source.indexOf('const handleMouseDown'), source.indexOf('const handleMouseMove'));
    const dependencyList = callback.slice(callback.lastIndexOf('}, ['), callback.lastIndexOf(']);'));
    expect(dependencyList).toContain('annotationTool');
    expect(dependencyList).toContain('annotationBrushSize');
    expect(dependencyList).toContain('annotationBrushColor');
    expect(dependencyList).toContain('annotations');
  });
});
