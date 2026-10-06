import { createHash } from 'node:crypto';

/** Versioned whitelist: credentials and transport request IDs are not execution identity. */
export function digestAgentEditAdmissionRequest(body: Record<string, unknown>): string {
  const fields = [
    'image', 'prompt', 'maskDataUrl', 'providerId', 'model', 'imageProviderId', 'imageModel',
    'imagePrompt', 'quality', 'aspectRatio', 'maxRounds', 'projectId', 'sessionId',
    'messageId', 'selectedEntityId', 'assetParentVersionIds', 'maskVersionId',
  ];
  const identity: Record<string, unknown> = { version: 'agent-edit-admission-v2' };
  for (const field of fields) identity[field] = body[field];
  identity.assetProjectionMode = body.assetProjectionMode === 'revision' ? 'revision' : 'derived';
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
