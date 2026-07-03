import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, getApiProviders, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { validateApiInputs } from '@/lib/api-validator';

export const maxDuration = 60;

/**
 * Vision Prompt API - Image to bilingual prompt conversion
 * Syncs with user's current image model API provider
 * Converts image to base64 for API accessibility
 */

const VISION_SYSTEM_PROMPT = `You are an extremely rigorous visual analyst, cinematography analyst, and prompt engineer. Always produce highly detailed, visually grounded prompt output for every supported model provider. Return valid JSON only and follow the requested schema exactly. Make zh.prompt and en.prompt richly detailed, production-ready, and information-dense while keeping the requested field order. Make json_prompt the most detailed layer of the output, using nested objects and arrays when useful, but prefer compact factual phrases over verbose prose. Cover composition, lens language, spatial layout, subjects, objects, text, symbols, lighting, color, materials, background, environment, and generation constraints. Do not hallucinate. When uncertain, mark information as uncertain or approximate.

You are also preparing bilingual prompt output for image generation.
Analyze the provided image and return valid JSON only.

The JSON schema:
{
  "zh": {
    "title": "A concise Chinese title (5-15 characters) summarizing the image content, e.g. '时尚女性肖像' or '城市夜景'.",
    "prompt": "A highly detailed, production-ready Chinese image generation prompt, ordered as: Subject, Action/Pose, Details/Appearance, Environment/Background, Lighting/Atmosphere, Style/Camera, Colors, Materials, Aspect Ratio.",
    "analysis": "A compact Chinese explanation that covers the same fields, with extra attention on style and camera language."
  },
  "en": {
    "title": "A concise English title (3-10 words) summarizing the image content, e.g. 'Fashion Portrait' or 'City Night Scene'.",
    "prompt": "A highly detailed, production-ready English image generation prompt, ordered as: Subject, Action/Pose, Details/Appearance, Environment/Background, Lighting/Atmosphere, Style/Camera, Colors, Materials, Aspect Ratio.",
    "analysis": "A compact English explanation that covers the same fields, with extra attention on style and camera language."
  },
  "zh_style_tags": ["中文标签1", "中文标签2", "中文标签3"],
  "en_style_tags": ["english tag 1", "english tag 2", "english tag 3"],
  "zh_json": {
    "主体": "Main subject in Chinese.",
    "动作姿态": "Action or pose in Chinese.",
    "细节外观": "Details, clothing, appearance, accessories or visible design details in Chinese.",
    "环境背景": "Environment or background in Chinese.",
    "光影氛围": "Lighting and atmosphere in Chinese.",
    "风格镜头": "Art style, design language, camera or lens feeling, and technical visual cues in Chinese.",
    "色彩": ["primary color in Chinese"],
    "材质": ["material 1 in Chinese"],
    "宽高比": "4:5"
  },
  "en_json": {
    "subject": "Main subject.",
    "action_pose": "Action or pose.",
    "details_appearance": "Details, clothing, appearance, accessories or visible design details.",
    "environment_background": "Environment or background.",
    "lighting_atmosphere": "Lighting and atmosphere.",
    "style_camera": "Art style, design language, camera or lens feeling, and technical visual cues.",
    "colors": ["primary color"],
    "materials": ["material 1"],
    "aspect_ratio": "4:5"
  },
  "json_prompt": {
    "subject": "Main subject.",
    "action_pose": "Action or pose.",
    "details_appearance": "Details, clothing, appearance, accessories or visible design details.",
    "environment_background": "Environment or background.",
    "lighting_atmosphere": "Lighting and atmosphere.",
    "style_camera": "Art style, design language, camera or lens feeling, and technical visual cues.",
    "colors": ["primary color"],
    "materials": ["material 1"],
    "aspect_ratio": "4:5"
  },
  "confidence": 0.0
}

Rules:
- Return JSON only. No markdown fences.
- Keep prompts directly usable for Midjourney, Flux or SDXL style generation.
- zh.prompt and en.prompt should be highly detailed, information-dense, and still directly usable without extra rewriting.
- Be faithful to visually verifiable facts. Do not invent unseen objects, brands, text, camera specs, materials, art movements or lighting setups.
- If something is uncertain, use broader wording instead of hallucinating specifics.
- zh_json must have ALL field names and values in Chinese (e.g., "主体", "动作姿态", "光影氛围").
- en_json must have ALL field names and values in English (e.g., "subject", "action_pose", "lighting_atmosphere").
- json_prompt is the legacy language-neutral format with English field names, keep for backward compatibility.
- json_prompt, zh_json, en_json can use nested objects and arrays, but prefer compact factual phrases instead of long prose.
- json_prompt must always preserve these exact top-level baseline keys: subject, action_pose, details_appearance, environment_background, lighting_atmosphere, style_camera, colors, materials, aspect_ratio
- zh_json must always preserve these exact Chinese top-level baseline keys: 主体, 动作姿态, 细节外观, 环境背景, 光影氛围, 风格镜头, 色彩, 材质, 宽高比
- en_json must always preserve these exact English top-level baseline keys: subject, action_pose, details_appearance, environment_background, lighting_atmosphere, style_camera, colors, materials, aspect_ratio
- Beyond those baseline keys, add only the extra fields that materially help reconstruction.
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
- The style/camera part should be richer than before: describe design language, era influence, medium, finish, camera angle, lens feel, framing logic and aesthetic cues when they are visually supported.
- The analysis should briefly explain all the same fields in natural language, and stay compact.
- Return 4 to 6 concise style tags in both Chinese and English.
- zh_style_tags must be Chinese. en_style_tags must be English.
- Confidence must be a number between 0 and 1.

Analyze this image and output bilingual prompt JSON.
Prioritize accurate visual grounding over creativity.
Keep zh.prompt and en.prompt highly detailed, richly descriptive, and directly usable.
Focus on: subject, action/pose, details/appearance, environment/background, lighting/atmosphere, style/camera, colors, materials and aspect ratio.
The zh_json, en_json, and json_prompt must preserve the baseline top-level keys while adding only the extra nested fields needed for faithful reconstruction.
Prefer compact phrases, compact arrays and compact nested objects over long natural-language paragraphs.`;

/**
 * Convert image URL to base64 data URI for API accessibility
 * Handles: data URIs, absolute URLs, and relative paths (/uploads/xxx.png)
 */
async function imageUrlToBase64(imageUrl: string): Promise<string> {
  // Already a data URI
  if (imageUrl.startsWith('data:')) {
    return imageUrl;
  }

  // Relative path (e.g., /uploads/xxx.png, /api/serve-upload/generate/img_xxx.png) — read from local filesystem
  if (imageUrl.startsWith('/')) {
    const fsSync = await import('fs');
    const fsPromises = fsSync.promises;
    const path = await import('path');
    const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';

    // Strip /api/serve-upload/ prefix to get the actual file sub-path
    // e.g., /api/serve-upload/generate/img_xxx.png → generate/img_xxx.png
    const strippedPath = imageUrl.replace(/^\/api\/serve-upload\//, '').replace(/^\//, '');

    // 1. Try local public directory
    const localPath = path.join(workspacePath, 'public', strippedPath);
    if (fsSync.existsSync(localPath)) {
      const buffer = await fsPromises.readFile(localPath);
      const ext = path.extname(localPath).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
      };
      const contentType = mimeMap[ext] || 'image/png';
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    }

    // 2. Try persistent data directory (DEV + PROD)
    try {
      const { getServerDataRoot } = await import('@/lib/server-data-root');
      const dataRoot = await getServerDataRoot();
      // Try multiple possible locations (matching serve-upload route logic)
      const possiblePaths = [
        path.join(dataRoot, strippedPath),              // dataRoot/generate/img_xxx.png
        path.join(dataRoot, 'uploads', strippedPath),   // dataRoot/uploads/generate/img_xxx.png
        path.join(workspacePath, 'public', 'uploads', path.basename(strippedPath)), // public/uploads/img_xxx.png
      ];
      for (const persistentPath of possiblePaths) {
        if (fsSync.existsSync(persistentPath)) {
          const buffer = await fsPromises.readFile(persistentPath);
          const ext = path.extname(persistentPath).toLowerCase();
          const mimeMap: Record<string, string> = {
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.webp': 'image/webp', '.gif': 'image/gif',
          };
          const contentType = mimeMap[ext] || 'image/png';
          return `data:${contentType};base64,${buffer.toString('base64')}`;
        }
      }
    } catch {}

    // 3. Try S3 object storage fallback
    try {
      const { isS3Available, downloadImageFromS3 } = await import('@/lib/s3-storage');
      if (isS3Available()) {
        const filename = strippedPath;
        for (const prefix of ['images/', 'uploads/', 'generate/', ''] ) {
          const s3Key = prefix ? `${prefix}${filename}` : filename;
          const s3Buffer = await downloadImageFromS3(s3Key);
          if (s3Buffer) {
            const ext = filename.split('.').pop()?.toLowerCase() || 'png';
            const mimeMap: Record<string, string> = {
              'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
              'webp': 'image/webp', 'gif': 'image/gif',
            };
            const contentType = mimeMap[ext] || 'image/png';
            return `data:${contentType};base64,${s3Buffer.toString('base64')}`;
          }
        }
      }
    } catch {}

    // 4. Try source URL mapping (re-download from original external URL)
    try {
      const filename = strippedPath;
      const { getImageSourceUrl } = await import('@/lib/image-source-map');
      const sourceUrl = await getImageSourceUrl(filename);
      if (sourceUrl) {
        console.log(`[vision-prompt] Re-downloading from source: ${sourceUrl.substring(0, 80)}...`);
        const srcRes = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
        if (srcRes.ok) {
          const arrayBuffer = await srcRes.arrayBuffer();
          const contentType = srcRes.headers.get('content-type') || 'image/png';
          const base64 = Buffer.from(arrayBuffer).toString('base64');
          return `data:${contentType};base64,${base64}`;
        }
      }
    } catch {}

    // 5. Last resort: try localhost fetch
    try {
      const absoluteUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}`;
      const response = await fetch(absoluteUrl, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const contentType = response.headers.get('content-type') || 'image/png';
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        return `data:${contentType};base64,${base64}`;
      }
    } catch {}

    console.error('[vision-prompt] Failed to resolve relative image path:', imageUrl);
    throw new Error(`无法解析图片路径: ${imageUrl}`);
  }

  // Absolute URL — fetch from remote
  try {
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn('[vision-prompt] Failed to fetch image for base64 conversion:', response.status);
      throw new Error(`获取图片失败: HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    console.error('[vision-prompt] Failed to convert image to base64:', err);
    throw new Error(`图片转换失败: ${err instanceof Error ? err.message : '未知错误'}`);
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
  let deductedCredits = 0;
  let sessionUser: any = null;
  try {
    const {
      imageUrl,
      model,
      providerId,
      providerPreset,
    } = await request.json();
    // 输入校验
    const _validationError = validateApiInputs({ imageUrl }, {
        imageUrl: 'imageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }


    sessionUser = await getSessionUser(request);

    if (!imageUrl) {
      return NextResponse.json({ error: '缺少图片URL' }, { status: 400 });
    }

    const resolvedModel = model?.includes('::') ? model.split('::').slice(1).join('::') : (model || '');
    const resolvedProviderId = providerId || (model?.includes('::') ? model.split('::')[0] : undefined);

    // 积分检查与扣除
    deductedCredits = 0;
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'chat', undefined, undefined, resolvedModel);
      if (!creditResult.success) {
        return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
    }

    // Resolve API key and base URL — use the user's selected chat model only (no VLM fallback)
    // Build candidate list: same model across different providers that have it
    interface VisionCandidate {
      apiKey: string;
      baseUrl: string;
      model: string;
      preset?: string;
      providerName: string;
    }
    const candidates: VisionCandidate[] = [];

    const allProviders = (await getApiProviders()).filter(p => p.isEnabled && p.baseUrl && p.apiKey);

    if (resolvedProviderId) {
      // User specified a provider — use it directly
      const provider = allProviders.find(item => item.id === resolvedProviderId);
      if (!provider) {
        return NextResponse.json({ error: 'Admin provider config not found' }, { status: 400 });
      }
      const m = resolvedModel || provider.selectedModels?.[0] || '';
      if (m) {
        candidates.push({
          apiKey: provider.apiKey,
          baseUrl: normalizeApiBaseUrl(provider.baseUrl),
          model: m,
          preset: providerPreset || provider.providerPreset,
          providerName: provider.name,
        });
      }
    } else if (resolvedModel) {
      // No providerId — find all providers that have this model (user's chat model)
      // Search across chat, vlm, and image types to find the right provider
      for (const provider of allProviders) {
        const models = provider.selectedModels || [];
        if (models.includes(resolvedModel)) {
          candidates.push({
            apiKey: provider.apiKey,
            baseUrl: normalizeApiBaseUrl(provider.baseUrl),
            model: resolvedModel,
            preset: provider.providerPreset,
            providerName: provider.name,
          });
        }
      }
      // If no provider has the exact model, fall back to findProviderForModel
      if (candidates.length === 0) {
        const provider = await findProviderForModel(resolvedModel, 'chat')
          || await findProviderForModel(resolvedModel, 'vlm')
          || await findProviderForModel(resolvedModel, 'image');
        if (provider?.apiKey) {
          candidates.push({
            apiKey: provider.apiKey,
            baseUrl: normalizeApiBaseUrl(provider.baseUrl),
            model: resolvedModel,
            preset: provider.providerPreset,
            providerName: provider.name,
          });
        }
      }
    }

    if (candidates.length === 0) {
      return NextResponse.json({ error: '请在聊天面板选择一个支持图片理解的模型（如 GPT-4o、Gemini、Claude 等）' }, { status: 400 });
    }

    console.log(`[vision-prompt] Using user's chat model: ${candidates.map(c => `${c.model}@${c.providerName}`).join(' → ')}`);

    // Convert image to base64 for API accessibility (once, shared across candidates)
    const imageBase64 = await imageUrlToBase64(imageUrl);
    const usingBase64 = imageBase64.startsWith('data:');

    // Build the vision request with image content
    const imageContent: { type: string; image_url?: { url: string }; text?: string } = {
      type: 'image_url',
      image_url: {
        url: imageBase64,
      },
    };

    // Try each candidate provider in order until one succeeds
    let lastError: string | null = null;
    let lastStatus = 500;

    for (const candidate of candidates) {
      const { apiModelName: effectiveModel } = normalizeModelForApi(candidate.model);
      if (effectiveModel !== candidate.model) {
        console.log(`[vision-prompt] Model normalized: ${candidate.model} → ${effectiveModel}`);
      }
      console.log(`[vision-prompt] Trying model: ${candidate.model} (${effectiveModel}) @ ${candidate.providerName}, base64: ${usingBase64}`);

      const requestBody = {
        model: effectiveModel,
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

      try {
        console.log(`[vision-prompt] Calling endpoint with base: ${candidate.baseUrl}`);

        const response = await fetchWithV1Retry(
          candidate.baseUrl,
          '/chat/completions',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${candidate.apiKey}`,
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(90000),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[vision-prompt] Candidate ${candidate.model}@${candidate.providerName} failed: ${response.status} ${errorText.substring(0, 300)}`);

          lastStatus = response.status;
          // Build error message
          if (response.status === 503) {
            lastError = 'Vision API 暂时不可用 (503)，该模型可能不支持图片理解功能，请尝试切换到支持视觉的模型（如 GPT-4o、Gemini、Claude 等）';
          } else if (response.status === 401) {
            lastError = 'API Key 无效，请检查配置';
          } else if (response.status === 400) {
            try {
              const errJson = JSON.parse(errorText);
              const rawMsg = errJson.error?.message || errJson.message || '';
              if (rawMsg) {
                const lowerMsg = rawMsg.toLowerCase();
                if (lowerMsg.includes('try again later') || lowerMsg.includes('please wait')) {
                  lastError = '当前模型暂时不可用，请稍后重试';
                } else if (lowerMsg.includes('invalid api key') || lowerMsg.includes('invalid api_key')) {
                  lastError = 'API 密钥无效，请检查配置';
                } else if (/^[a-zA-Z]/.test(rawMsg) && !/[\u4e00-\u9fff]/.test(rawMsg)) {
                  lastError = `API 返回错误: ${rawMsg}`;
                } else {
                  lastError = rawMsg;
                }
              }
            } catch {}
          } else if (response.status === 404) {
            lastError = `模型 ${candidate.model} 在提供商 ${candidate.providerName} 中不可用`;
          } else {
            lastError = `Vision API 调用失败: ${response.status}`;
          }
          continue; // Try next candidate
        }

        // Handle both SSE stream and JSON responses
        const contentType = response.headers.get('content-type') || '';
        let data: Record<string, unknown>;

        if (contentType.includes('text/event-stream')) {
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
            lastError = 'API返回了空的流式响应';
            lastStatus = 502;
            continue;
          }
          try {
            const parsed = JSON.parse(lastData) as Record<string, unknown>;
            data = (parsed.Response ? parsed.Response : parsed) as Record<string, unknown>;
          } catch {
            lastError = '解析流式响应失败';
            lastStatus = 502;
            continue;
          }
        } else {
          try {
            const raw = await response.json() as Record<string, unknown>;
            data = (raw.Response ? raw.Response : raw) as Record<string, unknown>;
          } catch {
            lastError = '解析API响应失败';
            lastStatus = 502;
            continue;
          }
        }

        const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
        const content = choices?.[0]?.message?.content || '';

        // Try to parse JSON from the response
        let parsed: Record<string, unknown> | null = null;
        try {
          const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          parsed = JSON.parse(jsonStr);
        } catch {
          parsed = null;
        }

        console.log(`[vision-prompt] Success with ${candidate.model}@${candidate.providerName}`);
        return NextResponse.json({
          success: true,
          data: parsed || { raw: content },
          model: candidate.model,
        });
      } catch (fetchErr) {
        console.error(`[vision-prompt] Candidate ${candidate.model}@${candidate.providerName} fetch error:`, fetchErr);
        lastError = `请求失败: ${fetchErr instanceof Error ? fetchErr.message : '网络错误'}`;
        lastStatus = 503;
        continue;
      }
    }

    // All candidates failed
    console.error(`[vision-prompt] All ${candidates.length} candidate(s) failed. Last error: ${lastError}`);
    return NextResponse.json(
      { error: lastError || '所有视觉模型提供商均不可用，请检查管理员面板配置' },
      { status: lastStatus }
    );
  } catch (error) {
    console.error('[vision-prompt] Error:', error);
    // 退款：图片识词失败时退还积分
    if (deductedCredits > 0 && sessionUser) {
      try {
        await refundCredits(sessionUser.id, deductedCredits, `图片识词失败退款: ${(error instanceof Error ? error.message : 'Unknown').substring(0, 100)}`);
      } catch (refundErr) { console.error('[vision-prompt] Refund failed:', refundErr); }
    }
    return NextResponse.json(
      { error: `图片分析失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}
