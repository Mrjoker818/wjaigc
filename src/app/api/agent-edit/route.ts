import { NextRequest, NextResponse, after } from 'next/server';
import { findProviderForFeature, findProviderById, findProviderForModel } from '@/lib/server-api-config';
import type { ApiProviderConfig } from '@/lib/universal-api-types';
import { fetchWithV1Retry, getInternalApiUrl } from '@/lib/api-helpers';
import { optionalApiAuth } from '@/lib/api-auth';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile } from '@/lib/api-compatibility';
import { executeAgentLoop, getToolsForLLM, type AgentContext, type AgentResult } from '@/lib/agent-engine';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';
import { translateApiError } from '@/lib/api-error-translate';
export const runtime = 'nodejs';
export const maxDuration = 600;

// ─── 本地任务存储 ──────────────────────────────────────────────────
// 由于 Next.js dev 模式下不同路由的内存不共享，
// 在本文件内维护独立的任务状态存储，供 GET 查询使用
interface LocalTaskInfo {
  status: 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  label: string;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: number;
}

const localTaskStore = new Map<string, LocalTaskInfo>();

// 30 分钟自动清理过期任务
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of localTaskStore) {
      if (now - v.createdAt > 30 * 60 * 1000) localTaskStore.delete(k);
    }
  }, 60_000).unref?.();
}

/**
 * POST /api/agent-edit
 * Agent 编排编辑 — 智能选择工具，多轮编辑
 *
 * Body: {
 *   image: string,         // 图片 URL/data URL
 *   prompt: string,        // 用户指令
 *   maskDataUrl?: string,  // 蒙版
 *   model?: string,        // LLM 模型
 *   providerId?: string,   // API 提供商 ID
 *   maxRounds?: number,    // 最大执行轮次
 * }
 */
export async function POST(request: NextRequest) {
  try {
    await optionalApiAuth(request);

    const body = await request.json();
    const { image, prompt, maskDataUrl, model, providerId, maxRounds, imagePrompt, imageModel, imageProviderId } = body;

    if (!image || !prompt) {
      return NextResponse.json({ success: false, error: '缺少图片或描述' }, { status: 400 });
    }

    // Content safety check
    const safetyResult = checkPromptSafety(prompt);
    if (safetyResult.level === 'block') {
      return NextResponse.json({ success: false, error: safetyResult.reason }, { status: 400 });
    }
    if (safetyResult.level === 'warning') {
      logSafetyWarning(prompt, safetyResult);
    }

    // 生成任务 ID
    const taskId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 注册任务到本地存储
    localTaskStore.set(taskId, {
      status: 'processing',
      progress: 5,
      label: 'Agent 分析中',
      createdAt: Date.now(),
    });

    // 异步执行（后台处理）— 使用 after() 确保响应返回后 IIFE 仍可运行
    after(async () => {
      const EDIT_GLOBAL_TIMEOUT_MS = 5 * 60 * 1000;
      const timeout = setTimeout(() => {
        const task = localTaskStore.get(taskId);
        if (task && task.status === 'processing') {
          localTaskStore.set(taskId, { ...task, status: 'failed', error: '任务超时', progress: 100 });
        }
      }, EDIT_GLOBAL_TIMEOUT_MS);

      // 辅助函数：检查任务是否已被取消
      const isCancelled = () => {
        const task = localTaskStore.get(taskId);
        return !task || task.status === 'cancelled';
      };

      try {
        // 查找 LLM 提供商
        const chatProvider = await findProviderForFeature('chat');
        if (!chatProvider || isCancelled()) {
          if (!chatProvider) {
            localTaskStore.set(taskId, {
              status: 'failed', error: '未配置聊天模型，请在管理员面板添加 LLM 模型', progress: 100, label: '失败', createdAt: Date.now(),
            });
          }
          return;
        }

        const chatModel = chatProvider.selectedModels?.[0] || model || 'gpt-4o';

        // 构建 Agent 上下文
        const context: AgentContext = {
          taskId,
          userPrompt: prompt,
          imageUrl: image,
          imagePrompt: imagePrompt || '',
          maskDataUrl,
          model: chatModel,
          maxRounds: maxRounds || 5,
          currentRound: 0,
          contextHistory: [],
          onProgress: (info) => {
            if (isCancelled()) return;
            const task = localTaskStore.get(taskId);
            if (!task || task.status !== 'processing') return;
            const progress = Math.min(95, 10 + (info.round / (context.maxRounds || 5)) * 80);
            localTaskStore.set(taskId, {
              ...task,
              progress,
              label: `第${info.round}轮: ${info.step}${info.detail ? ' - ' + info.detail : ''}`,
            });
          },
        };

        // LLM 调用函数
        const llmCall = async (
          messages: Array<{ role: string; content: string }>,
          tools: ReturnType<typeof getToolsForLLM>
        ) => {
          const baseUrl = chatProvider.baseUrl.replace(/\/+$/, '');
          const headers: Record<string, string> = {
            'Authorization': `Bearer ${chatProvider.apiKey}`,
            'Content-Type': 'application/json',
          };

          // Apply advanced params
          if (Array.isArray(chatProvider.advancedParams)) {
            for (const p of chatProvider.advancedParams as Array<{ key?: string; value?: unknown }>) {
              if (p.key?.trim() && p.value !== undefined) {
                headers[p.key.trim()] = String(p.value);
              }
            }
          }

          const requestBody: Record<string, unknown> = {
            model: chatModel,
            messages,
            tools,
            tool_choice: 'auto',
            stream: false,
            max_tokens: 2048,
          };

          const resp = await fetchWithV1Retry(baseUrl, '/chat/completions', {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(60000),
          });

          if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`LLM API 返回 ${resp.status}: ${errText.slice(0, 200)}`);
          }

          // 检测响应类型：SSE 流式 vs JSON
          const contentType = resp.headers.get('content-type') || '';
          let data: Record<string, unknown>;

          if (contentType.includes('text/event-stream') || contentType.includes('text/stream')) {
            // API 返回了 SSE 流，需要解析流事件提取完整消息
            data = await parseSSEToJSON(resp);
          } else {
            // 标准 JSON 响应
            const text = await resp.text();
            // 兜底：文本以 "data: " 开头也按 SSE 处理
            if (text.startsWith('data: ')) {
              data = parseSSETextToJSON(text);
            } else {
              try {
                data = JSON.parse(text) as Record<string, unknown>;
              } catch {
                throw new Error(`LLM 响应解析失败: ${text.slice(0, 200)}`);
              }
            }
          }

          const choices = data.choices as Array<Record<string, unknown>> | undefined;
          const choice = choices?.[0];
          if (!choice) throw new Error('LLM 返回空响应');

          const message = choice.message as Record<string, unknown> | undefined;
          if (!message) throw new Error('LLM 返回无消息');

          // 解析 tool calls
          const toolCalls = (message.tool_calls as Array<Record<string, unknown>> | undefined)?.map(tc => {
            const fn = tc.function as Record<string, unknown>;
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(String(fn.arguments || '{}'));
            } catch { /* ignore */ }
            return {
              name: String(fn.name || ''),
              arguments: args,
            };
          });

          return {
            toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
            content: String(message.content || ''),
            finishReason: String(choice.finish_reason || ''),
          };
        };

        // 执行 Agent 循环
        const result: AgentResult = await executeAgentLoop(context, llmCall);

        // 实际执行所有图像编辑步骤（按轮次顺序）
        if (isCancelled()) return;

        let finalImageUrl = image;
        const allEditSteps = result.steps.filter(s => s.toolName === 'image_edit' && s.success);

        if (allEditSteps.length > 0) {
          // 逐步执行所有 image_edit 操作，每步使用上一步的结果
          for (let i = 0; i < allEditSteps.length; i++) {
            if (isCancelled()) break;
            const step = allEditSteps[i];
            const progressBase = Math.round(70 + (20 * i / allEditSteps.length));
            const task = localTaskStore.get(taskId);
            if (task) localTaskStore.set(taskId, { ...task, progress: progressBase, label: `执行图像编辑 (${i + 1}/${allEditSteps.length})...` });

            try {
              const editResult = await performImageEdit(
                finalImageUrl, // 使用上一步的结果（第一步用原图）
                String(step.params.prompt || prompt),
                i === 0 ? maskDataUrl : undefined, // 仅第一步使用用户蒙版
                imageModel,
                imageProviderId,
              );
              if (editResult.success && editResult.imageUrl) {
                finalImageUrl = editResult.imageUrl;
                // 更新步骤结果为实际编辑结果
                step.result = `编辑成功: ${String(step.params.prompt || prompt)}`;
              } else {
                step.result = `编辑失败: ${translateApiError(editResult.error || '未知错误')}`;
                step.success = false;
              }
            } catch (err) {
              console.error(`[agent-edit] Image edit step ${i + 1} failed:`, err);
              step.result = `编辑异常: ${err instanceof Error ? err.message : '未知错误'}`;
              step.success = false;
            }
          }
        }

        // 执行其他非 image_edit 工具的实际操作
        const otherSteps = result.steps.filter(s => s.toolName !== 'image_edit' && s.success);
        for (const step of otherSteps) {
          if (isCancelled()) break;
          try {
            if (step.toolName === 'upscale') {
              // 调用放大 API
              const task = localTaskStore.get(taskId);
              if (task) localTaskStore.set(taskId, { ...task, label: '执行无损放大...' });
              const upscaleResp = await fetch(getInternalApiUrl('/api/image/upscale'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl: finalImageUrl, scale: step.params.scale || '2', outputFormat: 'png' }),
              });
              const upscaleData = await upscaleResp.json();
              if (upscaleData.success && upscaleData.imageUrl) {
                finalImageUrl = upscaleData.imageUrl;
                step.result = '放大成功';
              }
            } else if (step.toolName === 'remove_background') {
              // 调用去背景 API
              const task = localTaskStore.get(taskId);
              if (task) localTaskStore.set(taskId, { ...task, label: '执行移除背景...' });
              const rbResp = await fetch(getInternalApiUrl('/api/image-edit'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl: finalImageUrl, action: 'removebg' }),
              });
              const rbData = await rbResp.json();
              if (rbData.success && rbData.imageUrl) {
                finalImageUrl = rbData.imageUrl;
                step.result = '移除背景成功';
              }
            } else if (step.toolName === 'svg_trace') {
              // 调用 SVG 描摹 API
              const task = localTaskStore.get(taskId);
              if (task) localTaskStore.set(taskId, { ...task, label: '执行SVG描摹...' });
              const svgResp = await fetch(getInternalApiUrl('/api/svg-trace'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl: finalImageUrl, mode: step.params.mode || 'color', quality: step.params.quality || 'balanced' }),
              });
              const svgData = await svgResp.json();
              if (svgData.success && svgData.svgDataUrl) {
                finalImageUrl = svgData.previewUrl || finalImageUrl;
                step.result = 'SVG描摹成功';
              }
            }
          } catch (err) {
            console.error(`[agent-edit] Tool ${step.toolName} execution failed:`, err);
            step.result = `执行失败: ${err instanceof Error ? err.message : '未知错误'}`;
            step.success = false;
          }
        }

        // 任务完成 - 如果已被取消则不覆盖状态
        if (isCancelled()) return;

        // 根据 Agent 结果决定任务状态
        if (result.success) {
          localTaskStore.set(taskId, {
            status: 'completed',
            progress: 100,
            label: '完成',
            result: {
              imageUrl: finalImageUrl,
              steps: result.steps,
              finalResponse: result.finalResponse,
            },
            createdAt: localTaskStore.get(taskId)?.createdAt || Date.now(),
          });
        } else {
          // Agent 执行失败（LLM 调用失败、工具执行失败等）
          localTaskStore.set(taskId, {
            status: 'failed',
            progress: 100,
            label: '失败',
            error: translateApiError(result.error || result.finalResponse || 'Agent 执行失败'),
            result: {
              imageUrl: finalImageUrl,
              steps: result.steps,
              finalResponse: result.finalResponse,
            },
            createdAt: localTaskStore.get(taskId)?.createdAt || Date.now(),
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : '未知错误';
        console.error('[agent-edit] Error:', errMsg);
        const task = localTaskStore.get(taskId);
        if (task && task.status === 'processing') {
          localTaskStore.set(taskId, { ...task, status: 'failed', error: translateApiError(errMsg), progress: 100 });
        }
      } finally {
        clearTimeout(timeout);
      }
    });

    // 立即返回 taskId
    return NextResponse.json({
      success: true,
      taskId,
      mode: 'agent',
    });
  } catch (err) {
    console.error('[agent-edit] POST error:', err);
    return NextResponse.json(
      { success: false, error: '请求处理失败' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/agent-edit
 * 获取支持的 Agent 工具列表 或 查询任务状态
 * 
 * 查询任务状态: /api/agent-edit?taskId=xxx
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');
  const action = searchParams.get('action');

  if (taskId && action === 'cancel') {
    // 取消任务
    const task = localTaskStore.get(taskId);
    if (task && task.status === 'processing') {
      localTaskStore.set(taskId, { ...task, status: 'cancelled', error: '任务已取消' });
      return NextResponse.json({ success: true, status: 'cancelled' });
    }
    return NextResponse.json({ success: false, error: '任务不存在或无法取消' });
  }

  if (taskId) {
    // 查询任务状态
    const task = localTaskStore.get(taskId);
    if (!task) {
      return NextResponse.json({
        success: false,
        status: 'not_found',
        error: '任务不存在或已过期',
        retryable: false,
      });
    }

    return NextResponse.json({
      success: task.status === 'completed',
      status: task.status,
      progress: task.progress,
      label: task.label,
      result: task.result,
      error: task.error,
    });
  }

  // 默认：获取工具列表
  const { getToolsForLLM: getTools } = await import('@/lib/agent-engine');
  return NextResponse.json({
    tools: getTools(),
  });
}

// ─── 实际图像编辑执行 ──────────────────────────────────────────────

async function performImageEdit(
  imageUrl: string,
  editPrompt: string,
  maskDataUrl: string | undefined,
  imageModelFromFrontend?: string,
  imageProviderIdFromFrontend?: string
): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
  // 优先使用前端传递的图像模型和提供商，遵循用户在图像生成面板的选择
  let imageProvider: ApiProvider | null = null;
  if (imageProviderIdFromFrontend) {
    imageProvider = await findProviderById(imageProviderIdFromFrontend);
  }
  if (!imageProvider && imageModelFromFrontend) {
    imageProvider = await findProviderForModel(imageModelFromFrontend, 'image');
  }
  if (!imageProvider) {
    // 兜底：查找图像编辑提供商
    imageProvider = await findProviderForFeature('imageEdit');
  }
  if (!imageProvider) {
    return { success: false, error: '未配置图像模型' };
  }

  const baseUrl = imageProvider.baseUrl?.replace(/\/+$/, '') || '';
  const apiKey = imageProvider.apiKey || '';
  const imageModel = imageModelFromFrontend || imageProvider.selectedModels?.[0] || '';

  if (!baseUrl || !apiKey || !imageModel) {
    return { success: false, error: '图像提供商配置不完整' };
  }

  // 使用 API 兼容层确定正确的端点
  const profile = resolveCompatProfile(provider);
  const resolvedEndpoint = profile.editEndpoint || '/images/edits';

  // Path A: 支持 /images/edits 端点的提供商（OpenAI 官方等）
  if (resolvedEndpoint === '/images/edits') {
    // OpenAI images/edits 路径
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
    };

    const formData = new FormData();
    formData.append('model', imageModel);
    formData.append('prompt', editPrompt);
    formData.append('n', '1');
    formData.append('size', '1024x1024');

    // 添加图片
    if (imageUrl.startsWith('data:')) {
      const blob = dataUrlToBlob(imageUrl);
      formData.append('image', blob, 'image.png');
    } else {
      const imgResp = await fetch(imageUrl);
      const imgBlob = await imgResp.blob();
      formData.append('image', imgBlob, 'image.png');
    }

    // 添加蒙版
    if (maskDataUrl?.startsWith('data:')) {
      const maskBlob = dataUrlToBlob(maskDataUrl);
      formData.append('mask', maskBlob, 'mask.png');
    }

    const resp = await fetchWithV1Retry(baseUrl, '/images/edits', {
      method: 'POST',
      headers,
      body: formData,
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { success: false, error: `OpenAI edit 失败 (${resp.status}): ${errText.slice(0, 200)}` };
    }

    const data = await resp.json() as Record<string, unknown>;
    const images = data.data as Array<Record<string, unknown>> | undefined;
    if (images && images.length > 0) {
      const resultUrl = String(images[0].url || images[0].b64_json || '');
      return { success: true, imageUrl: resultUrl.startsWith('data:') ? resultUrl : resultUrl };
    }

    return { success: false, error: 'OpenAI 未返回图片' };
  }

  // Path B: /images/generations 端点（APImart 等兼容 API）
  if (resolvedEndpoint === '/images/generations') {
    try {
      // 解析图片为 base64
      let imageBase64 = '';
      let imageMimeType = 'image/png';
      if (imageUrl.startsWith('data:')) {
        const commaIdx = imageUrl.indexOf(',');
        const header = imageUrl.substring(0, commaIdx);
        const mimeMatch = header.match(/data:([^;]+)/);
        imageMimeType = mimeMatch?.[1] || 'image/png';
        imageBase64 = imageUrl.substring(commaIdx + 1);
      } else {
        const imgResp = await fetch(imageUrl.startsWith('/') ? `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}` : imageUrl, {
          signal: AbortSignal.timeout(30000),
        });
        if (!imgResp.ok) return { success: false, error: `无法下载图片: ${imgResp.status}` };
        const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
        imageBase64 = imgBuffer.toString('base64');
        imageMimeType = imgResp.headers.get('content-type') || 'image/png';
      }

      // 构建 images/generations 请求体
      const { body: genBody, endpoint: _resolvedEp } = adjustRequestForProfile(
        {
          model: imageModel,
          prompt: editPrompt,
          n: 1,
          size: '1024x1024',
          image_urls: [`data:${imageMimeType};base64,${imageBase64}`],
        },
        profile,
        { hasImage: true, isEditEndpoint: false }
      );

      const genHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      };

      const genResp = await fetchWithV1Retry(baseUrl, '/images/generations', {
        method: 'POST',
        headers: genHeaders,
        body: JSON.stringify(genBody),
        signal: AbortSignal.timeout(120000),
      });

      if (!genResp.ok) {
        const errText = await genResp.text().catch(() => '');
        const parsed = translateApiError(`编辑请求失败 (${genResp.status}): ${errText.slice(0, 200)}`);
        return { success: false, error: parsed };
      }

      // 解析响应 JSON
      const genData = await genResp.json() as Record<string, unknown>;
      const parsedResult = parseResponseForProfile(genData, profile);

      if (parsedResult.mode === 'polling' && parsedResult.taskIds.length > 0) {
        // 异步任务 - 轮询等待结果
        const remoteTaskId = parsedResult.taskIds[0];
        let pollAttempts = 0;
        const maxPollAttempts = 60;
        const pollInterval = 5000;
        const pollUrl = (profile.pollPathTemplate || '/tasks/{taskId}').replace('{taskId}', remoteTaskId);

        while (pollAttempts < maxPollAttempts) {
          await new Promise(r => setTimeout(r, pollInterval));
          pollAttempts++;

          const pollResp = await fetchWithV1Retry(baseUrl, pollUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(30000),
          });

          if (!pollResp.ok) continue;

          const pollData = await pollResp.json() as Record<string, unknown>;
          const status = String(pollData.status || '').toLowerCase();

          if (status === 'completed' || status === 'success' || status === 'succeeded') {
            const resultsRaw = pollData.results || pollData.images || pollData.data;
            if (Array.isArray(resultsRaw) && resultsRaw.length > 0) {
              const first = resultsRaw[0] as Record<string, unknown>;
              const resultUrl = String(first.url || first.b64_json || '');
              if (resultUrl) return { success: true, imageUrl: resultUrl.startsWith('data:') ? resultUrl : resultUrl };
            } else if (resultsRaw && typeof resultsRaw === 'object' && !Array.isArray(resultsRaw)) {
              const dataObj = resultsRaw as Record<string, unknown>;
              const imagesArr = dataObj.images || dataObj.results;
              if (Array.isArray(imagesArr) && imagesArr.length > 0) {
                const first = imagesArr[0] as Record<string, unknown>;
                const resultUrl = String(first.url || first.b64_json || '');
                if (resultUrl) return { success: true, imageUrl: resultUrl.startsWith('data:') ? resultUrl : resultUrl };
              }
            }
            break;
          }

          if (status === 'failed' || status === 'error') {
            const errMsg = String((pollData.error as Record<string, unknown>)?.message || pollData.message || '远程任务失败');
            return { success: false, error: translateApiError(errMsg) };
          }
        }

        return { success: false, error: '编辑任务轮询超时' };
      }

      // 直接返回结果
      if (parsedResult.directImageUrls.length > 0) {
        return { success: true, imageUrl: parsedResult.directImageUrls[0] };
      }

      return { success: false, error: '模型未返回编辑后的图片' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? translateApiError(err.message) : '编辑请求失败' };
    }
  }

  // 非 OpenAI: 使用 chat/completions + 图片输入 (Gemini / 兼容 API)
  // 直接调用提供商 API，不经过 /api/edit 路由（避免 Next.js dev 模式内存隔离问题）
  try {
    // 解析图片为 base64
    let imageBase64 = '';
    let imageMimeType = 'image/png';
    if (imageUrl.startsWith('data:')) {
      const commaIdx = imageUrl.indexOf(',');
      const header = imageUrl.substring(0, commaIdx);
      const mimeMatch = header.match(/data:([^;]+)/);
      imageMimeType = mimeMatch?.[1] || 'image/png';
      imageBase64 = imageUrl.substring(commaIdx + 1);
    } else {
      // 下载图片
      const imgResp = await fetch(imageUrl.startsWith('/') ? `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}` : imageUrl, {
        signal: AbortSignal.timeout(30000),
      });
      if (!imgResp.ok) return { success: false, error: `无法下载图片: ${imgResp.status}` };
      const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
      imageBase64 = imgBuffer.toString('base64');
      imageMimeType = imgResp.headers.get('content-type') || 'image/png';
    }

    // 构建 chat/completions 请求
    const chatMessages: Array<Record<string, unknown>> = [
      {
        role: 'user',
        content: [
          { type: 'text', text: editPrompt },
          { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } },
        ],
      },
    ];

    // 如果有蒙版，也添加进去
    if (maskDataUrl?.startsWith('data:')) {
      const maskCommaIdx = maskDataUrl.indexOf(',');
      const maskHeader = maskDataUrl.substring(0, maskCommaIdx);
      const maskMimeMatch = maskHeader.match(/data:([^;]+)/);
      const maskMime = maskMimeMatch?.[1] || 'image/png';
      const maskBase64 = maskDataUrl.substring(maskCommaIdx + 1);
      const maskContent = (chatMessages[0].content as Array<Record<string, unknown>>);
      maskContent.push({ type: 'image_url', image_url: { url: `data:${maskMime};base64,${maskBase64}` } });
      maskContent[0] = { type: 'text', text: `${editPrompt}\n\n第二张图片是需要修改的蒙版区域（白色=修改区域）。请仅修改蒙版标记的区域。` };
    }

    const chatBody = {
      model: imageModel,
      messages: chatMessages,
      max_tokens: 4096,
      stream: false,
    };

    const chatHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };

    const chatResp = await fetchWithV1Retry(baseUrl, '/chat/completions', {
      method: 'POST',
      headers: chatHeaders,
      body: JSON.stringify(chatBody),
      signal: AbortSignal.timeout(120000),
    });

    if (!chatResp.ok) {
      const errText = await chatResp.text().catch(() => '');
      return { success: false, error: `编辑请求失败 (${chatResp.status}): ${errText.slice(0, 200)}` };
    }

    // 解析响应（兼容 SSE 流式响应）
    const chatData = await parseAPIResponse(chatResp);

    // 提取图片 URL
    const choices = chatData.choices as Array<Record<string, unknown>> | undefined;
    if (choices && choices.length > 0) {
      const message = choices[0].message as Record<string, unknown> | undefined;
      if (message) {
        // 检查 message.content 是否包含图片
        const content = message.content;
        if (typeof content === 'string' && content.includes('data:image')) {
          // 从文本中提取 base64 图片
          const imgMatch = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
          if (imgMatch) return { success: true, imageUrl: imgMatch[0] };
        }
        // 检查 Gemini 格式的 inline_data
        if (Array.isArray(content)) {
          for (const part of content) {
            const p = part as Record<string, unknown>;
            if (p.type === 'image_url' && p.image_url) {
              const iu = p.image_url as Record<string, unknown>;
              if (iu.url) return { success: true, imageUrl: String(iu.url) };
            }
            if (p.inline_data) {
              const id = p.inline_data as Record<string, unknown>;
              if (id.data) return { success: true, imageUrl: `data:${id.mime_type || 'image/png'};base64,${id.data}` };
            }
          }
        }
      }
    }

    // 尝试 images/generations 格式的响应
    const dataArr = chatData.data as Array<Record<string, unknown>> | undefined;
    if (dataArr && dataArr.length > 0) {
      const resultUrl = String(dataArr[0].url || dataArr[0].b64_json || '');
      if (resultUrl) {
        return { success: true, imageUrl: resultUrl.startsWith('data:') ? resultUrl : resultUrl };
      }
    }

    return { success: false, error: '模型未返回编辑后的图片' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : '编辑请求失败' };
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

// ─── SSE 解析工具 ──────────────────────────────────────────────────

/**
 * 从 SSE 流式响应中解析出完整的 JSON 对象
 * 将多个 data: {...} 事件中的 delta 合并为完整 message
 */
/**
 * 自动检测响应格式并解析为 JSON（兼容 SSE 流和普通 JSON）
 */
async function parseAPIResponse(resp: Response): Promise<Record<string, unknown>> {
  const contentType = resp.headers.get('content-type') || '';
  const text = await resp.text();

  // 尝试直接解析 JSON
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // 不是纯 JSON，尝试 SSE 解析
  }

  // SSE 格式解析
  if (contentType.includes('text/event-stream') || text.trim().startsWith('data: ')) {
    return parseSSETextToJSON(text);
  }

  // 无法解析
  throw new Error(`无法解析 API 响应: ${text.slice(0, 200)}`);
}

async function parseSSEToJSON(resp: Response): Promise<Record<string, unknown>> {
  const text = await resp.text();
  return parseSSETextToJSON(text);
}

/**
 * 从 SSE 文本中解析出完整的 JSON 对象
 * 处理两种情况：
 * 1. 单个完整 JSON 响应（某些代理以 SSE 格式返回完整响应）
 * 2. 标准 SSE delta 流（需要合并 deltas）
 */
function parseSSETextToJSON(text: string): Record<string, unknown> {
  const lines = text.split('\n');
  let fullContent = '';
  let toolCalls: Array<{ id?: string; type?: string; function: { name: string; arguments: string } }> = [];
  let lastFinishReason = '';
  let model = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data: ')) continue;

    const dataStr = trimmed.slice(6); // 去掉 "data: "

    if (dataStr === '[DONE]') break;

    try {
      const event = JSON.parse(dataStr) as Record<string, unknown>;
      model = String(event.model || model);

      const choices = event.choices as Array<Record<string, unknown>> | undefined;
      if (!choices || choices.length === 0) continue;

      const choice = choices[0];
      const delta = choice.delta as Record<string, unknown> | undefined;

      if (delta) {
        // 合并 content
        if (typeof delta.content === 'string') {
          fullContent += delta.content;
        }

        // 合并 tool_calls
        const deltaToolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
        if (deltaToolCalls) {
          for (const dtc of deltaToolCalls) {
            const idx = Number(dtc.index ?? toolCalls.length);
            while (toolCalls.length <= idx) {
              toolCalls.push({ function: { name: '', arguments: '' } });
            }
            const fn = dtc.function as Record<string, unknown> | undefined;
            if (fn) {
              if (fn.name) toolCalls[idx].function.name += String(fn.name);
              if (fn.arguments) toolCalls[idx].function.arguments += String(fn.arguments);
            }
            if (dtc.id) toolCalls[idx].id = String(dtc.id);
            if (dtc.type) toolCalls[idx].type = String(dtc.type);
          }
        }
      }

      // 记录 finish_reason
      if (choice.finish_reason) {
        lastFinishReason = String(choice.finish_reason);
      }
    } catch {
      // 跳过无法解析的行
      continue;
    }
  }

  // 构造与标准 JSON 响应相同格式的对象
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: fullContent || null,
  };

  // 只有有 tool_calls 时才添加
  const validToolCalls = toolCalls.filter(tc => tc.function.name || tc.function.arguments);
  if (validToolCalls.length > 0) {
    message.tool_calls = validToolCalls;
  }

  return {
    id: `sse-${Date.now()}`,
    object: 'chat.completion',
    model,
    choices: [{
      index: 0,
      message,
      finish_reason: lastFinishReason || (validToolCalls.length > 0 ? 'tool_calls' : 'stop'),
    }],
  };
}
