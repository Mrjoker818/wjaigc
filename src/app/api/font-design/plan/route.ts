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
  const strokeDesc = strokeOptions.length > 0 ? strokeOptions.map(s => STROKE_MAP[s] || s).join('\uFF0C') : '\u4FDD\u6301\u539F\u6709\u7B14\u753B\u7ED3\u6784';
  const graphicDesc = graphicElements.length > 0 ? graphicElements.map(g => GRAPHIC_MAP[g] || g).join('\uFF0C') : '\u65E0\u56FE\u5F62\u878D\u5408';
  const materialDesc = MATERIAL_MAP[material] || material;

  let prompt = '\u4E2D\u6587\u5B57\u4F53\u8BBE\u8BA1\uFF0C\u6587\u5B57\u5185\u5BB9\u4E3A"' + text + '"\uFF0C\u53EA\u4FDD\u7559\u8FD9\u51E0\u4E2A\u4E2D\u6587\u6587\u5B57\uFF0C\u4E0D\u8981\u51FA\u73B0\u5176\u4ED6\u4EFB\u4F55\u6587\u5B57\u3002\n\n\u4F7F\u7528\u573A\u666F\uFF1A' + sceneDesc + '\u3002\n\u5B57\u4F53\u98CE\u683C\uFF1A' + style + '\u3002\n\u753B\u9762\u6784\u56FE\uFF1A\u5B57\u4F53\u5C45\u4E2D\uFF0C\u5360\u636E\u753B\u9762\u4E3B\u4F53\uFF0C\u6574\u4F53\u6784\u56FE\u7B80\u6D01\u6E05\u6670\u3002\n\u5B57\u5F62\u7ED3\u6784\uFF1A\u5B57\u5F62\u7ED3\u6784\u6E05\u6670\uFF0C\u7B14\u753B\u7ECF\u8FC7\u827A\u672F\u5316\u6539\u9020\uFF0C\u4F46\u5FC5\u987B\u4FDD\u6301\u4E2D\u6587\u53EF\u8BFB\u6027\u3002\n\u7B14\u753B\u5904\u7406\uFF1A' + strokeDesc + '\u3002\n\u56FE\u5F62\u878D\u5408\uFF1A' + graphicDesc + '\uFF0C\u56FE\u5F62\u5143\u7D20\u9700\u8981\u81EA\u7136\u878D\u5165\u90E8\u5206\u7B14\u753B\uFF0C\u4F46\u4E0D\u8981\u5F71\u54CD\u6587\u5B57\u8BC6\u522B\u3002\n\u989C\u8272\u6750\u8D28\uFF1A\u5B57\u4F53\u989C\u8272\u4E3A' + color + '\uFF0C\u8D28\u611F\u4E3A' + materialDesc + '\u3002\n\u80CC\u666F\uFF1A' + background + '\u3002\n\u753B\u9762\u6BD4\u4F8B\uFF1A' + ratio + '\u3002';

  if (jimengEnhanced) {
    prompt += '\n\n\u4E25\u683C\u8981\u6C42\uFF1A\u4E0D\u8981\u82F1\u6587\uFF0C\u4E0D\u8981\u62FC\u97F3\uFF0C\u4E0D\u8981\u4E71\u7801\uFF0C\u4E0D\u8981\u591A\u4F59\u6587\u5B57\uFF0C\u4E0D\u8981\u91CD\u590D\u6587\u5B57\uFF0C\u4E0D\u8981\u6C34\u5370\u3002\u6587\u5B57\u5FC5\u987B\u6E05\u6670\u53EF\u8BFB\uFF0C\u5C0F\u5C3A\u5BF8\u4E0B\u4ECD\u7136\u53EF\u4EE5\u8BC6\u522B\u3002';
  }
  return prompt;
}

export function buildBlackOnWhitePrompt(text: string): string {
  return '\u9ED1\u8272\u7EAF\u80CC\u666F\uFF0C\u767D\u8272\u4E2D\u6587\u6807\u9898\u5B57\uFF0C\u6587\u5B57\u5185\u5BB9\u4E3A"' + text + '"\uFF0C\u5B57\u4F53\u5C45\u4E2D\uFF0C\u5360\u636E\u753B\u9762\u4E3B\u4F53\uFF0C\u539F\u521B\u4E2D\u6587\u5B57\u4F53\u8BBE\u8BA1\uFF0C\u5F3A\u8C03\u5B57\u5F62\u7ED3\u6784\u4E0E\u7B14\u753B\u8BBE\u8BA1\u3002\u53EA\u4FDD\u7559"' + text + '"\u8FD9\u51E0\u4E2A\u4E2D\u6587\uFF0C\u4E0D\u8981\u5176\u4ED6\u6587\u5B57\uFF0C\u4E0D\u8981\u82F1\u6587\uFF0C\u4E0D\u8981\u62FC\u97F3\uFF0C\u4E0D\u8981\u4E71\u7801\uFF0C\u4E0D\u8981\u91CD\u590D\u5B57\u3002\u6587\u5B57\u5FC5\u987B\u6E05\u6670\u53EF\u8BFB\u3002';
}

export function buildTransparentLogoPrompt(text: string): string {
  return '透明背景，原创中文文字Logo，文字内容为"' + text + '"，只保留这几个中文。字体具有矢量感，结构简洁，小尺寸清晰，黑白适配，适合品牌Logo、网站Logo、App图标使用。不要其他文字，不要英文，不要乱码，不要重复字，不要复杂背景。';
}

function parseSSEToJSON(text: string): Record<string, unknown> | null {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const choices = parsed.choices as Record<string, unknown>[] | undefined;
        const firstChoice = choices?.[0];
        const delta = firstChoice?.delta as Record<string, unknown> | undefined;
        if (typeof delta?.content === 'string' && delta.content.trim()) {
          return parsed;
        }
        const msg = firstChoice?.message as Record<string, unknown> | undefined;
        if (typeof msg?.content === 'string' && msg.content.trim()) {
          return parsed;
        }
      } catch { /* skip */ }
    }
  }
  return null;
}

function parseSSETextToJSON(text: string): string | null {
  let fullContent = '';
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const choices = (parsed as Record<string, unknown>)?.choices as Record<string, unknown>[] | undefined;
        if (choices?.[0]) {
          const delta = choices[0].delta as Record<string, unknown> | undefined;
          if (typeof delta?.content === 'string') fullContent += delta.content;
          const msg = choices[0].message as Record<string, unknown> | undefined;
          if (typeof msg?.content === 'string') fullContent += msg.content;
        }
        const message = (parsed as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
        if (typeof message?.content === 'string') fullContent += message.content;
      } catch { /* skip */ }
    }
  }
  return fullContent || null;
}

function extractJSONFromText(text: string): unknown | null {
  // Try direct JSON parse first
  try { return JSON.parse(text); } catch { /* */ }
  // Try extracting from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1]); } catch { /* */ }
  }
  // Try finding first { ... } or [ ... ]
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1]); } catch { /* */ }
  }
  return null;
}

function buildSystemPrompt(params: {
  text: string; scene: string; style: string; ratio: string;
  color: string; background: string; material: string;
  strokeOptions: string[]; graphicElements: string[];
}): string {
  const { text, scene, style, ratio, color, background, material, strokeOptions, graphicElements } = params;
  const sceneDesc = SCENE_MAP[scene] || scene;
  const strokeDesc = strokeOptions.length > 0 ? strokeOptions.map(s => STROKE_MAP[s] || s).join('、') : '保持原有笔画结构';
  const graphicDesc = graphicElements.length > 0 ? graphicElements.map(g => GRAPHIC_MAP[g] || g).join('、') : '无图形融合';
  const materialDesc = MATERIAL_MAP[material] || material;

  return `你是一位资深的中文字体设计创意总监。请根据以下用户需求，生成3个差异化的字体设计方案。

【用户需求】
- 文字内容："${text}"
- 使用场景：${scene}（${sceneDesc}）
- 字体风格：${style}
- 画面比例：${ratio}
- 颜色偏好：${color}
- 背景要求：${background}
- 质感材质：${materialDesc}
- 笔画处理：${strokeDesc}
- 图形融合：${graphicDesc}

【重要：差异化要求】
3个方案必须在以下维度上明确区分，不能雷同：
- 方案A：侧重"风格强化"——将该风格的核心特征发挥到极致
- 方案B：侧重"创意融合"——在风格基础上融入创意元素或跨风格混搭
- 方案C：侧重"应用适配"——针对使用场景做最优化设计

【输出格式】JSON，严格遵循：
{
  "plans": [
    {
      "title": "方案名称（4-8字）",
      "stylePositioning": "风格定位（10-20字）",
      "designConcept": "设计理念（20-40字）",
      "prompt": "完整AI生图提示词（80-150字，描述画面构图、字形结构、笔画特征、材质、背景等）",
      "keywords": ["关键词1", "关键词2", "关键词3"],
      "suitableScenes": ["适用场景1", "适用场景2"]
    }
  ]
}

【提示词要求】
- 提示词必须包含：文字内容"${text}"、字体风格描述、构图描述、材质描述、背景描述
- 严格禁止出现：英文、拼音、乱码、多余文字、水印、重复字
- 文字必须清晰可读`;
}

function generateTemplatePlans(params: {
  text: string; scene: string; style: string; ratio: string;
  color: string; background: string; material: string;
  strokeOptions: string[]; graphicElements: string[];
}): unknown[] {
  const { text, scene, style, ratio, color, background, material, strokeOptions, graphicElements } = params;
  const strokeDesc = strokeOptions.length > 0 ? strokeOptions.join('、') : '标准笔画';
  const graphicDesc = graphicElements.length > 0 ? graphicElements.join('、') : '无';

  return [
    {
      title: `${style}\u00B7\u6781\u81F4\u98CE`,
      stylePositioning: `\u5C06${style}\u7684\u6838\u5FC3\u7279\u5F81\u53D1\u6325\u5230\u6781\u81F4`,
      designConcept: `\u6587\u5B57"${text}"\u91C7\u7528${style}\u98CE\u683C\u7684\u7ECF\u5178\u5F62\u6001\uFF0C\u7B14\u753B\u7ECF\u8FC7${strokeDesc}\u5904\u7406\uFF0C\u8D28\u611F\u4E3A${material}\uFF0C\u914D\u5408${background}\u80CC\u666F\u3002`,
      prompt: `\u4E2D\u6587\u5B57\u4F53\u8BBE\u8BA1\uFF0C\u6587\u5B57\u5185\u5BB9"${text}"\uFF0C${style}\u98CE\u683C\u6781\u81F4\u8868\u73B0\uFF0C\u5B57\u4F53\u5C45\u4E2D\uFF0C\u7B14\u753B${strokeDesc}\uFF0C\u56FE\u5F62\u878D\u5408${graphicDesc}\uFF0C\u989C\u8272${color}\uFF0C\u8D28\u611F${material}\uFF0C\u80CC\u666F${background}\uFF0C\u753B\u9762\u6BD4\u4F8B${ratio}\u3002\u53EA\u4FDD\u7559\u8FD9\u51E0\u4E2A\u4E2D\u6587\uFF0C\u4E0D\u8981\u82F1\u6587\u4E0D\u8981\u62FC\u97F3\u4E0D\u8981\u4E71\u7801\u4E0D\u8981\u91CD\u590D\u5B57\u3002`,
      keywords: [style, '\u6781\u81F4\u98CE', strokeDesc],
      suitableScenes: [scene],
    },
    {
      title: `${style}\u00B7\u521B\u610F\u878D`,
      stylePositioning: `\u5728${style}\u57FA\u7840\u4E0A\u878D\u5165\u521B\u610F\u5143\u7D20\u548C\u8DE8\u98CE\u683C\u6DF7\u642D`,
      designConcept: `\u6587\u5B57"${text}"\u5728${style}\u6846\u67B6\u5185\u878D\u5165\u521B\u610F\u8BBE\u8BA1\uFF0C${strokeDesc}\u5904\u7406\u7A81\u7834\u5E38\u89C4\uFF0C${graphicDesc}\u56FE\u5F62\u70B9\u7F00\uFF0C${material}\u8D28\u611F\u5347\u7EA7\u3002`,
      prompt: `\u4E2D\u6587\u5B57\u4F53\u8BBE\u8BA1\uFF0C\u6587\u5B57\u5185\u5BB9"${text}"\uFF0C${style}\u98CE\u683C\u521B\u610F\u878D\u5408\uFF0C\u5B57\u4F53\u5C45\u4E2D\uFF0C\u7B14\u753B${strokeDesc}\u5904\u7406\u7A81\u7834\u5E38\u89C4\uFF0C${graphicDesc}\u5143\u7D20\u81EA\u7136\u878D\u5165\uFF0C\u989C\u8272${color}\uFF0C\u8D28\u611F${material}\uFF0C\u80CC\u666F${background}\uFF0C\u753B\u9762\u6BD4\u4F8B${ratio}\u3002\u53EA\u4FDD\u7559\u8FD9\u51E0\u4E2A\u4E2D\u6587\uFF0C\u4E0D\u8981\u82F1\u6587\u4E0D\u8981\u62FC\u97F3\u4E0D\u8981\u4E71\u7801\u4E0D\u8981\u91CD\u590D\u5B57\u3002`,
      keywords: [style, '\u521B\u610F\u878D\u5408', '\u8DE8\u98CE\u683C'],
      suitableScenes: [scene, '\u521B\u610F\u8BBE\u8BA1'],
    },
    {
      title: `${style}\u00B7\u573A\u666F\u9002\u914D`,
      stylePositioning: `\u9488\u5BF9${scene}\u573A\u666F\u505A\u6700\u4F18\u5316\u8BBE\u8BA1`,
      designConcept: `\u6587\u5B57"${text}"\u4E3A${scene}\u573A\u666F\u91CF\u8EAB\u5B9A\u5236\uFF0C\u5B57\u5F62\u7ED3\u6784\u6E05\u6670\uFF0C\u7B14\u753B${strokeDesc}\uFF0C\u786E\u4FDD\u5B9E\u9645\u5E94\u7528\u6548\u679C\u6700\u4F73\u3002`,
      prompt: `\u4E2D\u6587\u5B57\u4F53\u8BBE\u8BA1\uFF0C\u6587\u5B57\u5185\u5BB9"${text}"\uFF0C\u4E3A${scene}\u573A\u666F\u91CF\u8EAB\u5B9A\u5236\uFF0C${style}\u98CE\u683C\uFF0C\u5B57\u4F53\u5C45\u4E2D\uFF0C\u7B14\u753B${strokeDesc}\uFF0C\u56FE\u5F62${graphicDesc}\uFF0C\u989C\u8272${color}\uFF0C\u8D28\u611F${material}\uFF0C\u80CC\u666F${background}\uFF0C\u753B\u9762\u6BD4\u4F8B${ratio}\u3002\u6587\u5B57\u6E05\u6670\u53EF\u8BFB\uFF0C\u53EA\u4FDD\u7559\u8FD9\u51E0\u4E2A\u4E2D\u6587\uFF0C\u4E0D\u8981\u82F1\u6587\u4E0D\u8981\u62FC\u97F3\u4E0D\u8981\u4E71\u7801\u4E0D\u8981\u91CD\u590D\u5B57\u3002`,
      keywords: [scene, style, '\u573A\u666F\u9002\u914D'],
      suitableScenes: [scene],
    },
  ];
}

export async function GET() {
  return NextResponse.json({
    styleCategories: FONT_STYLE_CATEGORIES,
    scenes: Object.entries(SCENE_MAP).map(([name, description]) => ({ id: name, name, description })),
    strokeOptions: Object.entries(STROKE_MAP).map(([name, description]) => ({ id: name, name, description })),
    graphicElements: Object.entries(GRAPHIC_MAP).map(([name, description]) => ({ id: name, name, description })),
    materials: Object.entries(MATERIAL_MAP).map(([name, description]) => ({ id: name, name, description })),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      text = '', scene = 'KV主标题', primaryStyleCategory = 'smart-recommend',
      secondaryStyle = '', ratio = '1:1', color = '白色', background = '纯色背景',
      strokeOptions = [], graphicElements = [], material = '平面矢量',
      jimengEnhanced = true,
    } = body;

    if (!text.trim()) {
      return NextResponse.json({ error: '请输入文字内容' }, { status: 400 });
    }

    const styleName = secondaryStyle || primaryStyleCategory;
    const planParams = { text, scene, style: styleName, ratio, color, background, material, strokeOptions, graphicElements };

    // Try LLM-generated plans first
    const provider = await findProviderForFeature('chat');
    if (provider?.apiKey) {
      try {
        const systemPrompt = buildSystemPrompt(planParams);
        const userPrompt = `请为文字"${text}"生成3个差异化的字体设计方案，场景：${scene}，风格：${styleName}`;

        const llmBody = {
          model: (provider.selectedModels as string[])?.[0] || 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.8,
          max_tokens: 4096,
          stream: false,
        };

        const response = await fetchWithV1Retry(provider.baseUrl, '/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify(llmBody),
        });

        if (!response.ok) {
          throw new Error(`LLM API returned ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || '';
        let responseText = '';

        if (contentType.includes('text/event-stream') || contentType.includes('stream')) {
          const rawText = await response.text();
          const sseResult = parseSSETextToJSON(rawText);
          responseText = sseResult || rawText;
        } else {
          // Try JSON first, fall back to SSE text parsing
          try {
            const data = await response.json() as Record<string, unknown>;
            const choices = data.choices as Record<string, unknown>[] | undefined;
            if (choices?.[0]) {
              const msg = choices[0].message as Record<string, unknown> | undefined;
              responseText = typeof msg?.content === 'string' ? msg.content : '';
            }
          } catch {
            // If JSON parse fails, treat as SSE text
            const rawText = await response.text();
            const sseResult = parseSSETextToJSON(rawText);
            responseText = sseResult || '';
          }
        }

        if (responseText) {
          const parsed = extractJSONFromText(responseText);
          if (parsed && typeof parsed === 'object' && 'plans' in (parsed as Record<string, unknown>)) {
            const planData = parsed as { plans: unknown[] };
            if (Array.isArray(planData.plans) && planData.plans.length > 0) {
              // Build prompt for each plan
              const jimengPrompt = buildJimengPrompt({
                text, scene, style: styleName, strokeOptions, graphicElements,
                color, background, material, ratio, jimengEnhanced,
              });
              return NextResponse.json({
                plans: planData.plans,
                prompt: jimengPrompt,
              });
            }
          }
        }
      } catch (e) {
        console.error('[font-design/plan] LLM generation failed, using templates:', e);
      }
    }

    // Fallback to template plans
    const plans = generateTemplatePlans(planParams);
    const jimengPrompt = buildJimengPrompt({
      text, scene, style: styleName, strokeOptions, graphicElements,
      color, background, material, ratio, jimengEnhanced,
    });

    return NextResponse.json({ plans, prompt: jimengPrompt });
  } catch (error) {
    console.error('[font-design/plan API] Error:', error);
    return NextResponse.json({ error: '生成方案失败' }, { status: 500 });
  }
}

