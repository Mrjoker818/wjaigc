import { readFileSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { auditComplianceMedia } from '@/lib/platform-compliance/media-audit';
import { evaluateTechnicalRules } from '@/lib/platform-compliance/technical-evaluator';
import { resolveComplianceRuleSet } from '@/lib/platform-compliance/rules';

const FIXTURE_ROOT = resolve(process.cwd(), 'src/__tests__/fixtures/platform-compliance');

function fixtureBuffer(name: string): Buffer {
  return readFileSync(resolve(FIXTURE_ROOT, name));
}

function fixture(name: string, mimeType = 'image/png'): string {
  return `data:${mimeType};base64,${fixtureBuffer(name).toString('base64')}`;
}

function dataUrl(buffer: Buffer, mimeType = 'image/png'): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function amazonMainRules() {
  return resolveComplianceRuleSet({
    platform: 'Amazon', region: 'US', assetType: 'main', productCategory: '',
  }).rules;
}

describe('platform compliance deterministic media audit', () => {
  it('reports exact dimensions, signature MIME, bytes, and multi-point white edge evidence', async () => {
    const source = fixtureBuffer('amazon-main-pass.png');
    const facts = await auditComplianceMedia({
      imageInput: fixture('amazon-main-pass.png'), signal: new AbortController().signal,
    });

    expect(facts).toMatchObject({
      mimeType: 'image/png', byteLength: source.byteLength,
      width: 1600, height: 1600, pixelCount: 2_560_000,
      hasAlpha: false, hasTransparentPixels: false, isAnimated: false,
      backgroundSampleRegion: 'corner-depth-zones',
      backgroundSampleRegionCount: 4,
      backgroundSampleMaxDepthRatio: 0.24,
      whiteOuterBackgroundRatio: 1,
      whiteDeepBackgroundRatio: 1,
      whiteBackgroundRatio: 1,
    });
    expect(facts.backgroundSampleCount).toBeLessThanOrEqual(256);
    expect(facts.whiteBackgroundSampleCount).toBe(facts.backgroundSampleCount);
    const checks = evaluateTechnicalRules(facts, amazonMainRules());
    expect(checks.find(check => check.ruleId === 'amazon-supported-format')).toMatchObject({
      status: 'passed', evidence: expect.arrayContaining(['mimeType=image/png']),
    });
    expect(checks.find(check => check.ruleId === 'amazon-image-dimensions')).toMatchObject({
      status: 'passed', evidence: expect.arrayContaining(['width=1600', 'height=1600']),
    });
    expect(checks.find(check => check.ruleId === 'amazon-main-white-background')).toMatchObject({
      status: 'passed',
      evidence: expect.arrayContaining([
        'hasTransparentPixels=false',
        'backgroundSampleRegion=corner-depth-zones',
        'backgroundSampleRegions=4',
        'backgroundSampleMaxDepthRatio=0.24',
        'whiteOuterBackgroundRatio=1',
        'whiteDeepBackgroundRatio=1',
        'backgroundEvidenceConflict=false',
        `backgroundSamples=${facts.backgroundSampleCount}`,
        'whiteBackgroundRatio=1',
      ]),
    });
  });

  it('blocks an Amazon main image with transparent pixels', async () => {
    const facts = await auditComplianceMedia({
      imageInput: fixture('amazon-main-alpha.png'), signal: new AbortController().signal,
    });
    const background = evaluateTechnicalRules(facts, amazonMainRules())
      .find(check => check.ruleId === 'amazon-main-white-background');

    expect(facts.hasAlpha).toBe(true);
    expect(facts.hasTransparentPixels).toBe(true);
    expect(background).toMatchObject({
      status: 'blocked', evidence: expect.arrayContaining(['hasTransparentPixels=true']),
    });
  });

  it('accepts a fully opaque RGBA PNG and reports channel and pixel alpha separately', async () => {
    const rgba = await sharp({
      create: {
        width: 1600, height: 1600, channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    }).png().toBuffer();
    const facts = await auditComplianceMedia({
      imageInput: dataUrl(rgba), signal: new AbortController().signal,
    });
    const background = evaluateTechnicalRules(facts, amazonMainRules())
      .find(check => check.ruleId === 'amazon-main-white-background');

    expect(facts).toMatchObject({ hasAlpha: true, hasTransparentPixels: false });
    expect(background).toMatchObject({
      status: 'passed',
      evidence: expect.arrayContaining(['hasAlpha=true', 'hasTransparentPixels=false']),
    });
  });

  it('audits a real TIFF through the shared safe image loader', async () => {
    const tiff = await sharp({
      create: { width: 1600, height: 1600, channels: 3, background: '#ffffff' },
    }).tiff().toBuffer();
    const facts = await auditComplianceMedia({
      imageInput: dataUrl(tiff, 'image/tiff'), signal: new AbortController().signal,
    });
    const format = evaluateTechnicalRules(facts, amazonMainRules())
      .find(check => check.ruleId === 'amazon-supported-format');

    expect(facts.mimeType).toBe('image/tiff');
    expect(format).toMatchObject({ status: 'passed', measuredValue: 'TIFF' });
  });

  it('returns unknown for an 80px white frame with conflicting deep dark evidence', async () => {
    const framed = await sharp({
      create: { width: 600, height: 600, channels: 3, background: '#ffffff' },
    }).composite([{
      input: await sharp({
        create: { width: 440, height: 440, channels: 3, background: '#111111' },
      }).png().toBuffer(),
      left: 80,
      top: 80,
    }]).png().toBuffer();
    const pixels = await sharp(framed).raw().toBuffer({ resolveWithObject: true });
    const rgbAt = (x: number, y: number) => {
      const offset = (y * pixels.info.width + x) * pixels.info.channels;
      return [...pixels.data.subarray(offset, offset + 3)];
    };
    expect(rgbAt(0, 0)).toEqual([255, 255, 255]);
    expect(rgbAt(90, 90)).toEqual([17, 17, 17]);

    const facts = await auditComplianceMedia({
      imageInput: dataUrl(framed), signal: new AbortController().signal,
    });
    const background = evaluateTechnicalRules(facts, amazonMainRules())
      .find(check => check.ruleId === 'amazon-main-white-background');

    expect(facts).toMatchObject({
      backgroundSampleRegion: 'corner-depth-zones',
      backgroundSampleRegionCount: 4,
      backgroundSampleMaxDepthRatio: 0.24,
    });
    expect(facts.backgroundSampleCount).toBeLessThanOrEqual(256);
    expect(facts.whiteOuterBackgroundRatio).toBe(1);
    expect(facts.whiteDeepBackgroundRatio).toBeLessThan(0.99);
    expect(facts.whiteBackgroundRatio).toBeLessThan(0.99);
    expect(background).toMatchObject({
      status: 'unknown',
      confidence: null,
      measuredValue: `outer=${facts.whiteOuterBackgroundRatio};deep=${facts.whiteDeepBackgroundRatio};transparent=false`,
      remediation: expect.stringMatching(/vision|review/i),
      evidence: expect.arrayContaining([
        'backgroundSampleRegion=corner-depth-zones',
        'backgroundSampleRegions=4',
        'backgroundSampleMaxDepthRatio=0.24',
        `backgroundSamples=${facts.backgroundSampleCount}`,
        `whiteBackgroundSamples=${facts.whiteBackgroundSampleCount}`,
        'whiteOuterBackgroundRatio=1',
        `whiteDeepBackgroundRatio=${facts.whiteDeepBackgroundRatio}`,
        'backgroundEvidenceConflict=true',
      ]),
    });
  });

  it('does not block an 85-percent centered product when background evidence conflicts', async () => {
    const centeredProduct = await sharp({
      create: { width: 600, height: 600, channels: 3, background: '#ffffff' },
    }).composite([{
      input: await sharp({
        create: { width: 510, height: 510, channels: 3, background: '#111111' },
      }).png().toBuffer(),
      left: 45,
      top: 45,
    }]).png().toBuffer();
    const pixels = await sharp(centeredProduct).raw().toBuffer({ resolveWithObject: true });
    const centerOffset = (300 * pixels.info.width + 300) * pixels.info.channels;
    expect([...pixels.data.subarray(centerOffset, centerOffset + 3)]).toEqual([17, 17, 17]);

    const facts = await auditComplianceMedia({
      imageInput: dataUrl(centeredProduct), signal: new AbortController().signal,
    });
    const background = evaluateTechnicalRules(facts, amazonMainRules())
      .find(check => check.ruleId === 'amazon-main-white-background');

    expect(facts.backgroundSampleRegion).toBe('corner-depth-zones');
    expect(facts.whiteOuterBackgroundRatio).toBe(1);
    expect(facts.whiteDeepBackgroundRatio).toBeLessThan(0.99);
    expect(background).toMatchObject({ status: 'unknown', confidence: null });
  });

  it('deterministically blocks an opaque image whose outer edge is non-white', async () => {
    const dark = await sharp({
      create: { width: 1600, height: 1600, channels: 3, background: '#111111' },
    }).png().toBuffer();
    const facts = await auditComplianceMedia({
      imageInput: dataUrl(dark), signal: new AbortController().signal,
    });
    const background = evaluateTechnicalRules(facts, amazonMainRules())
      .find(check => check.ruleId === 'amazon-main-white-background');

    expect(facts).toMatchObject({
      hasTransparentPixels: false,
      whiteOuterBackgroundRatio: 0,
      whiteDeepBackgroundRatio: 0,
    });
    expect(background).toMatchObject({
      status: 'blocked', confidence: 1,
      evidence: expect.arrayContaining([
        'whiteOuterBackgroundRatio=0',
        'backgroundEvidenceConflict=false',
      ]),
    });
  });

  it('blocks off-white edges using many samples instead of one corner', async () => {
    const facts = await auditComplianceMedia({
      imageInput: fixture('amazon-main-offwhite.png'), signal: new AbortController().signal,
    });
    const background = evaluateTechnicalRules(facts, amazonMainRules())
      .find(check => check.ruleId === 'amazon-main-white-background');

    expect(facts.backgroundSampleCount).toBeGreaterThan(4);
    expect(facts.whiteBackgroundRatio).toBeGreaterThan(0);
    expect(facts.whiteBackgroundRatio).toBeLessThan(0.1);
    expect(background).toMatchObject({
      status: 'blocked',
      evidence: expect.arrayContaining([
        `backgroundSamples=${facts.backgroundSampleCount}`,
        `whiteBackgroundRatio=${facts.whiteBackgroundRatio}`,
      ]),
    });
  });

  it('rejects a declared MIME that disagrees with the file signature', async () => {
    await expect(auditComplianceMedia({
      imageInput: fixture('amazon-main-pass.png', 'image/jpeg'),
      signal: new AbortController().signal,
    })).rejects.toThrow(/MIME/u);
  });

  it('rejects inputs over 25 MiB before decoding', async () => {
    const uploads = resolve(process.cwd(), 'public/uploads');
    const name = `platform-compliance-oversized-${process.pid}-${Date.now()}.png`;
    await mkdir(uploads, { recursive: true });
    await writeFile(resolve(uploads, name), Buffer.alloc(25 * 1024 * 1024 + 1));
    try {
      await expect(auditComplianceMedia({
        imageInput: `/uploads/${name}`,
        signal: new AbortController().signal,
      })).rejects.toThrow(/size limit/iu);
    } finally {
      await unlink(resolve(uploads, name));
    }
  });

  it('rejects images over 40 million pixels', async () => {
    const bomb = await sharp({
      create: { width: 8000, height: 5001, channels: 3, background: '#ffffff' },
    }).png().toBuffer();

    await expect(auditComplianceMedia({
      imageInput: `data:image/png;base64,${bomb.toString('base64')}`,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'UNSAFE_IMAGE_INPUT' });
  }, 15_000);

  it('rejects corrupt images and observes an already-aborted signal', async () => {
    const corrupt = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('not-a-png'),
    ]);
    await expect(auditComplianceMedia({
      imageInput: `data:image/png;base64,${corrupt.toString('base64')}`,
      signal: new AbortController().signal,
    })).rejects.toThrow(/decode/iu);

    const controller = new AbortController();
    controller.abort(new Error('AUDIT_ABORTED'));
    await expect(auditComplianceMedia({
      imageInput: fixture('amazon-main-pass.png'), signal: controller.signal,
    })).rejects.toThrow('AUDIT_ABORTED');
  });
});
