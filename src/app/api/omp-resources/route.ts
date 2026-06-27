import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// API route to serve Oh My Prompt resource library data
// Strategy: Runtime file reading from disk — works in all deployment environments
// (dev, production, FaaS) without relying on build-time bundling of JSON/TS modules.

// Cached data directory path
let cachedDataDir: string | null | undefined = undefined;

function findDataDir(): string | null {
  if (cachedDataDir !== undefined) return cachedDataDir;
  const candidates = [
    // Standard Next.js layout: process.cwd() == project root
    join(process.cwd(), 'public', 'data', 'omp-resources'),
    // Alternative: src directory
    join(process.cwd(), 'src', 'data', 'omp-resources'),
    // Coze deployment: may run from /app/ with .next/ output
    join(process.cwd(), '.next', 'static', 'data', 'omp-resources'),
    // Standalone output: server.js in .next/standalone/
    join(process.cwd(), 'public', 'data', 'omp-resources'),
  ];
  // Also check COZE_WORKSPACE_PATH env var for the project root
  const cozeWorkspace = process.env.COZE_WORKSPACE_PATH;
  if (cozeWorkspace) {
    candidates.push(
      join(cozeWorkspace, 'public', 'data', 'omp-resources'),
      join(cozeWorkspace, 'src', 'data', 'omp-resources'),
    );
  }
  // Deduplicate
  const uniqueCandidates = [...new Set(candidates)];
  for (const dir of uniqueCandidates) {
    try {
      if (existsSync(join(dir, 'index.json'))) {
        cachedDataDir = dir;
        return dir;
      }
    } catch { /* skip */ }
  }
  cachedDataDir = null;
  return null;
}

// Cached index data with TTL (5 minutes)
let cachedIndexData: Record<string, unknown> | null = null;
let cachedIndexTime = 0;
const INDEX_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getIndexData(): Record<string, unknown> | null {
  const now = Date.now();
  if (cachedIndexData !== null && now - cachedIndexTime < INDEX_CACHE_TTL) return cachedIndexData;
  const dir = findDataDir();
  if (dir) {
    try {
      const raw = readFileSync(join(dir, 'index.json'), 'utf-8');
      cachedIndexData = JSON.parse(raw);
      cachedIndexTime = now;
      return cachedIndexData;
    } catch (err) {
      console.error('[omp-resources] Error reading index.json:', err);
    }
  }
  cachedIndexData = null;
  cachedIndexTime = 0;
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const catId = searchParams.get('cat');

    // If catId is provided, return specific category data
    if (catId) {
      // Read category data from disk
      const dir = findDataDir();
      if (dir) {
        const catFile = join(dir, 'categories', `${catId}.json`);
        try {
          if (existsSync(catFile)) {
            const data = JSON.parse(readFileSync(catFile, 'utf-8'));
            return NextResponse.json(data, {
              headers: { 'Cache-Control': 'public, max-age=3600' },
            });
          }
        } catch (readErr) {
          console.error(`[omp-resources] Error reading category '${catId}' from disk:`, readErr);
        }
      }

      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    // Return the index
    const indexData = getIndexData();
    if (indexData) {
      return NextResponse.json(indexData, {
        headers: { 'Cache-Control': 'public, max-age=3600' },
      });
    }

    return NextResponse.json({ error: 'Resource data not available' }, { status: 503 });
  } catch (error) {
    console.error('[omp-resources API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load resource data' },
      { status: 500 }
    );
  }
}
