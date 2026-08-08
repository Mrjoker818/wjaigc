import { NextRequest } from 'next/server';
import { findProviderForModel } from '@/lib/server-api-config';
import type { ApiKind } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { SearchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { fetchWithTimeout } from '@/lib/api-helpers';
import { resolveChatControls } from '@/lib/chat-generation-controls';
import { getInternalRequestHeaders } from '@/lib/api-auth';

const DEFAULT_SYSTEM_PROMPT = `你是无界AI的智能助手。你可以：
1. 回答用户的各种问题
2. 当用户需要生成图片时，使用 generate_image 工具
3. 支持多模态理解（图片识别）

请保持回复简洁、专业、友好。
**重要**：请始终以自然语言（纯文本）回复用户，**不要**使用 JSON 格式或 Markdown 代码块格式输出你的回答内容。`;

interface KnowledgeItem {
  id: string;
  type: 'file' | 'url' | 'note';
  title: string;
  content: string;
}

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'auto' } };

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
  };
  const messages = body.messages || [];
  const model = body.model || 'deepseek-v4-flash';
  const providerId = body.providerId || '';
  const webSearch = body.webSearch || false;
  const knowledgeItems = body.knowledgeItems || [];
  const imageModel = body.imageModel || model;
  const imageProviderId = body.imageProviderId || providerId;
  const memories = body.memories || [];
  const deepAnalysis = body.deepAnalysis || false;
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
  if (webSearch) {
    try {
      // 取最后一条用户消息作为搜索 query
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      const searchQuery = lastUserMsg?.content || '';
      if (searchQuery) {
        const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
        const searchClient = new SearchClient(new Config(), customHeaders);
        const searchResp = await searchClient.webSearch(searchQuery, 5, true);

        if (searchResp.web_items && searchResp.web_items.length > 0) {
          const items = searchResp.web_items.slice(0, 5).map((item, i) =>
            `[${i + 1}] ${item.title}\nURL: ${item.url || '无'}\n摘要: ${item.snippet || ''}${item.summary ? '\nAI摘要: ' + item.summary : ''}`
          ).join('\n\n');

          searchResults = `## 联网搜索结果\n搜索关键词: "${searchQuery}"\n\n${items}`;
          if (searchResp.summary) {
            searchResults += `\n\n## AI 搜索摘要\n${searchResp.summary}`;
          }
          enhancedSystemPrompt += `\n\n${searchResults}\n\n请基于以上联网搜索结果回答用户问题。如有引用，请标注来源编号（如 [1]、[2]）。`;
        } else {
          enhancedSystemPrompt += `\n\n(联网搜索未找到相关结果，请基于已有知识回答)`;
        }
      }
    } catch (e: unknown) {
      const message = errorMessage(e, 'Web search unavailable');
      console.error('Web search failed:', message);
      enhancedSystemPrompt += `\n\n(联网搜索暂时不可用: ${message})`;
    }
  }

  // 构建消息列表
  const fullMessages = [
    { role: 'system', content: enhancedSystemPrompt },
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
        return { role: m.role, content: m.content };
      }
      return { role: m.role, content: parts };
    }),
  ];

  // SSE 流式响应
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
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

        // 先发送搜索结果（如果有联网搜索）
        if (webSearch) {
          if (searchResults) {
            // 解析出搜索条目
            const resultCount = (searchResults.match(/\[\d+\]/g)?.length || 0);
            send({ type: 'search_status', status: 'completed', resultCount, searchResults });
          } else {
            send({ type: 'search_status', status: 'failed', resultCount: 0 });
          }
        }

        const apiUrl = `${baseUrl}/chat/completions`;

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
                  size: {
                    type: 'string',
                    enum: ['1024x1024', '1792x1024', '1024x1792'],
                    description: 'Image size, default 1024x1024',
                  },
                },
                required: ['prompt'],
              },
            },
          },
        ];

        const fetchRes = await fetchWithTimeout(apiUrl, {
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
        }, 'chat');

        if (!fetchRes.ok) {
          const errText = await fetchRes.text().catch(() => '');
          send({ type: 'error', error: `API 错误 ${fetchRes.status}: ${errText.slice(0, 200)}` });
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
            send({ type: 'tool_status', tool: 'generating_image', status: 'generating', label: '正在生成图片...' });

            let args: { prompt?: string; size?: string } = {};
            try { args = JSON.parse(tc.arguments); } catch { /* ignore */ }

            const imgPrompt = args.prompt || fullContent.slice(0, 500);
            const imgSize = args.size || '1024x1024';

            // 图生图：用户上传了参考图且意图是"基于图片生成/调整"时，传入参考图
            const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
            const userImages = lastUserMsg?.images || [];
            const userText = (lastUserMsg?.content || '').toLowerCase();
            const i2iIntent = /(这张图|这张|此图|图片|参考|改成|调整|换成|基于|类似风格|同款|根据这)/.test(userText);
            const referenceImage = userImages.length > 0 && i2iIntent ? userImages[0] : undefined;

            try {
              const internalHeaders = await getInternalRequestHeaders(user.id, user.role === 'admin' ? 'admin' : 'user');
              const imgRes = await fetch(`${request.nextUrl.origin}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...internalHeaders },
                body: JSON.stringify({
                  prompt: imgPrompt,
                  model: imageModel,
                  providerId: imageProviderId,
                  size: imgSize,
                  count: 1,
                  submitOnly: true,
                  ...(referenceImage ? { imageUrl: referenceImage, strength: i2iStrength } : {}),
                }),
              });
              const imgData = await imgRes.json() as { success?: boolean; taskIds?: string[]; imageUrls?: string[]; directImageUrls?: string[] };

              // 直接返回图片的情况（同步提供商）
              const directUrls = imgData.directImageUrls || imgData.imageUrls;
              if (imgData.success && directUrls?.length && !imgData.taskIds?.length) {
                send({ type: 'image', imageUrl: directUrls[0], prompt: imgPrompt });
              } else if (imgData.success && imgData.taskIds?.length) {
                const taskId = imgData.taskIds[0];
                send({ type: 'tool_status', tool: 'generating_image', status: 'polling', label: '图片生成中...', taskId });

                // 轮询直到完成
                let attempts = 0;
                while (attempts < 100) {
                  await new Promise(r => setTimeout(r, 3000));
                  const pollRes = await fetch(`${request.nextUrl.origin}/api/poll-task`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...internalHeaders },
                    body: JSON.stringify({ taskId, model: imageModel, providerId: imageProviderId }),
                  });
                  const pollData = await pollRes.json() as { status?: string; imageUrl?: string; progress?: number };

                  if (pollData.status === 'completed' && pollData.imageUrl) {
                    send({ type: 'image', imageUrl: pollData.imageUrl, prompt: imgPrompt });
                    break;
                  }
                  if (pollData.status === 'failed') {
                    send({ type: 'tool_status', tool: 'generating_image', status: 'failed', label: '图片生成失败' });
                    break;
                  }
                  send({ type: 'tool_status', tool: 'generating_image', status: 'polling', label: `图片生成中... ${pollData.progress || ''}`, taskId, progress: pollData.progress });
                  attempts++;
                }
              }
            } catch (e: unknown) {
              send({ type: 'tool_status', tool: 'generating_image', status: 'failed', label: `图片生成失败: ${errorMessage(e, '未知错误')}` });
            }
          }
        }

        send({ type: 'done' });
      } catch (e: unknown) {
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
