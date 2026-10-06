interface VideoDownloadFormat {
  extension: 'mp4' | 'webm' | 'mov' | 'm4v';
  mimeType: string;
}

const VIDEO_FORMATS: readonly VideoDownloadFormat[] = [
  { extension: 'mp4', mimeType: 'video/mp4' },
  { extension: 'webm', mimeType: 'video/webm' },
  { extension: 'mov', mimeType: 'video/quicktime' },
  { extension: 'm4v', mimeType: 'video/x-m4v' },
];

function sourceFormat(source: string): VideoDownloadFormat | undefined {
  try {
    const pathname = decodeURIComponent(new URL(source, 'https://media.invalid').pathname).toLowerCase();
    return VIDEO_FORMATS.find(format => pathname.endsWith(`.${format.extension}`));
  } catch {
    return undefined;
  }
}

/** Format metadata only: never transcodes or changes the downloaded bytes. */
export function resolveVideoDownloadFormat(source: string, contentType?: string | null): VideoDownloadFormat {
  const mime = contentType?.split(';', 1)[0].trim().toLowerCase();
  return VIDEO_FORMATS.find(format => format.mimeType === mime) ?? sourceFormat(source) ?? VIDEO_FORMATS[0];
}

/** Before fetching, an extensionless source has no known container format. */
export function getVideoDownloadLabel(source: string | undefined): string {
  const format = source ? sourceFormat(source) : undefined;
  return format ? `${format.extension.toUpperCase()} 视频` : '原格式视频';
}
