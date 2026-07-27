import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AnnotationComposer } from '@/features/annotations/annotation-composer';
import { AnnotationOverlay } from '@/features/annotations/annotation-overlay';
import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';

const canvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);
const nodeWorkspaceSource = readFileSync(
  resolve(process.cwd(), 'src/features/annotations/node-annotation-workspace.tsx'),
  'utf8',
);
const canvasWorkspaceSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
);

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | null {
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  if (predicate(node)) return node;

  for (const child of Children.toArray(node.props.children as ReactNode)) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

const brushAnnotation: CanvasAnnotationV2 = {
  id: 'brush-1',
  projectId: 'project-1',
  sourceImageId: 'image-1',
  sourceVersionId: 'image-1:1',
  type: 'brush',
  geometry: {
    kind: 'brush',
    points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }],
    width: 0.04,
  },
  status: 'ready',
  createdAt: 1,
  updatedAt: 1,
};

const textAnnotation: CanvasAnnotationV2 = {
  id: 'text-1',
  projectId: 'project-1',
  sourceImageId: 'image-1',
  sourceVersionId: 'image-1:1',
  type: 'text',
  geometry: { kind: 'text', point: { x: 0.5, y: 0.5 } },
  instruction: 'Original instruction',
  status: 'ready',
  createdAt: 1,
  updatedAt: 1,
};

describe('fused annotation component behavior', () => {
  it('positions the composer inside its canvas viewport instead of the browser viewport', () => {
    const tree = AnnotationComposer({
      annotations: [],
      selectedAnnotationId: null,
      tool: 'region',
      prompt: '',
      modelId: '',
      rightInset: 480,
      onToolChange: vi.fn(),
      onPromptChange: vi.fn(),
      onModelChange: vi.fn(),
      onSelectAnnotation: vi.fn(),
      onRemoveAnnotation: vi.fn(),
      onUpdateInstruction: vi.fn(),
      onExecute: vi.fn(),
      onCancel: vi.fn(),
      onClose: vi.fn(),
    });
    const composer = findElement(
      tree,
      (element) => element.props['data-testid'] === 'annotation-composer',
    );
    const className = String(composer?.props.className || '');

    expect(className.split(' ')).toContain('absolute');
    expect(className.split(' ')).not.toContain('fixed');
    expect(className).not.toContain('100vw');
    expect(composer?.props.style).toMatchObject({
      left: 'calc((100% - 480px) / 2)',
      width: 'min(960px, calc(100% - 480px - 32px))',
    });
    const markup = renderToStaticMarkup(tree);
    expect(markup).not.toContain('min-[820px]:flex-nowrap');
  });

  it('renders all tools and a selected text instruction editor', () => {
    const onUpdateInstruction = vi.fn();
    const onRemoveAnnotation = vi.fn();
    const tree = AnnotationComposer({
      annotations: [textAnnotation],
      selectedAnnotationId: textAnnotation.id,
      tool: 'text',
      prompt: '',
      modelId: '',
      onToolChange: vi.fn(),
      onPromptChange: vi.fn(),
      onModelChange: vi.fn(),
      onSelectAnnotation: vi.fn(),
      onRemoveAnnotation,
      onUpdateInstruction,
      onExecute: vi.fn(),
      onCancel: vi.fn(),
      onClose: vi.fn(),
    });

    for (const tool of ['semantic-object', 'region', 'brush', 'arrow', 'text']) {
      expect(findElement(
        tree,
        (element) => element.props['data-annotation-tool'] === tool,
      )).not.toBeNull();
    }

    const editor = findElement(
      tree,
      (element) => element.props['data-testid'] === 'annotation-instruction-editor',
    );
    expect(editor?.props.value).toBe('Original instruction');
    (editor?.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: 'Updated instruction' },
    });
    expect(onUpdateInstruction).toHaveBeenCalledWith('text-1', 'Updated instruction');

    const removeButton = findElement(
      tree,
      (element) => element.props['data-annotation-remove'] === 'text-1',
    );
    (removeButton?.props.onClick as () => void)();
    expect(onRemoveAnnotation).toHaveBeenCalledWith('text-1');
  });

  it('renders committed brush width in constant screen pixels at every zoom', () => {
    const renderAtZoom = (zoom: number): string => renderToStaticMarkup(createElement(
      AnnotationOverlay,
      {
        annotations: [brushAnnotation],
        images: [{ id: 'image-1', x: 0, y: 0, width: 100, height: 100 }],
        zoom,
        viewOffset: { x: 0, y: 0 },
        brushScreenWidths: { 'brush-1': 12 },
      },
    ));

    const zoomOne = renderAtZoom(1);
    const zoomFour = renderAtZoom(4);

    expect(zoomOne).toContain('data-annotation-kind="brush"');
    expect(zoomOne).toContain('stroke-width="12"');
    expect(zoomFour).toContain('stroke-width="12"');
    expect(zoomFour).not.toContain('brushMaskDataUrl');
  });

  it('renders live vector previews for region, brush, and arrow gestures', () => {
    const common = {
      annotations: [],
      images: [{ id: 'image-1', x: 0, y: 0, width: 100, height: 100 }],
      zoom: 1,
      viewOffset: { x: 0, y: 0 },
    };
    const source = {
      projectId: 'project-1',
      imageId: 'image-1',
      versionId: 'image-1:1',
      imageRect: { x: 0, y: 0, width: 100, height: 100 },
    };

    const region = renderToStaticMarkup(createElement(AnnotationOverlay, {
      ...common,
      gesture: {
        kind: 'region',
        source,
        start: { x: 10, y: 10 },
        current: { x: 50, y: 50 },
      },
    }));
    const brush = renderToStaticMarkup(createElement(AnnotationOverlay, {
      ...common,
      gesture: {
        kind: 'brush',
        source,
        start: { x: 10, y: 10 },
        current: { x: 50, y: 50 },
        points: [{ x: 10, y: 10 }, { x: 50, y: 50 }],
      },
    }));
    const arrow = renderToStaticMarkup(createElement(AnnotationOverlay, {
      ...common,
      gesture: {
        kind: 'arrow',
        source,
        start: { x: 10, y: 10 },
        current: { x: 50, y: 50 },
      },
    }));

    expect(region).toContain('data-annotation-kind="draft-region"');
    expect(brush).toContain('data-annotation-kind="draft-brush"');
    expect(arrow).toContain('data-annotation-kind="draft-arrow"');
  });
});

describe('InfiniteCanvas annotation gesture integration', () => {
  it('uses pointer events and pointer capture while preserving the toolbar and C shortcut', () => {
    expect(canvasSource).toContain('onPointerDown={handlePointerDown}');
    expect(canvasSource).toContain('onPointerMove={handlePointerMove}');
    expect(canvasSource).toContain('onPointerUp={handlePointerUp}');
    expect(canvasSource).toContain('onPointerCancel={handlePointerCancel}');
    expect(canvasSource).toContain('setPointerCapture');
    expect(canvasSource).toContain('releasePointerCapture');
    expect(canvasSource).toContain('data-toolbar="bottom-annotation-entry"');
    expect(canvasSource).toContain("e.code === 'KeyC'");
  });

  it('keeps the annotation entry at the end of the hover-expanded tool group', () => {
    const entryIndex = canvasSource.indexOf(
      'data-toolbar="bottom-annotation-entry"',
    );
    const expandedGroupIndex = canvasSource.indexOf(
      "bottomBarHovered ? 'max-w-[900px]",
    );

    expect(entryIndex).toBeGreaterThan(-1);
    expect(expandedGroupIndex).toBeGreaterThan(-1);
    expect(entryIndex).toBeGreaterThan(expandedGroupIndex);
  });

  it('reserves the visible right-panel width for the annotation composer', () => {
    expect(canvasSource).toContain(
      'rightInset={isPanelCollapsed ? 20 : 480}',
    );
  });

  it('does not cancel a captured annotation gesture on pointer leave', () => {
    const leaveStart = canvasSource.indexOf('const handlePointerLeave');
    expect(leaveStart).toBeGreaterThan(-1);
    const leaveHandler = canvasSource.slice(
      leaveStart,
      canvasSource.indexOf('const handleWheel'),
    );

    expect(leaveHandler).not.toContain('escapeAnnotationV2');
  });

  it('does not trigger state side effects inside the annotationMode functional updater', () => {
    expect(canvasSource).not.toContain('setAnnotationMode(current => {');
  });

  it('starts a fresh canvas annotation session instead of blocking another image', () => {
    expect(canvasSource).toContain(
      'pointerDownCanvas: beginCanvasAnnotationV2Gesture',
    );
    expect(canvasSource).toContain(
      "toast.info('已切换批注图片，请在当前图片上重新标记')",
    );
    expect(canvasSource).not.toContain(
      "toast.error('同一次批注编辑中只能标注同一张图片，请先完成当前批注')",
    );
  });

  it('wires semantic resolution and bundle execution instead of placeholder actions', () => {
    expect(canvasSource).toContain('resolveSemanticAnnotation');
    expect(canvasSource).toContain('executeAnnotationBundle');
    expect(canvasSource).toContain('buildEditIntentBundle');
    expect(canvasSource).toContain('commitResolvedSemantic');
    expect(canvasSource).not.toContain("toast.info('鎵规敞鎵ц閾捐矾姝ｅ湪鍒濆鍖?)");
  });

  it('falls back to region selection after semantic resolution errors in both modes', () => {
    expect(canvasSource).toContain("selectAnnotationV2Tool('region');");
    expect(canvasSource).toContain("baseMessage.includes('框选')");
    expect(nodeWorkspaceSource).toContain("selectTool('region');");
    expect(nodeWorkspaceSource).toContain("baseMessage.includes('框选')");
  });

  it('does not let a late same-project snapshot overwrite dirty annotations', () => {
    expect(canvasWorkspaceSource).toContain('const annotationsDirtyRef = useRef(false);');
    expect(canvasWorkspaceSource).toContain('if (!projectChanged && annotationsDirtyRef.current) return;');
    expect(canvasWorkspaceSource).toContain('annotationsDirtyRef.current = true;');
  });
});
