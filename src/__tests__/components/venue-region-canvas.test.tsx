// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VenueRegionCanvas, type VenueRegion } from '@/components/venue-region-canvas';

function fixture() {
  const images: FixtureImage[] = [];
  class FixtureImage {
    crossOrigin = '';
    naturalWidth = 100;
    naturalHeight = 200;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { images.push(this); }
    src = '';
  }
  vi.stubGlobal('Image', FixtureImage);
  const strokes: Array<{ width: number; color: string }> = [];
  const ctx = { clearRect: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(), strokeStyle: '', lineWidth: 0,
    strokeRect() { strokes.push({ width: this.lineWidth, color: this.strokeStyle }); },
    setLineDash: vi.fn(), measureText: () => ({ width: 10 }), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), fillText: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  return { images, ctx, strokes };
}

const entrance: VenueRegion = { id: 'door', name: '入口测试', type: 'entrance', position: { x: 0, y: 0, w: 1, h: 1 } };
const display: VenueRegion = { id: 'display', name: '展区测试', type: 'main-display', position: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } };
const description: VenueRegion = { id: 'text', name: '文字位置', type: 'other', position: '入口右侧' };

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads once per source and draws the current selection when the image settles', () => {
  const { images, ctx, strokes } = fixture();
  const props = { imageUrl: '/synthetic/venue-a.png', regions: [entrance, display, description] };
  const { rerender } = render(<VenueRegionCanvas {...props} selectedRegionId="door" />);
  rerender(<VenueRegionCanvas {...props} selectedRegionId="display" />);
  expect(images).toHaveLength(1);
  act(() => images[0].onload?.());
  expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  expect(strokes).toEqual([{ width: 2, color: '#f59e0b' }, { width: 3, color: '#3b82f6' }]);
  expect(ctx.fillText).toHaveBeenCalledTimes(2);
  rerender(<VenueRegionCanvas {...props} selectedRegionId="door" />);
  expect(images).toHaveLength(1);
  expect(strokes.slice(-2)).toEqual([{ width: 3, color: '#f59e0b' }, { width: 2, color: '#3b82f6' }]);
});

it('ignores an obsolete image callback and disables hits until the current image is ready', () => {
  const { images, ctx } = fixture();
  const select = vi.fn(), props = { regions: [entrance, display], onSelectRegion: select };
  const { container, rerender } = render(<VenueRegionCanvas {...props} imageUrl="/synthetic/venue-a.png" />);
  const lateA = images[0].onload!;
  act(lateA);
  const canvas = container.querySelector('canvas')!;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 300, height: 360 } as DOMRect);
  rerender(<VenueRegionCanvas {...props} imageUrl="/synthetic/venue-b.png" />);
  fireEvent.click(canvas, { clientX: 150, clientY: 180 });
  expect(select).not.toHaveBeenCalled();
  act(() => images[1].onload?.());
  const draws = ctx.drawImage.mock.calls.length;
  act(lateA);
  expect(ctx.drawImage).toHaveBeenCalledTimes(draws);
  expect(ctx.drawImage.mock.calls.at(-1)?.[0]).toBe(images[1]);
  fireEvent.click(canvas, { clientX: 150, clientY: 180 });
  expect(select).toHaveBeenCalledWith('display');
});

it('hit-tests the fitted portrait image and retains topmost ordering inside it', () => {
  const { images } = fixture();
  const select = vi.fn();
  const { container } = render(<VenueRegionCanvas imageUrl="/synthetic/portrait.png" regions={[entrance, display, description]} onSelectRegion={select} />);
  act(() => images[0].onload?.());
  const canvas = container.querySelector('canvas')!;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 10, width: 300, height: 360 } as DOMRect);
  fireEvent.click(canvas, { clientX: 40, clientY: 190 });
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(canvas, { clientX: 170, clientY: 190 });
  fireEvent.click(canvas, { clientX: 90, clientY: 190 });
  expect(select.mock.calls).toEqual([['display'], ['door']]);
});
