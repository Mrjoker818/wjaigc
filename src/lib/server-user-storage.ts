import 'server-only';

import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { getServerUsersDir } from './server-data-root';

function safeUserId(userId: string): string {
  return /^[a-zA-Z0-9_-]+$/.test(userId) ? userId : 'anonymous';
}

export function getUserDataDir(userId?: string): string {
  return path.join(getServerUsersDir(), safeUserId(userId || 'anonymous'));
}

export async function ensureUserDataDirs(userId?: string): Promise<string> {
  const userDir = getUserDataDir(userId);
  await Promise.all([
    mkdir(path.join(userDir, 'images'), { recursive: true }),
    mkdir(path.join(userDir, 'videos'), { recursive: true }),
    mkdir(path.join(userDir, '3d'), { recursive: true }),
    mkdir(path.join(userDir, 'chat'), { recursive: true }),
    mkdir(path.join(userDir, 'projects'), { recursive: true }),
    mkdir(path.join(userDir, 'uploads'), { recursive: true }),
    mkdir(path.join(userDir, 'layers'), { recursive: true }),
    mkdir(path.join(userDir, 'exports'), { recursive: true }),
  ]);
  await writeFile(
    path.join(userDir, '.wujie-user.json'),
    JSON.stringify({ userId: safeUserId(userId || 'anonymous'), updatedAt: Date.now() }, null, 2),
    'utf8',
  ).catch(() => undefined);
  return userDir;
}

export async function appendUserJsonl(userId: string | undefined, area: 'images' | 'chat' | 'projects' | 'uploads' | 'layers' | 'exports' | '3d', payload: unknown): Promise<void> {
  const userDir = await ensureUserDataDirs(userId);
  const file = path.join(userDir, area, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  await writeFile(file, `${JSON.stringify({ at: Date.now(), payload })}\n`, { flag: 'a' });
}
