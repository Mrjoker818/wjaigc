import { describe, expect, it } from 'vitest';
import {
  recordSkillExecutionDiagnostic,
  safeSkillExecutionError,
  skillExecutionDiagnostic,
} from '@/lib/skill-runtime/execution-error';

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

  it('keeps actionable internal diagnostics while redacting credentials and media payloads', () => {
    const error = new TypeError(
      'decode failed for https://cdn.example.test/image.png?token=private-token '
      + 'Bearer bearer-secret sk-secret-token data:image/png;base64,AAAA',
    );
    error.stack = `TypeError: ${error.message}\n    at loadSafeImageInput (/app/src/lib/safe-image-input.ts:323:17)`;

    const diagnostic = skillExecutionDiagnostic(error, {
      runId: 'run-1',
      stepId: 'audit-image:one',
      generation: 4,
    });

    expect(diagnostic).toMatchObject({
      runId: 'run-1',
      stepId: 'audit-image:one',
      generation: 4,
      errorName: 'TypeError',
    });
    expect(diagnostic.message).toContain('decode failed');
    expect(diagnostic.stack).toContain('safe-image-input.ts:323:17');
    expect(JSON.stringify(diagnostic)).not.toMatch(
      /private-token|bearer-secret|sk-secret-token|base64,AAAA/,
    );

    const records: unknown[] = [];
    recordSkillExecutionDiagnostic(error, {
      runId: 'run-1', stepId: 'audit-image:one', generation: 4,
    }, diagnosticRecord => records.push(diagnosticRecord));
    expect(records).toEqual([diagnostic]);
  });
});
