export type AuditRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const ACTION_BY_PATH: Array<[string, string]> = [
  ['/api/generate', 'image_generate'],
  ['/api/image-edit', 'image_edit'],
  ['/api/edit', 'lang_edit'],
  ['/api/agent-edit', 'agent_edit'],
  ['/api/chat', 'chat'],
  ['/api/optimize-prompt', 'optimize_prompt'],
  ['/api/image-to-3d', 'image_to_3d'],
  ['/api/svg-trace', 'svg_trace'],
  ['/api/segment-elements', 'segment_elements'],
  ['/api/refine-engine', 'refine_engine'],
  ['/api/video/generate', 'video_generate'],
  ['/api/video/extend', 'video_extend'],
  ['/api/workflow/execute', 'workflow_execute'],
  ['/api/upload', 'file_upload'],
  ['/api/credits', 'credit_operation'],
];

export function shouldAuditClientRequest(pathname: string, method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if (
    pathname === '/api/activity'
    || pathname.startsWith('/api/auth/')
    || pathname.startsWith('/api/connector/auth/')
    || pathname === '/api/user-data/sync'
    || pathname.startsWith('/api/task-events')
    || pathname.startsWith('/api/poll-')
  ) return false;
  return normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD' && pathname.startsWith('/api/');
}

export function getOperationAuditAction(pathname: string, method: string): string {
  const exact = ACTION_BY_PATH.find(([path]) => pathname === path);
  if (exact) return exact[1];
  return `${method.toLowerCase()}_api_request`;
}

export function normalizeAuditPath(pathname: string): string {
  return pathname.startsWith('/api/') ? pathname.slice(0, 160) : '/api/unknown';
}
