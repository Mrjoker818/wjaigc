import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, getApiProviders, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';

export const maxDuration = 60;

/**
 * Vision Prompt API - Image to bilingual prompt conversion
 * Syncs with user's current image model API provider
 * Converts image to base64 for API accessibility
 */

const VISION_SYSTEM_PROMPT = `You are an extremely rigorous visual analyst, cinematography analyst, and prompt engineer. Always produce highly detailed, visually grounded prompt output. Return valid JSON only and follow the requested schema exactly. Make zh.prompt and en.prompt richly detailed, production-ready, and information-dense while keeping the requested field order. Cover composition, lens language, spatial layout, subjects, objects, text, symbols, lighting, color, materials, background, environment, and generation constraints. Do not hallucinate. When uncertain, mark information as uncertain or approximate.

Analyze the provided image and return valid JSON only.

The JSON schema:
{
  "zh": {
    "title": "A concise Chinese title (5-15 characters) summarizing the image content",
    "prompt": "A highly detailed, production-ready Chinese image generation prompt, ordered as: Subject, Action/Pose, Details/Appearance, Environment/Background, Lighting/Atmosphere, Style/Camera, Colors, Materials, Aspect Ratio.",
    "analysis": "A compact Chinese explanation that covers the same fields, with extra attention on style and camera language."
  },
  "en": {
    "title": "A concise English title (3-10 words) summarizing the image content",
    "prompt": "A highly detailed, production-ready English image generation prompt, ordered as: Subject, Action/Pose, Details/Appearance, Environment/Background, Lighting/Atmosphere, Style/Camera, Colors, Materials, Aspect Ratio.",
    "analysis": "A compact English explanation that covers the same fields, with extra attention on style and camera language."
  },
  "zh_style_tags": ["中文标签1", "中文标签2", "中文标签3"],
  "en_style_tags": ["english tag 1", "english tag 2", "english tag 3"]
}

Rules:
- Return JSON only. No markdown fences.
- Keep prompts directly usable for Midjourney, DALL-E 3, Flux or SDXL style generation.
- zh.prompt and en.prompt should be highly detailed, information-dense, and still directly usable without extra rewriting.
- Be faithful to visually verifiable facts. Do not invent unseen objects, brands, text, camera specs, materials, art movements or lighting setups.
- Both zh.prompt and en.prompt must follow this exact information order:
  1. Subject
  2. Action/Pose
  3. Details/Appearance
  4. Environment/Background
  5. Lighting/Atmosphere
  6. Style/Camera
  7. Colors
  8. Materials
  9. Aspect Ratio
- Return 4 to 6 concise style tags in both Chinese and English.
- zh_style_tags must be Chinese. en_style_tags must be English.

Analyze this image and output bilingual prompt JSON.
Prioritize accurate visual grounding over creativity.
Keep zh.prompt and en.prompt highly detailed, richly descriptive, and directly usable.`;

/**
 * Convert image URL to base64 data URI for API accessibility
 */
async function imageUrlToBase64(imageUrl: string): Promise<string> {
  // Already a data URI
  if (imageUrl.startsWith('data:')) {
    return imageUrl;
  }

  try {
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn('[vision-prompt] Failed to fetch image for base64 conversion:', response.status);
      return imageUrl; // Fallback to original URL
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    console.warn('[vision-prompt] Failed to convert image to base64:', err);
    return imageUrl; // Fallback to original URL
  }
}

/**
 * Build the chat completions endpoint based on provider preset
 */
function buildChatEndpoint(baseUrl: string, _providerPreset?: string): string {
  const normalized = normalizeApiBaseUrl(baseUrl.replace(/\/+$/, ''));
  return `${normalized}/chat/completions`;
}

export async function POST(request: NextRequest) {
  try {
    const {
      imageUrl,
      model,
      providerId,
      providerPreset,
    } = await request.json();

    const sessionUser = await getSessionUser(request);

    if (!imageUrl) {
      return NextResponse.json({ error: '缺少图片URL' }, { status: 400 });
    }

    const resolvedModel = model?.includes('::') ? model.split('::').slice(1).join('::') : (model || '');
    const resolvedProviderId = providerId || (model?.includes('::') ? model.split('::')[0] : undefined);

    // Resolve API key and base URL from server-side provider config only
    let visionApiKey = process.env.APIMART_API_KEY || '';
    let visionBaseUrl = 'https://api.apimart.ai/v1';
    let visionModel = resolvedModel;
    let resolvedProviderPreset = providerPreset;

    if (resolvedProviderId) {
      const provider = (await getApiProviders()).find(item => item.id === resolvedProviderId && item.isEnabled);
      if (!provider) {
        return NextResponse.json({ error: 'Admin provider config not found' }, { status: 400 });
      }
      visionApiKey = provider.apiKey;
      let baseUrl = normalizeApiBaseUrl(provider.baseUrl);
      visionBaseUrl = baseUrl;
      resolvedProviderPreset = providerPreset || provider.providerPreset;
      if (!visionModel && provider.selectedModels?.length) {
        visionModel = provider.selectedModels[0];
      }
    } else if (visionModel) {
      const provider = await findProviderForModel(visionModel, 'chat');
      if (provider?.apiKey) {
        visionApiKey = provider.apiKey;
        visionBaseUrl = normalizeApiBaseUrl(provider.baseUrl);
        resolvedProviderPreset = providerPreset || provider.providerPreset;
      }
    }

    if (!visionApiKey) {
      return NextResponse.json({ error: 'Configure a vision or chat model in admin panel first' }, { status: 400 });
    }
    if (!visionModel) {
      return NextResponse.json(
        { error: '未指定视觉模型，请添加支持图片理解的模型（如GPT-4o、Gemini、Claude-3等）' },
        { status: 400 }
      );
    }

    // Convert image to base64 for API accessibility
    const imageBase64 = await imageUrlToBase64(imageUrl);
    const usingBase64 = imageBase64.startsWith('data:');
    console.log(`[vision-prompt] Using model: ${visionModel}, base64: ${usingBase64}, preset: ${resolvedProviderPreset}`);

    // Build the vision request with image content
    // Use OpenAI-compatible chat completions with vision capability
    const imageContent: { type: string; image_url?: { url: string }; text?: string } = {
      type: 'image_url',
      image_url: {
        url: imageBase64,
      },
    };

    const requestBody = {
      model: visionModel,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: VISION_SYSTEM_PROMPT,
            },
            imageContent,
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0.5,
      stream: false,
    };

    // Build the correct endpoint
    const endpoint = `${visionBaseUrl.replace(/\/+$/, '')}/chat/completions`;
    console.log(`[vision-prompt] Calling endpoint: ${endpoint}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${visionApiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(90000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[vision-prompt] API error:', response.status, errorText.substring(0, 500));

      // Provide more helpful error messages
      let errorMessage = `Vision API 调用失败: ${response.status}`;
      if (response.status === 503) {
        errorMessage = 'Vision API 暂时不可用 (503)，该模型可能不支持图片理解功能，请尝试切换到支持视觉的模型（如 GPT-4o、Gemini、Claude 等）';
      } else if (response.status === 401) {
        errorMessage = '?????? 无效，请检查配置';
      } else if (response.status === 400) {
        try {
          const errJson = JSON.parse(errorText);
          errorMessage = errJson.error?.message || errJson.message || errorMessage;
        } catch {}
      }

      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }

    // Handle both SSE stream and JSON responses
    const contentType = response.headers.get('content-type') || '';
    let data: Record<string, unknown>;

    if (contentType.includes('text/event-stream')) {
      // API returned SSE stream despite stream:false - read and extract last data event
      const text = await response.text();
      const lines = text.split('\n');
      let lastData = '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const payload = line.slice(6).trim();
          if (payload && payload !== '[DONE]') {
            lastData = payload;
          }
        }
      }
      if (!lastData) {
        return NextResponse.json(
          { error: 'API返回了空的流式响应' },
          { status: 502 }
        );
      }
      try {
        const parsed = JSON.parse(lastData) as Record<string, unknown>;
        data = (parsed.Response ? parsed.Response : parsed) as Record<string, unknown>;
      } catch {
        console.error('[vision-prompt] Failed to parse SSE data:', lastData.slice(0, 300));
        return NextResponse.json(
          { error: '解析流式响应失败' },
          { status: 502 }
        );
      }
    } else {
      // Standard JSON response
      try {
        const raw = await response.json() as Record<string, unknown>;
        data = (raw.Response ? raw.Response : raw) as Record<string, unknown>;
      } catch {
        console.error('[vision-prompt] Failed to parse JSON response');
        return NextResponse.json(
          { error: '解析API响应失败' },
          { status: 502 }
        );
      }
    }

    const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
    const content = choices?.[0]?.message?.content || '';

    // Try to parse JSON from the response
    let parsed: Record<string, unknown> | null = null;
    try {
      // Handle potential markdown code blocks
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      // If parsing fails, return raw content
      parsed = null;
    }

    return NextResponse.json({
      success: true,
      data: parsed || { raw: content },
      model: visionModel,
    });
  } catch (error) {
    console.error('[vision-prompt] Error:', error);
    return NextResponse.json(
      { error: `图片分析失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}
