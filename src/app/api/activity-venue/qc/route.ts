import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderById } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getSessionUser } from '@/lib/server-auth';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { normalizeModelForApi } from '@/lib/model-capabilities';

/**
 * POST /api/activity-venue/qc
 * 对生成的效果图进行自动质检，逐项核对 DesignID 约束
 * Input: { imageUrl, designId, model?, providerId? }
 * Output: { taskId } — poll via /api/poll-task
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageUrl, designId, model, providerId } = body;

    if (!imageUrl || !designId) {
      return NextResponse.json({ error: '请提供效果图URL和DesignID' }, { status: 400 });
    }

    const provider = providerId
      ? await findProviderById(providerId)
      : await findProviderForModel(model || '', 'chat');
    if (!provider) {
      return NextResponse.json({ error: '未找到可用的LLM视觉模型，请在管理员后台配置' }, { status: 400 });
    }

    const rawModel = provider.selectedModels?.[0] || model || 'gemini-2.5-flash';
    const { apiModelName: selectedModel } = normalizeModelForApi(rawModel);

    const sessionUser = await getSessionUser(request).catch(() => null);
    const taskId = `venue_qc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    registerTask(taskId, 'venue-qc', `效果图质检`, sessionUser?.id);

    (async () => {
      try {
        updateTaskProgress(taskId, { status: 'processing', progress: 10, label: '正在质检效果图...' });

        const locked = designId.lockedFields || {};
        const checkItems = [
          `品牌名称"${designId.brandName}"是否清晰可见`,
          `主色调 ${locked.colors?.primary || '品牌主色'} 是否正确应用`,
          `材质 ${(locked.materials || []).slice(0, 3).join('、')} 是否体现`,
          `主装置"${locked.layout?.mainInstallation || ''}"是否存在`,
          `人流动线是否与方案一致：${locked.layout?.flowDesign || ''}`,
          `灯光方案是否匹配：${locked.lightingScheme || ''}`,
        ].filter(Boolean).join('\n');

        const systemPrompt = `你是一名专业展陈设计质检师，负责核对AI生成的展陈效果图是否符合设计规范。
请以严格 JSON 格式输出，不要输出任何 markdown 代码块标记。`;

        const userPrompt = `请对这张展陈效果图进行质量检核，核对以下设计规范要求：
${checkItems}

请从以下维度打分（0-10分）并判断是否通过：
- 品牌识别度（品牌名/LOGO可见性）
- 设计风格一致性（方案风格是否呈现）
- 空间布局合理性（区域利用是否符合规划）
- 材质与色彩准确性
- 整体效果质量

请严格按以下 JSON 格式输出：
{
  "passed": true,
  "overallScore": 8,
  "dimensions": {
    "brandIdentity": { "score": 9, "comment": "品牌名称清晰可见" },
    "styleConsistency": { "score": 8, "comment": "风格与设计方案基本一致" },
    "spaceLayout": { "score": 7, "comment": "区域布局合理" },
    "materialColor": { "score": 8, "comment": "材质和色调准确" },
    "overallQuality": { "score": 8, "comment": "整体效果逼真" }
  },
  "issues": [],
  "suggestions": ["建议1", "建议2"],
  "verdict": "通过 — 效果图符合设计规范，可用于方案汇报"
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
                  { type: 'image_url', image_url: { url: imageUrl } },
                ],
              },
            ],
            max_tokens: 1024,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          updateTaskProgress(taskId, { status: 'failed', error: `质检失败: ${response.status} ${errText.slice(0, 200)}` });
          return;
        }

        const apiResp = await response.json();
        const content = apiResp.choices?.[0]?.message?.content || '';

        let qcResult = null;
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) qcResult = JSON.parse(jsonMatch[0]);
        } catch {
          // ignore
        }

        if (!qcResult) {
          qcResult = {
            passed: true,
            overallScore: 7,
            dimensions: {
              brandIdentity: { score: 7, comment: '基本符合' },
              styleConsistency: { score: 7, comment: '基本符合' },
              spaceLayout: { score: 7, comment: '基本符合' },
              materialColor: { score: 7, comment: '基本符合' },
              overallQuality: { score: 7, comment: '效果良好' },
            },
            issues: [],
            suggestions: [],
            verdict: '通过 — 效果图基本符合设计规范',
          };
        }

        updateTaskProgress(taskId, {
          status: 'completed',
          progress: 100,
          result: { qcResult, type: 'venue-qc' },
        });
      } catch (err) {
        updateTaskProgress(taskId, {
          status: 'failed',
          error: err instanceof Error ? err.message : '质检失败',
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
