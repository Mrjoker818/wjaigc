/**
 * Responses API SSE 流式保活模块
 *
 * 参考 Image-Studio 的 SSE 流式保活设计，实现 OpenAI Responses API 的 SSE 解析。
 *
 * 核心原理：
 * - 使用 /v1/responses 端点 + image_generation 工具 + SSE 流式协议
 * - 模型边推理边发心跳事件（response.in_progress / image_generation_call.generating），
 *   Cloudflare/Nginx 看到持续流量不会判定为空闲超时
 * - 即使流中断，如果有 partial_image 也可以保存为半成品
 *
 * 安全设计：
 * - Feature Flag 控制：管理员面板开关，默认关闭
 * - 自动降级：Responses API 失败时回退到现有 Images API 路径
 * - 纯新增模块，不修改现有代码结构
 */

/** Responses API SSE 事件类型 */
export type ResponsesApiEventType =
  | 'response.created'
  | 'response.in_progress'
  | 'response.image_generation_call.in_progress'
  | 'response.image_generation_call.generating'
  | 'response.image_generation_call.partial_image'
  | 'response.output_item.done'
  | 'response.completed'
  | 'response.failed'
  | 'error'
  | 'unknown';

/** 解析后的 SSE 事件 */
export interface ResponsesApiSSEEvent {
  type: ResponsesApiEventType;
  /** 原始事件数据 */
  raw: Record<string, unknown>;
  /** 阶段描述（中文） */
  stage: string;
  /** 是否有最终图片结果 */
  hasFinalImage: boolean;
  /** 最终图片 base64（仅 output_item.done 时有值） */
  finalImageB64: string | null;
  /** 修订后的 prompt（可选） */
  revisedPrompt: string | null;
  /** 部分图片 base64（partial_image 事件时更新） */
  partialImageB64: string | null;
  /** 错误信息（error / response.failed 时有值） */
  error: string | null;
}

/** Responses API 生成结果 */
export interface ResponsesApiResult {
  success: boolean;
  imageB64: string | null;
  revisedPrompt: string | null;
  partialImageB64: string | null;
  isPartial: boolean;
  error: string | null;
}

/**
 * 构建 Responses API 请求体
 *
 * @param prompt - 用户提示词
 * @param imageModel - 图像模型 ID（如 gpt-image-2）
 * @param textModel - 文本模型 ID（如 gpt-4o）
 * @param options - 可选参数
 */
export function buildResponsesApiPayload(
  prompt: string,
  imageModel: string,
  textModel: string,
  options?: {
    size?: string;
    quality?: string;
    outputFormat?: string;
    background?: string;
    inputFidelity?: string;
    moderation?: string;
    seed?: number;
    negativePrompt?: string;
    imageUrls?: string[];
    maskB64?: string;
    /** 不优化提示词（默认 true，让模型逐字使用用户 prompt） */
    noPromptRevision?: boolean;
  },
): Record<string, unknown> {
  const content: Record<string, unknown>[] = [
    { type: 'input_text', text: prompt },
  ];

  // 添加参考图
  if (options?.imageUrls && options.imageUrls.length > 0) {
    for (const url of options.imageUrls) {
      content.push({
        type: 'input_image',
        image_url: url,
      });
    }
  }

  // 构建工具定义
  const tool: Record<string, unknown> = {
    type: 'image_generation',
    model: imageModel,
    action: (options?.imageUrls && options.imageUrls.length > 0) ? 'edit' : 'generate',
    size: options?.size || '1024x1024',
    quality: options?.quality || 'auto',
    output_format: options?.outputFormat || 'png',
    partial_images: 1, // 请求 1 个预览帧（保活 + 兜底）
  };

  // GPT-Image 系列特有参数
  if (options?.background) {
    tool['background'] = options.background;
  }
  if (options?.inputFidelity && options.imageUrls && options.imageUrls.length > 0) {
    tool['input_fidelity'] = options.inputFidelity;
  }
  if (options?.moderation) {
    tool['moderation'] = options.moderation;
  }
  if (options?.maskB64) {
    tool['input_image_mask'] = {
      image_url: `data:image/png;base64,${options.maskB64}`,
    };
  }
  if (options?.seed) {
    tool['seed'] = options.seed;
  }
  if (options?.negativePrompt) {
    tool['negative_prompt'] = options.negativePrompt;
  }

  const payload: Record<string, unknown> = {
    model: textModel,
    input: [{ role: 'user', content }],
    tools: [tool],
    tool_choice: { type: 'image_generation' },
    store: false,
    stream: true,
  };

  // 不优化提示词指令（参考 Image-Studio 的 instructions 策略）
  if (options?.noPromptRevision !== false) {
    payload['instructions'] =
      'You are a tool runner. Pass the user prompt to image_generation VERBATIM. DO NOT rewrite, expand, polish, or revise it in any way. Use the exact text the user gave.';
  }

  return payload;
}

/**
 * 解析单条 SSE 事件数据
 *
 * @param sseLine - SSE 行文本（以 "data: " 开头）
 */
export function parseResponsesApiSSEEvent(sseLine: string): ResponsesApiSSEEvent | null {
  const stripped = sseLine.trim();
  if (!stripped || stripped.startsWith(':')) {
    // 空行或注释行（SSE keep-alive comment）
    return null;
  }

  if (!stripped.startsWith('data: ')) {
    return null;
  }

  const payload = stripped.slice(6).trim();
  if (!payload || payload === '[DONE]') {
    return null;
  }

  try {
    const raw = JSON.parse(payload) as Record<string, unknown>;
    const eventType = String(raw.type || 'unknown') as ResponsesApiEventType;

    return extractEventDetails(eventType, raw);
  } catch {
    // JSON 解析失败，静默忽略
    return null;
  }
}

/**
 * 从事件中提取详细信息
 */
function extractEventDetails(
  eventType: ResponsesApiEventType,
  raw: Record<string, unknown>,
): ResponsesApiSSEEvent {
  const result: ResponsesApiSSEEvent = {
    type: eventType,
    raw,
    stage: getStageDescription(eventType),
    hasFinalImage: false,
    finalImageB64: null,
    revisedPrompt: null,
    partialImageB64: null,
    error: null,
  };

  switch (eventType) {
    case 'response.image_generation_call.partial_image': {
      // 提取部分图片
      const b64 = raw['partial_image_b64'] as string | undefined;
      if (b64) {
        result.partialImageB64 = b64;
      }
      break;
    }

    case 'response.output_item.done': {
      // 提取最终图片
      const item = raw['item'] as Record<string, unknown> | undefined;
      if (item) {
        const itemType = String(item.type || '');
        if (itemType === 'image_generation_call') {
          const imageResult = String(item.result || '');
          if (imageResult) {
            result.hasFinalImage = true;
            result.finalImageB64 = imageResult;
            result.revisedPrompt = String(item.revised_prompt || '') || null;
          }
          // 检查失败状态
          const status = String(item.status || '');
          if (status === 'failed' || status === 'cancelled') {
            const errorObj = item.error as Record<string, unknown> | undefined;
            result.error = errorObj
              ? String(errorObj.message || JSON.stringify(errorObj))
              : `图片生成状态: ${status}`;
          }
        }
      }
      break;
    }

    case 'response.failed': {
      // 整体失败
      const response = raw['response'] as Record<string, unknown> | undefined;
      const errorObj = (raw['error'] || response?.['error']) as Record<string, unknown> | undefined;
      if (errorObj) {
        result.error = String(errorObj.message || JSON.stringify(errorObj));
      } else {
        result.error = '请求失败';
      }
      break;
    }

    case 'error': {
      const errorObj = raw['error'] as Record<string, unknown> | undefined;
      if (errorObj) {
        result.error = String(errorObj.message || JSON.stringify(errorObj));
      } else {
        result.error = '接口返回错误事件';
      }
      break;
    }
  }

  return result;
}

/**
 * 获取 SSE 事件的中文阶段描述
 */
function getStageDescription(eventType: ResponsesApiEventType): string {
  switch (eventType) {
    case 'response.created':
      return '请求已创建';
    case 'response.in_progress':
      return '模型处理中';
    case 'response.image_generation_call.in_progress':
      return '图片工具已启动';
    case 'response.image_generation_call.generating':
      return '图片正在生成';
    case 'response.image_generation_call.partial_image':
      return '已收到图片数据片段';
    case 'response.output_item.done':
      return '图片生成完成';
    case 'response.completed':
      return '接口已完成';
    case 'response.failed':
      return '生成失败';
    case 'error':
      return '接口错误';
    default:
      return `接口事件: ${eventType}`;
  }
}

/**
 * 从完整 SSE 响应文本中提取图片结果
 *
 * 用于一次性解析（非流式场景，如保存到文件后重新解析）
 */
export function extractResultFromSSERaw(rawText: string): ResponsesApiResult {
  let finalImageB64: string | null = null;
  let revisedPrompt: string | null = null;
  let lastPartialB64: string | null = null;
  let lastError: string | null = null;

  const lines = rawText.split('\n');
  for (const line of lines) {
    const event = parseResponsesApiSSEEvent(line);
    if (!event) continue;

    if (event.partialImageB64) {
      lastPartialB64 = event.partialImageB64;
    }
    if (event.hasFinalImage && event.finalImageB64) {
      finalImageB64 = event.finalImageB64;
      revisedPrompt = event.revisedPrompt;
    }
    if (event.error) {
      lastError = event.error;
    }
  }

  if (finalImageB64) {
    return {
      success: true,
      imageB64: finalImageB64,
      revisedPrompt,
      partialImageB64: lastPartialB64,
      isPartial: false,
      error: null,
    };
  }

  // 有 partial image 但没有 final → 半成品兜底
  if (lastPartialB64) {
    return {
      success: true,
      imageB64: lastPartialB64,
      revisedPrompt: null,
      partialImageB64: lastPartialB64,
      isPartial: true,
      error: lastError || '流中断，仅获取到部分图片',
    };
  }

  return {
    success: false,
    imageB64: null,
    revisedPrompt: null,
    partialImageB64: null,
    isPartial: false,
    error: lastError || '接口已返回内容，但没有发现图片结果',
  };
}

/**
 * 判断模型是否支持 Responses API
 *
 * 支持 Responses API 的模型需要满足:
 * 1. 上游实现了 /v1/responses 端点
 * 2. 模型内置了 image_generation 工具
 *
 * 当前已确认支持的模型系列:
 * - gpt-image 系列 (gpt-image-1, gpt-image-2 等)
 * - chatgpt-image 系列 (chatgpt-image-latest 等)
 * - dall-e-3 (通过 Responses API 可获得 SSE 保活优势)
 *
 * 注意: 即使模型在此列表中，如果上游不支持 /v1/responses，
 * 也会自动降级到标准 Images API 路径
 */
export function isResponsesApiSupportedModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return (
    lower.includes('gpt-image') ||
    lower.includes('chatgpt-image') ||
    lower === 'dall-e-3'
  );
}

/**
 * 判断模型是否需要文本模型配合（Responses API 需要）
 */
export function needsTextModel(modelId: string): boolean {
  // Responses API 需要一个文本模型来处理 prompt 并调用 image_generation 工具
  return isResponsesApiSupportedModel(modelId);
}

/**
 * 推断合适的文本模型 ID
 *
 * Responses API 需要一个文本模型来驱动 image_generation 工具
 */
export function inferTextModel(imageModel: string): string {
  const lower = imageModel.toLowerCase();

  // GPT-Image-2 配合 GPT-4o
  if (lower.includes('gpt-image-2') || lower.includes('chatgpt-image')) {
    return 'gpt-4o';
  }
  // GPT-Image-1 配合 GPT-4o-mini
  if (lower.includes('gpt-image-1')) {
    return 'gpt-4o-mini';
  }

  // 默认使用 gpt-4o
  return 'gpt-4o';
}

/**
 * 流式解析 Responses API 的 SSE 响应
 *
 * 用于服务端 route.ts 中实时处理 SSE 流
 *
 * @param reader - ReadableStream 的 reader
 * @param onEvent - 每个解析出的事件的回调
 * @param signal - AbortSignal，用于取消
 * @returns 最终结果
 */
export async function streamResponsesApiSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: ResponsesApiSSEEvent) => void,
  signal?: AbortSignal,
): Promise<ResponsesApiResult> {
  const decoder = new TextDecoder();
  let buffer = '';
  let finalImageB64: string | null = null;
  let revisedPrompt: string | null = null;
  let lastPartialB64: string | null = null;
  let lastError: string | null = null;

  try {
    while (true) {
      if (signal?.aborted) {
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 按行处理
      const lines = buffer.split('\n');
      // 最后一行可能不完整，保留到下次
      buffer = lines.pop() || '';

      for (const line of lines) {
        const event = parseResponsesApiSSEEvent(line);
        if (!event) continue;

        // 通知调用方
        onEvent(event);

        // 跟踪最新状态
        if (event.partialImageB64) {
          lastPartialB64 = event.partialImageB64;
        }
        if (event.hasFinalImage && event.finalImageB64) {
          finalImageB64 = event.finalImageB64;
          revisedPrompt = event.revisedPrompt;
        }
        if (event.error) {
          lastError = event.error;
        }
      }
    }

    // 处理 buffer 中剩余内容
    if (buffer.trim()) {
      const event = parseResponsesApiSSEEvent(buffer);
      if (event) {
        onEvent(event);
        if (event.partialImageB64) lastPartialB64 = event.partialImageB64;
        if (event.hasFinalImage && event.finalImageB64) {
          finalImageB64 = event.finalImageB64;
          revisedPrompt = event.revisedPrompt;
        }
        if (event.error) lastError = event.error;
      }
    }
  } catch (err) {
    // 流中断，尝试用 partial image 兜底
    if (!finalImageB64 && lastPartialB64) {
      return {
        success: true,
        imageB64: lastPartialB64,
        revisedPrompt: null,
        partialImageB64: lastPartialB64,
        isPartial: true,
        error: `流中断: ${err instanceof Error ? err.message : String(err)}，已保存部分结果`,
      };
    }
    return {
      success: false,
      imageB64: null,
      revisedPrompt: null,
      partialImageB64: lastPartialB64,
      isPartial: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (finalImageB64) {
    return {
      success: true,
      imageB64: finalImageB64,
      revisedPrompt,
      partialImageB64: lastPartialB64,
      isPartial: false,
      error: null,
    };
  }

  // 有 partial 但没 final → 半成品
  if (lastPartialB64) {
    return {
      success: true,
      imageB64: lastPartialB64,
      revisedPrompt: null,
      partialImageB64: lastPartialB64,
      isPartial: true,
      error: lastError || '仅获取到部分图片',
    };
  }

  return {
    success: false,
    imageB64: null,
    revisedPrompt: null,
    partialImageB64: null,
    isPartial: false,
    error: lastError || '未获取到图片结果',
  };
}
