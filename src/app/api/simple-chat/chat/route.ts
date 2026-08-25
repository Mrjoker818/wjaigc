import { createHash } from 'node:crypto';

import { NextRequest } from 'next/server';
import { findProviderById, findProviderForModel } from '@/lib/server-api-config';
import type { ApiKind } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { SearchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { fetchWithTimeout, getInternalApiUrl } from '@/lib/api-helpers';
import { resolveChatControls } from '@/lib/chat-generation-controls';
import { getInternalRequestHeaders } from '@/lib/api-auth';
import { AssetServiceError, createAssetService } from '@/lib/asset-core/service';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import { getSafeImageTypeFromDataUrl, getSafeMediaTypeFromResponse } from '@/lib/media-validation';
import {
  agentWorkspaceProjectionIdempotencyKey,
  projectAgentResultToWorkspace,
} from '@/lib/agent-runtime/workspace-results';
import {
  extractTaskAssetReferences,
  findWorkspaceAssetReferenceByUrl,
} from '@/lib/asset-core/workspace-transfer';
import {
  buildSimpleChatAgentRequest,
  parseBoundedAgentSurfaceBody,
  SurfaceAgentRequestError,
} from '@/lib/agent-runtime/surface-requests';
import { authorizeAgentContext } from '@/lib/agent-runtime/context-adapters';
import { prepareAdmittedAgentTaskExecution } from '@/lib/agent-runtime/surface-dispatch';
import { resolveAgentRuntimeMode } from '@/lib/agent-runtime/mode';
import { admitAuthorizedAgentExecution } from '@/lib/agent-runtime/admission-gate';
import { executeAdmittedToolCall } from '@/lib/chat-tools';
import { resolveTaskModel } from '@/lib/task-core/model-catalog';
import { STRICT_AGENT_GENERATE_HEADER } from '@/lib/agent-runtime/generate-image-adapter';
import { resolveSimpleChatRequestIdempotencyKey } from '@/lib/simple-chat-retry';

const DEFAULT_SYSTEM_PROMPT = `你是无界AI的智能助手。你可以：
1. 回答用户的各种问题
2. 当用户需要生成图片时，使用 generate_image 工具
3. 支持多模态理解（图片识别）

请保持回复简洁、专业、友好。
**重要**：请始终以自然语言（纯文本）回复用户，**不要**使用 JSON 格式或 Markdown 代码块格式输出你的回答内容。`;

interface KnowledgeItem {
  id: string;
  type: 'file' | 'url' | 'note';
  title: string;
  content: string;
}

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'auto' } };

interface AssetRegistrationRequest {
  projectId: string;
  workspaceId: string;
  entityType: 'chat-attachment' | 'chat-result';
  entityId: string;
  idempotencyKey: string;
  image: {
    url: string;
    name?: string;
    mimeType?: string;
  };
}

const REGISTRATION_LIMITS = {
  projectId: 128,
  workspaceId: 256,
  entityId: 256,
  idempotencyKey: 256,
  name: 256,
  mimeType: 128,
  url: 4096,
  dataUrl: 28 * 1024 * 1024,
  decodedImage: 20 * 1024 * 1024,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  const result = value.trim();
  return result && result.length <= maximum ? result : '';
}

function parseDataImage(url: string): { bytes: Buffer; mimeType: string } | null {
  if (url.length > REGISTRATION_LIMITS.dataUrl) return null;
  const safeType = getSafeImageTypeFromDataUrl(url);
  const match = url.match(/^data:image\/[\w+.-]+;base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!safeType || !match || match[1].length % 4 !== 0) return null;
  const bytes = Buffer.from(match[1], 'base64');
  if (
    bytes.length === 0
    || bytes.length > REGISTRATION_LIMITS.decodedImage
    || bytes.toString('base64') !== match[1]
    || !getSafeMediaTypeFromResponse(safeType.mimeType, bytes, false)
  ) return null;
  return { bytes, mimeType: safeType.mimeType };
}

function isAllowedAssetMediaUrl(url: string): boolean {
  if (url.startsWith('data:')) return parseDataImage(url) !== null;
  if (!url || url.length > REGISTRATION_LIMITS.url) return false;
  if (url.startsWith('/api/serve-upload/') || url.startsWith('/uploads/')) {
    try {
      const decoded = decodeURIComponent(url);
      return !decoded.includes('..') && !decoded.includes('\\');
    } catch {
      return false;
    }
  }
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

function parseAssetRegistration(body: Record<string, unknown>): AssetRegistrationRequest | null {
  if (body.assetAction !== 'register' || !isRecord(body.image)) return null;
  const projectId = boundedString(body.projectId, REGISTRATION_LIMITS.projectId);
  const workspaceId = boundedString(body.workspaceId, REGISTRATION_LIMITS.workspaceId);
  const entityType = body.entityType === 'chat-attachment' || body.entityType === 'chat-result'
    ? body.entityType
    : null;
  const entityId = boundedString(body.entityId, REGISTRATION_LIMITS.entityId);
  const idempotencyKey = boundedString(body.idempotencyKey, REGISTRATION_LIMITS.idempotencyKey);
  const rawUrl = typeof body.image.url === 'string' ? body.image.url : '';
  const url = rawUrl.startsWith('data:') ? rawUrl : rawUrl.trim();
  const name = body.image.name === undefined
    ? ''
    : boundedString(body.image.name, REGISTRATION_LIMITS.name);
  const mimeType = body.image.mimeType === undefined
    ? ''
    : boundedString(body.image.mimeType, REGISTRATION_LIMITS.mimeType);
  if (
    !projectId
    || !workspaceId
    || !entityType
    || !entityId
    || !idempotencyKey
    || !isAllowedAssetMediaUrl(url)
    || (body.image.name !== undefined && !name)
    || (body.image.mimeType !== undefined && !mimeType)
  ) return null;
  return {
    projectId,
    workspaceId,
    entityType,
    entityId,
    idempotencyKey,
    image: {
      url,
      ...(name ? { name } : {}),
      ...(mimeType ? { mimeType } : {}),
    },
  };
}

function assetMediaDigest(url: string): string {
  const dataImage = url.startsWith('data:') ? parseDataImage(url) : null;
  return createHash('sha256')
    .update(dataImage ? dataImage.bytes : Buffer.from(url, 'utf8'))
    .digest('hex');
}

function assetRegistrationDigest(input: AssetRegistrationRequest): string {
  return createHash('sha256').update(JSON.stringify({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    entityType: input.entityType,
    entityId: input.entityId,
    mediaDigest: assetMediaDigest(input.image.url),
    name: input.image.name ?? '',
    mimeType: input.image.mimeType ?? '',
  })).digest('hex');
}

async function persistNewChatImage(
  userId: string,
  userRole: string | undefined,
  imageUrl: string,
): Promise<string> {
  if (!imageUrl.startsWith('data:')) return imageUrl;
  const internalHeaders = await getInternalRequestHeaders(userId, userRole === 'admin' ? 'admin' : 'user');
  const response = await fetch(getInternalApiUrl('/api/save-image'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...internalHeaders },
    body: JSON.stringify({ imageUrl }),
  });
  if (!response.ok) throw new Error('ASSET_MEDIA_PERSIST_FAILED');
  const payload = await response.json() as { url?: unknown };
  if (typeof payload.url !== 'string' || !payload.url) throw new Error('ASSET_MEDIA_PERSIST_FAILED');
  return payload.url;
}

async function registerStandaloneChatAsset(
  actor: { id: string; role?: string },
  input: AssetRegistrationRequest,
): Promise<WorkspaceAssetReference> {
  const service = createAssetService();
  const sourceDigest = assetMediaDigest(input.image.url);
  const created = await service.createVersionWithPlacement({
    actorUserId: actor.id,
    projectId: input.projectId,
    kind: 'image',
    resolveFile: async () => {
      const url = await persistNewChatImage(actor.id, actor.role, input.image.url);
      const dataImage = input.image.url.startsWith('data:') ? parseDataImage(input.image.url) : null;
      return {
        url,
        availability: 'ready',
        ...(input.image.mimeType || dataImage?.mimeType
          ? { mimeType: input.image.mimeType || dataImage?.mimeType }
          : {}),
        ...(dataImage ? { checksum: `sha256:${sourceDigest}` } : {}),
        ...(/^https?:\/\//.test(input.image.url) ? { recoverySourceUrl: input.image.url } : {}),
      };
    },
    idempotencyKey: input.idempotencyKey,
    requestDigest: assetRegistrationDigest(input),
    metadata: {
      source: 'standalone-chat',
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.image.name ? { name: input.image.name } : {}),
    },
    placement: {
      workspace: 'chat',
      workspaceId: input.workspaceId,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: {
        source: 'standalone-chat',
        ...(input.image.name ? { name: input.image.name } : {}),
      },
    },
  });
  return {
    assetId: created.version.assetId,
    assetVersionId: created.version.id,
    placementId: created.placement.id,
    url: created.version.file.url,
    ...(input.image.name ? { name: input.image.name } : {}),
  };
}

function assetRegistrationError(error: unknown): Response {
  if (error instanceof AssetServiceError) {
    if (error.code === 'ASSET_NOT_FOUND') {
      return Response.json({ error: 'ASSET_NOT_FOUND' }, { status: 404 });
    }
    if (error.code === 'ASSET_IDEMPOTENCY_CONFLICT' || error.code === 'ASSET_PLACEMENT_CONFLICT') {
      return Response.json({ error: error.code }, { status: 409 });
    }
  }
  if (error instanceof Error && error.message === 'ASSET_MEDIA_PERSIST_FAILED') {
    return Response.json({ error: error.message }, { status: 502 });
  }
  return Response.json({ error: 'ASSET_REGISTRATION_FAILED' }, { status: 500 });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function POST(request: NextRequest) {
  const agentRuntimeMode = resolveAgentRuntimeMode(process.env.WUJIE_AGENT_RUNTIME_MODE);
  const user = await getSessionUser(request);
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }
  let body: {
    assetAction?: string;
    messages?: { role: string; content: string; images?: string[] }[];
    model?: string;
    providerId?: string;
    stream?: boolean;
    webSearch?: boolean;
    knowledgeItems?: KnowledgeItem[];
    projectId?: string;
    taskId?: string;
    assetProjectId?: string;
    responseMessageId?: string;
    workspaceId?: string;
    entityType?: string;
    entityId?: string;
    idempotencyKey?: string;
    image?: { url?: string; name?: string; mimeType?: string };
    imageModel?: string;
    imageProviderId?: string;
    memories?: string[];
    deepAnalysis?: boolean;
    i2iStrength?: number;
    reasoningEffort?: string;
    responseSpeed?: string;
    sourceVersionIds?: string[];
    selectedEntityIds?: string[];
  };
  try {
    body = parseBoundedAgentSurfaceBody(await request.text()) as typeof body;
  } catch (error) {
    if (error instanceof SurfaceAgentRequestError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  const messages = body.messages || [];
  const model = body.model || 'deepseek-v4-flash';
  const providerId = body.providerId || '';
  const webSearch = body.webSearch || false;
  const knowledgeItems = body.knowledgeItems || [];
  const imageModel = body.imageModel || model;
  const imageProviderId = body.imageProviderId || providerId;
  const memories = body.memories || [];
  const deepAnalysis = body.deepAnalysis || false;
  const i2iStrength = body.i2iStrength || 0.7;

  const productTypes = (user.productType || '').split(',').map(type => type.trim()).filter(Boolean);
  if (user.role !== 'admin' && (
    user.apiPermissions?.chat === false ||
    (productTypes.length > 0 && !productTypes.includes('chat'))
  )) {
    return Response.json({ error: 'You are not authorized to use intelligent chat' }, { status: 403 });
  }

  if (body.assetAction === 'register') {
    const registration = parseAssetRegistration(body as Record<string, unknown>);
    if (!registration) {
      return Response.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
    }
    try {
      return Response.json(await registerStandaloneChatAsset(user, registration));
    } catch (error) {
      return assetRegistrationError(error);
    }
  }

  const idempotencyKeyResolution = resolveSimpleChatRequestIdempotencyKey(
    request.headers,
    body.idempotencyKey,
  );
  if (!idempotencyKeyResolution.ok) {
    return Response.json(
      { error: idempotencyKeyResolution.code },
      { status: idempotencyKeyResolution.status },
    );
  }
  const requestIdempotencyKey = idempotencyKeyResolution.key;

  // 查找提供商
  let provider;
  if (agentRuntimeMode === 'agent-v2') {
    if (!providerId) {
      return Response.json({ code: 'MODEL_ROUTE_MISMATCH', error: 'An exact provider is required' }, { status: 409 });
    }
    try {
      const exactModel = await resolveTaskModel(providerId, model, user.id);
      if (exactModel.kind !== 'chat') throw new Error('The exact pair is not a chat model');
      provider = await findProviderById(providerId);
    } catch {
      return Response.json({ code: 'MODEL_ROUTE_MISMATCH', error: 'The exact provider/model pair is unavailable or unauthorized' }, { status: 409 });
    }
  } else {
    provider = await findProviderForModel(model, 'chat' as ApiKind, providerId || undefined);
  }
  if (!provider) {
    return Response.json({ error: '未找到可用的 API 提供商' }, { status: 400 });
  }

  let canonicalSourceUrls: string[] = [];
  const hasImageInput = messages.some(message => Array.isArray(message.images) && message.images.length > 0);
  if (agentRuntimeMode === 'agent-v2' && hasImageInput) {
    const sourceVersionIds = Array.isArray(body.sourceVersionIds) ? body.sourceVersionIds : [];
    const selectedEntityIds = Array.isArray(body.selectedEntityIds) ? body.selectedEntityIds : [];
    try {
      const authorized = await authorizeAgentContext({
        actorUserId: user.id,
        request: buildSimpleChatAgentRequest({
          projectId: body.assetProjectId || '',
          workspaceId: body.workspaceId || `standalone-chat:${body.projectId || 'chat'}`,
          providerId,
          modelId: model,
          prompt: messages.at(-1)?.content || 'vision',
          sourceVersionIds,
          selectedEntityIds,
          mode: 'vision',
          conversationId: body.projectId,
          idempotencyKey: requestIdempotencyKey,
        }),
      });
      canonicalSourceUrls = sourceVersionIds.map(versionId => authorized.mediaByVersionId[versionId]);
      const requestedUrls = messages.flatMap(message => message.images || []);
      if (
        canonicalSourceUrls.length !== requestedUrls.length
        || requestedUrls.some((url, index) => url !== canonicalSourceUrls[index])
      ) {
        return Response.json({ code: 'AGENT_MEDIA_URL_MISMATCH', error: 'Image URL does not match the authorized Asset Version' }, { status: 409 });
      }
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'AGENT_CONTEXT_NOT_FOUND';
      return Response.json({ code, error: 'Authorized image context was not found' }, { status: 404 });
    }
  }

  // 模型权限校验：非管理员用户需检查 chatModels 授权列表
  if (user.role !== 'admin') {
    const allowed = user.chatModels;
    if (allowed && allowed.length > 0 && !allowed.includes(model)) {
      return Response.json({ error: '您没有权限使用此模型，请联系管理员' }, { status: 403 });
    }
  }

  const apiKey = provider.apiKey;
  const baseUrl = provider.baseUrl?.replace(/\/+$/, '') || '';
  const chatControls = resolveChatControls(model, provider, body.reasoningEffort, body.responseSpeed);

  // 构建增强的 system prompt（指令 + 知识库 + 联网搜索结果）
  let enhancedSystemPrompt = DEFAULT_SYSTEM_PROMPT;

  // 用户记忆注入
  if (memories.length > 0) {
    const memoryContext = memories.slice(0, 20).map((m, i) => `${i + 1}. ${m}`).join('\n');
    enhancedSystemPrompt += `\n\n## 用户记忆\n以下是关于用户的长期记忆信息，请在回答时参考：\n${memoryContext}`;
  }

  // 深度图片分析模式（文案策划专用）
  if (deepAnalysis) {
    enhancedSystemPrompt += `\n\n## 深度图片分析模式（文案策划专业版）
用户正在请求对图片进行深度分析。请作为资深文案策划与品牌策略专家，输出结构化分析报告，包含以下维度（可根据图片类型灵活裁剪）：

1. **视觉概览**：图片整体风格、色调、构图、视觉焦点
2. **文案拆解**：标题/正文/CTA 的用词策略、语气、句式特点
3. **受众画像**：目标人群特征、痛点、情感诉求
4. **策略分析**：品牌定位、差异化卖点、传播目的
5. **优劣评估**：亮点（3 条）+ 可改进点（3 条）
6. **行动清单**：可直接落地的文案建议（至少 3 条，含示例文案）

要求：
- 使用 Markdown 格式输出（标题、列表、加粗）
- 每个维度要有具体洞察，避免空泛描述
- 文案建议要给出可直接使用的示例`;
  }

  // 知识库注入
  if (knowledgeItems.length > 0) {
    const kbContext = knowledgeItems
      .filter(k => k.content)
      .map(k => {
        const label = k.type === 'file' ? `[文件: ${k.title}]` : k.type === 'url' ? `[链接: ${k.title}]` : `[笔记: ${k.title}]`;
        return `${label}\n${k.content.slice(0, 2000)}`;
      })
      .join('\n\n---\n\n');
    if (kbContext) {
      enhancedSystemPrompt += `\n\n## 项目知识库\n以下是用户提供的知识库内容，请基于这些内容回答用户问题：\n\n${kbContext}`;
    }
  }

  // 联网搜索
  let searchResults: string | null = null;
  if (webSearch) {
    try {
      // 取最后一条用户消息作为搜索 query
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      const searchQuery = lastUserMsg?.content || '';
      if (searchQuery) {
        const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
        const searchClient = new SearchClient(new Config(), customHeaders);
        const searchResp = await searchClient.webSearch(searchQuery, 5, true);

        if (searchResp.web_items && searchResp.web_items.length > 0) {
          const items = searchResp.web_items.slice(0, 5).map((item, i) =>
            `[${i + 1}] ${item.title}\nURL: ${item.url || '无'}\n摘要: ${item.snippet || ''}${item.summary ? '\nAI摘要: ' + item.summary : ''}`
          ).join('\n\n');

          searchResults = `## 联网搜索结果\n搜索关键词: "${searchQuery}"\n\n${items}`;
          if (searchResp.summary) {
            searchResults += `\n\n## AI 搜索摘要\n${searchResp.summary}`;
          }
          enhancedSystemPrompt += `\n\n${searchResults}\n\n请基于以上联网搜索结果回答用户问题。如有引用，请标注来源编号（如 [1]、[2]）。`;
        } else {
          enhancedSystemPrompt += `\n\n(联网搜索未找到相关结果，请基于已有知识回答)`;
        }
      }
    } catch (e: unknown) {
      const message = errorMessage(e, 'Web search unavailable');
      console.error('Web search failed:', message);
      enhancedSystemPrompt += `\n\n(联网搜索暂时不可用: ${message})`;
    }
  }

  // 构建消息列表
  const fullMessages = [
    { role: 'system', content: enhancedSystemPrompt },
    ...messages.map((m) => {
      const parts: ChatContentPart[] = [{ type: 'text', text: m.content }];
      if (m.images && m.images.length > 0) {
        for (const img of m.images) {
          parts.push({
            type: 'image_url',
            image_url: { url: agentRuntimeMode === 'agent-v2' ? canonicalSourceUrls.shift() || img : img, detail: 'auto' },
          });
        }
      }
      if (parts.length === 1) {
        return { role: m.role, content: m.content };
      }
      return { role: m.role, content: parts };
    }),
  ];

  // SSE 流式响应
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      let generatedOutputIndex = 0;
      const sendGeneratedImage = async (
        imageUrl: string,
        prompt: string,
        authoritativeTaskId?: string,
        authoritativeResult?: unknown,
      ): Promise<void> => {
        const outputIndex = generatedOutputIndex++;
        let imageRef: WorkspaceAssetReference | undefined;
        if (body.assetProjectId && body.projectId && body.taskId && body.responseMessageId) {
          try {
            if (authoritativeTaskId) {
              const workspaceId = `standalone-chat:${body.projectId}`;
              const durableReferences = extractTaskAssetReferences(authoritativeResult);
              const projected = durableReferences.length > 0
                ? durableReferences
                : await projectAgentResultToWorkspace({
                    actorUserId: user.id,
                    taskId: authoritativeTaskId,
                    targetProjectId: body.assetProjectId,
                    workspace: 'chat',
                    workspaceId,
                    sourceEntityId: body.responseMessageId,
                    parentVersionIds: Array.isArray(body.sourceVersionIds)
                      ? body.sourceVersionIds.filter((value): value is string => typeof value === 'string')
                      : [],
                    idempotencyKey: agentWorkspaceProjectionIdempotencyKey({
                      taskId: authoritativeTaskId,
                      workspace: 'chat',
                      workspaceId,
                      sourceEntityId: body.responseMessageId,
                    }),
                  });
              const reference = findWorkspaceAssetReferenceByUrl(imageUrl, projected) || projected[0];
              if (reference) imageRef = {
                ...reference,
                name: prompt.slice(0, 120) || 'Generated image',
              };
            } else {
              imageRef = await registerStandaloneChatAsset(user, {
                projectId: body.assetProjectId,
                workspaceId: `standalone-chat:${body.projectId}`,
                entityType: 'chat-result',
                entityId: `${body.responseMessageId}:${outputIndex}`,
                idempotencyKey: `simple-chat-result:${body.taskId}:${body.responseMessageId}:${outputIndex}`,
                image: { url: imageUrl, name: prompt.slice(0, 120) || 'Generated image' },
              });
            }
          } catch {
            send({
              type: 'tool_status',
              tool: 'registering_asset',
              status: 'failed',
              label: '图片已生成，但素材登记失败',
            });
            if (agentRuntimeMode === 'agent-v2' && authoritativeTaskId) return;
          }
        }
        send({
          type: 'image',
          imageUrl: imageRef?.url || imageUrl,
          prompt,
          ...(imageRef ? { imageRef } : {}),
        });
      };

      try {
        send({
          type: 'generation_controls',
          appliedReasoningEffort: chatControls.appliedReasoningEffort,
          appliedResponseSpeed: chatControls.appliedResponseSpeed,
          degraded: chatControls.degraded,
          notices: chatControls.notices,
          support: chatControls.support,
        });

        // 先发送搜索结果（如果有联网搜索）
        if (webSearch) {
          if (searchResults) {
            // 解析出搜索条目
            const resultCount = (searchResults.match(/\[\d+\]/g)?.length || 0);
            send({ type: 'search_status', status: 'completed', resultCount, searchResults });
          } else {
            send({ type: 'search_status', status: 'failed', resultCount: 0 });
          }
        }

        const apiUrl = `${baseUrl}/chat/completions`;

        // 添加工具定义
        const tools: Record<string, unknown>[] = [
          {
            type: 'function',
            function: {
              name: 'generate_image',
              description: 'Generate an image based on a text description. Use this when the user wants to create, draw, or generate an image.',
              parameters: {
                type: 'object',
                properties: {
                  prompt: {
                    type: 'string',
                    description: 'A detailed description of the image to generate',
                  },
                  size: {
                    type: 'string',
                    enum: ['1024x1024', '1792x1024', '1024x1792'],
                    description: 'Image size, default 1024x1024',
                  },
                },
                required: ['prompt'],
              },
            },
          },
        ];

        const fetchRes = await fetchWithTimeout(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            ...(requestIdempotencyKey ? { 'Idempotency-Key': requestIdempotencyKey } : {}),
          },
          body: JSON.stringify({
            model,
            messages: fullMessages,
            stream: true,
            tools,
            tool_choice: 'auto',
            ...chatControls.requestParams,
          }),
        }, 'chat');

        if (!fetchRes.ok) {
          const errText = await fetchRes.text().catch(() => '');
          send({ type: 'error', error: `API 错误 ${fetchRes.status}: ${errText.slice(0, 200)}` });
          controller.close();
          return;
        }

        const reader = fetchRes.body?.getReader();
        if (!reader) {
          send({ type: 'error', error: '无法读取响应流' });
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        const toolCalls: Record<number, { id: string; name: string; arguments: string }> = {};
        let fullContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (jsonStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed.choices?.[0]?.delta;
              if (!delta) continue;

              // 文本内容
              if (delta.content) {
                fullContent += delta.content;
                send({ type: 'text', content: delta.content });
              }

              // 工具调用
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!toolCalls[idx]) {
                    toolCalls[idx] = { id: tc.id || '', name: tc.function?.name || '', arguments: '' };
                  }
                  if (tc.function?.name) toolCalls[idx].name = tc.function.name;
                  if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
                }
              }
            } catch { /* 忽略解析错误 */ }
          }
        }

        // 处理工具调用
        if (Object.keys(toolCalls).length > 0) {
          const tc = toolCalls[0];
          if (tc.name === 'generate_image') {
            send({ type: 'tool_status', tool: 'generating_image', status: 'generating', label: '正在生成图片...' });

            let args: { prompt?: string; size?: string } = {};
            try { args = JSON.parse(tc.arguments); } catch { /* ignore */ }

            const imgPrompt = args.prompt || fullContent.slice(0, 500);
            const imgSize = args.size || '1024x1024';

            // 图生图：用户上传了参考图且意图是"基于图片生成/调整"时，传入参考图
            const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
            const userImages = lastUserMsg?.images || [];
            const userText = (lastUserMsg?.content || '').toLowerCase();
            const i2iIntent = /(这张图|这张|此图|图片|参考|改成|调整|换成|基于|类似风格|同款|根据这)/.test(userText);
            const referenceImage = userImages.length > 0 && i2iIntent ? userImages[0] : undefined;

            try {
              const internalHeaders = await getInternalRequestHeaders(user.id, user.role === 'admin' ? 'admin' : 'user');
              const stableIdempotencyKey = `simple-chat:${body.taskId || body.projectId || 'chat'}:${body.responseMessageId || tc.id}:generate`;
              const sourceVersionIds = Array.isArray(body.sourceVersionIds)
                ? body.sourceVersionIds.filter((value): value is string => typeof value === 'string')
                : [];
              const selectedEntityIds = Array.isArray(body.selectedEntityIds)
                ? body.selectedEntityIds.filter((value): value is string => typeof value === 'string')
                : [];
              const runtimeRequest = () => ({
                ...buildSimpleChatAgentRequest({
                  projectId: body.assetProjectId || '',
                  workspaceId: `standalone-chat:${body.projectId || 'chat'}`,
                  providerId: imageProviderId,
                  modelId: imageModel,
                  prompt: imgPrompt,
                  sourceVersionIds,
                  selectedEntityIds,
                  mode: 'agent',
                  conversationId: body.projectId,
                  idempotencyKey: stableIdempotencyKey,
                }),
                allowedToolIds: ['generate_image'],
              });
              const admitGeneration = () => fetch(getInternalApiUrl('/api/generate'), {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...internalHeaders,
                  'idempotency-key': stableIdempotencyKey,
                  ...(agentRuntimeMode === 'agent-v2'
                    ? {
                        'x-wujie-agent-defer-execution': 'true',
                        [STRICT_AGENT_GENERATE_HEADER]: 'true',
                      }
                    : {}),
                },
                body: JSON.stringify({
                  prompt: imgPrompt,
                  model: imageModel,
                  providerId: imageProviderId,
                  size: imgSize,
                  count: 1,
                  submitOnly: true,
                  projectId: body.assetProjectId,
                  sessionId: `standalone-chat:${body.projectId}`,
                  messageId: body.responseMessageId,
                  assetWorkspace: 'chat',
                  assetWorkspaceId: `standalone-chat:${body.projectId}`,
                  assetSourceEntityId: body.responseMessageId,
                  assetParentVersionIds: sourceVersionIds,
                  ...(referenceImage ? { imageUrl: referenceImage, strength: i2iStrength } : {}),
                }),
              });
              const imgRes = agentRuntimeMode === 'agent-v2'
                ? await admitAuthorizedAgentExecution({
                    actor: user,
                    request: runtimeRequest(),
                    toolId: 'generate_image',
                    admit: admitGeneration,
                  })
                : await admitGeneration();
              const imgData = await imgRes.json() as { success?: boolean; taskIds?: string[]; imageUrls?: string[]; directImageUrls?: string[] };

              // 直接返回图片的情况（同步提供商）
              const directUrls = imgData.directImageUrls || imgData.imageUrls;
              if (imgData.success && directUrls?.length && !imgData.taskIds?.length) {
                await sendGeneratedImage(directUrls[0], imgPrompt);
              } else if (imgData.success && imgData.taskIds?.length) {
                const taskId = imgData.taskIds[0];
                const pollExistingTask = async (): Promise<void> => {
                  let attempts = 0;
                  while (attempts < 100) {
                    await new Promise(r => setTimeout(r, 3000));
                    const pollRes = await fetch(getInternalApiUrl('/api/poll-task'), {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', ...internalHeaders },
                      body: JSON.stringify({ taskId, model: imageModel, providerId: imageProviderId }),
                    });
                    const pollData = await pollRes.json() as {
                      status?: string;
                      imageUrl?: string;
                      progress?: number;
                      assetProjection?: unknown;
                    };

                    if (pollData.status === 'completed' && pollData.imageUrl) {
                      await sendGeneratedImage(pollData.imageUrl, imgPrompt, taskId, pollData);
                      break;
                    }
                    if (pollData.status === 'failed' || pollData.status === 'cancelled') {
                      send({ type: 'tool_status', tool: 'generating_image', status: 'failed', label: '图片生成失败' });
                      break;
                    }
                    send({ type: 'tool_status', tool: 'generating_image', status: 'polling', label: `图片生成中... ${pollData.progress || ''}`, taskId, progress: pollData.progress });
                    attempts++;
                  }
                };
                const preparedAgentTask = body.assetProjectId
                  ? await prepareAdmittedAgentTaskExecution({
                      mode: agentRuntimeMode,
                      observation: () => ({
                        runId: taskId,
                        actorUserId: user.id,
                        projectId: body.assetProjectId!,
                        workspace: 'chat',
                        providerId: imageProviderId,
                        modelId: imageModel,
                        mode: 'agent',
                        prompt: imgPrompt,
                        sourceVersionIds: runtimeRequest().sourceVersionIds,
                        allowedToolIds: ['generate_image'],
                      }),
                      adoption: () => ({
                        actor: user,
                        taskId,
                        request: runtimeRequest(),
                        toolId: 'generate_image',
                      }),
                      execute: async () => {
                        if (agentRuntimeMode === 'agent-v2') {
                          await executeAdmittedToolCall({
                            kind: 'generation',
                            taskIds: [taskId],
                            userId: user.id,
                            userRole: user.role === 'admin' ? 'admin' : 'user',
                          });
                        }
                        await pollExistingTask();
                      },
                    })
                  : { execute: pollExistingTask, runId: undefined };
                send({
                  type: 'tool_status',
                  tool: 'generating_image',
                  status: 'polling',
                  label: '图片生成中...',
                  taskId,
                  ...(preparedAgentTask.runId ? { runId: preparedAgentTask.runId } : {}),
                });
                await preparedAgentTask.execute();
              }
            } catch (e: unknown) {
              send({ type: 'tool_status', tool: 'generating_image', status: 'failed', label: `图片生成失败: ${errorMessage(e, '未知错误')}` });
            }
          }
        }

        send({ type: 'done' });
      } catch (e: unknown) {
        send({ type: 'error', error: errorMessage(e, '未知错误') });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Transfer-Encoding': 'chunked',
    },
  });
}
