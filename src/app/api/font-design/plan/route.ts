import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { validateApiInputs } from '@/lib/api-validator';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  FONT_STYLE_CATEGORIES,
  GRAPHIC_MAP,
  MATERIAL_MAP,
  SCENE_MAP,
  STROKE_MAP,
  buildJimengPrompt,
} from './constants';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

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

  // Resolve style name to visual description from FONT_STYLE_CATEGORIES
  let styleVisualDesc = '';
  for (const cat of FONT_STYLE_CATEGORIES) {
    for (const sub of cat.subStyles) {
      if (sub.name === style || sub.id === style) {
        styleVisualDesc = sub.prompt;
        break;
      }
    }
    if (styleVisualDesc) break;
  }

  const styleLine = styleVisualDesc
    ? `${style}（${styleVisualDesc}）`
    : style;

  return `你是一位资深的中文字体设计创意总监。请根据以下用户需求，生成4个差异化的字体设计方案。

【用户需求】
- 文字内容："${text}"
- 使用场景：${scene}（${sceneDesc}）
- 字体风格：${styleLine}
- 画面比例：${ratio}
- 颜色偏好：${color}
- 背景要求：${background}
- 质感材质：${materialDesc}
- 笔画处理：${strokeDesc}
- 图形融合：${graphicDesc}

【重要：风格强制要求】
用户选择了"${style}"风格${styleVisualDesc ? `，其核心视觉特征是"${styleVisualDesc}"` : ''}。所有方案必须严格体现这一风格的核心视觉特征，每个方案的prompt中必须明确描述该风格特征如何在笔画、结构、造型中体现。绝对不能偏离或弱化这一风格。

【重要：差异化要求】
4个方案必须在风格方向上明确区分，不能雷同，每个方案走完全不同的设计路线：
- 方案A：侧重"风格强化"——将该风格的核心特征发挥到极致
- 方案B：侧重"创意融合"——在风格基础上融入创意元素或跨风格混搭
- 方案C：侧重"应用适配"——针对使用场景做最优化设计
- 方案D：侧重"反向突破"——在风格框架内做大胆创新，尝试出人意料的表现手法

【输出格式】JSON，严格遵循以下结构，每个字段都必须填写具体内容，不能为空：
{
  "plans": [
    {
      "title": "方案名称（4-8字，体现风格特色）",
      "stylePositioning": "风格定位（10-20字，概括这个方案的风格方向）",
      "recommendIndex": 5,
      "glyphFeatures": "字形特点（15-30字，描述字形结构、整体造型、视觉感受）",
      "strokeAdvice": "笔画处理（15-30字，描述笔画粗细、起笔收笔、转折处理）",
      "graphicFusion": "图形融合（15-30字，描述图形元素如何与文字结合）",
      "colorMaterial": "色彩质感（15-30字，描述配色方案、材质肌理、光影效果）",
      "applicableScene": "适用场景（10-20字，说明最适合的应用场景）",
      "prompt": "完整AI生图提示词（80-150字，必须包含：文字内容"${text}"、字体风格"${style}"的具体视觉特征描述、字形结构、笔画特征、构图描述、材质描述、背景描述。严格禁止出现：英文、拼音、乱码、多余文字、水印、重复字。文字必须清晰可读）",
      "keywords": ["关键词1", "关键词2", "关键词3"],
      "suitableScenes": ["适用场景1", "适用场景2"]
    }
  ]
}

【关键字段填写指引】
- glyphFeatures：具体描述字的外形，如"圆润饱满的膨胀造型，字形微微横向延展，视觉上软糯Q弹"
- strokeAdvice：具体描述笔画怎么处理，如"笔画端头圆钝加粗，转角处圆弧过渡，主笔画与副笔画对比鲜明"
- graphicFusion：具体描述图形怎么融合，如"气泡元素从字形内部自然生长，与笔画融为一体"
- colorMaterial：具体描述颜色和质感，如"糖果色渐变，表面光泽感强烈，呈现硅胶般的柔润质感"
- applicableScene：具体说明哪里最合适，如"休闲零食品牌包装、社交媒体美食内容封面"
- recommendIndex：推荐指数1-5，根据风格与用户需求的匹配度打分

【风格一致性要求】
所有方案的设计必须严格围绕"${style}"风格展开${styleVisualDesc ? `，核心视觉特征"${styleVisualDesc}"必须在每个方案中清晰可见` : ''}，不能偏离到其他不相关的风格。`;
}

function generateTemplatePlans(params: {
  text: string; scene: string; style: string; ratio: string;
  color: string; background: string; material: string;
  strokeOptions: string[]; graphicElements: string[];
}): unknown[] {
  const { text, scene, style, ratio, color, background, material, strokeOptions, graphicElements } = params;
  const strokeDesc = strokeOptions.length > 0 ? strokeOptions.join('、') : '标准笔画';
  const graphicDesc = graphicElements.length > 0 ? graphicElements.join('、') : '无';

  // Resolve style name to visual description
  let styleVisualDesc = '';
  for (const cat of FONT_STYLE_CATEGORIES) {
    for (const sub of cat.subStyles) {
      if (sub.name === style || sub.id === style) {
        styleVisualDesc = sub.prompt;
        break;
      }
    }
    if (styleVisualDesc) break;
  }
  const styleVisual = styleVisualDesc ? `（${styleVisualDesc}）` : '';

  return [
    {
      title: `${style}·极致风`,
      stylePositioning: `将${style}的核心特征发挥到极致`,
      recommendIndex: 5,
      glyphFeatures: `${style}经典字形，结构饱满稳定，视觉冲击力强，字形比例协调`,
      strokeAdvice: `笔画${strokeDesc}处理，起笔收笔干脆利落，转折处棱角分明`,
      graphicFusion: `${graphicDesc !== '无' ? graphicDesc + '元素与字形结构深度融合，增强视觉表现力' : '纯文字表现，以字形本身作为视觉焦点'}`,
      colorMaterial: `${color}为主色调，${material}质感，表面光滑细腻，${background}衬托`,
      applicableScene: `最适合${scene}场景，追求视觉震撼效果`,
      prompt: `中文字体设计，文字内容"${text}"，${style}风格极致表现${styleVisual}，字体居中，笔画${strokeDesc}，图形融合${graphicDesc}，颜色${color}，质感${material}，背景${background}，画面比例${ratio}。只保留这几个中文，不要英文不要拼音不要乱码不要重复字。`,
      keywords: [style, '极致风', strokeDesc],
      suitableScenes: [scene],
    },
    {
      title: `${style}·创意融`,
      stylePositioning: `在${style}基础上融入创意元素和跨风格混搭`,
      recommendIndex: 4,
      glyphFeatures: `${style}字形框架内大胆变形，结构灵动有趣，打破常规排列`,
      strokeAdvice: `笔画${strokeDesc}突破常规处理，粗细对比强烈，笔势流动自然`,
      graphicFusion: `${graphicDesc !== '无' ? graphicDesc + '元素创意点缀，与字形若即若离，增添层次感' : '以字形的解构重组作为创意表达'}`,
      colorMaterial: `${color}搭配对比色，${material}质感升级，光影层次丰富`,
      applicableScene: `适合${scene}及创意设计场景，追求独特个性表达`,
      prompt: `中文字体设计，文字内容"${text}"，${style}风格创意融合${styleVisual}，字体居中，笔画${strokeDesc}处理突破常规，${graphicDesc !== '自然' ? graphicDesc + '元素自然融入' : '字形解构创意表达'}，颜色${color}，质感${material}，背景${background}，画面比例${ratio}。只保留这几个中文，不要英文不要拼音不要乱码不要重复字。`,
      keywords: [style, '创意融合', '跨风格'],
      suitableScenes: [scene, '创意设计'],
    },
    {
      title: `${style}·场景适配`,
      stylePositioning: `针对${scene}场景做最优化设计`,
      recommendIndex: 3,
      glyphFeatures: `为${scene}量身定制的字形，结构清晰易读，视觉舒适度高`,
      strokeAdvice: `笔画${strokeDesc}适度处理，保证辨识度的同时兼顾美观`,
      graphicFusion: `${graphicDesc !== '无' ? graphicDesc + '元素适度运用，不喧宾夺主，服务于整体阅读体验' : '以纯净字形保证信息传达效率'}`,
      colorMaterial: `${color}配色和谐，${material}质感温润，适合长时间注视`,
      applicableScene: `专为${scene}场景设计，实用性与美观性兼顾`,
      prompt: `中文字体设计，文字内容"${text}"，为${scene}场景量身定制，${style}风格${styleVisual}，字体居中，笔画${strokeDesc}，图形${graphicDesc}，颜色${color}，质感${material}，背景${background}，画面比例${ratio}。文字清晰可读，只保留这几个中文，不要英文不要拼音不要乱码不要重复字。`,
      keywords: [scene, style, '场景适配'],
      suitableScenes: [scene],
    },
    {
      title: `${style}·反向突破`,
      stylePositioning: `在${style}框架内做大胆创新，出人意料的表现手法`,
      recommendIndex: 4,
      glyphFeatures: `${style}字形结构的颠覆性演绎，打破常规比例和排列，制造视觉惊喜`,
      strokeAdvice: `笔画${strokeDesc}处理反其道而行，粗细极反差或极统一，笔势出其不意`,
      graphicFusion: `${graphicDesc !== '无' ? graphicDesc + '元素以意想不到的方式介入，制造视觉冲突与张力' : '字形的极简或极繁处理，以反差创造记忆点'}`,
      colorMaterial: `${color}的非主流运用方式，${material}质感呈现实验性效果，突破审美惯性`,
      applicableScene: `适合${scene}及追求差异化的前卫场景，制造话题与记忆点`,
      prompt: `中文字体设计，文字内容"${text}"，${style}风格大胆突破${styleVisual}，字体居中，笔画${strokeDesc}反常规处理，${graphicDesc !== '无' ? graphicDesc + '元素制造视觉张力' : '字形极简极繁反差'}，颜色${color}非主流运用，质感${material}实验性，背景${background}，画面比例${ratio}。只保留这几个中文，不要英文不要拼音不要乱码不要重复字。`,
      keywords: [style, '反向突破', '前卫实验'],
      suitableScenes: [scene, '前卫设计', '差异化表达'],
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
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;
  try {
    const body = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body, {
        prompt: 'optionalPrompt'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

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
        const userPrompt = `请为文字"${text}"生成4个差异化的字体设计方案，场景：${scene}，风格：${styleName}`;

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

