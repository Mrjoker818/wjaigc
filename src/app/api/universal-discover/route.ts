import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { normalizeApiBaseUrl } from '@/lib/server-api-config';

// 获取第三方API支持的模型列表
export const dynamic = 'force-dynamic';

interface DiscoverRequest {
  apiKey: string;
  baseUrl: string;
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin session required' }, { status: 401 });
    }

    const { apiKey, baseUrl } = (await request.json()) as DiscoverRequest;

    if (!apiKey || !baseUrl) {
      return NextResponse.json({
        success: false,
        error: '缺少必要参数：apiKey, baseUrl',
      }, { status: 400 });
    }

    // 标准化baseUrl
    const normalizedUrl = normalizeApiBaseUrl(baseUrl);

    // 尝试获取模型列表
    const response = await fetch(`${normalizedUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000), // 15秒超时
    });

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        error: `API返回错误: ${response.status} ${response.statusText}`,
      }, { status: response.status });
    }

    const data = await response.json();

    // 解析模型列表 - OpenAI兼容格式
    const rawModels = data.data || data.models || [];
    const models = rawModels
      .filter((m: Record<string, unknown>) => {
        const id = (m.id as string || '').toLowerCase();
        // 过滤出图像生成模型
        return id.includes('image') ||
               id.includes('dall-e') ||
               id.includes('flux') ||
               id.includes('sd') ||
               id.includes('stable') ||
               id.includes('midjourney') ||
               id.includes('gemini') && id.includes('image') ||
               id.includes('imagen') ||
               id.includes('seedream') ||
               id.includes('qwen-image');
      })
      .map((m: Record<string, unknown>) => ({
        id: m.id as string,
        name: (m.id as string).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        owned_by: m.owned_by as string || 'unknown',
        type: 'image' as const,
      }));

    // 也获取文本模型（用于聊天）
    const chatModels = rawModels
      .filter((m: Record<string, unknown>) => {
        const id = (m.id as string || '').toLowerCase();
        return !id.includes('image') &&
               !id.includes('dall-e') &&
               !id.includes('flux') &&
               !id.includes('sd') &&
               !id.includes('stable') &&
               !id.includes('midjourney') &&
               !id.includes('imagen') &&
               !id.includes('seedream') &&
               !id.includes('qwen-image') &&
               (id.includes('gpt') ||
                id.includes('claude') ||
                id.includes('gemini') ||
                id.includes('llama') ||
                id.includes('qwen') ||
                id.includes('deepseek'));
      })
      .map((m: Record<string, unknown>) => ({
        id: m.id as string,
        name: (m.id as string).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        owned_by: m.owned_by as string || 'unknown',
        type: 'chat' as const,
      }));

    return NextResponse.json({
      success: true,
      imageModels: models,
      chatModels,
      totalModels: rawModels.length,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Universal Discover] 错误:', error);
    return NextResponse.json({
      success: false,
      error: `模型发现失败: ${message}`,
    }, { status: 500 });
  }
}
