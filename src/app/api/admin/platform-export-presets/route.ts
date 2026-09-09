import { NextRequest, NextResponse } from 'next/server';
import {
  createPlatformExportPresetVersion,
  listAllPlatformExportPresets,
  setPlatformExportPresetEnabled,
} from '@/lib/multi-platform-export/presets';
import type { CreatePlatformExportPresetVersionInput, ExportFormat } from '@/lib/multi-platform-export/types';
import { requireAdminUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const CREATE_FIELDS = new Set([
  'id', 'platform', 'usage', 'label', 'width', 'height',
  'recommendedFormat', 'supportsTransparency', 'enabled',
]);
const PATCH_FIELDS = new Set(['presetId', 'version', 'enabled']);
const EXPORT_FORMATS = new Set<ExportFormat>(['png', 'jpeg', 'webp']);
const POSTGRES_INTEGER_MAX = 2_147_483_647;

function errorResponse(status: number, code: string, error: string): NextResponse {
  return NextResponse.json({ success: false, code, error }, { status });
}

function domainErrorResponse(error: unknown): NextResponse {
  const code = (error as { code?: unknown })?.code;
  if (code === 'PLATFORM_EXPORT_PRESET_NOT_FOUND') {
    return errorResponse(404, code, 'Platform export preset version was not found');
  }
  if (code === 'PLATFORM_EXPORT_PRESET_VERSION_CONFLICT') {
    return errorResponse(409, code, 'Platform export preset version conflicts with another write');
  }
  return errorResponse(
    503,
    'PLATFORM_EXPORT_PRESET_STORAGE_UNAVAILABLE',
    'Platform export preset storage is unavailable',
  );
}

async function requireAdministrator(request: NextRequest): Promise<NextResponse | null> {
  const admin = await requireAdminUser(request);
  return admin ? null : errorResponse(403, 'ADMIN_REQUIRED', 'Administrator access required');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function parseCreateInput(value: unknown): CreatePlatformExportPresetVersionInput | null {
  if (!isPlainObject(value) || Object.keys(value).some(key => !CREATE_FIELDS.has(key))) return null;
  if (
    !boundedText(value.id, 64)
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)
    || !boundedText(value.platform, 64)
    || !boundedText(value.usage, 64)
    || !boundedText(value.label, 120)
    || !Number.isInteger(value.width) || Number(value.width) < 64 || Number(value.width) > 8192
    || !Number.isInteger(value.height) || Number(value.height) < 64 || Number(value.height) > 8192
    || typeof value.recommendedFormat !== 'string'
    || !EXPORT_FORMATS.has(value.recommendedFormat as ExportFormat)
    || typeof value.supportsTransparency !== 'boolean'
    || typeof value.enabled !== 'boolean'
  ) return null;
  return {
    id: value.id,
    platform: value.platform.trim(),
    usage: value.usage.trim(),
    label: value.label.trim(),
    width: value.width as number,
    height: value.height as number,
    recommendedFormat: value.recommendedFormat as ExportFormat,
    supportsTransparency: value.supportsTransparency,
    enabled: value.enabled,
  };
}

function parsePatchInput(value: unknown): { presetId: string; version: number; enabled: boolean } | null {
  if (!isPlainObject(value) || Object.keys(value).some(key => !PATCH_FIELDS.has(key))) return null;
  if (
    !boundedText(value.presetId, 64)
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.presetId)
    || !Number.isSafeInteger(value.version) || Number(value.version) < 1
    || Number(value.version) > POSTGRES_INTEGER_MAX
    || typeof value.enabled !== 'boolean'
  ) return null;
  return { presetId: value.presetId, version: value.version as number, enabled: value.enabled };
}

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const denied = await requireAdministrator(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ success: true, presets: await listAllPlatformExportPresets() });
  } catch (error) {
    return domainErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdministrator(request);
  if (denied) return denied;
  const input = parseCreateInput(await readJson(request));
  if (!input) return errorResponse(400, 'PLATFORM_EXPORT_PRESET_INVALID', 'Invalid platform export preset');
  try {
    const preset = await createPlatformExportPresetVersion(input);
    return NextResponse.json({ success: true, preset }, { status: 201 });
  } catch (error) {
    return domainErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await requireAdministrator(request);
  if (denied) return denied;
  const input = parsePatchInput(await readJson(request));
  if (!input) return errorResponse(400, 'PLATFORM_EXPORT_PRESET_INVALID', 'Invalid platform export preset update');
  try {
    const preset = await setPlatformExportPresetEnabled(input.presetId, input.version, input.enabled);
    return NextResponse.json({ success: true, preset });
  } catch (error) {
    return domainErrorResponse(error);
  }
}
