/**
 * AI PSD 生成器 — JSON Schema 校验
 *
 * 校验 LLM 输出的 LayerPlan JSON 是否符合要求
 * 校验失败时返回错误信息，支持重试
 */

import type { LayerPlan, LayerPlanLayer, LayerPlanTextLayer } from './types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  fixed?: LayerPlan; // 自动修复后的版本
}

export function validateLayerPlan(plan: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!plan || typeof plan !== 'object') {
    return { valid: false, errors: ['LayerPlan is not an object'], warnings };
  }

  const p = plan as Record<string, unknown>;

  // ─── Canvas 校验 ──────────────────────────────────────────────────

  if (!p.canvas || typeof p.canvas !== 'object') {
    errors.push('Missing or invalid "canvas" object');
  } else {
    const canvas = p.canvas as Record<string, unknown>;
    if (typeof canvas.width !== 'number' || canvas.width <= 0) {
      errors.push('canvas.width must be a positive number');
    }
    if (typeof canvas.height !== 'number' || canvas.height <= 0) {
      errors.push('canvas.height must be a positive number');
    }
    if (typeof canvas.ratio !== 'string' || !canvas.ratio.includes(':')) {
      warnings.push('canvas.ratio should be a string like "16:9"');
    }
  }

  // ─── Layers 校验 ──────────────────────────────────────────────────

  if (!Array.isArray(p.layers) || p.layers.length === 0) {
    errors.push('Missing or empty "layers" array');
  } else {
    const layers = p.layers as LayerPlanLayer[];
    const layerIds = new Set<string>();

    // 检查是否有背景层
    const hasBackground = layers.some(l => l.type === 'background');
    if (!hasBackground) {
      warnings.push('No background layer found — first layer should be background');
    }

    // 背景层不应是透明的
    const bgLayer = layers.find(l => l.type === 'background');
    if (bgLayer && bgLayer.transparent) {
      warnings.push('Background layer should have transparent: false — auto-fixing');
      bgLayer.transparent = false;
    }

    // 非背景层应该是透明的
    for (const layer of layers) {
      if (layer.type !== 'background' && !layer.transparent) {
        warnings.push(`Layer "${layer.name}" (type: ${layer.type}) should have transparent: true — auto-fixing`);
        layer.transparent = true;
      }
    }

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];

      if (!layer.id) {
        errors.push(`Layer ${i}: missing "id"`);
      } else if (layerIds.has(layer.id)) {
        errors.push(`Layer ${i}: duplicate id "${layer.id}"`);
      } else {
        layerIds.add(layer.id);
      }

      if (!layer.name) {
        warnings.push(`Layer ${i}: missing "name" — auto-assigning`);
        layer.name = `Layer ${i + 1}`;
      }

      if (!layer.type) {
        errors.push(`Layer ${i} ("${layer.name}"): missing "type"`);
      }

      if (!layer.prompt && layer.type !== 'product' && layer.type !== 'logo') {
        errors.push(`Layer ${i} ("${layer.name}"): missing "prompt"`);
      }

      if (typeof layer.transparent !== 'boolean') {
        warnings.push(`Layer ${i} ("${layer.name}"): "transparent" should be boolean — auto-fixing`);
        layer.transparent = layer.type !== 'background';
      }

      if (typeof layer.editable !== 'boolean') {
        layer.editable = false;
      }

      // 补全默认值
      if (layer.opacity === undefined) layer.opacity = 1;
      if (layer.visible === undefined) layer.visible = true;
      if (!layer.group) layer.group = layer.type || 'decoration';
    }
  }

  // ─── TextLayers 校验 ──────────────────────────────────────────────

  if (!Array.isArray(p.textLayers)) {
    warnings.push('Missing "textLayers" array — creating empty array');
    (p as Record<string, unknown>).textLayers = [];
  } else {
    const textLayers = p.textLayers as LayerPlanTextLayer[];
    const textIds = new Set<string>();

    for (let i = 0; i < textLayers.length; i++) {
      const tl = textLayers[i];

      if (!tl.id) {
        errors.push(`TextLayer ${i}: missing "id"`);
      } else if (textIds.has(tl.id)) {
        errors.push(`TextLayer ${i}: duplicate id "${tl.id}"`);
      } else {
        textIds.add(tl.id);
      }

      if (!tl.text) {
        warnings.push(`TextLayer ${i}: missing "text" — using placeholder`);
        tl.text = 'Sample Text';
      }

      if (typeof tl.fontSize !== 'number' || tl.fontSize <= 0) {
        warnings.push(`TextLayer ${i}: invalid fontSize — defaulting to 24`);
        tl.fontSize = 24;
      }

      if (!tl.color) {
        tl.color = '#FFFFFF';
      }

      if (typeof tl.x !== 'number') tl.x = 0;
      if (typeof tl.y !== 'number') tl.y = 0;
      if (typeof tl.width !== 'number') tl.width = 200;
      if (typeof tl.height !== 'number') tl.height = 50;
      if (!tl.align) tl.align = 'left';
      if (!tl.fontFamily) tl.fontFamily = 'Noto Sans SC';
      if (!tl.fontWeight) tl.fontWeight = 'normal';
      if (!tl.lineHeight) tl.lineHeight = 1.2;
      if (tl.letterSpacing === undefined) tl.letterSpacing = 0;
      tl.editable = true;
    }
  }

  // ─── 结果 ──────────────────────────────────────────────────────────

  const validPlan = errors.length === 0 ? (p as unknown as LayerPlan) : undefined;

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    fixed: validPlan,
  };
}
