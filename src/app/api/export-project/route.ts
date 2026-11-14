import { NextRequest, NextResponse } from 'next/server';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { requireAdminUser } from '@/lib/server-auth';

// Exclude patterns for each scope
const EXCLUDE_NAMES = [
  'node_modules', '.next', '.git', 'upscayl-models', '__pycache__',
  '.DS_Store', 'project-source.tar.gz', 'deploy-seed',
];
const EXCLUDE_PATHS = ['data/system', 'data/users'];
const ENV_EXAMPLE = '.env.example';
const ENV_PREFIX = '.env.';
const execFileAsync = promisify(execFile);

function envExcludes(includeExample: boolean): string[] {
  if (!includeExample) return ['.env', '.env.*'];
  // Tar exclusion globs have no negation. Match shorter names, the first
  // differing letter, longer names, and examples below the workspace root.
  const suffix = ENV_EXAMPLE.slice(ENV_PREFIX.length);
  const patterns = ['.env', '*/' + ENV_EXAMPLE, ENV_EXAMPLE + '?*'];
  for (let i = 0; i < suffix.length; i++) {
    const prefix = ENV_PREFIX + suffix.slice(0, i);
    patterns.push(prefix, prefix + '[!' + suffix[i] + ']*');
  }
  return patterns;
}

// Keep runtime workspace inspection out of the Next build's file tracing.
const INSPECT_WORKSPACE = `
  const { lstatSync, readdirSync, statSync } = require('node:fs');
  const { join } = require('node:path');
  const [root, config] = process.argv.slice(1);
  const { entries, excludeNames, excludePaths, envExample } = JSON.parse(config);
  const directory = path => statSync(path, { throwIfNoEntry: false })?.isDirectory();
  const excluded = new Set(excludePaths);
  if (!directory(root) || !directory(join(root, 'src'))) process.exit(2);
  const present = entries.length
    ? entries.filter(name => statSync(join(root, name), { throwIfNoEntry: false }))
    : readdirSync(root);
  const includeEnvExample = entries.length === 0
    && lstatSync(join(root, envExample), { throwIfNoEntry: false })?.isFile() === true;
  const countDeadline = performance.now() + 1500;
  function count(dir, prefix = '') {
    let files = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (performance.now() > countDeadline) throw new Error('File count deadline');
      const path = prefix + entry.name;
      if (excludeNames.includes(entry.name) || excluded.has(path) || entry.name.endsWith('.pyc')
        || entry.name === '.env'
        || (entry.name.startsWith('.env.') && !(includeEnvExample && path === envExample))) continue;
      if (entry.isDirectory()) files += count(join(dir, entry.name), path + '/');
      else if (entry.isFile()) files++;
    }
    return files;
  }
  let fileCount = -1;
  try {
    fileCount = entries.length
      ? present.reduce((n, name) => n + (directory(join(root, name)) ? count(join(root, name), name + '/') : 1), 0)
      : count(root);
  } catch { /* The count is informational. */ }
  process.stdout.write(JSON.stringify({ present, fileCount, includeEnvExample }));
`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Create a tar.gz stream of the project
 * Uses Node.js child_process to call tar for reliability with large directories
 */
async function createTarGz(scope: string, signal: AbortSignal): Promise<{
  stream: ReadableStream<Uint8Array>; fileCount: number;
}> {
  signal.throwIfAborted();
  const projectRoot = process.env.COZE_WORKSPACE_PATH?.trim() || process.cwd();
  const withAssets = scope === 'with-assets';
  const entries = scope === 'source' || scope === 'source-config' ? ['src', 'scripts'] : [];
  if (scope === 'source-config') {
    entries.push(
      'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'next.config.ts',
      'next-env.d.ts', 'postcss.config.mjs', 'tailwind.config.ts', 'components.json',
      'drizzle.config.ts', 'eslint.config.mjs', '.coze', '.gitignore', 'AGENTS.md', 'DESIGN.md',
    );
  }
  const excludePaths = withAssets
    ? [...EXCLUDE_PATHS, 'public/uploads', 'public/outputs', 'public/ai-psd', 'public/gallery']
    : EXCLUDE_PATHS;
  let workspace: { present: string[]; fileCount: number; includeEnvExample: boolean };
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      '-e', INSPECT_WORKSPACE, '--', projectRoot,
      JSON.stringify({ entries, excludeNames: EXCLUDE_NAMES, excludePaths, envExample: ENV_EXAMPLE }),
    ], { encoding: 'utf8', timeout: 5_000, maxBuffer: 65_536, windowsHide: true, signal });
    workspace = JSON.parse(stdout);
  } catch {
    throw new Error('Project export workspace is unavailable');
  }
  const useBareInputs = entries.length > 0 || workspace.includeEnvExample;
  const paths = useBareInputs ? excludePaths : excludePaths.map(path => './' + path);
  const excludes = [...EXCLUDE_NAMES, ...paths, '*.pyc', ...envExcludes(workspace.includeEnvExample)];
  // With bare root entries, */.env.example excludes all nested templates on
  // GNU tar, bsdtar and BusyBox while keeping the top-level template.
  const inputs = useBareInputs ? ['--', ...workspace.present] : ['.'];
  signal.throwIfAborted();
  const tarArgs = ['cfz', '-', '-C', projectRoot, ...excludes.map(pattern => `--exclude=${pattern}`), ...inputs];

  const tar = spawn('tar', tarArgs, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const stop = (): void => {
    if (tar.exitCode === null && tar.signalCode === null) tar.kill();
    tar.stdout.destroy();
    signal.removeEventListener('abort', stop);
  };
  const finished = new Promise<boolean>(resolve => {
    tar.once('error', () => resolve(false));
    tar.once('close', code => {
      signal.removeEventListener('abort', stop);
      resolve(code === 0);
    });
  });
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  const chunks = tar.stdout.iterator({ destroyOnReturn: false });
  let current: IteratorResult<Buffer>;
  try {
    current = await chunks.next();
    signal.throwIfAborted();
    if (current.done) throw new Error('Project archive could not be created');
  } catch (error) {
    stop();
    signal.throwIfAborted();
    throw error;
  }

  let pending: IteratorResult<Buffer> | undefined = current;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = pending ?? await chunks.next();
      pending = undefined;
      if (cancelled) return;
      if (!chunk.done) {
        controller.enqueue(chunk.value);
        return;
      }
      const succeeded = await finished;
      if (cancelled) return;
      if (!succeeded || signal.aborted) throw new Error('Project archive was interrupted');
      controller.close();
    },
    cancel() {
      cancelled = true;
      stop();
    },
  });
  return { stream, fileCount: workspace.fileCount };
}

/**
 * GET /api/export-project — Get export info/preview
 * GET /api/export-project?scope=with-assets — Download tar.gz directly (browser-friendly)
 * POST /api/export-project — Download tar.gz (with JSON body)
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const scope = request.nextUrl.searchParams.get('scope');

  // If scope is specified, trigger download directly
  if (scope) {
    const validScopes = ['source', 'source-config', 'with-assets', 'full'];
    if (!validScopes.includes(scope)) {
      return NextResponse.json({ error: `Invalid scope. Use: ${validScopes.join(', ')}` }, { status: 400 });
    }

    try {
      console.log(`[export-project] Starting export, scope=${scope}`);
      const { stream, fileCount } = await createTarGz(scope, request.signal);

      const scopeLabels: Record<string, string> = {
        'source': '无界AI-纯源码',
        'source-config': '无界AI-源码+配置',
        'with-assets': '无界AI-含静态资源',
        'full': '无界AI-完整项目',
      };

      const filename = `${scopeLabels[scope] || 'project'}-${new Date().toISOString().slice(0, 10)}.tar.gz`;

      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          'X-Export-Scope': scope,
          'X-Export-File-Count': String(fileCount),
        },
      });
    } catch (error: unknown) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      console.error('[export-project] Export failed:', error);
      return NextResponse.json(
        { error: `Export failed: ${errorMessage(error)}` },
        { status: 500 }
      );
    }
  }

  // No scope — return info list
  const scopes = [
    {
      id: 'source',
      label: '纯源码',
      description: 'src/ + scripts/ 目录，最小体积',
      estimatedSize: '~15MB',
    },
    {
      id: 'source-config',
      label: '源码 + 配置',
      description: '源码 + package.json + tsconfig + next.config 等所有配置文件',
      estimatedSize: '~20MB',
    },
    {
      id: 'with-assets',
      label: '含静态资源',
      description: '源码 + 配置 + public 目录（排除用户上传/输出/PSD/画廊）',
      estimatedSize: '~30MB',
    },
    {
      id: 'full',
      label: '完整项目',
      description: '源码及用户上传、生成图片、PSD 等资源。环境文件与账号配置另行管理。',
      estimatedSize: '~1.7GB',
    },
  ];

  return NextResponse.json({ scopes });
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const scope = body.scope || 'source-config';
    
    const validScopes = ['source', 'source-config', 'with-assets', 'full'];
    if (!validScopes.includes(scope)) {
      return NextResponse.json({ error: `Invalid scope. Use: ${validScopes.join(', ')}` }, { status: 400 });
    }
    
    console.log(`[export-project] Starting export, scope=${scope}`);
    
    const { stream, fileCount } = await createTarGz(scope, request.signal);
    
    const scopeLabels: Record<string, string> = {
      'source': '无界AI-纯源码',
      'source-config': '无界AI-源码+配置',
      'with-assets': '无界AI-含静态资源',
      'full': '无界AI-完整项目',
    };
    
    const filename = `${scopeLabels[scope] || 'project'}-${new Date().toISOString().slice(0,10)}.tar.gz`;
    
    // Return streaming response
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'X-Export-Scope': scope,
        'X-Export-File-Count': String(fileCount),
      },
    });
  } catch (error: unknown) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error('[export-project] Export failed:', error);
    return NextResponse.json(
      { error: `Export failed: ${errorMessage(error)}` },
      { status: 500 }
    );
  }
}
