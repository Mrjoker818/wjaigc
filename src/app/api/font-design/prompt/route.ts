import { NextRequest, NextResponse } from 'next/server';
import { validateApiInputs } from '@/lib/api-validator';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  buildJimengPrompt, buildBlackOnWhitePrompt, buildTransparentLogoPrompt,
  SCENE_MAP,
} from '../plan/constants';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;
  try {
    const body = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body, {
        prompt: 'prompt'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const {
      text, scene, primaryStyleCategory, secondaryStyle,
      ratio = '横版16:9', color = '白色', background = '高级留白',
      strokeOptions = [], graphicElements = [], material = '平面矢量',
      jimengEnhanced = true, mode = 'full',
    } = body;

    if (!text?.trim()) {
      return NextResponse.json({ error: '请输入要设计的中文文字' }, { status: 400 });
    }

    const styleName = secondaryStyle || primaryStyleCategory || '智能推荐';

    if (mode === 'black-on-white') {
      return NextResponse.json({ prompt: buildBlackOnWhitePrompt(text), mode: 'black-on-white' });
    }
    if (mode === 'transparent-logo') {
      return NextResponse.json({ prompt: buildTransparentLogoPrompt(text), mode: 'transparent-logo' });
    }

    const fullPrompt = buildJimengPrompt({
      text, scene, style: styleName,
      strokeOptions, graphicElements, color, background, material, ratio, jimengEnhanced,
    });
    const enhancedPrompt = buildJimengPrompt({
      text, scene, style: styleName,
      strokeOptions, graphicElements, color, background, material, ratio, jimengEnhanced: true,
    });
    const sceneDesc = SCENE_MAP[scene] || scene;
    const strokeDesc = strokeOptions.length > 0 ? strokeOptions.join('、') : '自然笔画';
    const shortPrompt = `中文字体设计，"${text}"，${styleName}风格，${sceneDesc}，${color}，${background}，${strokeDesc}，${ratio}。只保留这几个中文，不要英文拼音乱码，文字清晰可读。`;

    return NextResponse.json({
      prompt: fullPrompt,
      shortPrompt,
      enhancedPrompt,
      blackOnWhitePrompt: buildBlackOnWhitePrompt(text),
      transparentLogoPrompt: buildTransparentLogoPrompt(text),
      mode: 'full',
    });
  } catch (error: unknown) {
    console.error('[font-design/prompt] Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '生成提示词失败' }, { status: 500 });
  }
}
