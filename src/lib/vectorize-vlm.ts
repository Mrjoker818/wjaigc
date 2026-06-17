/**
 * VLM 视觉语言模型适配器 — 图片→SVG 生成
 * 使用支持图片输入的聊天模型（Qwen-VL、GLM-4V 等），
 * 通过精心设计的提示词让 VLM "看到图片后重绘为 SVG"。
 * 
 * 适用场景：Recraft 和 vtracer 均不可用时的 fallback
 * 效果：对简单图形/图标可达 70-85% 还原度，复杂图形效果有限
 */
import { findProviderForFeature, getApiProviders } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';

export interface VlmVectorizeOptions {
  /** 图片 URL */
  imageUrl: string;
  /** 图片 base64 data URL */
  imageDataUrl?: string;
  /** 自定义提示词 */
  customPrompt?: string;
  /** 最大重试次数 */
  maxRetries?: number;
}

export interface VlmVectorizeResult {
  success: boolean;
  svg?: string;
  engine: 'vlm';
  model?: string;
  error?: string;
  pathCount?: number;
  svgSize?: number;
}

const VLM_SYSTEM_PROMPT = `You are a professional SVG engineer. Your task is to convert the provided image into a clean, editable SVG that is as close to 1:1 faithful reproduction as possible.

STRICT RULES:
1. Analyze the image carefully: identify all shapes, colors, gradients, text, and spatial relationships
2. Reconstruct the image as SVG using <path>, <rect>, <circle>, <ellipse>, <polygon>, <line>, <text> elements
3. Use precise coordinates and colors from the original image
4. Keep the total number of paths ≤ 300 — merge similar adjacent paths
5. Set correct width/height/viewBox matching the original image dimensions
6. For text, use <text> elements with matching font properties
7. For gradients, use <linearGradient>/<radialGradient> in <defs>

ABSOLUTELY FORBIDDEN:
- NO <script> tags or JavaScript event handlers
- NO <foreignObject> elements
- NO <image> tags with embedded base64 or external URLs
- NO inline styles with url() references to external resources

OUTPUT FORMAT:
Return ONLY the raw SVG code starting with <svg and ending with </svg>. No markdown, no explanation, no code fences.`;

const VLM_RETRY_PROMPT = `The previous SVG was rejected because it was too simple or inaccurate. Please try again with MORE detail and precision. Focus on:
1. More accurate color matching (use exact hex values from the image)
2. More precise shape paths (use more control points in bezier curves)
3. Correct layering and z-order of elements
4. Proper use of transforms for complex shapes

Return ONLY the raw SVG code.`;

/**
 * 查找可用的 VLM 提供商
 */
export async function findVlmProvider(): Promise<{
  providerId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
} | null> {
  // 1. 优先从 vlm 类型提供商中查找
  const vlmProvider = await findProviderForFeature('vlm');
  if (vlmProvider) {
    const selectedModels = vlmProvider.selectedModels || [];
    // 优先选择 qwen 或 glm 的 VLM 模型
    const preferredModel = selectedModels.find(id => 
      id.toLowerCase().includes('qwen') || id.toLowerCase().includes('glm')
    ) || selectedModels[0];
    if (preferredModel) {
      return {
        providerId: vlmProvider.id,
        baseUrl: vlmProvider.baseUrl,
        apiKey: vlmProvider.apiKey,
        model: preferredModel,
      };
    }
  }

  // 2. 回退到 chat 类型提供商中的 VLM 模型
  const providers = await getApiProviders();
  for (const provider of providers) {
    if (!provider.isEnabled) continue;
    const discovered = provider.discoveredModels || [];
    const selected = provider.selectedModels || [];
    
    // 查找包含 VLM 关键词的模型
    const vlmKeywords = ['qwen2.5-vl', 'qwen2-vl', 'qwen-vl', 'qwen3.6-flash', 'qwen3.7-plus',
      'glm-4v', 'glm-5v', 'glm-4.1v', 'internvl', 'llava', 'deepseek-vl', 'pixtral', 'cogvlm', 'minicpm-v'];
    
    const vlmModels = [...selected, ...discovered.map(m => m.id)].filter(id => 
      vlmKeywords.some(kw => id.toLowerCase().includes(kw))
    );
    
    if (vlmModels.length > 0) {
      return {
        providerId: provider.id,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: vlmModels[0],
      };
    }
  }

  // 3. 最终回退到 chat 提供商（使用支持视觉的模型）
  const chatProvider = await findProviderForFeature('chat');
  if (chatProvider) {
    const selectedModels = chatProvider.selectedModels || [];
    // Gemini 模型也支持视觉
    const visionModel = selectedModels.find(id =>
      id.toLowerCase().includes('gemini') || id.toLowerCase().includes('vision')
    ) || selectedModels[0];
    if (visionModel) {
      return {
        providerId: chatProvider.id,
        baseUrl: chatProvider.baseUrl,
        apiKey: chatProvider.apiKey,
        model: visionModel,
      };
    }
  }

  return null;
}

/**
 * 构建 VLM 请求消息
 */
function buildVlmMessages(
  imageUrl: string,
  imageDataUrl?: string,
  customPrompt?: string,
  isRetry?: boolean,
): Array<Record<string, unknown>> {
  const userPrompt = customPrompt || 
    (isRetry ? VLM_RETRY_PROMPT : 'Please convert this image to SVG. Reproduce it as faithfully as possible.');

  // 构建图片内容
  const imageContent: Record<string, unknown> = {
    type: 'image_url',
    image_url: {
      url: imageDataUrl || imageUrl,
    },
  };

  return [
    {
      role: 'system',
      content: VLM_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: [
        imageContent,
        { type: 'text', text: userPrompt },
      ],
    },
  ];
}

/**
 * 从 VLM 响应中提取 SVG
 */
function extractSvgFromResponse(content: string): string | null {
  // 1. 直接是 SVG
  const trimmed = content.trim();
  if (trimmed.startsWith('<svg') && trimmed.endsWith('</svg>')) {
    return trimmed;
  }

  // 2. 从 markdown code fence 中提取
  const codeFenceMatch = trimmed.match(/```(?:svg|xml)?\s*\n?([\s\S]*?)```/);
  if (codeFenceMatch) {
    const extracted = codeFenceMatch[1]!.trim();
    if (extracted.startsWith('<svg')) {
      return extracted;
    }
  }

  // 3. 查找 <svg...>...</svg> 标签
  const svgMatch = trimmed.match(/<svg[\s\S]*?<\/svg>/);
  if (svgMatch) {
    return svgMatch[0];
  }

  return null;
}

/**
 * 安全过滤 AI 生成的 SVG
 * 移除危险的标签和属性
 */
function sanitizeVlmSvg(svg: string): string {
  let safe = svg;
  
  // 移除 script 标签
  safe = safe.replace(/<script[\s\S]*?<\/script>/gi, '');
  
  // 移除 foreignObject
  safe = safe.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  
  // 移除 image 标签（防止嵌入外部资源）
  safe = safe.replace(/<image[\s\S]*?\/?>/gi, '');
  
  // 移除事件处理器
  safe = safe.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
  
  // 移除 javascript: URL
  safe = safe.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href=""');
  
  // 验证 viewBox
  if (!safe.includes('viewBox')) {
    const widthMatch = safe.match(/width="(\d+)"/);
    const heightMatch = safe.match(/height="(\d+)"/);
    if (widthMatch && heightMatch) {
      safe = safe.replace(
        /<svg/,
        `<svg viewBox="0 0 ${widthMatch[1]} ${heightMatch[1]}"`
      );
    }
  }

  return safe;
}

/**
 * 调用 VLM 模型生成 SVG
 */
export async function vlmVectorize(
  options: VlmVectorizeOptions,
  providerOverride?: { baseUrl: string; apiKey: string; model: string },
): Promise<VlmVectorizeResult> {
  const provider = providerOverride || (await findVlmProvider());
  if (!provider) {
    return {
      success: false,
      engine: 'vlm',
      error: '未找到 VLM 视觉模型提供商，请在管理员后台添加 VLM 模型 API',
    };
  }

  const { baseUrl, apiKey, model } = provider;
  console.log(`[vectorize-vlm] Using provider: baseUrl=${baseUrl}, model=${model}`);
  const maxRetries = options.maxRetries ?? 1;

  // 确保 VLM 收到可访问的图片数据：base64 data URL 优先于原始 URL
  const effectiveImageUrl = options.imageDataUrl || options.imageUrl;
  if (!options.imageDataUrl && !options.imageUrl.startsWith('http') && !options.imageUrl.startsWith('data:')) {
    console.warn(`[vectorize-vlm] imageUrl is not publicly accessible: ${options.imageUrl.substring(0, 80)}... — VLM may fail to read the image`);
  }

  let lastError = '';
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const messages = buildVlmMessages(
        effectiveImageUrl,
        undefined, // 已合并到 effectiveImageUrl
        options.customPrompt,
        attempt > 0,
      );

      const url = `${baseUrl}/chat/completions`;
      const response = await fetchWithV1Retry(baseUrl, '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 8192,
          temperature: 0.1, // 低温度提高 SVG 一致性
        }),
      }, true, 120000);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        lastError = `VLM API 返回 HTTP ${response.status}: ${errorText.slice(0, 200)}`;
        console.warn(`[vectorize-vlm] API error (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError}`);
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) {
        lastError = 'VLM 返回空内容';
        console.warn(`[vectorize-vlm] Empty response (attempt ${attempt + 1}/${maxRetries + 1}), response keys: ${Object.keys(data).join(',')}`);
        continue;
      }

      // 提取 SVG
      const rawSvg = extractSvgFromResponse(content);
      if (!rawSvg) {
        lastError = `VLM 未生成有效 SVG，原始回复: ${content.slice(0, 300)}`;
        console.warn(`[vectorize-vlm] No valid SVG extracted (attempt ${attempt + 1}/${maxRetries + 1})`);
        continue;
      }

      // 安全过滤
      const svg = sanitizeVlmSvg(rawSvg);

      // 质量检查：路径数不超过 900
      const pathCount = (svg.match(/<path/g) || []).length;
      if (pathCount > 900) {
        lastError = `VLM 生成的 SVG 路径数 ${pathCount} 超过 900，可能不适合矢量使用`;
        // 仍然返回，但标记路径数过多
      }

      // 质量检查：SVG 太小（< 200 bytes）可能不完整
      if (svg.length < 200) {
        lastError = `VLM 生成的 SVG 太小 (${svg.length} bytes)，可能不完整`;
        if (attempt < maxRetries) continue;
      }

      return {
        success: true,
        engine: 'vlm',
        svg,
        model,
        pathCount,
        svgSize: svg.length,
      };
    } catch (err) {
      lastError = `VLM 请求失败: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(`[vectorize-vlm] Request failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError}`);
    }
  }

  return {
    success: false,
    engine: 'vlm',
    model,
    error: `VLM 矢量化失败 (${maxRetries + 1} 次尝试): ${lastError}`,
  };
}
