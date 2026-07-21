import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';

/**
 * POST /api/activity-venue/lock-design
 * 锁定Design ID — 将选中的方案关键参数固化为设计规范，后续生成效果图须遵守
 * Input: { proposal, brandName, venueAnalysis, activityBrief }
 * Output: { designId } (同步返回，无需轮询)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { proposal, brandName = '', venueAnalysis, activityBrief } = body;

    if (!proposal) {
      return NextResponse.json({ error: '请提供要锁定的方案' }, { status: 400 });
    }

    const sessionUser = await getSessionUser(request).catch(() => null);
    const version = `v${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // Build Design ID from proposal + context
    const designId = {
      id: `did_${Date.now()}`,
      version,
      brandName,
      theme: proposal.name || '未命名方案',
      lockedAt: new Date().toISOString(),
      lockedBy: sessionUser?.id || 'anonymous',
      lockedFields: {
        layout: {
          spaceType: venueAnalysis?.spaceType || 'unknown',
          dimensions: venueAnalysis?.estimatedDimensions,
          regionUsage: proposal.regionUsage || [],
          flowDesign: proposal.flowDesign || '',
          mainInstallation: proposal.mainInstallation || '',
        },
        colors: {
          primary: proposal.visualElements?.primaryColor || '',
          scheme: proposal.style || '',
        },
        materials: proposal.visualElements?.materials || [],
        brandRules: {
          brandName,
          eventName: activityBrief?.eventName || '',
          highlights: proposal.highlights || [],
        },
        lightingScheme: proposal.visualElements?.lighting || '',
        viewAngles: ['正面全景', '45°斜视', '鸟瞰平面'],
        renderPromptHint: proposal.renderPromptHint || '',
        estimatedCost: proposal.estimatedCost || '',
        pros: proposal.pros || [],
        concept: proposal.concept || '',
      },
      versions: [],
    };

    return NextResponse.json({ success: true, designId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '锁定失败' },
      { status: 500 },
    );
  }
}
