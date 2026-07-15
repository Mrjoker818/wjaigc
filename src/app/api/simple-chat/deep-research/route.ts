import { NextRequest } from 'next/server';
import { findProviderForModel } from '@/lib/server-api-config';
import type { ApiKind } from '@/lib/server-api-config';
import { SearchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

interface ResearchStep {
  step: number;
  query: string;
  rationale: string;
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    query: string;
    model?: string;
    providerId?: string;
    depth?: 'quick' | 'standard' | 'deep';
  };
  const query = body.query || '';
  const model = body.model || 'gpt-4o-mini';
  const providerId = body.providerId || '';
  const depth = body.depth || 'standard';

  if (!query.trim()) {
    return Response.json({ error: '请提供研究问题' }, { status: 400 });
  }

  const provider = await findProviderForModel(model, 'chat' as ApiKind, providerId || undefined);
  if (!provider) {
    return Response.json({ error: '未找到可用的 LLM 提供商' }, { status: 400 });
  }

  const apiKey = provider.apiKey;
  const baseUrl = provider.baseUrl?.replace(/\/+$/, '') || '';
  const searchCount = depth === 'deep' ? 4 : depth === 'quick' ? 1 : 2;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // Phase 1: 制定研究计划
        send({ type: 'phase', phase: 'planning', label: '正在制定研究计划...' });

        const planPrompt = `你是一位研究专家。用户提出了以下研究问题："${query}"

请将这个问题拆解为 ${searchCount} 个具体的搜索子问题。每个子问题应该从不同角度切入。
以 JSON 格式返回，格式为：{"steps":[{"step":1,"query":"子问题1","rationale":"为什么搜索这个角度"},...]}

只返回 JSON，不要其他内容。`;

        const planRes = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: planPrompt }], stream: false }),
        });

        let steps: ResearchStep[] = [];
        if (planRes.ok) {
          const planData = await planRes.json() as { choices?: { message?: { content?: string } }[] };
          const planContent = planData.choices?.[0]?.message?.content || '';
          try {
            const parsed = JSON.parse(planContent.replace(/```json|```/g, '').trim());
            steps = parsed.steps || [];
          } catch {
            // 降级：直接用原始 query 搜索
            steps = [{ step: 1, query, rationale: '直接搜索用户问题' }];
          }
        } else {
          steps = [{ step: 1, query, rationale: '直接搜索用户问题' }];
        }

        send({ type: 'phase', phase: 'planning_complete', label: `研究计划完成，共 ${steps.length} 个搜索任务`, steps });

        // Phase 2: 执行搜索
        const allResults: Array<{ step: number; query: string; items: Array<{ title: string; url: string; snippet: string }> }> = [];
        const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
        const searchClient = new SearchClient(new Config(), customHeaders);

        for (const step of steps) {
          send({ type: 'phase', phase: 'searching', label: `正在搜索(${step.step}/${steps.length}): ${step.query}`, step: step.step, total: steps.length });

          try {
            const searchResp = await searchClient.webSearch(step.query, 5, true);
            const items = (searchResp.web_items || []).slice(0, 5).map(item => ({
              title: item.title,
              url: item.url || '',
              snippet: item.snippet || '',
            }));
            allResults.push({ step: step.step, query: step.query, items });
          } catch {
            allResults.push({ step: step.step, query: step.query, items: [] });
          }
        }

        send({ type: 'phase', phase: 'searching_complete', label: `搜索完成，共找到 ${allResults.reduce((s, r) => s + r.items.length, 0)} 条结果` });

        // Phase 3: 综合撰写报告
        send({ type: 'phase', phase: 'writing', label: '正在综合分析并撰写研究报告...' });

        const searchContext = allResults.map(r =>
          `### 搜索${r.step}: ${r.query}\n${r.items.map((item, i) => `[${i + 1}] ${item.title}\nURL: ${item.url}\n摘要: ${item.snippet}`).join('\n\n')}`
        ).join('\n\n---\n\n');

        const reportPrompt = `你是一位资深研究分析师。请基于以下搜索结果，为用户的研究问题撰写一份综合研究报告。

研究问题: "${query}"

搜索结果:
${searchContext}

请撰写一份结构化的研究报告，包含以下部分：
1. 执行摘要（2-3句话概括核心发现）
2. 关键发现（按主题组织，引用来源编号）
3. 综合分析（不同来源的交叉验证与对比）
4. 结论与建议

格式要求：
- 使用 Markdown 格式
- 引用时标注来源编号如 [1]、[2]
- 保持客观、专业
- 长度：${depth === 'deep' ? '800-1500字' : '400-800字'}`;

        const reportRes = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: reportPrompt }],
            stream: true,
          }),
        });

        if (!reportRes.ok) {
          const errText = await reportRes.text().catch(() => '');
          send({ type: 'error', error: `报告生成失败: ${errText.slice(0, 200)}` });
          controller.close();
          return;
        }

        const reader = reportRes.body?.getReader();
        if (!reader) {
          send({ type: 'error', error: '无法读取报告流' });
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let fullReport = '';

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
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullReport += content;
                send({ type: 'text', content });
              }
            } catch { /* ignore */ }
          }
        }

        // 发送来源引用
        const citations = allResults.flatMap(r => r.items.map((item, i) => ({
          index: i + 1 + allResults.slice(0, r.step - 1).reduce((s, pr) => s + pr.items.length, 0),
          title: item.title,
          url: item.url,
          snippet: item.snippet.slice(0, 200),
        })));

        send({ type: 'citations', citations });
        send({ type: 'done' });
      } catch (e: unknown) {
        send({ type: 'error', error: e instanceof Error ? e.message : 'Deep Research 失败' });
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
