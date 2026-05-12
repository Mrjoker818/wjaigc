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
    } catch (e) {
      console.warn('[instrumentation] DB migration failed (non-fatal):', e);
    }
  }
}
