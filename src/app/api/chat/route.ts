import { NextRequest, NextResponse } from 'next/server';
import { appendUserJsonl } from '@/lib/server-user-storage';
import { findProviderForModel, getApiProviders, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { CHAT_TOOLS, executeToolCall, parseToolCallsFromStream, ToolCallResult } from '@/lib/chat-tools';
import { getAgentToolChoice } from '@/lib/chat-agent-tool-choice';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { logOperation, logError, startTimer, OP_ACTIONS } from '@/lib/op-log';

export const maxDuration = 120;

/** Maximum Agent loop iterations to prevent infinite loops */
const MAX_AGENT_ITERATIONS = 8;
/** Timeout for each tool execution */
const TOOL_EXECUTION_TIMEOUT = 120000;

interface ChatTaskContext {
  projectId?: string;
  sessionId?: string;
  messageId?: string;
}

export async function POST(request: NextRequest) {
  const opTimer = startTimer();
  let deductedCredits = 0;
  let sessionUser: any = null;
  try {
    const authResult = await requireApiAuthOrReject(request);
    if (authResult instanceof NextResponse) return authResult;
    const {
      model,
      messages,
      stream = true,
      providerId,
      userId: requestUserId,
      enableTools = true,  // 是否启用 function calling
      agentTools = undefined as string[] | undefined,  // 智能体可用的工具列表（过滤）
      canvasSummary = undefined as string | undefined,  // 画布图片摘要
      intentLevel = undefined as string | undefined,  // P2-9: 意图完整度 (extremely_vague / moderately_vague / clear)
      imageModel = undefined as string | undefined,  // 前端当前选择的图像模型
      imageProviderId = undefined as string | undefined,  // 前端当前选择的图像提供商ID
      isAgentMode = false,  // 是否是Agent模式（Agent模式下放宽意图检测，强制启用工具）
      projectId: requestProjectId = undefined as string | undefined,
      sessionId: requestSessionId = undefined as string | undefined,
      messageId: requestMessageId = undefined as string | undefined,
    } = await request.json();
    
    // P2-9: 极度模糊时强制禁用工具，确保LLM只追问不执行
    // Agent模式例外：用户明确希望自动执行，放宽意图检测
    const effectiveEnableTools = (intentLevel === 'extremely_vague' && !isAgentMode) ? false : enableTools;
    
    // Filter tools based on agent's allowed tools
    const availableTools = agentTools && agentTools.length > 0
      ? CHAT_TOOLS.filter(t => agentTools.includes(t.function.name))
      : CHAT_TOOLS;
    
    sessionUser = await getSessionUser(request);
    const userId = sessionUser?.id ?? requestUserId ?? "anonymous";
    const taskContext = {
      projectId: typeof requestProjectId === 'string' ? requestProjectId : undefined,
      sessionId: typeof requestSessionId === 'string' ? requestSessionId : undefined,
      messageId: typeof requestMessageId === 'string' ? requestMessageId : undefined,
    };
    deductedCredits = 0; // 跟踪已扣积分，用于失败退款

    // 参数验证
    if (!model || !messages) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: '消息列表不能为空' }, { status: 400 });
    }
    if (messages.length > 100) {
      return NextResponse.json({ error: '消息数量超出限制(最多100条)' }, { status: 400 });
    }

    // 积分扣除（登录用户才扣积分，按模型差异化扣分）
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'chat', undefined, undefined, model);
      if (!creditResult.success) {
        return NextResponse.json({ error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
    }

    // Content safety check
    const lastUserMsg = messages.filter((m: { role: string }) => m.role === 'user').pop();
    if (lastUserMsg) {
      const promptText = typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content);
      const safetyResult = checkPromptSafety(promptText);
      if (safetyResult.level === 'block') {
        return NextResponse.json({ error: safetyResult.reason }, { status: 400 });
      }
      if (safetyResult.level === 'warning') {
        logSafetyWarning(promptText, safetyResult);
      }
    }

    // 查找 API 提供商配置
    let chatApiKey = '';
    let chatBaseUrl = 'https://api.apimart.ai/v1';

    if (providerId) {
      const provider = (await getApiProviders()).find(item => item.id === providerId);
      if (provider) {
        chatApiKey = provider.apiKey;
        chatBaseUrl = normalizeApiBaseUrl(provider.baseUrl);
      } else {
        return NextResponse.json({ error: '未找到对应的模型提供商' }, { status: 400 });
      }
    } else {
      const provider = await findProviderForModel(model, 'chat');
      chatApiKey = provider?.apiKey || '';
      if (provider?.baseUrl) {
        chatBaseUrl = provider.baseUrl.replace(/\/+$/, '');
      }
    }

    if (!chatApiKey) {
      return NextResponse.json({ error: '请先在管理员后台配置可用模型' }, { status: 400 });
    }

    // Detect thinking mode
    const isThinkingModel = model.endsWith('-thinking');
    const baseModel = isThinkingModel ? model.replace(/-thinking$/, '') : model;
    const { apiModelName: requestModel } = normalizeModelForApi(baseModel);
    if (requestModel !== baseModel) {
      console.log(`[chat] Model normalized: ${baseModel} → ${requestModel}`);
    }

    // Convert relative image URLs to absolute URLs
    const origin = request.headers.get('origin') || process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
    const fixedMessages = messages.map((msg: { role: string; content: unknown }) => {
      if (Array.isArray(msg.content)) {
        const fixedContent = msg.content.map((part: { type?: string; image_url?: { url?: string } }) => {
          if (part.type === 'image_url' && part.image_url?.url && part.image_url.url.startsWith('/')) {
            return { ...part, image_url: { ...part.image_url, url: `${origin}${part.image_url.url}` } };
          }
          return part;
        });
        return { ...msg, content: fixedContent };
      }
      return msg;
    });

    // Inject tool-use system prompt when tools are enabled
    if (effectiveEnableTools) {
      fixedMessages.unshift({
        role: 'system',
        content: `你是「无界AI」的智能创作助手，集成了图片生成、视频生成、语言修图等专业工具。

## 核心规则
- 当用户**要求生成图片、画图、出图、设计、创作视觉内容**时：
  1. **先输出设计思路/分析结果**（风格定位、主体构思、场景设定、光影规划等，用简洁的中文描述，可折叠）
  2. **然后必须调用 generate_image 工具**生成图片
  - 不要只输出文字描述而不调用工具，也不要只调用工具而不输出分析
- 当用户**要求生成视频**时，同样先输出创作思路，再调用 generate_video 工具。
- 当用户**要求修改/编辑/修图**现有图片时，先分析图片内容和修改方案，再调用 edit_image 工具。
- 当用户上传图片并要求分析时，先分析图片内容，然后根据用户意图决定是否调用工具生成相关图片。
- 用户要求优化提示词时，输出优化后的提示词分析，**但如果用户明确要求生成图片，必须最终调用 generate_image**。
- 不要说"我来帮你生成"之类的话然后不调用工具——你必须实际调用工具来完成任务。
- 调用 generate_image 时，prompt 参数要包含完整详细的中文描述（风格、主体、场景、光线、构图等），不要只传简短关键词。
- aspectRatio 根据用户描述选择合适比例：1:1(默认)、16:9(横屏/风景)、9:16(竖屏/手机壁纸)、4:3、3:4 等。`
      });
    }

    // Inject canvas summary as context
    if (canvasSummary) {
      fixedMessages.unshift({
        role: 'system',
        content: `[画布状态]\n${canvasSummary}`
      });
    }

    // ============ Agent Loop with Function Calling ============
    // 当 enableTools=true 时，执行 Agent 循环：
    // LLM 思考 → 返回 tool_calls → 执行工具 → 结果回传 LLM → 继续思考
    // 直到 LLM 返回纯文本（无 tool_calls）或达到最大循环次数

    if (effectiveEnableTools && stream) {
      return handleAgentStream(fixedMessages, requestModel, chatApiKey, chatBaseUrl, origin, userId, model, providerId, isThinkingModel, availableTools, imageModel, imageProviderId, isAgentMode, taskContext);
    }

    // Non-stream or non-tool mode: original behavior
    const requestBody: Record<string, unknown> = {
      model: requestModel,
      messages: fixedMessages,
      stream,
      temperature: 0.7,
    };

    if (effectiveEnableTools) {
      requestBody.tools = availableTools;
      requestBody.tool_choice = 'auto';
    }

    if (isThinkingModel) {
      requestBody.reasoning_effort = 'medium';
    }

    const response = await fetchWithV1Retry(
      chatBaseUrl,
      '/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${chatApiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120000),
      }
    );

    // Fallback for thinking model
    if (!response.ok && isThinkingModel) {
      const errorText = await response.text().catch(() => '');
      console.warn(`[chat] Base model ${requestModel} with thinking params failed (${response.status}), trying ${model}...`);
      
      const retryBody: Record<string, unknown> = { model, messages: fixedMessages, stream, temperature: 0.7 };
      if (effectiveEnableTools) {
        retryBody.tools = availableTools;
        retryBody.tool_choice = 'auto';
      }
      const retryResponse = await fetchWithV1Retry(
        chatBaseUrl,
        '/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${chatApiKey}`,
          },
          body: JSON.stringify(retryBody),
          signal: AbortSignal.timeout(120000),
        }
      );
      
      if (!retryResponse.ok) {
        const retryError = await retryResponse.text().catch(() => '');
        console.error('Chat API error (both attempts):', errorText, retryError);
        let apiErrMsg = `API 调用失败: ${retryResponse.status}`;
        try {
          const ej = JSON.parse(retryError);
          apiErrMsg = ej.error?.message || ej.message || ej.msg || apiErrMsg;
        } catch { /* not JSON */ }
        if (/no\s+available\s+channel/i.test(retryError)) {
          apiErrMsg = '当前模型渠道暂不可用，请稍后重试或更换模型';
        }
        return NextResponse.json({ error: apiErrMsg }, { status: retryResponse.status });
      }
      
      if (stream && retryResponse.body) {
        await appendUserJsonl(userId, 'chat', { model, providerId, messageCount: messages.length, stream: true });
        return new NextResponse(retryResponse.body, {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
        });
      }
      const retryData = await retryResponse.json();
      
      // Handle tool_calls in non-stream mode
      if (effectiveEnableTools && retryData.choices?.[0]?.message?.tool_calls) {
        return handleNonStreamAgentLoop(retryData, fixedMessages, requestModel, chatApiKey, chatBaseUrl, origin, userId, model, providerId, availableTools, imageModel, imageProviderId, isAgentMode, taskContext);
      }
      
      await appendUserJsonl(userId, 'chat', { model, providerId, messageCount: messages.length, stream: false });
      return NextResponse.json(retryData);
    }

    // Primary response error handling
    if (!response.ok) {
      const error = await response.text().catch(() => '');
      console.error('Chat API error:', error);

      // /responses API fallback
      if (response.status === 403 && error.includes('/responses')) {
        console.info('[chat] /chat/completions not allowed, retrying with /responses endpoint...');
        try {
          const responsesBody: Record<string, unknown> = {
            model: requestModel,
            input: fixedMessages,
            stream,
          };
          const responsesRes = await fetchWithV1Retry(chatBaseUrl, '/responses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${chatApiKey}` },
            body: JSON.stringify(responsesBody),
            signal: AbortSignal.timeout(120000),
          });
          if (!responsesRes.ok) {
            const retryErr = await responsesRes.text().catch(() => '');
            console.error('Chat API /responses fallback error:', retryErr);
            return NextResponse.json({ error: `API 调用失败: ${responsesRes.status}` }, { status: responsesRes.status });
          }
          if (stream && responsesRes.body) {
            await appendUserJsonl(userId, 'chat', { model, providerId, messageCount: messages.length, stream: true });
            return new NextResponse(responsesRes.body, {
              headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
            });
          }
          const respData = await responsesRes.json();
          const outputText = Array.isArray(respData.output)
            ? respData.output.filter((o: { type: string }) => o.type === 'message').flatMap((o: { content: Array<{ text: string }> }) => o.content?.map((c: { text: string }) => c.text) || []).join('')
            : respData.output_text || JSON.stringify(respData.output || '');
          await appendUserJsonl(userId, 'chat', { model, providerId, messageCount: messages.length, stream: false });
          return NextResponse.json({
            id: respData.id || `chatcmpl-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: requestModel,
            choices: [{ index: 0, message: { role: 'assistant', content: outputText }, finish_reason: 'stop' }],
            usage: respData.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          });
        } catch (fallbackErr) {
          console.error('Chat API /responses fallback exception:', fallbackErr);
          return NextResponse.json({ error: `API 调用失败: ${response.status}` }, { status: response.status });
        }
      }

      if (error.includes('No available channel') || error.includes('model_not_found') || error.includes('not configured')) {
        return NextResponse.json({ error: `模型 ${model || requestModel} 在当前渠道暂不可用，请稍后重试或更换模型` }, { status: 503 });
      }
      // 外部API内部错误(如 [GetContextManager] / Key not found)翻译为中文友好提示
      if (error.includes('GetContextManager') || error.includes('context manager')) {
        return NextResponse.json({ error: 'API提供商内部错误(上下文管理失败)，请稍后重试或更换模型' }, { status: 502 });
      }
      if (error.includes('Key not found') || error.includes('key not found')) {
        return NextResponse.json({ error: 'API密钥无效或已过期，请检查管理员后台配置' }, { status: 401 });
      }
      // 尝试从错误JSON中提取友好消息
      let apiErrMsg = `API 调用失败: ${response.status}`;
      try {
        const ej = JSON.parse(error);
        apiErrMsg = ej.error?.message || ej.message || ej.msg || apiErrMsg;
      } catch { /* not JSON */ }
      return NextResponse.json({ error: apiErrMsg }, { status: response.status });
    }

    // Stream: forward directly (with APImart-style wrapper unwrapping)
    if (stream && response.body) {
      await appendUserJsonl(userId, 'chat', { model, providerId, messageCount: messages.length, stream: true });
      const { readable, writable } = new TransformStream();
      const reader = response.body.getReader();
      const writer = writable.getWriter();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let sseBuffer = '';
      // Unwrap SSE data: lines if {"code":200,"data":{...}} with no choices, re-emit data.data
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            sseBuffer += chunk;
            const lines = sseBuffer.split('\n');
            if (!chunk.endsWith('\n')) sseBuffer = lines.pop() || ''; else sseBuffer = '';
            for (const line of lines) {
              let outLine = line;
              if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                  const parsed = JSON.parse(line.slice(6));
                  if (parsed && typeof parsed === 'object' && 'code' in parsed && 'data' in parsed && parsed.data && !parsed.choices) {
                    outLine = 'data: ' + JSON.stringify(parsed.data);
                  }
                } catch { /* not JSON, passthrough */ }
              }
              await writer.write(encoder.encode(outLine + '\n'));
            }
          }
          if (sseBuffer) {
            let outLine = sseBuffer;
            if (sseBuffer.startsWith('data: ') && sseBuffer !== 'data: [DONE]') {
              try {
                const parsed = JSON.parse(sseBuffer.slice(6));
                if (parsed && typeof parsed === 'object' && 'code' in parsed && 'data' in parsed && parsed.data && !parsed.choices) {
                  outLine = 'data: ' + JSON.stringify(parsed.data);
                }
              } catch { /* passthrough */ }
            }
            await writer.write(encoder.encode(outLine));
          }
        } finally {
          await writer.close();
        }
      })();
      return new NextResponse(readable, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
      });
    }

    // Non-stream
    const rawData = await response.json();
    // Unwrap APImart-style wrapper: {code:200, data:{...OpenAI格式}}
    const data = (rawData && typeof rawData === 'object' && 'code' in rawData && 'data' in rawData && rawData.data && !rawData.choices)
      ? rawData.data
      : rawData;
    
    // Handle tool_calls in non-stream mode
    if (effectiveEnableTools && data.choices?.[0]?.message?.tool_calls) {
      return handleNonStreamAgentLoop(data, fixedMessages, requestModel, chatApiKey, chatBaseUrl, origin, userId, model, providerId, availableTools, imageModel, imageProviderId, undefined, taskContext);
    }
    
    await appendUserJsonl(userId, 'chat', { model, providerId, messageCount: messages.length, stream: false });
    return NextResponse.json(data);

  } catch (error) {
    console.error('Chat API error:', error);
    // 记录操作日志 - 聊天失败
    logError(OP_ACTIONS.CHAT, error, {
      userId: sessionUser?.id || 'anonymous',
      userName: sessionUser?.name,
      targetType: 'chat',
      durationMs: opTimer.end(),
    });
    // 退款：聊天请求完全失败时退还积分
    if (deductedCredits > 0 && sessionUser) {
      try {
        await refundCredits(sessionUser.id, deductedCredits, `聊天请求失败退款`);
      } catch (refundErr) { console.error('[chat] Refund failed:', refundErr); }
    }
    return NextResponse.json(
      { error: `服务器错误: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}

// ============ Agent Stream Handler ============

async function handleAgentStream(
  fixedMessages: Array<Record<string, unknown>>,
  requestModel: string,
  chatApiKey: string,
  chatBaseUrl: string,
  origin: string,
  userId: string,
  model: string,
  providerId: string | undefined,
  isThinkingModel: boolean,
  availableTools: typeof CHAT_TOOLS,
  imageModel?: string,
  imageProviderId?: string,
  isAgentMode?: boolean,
  taskContext: ChatTaskContext = {},
): Promise<NextResponse> {
  const agentModeEnabled = isAgentMode ?? false; // 捕获isAgentMode到局部变量
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const currentMessages = [...fixedMessages];
      let iteration = 0;

      try {
        while (iteration < MAX_AGENT_ITERATIONS) {
          iteration++;
          
          const toolChoice = getAgentToolChoice(agentModeEnabled, iteration);
          
          const requestBody: Record<string, unknown> = {
            model: requestModel,
            messages: currentMessages,
            stream: true,
            temperature: 0.7,
            tools: availableTools,
            tool_choice: toolChoice,
          };

          if (isThinkingModel) {
            requestBody.reasoning_effort = 'medium';
          }

          const response = await fetchWithV1Retry(chatBaseUrl, '/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${chatApiKey}`,
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(agentModeEnabled ? 300000 : 120000), // Agent模式5分钟超时
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            let apiErrMsg = `API 调用失败: ${response.status}`;
            try {
              const ej = JSON.parse(errorText);
              apiErrMsg = ej.error?.message || ej.message || ej.msg || apiErrMsg;
            } catch { /* not JSON */ }
            // Check if it's a tools-not-supported error — if so, retry without tools
            if (errorText.includes('tool') || errorText.includes('function') || response.status === 400) {
              console.warn('[chat-agent] Model may not support function calling, falling back to no-tools mode');
              // Retry without tools
              const fallbackBody: Record<string, unknown> = {
                model: requestModel,
                messages: currentMessages,
                stream: true,
                temperature: 0.7,
              };
              const fallbackResponse = await fetchWithV1Retry(chatBaseUrl, '/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${chatApiKey}`,
                },
                body: JSON.stringify(fallbackBody),
                signal: AbortSignal.timeout(agentModeEnabled ? 300000 : 120000), // Agent模式5分钟超时
              });
              if (fallbackResponse.ok && fallbackResponse.body) {
                const reader = fallbackResponse.body.getReader();
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  controller.enqueue(value);
                }
              }
              break; // Exit loop — no tools support
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: apiErrMsg })}\n\n`));
            break;
          }

          if (!response.body) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'API 未返回流' })}\n\n`));
            break;
          }

          // Parse streaming response, accumulate tool_calls
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let accumulatedToolCalls: Array<{ id: string; function: { name: string; arguments: string }; type: string }> = [];
          let assistantContent = '';
          let finishReason = '';
          let hasToolCalls = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              const data = trimmed.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const choice = parsed.choices?.[0];
                if (!choice) continue;

                const delta = choice.delta;

                // Accumulate tool_calls from delta
                if (delta?.tool_calls) {
                  hasToolCalls = true;
                  accumulatedToolCalls = parseToolCallsFromStream(accumulatedToolCalls, delta.tool_calls);
                  
                  // Send a tool_call_start event to the frontend so it can show progress
                  for (const tcDelta of delta.tool_calls) {
                    if (tcDelta.function?.name) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        type: 'tool_call_start',
                        tool_name: accumulatedToolCalls[tcDelta.index]?.function?.name || '',
                        tool_call_id: accumulatedToolCalls[tcDelta.index]?.id || '',
                        iteration,
                      })}\n\n`));
                    }
                  }
                }

                // Forward text content to client
                if (delta?.content) {
                  assistantContent += delta.content;
                  // Forward the original SSE event to the frontend
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
                }

                if (choice.finish_reason) {
                  finishReason = choice.finish_reason;
                }
              } catch {
                // Non-JSON line, skip
              }
            }
          }

          // If no tool_calls, we're done — the text content has already been forwarded
          if (!hasToolCalls || finishReason !== 'tool_calls') {
            break;
          }

          // ============ Execute Tool Calls ============
          // Complete any unfinished tool_calls arguments
          const completedToolCalls = accumulatedToolCalls.filter(tc => tc.id && tc.function.name);
          
          // Add assistant message with tool_calls to conversation
          currentMessages.push({
            role: 'assistant',
            content: assistantContent || null,
            tool_calls: completedToolCalls,
          });

          // Execute each tool call and add results
          for (const toolCall of completedToolCalls) {
            const toolName = toolCall.function.name;
            let toolArgs: Record<string, unknown>;
            try {
              toolArgs = JSON.parse(toolCall.function.arguments || '{}');
            } catch {
              toolArgs = {};
            }

            // Send tool execution progress event
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'tool_execution_start',
              toolName,
              toolCallId: toolCall.id,
              toolArgs,
              label: toolName === 'generate_image' ? '正在生成图片...' :
                     toolName === 'generate_video' ? '正在生成视频...' :
                     toolName === 'analyze_image' ? '正在分析图片...' :
                     `正在执行 ${toolName}...`,
              iteration,
            })}\n\n`));

            // Execute the tool
            let toolResult: ToolCallResult;
            try {
              toolResult = await Promise.race([
                executeToolCall(toolName, toolArgs, {
                  chatApiKey,
                  chatBaseUrl,
                  origin,
                  userId,
                  imageModel: imageModel || '',
                  imageProviderId: imageProviderId || '',
                  ...taskContext,
                }),
                new Promise<ToolCallResult>((_, reject) =>
                  setTimeout(() => reject(new Error('Tool execution timeout')), TOOL_EXECUTION_TIMEOUT)
                ),
              ]);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              toolResult = { success: false, error: msg, resultText: `工具执行超时或出错: ${msg}` };
            }

            // Send tool execution result event
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'tool_execution_result',
              toolName,
              toolCallId: toolCall.id,
              success: toolResult.success,
              error: toolResult.error,
              imageUrls: toolResult.imageUrls || [],
              videoUrls: toolResult.videoUrls || [],
              taskIds: toolResult.taskIds || [],
              iteration,
            })}\n\n`));

            // Add tool result to conversation
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: toolResult.resultText,
            });
          }

          // Send tool execution complete event — LLM will continue thinking
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'tool_execution_complete',
            iteration,
            toolsExecuted: completedToolCalls.length,
          })}\n\n`));

          // Continue the loop — LLM will now see the tool results and decide next action
        }

        // Send final [DONE]
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();

        await appendUserJsonl(userId, 'chat', { model, providerId, messageCount: fixedMessages.length, stream: true, agentIterations: iteration });
      } catch (err) {
        console.error('[chat-agent] Stream error:', err);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `Agent 执行出错: ${err instanceof Error ? err.message : String(err)}` })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// ============ Non-Stream Agent Loop ============

async function handleNonStreamAgentLoop(
  initialData: { choices: Array<{ message: { tool_calls?: unknown[]; content?: string } }> },
  fixedMessages: Array<Record<string, unknown>>,
  requestModel: string,
  chatApiKey: string,
  chatBaseUrl: string,
  origin: string,
  userId: string,
  model: string,
  providerId: string | undefined,
  availableTools: typeof CHAT_TOOLS,
  imgModel?: string,
  imgProviderId?: string,
  isAgentMode?: boolean,
  taskContext: ChatTaskContext = {},
): Promise<NextResponse> {
  const agentModeEnabled = isAgentMode ?? false;
  const currentMessages = [...fixedMessages];
  const allToolResults: Array<{ toolName: string; result: ToolCallResult }> = [];
  let iteration = 0;

  // Add the initial assistant message with tool_calls
  const initialChoice = initialData.choices[0];
  if (initialChoice?.message) {
    currentMessages.push(initialChoice.message as Record<string, unknown>);
  }

  while (iteration < MAX_AGENT_ITERATIONS) {
    iteration++;
    const toolCalls = (currentMessages[currentMessages.length - 1] as Record<string, unknown>)?.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined;
    
    if (!toolCalls || toolCalls.length === 0) break;

    // Execute each tool call
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      let toolArgs: Record<string, unknown>;
      try {
        toolArgs = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        toolArgs = {};
      }

      const toolResult = await executeToolCall(toolName, toolArgs, {
        chatApiKey,
        chatBaseUrl,
        origin,
        userId,
        imageModel: imgModel,
        imageProviderId: imgProviderId,
        ...taskContext,
      });

      allToolResults.push({ toolName, result: toolResult });

      currentMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult.resultText,
      });
    }

    // Call LLM again with tool results
    const nextRequestBody: Record<string, unknown> = {
      model: requestModel,
      messages: currentMessages,
      stream: false,
      temperature: 0.7,
      tools: availableTools,
      tool_choice: 'auto',
    };

    const nextResponse = await fetchWithV1Retry(chatBaseUrl, '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${chatApiKey}`,
      },
      body: JSON.stringify(nextRequestBody),
      signal: AbortSignal.timeout(agentModeEnabled ? 300000 : 120000), // Agent模式5分钟超时
    });

    if (!nextResponse.ok) break;

    const nextData = await nextResponse.json();
    const nextMessage = nextData.choices?.[0]?.message;
    if (!nextMessage) break;

    currentMessages.push(nextMessage as Record<string, unknown>);

    // If no more tool_calls, we're done
    if (!nextMessage.tool_calls || nextMessage.tool_calls.length === 0) {
      // Collect all image/video URLs from tool results
      const allImageUrls = allToolResults.flatMap(r => r.result.imageUrls || []);
      const allVideoUrls = allToolResults.flatMap(r => r.result.videoUrls || []);
      const allTaskIds = allToolResults.flatMap(r => r.result.taskIds || []);

      await appendUserJsonl(userId, 'chat', { model, providerId, messageCount: fixedMessages.length, stream: false, agentIterations: iteration });
      
      // Return the final response with tool results metadata
      return NextResponse.json({
        ...nextData,
        _toolResults: allToolResults.map(r => ({
          toolName: r.toolName,
          success: r.result.success,
          imageUrls: r.result.imageUrls || [],
          videoUrls: r.result.videoUrls || [],
          taskIds: r.result.taskIds || [],
        })),
        _imageUrls: allImageUrls,
        _videoUrls: allVideoUrls,
        _taskIds: allTaskIds,
      });
    }
  }

  // Fallback: return last data
  await appendUserJsonl(userId, 'chat', { model, providerId, messageCount: fixedMessages.length, stream: false, agentIterations: iteration });
  return NextResponse.json(initialData);
}
