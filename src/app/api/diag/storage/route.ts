import { execFileSync } from 'node:child_process';
import { NextRequest, NextResponse } from 'next/server';
import { getServerDataRoot } from '@/lib/server-data-root';
import { requireAdminUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

interface StorageDiagnostic {
  dataRoot: string;
  directories: Record<string, unknown>;
  environment: Record<string, string>;
  topLevel?: unknown;
  topLevelError?: string;
  spaceDir?: unknown;
  wujieDataDir?: unknown;
  spaceError?: string;
  publicUploads?: unknown;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Keep diagnostic enumeration in a separate process so production route tracing
// does not treat the dynamic data root as the project source tree.
const STORAGE_PROBE = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const dataRoot = process.argv[1];
const projectRoot = process.argv[2];
const result = { directories: {} };
const errorMessage = error => error instanceof Error ? error.message : String(error);
try {
  const entries = fs.readdirSync(dataRoot, { withFileTypes: true });
  result.topLevel = entries.map(entry => ({
    name: entry.name,
    type: entry.isDirectory() ? 'dir' : 'file',
    size: entry.isFile() ? fs.statSync(path.join(dataRoot, entry.name)).size : undefined,
  }));
} catch (error) {
  result.topLevelError = errorMessage(error);
}
const dirsToCheck = ['uploads', 'images', 'image', 'generate', 'outpaint', 'upscale', 'video', 'svg-trace-tmp'];
for (const dir of dirsToCheck) {
  const dirPath = path.join(dataRoot, dir);
  try {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      const totalSize = files.reduce((sum, file) => {
        try { return sum + fs.statSync(path.join(dirPath, file)).size; } catch { return sum; }
      }, 0);
      result.directories[dir] = {
        exists: true,
        fileCount: files.length,
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
        sampleFiles: files.slice(0, 10),
      };
      const subdirs = files.filter(file => {
        try { return fs.statSync(path.join(dirPath, file)).isDirectory(); } catch { return false; }
      });
      for (const sub of subdirs.slice(0, 5)) {
        const subPath = path.join(dirPath, sub);
        try {
          const subFiles = fs.readdirSync(subPath);
          result.directories[dir + '/' + sub] = {
            exists: true,
            fileCount: subFiles.length,
            sampleFiles: subFiles.slice(0, 5),
          };
        } catch {}
      }
    } else {
      result.directories[dir] = { exists: false };
    }
  } catch (error) {
    result.directories[dir] = { error: errorMessage(error) };
  }
}
try {
  const spaceDir = '/space';
  if (fs.existsSync(spaceDir)) {
    const entries = fs.readdirSync(spaceDir, { withFileTypes: true });
    result.spaceDir = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'dir' : 'file',
    }));
    const wujieDataPath = '/space/wujie-data';
    if (fs.existsSync(wujieDataPath)) {
      const dataEntries = fs.readdirSync(wujieDataPath, { withFileTypes: true });
      result.wujieDataDir = dataEntries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'dir' : 'file',
      }));
    }
  }
} catch (error) {
  result.spaceError = errorMessage(error);
}
try {
  const publicUploads = path.join(projectRoot, 'public', 'uploads');
  if (fs.existsSync(publicUploads)) {
    const files = fs.readdirSync(publicUploads);
    result.publicUploads = { fileCount: files.length, sampleFiles: files.slice(0, 10) };
  }
} catch {}
process.stdout.write(JSON.stringify(result));
`;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminUser(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }

  try {
    const dataRoot = getServerDataRoot();
    const inspected = JSON.parse(execFileSync(process.execPath, [
      '-e', STORAGE_PROBE, dataRoot, process.cwd(),
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true })) as Omit<StorageDiagnostic, 'dataRoot' | 'environment'>;
    const results: StorageDiagnostic = {
      dataRoot,
      ...inspected,
      environment: {
        COZE_PROJECT_ENV: process.env.COZE_PROJECT_ENV || 'unknown',
        PERSISTENT_DIR: process.env.PERSISTENT_DIR || 'not set',
        HOME: process.env.HOME || 'not set',
      },
    };
    return NextResponse.json(results);
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
