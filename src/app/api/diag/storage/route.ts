import { NextRequest, NextResponse } from 'next/server';
import { getServerDataRoot } from '@/lib/server-data-root';
import { requireAdminUser } from '@/lib/server-auth';
import * as fs from 'fs';
import * as path from 'path';

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

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }

  try {
    const dataRoot = getServerDataRoot();
    const results: StorageDiagnostic = {
      dataRoot,
      directories: {},
      environment: {
        COZE_PROJECT_ENV: process.env.COZE_PROJECT_ENV || 'unknown',
        PERSISTENT_DIR: process.env.PERSISTENT_DIR || 'not set',
        HOME: process.env.HOME || 'not set',
      }
    };
    
    // List top-level contents of dataRoot
    try {
      const entries = fs.readdirSync(dataRoot, { withFileTypes: true });
      results.topLevel = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        size: e.isFile() ? fs.statSync(path.join(dataRoot, e.name)).size : undefined,
      }));
    } catch (e: unknown) {
      results.topLevelError = errorMessage(e);
    }
    
    // Check each subdirectory
    const dirsToCheck = ['uploads', 'images', 'image', 'generate', 'outpaint', 'upscale', 'video', 'svg-trace-tmp'];
    for (const dir of dirsToCheck) {
      const dirPath = path.join(dataRoot, dir);
      try {
        if (fs.existsSync(dirPath)) {
          const files = fs.readdirSync(dirPath);
          const fileCount = files.length;
          const sampleFiles = files.slice(0, 10);
          const totalSize = files.reduce((sum, f) => {
            try { return sum + fs.statSync(path.join(dirPath, f)).size; } catch { return sum; }
          }, 0);
          results.directories[dir] = {
            exists: true,
            fileCount,
            totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
            sampleFiles,
          };
          
          // Check subdirectories too
          const subdirs = files.filter(f => {
            try { return fs.statSync(path.join(dirPath, f)).isDirectory(); } catch { return false; }
          });
          for (const sub of subdirs.slice(0, 5)) {
            const subPath = path.join(dirPath, sub);
            try {
              const subFiles = fs.readdirSync(subPath);
              results.directories[`${dir}/${sub}`] = {
                exists: true,
                fileCount: subFiles.length,
                sampleFiles: subFiles.slice(0, 5),
              };
            } catch {}
          }
        } else {
          results.directories[dir] = { exists: false };
        }
      } catch (e: unknown) {
        results.directories[dir] = { error: errorMessage(e) };
      }
    }
    
    // Also check /space/ directly
    try {
      const spaceDir = '/space';
      if (fs.existsSync(spaceDir)) {
        const spaceEntries = fs.readdirSync(spaceDir, { withFileTypes: true });
        results.spaceDir = spaceEntries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'dir' : 'file',
        }));
        
        // Check /space/wujie-data/
        const wujieDataPath = '/space/wujie-data';
        if (fs.existsSync(wujieDataPath)) {
          const wdEntries = fs.readdirSync(wujieDataPath, { withFileTypes: true });
          results.wujieDataDir = wdEntries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'dir' : 'file',
          }));
        }
      }
    } catch (e: unknown) {
      results.spaceError = errorMessage(e);
    }
    
    // Check public/uploads
    try {
      const publicUploads = path.join(process.cwd(), 'public', 'uploads');
      if (fs.existsSync(publicUploads)) {
        const puFiles = fs.readdirSync(publicUploads);
        results.publicUploads = {
          fileCount: puFiles.length,
          sampleFiles: puFiles.slice(0, 10),
        };
      }
    } catch {}
    
    return NextResponse.json(results);
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
