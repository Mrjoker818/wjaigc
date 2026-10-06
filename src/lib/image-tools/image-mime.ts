export type SupportedImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Detect the supported image type from bytes, never from a file extension. */
export function detectSupportedImageMimeType(buffer: Buffer): SupportedImageMimeType | null {
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) return 'image/webp';
  return null;
}
