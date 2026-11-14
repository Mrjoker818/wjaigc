import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  classifyTask7Request,
  task7CanonicalPaths,
  task7RequestMatches,
  task7ScenarioRequestContract,
  type Task7ForbiddenReason,
  type Task7RequestRecord,
  type Task7Scenario,
} from './read-only-canvas-share-contract';

export type ShareBuildAsset = Readonly<{ pathname: string; search: string; resourceType: string }>;
type PageBuildManifest = {
  rootMainFiles: string[];
  polyfillFiles: string[];
};
type ClientReferenceManifest = {
  entryJSFiles: Record<string, string[]>;
  entryCSSFiles: Record<string, Array<{ path: string; inlined: boolean }>>;
};

const route = '/shared/canvas/[token]/page';
const fingerprintedChunk = /^static\/chunks\/[a-z0-9_-]+\.(?:js|css)$/u;
const fingerprintedIcon = /^favicon\.[a-z0-9_-]+\.ico$/u;

/** Use the checked local build for this route, never a request log or a route prefix. */
export async function readShareBuildAssets(buildDirectory: string): Promise<readonly ShareBuildAsset[]> {
  const build = resolve(buildDirectory);
  const routeDirectory = join(build, 'server', 'app', route);
  const [pageManifest, referenceSource, media, buildId, completion] = await Promise.all([
    readFile(join(routeDirectory, 'build-manifest.json'), 'utf8'),
    readFile(join(routeDirectory, '../page_client-reference-manifest.js'), 'utf8'),
    readdir(join(build, 'static/media'), { withFileTypes: true }),
    readFile(join(build, 'BUILD_ID'), 'utf8'),
    readFile(join(build, 'WUJIE_BUILD_COMPLETE'), 'utf8'),
  ]);
  if (!buildId.trim() || buildId.trim() !== completion.trim()) {
    throw new Error('The share network gate requires a completed local production build');
  }
  const assignment = 'globalThis.__RSC_MANIFEST[' + JSON.stringify(route) + '] = ';
  const referenceLine = referenceSource.split(/\r?\n/u).find(line => line.startsWith(assignment));
  if (!referenceLine) throw new Error('Missing share page client reference manifest');
  const client = JSON.parse(referenceLine.slice(assignment.length).replace(/;$/u, '')) as ClientReferenceManifest;
  const page = JSON.parse(pageManifest) as PageBuildManifest;
  const paths = new Set([
    ...page.rootMainFiles,
    ...page.polyfillFiles,
    ...Object.values(client.entryJSFiles).flat(),
    ...Object.values(client.entryCSSFiles).flat().filter(item => !item.inlined).map(item => item.path),
  ]);
  if (!paths.size) throw new Error('Missing share page assets');
  const assets: ShareBuildAsset[] = [];
  for (const path of paths) {
    if (!fingerprintedChunk.test(path) || !(await stat(join(build, path))).isFile()) {
      throw new Error('Invalid share page chunk in the production build manifest');
    }
    assets.push(Object.freeze({
      pathname: '/_next/' + path,
      search: '',
      resourceType: path.endsWith('.css') ? 'stylesheet' : 'script',
    }));
  }
  // Next's favicon route uses the emitted favicon file name as the full query.
  const icons = media.filter(file => file.isFile() && fingerprintedIcon.test(file.name));
  if (icons.length !== 1) throw new Error('Cannot bind the share page favicon to this production build');
  assets.push(Object.freeze({ pathname: '/favicon.ico', search: '?' + icons[0].name, resourceType: 'other' }));
  return Object.freeze(assets);
}

export function matchesShareBuildAsset(
  assets: readonly ShareBuildAsset[],
  actual: Task7RequestRecord,
): boolean {
  return actual.method === 'GET'
    && actual.origin === ':same-origin'
    && actual.pageRole === 'primary'
    && actual.frameRole === 'main'
    && !actual.navigation
    && actual.range === null
    && actual.reason === undefined
    && assets.some(asset => actual.pathname === asset.pathname
      && actual.search === asset.search && actual.resourceType === asset.resourceType);
}

const shareRoutes = new Set<string>(Object.values(task7CanonicalPaths));

export function classifyProductionShareRequest(
  assets: readonly ShareBuildAsset[],
  scenario: Task7Scenario | null,
  actual: Task7RequestRecord,
): Task7ForbiddenReason | null {
  if (scenario && matchesShareBuildAsset(assets, actual)) return null;
  const reason = classifyTask7Request(scenario, actual);
  if (reason !== null) return reason;
  // Keep the immutable descriptors unchanged. Their development resources and
  // volatile exceptions (including build queries and HMR) do not apply here.
  return actual.search === '' && shareRoutes.has(actual.pathname) ? null : 'unexpected-request';
}

export function evaluateProductionShareRequests(
  assets: readonly ShareBuildAsset[],
  scenario: Task7Scenario,
  requests: readonly Task7RequestRecord[],
  forbiddenFrameNavigations: number,
) {
  const expected = task7ScenarioRequestContract(scenario).filter(entry => shareRoutes.has(entry.pathname));
  const errors: string[] = [];
  const actual = expected.map(entry => {
    const count = requests.filter(record => task7RequestMatches(entry, record)).length;
    if (count !== entry.count) errors.push(entry.label + ': expected ' + entry.count + ', received ' + count);
    return { label: entry.label, count };
  });
  const outside = requests.filter(record => !matchesShareBuildAsset(assets, record)
    && !expected.some(entry => task7RequestMatches(entry, record))).length;
  if (outside) errors.push('unexpected production share requests: ' + outside);
  if (forbiddenFrameNavigations) errors.push('forbidden frame navigations: ' + forbiddenFrameNavigations);
  for (const resourceType of ['script', 'stylesheet']) {
    if (!requests.some(record => record.resourceType === resourceType && matchesShareBuildAsset(assets, record))) {
      errors.push('missing observed production ' + resourceType);
    }
  }
  return { valid: errors.length === 0, errors, expected: expected.map(({ label, count }) => ({ label, count })), actual };
}
