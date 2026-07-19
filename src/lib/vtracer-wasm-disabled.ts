export interface DisabledWasmVtracerOptions {
  colorMode: 'color' | 'bw';
  colorPrecision: number;
  filterSpeckle: number;
  cornerThreshold?: number;
  lengthThreshold?: number;
  hierarchical?: 'stacked' | 'cutout';
  maxColors?: number;
}

export const vtracerWasmClient = {
  async convertImage(_imageUrl: string, _options?: Partial<DisabledWasmVtracerOptions>) {
    return {
      success: false,
      svg: '',
      pathCount: 0,
      originalSize: { width: 0, height: 0 },
      processingTime: 0,
      error: 'Client-side WASM is disabled. Use the server vectorization pipeline.',
    };
  },
};
