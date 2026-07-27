import { describe, expect, it } from 'vitest';
import {
  VECTOR_KEYWORD_TEMPLATES,
  applyVectorEditOperation,
  buildVectorPrompt,
  isRecraftVectorModel,
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

  it('keeps template ids unique and grouped for direct panel use', () => {
    const ids = VECTOR_KEYWORD_TEMPLATES.map(template => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(VECTOR_KEYWORD_TEMPLATES.map(template => template.group))).toEqual(
      new Set(['quick', 'category', 'design', 'style']),
    );
  });
});

describe('vector model and SVG editing contract', () => {
  it('accepts only Recraft vector model ids', () => {
    expect(isRecraftVectorModel('recraftv4_1_vector')).toBe(true);
    expect(isRecraftVectorModel('recraftv4_pro_vector')).toBe(true);
    expect(isRecraftVectorModel('recraftv4')).toBe(false);
    expect(isRecraftVectorModel('stable-diffusion-vector')).toBe(false);
  });

  it('removes executable SVG content while assigning stable editable ids', () => {
    const sanitized = sanitizeEditableSvg(
      '<svg viewBox="0 0 100 100"><script>alert(1)</script><path onclick="bad()" d="M0 0L10 10"/></svg>',
    );

    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).toMatch(/data-vector-element-id="vector-element-\d+"/);
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
