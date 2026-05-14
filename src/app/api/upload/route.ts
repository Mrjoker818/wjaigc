import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });
    }

    // Validate file size (max 20MB)
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Generate unique filename
    const ext = file.name.split('.').pop() || 'png';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const filename = `upload-${timestamp}-${random}.${ext}`;

    const { saveImageFile } = await import('@/lib/server-data-root');
    const url = await saveImageFile(buffer, filename, 'uploads');

    return NextResponse.json({
      success: true,
      url,
      filename,
      size: file.size,
      type: file.type,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    console.error('Upload error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
