import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import net from 'node:net';
import tls from 'node:tls';
import ts from 'typescript';
import YAML from 'yaml';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const aliases = ['DATABASE_URL', 'PGDATABASE_URL', 'POSTGRES_TEST_DATABASE_URL', 'TEST_POSTGRES_URL'] as const;
const probeUrl = 'postgresql://probe:probe-secret@127.0.0.1:60018/wujie_bridge_test_child_probe';
const parent: NodeJS.ProcessEnv = { NODE_ENV: 'test', ...Object.fromEntries(aliases.map(alias => [alias, probeUrl])) };
const workflows = [
  ['.github/workflows/quality.yml', 'unit-and-integration-tests', 'Unit and integration tests'],
  ['.github/workflows/stage-0-quality.yml', 'stage-1-automated-tests', 'Full automated test suite'],
] as const;
const file = path.resolve('src/__tests__/scripts/isolated-vitest-workflow.test.ts');
const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let environmentExpression: string | undefined;
function visit(node: ts.Node): void {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'execFileAsync') {
    const options = node.arguments[2];
    if (!options || !ts.isObjectLiteralExpression(options)) throw new Error('Missing real execFileAsync options');
    const property = options.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(source) === 'env');
    if (!property || !ts.isPropertyAssignment(property)) throw new Error('Missing real execFileAsync environment');
    environmentExpression = property.initializer.getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
if (!environmentExpression) throw new Error('Missing actual shard child environment');
const evaluateEnvironment = ts.transpileModule(`(${environmentExpression})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
let runtimeHelper: Record<string, unknown> = {};
let socketAttempts = 0;

beforeAll(async () => {
  const deny = (): never => { socketAttempts++; throw new Error('ISOLATED_CHILD_PROBE_NETWORK_FORBIDDEN'); };
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(deny);
  vi.spyOn(tls, 'connect').mockImplementation(deny);
  if (existsSync(path.resolve('src/__tests__/helpers/isolated-child-database-env.ts'))) {
    runtimeHelper = await import('../helpers/isolated-child-database-env');
  }
});
afterAll(() => { vi.restoreAllMocks(); expect(socketAttempts).toBe(0); });

function childEnvironment(parentEnv: NodeJS.ProcessEnv, workflow: readonly [string, string, string] = workflows[0]): NodeJS.ProcessEnv {
  const parsed = YAML.parse(readFileSync(workflow[0], 'utf8')) as {
    jobs: Record<string, { steps: Array<{ name?: string; env?: Record<string, string> }> }>;
  };
  const step = parsed.jobs[workflow[1]].steps.find(item => item.name === workflow[2]);
  // Execute only the real env expression. No child process or connection is created.
  return vm.runInNewContext(evaluateEnvironment, { process: { env: parentEnv }, aliases, step, ...runtimeHelper }, { timeout: 1000 }) as NodeJS.ProcessEnv;
}

describe('actual shard runtime environment without spawning or connecting', () => {
  it.each(workflows)('inherits the verified parent port for %s', (workflow, job, step) => {
    const child = childEnvironment({ ...parent, NODE_OPTIONS: '--synthetic-parent-option', WUJIE_DATA_DIR: 'owned-data-root' }, [workflow, job, step]);
    console.info('CHILD_ENV_PROBE', JSON.stringify({ workflow, parentPort: new URL(probeUrl).port,
      childPorts: aliases.map(alias => new URL(child[alias]!).port), spawnedChildren: 0, networkConnections: 0 }));
    expect(aliases.every(alias => child[alias] === parent[alias])).toBe(true);
    expect(child.NODE_OPTIONS).toBe('');
    expect(child.WUJIE_DATA_DIR).toBe('owned-data-root');
  });

  it.each<readonly [string, NodeJS.ProcessEnv]>([
    ['missing all aliases', { NODE_ENV: 'test' }],
    ...aliases.map(alias => [`missing ${alias}`, { ...parent, [alias]: undefined }] as const),
    ...aliases.map(alias => [`mismatched ${alias}`, { ...parent, [alias]: probeUrl.replace('60018', '60019') }] as const),
    ['empty aliases', { NODE_ENV: 'test', ...Object.fromEntries(aliases.map(alias => [alias, ''])) }],
    ...[
      ['malformed', 'invalid probe-secret URL'],
      ['wrong protocol', probeUrl.replace('postgresql:', 'postgres:')],
      ['remote host', probeUrl.replace('127.0.0.1', 'db.example.invalid')],
      ['nonexact loopback', probeUrl.replace('127.0.0.1', 'localhost')],
      ['implicit port', probeUrl.replace(':60018', '')],
      ['privileged port', probeUrl.replace('60018', '80')],
      ['invalid port', probeUrl.replace('60018', '65536')],
      ['ordinary database', probeUrl.replace('wujie_bridge_test_child_probe', 'postgres')],
      ['bare test prefix', probeUrl.replace('wujie_bridge_test_child_probe', 'wujie_bridge_test_')],
      ['query', `${probeUrl}?options=probe-secret`],
      ['fragment', `${probeUrl}#probe-secret`],
    ].map(([label, url]) => [label, { NODE_ENV: 'test', ...Object.fromEntries(aliases.map(alias => [alias, url])) }] as const),
  ])('rejects %s without workflow fallback or connection-string disclosure', (_label, env) => {
    let message: string | undefined;
    try { childEnvironment(env); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    expect(typeof message).toBe('string');
    expect(message).toMatch(/Isolated child database boundary rejected/);
    expect(message?.includes('://')).toBe(false);
    expect(message?.includes('probe-secret')).toBe(false);
  });
});
