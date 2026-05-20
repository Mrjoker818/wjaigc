// ============================================================
// GET /api/image/health — 本地图像工具健康检测
// ============================================================

import { NextResponse } from 'next/server';
import { isUpscaylAvailable } from '@/lib/image-tools/upscayl';
import { checkIOPaintHealth } from '@/lib/image-tools/iopaint-client';
import { LOCAL_AI_ENABLED } from '@/lib/image-tools/config';
import fs from 'fs';
import path from 'path';

/** 检查 LaMa 模型文件是否存在且有效 */
function checkLamaModel(): { available: boolean; path: string; size?: number; error?: string } {
  const modelPath = path.join(
    process.env.HOME || '/root',
    '.cache/torch/hub/checkpoints/big-lama.pt',
  );
  try {
    if (!fs.existsSync(modelPath)) {
      return { available: false, path: modelPath, error: '模型文件不存在' };
    }
    const stat = fs.statSync(modelPath);
    if (stat.size < 1_000_000) {
      return { available: false, path: modelPath, size: stat.size, error: `模型文件过小 (${(stat.size / 1024).toFixed(0)}KB)，可能下载不完整` };
    }
    return { available: true, path: modelPath, size: stat.size };
  } catch (e) {
    return { available: false, path: modelPath, error: String(e) };
  }
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

  const lamaModel = checkLamaModel();
  const scripts = checkPythonScripts();

  return NextResponse.json({
    localAiEnabled: LOCAL_AI_ENABLED,
    iopaint: {
      available: iopaint.available,
      baseUrl: iopaint.baseUrl,
      model: iopaint.model,
      error: iopaint.error,
    },
    lamaModel: {
      available: lamaModel.available,
      path: lamaModel.path,
      size: lamaModel.size ? `${(lamaModel.size / 1024 / 1024).toFixed(1)}MB` : undefined,
      error: lamaModel.error,
    },
    removebg: {
      scriptAvailable: scripts.removebg,
      // RemoveBG 模型首次使用时自动下载（rembg/u2net ~176MB）
      modelAutoDownload: true,
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
