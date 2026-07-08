import { NextRequest, NextResponse } from 'next/server';
import { diagnoseFailure } from '@/lib/video-director';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { issue, issueType, prompt, model, aspectRatio, duration } = body || {};
    const issueKey = String(issueType || issue || 'generic');
    const d = diagnoseFailure(issueKey as any);
    return NextResponse.json({ success: true, diagnosis: d, prompt, model, aspectRatio, duration });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || '诊断失败' }, { status: 500 });
  }
}
