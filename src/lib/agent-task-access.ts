export function canAccessAgentTask(
  ownerId: string | undefined,
  requesterId: string,
  requesterRole: string | undefined,
): boolean {
  return Boolean(ownerId) && (ownerId === requesterId || requesterRole === 'admin');
}
