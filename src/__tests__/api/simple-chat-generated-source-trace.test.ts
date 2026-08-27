import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/simple-chat/chat/route.ts'),
  'utf8',
);

describe('simple chat generated image source trace', () => {
  it('emits actual generation execution identity in registered and projected image references', () => {
    const sendGeneratedImage = routeSource.slice(
      routeSource.indexOf('const sendGeneratedImage'),
      routeSource.indexOf('\n      try {', routeSource.indexOf('const sendGeneratedImage')),
    );

    expect(sendGeneratedImage).toMatch(/const sourceTrace:\s*WorkspaceSourceTrace\s*=\s*\{/);
    expect(sendGeneratedImage).toMatch(/source:\s*['"]simple-chat['"]/);
    expect(sendGeneratedImage).toMatch(/chatProjectId:\s*body\.projectId/);
    expect(sendGeneratedImage).toMatch(/chatTaskId:\s*body\.taskId/);
    expect(sendGeneratedImage).toMatch(/messageId:\s*body\.responseMessageId/);
    expect(sendGeneratedImage).toMatch(/modelId:\s*imageModel/);
    expect(sendGeneratedImage).toMatch(/providerId:\s*imageProviderId/);
    expect(sendGeneratedImage).toMatch(/authoritativeTaskId\s*\?\s*\{ generationTaskIds:\s*\[authoritativeTaskId\] \}/);
    expect(sendGeneratedImage).toMatch(/createdAt:\s*new Date\(\)\.toISOString\(\)/);
    expect(sendGeneratedImage).toMatch(/registerStandaloneChatAsset\([\s\S]*?sourceTrace/);
    expect(sendGeneratedImage).toMatch(/imageRef\s*=\s*\{[\s\S]*?\.\.\.reference,[\s\S]*?sourceTrace/);
    expect(sendGeneratedImage).toMatch(/type:\s*['"]image['"][\s\S]*?imageRef/);
  });

  it('stores generated provenance only under placement sourceTrace metadata', () => {
    const registerAsset = routeSource.slice(
      routeSource.indexOf('async function registerStandaloneChatAsset'),
      routeSource.indexOf('\nfunction assetRegistrationError'),
    );

    expect(registerAsset).toMatch(/placement:\s*\{[\s\S]*?metadata:\s*\{[\s\S]*?sourceTrace/);
    expect(registerAsset).toMatch(/return\s*\{[\s\S]*?sourceTrace/);
  });
});
