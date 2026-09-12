import type { AgentRunError } from '@/lib/agent-runtime/types';

export interface SkillExecutionDiagnosticContext {
  runId: string;
  stepId: string;
  generation: number;
}

export interface SkillExecutionDiagnostic extends SkillExecutionDiagnosticContext {
  errorName: string;
  errorCode?: string;
  message: string;
  stack?: string;
  retryable?: boolean;
  providerStatus?: number;
  requestId?: string;
  cause?: Omit<SkillExecutionDiagnostic, keyof SkillExecutionDiagnosticContext | 'cause'>;
}

const SAFE_DIAGNOSTIC_CODE = /^[A-Z0-9_.-]{1,80}$/u;
const SAFE_DIAGNOSTIC_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function redactDiagnosticText(value: string, limit: number): string {
  return value
    .replace(/data:[^;,\s]+(?:;[^,\s]+)*;base64,[a-z0-9+/=]+/giu, '[REDACTED_DATA_URL]')
    .replace(/\bBearer\s+[^\s]+/giu, 'Bearer [REDACTED]')
    .replace(/\bsk-[a-z0-9_-]+/giu, 'sk-[REDACTED]')
    .replace(/https?:\/\/[^\s)]+/giu, '[REDACTED_URL]')
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/giu, '$1=[REDACTED]')
    .slice(0, limit);
}

function buildSkillExecutionDiagnostic(
  error: unknown,
  context: SkillExecutionDiagnosticContext,
  includeCause: boolean,
): SkillExecutionDiagnostic {
  const details = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const errorName = error instanceof Error && error.name
    ? redactDiagnosticText(error.name, 80)
    : 'UnknownError';
  const rawMessage = error instanceof Error ? error.message : String(error);
  const rawCode = typeof details.code === 'string' && SAFE_DIAGNOSTIC_CODE.test(details.code)
    ? details.code
    : undefined;
  const retryable = typeof details.retryable === 'boolean' ? details.retryable : undefined;
  const providerStatus = typeof details.providerStatus === 'number'
    && Number.isInteger(details.providerStatus)
    && details.providerStatus >= 400
    && details.providerStatus <= 599
    ? details.providerStatus
    : undefined;
  const requestId = typeof details.requestId === 'string' && SAFE_DIAGNOSTIC_ID.test(details.requestId)
    ? details.requestId
    : undefined;
  const rawStack = error instanceof Error && typeof error.stack === 'string' ? error.stack : undefined;
  const rawCause = includeCause && error instanceof Error ? error.cause : undefined;
  const cause = rawCause === undefined ? undefined : buildSkillExecutionDiagnostic(rawCause, {
    runId: context.runId,
    stepId: context.stepId,
    generation: context.generation,
  }, false);
  return {
    ...context,
    errorName,
    ...(rawCode ? { errorCode: rawCode } : {}),
    message: redactDiagnosticText(rawMessage, 600),
    ...(rawStack ? { stack: redactDiagnosticText(rawStack, 4_000) } : {}),
    ...(retryable === undefined ? {} : { retryable }),
    ...(providerStatus === undefined ? {} : { providerStatus }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(cause === undefined ? {} : {
      cause: {
        errorName: cause.errorName,
        ...(cause.errorCode ? { errorCode: cause.errorCode } : {}),
        message: cause.message,
        ...(cause.stack ? { stack: cause.stack } : {}),
        ...(cause.retryable === undefined ? {} : { retryable: cause.retryable }),
        ...(cause.providerStatus === undefined ? {} : { providerStatus: cause.providerStatus }),
        ...(cause.requestId === undefined ? {} : { requestId: cause.requestId }),
      },
    }),
  };
}

export function skillExecutionDiagnostic(
  error: unknown,
  context: SkillExecutionDiagnosticContext,
): SkillExecutionDiagnostic {
  return buildSkillExecutionDiagnostic(error, context, true);
}

export function recordSkillExecutionDiagnostic(
  error: unknown,
  context: SkillExecutionDiagnosticContext,
  write: (diagnostic: SkillExecutionDiagnostic) => void = diagnostic => {
    console.error('[skill-runtime] step execution failed', diagnostic);
  },
): void {
  write(skillExecutionDiagnostic(error, context));
}

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
  if (details.code === 'COMPLIANCE_AUDIT_VISION_FAILED') {
    return {
      code: 'COMPLIANCE_AUDIT_VISION_FAILED',
      message: '平台合规视觉检查未完成，请检查任务记录后重试',
      retryable: details.retryable === true,
      ...metadata,
    };
  }
  // Never persist raw provider text, prompts, or credentials into public run events.
  return { code: 'SKILL_EXECUTION_FAILED', message: '当前步骤执行失败，请检查任务记录后重试', retryable: false, ...metadata };
}
