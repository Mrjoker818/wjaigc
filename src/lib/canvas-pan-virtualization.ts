/**
 * Canvas panning is applied as a direct DOM transform between React renders.
 * Viewport culling must be paused during that interval because its coordinates
 * still describe the view before the transform.
 */
export function shouldSuspendCanvasVirtualization(
  isPanning: boolean,
  isMiddlePanning: boolean,
): boolean {
  return isPanning || isMiddlePanning;
}
