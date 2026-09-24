import { describe, expect, it } from 'vitest';

import {
  PRESENCE_SUBPROTOCOL,
  presenceClientFrameSchema,
  presenceSnapshotFrameSchema,
} from '@/lib/collaboration/presence-schema';

describe('presence wire contract', () => {
  it('accepts only a heartbeat client frame without project content', () => {
    expect(presenceClientFrameSchema.safeParse({ type: 'heartbeat' }).success).toBe(true);
    expect(presenceClientFrameSchema.safeParse({ type: 'heartbeat', imageUrl: '/private.png' }).success)
      .toBe(false);
    expect(presenceClientFrameSchema.safeParse({ type: 'canvas-update', content: 'secret' }).success)
      .toBe(false);
    expect(PRESENCE_SUBPROTOCOL).toBe('wujie-presence-v1');
  });

  it('permits only the minimal participant snapshot fields', () => {
    const snapshot = {
      type: 'snapshot', projectId: 'project-a', connectionId: 'connection-a', sequence: 3,
      participants: [{ userId: 'member-a', displayName: 'Member A', lastSeenAt: '2026-09-24T10:00:00.000Z' }],
    };
    expect(presenceSnapshotFrameSchema.safeParse(snapshot).success).toBe(true);
    expect(presenceSnapshotFrameSchema.safeParse({ ...snapshot, apiKey: 'private' }).success).toBe(false);
    expect(presenceSnapshotFrameSchema.safeParse({
      ...snapshot, participants: [{ ...snapshot.participants[0], email: 'private@example.test' }],
    }).success).toBe(false);
  });
});
