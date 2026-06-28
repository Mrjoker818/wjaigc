import { NextRequest, NextResponse } from 'next/server';
import { getTaskInfo } from '@/lib/task-registry';
import { findProviderForModel } from '@/lib/server-api-config';
import { resolveCompatProfile, parseResponseForProfile } from '@/lib/api-compatibility';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { normalizeModelForApi } from '@/lib/model-capabilities';

export async function GET(request: NextRequest) {
  try {
    const taskId = request.nextUrl.searchParams.get('taskId');
    if (!taskId) {
      return NextResponse.json({ error: '缺少taskId参数' }, { status: 400 });
    }

    const task = getTaskInfo(taskId);
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    // If still processing, try polling the provider
    if (task.status === 'processing' && task.result && typeof task.result === 'object') {
      const result = task.result as Record<string, unknown>;
      const providerId = result.providerId as string | undefined;
      const pollUrl = result.pollUrl as string | undefined;
      const model = result.model as string | undefined;

      if (pollUrl && providerId) {
        const { apiModelName: normalizedModel } = normalizeModelForApi(model || '');
        const provider = await findProviderForModel(normalizedModel, 'image', providerId);
        if (provider) {
          const profile = resolveCompatProfile(provider);
          let apiBase = provider.baseUrl.replace(/\/+$/, '');
          if (apiBase.endsWith('/v1')) apiBase = apiBase.slice(0, -3);

          const pollRes = await fetchWithV1Retry(apiBase, `/tasks/${pollUrl}`, {
            headers: { 'Authorization': `Bearer ${provider.apiKey}` },
          });
          if (pollRes.ok) {
            const pollData = await pollRes.json();
            const parsed = parseResponseForProfile(pollData, profile);
            if (parsed.mode === 'direct' && parsed.directImageUrls.length > 0) {
              return NextResponse.json({
                success: true,
                status: 'completed',
                results: parsed.directImageUrls.map((url: string, i: number) => ({
                  id: `img_${i}`,
                  url,
                  type: 'package_render',
                })),
              });
            }
          }
        }
      }
    }

    // Return current task state
    const result = task.result as Record<string, unknown> | undefined;
    const imageUrls = (result?.imageUrls || []) as string[];

    return NextResponse.json({
      success: true,
      status: task.status,
      progress: task.progress,
      results: imageUrls.map((url: string, i: number) => ({
        id: `img_${i}`,
        url,
        type: 'package_render',
      })),
      prompt: result?.prompt || '',
      analysis: result?.analysis || null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '服务器错误' },
      { status: 500 }
    );
  }
}
