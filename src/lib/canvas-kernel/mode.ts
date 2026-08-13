export type CanvasKernelMode = 'legacy' | 'shadow' | 'canvas-v2';

export type CanvasKernelReadStrategy =
  | 'legacy-authoritative'
  | 'shadow-compare'
  | 'kernel-authoritative';

export type CanvasKernelWriteStrategy =
  | 'legacy-authoritative'
  | 'kernel-authoritative';

export function resolveCanvasKernelMode(raw?: string): CanvasKernelMode {
  return raw === 'shadow' || raw === 'canvas-v2' ? raw : 'legacy';
}

export function getCanvasKernelReadStrategy(mode: CanvasKernelMode): CanvasKernelReadStrategy {
  if (mode === 'shadow') return 'shadow-compare';
  return mode === 'canvas-v2' ? 'kernel-authoritative' : 'legacy-authoritative';
}

export function getCanvasKernelWriteStrategy(mode: CanvasKernelMode): CanvasKernelWriteStrategy {
  return mode === 'canvas-v2' ? 'kernel-authoritative' : 'legacy-authoritative';
}
