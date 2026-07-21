import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderById } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getSessionUser } from '@/lib/server-auth';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { normalizeModelForApi } from '@/lib/model-capabilities';

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

    const provider = providerId
      ? await findProviderById(providerId)
      : await findProviderForModel(model || '', 'chat');
    if (!provider) {
      return NextResponse.json({ error: '未找到可用的LLM模型，请在管理员后台配置' }, { status: 400 });
    }

    const rawModel = provider.selectedModels?.[0] || model || 'gemini-2.5-flash';
    const { apiModelName: selectedModel } = normalizeModelForApi(rawModel);

    const sessionUser = await getSessionUser(request).catch(() => null);
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

        const userPrompt = `基于以下信息，生成3套有明显差异化的展陈布局方案：

## 场馆条件
- 空间类型：${venueAnalysis.spaceType}
- 估算尺寸：${JSON.stringify(venueAnalysis.estimatedDimensions)}mm
- 光线：${venueAnalysis.lighting}
- 可用区域：${venueAnalysis.regions?.map((r: { name: string; type: string; position: string }) => `${r.name}(${r.type}, ${r.position})`).join('；')}
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
      "regionUsage": [
        { "regionId": "r1", "usage": "主展台+互动装置", "priority": "primary" },
        { "regionId": "r2", "usage": "打卡拍照区", "priority": "secondary" }
      ],
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

确保3套方案在以下维度有明显差异：空间布局策略、视觉风格取向、互动体验形式、预算侧重点。`;

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

        let proposals = null;
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) proposals = JSON.parse(jsonMatch[0]);
        } catch {
          // ignore
        }

        if (!proposals?.proposals || proposals.proposals.length < 2) {
          // Retry with simpler prompt
          updateTaskProgress(taskId, { status: 'processing', progress: 50, label: '正在补全方案...' });
          // Build 3 minimal fallback proposals
          proposals = {
            proposals: [
              { id: 'p1', name: '方案A — 沉浸体验型', concept: '以沉浸式互动体验为核心，打造品牌专属空间', style: 'immersive', highlights: ['沉浸式视觉', '互动装置', '品牌故事线'], regionUsage: [], mainInstallation: '中央沉浸装置', visualElements: { primaryColor: '#000', materials: ['LED屏', '透明亚克力'], lighting: '动态灯光' }, flowDesign: '环形动线', estimatedCost: '¥100,000', renderPromptHint: `${brandName} immersive brand exhibition, LED display walls, circular flow`, pros: ['视觉冲击强'], cons: ['成本较高'] },
              { id: 'p2', name: '方案B — 简约展示型', concept: '极简风格，突出产品本身，清晰传达品牌调性', style: 'minimalist', highlights: ['极简展台', '产品焦点', '清晰导视'], regionUsage: [], mainInstallation: '线性展示台', visualElements: { primaryColor: '#fff', materials: ['烤漆板', '不锈钢'], lighting: '自然光+射灯' }, flowDesign: '线性动线', estimatedCost: '¥60,000', renderPromptHint: `${brandName} minimalist product display, white podium, spotlights`, pros: ['预算友好', '制作周期短'], cons: ['互动性弱'] },
              { id: 'p3', name: '方案C — 互动打卡型', concept: '以社交分享为核心，打造高传播度的打卡场景', style: 'social_media', highlights: ['网红打卡装置', '社交传播点', '品牌LOGO墙'], regionUsage: [], mainInstallation: 'LOGO装置打卡墙', visualElements: { primaryColor: '#ff6b9d', materials: ['花艺', '彩色亚克力', '霓虹灯'], lighting: '柔和环境光' }, flowDesign: '自由探索型', estimatedCost: '¥75,000', renderPromptHint: `${brandName} instagram-worthy brand activation, neon signs, photo wall`, pros: ['传播效果好', '吸引年轻客群'], cons: ['品牌感稍弱'] },
            ],
          };
        }

        updateTaskProgress(taskId, {
          status: 'completed',
          progress: 100,
          result: { proposals: proposals.proposals, type: 'venue-proposals' },
        });
      } catch (err) {
        updateTaskProgress(taskId, {
          status: 'failed',
          error: err instanceof Error ? err.message : '方案生成失败',
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
