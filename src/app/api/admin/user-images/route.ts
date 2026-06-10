import { NextRequest, NextResponse } from 'next/server';
import { dbGetUserData } from '@/lib/db-storage';

interface ImageRecord {
  id: string;
  url: string;
  prompt?: string;
  model?: string;
  quality?: string;
  aspectRatio?: string;
  size?: string;
  createdAt: number;
  projectId: string;
  projectName: string;
  originalWidth?: number;
  originalHeight?: number;
  duration?: number;
  source: 'generated' | 'uploaded' | 'edited' | 'unknown';
  modifyPrompt?: string;
  category?: string;
  apiProvider?: string;
}

/** 从图片数据推断来源类型 */
function inferSource(img: Record<string, unknown>): ImageRecord['source'] {
  const id = (img.id as string) || '';
  const url = (img.url as string) || '';
  if (id.startsWith('gen-')) return 'generated';
  // 优先根据 URL 路径判断
  if (url.includes('/gen-') || url.includes('/generated/')) return 'generated';
  if (url.includes('/upload-') || url.includes('/uploaded/')) return 'uploaded';
  // 根据 model 或 prompt 判断（非空字符串视为生成图）
  if ((typeof img.model === 'string' && img.model.trim()) || (typeof img.prompt === 'string' && img.prompt.trim())) return 'generated';
  if (id.startsWith('processing-')) return 'edited';
  return 'unknown';
}

/** 从图片URL中提取时间戳（作为更准确的生成时间） */
function extractTimestampFromUrl(url: string, fallback: number): number {
  // 匹配 URL 中的时间戳模式：gen-1234567890-xxx 或 upload-1234567890-xxx
  const match = url.match(/(?:gen|upload|img_)(\d{10,13})/);
  if (match) {
    const ts = parseInt(match[1], 10);
    // 如果时间戳是13位（毫秒），直接返回；如果是10位（秒），转为毫秒
    return ts > 1e12 ? ts : ts * 1000;
  }
  return fallback;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const source = searchParams.get('source') || ''; // 'generated' | 'uploaded' | '' (all)

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // 从 wujie_user_data 读取用户的项目数据
    const projectData = await dbGetUserData(userId, 'projects');
    if (!projectData) {
      return NextResponse.json({ images: [], total: 0, page, pageSize });
    }

    // 解析项目数据
    let projects: Array<Record<string, unknown>> = [];
    if (typeof projectData === 'string') {
      try { projects = JSON.parse(projectData); } catch { /* ignore */ }
    } else if (Array.isArray(projectData)) {
      projects = projectData;
    }

    // 收集所有图片
    const allImages: ImageRecord[] = [];
    for (const project of projects) {
      const projectId = (project.id as string) || '';
      const projectName = (project.name as string) || '未命名项目';
      const canvasImages = project.canvasImages;
      if (!Array.isArray(canvasImages)) continue;

      for (const imgRaw of canvasImages) {
        const img = imgRaw as Record<string, unknown>;
        const imgSource = inferSource(img);

        // 如果指定了来源过滤，跳过不匹配的
        if (source && imgSource !== source && source !== 'unknown') continue;

        const url = (img.url as string) || '';
        const createdAtFallback = (img.createdAt as number) || 0;
        // 优先从 URL 提取时间戳，回退到 createdAt 字段
        const createdAt = extractTimestampFromUrl(url, createdAtFallback);

        allImages.push({
          id: (img.id as string) || '',
          url,
          prompt: (img.prompt as string) || undefined,
          model: (img.model as string) || undefined,
          quality: (img.quality as string) || undefined,
          aspectRatio: (img.aspectRatio as string) || undefined,
          size: (img.size as string) || undefined,
          createdAt,
          projectId,
          projectName,
          originalWidth: (img.originalWidth as number) || undefined,
          originalHeight: (img.originalHeight as number) || undefined,
          duration: (img.duration as number) || undefined,
          source: imgSource,
          modifyPrompt: (img.modifyPrompt as string) || undefined,
          category: (img.category as string) || undefined,
          apiProvider: (img.apiProvider as string) || (img.apiBaseUrl as string) || undefined,
        });
      }
    }

    // 按创建时间降序排列
    allImages.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // 分页
    const total = allImages.length;
    const start = (page - 1) * pageSize;
    const images = allImages.slice(start, start + pageSize);

    // 统计信息
    const stats = {
      total: allImages.length,
      generated: allImages.filter(i => i.source === 'generated').length,
      uploaded: allImages.filter(i => i.source === 'uploaded').length,
      edited: allImages.filter(i => i.source === 'edited').length,
    };

    return NextResponse.json({ images, total, page, pageSize, stats });
  } catch (error) {
    console.error('[admin/user-images] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch user images' }, { status: 500 });
  }
}
