import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * Gallery data API - serves the font design inspiration gallery
 * Supports category filtering and pagination
 */
export async function GET(request: NextRequest) {
  try {
    const dataPath = path.join(process.cwd(), 'public', 'gallery', 'data.json');
    
    if (!fs.existsSync(dataPath)) {
      return NextResponse.json({ error: 'Gallery data not found' }, { status: 404 });
    }

    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const { searchParams } = new URL(request.url);
    
    const category = searchParams.get('category'); // category ID
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const search = searchParams.get('search') || '';

    let items = data.items || [];

    // Filter by category (supports both category ID and category name)
    if (category && category !== 'all') {
      items = items.filter((item: Record<string, string>) => 
        item.category === category || item.categoryName === category
      );
    }

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((item: Record<string, string>) => 
        item.prompt?.toLowerCase().includes(q) || 
        item.displayText?.toLowerCase().includes(q) ||
        item.categoryName?.toLowerCase().includes(q)
      );
    }

    // Pagination
    const total = items.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const pagedItems = items.slice(start, start + pageSize);

    return NextResponse.json({
      categories: data.categories,
      totalCount: data.totalCount,
      filteredCount: total,
      page,
      pageSize,
      totalPages,
      items: pagedItems
    });
  } catch (error) {
    console.error('Gallery API error:', error);
    return NextResponse.json({ error: 'Failed to load gallery data' }, { status: 500 });
  }
}
