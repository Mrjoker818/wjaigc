/**
 * API 错误中文翻译模块
 *
 * 参考 Image-Studio 的 describeAPIError / DescribeProblem 设计，
 * 将原始 API 错误翻译为中文友好提示 + 操作建议。
 *
 * 纯新增模块，不修改任何现有代码（零风险）。
 */

/** 错误类别枚举 */
export type ApiErrorCategory =
  | 'cloudflare_timeout'   // CF 524/504 网关超时
  | 'rate_limit'           // 限速
  | 'insufficient_quota'   // 余额不足
  | 'invalid_api_key'      // API Key 无效
  | 'model_not_found'      // 模型不存在
  | 'content_moderation'   // 内容审核拦截
  | 'invalid_size'         // 尺寸无效
  | 'server_error'         // 服务端 5xx 错误
  | 'network_error'        // 网络连接错误
  | 'unknown';             // 未知错误

/** 错误码（兼容 smart-retry 的分类键） */
export type ApiErrorCode = ApiErrorCategory;

/** 分类后的错误（兼容 smart-retry 的 ClassifiedError） */
export interface ClassifiedError {
  category: ApiErrorCategory;
  rawMessage: string;
  isRetryable: boolean;
  suggestedRetries: number;
  retryDelayMs: number;
  friendlyMessage: string;
  suggestion: string;
}

/**
 * 分类 API 错误（返回 ClassifiedError 结构，供 smart-retry 等模块使用）
 */
export function classifyApiError(
  errorMessage: string,
  statusCode?: number,
  responseBody?: string,
): ClassifiedError {
  const translated = translateApiError(errorMessage, statusCode, responseBody);
  return {
    category: translated.category,
    rawMessage: translated.originalMessage,
    isRetryable: translated.isRetryable,
    suggestedRetries: translated.isRetryable ? 2 : 0,
    retryDelayMs: translated.category === 'cloudflare_timeout' ? 10000
      : translated.category === 'rate_limit' ? 30000
      : translated.category === 'network_error' ? 5000
      : translated.category === 'server_error' ? 15000
      : 0,
    friendlyMessage: translated.title,
    suggestion: translated.suggestions[0] || '',
  };
}

/** 翻译后的错误信息 */
export interface TranslatedApiError {
  category: ApiErrorCategory;
  title: string;
  description: string;
  suggestions: string[];
  isRetryable: boolean;
  /** 原始错误信息（保留供高级用户查看） */
  originalMessage: string;
}

/**
 * 分类并翻译 API 错误
 *
 * @param error - 原始错误对象或错误消息字符串
 * @param statusCode - HTTP 状态码（可选）
 * @param responseBody - 响应体文本（可选，用于解析结构化错误）
 */
export function translateApiError(
  error: unknown,
  statusCode?: number,
  responseBody?: string,
): TranslatedApiError {
  const raw = error instanceof Error ? error.message : String(error || '');
  const lower = raw.toLowerCase();
  const bodyLower = (responseBody || '').toLowerCase();

  // ── 1. Cloudflare 524/504 超时 ──
  if (
    lower.includes('error code 524') ||
    lower.includes('524: a timeout occurred') ||
    lower.includes('cloudflare') && lower.includes('524') ||
    bodyLower.includes('error code 524') ||
    bodyLower.includes('524: a timeout occurred')
  ) {
    return {
      category: 'cloudflare_timeout',
      title: '网关超时 (524)',
      description: 'Cloudflare 524: 源站在超时时间内没有返回有效响应。图像模型推理通常需要 30~120 秒，超过了 CDN 网关的默认超时限制。',
      suggestions: [
        '稍后重试（同模型重试有较大概率成功）',
        '切换到支持 SSE 流式保活的 API 提供商（Responses API 模式可避免此问题）',
        '在管理员后台配置延迟更高的中转站',
      ],
      isRetryable: true,
      originalMessage: raw,
    };
  }

  if (
    lower.includes('error code 504') ||
    lower.includes('gateway time-out') ||
    lower.includes('gateway timeout') ||
    bodyLower.includes('error code 504') ||
    bodyLower.includes('gateway time-out')
  ) {
    return {
      category: 'cloudflare_timeout',
      title: '网关超时 (504)',
      description: 'Cloudflare 504: 源站网关超时。图像生成请求在 CDN 层面超时。',
      suggestions: [
        '稍后重试',
        '切换 API 提供商或模型',
        '减少生成分辨率（高分辨率需要更长推理时间）',
      ],
      isRetryable: true,
      originalMessage: raw,
    };
  }

  // ── 2. 503 Service Unavailable ──
  if (
    statusCode === 503 ||
    lower.includes('error code 503') ||
    lower.includes('service unavailable') ||
    lower.includes('service temporarily unavailable')
  ) {
    return {
      category: 'server_error',
      title: '服务暂不可用 (503)',
      description: 'API 服务暂时不可用，可能是服务器过载或维护中。',
      suggestions: [
        '稍后重试（通常几分钟后恢复）',
        '切换到其他 API 提供商',
        '检查管理员后台该提供商的状态',
      ],
      isRetryable: true,
      originalMessage: raw,
    };
  }

  // ── 3. 限速 ──
  if (
    lower.includes('rate_limit') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('429')
  ) {
    return {
      category: 'rate_limit',
      title: '请求限速',
      description: 'API 请求频率超过限制，当前 Key 的配额已被暂时耗尽。',
      suggestions: [
        '等待几秒后重试',
        '在管理员后台换一个有更高额度的分组',
        '减少同时生成的图片数量',
      ],
      isRetryable: true,
      originalMessage: raw,
    };
  }

  // ── 4. 余额不足 ──
  if (
    lower.includes('insufficient_quota') ||
    lower.includes('billing_hard_limit') ||
    lower.includes('quota exceeded') ||
    lower.includes('余额不足') ||
    lower.includes('out of credits')
  ) {
    return {
      category: 'insufficient_quota',
      title: '额度不足',
      description: 'API 账户余额不足或已达到消费上限。',
      suggestions: [
        '到中转站/提供商后台确认套餐和余额状态',
        '充值或升级套餐',
        '在管理员后台配置其他有余额的 API 提供商',
      ],
      isRetryable: false,
      originalMessage: raw,
    };
  }

  // ── 5. API Key 无效 ──
  if (
    lower.includes('invalid_api_key') ||
    lower.includes('incorrect_api_key') ||
    lower.includes('invalid api key') ||
    lower.includes('authentication') && lower.includes('invalid') ||
    statusCode === 401
  ) {
    return {
      category: 'invalid_api_key',
      title: 'API Key 无效',
      description: 'API Key 无效、已过期或权限不足。',
      suggestions: [
        '在管理员后台检查并更新 API Key',
        '确认 Key 绑定了正确的分组（有些 Key 只绑定了特定模型分组）',
        '检查 Key 是否有当前所选模型的权限',
      ],
      isRetryable: false,
      originalMessage: raw,
    };
  }

  // ── 6. 模型不存在 / 渠道不可用 ──
  if (
    lower.includes('model_not_found') ||
    lower.includes('model not found') ||
    lower.includes('does not exist') && lower.includes('model') ||
    lower.includes('no such model') ||
    lower.includes('no available compatible account') ||
    (lower.includes('is not supported on') && lower.includes('use '))
  ) {
    return {
      category: 'model_not_found',
      title: '模型不可用',
      description: '当前 API 提供商不支持所选模型，或该模型渠道暂时不可用。',
      suggestions: [
        '在管理员后台检查图像模型 ID 是否正确',
        '确认 Key 所在分组拥有此模型权限',
        '切换到其他可用的模型',
        '如果是渠道暂时不可用，请稍后重试',
      ],
      isRetryable: false,
      originalMessage: raw,
    };
  }

  // ── 7. 内容审核拦截 ──
  if (
    lower.includes('moderation_blocked') ||
    lower.includes('content_policy') ||
    lower.includes('content policy') ||
    lower.includes('safety') && lower.includes('blocked') ||
    lower.includes('content filter')
  ) {
    return {
      category: 'content_moderation',
      title: '内容审核拦截',
      description: 'AI 安全系统认为提示词可能生成违规内容，拒绝了本次请求。这是平台硬策略，与客户端无关。',
      suggestions: [
        '修改提示词，避免涉及版权角色、公众人物、暴力或敏感内容',
        '使用更中性的描述方式',
        '如果认为是误判，可联系 API 提供商申诉',
      ],
      isRetryable: false,
      originalMessage: raw,
    };
  }

  // ── 8. 尺寸无效 ──
  if (
    lower.includes('invalid size') ||
    lower.includes('invalid_size') ||
    lower.includes('must be divisible by 16') ||
    lower.includes('size is not supported')
  ) {
    return {
      category: 'invalid_size',
      title: '尺寸无效',
      description: '所选分辨率不被当前模型支持。不同模型对尺寸的约束不同（如需要 16 对齐、最大边限制等）。',
      suggestions: [
        '系统将自动修正为最近合法尺寸并重试',
        '切换到标准比例（1:1、16:9 等）',
        '降低分辨率档位',
      ],
      isRetryable: true,
      originalMessage: raw,
    };
  }

  // ── 9. 网络连接错误 ──
  if (
    lower.includes('connection reset') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed') ||
    lower.includes('network error') ||
    lower.includes('tls handshake') ||
    lower.includes('no such host') ||
    lower.includes('upstream connect error') ||
    lower.includes('abort') && lower.includes('timeout')
  ) {
    return {
      category: 'network_error',
      title: '网络连接失败',
      description: '无法连接到 API 服务器，可能是网络波动或服务器不可达。',
      suggestions: [
        '检查网络连接',
        '稍后重试',
        '在管理员后台检查 API 提供商地址是否正确',
      ],
      isRetryable: true,
      originalMessage: raw,
    };
  }

  // ── 10. 通用 5xx 服务端错误 ──
  if (statusCode && statusCode >= 500 && statusCode < 600) {
    return {
      category: 'server_error',
      title: `服务端错误 (${statusCode})`,
      description: `API 返回 ${statusCode} 错误，服务端处理请求时出现异常。`,
      suggestions: [
        '稍后重试',
        '切换 API 提供商或模型',
        '查看日志获取详细错误信息',
      ],
      isRetryable: true,
      originalMessage: raw,
    };
  }

  // ── 11. 403 Forbidden ──
  if (statusCode === 403) {
    return {
      category: 'invalid_api_key',
      title: '权限不足 (403)',
      description: 'API Key 没有访问此资源的权限，或 Key 绑定的分组不包含当前模型。',
      suggestions: [
        '确认 Key 有当前模型的权限',
        '在管理员后台切换到有权限的分组',
        '联系 API 提供商确认权限配置',
      ],
      isRetryable: false,
      originalMessage: raw,
    };
  }

  // ── 12. 国内 API 专属错误模式 ──

  // 渠道余额不足 / 上游渠道积分不足（中转站）
  if (
    lower.includes('渠道余额不足') ||
    lower.includes('channel balance') ||
    lower.includes('上游余额') ||
    lower.includes('provider balance') ||
    lower.includes('no quota') ||
    lower.includes('credits exhausted')
  ) {
    return {
      category: 'insufficient_quota',
      title: '渠道余额不足',
      description: '当前 API 中转渠道账户余额已耗尽，无法继续生成。',
      suggestions: [
        '到 API 中转站后台为当前渠道充值',
        '在管理员后台切换到余额充足的 API 提供商',
        '联系 API 服务商补充额度',
      ],
      isRetryable: false,
      originalMessage: raw,
    };
  }

  // 上游超时 / 网关超时（中转站常见）
  if (
    lower.includes('上游超时') ||
    lower.includes('upstream timeout') ||
    lower.includes('gateway timeout') ||
    lower.includes('origin timeout') ||
    lower.includes('origin_gateway_timeout') ||
    lower.includes('upstream_timeout') ||
    lower.includes('上游服务超时')
  ) {
    return {
      category: 'cloudflare_timeout',
      title: '上游服务超时',
      description: 'API 中转站无法在限定时间内从上游服务商获取响应，通常是模型负载高或网络拥堵。',
      suggestions: [
        '稍后重试（通常 30 秒到 2 分钟后恢复）',
        '切换到响应更稳定的模型',
        '高峰期可在管理员后台切换到其他提供商',
      ],
      isRetryable: true,
      originalMessage: raw,
    };
  }

  // DashScope（阿里云）特定错误码
  if (
    lower.includes('throttling.user') ||
    lower.includes('throttling.ratelimitexceeded') ||
    lower.includes('400022') ||
    lower.includes('400020') ||
    lower.includes('arrearage') ||
    lower.includes('dashscope') && lower.includes('error')
  ) {
    const isDashScopeThrottle = lower.includes('throttling');
    return {
      category: isDashScopeThrottle ? 'rate_limit' : 'server_error',
      title: isDashScopeThrottle ? '阿里云 DashScope 限流' : '阿里云 DashScope 错误',
      description: isDashScopeThrottle
        ? '阿里云 DashScope API 当前请求频率超过账户限额。'
        : '阿里云 DashScope API 返回错误，可能是账户欠费或参数不合规。',
      suggestions: isDashScopeThrottle
        ? ['等待 10~30 秒后重试', '到阿里云控制台申请提升 QPS 额度', '切换到其他提供商的模型']
        : ['到阿里云控制台检查账户状态和余额', '确认 API Key 绑定的应用有当前模型权限', '检查请求参数是否符合规范'],
      isRetryable: isDashScopeThrottle,
      originalMessage: raw,
    };
  }

  // 可灵（Kling）/ 快手 API 错误
  if (
    lower.includes('kling') && (lower.includes('error') || lower.includes('failed')) ||
    lower.includes('klingai') ||
    lower.includes('task_status_failed') ||
    lower.includes('任务状态异常') ||
    (lower.includes('视频任务') && lower.includes('失败'))
  ) {
    return {
      category: 'server_error',
      title: '视频生成任务失败',
      description: '视频生成任务在服务端执行失败，可能是提示词不合规或服务端临时异常。',
      suggestions: [
        '修改提示词，避免涉及版权内容和敏感词汇',
        '稍后重试（服务端临时异常通常会自动恢复）',
        '切换到其他视频模型尝试',
      ],
      isRetryable: true,
      originalMessage: raw,
    };
  }

  // 豆包 / 火山引擎 API 错误
  if (
    lower.includes('volc') && lower.includes('error') ||
    lower.includes('volcengine') ||
    lower.includes('ByteDance') && lower.includes('error') ||
    lower.includes('ark') && (lower.includes('error') || statusCode === 400) && lower.includes('model')
  ) {
    return {
      category: 'server_error',
      title: '火山引擎 API 错误',
      description: '火山引擎（豆包/Seedance）返回错误，可能是模型 ID 格式不正确或账户配置问题。',
      suggestions: [
        '确认 Endpoint ID 格式正确（形如 ep-xxxxxxxx-xxxxx）',
        '到火山引擎控制台检查在线推理服务状态',
        '确认当前账号有该模型的调用权限',
      ],
      isRetryable: false,
      originalMessage: raw,
    };
  }

  // Minimax / 海螺 AI 错误
  if (
    lower.includes('minimax') && lower.includes('error') ||
    lower.includes('1000070') ||  // Minimax 常见超时错误码
    lower.includes('1000060')     // Minimax 余额不足
  ) {
    const isMinimaxQuota = lower.includes('1000060');
    return {
      category: isMinimaxQuota ? 'insufficient_quota' : 'server_error',
      title: isMinimaxQuota ? 'Minimax 余额不足' : 'Minimax API 错误',
      description: isMinimaxQuota
        ? 'Minimax 账户余额已耗尽，无法继续调用。'
        : 'Minimax API 返回错误，可能是服务端超时或临时异常。',
      suggestions: isMinimaxQuota
        ? ['到 Minimax 开放平台充值账户余额', '在管理员后台切换到其他视频 API 提供商']
        : ['稍后重试（10~30 秒后）', '切换到其他视频模型'],
      isRetryable: !isMinimaxQuota,
      originalMessage: raw,
    };
  }

  // 中转站通用渠道错误（one-api / new-api 中转站）
  if (
    lower.includes('no available channel') ||
    lower.includes('渠道不可用') ||
    lower.includes('channel not found') ||
    lower.includes('所有渠道均不可用') ||
    lower.includes('channel_not_found')
  ) {
    return {
      category: 'model_not_found',
      title: '中转渠道不可用',
      description: 'API 中转站没有找到支持当前模型的可用渠道，渠道可能已被禁用或暂时不可用。',
      suggestions: [
        '在管理员后台更换 API 提供商',
        '联系 API 中转站服务商确认渠道状态',
        '检查模型 ID 是否与中转站配置一致',
      ],
      isRetryable: false,
      originalMessage: raw,
    };
  }

  // ── 兜底：未知错误 ──
  return {
    category: 'unknown',
    title: '请求失败',
    description: raw || '未知错误',
    suggestions: [
      '稍后重试',
      '切换 API 提供商或模型',
      '查看日志获取详细信息',
    ],
    isRetryable: false,
    originalMessage: raw,
  };
}

/**
 * 判断错误是否可自动重试
 *
 * 基于 Image-Studio 的 IsRetryable 逻辑，适配无界AI 的错误场景。
 */
export function isRetryableApiError(
  error: unknown,
  statusCode?: number,
  responseBody?: string,
): boolean {
  return translateApiError(error, statusCode, responseBody).isRetryable;
}

/**
 * 判断是否为 Cloudflare 超时错误（524/504）
 * 此类错误同模型重试通常就能成功，不需要切换模型。
 */
export function isCloudflareTimeoutError(error: unknown, statusCode?: number): boolean {
  const raw = error instanceof Error ? error.message : String(error || '');
  const lower = raw.toLowerCase();
  return (
    lower.includes('524') ||
    lower.includes('504') ||
    lower.includes('gateway time-out') ||
    lower.includes('gateway timeout') ||
    lower.includes('a timeout occurred') ||
    statusCode === 524 ||
    statusCode === 504
  );
}

/**
 * 判断是否为可恢复的传输层错误
 */
export function isTransportError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error || '');
  const lower = raw.toLowerCase();
  const transportMarkers = [
    'connection reset',
    'eof',
    'timeout',
    'deadline exceeded',
    'i/o timeout',
    'tls handshake',
    'no such host',
    'upstream connect error',
    'econnreset',
    'econnrefused',
    'etimedout',
    'fetch failed',
    'socket hang up',
  ];
  return transportMarkers.some(m => lower.includes(m));
}
