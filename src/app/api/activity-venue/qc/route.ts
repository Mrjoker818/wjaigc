import { NextRequest, NextResponse } from 'next/server';
import { getApiProviders } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getSessionUser } from '@/lib/server-auth';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { selectActivityVenueModel } from '@/lib/activity-venue-model';
import { z } from 'zod';

const score = z.number().finite().min(0).max(10);
const qcDimension = z.object({ score, comment: z.string() }).passthrough();
const qcResultSchema = z.object({
  passed: z.boolean(), overallScore: score,
  dimensions: z.object({
    brandIdentity: qcDimension, styleConsistency: qcDimension, spaceLayout: qcDimension,
    materialColor: qcDimension, overallQuality: qcDimension,
  }).catchall(qcDimension),
  issues: z.array(z.string()), suggestions: z.array(z.string()), verdict: z.string().min(1),
}).passthrough();

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

    if ((providerId !== undefined && typeof providerId !== 'string') || (model !== undefined && typeof model !== 'string')) {
      return NextResponse.json({ error: '供应商或模型参数无效' }, { status: 400 });
    }
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) return NextResponse.json({ error: '请登录后进行质检' }, { status: 401 });
    const providers = await getApiProviders();
    const selection = selectActivityVenueModel(providers, sessionUser, providerId, model);
    if (!selection.ok) return NextResponse.json({ error: selection.error }, { status: selection.status });
    const { provider, modelId: selectedModel } = selection;
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

        const apiBase = provider.baseUrl.replace(/\/+$/, '');

        const response = await fetchWithV1Retry(apiBase, '/chat/completions', {
          method: 'POST',
          skipV1Retry: true,
          redirect: 'manual',
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
          updateTaskProgress(taskId, { status: 'failed', error: `质检上游返回 HTTP ${response.status}（任务 ${taskId}），请核实供应商状态和费用` });
          return;
        }

        const apiResp = await response.json();
        const content = apiResp.choices?.[0]?.message?.content || '';

        let parsed: unknown;
        try {
          const jsonMatch = typeof content === 'string' ? content.match(/\{[\s\S]*\}/) : null;
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        } catch {
          // Invalid provider content is handled below.
        }
        const qcResult = qcResultSchema.safeParse(parsed);
        if (!qcResult.success) {
          updateTaskProgress(taskId, { status: 'failed', error: `质检结果格式无效（任务 ${taskId}），请核实供应商费用` });
          return;
        }

        updateTaskProgress(taskId, {
          status: 'completed',
          progress: 100,
          result: { qcResult: qcResult.data, type: 'venue-qc' },
        });
      } catch {
        updateTaskProgress(taskId, {
          status: 'failed',
          error: `质检结果暂无法确认（任务 ${taskId}），请核实供应商状态和费用`,
        });
      }
    })();

    return NextResponse.json({ success: true, taskId, status: 'running' });
  } catch {
    return NextResponse.json(
      { error: '质检暂时不可用，请稍后查看任务状态' },
      { status: 500 },
    );
  }
}
