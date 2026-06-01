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
    join(process.cwd(), 'public', 'data', 'omp-resources'),
    join(process.cwd(), 'src', 'data', 'omp-resources'),
  ];
  for (const dir of candidates) {
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

// Cached index data (loaded once, reused across requests)
let cachedIndexData: Record<string, unknown> | null = null;

function getIndexData(): Record<string, unknown> | null {
  if (cachedIndexData !== null) return cachedIndexData;
  const dir = findDataDir();
  if (dir) {
    try {
      const raw = readFileSync(join(dir, 'index.json'), 'utf-8');
      cachedIndexData = JSON.parse(raw);
      return cachedIndexData;
    } catch (err) {
      console.error('[omp-resources] Error reading index.json:', err);
    }
  }
  cachedIndexData = null;
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
