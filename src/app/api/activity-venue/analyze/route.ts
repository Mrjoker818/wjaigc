import { NextRequest, NextResponse } from 'next/server';
import { getApiProviders } from '@/lib/server-api-config';
import { configuredPaidProviderBaseUrl } from '@/lib/paid-provider-submit';
import { submitVenueCompletion } from '@/lib/activity-venue-submission';
import { getSessionUser } from '@/lib/server-auth';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { selectActivityVenueModel } from '@/lib/activity-venue-model';
import { z } from 'zod';

const dimension = z.number().finite().positive();
const regionCoordinates = z.object({
  x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1),
  w: z.number().finite().positive().max(1), h: z.number().finite().positive().max(1),
}).passthrough().refine(position => position.x + position.w <= 1 && position.y + position.h <= 1);
const venueAnalysisSchema = z.object({
  spaceType: z.string().min(1),
  estimatedDimensions: z.object({ length: dimension, width: dimension, height: dimension }).passthrough(),
  lighting: z.string().min(1),
  regions: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), type: z.string().min(1),
    position: z.union([z.string().refine(value => value.trim().length > 0), regionCoordinates]),
    estimatedSize: z.union([z.string(), z.object({ length: dimension, width: dimension }).passthrough()]).optional(),
    notes: z.string().optional(),
  }).passthrough()),
  structuralLimits: z.array(z.string()),
  designNotes: z.string(),
}).passthrough();

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

    if ((providerId !== undefined && typeof providerId !== 'string') || (model !== undefined && typeof model !== 'string')) {
      return NextResponse.json({ error: '供应商或模型参数无效' }, { status: 400 });
    }
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) return NextResponse.json({ error: '请登录后分析场馆' }, { status: 401 });
    const providers = await getApiProviders();
    const selection = selectActivityVenueModel(providers, sessionUser, providerId, model);
    if (!selection.ok) return NextResponse.json({ error: selection.error }, { status: selection.status });
    const { provider, modelId: selectedModel } = selection;
    const baseUrl = configuredPaidProviderBaseUrl(provider.baseUrl);

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

        const content = await submitVenueCompletion({
          taskId, baseUrl, apiKey: provider.apiKey,
          body: {
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
          },
        });
        if (content === undefined) return;

        let parsed: unknown;
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        } catch {
          // Invalid provider content is handled below.
        }
        const analysis = venueAnalysisSchema.safeParse(parsed);
        if (!analysis.success) {
          updateTaskProgress(taskId, { status: 'failed', error: `场馆分析结果格式无效（任务 ${taskId}），请先核实供应商费用` });
          return;
        }

        updateTaskProgress(taskId, {
          status: 'completed',
          progress: 100,
          result: { analysis: analysis.data, type: 'venue-analyze' },
        });
      } catch {
        updateTaskProgress(taskId, {
          status: 'failed',
          error: `场馆分析未能完成（任务 ${taskId}），请核实任务状态`,
        });
      }
    })();

    return NextResponse.json({ success: true, taskId, status: 'running' });
  } catch {
    return NextResponse.json(
      { error: '场馆分析暂时不可用，请稍后查看任务状态' },
      { status: 500 },
    );
  }
}
