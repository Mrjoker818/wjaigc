import { Config, HeaderUtils, LLMClient } from 'coze-coding-dev-sdk';
import { NextRequest } from 'next/server';
import {
  buildQuickCreateCompilerPrompt,
  parseQuickCreateCompilePayload,
  parseQuickCreateCompileRequest,
  supportsQuickCreateVision,
  type QuickCreateCompileRequest,
  type QuickCreateCompileSseEvent,
  type QuickCreateModelSource,
} from '@/lib/quick-create-compile';
import {
  isModelAssignedToUser,
  resolveQuickCreateModel,
  type QuickCreateModelCandidate,
} from '@/lib/model-defaults';
import { checkPromptSafety, logSafetyWarning } from '@/lib/prompt-safety';
import { getRuntimeSettings } from '@/lib/runtime-settings';
import { getApiProviders } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import type { ApiProvider, ModelInfo } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120; // 防止 LLM 卡住导致 serverless 函数超时

interface AuthorizedChatModel extends QuickCreateModelCandidate {
  provider: ApiProvider;
  modelInfo: ModelInfo | null;
}

function providerSupportsChat(provider: ApiProvider): boolean {
  const type = provider.modelType ?? provider.type;
  return type === 'chat' || type === 'vlm' || type === 'universal' || type === 'general';
}

function providerOwnsModel(provider: ApiProvider, modelId: string): boolean {
  return Boolean(
    provider.selectedModels?.includes(modelId)
    || provider.selectedModel === modelId
    || provider.discoveredModels?.some((model: ModelInfo) => model.id === modelId),
  );
}

function modelAllowedForUser(user: User, providerId: string, modelId: string): boolean {
  return user.role === 'admin'
    || isModelAssignedToUser(user.chatModels, providerId, modelId);
}

function buildAuthorizedModels(user: User, providers: ApiProvider[]): AuthorizedChatModel[] {
  const result: AuthorizedChatModel[] = [];

  for (const provider of providers) {
    if (!provider.isEnabled || !providerSupportsChat(provider)) continue;
    if (!provider.baseUrl?.trim() || !provider.apiKey?.trim()) continue;

    const selectedIds = new Set<string>();
    for (const modelId of provider.selectedModels ?? []) selectedIds.add(modelId);
    if (provider.selectedModel) selectedIds.add(provider.selectedModel);
    for (const model of provider.discoveredModels ?? []) {
      if (provider.selectedModels?.includes(model.id) || provider.selectedModel === model.id) {
        selectedIds.add(model.id);
      }
    }

    for (const modelId of selectedIds) {
      if (
        !providerOwnsModel(provider, modelId)
        || !modelAllowedForUser(user, provider.id, modelId)
      ) continue;
      const modelInfo = provider.discoveredModels?.find((model: ModelInfo) => model.id === modelId) ?? null;
      result.push({
        id: `${provider.id}::${modelId}`,
        providerId: provider.id,
        modelId,
        name: modelInfo?.displayName || modelInfo?.name || modelId,
        providerName: provider.displayName || provider.name,
        provider,
        modelInfo,
      });
    }
  }

  return result;
}

function toAbsoluteReferenceImage(request: NextRequest, value: string): string {
  if (!value.startsWith('/')) return value;
  return new URL(value, request.nextUrl.origin).toString();
}

function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function requestErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.startsWith('快速创作请求字段无效：')) {
    return error.message;
  }
  return '快速创作请求格式无效';
}

function compileErrorMessage(error: unknown, requestAborted: boolean): string {
  if (requestAborted) return '快速创作请求已取消';
  if (error instanceof Error && (
    error.message.startsWith('模型未返回完整的 JSON 对象')
    || error.message.startsWith('模型返回的创作方案')
  )) {
    return error.message;
  }
  return '快速创作编译失败，请稍后重试';
}

function createErrorStream(message: string, code: string): Response {
  const encoder = new TextEncoder();
  return sseResponse(new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>) {
      const send = (event: QuickCreateCompileSseEvent): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      send({ type: 'error', message, code });
      send({ type: 'done' });
      controller.close();
    },
  }));
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: QuickCreateCompileRequest;
  try {
    body = parseQuickCreateCompileRequest(await request.json());
  } catch (error: unknown) {
    return createErrorStream(requestErrorMessage(error), 'INVALID_REQUEST');
  }

  const user = await getSessionUser(request).catch(() => null);
  if (!user) return createErrorStream('请先登录后再使用快速创作', 'UNAUTHORIZED');
  if (user.status === 'disabled') return createErrorStream('当前账号已被禁用', 'ACCOUNT_DISABLED');
  if (user.apiPermissions && !user.apiPermissions.chat) {
    return createErrorStream('当前账号没有聊天模型使用权限', 'CHAT_PERMISSION_DENIED');
  }

  const safetyResult = checkPromptSafety(body.prompt);
  if (safetyResult.level === 'block') {
    return createErrorStream(safetyResult.reason || '创作需求未通过安全检查', 'PROMPT_BLOCKED');
  }
  if (safetyResult.level === 'warning') logSafetyWarning(body.prompt, safetyResult);

  const [providers, settings] = await Promise.all([getApiProviders(), getRuntimeSettings()]);
  const authorizedModels = buildAuthorizedModels(user, providers);
  const resolved = resolveQuickCreateModel({
    taskOverride: body.chatModelOverride,
    quickCreateDefault: settings.quickCreateChatModel,
    globalDefault: settings.quickCreateAutoModelRouting ? settings.defaultChatModel : undefined,
    recentSelection: settings.quickCreateAutoModelRouting ? body.recentChatModel : undefined,
    models: authorizedModels,
    allowFirstAvailable: settings.quickCreateAutoModelRouting,
  });
  const selected = resolved.model
    ? authorizedModels.find((model: AuthorizedChatModel) => model.id === resolved.id) ?? null
    : null;

  if (!selected || resolved.source === 'none') {
    const requestedOverride = body.chatModelOverride?.trim();
    const overrideWasRejected = Boolean(requestedOverride)
      && !authorizedModels.some((model: AuthorizedChatModel) => model.id === requestedOverride);
    return createErrorStream(
      overrideWasRejected ? '本次选择的聊天模型不可用或未获授权' : '当前账号没有可用的聊天模型',
      overrideWasRejected ? 'MODEL_NOT_AUTHORIZED' : 'NO_AVAILABLE_MODEL',
    );
  }

  const provider = selected.provider;
  if (!providerOwnsModel(provider, selected.modelId)) {
    return createErrorStream('聊天模型与提供商配置不匹配', 'MODEL_PROVIDER_MISMATCH');
  }

  const modelSource = resolved.source as QuickCreateModelSource;
  const encoder = new TextEncoder();
  const forwardedHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  const compilerPrompt = buildQuickCreateCompilerPrompt(body);
  const canUseVision = supportsQuickCreateVision(
    selected.modelId,
    selected.modelInfo?.capabilities ?? [],
  );
  const referenceImages = canUseVision
    ? body.referenceImages.map((image: string) => toAbsoluteReferenceImage(request, image))
    : [];

  const messages = referenceImages.length > 0
    ? [{
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: compilerPrompt },
          ...referenceImages.map((image: string) => ({
            type: 'image_url' as const,
            image_url: { url: image, detail: 'high' as const },
          })),
        ],
      }]
    : [{ role: 'user' as const, content: compilerPrompt }];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
      let closed = false;
      const send = (event: QuickCreateCompileSseEvent): void => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const finish = (): void => {
        if (closed) return;
        send({ type: 'done' });
        closed = true;
        controller.close();
      };

      try {
        send({ type: 'status', phase: 'validating', message: '已完成账号权限与输入校验' });
        send({ type: 'status', phase: 'routing', message: `已选择 ${selected.providerName} / ${selected.name}` });
        send({ type: 'status', phase: 'understanding', message: '正在理解创作目标与参考素材' });

        const config = new Config({
          apiKey: provider.apiKey,
          modelBaseUrl: provider.baseUrl.replace(/\/+$/, ''),
        });
        const client = new LLMClient(config, forwardedHeaders);
        const llmStream = client.stream(messages, {
          model: selected.modelId,
          thinking: 'disabled',
          temperature: 0.45,
        });

        let completeText = '';
        let announcedStrategy = false;
        // ★ 流级超时看门狗：如果 LLM 流 90 秒内没有新 chunk，主动中断
        const STREAM_TIMEOUT_MS = 90_000;
        const streamTimeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('LLM 流式响应超时，请检查模型可用性或网络连接')), STREAM_TIMEOUT_MS);
        });
        const chunkIterator = llmStream[Symbol.asyncIterator]();
        for (;;) {
          if (request.signal.aborted) throw new Error('请求已取消');
          const result = await Promise.race([chunkIterator.next(), streamTimeout]);
          if (result.done) break;
          const chunk = result.value;
          if (!chunk.content) continue;
          const content = chunk.content.toString();
          if (!content) continue;
          completeText += content;
          if (!announcedStrategy) {
            announcedStrategy = true;
            send({ type: 'status', phase: 'strategizing', message: '正在编排视觉策略与生成提示词' });
          }
          send({ type: 'delta', content });
        }

        send({ type: 'status', phase: 'finalizing', message: '正在校验并整理结构化创作方案' });
        const payload = parseQuickCreateCompilePayload(completeText);
        send({
          type: 'result',
          result: {
            ...payload,
            model: selected.modelId,
            providerId: selected.providerId,
            providerName: selected.providerName || provider.name,
            modelSource,
          },
        });
        send({ type: 'status', phase: 'ready', message: '创作方案已编译完成' });
        finish();
      } catch (error: unknown) {
        send({
          type: 'error',
          message: compileErrorMessage(error, request.signal.aborted),
          code: request.signal.aborted ? 'REQUEST_CANCELLED' : 'COMPILE_FAILED',
        });
        finish();
      }
    },
    cancel(): void {
      // The request AbortSignal is observed in the SDK stream loop.
    },
  });

  return sseResponse(stream);
}
