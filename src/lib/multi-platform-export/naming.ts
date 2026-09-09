import { createHash } from 'node:crypto';
import type { ExportFilenameContext } from './types';

const MAX_EXPORT_BASE_NAME_LENGTH = 120;
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

export function sanitizeExportBaseName(value: string): string {
  let sanitized = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\.\.+/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[ .-]+|[ .-]+$/g, '');
  sanitized = Array.from(sanitized)
    .slice(0, MAX_EXPORT_BASE_NAME_LENGTH)
    .join('')
    .replace(/[ .]+$/g, '');

  if (!sanitized || WINDOWS_RESERVED_NAME.test(sanitized)) sanitized = 'asset';
  return sanitized;
}

function duplicateDigest(context: ExportFilenameContext): string {
  return createHash('sha256')
    .update(`${context.sourceVersionId}:${context.presetId}:${context.presetVersion}`)
    .digest('hex');
}

export function renderExportFilename(
  template: string,
  context: ExportFilenameContext,
  usedNames: Set<string>,
): string {
  const variables: Record<string, string> = {
    project: context.project,
    asset: context.asset,
    platform: context.platform,
    usage: context.usage,
    size: `${context.width}x${context.height}`,
    index: String(context.index),
  };
  const rendered = template.replace(/\{(project|asset|platform|usage|size|index)\}/g, (_match, token: string) => (
    variables[token]
  ));
  const baseName = sanitizeExportBaseName(rendered);
  const extension = context.outputFormat;
  let filename = `${baseName}.${extension}`;
  const normalizedName = (value: string) => value.toLocaleLowerCase('en-US');
  if (usedNames.has(normalizedName(filename))) {
    const digest = duplicateDigest(context);
    let suffixLength = 6;
    while (suffixLength <= digest.length) {
      filename = `${baseName}-${digest.slice(0, suffixLength)}.${extension}`;
      if (!usedNames.has(normalizedName(filename))) break;
      suffixLength += 2;
    }
    if (usedNames.has(normalizedName(filename))) {
      let sequence = 2;
      do {
        filename = `${baseName}-${digest}-${sequence}.${extension}`;
        sequence += 1;
      } while (usedNames.has(normalizedName(filename)));
    }
  }
  usedNames.add(normalizedName(filename));
  return filename;
}
