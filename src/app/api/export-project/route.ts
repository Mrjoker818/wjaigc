import { NextRequest, NextResponse } from 'next/server';
import { createReadStream, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';

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

interface FileEntry {
  path: string;        // Relative path from project root
  fullPath: string;    // Absolute path
  size: number;
}

/**
 * Walk directory and collect files matching include/exclude rules
 */
function walkDir(dir: string, baseDir: string, excludes: string[], includes: string[] | null): FileEntry[] {
  const results: FileEntry[] = [];
  const fs = require('fs');
  
  if (!fs.existsSync(dir)) return results;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(baseDir, fullPath);
    
    // Check excludes
    if (excludes.some(exc => {
      if (exc.startsWith('*.')) {
        return entry.name.endsWith(exc.slice(1));
      }
      return entry.name === exc || relPath.startsWith(exc + '/');
    })) {
      continue;
    }
    
    // Check includes (if specified, only include matching paths)
    if (includes && !includes.some(inc => relPath.startsWith(inc + '/') || relPath === inc)) {
      if (entry.isDirectory()) {
        // Still recurse into subdirs that might contain included paths
        const subResults = walkDir(fullPath, baseDir, excludes, includes);
        results.push(...subResults);
      }
      continue;
    }
    
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, baseDir, excludes, null));
    } else if (entry.isFile()) {
      try {
        const stat = statSync(fullPath);
        results.push({ path: relPath, fullPath, size: stat.size });
      } catch {
        // Skip files we can't stat
      }
    }
  }
  
  return results;
}

/**
 * Create a tar.gz stream of the project
 * Uses Node.js child_process to call tar for reliability with large directories
 */
async function createTarGz(scope: string): Promise<{ stream: Readable; fileCount: number; totalSize: number }> {
  const { spawn } = require('child_process');
  
  const excludes = [...EXCLUDE_COMMON];
  let includes: string[] | null = null;
  
  switch (scope) {
    case 'source':
      // Source code only: src, scripts, configs
      includes = ['src', 'scripts'];
      break;
    case 'source-config':
      // Source + config files
      includes = ['src', 'scripts'];
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
      includes = ['src', 'scripts'];
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
  let totalSize = 0;
  
  // Quick file count for metadata
  try {
    const { execSync } = require('child_process');
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
 * POST /api/export-project — Download tar.gz
 */
export async function GET(request: NextRequest) {
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
    return new NextResponse(stream as any, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'X-Export-Scope': scope,
        'X-Export-File-Count': String(fileCount),
      },
    });
  } catch (error: any) {
    console.error('[export-project] Export failed:', error);
    return NextResponse.json(
      { error: `Export failed: ${error.message}` },
      { status: 500 }
    );
  }
}
