// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SharedCanvasViewer } from '@/components/canvas-share/shared-canvas-viewer';
import type { CanvasSharePublicDocument } from '@/lib/canvas-share/types';

const routeToken = 'T'.repeat(43);
const itemRef = `csr_${'U'.repeat(43)}`;
const publicDocument: CanvasSharePublicDocument = {
  title: '触控生命周期审阅画布',
  revisionLabel: '修订 1',
  createdAt: '2026-10-19T00:00:00.000Z',
  allowDownload: false,
  viewport: { offsetX: 12, offsetY: 34, zoom: 1.25 },
  items: [{
    itemRef,
    entityType: 'canvas-image',
    assetKind: 'image',
    transform: { x: 10, y: 20, width: 640, height: 480, rotation: 0, zIndex: 1 },
    display: { label: '审阅图', altText: '触控测试图片' },
    mimeType: 'image/png',
    width: 640,
    height: 480,
    mediaPath: `media/${itemRef}`,
  }],
};

// jsdom's MouseEvent omits these fields even when given PointerEventInit.
class TouchPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? '';
    this.isPrimary = init.isPrimary ?? false;
  }
}

type TouchEventType = 'pointerdown' | 'pointermove' | 'pointerup'
  | 'pointercancel' | 'lostpointercapture';

interface TouchViewer {
  content: HTMLElement;
  touch(type: TouchEventType, pointerId: number, clientX: number, clientY: number): void;
}

function withTouchViewer(check: (viewer: TouchViewer) => void): void {
  try {
    vi.stubGlobal('PointerEvent', TouchPointerEvent);
    vi.stubGlobal('fetch', (): never => {
      throw new Error('HTTP is outside the shared-canvas touch test boundary');
    });
    let eventTime = 1_000;
    let clockReads = 0;
    vi.spyOn(performance, 'now').mockImplementation((): number => (
      eventTime + (++clockReads / 1_000)
    ));

    render(
      <SharedCanvasViewer
        document={publicDocument}
        metadataEndpointBase={`/api/public/canvas-shares/${routeToken}/`}
      />,
    );
    const viewport = screen.getByRole('region', { name: '共享画布视口' });
    const content = screen.getByTestId('shared-canvas-content');
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 100, 1_000, 800));

    const touch = (
      type: TouchEventType,
      pointerId: number,
      clientX: number,
      clientY: number,
    ): void => {
      // Each input advances 40 ms; individual clock reads remain distinct.
      eventTime += 40;
      clockReads = 0;
      fireEvent(viewport, new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: 'touch',
        isPrimary: true,
        clientX,
        clientY,
        buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
      }));
    };

    check({ content, touch });
  } finally {
    try {
      cleanup();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  }
}

function expectViewport(
  content: HTMLElement,
  scale: number,
  offsetX: number,
  offsetY: number,
  percentage: string,
): void {
  expect(Number(content.getAttribute('data-scale'))).toBeCloseTo(scale, 8);
  expect(Number(content.getAttribute('data-offset-x'))).toBeCloseTo(offsetX, 8);
  expect(Number(content.getAttribute('data-offset-y'))).toBeCloseTo(offsetY, 8);
  expect(screen.getByLabelText('当前比例').textContent).toBe(percentage);
}

describe('canvas share aa touch lifecycle', () => {
  it('does not zoom when a legitimate first tap is followed by a canceled second touch', () => {
    withTouchViewer(({ content, touch }): void => {
      touch('pointerdown', 11, 700, 500);
      touch('pointerup', 11, 700, 500);
      expectViewport(content, 1.25, 12, 34, '125%');

      touch('pointerdown', 12, 700, 500);
      touch('pointercancel', 12, 700, 500);

      expectViewport(content, 1.25, 12, 34, '125%');
    });
  });

  it('does not pair a canceled first touch with a subsequent legitimate tap', () => {
    withTouchViewer(({ content, touch }): void => {
      touch('pointerdown', 21, 700, 500);
      touch('pointercancel', 21, 700, 500);
      expectViewport(content, 1.25, 12, 34, '125%');

      touch('pointerdown', 22, 700, 500);
      touch('pointerup', 22, 700, 500);

      expectViewport(content, 1.25, 12, 34, '125%');
    });
  });

  it('ends a drag on lost capture so stale movement and release cannot pan or arm a tap', () => {
    withTouchViewer(({ content, touch }): void => {
      touch('pointerdown', 31, 300, 200);
      touch('pointermove', 31, 304, 203);
      expectViewport(content, 1.25, 16, 37, '125%');

      touch('lostpointercapture', 31, 304, 203);
      touch('pointermove', 31, 340, 230);
      expectViewport(content, 1.25, 16, 37, '125%');
      expect(content.style.transition).not.toBe('none');

      touch('pointerup', 31, 304, 203);
      touch('pointerdown', 32, 304, 203);
      touch('pointerup', 32, 304, 203);

      expectViewport(content, 1.25, 16, 37, '125%');
    });
  });

  it('still zooms a legitimate touch double tap around its viewport-local anchor', () => {
    withTouchViewer(({ content, touch }): void => {
      touch('pointerdown', 41, 700, 500);
      touch('pointerup', 41, 700, 500);
      // Browsers dispatch this automatically after a normal captured release.
      touch('lostpointercapture', 41, 700, 500);
      expectViewport(content, 1.25, 12, 34, '125%');

      touch('pointerdown', 42, 700, 500);
      touch('pointerup', 42, 700, 500);

      expectViewport(content, 1.5, -85.6, -39.2, '150%');
    });
  });

  it('still pans with one touch and stops moving when that touch is released', () => {
    withTouchViewer(({ content, touch }): void => {
      touch('pointerdown', 51, 300, 200);
      touch('pointermove', 51, 340, 230);
      expectViewport(content, 1.25, 52, 64, '125%');
      expect(content.style.transition).toBe('none');

      touch('pointermove', 51, 355, 240);
      touch('pointerup', 51, 355, 240);
      touch('pointermove', 51, 400, 300);

      expectViewport(content, 1.25, 67, 74, '125%');
      expect(content.style.transition).not.toBe('none');
    });
  });
});
