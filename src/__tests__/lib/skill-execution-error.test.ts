import { describe, expect, it } from 'vitest';
import { safeSkillExecutionError } from '@/lib/skill-runtime/execution-error';

describe('safe Skill execution errors', () => {
  it('does not suggest resubmission for an unknown provider outcome', () => {
    expect(safeSkillExecutionError({ code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN' })).toMatchObject({
      code: 'SKILL_SUBMISSION_UNKNOWN', retryable: false,
    });
  });
  it('preserves a bounded parameter rejection without exposing provider text', () => {
    const result = safeSkillExecutionError(Object.assign(new Error('secret prompt sk-secret-token'), {
      providerStatus: 400, providerCode: 'invalid_quality',
    }));
    expect(result).toMatchObject({ code: 'SKILL_IMAGE_QUALITY_REJECTED', providerStatus: 400, retryable: false });
    expect(result.message).toContain('质量');
    expect(JSON.stringify(result)).not.toMatch(/secret|prompt/);
  });
  it('keeps transient failures distinct from bad parameters', () => {
    expect(safeSkillExecutionError({ providerStatus: 503 })).toMatchObject({
      code: 'SKILL_PROVIDER_UNAVAILABLE', retryable: true, providerStatus: 503,
    });
    expect(safeSkillExecutionError({ providerStatus: 400 })).toMatchObject({
      code: 'SKILL_PARAMETERS_REJECTED', retryable: false,
    });
  });
  it('does not serialize arbitrary exceptions or invalid metadata', () => {
    const result = safeSkillExecutionError({ providerStatus: Infinity, providerCode: 'sk-secret', message: 'private' });
    expect(result).toMatchObject({ code: 'SKILL_EXECUTION_FAILED', retryable: false });
    expect(result).not.toHaveProperty('providerStatus');
    expect(JSON.stringify(result)).not.toMatch(/private|sk-secret/);
  });
});
