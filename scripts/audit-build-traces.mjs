import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function collectRouteTraces(directory) {
  const traces = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      traces.push(...await collectRouteTraces(entryPath));
    } else if (entry.name === 'route.js.nft.json') {
      traces.push(entryPath);
    }
  }
  return traces;
}

export async function auditBuildTraces(projectRoot, { wideThreshold = 2000 } = {}) {
  const root = path.resolve(projectRoot);
  const comparableRoot = comparablePath(root);
  const comparableConfig = comparablePath(path.join(root, 'next.config.ts'));
  const apiRoot = path.join(root, '.next', 'server', 'app', 'api');
  const traces = await collectRouteTraces(apiRoot);
  if (traces.length === 0) throw new Error(`No API route traces found in ${apiRoot}`);

  const routes = [];
  const nextConfigRoutes = [];
  const rootDocumentRoutes = [];
  let totalFileReferences = 0;

  for (const tracePath of traces) {
    const trace = JSON.parse(await readFile(tracePath, 'utf8'));
    if (!Array.isArray(trace.files)) throw new Error(`Invalid NFT files in ${tracePath}`);
    const route = `/api/${path.relative(apiRoot, path.dirname(tracePath)).split(path.sep).join('/')}`;
    const files = trace.files.map((file) => path.resolve(path.dirname(tracePath), file));
    totalFileReferences += files.length;
    routes.push({ route, fileCount: files.length });
    if (files.some((file) => comparablePath(file) === comparableConfig)) nextConfigRoutes.push(route);
    if (files.some((file) => comparablePath(path.dirname(file)) === comparableRoot && /\.md$/i.test(file))) {
      rootDocumentRoutes.push(route);
    }
  }

  routes.sort((a, b) => b.fileCount - a.fileCount || a.route.localeCompare(b.route));
  nextConfigRoutes.sort();
  rootDocumentRoutes.sort();
  const wideRoutes = routes.filter((route) => route.fileCount >= wideThreshold);
  return {
    routeCount: routes.length,
    totalFileReferences,
    wideRouteCount: wideRoutes.length,
    wideRoutes,
    nextConfigRoutes,
    rootDocumentRoutes,
    largestRoutes: routes.slice(0, 10),
  };
}

async function main() {
  const args = process.argv.slice(2);
  let projectRoot = process.cwd();
  let wideThreshold = 2000;
  let strict = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--project-root') projectRoot = args[++index];
    else if (args[index] === '--wide-threshold') wideThreshold = Number(args[++index]);
    else if (args[index] === '--strict') strict = true;
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (!projectRoot || !Number.isSafeInteger(wideThreshold) || wideThreshold < 1) {
    throw new Error('Expected a project root and a positive wide threshold');
  }
  const report = await auditBuildTraces(projectRoot, { wideThreshold });
  console.log(JSON.stringify(report, null, 2));
  if (strict && (report.nextConfigRoutes.length > 0 || report.rootDocumentRoutes.length > 0)) {
    console.error('API route traces include unexpected project files');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
