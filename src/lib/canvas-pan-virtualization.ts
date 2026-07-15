export function shouldSuspendCanvasVirtualization(isPanning: boolean, isMiddlePanning: boolean): boolean {
  return isPanning || isMiddlePanning;
}
