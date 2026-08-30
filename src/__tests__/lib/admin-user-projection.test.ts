import { describe, expect, it } from 'vitest';
import {
  countProjects,
  projectAdminUsers,
} from '@/lib/admin-user-projection';
import type { User } from '@/lib/user-types';

function user(id: string, updatedAt: number): User {
  return {
    id,
    name: id,
    role: 'user',
    status: 'active',
    createdAt: 1,
    updatedAt,
  };
}

describe('admin user projection', () => {
  it('counts project arrays, objects and serialized values safely', () => {
    expect(countProjects([{ id: 'p1' }, { id: 'p2' }])).toBe(2);
    expect(countProjects({ p1: {}, p2: {}, p3: {} })).toBe(3);
    expect(countProjects('[{"id":"p1"}]')).toBe(1);
    expect(countProjects('{"p1":{},"p2":{}}')).toBe(2);
    expect(countProjects('{not-json')).toBe(0);
    expect(countProjects(null)).toBe(0);
  });

  it('merges authoritative rows without dropping users that have no statistics', () => {
    const result = projectAdminUsers({
      users: [user('a', 100), user('b', 120)],
      creditRows: [{ user_id: 'a', balance: '403' }],
      projectRows: [
        { user_id: 'a', data_value: '[{"id":"p1"}]', updated_at: 200 },
        { user_id: 'b', data_value: { p1: {}, p2: {} }, updated_at: 150 },
      ],
      activityRows: [{ user_id: 'a', last_activity: 300 }],
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: 'a',
        credits: 403,
        project_count: 1,
        last_login: 300,
      }),
      expect.objectContaining({
        id: 'b',
        credits: 0,
        project_count: 2,
        last_login: 150,
      }),
    ]);
  });

  it('omits last_login when no valid activity timestamp exists', () => {
    const [result] = projectAdminUsers({
      users: [user('a', 0)],
      creditRows: [{ user_id: 'a', balance: 'not-a-number' }],
      projectRows: [{ user_id: 'a', data_value: [], updated_at: 'invalid' }],
      activityRows: [{ user_id: 'a', last_activity: null }],
    });

    expect(result).toMatchObject({ id: 'a', credits: 0, project_count: 0 });
    expect(result).not.toHaveProperty('last_login');
  });
});
