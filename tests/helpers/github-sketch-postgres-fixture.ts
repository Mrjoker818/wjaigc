import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { platform } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { requireOfflineBridgeTestMediaRoot } from './offline-bridge-media-guard';
import type { QueryFn } from './postgres-test-database';

const database = 'wujie_bridge_test_ci';
const username = 'postgres';
const port = '5432';
const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/${database}`;
const aliases = ['DATABASE_URL', 'PGDATABASE_URL', 'POSTGRES_TEST_DATABASE_URL', 'TEST_POSTGRES_URL'];

export interface GitHubSketchPostgresFixture {
  databaseUrl: string;
  mediaRoot: string;
  containerId: string;
  network: string;
}

function requireGitHubProof(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(`GitHub sketch PostgreSQL fixture proof required (${detail})`);
}

export function readGitHubSketchPostgresFixture(
  env: NodeJS.ProcessEnv = process.env,
): GitHubSketchPostgresFixture | undefined {
  const workflow = env.GITHUB_JOB === 'unit-and-integration-tests' ? 'quality.yml'
    : env.GITHUB_JOB === 'stage-1-automated-tests' ? 'stage-0-quality.yml' : undefined;
  const expectedJob = env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY?.toLowerCase() === 'mrjoker818/wjaigc'
    && workflow && env.GITHUB_WORKFLOW_REF?.startsWith(`${env.GITHUB_REPOSITORY}/.github/workflows/${workflow}@refs/`);
  const containerId = env.WUJIE_CI_SKETCH_POSTGRES_CONTAINER;
  const network = env.WUJIE_CI_SKETCH_POSTGRES_NETWORK;
  if (!expectedJob && containerId === undefined && network === undefined) return undefined;

  requireGitHubProof(expectedJob && env.RUNNER_ENVIRONMENT === 'github-hosted' && platform() === 'linux', 'workflow job');
  requireGitHubProof(containerId && /^[a-f0-9]{64}$/.test(containerId)
    && network && /^github_network_[a-f0-9]{32}$/.test(network), 'job service context');
  requireGitHubProof(env.TASK6_OWNED_FIXTURE_RECEIPT === undefined && env.TASK6_OWNED_FIXTURE_SHA256 === undefined
    && env.SKETCH_TOKEN_OWNED_FIXTURE === undefined, 'conflicting historical fixture');
  requireGitHubProof(aliases.every(key => env[key] === databaseUrl) && env.PGOPTIONS === undefined, 'database aliases');

  const temporary = env.RUNNER_TEMP;
  requireGitHubProof(temporary && isAbsolute(temporary) && realpathSync(temporary) === temporary, 'runner temp');
  const mediaRoot = join(temporary, 'wujie-bridge-test-ci');
  requireGitHubProof(env.WUJIE_DATA_DIR === mediaRoot
    && requireOfflineBridgeTestMediaRoot(mediaRoot) === mediaRoot
    && realpathSync(mediaRoot) === mediaRoot, 'media root');
  const exportsDir = join(mediaRoot, 'exports');
  requireGitHubProof(lstatSync(exportsDir).isDirectory() && realpathSync(exportsDir) === exportsDir, 'media exports');
  return { databaseUrl, mediaRoot, containerId, network };
}

interface ServerIdentity {
  database: string;
  username: string;
  port: string;
  data_directory: string;
  system_identifier: string;
  postmaster_started_at: string;
}

const identitySql = `SELECT current_database() AS database, current_user AS username,
  current_setting('port') AS port, current_setting('data_directory') AS data_directory,
  (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_identifier,
  EXTRACT(EPOCH FROM pg_catalog.pg_postmaster_start_time())::text AS postmaster_started_at`;

interface ServiceContainer {
  Id: string;
  Config: { Image: string };
  State: { Running: boolean };
  Mounts: { Type: string; Name?: string; Destination: string; RW: boolean }[];
  NetworkSettings: {
    Networks: Record<string, { IPAddress: string; Aliases: string[] }>;
    Ports: Record<string, { HostIp: string; HostPort: string }[]>;
  };
}

function docker(args: string[]): string {
  const result = spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {
    encoding: 'utf8', timeout: 5_000,
  });
  requireGitHubProof(result.status === 0 && !result.error, `Docker ${args[0]}`);
  return result.stdout;
}

// The expected identity comes from the workflow's service container, independently of the TCP URL.
function inspectService(fixture: GitHubSketchPostgresFixture): { identity: ServerIdentity; address: string } {
  const [service] = JSON.parse(docker(['inspect', '--type=container', fixture.containerId])) as ServiceContainer[];
  requireGitHubProof(service?.Id === fixture.containerId && service.Config?.Image === 'postgres:16-alpine'
    && service.State?.Running, 'dedicated PostgreSQL container');
  const networks = service.NetworkSettings?.Networks;
  const attachment = networks?.[fixture.network];
  requireGitHubProof(attachment?.Aliases?.includes('postgres') && isIPv4(attachment.IPAddress)
    && Object.keys(networks).length === 1, 'dedicated container network');
  requireGitHubProof(isDeepStrictEqual(service.NetworkSettings.Ports, {
    '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: port }],
  }), 'loopback port mapping');
  const [mount] = service.Mounts ?? [];
  requireGitHubProof(service.Mounts?.length === 1 && mount?.Type === 'volume' && mount.RW
    && isAbsolute(mount.Destination) && /^[a-f0-9]{64}$/.test(mount.Name ?? ''), 'disposable data volume');

  const identity = JSON.parse(docker(['exec', '--user=postgres', fixture.containerId, 'psql',
    '-XwAt', '-h', '/var/run/postgresql', '-p', port, '-U', username, '-d', database,
    '-v', 'ON_ERROR_STOP=1', '-c', `SELECT row_to_json(service) FROM (${identitySql}) AS service`,
  ])) as ServerIdentity;
  requireGitHubProof(identity?.database === database && identity.username === username && identity.port === port
    && identity.data_directory === mount.Destination && /^\d+$/.test(identity.system_identifier)
    && /^\d+\.\d{6}$/.test(identity.postmaster_started_at), 'in-container database identity');
  return { identity, address: attachment.IPAddress };
}

let serviceProof: { containerId: string; network: string; expected: ReturnType<typeof inspectService> } | undefined;

export function prepareGitHubSketchPostgres(fixture: GitHubSketchPostgresFixture): (query: QueryFn) => Promise<void> {
  if (serviceProof?.containerId !== fixture.containerId || serviceProof.network !== fixture.network) {
    serviceProof = { containerId: fixture.containerId, network: fixture.network, expected: inspectService(fixture) };
  }
  const expected = serviceProof.expected;
  // An exclusive write in the verified exports directory proves the media path is usable.
  const probe = join(fixture.mediaRoot, 'exports', `.owned-sketch-${randomUUID()}`);
  writeFileSync(probe, 'GitHub sketch media fixture\n', { flag: 'wx', mode: 0o600 });
  unlinkSync(probe);

  return async query => {
    const row = (await query<ServerIdentity & { address: string }>(
      `${identitySql}, host(inet_server_addr()) AS address`,
    )).rows[0];
    requireGitHubProof(row, 'missing live database identity');
    const { address, ...identity } = row;
    requireGitHubProof(address === expected.address && isDeepStrictEqual(identity, expected.identity), 'live database identity');
  };
}
