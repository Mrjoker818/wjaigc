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

    // 异步检查本地 AI 模型文件状态（不阻塞启动）
    checkLocalModels().catch(() => {});
  }
}

/**
 * 检查本地 AI 模型文件状态，日志提示缺失的模型
 * 仅检查核心模型（LaMa + U2NetP），不自动下载（下载耗时较长，需用户手动执行）
 */
async function checkLocalModels() {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { IOPAINT_MODELS_DIR, REMOVEBG_MODELS_DIR, LOCAL_AI_ENABLED } = await import('@/lib/image-tools/config');

    if (!LOCAL_AI_ENABLED) {
      console.log('[instrumentation] LOCAL_AI_ENABLED is false, skipping model check');
      return;
    }

    // 检查核心模型文件
    const coreModels = [
      { name: 'LaMa 擦除', path: path.join(IOPAINT_MODELS_DIR, 'big-lama.pt'), minSize: 1_000_000 },
      { name: 'U2NetP 去背景', path: path.join(REMOVEBG_MODELS_DIR, 'u2netp.onnx'), minSize: 1_000_000 },
    ];

    const missing: string[] = [];
    for (const model of coreModels) {
      try {
        const stat = fs.statSync(model.path);
        if (stat.size < model.minSize) {
          missing.push(`${model.name} (${model.path} 文件过小: ${stat.size} bytes)`);
        }
      } catch {
        missing.push(`${model.name} (${model.path} 不存在)`);
      }
    }

    if (missing.length > 0) {
      console.warn(
        `[instrumentation] 本地 AI 模型缺失:\n${missing.map(m => `  - ${m}`).join('\n')}\n` +
        `  请运行: bash scripts/ensure-models.sh --download\n` +
        `  模型目录: IOPaint=${IOPAINT_MODELS_DIR}, RemoveBG=${REMOVEBG_MODELS_DIR}\n` +
        `  缺失模型将自动降级到 AI API 兜底`
      );
    } else {
      console.log('[instrumentation] 核心本地 AI 模型已就绪 (LaMa + U2NetP)');
    }
  } catch (e) {
    // 模型检查失败不应影响应用启动
    console.warn('[instrumentation] Model check failed (non-fatal):', e);
  }
}
