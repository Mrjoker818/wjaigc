import { describe, expect, it } from 'vitest';
import {
  VECTOR_ASPECT_RATIOS,
  VECTOR_KEYWORD_TEMPLATES,
  applyVectorEditOperation,
  buildVectorPrompt,
  getVectorModelCapabilities,
  isRecraftVectorModel,
  normalizeVectorSelection,
  sanitizeEditableSvg,
} from '@/lib/vector-design';

describe('vector design prompt templates', () => {
  it('builds a production vector prompt from reusable keyword templates', () => {
    const prompt = buildVectorPrompt({
      prompt: '一瓶白酒、酒杯与祥云组合',
      templateIds: ['line-art', 'imperial-gold', 'no-text'],
    });

    expect(prompt).toContain('一瓶白酒、酒杯与祥云组合');
    expect(prompt).toContain('clean vector line art');
    expect(prompt).toContain('imperial gold');
    expect(prompt).toContain('no text');
  });

  it('orders category, construction, style and output constraints after the subject', () => {
    const prompt = buildVectorPrompt({
      prompt: 'A tea brand symbol',
      selection: {
        quickIds: ['print-ready'],
        categoryId: 'logo',
        designId: 'geometric',
        styleId: 'bauhaus',
      },
    });

    expect(prompt.indexOf('professional vector logo')).toBeLessThan(
      prompt.indexOf('geometric construction'),
    );
    expect(prompt.indexOf('geometric construction')).toBeLessThan(
      prompt.indexOf('Bauhaus-inspired'),
    );
    expect(prompt.indexOf('Bauhaus-inspired')).toBeLessThan(
      prompt.indexOf('print-ready'),
    );
  });

  it('keeps template ids unique and grouped for direct panel use', () => {
    const ids = VECTOR_KEYWORD_TEMPLATES.map(template => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(VECTOR_KEYWORD_TEMPLATES.map(template => template.group))).toEqual(
      new Set(['quick', 'category', 'design', 'style']),
    );
  });

  it('covers the complete Recraft vector ratio set and a production preset taxonomy', () => {
    expect(VECTOR_ASPECT_RATIOS.map(option => option.value)).toEqual([
      '1:1',
      '2:1',
      '1:2',
      '3:2',
      '2:3',
      '4:3',
      '3:4',
      '5:4',
      '4:5',
      '6:10',
      '14:10',
      '10:14',
      '16:9',
      '9:16',
    ]);
    expect(VECTOR_KEYWORD_TEMPLATES.filter(template => template.group === 'quick').length).toBeGreaterThanOrEqual(16);
    expect(VECTOR_KEYWORD_TEMPLATES.filter(template => template.group === 'category').length).toBeGreaterThanOrEqual(14);
    expect(VECTOR_KEYWORD_TEMPLATES.filter(template => template.group === 'design').length).toBeGreaterThanOrEqual(14);
    expect(VECTOR_KEYWORD_TEMPLATES.filter(template => template.group === 'style').length).toBeGreaterThanOrEqual(18);
  });

  it('normalizes incompatible quick constraints and preserves one choice per creative group', () => {
    const selection = normalizeVectorSelection({
      quickIds: ['no-text', 'gradient-allowed', 'no-gradient', 'uniform-outline', 'no-outline'],
      categoryId: 'wordmark',
      designId: 'monoline',
      styleId: 'bauhaus',
    });

    expect(selection.quickIds).toEqual(['no-gradient', 'no-outline']);
    expect(selection.categoryId).toBe('wordmark');
    expect(selection.designId).toBe('monoline');
    expect(selection.styleId).toBe('bauhaus');

    const prompt = buildVectorPrompt({
      prompt: '为一家咖啡店设计字标',
      selection,
    });
    expect(prompt).toContain('professional vector wordmark');
    expect(prompt).toContain('Bauhaus');
    expect(prompt).not.toContain('no text');
  });
});

describe('vector model and SVG editing contract', () => {
  it('accepts only Recraft vector model ids', () => {
    expect(isRecraftVectorModel('recraftv4_1_vector')).toBe(true);
    expect(isRecraftVectorModel('recraftv4_pro_vector')).toBe(true);
    expect(isRecraftVectorModel('recraftv4_1_utility_pro_vector')).toBe(true);
    expect(isRecraftVectorModel('recraftv4')).toBe(false);
    expect(isRecraftVectorModel('recraftv2_pro_vector')).toBe(false);
    expect(isRecraftVectorModel('recraftv3_utility_vector')).toBe(false);
    expect(isRecraftVectorModel('recraftv4_utility_vector')).toBe(false);
    expect(isRecraftVectorModel('stable-diffusion-vector')).toBe(false);
  });

  it('describes Recraft generation capabilities without exposing unsupported controls', () => {
    const v41Pro = getVectorModelCapabilities('recraftv4_1_pro_vector');
    expect(v41Pro).toMatchObject({
      family: 'v4.1',
      tier: 'pro',
      maxCount: 6,
      megapixels: 4,
      supportsStyles: false,
      supportsImageToImage: true,
      supportsExplore: true,
      supportsNegativePrompt: false,
      supportsNoTextControl: false,
      promptLimit: 10000,
    });

    const v3 = getVectorModelCapabilities('recraftv3_vector');
    expect(v3).toMatchObject({
      family: 'v3',
      tier: 'standard',
      maxCount: 6,
      megapixels: 1,
      supportsStyles: true,
      supportsImageToImage: true,
      supportsExplore: false,
      supportsNegativePrompt: true,
      supportsNoTextControl: true,
      promptLimit: 1000,
    });

    expect(getVectorModelCapabilities('recraftv2_vector')).toMatchObject({
      supportsNegativePrompt: true,
      supportsCustomStyles: false,
      supportsImageToImage: false,
    });
  });

  it('removes executable SVG content while assigning stable editable ids', () => {
    const sanitized = sanitizeEditableSvg(
      '<svg viewBox="0 0 100 100"><script>alert(1)</script><path onclick="bad()" d="M0 0L10 10"/></svg>',
    );

    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).toMatch(/data-vector-element-id="vector-element-\d+"/);
  });

  it('rejects persistent SVG XSS while preserving local paint references', () => {
    expect(() => sanitizeEditableSvg(
      '<svg viewBox="0 0 10 10" onload=alert(1)><path d="M0 0L1 1"/></svg>',
    )).toThrow(/有效 SVG/);

    const sanitized = sanitizeEditableSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 100 100">
        <style>@import url(https://attacker.example/x.css)</style>
        <script>alert(1)</script>
        <animate attributeName="x" values="0;1" />
        <defs>
          <linearGradient id="safe-gradient"><stop offset="0" stop-color="#fff"/></linearGradient>
        </defs>
        <path id="safe" style="fill:url(javascript:alert(1))" fill="url(#safe-gradient)" d="M0 0L10 10"/>
        <use href="https://attacker.example/remote.svg#shape"/>
        <feImage href="data:image/svg+xml;base64,PHN2Zy8+"/>
      </svg>
    `);

    expect(sanitized).not.toMatch(/onload|<style|<script|<animate|javascript:|attacker\.example|data:image|feImage/i);
    expect(sanitized).toContain('fill="url(#safe-gradient)"');
    expect(sanitized).toContain('id="safe-gradient"');
  });

  it('rejects SVGs that exceed structural complexity limits', () => {
    const paths = Array.from({ length: 5_001 }, () => '<path d="M0 0L1 1"/>').join('');
    expect(() => sanitizeEditableSvg(`<svg viewBox="0 0 10 10">${paths}</svg>`))
      .toThrow(/complex|复杂/i);
  });

  it('applies selected-element recolor and canvas expansion without raster wrappers', () => {
    const source = sanitizeEditableSvg(
      '<svg viewBox="0 0 100 100"><path fill="#111111" d="M0 0L10 10"/></svg>',
    );
    const recolored = applyVectorEditOperation(source, {
      type: 'recolor',
      elementId: 'vector-element-1',
      color: '#d4af37',
    });
    const expanded = applyVectorEditOperation(recolored, {
      type: 'expand',
      percent: 20,
    });

    expect(recolored).toContain('fill="#d4af37"');
    expect(expanded).toContain('viewBox="-10 -10 120 120"');
    expect(expanded).not.toContain('<image');
  });

  it('fits a generated replacement into the selected element bounds', () => {
    const source = sanitizeEditableSvg(
      '<svg viewBox="0 0 100 100"><rect x="20" y="30" width="40" height="20"/></svg>',
    );
    const replacement = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>';
    const result = applyVectorEditOperation(source, {
      type: 'replace',
      elementId: 'vector-element-1',
      replacementSvg: replacement,
      targetBox: { x: 20, y: 30, width: 40, height: 20 },
    });

    expect(result).toContain('translate(20 30) scale(4 2)');
    expect(result).toContain('<circle');
  });
});
