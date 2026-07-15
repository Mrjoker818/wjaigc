import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { } from 'stream/promises';
import { } from 'zlib';
import { spawn, execSync } from 'child_process';

const PROJECT_ROOT = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';

// Exclude patterns for each scope
const EXCLUDE_COMMON = [
  'node_modules',
  '.next',
  '.git',
  'upscayl-models',
  '__pycache__',
  '*.pyc',
  '.DS_Store',
  'project-source.tar.gz',
];

function toWebStream(stream: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Create a tar.gz stream of the project
 * Uses Node.js child_process to call tar for reliability with large directories
 */
async function createTarGz(scope: string): Promise<{ stream: Readable; fileCount: number; totalSize: number }> {
  const excludes = [...EXCLUDE_COMMON];
  
  switch (scope) {
    case 'source':
      // Source code only: src, scripts, configs
      break;
    case 'source-config':
      // Source + config files
      // Also include root config files
      break;
    case 'with-assets':
      // Source + config + public assets (no uploads/outputs)
      excludes.push('public/uploads', 'public/outputs', 'public/ai-psd', 'public/gallery');
      break;
    case 'full':
      // Everything
      break;
    default:
  }
  
  // Build tar arguments
  const tarArgs: string[] = ['cfz', '-', '-C', PROJECT_ROOT];
  
  for (const exc of excludes) {
    if (!exc.startsWith('*.')) {
      tarArgs.push(`--exclude=./${exc}`);
    } else {
      tarArgs.push(`--exclude=${exc}`);
    }
  }
  
  if (scope === 'source' || scope === 'source-config') {
    // Add source directories
    tarArgs.push('./src', './scripts');
    
    if (scope === 'source-config') {
      // Add config files
      const configFiles = [
        'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'next.config.ts',
        'next-env.d.ts', 'postcss.config.mjs', 'tailwind.config.ts',
        'components.json', 'drizzle.config.ts', 'eslint.config.mjs',
        '.coze', '.gitignore', 'AGENTS.md', 'DESIGN.md',
      ];
      for (const f of configFiles) {
        if (existsSync(join(PROJECT_ROOT, f))) {
          tarArgs.push(`./${f}`);
        }
      }
    }
  } else {
    // Add everything (excludes already set)
    tarArgs.push('.');
  }
  
  const tar = spawn('tar', tarArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  
  // Count files (non-blocking, approximate)
  let fileCount = 0;
  const totalSize = 0;
  
  // Quick file count for metadata
  try {
    let findCmd = `find ${PROJECT_ROOT}`;
    for (const exc of EXCLUDE_COMMON) {
      if (!exc.startsWith('*.')) {
        findCmd += ` -path '*/${exc}' -prune -o`;
      }
    }
    findCmd += ` -type f -print | wc -l`;
    fileCount = parseInt(execSync(findCmd, { timeout: 5000 }).toString().trim()) || 0;
  } catch {
    fileCount = -1; // Unknown
  }
  
  const stream = Readable.from(tar.stdout);
  
  return { stream, fileCount, totalSize };
}

/**
 * GET /api/export-project — Get export info/preview
 * GET /api/export-project?scope=with-assets — Download tar.gz directly (browser-friendly)
 * POST /api/export-project — Download tar.gz (with JSON body)
 */
export async function GET(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get('scope');

  // If scope is specified, trigger download directly
  if (scope) {
    const validScopes = ['source', 'source-config', 'with-assets', 'full'];
    if (!validScopes.includes(scope)) {
      return NextResponse.json({ error: `Invalid scope. Use: ${validScopes.join(', ')}` }, { status: 400 });
    }

    try {
      console.log(`[export-project] Starting export, scope=${scope}`);
      const { stream, fileCount } = await createTarGz(scope);

      const scopeLabels: Record<string, string> = {
        'source': '无界AI-纯源码',
        'source-config': '无界AI-源码+配置',
        'with-assets': '无界AI-含静态资源',
        'full': '无界AI-完整项目',
      };

      const filename = `${scopeLabels[scope] || 'project'}-${new Date().toISOString().slice(0, 10)}.tar.gz`;

      return new NextResponse(toWebStream(stream), {
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          'X-Export-Scope': scope,
          'X-Export-File-Count': String(fileCount),
        },
      });
    } catch (error: unknown) {
      console.error('[export-project] Export failed:', error);
      return NextResponse.json(
        { error: `Export failed: ${getErrorMessage(error)}` },
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
      description: '所有内容（含用户上传文件、生成图片、PSD 等资源）',
      estimatedSize: '~1.7GB',
    },
  ];

  return NextResponse.json({ scopes });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const scope = body.scope || 'source-config';
    
    const validScopes = ['source', 'source-config', 'with-assets', 'full'];
    if (!validScopes.includes(scope)) {
      return NextResponse.json({ error: `Invalid scope. Use: ${validScopes.join(', ')}` }, { status: 400 });
    }
    
    console.log(`[export-project] Starting export, scope=${scope}`);
    
    const { stream, fileCount } = await createTarGz(scope);
    
    const scopeLabels: Record<string, string> = {
      'source': '无界AI-纯源码',
      'source-config': '无界AI-源码+配置',
      'with-assets': '无界AI-含静态资源',
      'full': '无界AI-完整项目',
    };
    
    const filename = `${scopeLabels[scope] || 'project'}-${new Date().toISOString().slice(0,10)}.tar.gz`;
    
    // Return streaming response
    return new NextResponse(toWebStream(stream), {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'X-Export-Scope': scope,
        'X-Export-File-Count': String(fileCount),
      },
    });
  } catch (error: unknown) {
    console.error('[export-project] Export failed:', error);
    return NextResponse.json(
      { error: `Export failed: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
