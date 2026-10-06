/** Shared, exact export namespace. These limits do not narrow legacy artifacts. */
export const MAX_ASSET_BINARY_BYTES = 256 * 1024 * 1024;
export const MAX_ASSET_VIDEO_BYTES = 512 * 1024 * 1024;
export const BINARY_MEDIA_CHUNK_BYTES = 16 * 1024 * 1024;
export const BINARY_MEDIA_PIXEL_LIMIT = 100_000_000;
export const EXPORT_FILENAME = /^([a-f0-9]{16})-[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif|avif|bmp|mp4|webm|mov|m4v|json|zip)$/u;
export const EXPORT_KEY = /^exports\/[a-f0-9]{16}-[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|gif|avif|bmp|mp4|webm|mov|m4v|json|zip)$/u;

const MIME_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'image/png': ['png'], 'image/jpeg': ['jpeg', 'jpg'], 'image/webp': ['webp'],
  'image/gif': ['gif'], 'image/avif': ['avif'], 'image/bmp': ['bmp'],
  'video/mp4': ['mp4'], 'video/webm': ['webm'], 'video/quicktime': ['mov'], 'video/x-m4v': ['m4v'],
  'application/json': ['json'], 'application/zip': ['zip'],
};

export function binaryExtensions(mimeType: string): readonly string[] | undefined {
  return Object.hasOwn(MIME_EXTENSIONS, mimeType) ? MIME_EXTENSIONS[mimeType] : undefined;
}

export function binaryByteLimit(mimeType: string): number {
  return typeof mimeType === 'string' && mimeType.startsWith('video/') && binaryExtensions(mimeType) ? MAX_ASSET_VIDEO_BYTES : MAX_ASSET_BINARY_BYTES;
}

export function exportMediaDescriptor(filename: string): { mimeType: string; attachment: boolean; maxBytes: number; video: boolean } | null {
  const match = EXPORT_FILENAME.exec(filename);
  if (!match || filename.includes('..')) return null;
  const mimeType = Object.keys(MIME_EXTENSIONS).find(mime => MIME_EXTENSIONS[mime].includes(match[2]));
  if (!mimeType) return null;
  return { mimeType, attachment: mimeType.startsWith('application/'), maxBytes: binaryByteLimit(mimeType), video: mimeType.startsWith('video/') };
}
