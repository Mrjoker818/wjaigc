import { z } from 'zod';

export const PRESENCE_SUBPROTOCOL = 'wujie-presence-v1';

export const presenceClientFrameSchema = z.object({
  type: z.literal('heartbeat'),
}).strict();

const presenceParticipantSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string(),
  lastSeenAt: z.string().min(1),
}).strict();

export const presenceSnapshotFrameSchema = z.object({
  type: z.literal('snapshot'),
  projectId: z.string().min(1),
  connectionId: z.string().min(1),
  sequence: z.number().int().nonnegative().safe(),
  participants: z.array(presenceParticipantSchema),
}).strict();

export type PresenceClientFrame = z.infer<typeof presenceClientFrameSchema>;
export type PresenceSnapshotFrame = z.infer<typeof presenceSnapshotFrameSchema>;
