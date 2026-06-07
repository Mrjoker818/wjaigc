import { NextRequest, NextResponse } from 'next/server';
import { execSql } from '@/lib/db-client';
import { getSessionUser } from '@/lib/server-auth';

// GET /api/favorites - List favorites (paginated)
export async function GET(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: 'Login required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = sessionUser.id; // Use session user ID instead of parameter
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
    const offset = (page - 1) * limit;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const [rowsResult, countResult] = await Promise.all([
      execSql(
        `SELECT id, user_id, image_url, prompt, negative_prompt, model, model_name,
                aspect_ratio, quality, image_width, image_height, original_width, original_height,
                api_provider, api_base_url, source_type, source_project_id, created_at, username
         FROM wujie_favorites
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      ),
      execSql(
        `SELECT COUNT(*) as total FROM wujie_favorites WHERE user_id = $1`,
        [userId]
      ),
    ]);

    const total = parseInt(String(countResult.rows?.[0]?.total || '0'), 10);

    return NextResponse.json({
      success: true,
      favorites: rowsResult.rows || [],
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('[Favorites] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch favorites' }, { status: 500 });
  }
}

// POST /api/favorites - Add to favorites
export async function POST(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: 'Login required' }, { status: 401 });
    }

    const body = await request.json();
    const {
      username,
      imageUrl,
      prompt,
      negativePrompt,
      model,
      modelName,
      aspectRatio,
      quality,
      imageWidth,
      imageHeight,
      originalWidth,
      originalHeight,
      apiProvider,
      apiBaseUrl,
      sourceType,
      sourceProjectId,
    } = body;

    const userId = sessionUser.id;
    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });
    }

    // Check duplicate
    const existing = await execSql(
      `SELECT id FROM wujie_favorites WHERE user_id = $1 AND image_url = $2 LIMIT 1`,
      [userId, imageUrl]
    );
    if (existing.rows && existing.rows.length > 0) {
      return NextResponse.json({ success: true, message: 'Already in favorites', id: existing.rows[0].id });
    }

    const result = await execSql(
      `INSERT INTO wujie_favorites
        (user_id, username, image_url, prompt, negative_prompt, model, model_name,
         aspect_ratio, quality, image_width, image_height, original_width, original_height,
         api_provider, api_base_url, source_type, source_project_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id, created_at`,
      [
        userId, username || '', imageUrl, prompt || '', negativePrompt || '',
        model || '', modelName || '', aspectRatio || '', quality || '',
        imageWidth || 0, imageHeight || 0, originalWidth || 0, originalHeight || 0,
        apiProvider || '', apiBaseUrl || '', sourceType || 'generated', sourceProjectId || '',
      ]
    );

    return NextResponse.json({
      success: true,
      id: result.rows?.[0]?.id,
      createdAt: result.rows?.[0]?.created_at,
    });
  } catch (error) {
    console.error('[Favorites] POST error:', error);
    return NextResponse.json({ error: 'Failed to add favorite' }, { status: 500 });
  }
}

// DELETE /api/favorites - Remove from favorites
export async function DELETE(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: 'Login required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Use string id directly for SQL (parameterized query is safe)
    await execSql(
      `DELETE FROM wujie_favorites WHERE id = $1 AND user_id = $2`,
      [id, sessionUser.id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Favorites] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to remove favorite' }, { status: 500 });
  }
}
