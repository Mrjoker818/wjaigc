/** Browser-safe response contract. Server authentication is never taken from this object. */
export interface DocumentExchangeSessionDescriptor {
  sessionToken: string;
  sessionFingerprint: string;
  actorId: string;
  ownerId: string;
  projectId: string;
  grantGeneration: string;
  expiresAt: string;
  retainUntil: string;
}
