import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * Gallery image proxy/download API
 * Fetches images from jimeng.jianying.com detail pages and caches them locally
 * 
 * GET /api/font-design/gallery-image?id=g1
 * - Checks local cache first
 * - If not cached, scrapes the source URL to get the image
 * - Downloads and caches the image locally
 * - Returns the image
 */

const GALLERY_DIR = path.join(process.cwd(), 'public', 'gallery');
const CACHE_DIR = path.join(GALLERY_DIR, 'cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function getCachePath(id: string, category: string): string {
  const catDir = path.join(CACHE_DIR, category);
  if (!fs.existsSync(catDir)) {
    fs.mkdirSync(catDir, { recursive: true });
  }
  return path.join(catDir, `${id}.webp`);
}

async function fetchImageFromSource(sourceUrl: string): Promise<Buffer | null> {
  try {
    // Fetch the detail page
    const resp = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(15000),
    });
    
    if (!resp.ok) return null;
    
    const html = await resp.text();
    
    // Try to extract image URL from the page
    // Jimeng pages contain image URLs in JSON data or og:image meta tags
    const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
    if (ogMatch) {
      const imgUrl = ogMatch[1].replace(/&amp;/g, '&');
      const imgResp = await fetch(imgUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://jimeng.jianying.com/',
        },
        signal: AbortSignal.timeout(30000),
      });
      if (imgResp.ok) {
        return Buffer.from(await imgResp.arrayBuffer());
      }
    }

    // Try to find image URL in JSON data
    const jsonImgMatch = html.match(/"(https?:\/\/[^"]*(?:dreamina|toutiaoimg|byteimg)[^"]*\.(?:webp|jpg|png)[^"]*)"/);
    if (jsonImgMatch) {
      const imgUrl = jsonImgMatch[1].replace(/\\u002F/g, '/').replace(/&amp;/g, '&');
      const imgResp = await fetch(imgUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://jimeng.jianying.com/',
        },
        signal: AbortSignal.timeout(30000),
      });
      if (imgResp.ok) {
        return Buffer.from(await imgResp.arrayBuffer());
      }
    }

    return null;
  } catch (error) {
    console.error('fetchImageFromSource error:', error);
    return null;
  }
}

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

    // Check local cache
    const cachePath = getCachePath(id, item.category);
    if (fs.existsSync(cachePath)) {
      const stat = fs.statSync(cachePath);
      if (stat.size > 1000) { // Valid cached image (>1KB)
        const buffer = fs.readFileSync(cachePath);
        return new NextResponse(buffer, {
          headers: {
            'Content-Type': 'image/webp',
            'Cache-Control': 'public, max-age=86400',
            'Content-Length': buffer.length.toString(),
          },
        });
      }
    }

    // Not cached - try to fetch from source
    if (item.sourceUrl) {
      const imageBuffer = await fetchImageFromSource(item.sourceUrl);
      
      if (imageBuffer && imageBuffer.length > 1000) {
        // Cache the image
        fs.writeFileSync(cachePath, imageBuffer);
        
        return new NextResponse(new Uint8Array(imageBuffer), {
          headers: {
            'Content-Type': 'image/webp',
            'Cache-Control': 'public, max-age=86400',
            'Content-Length': imageBuffer.length.toString(),
          },
        });
      }
    }

    // If we can't fetch the image, return a placeholder
    // Generate a simple SVG placeholder with the display text
    const text = item.displayText || item.categoryName || '?';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
      <rect width="400" height="200" fill="#1a1a1a"/>
      <text x="200" y="100" font-family="sans-serif" font-size="28" fill="#d4af37" text-anchor="middle" dominant-baseline="middle">${text.substring(0, 8)}</text>
      <text x="200" y="140" font-family="sans-serif" font-size="12" fill="#888" text-anchor="middle">${item.categoryName}</text>
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
