import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prepareVectorSvgAsset } from '@/lib/vector-svg-preview';

describe('vector SVG preview', () => {
  it('renders a 4MP SVG without tripping the pixel guard', async () => {
    const asset = await prepareVectorSvgAsset(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048">'
      + '<rect width="2048" height="2048" fill="#d4af37"/>'
      + '</svg>',
    );
    const metadata = await sharp(asset.previewBuffer).metadata();

    expect(asset.width).toBe(2048);
    expect(asset.height).toBe(2048);
    expect(metadata.width).toBe(1400);
    expect(metadata.height).toBe(1400);
  });

  it('sanitizes SVG before passing it to Sharp', async () => {
    await expect(prepareVectorSvgAsset(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.test/x)</style></svg>',
    )).rejects.toThrow();
  });
});
