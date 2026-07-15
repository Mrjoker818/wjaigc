/**
 * 诊断包导出 API
 * GET /api/diagnostics/export
 * 收集应用状态、配置摘要、最近日志（脱敏API Key），打包为zip下载
 */

import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
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

/** 脱敏字符串（保留首尾字符） */
function maskString(s: string, keepStart = 4, keepEnd = 4): string {
  if (!s || s.length < keepStart + keepEnd + 2) return '***';
  return `${s.slice(0, keepStart)}${'*'.repeat(Math.max(4, s.length - keepStart - keepEnd))}${s.slice(-keepEnd)}`;
}

/** 脱敏对象中的API Key等敏感字段 */
function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['api_key', 'apikey', 'apiKey', 'key', 'secret', 'password', 'token', 'authorization'];
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (sensitiveKeys.some(sk => k.toLowerCase().includes(sk.toLowerCase()))) {
      result[k] = typeof v === 'string' ? maskString(v) : '***';
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      result[k] = sanitizeObject(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      result[k] = v.map(item => typeof item === 'object' && item !== null ? sanitizeObject(item as Record<string, unknown>) : item);
    } else {
      result[k] = v;
    }
  }
  return result;
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
      cozeEnv: process.env.COZE_PROJECT_ENV,
      // 关键环境变量（仅检查存在性，不泄露值）
      envVars: {
        PGDATABASE_URL: !!process.env.PGDATABASE_URL,
        DATABASE_URL: !!process.env.DATABASE_URL,
        GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
        APIMART_API_KEY: !!process.env.APIMART_API_KEY,
        COZE_API_KEY: !!process.env.COZE_API_KEY,
        LOCAL_AI_ENABLED: process.env.LOCAL_AI_ENABLED,
        IOPAINT_BASE_URL: process.env.IOPAINT_BASE_URL ? '(set)' : '(not set)',
        PY_VECTORIZE_ENDPOINT: process.env.PY_VECTORIZE_ENDPOINT ? '(set)' : '(not set)',
      },
    };
    zip.file('environment.json', JSON.stringify(envInfo, null, 2));
    
    // 2. 最近应用日志（读取/app/work/logs/bypass/目录）
    const logFiles = ['app.log', 'dev.log', 'console.log'];
    const logDir = '/app/work/logs/bypass/';
    for (const logName of logFiles) {
      try {
        const logPath = join(logDir, logName);
        if (existsSync(logPath)) {
          const content = await readFile(logPath, 'utf-8');
          // 取最后2000行，避免过大
          const lines = content.split('\n');
          const tailLines = lines.slice(-2000).join('\n');
          // 脱敏：替换可能的API Key（sk-xxx, key=xxx格式）
          const sanitized = tailLines
            .replace(/sk-[a-zA-Z0-9]{20,}/g, m => maskString(m, 6, 4))
            .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)([a-zA-Z0-9_-]{20,})/gi, (_, p1, p2) => p1 + maskString(p2, 4, 4))
            .replace(/(Bearer\s+)([a-zA-Z0-9._-]{20,})/gi, (_, p1, p2) => p1 + maskString(p2, 6, 4));
          zip.file(`logs/${logName}`, sanitized);
        }
      } catch {
        // 忽略日志读取错误
      }
    }
    
    // 3. 工作区文件结构概览（仅列目录，不读文件内容）
    try {
      const { readdirSync, statSync } = await import('fs');
      function listDir(dir: string, depth = 0, maxDepth = 2): string {
        if (depth > maxDepth) return '';
        let result = '';
        try {
          const items = readdirSync(dir);
          for (const item of items) {
            if (item === 'node_modules' || item === '.next' || item.startsWith('.')) continue;
            const fullPath = join(dir, item);
            try {
              const stat = statSync(fullPath);
              const indent = '  '.repeat(depth);
              if (stat.isDirectory()) {
                result += `${indent}${item}/\n`;
                result += listDir(fullPath, depth + 1, maxDepth);
              } else {
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
    zip.file('README.txt', `无界AI 诊断包\n生成时间: ${now.toLocaleString('zh-CN')}\n\n包含内容:\n- environment.json: 环境信息（已脱敏）\n- logs/: 最近日志（已脱敏API Key）\n- project-structure.txt: 源码目录结构\n- package-info.json: 依赖信息\n\n所有敏感信息已自动脱敏。\n`);
    
    // 生成zip
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    
    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="wujie-diagnostics-${timestamp}.zip"`,
      },
    });
  } catch (error) {
    console.error('[diagnostics/export] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '导出诊断包失败' },
      { status: 500 }
    );
  }
}
