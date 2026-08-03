import type { NormalizedPoint, NormalizedQuad } from './types';

const MAX_OUTPUT_PIXELS = 64_000_000;
const EPSILON = 1e-10;

type Matrix3 = [number, number, number, number, number, number, number, number, number];

function solveLinearSystem(matrix: number[][], values: number[]): number[] {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) {
        pivotRow = row;
      }
    }
    if (Math.abs(augmented[pivotRow][column]) < EPSILON) {
      throw new Error('Perspective quadrilateral is singular');
    }
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];

    const pivot = augmented[column][column];
    for (let current = column; current <= size; current += 1) {
      augmented[column][current] /= pivot;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let current = column; current <= size; current += 1) {
        augmented[row][current] -= factor * augmented[column][current];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function solveUnitSquareToQuad(quad: NormalizedQuad): Matrix3 {
  const targets: NormalizedPoint[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const matrix: number[][] = [];
  const values: number[] = [];

  targets.forEach((point, index) => {
    const source = quad[index];
    matrix.push([point.x, point.y, 1, 0, 0, 0, -source.x * point.x, -source.x * point.y]);
    values.push(source.x);
    matrix.push([0, 0, 0, point.x, point.y, 1, -source.y * point.x, -source.y * point.y]);
    values.push(source.y);
  });

  const coefficients = solveLinearSystem(matrix, values);
  return [...coefficients, 1] as Matrix3;
}

function project(matrix: Matrix3, x: number, y: number): NormalizedPoint {
  const denominator = matrix[6] * x + matrix[7] * y + matrix[8];
  if (Math.abs(denominator) < EPSILON) {
    throw new Error('Perspective projection is singular');
  }
  return {
    x: (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
    y: (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator,
  };
}

function readChannel(
  source: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number {
  const safeX = Math.max(0, Math.min(width - 1, x));
  const safeY = Math.max(0, Math.min(height - 1, y));
  return source[(safeY * width + safeX) * 4 + channel];
}

function sampleBilinear(
  source: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  output: Buffer,
  outputOffset: number,
): void {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const dx = x - x0;
  const dy = y - y0;

  for (let channel = 0; channel < 4; channel += 1) {
    const top = readChannel(source, width, height, x0, y0, channel) * (1 - dx) +
      readChannel(source, width, height, x1, y0, channel) * dx;
    const bottom = readChannel(source, width, height, x0, y1, channel) * (1 - dx) +
      readChannel(source, width, height, x1, y1, channel) * dx;
    output[outputOffset + channel] = Math.round(top * (1 - dy) + bottom * dy);
  }
}

function assertDimensions(width: number, height: number, label: string): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`${label} dimensions must be positive integers`);
  }
  if (width * height > MAX_OUTPUT_PIXELS) {
    throw new Error(`${label} exceeds the safe pixel limit`);
  }
}

export function warpPerspectiveRgba(
  source: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  sourceQuad: NormalizedQuad,
  outputWidth: number,
  outputHeight: number,
): Buffer {
  assertDimensions(sourceWidth, sourceHeight, 'Source image');
  assertDimensions(outputWidth, outputHeight, 'Output image');
  if (source.byteLength !== sourceWidth * sourceHeight * 4) {
    throw new Error('Source buffer length does not match RGBA dimensions');
  }

  const transform = solveUnitSquareToQuad(sourceQuad);
  const output = Buffer.alloc(outputWidth * outputHeight * 4);

  for (let y = 0; y < outputHeight; y += 1) {
    const normalizedY = outputHeight === 1 ? 0 : y / (outputHeight - 1);
    for (let x = 0; x < outputWidth; x += 1) {
      const normalizedX = outputWidth === 1 ? 0 : x / (outputWidth - 1);
      const sourcePoint = project(transform, normalizedX, normalizedY);
      const sourceX = sourcePoint.x * (sourceWidth - 1);
      const sourceY = sourcePoint.y * (sourceHeight - 1);
      sampleBilinear(
        source,
        sourceWidth,
        sourceHeight,
        sourceX,
        sourceY,
        output,
        (y * outputWidth + x) * 4,
      );
    }
  }

  return output;
}
