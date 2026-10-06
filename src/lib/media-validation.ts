export type SafeMediaKind = 'image' | 'video';

export interface SafeMediaType {
  extension: string;
  kind: SafeMediaKind;
  mimeType: string;
}

const RASTER_IMAGES: Record<string, SafeMediaType> = {
  'image/jpeg': { extension: 'jpg', kind: 'image', mimeType: 'image/jpeg' },
  'image/png': { extension: 'png', kind: 'image', mimeType: 'image/png' },
  'image/gif': { extension: 'gif', kind: 'image', mimeType: 'image/gif' },
  'image/webp': { extension: 'webp', kind: 'image', mimeType: 'image/webp' },
  'image/bmp': { extension: 'bmp', kind: 'image', mimeType: 'image/bmp' },
  'image/avif': { extension: 'avif', kind: 'image', mimeType: 'image/avif' },
};

const VIDEOS: Record<string, SafeMediaType> = {
  'video/mp4': { extension: 'mp4', kind: 'video', mimeType: 'video/mp4' },
  'video/webm': { extension: 'webm', kind: 'video', mimeType: 'video/webm' },
  'video/quicktime': { extension: 'mov', kind: 'video', mimeType: 'video/quicktime' },
  'video/x-m4v': { extension: 'm4v', kind: 'video', mimeType: 'video/x-m4v' },
  'video/x-msvideo': { extension: 'avi', kind: 'video', mimeType: 'video/x-msvideo' },
  'video/x-matroska': { extension: 'mkv', kind: 'video', mimeType: 'video/x-matroska' },
};

function normalizeMimeType(value: string): string {
  return value.split(';', 1)[0].trim().toLowerCase();
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function isIsoBaseMedia(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
}

function matchesImageSignature(mimeType: string, bytes: Uint8Array): boolean {
  switch (mimeType) {
    case 'image/jpeg': return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
    case 'image/png': return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/gif': return hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38]);
    case 'image/webp': return hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
    case 'image/bmp': return hasPrefix(bytes, [0x42, 0x4d]);
    case 'image/avif': return isIsoBaseMedia(bytes) && /avif|avis/.test(String.fromCharCode(...bytes.slice(8, 32)));
    default: return false;
  }
}

function matchesVideoSignature(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === 'video/webm' || mimeType === 'video/x-matroska') return hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
  if (mimeType === 'video/x-msvideo') return hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === 'AVI ';
  return isIsoBaseMedia(bytes);
}

export function getSafeRasterImageExtension(mimeType: string): string | null {
  return RASTER_IMAGES[normalizeMimeType(mimeType)]?.extension ?? null;
}

export function inferSafeRasterImageType(buffer: Uint8Array): SafeMediaType | null {
  return Object.values(RASTER_IMAGES).find(type => matchesImageSignature(type.mimeType, buffer)) ?? null;
}

export function getSafeImageTypeFromDataUrl(dataUrl: string): SafeMediaType | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,/i);
  if (!match) return null;
  return RASTER_IMAGES[normalizeMimeType(match[1])] ?? null;
}

export function validateSafeMediaFile(file: Pick<File, 'type'>, buffer: Uint8Array): SafeMediaType | null {
  return getSafeMediaTypeFromResponse(file.type, buffer, false);
}

export function getSafeMediaTypeFromResponse(
  contentType: string,
  buffer: Uint8Array,
  isVideo: boolean,
): SafeMediaType | null {
  const mimeType = normalizeMimeType(contentType);
  const image = RASTER_IMAGES[mimeType];
  if (image) return matchesImageSignature(mimeType, buffer) ? image : null;

  const video = VIDEOS[mimeType];
  if (!video || (!isVideo && !mimeType.startsWith('video/'))) return null;
  return matchesVideoSignature(mimeType, buffer) ? video : null;
}

export function isAllowedPublicMediaExtension(extension: string): boolean {
  return new Set([
    '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif',
    '.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv',
    '.svg', '.glb', '.gltf', '.obj', '.mtl',
  ]).has(extension.toLowerCase());
}

/** Shared public-resource boundary; private data roots are never media sources. */
export function isAllowedPublicMediaPath(pathParts: readonly string[]): boolean {
  if (pathParts.length === 0 || pathParts.some(part => !/^[a-zA-Z0-9._-]+$/.test(part) || part.includes('..'))) {
    return false;
  }
  if (['system', 'users'].includes(pathParts[0].toLowerCase())) return false;
  const filename = pathParts[pathParts.length - 1];
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex > 0 && isAllowedPublicMediaExtension(filename.slice(dotIndex));
}
