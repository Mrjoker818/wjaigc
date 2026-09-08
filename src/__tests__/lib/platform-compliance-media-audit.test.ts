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
      hasAlpha: false, isAnimated: false,
      backgroundSampleCount: 1020, whiteBackgroundSampleCount: 1020,
      whiteBackgroundRatio: 1,
    });
    const checks = evaluateTechnicalRules(facts, amazonMainRules());
    expect(checks.find(check => check.ruleId === 'amazon-supported-format')).toMatchObject({
      status: 'passed', evidence: expect.arrayContaining(['mimeType=image/png']),
    });
    expect(checks.find(check => check.ruleId === 'amazon-image-dimensions')).toMatchObject({
      status: 'passed', evidence: expect.arrayContaining(['width=1600', 'height=1600']),
    });
    expect(checks.find(check => check.ruleId === 'amazon-main-white-background')).toMatchObject({
      status: 'passed',
      evidence: expect.arrayContaining(['backgroundSamples=1020', 'whiteBackgroundRatio=1']),
    });
  });

  it('blocks an Amazon main image with an alpha channel', async () => {
    const facts = await auditComplianceMedia({
      imageInput: fixture('amazon-main-alpha.png'), signal: new AbortController().signal,
    });
    const background = evaluateTechnicalRules(facts, amazonMainRules())
      .find(check => check.ruleId === 'amazon-main-white-background');

    expect(facts.hasAlpha).toBe(true);
    expect(background).toMatchObject({
      status: 'blocked', evidence: expect.arrayContaining(['hasAlpha=true']),
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
        'backgroundSamples=1020',
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
