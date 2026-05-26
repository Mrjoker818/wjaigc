import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * Gallery image API
 * 
 * Priority:
 * 1. Serve local extracted images (from embedded markdown extraction)
 * 2. Serve cached images (from previous proxy downloads)
 * 3. Return SVG placeholder
 * 
 * GET /api/font-design/gallery-image?id=g1
 */

const GALLERY_DIR = path.join(process.cwd(), 'public', 'gallery');

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
    }

    // Load gallery data to find the item
    const dataPath = path.join(GALLERY_DIR, 'data.json');
    if (!fs.existsSync(dataPath)) {
      return NextResponse.json({ error: 'Gallery data not found' }, { status: 404 });
    }

    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const item = data.items.find((i: Record<string, string>) => i.id === id);
    
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Priority 1: Check localPath (extracted from embedded markdown images)
    if (item.localPath) {
      const localFilePath = path.join(process.cwd(), 'public', item.localPath);
      if (fs.existsSync(localFilePath)) {
        const stat = fs.statSync(localFilePath);
        if (stat.size > 100) {
          const buffer = fs.readFileSync(localFilePath);
          const ext = path.extname(localFilePath).slice(1).toLowerCase();
          const contentType = MIME_MAP[ext] || 'image/jpeg';
          return new NextResponse(buffer, {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=604800', // 7 days - images are permanent
              'Content-Length': buffer.length.toString(),
            },
          });
        }
      }
    }

    // Priority 2: Check cache directory (from previous proxy downloads)
    const cachePath = path.join(GALLERY_DIR, 'cache', item.category, `${id}.webp`);
    if (fs.existsSync(cachePath)) {
      const stat = fs.statSync(cachePath);
      if (stat.size > 1000) {
        const buffer = fs.readFileSync(cachePath);
        return new NextResponse(buffer, {
          headers: {
            'Content-Type': 'image/webp',
            'Cache-Control': 'public, max-age=604800',
            'Content-Length': buffer.length.toString(),
          },
        });
      }
    }

    // Priority 3: Return SVG placeholder with the display text
    const text = item.displayText || item.categoryName || '?';
    const escapedText = text.substring(0, 8).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedCat = (item.categoryName || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
      <rect width="400" height="200" fill="#1a1a1a"/>
      <text x="200" y="100" font-family="sans-serif" font-size="28" fill="#d4af37" text-anchor="middle" dominant-baseline="middle">${escapedText}</text>
      <text x="200" y="140" font-family="sans-serif" font-size="12" fill="#888" text-anchor="middle">${escapedCat}</text>
    </svg>`;
    
    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    console.error('Gallery image API error:', error);
    return NextResponse.json({ error: 'Failed to load image' }, { status: 500 });
  }
}
