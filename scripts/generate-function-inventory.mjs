import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_FEATURE_FIELDS = [
  'featureId',
  'surface',
  'workspace',
  'name',
  'entrances',
  'routes',
  'components',
  'actions',
  'resultKinds',
  'preservesOriginal',
  'risk',
  'status',
];

const PRODUCT_SURFACES = [
  'identity',
  'creator-dashboard',
  'admin-dashboard',
  'workspaces',
  'public-delivery',
  'desktop-connectors',
  'support-operations',
];

const WORKSPACES = ['canvas', 'workflow', 'chat'];

export function posixPath(path) {
  return path.split(sep).join('/');
}

export async function walk(directory, predicate = () => true) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(path, predicate));
    } else if (entry.isFile() && predicate(path)) {
      files.push(path);
    }
  }
  return files;
}

export function appFileToRoute(appRoot, file, filename) {
  const directory = relative(appRoot, dirname(file));
  const segments = directory === '' ? [] : posixPath(directory).split('/');
  const isApiRoute = segments[0] === 'api';
  const routeSegments = segments
    .filter((segment) => !segment.startsWith('(') && !segment.startsWith('@'))
    .filter((segment, index) => !(isApiRoute && index === 0))
    .map((segment) => segment
      .replace(/^\[\.\.\.(.+)\]$/, ':$1*')
      .replace(/^\[\[(.+)\]\]$/, ':$1?')
      .replace(/^\[(.+)\]$/, ':$1'));
  const prefix = routeSegments.length === 0 ? '' : `/${routeSegments.join('/')}`;
  return filename === 'route.ts'
    ? `${isApiRoute ? '/api' : ''}${prefix || (isApiRoute ? '' : '/')}`
    : prefix || '/';
}

function git(root, args, fallback = 'unknown') {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

function parseCandidateDocument(document) {
  if (Array.isArray(document)) {
    return { features: document, removalApproved: [] };
  }
  return {
    features: Array.isArray(document?.features) ? document.features : [],
    removalApproved: Array.isArray(document?.removalApproved)
      ? document.removalApproved
      : [],
  };
}

export function validateProtectedFeatures(candidate, baseline = candidate, removalApproved = []) {
  const errors = [];
  const ids = new Set();
  const approvedRemovals = new Set(
    removalApproved.map((record) => typeof record === 'string' ? record : record?.featureId),
  );

  for (const [index, feature] of candidate.entries()) {
    for (const field of REQUIRED_FEATURE_FIELDS) {
      if (!(field in feature)) {
        errors.push(`Feature at index ${index} is missing required field "${field}".`);
      }
    }
    if (typeof feature.featureId !== 'string' || feature.featureId.trim() === '') {
      errors.push(`Feature at index ${index} has an empty featureId.`);
      continue;
    }
    if (ids.has(feature.featureId)) {
      errors.push(`Duplicate featureId "${feature.featureId}".`);
    }
    ids.add(feature.featureId);
    if (!PRODUCT_SURFACES.includes(feature.surface)) {
      errors.push(`Feature "${feature.featureId}" uses unknown surface "${feature.surface}".`);
    }
    if (feature.surface === 'workspaces' && !WORKSPACES.includes(feature.workspace)) {
      errors.push(`Workspace feature "${feature.featureId}" uses unknown workspace "${feature.workspace}".`);
    }
  }

  const candidateIds = new Set(candidate.map((feature) => feature.featureId));
  for (const protectedFeature of baseline) {
    if (
      protectedFeature?.featureId
      && !candidateIds.has(protectedFeature.featureId)
      && !approvedRemovals.has(protectedFeature.featureId)
    ) {
      errors.push(
        `Protected feature "${protectedFeature.featureId}" was removed without a removalApproved record.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
}

export function extractQuotedValues(source) {
  return [...source.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function extractNodeTypes(source) {
  const match = source.match(/export\s+type\s+NodeType\s*=([\s\S]*?);/);
  return match ? [...new Set(extractQuotedValues(match[1]))].sort() : [];
}

export function extractAgentTools(source) {
  return [...new Set(
    [...source.matchAll(/registerTool\(\s*\{\s*name:\s*['"]([^'"]+)['"]/g)]
      .map((match) => match[1]),
  )].sort();
}

function extractReferencedApiRoutes(source) {
  return [...new Set(
    [...source.matchAll(/['"`](\/api\/[^'"`\s)]+)['"`]/g)]
      .map((match) => match[1]),
  )].sort();
}

function extractImageToolbarActions(source) {
  const start = source.indexOf('const imageActions');
  const end = source.indexOf('const allActionLabels', start);
  if (start === -1 || end === -1) return [];
  return [...new Set(
    [...source.slice(start, end).matchAll(/label:\s*['"]([^'"]+)['"]/g)]
      .map((match) => match[1]),
  )];
}

function extractPreferenceItems(source) {
  const match = source.match(/DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER\s*=\s*\[([\s\S]*?)\]/);
  return match ? extractQuotedValues(match[1]) : [];
}

export async function discoverRepository(root) {
  const appRoot = join(root, 'src', 'app');
  const componentRoot = join(root, 'src', 'components');
  const sourceRoot = join(root, 'src');
  const appFiles = await walk(
    appRoot,
    (file) => file.endsWith('page.tsx') || file.endsWith('route.ts'),
  );
  const componentFiles = await walk(
    componentRoot,
    (file) => ['.ts', '.tsx'].includes(extname(file)),
  );

  const pages = [];
  const apiRoutes = [];
  for (const file of appFiles) {
    const filename = file.endsWith('page.tsx') ? 'page.tsx' : 'route.ts';
    const source = await readFile(file, 'utf8');
    const item = {
      route: appFileToRoute(appRoot, file, filename),
      file: posixPath(relative(root, file)),
    };
    if (filename === 'page.tsx') {
      pages.push(item);
    } else {
      apiRoutes.push({
        ...item,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
          .filter((method) => new RegExp(
            `export\\s+(?:async\\s+)?function\\s+${method}\\b|export\\s+const\\s+${method}\\b`,
          ).test(source)),
      });
    }
  }

  const workflowSource = await readFile(join(root, 'src/lib/workflow-engine.ts'), 'utf8');
  const agentSource = await readFile(join(root, 'src/lib/agent-engine.ts'), 'utf8');
  const canvasSource = await readFile(join(root, 'src/components/infinite-canvas.tsx'), 'utf8');
  const toolbarPreferenceSource = await readFile(
    join(root, 'src/lib/image-toolbar-preferences.ts'),
    'utf8',
  );

  return {
    pages: pages.sort((a, b) => a.route.localeCompare(b.route)),
    apiRoutes: apiRoutes.sort((a, b) => a.route.localeCompare(b.route)),
    components: componentFiles.map((file) => posixPath(relative(root, file))).sort(),
    nodeTypes: extractNodeTypes(workflowSource),
    agentTools: extractAgentTools(agentSource),
    toolbarActions: [...new Set([
      ...extractPreferenceItems(toolbarPreferenceSource),
      ...extractImageToolbarActions(canvasSource),
    ])],
    referencedApiRoutes: uniqueSorted(await Promise.all(
      (await walk(sourceRoot, file => ['.ts', '.tsx'].includes(extname(file))))
        .map(async file => extractReferencedApiRoutes(await readFile(file, 'utf8'))),
    ).then(groups => groups.flat())),
  };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function escapeCell(value) {
  if (Array.isArray(value)) {
    return value.map(String).join('<br>').replaceAll('|', '\\|');
  }
  if (value === null || value === undefined || value === '') return '—';
  return String(value).replaceAll('|', '\\|');
}

function featureTable(features) {
  return features
    .map((feature) => `| ${[
      `\`${feature.featureId}\``,
      feature.surface,
      feature.workspace,
      feature.name,
      feature.entrances,
      feature.routes,
      feature.actions,
      feature.resultKinds,
      feature.risk,
      feature.status,
    ].map(escapeCell).join(' | ')} |`)
    .join('\n');
}

function discoveredList(values) {
  return values.length > 0 ? values.map((value) => `- \`${value}\``).join('\n') : '- 未发现';
}

function renderProtectedFeatures(features, commit, generatedAt) {
  return `# 受保护功能清单

- Git Commit：\`${commit}\`
- 生成时间：${generatedAt}
- 契约文件：\`docs/testing/baselines/protected-features.json\`
- 条目数量：${features.length}

本清单是升级期间禁止静默删除、隐藏或解绑的稳定功能契约。` +
`“受保护”不等于“真实验证通过”；状态以浏览器、接口、数据库和云端证据为准。

| Feature ID | 产品表面 | 工作区 | 功能 | 入口 | 路由 | 动作 | 产物 | 风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${featureTable(features)}
`;
}

function renderFunctionInventory({
  features,
  discovered,
  commit,
  packageVersion,
  generatedAt,
}) {
  const apiRows = discovered.apiRoutes.map((item) => (
    `| \`${item.route}\` | ${item.methods.join(', ') || 'dynamic'} | \`${item.file}\` |`
  )).join('\n');
  const pageRows = discovered.pages.map((item) => (
    `| \`${item.route}\` | \`${item.file}\` |`
  )).join('\n');

  return `# 无界 AI 功能盘点

- Git Commit：\`${commit}\`
- 软件版本：\`${packageVersion}\`
- 生成时间：${generatedAt}
- 受保护功能：${features.length} 项
- 页面：${discovered.pages.length} 项
- API 路由：${discovered.apiRoutes.length} 项
- 组件源码：${discovered.components.length} 项
- 工作流节点类型：${discovered.nodeTypes.length} 项
- Agent 工具：${discovered.agentTools.length} 项
- 图片浮动工具动作：${discovered.toolbarActions.length} 项

> 本报告由显式保护契约和源码静态发现合并生成。入口、组件或路由“已发现”只证明代码存在，不代表真实浏览器、供应商、数据库、积分或云端链路已经通过。

## 受保护功能矩阵

| Feature ID | 产品表面 | 工作区 | 功能 | 入口 | 路由 | 动作 | 产物 | 风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${featureTable(features)}

## 页面

| 路由 | 文件 |
| --- | --- |
${pageRows}

## API 路由

| 路由 | 方法 | 文件 |
| --- | --- | --- |
${apiRows}

## 源码引用 API 端点

${discoveredList(discovered.referencedApiRoutes)}

## 工作流节点类型

${discoveredList(discovered.nodeTypes)}

## Agent 工具

${discoveredList(discovered.agentTools)}

## 图片浮动工具动作

${discoveredList(discovered.toolbarActions)}

## 组件源文件

${discoveredList(discovered.components)}
`;
}

function findArgument(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] || null;
}

export async function generateFunctionInventory({
  root = process.cwd(),
  candidatePath = null,
} = {}) {
  const baselinePath = join(root, 'docs/testing/baselines/protected-features.json');
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  const candidateDocument = candidatePath
    ? JSON.parse(await readFile(resolve(root, candidatePath), 'utf8'))
    : baseline;
  const candidate = parseCandidateDocument(candidateDocument);

  validateProtectedFeatures(candidate.features, baseline, candidate.removalApproved);

  const discovered = await discoverRepository(root);
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const commit = git(root, ['rev-parse', '--short', 'HEAD']);
  const generatedAt = new Date().toISOString();
  const protectedOutput = join(root, 'docs/testing/PROTECTED_FEATURES.md');
  const inventoryOutput = join(root, 'docs/testing/FUNCTION_INVENTORY.md');

  await mkdir(dirname(protectedOutput), { recursive: true });
  await writeFile(
    protectedOutput,
    renderProtectedFeatures(candidate.features, commit, generatedAt),
    'utf8',
  );
  await writeFile(
    inventoryOutput,
    renderFunctionInventory({
      features: candidate.features,
      discovered,
      commit,
      packageVersion: packageJson.version,
      generatedAt,
    }),
    'utf8',
  );

  return {
    commit,
    protectedFeatureCount: candidate.features.length,
    ...discovered,
  };
}

const invokedFile = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedFile === fileURLToPath(import.meta.url)) {
  try {
    const candidatePath = findArgument(process.argv.slice(2), '--candidate');
    const result = await generateFunctionInventory({ candidatePath });
    console.log(
      `Generated protected inventory for ${result.protectedFeatureCount} features, `
      + `${result.apiRoutes.length} API routes and ${result.nodeTypes.length} workflow node types.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
