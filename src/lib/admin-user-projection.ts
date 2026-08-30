import type { User } from '@/lib/user-types';

export type ProjectionAvailability = 'available' | 'unavailable';

export interface ProjectionCoverage {
  identity: 'available';
  credits: ProjectionAvailability;
  projects: ProjectionAvailability;
  activity: ProjectionAvailability;
}

export interface CreditProjectionRow {
  user_id?: unknown;
  balance?: unknown;
}

export interface ProjectProjectionRow {
  user_id?: unknown;
  data_value?: unknown;
  updated_at?: unknown;
}

export interface ActivityProjectionRow {
  user_id?: unknown;
  last_activity?: unknown;
}

export interface AdminProjectedUser extends User {
  credits: number;
  project_count: number;
  last_login?: number;
}

interface ProjectionInput {
  users: User[];
  creditRows: CreditProjectionRow[];
  projectRows: ProjectProjectionRow[];
  activityRows: ActivityProjectionRow[];
}

function safeUserId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value;
}

function safeNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeTimestamp(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function countProjects(value: unknown): number {
  if (typeof value === 'string') {
    try {
      return countProjects(JSON.parse(value));
    } catch {
      return 0;
    }
  }
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

export function projectAdminUsers({
  users,
  creditRows,
  projectRows,
  activityRows,
}: ProjectionInput): AdminProjectedUser[] {
  const creditsByUser = new Map<string, number>();
  const projectsByUser = new Map<string, ProjectProjectionRow>();
  const activityByUser = new Map<string, number>();

  for (const row of creditRows) {
    const userId = safeUserId(row.user_id);
    if (userId) creditsByUser.set(userId, safeNumber(row.balance));
  }
  for (const row of projectRows) {
    const userId = safeUserId(row.user_id);
    if (userId) projectsByUser.set(userId, row);
  }
  for (const row of activityRows) {
    const userId = safeUserId(row.user_id);
    const timestamp = safeTimestamp(row.last_activity);
    if (userId && timestamp !== null) activityByUser.set(userId, timestamp);
  }

  return users.map(user => {
    const {
      credits: _legacyCredits,
      project_count: _legacyProjectCount,
      last_login: _legacyLastLogin,
      ...identityUser
    } = user;
    void _legacyCredits;
    void _legacyProjectCount;
    void _legacyLastLogin;
    const projectRow = projectsByUser.get(user.id);
    const timestamps = [
      safeTimestamp(activityByUser.get(user.id)),
      safeTimestamp(projectRow?.updated_at),
      safeTimestamp(user.updatedAt),
      safeTimestamp((user as User & { updated_at?: unknown }).updated_at),
    ].filter((value): value is number => value !== null);
    const lastLogin = timestamps.length > 0 ? Math.max(...timestamps) : undefined;

    return {
      ...identityUser,
      credits: creditsByUser.get(user.id) ?? 0,
      project_count: countProjects(projectRow?.data_value),
      ...(lastLogin !== undefined ? { last_login: lastLogin } : {}),
    };
  });
}
