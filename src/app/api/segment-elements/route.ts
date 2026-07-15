import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { findProviderForFeature, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getServerDataRoot } from '@/lib/server-data-root';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits, refundCredits } from '@/lib/credits';
import fsSync from 'fs';
import path from 'path';
import { validateApiInputs } from '@/lib/api-validator';
import { logError, OP_ACTIONS } from '@/lib/op-log';

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
  engine?: 'auto' | 'ai' | 'local';
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
        return (await fsSync.promises.readFile(localPath)).toString('base64');
      }

      // Try dataRoot path (images stored via save-image API)
      const dataRoot = getServerDataRoot();
      const dataRootPath = path.join(dataRoot, imageUrl);
      if (fsSync.existsSync(dataRootPath)) {
        return (await fsSync.promises.readFile(dataRootPath)).toString('base64');
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
            return (await fsSync.promises.readFile(filePath)).toString('base64');
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

async function resolveImageBuffer(imageUrl: string): Promise<Buffer | null> {
  try {
    if (imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:[^;]+;base64,(.+)$/);
      return match ? Buffer.from(match[1], 'base64') : null;
    }
    if (imageUrl.startsWith('blob:')) return null;
    let url = imageUrl;
    if (imageUrl.startsWith('/')) {
      url = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}`;
    }
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    console.warn('[segment] Could not resolve image buffer:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let deductedCredits = 0;
  let sessionUser: Awaited<ReturnType<typeof getSessionUser>> = null;
  const selectedModel = '';
  const providerIdUsed = '';
  try {
    const body: SegmentRequest = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body as unknown as Record<string, unknown>, {
        imageUrl: 'imageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const { imageUrl, mode = 'auto', engine } = body;

    if (!imageUrl) {
      return NextResponse.json({ success: false, error: '缺少 imageUrl' }, { status: 400 });
    }

    // engine 参数：auto/ai/local（默认auto）
    const engineMode: 'auto' | 'ai' | 'local' =
      engine === 'local' || engine === 'ai' ? engine : 'auto';

    // 积分检查与扣除
    sessionUser = await getSessionUser(request);
    deductedCredits = 0;
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'segment');
      if (!creditResult.success) {
        return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
    }

    // 查找管理员配置的分层模型 API
    const layerProvider = engineMode !== 'local' ? await findProviderForFeature('layer') : null;
    if (engineMode === 'ai' && !layerProvider) {
      return NextResponse.json({
        success: false,
        error: '未配置图片分层模型 API。请在管理员系统中添加图片分层模型 API，或切换到自动/本地模式。',
      }, { status: 400 });
    }

    if (layerProvider) {

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
              engine: 'ai',
            });
          }
        }

        return NextResponse.json({
          success: true,
          layers: [],
          model: modelId,
          providerId: layerProvider.id,
          message: '模型返回了空结果',
          engine: 'ai',
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
          engine: 'ai',
        });
      }
    } catch (e) {
      console.warn('[segment] /segment endpoint failed:', e instanceof Error ? e.message : String(e));
    }

    // AI模式且AI路径全部失败：直接返回错误，不降级
    if (engineMode === 'ai') {
      return NextResponse.json({
        success: false,
        error: 'AI 元素分层失败，已配置的模型均不可用。请检查API密钥或切换到自动/本地模式。',
      }, { status: 502 });
    }
    } // end if (layerProvider)

    // ─── 本地连通域分层兜底（不依赖任何API） ───
    try {
      const sourceBuffer = await resolveImageBuffer(imageUrl);
      if (sourceBuffer && sourceBuffer.length > 0) {
        const { data, info } = await sharp(sourceBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const w = info.width, h = info.height;
        const visited = new Uint8Array(w * h);
        const localLayers: Array<{ id: number; name: string; bbox: [number, number, number, number]; pixelCount: number; dominantColor?: [number, number, number] }> = [];
        const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
        for (let sy = 0; sy < h; sy++) {
          for (let sx = 0; sx < w; sx++) {
            const si = (sy * w + sx);
            if (visited[si]) continue;
            const sIdx = si * 4;
            const a = data[sIdx + 3];
            if (a < 30) { visited[si] = 1; continue; }
            // BFS连通域
            const queue: [number, number][] = [[sx, sy]];
            visited[si] = 1;
            let minX = sx, maxX = sx, minY = sy, maxY = sy;
            let cnt = 0;
            let rSum = 0, gSum = 0, bSum = 0;
            while (queue.length) {
              const [cx, cy] = queue.shift()!;
              const cIdx = (cy * w + cx) * 4;
              cnt++;
              rSum += data[cIdx]; gSum += data[cIdx+1]; bSum += data[cIdx+2];
              if (cx < minX) minX = cx;
              if (cx > maxX) maxX = cx;
              if (cy < minY) minY = cy;
              if (cy > maxY) maxY = cy;
              for (const [dx, dy] of dirs) {
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                const ni = ny * w + nx;
                if (visited[ni]) continue;
                const nIdx = ni * 4;
                if (data[nIdx+3] < 30) { visited[ni] = 1; continue; }
                // 颜色差阈值判断
                const dr = data[cIdx] - data[nIdx];
                const dg = data[cIdx+1] - data[nIdx+1];
                const db = data[cIdx+2] - data[nIdx+2];
                if (dr*dr + dg*dg + db*db < 3200) { // ~颜色差 < 56
                  visited[ni] = 1;
                  queue.push([nx, ny]);
                }
              }
            }
            // 过滤噪声点（<0.1%总面积）
            if (cnt < (w * h) * 0.001) continue;
            localLayers.push({
              id: localLayers.length + 1,
              name: `元素 ${localLayers.length + 1}`,
              bbox: [minX, minY, maxX, maxY],
              pixelCount: cnt,
              dominantColor: [Math.round(rSum/cnt), Math.round(gSum/cnt), Math.round(bSum/cnt)],
            });
          }
        }
        // 按面积排序，取前10个
        localLayers.sort((a, b) => b.pixelCount - a.pixelCount);
        const topLayers = localLayers.slice(0, 10).map((l, i) => ({
          id: i + 1,
          name: i === 0 ? '主体/背景' : `元素 ${i + 1}`,
          type: 'local',
          bbox: { x: l.bbox[0], y: l.bbox[1], w: l.bbox[2] - l.bbox[0] + 1, h: l.bbox[3] - l.bbox[1] + 1 },
          pixelCount: l.pixelCount,
          dominantColor: l.dominantColor ? `rgb(${l.dominantColor[0]},${l.dominantColor[1]},${l.dominantColor[2]})` : undefined,
        }));
        return NextResponse.json({
          success: true,
          layers: topLayers,
          model: 'local-connected-component',
          providerId: 'local',
          engine: 'local',
          warning: layerProvider ? 'AI分层失败，已使用本地连通域分层' : undefined,
        });
      }
    } catch (localErr) {
      console.warn('[segment] local fallback failed:', localErr instanceof Error ? localErr.message : String(localErr));
    }

    return NextResponse.json({
      success: false,
      error: '元素分层失败：AI模型不可用，且本地兜底分层失败。',
    }, { status: 500 });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error('Segment elements error:', error);
    logError(OP_ACTIONS.IMAGE_SEGMENT, error, {
      userId: sessionUser?.id || 'unknown',
      userName: sessionUser?.name || 'unknown',
      model: selectedModel,
      providerId: providerIdUsed,
      durationMs,
      detail: `元素分层失败`,
    });
    // 退款：元素分层失败时退还积分
    if (deductedCredits > 0 && sessionUser) {
      try {
        await refundCredits(sessionUser.id, deductedCredits, `元素分层失败退款`);
      } catch (refundErr) { console.error('[segment-elements] Refund failed:', refundErr); }
    }
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '编辑元素失败',
    }, { status: 500 });
  }
}
