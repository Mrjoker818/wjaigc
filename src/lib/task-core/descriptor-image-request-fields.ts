export interface DescriptorImageRequestFieldInput {
  aspectRatio: string;
  requestedPixelSize?: string;
  quality?: string;
  resolution?: string;
  sizeFormat?: 'pixel' | 'aspect-ratio';
}

export interface DescriptorImageRequestFields {
  size: string;
  sizePx?: string;
  quality?: string;
  resolution?: string;
}

export function buildDescriptorImageRequestFields(
  input: DescriptorImageRequestFieldInput,
): DescriptorImageRequestFields {
  const size = input.sizeFormat === 'aspect-ratio'
    ? input.aspectRatio
    : input.requestedPixelSize || input.aspectRatio;

  return {
    size,
    ...(input.sizeFormat === 'aspect-ratio' && input.requestedPixelSize
      ? { sizePx: input.requestedPixelSize }
      : {}),
    ...(input.quality !== undefined ? { quality: input.quality } : {}),
    ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
  };
}

/**
 * Compatibility filtering may remove unsupported transport fields, but it must
 * not replace values already accepted by the exact task-model descriptor.
 */
export function applyDescriptorApprovedImageFields(
  requestBody: Record<string, unknown>,
  fields: DescriptorImageRequestFields,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...requestBody, size: fields.size };

  if (fields.sizePx && /^\d+x\d+$/.test(fields.sizePx)) {
    const [width, height] = fields.sizePx.split('x');
    result.size_px = fields.sizePx;
    result.width = Number(width);
    result.height = Number(height);
  }

  if (fields.quality === undefined) delete result.quality;
  else result.quality = fields.quality;

  if (fields.resolution === undefined) delete result.resolution;
  else result.resolution = fields.resolution;

  return result;
}
