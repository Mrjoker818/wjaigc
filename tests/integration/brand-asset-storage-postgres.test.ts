import { expect, it } from 'vitest';
import { dbGetBrandAssets, dbUpsertBrandAsset, ensureCoreTables, type DbBrandAsset } from '@/lib/db-storage';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';

it('round-trips empty and free-text brand style settings through PostgreSQL', async () => {
  await withIsolatedPostgres('brand_asset_styles', async ({ query }) => {
    await ensureCoreTables();
    const asset: DbBrandAsset = {
      id: 'brand-style-regression',
      user_id: 'brand-style-test-owner',
      name: '品牌方案验收',
      brand_name: '',
      brand_colors: ['#000000'],
      style_extra: '',
      scene_desc: '',
      reference_image_url: '',
      product_image_url: '',
      product_desc: '',
      main_text: '',
      secondary_text: '',
      accent_symbol: '',
      selected_model: '',
      is_default: false,
      created_at: 1,
      updated_at: 1,
    };
    expect(await dbUpsertBrandAsset(asset)).toBe(true);
    expect(await dbGetBrandAssets(asset.user_id)).toMatchObject([{ style_extra: '', brand_colors: ['#000000'] }]);

    const style = '高对比，"磨砂" 质感';
    expect(await dbUpsertBrandAsset({ ...asset, style_extra: style, updated_at: 2 })).toBe(true);
    expect(await dbGetBrandAssets(asset.user_id)).toMatchObject([{ style_extra: style }]);
    const stored = await query('SELECT jsonb_typeof(style_extra) AS kind FROM wujie_brand_assets WHERE id = $1', [asset.id]);
    expect(stored.rows).toEqual([{ kind: 'string' }]);
  });
});
