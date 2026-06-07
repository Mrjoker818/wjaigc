import { NextRequest, NextResponse } from 'next/server';
import { dbGetEcomTemplates, dbGetEcomTemplate, dbUpsertEcomTemplate, dbDeleteEcomTemplate, dbBatchUpdateEcomTemplateOrder, type DbEcomTemplate } from '@/lib/db-storage';
import { requireApiAuthOrReject } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// ─── GET: List e-commerce templates ─────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const enabledOnly = request.nextUrl.searchParams.get('enabled') === 'true';
    const templates = await dbGetEcomTemplates(enabledOnly);

    // If DB has no templates, return built-in templates and seed them
    if (templates.length === 0) {
      const builtinTemplates = getBuiltinTemplates();
      for (const tpl of builtinTemplates) {
        await dbUpsertEcomTemplate(tpl);
      }
      return NextResponse.json({ success: true, templates: builtinTemplates });
    }

    return NextResponse.json({ success: true, templates });
  } catch (e) {
    console.error('[ecom-templates] GET error:', e);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// ─── POST: CRUD operations ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const { action } = body;

    // ─── List templates ───
    if (action === 'list') {
      const templates = await dbGetEcomTemplates();
      return NextResponse.json({ success: true, templates });
    }

    // ─── Get single template ───
    if (action === 'get') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
      const tpl = await dbGetEcomTemplate(id);
      if (!tpl) return NextResponse.json({ error: '未找到模板' }, { status: 404 });
      return NextResponse.json({ success: true, template: tpl });
    }

    // ─── Save (upsert) template ───
    if (action === 'save') {
      const { id, name, icon, description, promptTemplate, negativePrompt, aspectRatio, category, fidelityAnchor, sortOrder, isEnabled } = body;
      if (!name?.trim()) return NextResponse.json({ error: '请输入模板名称' }, { status: 400 });
      if (!promptTemplate?.trim()) return NextResponse.json({ error: '请输入提示词模板' }, { status: 400 });

      const now = Date.now();
      const tpl: DbEcomTemplate = {
        id: id || `tpl-${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim(),
        icon: icon || '📄',
        description: description || '',
        prompt_template: promptTemplate.trim(),
        negative_prompt: negativePrompt || '',
        aspect_ratio: aspectRatio || '1:1',
        category: category || 'product',
        fidelity_anchor: fidelityAnchor || '',
        sort_order: sortOrder ?? 999,
        is_enabled: isEnabled ?? true,
        is_builtin: false,
        created_at: body.createdAt || now,
        updated_at: now,
      };

      const ok = await dbUpsertEcomTemplate(tpl);
      if (!ok) return NextResponse.json({ error: '保存失败' }, { status: 500 });

      return NextResponse.json({ success: true, template: tpl });
    }

    // ─── Delete template ───
    if (action === 'delete') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
      const ok = await dbDeleteEcomTemplate(id);
      if (!ok) return NextResponse.json({ error: '删除失败（内置模板不可删除）' }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    // ─── Reorder templates ───
    if (action === 'reorder') {
      const { id, direction, orders } = body as { id?: string; direction?: 'up' | 'down'; orders?: Array<{ id: string; sortOrder: number }> };

      // Batch mode: direct orders array
      if (orders?.length) {
        const ok = await dbBatchUpdateEcomTemplateOrder(orders);
        if (!ok) return NextResponse.json({ error: '排序更新失败' }, { status: 500 });
        return NextResponse.json({ success: true });
      }

      // Single template move mode
      if (id && direction) {
        const allTemplates = await dbGetEcomTemplates();
        const idx = allTemplates.findIndex(t => t.id === id);
        if (idx === -1) return NextResponse.json({ error: '未找到模板' }, { status: 404 });

        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= allTemplates.length) return NextResponse.json({ success: true });

        // Swap sort orders
        const orders = [
          { id: allTemplates[idx].id, sortOrder: allTemplates[swapIdx].sort_order },
          { id: allTemplates[swapIdx].id, sortOrder: allTemplates[idx].sort_order },
        ];
        const ok = await dbBatchUpdateEcomTemplateOrder(orders);
        if (!ok) return NextResponse.json({ error: '排序更新失败' }, { status: 500 });
        return NextResponse.json({ success: true });
      }

      return NextResponse.json({ error: '缺少排序数据' }, { status: 400 });
    }

    // ─── Toggle enable/disable ───
    if (action === 'toggle') {
      const { id, isEnabled } = body;
      if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });

      const existing = await dbGetEcomTemplate(id);
      if (!existing) return NextResponse.json({ error: '未找到模板' }, { status: 404 });

      existing.is_enabled = isEnabled ?? !existing.is_enabled;
      existing.updated_at = Date.now();
      const ok = await dbUpsertEcomTemplate(existing);
      if (!ok) return NextResponse.json({ error: '更新失败' }, { status: 500 });
      return NextResponse.json({ success: true, template: existing });
    }

    // ─── Reset to built-in templates ───
    if (action === 'reset') {
      const builtinTemplates = getBuiltinTemplates();
      for (const tpl of builtinTemplates) {
        await dbUpsertEcomTemplate(tpl);
      }
      return NextResponse.json({ success: true, templates: builtinTemplates });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (e) {
    console.error('[ecom-templates] POST error:', e);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// ─── Built-in Templates (迁移自 brand-ecommerce/route.ts) ─────────────

function getBuiltinTemplates(): DbEcomTemplate[] {
  const now = Date.now();
  const base: Array<Omit<DbEcomTemplate, 'id' | 'created_at' | 'updated_at' | 'is_builtin' | 'sort_order'>> = [
    {
      name: '白底主图',
      icon: '⬜',
      description: '淘宝/京东/拼多多标准主图，纯白背景+自然阴影，平台审核无忧',
      prompt_template: `Commercial product photography, {SUBJECT}, placed on pure white background RGB(255,255,255), professional studio lighting from upper-left 45°, centered composition with breathing room, tack-sharp product details, soft natural drop shadow, e-commerce standard main image, high resolution suitable for mobile display. {brand_color_prompt}{style_extra}\n{SUBJECT_ACTION}\n{BACKGROUND_ELEMENTS}\n{STYLE_FIDELITY_PRODUCT}`,
      negative_prompt: 'low quality, blurry, distorted, deformed, watermark, signature, screenshot, compression artifacts, cluttered background, gray edge, shadow on background, text, logo, harsh shadow, asymmetric shadow, colored background, noise, grain, overexposed',
      aspect_ratio: '1:1',
      category: 'product',
      fidelity_anchor: 'product',
      is_enabled: true,
    },
    {
      name: '横版Banner图',
      icon: '🖼️',
      description: '横版广告Banner，冲击力构图+品牌文案，适合首页/活动页',
      prompt_template: `Commercial banner advertisement, {ASPECT_RATIO} format, {SUBJECT} as hero element, {SUBJECT_ACTION}, dynamic wide-angle composition with lens distortion effect for visual impact, {BACKGROUND_ELEMENTS}, bold typography layout — {MAIN_TEXT} as primary headline in large bold font, {SECONDARY_TEXT} as supporting copy, {ACCENT_SYMBOL} as decorative accent, warm amber color temperature, professional advertising photography quality. {brand_color_prompt}{style_extra}\n{STYLE_FIDELITY_COMMERCIAL}`,
      negative_prompt: 'low quality, blurry, distorted, deformed, watermark, text overflow, messy layout, unprofessional, boring, static, plain, low resolution, overexposed, underexposed, wrong aspect ratio',
      aspect_ratio: '16:9',
      category: 'banner',
      fidelity_anchor: 'commercial',
      is_enabled: true,
    },
    {
      name: '竖版详情页',
      icon: '📱',
      description: '竖版详情页长图，多区段结构：英雄区+卖点+细节+CTA',
      prompt_template: `E-commerce product detail page, vertical {ASPECT_RATIO} format, {SUBJECT} as hero product, multi-section layout — hero banner section at top with {SUBJECT} and {MAIN_TEXT} headline, value proposition section with {SECONDARY_TEXT}, core benefit section highlighting {PRODUCT_OR_PROP}, flavor/detail section showcasing material and craftsmanship, CTA section at bottom with {ACCENT_SYMBOL}, professional typography hierarchy, warm amber tones, premium commercial feel. {brand_color_prompt}{style_extra}\n{STYLE_FIDELITY_COMMERCIAL}`,
      negative_prompt: 'low quality, blurry, distorted, deformed, watermark, text overflow, messy layout, unprofessional, cluttered, inconsistent sections, wrong aspect ratio, horizontal layout',
      aspect_ratio: '3:4',
      category: 'detail',
      fidelity_anchor: 'commercial',
      is_enabled: true,
    },
    {
      name: '小红书封面',
      icon: '📕',
      description: '小红书竖版笔记封面，强化标题文字渲染+种草风格',
      prompt_template: `Xiaohongshu (RED) cover image, vertical {ASPECT_RATIO} format, {SUBJECT} as eye-catching focal point, {SUBJECT_ACTION}, lifestyle aesthetic with warm natural lighting, top 20% reserved for app overlay logo, bold and crisp Chinese text rendering — {MAIN_TEXT} as attention-grabbing headline in stylish font, {SECONDARY_TEXT} as supporting tagline, {ACCENT_SYMBOL} as decorative element, aspirational and shareable vibe, depth of field bokeh background, {brand_color_prompt}{style_extra}\n{STYLE_FIDELITY_LIFESTYLE}`,
      negative_prompt: 'low quality, blurry, distorted, deformed, watermark, ugly, boring, dated, horizontal layout, harsh text, aliased text, misspelled characters, cluttered, unappealing',
      aspect_ratio: '3:4',
      category: 'social',
      fidelity_anchor: 'lifestyle',
      is_enabled: true,
    },
    {
      name: '抖音橱窗图',
      icon: '🎵',
      description: '抖音横版商品橱窗封面，动态构图+行动号召按钮位',
      prompt_template: `Douyin product showcase cover, horizontal {ASPECT_RATIO} format, {SUBJECT} as hero product, {SUBJECT_ACTION}, dynamic wide-angle composition guiding eyes to product, key highlight areas auto-brightened, bottom-right reserved for CTA button overlay, bold headline text — {MAIN_TEXT}, supporting copy — {SECONDARY_TEXT}, {ACCENT_SYMBOL} as visual accent, energetic and engaging vibe, professional commercial photography quality, {brand_color_prompt}{style_extra}\n{STYLE_FIDELITY_COMMERCIAL}`,
      negative_prompt: 'low quality, blurry, distorted, deformed, watermark, vertical layout, boring, static, plain, text overflow, messy layout, unprofessional',
      aspect_ratio: '16:9',
      category: 'social',
      fidelity_anchor: 'commercial',
      is_enabled: true,
    },
    {
      name: '场景氛围图',
      icon: '🏞️',
      description: '商品融入生活场景，自然光影+景深氛围，增强购买代入感',
      prompt_template: `Lifestyle product photography, {SUBJECT} placed in {LOCATION} setting, {SUBJECT_ACTION}, natural ambient lighting matching real-world scene, warm and inviting atmosphere, professional depth of field with natural bokeh, {BACKGROUND_ELEMENTS}, product seamlessly integrated — no floating or composite feel, magazine editorial quality, aspirational mood. {brand_color_prompt}{style_extra}\n{STYLE_FIDELITY_LIFESTYLE}`,
      negative_prompt: 'low quality, blurry, distorted, deformed, watermark, ugly, unrealistic, cartoon, fake composite, harsh edge, floating product, mismatched lighting, unnatural shadow, CGI look',
      aspect_ratio: '4:3',
      category: 'scene',
      fidelity_anchor: 'lifestyle',
      is_enabled: true,
    },
    {
      name: '模特展示图',
      icon: '👗',
      description: '模特穿搭/使用展示，自然姿态+时尚杂志风格',
      prompt_template: `Fashion model photography, model showcasing {SUBJECT}, {SUBJECT_ACTION}, full-body to half-body shot, professional studio lighting, natural and confident pose, clean background with subtle gradient, fashion magazine editorial style, high-resolution skin and fabric detail, {BACKGROUND_ELEMENTS}, {brand_color_prompt}{style_extra}\n{STYLE_FIDELITY_LIFESTYLE}`,
      negative_prompt: 'low quality, blurry, distorted face, deformed hands, extra limbs, watermark, ugly, unnatural pose, fused fingers, long neck, bad anatomy, disfigured, extra fingers, mutated hands',
      aspect_ratio: '3:4',
      category: 'model',
      fidelity_anchor: 'lifestyle',
      is_enabled: true,
    },
    {
      name: '细节特写',
      icon: '🔍',
      description: '微距展示材质纹理和工艺细节，放大产品质感',
      prompt_template: `Macro product photography, extreme close-up detail shot of {SUBJECT}, showcasing {PRODUCT_OR_PROP} — material texture, craftsmanship, and fine details, ultra-shallow depth of field, professional studio ring lighting, tack-sharp focus on detail area, {BACKGROUND_ELEMENTS} as soft bokeh, high-resolution sensor quality capture. {brand_color_prompt}{style_extra}\n{STYLE_FIDELITY_PRODUCT}`,
      negative_prompt: 'low quality, blurry, out of focus, distorted, deformed, watermark, noise, grain, overexposed, underexposed, depth of field too deep, lack of detail, soft focus',
      aspect_ratio: '1:1',
      category: 'product',
      fidelity_anchor: 'product',
      is_enabled: true,
    },
    {
      name: '品牌海报',
      icon: '🎨',
      description: '品牌视觉延展海报，渐变背景+品牌色锁定+高级质感',
      prompt_template: `Brand visual extension poster, {SUBJECT} as central element, {SUBJECT_ACTION}, premium gradient background with brand color consistency, {brand_color_prompt} professional advertising composition, {MAIN_TEXT} as brand headline in elegant typography, {SECONDARY_TEXT} as tagline, {ACCENT_SYMBOL} as brand mark, luxury commercial photography style, high-end material feel. {style_extra}\n{STYLE_FIDELITY_COMMERCIAL}`,
      negative_prompt: 'low quality, blurry, distorted, deformed, watermark, text overflow, messy layout, inconsistent colors, cheap feel, amateur, plain background',
      aspect_ratio: '3:4',
      category: 'promo',
      fidelity_anchor: 'commercial',
      is_enabled: true,
    },
    {
      name: '创意合成图',
      icon: '✨',
      description: '创意视觉合成，超现实场景+梦幻光影，打造差异化产品形象',
      prompt_template: `Creative composite product photography, {SUBJECT} in surreal dreamlike scene, {SUBJECT_ACTION}, {BACKGROUND_ELEMENTS} with fantastical elements, ethereal and dreamy lighting effects, artistic presentation with unique visual language, {MAIN_TEXT} as creative headline, {ACCENT_SYMBOL} as mystical accent, {brand_color_prompt} differentiated product imagery, professional retouching quality. {style_extra}\n{STYLE_FIDELITY_COMMERCIAL}`,
      negative_prompt: 'low quality, blurry, distorted, deformed, watermark, boring, ordinary, plain, messy composite, harsh edges, unnatural blend, cheap CGI',
      aspect_ratio: '1:1',
      category: 'creative',
      fidelity_anchor: 'commercial',
      is_enabled: true,
    },
    {
      name: '包装展示图',
      icon: '📦',
      description: '产品包装盒/袋展示，品牌标识清晰+高级包装质感',
      prompt_template: `Product packaging photography, {SUBJECT} packaging box/bag facing camera, {SUBJECT_ACTION}, brand identity and logo clearly visible on packaging, {MAIN_TEXT} printed on packaging surface, {brand_color_prompt} premium packaging material texture, soft professional lighting, {BACKGROUND_ELEMENTS}, high-end unboxing feel. {style_extra}\n{STYLE_FIDELITY_PRODUCT}`,
      negative_prompt: 'low quality, blurry, distorted, deformed, watermark, damaged packaging, wrinkled, misprinted text, cheap material, flat lighting, unappealing',
      aspect_ratio: '3:4',
      category: 'product',
      fidelity_anchor: 'product',
      is_enabled: true,
    },
    {
      name: '多尺寸批量图',
      icon: '📐',
      description: '同一商品生成多种尺寸，全渠道分发覆盖（1:1+3:4+16:9）',
      prompt_template: `Multi-purpose product photography, {SUBJECT}, versatile composition that works in multiple aspect ratios, {SUBJECT_ACTION}, professional studio lighting, clean background suitable for cropping, {MAIN_TEXT} as flexible headline, {brand_color_prompt} consistent visual identity across sizes, {style_extra}\n{STYLE_FIDELITY_PRODUCT}`,
      negative_prompt: 'low quality, blurry, distorted, deformed, watermark, cluttered, tight composition, elements cut off, inconsistent style',
      aspect_ratio: '1:1',
      category: 'product',
      fidelity_anchor: 'product',
      is_enabled: true,
    },
  ];

  return base.map((tpl, idx) => ({
    ...tpl,
    id: BUILTIN_IDS[idx],
    is_builtin: true,
    sort_order: idx + 1,
    created_at: now,
    updated_at: now,
  }));
}

// Stable IDs for built-in templates (same as original ECOM_TEMPLATES)
const BUILTIN_IDS = [
  'white-bg', 'banner-horizontal', 'detail-vertical', 'xiaohongshu',
  'douyin', 'scene-lifestyle', 'model-wear', 'detail-closeup',
  'brand-poster', 'creative-composite', 'packaging', 'multi-size-batch',
];
