import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
const auditScript = path.resolve(process.cwd(), 'scripts/audit-build-traces.mjs');

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

async function writeRouteTrace(projectRoot: string, route: string, files: string[]): Promise<void> {
  const directory = path.join(projectRoot, '.next', 'server', 'app', 'api', route);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'route.js.nft.json'), JSON.stringify({ version: 1, files }));
}

describe('build trace audit CLI', () => {
  it('reports broad API traces and their unexpected project files', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'wujie-trace-audit-'));
    temporaryDirectories.push(projectRoot);
    await writeRouteTrace(projectRoot, 'wide', [
      '../../../../../next.config.ts',
      '../../../../../README.md',
      './route.js',
    ]);
    await writeRouteTrace(projectRoot, 'small', ['./route.js']);

    const result = spawnSync(process.execPath, [
      auditScript,
      '--project-root', projectRoot,
      '--wide-threshold', '3',
    ], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      routeCount: 2,
      totalFileReferences: 4,
      wideRouteCount: 1,
      wideRoutes: [{ route: '/api/wide', fileCount: 3 }],
      nextConfigRoutes: ['/api/wide'],
      rootDocumentRoutes: ['/api/wide'],
      largestRoutes: [
        { route: '/api/wide', fileCount: 3 },
        { route: '/api/small', fileCount: 1 },
      ],
    });
  });

  it('rejects unexpected project files in strict mode without changing the trace', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'wujie-trace-audit-'));
    temporaryDirectories.push(projectRoot);
    const files = ['../../../../../next.config.ts', '../../../../../README.md', './route.js'];
    await writeRouteTrace(projectRoot, 'wide', files);

    const result = spawnSync(process.execPath, [
      auditScript, '--project-root', projectRoot, '--strict',
    ], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unexpected project files');
    expect(JSON.parse(result.stdout).nextConfigRoutes).toEqual(['/api/wide']);
    const tracePath = path.join(projectRoot, '.next', 'server', 'app', 'api', 'wide', 'route.js.nft.json');
    const { readFile } = await import('node:fs/promises');
    expect(JSON.parse(await readFile(tracePath, 'utf8')).files).toEqual(files);
  });

  it('detects case-only Windows path variants in strict mode', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'wujie-trace-audit-'));
    temporaryDirectories.push(projectRoot);
    await writeFile(path.join(projectRoot, 'next.config.ts'), '');
    await writeFile(path.join(projectRoot, 'README.md'), '');
    const listedRoot = process.platform === 'win32' ? projectRoot.toUpperCase() : projectRoot;
    const configName = process.platform === 'win32' ? 'NEXT.CONFIG.TS' : 'next.config.ts';
    const readmeName = process.platform === 'win32' ? 'README.MD' : 'README.md';
    await writeRouteTrace(projectRoot, 'case-variant', [
      path.join(listedRoot, configName),
      path.join(listedRoot, readmeName),
    ]);

    const result = spawnSync(process.execPath, [
      auditScript, '--project-root', projectRoot, '--strict',
    ], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).nextConfigRoutes).toEqual(['/api/case-variant']);
    expect(JSON.parse(result.stdout).rootDocumentRoutes).toEqual(['/api/case-variant']);
  });

  it('accepts clean route traces in strict mode', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'wujie-trace-audit-'));
    temporaryDirectories.push(projectRoot);
    await writeRouteTrace(projectRoot, 'small', ['./route.js']);

    const result = spawnSync(process.execPath, [
      auditScript, '--project-root', projectRoot, '--strict',
    ], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).routeCount).toBe(1);
  });
});
