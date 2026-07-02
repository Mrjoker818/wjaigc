import { NextRequest, NextResponse } from 'next/server';
import { dbGetBrandAssets, dbGetBrandAsset, dbUpsertBrandAsset, dbDeleteBrandAsset, dbSetDefaultBrandAsset, type DbBrandAsset } from '@/lib/db-storage';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getSessionUser } from '@/lib/server-auth';
import { validateApiInputs } from '@/lib/api-validator';

export const dynamic = 'force-dynamic';

// ─── GET: List brand assets for a user ──────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireApiAuthOrReject(request);
    if (authResult) return authResult;
    const userId = request.nextUrl.searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: '缺少 userId 参数' }, { status: 400 });
    }

    const assets = await dbGetBrandAssets(userId);
    return NextResponse.json({ success: true, assets });
  } catch (e) {
    console.error('[brand-assets] GET error:', e);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// ─── POST: Create or update a brand asset ───────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireApiAuthOrReject(request);
    if (authResult) return authResult;
    const currentUser = await getSessionUser(request);
    const authenticatedUserId = currentUser?.id;
    const body = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body, {
        imageUrl: 'optionalImageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const { action } = body;

    // ─── List assets ───
    if (action === 'list') {
      const { userId } = body;
      // 使用认证用户ID，防止跨用户访问
      const targetUserId = authenticatedUserId || userId;
      if (!targetUserId) return NextResponse.json({ error: '缺少 userId' }, { status: 400 });
      const assets = await dbGetBrandAssets(targetUserId);
      return NextResponse.json({ success: true, assets });
    }

    // ─── Get single asset ───
    if (action === 'get') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
      const asset = await dbGetBrandAsset(id);
      if (!asset) return NextResponse.json({ error: '未找到品牌资产' }, { status: 404 });
      return NextResponse.json({ success: true, asset });
    }

    // ─── Save (upsert) asset ───
    if (action === 'save') {
      const { id, name, brandName, brandColors, styleExtra, sceneDesc, referenceImageUrl, productImageUrl, productDesc, mainText, secondaryText, accentSymbol, selectedModel, isDefault } = body;
      const userId = authenticatedUserId || body.userId;
      if (!userId) return NextResponse.json({ error: '缺少 userId' }, { status: 400 });
      if (!name?.trim()) return NextResponse.json({ error: '请输入品牌方案名称' }, { status: 400 });

      const now = Date.now();
      const asset: DbBrandAsset = {
        id: id || `brand-${now}-${Math.random().toString(36).slice(2, 8)}`,
        user_id: userId,
        name: name.trim(),
        brand_name: brandName || '',
        brand_colors: brandColors || [],
        style_extra: styleExtra || '',
        scene_desc: sceneDesc || 'modern minimalist interior',
        reference_image_url: referenceImageUrl || '',
        product_image_url: productImageUrl || '',
        product_desc: productDesc || '',
        main_text: mainText || '',
        secondary_text: secondaryText || '',
        accent_symbol: accentSymbol || '',
        selected_model: selectedModel || '',
        is_default: isDefault || false,
        created_at: body.createdAt || now,
        updated_at: now,
      };

      const ok = await dbUpsertBrandAsset(asset);
      if (!ok) return NextResponse.json({ error: '保存失败' }, { status: 500 });

      // If setting as default, update other assets
      if (asset.is_default) {
        await dbSetDefaultBrandAsset(userId, asset.id);
      }

      return NextResponse.json({ success: true, asset });
    }

    // ─── Delete asset ───
    if (action === 'delete') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
      if (!authenticatedUserId) return NextResponse.json({ error: '未登录' }, { status: 401 });
      // Verify ownership: only the asset owner can delete
      const existingAssets = await dbGetBrandAssets(authenticatedUserId);
      const assetExists = existingAssets.some((a: { id: string }) => a.id === id);
      if (!assetExists) return NextResponse.json({ error: '资产不存在或无权操作' }, { status: 403 });
      const ok = await dbDeleteBrandAsset(id);
      if (!ok) return NextResponse.json({ error: '删除失败' }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    // ─── Set default ───
    if (action === 'setDefault') {
      const { id } = body;
      const userId = authenticatedUserId;
      if (!userId || !id) return NextResponse.json({ error: '缺少参数' }, { status: 400 });
      const ok = await dbSetDefaultBrandAsset(userId, id);
      if (!ok) return NextResponse.json({ error: '设置默认失败' }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (e) {
    console.error('[brand-assets] POST error:', e);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
