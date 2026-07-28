import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import { submitLayerDecomposition } from '@/lib/layer-decomposition/service';
import { parseLayerRequest, validateLayerIdempotencyKey } from '@/lib/layer-decomposition/validation';
import { logError, logOperation, OP_ACTIONS, startTimer } from '@/lib/op-log';
import { findProviderForFeature } from '@/lib/server-api-config';

interface LegacySegmentRequest {
  imageUrl?: unknown;
  engine?: unknown;
  providerId?: unknown;
  modelId?: unknown;
  model?: unknown;
}

export async function POST(request: NextRequest) {
  const timer = startTimer();
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json() as LegacySegmentRequest;
    const legacyEngine = String(body.engine || 'auto').toLowerCase();
    const engine = legacyEngine === 'local'
      ? 'local'
      : legacyEngine === 'ai'
        ? 'cloud'
        : 'smart';
    let providerId = typeof body.providerId === 'string' ? body.providerId : undefined;
    let modelId = typeof body.modelId === 'string'
      ? body.modelId
      : typeof body.model === 'string' ? body.model : undefined;
    if (engine !== 'local' && (!providerId || !modelId)) {
      const provider = await findProviderForFeature('layer');
      const configuredModel = provider?.selectedModels?.[0]
        || provider?.discoveredModels?.[0]?.id;
      if (provider && configuredModel) {
        providerId = provider.id;
        modelId = configuredModel;
      }
    }
    const layerRequest = parseLayerRequest({
      imageUrl: body.imageUrl,
      engine,
      providerId,
      modelId,
    });
    const idempotencyKey = validateLayerIdempotencyKey(
      request.headers.get('idempotency-key') || `segment-${randomUUID()}`,
    );
    const result = await submitLayerDecomposition({
      userId: auth.userId,
      userRole: auth.userRole,
      idempotencyKey,
      request: layerRequest,
    });
    logOperation({
      userId: auth.userId,
      action: OP_ACTIONS.IMAGE_SEGMENT,
      targetType: 'layer-task',
      targetId: result.taskId,
      detail: `提交图片分层任务 (${engine})`,
      responseStatus: 202,
      durationMs: timer.end(),
      model: modelId,
      providerId,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'LAYER_SEGMENT_COMPATIBILITY_ERROR';
    const status = error && typeof error === 'object' && 'status' in error
      ? Number(error.status)
      : 500;
    logError(OP_ACTIONS.IMAGE_SEGMENT, error, {
      userId: auth.userId,
      targetType: 'layer-task',
      detail: '图片分层任务提交失败',
      responseStatus: status,
      durationMs: timer.end(),
    });
    return NextResponse.json({
      success: false,
      code,
      message: error instanceof Error ? error.message : '编辑元素任务提交失败',
      retryable: false,
    }, { status });
  }
}
