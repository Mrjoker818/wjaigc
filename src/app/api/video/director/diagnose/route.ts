import { NextRequest, NextResponse } from 'next/server';
import { diagnoseFailure, listFailureTypes } from '@/lib/video-director';
import type { VideoFailureType } from '@/lib/video-director/retake-diagnosis';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      issue,
      issueType,
      failureType,
      shot,
      videoUrl,
      prompt,
      model,
      aspectRatio,
      duration,
    } = body || {};

    // 兼容多种参数命名：failureType / issueType / issue
    const issueKey = String(failureType || issueType || issue || 'generic');
    const diagnosis = diagnoseFailure(issueKey as VideoFailureType);

    // retakeSuggestions 顶层数组返回，便于前端直接迭代
    const retakeSuggestions = Array.isArray(diagnosis?.retakeSuggestions)
      ? diagnosis.retakeSuggestions
      : [];

    return NextResponse.json({
      success: true,
      failureType: issueKey,
      diagnosis: {
        ...diagnosis,
        // 保证前端可通过 diagnosis.retakeSuggestions 访问
        retakeSuggestions,
      },
      retakeSuggestions,
      availableTypes: listFailureTypes ? listFailureTypes() : undefined,
      context: {
        hasShot: !!(shot && typeof shot === 'object'),
        hasVideoUrl: !!videoUrl,
        prompt,
        model,
        aspectRatio,
        duration,
      },
      // 预留字段：未来接入多模态分析时填充
      note: videoUrl
        ? '当前版本基于失败类型查表返回静态建议；视频内容分析在后续版本接入。'
        : undefined,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '诊断失败' }, { status: 500 });
  }
}
