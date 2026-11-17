/**
 * 音频上传 API（视频生成的参考音频 / 数字人对口型音频）
 * POST /api/upload-audio  multipart/form-data, 字段名 file
 *
 * PearAPI 等视频接口要求素材是公网 HTTP(S) 地址，不支持 base64。
 * 优先存入对象存储并返回预签名地址；对象存储不可用时存到本地并补全公网域名。
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getS3PresignedUrl, uploadMediaToS3 } from '@/lib/s3-storage';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const AUDIO_TYPES: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
};
const AUDIO_EXTS = new Set(Object.values(AUDIO_TYPES));

function publicBase(): string {
  const raw = (process.env.COZE_PROJECT_DOMAIN_DEFAULT || '').replace(/\/+$/, '');
  if (!raw) return '';
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

export async function POST(req: NextRequest) {
  const authResult = await requireApiAuthOrReject(req);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: '请选择音频文件' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ success: false, error: '音频文件为空' }, { status: 400 });
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ success: false, error: '音频文件不能超过 30MB' }, { status: 400 });
    }

    const nameExt = (file.name.split('.').pop() || '').toLowerCase();
    const ext = AUDIO_TYPES[file.type] || (AUDIO_EXTS.has(nameExt) ? nameExt : '');
    if (!ext) {
      return NextResponse.json({ success: false, error: '仅支持 mp3 / wav / m4a / aac / ogg / webm / flac 音频' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = `ref_audio_${Date.now()}_${randomUUID().slice(0, 8)}.${ext}`;
    const contentType = file.type || `audio/${ext === 'mp3' ? 'mpeg' : ext}`;

    // 1. 对象存储 → 预签名公网地址（7 天有效，足够覆盖一次视频任务）
    const key = await uploadMediaToS3(buffer, filename, contentType, 'audio');
    if (key) {
      const url = await getS3PresignedUrl(key);
      if (url) {
        return NextResponse.json({ success: true, url, key, filename, size: buffer.length });
      }
    }

    // 2. 兜底：本地 public 目录 + 公网域名
    const base = publicBase();
    if (!base) {
      return NextResponse.json({ success: false, error: '音频存储不可用，且未配置公网域名' }, { status: 500 });
    }
    const dir = path.join(process.cwd(), 'public', 'generated-audio');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), buffer);
    return NextResponse.json({
      success: true,
      url: `${base}/generated-audio/${filename}`,
      filename,
      size: buffer.length,
    });
  } catch (error: unknown) {
    console.error('[upload-audio] failed:', error);
    return NextResponse.json({ success: false, error: '音频上传失败，请重试' }, { status: 500 });
  }
}
