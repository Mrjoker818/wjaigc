// ============================================================
// GET /api/image/health — 本地图像工具健康检测
// ============================================================

import { NextResponse } from 'next/server';
import { checkIOPaintHealth, REMOVEBG_MODELS, ERASE_MODELS } from '@/lib/image-tools/iopaint-client';
import { LOCAL_AI_ENABLED, IOPAINT_MODELS_DIR } from '@/lib/image-tools/config';
import { isOnnxUpscaleAvailable } from '@/lib/image-tools/upscayl';
import fs from 'fs';
import path from 'path';

/** 检查擦除模型文件是否存在且有效 */
function checkEraseModels(): Record<string, { available: boolean; path: string; size?: number; error?: string }> {
  // 使用持久化模型目录（支持 root 目录和 hub/checkpoints/ 子目录两种布局）
  const modelsDir = IOPAINT_MODELS_DIR;
  const hubCkptDir = path.join(modelsDir, 'hub', 'checkpoints');
  const models: Record<string, { available: boolean; path: string; size?: number; error?: string }> = {};
  for (const m of ERASE_MODELS) {
    const primaryFile = m.files[0]; // 第一个文件为主文件
    // 查找模型文件: 先查 root 目录，再查 hub/checkpoints/ 子目录
    let modelPath = path.join(modelsDir, primaryFile);
    if (!fs.existsSync(modelPath)) {
      modelPath = path.join(hubCkptDir, primaryFile);
    }
    try {
      // 检查所有文件是否都存在
      let allExist = true;
      let totalSize = 0;
      for (const f of m.files) {
        let fp = path.join(modelsDir, f);
        if (!fs.existsSync(fp)) {
          fp = path.join(hubCkptDir, f);
        }
        if (!fs.existsSync(fp)) { allExist = false; break; }
        totalSize += fs.statSync(fp).size;
      }
      if (!allExist) {
        models[m.id] = { available: false, path: modelPath, error: `模型文件不存在 (需要: ${m.files.join(', ')})` };
      } else if (totalSize < 1_000_000) {
        models[m.id] = { available: false, path: modelPath, size: totalSize, error: `文件过小 (${(totalSize / 1024).toFixed(0)}KB)` };
      } else {
        models[m.id] = { available: true, path: modelPath, size: totalSize };
      }
    } catch (e) {
      models[m.id] = { available: false, path: modelPath, error: String(e) };
    }
  }
  return models;
}

/** 检查 Python 脚本是否存在 */
function checkPythonScripts(): { erase: boolean; removebg: boolean } {
  const scriptsDir = path.join(process.cwd(), 'scripts');
  return {
    erase: fs.existsSync(path.join(scriptsDir, 'iopaint_erase.py')),
    removebg: fs.existsSync(path.join(scriptsDir, 'iopaint_removebg.py')),
  };
}

export async function GET() {
  const [iopaint, onnxStatus] = await Promise.all([
    checkIOPaintHealth(),
    isOnnxUpscaleAvailable(),
  ]);

  const eraseModels = checkEraseModels();
  const scripts = checkPythonScripts();
  const lamaModelInfo = eraseModels['lama'] || { available: false, error: '未知' };

  return NextResponse.json({
    localAiEnabled: LOCAL_AI_ENABLED,
    iopaint: {
      available: iopaint.available,
      baseUrl: iopaint.baseUrl,
      model: iopaint.model,
      error: iopaint.error,
    },
    lamaModel: {
      available: lamaModelInfo.available,
      path: lamaModelInfo.path,
      size: lamaModelInfo.size ? `${(lamaModelInfo.size / 1024 / 1024).toFixed(1)}MB` : undefined,
      error: lamaModelInfo.error,
    },
    eraseModels: ERASE_MODELS.map(m => ({
      id: m.id,
      label: m.label,
      description: m.description,
      files: m.files,
      recommended: 'recommended' in m ? m.recommended : false,
      ...(eraseModels[m.id] || { available: false, error: '未知' }),
    })),
    removebg: {
      scriptAvailable: scripts.removebg,
      modelAutoDownload: true,
      supportedModels: REMOVEBG_MODELS.map(m => ({ id: m.id, label: m.label, group: m.group, recommended: 'recommended' in m ? m.recommended : false, description: m.description, size: m.size })),
    },
    scripts: {
      erase: scripts.erase,
      removebg: scripts.removebg,
    },
    // 放大引擎
    upscale: {
      onnx: {
        available: onnxStatus.available,
        model: onnxStatus.model,
        error: onnxStatus.error,
      },
      sharp: {
        available: true,
        engine: 'lanczos3',
        note: '仅插值放大，不增加细节',
      },
    },
  });
}
