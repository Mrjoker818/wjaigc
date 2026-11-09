import { calculateActualPixels } from './canvas-generation-group';
import { getInternalRequestHeaders } from './api-auth';
import { fetchWithV1Retry } from './api-helpers';
import { runWithAbortSignalTimeout } from './abort-signal';
import { STRICT_AGENT_GENERATE_HEADER } from './agent-runtime/generate-image-adapter';
import type { AgentAdmittedExecution as AdmittedToolExecution } from './agent-runtime/types';
import {
  detectTransparentBackgroundIntent,
  withImageOutputPreference,
  type ImageBackgroundMode,
} from './image-generation-output';
import { listSkillsForSurface } from './skill-runtime/catalog';
import { createSkillRun, dispatchSkillRunExecution, getSkillRun } from './skill-runtime/service';
import { requiredSkillModelRoles, type SkillDefinition } from './skill-runtime/types';
import type { FrozenBindings } from './skill-runtime/cost-estimator';
import type { User } from './user-types';
import { AI_BUILD_PROMPT, createWorkflowFromAIResult, parseAIBuildResponse } from './workflow-engine';

// 服务器端口，所有服务器间 fetch 调用统一使用 localhost + 此端口
const SERVER_PORT = process.env.DEPLOY_RUN_PORT || '5000';

/**
 * Chat Tool Definitions for AI Agent Function Calling
 * 
 * 这些工具定义用于 OpenAI-compatible 的 function calling / tool_use 机制。
 * 当 LLM 返回 tool_calls 时，后端会执行对应的工具并将结果回传给 LLM，
 * 形成 Agent 循环：LLM 思考 → 调用工具 → 感知结果 → 继续思考。
 */

// ============ Tool Definitions (OpenAI function calling 格式) ============

// 会消耗积分或产生素材的工具。Agent 模式关闭时，执行前要在对话里确认。
export const PAID_CHAT_TOOLS = new Set([
  'generate_image', 'img2img', 'remove_bg', 'upscale', 'generate_video', 'extend_canvas', 'run_skill',
]);

export const CHAT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'generate_image',
      description: '根据文字描述生成图片。支持各种风格和主题的图像生成。当你需要为用户创作图片时使用此工具。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '图像生成的提示词，描述想要生成的图片内容、风格、构图等',
          },
          aspect_ratio: {
            type: 'string',
            description: '画面比例，如 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3',
            enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
          },
          quality: {
            type: 'string',
            description: '所选模型支持的质量值，例如 auto、low、medium、high。仅在明确知道模型支持时设置，否则省略；不要填入分辨率。',
          },
          resolution: {
            type: 'string',
            description: '所选模型支持的分辨率，仅在明确知道模型支持时设置，否则省略。与质量参数独立。',
            enum: ['1K', '2K', '4K'],
          },
          count: {
            type: 'number',
            description: '生成图片数量，1-4张，默认1张。仅当用户明确要求多张时才设置>1',
          },
          negative_prompt: {
            type: 'string',
            description: '反向提示词，描述不希望出现的内容',
          },
          background: {
            type: 'string',
            description: '输出背景。仅当用户明确要求透明背景时使用 transparent',
            enum: ['auto', 'transparent', 'opaque'],
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'edit_image',
      description: '使用自然语言描述修改已有图片。可以修改图片的风格、内容、色调等。当用户要求修改画布上的某张图片时使用此工具。',
      parameters: {
        type: 'object',
        properties: {
          image_url: {
            type: 'string',
            description: '要修改的图片URL',
          },
          prompt: {
            type: 'string',
            description: '描述想要如何修改图片，例如"将背景改为深蓝色"、"增加光影效果"',
          },
          size: {
            type: 'string',
            description: '输出尺寸: 1024, 1536 或 2048',
            enum: ['1024', '1536', '2048'],
          },
        },
        required: ['image_url', 'prompt'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'img2img',
      description: '基于已有图片生成新的变体图。支持控制参考类别（风格/构图/角色）和强度。当用户要求基于某张图生成相似但不同的图片时使用。',
      parameters: {
        type: 'object',
        properties: {
          image_url: {
            type: 'string',
            description: '参考图片URL',
          },
          image_urls: {
            type: 'array',
            items: { type: 'string' },
            description: '按顺序提供的1至6张参考图片URL',
          },
          prompt: {
            type: 'string',
            description: '描述想要的变化，例如"换成水彩风格"、"改变背景为森林"',
          },
          strength: {
            type: 'number',
            description: '变化强度 0-1，0.3为轻微变化，0.7为较大变化，1.0为完全重绘',
          },
          reference_types: {
            type: 'array',
            items: { type: 'string', enum: ['style', 'composition', 'character', 'color'] },
            description: '参考类别：style=风格, composition=构图, character=角色, color=色彩',
          },
          negative_prompt: {
            type: 'string',
            description: '反向提示词',
          },
          aspect_ratio: {
            type: 'string',
            description: '画面比例，如 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3',
            enum: ['1:1', '16:9', '9:16', '4:5', '4:3', '3:4', '3:2', '2:3', '21:9'],
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'remove_bg',
      description: '移除图片背景，自动分离主体和背景。当用户要求抠图、去背景、透明背景时使用。',
      parameters: {
        type: 'object',
        properties: {
          image_url: {
            type: 'string',
            description: '要移除背景的图片URL',
          },
        },
        required: ['image_url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'upscale',
      description: '无损放大图片，提升图片分辨率和清晰度而不改变内容。当用户要求放大图片、提升清晰度时使用。',
      parameters: {
        type: 'object',
        properties: {
          image_url: {
            type: 'string',
            description: '要放大的图片URL',
          },
          scale: {
            type: 'string',
            description: '放大倍数: 2 或 4',
            enum: ['2', '4'],
          },
        },
        required: ['image_url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'generate_video',
      description: '根据文字描述生成视频，或基于图片生成视频。当用户要求创建视频内容时使用。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '视频内容描述',
          },
          image_url: {
            type: 'string',
            description: '首帧参考图片URL（图生视频时必填）',
          },
          aspect_ratio: {
            type: 'string',
            description: '视频画面比例',
            enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
          },
          duration: {
            type: 'string',
            description: '视频时长（秒）',
            enum: ['5', '6', '8', '10'],
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'analyze_image',
      description: '分析图片内容，返回图片的详细描述、关键词、风格等信息。当需要理解图片内容以做出决策时使用。',
      parameters: {
        type: 'object',
        properties: {
          image_url: {
            type: 'string',
            description: '要分析的图片URL',
          },
          question: {
            type: 'string',
            description: '针对图片的具体问题，如"这张图的风格是什么"、"图片中的主体是什么"',
          },
        },
        required: ['image_url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'extend_canvas',
      description: '扩展图片画面，向四周延伸画面内容。当用户要求扩大画面、扩展画幅时使用。',
      parameters: {
        type: 'object',
        properties: {
          image_url: {
            type: 'string',
            description: '要扩展的图片URL',
          },
          direction: {
            type: 'string',
            description: '扩展方向',
            enum: ['all', 'left', 'right', 'top', 'bottom'],
          },
          scale: {
            type: 'string',
            description: '扩展倍数，1.5/2/3',
            enum: ['1.5', '2', '3'],
          },
          prompt: {
            type: 'string',
            description: '扩展区域的内容描述',
          },
        },
        required: ['image_url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_skill',
      description: '运行一个预设技能来完成多步骤创作任务，例如电商套图、营销海报、视频脚本。技能目录见系统提示。只在用户的需求明确对应某个技能时使用，普通的单张出图、修图、放大请直接用对应的单一工具。',
      parameters: {
        type: 'object',
        properties: {
          skill_id: {
            type: 'string',
            description: '要运行的技能 id，必须来自系统提示中的技能目录',
          },
          request: {
            type: 'string',
            description: '用户的具体需求，会作为技能的输入',
          },
        },
        required: ['skill_id', 'request'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'build_workflow',
      description: '根据用户的描述在节点模式里创建一个可复用的工作流。当用户要求搭建流程、工作流、自动化流水线，或描述的是多个步骤串联的生产过程时使用。单次的出图、修图、放大不要用这个工具。',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: '用户想要的工作流，用自然语言描述目标和步骤',
          },
        },
        required: ['description'],
      },
    },
  },
];

// ============ Tool Execution ============

export function validateChatToolCall(toolName: string, args: Record<string, unknown>): string | null {
  const tool = CHAT_TOOLS.find(candidate => candidate.function.name === toolName);
  if (!tool) return `Unknown tool: ${toolName}`;

  if (toolName === 'img2img') {
    const hasSingle = args.image_url !== undefined && args.image_url !== null;
    const hasMultiple = args.image_urls !== undefined && args.image_urls !== null;
    if (hasSingle && hasMultiple) return 'img2img image source is ambiguous';
    if (!hasSingle && !hasMultiple) return 'Missing required parameter: image_url';
    if (hasSingle && (typeof args.image_url !== 'string' || !args.image_url.trim())) {
      return 'Invalid image_url: expected a non-empty string';
    }
    if (hasMultiple) {
      const imageUrls = args.image_urls;
      if (!Array.isArray(imageUrls)
        || imageUrls.length < 1
        || imageUrls.length > 6
        || imageUrls.some(url => typeof url !== 'string' || !url.trim())
        || new Set(imageUrls.map(url => typeof url === 'string' ? url.trim() : url)).size !== imageUrls.length) {
        return 'Invalid image_urls: expected 1-6 unique non-empty strings';
      }
    }
  }

  const parameters = tool.function.parameters as unknown as {
    properties: Record<string, { type?: string; enum?: string[] }>;
    required?: string[];
  };
  for (const required of parameters.required || []) {
    const value = args[required];
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
      return `Missing required parameter: ${required}`;
    }
  }
  for (const [name, definition] of Object.entries(parameters.properties)) {
    const value = args[name];
    if (value === undefined || value === null) continue;
    const typeMatches = definition.type === 'array' ? Array.isArray(value) : typeof value === definition.type;
    if (!typeMatches) return `Invalid parameter type for ${name}`;
    if (definition.enum && (typeof value !== 'string' || !definition.enum.includes(value))) {
      return `Invalid value for ${name}`;
    }
  }
  return null;
}

export interface ToolCallResult {
  errorCode?: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  /** 工具执行产生的图片URL列表，前端需要将这些图片添加到画布 */
  imageUrls?: string[];
  /** 工具执行产生的视频URL列表 */
  videoUrls?: string[];
  /** 异步任务ID列表（包含model/providerId供前端轮询） */
  taskIds?: Array<{ taskId: string; model: string; providerId: string; type: 'image' | 'video'; runId?: string }>;
  /** 结果描述，用于回传给 LLM */
  resultText: string;
  /** build_workflow 产出的工作流，前端写入节点模式并在画布放预览卡 */
  workflow?: import('./workflow-engine').Workflow;
  /** Server-only continuation for an agent-v2 task admitted without provider execution. */
  admittedExecution?: AdmittedToolExecution;
}

export type { AgentAdmittedExecution as AdmittedToolExecution } from '@/lib/agent-runtime/types';

export async function executeAdmittedToolCall(
  input: ToolCallResult | AdmittedToolExecution,
  signal?: AbortSignal,
  options: {
    waitForTerminal?: boolean;
    executionFence?: import('@/lib/agent-runtime/execution-fence').AgentExecutionFence;
  } = {},
): Promise<void> {
  const execution = 'kind' in input ? input : input.admittedExecution;
  if (!execution) return;
  if (execution.kind === 'generation') {
    const { kickoffDurableGenerationTasks } = await import('@/lib/task-core/durable-generation-kickoff');
    const result = await kickoffDurableGenerationTasks({
      taskIds: execution.taskIds,
      userId: execution.userId,
      userRole: execution.userRole,
      ...(signal ? { signal } : {}),
      ...(options.waitForTerminal === false ? { waitForTerminal: false } : {}),
      ...(options.executionFence ? { executionFence: options.executionFence } : {}),
    });
    if (result.failed.length > 0) {
      throw new Error(`Generation continuation was rejected for ${result.failed.join(', ')}`);
    }
    return;
  }

  const response = await runWithAbortSignalTimeout(signal, 120_000, async requestSignal => (
    fetch(`http://localhost:${SERVER_PORT}/api/edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getInternalRequestHeaders(execution.userId, execution.userRole)),
        'idempotency-key': execution.idempotencyKey,
        'x-wujie-agent-resume-execution': 'true',
      },
      body: JSON.stringify(execution.requestBody),
      signal: requestSignal,
    })
  ));
  if (!response.ok) {
    throw new Error(`Edit continuation failed: ${response.status}`);
  }
  const payload = await response.json() as { success?: boolean; error?: string };
  if (!payload.success) throw new Error(payload.error || 'Edit continuation failed');
}

/**
 * 执行工具调用
 * @param toolName 工具名称
 * @param args 工具参数
 * @param context 执行上下文（API密钥等）
 */
export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context: {
    chatApiKey: string;
    chatBaseUrl: string;
    chatModel?: string;
    chatProviderId?: string;
    origin: string;
    userId: string;
    imageModel?: string;
    imageProviderId?: string;
    projectId?: string;
    sessionId?: string;
    messageId?: string;
    idempotencyKey?: string;
    deferAgentExecution?: boolean;
    skillBillingContext?: import('@/lib/skill-runtime/billing-authorization').SkillBillingContext;
    userRole?: 'user' | 'admin';
    allowedTools?: string[];
    canonicalImageUrl?: string;
    canonicalImageUrls?: readonly string[];
  }
): Promise<ToolCallResult> {
  if (context.allowedTools && !context.allowedTools.includes(toolName)) {
    const error = `Tool is not allowed for this agent: ${toolName}`;
    return { success: false, error, resultText: `Tool validation failed: ${error}` };
  }

  const validationError = validateChatToolCall(toolName, args);
  if (validationError) {
    return { success: false, error: validationError, resultText: `Tool validation failed: ${validationError}` };
  }

  switch (toolName) {
    case 'generate_image':
      return executeGenerateImage(args, context);
    case 'edit_image':
      return executeEditImage(args, context);
    case 'img2img':
      return executeImg2Img(args, context);
    case 'remove_bg':
      return executeRemoveBg(args, context);
    case 'upscale':
      return executeUpscale(args, context);
    case 'generate_video':
      return executeGenerateVideo(args, context);
    case 'analyze_image':
      return executeAnalyzeImage(args, context);
    case 'extend_canvas':
      return executeExtendCanvas(args, context);
    case 'run_skill':
      return executeRunSkill(args, context);
    case 'build_workflow':
      return executeBuildWorkflow(args, context);
    default:
      return { success: false, error: `未知工具: ${toolName}`, resultText: `错误：未知工具 ${toolName}` };
  }
}

// ============ Tool Context Type ============
interface ToolContext {
  skillBillingContext?: import('@/lib/skill-runtime/billing-authorization').SkillBillingContext;
  chatApiKey: string;
  chatBaseUrl: string;
  chatModel?: string;
  chatProviderId?: string;
  origin: string;
  userId: string;
  imageModel?: string;
  imageProviderId?: string;
  projectId?: string;
  sessionId?: string;
  messageId?: string;
  idempotencyKey?: string;
  deferAgentExecution?: boolean;
  userRole?: 'user' | 'admin';
  canonicalImageUrl?: string;
  canonicalImageUrls?: readonly string[];
}

function routeMismatch(): ToolCallResult {
  return {
    success: false,
    error: 'MODEL_ROUTE_MISMATCH',
    resultText: 'The exact selected provider/model pair is unavailable.',
  };
}

function hasAgentRouteOverride(
  args: Record<string, unknown>,
  context: ToolContext,
): boolean {
  if (!context.deferAgentExecution) return false;
  const model = typeof args.model === 'string' ? args.model : undefined;
  const providerId = typeof args.provider_id === 'string' ? args.provider_id : undefined;
  return (model !== undefined && model !== context.imageModel)
    || (providerId !== undefined && providerId !== context.imageProviderId);
}

function authorizedAgentImageUrl(
  args: Record<string, unknown>,
  context: ToolContext,
): { imageUrl?: string; error?: ToolCallResult } {
  const requested = normalizeImageUrl(String(args.image_url || ''), context.origin);
  if (!context.deferAgentExecution) return { imageUrl: requested };
  if (!context.canonicalImageUrl) {
    return { error: { success: false, error: 'AGENT_CONTEXT_NOT_FOUND', resultText: 'Authorized media is unavailable.' } };
  }
  const canonical = normalizeImageUrl(context.canonicalImageUrl, context.origin);
  if (requested !== canonical) {
    return { error: { success: false, error: 'AGENT_MEDIA_URL_MISMATCH', resultText: 'The image URL does not match the authorized Asset Version.' } };
  }
  return { imageUrl: canonical };
}

function authorizedAgentImageUrls(
  args: Record<string, unknown>,
  context: ToolContext,
): { imageUrls?: string[]; error?: ToolCallResult } {
  if (!Array.isArray(args.image_urls)) {
    const single = authorizedAgentImageUrl(args, context);
    return single.error ? { error: single.error } : { imageUrls: [single.imageUrl!] };
  }
  const requested = args.image_urls.map(url => normalizeImageUrl(url as string, context.origin));
  if (new Set(requested).size !== requested.length) {
    return { error: {
      success: false,
      error: 'Invalid image_urls: references must remain unique after URL normalization',
      resultText: 'Tool validation failed: normalized image URLs contain duplicates.',
    } };
  }
  if (!context.deferAgentExecution) return { imageUrls: requested };
  if (!context.canonicalImageUrls) {
    return { error: { success: false, error: 'AGENT_CONTEXT_NOT_FOUND', resultText: 'Authorized media is unavailable.' } };
  }
  const canonical = context.canonicalImageUrls.map(url => normalizeImageUrl(url, context.origin));
  if (requested.length !== canonical.length || requested.some((url, index) => url !== canonical[index])) {
    return { error: { success: false, error: 'AGENT_MEDIA_URL_MISMATCH', resultText: 'The image URLs do not match the authorized Asset Versions.' } };
  }
  return { imageUrls: [...context.canonicalImageUrls] };
}

function embeddedChatWorkspaceId(context: ToolContext): string | undefined {
  return context.sessionId ? `embedded-chat:${context.sessionId}` : undefined;
}

async function executeGenerateImage(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolCallResult> {
  try {
    if (hasAgentRouteOverride(args, context)) return routeMismatch();
    const prompt = args.prompt as string;
    const aspectRatio = (args.aspect_ratio as string) || '1:1';
    const quality = typeof args.quality === 'string' && args.quality.trim() ? args.quality : undefined;
    const resolution = typeof args.resolution === 'string' && args.resolution.trim() ? args.resolution : undefined;
    // 强制 count=1：系统提示词要求每次只生成1张，多张时应多次调用工具
    const count = 1;
    const negativePrompt = args.negative_prompt as string | undefined;
    const explicitBackground = typeof args.background === 'string'
      ? args.background as ImageBackgroundMode
      : undefined;
    const background = explicitBackground || detectTransparentBackgroundIntent(prompt) || 'auto';

    // 从 args 或 context 获取 model 和 providerId
    const model = context.deferAgentExecution
      ? context.imageModel || ''
      : (args.model as string) || context.imageModel || '';
    const providerId = context.deferAgentExecution
      ? context.imageProviderId || ''
      : (args.provider_id as string) || context.imageProviderId || '';
    if (context.deferAgentExecution && (!model || !providerId)) return routeMismatch();

    console.log(`[chat-tools] generate_image: model=${model}, providerId=${providerId}, prompt="${prompt?.substring(0, 80)}...", aspectRatio=${aspectRatio}, quality=${quality}`);

    // 使用统一的 /api/generate 接口，submitOnly 模式立即返回 taskId，不阻塞等待生成完成
    // 服务器端调用始终使用 localhost，避免通过外部域名自引用导致的网络问题
    const generateUrl = `http://localhost:${SERVER_PORT}/api/generate`;
    console.log(`[chat-tools] generate_image: calling ${generateUrl} with submitOnly`);
    const generateRes = await fetch(generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getInternalRequestHeaders(context.userId)),
        ...(context.idempotencyKey ? { 'idempotency-key': context.idempotencyKey } : {}),
        ...(context.deferAgentExecution ? {
          'x-wujie-agent-defer-execution': 'true',
          [STRICT_AGENT_GENERATE_HEADER]: 'true',
        } : {}),
      },
      body: JSON.stringify(withImageOutputPreference({
        prompt: negativePrompt ? `${prompt} [negative: ${negativePrompt}]` : prompt,
        model,
        providerId,
        aspectRatio,
        quality,
        resolution,
        outputCount: count,
        submitOnly: true,
        ...(context.deferAgentExecution && context.skillBillingContext
          ? { skillBillingContext: context.skillBillingContext } : {}),
        projectId: context.projectId,
        sessionId: context.sessionId,
        messageId: context.messageId,
        assetWorkspace: 'chat',
        assetWorkspaceId: embeddedChatWorkspaceId(context),
        assetSourceEntityId: context.messageId,
      }, model, { background, outputFormat: 'png' })),
      signal: AbortSignal.timeout(30000),
    });

    console.log(`[chat-tools] generate_image: response status=${generateRes.ok ? 'ok' : generateRes.status}`);
    if (!generateRes.ok) {
      const errorText = await generateRes.text().catch(() => '');
      console.error(`[chat-tools] generate_image FAILED: HTTP ${generateRes.status}, body=${errorText.substring(0, 300)}`);
      let errorCode: string | undefined;
      try {
        const parsed: unknown = JSON.parse(errorText);
        if (parsed && typeof parsed === 'object' && 'code' in parsed
          && parsed.code === 'SKILL_BILLING_NOT_AUTHORIZED') errorCode = parsed.code;
      } catch {
        errorCode = undefined;
      }
      return { success: false, errorCode, error: `图像生成API失败: ${generateRes.status}`, resultText: `图像生成失败（HTTP ${generateRes.status}）。${errorText.substring(0, 200)}` };
    }

    const data = await generateRes.json();
    console.log(`[chat-tools] generate_image: response success=${data.success}, hasImageUrls=${!!(data.imageUrls?.length)}, hasTaskIds=${!!(data.taskIds?.length || data.taskId)}, error=${data.error || 'none'}`);
    if (!data.success) {
      console.error(`[chat-tools] generate_image FAILED: ${data.error}`);
      return { success: false, error: data.error || '生成失败', resultText: `图像生成失败: ${data.error || '未知错误'}` };
    }

    const imageUrls: string[] = [];
    if (data.imageUrls && Array.isArray(data.imageUrls)) {
      imageUrls.push(...data.imageUrls);
    } else if (data.imageUrl) {
      imageUrls.push(data.imageUrl);
    }

    // 异步任务先等它完成，再把成品交还模型，模型才能基于结果继续下一步。
    // 等待超时或 agent-v2 延迟执行时，退回 taskIds 由前端或续跑流程接管。
    const taskIds: string[] = data.taskIds || (data.taskId ? [data.taskId] : []);
    if (taskIds.length > 0 && imageUrls.length === 0) {
      return finishSubmittedChatTasks(
        taskIds.map(taskId => ({
          taskId,
          model: data.model || '',
          providerId: data.providerId || '',
          type: 'image' as const,
        })),
        context,
        `已提交 ${taskIds.length} 个图像生成任务，仍在生成中，完成后将自动添加到画布。`,
      );
    }

    if (imageUrls.length === 0) {
      return { success: false, error: '未返回图片', resultText: '图像生成API返回了空结果。' };
    }

    return {
      success: true,
      imageUrls,
      resultText: `成功生成了 ${imageUrls.length} 张图片。图片已添加到画布上，用户可以查看。`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg, resultText: `图像生成出错: ${msg}` };
  }
}

async function executeEditImage(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolCallResult> {
  try {
    if (hasAgentRouteOverride(args, context)) return routeMismatch();
    const authorizedImage = authorizedAgentImageUrl(args, context);
    if (authorizedImage.error) return authorizedImage.error;
    const imageUrl = authorizedImage.imageUrl!;

    console.log(`[chat-tool:remove_bg] model=${context.imageModel || 'default'}, providerId=${context.imageProviderId || 'default'}`);
    const prompt = args.prompt as string;
    const size = parseInt(args.size as string, 10) || 1024;
    const model = context.deferAgentExecution
      ? context.imageModel || ''
      : (args.model as string) || context.imageModel || '';
    const providerId = context.deferAgentExecution
      ? context.imageProviderId || ''
      : (args.provider_id as string) || context.imageProviderId || '';
    if (context.deferAgentExecution && (!model || !providerId)) return routeMismatch();

    console.log(`[chat-tool:edit_image] model=${model}, providerId=${providerId}, prompt="${(prompt as string).slice(0, 80)}"`);

    // 调用语言修图 API
    const requestBody = {
      image: imageUrl,
      prompt,
      size: `${size}x${size}`,
      model,
      providerId,
    };
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getInternalRequestHeaders(context.userId)),
        ...(context.idempotencyKey ? { 'idempotency-key': context.idempotencyKey } : {}),
        ...(context.deferAgentExecution ? { 'x-wujie-agent-defer-execution': 'true' } : {}),
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { success: false, error: `修图API失败: ${res.status}`, resultText: `语言修图失败（HTTP ${res.status}）。${errText.substring(0, 200)}` };
    }

    const data = await res.json();
    const resultImageUrl = data.imageUrl || data.url;

    if (!resultImageUrl) {
      // 可能是异步任务
      const taskId = data.taskId;
      if (taskId) {
        return {
          success: true,
          taskIds: [{ taskId, model: data.model || '', providerId: data.providerId || '', type: 'image' as const }],
          ...(context.deferAgentExecution && context.idempotencyKey ? {
            admittedExecution: {
              kind: 'edit' as const,
              requestBody,
              idempotencyKey: context.idempotencyKey,
              userId: context.userId,
              userRole: context.userRole || 'user',
            },
          } : {}),
          resultText: `语言修图任务已提交（任务ID: ${taskId}），正在处理中。`,
        };
      }
      return { success: false, error: '修图未返回结果', resultText: '语言修图API未返回有效结果。' };
    }

    return {
      success: true,
      imageUrls: [resultImageUrl],
      resultText: `成功修改了图片。修改后的图片已添加到画布上。`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg, resultText: `语言修图出错: ${msg}` };
  }
}

async function executeImg2Img(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolCallResult> {
  try {
    if (hasAgentRouteOverride(args, context)) return routeMismatch();
    const authorizedImages = authorizedAgentImageUrls(args, context);
    if (authorizedImages.error) return authorizedImages.error;
    const imageUrls = authorizedImages.imageUrls!;
    const prompt = args.prompt as string;
    const strength = (args.strength as number) || 0.7;
    const referenceTypes = args.reference_types as string[] || ['style', 'composition'];
    const negativePrompt = args.negative_prompt as string | undefined;
    const model = context.deferAgentExecution
      ? context.imageModel || ''
      : (args.model as string) || context.imageModel || '';
    const providerId = context.deferAgentExecution
      ? context.imageProviderId || ''
      : (args.provider_id as string) || context.imageProviderId || '';
    if (context.deferAgentExecution && (!model || !providerId)) return routeMismatch();

    console.log(`[chat-tool:img2img] model=${model}, providerId=${providerId}, prompt="${prompt.slice(0, 80)}", strength=${strength}`);

    // 构建图生图 prompt 前缀
    const refPrefixes: string[] = [];
    if (referenceTypes.includes('style')) refPrefixes.push(`in the style of the reference image`);
    if (referenceTypes.includes('composition')) refPrefixes.push(`with the composition of the reference image`);
    if (referenceTypes.includes('character')) refPrefixes.push(`featuring the character of the reference image`);
    if (referenceTypes.includes('color')) refPrefixes.push(`with the color palette of the reference image`);
    
    const fullPrompt = refPrefixes.length > 0
      ? `${refPrefixes.join(', ')}. ${prompt}${negativePrompt ? ` [negative: ${negativePrompt}]` : ''}`
      : `${prompt}${negativePrompt ? ` [negative: ${negativePrompt}]` : ''}`;

    // 调用 generate API 并传入参考图（submitOnly 模式，不阻塞等待生成完成）
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getInternalRequestHeaders(context.userId)),
        ...(context.idempotencyKey ? { 'idempotency-key': context.idempotencyKey } : {}),
        ...(context.deferAgentExecution ? {
          'x-wujie-agent-defer-execution': 'true',
          [STRICT_AGENT_GENERATE_HEADER]: 'true',
        } : {}),
      },
      body: JSON.stringify({
        prompt: fullPrompt,
        model,
        providerId,
        referenceImages: imageUrls,
        strength,
        aspectRatio: typeof args.aspect_ratio === 'string' ? args.aspect_ratio : '1:1',
        submitOnly: true,
        ...(context.deferAgentExecution && context.skillBillingContext
          ? { skillBillingContext: context.skillBillingContext } : {}),
        projectId: context.projectId,
        sessionId: context.sessionId,
        messageId: context.messageId,
        assetWorkspace: 'chat',
        assetWorkspaceId: embeddedChatWorkspaceId(context),
        assetSourceEntityId: context.messageId,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errorCode: string | undefined;
      let errorMessage: string | undefined;
      try {
        const parsed: unknown = JSON.parse(errText);
        if (parsed && typeof parsed === 'object') {
          const error = parsed as Record<string, unknown>;
          errorCode = typeof error.code === 'string' ? error.code : undefined;
          errorMessage = typeof error.error === 'string' ? error.error : undefined;
        }
      } catch {
        errorCode = undefined;
      }
      return {
        success: false,
        errorCode,
        error: errorMessage || `图生图API失败: ${res.status}`,
        resultText: `图生图失败（HTTP ${res.status}）。${errText.substring(0, 200)}`,
      };
    }

    const data = await res.json();
    const outputImageUrls: string[] = data.imageUrls || (data.imageUrl ? [data.imageUrl] : []);
    const taskIds: string[] = data.taskIds || [];

    if (outputImageUrls.length > 0) {
      return {
        success: true,
        imageUrls: outputImageUrls,
        resultText: `成功基于参考图生成了 ${outputImageUrls.length} 张新图片。图片已添加到画布上。`,
      };
    }

    if (taskIds.length > 0) {
      return finishSubmittedChatTasks(
        taskIds.map(taskId => ({ taskId, model: data.model || '', providerId: data.providerId || '', type: 'image' as const })),
        context,
        `图生图任务已提交（任务ID: ${taskIds.join(', ')}），仍在生成中。`,
      );
    }

    return { success: false, error: '图生图未返回结果', resultText: '图生图API未返回有效结果。' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg, resultText: `图生图出错: ${msg}` };
  }
}

async function executeRemoveBg(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolCallResult> {
  try {
    const imageUrl = normalizeImageUrl(args.image_url as string, context.origin);

    console.log(`[chat-tool:edit_image] model=${context.imageModel || 'default'}, providerId=${context.imageProviderId || 'default'}`);
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/image-edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getInternalRequestHeaders(context.userId)),
        ...(context.idempotencyKey ? { 'idempotency-key': context.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        action: 'removebg',
        imageUrl,
        model: context.imageModel || '',
        providerId: context.imageProviderId || '',
      }),
    });

    if (!res.ok) {
      return { success: false, error: `移除背景API失败: ${res.status}`, resultText: `移除背景失败（HTTP ${res.status}）。` };
    }

    const data = await res.json();
    const taskIds: string[] = data.taskIds || (data.taskId ? [data.taskId] : []);
    const resultUrls: string[] = data.imageUrls || [];

    if (resultUrls.length > 0) {
      return { success: true, imageUrls: resultUrls, resultText: `成功移除了图片背景。透明背景图和蒙版图已添加到画布上。` };
    }
    if (taskIds.length > 0) {
      return finishSubmittedChatTasks(
        taskIds.map(taskId => ({ taskId, model: data.model || '', providerId: data.providerId || '', type: 'image' as const })),
        context,
        '移除背景任务已提交，仍在处理中。',
      );
    }
    return { success: false, error: '未返回结果', resultText: '移除背景API未返回有效结果。' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg, resultText: `移除背景出错: ${msg}` };
  }
}

async function executeUpscale(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolCallResult> {
  try {
    const imageUrl = normalizeImageUrl(args.image_url as string, context.origin);
    const scale = parseInt(args.scale as string, 10) || 2;

    console.log(`[chat-tool:upscale] model=${context.imageModel || 'default'}, providerId=${context.imageProviderId || 'default'}, scale=${scale}`);

    const res = await fetch(`http://localhost:${SERVER_PORT}/api/image-edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getInternalRequestHeaders(context.userId)),
        ...(context.idempotencyKey ? { 'idempotency-key': context.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        action: 'upscale',
        imageUrl,
        scale,
        model: context.imageModel || '',
        providerId: context.imageProviderId || '',
      }),
    });

    if (!res.ok) {
      return { success: false, error: `放大API失败: ${res.status}`, resultText: `图片放大失败（HTTP ${res.status}）。` };
    }

    const data = await res.json();
    const taskIds: string[] = data.taskIds || (data.taskId ? [data.taskId] : []);
    const resultUrls: string[] = data.imageUrls || [];

    if (resultUrls.length > 0) {
      return { success: true, imageUrls: resultUrls, resultText: `成功将图片放大了${scale}倍。放大后的图片已添加到画布上。` };
    }
    if (taskIds.length > 0) {
      return finishSubmittedChatTasks(
        taskIds.map(taskId => ({ taskId, model: data.model || '', providerId: data.providerId || '', type: 'image' as const })),
        context,
        '图片放大任务已提交，仍在处理中。',
      );
    }
    return { success: false, error: '未返回结果', resultText: '图片放大API未返回有效结果。' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg, resultText: `图片放大出错: ${msg}` };
  }
}

async function executeGenerateVideo(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolCallResult> {
  try {
    const prompt = args.prompt as string;
    const imageUrl = args.image_url ? normalizeImageUrl(args.image_url as string, context.origin) : undefined;
    const aspectRatio = (args.aspect_ratio as string) || '16:9';
    const duration = parseInt(args.duration as string, 10) || 5;

    console.log(`[chat-tool:generate_video] model=${context.imageModel || 'default'}, providerId=${context.imageProviderId || 'default'}, aspectRatio=${aspectRatio}, duration=${duration}s`);

    const res = await fetch(`http://localhost:${SERVER_PORT}/api/video/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getInternalRequestHeaders(context.userId)),
        ...(context.idempotencyKey ? { 'idempotency-key': context.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        prompt,
        ...(imageUrl ? { imageUrl, mode: 'image-to-video' } : { mode: 'text-to-video' }),
        aspectRatio,
        duration,
      }),
    });

    if (!res.ok) {
      return { success: false, error: `视频生成API失败: ${res.status}`, resultText: `视频生成失败（HTTP ${res.status}）。` };
    }

    const data = await res.json();
    const taskIds: string[] = data.taskIds || (data.taskId ? [data.taskId] : []);

    if (taskIds.length > 0) {
      return finishSubmittedChatTasks(
        taskIds.map(taskId => ({
          taskId,
          model: data.model || '',
          providerId: data.providerId || '',
          type: 'video' as const,
        })),
        context,
        `视频生成任务已提交（任务ID: ${taskIds.join(', ')}），仍在生成中，完成后将自动添加到画布。`,
      );
    }

    const videoUrls: string[] = data.videoUrls || (data.videoUrl ? [data.videoUrl] : []);
    if (videoUrls.length > 0) {
      return { success: true, videoUrls, resultText: `成功生成了视频。视频已添加到画布上。` };
    }

    return { success: false, error: '未返回结果', resultText: '视频生成API未返回有效结果。' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg, resultText: `视频生成出错: ${msg}` };
  }
}

async function executeAnalyzeImage(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolCallResult> {
  try {
    const authorizedImage = authorizedAgentImageUrl(args, context);
    if (authorizedImage.error) return authorizedImage.error;
    const imageUrl = authorizedImage.imageUrl!;
    const question = (args.question as string) || '请详细描述这张图片的内容、风格、色彩、构图等信息。';

    let chatApiKey: string;
    let chatBaseUrl: string;
    let chatModel: string;
    if (context.deferAgentExecution) {
      if (!context.chatProviderId || !context.chatModel || !context.chatApiKey || !context.chatBaseUrl) {
        return {
          success: false,
          error: 'MODEL_ROUTE_MISMATCH',
          resultText: 'The exact selected provider/model pair is unavailable.',
        };
      }
      chatApiKey = context.chatApiKey;
      chatBaseUrl = context.chatBaseUrl.replace(/\/+$/, '');
      chatModel = context.chatModel;
    } else {
      // Preserve legacy default-provider lookup outside agent-v2.
      const { findProviderForModel: findChatProvider } = await import('@/lib/server-api-config');
      const chatProvider = await findChatProvider('', 'chat');
      if (!chatProvider) {
        return { success: false, error: '未配置聊天模型', resultText: '错误：未配置聊天模型，无法分析图片。' };
      }
      chatApiKey = chatProvider.apiKey;
      chatBaseUrl = chatProvider.baseUrl?.replace(/\/+$/, '') || context.chatBaseUrl;
      chatModel = chatProvider.selectedModels?.[0] || 'gpt-4o';
    }

    const response = await fetchWithV1Retry(chatBaseUrl, '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${chatApiKey}`,
      },
      body: JSON.stringify({
        model: chatModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: question },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 1000,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return { success: false, error: `图片分析失败: ${response.status}`, resultText: `图片分析失败（HTTP ${response.status}）。` };
    }

    const data = await response.json();
    const analysisText = data.choices?.[0]?.message?.content || '无法分析图片内容。';

    return {
      success: true,
      resultText: `图片分析结果：${analysisText}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg, resultText: `图片分析出错: ${msg}` };
  }
}

async function executeExtendCanvas(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolCallResult> {
  try {
    const imageUrl = normalizeImageUrl(args.image_url as string, context.origin);
    const direction = (args.direction as string) || 'all';
    const scale = parseInt(args.scale as string, 10) || 2;
    const prompt = args.prompt as string | undefined;

    console.log(`[chat-tool:extend_canvas] model=${context.imageModel || 'default'}, providerId=${context.imageProviderId || 'default'}, direction=${direction}, scale=${scale}`);

    const res = await fetch(`http://localhost:${SERVER_PORT}/api/image-edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getInternalRequestHeaders(context.userId)),
        ...(context.idempotencyKey ? { 'idempotency-key': context.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        action: 'extend',
        imageUrl,
        direction,
        scale,
        prompt,
        model: context.imageModel || '',
        providerId: context.imageProviderId || '',
      }),
    });

    if (!res.ok) {
      return { success: false, error: `扩展画面API失败: ${res.status}`, resultText: `扩展画面失败（HTTP ${res.status}）。` };
    }

    const data = await res.json();
    const taskIds: string[] = data.taskIds || (data.taskId ? [data.taskId] : []);
    const resultUrls: string[] = data.imageUrls || [];

    if (resultUrls.length > 0) {
      return { success: true, imageUrls: resultUrls, resultText: `成功扩展了画面。扩展后的图片已添加到画布上。` };
    }
    if (taskIds.length > 0) {
      return finishSubmittedChatTasks(
        taskIds.map(taskId => ({ taskId, model: data.model || '', providerId: data.providerId || '', type: 'image' as const })),
        context,
        '扩展画面任务已提交，仍在处理中。',
      );
    }
    return { success: false, error: '未返回结果', resultText: '扩展画面API未返回有效结果。' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg, resultText: `扩展画面出错: ${msg}` };
  }
}

// ============ Skill execution ============

// 技能运行等待上限。技能可能包含多步生成，给足时间；超时则退回 runId，
// 由前端技能面板继续跟踪，不阻断对话。
const SKILL_RUN_WAIT_MS = 90_000;
const SKILL_RUN_POLL_INTERVAL_MS = 3_000;

const TEXT_INPUT_KINDS = new Set(['text', 'select', 'number']);

function skillRequestInputKey(skill: SkillDefinition): string | undefined {
  const named = skill.inputs.find(input => input.key === 'request' && TEXT_INPUT_KINDS.has(input.kind));
  if (named) return named.key;
  const required = skill.inputs.find(input => input.required && TEXT_INPUT_KINDS.has(input.kind));
  return required?.key ?? skill.inputs.find(input => TEXT_INPUT_KINDS.has(input.kind))?.key;
}

const SKILL_CATALOG_DESCRIPTION_LIMIT = 60;

/**
 * 对话工具的补充说明：技能目录和 build_workflow 用法。
 * 只列出能用一段文字需求启动的技能，需要素材输入的技能留给技能面板。
 */
export function buildChatToolGuide(availableToolNames: readonly string[]): string {
  const sections: string[] = [];
  if (availableToolNames.includes('run_skill')) {
    const lines = listSkillsForSurface('canvas')
      .filter(skill => skillRequestInputKey(skill))
      .map(skill => {
        const description = skill.description.length > SKILL_CATALOG_DESCRIPTION_LIMIT
          ? `${skill.description.slice(0, SKILL_CATALOG_DESCRIPTION_LIMIT)}…`
          : skill.description;
        return `- ${skill.id}：${skill.name}，${description}`;
      });
    if (lines.length > 0) {
      sections.push([
        '## 技能目录（run_skill）',
        '用户的需求明确对应下列某个多步骤技能时，调用 run_skill，skill_id 必须取自本目录，request 写清用户的完整需求。单张出图、修图、放大不要用技能。',
        ...lines,
      ].join('\n'));
    }
  }
  if (availableToolNames.includes('build_workflow')) {
    sections.push([
      '## 节点工作流（build_workflow）',
      '用户要求搭建、创建或设计一个可重复使用的处理流程（例如“先生成再去背景再放大”）时，调用 build_workflow，description 写清每一步要做什么。',
      '工作流会写入节点模式，不会立即执行，也不消耗积分。只想要一张成品图时直接调用对应的单一工具。',
    ].join('\n'));
  }
  return sections.join('\n\n');
}

function skillModelBindings(skill: SkillDefinition, context: ToolContext): FrozenBindings | string {
  const bindings: FrozenBindings = {};
  for (const role of requiredSkillModelRoles(skill)) {
    if ((role === 'orchestrator' || role === 'vision') && context.chatProviderId && context.chatModel) {
      bindings[role] = { providerId: context.chatProviderId, modelId: context.chatModel };
    } else if ((role === 'image' || role === 'edit') && context.imageProviderId && context.imageModel) {
      bindings[role] = { providerId: context.imageProviderId, modelId: context.imageModel };
    } else {
      return `当前没有为技能配置 ${role} 模型，无法运行`;
    }
  }
  return bindings;
}

function skillRunText(outputs: unknown): string {
  if (!Array.isArray(outputs)) return '';
  return outputs
    .filter((output): output is { kind: string; content: string } => (
      Boolean(output) && typeof output === 'object'
      && (output as { kind?: unknown }).kind === 'text'
      && typeof (output as { content?: unknown }).content === 'string'
    ))
    .map(output => output.content.trim())
    .filter(Boolean)
    .join('\n\n');
}

async function executeRunSkill(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolCallResult> {
  const skillId = String(args.skill_id);
  const request = String(args.request);
  const skill = listSkillsForSurface('canvas').find(candidate => candidate.id === skillId);
  if (!skill) {
    return { success: false, error: `未知技能: ${skillId}`, resultText: `没有找到技能 ${skillId}，请改用技能目录中的技能。` };
  }
  if (!context.projectId) {
    return { success: false, error: '缺少项目', resultText: '当前没有打开的项目，无法运行技能。' };
  }
  const inputKey = skillRequestInputKey(skill);
  if (!inputKey) {
    return { success: false, error: '技能不接受文本输入', resultText: `${skill.name} 需要图片等素材输入，请在技能面板中运行。` };
  }
  const modelBindings = skillModelBindings(skill, context);
  if (typeof modelBindings === 'string') {
    return { success: false, error: modelBindings, resultText: modelBindings };
  }

  const actor: User = {
    id: context.userId,
    name: context.userId,
    role: context.userRole ?? 'user',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  let runId: string;
  try {
    const created = await createSkillRun({
      actor,
      request: {
        skillId: skill.id,
        skillVersion: skill.version,
        surface: 'canvas',
        projectId: context.projectId,
        workspaceId: `canvas:${context.projectId}`,
        inputValues: { [inputKey]: request },
        sourceVersionIds: [],
        modelBindings,
        idempotencyKey: context.idempotencyKey || `chat-skill:${context.projectId}:${skill.id}:${Date.now()}`,
      },
    });
    runId = created.runId;
    await dispatchSkillRunExecution({ actorUserId: context.userId, runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message, resultText: `技能运行失败：${message}` };
  }

  const runTask = { taskId: runId, model: '', providerId: '', type: 'image' as const, runId };
  const deadline = Date.now() + SKILL_RUN_WAIT_MS;
  let lastStatus = 'queued';
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, SKILL_RUN_POLL_INTERVAL_MS));
    let history: Awaited<ReturnType<typeof getSkillRun>>;
    try {
      history = await getSkillRun({ actorUserId: context.userId, runId });
    } catch {
      continue;
    }
    lastStatus = history.status;
    if (history.status === 'completed') {
      const text = skillRunText(history.outputs);
      const assetCount = history.assetVersionIds.length;
      return {
        success: true,
        taskIds: [runTask],
        resultText: `${skill.name} 已完成。${text ? `结果：\n${text}` : ''}${assetCount > 0 ? `\n产出 ${assetCount} 个素材，已添加到画布。` : ''}`,
      };
    }
    if (history.status === 'failed' || history.status === 'cancelled' || history.status === 'timeout') {
      const reason = history.error?.message || history.status;
      return { success: false, error: reason, taskIds: [runTask], resultText: `${skill.name} 运行失败：${reason}` };
    }
  }
  return {
    success: true,
    taskIds: [runTask],
    resultText: `${skill.name} 仍在运行（状态：${lastStatus}），完成后结果会自动添加到画布。`,
  };
}

/** 读出 chat/completions 的回复文本；部分网关忽略 stream:false 仍按 SSE 返回，也一并拼接。 */
function readChatCompletionText(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith('data:')) {
    const payload = JSON.parse(trimmed) as { choices?: Array<{ message?: { content?: unknown } }> };
    const message = payload.choices?.[0]?.message?.content;
    return typeof message === 'string' ? message : '';
  }
  let text = '';
  for (const line of trimmed.split('\n')) {
    const data = line.trim().replace(/^data:\s*/, '');
    if (!line.trim().startsWith('data:') || !data || data === '[DONE]') continue;
    try {
      const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }> };
      const piece = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content;
      if (typeof piece === 'string') text += piece;
    } catch {
      // 跳过不完整或非 JSON 的事件行
    }
  }
  return text;
}

async function executeBuildWorkflow(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolCallResult> {
  const description = String(args.description);
  if (!context.chatModel) {
    return { success: false, error: '未配置对话模型', resultText: '当前没有可用的对话模型，无法创建工作流。' };
  }
  let content = '';
  try {
    const response = await fetchWithV1Retry(context.chatBaseUrl, '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${context.chatApiKey}`,
      },
      body: JSON.stringify({
        model: context.chatModel,
        temperature: 0.7,
        stream: false,
        messages: [
          { role: 'system', content: AI_BUILD_PROMPT },
          { role: 'user', content: description },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      return { success: false, error: `工作流生成失败: ${response.status}`, resultText: `创建工作流失败（HTTP ${response.status}）。` };
    }
    content = readChatCompletionText(await response.text());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message, resultText: `创建工作流出错：${message}` };
  }

  const parsed = parseAIBuildResponse(content);
  if (!parsed || parsed.nodes.length < 2) {
    return { success: false, error: '工作流格式无效', resultText: '没有生成可用的工作流，请把需求描述得更具体一些。' };
  }
  const workflow = createWorkflowFromAIResult(parsed, { defaultChatModel: context.chatModel });
  return {
    success: true,
    data: { workflow },
    workflow,
    resultText: `已创建工作流「${workflow.name}」，包含 ${workflow.nodes.length} 个节点，已写入节点模式。`,
  };
}

// ============ Task completion waiting ============

// 工具在把结果交还模型前等待任务完成的上限。超过上限则退回 taskIds，
// 由前端继续轮询，避免一次工具调用耗尽整轮 Agent 超时。
const TOOL_TASK_WAIT_MS = 90_000;
const TOOL_TASK_POLL_INTERVAL_MS = 3_000;

type SubmittedChatTask = { taskId: string; model: string; providerId: string; type: 'image' | 'video' };

interface AwaitedChatTasks {
  imageUrls: string[];
  videoUrls: string[];
  pending: SubmittedChatTask[];
  failed: string[];
}

/**
 * 轮询已提交的任务直到完成、失败或超时。
 * 完成的图片/视频 URL 直接交还模型，让模型能基于成品继续下一步；
 * 超时仍未完成的任务保留为 pending，交由前端继续轮询。
 */
async function awaitChatTasks(
  tasks: SubmittedChatTask[],
  context: ToolContext,
): Promise<AwaitedChatTasks> {
  const imageUrls: string[] = [];
  const videoUrls: string[] = [];
  const pending: SubmittedChatTask[] = [];
  const failed: string[] = [];
  const deadline = Date.now() + TOOL_TASK_WAIT_MS;

  for (const task of tasks) {
    let settled = false;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, TOOL_TASK_POLL_INTERVAL_MS));
      let payload: Record<string, unknown>;
      try {
        const response = await fetch(`http://localhost:${SERVER_PORT}/api/poll-task`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await getInternalRequestHeaders(context.userId, context.userRole)),
          },
          body: JSON.stringify({ taskId: task.taskId, model: task.model, providerId: task.providerId }),
          signal: AbortSignal.timeout(20_000),
        });
        payload = await response.json() as Record<string, unknown>;
      } catch {
        continue;
      }
      const status = typeof payload.status === 'string' ? payload.status : '';
      if (status === 'completed') {
        const images = Array.isArray(payload.imageUrls)
          ? payload.imageUrls.filter((url): url is string => typeof url === 'string' && url.length > 0)
          : [];
        if (typeof payload.imageUrl === 'string' && payload.imageUrl && !images.includes(payload.imageUrl)) {
          images.unshift(payload.imageUrl);
        }
        const videos = Array.isArray(payload.videoUrls)
          ? payload.videoUrls.filter((url): url is string => typeof url === 'string' && url.length > 0)
          : [];
        if (typeof payload.videoUrl === 'string' && payload.videoUrl && !videos.includes(payload.videoUrl)) {
          videos.unshift(payload.videoUrl);
        }
        imageUrls.push(...images);
        videoUrls.push(...videos);
        settled = true;
        break;
      }
      if (status === 'failed' || status === 'cancelled' || status === 'timeout' || payload.retryable === false) {
        failed.push(typeof payload.error === 'string' && payload.error ? payload.error : `任务 ${task.taskId} 未完成`);
        settled = true;
        break;
      }
    }
    if (!settled) pending.push(task);
  }

  return { imageUrls, videoUrls, pending, failed };
}

/**
 * 工具提交出异步任务后的统一收尾：等待完成并把成品交还模型。
 * agent-v2 的延迟执行路径不在这里等待，任务由准入后的续跑流程接管。
 */
async function finishSubmittedChatTasks(
  tasks: SubmittedChatTask[],
  context: ToolContext,
  pendingText: string,
): Promise<ToolCallResult> {
  if (context.deferAgentExecution) {
    return {
      success: true,
      taskIds: tasks,
      admittedExecution: {
        kind: 'generation' as const,
        taskIds: tasks.map(task => task.taskId),
        userId: context.userId,
        userRole: context.userRole || 'user',
      },
      resultText: pendingText,
    };
  }

  const awaited = await awaitChatTasks(tasks, context);
  if (awaited.imageUrls.length > 0 || awaited.videoUrls.length > 0) {
    const finished = [...awaited.imageUrls, ...awaited.videoUrls];
    const note = awaited.pending.length > 0
      ? `另有 ${awaited.pending.length} 个任务仍在生成，完成后会自动添加到画布。`
      : '';
    return {
      success: true,
      imageUrls: awaited.imageUrls,
      videoUrls: awaited.videoUrls,
      ...(awaited.pending.length > 0 ? { taskIds: awaited.pending } : {}),
      resultText: `已完成，生成结果：${finished.join(' ')}。${note}可基于这些结果继续下一步。`,
    };
  }
  if (awaited.pending.length > 0) {
    return { success: true, taskIds: awaited.pending, resultText: pendingText };
  }
  return {
    success: false,
    error: awaited.failed[0] || '任务未完成',
    resultText: `任务失败：${awaited.failed.join('；') || '未获得结果'}`,
  };
}

// ============ Helpers ============

function normalizeImageUrl(url: string, origin: string): string {
  if (url.startsWith('/')) {
    // 服务器端调用始终使用 localhost，避免外部 URL 回环
    return `http://localhost:${SERVER_PORT}${url}`;
  }
  return url;
}

function mapAspectRatioToSize(aspectRatio: string, quality: string, modelId?: string): string {
  return calculateActualPixels(aspectRatio, quality, modelId) || '1024x1024';
}

/**
 * 从 SSE 流中解析 tool_calls
 * 在流式响应中，tool_calls 是增量式传输的，需要累积拼接
 */
export function parseToolCallsFromStream(
  accumulatedToolCalls: Array<{ id: string; function: { name: string; arguments: string }; type: string }>,
  deltaToolCalls: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string }; type?: string }>
): Array<{ id: string; function: { name: string; arguments: string }; type: string }> {
  for (const delta of deltaToolCalls) {
    const index = delta.index;
    if (!accumulatedToolCalls[index]) {
      accumulatedToolCalls[index] = {
        id: delta.id || '',
        function: { name: '', arguments: '' },
        type: delta.type || 'function',
      };
    }
    if (delta.id) {
      accumulatedToolCalls[index].id = delta.id;
    }
    if (delta.function?.name) {
      accumulatedToolCalls[index].function.name += delta.function.name;
    }
    if (delta.function?.arguments) {
      accumulatedToolCalls[index].function.arguments += delta.function.arguments;
    }
    if (delta.type) {
      accumulatedToolCalls[index].type = delta.type;
    }
  }
  return accumulatedToolCalls;
}