import type { PortPosition } from '@/lib/node-port-position';

/** Read a legacy HTML port center in the untransformed SVG world space. */
export function getLegacyPortWorldPosition(
  portElement: HTMLElement,
  nodeLayer: HTMLElement | null,
): PortPosition | null {
  if (!nodeLayer?.contains(portElement)) return null;
  const layerRect = nodeLayer.getBoundingClientRect();
  const portRect = portElement.getBoundingClientRect();
  // Rects use the effective CSS transform, which can lag the inline zoom target.
  // Use that same painted scale, without rounding fractional layout widths.
  const transform = nodeLayer.ownerDocument.defaultView?.getComputedStyle(nodeLayer).transform;
  const matrix = transform?.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number);
  if (!matrix || matrix.length !== 6 || !matrix.every(Number.isFinite)
    || matrix[1] !== 0 || matrix[2] !== 0 || matrix[0] !== matrix[3]) return null;
  const scale = matrix[0];
  if (scale <= 0 || portRect.width <= 0 || portRect.height <= 0) return null;
  // Subpixel rounding avoids floating-point churn when the viewport changes.
  return {
    x: Math.round((portRect.left + portRect.width / 2 - layerRect.left) / scale * 1e6) / 1e6,
    y: Math.round((portRect.top + portRect.height / 2 - layerRect.top) / scale * 1e6) / 1e6,
  };
}
