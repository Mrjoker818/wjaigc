import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import {
  classifyFailedRequest,
  createExpectedConsoleRegistry,
  createExpectedResponseRegistry,
  createRunArtifactManifest,
  sanitizePlaywrightTrace,
  scanArtifactsForSecrets,
  secretVariants,
  validateAuthenticatedSessionPayload,
} from '../../../tests/helpers/v588-auth-task-9';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'v588-auth-hardening-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('V588-AUTH-001 Task 9 hardening contracts', () => {
  it('requires exact id, name, and role in an authenticated session payload', () => {
    const expected = { id: 'fixture-id', name: 'fixture-name', role: 'admin' as const };
    expect(validateAuthenticatedSessionPayload({
      success: true,
      user: expected,
    }, expected)).toBe(true);
    expect(validateAuthenticatedSessionPayload({
      success: true,
      user: { ...expected, id: 'other-id' },
    }, expected)).toBe(false);
    expect(validateAuthenticatedSessionPayload({
      success: true,
      user: { ...expected, role: 'user' },
    }, expected)).toBe(false);
  });

  it('matches an expected failure by request identity exactly once', () => {
    const registry = createExpectedResponseRegistry<object>();
    const expectedRequest = {};
    const duplicateSignatureRequest = {};
    const token = registry.expect(expectedRequest, {
      method: 'POST',
      path: '/api/auth/login',
      status: 401,
      stage: 'wrong-password',
    });

    expect(registry.consume(expectedRequest)?.token).toBe(token);
    expect(registry.consume(expectedRequest)).toBeNull();
    expect(registry.consume(duplicateSignatureRequest)).toBeNull();
  });

  it('consumes one late stage-less 401 console entry per expected response token', () => {
    const registry = createExpectedConsoleRegistry([{
      method: 'POST',
      path: '/api/auth/login',
      status: 401,
      stage: 'wrong-password',
      token: 'expected-response-token',
    }]);
    const lateConsole = {
      type: 'error',
      text: 'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
      locationPath: '/api/auth/login',
      stage: null,
    } as const;

    expect(registry.consume(lateConsole)).toBe('expected-response-token');
    expect(registry.consume(lateConsole)).toBeNull();
    expect(registry.remainingTokens()).toEqual([]);
  });

  it('never classifies an authentication request failure as a navigation abort', () => {
    expect(classifyFailedRequest({
      path: '/api/session',
      failure: 'net::ERR_ABORTED',
      navigationStage: 'dashboard-refresh',
    })).toBe('unexpected');
    expect(classifyFailedRequest({
      path: '/api/auth/logout',
      failure: 'Load request cancelled',
      navigationStage: 'logout',
    })).toBe('unexpected');
    expect(classifyFailedRequest({
      path: '/api/user-data/sync',
      failure: 'net::ERR_ABORTED',
      navigationStage: 'canvas-navigation',
    })).toBe('navigation-abort');
    expect(classifyFailedRequest({
      path: '/api/user-data/sync',
      failure: 'net::ERR_ABORTED',
      navigationStage: null,
    })).toBe('unexpected');
  });

  it('sanitizes raw, URL-encoded, and base64 credentials while preserving a readable trace zip', async () => {
    const directory = await temporaryDirectory();
    const tracePath = join(directory, 'trace.zip');
    const username = 'fixture user';
    const password = 'correct/password';
    const wrongPassword = `${password}-incorrect`;
    const archive = new JSZip();
    archive.file('trace.trace', JSON.stringify({ username, password, wrongPassword }));
    archive.file('network', `${encodeURIComponent(username)} ${Buffer.from(password).toString('base64')}`);
    await writeFile(tracePath, await archive.generateAsync({ type: 'nodebuffer' }));

    await sanitizePlaywrightTrace(tracePath, [username, password, wrongPassword]);

    const reopened = await JSZip.loadAsync(await readFile(tracePath));
    const trace = await reopened.file('trace.trace')!.async('string');
    const network = await reopened.file('network')!.async('string');
    for (const variant of secretVariants([username, password, wrongPassword])) {
      expect(trace).not.toContain(variant);
      expect(network).not.toContain(variant);
    }
    expect(trace).toContain('[REDACTED]');
  });

  it('fails a current-run artifact scan when any credential variant remains', async () => {
    const directory = await temporaryDirectory();
    const artifact = join(directory, 'network.json');
    await writeFile(artifact, JSON.stringify({ body: Buffer.from('fixture-secret').toString('base64') }));

    await expect(scanArtifactsForSecrets(directory, ['fixture-secret'])).rejects.toThrow(/credential material/i);
  });

  it('treats Playwright Markdown error context as a scanned text artifact', async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, 'error-context.md'), 'input value: fixture-secret');

    await expect(scanArtifactsForSecrets(directory, ['fixture-secret'])).rejects.toThrow(/error-context\.md/);
  });

  it('writes a run-scoped manifest with project, role, retry, metadata, and checksum', async () => {
    const directory = await temporaryDirectory();
    const artifact = join(directory, 'console', 'run-1__chromium__admin__retry-0.json');
    await writeFile(artifact, '{}', { encoding: 'utf8', flag: 'wx' }).catch(async error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(directory, 'console'), { recursive: true });
      await writeFile(artifact, '{}', 'utf8');
    });

    const manifest = await createRunArtifactManifest(directory, 'run-1');
    expect(manifest.runId).toBe('run-1');
    expect(manifest.artifacts).toHaveLength(1);
    expect(manifest.artifacts[0]).toMatchObject({
      project: 'chromium',
      role: 'admin',
      retry: 0,
      path: 'console/run-1__chromium__admin__retry-0.json',
      size: (await stat(artifact)).size,
    });
    expect(manifest.artifacts[0].mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(manifest.artifacts[0].checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('replays the fixed stable legacy algorithm without modifying the migrated fixture', async () => {
    const directory = await temporaryDirectory();
    const fixturePath = join(directory, 'users.json');
    const outputPath = join(directory, 'stable-contract.json');
    const secret = 'fixture-auth-secret-with-at-least-32-bytes';
    const users = [
      { role: 'admin', id: 'admin-id', name: 'admin-name', password: 'admin-password' },
      { role: 'user', id: 'user-id', name: 'user-name', password: 'user-password' },
    ];
    await writeFile(fixturePath, JSON.stringify({ users: users.map(user => ({
      id: user.id,
      name: user.name,
      role: user.role,
      passwordHash: createHash('sha256').update(`${secret}:${user.password}`).digest('hex'),
      credentialHash: `scrypt-v1$32768$8$1$${'a'.repeat(32)}$${'b'.repeat(64)}`,
    })) }));
    const before = await readFile(fixturePath);

    execFileSync(process.execPath, ['scripts/verify-v588-auth-stable-contract.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        V588_STABLE_REF: '52f7c601ed150769e15d06fb435c6e360e28c9e7',
        V588_FIXTURE_PATH: fixturePath,
        V588_STABLE_OUTPUT_PATH: outputPath,
        WUJIE_AUTH_SECRET: secret,
        E2E_ADMIN_ID: users[0].id,
        E2E_ADMIN_USERNAME: users[0].name,
        E2E_ADMIN_PASSWORD: users[0].password,
        E2E_USER_ID: users[1].id,
        E2E_USER_USERNAME: users[1].name,
        E2E_USER_PASSWORD: users[1].password,
      },
      stdio: 'pipe',
    });

    const result = JSON.parse(await readFile(outputPath, 'utf8'));
    expect(result).toMatchObject({
      result: 'PASS',
      stableRef: '52f7c601ed150769e15d06fb435c6e360e28c9e7',
      stableBlob: '839455ef7a9d5f0362bdcc1dbd4ff6bb7dbdeb6e',
      fixtureUnchanged: true,
      browserEvidence: false,
      databaseEvidence: false,
    });
    expect(result.helperSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.roles).toEqual([
      expect.objectContaining({ role: 'admin', legacyPasswordHashVerified: true, credentialHashStillPresent: true }),
      expect.objectContaining({ role: 'user', legacyPasswordHashVerified: true, credentialHashStillPresent: true }),
    ]);
    expect(await readFile(fixturePath)).toEqual(before);
  });

  it('binds every successful login and reload to a server session assertion in both specs', async () => {
    const [strictSource, p0Source] = await Promise.all([
      readFile(join(process.cwd(), 'tests/e2e/v588-auth-001-session.spec.ts'), 'utf8'),
      readFile(join(process.cwd(), 'tests/e2e/p0-auth-session.spec.ts'), 'utf8'),
    ]);
    expect(strictSource).toContain('waitForAuthenticatedSessionForAction');
    expect(p0Source).toContain('waitForAuthenticatedSessionForAction');
    const helperSource = await readFile(join(process.cwd(), 'tests/helpers/v588-auth-task-9.ts'), 'utf8');
    expect(helperSource).toContain('request.timing().startTime >= actionStartedAt');
    expect(helperSource).toContain('actionStartedAt = Date.now()');
    expect(helperSource).toContain('page.waitForResponse');
    expect(helperSource).toContain('Promise.all([');
    expect(strictSource).not.toContain('expectedNetworkSignatures');
    expect(p0Source).not.toContain('Body was discarded by browser');
  });
});
