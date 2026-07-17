/**
 * API 错误信息翻译 —— 将英文 API 错误消息翻译为中文友好提示
 *
 * 避免用户看到 "Please wait and try again later" 等原始英文消息。
 * 所有后端 API 路由和 poll-task 均应使用此函数统一翻译。
 */

export function translateApiError(rawMsg: string): string {
  if (!rawMsg) return '处理失败，请重试';
  // 防御性处理：确保 rawMsg 是字符串
  const strMsg = typeof rawMsg === 'string' ? rawMsg : JSON.stringify(rawMsg);
  const msg = strMsg.toLowerCase();

  // 内容审核/版权限制
  if (msg.includes('copyright') || msg.includes('content policy') || msg.includes('content restriction')) {
    return '生成内容触发了版权/内容安全限制，请修改提示词后重试';
  }
  if (msg.includes('task_failed') && msg.includes('output')) {
    return '生成任务被平台拒绝，可能涉及敏感内容或版权限制，请修改提示词后重试';
  }
  // 余额不足
  if (msg.includes('insufficient balance') || msg.includes('insufficient')) {
    return 'API 余额不足，请联系管理员充值';
  }
  // 频率限制
  if (msg.includes('rate limit') || msg.includes('rate_limit') || msg.includes('too many requests')) {
    return '请求过于频繁，请稍后再试';
  }
  // 模型不存在
  if (msg.includes('model_not_found') || msg.includes('model not found')) {
    return '模型不存在或已下线，请尝试切换其他模型';
  }
  // 渠道不可用（4sapi 等中转站常见错误：模型在当前密钥组下无可用渠道）
  if (msg.includes('no available channel') || msg.includes('no channel')) {
    return '当前模型渠道不可用，请尝试切换其他模型或联系管理员检查配置';
  }
  // 暂时不可用 / 稍后重试（★ 最常见：APImart 的 "Please wait and try again later"）
  if (msg.includes('try again later') || msg.includes('please wait') || msg.includes('_error')) {
    return '当前模型暂时不可用，请稍后重试或切换其他模型';
  }
  // API Key 无效
  if (msg.includes('invalid api key') || msg.includes('invalid api_key') || msg.includes('incorrect api key')) {
    return 'API 密钥无效，请联系管理员检查配置';
  }
  // 权限不足
  if (msg.includes('permission denied') || msg.includes('access denied') || msg.includes('unauthorized')) {
    return 'API 权限不足，请联系管理员检查配置';
  }
  // 上游认证异常（中转站 401 + bad_response_status_code）
  if (msg.includes('bad_response_status_code') || msg.includes('上游服务认证异常')) {
    return 'API 上游服务认证异常，请稍后重试或更换模型';
  }
  // 不支持的画面比例
  if (msg.includes('ratio or price') || msg.includes('not configured')) {
    return '当前供应商尚未配置该模型的价格或规格映射，请联系管理员检查模型配置';
  }
  if (msg.includes('aspect ratio is not in the allowed') || msg.includes('invalid aspect ratio')
    || msg.includes('not a valid size') || msg.includes('宽高比不在允许')) {
    return '当前模型不支持此画面比例，请尝试切换到标准比例';
  }
  // 不支持图片编辑
  if (msg.includes('image_urls') || msg.includes('mask_image') || msg.includes('image editing')) {
    return '当前模型不支持图像编辑功能，请尝试切换模型';
  }
  // 不支持 Base64 或图片URL无效
  if (msg.includes('must be an url') || msg.includes('must be a url') || msg.includes('invalid url format')) {
    return '图片URL格式无效，请检查API提供商是否支持当前图片格式，或尝试切换模型';
  }
  // data: 前缀（Base64输入不被支持）
  if (msg.includes('data:')) {
    return '当前模型不支持 Base64 图片输入，请尝试切换模型';
  }
  // 内容安全
  if (msg.includes('content_policy') || msg.includes('content policy') || msg.includes('safety')) {
    return '内容被安全策略拦截，请修改指令后重试';
  }
  // 服务端错误
  if (msg.includes('internal server error') || msg.includes('server error')) {
    return 'API 服务内部错误，请稍后重试';
  }
  // 超时（含 Cloudflare 524）
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('a timeout occurred') || msg.includes('524')) {
    return '请求超时，API 服务响应过慢，请稍后重试或更换模型';
  }
  // 请求体过大
  if (msg.includes('request too large') || msg.includes('payload too large') || msg.includes('size limit')) {
    return '请求数据过大，请尝试缩小图片尺寸';
  }
  // 模型过载
  if (msg.includes('overloaded') || msg.includes('capacity') || msg.includes('currently unavailable')) {
    return '模型当前过载，请稍后重试或切换其他模型';
  }
  // 请求ID后缀清理（如 "(request id: 20260529...)" 无需暴露给用户）
  const cleanedMsg = strMsg.replace(/\s*\(request id:.*?\)\s*/i, '').trim();

  // 兜底：如果是纯英文消息，加上中文前缀
  if (/^[a-zA-Z]/.test(cleanedMsg) && !/[\u4e00-\u9fff]/.test(cleanedMsg)) {
    return `API 返回错误: ${cleanedMsg}`;
  }
  return cleanedMsg;
}
