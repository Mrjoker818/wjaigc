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
 * 
 * 注意: 不从 config.ts 导入，因为 config.ts 顶层 import path 会在 Edge Runtime 报错
 */
async function checkLocalModels() {
  try {
    const fs = await import('fs');
    const path = await import('path');

    // 直接读取环境变量，不依赖 config.ts
    const localAiEnabled = process.env.LOCAL_AI_ENABLED;
    if (localAiEnabled === 'false') {
      console.log('[instrumentation] LOCAL_AI_ENABLED is false, skipping model check');
      return;
    }

    const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
    const iopaintDir = process.env.IOPAINT_MODELS_DIR || path.join(workspacePath, 'models', 'iopaint');
    const removebgDir = process.env.REMOVEBG_MODELS_DIR || path.join(workspacePath, 'models', 'removebg');

    // 检查核心模型文件
    const coreModels = [
      { name: 'LaMa 擦除', path: path.join(iopaintDir, 'big-lama.pt'), minSize: 1_000_000 },
      { name: 'U2NetP 去背景', path: path.join(removebgDir, 'u2netp.onnx'), minSize: 1_000_000 },
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
        `  模型目录: IOPaint=${iopaintDir}, RemoveBG=${removebgDir}\n` +
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
