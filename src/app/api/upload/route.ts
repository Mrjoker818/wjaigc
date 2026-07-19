import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getRuntimeSettings } from '@/lib/runtime-settings';
import { getSafeRasterImageExtension, validateSafeMediaFile } from '@/lib/media-validation';

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const runtimeSettings = await getRuntimeSettings();
    const maxBytes = runtimeSettings.imageMaxSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      return NextResponse.json({ error: `File too large (max ${runtimeSettings.imageMaxSizeMB}MB)` }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const safeMedia = validateSafeMediaFile(file, buffer);
    if (!safeMedia) {
      return NextResponse.json({ error: 'File content does not match image format' }, { status: 400 });
    }

    // Generate unique filename
    const ext = getSafeRasterImageExtension(file.type);
    if (!ext) {
      return NextResponse.json({ error: 'Only supported raster image files are allowed' }, { status: 400 });
    }
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
