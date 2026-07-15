/**
 * Recraft Vectorize 适配器 — 专业位图→矢量转换
 * 通过 Recraft API（可经 302.AI 等中转站调用）实现高质量矢量化
 * API 格式: POST {baseUrl}/recraft/v1/images/vectorize
 * 
 * 特点：
 * - 语义分组可编辑 SVG
 * - 精确路径（非机械描摹）
 * - 支持图形、图标、卡通吉祥物接近 1:1 还原
 */
import { findProviderForFeature, findProviderById, getApiProviders } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';

export interface RecraftVectorizeOptions {
  /** 图片 URL 或 data URL */
  imageUrl: string;
  /** 图片 buffer（如果 imageUrl 不可公网访问时使用） */
  imageBuffer?: Buffer;
  /** 输出格式，默认 svg */
  outputFormat?: 'svg' | 'eps' | 'pdf';
}

export interface RecraftVectorizeResult {
  success: boolean;
  svg?: string;
  engine: 'recraft';
  error?: string;
  /** SVG 路径数量 */
  pathCount?: number;
  /** SVG 文件大小 */
  svgSize?: number;
}

/**
 * 查找可用的 Recraft 矢量化提供商
 * 优先级：vectorize 类型中包含 recraft 模型的提供商
 */
export async function findRecraftProvider(): Promise<{
  providerId: string;
  baseUrl: string;
  apiKey: string;
} | null> {
  // 1. 优先从 vectorize 类型提供商中查找
  const vectorizeProvider = await findProviderForFeature('vectorize');
  if (vectorizeProvider) {
    const selectedModels = vectorizeProvider.selectedModels || [];
    const discoveredModels = vectorizeProvider.discoveredModels || [];
    const allModelIds = [...selectedModels, ...discoveredModels.map(m => m.id)];
    const hasRecraft = allModelIds.some(id => id.toLowerCase().includes('recraft'));
    if (hasRecraft) {
      return {
        providerId: vectorizeProvider.id,
        baseUrl: vectorizeProvider.baseUrl,
        apiKey: vectorizeProvider.apiKey,
      };
    }
    // 即使没有 recraft 模型，也尝试使用 vectorize 提供商的 Recraft 端点
    // 很多中转站（如 302.AI）的 Recraft 端点不需要特定模型名
    return {
      providerId: vectorizeProvider.id,
      baseUrl: vectorizeProvider.baseUrl,
      apiKey: vectorizeProvider.apiKey,
    };
  }

  // 2. 遍历所有提供商查找包含 recraft 模型的
  const providers = await getApiProviders();
  for (const provider of providers) {
    if (!provider.isEnabled) continue;
    const selectedModels = provider.selectedModels || [];
    const discoveredModels = provider.discoveredModels || [];
    const allModelIds = [...selectedModels, ...discoveredModels.map(m => m.id)];
    const hasRecraft = allModelIds.some(id => id.toLowerCase().includes('recraft'));
    if (hasRecraft || provider.modelType === 'vectorize') {
      return {
        providerId: provider.id,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
      };
    }
  }

  return null;
}

/**
 * 调用 Recraft Vectorize API
 * 
 * API 格式 (302.AI / Recraft 官方):
 * POST {baseUrl}/recraft/v1/images/vectorize
 * Content-Type: multipart/form-data
 * Body: image (file) + output_format (svg)
 * 
 * 也可以尝试:
 * POST {baseUrl}/v1/images/vectorize
 * POST {baseUrl}/recraft/v1/vectorize
 */
export async function recraftVectorize(
  options: RecraftVectorizeOptions,
  providerOverride?: { baseUrl: string; apiKey: string },
): Promise<RecraftVectorizeResult> {
  const provider = providerOverride || (await findRecraftProvider());
  if (!provider) {
    return {
      success: false,
      engine: 'recraft',
      error: '未找到 Recraft 矢量模型提供商，请在管理员后台添加矢量模型 API',
    };
  }

  const { baseUrl, apiKey } = provider;

  // 尝试多个端点路径
  const endpoints = [
    '/recraft/v1/images/vectorize',
    '/v1/images/vectorize',
    '/recraft/v1/vectorize',
    '/v1/recraft/vectorize',
  ];

  // 准备图片数据
  let imageBlob: Blob;
  if (options.imageBuffer) {
    imageBlob = new Blob([new Uint8Array(options.imageBuffer)], { type: 'image/png' });
  } else {
    // 下载图片
    try {
      const imageResponse = await fetchWithV1Retry(options.imageUrl, '', {}, true, 15000);
      if (!imageResponse.ok) {
        return { success: false, engine: 'recraft', error: `下载图片失败: HTTP ${imageResponse.status}` };
      }
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      imageBlob = new Blob([imageBuffer], { type: 'image/png' });
    } catch (err) {
      return { success: false, engine: 'recraft', error: `下载图片失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const outputFormat = options.outputFormat || 'svg';

  // 逐个尝试端点
  let lastError = '';
  for (const endpoint of endpoints) {
    try {
      const formData = new FormData();
      formData.append('image', imageBlob, 'image.png');
      formData.append('output_format', outputFormat);

      const url = `${baseUrl}${endpoint}`;
      const response = await fetchWithV1Retry(baseUrl, endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        body: formData,
      }, true, 60000);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        lastError = `端点 ${endpoint} 返回 HTTP ${response.status}: ${errorText.slice(0, 200)}`;
        continue; // 尝试下一个端点
      }

      const contentType = response.headers.get('content-type') || '';

      // 如果直接返回 SVG
      if (contentType.includes('svg') || contentType.includes('text/xml')) {
        const svg = await response.text();
        return {
          success: true,
          engine: 'recraft',
          svg,
          pathCount: (svg.match(/<path/g) || []).length,
          svgSize: svg.length,
        };
      }

      // 如果返回 JSON
      const data = await response.json();
      
      // Recraft API 可能返回多种格式
      // 格式1: { image: { svg: "..." } }
      if (data.image?.svg) {
        return {
          success: true,
          engine: 'recraft',
          svg: data.image.svg,
          pathCount: (data.image.svg.match(/<path/g) || []).length,
          svgSize: data.image.svg.length,
        };
      }

      // 格式2: { data: [{ svg: "..." }] } (OpenAI images 格式)
      if (data.data?.[0]?.svg) {
        return {
          success: true,
          engine: 'recraft',
          svg: data.data[0].svg,
          pathCount: (data.data[0].svg.match(/<path/g) || []).length,
          svgSize: data.data[0].svg.length,
        };
      }

      // 格式3: { svg: "..." } 直接返回
      if (data.svg) {
        return {
          success: true,
          engine: 'recraft',
          svg: data.svg,
          pathCount: (data.svg.match(/<path/g) || []).length,
          svgSize: data.svg.length,
        };
      }

      // 格式4: { url: "..." } 返回 SVG URL
      if (data.url || data.data?.[0]?.url) {
        const svgUrl = data.url || data.data[0].url;
        const svgResponse = await fetchWithV1Retry(svgUrl, '', {}, true, 15000);
        if (svgResponse.ok) {
          const svg = await svgResponse.text();
          return {
            success: true,
            engine: 'recraft',
            svg,
            pathCount: (svg.match(/<path/g) || []).length,
            svgSize: svg.length,
          };
        }
      }

      lastError = `端点 ${endpoint} 返回了无法解析的响应格式: ${JSON.stringify(data).slice(0, 300)}`;
    } catch (err) {
      lastError = `端点 ${endpoint} 请求失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return {
    success: false,
    engine: 'recraft',
    error: `所有 Recraft 端点均失败: ${lastError}`,
  };
}
