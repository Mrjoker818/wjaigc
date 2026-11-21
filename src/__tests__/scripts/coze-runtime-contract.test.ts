import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const evidence = path.resolve('output/canvas-chat-audit/ci-20261121/coze-runtime-contract');
const scripts = ['coze-start.sh', 'coze-preview-build.sh', 'coze-deploy-build.sh'] as const;
type Script = typeof scripts[number];
const tree = '1234567890123456789012345678901234567890';
const dbKeys = /^(PG|DATABASE|POSTGRES|TEST_POSTGRES|COZE_SUPABASE)|^WUJIE_.*DB|^WUJIE_AUTH_PERSISTENCE_MODE$/;
const inheritedDbKeys = Object.keys(process.env).filter(key => dbKeys.test(key));

const next = `#!/usr/bin/env bash
printf 'next' >> events.log
printf ' <%s>' "$@" >> events.log
printf ' deploy_db=%s auth=%s\\n' "\${WUJIE_DEPLOYMENT_DB_ONLY:-unset}" "\${WUJIE_AUTH_PERSISTENCE_MODE:-unset}" >> events.log
if [ -f .next/lock ]; then echo 'VIOLATION: start during build lock' >&2; exit 94; fi
echo 'fixture server started'
`;
const pnpm = `#!/usr/bin/env bash
printf 'pnpm' >> events.log; printf ' <%s>' "$@" >> events.log; printf '\\n' >> events.log
if [ "$1" = install ]; then
  if [ "\${FIXTURE_FAIL_ALL_INSTALLS:-0}" = 1 ]; then exit 31; fi
  if [ "\${FIXTURE_FAIL_FIRST_INSTALL:-0}" = 1 ] && [[ " $* " != *' --ignore-scripts '* ]]; then exit 32; fi
  mkdir -p node_modules/.bin
  cp fake-next node_modules/.bin/next; chmod +x node_modules/.bin/next
  exit 0
fi
if [ "$1" = run ] && { [ "$2" = build ] || [ "$2" = build:coze ]; }; then
  if [ -f .next/lock ]; then echo 'VIOLATION: concurrent build' >&2; exit 95; fi
  mkdir -p .next
  printf '%s\\n' "\${FIXTURE_BUILD_TREE:-${tree}}" > .next/BUILD_ID
  if [ "\${FIXTURE_NO_SEAL:-0}" != 1 ]; then cp .next/BUILD_ID .next/WUJIE_BUILD_COMPLETE; fi
  exit 0
fi
echo 'VIOLATION: unexpected pnpm command' >&2; exit 96
`;
const git = `#!/usr/bin/env bash
printf 'git' >> events.log; printf ' <%s>' "$@" >> events.log; printf '\\n' >> events.log
case "$*" in
  'rev-parse --is-inside-work-tree') [ "\${FIXTURE_GIT:-absent}" != absent ] ;;
  'status --porcelain --untracked-files=normal') if [ "\${FIXTURE_GIT:-absent}" = dirty ]; then echo ' M fixture'; fi ;;
  'rev-parse HEAD^{tree}') echo '${tree}' ;;
  *) echo 'VIOLATION: unexpected Git operation' >&2; exit 97 ;;
esac
`;

function executable(file: string, content: string) {
  writeFileSync(file, content); chmodSync(file, 0o755);
}

interface Options {
  env?: Record<string, string | undefined>;
  deployment?: boolean;
  artifact?: 'none' | 'packaged' | 'matching' | 'stale' | 'unsealed';
  missingNext?: boolean;
  locked?: boolean;
}
function run(script: Script, options: Options = {}) {
  expect(inheritedDbKeys, 'Use the offline launcher; inherited DB bindings must be cleared').toEqual([]);
  const root = mkdtempSync(path.join(evidence, 'fixture-'));
  for (const dir of ['scripts', 'fake-bin', '.next', 'node_modules/.bin']) mkdirSync(path.join(root, dir), { recursive: true });
  for (const name of scripts) {
    writeFileSync(path.join(root, 'scripts', name), readFileSync(path.resolve('scripts', name), 'utf8').replace(/\r\n/g, '\n'));
  }
  executable(path.join(root, 'fake-next'), next);
  if (!options.missingNext) executable(path.join(root, 'node_modules/.bin/next'), next);
  executable(path.join(root, 'fake-bin/pnpm'), pnpm);
  executable(path.join(root, 'fake-bin/git'), git);
  executable(path.join(root, 'fake-bin/node'), '#!/usr/bin/env bash\nprintf "node" >> events.log; printf " <%s>" "$@" >> events.log; printf "\\n" >> events.log\n');
  executable(path.join(root, 'fake-bin/uname'), '#!/usr/bin/env bash\necho FixtureOS\n');
  executable(path.join(root, 'fake-bin/seq'), '#!/usr/bin/env bash\necho 1\n');
  executable(path.join(root, 'fake-bin/sleep'), '#!/usr/bin/env bash\necho sleep >> events.log\nif [ "${FIXTURE_RELEASE_LOCK:-0}" = 1 ]; then rm -f .next/lock; fi\n');
  const artifact = options.artifact ?? 'packaged';
  if (artifact !== 'none') {
    writeFileSync(path.join(root, '.next/BUILD_ID'), artifact === 'packaged' ? 'packaged\n' : artifact === 'stale' ? 'old-tree\n' : `${tree}\n`);
    if (artifact === 'matching') writeFileSync(path.join(root, '.next/WUJIE_BUILD_COMPLETE'), `${tree}\n`);
  }
  if (options.locked) writeFileSync(path.join(root, '.next/lock'), 'owned-by-build\n');
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (dbKeys.test(key) || /^(WUJIE_PRESENCE_ENABLED|WUJIE_YJS_ENABLED|WUJIE_RUN_MIGRATIONS|WUJIE_PREVIEW_ORIGIN|COZE_PROJECT_|NODE_OPTIONS|WUJIE_ADMIN_|WUJIE_BOOTSTRAP_|FIXTURE_)/.test(key)) delete env[key];
  }
  Object.assign(env, { BASH_ENV: '/dev/null', ENV: '/dev/null', COZE_PROJECT_ENV: 'PROD', FIXTURE_GIT: 'absent', PORT: '5000' }, options.env);
  const child = spawnSync(bash, [
    '--noprofile', '--norc', '-c',
    'export PATH="$PWD/fake-bin:/usr/bin:/bin"; exec /bin/bash "$@"',
    'isolated-coze-contract', `scripts/${script}`, ...(options.deployment ? ['--deployment'] : []),
  ], { cwd: root, env, encoding: 'utf8', timeout: 30_000, windowsHide: true });
  if (child.error) throw child.error;
  const events = existsSync(path.join(root, 'events.log')) ? readFileSync(path.join(root, 'events.log'), 'utf8').trim().split('\n') : [];
  const output = child.stdout + child.stderr;
  writeFileSync(path.join(root, 'result.json'), JSON.stringify({ status: child.status, output, events }, null, 2));
  expect(output).not.toContain('VIOLATION:');
  return { status: child.status, output, events, root, paid: events.filter(line => /^(pnpm|node|next)\b/.test(line)) };
}

beforeAll(() => mkdirSync(evidence, { recursive: true }));

describe('Coze deployment requires a PostgreSQL connection source', () => {
  it.each([
    { FIXTURE_GIT: 'absent', COZE_PROJECT_ENV: 'PROD', COZE_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-http-secret' },
    { FIXTURE_GIT: 'clean', COZE_PROJECT_ENV: 'PROD', COZE_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-http-secret' },
    { FIXTURE_GIT: 'clean', COZE_PROJECT_ENV: 'DEV', COZE_SUPABASE_ANON_KEY: 'synthetic-http-secret' },
    { FIXTURE_GIT: 'absent', COZE_PROJECT_ENV: 'DEV', COZE_SUPABASE_ANON_KEY: 'synthetic-http-secret' },
    { FIXTURE_GIT: 'clean', COZE_PROJECT_ENV: 'PROD', COZE_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-http-secret', PGHOST: 'pg.invalid' },
    { FIXTURE_GIT: 'clean', COZE_PROJECT_ENV: 'PROD', COZE_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-http-secret', PGHOST: '   ', PGDATABASE: 'fixture', PGUSER: 'fixture' },
    { FIXTURE_GIT: 'clean', COZE_PROJECT_ENV: 'PROD' },
    { FIXTURE_GIT: 'clean', COZE_PROJECT_ENV: 'PROD', COZE_SUPABASE_URL: '', COZE_SUPABASE_ANON_KEY: 'synthetic-http-secret' },
  ])('stops HTTP-only deployment before any install or server work (case %#)', env => {
    const result = run('coze-start.sh', { deployment: true, missingNext: true,
      env: { COZE_SUPABASE_URL: 'https://synthetic-http.invalid', ...env } });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/HTTP.*PostgreSQL|PostgreSQL.*HTTP/);
    expect(result.output).not.toContain('synthetic-http-secret');
    expect(result.output).not.toContain('synthetic-http.invalid');
    expect(result.output).not.toContain('starting without deployment DB enforcement');
    expect(result.paid).toEqual([]);
  });

  it.each([
    { DATABASE_URL: 'postgresql://synthetic-user:synthetic-pg-secret@pg.invalid/db' },
    { PGDATABASE_URL: 'postgresql://synthetic-user:synthetic-pg-secret@pg.invalid/db' },
    { PGHOST: 'pg.invalid', PGDATABASE: 'fixture', PGUSER: 'fixture', PGPASSWORD: 'synthetic-pg-secret' },
    { PGHOST: 'pg.invalid', PGDATABASE: 'fixture', PGUSER: 'fixture', PGPORT: '5433' },
    { DATABASE_URL: 'postgresql://synthetic-user:synthetic-pg-secret@pg.invalid/db', COZE_SUPABASE_URL: 'https://synthetic-http.invalid', COZE_SUPABASE_ANON_KEY: 'synthetic-http-secret' },
  ])('keeps canonical and complete libpq deployment sources (case %#)', env => {
    const result = run('coze-start.sh', { deployment: true, env });
    expect(result.status).toBe(0);
    expect(result.events).toContain('node <scripts/verify-deploy-package.mjs> <--source>');
    expect(result.events).toContain('next <start> <-p> <5000> <-H> <0.0.0.0> deploy_db=1 auth=DB_ONLY');
    expect(result.events.some(line => line.startsWith('pnpm'))).toBe(false);
    expect(result.output).not.toContain('synthetic-pg-secret');
    expect(result.output).not.toContain('synthetic-http-secret');
  });

  it.each([{ FIXTURE_GIT: 'clean', COZE_PROJECT_ENV: 'PROD' }, { FIXTURE_GIT: 'absent', COZE_PROJECT_ENV: 'DEV' }])(
    'preserves the normal no-DB development/validation exception (%j)', env => {
      const result = run('coze-start.sh', { deployment: true, env });
      expect(result.status).toBe(0);
      expect(result.output).toContain('starting without deployment DB enforcement');
      expect(result.events).toContain('next <start> <-p> <5000> <-H> <0.0.0.0> deploy_db=unset auth=unset');
    },
  );
  it('still refuses a packaged production deployment with no database', () => {
    const result = run('coze-start.sh', { deployment: true, missingNext: true });
    expect(result.status).toBe(1);
    expect(result.paid).toEqual([]);
  });
  it('does not force DB_ONLY on a normal no-DB developer start', () => {
    const result = run('coze-start.sh', { env: { COZE_PROJECT_ENV: 'DEV' } });
    expect(result.status).toBe(0);
    expect(result.events.at(-1)).toContain('deploy_db=unset auth=unset');
  });
});

describe('Coze install retries keep the lock frozen', () => {
  const cases: Array<[Script, Options]> = [
    ['coze-start.sh', { artifact: 'packaged', missingNext: true }],
    ['coze-start.sh', { artifact: 'none', missingNext: true }],
    ['coze-preview-build.sh', { artifact: 'none' }],
    ['coze-deploy-build.sh', { artifact: 'none' }],
  ];
  it.each(cases)('keeps frozen argv through %s %j retry', (script, options) => {
    const result = run(script, { ...options, env: { FIXTURE_FAIL_FIRST_INSTALL: '1' } });
    expect(result.status).toBe(0);
    const installs = result.events.filter(line => line.startsWith('pnpm <install>'));
    expect(installs).toHaveLength(2);
    expect(installs[0]).toBe('pnpm <install> <--frozen-lockfile>');
    expect(installs[1]).toBe('pnpm <install> <--ignore-scripts> <--frozen-lockfile>');
    expect(result.events).toContain('node <scripts/prepare-tools.mjs>');
    expect(result.events).toContain('node <scripts/patch-pg-ssl.js>');
    expect(result.events.some(line => line.includes('<migrate>'))).toBe(false);
    expect(result.events.some(line => line.includes('<build:coze>'))).toBe(script === 'coze-deploy-build.sh');
  });
  it.each(cases)('stops after both installs fail in %s %j', (script, options) => {
    const result = run(script, { ...options, env: { FIXTURE_FAIL_ALL_INSTALLS: '1' } });
    expect(result.status).toBe(31);
    expect(result.events.filter(line => line.startsWith('pnpm <install>'))).toHaveLength(2);
    expect(result.events.some(line => line.startsWith('next') || line.includes('<build>') || line.includes('<build:coze>') || line.includes('<prepare-tools'))).toBe(false);
  });
});

describe('Coze existing build lock and source identity guards', () => {
  it.each(['coze-start.sh', 'coze-preview-build.sh'] as const)('keeps an owned lock and refuses %s on timeout', script => {
    const result = run(script, { locked: true, artifact: 'matching', env: { FIXTURE_GIT: 'clean' } });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/Timed out/);
    expect(existsSync(path.join(result.root, '.next/lock'))).toBe(true);
    expect(result.events).toContain('sleep');
    expect(result.events.some(line => line.startsWith('next') || line.includes('<build>'))).toBe(false);
  });
  it.each(['coze-start.sh', 'coze-preview-build.sh'] as const)('waits and reuses a sealed matching build in %s', script => {
    const result = run(script, { locked: true, artifact: 'matching', env: { FIXTURE_GIT: 'clean', FIXTURE_RELEASE_LOCK: '1' } });
    expect(result.status).toBe(0);
    expect(result.events).toContain('sleep');
    expect(result.events.some(line => line.includes('<build>'))).toBe(false);
    expect(result.events.some(line => line.startsWith('next'))).toBe(script === 'coze-start.sh');
  });
  it.each(['stale', 'unsealed'] as const)('rebuilds a %s artifact before startup', artifact => {
    const result = run('coze-start.sh', { artifact, env: { FIXTURE_GIT: 'clean' } });
    expect(result.status).toBe(0);
    expect(result.events.indexOf('pnpm <run> <build>')).toBeLessThan(result.events.findIndex(line => line.startsWith('next')));
    expect(readFileSync(path.join(result.root, '.next/BUILD_ID'), 'utf8').trim()).toBe(tree);
    expect(readFileSync(path.join(result.root, '.next/WUJIE_BUILD_COMPLETE'), 'utf8').trim()).toBe(tree);
  });
  it.each(['coze-start.sh', 'coze-preview-build.sh'] as const)('refuses a mismatched completed build from %s', script => {
    const result = run(script, { artifact: 'none', env: { FIXTURE_GIT: 'clean', FIXTURE_BUILD_TREE: 'wrong-tree' } });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/does not match clean source tree/);
    expect(result.events.some(line => line.startsWith('next'))).toBe(false);
  });
});
