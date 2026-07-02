import { NextRequest, NextResponse } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits, refundCredits } from '@/lib/credits';

export const runtime = 'nodejs';

/**
 * POST /api/analyze-psd
 * Uses AI vision to analyze an image and identify semantic layer structure
 * for PSD decomposition.
 *
 * Request body:
 *   image: string (data URL or HTTP URL of the image)
 *
 * Response:
 *   layers: Array of { name, role, description }
 *   backgroundColor: [r, g, b] estimated background color
 *   backgroundMode: suggested background removal mode
 */
export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  let deductedCredits = 0;
  let sessionUser: any = null;
  try {
    const { image } = await request.json();

    if (!image) {
      return NextResponse.json(
        { success: false, error: '缺少图片数据' },
        { status: 400 }
      );
    }

    // 积分检查与扣除
    deductedCredits = 0;
    sessionUser = await getSessionUser(request).catch(() => null);
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'segment');
      if (!creditResult.success) {
        return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    const analysisPrompt = `You are an expert image analyst specializing in Photoshop layer decomposition. Analyze this image and identify its semantic visual layers.

IMPORTANT: Respond ONLY with valid JSON, no markdown, no explanation outside JSON.

Return a JSON object with this exact structure:
{
  "backgroundColor": [R, G, B],
  "backgroundMode": "white" | "corner" | "color" | "white-preserve" | "none",
  "layers": [
    {
      "name": "descriptive layer name in English",
      "role": "bg" | "subject" | "text" | "deco" | "fx",
      "description": "brief description of what this element is"
    }
  ]
}

Rules:
1. "backgroundColor" should be the dominant background color as [R,G,B] (0-255).
2. "backgroundMode" selection:
   - "white" if the background is predominantly white/near-white
   - "white-preserve" if white background but has pale/light foreground objects
   - "corner" if background color is best determined from corners
   - "color" if the background is a solid or gradient non-white color
   - "none" if the image has no clear single background (e.g. complex scene)
3. First layer should ALWAYS be the background (role: "bg").
4. Identify the MAIN subject(s) as "subject" role layers.
5. Identify any visible TEXT as "text" role layers.
6. Identify decorative elements (shapes, borders, patterns, icons) as "deco" role layers.
7. Identify shadows, reflections, glow effects as "fx" role layers.
8. Keep layer count reasonable (3-8 layers). Don't over-split.
9. Each layer represents a SEMANTIC element, not a color region.
10. Layer names should be descriptive (e.g. "Main Product", "Title Text", "Decorative Stars").

Analyze the image now and return ONLY the JSON.`;

    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: analysisPrompt },
          {
            type: 'image_url' as const,
            image_url: {
              url: image,
              detail: 'high' as const,
            },
          },
        ],
      },
    ];

    const response = await client.invoke(messages, {
      model: 'doubao-seed-1-6-vision-250815',
      temperature: 0.3,
    });

    // Parse the AI response - extract JSON from potential markdown code blocks
    let jsonStr = response.content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    let analysis: Record<string, unknown>;
    try {
      analysis = JSON.parse(jsonStr);
    } catch {
      // If parsing fails, return a default analysis
      console.warn('Failed to parse AI layer analysis, using defaults:', jsonStr.substring(0, 200));
      analysis = {
        backgroundColor: [255, 255, 255],
        backgroundMode: 'white',
        layers: [
          { name: 'Background', role: 'bg', description: 'Image background' },
          { name: 'Main Subject', role: 'subject', description: 'Primary visual content' },
        ],
      };
    }

    return NextResponse.json({
      success: true,
      analysis,
    });
  } catch (error) {
    console.error('PSD layer analysis error:', error);
    // 退款：PSD分析失败时退还积分
    if (deductedCredits > 0 && sessionUser) {
      try {
        await refundCredits(sessionUser.id, deductedCredits, `PSD分析失败退款: ${(error instanceof Error ? error.message : 'Unknown').substring(0, 100)}`);
      } catch (refundErr) { console.error('[analyze-psd] Refund failed:', refundErr); }
    }
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '图片分析失败',
      },
      { status: 500 }
    );
  }
}
