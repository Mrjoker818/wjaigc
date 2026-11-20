/** A short-drama script draft the chat model saved with create_drama_draft. */
export interface SimpleChatDramaDraft {
  dramaId: string;
  title: string;
  /** Canvas project the draft was saved in, when the chat had one selected. */
  projectId?: string;
  /** e.g. "1 集、6 场、3 个角色". */
  summary: string;
}

const ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Returns the draft when every field is well formed, otherwise null. */
export function readDramaDraft(value: unknown): SimpleChatDramaDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { dramaId, title, projectId, summary } = value as Record<string, unknown>;
  if (typeof dramaId !== 'string' || !ID.test(dramaId)) return null;
  if (typeof title !== 'string' || !title.trim() || title.length > 120) return null;
  if (typeof summary !== 'string' || summary.length > 120) return null;
  if (projectId !== undefined && (typeof projectId !== 'string' || !ID.test(projectId))) return null;
  return { dramaId, title, ...(projectId ? { projectId } : {}), summary };
}
