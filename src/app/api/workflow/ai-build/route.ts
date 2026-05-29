/**
 * AI自然语言建图 API
 * POST /api/workflow/ai-build
 * 
 * 用户描述需求 → LLM解析 → 自动生成完整节点工作流JSON
 * 使用管理员配置的chat模型调用
 */
import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature } from '@/lib/server-api-config';
import { AI_BUILD_PROMPT, parseAIBuildResponse, createWorkflowFromAIResult } from '@/lib/workflow-engine';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { description, model } = body as { description: string; model?: string };

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return NextResponse.json({ error: '请描述你想要的工作流需求' }, { status: 400 });
    }

    // 查找可用的聊天模型提供商
    const chatProvider = await findProviderForFeature('chat');
    if (!chatProvider) {
      return NextResponse.json({ error: '未配置聊天模型，请在管理员系统中添加LLM模型' }, { status: 400 });
    }

    const { baseUrl, apiKey, selectedModels } = chatProvider;
    // 优先使用用户指定的model，否则使用提供商默认模型
    const chatModel = model || selectedModels?.[0] || '';
    if (!chatModel) {
      return NextResponse.json({ error: '未选择聊天模型' }, { status: 400 });
    }

    // 调用LLM
    const endpoint = `${baseUrl}/chat/completions`;
    const llmResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: chatModel,
        messages: [
          { role: 'system', content: AI_BUILD_PROMPT },
          { role: 'user', content: description },
        ],
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text().catch(() => '');
      return NextResponse.json({ error: `LLM调用失败: ${llmResponse.status} ${errText}` }, { status: 502 });
    }

    // 解析响应 (支持SSE流和非流)
    let llmContent = '';
    const contentType = llmResponse.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      // SSE流式响应
      const text = await llmResponse.text();
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content || '';
            llmContent += delta;
          } catch { /* skip malformed chunks */ }
        }
      }
    } else {
      // 非流式JSON响应
      const json = await llmResponse.json();
      llmContent = json.choices?.[0]?.message?.content || '';
    }

    if (!llmContent.trim()) {
      return NextResponse.json({ error: 'LLM返回空内容' }, { status: 502 });
    }

    // 解析AI生成的工作流
    const parsed = parseAIBuildResponse(llmContent);
    if (!parsed) {
      return NextResponse.json({
        error: 'AI生成的工作流格式无效，请重试或手动描述需求',
        rawResponse: llmContent,
      }, { status: 422 });
    }

    // 创建完整工作流对象
    const workflow = createWorkflowFromAIResult(parsed);

    return NextResponse.json({
      success: true,
      workflow,
      rawResponse: llmContent,
    });

  } catch (error) {
    console.error('[ai-build] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'AI建图失败',
    }, { status: 500 });
  }
}
