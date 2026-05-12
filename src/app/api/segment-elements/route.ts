import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getServerDataRoot } from '@/lib/server-data-root';
import fsSync from 'fs';
import path from 'path';

/**
 * 编辑元素/分层 API - 根据图片元素进行智能分层
 * 使用管理员配置的分层模型 API (qwen-image-layered 等)
 * 
 * 支持 OpenAI 兼容的 chat-completions 接口格式
 * 图片通过 base64 传入，模型返回分层结果
 */

interface SegmentRequest {
  imageUrl: string;
  mode?: 'auto' | 'semantic' | 'instance' | 'panoptic';
  model?: string;
}

/**
 * Resolve an image URL to a base64 string for APIs that need image data.
 */
async function resolveImageToBase64(imageUrl: string): Promise<string | null> {
  try {
    // Data URL - extract base64 part
    if (imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:[^;]+;base64,(.+)$/);
      return match ? match[1] : null;
    }

    // Blob URL - cannot be resolved server-side
    if (imageUrl.startsWith('blob:')) {
      console.warn('[segment] Blob URLs cannot be resolved server-side');
      return null;
    }

    // Local path - read from filesystem
    if (imageUrl.startsWith('/')) {
      const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';

      // Try direct public path
      const localPath = path.join(workspacePath, 'public', imageUrl);
      if (fsSync.existsSync(localPath)) {
        return fsSync.readFileSync(localPath).toString('base64');
      }

      // /api/serve-upload/filename → search upload directories
      const serveUploadMatch = imageUrl.match(/^\/api\/serve-upload\/(.+)$/);
      if (serveUploadMatch) {
        const filename = serveUploadMatch[1];
        const dataRoot = getServerDataRoot();
        const uploadDirs = [
          path.join(dataRoot, 'uploads'),
          path.join(workspacePath, 'public', 'uploads'),
        ];
        for (const dir of uploadDirs) {
          const filePath = path.join(dir, filename);
          if (fsSync.existsSync(filePath)) {
            return fsSync.readFileSync(filePath).toString('base64');
          }
        }
      }

      // Fallback: fetch from localhost
      const fullUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}`;
      const response = await fetch(fullUrl, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        return buffer.toString('base64');
      }
      console.warn('[segment] Failed to fetch local image:', imageUrl);
      return null;
    }

    // External URL - fetch and convert
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString('base64');
  } catch (err) {
    console.warn('[segment] Could not resolve image to base64:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
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
        error: '未配置图片分层模型 API。请在管理员系统中添加图片分层模型 API。',
      }, { status: 400 });
    }

    const baseUrl = normalizeApiBaseUrl(layerProvider.baseUrl.replace(/\/+$/, ''));
    const selectedModels = layerProvider.selectedModels || [];
    const modelId = selectedModels[0] || body.model || 'qwen-image-layered';

    // Pre-resolve image to base64
    const imageBase64 = await resolveImageToBase64(imageUrl);

    // 构建图片内容
    const imageContent = imageBase64
      ? { type: 'image_url' as const, image_url: { url: `data:image/png;base64,${imageBase64}` } }
      : { type: 'image_url' as const, image_url: { url: imageUrl } };

    // 尝试 chat-completions 格式 (OpenAI Vision 兼容)
    // qwen-image-layered 等分层模型通过 chat-completions 接口调用
    const chatRequestBody = {
      model: modelId,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text' as const, text: `请对这张图片进行元素分层分析。识别并分离出各个独立元素（如主体、背景、装饰、文字等），返回分层结果。模式: ${mode}` },
            imageContent,
          ],
        },
      ],
      max_tokens: 4096,
    };

    try {
      const response = await fetchWithV1Retry(baseUrl, '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${layerProvider.apiKey}`,
        },
        body: JSON.stringify(chatRequestBody),
        signal: AbortSignal.timeout(60000),
      });

      if (response.ok) {
        const data = await response.json() as Record<string, unknown>;
        const choices = data.choices as Array<Record<string, unknown>> | undefined;
        if (choices && choices.length > 0) {
          const message = choices[0].message as Record<string, unknown> | undefined;
          const content = message?.content as string | undefined;

          if (content) {
            // 尝试从返回内容中解析分层结果
            // 模型可能返回 JSON 格式的分层结果或文本描述
            let layers: Array<Record<string, unknown>> = [];

            // 尝试解析 JSON
            try {
              const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\[[\s\S]*\]/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                if (Array.isArray(parsed)) {
                  layers = parsed;
                }
              }
            } catch {
              // JSON 解析失败，使用文本作为单层描述
            }

            // 如果没有解析到 JSON 分层结果，创建基于文本描述的分层
            if (layers.length === 0) {
              layers = [{
                name: '分析结果',
                description: content,
                type: 'text',
              }];
            }

            return NextResponse.json({
              success: true,
              layers,
              model: modelId,
              providerId: layerProvider.id,
              rawContent: content,
            });
          }
        }

        return NextResponse.json({
          success: true,
          layers: [],
          model: modelId,
          providerId: layerProvider.id,
          message: '模型返回了空结果',
        });
      }

      console.warn('[segment] chat-completions returned non-OK:', response.status);
    } catch (e) {
      console.warn('[segment] chat-completions failed:', e instanceof Error ? e.message : String(e));
    }

    // Fallback: 尝试 /segment 端点
    try {
      const segmentBody: Record<string, unknown> = {
        image_url: imageUrl,
        model: modelId,
        mode,
      };
      if (imageBase64) {
        segmentBody.image_base64 = imageBase64;
      }

      const response = await fetchWithV1Retry(baseUrl, '/segment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${layerProvider.apiKey}`,
        },
        body: JSON.stringify(segmentBody),
        signal: AbortSignal.timeout(60000),
      });

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json({
          success: true,
          layers: data.layers || data.segments || [],
          model: modelId,
          providerId: layerProvider.id,
        });
      }
    } catch (e) {
      console.warn('[segment] /segment endpoint failed:', e instanceof Error ? e.message : String(e));
    }

    return NextResponse.json({
      success: false,
      error: '分层模型 API 调用失败。请检查 API 配置是否正确。',
    }, { status: 500 });
  } catch (error) {
    console.error('Segment elements error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '编辑元素失败',
    }, { status: 500 });
  }
}
