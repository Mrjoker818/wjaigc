import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('simple chat image submission', () => {
  const route = read('src/app/api/simple-chat/chat/route.ts');
  const pollTask = read('src/app/api/poll-task/route.ts');

  it('forwards the session cookie because poll-task only submits for cookie users', () => {
    // poll-task resumes the real provider submission only when getSessionUser (cookie) resolves.
    expect(pollTask).toMatch(/\(!registryTask \|\| shouldResumeExistingAsync\) && sessionUser/);
    expect(route).toMatch(/request\.headers\.get\('cookie'\)/);
    expect(route).toMatch(/cookie: sessionCookie/);
  });

  it('sends the generate fields that /api/generate reads', () => {
    expect(route).toContain("getInternalApiUrl('/api/generate')");
    // Ratio / resolution / quality are fitted to the selected model's spec before submission.
    expect(route).toContain('aspectRatio: fitted.aspectRatio');
    expect(route).toContain('resolution: fitted.resolution');
    // Passing the chat model's description lets /api/generate skip its own vision pass.
    expect(route).toContain('referenceDescriptions: [referenceDescription]');
    expect(route).toContain('submitOnly: true');
    expect(route).toContain("getInternalApiUrl('/api/poll-task')");
  });
});

describe('simple chat input layout', () => {
  const chatArea = read('src/components/simple-chat/chat-area.tsx');

  it('keeps the toolbar out of the text area so text cannot run under icons', () => {
    expect(chatArea).not.toContain('absolute right-2 bottom-2 flex items-center gap-1');
    expect(chatArea).toContain('min-h-[88px]');
  });
});
