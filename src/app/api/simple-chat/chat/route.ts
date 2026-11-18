import { NextRequest } from 'next/server';
import { findProviderForModel, findProviderById } from '@/lib/server-api-config';
import { prepareChatVisionMessages } from '@/lib/chat-vision-image';
import { buildSkillInstructions, selectSimpleChatSkill } from '@/lib/simple-chat-skills';
import { describeFittedParams, fitImageParams, parseImageRequest } from '@/lib/simple-chat-image-params';
import type { ApiKind } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { SearchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { fetchWithV1Retry, API_TIMEOUTS, getInternalApiUrl } from '@/lib/api-helpers';
import { resolveChatControls } from '@/lib/chat-generation-controls';
import { getInternalRequestHeaders } from '@/lib/api-auth';
import { buildWorkModeInstructions, buildWorkPlan, normalizeWorkMode } from '@/lib/chatgpt-work-mode';
import { IMAGE_ASPECT_RATIOS, describeUpstreamChatError, resolveToolAspectRatio } from '@/lib/simple-chat-upstream';

const DEFAULT_SYSTEM_PROMPT = `你是无界AI的智能助手。你可以：
1. 回答用户的各种问题
2. 当用户需要生成图片时，使用 generate_image 工具
3. 支持多模态理解（图片识别）

请保持回复简洁、专业、友好。
**重要**：默认以自然语言回复用户，不要输出 JSON；只有在系统提示"已加载技能"且该技能要求输出 json 代码块时，才按技能要求输出。`;

interface KnowledgeItem {
  id: string;
  type: 'file' | 'url' | 'note';
  title: string;
  content: string;
}

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'auto' } };

function latestSimpleChatGoal(items: Array<{ role?: string; content?: string }>): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.role === 'user' && items[index]?.content?.trim()) return items[index]?.content?.trim() || '';
  }
  return '';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    messages?: { role: string; content: string; images?: string[] }[];
    model?: string;
    providerId?: string;
    stream?: boolean;
    webSearch?: boolean;
    knowledgeItems?: KnowledgeItem[];
    projectId?: string;
    taskId?: string;
    imageModel?: string;
    imageProviderId?: string;
    memories?: string[];
    deepAnalysis?: boolean;
    i2iStrength?: number;
    reasoningEffort?: string;
    responseSpeed?: string;
    workMode?: 'chat' | 'work';
    skillId?: string;
  };
  const messages = body.messages || [];
  // No hard-coded fallback: a stale default model is rejected by the relay with an opaque error.
  const model = (body.model || '').trim();
  const providerId = body.providerId || '';
  const webSearch = body.webSearch || false;
  const knowledgeItems = body.knowledgeItems || [];
  // The image model must be chosen explicitly; a chat model cannot generate images.
  const imageModel = body.imageModel || '';
  const imageProviderId = body.imageProviderId || '';
  const memories = body.memories || [];
  const deepAnalysis = body.deepAnalysis || false;
  const workMode = normalizeWorkMode(body.workMode);
  const workPlan = workMode === 'work' ? buildWorkPlan(latestSimpleChatGoal(messages)) : null;
  const i2iStrength = body.i2iStrength || 0.7;

  const user = await getSessionUser(request);
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const productTypes = (user.productType || '').split(',').map(type => type.trim()).filter(Boolean);
  if (user.role !== 'admin' && (
    user.apiPermissions?.chat === false ||
    (productTypes.length > 0 && !productTypes.includes('chat'))
  )) {
    return Response.json({ error: 'You are not authorized to use intelligent chat' }, { status: 403 });
  }

  if (!model) {
    return Response.json({ error: '请先在输入框上方选择一个对话模型' }, { status: 400 });
  }

  // 查找提供商
  const provider = await findProviderForModel(model, 'chat' as ApiKind, providerId || undefined);
  if (!provider) {
    return Response.json({ error: '未找到可用的 API 提供商' }, { status: 400 });
  }

  // 模型权限校验：非管理员用户需检查 chatModels 授权列表
  if (user.role !== 'admin') {
    const allowed = user.chatModels;
    if (allowed && allowed.length > 0 && !allowed.includes(model)) {
      return Response.json({ error: '您没有权限使用此模型，请联系管理员' }, { status: 403 });
    }
  }

  const apiKey = provider.apiKey;
  const baseUrl = provider.baseUrl?.replace(/\/+$/, '') || '';
  const chatControls = resolveChatControls(model, provider, body.reasoningEffort, body.responseSpeed);

  // 构建增强的 system prompt（指令 + 知识库 + 联网搜索结果）
  let enhancedSystemPrompt = DEFAULT_SYSTEM_PROMPT;
  if (workPlan) enhancedSystemPrompt += `\n\n${buildWorkModeInstructions(workPlan)}`;

  // Skill routing: load only the instructions of the skill that matches this request.
  const latestUser = [...messages].reverse().find(m => m.role === 'user');
  const skillSelection = selectSimpleChatSkill(latestUser?.content || '', {
    explicitSkillId: body.skillId,
    hasImages: Boolean(latestUser?.images?.length),
  });
  const activeSkill = skillSelection.skill;
  if (activeSkill) {
    enhancedSystemPrompt += buildSkillInstructions(activeSkill);
    if (skillSelection.source === 'command' && latestUser) latestUser.content = skillSelection.text || latestUser.content;
  }

  // 用户记忆注入
  if (memories.length > 0) {
    const memoryContext = memories.slice(0, 20).map((m, i) => `${i + 1}. ${m}`).join('\n');
    enhancedSystemPrompt += `\n\n## 用户记忆\n以下是关于用户的长期记忆信息，请在回答时参考：\n${memoryContext}`;
  }

  // 深度图片分析模式（文案策划专用）
  if (deepAnalysis) {
    enhancedSystemPrompt += `\n\n## 深度图片分析模式（文案策划专业版）
用户正在请求对图片进行深度分析。请作为资深文案策划与品牌策略专家，输出结构化分析报告，包含以下维度（可根据图片类型灵活裁剪）：

1. **视觉概览**：图片整体风格、色调、构图、视觉焦点
2. **文案拆解**：标题/正文/CTA 的用词策略、语气、句式特点
3. **受众画像**：目标人群特征、痛点、情感诉求
4. **策略分析**：品牌定位、差异化卖点、传播目的
5. **优劣评估**：亮点（3 条）+ 可改进点（3 条）
6. **行动清单**：可直接落地的文案建议（至少 3 条，含示例文案）

要求：
- 使用 Markdown 格式输出（标题、列表、加粗）
- 每个维度要有具体洞察，避免空泛描述
- 文案建议要给出可直接使用的示例`;
  }

  // 知识库注入
  if (knowledgeItems.length > 0) {
    const kbContext = knowledgeItems
      .filter(k => k.content)
      .map(k => {
        const label = k.type === 'file' ? `[文件: ${k.title}]` : k.type === 'url' ? `[链接: ${k.title}]` : `[笔记: ${k.title}]`;
        return `${label}\n${k.content.slice(0, 2000)}`;
      })
      .join('\n\n---\n\n');
    if (kbContext) {
      enhancedSystemPrompt += `\n\n## 项目知识库\n以下是用户提供的知识库内容，请基于这些内容回答用户问题：\n\n${kbContext}`;
    }
  }

  // 联网搜索
  let searchResults: string | null = null;
  let searchError: string | null = null;
  if (webSearch) {
    try {
      // 取最后一条用户消息作为搜索 query
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      const searchQuery = lastUserMsg?.content || '';
      if (searchQuery) {
        const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
        const searchClient = new SearchClient(new Config(), customHeaders);
        console.log('[simple-chat] Web search query:', searchQuery.slice(0, 100));
        const searchResp = await searchClient.webSearch(searchQuery, 5, true);
        console.log('[simple-chat] Web search response:', JSON.stringify({
          webItemsCount: searchResp.web_items?.length || 0,
          hasSummary: !!searchResp.summary,
        }));

        if (searchResp.web_items && searchResp.web_items.length > 0) {
          const items = searchResp.web_items.slice(0, 5).map((item, i) =>
            `[${i + 1}] ${(item.title || '').replace(/\n/g, ' ')}\nURL: ${item.url || '无'}\n摘要: ${(item.snippet || '').replace(/\n/g, ' ')}${item.summary ? '\nAI摘要: ' + item.summary.replace(/\n/g, ' ') : ''}`
          ).join('\n\n');

          searchResults = `## 联网搜索结果\n搜索关键词: "${searchQuery}"\n\n${items}`;
          if (searchResp.summary) {
            searchResults += `\n\n## AI 搜索摘要\n${searchResp.summary}`;
          }
          enhancedSystemPrompt += `\n\n${searchResults}\n\n请基于以上联网搜索结果回答用户问题。如有引用，请标注来源编号（如 [1]、[2]）。`;
        } else {
          console.warn('[simple-chat] Web search returned 0 results');
          enhancedSystemPrompt += `\n\n(联网搜索未找到相关结果，请基于已有知识回答)`;
        }
      }
    } catch (e: unknown) {
      const message = errorMessage(e, 'Web search unavailable');
      const errorDetail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error('[simple-chat] Web search failed:', message, errorDetail);
      if (e instanceof Error && e.stack) {
        console.error('[simple-chat] Web search stack:', e.stack.slice(0, 500));
      }
      searchError = message;
      enhancedSystemPrompt += `\n\n(联网搜索暂时不可用: ${message})`;
    }
  }

  // 构建消息列表
  const rawMessages = [
    { role: 'system', content: enhancedSystemPrompt as string | ChatContentPart[] },
    ...messages.map((m) => {
      const parts: ChatContentPart[] = [{ type: 'text', text: m.content }];
      if (m.images && m.images.length > 0) {
        for (const img of m.images) {
          parts.push({
            type: 'image_url',
            image_url: { url: img, detail: 'auto' },
          });
        }
      }
      if (parts.length === 1) {
        return { role: m.role, content: m.content as string | ChatContentPart[] };
      }
      return { role: m.role, content: parts as string | ChatContentPart[] };
    }),
  ];
  // Inline every image as a size-normalized data URL with detail "high" and real pixel facts.
  // Relays often cannot fetch our /api/serve-upload paths, which made the model guess.
  const fullMessages = await prepareChatVisionMessages(rawMessages);

  // Image tool: the model's spec decides which ratio / resolution / quality are valid.
  const imageProvider = imageProviderId ? await findProviderById(imageProviderId) : null;
  const imageProviderHint = `${imageProviderId} ${imageProvider?.name || ''} ${imageProvider?.baseUrl || ''}`;

  // SSE 流式响应
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Execution steps shown under the reply (like ChatGPT's "working" trace).
      type StepStatus = 'pending' | 'running' | 'done' | 'failed';
      let steps: { label: string; status: StepStatus; detail?: string }[] = (activeSkill?.steps || ['理解需求', '生成回复'])
        .map((label, index) => ({ label, status: index === 0 ? 'running' : 'pending' }));
      const emitSteps = () => send({ type: 'steps', skill: activeSkill ? { id: activeSkill.id, name: activeSkill.name } : null, steps });
      const setStep = (index: number, status: StepStatus, detail?: string) => {
        if (!steps[index]) return;
        steps = steps.map((step, i) => {
          if (i === index) return { ...step, status, ...(detail ? { detail } : {}) };
          if (status === 'done' && i === index + 1 && step.status === 'pending') return { ...step, status: 'running' };
          return step;
        });
        emitSteps();
      };
      const failCurrentStep = (detail: string) => {
        const index = steps.findIndex(step => step.status === 'running');
        setStep(index >= 0 ? index : steps.length - 1, 'failed', detail.slice(0, 160));
      };
      const finishSteps = () => {
        if (steps.some(step => step.status === 'failed')) return;
        steps = steps.map(step => ({ ...step, status: 'done' }));
        emitSteps();
      };
      const switchToImageSteps = () => {
        if (activeSkill?.id === 'image') return;
        steps = ['理解画面需求', '匹配模型比例与分辨率', '提交生图任务', '等待供应商返回结果']
          .map((label, index) => ({ label, status: index === 0 ? 'running' : 'pending' }));
      };

      try {
        send({
          type: 'generation_controls',
          appliedReasoningEffort: chatControls.appliedReasoningEffort,
          appliedResponseSpeed: chatControls.appliedResponseSpeed,
          degraded: chatControls.degraded,
          notices: chatControls.notices,
          support: chatControls.support,
        });
        if (workPlan) send({ type: 'work_plan', workPlan });
        emitSteps();

        // 先发送搜索结果（如果有联网搜索）
        if (webSearch) {
          if (searchResults) {
            // 解析出搜索条目
            const resultCount = (searchResults.match(/\[\d+\]/g)?.length || 0);
            send({ type: 'search_status', status: 'completed', resultCount, searchResults });
          } else {
            send({ type: 'search_status', status: 'failed', resultCount: 0, error: searchError || '未找到相关结果' });
          }
        }

        // 添加工具定义
        const tools: Record<string, unknown>[] = [
          {
            type: 'function',
            function: {
              name: 'generate_image',
              description: 'Generate an image based on a text description. Use this when the user wants to create, draw, or generate an image.',
              parameters: {
                type: 'object',
                properties: {
                  prompt: {
                    type: 'string',
                    description: 'A detailed description of the image to generate',
                  },
                  aspect_ratio: {
                    type: 'string',
                    enum: [...IMAGE_ASPECT_RATIOS],
                    description: 'Aspect ratio of the image, default 1:1',
                  },
                  use_reference_image: {
                    type: 'boolean',
                    description: 'True when the user uploaded an image and wants the result based on it (edit, restyle, keep the product).',
                  },
                  reference_description: {
                    type: 'string',
                    description: 'When use_reference_image is true: a short factual description of the uploaded image subject.',
                  },
                },
                required: ['prompt'],
              },
            },
          },
        ];

        const fetchRes = await fetchWithV1Retry(
          baseUrl,
          '/chat/completions',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: fullMessages,
              stream: true,
              tools,
              tool_choice: 'auto',
              ...chatControls.requestParams,
            }),
          },
          true,
          API_TIMEOUTS.chat
        );

        if (!fetchRes.ok) {
          const errText = await fetchRes.text().catch(() => '');
          console.warn(`[simple-chat] upstream chat failed: model=${model}, provider=${provider.name}, status=${fetchRes.status}, body=${errText.slice(0, 200)}`);
          failCurrentStep(`对话模型返回 ${fetchRes.status}`);
          send({ type: 'error', error: describeUpstreamChatError(fetchRes.status, errText, model) });
          controller.close();
          return;
        }

        const reader = fetchRes.body?.getReader();
        if (!reader) {
          send({ type: 'error', error: '无法读取响应流' });
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        const toolCalls: Record<number, { id: string; name: string; arguments: string }> = {};
        let fullContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (jsonStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed.choices?.[0]?.delta;
              if (!delta) continue;

              // 文本内容
              if (delta.content) {
                if (!fullContent && steps[0]?.status === 'running') setStep(0, 'done');
                fullContent += delta.content;
                send({ type: 'text', content: delta.content });
              }

              // 工具调用
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!toolCalls[idx]) {
                    toolCalls[idx] = { id: tc.id || '', name: tc.function?.name || '', arguments: '' };
                  }
                  if (tc.function?.name) toolCalls[idx].name = tc.function.name;
                  if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
                }
              }
            } catch { /* 忽略解析错误 */ }
          }
        }

        // 处理工具调用
        if (Object.keys(toolCalls).length > 0) {
          const tc = toolCalls[0];
          if (tc.name === 'generate_image') {
            switchToImageSteps();
            setStep(0, 'done');
            send({ type: 'tool_status', tool: 'generating_image', status: 'generating', label: '正在生成图片...' });

            let args: {
              prompt?: string; size?: string; aspect_ratio?: string;
              use_reference_image?: boolean; reference_description?: string;
            } = {};
            try { args = JSON.parse(tc.arguments); } catch { /* ignore */ }

            const imgPrompt = args.prompt || fullContent.slice(0, 500);
            const failImage = (reason: string) => {
              console.warn(`[simple-chat] image generation failed: model=${imageModel || '(none)'}, reason=${reason.slice(0, 200)}`);
              failCurrentStep(reason);
              send({ type: 'tool_status', tool: 'generating_image', status: 'failed', label: `图片生成失败：${reason}` });
            };

            // Size / ratio / quality: the user's own words win over the model's tool arguments,
            // then everything is fitted to what the selected image model supports.
            const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
            const userText = lastUserMsg?.content || '';
            const requested = { ...parseImageRequest(imgPrompt), ...parseImageRequest(userText) };
            const fitted = fitImageParams(requested, resolveToolAspectRatio(args), imageModel, imageProviderHint);
            setStep(1, 'done', [describeFittedParams(fitted), ...fitted.notes].join('；'));

            // Image-to-image: the chat model decides via use_reference_image; the keyword check is a fallback.
            const userImages = lastUserMsg?.images || [];
            const i2iIntent = /(这张图|这张|此图|图片|参考|改成|调整|换成|基于|类似风格|同款|根据这|保持|不变)/.test(userText);
            const wantsReference = args.use_reference_image ?? i2iIntent;
            const referenceImage = userImages.length > 0 && wantsReference ? userImages[0] : undefined;
            // The chat model has already looked at the image, so its description is passed along.
            // This lets /api/generate skip its own vision identification pass (20s+ in production logs).
            const referenceDescription = (args.reference_description || '').trim() || imgPrompt.slice(0, 300);

            if (!imageModel) {
              failImage('未选择图像模型，请在输入框上方选择一个图像模型后重试');
            } else try {
              // /api/generate with submitOnly only records the task; /api/poll-task performs the real
              // provider submission and only does so for a cookie-authenticated user. Forward the
              // caller's session cookie so the task is actually submitted (and billed) like canvas calls.
              const sessionCookie = request.headers.get('cookie');
              const internalHeaders: Record<string, string> = {
                ...(await getInternalRequestHeaders(user.id, user.role === 'admin' ? 'admin' : 'user')),
                ...(sessionCookie ? { cookie: sessionCookie } : {}),
              };
              // Server-side self-calls go to the local port; the public origin may not be reachable from inside the container.
              const imgRes = await fetch(getInternalApiUrl('/api/generate'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...internalHeaders },
                body: JSON.stringify({
                  prompt: imgPrompt,
                  model: imageModel,
                  providerId: imageProviderId,
                  aspectRatio: fitted.aspectRatio,
                  ...(fitted.quality ? { quality: fitted.quality } : {}),
                  ...(fitted.resolution ? { resolution: fitted.resolution } : {}),
                  outputCount: 1,
                  submitOnly: true,
                  // Use exactly the model the user picked. If it fails, surface the error instead of
                  // silently switching to another model — that mismatch left the provider panel showing
                  // "已退回" while the chat kept polling a different model as if still generating.
                  disableModelFallback: true,
                  projectId: body.projectId,
                  ...(referenceImage ? {
                    referenceImages: [referenceImage],
                    referenceDescriptions: [referenceDescription],
                    referenceMode: 'reference',
                    strength: i2iStrength,
                  } : {}),
                }),
                signal: AbortSignal.timeout(60000),
              });
              const imgData = await imgRes.json().catch(() => ({})) as {
                success?: boolean; error?: string; taskIds?: string[]; taskId?: string; imageUrls?: string[]; directImageUrls?: string[];
              };
              const directUrls = imgData.directImageUrls || imgData.imageUrls;
              const taskIds = imgData.taskIds || (imgData.taskId ? [imgData.taskId] : []);

              if (!imgRes.ok || !imgData.success) {
                failImage(imgData.error || `图像接口返回 ${imgRes.status}`);
              } else if (directUrls?.length && taskIds.length === 0) {
                setStep(2, 'done');
                send({ type: 'image', imageUrl: directUrls[0], prompt: imgPrompt });
                setStep(3, 'done');
              } else if (taskIds.length > 0) {
                const taskId = taskIds[0];
                setStep(2, 'done', `任务 ${taskId.slice(0, 12)}`);
                send({ type: 'tool_status', tool: 'generating_image', status: 'polling', label: '图片生成中...', taskId });

                let settled = false;
                for (let attempt = 0; attempt < 200; attempt += 1) {
                  await new Promise(r => setTimeout(r, attempt === 0 ? 500 : 2000));
                  const pollRes = await fetch(getInternalApiUrl('/api/poll-task'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...internalHeaders },
                    body: JSON.stringify({ taskId, model: imageModel, providerId: imageProviderId }),
                    signal: AbortSignal.timeout(30000),
                  }).catch(() => null);
                  if (!pollRes) continue;
                  const pollData = await pollRes.json().catch(() => ({})) as {
                    status?: string; imageUrl?: string; imageUrls?: string[]; progress?: number; error?: string;
                  };
                  const resultUrl = pollData.imageUrl || pollData.imageUrls?.[0];
                  if (pollData.status === 'completed' && resultUrl) {
                    send({ type: 'image', imageUrl: resultUrl, prompt: imgPrompt });
                    setStep(3, 'done');
                    settled = true;
                    break;
                  }
                  if (pollData.status === 'failed' || pollData.status === 'cancelled') {
                    failImage(pollData.error || '上游返回失败');
                    settled = true;
                    break;
                  }
                  send({ type: 'tool_status', tool: 'generating_image', status: 'polling', label: `图片生成中...${pollData.progress ? ` ${pollData.progress}%` : ''}`, taskId, progress: pollData.progress });
                }
                if (!settled) failImage('等待超时，图片可能仍在生成，请稍后在历史中查看');
              } else {
                failImage('图像接口未返回图片或任务编号');
              }
            } catch (e: unknown) {
              failImage(errorMessage(e, '未知错误'));
            }
          }
        }

        finishSteps();
        send({ type: 'done' });
      } catch (e: unknown) {
        failCurrentStep(errorMessage(e, '未知错误'));
        send({ type: 'error', error: errorMessage(e, '未知错误') });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Transfer-Encoding': 'chunked',
    },
  });
}
