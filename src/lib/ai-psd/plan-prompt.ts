/**
 * AI PSD 生成器 — LLM 图层规划 System Prompt
 *
 * 核心职责：让 LLM 理解用户需求后输出结构化 LayerPlan JSON
 * 包含：canvas 配置、分层策略、每层 prompt、文字层定义
 */

import type { GenerationMode, SceneType, StyleTag, ColorTone, LayerComplexity, TextRenderMode, LayerPlan } from './types';

// ─── 风格标签描述映射 ────────────────────────────────────────────────

const STYLE_DESCRIPTIONS: Record<StyleTag, string> = {
  commercial: 'Commercial advertising style, bold typography, product-focused, clean layout, professional feel',
  minimal_luxury: 'Minimalist luxury, lots of whitespace, refined serif fonts, subtle textures, premium feel',
  oriental_luxury: 'Oriental luxury, gold accents on dark backgrounds, Chinese calligraphy elements, traditional patterns',
  trendy_illustration: 'Trendy illustration style, vibrant colors, hand-drawn elements, Gen-Z appeal, playful composition',
  tech: 'Tech/futuristic, gradients, glow effects, dark backgrounds, neon accents, digital grids',
  healing: 'Healing/soothing, soft pastels, organic shapes, nature elements, warm lighting',
  black_gold: 'Black and gold palette, dramatic contrast, luxury branding, metallic textures',
  red_gold: 'Red and gold palette, festive/traditional Chinese feel, rich and opulent',
  youthful: 'Young and energetic, bold colors, dynamic layouts, graffiti elements, sporty feel',
  cinematic: 'Cinematic quality, dramatic lighting, film grain, deep shadows, movie poster composition',
};

const COLOR_TONE_DESCRIPTIONS: Record<ColorTone, string> = {
  auto: 'Automatically match colors based on style and subject',
  red_gold: 'Red and gold as primary palette, warm and luxurious',
  black_gold: 'Black background with gold accents, premium and dramatic',
  blue_white: 'Blue and white palette, clean and trustworthy',
  warm_orange: 'Warm orange/amber tones, inviting and energetic',
  natural_green: 'Natural greens and earth tones, organic and fresh',
  premium_gray: 'Premium gray palette, sophisticated and neutral',
  custom: 'Custom color palette as specified by user',
};

const COMPLEXITY_GUIDE: Record<LayerComplexity, { minLayers: number; maxLayers: number; detail: string }> = {
  simple: { minLayers: 5, maxLayers: 7, detail: 'Fewer layers, each layer covers a broader area. Minimal separation.' },
  standard: { minLayers: 8, maxLayers: 12, detail: 'Standard separation: background, light, subject, decoration, text. Each area gets its own layer.' },
  rich: { minLayers: 12, maxLayers: 18, detail: 'Rich separation: multiple background sub-layers, separate light effects, multiple decoration layers, texture overlays, atmospheric effects.' },
};

const SCENE_DESCRIPTIONS: Record<SceneType, string> = {
  brand_kv: 'Brand Key Visual — hero image for brand campaigns, large product + brand identity',
  poster: 'Commercial poster — promotional material, product + headline + CTA',
  ecommerce: 'E-commerce main product image — product-focused, clean background, info tags',
  xiaohongshu_cover: 'Xiaohongshu (Little Red Book) cover — trendy, eye-catching, vertical format',
  wechat_cover: 'WeChat Official Account cover — wide format, editorial feel',
  ui_visual: 'UI visual design — app/web mockup feel, modern interface elements',
  pop_up: 'Pop-up event material — bold, limited time feel, striking visuals',
  custom: 'Custom — follow user description exactly',
};

// ─── Layer Plan JSON Schema（LLM输出约束）────────────────────────────

export const LAYER_PLAN_SCHEMA = {
  type: 'object',
  required: ['canvas', 'layers', 'textLayers'],
  properties: {
    canvas: {
      type: 'object',
      required: ['width', 'height', 'ratio'],
      properties: {
        width: { type: 'number', description: 'Canvas width in pixels' },
        height: { type: 'number', description: 'Canvas height in pixels' },
        ratio: { type: 'string', description: 'Aspect ratio like "16:9"' },
        backgroundColor: { type: 'string', description: 'Background hex color like "#1a1a1a"' },
        dpi: { type: 'number', description: 'DPI, default 72' },
      },
    },
    style: { type: 'string', description: 'Overall visual style description' },
    composition: { type: 'string', description: 'Composition strategy description' },
    layers: {
      type: 'array',
      description: 'Image layers from bottom to top (first = bottommost)',
      items: {
        type: 'object',
        required: ['id', 'name', 'group', 'type', 'transparent', 'editable', 'prompt'],
        properties: {
          id: { type: 'string', description: 'Unique layer ID like "layer_bg"' },
          name: { type: 'string', description: 'Human-readable layer name in Chinese like "背景层"' },
          group: { type: 'string', description: 'Group: background/light/subject/decoration/texture/atmosphere/product/logo/shadow' },
          type: { type: 'string', description: 'Layer type: background/light/subject/decoration/texture/atmosphere/product/logo/text_preview/shadow' },
          transparent: { type: 'boolean', description: 'Whether this layer needs transparent background (true for all non-background layers)' },
          editable: { type: 'boolean', description: 'Whether user can edit this layer in PSD (false for generated images)' },
          prompt: { type: 'string', description: 'Detailed image generation prompt for this layer in English' },
          x: { type: 'number', description: 'X position offset' },
          y: { type: 'number', description: 'Y position offset' },
          width: { type: 'number', description: 'Layer width in pixels' },
          height: { type: 'number', description: 'Layer height in pixels' },
          opacity: { type: 'number', description: 'Opacity 0-1, default 1' },
          visible: { type: 'boolean', description: 'Default visibility, default true' },
        },
      },
    },
    textLayers: {
      type: 'array',
      description: 'Editable text layers',
      items: {
        type: 'object',
        required: ['id', 'name', 'text', 'fontSize', 'color', 'x', 'y', 'width', 'height', 'editable'],
        properties: {
          id: { type: 'string', description: 'Unique text layer ID like "text_title"' },
          name: { type: 'string', description: 'Chinese name like "标题文字"' },
          text: { type: 'string', description: 'Default text content' },
          fontFamily: { type: 'string', description: 'Font family, e.g. "Noto Sans SC"' },
          fontSize: { type: 'number', description: 'Font size in pixels' },
          fontWeight: { type: 'string', description: 'Font weight: normal/bold/900 etc' },
          color: { type: 'string', description: 'Text color hex like "#FFFFFF"' },
          x: { type: 'number', description: 'X position' },
          y: { type: 'number', description: 'Y position' },
          width: { type: 'number', description: 'Text area width' },
          height: { type: 'number', description: 'Text area height' },
          align: { type: 'string', description: 'Text alignment: left/center/right' },
          lineHeight: { type: 'number', description: 'Line height multiplier' },
          letterSpacing: { type: 'number', description: 'Letter spacing in pixels' },
          editable: { type: 'boolean', description: 'Always true for text layers' },
        },
      },
    },
  },
};

// ─── 构建 System Prompt ──────────────────────────────────────────────

export function buildPlanSystemPrompt(params: {
  generationMode: GenerationMode;
  sceneType: SceneType;
  styles: StyleTag[];
  colorTone: ColorTone;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  layerComplexity: LayerComplexity;
  textRenderMode: TextRenderMode;
  ratio: string;
  canvasWidth: number;
  canvasHeight: number;
  title?: string;
  subtitle?: string;
  bodyText?: string;
  hasReferenceImages: boolean;
  hasProductImages: boolean;
  hasLogoImages: boolean;
}): string {
  const {
    generationMode, sceneType, styles, colorTone,
    primaryColor, secondaryColor, accentColor,
    layerComplexity, textRenderMode, ratio,
    canvasWidth, canvasHeight,
    title, subtitle, bodyText,
    hasReferenceImages, hasProductImages, hasLogoImages,
  } = params;

  const styleDescs = styles.map(s => STYLE_DESCRIPTIONS[s]).join('. ');
  const colorDesc = COLOR_TONE_DESCRIPTIONS[colorTone];
  const complexity = COMPLEXITY_GUIDE[layerComplexity];
  const sceneDesc = SCENE_DESCRIPTIONS[sceneType];

  // 图层分离策略指导
  const layerStrategy = `
LAYER SEPARATION STRATEGY (CRITICAL):
- Background layer: FULL canvas, solid or gradient fill, NON-transparent
- Light/effect layers: FULL canvas, TRANSPARENT background, soft light beams, bokeh, lens flares
- Subject layers: FULL canvas, TRANSPARENT background, the main subject isolated (product/person/mascot)
- Product/Logo layers: FULL canvas, TRANSPARENT background, user-provided product/logo images — these will NOT be regenerated, only placed
- Decoration layers: FULL canvas, TRANSPARENT background, decorative elements like ribbons, badges, patterns
- Texture layers: FULL canvas, TRANSPARENT background, subtle overlay textures (grain, noise, paper)
- Atmosphere layers: FULL canvas, TRANSPARENT background, fog, smoke, particles, ambient glow
- Shadow layers: FULL canvas, TRANSPARENT background, soft shadows under subjects, always below the subject layer
- Text preview layers: FULL canvas, TRANSPARENT background, visual preview of how text should look (only if textRenderMode is "image_text" or "both")

CRITICAL RULES:
1. ALL layers (except background) must have "transparent": true
2. ALL layers are FULL canvas size (width=${canvasWidth}, height=${canvasHeight})
3. Layers are ordered BOTTOM to TOP (first element = bottommost layer)
4. Background layer is always first, with "transparent": false
5. Shadow layers come BEFORE their corresponding subject/product layers
6. Each prompt must describe what to generate for that specific layer ONLY
7. Do NOT include text rendering in image layer prompts — text is handled by textLayers
8. Product/Logo layers: set "editable": false, prompt should describe "placeholder for user product image"`;

  const textLayerGuidance = textRenderMode === 'editable_text'
    ? `TEXT LAYER MODE: "editable_text" — Create textLayers for ALL text content (title, subtitle, body, CTA, brand name). These will become editable text layers in the PSD. DO NOT create text_preview image layers.`
    : textRenderMode === 'image_text'
    ? `TEXT LAYER MODE: "image_text" — Create text_preview image layers in the "layers" array for artistically rendered text (special effects, 3D text, stylized typography). Also create corresponding textLayers as fallback editable versions.`
    : `TEXT LAYER MODE: "both" — Create text_preview image layers for artistic reference AND textLayers for editable text. Both will be included in the PSD.`;

  const assetGuidance = [
    hasProductImages ? 'PRODUCT IMAGES are provided by the user — create product layers with "editable": false and prompt like "placeholder for user product image, centered composition"' : '',
    hasLogoImages ? 'LOGO IMAGES are provided by the user — create logo layers with "editable": false and prompt like "placeholder for user logo, positioned in corner"' : '',
    hasReferenceImages ? 'REFERENCE IMAGES are provided for style/composition reference — analyze their visual style and apply to the layer design' : '',
  ].filter(Boolean).join('\n');

  const colorSpec = colorTone === 'custom'
    ? `Custom colors: primary=${primaryColor || 'not specified'}, secondary=${secondaryColor || 'not specified'}, accent=${accentColor || 'not specified'}`
    : `Color tone: ${colorDesc}`;

  const textInfo = [
    title ? `Title/Headline: "${title}"` : '',
    subtitle ? `Subtitle: "${subtitle}"` : '',
    bodyText ? `Body text: "${bodyText}"` : '',
  ].filter(Boolean).join('\n');

  return `You are an expert PSD layer planning AI. Your job is to analyze the user's design request and output a structured Layer Plan JSON that defines each layer of a Photoshop-compatible PSD file.

SCENE TYPE: ${sceneDesc}
CANVAS: ${canvasWidth}x${canvasHeight} pixels, ratio ${ratio}
VISUAL STYLE: ${styleDescs}
${colorSpec}
COMPLEXITY: ${complexity.minLayers}-${complexity.maxLayers} layers. ${complexity.detail}

${layerStrategy}

${textLayerGuidance}

${assetGuidance}

${textInfo ? `TEXT CONTENT:\n${textInfo}` : ''}

OUTPUT FORMAT:
You MUST output ONLY valid JSON matching this schema (no markdown, no code fences, no explanation):
${JSON.stringify(LAYER_PLAN_SCHEMA)}

EXAMPLE OUTPUT STRUCTURE:
{
  "canvas": { "width": ${canvasWidth}, "height": ${canvasHeight}, "ratio": "${ratio}", "backgroundColor": "#1a1a1a", "dpi": 72 },
  "style": "Commercial advertising with black-gold luxury feel",
  "composition": "Product centered, title above, decorative elements framing",
  "layers": [
    { "id": "layer_bg", "name": "背景层", "group": "background", "type": "background", "transparent": false, "editable": false, "prompt": "Dark gradient background from #1a1a1a to #0a0a0a, subtle radial light in center, luxury commercial feel", "visible": true, "opacity": 1 },
    { "id": "layer_light_1", "name": "主光源", "group": "light", "type": "light", "transparent": true, "editable": false, "prompt": "Soft golden spotlight beam from top-center, illuminating the middle area, warm glow effect on transparent background", "visible": true, "opacity": 0.7 },
    { "id": "layer_shadow_1", "name": "产品阴影", "group": "shadow", "type": "shadow", "transparent": true, "editable": false, "prompt": "Soft drop shadow under the product, subtle elliptical shadow, semi-transparent black, realistic shadow on transparent background", "visible": true, "opacity": 0.5 },
    { "id": "layer_product", "name": "产品层", "group": "product", "type": "product", "transparent": true, "editable": false, "prompt": "Placeholder for user product image, centered composition", "visible": true, "opacity": 1 },
    ...more layers
  ],
  "textLayers": [
    { "id": "text_title", "name": "标题文字", "text": "${title || 'BRAND TITLE'}", "fontSize": 72, "fontWeight": "bold", "color": "#FFFFFF", "x": 100, "y": 80, "width": 1720, "height": 100, "align": "center", "editable": true, "fontFamily": "Noto Sans SC" },
    ...more text layers
  ]
}

CRITICAL: Output ONLY the JSON object. No markdown. No explanation. No code fences.`;
}

// ─── 构建 User Prompt ────────────────────────────────────────────────

export function buildPlanUserPrompt(userPrompt: string): string {
  return `Design request: ${userPrompt}

Please generate the layer plan JSON for this PSD design.`;
}

// ─── 尝试从LLM响应中提取LayerPlan ───────────────────────────────────

export function extractLayerPlanFromResponse(response: string): LayerPlan | null {
  // 尝试直接解析
  try {
    const parsed = JSON.parse(response);
    if (parsed.canvas && parsed.layers && Array.isArray(parsed.layers)) {
      return parsed as LayerPlan;
    }
  } catch {
    // Not direct JSON, try to extract from markdown
  }

  // 尝试从 markdown code fence 中提取
  const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed.canvas && parsed.layers && Array.isArray(parsed.layers)) {
        return parsed as LayerPlan;
      }
    } catch {
      // Code block content not valid JSON
    }
  }

  // 尝试找到第一个 { 和最后一个 } 之间的内容
  const firstBrace = response.indexOf('{');
  const lastBrace = response.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const jsonStr = response.substring(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(jsonStr);
      if (parsed.canvas && parsed.layers && Array.isArray(parsed.layers)) {
        return parsed as LayerPlan;
      }
    } catch {
      // Not valid JSON
    }
  }

  return null;
}
