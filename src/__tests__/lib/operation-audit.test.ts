import { describe, expect, it } from 'vitest';
import { getOperationAuditAction, shouldAuditClientRequest } from '@/lib/operation-audit';

describe('operation audit routing', () => {
  it('maps AI generation endpoints to useful audit actions', () => {
    expect(getOperationAuditAction('/api/generate', 'POST')).toBe('image_generate');
    expect(getOperationAuditAction('/api/image-edit', 'POST')).toBe('image_edit');
    expect(getOperationAuditAction('/api/chat', 'POST')).toBe('chat');
  });

  it('avoids self-logging and high-frequency read polling', () => {
    expect(shouldAuditClientRequest('/api/activity', 'POST')).toBe(false);
    expect(shouldAuditClientRequest('/api/task-events?taskId=abc', 'GET')).toBe(false);
    expect(shouldAuditClientRequest('/api/generate', 'POST')).toBe(true);
    expect(shouldAuditClientRequest('/api/generate', 'GET')).toBe(false);
  });
});
