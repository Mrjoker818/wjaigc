import type { AgentRunError } from '@/lib/agent-runtime/types';

export function safeSkillExecutionError(error: unknown): AgentRunError & { providerStatus?: number } {
  const details = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  if (details.code === 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN') {
    return { code: 'SKILL_SUBMISSION_UNKNOWN', message: '供应商提交结果尚未确认，请核对原任务，勿重复生成', retryable: false };
  }
  if (details.code === 'SKILL_BILLING_NOT_AUTHORIZED') {
    return { code: 'SKILL_BILLING_NOT_AUTHORIZED', message: 'Skill 费用授权无效或执行状态已变化，请检查任务记录', retryable: false };
  }
  if (details.code === 'SKILL_IMAGE_ADMISSION_FAILED') {
    return { code: 'SKILL_IMAGE_ADMISSION_FAILED', message: '无界未能创建图像子任务，尚未向图像供应商提交，请稍后重试', retryable: true };
  }
  const status = typeof details.providerStatus === 'number' && Number.isInteger(details.providerStatus)
    && details.providerStatus >= 400 && details.providerStatus <= 599 ? details.providerStatus : undefined;
  const metadata = status === undefined ? {} : { providerStatus: status };
  if (status === 400 && details.providerCode === 'invalid_quality') {
    return { code: 'SKILL_IMAGE_QUALITY_REJECTED', message: '所选模型不支持当前图片质量参数，请检查质量设置', retryable: false, ...metadata };
  }
  if (status === 400 || details.providerCode === 'TASK_RECOVERY_REQUEST_REJECTED') {
    return { code: 'SKILL_PARAMETERS_REJECTED', message: '模型提供商拒绝了当前生成参数，请检查模型支持范围', retryable: false, ...metadata };
  }
  if (status === 401 || status === 403) {
    return { code: 'SKILL_PROVIDER_AUTH_REJECTED', message: '模型提供商凭证无效或权限不足，请联系管理员检查配置', retryable: false, ...metadata };
  }
  if (status === 429) {
    return { code: 'SKILL_PROVIDER_RATE_LIMITED', message: '模型提供商请求过于频繁，请稍后重试', retryable: true, ...metadata };
  }
  if (status !== undefined && status >= 500) {
    return { code: 'SKILL_PROVIDER_UNAVAILABLE', message: '模型提供商服务暂时不可用，请稍后重试', retryable: true, ...metadata };
  }
  // Never persist raw provider text, prompts, or credentials into public run events.
  return { code: 'SKILL_EXECUTION_FAILED', message: '当前步骤执行失败，请检查任务记录后重试', retryable: false, ...metadata };
}
