export interface NormalizedColorAdjustParams {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  hue: number;
  highlights: number;
  shadows: number;
}

const NEUTRAL_PARAMS: NormalizedColorAdjustParams = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  hue: 0,
  highlights: 0,
  shadows: 0,
};

function clampNumber(value: unknown, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(min, Math.min(max, numeric));
}

export function normalizeColorAdjustParams(value: unknown): NormalizedColorAdjustParams {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...NEUTRAL_PARAMS };
  }

  const input = value as Record<string, unknown>;
  return {
    brightness: clampNumber(input.brightness, -100, 100),
    contrast: clampNumber(input.contrast, -100, 100),
    saturation: clampNumber(input.saturation, -100, 100),
    temperature: clampNumber(input.temperature, -100, 100),
    hue: clampNumber(input.hue, -180, 180),
    highlights: clampNumber(input.highlights, -100, 100),
    shadows: clampNumber(input.shadows, -100, 100),
  };
}

export function isNeutralColorAdjustParams(params: NormalizedColorAdjustParams): boolean {
  return Object.values(params).every((value) => value === 0);
}

export function colorAdjustPreviewFilter(params: NormalizedColorAdjustParams): string {
  const filters = [
    `brightness(${1 + params.brightness / 200})`,
    `contrast(${1 + params.contrast / 100})`,
    `saturate(${1 + params.saturation / 100})`,
    `hue-rotate(${params.hue}deg)`,
  ];

  if (params.temperature > 0) {
    filters.push(`sepia(${params.temperature / 200})`, `saturate(${1 + params.temperature / 300})`);
  } else if (params.temperature < 0) {
    filters.push(`hue-rotate(${-params.temperature * 0.5}deg)`, `saturate(${1 - params.temperature / 500})`);
  }

  return filters.join(' ');
}
