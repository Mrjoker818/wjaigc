import { NextRequest } from 'next/server';
import { findProviderForModel, findProviderById, findProvidersForModel } from '@/lib/server-api-config';
import { prepareChatVisionMessages } from '@/lib/chat-vision-image';
import { buildSkillInstructions, selectSimpleChatSkill } from '@/lib/simple-chat-skills';
import { describeFittedParams, fitImageParams, parseImageCount, parseImageRequest } from '@/lib/simple-chat-image-params';
import type { ApiKind } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import { fetchWithV1Retry, API_TIMEOUTS, getInternalApiUrl } from '@/lib/api-helpers';
import { resolveChatControls } from '@/lib/chat-generation-controls';
import { getInternalRequestHeaders } from '@/lib/api-auth';
import { buildWorkModeInstructions, buildWorkPlan, normalizeWorkMode } from '@/lib/chatgpt-work-mode';
import { IMAGE_ASPECT_RATIOS, describeUpstreamChatError, resolveToolAspectRatio } from '@/lib/simple-chat-upstream';
import { runWebSearch, extractReasoningDelta, type WebSearchItem } from '@/lib/simple-chat-tools';

const DEFAULT_SYSTEM_PROMPT = `你是无界AI的智能助手，具备自主使用工具的能力（类似 ChatGPT 的工作方式）：
1. 回答用户的各种问题，支持多模态理解（图片识别）
2. 当用户需要生成图片时，使用 generate_image 工具
3. 当问题涉及实时信息、最新事件、具体数据、你不确定的事实时，先用 web_search 工具联网检索，再基于检索结果作答

工具使用原则：
- 自主判断是否需要工具。需要时直接调用，不要询问用户"要不要我搜索"。
- 可以多步进行：先调用工具 → 阅读结果 → 如仍不足则再次调用 → 最后综合作答。
- 使用 web_search 结果作答时，必须在引用处标注来源编号（如 [1]、[2]）。

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
    memories?: Array<string | { category?: string; content?: string }>;
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

  // 同模型跨提供商自动切换：收集所有提供同一模型的已启用提供商作为备选链。
  // 当首选提供商（中转站）临时不稳定（5xx/429/网络错误）时，自动切到下一个同模型提供商重试。
  const fallbackProviders = await findProvidersForModel(model, 'chat' as ApiKind, providerId || undefined);
  const providerChain = [provider, ...fallbackProviders.filter(p => p.id !== provider.id)];

  // 模型权限校验：非管理员用户需检查 chatModels 授权列表
  if (user.role !== 'admin') {
    const allowed = user.chatModels;
    if (allowed && allowed.length > 0 && !allowed.includes(model)) {
      return Response.json({ error: '您没有权限使用此模型，请联系管理员' }, { status: 403 });
    }
  }

  // 生成控制（推理档位/响应速度）按首选提供商解析，用于流开始前告知前端已应用的设置。
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

  // 用户记忆注入（兼容字符串数组与 {category, content} 对象数组两种前端格式）
  const memoryLines = memories
    .slice(0, 20)
    .map((m) => {
      if (typeof m === 'string') return m.trim();
      if (m && typeof m === 'object') {
        const content = (m.content || '').trim();
        if (!content) return '';
        return m.category ? `【${m.category}】${content}` : content;
      }
      return '';
    })
    .filter((line) => line.length > 0);
  if (memoryLines.length > 0) {
    const memoryContext = memoryLines.map((line, i) => `${i + 1}. ${line}`).join('\n');
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

  // 联网搜索现在是模型可自主调用的工具（web_search），由下方的 Agent 循环驱动。
  // 当用户显式打开"联网搜索"开关时，提示模型本轮应优先检索最新信息。
  const forwardHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  if (webSearch) {
    enhancedSystemPrompt += `\n\n（用户已开启联网搜索：本轮如涉及实时信息或最新事实，请优先调用 web_search 工具检索后再作答。）`;
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

        // 联网搜索现在是模型可自主调用的工具（web_search），结果通过下方 Agent 循环实时推送。

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
                  image_count: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 4,
                    description: 'How many image variations to generate (1-4). Use the number the user asked for, e.g. "3 张方案" -> 3. Default 1.',
                  },
                  use_reference_image: {
                    type: 'boolean',
                    description: 'True when the user has uploaded an image anywhere in this conversation and wants the result based on it (edit, restyle, keep the product, continue the same design). Keep this true on follow-up generations that should stay consistent with that image.',
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
          {
            type: 'function',
            function: {
              name: 'web_search',
              description: 'Search the web for real-time or up-to-date information (news, prices, recent events, facts you are unsure about). Returns ranked results with URLs you must cite as [1], [2].',
              parameters: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'A concise search query in the language most likely to yield good results.',
                  },
                },
                required: ['query'],
              },
            },
          },
        ];

        // Agent 闭环：模型可多轮调用工具（web_search → 读结果 → 再决策 → 最终作答）。
        // web_search 在循环内即时执行并把结果回灌给模型；generate_image 留给循环后的图像处理。
        // 整个循环有最大轮次上限，防止模型无限兜圈。
        const MAX_AGENT_ROUNDS = 5;
        const searchCustomHeaders = { ...forwardHeaders } as Record<string, string>;
        let fullContent = '';
        let imageToolArgs: string[] = [];

        for (let round = 0; round < MAX_AGENT_ROUNDS; round += 1) {
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
          const roundToolCalls: Record<number, { id: string; name: string; arguments: string }> = {};
          let reasoningEmitted = false;

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

                // 推理内容（DeepSeek: reasoning_content；其他: reasoning / thinking）
                const reasoningDelta = extractReasoningDelta(delta);
                if (reasoningDelta) {
                  reasoningEmitted = true;
                  send({ type: 'reasoning', content: reasoningDelta });
                }

                // 文本内容
                if (delta.content) {
                  if (reasoningEmitted) { send({ type: 'reasoning_done' }); reasoningEmitted = false; }
                  if (!fullContent && steps[0]?.status === 'running') setStep(0, 'done');
                  fullContent += delta.content;
                  send({ type: 'text', content: delta.content });
                }

                // 工具调用
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!roundToolCalls[idx]) {
                      roundToolCalls[idx] = { id: tc.id || '', name: tc.function?.name || '', arguments: '' };
                    }
                    if (tc.id) roundToolCalls[idx].id = tc.id;
                    if (tc.function?.name) roundToolCalls[idx].name = tc.function.name;
                    if (tc.function?.arguments) roundToolCalls[idx].arguments += tc.function.arguments;
                  }
                }
              } catch { /* 忽略解析错误 */ }
            }
          }
          if (reasoningEmitted) send({ type: 'reasoning_done' });

          const roundCalls = Object.values(roundToolCalls);
          const searchCalls = roundCalls.filter(t => t.name === 'web_search');
          const imageCalls = roundCalls.filter(t => t.name === 'generate_image');

          // 本轮没有搜索调用 → 结束 Agent 循环（可能带有 generate_image 或纯文本答复）。
          if (searchCalls.length === 0) {
            imageToolArgs = imageCalls.map(c => c.arguments);
            break;
          }

          // 执行 web_search 工具调用，把结果回灌给模型后继续下一轮。
          // 先把助手这轮的 tool_calls 作为一条 assistant 消息写回上下文。
          fullMessages.push({
            role: 'assistant',
            content: fullContent || null,
            tool_calls: roundCalls.map(c => ({
              id: c.id || `call_${c.name}`,
              type: 'function',
              function: { name: c.name, arguments: c.arguments || '{}' },
            })),
          } as unknown as (typeof fullMessages)[number]);

          for (const call of searchCalls) {
            let q = '';
            try { q = (JSON.parse(call.arguments || '{}').query || '').toString(); } catch { /* ignore */ }
            send({ type: 'search_status', status: 'searching', query: q });
            const result = await runWebSearch(q, searchCustomHeaders, 5);
            if (result.ok && result.resultCount > 0) {
              send({ type: 'search_status', status: 'completed', query: q, resultCount: result.resultCount, sources: result.items });
            } else {
              send({ type: 'search_status', status: 'failed', query: q, resultCount: 0, error: result.error || '未找到相关结果' });
            }
            fullMessages.push({
              role: 'tool',
              tool_call_id: call.id || `call_${call.name}`,
              content: result.ok && result.modelText
                ? result.modelText
                : `联网搜索未返回有效结果${result.error ? `：${result.error}` : ''}。请基于你已有的知识谨慎作答，并说明可能不是最新信息。`,
            } as unknown as (typeof fullMessages)[number]);
          }
          // 最后一轮仍想搜索则不再继续，交给模型基于已有结果作答。
          if (round === MAX_AGENT_ROUNDS - 1) {
            imageToolArgs = [];
          }
        }

        // 处理工具调用：模型可能一次返回多个 generate_image（如「分别画猫和狗」），逐个顺序执行，
        // 不再只取第一个而静默丢弃其余调用。
        if (imageToolArgs.length > 0) {
          for (let callIdx = 0; callIdx < imageToolArgs.length; callIdx += 1) {
            const callPrefix = imageToolArgs.length > 1 ? `第 ${callIdx + 1}/${imageToolArgs.length} 组 · ` : '';
            switchToImageSteps();
            setStep(0, 'done');
            send({ type: 'tool_status', tool: 'generating_image', status: 'generating', label: `${callPrefix}正在生成图片...` });

            let args: {
              prompt?: string; size?: string; aspect_ratio?: string; image_count?: number;
              use_reference_image?: boolean; reference_description?: string;
            } = {};
            try { args = JSON.parse(imageToolArgs[callIdx]); } catch { /* ignore */ }

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
            // The reference image may have been uploaded in an EARLIER turn (user says "再生成一张" with
            // no new image). Fall back to the most recent image anywhere in the conversation so follow-up
            // requests stay anchored to the original reference instead of drifting away from it.
            const lastTurnImages = lastUserMsg?.images || [];
            const anyConversationImage = [...messages].reverse().find(m => m.role === 'user' && m.images && m.images.length > 0)?.images || [];
            // Keep the keyword fallback narrow: only clear image-reference/edit intents. Broad words like
            // "继续/还是/保持" previously turned any plain follow-up into an img2img call whenever the
            // conversation happened to contain an image. The model's use_reference_image stays authoritative.
            const i2iIntent = /(这张图|这张|此图|参考图|参考这|改成|换成|基于这|根据这张|同款|保持(这张|原图|参考)|再(生成|来|画|出)一?(张|幅|版))/.test(userText);
            const wantsReference = args.use_reference_image ?? (i2iIntent && anyConversationImage.length > 0);
            const referenceSource = lastTurnImages.length > 0 ? lastTurnImages : anyConversationImage;
            const referenceImage = referenceSource.length > 0 && wantsReference ? referenceSource[0] : undefined;
            // How many variations: the model's image_count wins, else parse the user's words. Capped at 4.
            const imageCount = Math.max(1, Math.min(4, args.image_count || parseImageCount(userText)));
            // The chat model has already looked at the image, so its description is passed along.
            // This lets /api/generate skip its own vision identification pass (20s+ in production logs).
            // Only use a real description of the reference; never fall back to the target prompt, which
            // describes what to generate (not the reference subject) and would mislead reference matching.
            const referenceDescription = (args.reference_description || '').trim();

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
                  outputCount: imageCount,
                  submitOnly: true,
                  // Use exactly the model the user picked. If it fails, surface the error instead of
                  // silently switching to another model — that mismatch left the provider panel showing
                  // "已退回" while the chat kept polling a different model as if still generating.
                  disableModelFallback: true,
                  projectId: body.projectId,
                  ...(referenceImage ? {
                    referenceImages: [referenceImage],
                    ...(referenceDescription ? { referenceDescriptions: [referenceDescription] } : {}),
                    referenceMode: 'reference',
                    strength: i2iStrength,
                  } : {}),
                }),
                signal: AbortSignal.timeout(60000),
              });
              const imgData = await imgRes.json().catch(() => ({})) as {
                success?: boolean; error?: string; taskIds?: string[]; taskId?: string; imageUrls?: string[]; directImageUrls?: string[];
              };
              const directUrls = imgData.directImageUrls || imgData.imageUrls || [];
              const taskIds = imgData.taskIds || (imgData.taskId ? [imgData.taskId] : []);

              // Poll one task to completion and stream its image; returns true once settled.
              // Hard wall-clock cap (4 min) so the SSE connection can't hang indefinitely when the
              // upstream provider stops responding without ever returning a terminal status.
              const POLL_DEADLINE_MS = 4 * 60 * 1000;
              const pollOneTask = async (taskId: string, labelPrefix: string): Promise<boolean> => {
                const startedAt = Date.now();
                for (let attempt = 0; attempt < 200; attempt += 1) {
                  if (Date.now() - startedAt > POLL_DEADLINE_MS) break;
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
                  const urls = pollData.imageUrls?.length ? pollData.imageUrls : (pollData.imageUrl ? [pollData.imageUrl] : []);
                  if (pollData.status === 'completed' && urls.length > 0) {
                    for (const url of urls) send({ type: 'image', imageUrl: url, prompt: imgPrompt });
                    return true;
                  }
                  if (pollData.status === 'failed' || pollData.status === 'cancelled') {
                    failImage(pollData.error || '上游返回失败');
                    return true;
                  }
                  send({ type: 'tool_status', tool: 'generating_image', status: 'polling', label: `${labelPrefix}图片生成中...${pollData.progress ? ` ${pollData.progress}%` : ''}`, taskId, progress: pollData.progress });
                }
                return false;
              };

              if (!imgRes.ok || !imgData.success) {
                failImage(imgData.error || `图像接口返回 ${imgRes.status}`);
              } else if (directUrls.length > 0 && taskIds.length === 0) {
                setStep(2, 'done');
                for (const url of directUrls) send({ type: 'image', imageUrl: url, prompt: imgPrompt });
                setStep(3, 'done');
              } else if (taskIds.length > 0) {
                setStep(2, 'done', taskIds.length > 1 ? `${taskIds.length} 个任务` : `任务 ${taskIds[0].slice(0, 12)}`);
                send({ type: 'tool_status', tool: 'generating_image', status: 'polling', label: `图片生成中...（共 ${taskIds.length} 张）`, taskId: taskIds[0] });

                // Poll every task so each of the N variations streams back as it finishes.
                const results = await Promise.all(
                  taskIds.map((id, i) => pollOneTask(id, taskIds.length > 1 ? `第 ${i + 1}/${taskIds.length} 张 ` : ''))
                );
                if (results.some(Boolean)) setStep(3, 'done');
                else failImage('等待超时，图片可能仍在生成，请稍后在历史中查看');
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
