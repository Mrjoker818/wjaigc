import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const serveUpload = readFileSync(path.resolve(root, 'src/app/api/serve-upload/[...path]/route.ts'), 'utf8');
const upload = readFileSync(path.resolve(root, 'src/app/api/upload/route.ts'), 'utf8');
const saveImage = readFileSync(path.resolve(root, 'src/app/api/save-image/route.ts'), 'utf8');
const mediaValidation = readFileSync(path.resolve(root, 'src/lib/media-validation.ts'), 'utf8');

describe('public media access security contract', () => {
  it('allows only public media paths before reading the server data root', () => {
    const routeHandler = serveUpload.slice(serveUpload.indexOf('export async function GET'));
    const guardIndex = routeHandler.indexOf('isAllowedPublicMediaPath(pathParts)');
    const dataRootIndex = routeHandler.indexOf('const dataRoot = getServerDataRoot()');

    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(dataRootIndex).toBeGreaterThan(guardIndex);
    expect(routeHandler).not.toContain('dataRoot, // root level');
    expect(routeHandler).toContain("return NextResponse.json({ error: 'File not found' }, { status: 404 });");
  });

  it('fails closed when an exact recovery URL cannot be verified', () => {
    const routeHandler = serveUpload.slice(serveUpload.indexOf('export async function GET'));
    const recoveryReadIndex = routeHandler.indexOf('readExactRecoveryMedia(filePath)');
    const recoveryMissIndex = routeHandler.indexOf('if (isRecoveryPath)');
    const dataRootIndex = routeHandler.indexOf('const dataRoot = getServerDataRoot()');

    expect(recoveryReadIndex).toBeGreaterThanOrEqual(0);
    expect(recoveryMissIndex).toBeGreaterThan(recoveryReadIndex);
    expect(dataRootIndex).toBeGreaterThan(recoveryMissIndex);
  });

  it('never serves stored SVG as active same-origin content', () => {
    expect(serveUpload).not.toContain("ext === '.svg' ? 'image/svg+xml'");
    expect(serveUpload).toMatch(/Content-Disposition.*attachment/);
    expect(serveUpload).toContain("'X-Content-Type-Options': 'nosniff'");
  });

  it('rejects SVG uploads and derives file extensions from a safe MIME allowlist', () => {
    expect(upload).not.toContain("'image/svg+xml':");
    expect(upload).toContain("getSafeRasterImageExtension(file.type)");
  });

  it('validates multipart, data-URL, and fetched image content before persistence', () => {
    expect(saveImage).toContain('validateSafeMediaFile(file, buffer)');
    expect(saveImage).toContain('getSafeImageTypeFromDataUrl(imageUrl)');
    expect(saveImage).toContain('getSafeMediaTypeFromResponse(contentType, buffer, isVideo)');
  });

  it('keeps JPEG uploads on the canonical S3 content type after extension normalization', () => {
    expect(saveImage).toContain("finalMimeType === 'jpeg' || finalMimeType === 'jpg' ? 'image/jpeg'");
  });

  it('accepts a signature-verified video response even when its URL has no file extension', () => {
    expect(mediaValidation).not.toContain('if (!isVideo || !video) return null;');
    expect(mediaValidation).toContain("if (!video || (!isVideo && !mimeType.startsWith('video/'))) return null;");
  });

  it('keeps JSON and ZIP out of the generic public image/media allowlist', () => {
    expect(mediaValidation).not.toMatch(/['"]\.json['"]/);
    expect(mediaValidation).not.toMatch(/['"]\.zip['"]/);
  });
});
