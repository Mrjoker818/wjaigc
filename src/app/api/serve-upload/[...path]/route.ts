import { NextRequest, NextResponse } from 'next/server';
import { getServerDataRoot } from '@/lib/server-data-root';
import path from 'path';
import fs from 'fs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathParts } = await params;
    const filePath = pathParts.join('/');
    
    const dataRoot = getServerDataRoot();
    const possibleDirs = [
      path.join(dataRoot, 'uploads'),
      dataRoot, // root level for subdirs like outpaint/, upscale/
    ];
    
    for (const dir of possibleDirs) {
      const fullPath = path.join(dir, filePath);
      if (fs.existsSync(fullPath)) {
        const buffer = fs.readFileSync(fullPath);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = ext === '.png' ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.webp' ? 'image/webp'
          : ext === '.svg' ? 'image/svg+xml'
          : 'application/octet-stream';
        return new NextResponse(buffer, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }
    }
    
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  } catch (error) {
    console.error('serve-upload error:', error);
    return NextResponse.json({ error: 'Failed to serve file' }, { status: 500 });
  }
}
