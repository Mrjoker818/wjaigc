import { NextRequest, NextResponse, after } from 'next/server';
import { findProviderForFeature, findProviderById, findProviderForModel } from '@/lib/server-api-config';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import type { ApiProvider } from '@/lib/universal-api-types';
import { fetchWithV1Retry, getInternalApiUrl } from '@/lib/api-helpers';
import { getInternalRequestHeaders, requireApiAuthOrReject } from '@/lib/api-auth';
import { canAccessAgentTask } from '@/lib/agent-task-access';
import { recordAgentTaskProgress, recordAgentTaskSubmitted, recordAgentTaskTerminal } from '@/lib/agent-task-persistence';
import { getCloudTaskForUser } from '@/lib/cloud-task-storage';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, tryChatCompletionsImageFallback, isChannelUnavailableError } from '@/lib/api-compatibility';
import { calculateActualPixelsFromRatio } from '@/lib/canvas-generation-group';
import { executeAgentLoop, getToolsForLLM, type AgentContext, type AgentResult } from '@/lib/agent-engine';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';
import { translateApiError } from '@/lib/api-error-translate';
import { isTaskCancelled as isRegistryCancelled } from '@/lib/task-registry';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { validateApiInputs } from '@/lib/api-validator';
import { logOperation, logError, OP_ACTIONS, startTimer } from '@/lib/op-log';
export const runtime = 'nodejs';
export const maxDuration = 600;

const MAX_AGENT_EDIT_ROUNDS = 8;
const AGENT_EDIT_ALLOWED_TOOLS = [
  'image_edit',
  'generate_image',
  'remove_background',
  'upscale',
  'svg_trace',
  'generate_video',
  'extend_video',
];

// ─── 本地任务存储 ──────────────────────────────────────────────────
// 由于 Next.js dev 模式下不同路由的内存不共享，
// 在本文件内维护独立的任务状态存储，供 GET 查询使用
interface LocalTaskInfo {
  userId: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout';
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
  const startTime = Date.now();
  let deductedCredits = 0;
  let sessionUser: import('@/lib/user-types').User | null = null;
  const selectedModel = '';
  const providerId = '';
  try {
    const authResult = await requireApiAuthOrReject(request);
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body, {
        prompt: 'optionalPrompt',
        imageUrl: 'optionalImageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const { image, prompt, maskDataUrl, model, providerId, maxRounds, imagePrompt, imageModel, imageProviderId, quality, aspectRatio } = body;

    // ★ 从 model 中提取纯 modelId（前端可能传 providerId::modelId 格式）
    let pureModel = model;
    if (model && model.includes('::')) {
      pureModel = model.split('::').pop()!;
      console.log(`[agent-edit] Stripped provider prefix from model: "${model}" → "${pureModel}"`);
    }
    // ★ 规范化模型名（如 gpt-image-2-2k → gpt-image-2）
    const modelNorm = normalizeModelForApi(pureModel);
    if (modelNorm.wasNormalized) {
      console.log(`[agent-edit] Normalized model alias: "${pureModel}" → "${modelNorm.apiModelName}"`);
      pureModel = modelNorm.apiModelName;
    }
    let pureImageModel = imageModel;
    if (imageModel && imageModel.includes('::')) {
      pureImageModel = imageModel.split('::').pop()!;
      console.log(`[agent-edit] Stripped provider prefix from imageModel: "${imageModel}" → "${pureImageModel}"`);
    }
    const imgModelNorm = normalizeModelForApi(pureImageModel);
    if (imgModelNorm.wasNormalized) {
      console.log(`[agent-edit] Normalized imageModel alias: "${pureImageModel}" → "${imgModelNorm.apiModelName}"`);
      pureImageModel = imgModelNorm.apiModelName;
    }

    if (!image || !prompt) {
      return NextResponse.json({ success: false, error: '缺少图片或描述' }, { status: 400 });
    }

    // 积分检查与扣除
    sessionUser = await getSessionUser(request).catch(() => null);
    deductedCredits = 0;
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'image_retouch', undefined, undefined, model);
      if (!creditResult.success) {
        return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
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
      userId: authResult.userId,
      status: 'processing',
      progress: 5,
      label: 'Agent 分析中',
      createdAt: Date.now(),
    });

    // 异步执行（后台处理）— 使用 after() 确保响应返回后 IIFE 仍可运行
    try {
      const created = await recordAgentTaskSubmitted({
        taskId,
        userId: authResult.userId,
        providerId: typeof providerId === 'string' ? providerId : undefined,
        model: typeof pureModel === 'string' ? pureModel : undefined,
        label: 'Agent processing',
      });
      if (!created) {
        return NextResponse.json({ success: false, error: 'Agent task could not be created. Please retry.' }, { status: 503 });
      }
      void recordAgentTaskProgress(taskId, 5, 'Agent processing');
    } catch (error) {
      console.warn('[agent-edit] persistent task creation failed:', error);
      return NextResponse.json({ success: false, error: 'Agent task storage is temporarily unavailable. Please retry.' }, { status: 503 });
    }

    after(async () => {
      const EDIT_GLOBAL_TIMEOUT_MS = 5 * 60 * 1000;
      const timeout = setTimeout(() => {
        const task = localTaskStore.get(taskId);
        if (task && task.status === 'processing') {
          localTaskStore.set(taskId, { ...task, status: 'timeout', error: 'Agent task timed out', progress: 0 });
          void recordAgentTaskTerminal(taskId, {
            status: 'timeout', error: 'Agent task timed out',
          }).catch(error => console.warn('[agent-edit] timeout persistence failed:', error));
        }
      }, EDIT_GLOBAL_TIMEOUT_MS);

      // 辅助函数：检查任务是否已被取消（同时检查本地 store 和全局 task-registry）
      const isCancelled = () => {
        const task = localTaskStore.get(taskId);
        return !task || task.status === 'cancelled' || isRegistryCancelled(taskId);
      };

      try {
        // 查找 LLM 提供商
        const chatProvider = await findProviderForFeature('chat');
        if (!chatProvider || isCancelled()) {
          if (!chatProvider) {
            localTaskStore.set(taskId, {
              userId: authResult.userId,
              status: 'failed', error: '未配置聊天模型，请在管理员面板添加 LLM 模型', progress: 100, label: '失败', createdAt: Date.now(),
            });
            void recordAgentTaskTerminal(taskId, {
              status: 'failed', error: 'No chat model is configured for Agent execution',
            }).catch(error => console.warn('[agent-edit] terminal persistence failed:', error));
          }
          return;
        }

        const chatModel = chatProvider.selectedModels?.[0] || pureModel || 'gpt-4o';

        // 构建 Agent 上下文
        const requestedRounds = typeof maxRounds === 'number' ? Math.trunc(maxRounds) : 5;
        const boundedMaxRounds = Math.min(Math.max(requestedRounds || 5, 1), MAX_AGENT_EDIT_ROUNDS);
        const context: AgentContext = {
          taskId,
          userPrompt: prompt,
          imageUrl: image,
          imagePrompt: imagePrompt || '',
          maskDataUrl,
          model: chatModel,
          maxRounds: boundedMaxRounds,
          allowedTools: AGENT_EDIT_ALLOWED_TOOLS,
          currentRound: 0,
          contextHistory: [],
          onProgress: (info) => {
            if (isCancelled()) return;
            const task = localTaskStore.get(taskId);
            if (!task || task.status !== 'processing') return;
            const progress = Math.min(95, 10 + (info.round / (context.maxRounds || 5)) * 80);
            const progressLabel = `Agent round ${info.round}: ${info.step}`;
            void recordAgentTaskProgress(taskId, progress, progressLabel).catch(error => {
              console.warn('[agent-edit] progress persistence failed:', error);
            });
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
        console.log('[agent-edit] Starting agent loop, chatModel:', chatModel, 'maxRounds:', context.maxRounds);
        const result: AgentResult = await executeAgentLoop(context, llmCall);
        console.log('[agent-edit] Agent loop completed, steps:', result.steps.length, 'success:', result.success);

        // 实际执行所有图像编辑步骤（按轮次顺序）
        if (isCancelled()) return;

        let finalImageUrl = image;
        const allEditSteps = result.steps.filter(s => s.toolName === 'image_edit' && s.success);

        if (allEditSteps.length > 0) {
          // 逐步执行所有 image_edit 操作，每步使用上一步的结果
          console.log('[agent-edit] Executing', allEditSteps.length, 'image edit steps');
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
                quality,
                aspectRatio,
              );
              console.log(`[agent-edit] Edit step ${i + 1} result: success=${editResult.success} hasUrl=${!!editResult.imageUrl} url=${editResult.imageUrl?.substring(0, 80)} error=${editResult.error || ''}`);
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
                headers: {
                  'Content-Type': 'application/json',
                  ...getInternalRequestHeaders(authResult.userId, authResult.userRole === 'admin' ? 'admin' : 'user'),
                },
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
                headers: {
                  'Content-Type': 'application/json',
                  ...getInternalRequestHeaders(authResult.userId, authResult.userRole === 'admin' ? 'admin' : 'user'),
                },
                body: JSON.stringify({ imageUrl: finalImageUrl, action: 'removebg', model: imageModel, providerId: imageProviderId, engine: imageModel ? 'ai' : 'auto' }),
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
                headers: {
                  'Content-Type': 'application/json',
                  ...getInternalRequestHeaders(authResult.userId, authResult.userRole === 'admin' ? 'admin' : 'user'),
                },
                body: JSON.stringify({ imageUrl: finalImageUrl, mode: step.params.mode || 'color', quality: step.params.quality || 'balanced' }),
              });
              const svgData = await svgResp.json();
              if (svgData.success && svgData.svgDataUrl) {
                finalImageUrl = svgData.previewUrl || finalImageUrl;
                step.result = 'SVG描摹成功';
              }
            } else if (step.toolName === 'generate_image') {
              // 调用图像生成 API
              const task = localTaskStore.get(taskId);
              if (task) localTaskStore.set(taskId, { ...task, label: '执行图像生成...' });
              const genResp = await fetch(getInternalApiUrl('/api/generate'), {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...getInternalRequestHeaders(authResult.userId, authResult.userRole === 'admin' ? 'admin' : 'user'),
                },
                body: JSON.stringify({
                  prompt: String(step.params.prompt || prompt),
                  aspectRatio: step.params.size || '1:1',
                  quality: 'high',
                  model: imageModel,
                  providerId: imageProviderId,
                }),
              });
              const genData = await genResp.json() as Record<string, unknown>;
              if (genData.success && genData.taskId) {
                // 轮询等待结果
                const genTaskId = String(genData.taskId);
                for (let poll = 0; poll < 120; poll++) {
                  if (isCancelled()) break;
                  await new Promise(r => setTimeout(r, 2000));
                  const pollResp = await fetch(getInternalApiUrl(`/api/poll-task?taskId=${genTaskId}`), { method: 'POST' });
                  const pollData = await pollResp.json() as Record<string, unknown>;
                  const status = String(pollData.status || '');
                  if (status === 'completed' && pollData.imageUrl) {
                    finalImageUrl = String(pollData.imageUrl);
                    step.result = '图像生成成功';
                    break;
                  } else if (status === 'failed') {
                    step.result = `图像生成失败: ${pollData.error || '未知错误'}`;
                    step.success = false;
                    break;
                  }
                }
              }
            } else if (step.toolName === 'generate_video') {
              // 调用视频生成 API
              const task = localTaskStore.get(taskId);
              if (task) localTaskStore.set(taskId, { ...task, label: '执行视频生成...' });
              const vGenResp = await fetch(getInternalApiUrl('/api/video/generate'), {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...getInternalRequestHeaders(authResult.userId, authResult.userRole === 'admin' ? 'admin' : 'user'),
                },
                body: JSON.stringify({
                  prompt: String(step.params.prompt || prompt),
                  mode: step.params.mode === 'image2video' ? 'image2video' : 'text2video',
                  imageUrl: step.params.mode === 'image2video' ? finalImageUrl : undefined,
                  aspectRatio: step.params.aspect_ratio || '16:9',
                  duration: String(step.params.duration || '5'),
                }),
              });
              const vGenData = await vGenResp.json() as Record<string, unknown>;
              if (vGenData.success && vGenData.taskId) {
                // 轮询等待结果
                const vTaskId = String(vGenData.taskId);
                for (let poll = 0; poll < 180; poll++) {
                  if (isCancelled()) break;
                  await new Promise(r => setTimeout(r, 2000));
                  const pollResp = await fetch(getInternalApiUrl(`/api/poll-task?taskId=${vTaskId}`), { method: 'POST' });
                  const pollData = await pollResp.json() as Record<string, unknown>;
                  const status = String(pollData.status || '');
                  if (status === 'completed') {
                    const videoUrl = pollData.videoUrl || pollData.url;
                    if (videoUrl) {
                      step.result = '视频生成成功';
                      // 视频不替换 finalImageUrl，保留图片，视频URL通过steps返回
                      step.params.videoUrl = videoUrl;
                    }
                    break;
                  } else if (status === 'failed') {
                    step.result = `视频生成失败: ${pollData.error || '未知错误'}`;
                    step.success = false;
                    break;
                  }
                }
              }
            } else if (step.toolName === 'extend_video') {
              // 调用视频延长 API
              const task = localTaskStore.get(taskId);
              if (task) localTaskStore.set(taskId, { ...task, label: '执行视频延长...' });
              const vExtResp = await fetch(getInternalApiUrl('/api/video/extend'), {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...getInternalRequestHeaders(authResult.userId, authResult.userRole === 'admin' ? 'admin' : 'user'),
                },
                body: JSON.stringify({
                  videoUrl: String(step.params.videoUrl || context.videoUrl || ''),
                  prompt: String(step.params.prompt || ''),
                  extendDuration: Number(step.params.duration || 5),
                }),
              });
              const vExtData = await vExtResp.json() as Record<string, unknown>;
              if (vExtData.success && vExtData.taskId) {
                const exTaskId = String(vExtData.taskId);
                for (let poll = 0; poll < 180; poll++) {
                  if (isCancelled()) break;
                  await new Promise(r => setTimeout(r, 2000));
                  const pollResp = await fetch(getInternalApiUrl(`/api/poll-task?taskId=${exTaskId}`), { method: 'POST' });
                  const pollData = await pollResp.json() as Record<string, unknown>;
                  const status = String(pollData.status || '');
                  if (status === 'completed') {
                    step.result = '视频延长成功';
                    break;
                  } else if (status === 'failed') {
                    step.result = `视频延长失败: ${pollData.error || '未知错误'}`;
                    step.success = false;
                    break;
                  }
                }
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
        console.log(`[agent-edit] Task ${taskId} finishing, result.success=${result.success} finalImageUrl=${finalImageUrl?.substring(0, 80) || 'none'}`);

        // 持久化 base64 data URL 到服务器文件，避免轮询时序列化巨大 base64 字符串
        let persistedImageUrl = finalImageUrl;
        if (finalImageUrl && (finalImageUrl.startsWith('data:') || finalImageUrl.length > 500_000)) {
          try {
            const saveResp = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/save-image`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...getInternalRequestHeaders(authResult.userId, authResult.userRole === 'admin' ? 'admin' : 'user'),
              },
              body: JSON.stringify({ imageData: finalImageUrl }),
            });
            if (saveResp.ok) {
              const saveData = await saveResp.json();
              if (saveData.url) {
                const domainBase = process.env.COZE_PROJECT_DOMAIN_DEFAULT;
                persistedImageUrl = domainBase
                  ? `${domainBase.startsWith('http') ? '' : 'https://'}${domainBase}${saveData.url}`
                  : saveData.url;
                console.log(`[agent-edit] Persisted base64 image to ${persistedImageUrl.substring(0, 80)}`);
              }
            }
          } catch (persistErr) {
            console.warn('[agent-edit] Failed to persist image, keeping original URL:', persistErr);
          }
        }

        if (result.success) {
          void recordAgentTaskTerminal(taskId, {
            status: 'completed', imageUrl: persistedImageUrl, steps: result.steps, finalResponse: result.finalResponse,
          }).catch(error => console.warn('[agent-edit] terminal persistence failed:', error));
          localTaskStore.set(taskId, {
            userId: authResult.userId,
            status: 'completed',
            progress: 100,
            label: '完成',
            result: {
              imageUrl: persistedImageUrl,
              steps: result.steps,
              finalResponse: result.finalResponse,
            },
            createdAt: localTaskStore.get(taskId)?.createdAt || Date.now(),
          });
        } else {
          void recordAgentTaskTerminal(taskId, {
            status: 'failed', imageUrl: persistedImageUrl, steps: result.steps, finalResponse: result.finalResponse,
            error: translateApiError(result.error || result.finalResponse || 'Agent execution failed'),
          }).catch(error => console.warn('[agent-edit] terminal persistence failed:', error));
          // Agent 执行失败（LLM 调用失败、工具执行失败等）
          localTaskStore.set(taskId, {
            userId: authResult.userId,
            status: 'failed',
            progress: 100,
            label: '失败',
            error: translateApiError(result.error || result.finalResponse || 'Agent 执行失败'),
            result: {
              imageUrl: persistedImageUrl,
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
          void recordAgentTaskTerminal(taskId, {
            status: 'failed', error: translateApiError(errMsg),
          }).catch(error => console.warn('[agent-edit] terminal persistence failed:', error));
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
    const durationMs = Date.now() - startTime;
    console.error('[agent-edit] POST error:', err);
    logError(OP_ACTIONS.AGENT_EDIT, err, {
      userId: sessionUser?.id || 'unknown',
      userName: sessionUser?.name || 'unknown',
      model: selectedModel,
      providerId: providerId,
      durationMs,
      detail: `Agent编排编辑请求失败`,
    });
    // 退款：Agent编排失败时退还积分
    if (deductedCredits > 0 && sessionUser) {
      try {
        await refundCredits(sessionUser.id, deductedCredits, `Agent编排失败退款`);
      } catch (refundErr) { console.error('[agent-edit] Refund failed:', refundErr); }
    }
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
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');
  const action = searchParams.get('action');

  if (taskId && action !== 'cancel' && !localTaskStore.has(taskId)) {
    const persisted = await getCloudTaskForUser(taskId, authResult.userId);
    if (persisted) {
      return NextResponse.json({
        success: persisted.status === 'completed',
        status: persisted.status,
        progress: persisted.progress,
        label: persisted.label,
        result: persisted.result,
        error: persisted.error,
      });
    }
  }

  if (taskId && action === 'cancel') {
    // 取消任务
    const task = localTaskStore.get(taskId);
    if (!task || !canAccessAgentTask(task.userId, authResult.userId, authResult.userRole)) {
      return NextResponse.json({ success: false, error: 'Task not found or access denied' }, { status: 404 });
    }
    if (task && task.status === 'processing') {
      localTaskStore.set(taskId, { ...task, status: 'cancelled', error: '任务已取消' });
      void recordAgentTaskTerminal(taskId, { status: 'cancelled', error: 'Task cancelled by user' })
        .catch(error => console.warn('[agent-edit] cancellation persistence failed:', error));
      return NextResponse.json({ success: true, status: 'cancelled' });
    }
    return NextResponse.json({ success: false, error: '任务不存在或无法取消' });
  }

  if (taskId) {
    // 查询任务状态
    const task = localTaskStore.get(taskId);
    if (!task || !canAccessAgentTask(task.userId, authResult.userId, authResult.userRole)) {
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
  imageProviderIdFromFrontend?: string,
  qualityFromFrontend?: string,
  aspectRatioFromFrontend?: string
): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
  // 优先使用前端传递的图像模型和提供商，遵循用户在图像生成面板的选择
  console.log('[agent-edit] performImageEdit called, model:', imageModelFromFrontend, 'providerId:', imageProviderIdFromFrontend);
  let imageProvider: ApiProvider | null = null;
  if (imageProviderIdFromFrontend) {
    imageProvider = await findProviderById(imageProviderIdFromFrontend);
    console.log('[agent-edit] findProviderById result:', imageProvider ? imageProvider.name : 'null');
  }
  if (!imageProvider && imageModelFromFrontend) {
    imageProvider = await findProviderForModel(imageModelFromFrontend, 'image', imageProviderIdFromFrontend);
    console.log('[agent-edit] findProviderForModel result:', imageProvider ? imageProvider.name : 'null');
  }
  if (!imageProvider) {
    // 兜底：查找图像编辑提供商
    imageProvider = await findProviderForFeature('imageEdit');
    console.log('[agent-edit] findProviderForFeature(imageEdit) result:', imageProvider ? imageProvider.name : 'null');
  }
  if (!imageProvider) {
    console.error('[agent-edit] No image provider configured');
    return { success: false, error: '未配置图像模型，请在管理员面板添加图像模型提供商' };
  }

  const baseUrl = imageProvider.baseUrl?.replace(/\/+$/, '') || '';
  const apiKey = imageProvider.apiKey || '';
  // ★ 去除 imageModel 中的 providerId:: 前缀 + 规范化模型别名
  let imageModel = imageModelFromFrontend || imageProvider.selectedModels?.[0] || '';
  if (imageModel.includes('::')) {
    imageModel = imageModel.split('::').pop()!;
  }
  const pImgNorm = normalizeModelForApi(imageModel);
  if (pImgNorm.wasNormalized) {
    console.log(`[agent-edit] Normalized performImageEdit model: "${imageModel}" → "${pImgNorm.apiModelName}"`);
    imageModel = pImgNorm.apiModelName;
  }

  if (!baseUrl || !apiKey || !imageModel) {
    console.error('[agent-edit] Image provider config incomplete:', { baseUrl: !!baseUrl, apiKey: !!apiKey, imageModel });
    return { success: false, error: '图像提供商配置不完整（缺少 URL / Key / 模型名）' };
  }

  // 使用 API 兼容层确定正确的端点
  const profile = resolveCompatProfile(imageProvider);
  const resolvedEndpoint = profile.editEndpoint || '/images/edits';

  // Path A: 支持 /images/edits 端点的提供商（OpenAI 官方等）
  if (resolvedEndpoint === '/images/edits') {
    console.log('[agent-edit] Path A: /images/edits, baseUrl:', baseUrl, 'model:', imageModel);
    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
      };

      const formData = new FormData();
      formData.append('model', imageModel);
      formData.append('prompt', editPrompt);
      formData.append('n', '1');
      const effectiveQuality = qualityFromFrontend || '1K';
      const effectiveAspectRatio = aspectRatioFromFrontend || '1:1';
      const dynamicSize = calculateActualPixelsFromRatio(effectiveAspectRatio, effectiveQuality, imageModel) || '1024x1024';
      formData.append('size', dynamicSize);

      // 添加图片
      if (imageUrl.startsWith('data:')) {
        const blob = dataUrlToBlob(imageUrl);
        formData.append('image', blob, 'image.png');
      } else {
        const imgResp = await fetch(imageUrl.startsWith('/') ? `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}` : imageUrl, {
          signal: AbortSignal.timeout(30000),
        });
        if (!imgResp.ok) return { success: false, error: `无法下载图片: ${imgResp.status}` };
        const imgBlob = await imgResp.blob();
        formData.append('image', imgBlob, 'image.png');
      }

      // 添加蒙版
      if (maskDataUrl?.startsWith('data:')) {
        const maskBlob = dataUrlToBlob(maskDataUrl);
        formData.append('mask', maskBlob, 'mask.png');
      }

      console.log('[agent-edit] Path A: sending request to', `${baseUrl}/images/edits`);
      const resp = await fetchWithV1Retry(baseUrl, '/images/edits', {
        method: 'POST',
        headers,
        body: formData,
        signal: AbortSignal.timeout(120000),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.error('[agent-edit] Path A: API error', resp.status, errText.slice(0, 300));
        if (errText.includes('No available channel') || errText.includes('model_not_found') || errText.includes('not configured')) {
          return { success: false, error: `模型在当前渠道暂不可用，请稍后重试或更换模型` };
        }

        // ★ Try /chat/completions fallback for channel errors
        if (isChannelUnavailableError(`${errText} ${resp.status}`)) {
          console.info('[agent-edit] Path A: channel error, trying /chat/completions fallback...');
          try {
            const chatImageUrls = await tryChatCompletionsImageFallback({
              baseUrl,
              apiKey,
              model: imageModel,
              prompt: editPrompt,
              imageBase64: imageUrl,
              imageUrls: imageUrl ? [imageUrl] : undefined,
              originalError: errText,
              requestIdPrefix: 'agent-edit-pathA',
              skipChannelCheck: true,
            });
            if (chatImageUrls && chatImageUrls.length > 0) {
              console.log('[agent-edit] Path A: /chat/completions fallback succeeded');
              return { success: true, imageUrl: chatImageUrls[0] };
            }
          } catch (chatErr) {
            console.warn('[agent-edit] Path A: /chat/completions fallback error:', chatErr);
          }
        }

        return { success: false, error: `OpenAI edit 失败 (${resp.status}): ${errText.slice(0, 200)}` };
      }

      const data = await resp.json() as Record<string, unknown>;
      const images = data.data as Array<Record<string, unknown>> | undefined;
      if (images && images.length > 0) {
        let resultUrl = '';
        const rawB64 = images[0].b64_json;
        const rawUrl = images[0].url ? String(images[0].url) : '';
        if (rawB64) {
          resultUrl = `data:image/png;base64,${rawB64}`;
        } else if (rawUrl) {
          // 某些API在url字段直接返回base64字符串（无data:前缀）
          if (rawUrl.startsWith('data:') || rawUrl.startsWith('http')) {
            resultUrl = rawUrl;
          } else if (/^[A-Za-z0-9+/=\s]+$/.test(rawUrl.slice(0, 100)) && rawUrl.length > 200) {
            resultUrl = `data:image/png;base64,${rawUrl}`;
          } else {
            resultUrl = rawUrl;
          }
        }
        console.log('[agent-edit] Path A: success, got result, b64_json:', !!rawB64, 'url type:', rawUrl.startsWith('http') ? 'http' : rawUrl.startsWith('data:') ? 'data-url' : rawUrl.length > 200 ? 'raw-base64' : 'short', 'length:', resultUrl.length);
        return { success: true, imageUrl: resultUrl };
      }

      console.error('[agent-edit] Path A: no images in response', JSON.stringify(data).slice(0, 200));
      return { success: false, error: 'OpenAI 未返回图片' };
    } catch (err) {
      // Timeout → try /chat/completions fallback
      const isTimeout = err instanceof Error && (err.name === 'AbortError' || /timeout|aborted/i.test(err.message));
      if (isTimeout) {
        console.info('[agent-edit] Path A: timed out, trying /chat/completions fallback...');
        try {
          const chatImageUrls = await tryChatCompletionsImageFallback({
            baseUrl,
            apiKey,
            model: imageModel,
            prompt: editPrompt,
            imageBase64: imageUrl,
            imageUrls: imageUrl ? [imageUrl] : undefined,
            originalError: 'timeout',
            requestIdPrefix: 'agent-edit-pathA',
            skipChannelCheck: true,
          });
          if (chatImageUrls && chatImageUrls.length > 0) {
            console.log('[agent-edit] Path A: /chat/completions fallback succeeded (after timeout)');
            return { success: true, imageUrl: chatImageUrls[0] };
          }
        } catch (chatErr) {
          console.warn('[agent-edit] Path A: /chat/completions fallback error (after timeout):', chatErr);
        }
      }
      console.error('[agent-edit] Path A: exception', err);
      return { success: false, error: err instanceof Error ? translateApiError(err.message) : '编辑请求异常' };
    }
  }

  // Path B: /images/generations 端点（APImart 等兼容 API）
  if (resolvedEndpoint === '/images/generations') {
    console.log('[agent-edit] Path B: /images/generations, baseUrl:', baseUrl, 'model:', imageModel);
    let imageBase64 = '';
    let imageMimeType = 'image/png';
    try {
      // 解析图片为 base64
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
      const effectiveQuality = qualityFromFrontend || '1K';
      const effectiveAspectRatio = aspectRatioFromFrontend || '1:1';
      const dynamicSize = calculateActualPixelsFromRatio(effectiveAspectRatio, effectiveQuality, imageModel) || '2048x2048';
      const { body: genBody, endpoint: _resolvedEp } = adjustRequestForProfile(
        {
          model: imageModel,
          prompt: editPrompt,
          n: 1,
          size: dynamicSize,
          quality: effectiveQuality,
          image_urls: [`data:${imageMimeType};base64,${imageBase64}`],
        },
        profile,
        { hasImage: true, isEditEndpoint: false }
      );

      const genHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      };

      console.log('[agent-edit] Path B: sending request to', `${baseUrl}/images/generations`, 'with image_urls');
      const genResp = await fetchWithV1Retry(baseUrl, '/images/generations', {
        method: 'POST',
        headers: genHeaders,
        body: JSON.stringify(genBody),
        signal: AbortSignal.timeout(120000),
      });

      if (!genResp.ok) {
        const errText = await genResp.text().catch(() => '');
        console.error('[agent-edit] Path B: API error', genResp.status, errText.slice(0, 300));

        // ★ Try /chat/completions fallback for channel errors
        if (isChannelUnavailableError(`${errText} ${genResp.status}`)) {
          console.info('[agent-edit] Path B: channel error, trying /chat/completions fallback...');
          try {
            const chatImageUrls = await tryChatCompletionsImageFallback({
              baseUrl,
              apiKey,
              model: imageModel,
              prompt: editPrompt,
              imageBase64: `data:${imageMimeType};base64,${imageBase64}`,
              imageUrls: [`data:${imageMimeType};base64,${imageBase64}`],
              originalError: errText,
              requestIdPrefix: 'agent-edit-pathB',
              skipChannelCheck: true,
            });
            if (chatImageUrls && chatImageUrls.length > 0) {
              console.log('[agent-edit] Path B: /chat/completions fallback succeeded');
              return { success: true, imageUrl: chatImageUrls[0] };
            }
          } catch (chatErr) {
            console.warn('[agent-edit] Path B: /chat/completions fallback error:', chatErr);
          }
        }

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

          function extractImgUrl(obj: Record<string, unknown>): string {
            const rawB64 = obj.b64_json ? String(obj.b64_json) : '';
            const rawUrl = obj.url ? String(obj.url) : '';
            if (rawB64) return `data:image/png;base64,${rawB64}`;
            if (!rawUrl) return '';
            if (rawUrl.startsWith('data:') || rawUrl.startsWith('http')) return rawUrl;
            if (/^[A-Za-z0-9+/=\s]+$/.test(rawUrl.slice(0, 100)) && rawUrl.length > 200) return `data:image/png;base64,${rawUrl}`;
            return rawUrl;
          }
          if (status === 'completed' || status === 'success' || status === 'succeeded') {
            const resultsRaw = pollData.results || pollData.images || pollData.data;
            if (Array.isArray(resultsRaw) && resultsRaw.length > 0) {
              const first = resultsRaw[0] as Record<string, unknown>;
              const resultUrl = extractImgUrl(first);
              if (resultUrl) return { success: true, imageUrl: resultUrl };
            } else if (resultsRaw && typeof resultsRaw === 'object' && !Array.isArray(resultsRaw)) {
              const dataObj = resultsRaw as Record<string, unknown>;
              const imagesArr = dataObj.images || dataObj.results;
              if (Array.isArray(imagesArr) && imagesArr.length > 0) {
                const first = imagesArr[0] as Record<string, unknown>;
                const resultUrl = extractImgUrl(first);
                if (resultUrl) return { success: true, imageUrl: resultUrl };
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
        console.log('[agent-edit] Path B: direct result, got', parsedResult.directImageUrls.length, 'images');
        return { success: true, imageUrl: parsedResult.directImageUrls[0] };
      }

      console.error('[agent-edit] Path B: no images in response');
      return { success: false, error: '模型未返回编辑后的图片' };
    } catch (err) {
      // Timeout → try /chat/completions fallback
      const isTimeout = err instanceof Error && (err.name === 'AbortError' || /timeout|aborted/i.test(err.message));
      if (isTimeout) {
        console.info('[agent-edit] Path B: timed out, trying /chat/completions fallback...');
        try {
          const chatImageUrls = await tryChatCompletionsImageFallback({
            baseUrl,
            apiKey,
            model: imageModel,
            prompt: editPrompt,
            imageBase64: `data:${imageMimeType};base64,${imageBase64}`,
            imageUrls: [`data:${imageMimeType};base64,${imageBase64}`],
            originalError: 'timeout',
            requestIdPrefix: 'agent-edit-pathB',
            skipChannelCheck: true,
          });
          if (chatImageUrls && chatImageUrls.length > 0) {
            console.log('[agent-edit] Path B: /chat/completions fallback succeeded (after timeout)');
            return { success: true, imageUrl: chatImageUrls[0] };
          }
        } catch (chatErr) {
          console.warn('[agent-edit] Path B: /chat/completions fallback error (after timeout):', chatErr);
        }
      }
      console.error('[agent-edit] Path B: exception', err);
      return { success: false, error: err instanceof Error ? translateApiError(err.message) : '编辑请求失败' };
    }
  }

  // 非 OpenAI: 使用 chat/completions + 图片输入 (Gemini / 兼容 API)
  // 直接调用提供商 API，不经过 /api/edit 路由（避免 Next.js dev 模式内存隔离问题）
  console.log('[agent-edit] Path C: chat/completions, baseUrl:', baseUrl, 'model:', imageModel);
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

    console.log('[agent-edit] Path C: sending request to', `${baseUrl}/chat/completions`);
    const chatResp = await fetchWithV1Retry(baseUrl, '/chat/completions', {
      method: 'POST',
      headers: chatHeaders,
      body: JSON.stringify(chatBody),
      signal: AbortSignal.timeout(120000),
    });

    if (!chatResp.ok) {
      const errText = await chatResp.text().catch(() => '');
      console.error('[agent-edit] Path C: API error', chatResp.status, errText.slice(0, 300));
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
    console.error('[agent-edit] Path C: exception', err);
    return { success: false, error: err instanceof Error ? translateApiError(err.message) : '编辑请求失败' };
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
  const toolCalls: Array<{ id?: string; type?: string; function: { name: string; arguments: string } }> = [];
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
