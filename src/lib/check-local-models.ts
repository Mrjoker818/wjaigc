/**
 * 检查本地 AI 模型文件状态
 * 此文件独立于 instrumentation.ts，避免 Edge Runtime 加载 Node.js 模块
 */
import fs from 'fs';
import path from 'path';

export async function checkLocalModels() {
  try {
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
