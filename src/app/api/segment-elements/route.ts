import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';

/**
 * 编辑元素/分层 API - 根据图片元素进行智能分层
 * 使用管理员配置的分层模型 API
 */

interface SegmentRequest {
  imageUrl: string;
  mode?: 'auto' | 'semantic' | 'instance' | 'panoptic';
  model?: string;
}

export async function POST(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser(request);

    const body: SegmentRequest = await request.json();
    const { imageUrl, mode = 'auto' } = body;

    if (!imageUrl) {
      return NextResponse.json({ success: false, error: '缺少 imageUrl' }, { status: 400 });
    }

    // 查找管理员配置的分层模型 API
    const layerProvider = await findProviderForFeature('layer');
    if (!layerProvider) {
      return NextResponse.json({
        success: false,
        error: '未配置分层模型 API。请在管理员系统中添加分层模型 API。',
      }, { status: 400 });
    }

    const baseUrl = normalizeApiBaseUrl(layerProvider.baseUrl.replace(/\/+$/, ''));
    const selectedModels = layerProvider.selectedModels || [];
    const modelId = selectedModels[0] || body.model || 'default';

    // 调用分层模型 API
    const response = await fetch(`${baseUrl}/segment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${layerProvider.apiKey}`,
      },
      body: JSON.stringify({
        image_url: imageUrl,
        model: modelId,
        mode,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return NextResponse.json({
        success: false,
        error: `分层 API 调用失败 (${response.status}): ${errorText}`,
      }, { status: response.status });
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      layers: data.layers || data.segments || [],
      model: modelId,
      providerId: layerProvider.id,
    });
  } catch (error) {
    console.error('Segment elements error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '编辑元素失败',
    }, { status: 500 });
  }
}
