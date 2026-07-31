import sharp from 'sharp';

interface CompositeMaskedEditInput {
  source: Buffer;
  edited: Buffer;
  mask: Buffer;
}

interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

async function decodeRgba(buffer: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height };
}

export async function compositeMaskedEdit({
  source,
  edited,
  mask,
}: CompositeMaskedEditInput): Promise<Buffer> {
  const [sourceImage, editedImage, maskImage] = await Promise.all([
    decodeRgba(source),
    decodeRgba(edited),
    sharp(mask).greyscale().raw().toBuffer({ resolveWithObject: true }),
  ]);

  if (
    editedImage.width !== sourceImage.width
    || editedImage.height !== sourceImage.height
  ) {
    throw new Error('edited image dimensions must match source');
  }

  if (
    maskImage.info.width !== sourceImage.width
    || maskImage.info.height !== sourceImage.height
  ) {
    throw new Error('mask dimensions must match source');
  }

  const output = Buffer.from(sourceImage.data);
  for (let pixel = 0; pixel < maskImage.data.length; pixel += 1) {
    const rgbaOffset = pixel * 4;
    const coverage = maskImage.data[pixel] / 255;
    if (coverage <= 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      output[rgbaOffset + channel] = Math.round(
        sourceImage.data[rgbaOffset + channel] * (1 - coverage)
        + editedImage.data[rgbaOffset + channel] * coverage,
      );
    }
    output[rgbaOffset + 3] = sourceImage.data[rgbaOffset + 3];
  }

  return sharp(output, {
    raw: {
      width: sourceImage.width,
      height: sourceImage.height,
      channels: 4,
    },
  }).png().toBuffer();
}
