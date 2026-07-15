import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), 'src', 'app', 'api');
const imageTo3D = readFileSync(resolve(root, 'image-to-3d', 'route.ts'), 'utf8');
const pollTask = readFileSync(resolve(root, 'poll-3d-task', 'route.ts'), 'utf8');

describe('image-to-3d server performance wiring', () => {
  it('fails explicitly when no real 3D task is accepted instead of returning a placeholder asset', () => {
    expect(imageTo3D).toContain('3D provider did not accept the task');
    expect(imageTo3D).not.toContain("note: 'No live 3D API response yet; generated a configurable task preview.'");
  });

  it('bounds external submission, Tripo upload and status polling requests', () => {
    expect(imageTo3D).toContain('THREE_D_SUBMISSION_TIMEOUT_MS');
    expect(imageTo3D).toContain('TRIPO_UPLOAD_TIMEOUT_MS');
    expect(imageTo3D).toContain('TRIPO_UPLOAD_CONCURRENCY');
    expect(pollTask).toContain('THREE_D_POLL_REQUEST_TIMEOUT_MS');
  });
});
