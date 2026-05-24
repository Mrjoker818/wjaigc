import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

const HELP_IMAGES_DIR = path.join(process.cwd(), 'public', 'images', 'help');

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get('file');

  if (!file) {
    return NextResponse.json({ error: 'Missing file parameter' }, { status: 400 });
  }

  // Security: only allow alphanumeric filenames with common image extensions
  if (!/^[a-zA-Z0-9_-]+\.(jpeg|jpg|png|webp|gif)$/i.test(file)) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }

  try {
    const filePath = path.join(HELP_IMAGES_DIR, file);
    const buffer = await readFile(filePath);

    const ext = path.extname(file).toLowerCase();
    const contentType = ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif'
      : 'image/jpeg';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }
}
