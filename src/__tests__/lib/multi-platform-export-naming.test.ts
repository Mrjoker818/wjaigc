import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  renderExportFilename,
  sanitizeExportBaseName,
} from '@/lib/multi-platform-export/naming';

const context = {
  project: '项目',
  asset: '主视觉',
  platform: 'instagram',
  usage: 'post',
  width: 1080,
  height: 1080,
  index: 1,
  outputFormat: 'png' as const,
  sourceVersionId: 'version-a',
  presetId: 'instagram-post',
  presetVersion: 1,
};

describe('multi-platform export naming', () => {
  it('preserves safe Unicode while rejecting traversal and Windows reserved names', () => {
    expect(sanitizeExportBaseName('项目-主视觉')).toBe('项目-主视觉');
    expect(sanitizeExportBaseName('../CON. ')).toBe('asset');
    expect(sanitizeExportBaseName('..\\..\\NUL')).toBe('asset');
    expect(sanitizeExportBaseName('a/b:c*?"<>|d')).toBe('a-b-c-d');
  });

  it('renders supported template variables and appends the actual format extension', () => {
    expect(renderExportFilename(
      '{project}-{asset}-{size}-{index}',
      context,
      new Set(),
    )).toBe('项目-主视觉-1080x1080-1.png');
  });

  it('uses a deterministic six-character hash suffix for duplicate names', () => {
    const usedNames = new Set<string>();
    expect(renderExportFilename('{asset}', context, usedNames)).toBe('主视觉.png');

    const suffix = createHash('sha256')
      .update('version-a:instagram-post:1')
      .digest('hex')
      .slice(0, 6);
    expect(renderExportFilename('{asset}', context, usedNames)).toBe(`主视觉-${suffix}.png`);
  });

  it('extends a colliding six-character digest until every filename is unique', () => {
    const usedNames = new Set<string>();
    const firstCollision = { ...context, sourceVersionId: 'version-112' };
    const secondCollision = { ...context, sourceVersionId: 'version-4041' };

    expect(renderExportFilename('{asset}', firstCollision, usedNames)).toBe('主视觉.png');
    expect(renderExportFilename('{asset}', firstCollision, usedNames)).toBe('主视觉-0c461b.png');
    expect(renderExportFilename('{asset}', secondCollision, usedNames)).toBe('主视觉-0c461b39.png');
    expect(new Set(usedNames).size).toBe(3);
  });

  it('truncates by Unicode code point without splitting a surrogate pair', () => {
    const sanitized = sanitizeExportBaseName(`${'a'.repeat(119)}😀tail`);

    expect(Array.from(sanitized)).toHaveLength(120);
    expect(sanitized.endsWith('😀')).toBe(true);
    expect(sanitized).not.toContain('\uFFFD');
  });

  it('never allows a template to create directories', () => {
    const filename = renderExportFilename('../../{asset}', context, new Set());
    expect(filename).not.toContain('..');
    expect(filename).not.toContain('/');
    expect(filename).not.toContain('\\');
  });
});
