export function planImageOutputFanout(totalOutputs: number): 1[] {
  if (!Number.isInteger(totalOutputs) || totalOutputs < 1) return [1];
  return Array.from({ length: totalOutputs }, () => 1 as const);
}
