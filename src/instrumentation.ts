/**
 * Next.js instrumentation hook
 * Runs once on server startup to migrate file-based data to PostgreSQL
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE !== 'phase-production-build') {
      import('@/lib/asset-core/cleanup-worker').then(({ startAssetCleanupWorker }) => {
        startAssetCleanupWorker();
      }).catch(() => {
        console.warn({ code: 'ASSET_CLEANUP_WORKER_START_FAILED' });
      });
    }

    // 数据库迁移和表初始化改为非阻塞，避免生产环境启动超时
    // 首次请求时会在对应 API 路由中自动完成初始化
    const dbInit = async () => {
      try {
        const { migrateFileDataToDb, dbEnsureSortOrderColumn, dbEnsureBalanceColumns, detectAndRecoverOrphanedUsers, ensureCoreTables } = await import('@/lib/db-storage');
        // 首先确保所有核心表存在（新部署时自动建表）
        await ensureCoreTables();
        await migrateFileDataToDb();
        await dbEnsureSortOrderColumn();
        await dbEnsureBalanceColumns();
        console.log('[instrumentation] DB migration check completed');

        // 检测并恢复孤立用户（有项目数据但无账号记录的用户）
        const orphaned = await detectAndRecoverOrphanedUsers();
        if (orphaned.length > 0) {
          console.warn(`[instrumentation] Recovered ${orphaned.filter(o => o.recovered).length}/${orphaned.length} orphaned user(s). Admin should reset their passwords.`);
        }

        // 确保 sourceUrl 映射表存在
        const { ensureImageSourceMapTable } = await import('@/lib/image-source-map');
        await ensureImageSourceMapTable();
        console.log('[instrumentation] Image source map table ready');

        // 确保 AI PSD 生成器表存在
        const { ensureAiPsdTables } = await import('@/lib/ai-psd/storage');
        await ensureAiPsdTables();
        console.log('[instrumentation] AI PSD tables ready');
      } catch (e) {
        console.warn('[instrumentation] DB migration failed (non-fatal):', e);
      }
    };
    // 不 await，让服务器先启动，数据库初始化在后台完成
    dbInit().catch(() => {});

    // 异步检查本地 AI 模型文件状态和 Python 环境（不阻塞启动）
    // 使用动态 import 确保此模块不会被 Edge Runtime 静态分析
    import('@/lib/check-local-models').then(({ checkLocalModels }) => {
      checkLocalModels().catch(() => {});
    }).catch(() => {});

    // SVG 转换 Python 依赖安装改为后台异步非阻塞
    // 使用 exec (异步) 代替 execSync (同步阻塞)，避免 pip install 阻塞事件循环导致启动超时
    const ensureSvgConvertDeps = async () => {
      try {
        const { exec } = await import('child_process');
        const missing: string[] = [];

        // 使用异步 exec 检查依赖，不阻塞事件循环
        const checkModule = (mod: string): Promise<void> => {
          return new Promise((resolve) => {
            exec(`python3 -c "import ${mod}"`, { timeout: 5000 }, (err) => {
              if (err) missing.push(mod);
              resolve();
            });
          });
        };

        await Promise.all([checkModule('cairosvg'), checkModule('ezdxf')]);

        if (missing.length > 0) {
          console.log(`[instrumentation] Installing SVG convert deps: ${missing.join(', ')}`);
          // 异步 pip install，不阻塞事件循环
          exec(`pip3 install ${missing.join(' ')} -q`, { timeout: 120000 }, (err) => {
            if (err) {
              console.warn('[instrumentation] SVG convert deps installation failed (non-fatal):', err.message);
            } else {
              console.log('[instrumentation] SVG convert deps installed successfully');
            }
          });
        } else {
          console.log('[instrumentation] SVG convert deps (cairosvg, ezdxf) already available');
        }
      } catch (e) {
        console.warn('[instrumentation] SVG convert deps check failed (non-fatal):', e);
      }
    };
    ensureSvgConvertDeps().catch(() => {});
  }
}
