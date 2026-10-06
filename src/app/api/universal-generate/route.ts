import { NextRequest, NextResponse, after } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createBillableTask } from '@/lib/task-core/billing-service';
import { getCloudTaskForUser, getCloudTaskForUserByIdempotencyKey, CanvasBatchCommitUnknownError } from '@/lib/cloud-task-storage';
import { resolveTaskModelForUser } from '@/lib/task-core/model-catalog';
import { CanvasTaskPublicationError } from '@/lib/collaboration/task-publication';
import { calculateConfiguredCreditCost, InsufficientCreditsError } from '@/lib/credits';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
import { parseCanvasUniversalPublication, canvasUniversalRequestDigest, readCanvasUniversalTask, validateCanvasUniversalSources,
  validateCanvasUniversalReplay, isUniversalTerminal, CanvasUniversalAdmissionError } from '@/lib/collaboration/canvas-universal-generation-admission';
import { executeUniversalGenerationTask, universalTaskResponse } from '@/lib/task-core/universal-generation-task';
import { findProviderForModel, findProviderById, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { authorizeGenerationProject, GenerationProjectAccessError } from '@/lib/collaboration/generation-project-access';
import { resolveCompatProfile } from '@/lib/api-compatibility';
import { checkPromptSafety } from '@/lib/prompt-safety';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import {
  normalizeImageOutputRequestBody,
  UnsupportedTransparentBackgroundError,
} from '@/lib/image-generation-output';
import { executePrivateUniversalGeneration, type UniversalGenerateRequest } from '@/lib/task-core/universal-generation-provider';

// 通用API生成路由 - 支持第三方OpenAI兼容API的图像生成
// 当用户使用非 APIMart 管理的第三方模型时，图像生成请求会被路由到这里
export const maxDuration = 600; // 10分钟 - token link等API生图最久可达600s
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;
  let canvasRequest = false;
  let idempotencyKey: string | undefined;
  try {
    const body: UniversalGenerateRequest = await request.json();
    const access = await authorizeGenerationProject({ actorUserId: authResult.userId, projectId: body.projectId });
    canvasRequest = access.kind === 'document' && (body.assetScope === undefined || body.assetScope === 'canvas');
    idempotencyKey = request.headers.get('Idempotency-Key') || randomUUID();
    const identity = { type: 'universal-generate' as const, idempotencyKey, requestDigest: canvasUniversalRequestDigest(body) };
    if (access.kind !== 'document' && request.headers.has('Idempotency-Key')) {
      const previous = await getCloudTaskForUserByIdempotencyKey(authResult.userId, identity.idempotencyKey);
      if (previous?.type === 'universal-generate') {
        if (previous.requestDigest !== identity.requestDigest || previous.projectId !== body.projectId) throw new CanvasUniversalAdmissionError(409, 'IDEMPOTENCY_CONFLICT');
        if (isUniversalTerminal(previous.status)) return NextResponse.json(universalTaskResponse(previous));
        throw new CanvasUniversalAdmissionError(403, 'CANVAS_UNIVERSAL_SOURCE_FORBIDDEN');
      }
    }
    const existing = access.kind === 'document' ? await readCanvasUniversalTask({ access, workspace: 'canvas', workspaceId: access.projectId }, identity) : null;
    if (existing && isUniversalTerminal(existing.status)) return NextResponse.json(universalTaskResponse(existing));
    if (body.assetScope !== undefined && !['canvas', 'chat', 'workflow'].includes(String(body.assetScope))) {
      throw new CanvasUniversalAdmissionError(400, 'CANVAS_UNIVERSAL_INVALID_SCOPE');
    }
    if (access.kind === 'document' && (body.assetScope === undefined || body.assetScope === 'canvas')) {
      const publication = parseCanvasUniversalPublication(access, body);
      if (existing) await validateCanvasUniversalReplay(publication, identity, existing.id);
      const sourceUrls = await validateCanvasUniversalSources(publication, body, request.nextUrl.origin);
      if (existing) {
        const execute = async (): Promise<void> => executeUniversalGenerationTask({ taskId: existing.id, actorUserId: authResult.userId, origin: request.nextUrl.origin });
        if (body.submitOnly === true) { try { after(execute); } catch { /* Durable task is recoverable by poll. */ } }
        else await execute();
        return NextResponse.json(universalTaskResponse((await getCloudTaskForUser(existing.id, authResult.userId))!));
      }
      const n = body.n === undefined ? 1 : body.n;
      if (!Number.isSafeInteger(n) || n < 1) throw new CanvasUniversalAdmissionError(400, 'CANVAS_UNIVERSAL_INVALID_COUNT');
      if (typeof body.model !== 'string' || !body.model || typeof body.prompt !== 'string' || !body.prompt.trim()
        || checkPromptSafety(body.prompt).level === 'block') throw new CanvasUniversalAdmissionError(400, 'CANVAS_UNIVERSAL_INVALID');
      const parts = body.model.split('::');
      const hasProviderId = Object.hasOwn(body, 'providerId');
      if ((hasProviderId && (typeof body.providerId !== 'string' || !body.providerId.trim() || body.providerId.trim() !== body.providerId))
        || parts.length > 2 || parts.some(part => !part.trim() || part.trim() !== part)) {
        throw new CanvasUniversalAdmissionError(400, 'CANVAS_UNIVERSAL_PROVIDER_INVALID');
      }
      const compositeProvider = parts.length === 2 ? parts[0] : undefined;
      if (compositeProvider !== undefined && hasProviderId && compositeProvider !== body.providerId) throw new CanvasUniversalAdmissionError(400, 'CANVAS_UNIVERSAL_PROVIDER_INVALID');
      const model = normalizeModelForApi(parts.at(-1)!).apiModelName;
      const normalizedBody = normalizeImageOutputRequestBody(body, model);
      const selectedProvider = hasProviderId ? body.providerId : compositeProvider;
      const provider = selectedProvider !== undefined ? await findProviderById(selectedProvider) : await findProviderForModel(model, 'image');
      if (!provider?.apiKey || !provider.isEnabled) throw new CanvasUniversalAdmissionError(400, 'CANVAS_UNIVERSAL_PROVIDER_INVALID');
      try { await resolveTaskModelForUser(provider.id, model, authResult.user); }
      catch { throw new CanvasUniversalAdmissionError(400, 'CANVAS_UNIVERSAL_MODEL_INVALID'); }
      const cost = await calculateConfiguredCreditCost('image_generate', model, { providerId: provider.id, quality: body.quality });
      if (!Number.isSafeInteger(cost * n) || cost * n < 0) throw new CanvasUniversalAdmissionError(400, 'CANVAS_UNIVERSAL_INVALID_COST');
      const now = Date.now();
      const admitted = await createBillableTask({ userId: authResult.userId, ...identity, creditCost: cost * n, canvasPublication: publication,
        task: { id: `universal_${randomUUID()}`, type: 'universal-generate', status: 'processing', projectId: access.projectId,
          providerId: provider.id, model, progress: 0, label: '生成图片', createdAt: now, updatedAt: now,
          result: { universalGeneration: { version: 1, route: '/api/universal-generate', requestDigest: identity.requestDigest,
            providerId: provider.id, publication, target: { baseUrl: normalizeApiBaseUrl(provider.baseUrl), profile: resolveCompatProfile(provider) },
            request: { model, prompt: body.prompt, n, quality: body.quality, aspectRatio: body.aspectRatio,
              referenceImageUrl: sourceUrls[0], background: normalizedBody.background, output_format: normalizedBody.output_format } } } } });
      const task = await getCloudTaskForUser(admitted.task.id, authResult.userId);
      if (!task) throw new CanvasUniversalAdmissionError(503, 'CANVAS_UNIVERSAL_UNAVAILABLE');
      if (isUniversalTerminal(task.status)) return NextResponse.json(universalTaskResponse(task));
      const execute = async (): Promise<void> => executeUniversalGenerationTask({ taskId: task.id, actorUserId: authResult.userId, origin: request.nextUrl.origin });
      if (body.submitOnly === true) { try { after(execute); } catch { /* Durable task is recoverable by poll. */ } return NextResponse.json(universalTaskResponse(task)); }
      await execute();
      return NextResponse.json(universalTaskResponse((await getCloudTaskForUser(task.id, authResult.userId))!));
    }
    return await executePrivateUniversalGeneration(body);

  } catch (error: unknown) {
    // The transaction may have committed even when its acknowledgement was lost.
    // Expose only the request key, never an unconfirmed candidate task ID.
    const recoveryIdentity = canvasRequest && idempotencyKey ? { idempotencyKey } : {};
    if (error instanceof UnsupportedTransparentBackgroundError) return NextResponse.json({ success: false, code: 'TRANSPARENT_BACKGROUND_UNSUPPORTED', error: error.message, retryable: false }, { status: 400 });
    if (error instanceof CanvasUniversalAdmissionError || error instanceof CanvasTaskPublicationError || error instanceof CanvasBatchCommitUnknownError || error instanceof IdempotencyConflictError || error instanceof InsufficientCreditsError) {
      return NextResponse.json({ success: false, code: error.code, error: error.message, ...recoveryIdentity }, { status: error instanceof InsufficientCreditsError ? 402 : error.status });
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'CANVAS_TASK_PUBLICATION_UNAVAILABLE') return NextResponse.json({ success: false, code: error.code, error: '画布生成暂不可用，请使用原请求标识重试', ...recoveryIdentity }, { status: 503 });
    if (error instanceof GenerationProjectAccessError) {
      return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: error.status });
    }
    if (canvasRequest) return NextResponse.json({ success: false, code: 'CANVAS_UNIVERSAL_UNAVAILABLE', error: '画布生成暂不可用，请使用原请求标识重试', ...recoveryIdentity }, { status: 503 });
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Universal API] 生成错误:', error);
    return NextResponse.json({
      success: false,
      error: `通用API生成失败: ${message}`,
    }, { status: 500 });
  }
}
