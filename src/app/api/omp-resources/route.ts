import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// API route to serve Oh My Prompt resource library data
// Strategy: Use build-time bundled data (via category-registry) as the primary source,
// falling back to disk files only if available. This ensures data is available in all
// deployment environments, including FaaS where public/ may not be on disk.

// Build-time bundled index and category data (always available)
import indexDataFromBundle from '@/data/omp-resources/index.json';
import { getCategoryData } from '@/data/omp-resources/category-registry';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const catId = searchParams.get('cat');

    // If catId is provided, return specific category data
    if (catId) {
      // Primary: use bundled category data (always available)
      const bundledData = getCategoryData(catId);
      if (bundledData) {
        return NextResponse.json(bundledData, {
          headers: { 'Cache-Control': 'public, max-age=3600' },
        });
      }

      // Fallback: try disk (in case new categories were added after build)
      const diskDir = findDataDir();
      if (diskDir) {
        const catFile = join(diskDir, 'categories', `${catId}.json`);
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

    // Return the index — prefer bundled (always available)
    return NextResponse.json(indexDataFromBundle, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (error) {
    console.error('[omp-resources API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load resource data' },
      { status: 500 }
    );
  }
}

// ===== Disk fallback helpers =====

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
