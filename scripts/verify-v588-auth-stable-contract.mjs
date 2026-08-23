import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const FIXED_STABLE_REF = '52f7c601ed150769e15d06fb435c6e360e28c9e7';
const STABLE_SOURCE_PATH = 'src/lib/server-auth.ts';
const COMMAND = 'node scripts/verify-v588-auth-stable-contract.mjs';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment input: ${name}`);
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function git(...args) {
  return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8' }).trim();
}

function roleInput(role) {
  const prefix = role === 'admin' ? 'E2E_ADMIN' : 'E2E_USER';
  return {
    role,
    id: required(`${prefix}_ID`),
    name: required(`${prefix}_USERNAME`),
    password: required(`${prefix}_PASSWORD`),
  };
}

async function main() {
  const stableRef = required('V588_STABLE_REF');
  if (stableRef !== FIXED_STABLE_REF) {
    throw new Error('V588_STABLE_REF does not match the fixed reviewed stable ref');
  }
  const resolvedRef = git('rev-parse', `${stableRef}^{commit}`);
  if (resolvedRef !== FIXED_STABLE_REF) throw new Error('The fixed stable ref resolved to an unexpected commit');

  const stableBlob = git('rev-parse', `${stableRef}:${STABLE_SOURCE_PATH}`);
  const stableSource = git('show', `${stableRef}:${STABLE_SOURCE_PATH}`);
  const algorithmPattern = /crypto\.createHash\('sha256'\)\.update\(`\$\{secret\}:\$\{password\}`\)\.digest\('hex'\)/;
  if (!algorithmPattern.test(stableSource)) {
    throw new Error('The fixed stable source no longer contains the reviewed legacy password algorithm');
  }

  const fixturePath = required('V588_FIXTURE_PATH');
  const outputPath = required('V588_STABLE_OUTPUT_PATH');
  const authSecret = required('WUJIE_AUTH_SECRET');
  const before = await readFile(fixturePath);
  const fixture = JSON.parse(before.toString('utf8'));
  const users = Array.isArray(fixture?.users) ? fixture.users : [];
  const roles = [roleInput('admin'), roleInput('user')].map(input => {
    const user = users.find(candidate => candidate?.id === input.id && candidate?.name === input.name);
    const expectedLegacyHash = sha256(`${authSecret}:${input.password}`);
    return {
      role: input.role,
      userFoundByFixtureIdentity: Boolean(user),
      legacyPasswordHashVerified: Boolean(user) && user.passwordHash === expectedLegacyHash,
      credentialHashStillPresent: Boolean(user)
        && typeof user.credentialHash === 'string'
        && /^scrypt-v1\$32768\$8\$1\$/.test(user.credentialHash),
    };
  });
  const after = await readFile(fixturePath);
  const helperSource = await readFile(fileURLToPath(import.meta.url));
  const passed = roles.every(role => (
    role.userFoundByFixtureIdentity
    && role.legacyPasswordHashVerified
    && role.credentialHashStillPresent
  )) && sha256(before) === sha256(after);
  const result = {
    schemaVersion: 1,
    result: passed ? 'PASS' : 'FAIL',
    evidenceType: 'non-browser/file-only/read-only stable legacy credential contract',
    browserEvidence: false,
    databaseEvidence: false,
    command: COMMAND,
    requiredEnvironment: [
      'V588_STABLE_REF',
      'V588_FIXTURE_PATH',
      'V588_STABLE_OUTPUT_PATH',
      'WUJIE_AUTH_SECRET',
      'E2E_ADMIN_ID',
      'E2E_ADMIN_USERNAME',
      'E2E_ADMIN_PASSWORD',
      'E2E_USER_ID',
      'E2E_USER_USERNAME',
      'E2E_USER_PASSWORD',
    ],
    helperPath: 'scripts/verify-v588-auth-stable-contract.mjs',
    helperSha256: sha256(helperSource),
    stableRef,
    stableSourcePath: STABLE_SOURCE_PATH,
    stableBlob,
    stableSourceSha256: sha256(stableSource),
    fixturePathSource: 'V588_FIXTURE_PATH',
    fixtureBeforeSha256: sha256(before),
    fixtureAfterSha256: sha256(after),
    fixtureUnchanged: sha256(before) === sha256(after),
    roles,
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (!passed) throw new Error('Stable read-only credential contract failed');
  process.stdout.write('Stable read-only credential contract: PASS (2 roles, fixture unchanged).\n');
}

main().catch(error => {
  process.stderr.write(`Stable read-only credential contract: FAIL (${error instanceof Error ? error.message : 'unknown error'}).\n`);
  process.exitCode = 1;
});
