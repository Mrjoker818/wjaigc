/**
 * Agent 编排引擎 — 从语言修图扩展
 *
 * 核心概念:
 * 1. Tool = 工具（图像编辑、图片生成、SVG描摹等），每个工具有 name/description/parameters/execute
 * 2. AgentLoop = LLM 思考 → 选工具 → 执行 → 再思考（最多 N 轮）
 * 3. 与语言修图的关系：语言修图 = Agent 的一个特例（1工具，1轮）
 *
 * 设计原则:
 * - 复用现有 edit route 的基础设施（task store, SSE, 图像处理）
 * - 工具注册表可动态扩展
 * - 每步结果通过 SSE 实时推送
 * - 最大轮次限制防止死循环
 */

// ─── 工具定义 ──────────────────────────────────────────────────────

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ToolDefinition {
  /** 工具唯一标识 */
  name: string;
  /** 工具描述（LLM 选择工具的依据） */
  description: string;
  /** 参数定义 */
  parameters: ToolParameter[];
  /** 执行函数 */
  execute: (params: Record<string, unknown>, context: AgentContext) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  /** 结果数据（图片URL、文本等） */
  data?: unknown;
  /** 错误信息 */
  error?: string;
  /** LLM 可读的结果描述 */
  description: string;
  /** 是否应该继续循环 */
  shouldContinue?: boolean;
}

// ─── Agent 上下文 ──────────────────────────────────────────────────

export interface AgentContext {
  /** 任务 ID */
  taskId: string;
  /** 用户输入（自然语言描述） */
  userPrompt: string;
  /** 原始图片 URL（可选） */
  imageUrl?: string;
  /** 原始图片描述/提示词（可选，帮助 LLM 理解图片内容） */
  imagePrompt?: string;
  /** 蒙版图片（可选） */
  maskDataUrl?: string;
  /** 视频 URL（可选，用于视频延长等操作） */
  videoUrl?: string;
  /** 用户 ID（用于 API Key 查找） */
  userId?: string;
  /** Explicit allowlist for tools available to this task. */
  allowedTools?: string[];
  /** 模型名 */
  model?: string;
  /** 最大循环轮次 */
  maxRounds: number;
  /** 当前轮次 */
  currentRound: number;
  /** 累积的上下文（前几轮的结果摘要） */
  contextHistory: Array<{ role: 'tool' | 'assistant'; content: string; toolName?: string }>;
  /** 进度回调 */
  onProgress?: (info: { round: number; step: string; detail?: string }) => void;
  /** Allows the owning route to stop planning when its task is cancelled. */
  isCancelled?: () => boolean;
}

// ─── Agent 执行结果 ────────────────────────────────────────────────

export interface AgentResult {
  success: boolean;
  /** 最终输出（通常是图片 URL） */
  output?: unknown;
  /** 执行步骤摘要 */
  steps: Array<{
    round: number;
    toolName: string;
    params: Record<string, unknown>;
    result: string;
    success: boolean;
  }>;
  /** LLM 最终回复 */
  finalResponse?: string;
  /** 错误信息 */
  error?: string;
}

// ─── 工具注册表 ────────────────────────────────────────────────────

const toolRegistry = new Map<string, ToolDefinition>();

/** 注册工具 */
export function registerTool(tool: ToolDefinition): void {
  toolRegistry.set(tool.name, tool);
}

/** 获取工具 */
export function getTool(name: string): ToolDefinition | undefined {
  return toolRegistry.get(name);
}

/** 获取所有已注册工具 */
export function getAllTools(): ToolDefinition[] {
  return Array.from(toolRegistry.values());
}

/** 获取工具描述（供 LLM function calling 使用） */
export function getToolsForLLM(allowedTools?: readonly string[]): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: { type: string; properties: Record<string, unknown>; required: string[] } };
}> {
  const allowed = allowedTools ? new Set(allowedTools) : null;
  return getAllTools().filter(tool => !allowed || allowed.has(tool.name)).map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          tool.parameters.map(p => [p.name, {
            type: p.type,
            description: p.description,
            ...(p.enum ? { enum: p.enum } : {}),
          }])
        ),
        required: tool.parameters.filter(p => p.required).map(p => p.name),
      },
    },
  }));
}

// ─── Agent 循环 ────────────────────────────────────────────────────

function validateToolArguments(tool: ToolDefinition, args: Record<string, unknown>): string | null {
  for (const parameter of tool.parameters) {
    const value = args[parameter.name];
    if (parameter.required && (value === undefined || value === null || (typeof value === 'string' && !value.trim()))) {
      return `Missing required parameter: ${parameter.name}`;
    }
    if (value === undefined || value === null) continue;

    const typeMatches = parameter.type === 'array'
      ? Array.isArray(value)
      : parameter.type === 'object'
        ? typeof value === 'object' && !Array.isArray(value)
        : typeof value === parameter.type;
    if (!typeMatches) return `Invalid parameter type for ${parameter.name}`;
    if (parameter.enum && (typeof value !== 'string' || !parameter.enum.includes(value))) {
      return `Invalid value for ${parameter.name}`;
    }
  }
  return null;
}

const DEFAULT_MAX_ROUNDS = 5;

/**
 * 执行 Agent 循环
 *
 * 流程:
 * 1. 将用户 prompt + 可用工具列表发送给 LLM
 * 2. LLM 返回要调用的工具和参数
 * 3. 执行工具，将结果返回给 LLM
 * 4. LLM 决定是否需要继续（调用更多工具）或返回最终结果
 * 5. 重复 2-4 直到 LLM 返回最终结果或达到最大轮次
 */
export async function executeAgentLoop(
  context: AgentContext,
  llmCall: (messages: Array<{ role: string; content: string }>, tools: ReturnType<typeof getToolsForLLM>) => Promise<{
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
    content?: string;
    finishReason?: string;
  }>,
): Promise<AgentResult> {
  const steps: AgentResult['steps'] = [];
  let currentRound = 0;
  let consecutiveFailures = 0;
  const maxRounds = context.maxRounds || DEFAULT_MAX_ROUNDS;
  const allowedTools = context.allowedTools ? new Set(context.allowedTools) : null;
  const tools = getToolsForLLM(context.allowedTools);

  // 系统消息
  const systemMessage = buildSystemPrompt(context, context.allowedTools);

  // 消息历史
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemMessage },
  ];

  // 添加用户消息（含图片描述）
  let userContent = context.userPrompt;
  if (context.imageUrl) {
    userContent += `\n\n[用户提供的图片: ${context.imageUrl}]`;
  }
  if (context.videoUrl) {
    userContent += `\n[用户提供的视频: ${context.videoUrl}]`;
  }
  if (context.maskDataUrl) {
    userContent += '\n[用户提供了编辑蒙版]';
  }
  messages.push({ role: 'user', content: userContent });

  while (currentRound < maxRounds) {
    if (context.isCancelled?.()) {
      return {
        success: false,
        output: context.imageUrl,
        steps,
        error: 'Task cancelled',
        finalResponse: 'Task cancelled',
      };
    }
    currentRound++;
    context.currentRound = currentRound;

    context.onProgress?.({ round: currentRound, step: 'thinking', detail: `第 ${currentRound} 轮思考中...` });

    // 调用 LLM — ★ 添加 try-catch 防止 LLM 调用异常导致 Agent 循环崩溃
    let llmResponse: Awaited<ReturnType<typeof llmCall>>;
    try {
      console.log(`[agent-engine] Round ${currentRound}: calling LLM...`);
      llmResponse = await llmCall(messages, tools);
      console.log(`[agent-engine] Round ${currentRound}: LLM responded, toolCalls:`, llmResponse.toolCalls?.length || 0, 'content:', (llmResponse.content || '').slice(0, 100));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'LLM 调用异常';
      console.error(`[agent-engine] Round ${currentRound}: LLM call failed:`, errMsg);
      return {
        success: false,
        output: context.imageUrl,
        steps,
        finalResponse: `LLM 调用失败: ${errMsg}`,
        error: errMsg,
      };
    }

    // LLM 没有调用工具，返回最终结果
    if (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) {
      return {
        success: true,
        output: context.imageUrl, // 如果没有工具调用，输出原图
        steps,
        finalResponse: llmResponse.content || '已完成',
      };
    }

    // 执行每个工具调用
    const allResults: string[] = [];
    for (const toolCall of llmResponse.toolCalls) {
      if (context.isCancelled?.()) {
        return {
          success: false,
          output: context.imageUrl,
          steps,
          error: 'Task cancelled',
          finalResponse: 'Task cancelled',
        };
      }
      if (allowedTools && !allowedTools.has(toolCall.name)) {
        const result = `Tool "${toolCall.name}" is not allowed for this task`;
        allResults.push(result);
        steps.push({ round: currentRound, toolName: toolCall.name, params: toolCall.arguments, result, success: false });
        consecutiveFailures++;
        continue;
      }
      const tool = getTool(toolCall.name);
      if (!tool) {
        allResults.push(`工具 "${toolCall.name}" 不存在`);
        steps.push({
          round: currentRound,
          toolName: toolCall.name,
          params: toolCall.arguments,
          result: `工具不存在`,
          success: false,
        });
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          return {
            success: false,
            output: context.imageUrl,
            steps,
            error: `连续${consecutiveFailures}次调用不存在的工具，终止循环`,
            finalResponse: `工具 "${toolCall.name}" 不存在，连续失败终止`,
          };
        }
        continue;
      }

      context.onProgress?.({ round: currentRound, step: 'executing', detail: `执行 ${tool.name}...` });

      const argumentError = validateToolArguments(tool, toolCall.arguments);
      if (argumentError) {
        allResults.push(argumentError);
        steps.push({
          round: currentRound,
          toolName: toolCall.name,
          params: toolCall.arguments,
          result: argumentError,
          success: false,
        });
        consecutiveFailures++;
        continue;
      }

      try {
        const result = await tool.execute(toolCall.arguments, context);

        steps.push({
          round: currentRound,
          toolName: toolCall.name,
          params: toolCall.arguments,
          result: result.description,
          success: result.success,
        });

        allResults.push(result.description);

        // 更新上下文中的图片（如果工具返回了新图片）
        if (result.success && result.data && typeof result.data === 'string') {
          context.imageUrl = result.data;
        }

        // 工具指示停止
        if (result.shouldContinue === false) {
          return {
            success: true,
            output: result.data,
            steps,
            finalResponse: result.description,
          };
        }
        consecutiveFailures = 0; // 成功后重置连续失败计数
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : '未知错误';
        allResults.push(`工具 "${toolCall.name}" 执行失败: ${errMsg}`);
        steps.push({
          round: currentRound,
          toolName: toolCall.name,
          params: toolCall.arguments,
          result: errMsg,
          success: false,
        });
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          return {
            success: false,
            output: context.imageUrl,
            steps,
            error: `工具连续执行失败${consecutiveFailures}次，终止循环`,
            finalResponse: `工具连续执行失败: ${errMsg}`,
          };
        }
      }
    }

    // 将工具结果添加到消息历史
    messages.push({
      role: 'assistant',
      content: llmResponse.content || `调用工具: ${llmResponse.toolCalls.map(t => t.name).join(', ')}`,
    });

    messages.push({
      role: 'user', // tool result 以 user 角色发送（兼容更多 API）
      content: `工具执行结果:\n${allResults.join('\n\n')}\n\n请根据以上结果决定下一步操作，或回复"完成"结束。`,
    });
  }

  // 达到最大轮次
  return {
    success: true,
    output: context.imageUrl,
    steps,
    finalResponse: `已达到最大执行轮次(${maxRounds})，当前结果已保存`,
  };
}

// ─── 系统提示词 ────────────────────────────────────────────────────

function buildSystemPrompt(context: AgentContext, allowedTools?: readonly string[]): string {
  const allowed = allowedTools ? new Set(allowedTools) : null;
  const toolDescriptions = getAllTools()
    .filter(tool => !allowed || allowed.has(tool.name))
    .map(t => `- ${t.name}: ${t.description}`)
    .join('\n');

  return `你是一个专业的AI图像与视频编辑助手。用户会给你一个图像或视频编辑请求，你需要选择合适的工具来完成任务。

可用工具:
${toolDescriptions}

工作规则:
1. 根据用户需求选择最合适的工具
2. 每次只调用必要的工具，避免冗余操作
3. 如果一个工具的结果不理想，可以尝试其他工具或调整参数
4. 最多执行 ${context.maxRounds || DEFAULT_MAX_ROUNDS} 轮操作
5. 任务完成后，不要调用任何工具，直接描述完成的结果
6. 如果无法完成，也直接说明原因
7. 如果用户需要生成视频，使用 generate_video 工具；如需延长视频，使用 extend_video 工具

当前任务: ${context.userPrompt}
${context.imageUrl ? `图片已提供` : '没有图片'}
${context.imagePrompt ? `图片原始描述: ${context.imagePrompt}` : ''}`;
}

// ─── 注册内置工具 ──────────────────────────────────────────────────

/**
 * 注册图像编辑工具（复用 edit route 的逻辑）
 */
registerTool({
  name: 'image_edit',
  description: '使用自然语言描述来编辑图片。可以修改图片的任何部分，如更换背景、添加/移除元素、调整色彩等。需要提供编辑指令。',
  parameters: [
    { name: 'prompt', type: 'string', description: '编辑指令，描述想要对图片做什么修改', required: true },
    { name: 'size', type: 'string', description: '输出图片尺寸，如 1024, 1536, 2048', enum: ['1024', '1536', '2048'] },
    { name: 'quality', type: 'string', description: '输出质量', enum: ['low', 'medium', 'high'] },
  ],
  execute: async (params, ctx) => {
    // 实际执行在 agent-edit route 中处理
    return {
      success: true,
      data: ctx.imageUrl, // placeholder - 实际由 route 处理
      description: `图片编辑指令已记录: ${params.prompt}`,
    };
  },
});

registerTool({
  name: 'generate_image',
  description: '根据文字描述生成新图片。适用于从零创建图片或完全重新生成。',
  parameters: [
    { name: 'prompt', type: 'string', description: '图片描述，越详细越好', required: true },
    { name: 'size', type: 'string', description: '图片尺寸比例，如 1:1, 16:9, 4:3' },
  ],
  execute: async (params) => {
    return {
      success: true,
      description: `图片生成指令已记录: ${params.prompt}`,
    };
  },
});

registerTool({
  name: 'remove_background',
  description: '移除图片背景，只保留主体。适用于需要透明背景或分离主体的场景。',
  parameters: [
    { name: 'description', type: 'string', description: '对图片主体的描述，帮助AI更准确地识别' },
  ],
  execute: async (_params, ctx) => {
    return {
      success: true,
      data: ctx.imageUrl,
      description: '背景移除指令已记录',
    };
  },
});

registerTool({
  name: 'upscale',
  description: '无损放大图片，提高分辨率和清晰度，不改变画面内容。',
  parameters: [
    { name: 'scale', type: 'string', description: '放大倍数', enum: ['2', '4'] },
  ],
  execute: async (params, ctx) => {
    return {
      success: true,
      data: ctx.imageUrl,
      description: `图片放大指令已记录: ${params.scale || '2'}x`,
    };
  },
});

registerTool({
  name: 'svg_trace',
  description: '将位图转为SVG矢量图。适用于需要无损缩放或编辑路径的场景。',
  parameters: [
    { name: 'mode', type: 'string', description: '描摹模式', enum: ['color', 'bw'] },
    { name: 'quality', type: 'string', description: '质量级别', enum: ['fast', 'balanced', 'high', 'ultra'] },
  ],
  execute: async (params, ctx) => {
    return {
      success: true,
      data: ctx.imageUrl,
      description: `SVG描摹指令已记录 (${params.mode || 'color'} 模式)`,
    };
  },
});

registerTool({
  name: 'generate_video',
  description: '根据文字描述或参考图片生成视频。支持文生视频和图生视频两种模式。适用于从文本或图片创建动态视频内容。',
  parameters: [
    { name: 'prompt', type: 'string', description: '视频内容描述，描述想要生成的视频画面和动态效果', required: true },
    { name: 'mode', type: 'string', description: '生成模式: text2video=纯文字生成, image2video=图片转视频', enum: ['text2video', 'image2video'] },
    { name: 'duration', type: 'string', description: '视频时长(秒)', enum: ['5', '10', '15'] },
    { name: 'aspect_ratio', type: 'string', description: '画面比例', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
  ],
  execute: async (params) => {
    return {
      success: true,
      description: `视频生成指令已记录: ${params.prompt} (${params.mode || 'text2video'} 模式, ${params.duration || '5'}秒)`,
    };
  },
});

registerTool({
  name: 'extend_video',
  description: '延长视频时长，在现有视频末尾继续生成内容。适用于需要更长视频的场景。需要提供原始视频URL。',
  parameters: [
    { name: 'prompt', type: 'string', description: '延续内容的描述，描述视频后续的画面发展' },
    { name: 'duration', type: 'string', description: '延长的时长(秒)', enum: ['5', '10', '15'] },
  ],
  execute: async (params) => {
    return {
      success: true,
      description: `视频延长指令已记录: ${params.prompt || '自动延续'} (+${params.duration || '5'}秒)`,
    };
  },
});
