import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature, findProviderById } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { registerTask, updateTaskProgress, isTaskCancelled } from '@/lib/task-registry';
import { executeAgentLoop, getToolsForLLM, type AgentContext, type AgentResult } from '@/lib/agent-engine';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';

export const runtime = 'nodejs';
export const maxDuration = 600;

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
    const body = await request.json();
    const { image, prompt, maskDataUrl, model, providerId, maxRounds } = body;

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

    // 注册任务
    registerTask(taskId, 'edit', `Agent: ${prompt.slice(0, 50)}`);
    updateTaskProgress(taskId, { status: 'processing', progress: 5, label: 'Agent 分析中' });

    // 异步执行（后台处理）
    (async () => {
      const EDIT_GLOBAL_TIMEOUT_MS = 5 * 60 * 1000;
      const timeout = setTimeout(() => {
        if (!isTaskCancelled(taskId)) {
          updateTaskProgress(taskId, { status: 'failed', error: '任务超时', progress: 100 });
        }
      }, EDIT_GLOBAL_TIMEOUT_MS);

      try {
        // 查找 LLM 提供商
        const chatProvider = await findProviderForFeature('chat');
        if (!chatProvider) {
          updateTaskProgress(taskId, { status: 'failed', error: '未配置聊天模型，请在管理员面板添加 LLM 模型', progress: 100 });
          return;
        }

        const chatModel = chatProvider.selectedModels?.[0] || model || 'gpt-4o';

        // 构建 Agent 上下文
        const context: AgentContext = {
          taskId,
          userPrompt: prompt,
          imageUrl: image,
          maskDataUrl,
          model: chatModel,
          maxRounds: maxRounds || 5,
          currentRound: 0,
          contextHistory: [],
          onProgress: (info) => {
            if (isTaskCancelled(taskId)) return;
            const progress = Math.min(95, 10 + (info.round / (context.maxRounds || 5)) * 80);
            updateTaskProgress(taskId, {
              status: 'processing',
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

          const data = await resp.json() as Record<string, unknown>;
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

        // 实际执行图像编辑（如果 Agent 选择了 image_edit 工具）
        // 这里需要调用实际的 edit API 来完成操作
        let finalImageUrl = image;
        const imageEditStep = result.steps.find(s => s.toolName === 'image_edit' && s.success);

        if (imageEditStep) {
          // 调用实际的 edit route 进行图片编辑
          updateTaskProgress(taskId, { progress: 90, label: '执行图像编辑...' });

          try {
            const editResult = await performImageEdit(
              image,
              String(imageEditStep.params.prompt || prompt),
              maskDataUrl
            );
            if (editResult.success && editResult.imageUrl) {
              finalImageUrl = editResult.imageUrl;
            }
          } catch (err) {
            console.error('[agent-edit] Image edit failed:', err);
          }
        }

        // 任务完成
        updateTaskProgress(taskId, {
          status: 'completed',
          progress: 100,
          result: {
            imageUrl: finalImageUrl,
            steps: result.steps,
            finalResponse: result.finalResponse,
          },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : '未知错误';
        console.error('[agent-edit] Error:', errMsg);
        if (!isTaskCancelled(taskId)) {
          updateTaskProgress(taskId, { status: 'failed', error: errMsg, progress: 100 });
        }
      } finally {
        clearTimeout(timeout);
      }
    })();

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
 * 获取支持的 Agent 工具列表
 */
export async function GET() {
  const { getToolsForLLM: getTools } = await import('@/lib/agent-engine');
  return NextResponse.json({
    tools: getTools(),
  });
}

// ─── 实际图像编辑执行 ──────────────────────────────────────────────

async function performImageEdit(
  imageUrl: string,
  editPrompt: string,
  maskDataUrl: string | undefined
): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
  // 查找图像编辑提供商 (use 'imageEdit' feature key)
  const imageProvider = await findProviderForFeature('imageEdit');
  if (!imageProvider) {
    return { success: false, error: '未配置图像模型' };
  }

  // 获取提供商配置
  const provider = await findProviderById(String(imageProvider.id));
  if (!provider) {
    return { success: false, error: '图像提供商配置不存在' };
  }

  const baseUrl = provider.baseUrl?.replace(/\/+$/, '') || '';
  const apiKey = provider.apiKey || '';
  const imageModel = provider.selectedModels?.[0] || '';

  if (!baseUrl || !apiKey || !imageModel) {
    return { success: false, error: '图像提供商配置不完整' };
  }

  // 判断是否使用 OpenAI 格式（支持 edit + mask）
  const isOpenAI = baseUrl.includes('openai') || baseUrl.includes('api.openai');

  if (isOpenAI) {
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

  // 非 OpenAI: 使用 Gemini 或其他格式
  // 回退到现有的 edit route 逻辑
  try {
    const editResp = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imageUrl,
        prompt: editPrompt,
        mask: maskDataUrl,
        model: imageModel,
        size: '1024',
        quality: 'high',
      }),
    });

    const editData = await editResp.json() as Record<string, unknown>;
    if (editData.success) {
      return { success: true, imageUrl: String(editData.taskId ? '' : (editData.imageUrl || '')) };
    }
    return { success: false, error: String(editData.error || '编辑失败') };
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
