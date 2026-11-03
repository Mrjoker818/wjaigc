import { NextRequest, NextResponse } from 'next/server';
import { getApiProviders } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getSessionUser } from '@/lib/server-auth';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { selectActivityVenueModel } from '@/lib/activity-venue-model';
import { z } from 'zod';

const proposalText = z.string().refine(value => value.trim().length > 0);
const proposalSchema = z.object({
  id: proposalText,
  name: proposalText,
  concept: proposalText,
  style: proposalText,
  highlights: z.array(proposalText).min(1),
  regionUsage: z.array(z.object({ regionId: proposalText, usage: proposalText, priority: proposalText }).passthrough()),
  mainInstallation: proposalText,
  visualElements: z.object({ primaryColor: proposalText, materials: z.array(proposalText).min(1), lighting: proposalText }).passthrough(),
  flowDesign: proposalText,
  estimatedCost: proposalText,
  renderPromptHint: proposalText,
  pros: z.array(proposalText).min(1),
  cons: z.array(proposalText).min(1),
}).passthrough();
const proposalsSchema = z.object({
  proposals: z.array(proposalSchema).length(3).refine(items => new Set(items.map(item => item.id)).size === items.length),
}).passthrough();

function formatVenuePosition(position: unknown): string {
  if (typeof position === 'string') return position.trim() ? position : '位置未知';
  if (!position || typeof position !== 'object' || Array.isArray(position)) return '位置未知';
  const { x, y, w, h } = position as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof w !== 'number' || typeof h !== 'number'
    || ![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1) return '位置未知';
  return `归一化坐标（图片左上角为原点，x/y为位置，w/h为宽高，范围0–1） ${JSON.stringify({ x, y, w, h })}`;
}

/**
 * POST /api/activity-venue/proposals
 * 基于场馆分析结果 + 活动需求，生成3套差异化布局方案
 * Input: { venueAnalysis, activityBrief, brandName, assets?, model?, providerId? }
 * Output: { taskId } — poll via /api/poll-task
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { venueAnalysis, activityBrief, brandName = '', assets = [], model, providerId } = body;

    if (!venueAnalysis || !activityBrief) {
      return NextResponse.json({ error: '请提供场馆分析结果和活动需求' }, { status: 400 });
    }

    if ((providerId !== undefined && typeof providerId !== 'string') || (model !== undefined && typeof model !== 'string')) {
      return NextResponse.json({ error: '供应商或模型参数无效' }, { status: 400 });
    }
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) return NextResponse.json({ error: '请登录后生成布局方案' }, { status: 401 });
    const providers = await getApiProviders();
    const selection = selectActivityVenueModel(providers, sessionUser, providerId, model);
    if (!selection.ok) return NextResponse.json({ error: selection.error }, { status: selection.status });
    const { provider, modelId: selectedModel } = selection;
    const taskId = `venue_proposals_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    registerTask(taskId, 'venue-proposals', `布局方案生成: ${brandName}`, sessionUser?.id);

    (async () => {
      try {
        updateTaskProgress(taskId, { status: 'processing', progress: 10, label: '正在生成布局方案...' });

        const systemPrompt = `你是一名资深展陈空间策划师，擅长根据场馆特点和活动需求生成差异化布局方案。
请以严格 JSON 格式输出，不要输出任何 markdown 代码块标记。`;

        const assetDesc = assets.length > 0
          ? `\n已有品牌素材：${assets.map((a: { type: string }) => a.type).join('、')}`
          : '';

        const exampleRegionId = Array.isArray(venueAnalysis.regions)
          ? venueAnalysis.regions.find((region: unknown) => region && typeof region === 'object'
            && 'id' in region && typeof region.id === 'string' && region.id.trim())?.id
          : undefined;
        const regionUsageExample = exampleRegionId
          ? JSON.stringify([{ regionId: exampleRegionId, usage: '主展台+互动装置', priority: 'primary' }])
          : '[]';

        const userPrompt = `基于以下信息，生成3套有明显差异化的展陈布局方案：

## 场馆条件
- 空间类型：${venueAnalysis.spaceType}
- 估算尺寸：${JSON.stringify(venueAnalysis.estimatedDimensions)}mm
- 光线：${venueAnalysis.lighting}
- 可用区域：${venueAnalysis.regions?.map((r: { id?: string; name: string; type: string; position: unknown }) => `${r.name}(${r.type}, ${formatVenuePosition(r.position)}) 区域ID: ${JSON.stringify(r.id || '')}`).join('；')}
- 结构限制：${venueAnalysis.structuralLimits?.join('；') || '无'}

## 活动需求
- 品牌：${brandName}
- 活动名称：${activityBrief.eventName || ''}
- 活动类型：${activityBrief.eventType || '品牌展陈'}
- 预期客流：${activityBrief.expectedCapacity || ''}人/天
- 核心目标：${activityBrief.primaryGoal || '品牌曝光'}
- 预算范围：¥${activityBrief.budget || '不限'}
- 品牌风格：${activityBrief.brandStyle || ''}
- 特别要求：${activityBrief.specialRequirements || '无'}${assetDesc}

请生成3套差异化方案，严格按以下 JSON 结构输出：
{
  "proposals": [
    {
      "id": "p1",
      "name": "方案A — 沉浸体验型",
      "concept": "方案核心理念（2-3句话）",
      "style": "modern_minimalist",
      "highlights": ["亮点1", "亮点2", "亮点3"],
      "regionUsage": ${regionUsageExample},
      "mainInstallation": "主展装置描述",
      "visualElements": { "primaryColor": "品牌主色", "materials": ["铝合金", "亚克力", "LED灯带"], "lighting": "聚光灯+环境光" },
      "flowDesign": "人流动线说明",
      "estimatedCost": "¥80,000",
      "renderPromptHint": "用于AI生成效果图的关键词提示（英文）",
      "pros": ["优点1", "优点2"],
      "cons": ["不足1"]
    }
  ]
}

确保3套方案在以下维度有明显差异：空间布局策略、视觉风格取向、互动体验形式、预算侧重点。regionUsage 中的 regionId 必须使用上述场馆区域ID；若无可用ID，regionUsage 返回空数组。`;

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
              { role: 'user', content: userPrompt },
            ],
            max_tokens: 4096,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          updateTaskProgress(taskId, { status: 'failed', error: `方案生成失败: ${response.status} ${errText.slice(0, 200)}` });
          return;
        }

        const apiResp = await response.json();
        const content = apiResp.choices?.[0]?.message?.content || '';

        let proposals: unknown = null;
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) proposals = JSON.parse(jsonMatch[0]);
        } catch {
          // ignore
        }

        const parsed = proposalsSchema.safeParse(proposals);
        const regionIds = new Set<string>(Array.isArray(venueAnalysis.regions)
          ? venueAnalysis.regions.flatMap((region: unknown) => {
            if (!region || typeof region !== 'object' || !('id' in region)) return [];
            return typeof region.id === 'string' && region.id.trim() ? [region.id] : [];
          }) : []);
        if (!parsed.success || parsed.data.proposals.some(proposal => proposal.regionUsage.some(region => !regionIds.has(region.regionId)))) {
          updateTaskProgress(taskId, { status: 'failed', error: `供应商返回的方案格式无效；请先核实任务 ${taskId} 的状态和费用` });
          return;
        }

        updateTaskProgress(taskId, {
          status: 'completed',
          progress: 100,
          result: { proposals: parsed.data.proposals, type: 'venue-proposals' },
        });
      } catch (err) {
        updateTaskProgress(taskId, {
          status: 'failed',
          error: err instanceof Error ? err.message : '方案生成失败',
        });
      }
    })();

    return NextResponse.json({ success: true, taskId, status: 'running' });
  } catch {
    return NextResponse.json(
      { error: '布局方案暂时不可用，请稍后查看任务状态' },
      { status: 500 },
    );
  }
}
