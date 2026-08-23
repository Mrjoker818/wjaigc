export const WASM_TRACER_MAX_PIXELS = 512 * 512;

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export function computeWasmTraceBudget(
  width: number,
  height: number,
  maxPixels: number = WASM_TRACER_MAX_PIXELS,
): { scale: number; width: number; height: number } {
  const normalizedWidth = normalizePositiveInteger(width, 1);
  const normalizedHeight = normalizePositiveInteger(height, 1);
  const normalizedMaxPixels = normalizePositiveInteger(
    maxPixels,
    WASM_TRACER_MAX_PIXELS,
  );
  const pixels = normalizedWidth * normalizedHeight;

  if (pixels <= normalizedMaxPixels) {
    return {
      scale: 1,
      width: normalizedWidth,
      height: normalizedHeight,
    };
  }

  const scale = Math.sqrt(normalizedMaxPixels / pixels);
  return {
    scale,
    width: Math.max(1, Math.floor(normalizedWidth * scale)),
    height: Math.max(1, Math.floor(normalizedHeight * scale)),
  };
}
