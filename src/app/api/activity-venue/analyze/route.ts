import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderById } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getSessionUser } from '@/lib/server-auth';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { normalizeModelForApi } from '@/lib/model-capabilities';

/**
 * POST /api/activity-venue/analyze
 * 分析真实场馆照片，识别可用区域、尺寸估算、光线条件、结构限制
 * Input: { venueImageUrl, brief, model?, providerId? }
 * Output: { taskId } — poll via /api/poll-task
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { venueImageUrl, brief = '', model, providerId } = body;

    if (!venueImageUrl) {
      return NextResponse.json({ error: '请提供场馆照片 URL' }, { status: 400 });
    }

    // Find LLM (vision) provider
    const provider = providerId
      ? await findProviderById(providerId)
      : await findProviderForModel(model || '', 'chat');
    if (!provider) {
      return NextResponse.json({ error: '未找到可用的LLM视觉模型，请在管理员后台配置' }, { status: 400 });
    }

    const rawModel = provider.selectedModels?.[0] || model || 'gemini-2.5-flash';
    const { apiModelName: selectedModel } = normalizeModelForApi(rawModel);

    const sessionUser = await getSessionUser(request).catch(() => null);
    const taskId = `venue_analyze_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    registerTask(taskId, 'venue-analyze', `场馆分析`, sessionUser?.id);

    (async () => {
      try {
        updateTaskProgress(taskId, { status: 'processing', progress: 10, label: '正在识别场馆区域...' });

        const systemPrompt = `你是一名专业的展陈空间设计师，擅长分析真实场馆照片，识别可布置区域、评估尺寸和光线条件。
请以严格 JSON 格式输出分析结果，不要输出任何 markdown 代码块标记。`;

        const userPrompt = `请分析这张场馆照片，提取以下信息：
1. 可用展陈区域（每个区域给出编号ID、名称、位置描述、估算尺寸mm、区域类型：main/side/corner/entrance/flow）
2. 整体空间估算尺寸（长×宽×高 mm）
3. 光线条件（natural/artificial/mixed）
4. 空间类型（mall_atrium/exhibition_hall/store/outdoor/supermarket/other）
5. 结构限制（柱子/梁/固定设施等，可为空数组）
6. 活动简述参考：${brief || '无'}

请严格按以下 JSON 结构输出：
{
  "spaceType": "mall_atrium",
  "estimatedDimensions": { "length": 12000, "width": 8000, "height": 4500 },
  "lighting": "artificial",
  "regions": [
    { "id": "r1", "name": "主展区", "type": "main", "position": "正中央", "estimatedSize": { "length": 6000, "width": 4000 }, "notes": "视觉焦点位置" },
    { "id": "r2", "name": "左侧入口区", "type": "entrance", "position": "左侧入口", "estimatedSize": { "length": 3000, "width": 2000 }, "notes": "人流必经" }
  ],
  "structuralLimits": ["中央立柱2根，直径约300mm"],
  "designNotes": "整体空间开放，适合大型展陈装置"
}`;

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
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: [
                  { type: 'text', text: userPrompt },
                  { type: 'image_url', image_url: { url: venueImageUrl } },
                ],
              },
            ],
            max_tokens: 2048,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          updateTaskProgress(taskId, { status: 'failed', error: `视觉分析失败: ${response.status} ${errText.slice(0, 200)}` });
          return;
        }

        const apiResp = await response.json();
        const content = apiResp.choices?.[0]?.message?.content || '';

        let analysis = null;
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
        } catch {
          // fallback: return raw content
        }

        if (!analysis) {
          // Build minimal fallback
          analysis = {
            spaceType: 'other',
            estimatedDimensions: { length: 10000, width: 8000, height: 4000 },
            lighting: 'artificial',
            regions: [
              { id: 'r1', name: '主展区', type: 'main', position: '中央区域', estimatedSize: { length: 5000, width: 4000 }, notes: '' },
            ],
            structuralLimits: [],
            designNotes: content.slice(0, 300),
          };
        }

        updateTaskProgress(taskId, {
          status: 'completed',
          progress: 100,
          result: { analysis, type: 'venue-analyze' },
        });
      } catch (err) {
        updateTaskProgress(taskId, {
          status: 'failed',
          error: err instanceof Error ? err.message : '场馆分析失败',
        });
      }
    })();

    return NextResponse.json({ success: true, taskId, status: 'running' });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '服务器错误' },
      { status: 500 },
    );
  }
}
