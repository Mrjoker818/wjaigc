import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const verifier = resolve('scripts/verify-deploy-package.mjs');
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const syntheticValue = 'synthetic-credential-value';
const runtimeEnv = {
  PGDATABASE_URL: 'postgres://synthetic.invalid/db',
  WUJIE_BOOTSTRAP_PROVIDERS_JSON: syntheticValue,
  WUJIE_ADMIN_PASSWORD: syntheticValue,
};
const tempRoot = realpathSync(tmpdir());
let fixture: string;
type FixtureEnv = Partial<NodeJS.ProcessEnv>;

function writeFixture(relativePath: string, content: string) {
  const target = join(fixture, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

function writeExecutable(file: string, lines: string[]) {
  chmodSync(writeFixture(file, ['#!/usr/bin/env bash', ...lines, ''].join('\n')), 0o755);
}

function run(command: string, args: string[], env: FixtureEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: fixture,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env, NODE_ENV: env.NODE_ENV ?? 'test' },
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

function runCoze(script: string, args: string[] = [], env: FixtureEnv = runtimeEnv) {
  mkdirSync(join(fixture, 'scripts'), { recursive: true });
  copyFileSync(resolve('scripts', script), join(fixture, 'scripts', script));
  copyFileSync(verifier, join(fixture, 'scripts/verify-deploy-package.mjs'));
  return runBashFixture(`scripts/${script}`, args, env);
}

function runBashFixture(file: string, args: string[] = [], env: FixtureEnv = {}) {
  return run(bash, [
    '-c', 'PATH="$PWD/fake-bin:$PATH" exec bash "$@"', 'coze-test', file, ...args,
  ], env);
}

function writeTrace(file: string, files: string[] = []) {
  writeFixture(file, JSON.stringify({ version: 1, files }));
}

describe('deployment package guard', () => {
  beforeEach(() => {
    fixture = mkdtempSync(join(tempRoot, 'wujie-deploy-package-'));
  });

  afterEach(() => {
    expect(dirname(realpathSync(fixture))).toBe(tempRoot);
    rmSync(fixture, { recursive: true });
  });

  it.each([
    'deploy-seed/system/api-providers.json',
    'deploy-seed/system/users.json',
    'scripts/export-deploy-seed.mjs',
    'data/system/api-providers.json',
    'data/system/users.json',
    'data/system/auth-secret',
  ])('blocks the retired source path %s', (file) => {
    writeFixture(file, syntheticValue);

    const result = run(process.execPath, [verifier, '--source']);

    expect(result.status).toBe(1);
    expect(result.output).toContain(file);
    expect(result.output).not.toContain(syntheticValue);
  });

  it.each([
    ['.next/next-server.js.nft.json', '../deploy-seed/system/api-providers.json', 'deploy-seed/system/api-providers.json'],
    ['.next/server/instrumentation.js.nft.json', '..\\..\\deploy-seed\\system\\.\\users.json', 'deploy-seed/system/users.json'],
    ['.next/next-minimal-server.js.nft.json', '../data/system/auth-secret', 'data/system/auth-secret'],
    ['.next/server/instrumentation.js.nft.json', '../../data/system/api-providers.json', 'data/system/api-providers.json'],
  ])('blocks a legacy reference in %s even when the source file is absent', (manifest, reference, file) => {
    writeTrace(manifest, [reference]);

    const result = run(process.execPath, [verifier, '--built']);

    expect(result.status).toBe(1);
    expect(result.output).toContain(manifest);
    expect(result.output).toContain(file);
  });

  it.each([
    '.next/standalone/app/deploy-seed/system/users.json',
    'public/deploy-seed/system/api-providers.json',
    '.next/standalone/app/data/system/users.json',
    'public/data/system/auth-secret',
  ])('blocks a copied file at %s even when every trace is clean', (file) => {
    writeTrace('.next/next-server.js.nft.json');
    writeFixture(file, syntheticValue);

    const result = run(process.execPath, [verifier, '--built']);

    expect(result.status).toBe(1);
    expect(result.output).toContain(file);
    expect(result.output).not.toContain(syntheticValue);
  });

  it('reports an invalid NFT manifest without echoing its contents', () => {
    const manifest = '.next/next-server.js.nft.json';
    writeFixture(manifest, `{"files":[${syntheticValue}]}`);

    const result = run(process.execPath, [verifier, '--built']);

    expect(result.status).toBe(1);
    expect(result.output).toContain(manifest);
    expect(result.output).not.toContain(syntheticValue);
  });

  it('rejects build output with no manifests to verify', () => {
    writeFixture('.next/BUILD_ID', 'synthetic-build');

    const result = run(process.execPath, [verifier, '--built']);

    expect(result.status).toBe(1);
    expect(result.output).toContain('No NFT manifests');
  });

  it('accepts a clean package with unrelated system file names', () => {
    mkdirSync(join(fixture, 'deploy-seed/system'), { recursive: true });
    writeTrace('.next/next-server.js.nft.json', ['server/system/users.json', 'server/data/system/settings.json']);
    writeFixture('.next/server/system/users.json', '{}');
    writeFixture('.next/server/data/system/settings.json', '{}');

    expect(run(process.execPath, [verifier, '--source']).status).toBe(0);
    expect(run(process.execPath, [verifier, '--built']).status).toBe(0);
  });

  it('requires both executables and their license in the document upload trace for a Coze media build', () => {
    const manifest = '.next/server/app/api/collaboration/document-assets/upload/route.js.nft.json';
    const bundle = `assets/wujie-coze-media/${process.arch}`;
    const entries = ['ffmpeg', 'ffprobe', 'LICENSE.txt'].map(name => `${bundle}/${name}`);
    const references = entries.map(file => relative(dirname(manifest), file));
    writeTrace(manifest, references.slice(0, 1));
    writeExecutable(entries[0], ['exit 0']);
    writeExecutable(entries[1], ['exit 0']);
    writeFixture(entries[2], 'Synthetic license');

    expect(run(process.execPath, [verifier, '--built', '--coze-media']).output).toContain('trace is missing');

    writeTrace(manifest, references);
    expect(run(process.execPath, [verifier, '--built', '--coze-media']).status).toBe(0);

    rmSync(join(fixture, entries[1]));
    expect(run(process.execPath, [verifier, '--built', '--coze-media']).output).toContain('ffprobe');
  });

  it('prunes the three generated credential paths while retaining neighboring files', () => {
    const manifest = '.next/server/instrumentation.js.nft.json';
    const retained = ['../../data/system/auth-secret.backup', '../../data/system/settings.json'];
    writeTrace(manifest, [
      '../../data/system/users.json',
      '../../data/system/api-providers.json',
      '../../data/system/auth-secret',
      ...retained,
    ]);

    const result = run(process.execPath, [resolve('scripts/prune-build-traces.mjs')]);

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(join(fixture, manifest), 'utf8')).files).toEqual(retained);
  });

  it('fails the Coze deployment build if compilation produces a legacy NFT reference', () => {
    writeExecutable('fake-bin/uname', ['echo Darwin']);
    writeExecutable('fake-bin/pnpm', [
      'if [[ -v WUJIE_BOOTSTRAP_PROVIDERS_JSON || -v WUJIE_ADMIN_PASSWORD ]]; then exit 8; fi',
      'if [ "$*" = "install --frozen-lockfile" ]; then echo synthetic-install; exit 0; fi',
      'if [ "$*" = "run migrate" ] && [[ -v PGDATABASE_URL ]]; then echo synthetic-migrate; exit 0; fi',
      'if [ "$*" != "run build" ]; then exit 2; fi',
      'mkdir -p .next',
      `printf '%s\\n' '{"version":1,"files":["../deploy-seed/system/users.json"]}' > .next/next-server.js.nft.json`,
      'echo synthetic-build-completed',
    ]);

    const result = runCoze('coze-deploy-build.sh');

    expect(result.output).toMatch(/synthetic-install[\s\S]+synthetic-migrate[\s\S]+synthetic-build-completed/);
    expect(result.status).toBe(1);
    expect(result.output).toContain('.next/next-server.js.nft.json');
    expect(result.output).toContain('deploy-seed/system/users.json');
  }, 15_000);

  it('stages Linux tools before building and runs the media package guard', () => {
    const bundle = `assets/wujie-coze-media/${process.arch}`;
    const manifest = '.next/server/app/api/collaboration/document-assets/upload/route.js.nft.json';
    const references = ['ffmpeg', 'ffprobe', 'LICENSE.txt']
      .map(name => relative(dirname(manifest), `${bundle}/${name}`).replaceAll('\\', '/'));
    writeExecutable('fake-bin/uname', ['echo Linux']);
    writeExecutable('scripts/stage-coze-media-tools.sh', [
      `mkdir -p ${bundle}`,
      `printf '%s\\n' '#!/usr/bin/env bash' 'exit 0' | tee ${bundle}/ffmpeg > ${bundle}/ffprobe`,
      `chmod +x ${bundle}/ffmpeg ${bundle}/ffprobe`,
      `printf '%s\\n' 'Synthetic license' > ${bundle}/LICENSE.txt`,
    ]);
    writeExecutable('fake-bin/pnpm', [
      'if [ "$*" = "install --frozen-lockfile" ]; then exit 0; fi',
      '[ "$*" = "run build" ] || exit 2',
      `[ -x ${bundle}/ffmpeg ] && [ -x ${bundle}/ffprobe ] || exit 3`,
      `mkdir -p ${dirname(manifest).replaceAll('\\', '/')}`,
      `printf '%s\\n' '${JSON.stringify({ version: 1, files: references })}' > ${manifest}`,
    ]);

    const result = runCoze('coze-deploy-build.sh', [], {});
    expect(result.status).toBe(0);
    expect(result.output).toContain('Verified Coze media bundle');
  }, 15_000);

  it('rejects an unpinned download before extraction or execution', () => {
    writeExecutable('fake-bin/uname', ['echo x86_64']);
    writeExecutable('fake-bin/curl', [
      'echo "${@: -1}"',
      'while [ "$1" != "--output" ]; do shift; done',
      'printf "%s\\n" wrong-archive > "$2"',
    ]);
    writeExecutable('fake-bin/tar', ['echo unexpected-extraction', 'exit 1']);

    const result = runCoze('stage-coze-media-tools.sh', [], {});
    expect(result.status).toBe(1);
    expect(result.output).toContain('https://bin.ffmpeg.download/btbn_ffmpeg_builds/linux/x86_64/');
    expect(result.output).toContain('SHA-256 mismatch');
    expect(result.output).not.toContain('unexpected-extraction');
  }, 15_000);

  it('falls back to the publisher if the mirror is unavailable and still checks the archive', () => {
    writeExecutable('fake-bin/uname', ['echo x86_64']);
    writeExecutable('fake-bin/curl', [
      'case "${@: -1}" in',
      '  https://bin.ffmpeg.download/*) echo mirror-unavailable; exit 22 ;;',
      '  https://github.com/FFmpeg-Builds/*) echo publisher-download ;;',
      '  *) exit 7 ;;',
      'esac',
      'while [ "$1" != "--output" ]; do shift; done',
      'printf "%s\\n" wrong-archive > "$2"',
    ]);
    writeExecutable('fake-bin/tar', ['echo unexpected-extraction', 'exit 1']);

    const result = runCoze('stage-coze-media-tools.sh', [], {});
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/mirror-unavailable[\s\S]+publisher-download/);
    expect(result.output).toContain('SHA-256 mismatch');
    expect(result.output).not.toContain('unexpected-extraction');
  }, 15_000);

  it.each([false, true])('uses a complete x64 cache only when its digest matches (changed=%s)', (changed) => {
    const bundle = 'assets/wujie-coze-media/x64';
    const script = 'scripts/stage-coze-media-tools.sh';
    let source = readFileSync(resolve(script), 'utf8');
    for (const [name, pin] of [
      ['ffmpeg', 'ffmpeg_sha256'],
      ['ffprobe', 'ffprobe_sha256'],
      ['LICENSE.txt', 'license_sha256'],
    ]) {
      const path = `${bundle}/${name}`;
      if (name === 'LICENSE.txt') writeFixture(path, 'Synthetic license');
      else writeExecutable(path, ['[ "$1" = "-version" ] || exit 1', `touch ran-${name}`]);
      const alternate = writeFixture(`alternate-cache/${path}`, readFileSync(join(fixture, path), 'utf8'));
      if (name !== 'LICENSE.txt') chmodSync(alternate, 0o755);
      const digest = createHash('sha256').update(readFileSync(join(fixture, path))).digest('hex');
      source = source.replace(new RegExp(`${pin}=[a-f0-9]{64}`), `${pin}=${digest}`);
    }
    writeFixture(script, source.replaceAll('\r\n', '\n'));
    if (changed) writeExecutable(`${bundle}/ffprobe`, ['touch ran-changed-tool']);
    writeExecutable('fake-bin/uname', ['echo x86_64']);
    writeExecutable('fake-bin/curl', ['echo download-requested', 'exit 22']);

    const result = runBashFixture(script, [], { CDPATH: 'alternate-cache' });
    expect(result.status).toBe(changed ? 22 : 0);
    if (changed) {
      expect(result.output).toContain('download-requested');
      expect(() => readFileSync(join(fixture, bundle, 'ran-changed-tool'))).toThrow();
      expect(() => readFileSync(join(fixture, bundle, 'ran-ffmpeg'))).toThrow();
    } else {
      expect(result.output).toContain('Reused verified');
      expect(result.output).not.toContain('download-requested');
      expect(readFileSync(join(fixture, bundle, 'ran-ffmpeg'))).toHaveLength(0);
      expect(readFileSync(join(fixture, bundle, 'ran-ffprobe'))).toHaveLength(0);
    }
  }, 15_000);

  it('starts a packaged deployment without NFT manifests', () => {
    writeFixture('.next/BUILD_ID', 'synthetic-build');
    writeExecutable('fake-bin/git', ['exit 1']);
    writeExecutable('node_modules/.bin/next', [
      '[ "${WUJIE_DEPLOYMENT_DB_ONLY:-}" = "1" ] || exit 3',
      '[ "${WUJIE_AUTH_PERSISTENCE_MODE:-}" = "DB_ONLY" ] || exit 4',
      '[[ -v WUJIE_BOOTSTRAP_PROVIDERS_JSON && -v WUJIE_ADMIN_PASSWORD ]] || exit 5',
      'echo synthetic-runtime-started',
    ]);

    const result = runCoze('coze-start.sh', ['--deployment']);

    expect(result.status).toBe(0);
    expect(result.output).toContain('synthetic-runtime-started');
  }, 15_000);

  it.each([
    ['Linux', true, 'bundle'],
    ['Linux', false, 'system'],
    ['Darwin', true, 'system'],
  ])('resolves media tools on %s with a complete bundle=%s', (platform, complete, expected) => {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const bundle = `assets/wujie-coze-media/${process.arch}`;
    writeFixture('.next/BUILD_ID', 'synthetic-build');
    writeExecutable('fake-bin/git', ['exit 1']);
    writeExecutable('fake-bin/uname', [`if [ "$1" = "-s" ]; then echo ${platform}; else echo ${arch}; fi`]);
    for (const tool of ['ffmpeg', 'ffprobe']) {
      writeExecutable(`fake-bin/${tool}`, [`echo system-${tool}`]);
      if (complete || tool === 'ffmpeg') writeExecutable(`${bundle}/${tool}`, [`echo bundle-${tool}`]);
    }
    writeExecutable('node_modules/.bin/next', ['ffmpeg -version', 'ffprobe -version']);

    const result = runCoze('coze-start.sh', ['--deployment']);
    expect(result.status).toBe(0);
    expect(result.output).toContain(`${expected}-ffmpeg\n${expected}-ffprobe`);
  }, 15_000);

  it('blocks a packaged deployment with a generated credential replica at its source path', () => {
    writeFixture('.next/BUILD_ID', 'synthetic-build');
    writeFixture('data/system/auth-secret', syntheticValue);
    writeExecutable('fake-bin/git', ['exit 1']);
    writeExecutable('node_modules/.bin/next', ['echo synthetic-runtime-started']);

    const result = runCoze('coze-start.sh', ['--deployment']);

    expect(result.status).toBe(1);
    expect(result.output).toContain('data/system/auth-secret');
    expect(result.output).not.toContain(syntheticValue);
    expect(result.output).not.toContain('synthetic-runtime-started');
  }, 15_000);

  it('requires a DB URL for deploy while allowing preview without one', () => {
    writeFixture('.next/BUILD_ID', 'synthetic-build');
    writeExecutable('fake-bin/git', ['exit 1']);
    writeExecutable('node_modules/.bin/next', [
      'if [[ -v WUJIE_DEPLOYMENT_DB_ONLY || -v WUJIE_AUTH_PERSISTENCE_MODE ]]; then exit 3; fi',
      'echo synthetic-preview-started',
    ]);

    const deployment = runCoze('coze-start.sh', ['--deployment'], {});
    const preview = runCoze('coze-start.sh', [], {});

    expect(deployment.status).toBe(1);
    expect(deployment.output).toContain('requires DATABASE_URL or PGDATABASE_URL');
    expect(deployment.output).not.toContain('synthetic-preview-started');
    expect(preview.status).toBe(0);
    expect(preview.output).toContain('synthetic-preview-started');
  }, 15_000);

  it('requires verified NFT manifests immediately after a deployment fallback build', () => {
    writeExecutable('fake-bin/git', ['exit 1']);
    writeExecutable('fake-bin/next', ['echo synthetic-runtime-started']);
    writeExecutable('fake-bin/pnpm', [
      'if [[ -v WUJIE_BOOTSTRAP_PROVIDERS_JSON || -v WUJIE_ADMIN_PASSWORD ]]; then exit 8; fi',
      'if [ "$*" = "install --frozen-lockfile" ]; then',
      '  mkdir -p node_modules/.bin',
      '  cp fake-bin/next node_modules/.bin/next',
      '  echo synthetic-install',
      '  exit 0',
      'fi',
      'if [ "$*" != "run build" ]; then exit 2; fi',
      'mkdir -p .next',
      'echo synthetic-build > .next/BUILD_ID',
      'echo synthetic-build-completed',
    ]);

    const result = runCoze('coze-start.sh', ['--deployment']);

    expect(result.output).toMatch(/synthetic-install[\s\S]+synthetic-build-completed/);
    expect(result.status).toBe(1);
    expect(result.output).toContain('No NFT manifests found under .next');
    expect(result.output).not.toContain('synthetic-runtime-started');
  }, 15_000);
});
