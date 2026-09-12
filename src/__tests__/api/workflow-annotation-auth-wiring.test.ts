import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/workflow/execute/route.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('workflow annotation internal authentication wiring', () => {
  it('builds signed user headers for every internal workflow API execution path', () => {
    const signedHeaderCalls = source.match(
      /getInternalRequestHeaders\(\s*(?:auth|execState)\.userId!?/g,
    ) || [];

    expect(signedHeaderCalls).toHaveLength(8);
    expect(source).toMatch(
      /const internalHeaders = await getInternalRequestHeaders\(\s*auth\.userId/,
    );
    expect(source).toMatch(
      /const retryHeaders = isInternal\s+\? await getInternalRequestHeaders\(\s*auth\.userId/,
    );
    expect(source).toMatch(
      /const retryHeaders = await getInternalRequestHeaders\(\s*auth\.userId/,
    );
    expect(source).toMatch(
      /const downstreamHeaders = isInternal\s+\? await getInternalRequestHeaders\(\s*execState\.userId!/,
    );
    expect(source).toMatch(
      /const workflowHeaders = isInternalApi\s+\? await getInternalRequestHeaders\(\s*execState\.userId!/,
    );
    expect(source).toMatch(
      /activeSkillRunIds[\s\S]+?getInternalRequestHeaders\(\s*auth\.userId[\s\S]+?cancelWorkflowSkillRun\(\{[\s\S]+?submitUrl: getInternalApiUrl\('\/api\/skill-runs'\)/,
    );
  });

  it('does not send provider bearer credentials to internal workflow APIs', () => {
    expect(source).toMatch(
      /const retryHeaders = isInternal[\s\S]+?: \(apiKey \? \{ 'Authorization': `Bearer \$\{apiKey\}` \} : \{\}\);/,
    );
    expect(source).toMatch(
      /const workflowHeaders = isInternalApi[\s\S]+?: \(apiKey \? \{ 'Authorization': `Bearer \$\{apiKey\}` \} : \{\}\);/,
    );
  });

  it('waits for annotation tasks in normal and retry execution paths', () => {
    expect(source).toContain("'/api/annotations/execute'");
    expect(source).toMatch(
      /if \(isAsyncWorkflowEndpoint\(req\.endpoint\)\)[\s\S]+?executeAsyncTask/,
    );
    expect(source).toMatch(
      /const isAsyncApi = isAsyncWorkflowEndpoint\(req\.endpoint\)/,
    );
  });

  it('allows annotation submission enough time to compile assets and create the edit task', () => {
    expect(source).toMatch(
      /const isGenerateEndpoint = [^\n]+submitUrl\.includes\('\/api\/annotations\/execute'\)/,
    );
  });

  it('reuses signed workflow headers while polling an asynchronous task', () => {
    expect(source).toContain("const pollEndpoint = isThreeDTask ? '/api/poll-3d-task' : '/api/poll-task'");
    expect(source).toMatch(
      /fetch\(`http:\/\/localhost:\$\{port\}\$\{pollEndpoint\}`, \{[\s\S]+?headers: fetchOptions\.headers/,
    );
  });
});
