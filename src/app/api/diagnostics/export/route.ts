/**
 * 诊断包导出 API
 * GET /api/diagnostics/export
 * 收集应用状态、配置摘要和日志级别计数，打包为 zip 下载
 */

import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { open, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { requireAdminUser } from '@/lib/server-auth';

// 动态导入JSZip
interface JSZipConstructor {
  new (): import('jszip');
}

let JSZip: JSZipConstructor | null = null;
async function getJSZip(): Promise<JSZipConstructor> {
  if (!JSZip) {
    const mod = await import('jszip');
    JSZip = mod.default as unknown as JSZipConstructor;
  }
  return JSZip;
}

const LOG_SAMPLE_BYTES = 256 * 1024;
const LOG_SAMPLE_LINES = 2000;

async function summarizeLog(path: string) {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile()) return undefined;
    const start = Math.max(0, stat.size - LOG_SAMPLE_BYTES);
    const buffer = Buffer.alloc(stat.size - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8', 0, bytesRead).split('\n');
    if (start > 0) lines.shift();
    const counts = { sampledLines: 0, error: 0, warn: 0, info: 0, debug: 0, other: 0 };
    for (const line of lines.slice(-LOG_SAMPLE_LINES)) {
      if (!line.trim()) continue;
      counts.sampledLines += 1;
      const level = line.match(/^(?:\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+)?\[?(error|warn(?:ing)?|info|debug)\b/i)?.[1]?.toLowerCase();
      if (level === 'warning' || level === 'warn') counts.warn += 1;
      else if (level === 'error' || level === 'info' || level === 'debug') counts[level] += 1;
      else counts.other += 1;
    }
    return counts;
  } finally {
    await file.close();
  }
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminUser(req);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }

  try {
    const Zip = await getJSZip();
    const zip = new Zip();
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    
    // 1. 环境信息（脱敏）
    const envInfo = {
      timestamp: now.toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      env: process.env.NODE_ENV,
      // 关键环境变量（仅检查存在性，不泄露值）
      envVars: {
        PGDATABASE_URL: !!process.env.PGDATABASE_URL,
        DATABASE_URL: !!process.env.DATABASE_URL,
        GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
        APIMART_API_KEY: !!process.env.APIMART_API_KEY,
        COZE_API_KEY: !!process.env.COZE_API_KEY,
        COZE_PROJECT_ENV: !!process.env.COZE_PROJECT_ENV,
        PY_VECTORIZE_ENDPOINT: process.env.PY_VECTORIZE_ENDPOINT ? '(set)' : '(not set)',
      },
    };
    zip.file('environment.json', JSON.stringify(envInfo, null, 2));
    
    // 2. 最近日志的固定级别计数
    const logFiles = ['app.log', 'dev.log', 'console.log'];
    const logDir = '/app/work/logs/bypass/';
    const logSummary: Record<string, NonNullable<Awaited<ReturnType<typeof summarizeLog>>>> = {};
    for (const logName of logFiles) {
      try {
        const summary = await summarizeLog(join(logDir, logName));
        if (summary) logSummary[logName] = summary;
      } catch {
        // 忽略日志读取错误
      }
    }
    zip.file('logs/summary.json', JSON.stringify(logSummary, null, 2));
    
    // 3. 工作区文件结构概览（仅列目录，不读文件内容）
    try {
      const { readdirSync, lstatSync } = await import('fs');
      function listDir(dir: string, depth = 0, maxDepth = 2): string {
        if (depth > maxDepth) return '';
        let result = '';
        try {
          const items = readdirSync(dir);
          for (const item of items) {
            if (item === 'node_modules' || item === '.next' || item.startsWith('.')) continue;
            const fullPath = join(dir, item);
            try {
              const stat = lstatSync(fullPath);
              const indent = '  '.repeat(depth);
              if (stat.isDirectory()) {
                result += `${indent}${item}/\n`;
                result += listDir(fullPath, depth + 1, maxDepth);
              } else if (stat.isFile()) {
                result += `${indent}${item} (${Math.round(stat.size / 1024)}KB)\n`;
              }
            } catch {}
          }
        } catch {}
        return result;
      }
      const projectTree = listDir(join(process.cwd(), 'src'), 0, 3);
      zip.file('project-structure.txt', `Project source tree:\n\n${projectTree}`);
    } catch {}
    
    // 4. Package.json依赖信息
    try {
      const pkgPath = join(process.cwd(), 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
        const pkgInfo = {
          name: pkg.name,
          version: pkg.version,
          dependencies: Object.keys(pkg.dependencies || {}).sort(),
          devDependencies: Object.keys(pkg.devDependencies || {}).sort(),
        };
        zip.file('package-info.json', JSON.stringify(pkgInfo, null, 2));
      }
    } catch {}
    
    // 5. 诊断元数据
    zip.file('README.txt', `无界AI 诊断包\n生成时间: ${now.toLocaleString('zh-CN')}\n\n包含内容:\n- environment.json: 环境信息和配置状态\n- logs/summary.json: 最近日志的级别计数\n- project-structure.txt: 源码目录结构\n- package-info.json: 依赖信息\n`);
    
    // 生成zip
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    
    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="wujie-diagnostics-${timestamp}.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    console.error('[diagnostics/export] could not create archive');
    return NextResponse.json(
      { error: '导出诊断包失败' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
