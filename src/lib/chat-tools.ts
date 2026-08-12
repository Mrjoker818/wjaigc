import { calculateActualPixels } from './canvas-generation-group';
import { getInternalRequestHeaders } from './api-auth';
import { fetchWithV1Retry } from './api-helpers';

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
            description: '图片质量，如 1K, 2K, 4K',
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
        },
        required: ['image_url', 'prompt'],
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
];

// ============ Tool Execution ============

export function validateChatToolCall(toolName: string, args: Record<string, unknown>): string | null {
  const tool = CHAT_TOOLS.find(candidate => candidate.function.name === toolName);
  if (!tool) return `Unknown tool: ${toolName}`;

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
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  /** 工具执行产生的图片URL列表，前端需要将这些图片添加到画布 */
  imageUrls?: string[];
  /** 工具执行产生的视频URL列表 */
  videoUrls?: string[];
  /** 异步任务ID列表（包含model/providerId供前端轮询） */
  taskIds?: Array<{ taskId: string; model: string; providerId: string; type: 'image' | 'video' }>;
  /** 结果描述，用于回传给 LLM */
  resultText: string;
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
    origin: string;
    userId: string;
    imageModel?: string;
    imageProviderId?: string;
    projectId?: string;
    sessionId?: string;
    messageId?: string;
    allowedTools?: string[];
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
    default:
      return { success: false, error: `未知工具: ${toolName}`, resultText: `错误：未知工具 ${toolName}` };
  }
}

// ============ Tool Context Type ============
interface ToolContext {
  chatApiKey: string;
  chatBaseUrl: string;
  origin: string;
  userId: string;
  imageModel?: string;
  imageProviderId?: string;
  projectId?: string;
  sessionId?: string;
  messageId?: string;
}

function embeddedChatWorkspaceId(context: ToolContext): string | undefined {
  return context.sessionId ? `embedded-chat:${context.sessionId}` : undefined;
}

async function executeGenerateImage(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolCallResult> {
  try {
    const prompt = args.prompt as string;
    const aspectRatio = (args.aspect_ratio as string) || '1:1';
    const quality = (args.quality as string) || '1K';
    // 强制 count=1：系统提示词要求每次只生成1张，多张时应多次调用工具
    const count = 1;
    const negativePrompt = args.negative_prompt as string | undefined;

    // 从 args 或 context 获取 model 和 providerId
    const model = (args.model as string) || context.imageModel || '';
    const providerId = (args.provider_id as string) || context.imageProviderId || '';

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
      },
      body: JSON.stringify({
        prompt: negativePrompt ? `${prompt} [negative: ${negativePrompt}]` : prompt,
        model,
        providerId,
        aspectRatio,
        quality,
        outputCount: count,
        submitOnly: true,
        projectId: context.projectId,
        sessionId: context.sessionId,
        messageId: context.messageId,
        assetWorkspace: 'chat',
        assetWorkspaceId: embeddedChatWorkspaceId(context),
        assetSourceEntityId: context.messageId,
      }),
      signal: AbortSignal.timeout(30000),
    });

    console.log(`[chat-tools] generate_image: response status=${generateRes.ok ? 'ok' : generateRes.status}`);
    if (!generateRes.ok) {
      const errorText = await generateRes.text().catch(() => '');
      console.error(`[chat-tools] generate_image FAILED: HTTP ${generateRes.status}, body=${errorText.substring(0, 300)}`);
      return { success: false, error: `图像生成API失败: ${generateRes.status}`, resultText: `图像生成失败（HTTP ${generateRes.status}）。${errorText.substring(0, 200)}` };
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

    // 如果是异步任务（taskIds），不再在工具内阻塞轮询，直接返回 taskIds 给前端轮询
    // 这样 LLM 不需要等待图片生成完成，可以立即继续回复用户
    const taskIds: string[] = data.taskIds || (data.taskId ? [data.taskId] : []);
    if (taskIds.length > 0 && imageUrls.length === 0) {
      return {
        success: true,
        imageUrls: [],
        taskIds: taskIds.map(tid => ({
          taskId: tid,
          model: data.model || '',
          providerId: data.providerId || '',
          type: 'image' as const,
        })),
        resultText: `已提交 ${taskIds.length} 个图像生成任务，正在生成中...图片完成后将自动添加到画布。`,
      };
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
    const imageUrl = normalizeImageUrl(args.image_url as string, context.origin);

    console.log(`[chat-tool:remove_bg] model=${context.imageModel || 'default'}, providerId=${context.imageProviderId || 'default'}`);
    const prompt = args.prompt as string;
    const size = parseInt(args.size as string, 10) || 1024;
    const model = (args.model as string) || context.imageModel || '';
    const providerId = (args.provider_id as string) || context.imageProviderId || '';

    console.log(`[chat-tool:edit_image] model=${model}, providerId=${providerId}, prompt="${(prompt as string).slice(0, 80)}"`);

    // 调用语言修图 API
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getInternalRequestHeaders(context.userId)),
      },
      body: JSON.stringify({
        image: imageUrl,
        prompt,
        size: `${size}x${size}`,
        model,
        providerId,
      }),
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
    const imageUrl = normalizeImageUrl(args.image_url as string, context.origin);
    const prompt = args.prompt as string;
    const strength = (args.strength as number) || 0.7;
    const referenceTypes = args.reference_types as string[] || ['style', 'composition'];
    const negativePrompt = args.negative_prompt as string | undefined;
    const model = (args.model as string) || context.imageModel || '';
    const providerId = (args.provider_id as string) || context.imageProviderId || '';

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
      },
      body: JSON.stringify({
        prompt: fullPrompt,
        model,
        providerId,
        referenceImages: [imageUrl],
        strength,
        aspectRatio: '1:1',
        submitOnly: true,
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
      return { success: false, error: `图生图API失败: ${res.status}`, resultText: `图生图失败（HTTP ${res.status}）。${errText.substring(0, 200)}` };
    }

    const data = await res.json();
    const imageUrls: string[] = data.imageUrls || (data.imageUrl ? [data.imageUrl] : []);
    const taskIds: string[] = data.taskIds || [];

    if (imageUrls.length > 0) {
      return {
        success: true,
        imageUrls,
        resultText: `成功基于参考图生成了 ${imageUrls.length} 张新图片。图片已添加到画布上。`,
      };
    }

    if (taskIds.length > 0) {
      return {
        success: true,
        taskIds: taskIds.map(tid => ({ taskId: tid, model: data.model || '', providerId: data.providerId || '', type: 'image' as const })),
        resultText: `图生图任务已提交（任务ID: ${taskIds.join(', ')}），正在生成中。`,
      };
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
      return {
        success: true,
        taskIds: taskIds.map(tid => ({ taskId: tid, model: data.model || '', providerId: data.providerId || '', type: 'image' as const })),
        resultText: `移除背景任务已提交，正在处理中。`,
      };
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
      return {
        success: true,
        taskIds: taskIds.map(tid => ({ taskId: tid, model: data.model || '', providerId: data.providerId || '', type: 'image' as const })),
        resultText: `图片放大任务已提交，正在处理中。`,
      };
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
      return {
        success: true,
        taskIds: taskIds.map(tid => ({
          taskId: tid,
          model: data.model || '',
          providerId: data.providerId || '',
          type: 'video' as const,
        })),
        resultText: `视频生成任务已提交（任务ID: ${taskIds.join(', ')}），视频生成通常需要1-3分钟。`,
      };
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
    const imageUrl = normalizeImageUrl(args.image_url as string, context.origin);
    const question = (args.question as string) || '请详细描述这张图片的内容、风格、色彩、构图等信息。';

    // 使用视觉提示词API或直接用聊天模型分析
    const { findProviderForModel: findChatProvider } = await import('@/lib/server-api-config');
    const chatProvider = await findChatProvider('', 'chat');
    if (!chatProvider) {
      return { success: false, error: '未配置聊天模型', resultText: '错误：未配置聊天模型，无法分析图片。' };
    }

    const chatApiKey = chatProvider.apiKey;
    const chatBaseUrl = chatProvider.baseUrl?.replace(/\/+$/, '') || context.chatBaseUrl;
    const chatModel = chatProvider.selectedModels?.[0] || 'gpt-4o';

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
      return {
        success: true,
        taskIds: taskIds.map(tid => ({ taskId: tid, model: data.model || '', providerId: data.providerId || '', type: 'image' as const })),
        resultText: `扩展画面任务已提交，正在处理中。`,
      };
    }
    return { success: false, error: '未返回结果', resultText: '扩展画面API未返回有效结果。' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg, resultText: `扩展画面出错: ${msg}` };
  }
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
