import { NextRequest } from 'next/server';
import { findProviderForModel } from '@/lib/server-api-config';
import type { ApiKind } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { SearchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { fetchWithTimeout } from '@/lib/api-helpers';

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
  };
  const messages = body.messages || [];
  const model = body.model || 'deepseek-v4-flash';
  const providerId = body.providerId || '';
  const webSearch = body.webSearch || false;
  const knowledgeItems = body.knowledgeItems || [];
  const imageModel = body.imageModel || model;
  const imageProviderId = body.imageProviderId || providerId;

  // 查找提供商
  const provider = await findProviderForModel(model, 'chat' as ApiKind, providerId || undefined);
  if (!provider) {
    return Response.json({ error: '未找到可用的 API 提供商' }, { status: 400 });
  }

  // 模型权限校验：非管理员用户需检查 chatModels 授权列表
  const user = await getSessionUser(request);
  if (user && user.role !== 'admin') {
    const allowed = user.chatModels;
    if (allowed && allowed.length > 0 && !allowed.includes(model)) {
      return Response.json({ error: '您没有权限使用此模型，请联系管理员' }, { status: 403 });
    }
  }

  const apiKey = provider.apiKey;
  const baseUrl = provider.baseUrl?.replace(/\/+$/, '') || '';

  // 构建增强的 system prompt（指令 + 知识库 + 联网搜索结果）
  let enhancedSystemPrompt = DEFAULT_SYSTEM_PROMPT;

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
    } catch (e: any) {
      console.error('Web search failed:', e.message);
      enhancedSystemPrompt += `\n\n(联网搜索暂时不可用: ${e.message})`;
    }
  }

  // 构建消息列表
  const fullMessages = [
    { role: 'system', content: enhancedSystemPrompt },
    ...messages.map((m) => {
      const parts: any[] = [{ type: 'text', text: m.content }];
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
        const tools: any[] = [
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

            try {
              const imgRes = await fetch(`${request.nextUrl.origin}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  prompt: imgPrompt,
                  model: imageModel,
                  providerId: imageProviderId,
                  size: imgSize,
                  count: 1,
                }),
              });
              const imgData = await imgRes.json() as { success?: boolean; taskIds?: string[]; imageUrls?: string[] };

              if (imgData.success && imgData.taskIds?.length) {
                const taskId = imgData.taskIds[0];
                send({ type: 'tool_status', tool: 'generating_image', status: 'polling', label: '图片生成中...', taskId });

                // 轮询直到完成
                let attempts = 0;
                while (attempts < 60) {
                  await new Promise(r => setTimeout(r, 3000));
                  const pollRes = await fetch(`${request.nextUrl.origin}/api/poll-task`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskId, model }),
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
            } catch (e: any) {
              send({ type: 'tool_status', tool: 'generating_image', status: 'failed', label: `图片生成失败: ${e.message}` });
            }
          }
        }

        send({ type: 'done' });
      } catch (e: any) {
        send({ type: 'error', error: e.message || '未知错误' });
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
