import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderById } from '@/lib/server-api-config';
import { resolveCompatProfile } from '@/lib/api-compatibility';
import { buildDisplay3DDecomposePrompt } from '@/lib/display3d-prompts';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { fetchWithV1Retry } from '@/lib/api-helpers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { brandName = '', sceneType = 'pop_up_store', dimensions, imageUrl, model, providerId } = body;

    if (!imageUrl && !brandName) {
      return NextResponse.json({ error: '请提供效果图或品牌名称' }, { status: 400 });
    }

    // Build decompose prompt
    const prompt = buildDisplay3DDecomposePrompt({
      brandName,
      sceneType,
      dimensions: dimensions || { length: 9000, width: 6000, height: 4500, unit: 'mm' as const },
    });

    // Use chat model for decomposition analysis (prefer providerId for exact match)
    const provider = providerId
      ? await findProviderById(providerId)
      : await findProviderForModel(model || '', 'chat');
    if (!provider) {
      return NextResponse.json({ error: '未找到可用的LLM模型，请在管理员后台配置' }, { status: 400 });
    }

    const profile = resolveCompatProfile(provider);
    const selectedModel = provider.selectedModels?.[0] || model || 'gemini-2.5-flash';

    // Register task
    const taskId = `d3d_dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    registerTask(taskId, 'display3d-decompose', `3D展陈拆解: ${brandName}`);

    // Start async decomposition
    (async () => {
      try {
        updateTaskProgress(taskId, { status: 'processing', progress: 10, label: '正在拆解方案...' });

        // Build chat messages with image if available
        const messages: Array<{ role: string; content: unknown }> = [
          {
            role: 'user',
            content: imageUrl
              ? [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: imageUrl } },
                ]
              : prompt,
          },
        ];

        let apiBase = provider.baseUrl.replace(/\/+$/, '');
        if (apiBase.endsWith('/v1')) apiBase = apiBase.slice(0, -3);

        const response = await fetchWithV1Retry(apiBase, '/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify({
            model: selectedModel,
            messages,
            max_tokens: 4096,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          updateTaskProgress(taskId, { status: 'failed', error: `API错误: ${response.status} ${errorText}` });
          return;
        }

        const apiResponse = await response.json();
        const content = apiResponse.choices?.[0]?.message?.content || '';

        // Try to parse structured data from the response
        let decomposition = null;
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            decomposition = JSON.parse(jsonMatch[0]);
          }
        } catch {
          // Use raw content as analysis text
        }

        updateTaskProgress(taskId, {
          status: 'completed',
          progress: 100,
          result: {
            decomposition,
            rawAnalysis: content,
            type: 'display3d-decompose',
          },
        });
      } catch (err) {
        updateTaskProgress(taskId, {
          status: 'failed',
          error: err instanceof Error ? err.message : '拆解失败',
        });
      }
    })();

    return NextResponse.json({ success: true, taskId, status: 'running' });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '服务器错误' },
      { status: 500 }
    );
  }
}
