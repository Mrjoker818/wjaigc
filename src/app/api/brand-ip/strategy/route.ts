import { Config, HeaderUtils, LLMClient } from 'coze-coding-dev-sdk';
import { NextRequest, NextResponse } from 'next/server';

import { getRequestUser, requireApiAuthOrReject } from '@/lib/api-auth';
import type { BrandIpBrief, BrandIpControlledVariable, BrandIpDirection, BrandIpImmutableCore } from '@/lib/brand-ip';
import { getBrandIpProject } from '@/lib/brand-ip-storage';
import { isModelAssignedToUser } from '@/lib/model-defaults';
import { getApiProviders } from '@/lib/server-api-config';
import type { ApiProvider, ModelInfo } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthorizedChatModel {
  id: string;
  providerId: string;
  modelId: string;
  name: string;
  providerName: string;
  provider: ApiProvider;
  modelInfo: ModelInfo | null;
}

interface StrategyResult {
  summary: string;
  directions: BrandIpDirection[];
  immutableCore: BrandIpImmutableCore[];
  controlledVariables: BrandIpControlledVariable[];
  model: string;
  providerId: string;
  providerName: string;
}

type StrategySseEvent =
  | { type: 'status'; phase: string; message: string }
  | { type: 'delta'; content: string }
  | { type: 'result'; result: StrategyResult }
  | { type: 'error'; message: string; code: string }
  | { type: 'done' };

// ---------------------------------------------------------------------------
// Model authorization (mirrors quick-create/compile)
// ---------------------------------------------------------------------------

function providerSupportsChat(provider: ApiProvider): boolean {
  return (
    provider.isEnabled &&
    !!provider.baseUrl &&
    !!provider.apiKey &&
    (provider.type === 'chat' || provider.modelType === 'chat')
  );
}

function providerOwnsModel(provider: ApiProvider, modelId: string): boolean {
  const selectedIds = new Set(provider.selectedModels ?? []);
  const discoveredIds = new Set((provider.discoveredModels ?? []).map((m: ModelInfo) => m.id));
  return selectedIds.has(modelId) || discoveredIds.has(modelId);
}

function modelAllowedForUser(user: User, providerId: string, modelId: string): boolean {
  if (user.role === 'admin') return true;
  return isModelAssignedToUser(user.chatModels, providerId, modelId);
}

function buildAuthorizedModels(
  user: User,
  providers: ApiProvider[],
): AuthorizedChatModel[] {
  const result: AuthorizedChatModel[] = [];
  for (const provider of providers) {
    if (!providerSupportsChat(provider)) continue;
    const selectedIds = new Set(provider.selectedModels ?? []);
    const modelMap = new Map<string, ModelInfo>();
    for (const model of provider.discoveredModels ?? []) {
      modelMap.set(model.id, model);
    }
    for (const modelId of selectedIds) {
      if (!providerOwnsModel(provider, modelId)) continue;
      if (!modelAllowedForUser(user, provider.id, modelId)) continue;
      const modelInfo = modelMap.get(modelId) ?? null;
      result.push({
        id: `${provider.id}::${modelId}`,
        providerId: provider.id,
        modelId,
        name: modelInfo?.name ?? modelId,
        providerName: provider.name,
        provider,
        modelInfo,
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function createErrorStream(message: string, code: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message, code })}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
      controller.close();
    },
  });
  return sseResponse(stream);
}

// ---------------------------------------------------------------------------
// Strategy prompt & parser
// ---------------------------------------------------------------------------

function buildStrategyPrompt(brief: BrandIpBrief): string {
  const lines: string[] = [
    '你是品牌 IP 策略专家。请根据以下品牌简介，生成一份结构化的品牌 IP 策略方案。',
    '',
    '## 品牌简介',
  ];
  if (brief.brandName) lines.push(`- 品牌名称：${brief.brandName}`);
  if (brief.objective) lines.push(`- 品牌目标：${brief.objective}`);
  if (brief.audience) lines.push(`- 目标受众：${brief.audience}`);
  if (brief.personality?.length) lines.push(`- 品牌个性：${brief.personality.join('、')}`);
  lines.push('');
  lines.push('## 输出要求');
  lines.push('请生成 2-4 个角色方向，并为每个方向评分（0-100）。同时识别品牌的不可变核心要素和可控变量。');
  lines.push('');
  lines.push('请仅返回一个 JSON 对象，不要包含其他文字。格式如下：');
  lines.push('{');
  lines.push('  "summary": "品牌策略总结（50-100字）",');
  lines.push('  "directions": [');
  lines.push('    {');
  lines.push('      "id": "direction-xxx",');
  lines.push('      "name": "方向名称",');
  lines.push('      "concept": "概念描述（30-60字）",');
  lines.push('      "scores": { "brandRole": 90, "ownability": 82, "feasibility": 88 }');
  lines.push('    }');
  lines.push('  ],');
  lines.push('  "immutableCore": [');
  lines.push('    { "id": "core-xxx", "label": "要素名称", "value": "要素描述" }');
  lines.push('  ],');
  lines.push('  "controlledVariables": [');
  lines.push('    { "id": "var-xxx", "label": "变量名称", "value": "变量描述", "risk": "low" }');
  lines.push('  ]');
  lines.push('}');
  return lines.join('\n');
}

function parseStrategyResult(text: string): {
  summary: string;
  directions: BrandIpDirection[];
  immutableCore: BrandIpImmutableCore[];
  controlledVariables: BrandIpControlledVariable[];
} {
  // Strip markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = codeBlockMatch ? codeBlockMatch[1] : text;

  // Find JSON object boundaries
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('模型未返回完整的 JSON 对象');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText.slice(start, end + 1));
  } catch {
    throw new Error('模型返回的策略方案不是有效的 JSON');
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  if (!summary) {
    throw new Error('模型返回的策略方案缺少总结');
  }

  const rawDirections = Array.isArray(parsed.directions) ? parsed.directions : [];
  if (rawDirections.length === 0) {
    throw new Error('模型返回的策略方案缺少角色方向');
  }

  const directions: BrandIpDirection[] = rawDirections.map((raw: unknown, index: number) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('角色方向格式无效');
    }
    const dir = raw as Record<string, unknown>;
    const scores = typeof dir.scores === 'object' && dir.scores !== null
      ? dir.scores as Record<string, unknown>
      : {};
    return {
      id: typeof dir.id === 'string' ? dir.id : `direction-${index + 1}`,
      name: typeof dir.name === 'string' ? dir.name : `方向 ${index + 1}`,
      concept: typeof dir.concept === 'string' ? dir.concept : '',
      scores: {
        brandRole: typeof scores.brandRole === 'number' ? scores.brandRole : 0,
        ownability: typeof scores.ownability === 'number' ? scores.ownability : 0,
        feasibility: typeof scores.feasibility === 'number' ? scores.feasibility : 0,
      },
      status: 'draft' as const,
    };
  });

  const immutableCore: BrandIpImmutableCore[] = (Array.isArray(parsed.immutableCore) ? parsed.immutableCore : [])
    .map((raw: unknown, index: number) => {
      if (typeof raw !== 'object' || raw === null) return null;
      const item = raw as Record<string, unknown>;
      return {
        id: typeof item.id === 'string' ? item.id : `core-${index + 1}`,
        label: typeof item.label === 'string' ? item.label : '',
        value: typeof item.value === 'string' ? item.value : '',
      };
    })
    .filter((item): item is BrandIpImmutableCore => item !== null);

  const controlledVariables: BrandIpControlledVariable[] = (Array.isArray(parsed.controlledVariables) ? parsed.controlledVariables : [])
    .map((raw: unknown, index: number) => {
      if (typeof raw !== 'object' || raw === null) return null;
      const item = raw as Record<string, unknown>;
      const risk = item.risk === 'low' || item.risk === 'medium' || item.risk === 'high'
        ? item.risk
        : undefined;
      return {
        id: typeof item.id === 'string' ? item.id : `var-${index + 1}`,
        label: typeof item.label === 'string' ? item.label : '',
        value: typeof item.value === 'string' ? item.value : '',
        ...(risk ? { risk } : {}),
      };
    })
    .filter((item): item is BrandIpControlledVariable => item !== null);

  return { summary, directions, immutableCore, controlledVariables };
}

function strategyErrorMessage(error: unknown, requestAborted: boolean): string {
  if (requestAborted) return '品牌策略分析请求已取消';
  if (error instanceof Error) {
    const msg = error.message;
    if (
      msg.startsWith('模型未返回完整的 JSON 对象')
      || msg.startsWith('模型返回的策略方案')
      || msg.startsWith('角色方向格式无效')
    ) {
      return msg;
    }
  }
  return '品牌策略分析失败，请稍后重试';
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof Response) return auth;

  let projectId = '';
  try {
    const body = await request.json() as { projectId?: unknown };
    projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  } catch {
    // Body parsing failed — leave projectId empty for the 400 path
  }
  if (!projectId) {
    return NextResponse.json({ error: '缺少品牌 IP 项目 ID' }, { status: 400 });
  }

  const project = await getBrandIpProject(projectId, auth.userId);
  if (!project) {
    return NextResponse.json({ error: '品牌 IP 项目不存在' }, { status: 404 });
  }

  const requestUser = await getRequestUser(request);
  if (!requestUser) {
    return createErrorStream('请先登录后再使用品牌策略分析', 'UNAUTHORIZED');
  }
  const user = requestUser.user;

  if (user.status === 'disabled') {
    return createErrorStream('当前账号已被禁用', 'ACCOUNT_DISABLED');
  }
  if (user.apiPermissions && !user.apiPermissions.chat) {
    return createErrorStream('当前账号没有聊天模型使用权限', 'CHAT_PERMISSION_DENIED');
  }

  const providers = await getApiProviders();
  const authorizedModels = buildAuthorizedModels(user, providers);
  if (authorizedModels.length === 0) {
    return createErrorStream('当前账号没有可用的聊天模型', 'NO_AVAILABLE_MODEL');
  }

  const selected = authorizedModels[0];
  const provider = selected.provider;

  const encoder = new TextEncoder();
  const forwardedHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  const prompt = buildStrategyPrompt(project.brief);
  const messages = [{ role: 'user' as const, content: prompt }];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
      let closed = false;
      const send = (event: StrategySseEvent): void => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const finish = (): void => {
        if (closed) return;
        send({ type: 'done' });
        closed = true;
        controller.close();
      };

      try {
        send({ type: 'status', phase: 'validating', message: '已完成账号权限与项目校验' });
        send({ type: 'status', phase: 'routing', message: `已选择 ${selected.providerName} / ${selected.name}` });
        send({ type: 'status', phase: 'analyzing', message: '正在分析品牌目标与角色方向' });

        const config = new Config({
          apiKey: provider.apiKey,
          modelBaseUrl: provider.baseUrl.replace(/\/+$/, ''),
        });
        const client = new LLMClient(config, forwardedHeaders);
        const llmStream = client.stream(messages, {
          model: selected.modelId,
          thinking: 'disabled',
          temperature: 0.5,
        });

        let completeText = '';
        let announcedStrategy = false;
        for await (const chunk of llmStream) {
          if (request.signal.aborted) throw new Error('请求已取消');
          if (!chunk.content) continue;
          const content = chunk.content.toString();
          if (!content) continue;
          completeText += content;
          if (!announcedStrategy) {
            announcedStrategy = true;
            send({ type: 'status', phase: 'strategizing', message: '正在编排品牌策略与角色方向' });
          }
          send({ type: 'delta', content });
        }

        send({ type: 'status', phase: 'finalizing', message: '正在校验并整理结构化策略方案' });
        const parsed = parseStrategyResult(completeText);
        send({
          type: 'result',
          result: {
            ...parsed,
            model: selected.modelId,
            providerId: selected.providerId,
            providerName: selected.providerName || provider.name,
          },
        });
        send({ type: 'status', phase: 'ready', message: '品牌策略方案已生成' });
        finish();
      } catch (error: unknown) {
        send({
          type: 'error',
          message: strategyErrorMessage(error, request.signal.aborted),
          code: request.signal.aborted ? 'REQUEST_CANCELLED' : 'STRATEGY_FAILED',
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
