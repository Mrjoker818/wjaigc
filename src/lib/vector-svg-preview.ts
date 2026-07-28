import sharp from 'sharp';
import { sanitizeEditableSvg } from '@/lib/vector-design';

export interface PreparedVectorSvg {
  svg: string;
  previewBuffer: Buffer;
  width: number;
  height: number;
  pathCount: number;
}

function readSvgSize(svg: string): { width: number; height: number } {
  const viewBox = svg.match(
    /\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s*["']/i,
  );
  if (viewBox) {
    return {
      width: Math.max(1, Number(viewBox[1])),
      height: Math.max(1, Number(viewBox[2])),
    };
  }
  const width = Number(svg.match(/\bwidth=["']([\d.]+)/i)?.[1] || 1024);
  const height = Number(svg.match(/\bheight=["']([\d.]+)/i)?.[1] || 1024);
  return { width, height };
}

export async function prepareVectorSvgAsset(svgInput: string): Promise<PreparedVectorSvg> {
  const svg = sanitizeEditableSvg(svgInput);
  const { width, height } = readSvgSize(svg);
  const previewBuffer = await sharp(Buffer.from(svg, 'utf8'), {
    density: 96,
    limitInputPixels: 20_000_000,
    failOn: 'error',
  })
    .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();

  return {
    svg,
    previewBuffer,
    width,
    height,
    pathCount: (
      svg.match(/<(?:path|rect|circle|ellipse|polygon|polyline|line)\b/gi) || []
    ).length,
  };
}
