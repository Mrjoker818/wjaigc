import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

// API route to serve Oh My Prompt resource library data
// This ensures resources are available in both dev and deployed environments,
// even if the public/ directory's static files are not served by the hosting platform.

const DATA_DIR = join(process.cwd(), 'public', 'data', 'omp-resources');

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const catId = searchParams.get('cat');

    // If catId is provided, return specific category data
    if (catId) {
      const catFile = join(DATA_DIR, 'categories', `${catId}.json`);
      if (!existsSync(catFile)) {
        return NextResponse.json({ error: 'Category not found' }, { status: 404 });
      }
      const data = JSON.parse(readFileSync(catFile, 'utf-8'));
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'public, max-age=3600' },
      });
    }

    // Otherwise return the index
    const indexFile = join(DATA_DIR, 'index.json');
    if (!existsSync(indexFile)) {
      return NextResponse.json({ error: 'Resource index not found' }, { status: 404 });
    }
    const indexData = JSON.parse(readFileSync(indexFile, 'utf-8'));
    return NextResponse.json(indexData, {
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
