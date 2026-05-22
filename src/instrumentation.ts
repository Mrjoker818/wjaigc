/**
 * Next.js instrumentation hook
 * Runs once on server startup to migrate file-based data to PostgreSQL
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { migrateFileDataToDb } = await import('@/lib/db-storage');
      await migrateFileDataToDb();
      console.log('[instrumentation] DB migration check completed');

      // 确保 sourceUrl 映射表存在
      const { ensureImageSourceMapTable } = await import('@/lib/image-source-map');
      await ensureImageSourceMapTable();
      console.log('[instrumentation] Image source map table ready');
    } catch (e) {
      console.warn('[instrumentation] DB migration failed (non-fatal):', e);
    }

    // 异步检查本地 AI 模型文件状态和 Python 环境（不阻塞启动）
    // 使用动态 import 确保此模块不会被 Edge Runtime 静态分析
    import('@/lib/check-local-models').then(({ checkLocalModels }) => {
      checkLocalModels().catch(() => {});
    }).catch(() => {});
  }
}
