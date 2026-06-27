import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser, listManagedUsers } from '@/lib/server-auth';
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
  userId?: string;
  userName?: string;
}

/** 从图片数据推断来源类型 */
function inferSource(img: Record<string, unknown>): ImageRecord['source'] {
  const id = (img.id as string) || '';
  const url = (img.url as string) || '';
  if (id.startsWith('gen-')) return 'generated';
  if (url.includes('/gen-') || url.includes('/generated/')) return 'generated';
  if (url.includes('/upload-') || url.includes('/uploaded/')) return 'uploaded';
  if ((typeof img.model === 'string' && img.model.trim()) || (typeof img.prompt === 'string' && img.prompt.trim())) return 'generated';
  if (id.startsWith('processing-')) return 'edited';
  return 'unknown';
}

/** 从图片URL中提取时间戳 */
function extractTimestampFromUrl(url: string, fallback: number): number {
  const match = url.match(/(?:gen|upload|img_)(\d{10,13})/);
  if (match) {
    const ts = parseInt(match[1], 10);
    return ts > 1e12 ? ts : ts * 1000;
  }
  return fallback;
}

/** 从单个用户的项目数据中提取图片 */
function extractImagesFromProjects(
  projects: Array<Record<string, unknown>>,
  userId: string,
  userName: string,
  sourceFilter: string
): ImageRecord[] {
  const images: ImageRecord[] = [];
  for (const project of projects) {
    const projectId = (project.id as string) || '';
    const projectName = (project.name as string) || '未命名项目';
    const canvasImages = project.canvasImages;
    if (!Array.isArray(canvasImages)) continue;

    for (const imgRaw of canvasImages) {
      const img = imgRaw as Record<string, unknown>;
      const imgSource = inferSource(img);

      if (sourceFilter && imgSource !== sourceFilter && sourceFilter !== 'unknown') continue;

      const url = (img.url as string) || '';
      const createdAtFallback = (img.createdAt as number) || 0;
      const createdAt = extractTimestampFromUrl(url, createdAtFallback);

      images.push({
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
        userId,
        userName,
      });
    }
  }
  return images;
}

/**
 * GET /api/admin/user-images
 *
 * 管理员数据管理接口，支持两种模式：
 * 1. 指定 userId → 查看该用户的图片
 * 2. 不指定 userId → 查看所有用户的图片（管理员模式）
 *
 * Query params:
 * - userId: 用户ID（可选，不传则查全部）
 * - page: 页码（默认1）
 * - pageSize: 每页数量（默认20）
 * - source: 来源过滤 'generated'|'uploaded'|'edited'|'' (all)
 * - search: 搜索关键词（匹配prompt/model）
 * - startDate: 起始日期 (ISO string)
 * - endDate: 结束日期 (ISO string)
 */
export async function GET(request: NextRequest) {
  try {
    // 验证管理员权限
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const specificUserId = searchParams.get('userId') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '20', 10), 100);
    const source = searchParams.get('source') || '';
    const search = searchParams.get('search') || '';
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';

    const startTime = startDate ? new Date(startDate).getTime() : 0;
    const endTime = endDate ? new Date(endDate).getTime() : Date.now() + 86400000;

    // 获取用户列表
    const users = await listManagedUsers();
    const userMap = new Map((users || []).map(u => [u.id, u.name || u.id]));

    // 确定要查询的用户
    const targetUsers = specificUserId
      ? (users || []).filter(u => u.id === specificUserId)
      : (users || []);

    // 收集所有图片
    const allImages: ImageRecord[] = [];
    const userStats: Array<{
      userId: string;
      userName: string;
      totalImages: number;
      generated: number;
      uploaded: number;
      edited: number;
      projectCount: number;
    }> = [];

    for (const user of targetUsers) {
      try {
        const projectData = await dbGetUserData(user.id, 'projects') as Record<string, unknown> | null;
        if (!projectData) continue;

        let projects: Array<Record<string, unknown>> = [];
        if (typeof projectData === 'string') {
          try { projects = JSON.parse(projectData); } catch { /* ignore */ }
        } else if (Array.isArray(projectData)) {
          projects = projectData;
        }

        const userName = userMap.get(user.id) || user.id;
        const userImages = extractImagesFromProjects(projects, user.id, userName, source);

        // 日期过滤
        const filtered = userImages.filter(img => {
          if (startTime && img.createdAt < startTime) return false;
          if (endTime && img.createdAt > endTime) return false;
          return true;
        });

        // 搜索过滤
        const searched = search
          ? filtered.filter(img =>
              (img.prompt && img.prompt.toLowerCase().includes(search.toLowerCase())) ||
              (img.model && img.model.toLowerCase().includes(search.toLowerCase())) ||
              (img.apiProvider && img.apiProvider.toLowerCase().includes(search.toLowerCase()))
            )
          : filtered;

        allImages.push(...searched);

        // 用户级统计
        const allUserImages = extractImagesFromProjects(projects, user.id, userName, '');
        userStats.push({
          userId: user.id,
          userName,
          totalImages: allUserImages.length,
          generated: allUserImages.filter(i => i.source === 'generated').length,
          uploaded: allUserImages.filter(i => i.source === 'uploaded').length,
          edited: allUserImages.filter(i => i.source === 'edited').length,
          projectCount: projects.length,
        });
      } catch (err) {
        console.error(`[admin/user-images] Error processing user ${user.id}:`, err);
      }
    }

    // 按创建时间降序排列
    allImages.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // 分页
    const total = allImages.length;
    const start = (page - 1) * pageSize;
    const images = allImages.slice(start, start + pageSize);

    // 全局统计
    const stats = {
      totalUsers: targetUsers.length,
      totalImages: allImages.length,
      generated: allImages.filter(i => i.source === 'generated').length,
      uploaded: allImages.filter(i => i.source === 'uploaded').length,
      edited: allImages.filter(i => i.source === 'edited').length,
      userStats: userStats.sort((a, b) => b.totalImages - a.totalImages).slice(0, 50),
    };

    return NextResponse.json({ images, total, page, pageSize, stats });
  } catch (error) {
    console.error('[admin/user-images] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch user images' }, { status: 500 });
  }
}
