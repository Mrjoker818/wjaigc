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
    .replace(/^[ .-]+|[ .-]+$/g, '')
    .slice(0, MAX_EXPORT_BASE_NAME_LENGTH)
    .replace(/[ .]+$/g, '');

  if (!sanitized || WINDOWS_RESERVED_NAME.test(sanitized)) sanitized = 'asset';
  return sanitized;
}

function duplicateSuffix(context: ExportFilenameContext): string {
  return createHash('sha256')
    .update(`${context.sourceVersionId}:${context.presetId}:${context.presetVersion}`)
    .digest('hex')
    .slice(0, 6);
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
  if (usedNames.has(filename.toLocaleLowerCase('en-US'))) {
    filename = `${baseName}-${duplicateSuffix(context)}.${extension}`;
  }
  usedNames.add(filename.toLocaleLowerCase('en-US'));
  return filename;
}
