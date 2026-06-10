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
  duration?: number; // 生成消耗时间（秒），如果有记录
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // 从 wujie_user_data 读取用户的项目数据
    const projectData = await dbGetUserData(userId, 'projects');
    if (!projectData) {
      return NextResponse.json({ images: [], total: 0, page, pageSize });
    }

    // 解析项目数据，提取所有图片
    let projects: Array<{
      id: string;
      name: string;
      canvasImages?: Array<{
        id: string;
        url: string;
        prompt?: string;
        model?: string;
        quality?: string;
        aspectRatio?: string;
        size?: string;
        createdAt?: number;
        originalWidth?: number;
        originalHeight?: number;
        sourceUrl?: string;
        metadata?: Record<string, unknown>;
      }>;
    }> = [];

    if (typeof projectData === 'string') {
      try { projects = JSON.parse(projectData); } catch { /* ignore */ }
    } else if (Array.isArray(projectData)) {
      projects = projectData;
    }

    // 收集所有图片
    const allImages: ImageRecord[] = [];
    for (const project of projects) {
      if (!project.canvasImages || !Array.isArray(project.canvasImages)) continue;
      for (const img of project.canvasImages) {
        // 只包含有 prompt 或 model 的图片（即生成的图片，非上传的）
        if (img.prompt || img.model) {
          allImages.push({
            id: img.id,
            url: img.sourceUrl || img.url,
            prompt: img.prompt,
            model: img.model,
            quality: img.quality,
            aspectRatio: img.aspectRatio,
            size: img.size,
            createdAt: img.createdAt || 0,
            projectId: project.id,
            projectName: project.name || '未命名项目',
            originalWidth: img.originalWidth,
            originalHeight: img.originalHeight,
            duration: (img.metadata as Record<string, unknown>)?.duration as number | undefined,
          });
        }
      }
    }

    // 按创建时间降序排列
    allImages.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // 分页
    const total = allImages.length;
    const start = (page - 1) * pageSize;
    const images = allImages.slice(start, start + pageSize);

    return NextResponse.json({ images, total, page, pageSize });
  } catch (error) {
    console.error('[admin/user-images] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch user images' }, { status: 500 });
  }
}
