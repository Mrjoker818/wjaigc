/**
 * AI自然语言建图 API
 * POST /api/workflow/ai-build
 * 
 * 用户描述需求 → LLM解析 → 自动生成完整节点工作流JSON
 * 使用管理员配置的chat模型调用
 * 
 * P0升级: 二次修正机制 — 当AI首次输出nodes<2时自动追问LLM补充细节
 */
import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature } from '@/lib/server-api-config';
import { AI_BUILD_PROMPT, AI_BUILD_REFINE_PROMPT, parseAIBuildResponse, createWorkflowFromAIResult } from '@/lib/workflow-engine';

/** 调用LLM获取响应 (复用SSE/JSON双模式解析) */
async function callLLM(
  baseUrl: string, apiKey: string, chatModel: string,
  messages: { role: string; content: string }[]
): Promise<string> {
  const endpoint = `${baseUrl}/chat/completions`;
  const llmResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: chatModel,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!llmResponse.ok) {
    const errText = await llmResponse.text().catch(() => '');
    throw new Error(`LLM调用失败: ${llmResponse.status} ${errText}`);
  }

  // 解析响应 (支持SSE流和非流)
  let llmContent = '';
  const contentType = llmResponse.headers.get('content-type') || '';

  if (contentType.includes('text/event-stream')) {
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
    const json = await llmResponse.json();
    llmContent = json.choices?.[0]?.message?.content || '';
  }

  return llmContent;
}

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
    const chatModel = model || selectedModels?.[0] || '';
    if (!chatModel) {
      return NextResponse.json({ error: '未选择聊天模型' }, { status: 400 });
    }

    // ─── 第一次调用LLM ───
    let llmContent = await callLLM(baseUrl, apiKey, chatModel, [
      { role: 'system', content: AI_BUILD_PROMPT },
      { role: 'user', content: description },
    ]);

    if (!llmContent.trim()) {
      return NextResponse.json({ error: 'LLM返回空内容' }, { status: 502 });
    }

    // 解析首次结果
    let parsed = parseAIBuildResponse(llmContent);

    // ─── P0: 二次修正机制 ───
    // 当AI首次输出nodes<2时，自动追问让LLM补充更详细的工作流
    if (parsed && parsed.nodes.length < 2) {
      console.log('[ai-build] 首次结果节点不足，触发二次修正...');
      const refineContent = await callLLM(baseUrl, apiKey, chatModel, [
        { role: 'system', content: AI_BUILD_PROMPT },
        { role: 'user', content: description },
        { role: 'assistant', content: llmContent },
        { role: 'user', content: AI_BUILD_REFINE_PROMPT },
      ]);

      if (refineContent.trim()) {
        const refinedParsed = parseAIBuildResponse(refineContent);
        if (refinedParsed && refinedParsed.nodes.length >= 2) {
          parsed = refinedParsed;
          llmContent = refineContent;
        }
      }
    }

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
      refined: parsed.nodes.length >= 2,
    });

  } catch (error) {
    console.error('[ai-build] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'AI建图失败',
    }, { status: 500 });
  }
}
