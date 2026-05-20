// ============================================================
// GET /api/image/health — 本地图像工具健康检测
// ============================================================

import { NextResponse } from 'next/server';
import { isUpscaylAvailable } from '@/lib/image-tools/upscayl';
import { checkIOPaintHealth, REMOVEBG_MODELS, ERASE_MODELS } from '@/lib/image-tools/iopaint-client';
import { LOCAL_AI_ENABLED } from '@/lib/image-tools/config';
import fs from 'fs';
import path from 'path';

/** 检查擦除模型文件是否存在且有效 */
function checkEraseModels(): Record<string, { available: boolean; path: string; size?: number; error?: string }> {
  const cacheDir = path.join(process.env.HOME || '/root', '.cache/torch/hub/checkpoints');
  const models: Record<string, { available: boolean; path: string; size?: number; error?: string }> = {};
  for (const m of ERASE_MODELS) {
    const primaryFile = m.files[0]; // 第一个文件为主文件
    const modelPath = path.join(cacheDir, primaryFile);
    try {
      // 检查所有文件是否都存在
      let allExist = true;
      let totalSize = 0;
      for (const f of m.files) {
        const fp = path.join(cacheDir, f);
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
  const [iopaint, upscayl] = await Promise.all([
    checkIOPaintHealth(),
    isUpscaylAvailable(),
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
      // RemoveBG 模型首次使用时自动下载
      modelAutoDownload: true,
      supportedModels: REMOVEBG_MODELS.map(m => ({ id: m.id, label: m.label, group: m.group, recommended: 'recommended' in m ? m.recommended : false, description: m.description, size: m.size })),
    },
    scripts: {
      erase: scripts.erase,
      removebg: scripts.removebg,
    },
    upscayl: {
      available: upscayl.available,
      models: upscayl.models,
      error: upscayl.error,
    },
  });
}
