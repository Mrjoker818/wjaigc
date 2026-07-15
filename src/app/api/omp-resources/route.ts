import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { listResources } from '@/lib/desktop-cloud';

// API route to serve Oh My Prompt resource library data
// Strategy: Merge DB resources (admin后台上传) with bundled static JSON fallback
// 支持 type / category / keyword / limit / cat 五个参数

// Cached data directory path
let cachedDataDir: string | null | undefined = undefined;

function findDataDir(): string | null {
  if (cachedDataDir !== undefined) return cachedDataDir;
  const candidates = [
    join(process.cwd(), 'public', 'data', 'omp-resources'),
    join(process.cwd(), 'src', 'data', 'omp-resources'),
    join(process.cwd(), '.next', 'static', 'data', 'omp-resources'),
  ];
  const cozeWorkspace = process.env.COZE_WORKSPACE_PATH;
  if (cozeWorkspace) {
    candidates.push(
      join(cozeWorkspace, 'public', 'data', 'omp-resources'),
      join(cozeWorkspace, 'src', 'data', 'omp-resources'),
    );
  }
  const uniqueCandidates = [...new Set(candidates)];
  for (const dir of uniqueCandidates) {
    try {
      if (existsSync(join(dir, 'index.json'))) {
        cachedDataDir = dir;
        return dir;
      }
    } catch { /* skip */ }
  }
  cachedDataDir = null;
  return null;
}
// 从静态 categories 数据中提取所有 resource 项（兼容旧版静态格式）
function extractStaticResources(): Array<Record<string, unknown>> {
  const dir = findDataDir();
  if (!dir) return [];
  const out: Array<Record<string, unknown>> = [];
  try {
    const catsDir = join(dir, 'categories');
    if (!existsSync(catsDir)) return [];
    // 静态数据为每个分类一个json，包含 items/resources 数组
    const files: string[] = readdirSync(catsDir).filter((f: string) => f.endsWith('.json'));
    for (const f of files) {
      try {
        const data = JSON.parse(readFileSync(join(catsDir, f), 'utf-8'));
        const catId = f.replace(/\.json$/, '');
        const items = data.items || data.resources || data.prompts || [];
        if (Array.isArray(items)) {
          for (const it of items) {
            out.push({ ...it, _category: catId, _source: 'static' });
          }
        }
      } catch { /* skip single file error */ }
    }
  } catch (err) {
    console.error('[omp-resources] extractStaticResources error:', err);
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const catId = searchParams.get('cat');
    const type = searchParams.get('type');
    const category = searchParams.get('category');
    const keyword = searchParams.get('keyword');
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 0, 0), 200) : 0;

    // 如果指定了 catId，返回特定分类的静态数据（兼容旧接口）
    if (catId) {
      const dir = findDataDir();
      if (dir) {
        const catFile = join(dir, 'categories', `${catId}.json`);
        try {
          if (existsSync(catFile)) {
            const data = JSON.parse(readFileSync(catFile, 'utf-8'));
            return NextResponse.json(data, {
              headers: { 'Cache-Control': 'public, max-age=3600' },
            });
          }
        } catch (readErr) {
          console.error(`[omp-resources] Error reading category '${catId}' from disk:`, readErr);
        }
      }
      return NextResponse.json({ success: false, error: 'Category not found' }, { status: 404 });
    }

    // 合并 DB 资源 + 静态资源
    let resources: Array<Record<string, unknown>> = [];

    try {
      const dbResources = await listResources({ type: type || undefined, enabledOnly: true });
      resources.push(...dbResources.map((r) => ({
        id: r.id,
        type: r.type,
        name: r.name,
        description: r.description,
        category: r.category,
        tags: r.tags || [],
        thumbnailUrl: r.thumbnailUrl,
        content: r.content,
        payload: r.payload,
        _source: 'db',
      })));
    } catch (dbErr) {
      console.error('[omp-resources] DB list failed, fallback to static:', dbErr);
    }

    // 若未指定 type 或指定了提示词相关类型，同时合并静态提示词库
    if (!type || type === 'style' || type === 'prompt' || type === 'preset') {
      const staticRes = extractStaticResources();
      // 静态资源：兼容静态文件中可能没有的字段
      for (const it of staticRes) {
        resources.push({
          id: (it.id as string) || `static-${it._category}-${Math.random().toString(36).slice(2, 8)}`,
          type: it.type || 'preset',
          name: it.name || it.title || (it.label as string) || '',
          description: it.description || (it.prompt as string) || '',
          category: it.category || it._category,
          tags: it.tags || [],
          thumbnailUrl: it.thumbnailUrl || it.preview || null,
          content: it.content || it.prompt || it.text || '',
          payload: it.payload || it.metadata || null,
          _source: 'static',
        });
      }
    }

    // category 过滤
    if (category) {
      const catLower = category.toLowerCase();
      resources = resources.filter((r) => {
        const cat = String(r.category || '').toLowerCase();
        return cat.includes(catLower);
      });
    }

    // keyword 过滤（匹配 name/description/content/tags）
    if (keyword) {
      const kw = keyword.toLowerCase();
      resources = resources.filter((r) => {
        const name = String(r.name || '').toLowerCase();
        const desc = String(r.description || '').toLowerCase();
        const content = String(r.content || '').toLowerCase();
        const tags = Array.isArray(r.tags) ? (r.tags as string[]).join(',').toLowerCase() : '';
        return name.includes(kw) || desc.includes(kw) || content.includes(kw) || tags.includes(kw);
      });
    }

    // limit
    if (limit > 0) {
      resources = resources.slice(0, limit);
    }

    return NextResponse.json({
      success: true,
      resources,
      total: resources.length,
      version: '2.1.0',
      fetchedAt: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  } catch (error) {
    console.error('[omp-resources API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load resource data' },
      { status: 500 }
    );
  }
}
