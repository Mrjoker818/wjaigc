import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

interface StyleSubCategory { id: string; name: string; prompt: string; }
interface StyleCategory { id: string; name: string; subStyles: StyleSubCategory[]; }

export const FONT_STYLE_CATEGORIES: StyleCategory[] = [
  { id: 'smart-recommend', name: '智能推荐', subStyles: [
    { id: 'auto-1', name: '智能推荐1', prompt: '适合当前文字和场景的最佳风格' },
    { id: 'auto-2', name: '智能推荐2', prompt: '备选推荐风格' },
    { id: 'auto-3', name: '智能推荐3', prompt: '创意风格推荐' },
    { id: 'auto-4', name: '智能推荐4', prompt: '差异化风格推荐' },
  ]},
  { id: 'commercial-title', name: '商业标题字', subStyles: [
    { id: 'commercial-premium', name: '商业高级字', prompt: '高端商业感，笔画精致，结构稳健' },
    { id: 'commercial-minimal', name: '商业极简字', prompt: '极简克制，笔画精炼，负空间充足' },
    { id: 'commercial-impact', name: '商业冲击字', prompt: '笔画厚重，视觉冲击力强' },
    { id: 'commercial-elegant', name: '商业优雅字', prompt: '笔画纤细优雅，曲线流畅' },
    { id: 'commercial-bold', name: '商业粗壮字', prompt: '笔画粗壮饱满，醒目大气' },
    { id: 'commercial-3d', name: '商业立体字', prompt: '3D立体效果，光影质感' },
    { id: 'commercial-neon', name: '商业霓虹字', prompt: '霓虹发光效果，赛博商业感' },
    { id: 'commercial-gold', name: '黑金商业字', prompt: '金色质感，黑色背景，奢华商业风' },
    { id: 'commercial-tech', name: '科技商业字', prompt: '科技线条感，未来商业风' },
    { id: 'commercial-retro', name: '复古商业字', prompt: '复古印刷感，怀旧商业风' },
  ]},
  { id: 'text-logo', name: '文字Logo', subStyles: [
    { id: 'logo-minimal', name: '极简Logo', prompt: '极简字标，结构精炼，小尺寸清晰' },
    { id: 'logo-geometric', name: '几何字标', prompt: '几何化笔画，现代结构' },
    { id: 'logo-graphic', name: '图形融合字标', prompt: '图形融入笔画，字图一体' },
    { id: 'logo-handwrite', name: '手写字标', prompt: '手写质感，自然亲和' },
    { id: 'logo-seal', name: '印章字标', prompt: '印章风格，传统文化感' },
    { id: 'logo-outline', name: '描边字标', prompt: '线条描边，结构通透' },
    { id: 'logo-negative', name: '负形字标', prompt: '负空间设计，巧妙留白' },
    { id: 'logo-variable', name: '可变字标', prompt: '笔画可变，适配多场景' },
    { id: 'logo-gradient', name: '渐变字标', prompt: '渐变色彩，数字感强' },
    { id: 'logo-mono', name: '黑白字标', prompt: '纯黑白，高对比度' },
  ]},
  { id: 'trendy-young', name: '潮流年轻', subStyles: [
    { id: 'trendy-graffiti', name: '潮流涂鸦', prompt: '涂鸦风，街头感，笔画自由奔放' },
    { id: 'trendy-cute', name: 'Q弹可爱', prompt: '圆润可爱，笔画Q弹' },
    { id: 'trendy-neon', name: '霓虹发光', prompt: '霓虹灯管效果，赛博夜生活感' },
    { id: 'trendy-pixel', name: '像素复古', prompt: '8-bit像素风，游戏怀旧感' },
    { id: 'trendy-cyber', name: '赛博朋克', prompt: '赛博朋克，故障艺术，数字未来感' },
    { id: 'trendy-bubble', name: '泡泡字', prompt: '气泡膨胀感，圆润膨胀' },
    { id: 'trendy-glitch', name: '故障艺术', prompt: '数字故障，RGB偏移' },
    { id: 'trendy-vaporwave', name: '蒸汽波', prompt: '蒸汽波，渐变粉紫，复古未来感' },
    { id: 'trendy-pop', name: '波普艺术', prompt: '波普风格，鲜艳撞色' },
    { id: 'trendy-sticker', name: '贴纸字', prompt: '贴纸效果，厚描边' },
  ]},
  { id: 'oriental', name: '东方国风', subStyles: [
    { id: 'oriental-calligraphy', name: '国潮书法', prompt: '现代国潮书法，传统笔法+当代审美' },
    { id: 'oriental-luxury', name: '东方奢感', prompt: '东方奢华，金银质感' },
    { id: 'oriental-seal', name: '篆刻印章', prompt: '篆刻风格，朱白对比' },
    { id: 'oriental-ink', name: '水墨写意', prompt: '水墨晕染，写意笔法' },
    { id: 'oriental-paper', name: '宣纸拓印', prompt: '宣纸质感，碑帖拓印风' },
    { id: 'oriental-tang', name: '唐风楷书', prompt: '唐代楷书风，端庄大气' },
    { id: 'oriental-song', name: '宋体雅韵', prompt: '宋体风骨，横细竖粗' },
    { id: 'oriental-cloud', name: '祥云纹样', prompt: '祥云融入笔画，吉祥寓意' },
    { id: 'oriental-bamboo', name: '竹节笔意', prompt: '竹节形态融入笔画' },
    { id: 'oriental-dragon', name: '龙纹字', prompt: '龙纹融入笔画，气势磅礴' },
  ]},
  { id: 'emotional', name: '情绪叙事', subStyles: [
    { id: 'emotional-movie', name: '情绪电影字', prompt: '电影海报质感，情绪张力' },
    { id: 'emotional-dark', name: '暗黑叙事字', prompt: '暗黑风格，压抑情绪' },
    { id: 'emotional-broken', name: '破碎感标题字', prompt: '破碎裂痕效果，情感碎裂感' },
    { id: 'emotional-handwrite', name: '手写情绪字', prompt: '手写质感，笔触真实' },
    { id: 'emotional-melancholy', name: '忧伤字', prompt: '忧伤低沉，笔画下垂' },
    { id: 'emotional-rage', name: '愤怒爆发字', prompt: '愤怒爆发，笔画狂放' },
    { id: 'emotional-dreamy', name: '梦幻字', prompt: '梦幻柔和，笔画飘渺' },
    { id: 'emotional-freedom', name: '自由随性字', prompt: '自由随性，笔画不拘一格' },
    { id: 'emotional-warm', name: '温暖治愈字', prompt: '温暖治愈，圆润柔和' },
    { id: 'emotional-mystery', name: '神秘字', prompt: '神秘诡谲，笔画隐现' },
  ]},
  { id: 'tech-future', name: '科技未来', subStyles: [
    { id: 'tech-cyber', name: '赛博科技字', prompt: '赛博科技，线路感，未来数字风' },
    { id: 'tech-goldblack', name: '黑金科技字', prompt: '黑金配色，科技奢华感' },
    { id: 'tech-digital', name: '数字切割字', prompt: '数字切割，几何分割' },
    { id: 'tech-hologram', name: '全息投影字', prompt: '全息投影效果，光栅彩虹色' },
    { id: 'tech-matrix', name: '矩阵代码字', prompt: '矩阵代码，数据流效果' },
    { id: 'tech-ai', name: 'AI神经字', prompt: 'AI神经网络，算法生成感' },
    { id: 'tech-laser', name: '激光切割字', prompt: '激光切割，锋利边缘' },
    { id: 'tech-circuit', name: '电路板字', prompt: '电路板纹路融入笔画' },
    { id: 'tech-quantum', name: '量子字', prompt: '量子态叠加效果' },
    { id: 'tech-space', name: '太空字', prompt: '太空宇宙感，星际字体' },
  ]},
  { id: 'texture-fx', name: '质感特效', subStyles: [
    { id: 'fx-metal', name: '金属字', prompt: '金属质感，铬合金/拉丝金属效果' },
    { id: 'fx-glass', name: '玻璃字', prompt: '玻璃质感，透明折射效果' },
    { id: 'fx-fire', name: '火焰字', prompt: '燃烧火焰效果，热力四射' },
    { id: 'fx-ice', name: '冰霜字', prompt: '冰霜凝结效果' },
    { id: 'fx-water', name: '水滴字', prompt: '水滴/水面效果，流体感' },
    { id: 'fx-smoke', name: '烟雾字', prompt: '烟雾缭绕效果' },
    { id: 'fx-lightning', name: '闪电字', prompt: '闪电劈裂效果' },
    { id: 'fx-crystal', name: '水晶字', prompt: '水晶质感，多面折射效果' },
    { id: 'fx-wood', name: '木刻字', prompt: '木质雕刻效果' },
    { id: 'fx-stone', name: '石碑字', prompt: '石碑刻字效果' },
  ]},
  { id: 'industry', name: '行业场景', subStyles: [
    { id: 'industry-food', name: '美食餐饮字', prompt: '美食餐饮风格，食欲感' },
    { id: 'industry-fashion', name: '时尚潮流字', prompt: '时尚杂志感，高级排版' },
    { id: 'industry-sports', name: '运动健身字', prompt: '运动力量感，笔画刚劲' },
    { id: 'industry-music', name: '音乐娱乐字', prompt: '音乐律动感，节奏笔画' },
    { id: 'industry-education', name: '教育文化字', prompt: '文化教育感，端庄清晰' },
    { id: 'industry-medical', name: '医疗健康字', prompt: '医疗健康感，清洁安全' },
    { id: 'industry-realestate', name: '地产建筑字', prompt: '大气稳重' },
    { id: 'industry-auto', name: '汽车出行字', prompt: '速度感，流畅线条' },
    { id: 'industry-finance', name: '金融财经字', prompt: '专业感，精确稳重' },
    { id: 'industry-game', name: '游戏电竞字', prompt: '炫酷发光，电竞风格' },
  ]},
];

export const SCENE_MAP: Record<string, string> = {
  'KV主标题': '品牌KV主视觉标题字，需要强烈视觉冲击力和品牌辨识度',
  '封面标题': '杂志/专辑/书籍封面标题，需要吸引眼球和主题表达',
  '文字Logo': '品牌文字Logo，需要简洁、高辨识度、小尺寸清晰',
  '活动主题字': '活动/展会主题字，需要氛围感和信息传达力',
  '门头招牌': '线下店铺门头招牌，需要远距离可识别',
  '小红书封面': '小红书笔记封面标题，需要吸睛点击',
  '抖音封面': '抖音视频封面标题，需要高对比度',
  '商业海报': '商业推广海报主标题，需要商业感',
  '音乐封面': '音乐专辑/单曲封面，需要音乐气质和艺术感',
  '电影海报': '电影海报标题字，需要叙事感和情绪张力',
  '网站Logo': '网站/平台Logo文字，需要数字感',
  'App图标': 'App图标文字，需要极简、小尺寸清晰',
};

export const STROKE_MAP: Record<string, string> = {
  '圆角': '笔画圆润处理', '连笔': '相邻笔画自然连接', '笔画延展': '笔画末端自然延伸',
  '笔画缩短': '笔画精简缩短', '笔画加粗': '笔画整体加粗', '笔画变细': '笔画纤细精致',
  '断笔': '笔画故意断裂', '毛笔笔触': '毛笔书写质感', '几何简化': '笔画几何化简化', '装饰笔触': '笔画末端添加装饰',
};

export const GRAPHIC_MAP: Record<string, string> = {
  '无': '无图形融合', '云气': '云纹融入笔画', '火焰': '火焰形态融入', '水波': '水波纹路融入',
  '雷电': '闪电形态融入', '植物': '植物藤蔓融入', '光线': '光线融入', '裂纹': '裂纹融入',
  '几何': '几何图形融入', '粒子': '粒子散点融入', '飘带': '飘带融入', '齿轮': '齿轮机械融入',
  '音符': '音符节奏融入', '山脉': '山脉轮廓融入', '门': '门框形态融入', '裂痕': '裂痕纹理融入', '自定义元素': '用户指定元素融入',
};

export const MATERIAL_MAP: Record<string, string> = {
  '平面矢量': '平面矢量感', '金属质感': '金属材质', '玻璃质感': '玻璃材质',
  '霓虹发光': '霓虹灯管效果', '陶瓷质感': '陶瓷材质', '毛笔墨迹': '毛笔墨迹感',
  '纸张压印': '纸张压印凹凸感', '立体浮雕': '3D立体浮雕', '液态流体': '液态流动效果',
  '磨砂质感': '磨砂哑光', '手写笔触': '手写笔触质感', '赛博光效': '赛博朋克光效',
};

export function buildJimengPrompt(params: {
  text: string; scene: string; style: string;
  strokeOptions: string[]; graphicElements: string[];
  color: string; background: string; material: string;
  ratio: string; jimengEnhanced: boolean;
}): string {
  const { text, scene, style, strokeOptions, graphicElements, color, background, material, ratio, jimengEnhanced } = params;
  const sceneDesc = SCENE_MAP[scene] || scene;
  const strokeDesc = strokeOptions.length > 0 ? strokeOptions.map(s => STROKE_MAP[s] || s).join('，') : '保持原有笔画结构';
  const graphicDesc = graphicElements.length > 0 ? graphicElements.map(g => GRAPHIC_MAP[g] || g).join('，') : '无图形融合';
  const materialDesc = MATERIAL_MAP[material] || material;

  let prompt = `中文字体设计，文字内容为"${text}"，只保留这几个中文文字，不要出现其他任何文字。\n\n使用场景：${sceneDesc}。\n字体风格：${style}。\n画面构图：字体居中，占据画面主体，整体构图简洁清晰。\n字形结构：字形结构清晰，笔画经过艺术化改造，但必须保持中文可读性。\n笔画处理：${strokeDesc}。\n图形融合：${graphicDesc}，图形元素需要自然融入部分笔画，但不要影响文字识别。\n颜色材质：字体颜色为${color}，质感为${materialDesc}。\n背景：${background}。\n画面比例：${ratio}。`;

  if (jimengEnhanced) {
    prompt += `\n\n严格要求：不要英文，不要拼音，不要乱码，不要多余文字，不要重复文字，不要水印，不要复杂背景。文字必须清晰可读，小尺寸下仍然可以识别。`;
  }
  return prompt;
}

export function buildBlackOnWhitePrompt(text: string): string {
  return `黑色纯背景，白色中文标题字，文字内容为"${text}"，字体居中，占据画面主体，原创中文字体设计，强调字形结构与笔画设计。只保留"${text}"这几个中文，不要其他文字，不要英文，不要拼音，不要乱码，不要重复字。文字必须清晰可读。`;
}

export function buildTransparentLogoPrompt(text: string): string {
  return `透明背景，原创中文文字Logo，文字内容为"${text}"，只保留这几个中文。字体具有矢量感，结构简洁，小尺寸清晰，黑白适配，适合品牌Logo、网站Logo、App图标使用。不要其他文字，不要英文，不要乱码，不要重复字，不要复杂背景。`;
}

function generateTemplatePlans(
  text: string, scene: string, primaryStyleCategory: string, secondaryStyle: string,
  color: string, background: string, material: string,
  strokeOptions: string[], graphicElements: string[],
): Record<string, unknown>[] {
  const styleName = secondaryStyle || primaryStyleCategory || '智能推荐';
  const charCount = text.length;
  const plans: Record<string, unknown>[] = [
    { title: `${styleName}·经典版`, stylePositioning: `适合${scene}场景的经典${styleName}风格`, glyphFeatures: charCount <= 2 ? '大字形占比，结构舒展' : '排列整齐，字间距适中', strokeAdvice: strokeOptions.length > 0 ? `${strokeOptions.join('、')}处理` : '保持笔画结构清晰', graphicFusion: graphicElements.length > 0 && !graphicElements.includes('无') ? `${graphicElements.join('、')}元素融入笔画` : '纯文字设计', colorMaterial: `${color}配色，${material}质感`, applicableScene: scene, recommendIndex: 5 },
    { title: `${styleName}·创意版`, stylePositioning: '加入创意变化，更具个性', glyphFeatures: '笔画有意识变形，保持可读性', strokeAdvice: '关键笔画夸张处理', graphicFusion: graphicElements.length > 0 && !graphicElements.includes('无') ? `强化${graphicElements[0]}融合` : '可添加装饰元素', colorMaterial: `${color}为主，局部点缀`, applicableScene: scene, recommendIndex: 4 },
    { title: `${styleName}·极简版`, stylePositioning: '极简克制，最大视觉效果', glyphFeatures: '结构极简，负空间充分', strokeAdvice: '去除非必要装饰', graphicFusion: '纯文字表达', colorMaterial: `单色${color}`, applicableScene: `${scene}，适合小尺寸`, recommendIndex: 4 },
  ];
  if (charCount >= 4) {
    plans.push({ title: `${styleName}·主副标题版`, stylePositioning: '拆分为主次关系', glyphFeatures: `前${Math.ceil(charCount / 2)}字大字，其余小字`, strokeAdvice: '主标题厚重，辅助轻巧', graphicFusion: '主副标题分隔', colorMaterial: `主标题${color}，辅助低饱和度`, applicableScene: `${scene}，多字场景`, recommendIndex: 3 });
  }
  return plans;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, scene, primaryStyleCategory, secondaryStyle, ratio, color, background, strokeOptions = [], graphicElements = [], material = '平面矢量', jimengEnhanced = true } = body;

    if (!text?.trim()) return NextResponse.json({ error: '请输入要设计的中文文字' }, { status: 400 });
    if (text.trim().length > 20) return NextResponse.json({ error: '文字过长，建议拆分（最多20字）' }, { status: 400 });

    const chatProvider = await findProviderForFeature('chat');
    const styleInfo = FONT_STYLE_CATEGORIES.find(c => c.id === primaryStyleCategory);
    const styleName = styleInfo?.name || primaryStyleCategory;
    const subStyleName = secondaryStyle || '智能推荐';

    let plans: Record<string, unknown>[] = [];

    if (chatProvider) {
      const systemPrompt = `你是一位专业的中文字体设计师。根据用户需求生成3-6套字体设计方案。每套方案JSON格式：{"title":"方案名称","stylePositioning":"风格定位","glyphFeatures":"字形特点","strokeAdvice":"笔画处理","graphicFusion":"图形融合","colorMaterial":"色彩质感","applicableScene":"适用场景","recommendIndex":5}。只返回JSON数组。`;
      const userPrompt = `文字："${text}"\n场景：${scene}\n风格：${styleName}·${subStyleName}\n颜色：${color}\n背景：${background}\n笔画：${strokeOptions.join('、')||'不限'}\n图形：${graphicElements.join('、')||'不限'}\n质感：${material}`;

      const baseUrl = chatProvider.baseUrl || '';
      const apiKey = chatProvider.apiKey || '';
      const chatModel = chatProvider.selectedModels?.[0] || 'gpt-4o';

      try {
        const response = await fetchWithV1Retry(baseUrl, '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model: chatModel, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], temperature: 0.8, max_tokens: 4000 }),
        }, true, 30000);
        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || '';
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) plans = JSON.parse(jsonMatch[0]);
        }
      } catch { /* fallback to template */ }
    }

    if (!Array.isArray(plans) || plans.length === 0) {
      plans = generateTemplatePlans(text, scene, primaryStyleCategory, secondaryStyle, color, background, material, strokeOptions, graphicElements);
    }

    const fullPrompt = buildJimengPrompt({ text, scene, style: `${styleName}·${subStyleName}`, strokeOptions, graphicElements, color, background, material, ratio, jimengEnhanced });

    return NextResponse.json({
      plans,
      prompt: fullPrompt,
      shortPrompt: buildBlackOnWhitePrompt(text),
      enhancedPrompt: buildJimengPrompt({ text, scene, style: `${styleName}·${subStyleName}`, strokeOptions, graphicElements, color, background, material, ratio, jimengEnhanced: true }),
    });
  } catch (error: unknown) {
    console.error('[font-design/plan] Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '生成方案失败' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    styleCategories: FONT_STYLE_CATEGORIES,
    scenes: Object.keys(SCENE_MAP).map(id => ({ id, name: id, description: SCENE_MAP[id] })),
    strokeOptions: Object.keys(STROKE_MAP).map(id => ({ id, name: id, description: STROKE_MAP[id] })),
    graphicElements: Object.keys(GRAPHIC_MAP).map(id => ({ id, name: id, description: GRAPHIC_MAP[id] })),
    materials: Object.keys(MATERIAL_MAP).map(id => ({ id, name: id, description: MATERIAL_MAP[id] })),
  });
}
