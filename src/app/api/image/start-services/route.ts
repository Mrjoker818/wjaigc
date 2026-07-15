import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { IOPAINT_MODELS_DIR } from '@/lib/image-tools/config';

export const dynamic = 'force-dynamic';

// Auto-start IOPaint and check Upscayl services
export async function POST(request: NextRequest) {
  void request;
  const results: Record<string, { started: boolean; error?: string }> = {};

  // 1. Check and start IOPaint
  try {
    const iopaintBaseUrl = process.env.IOPAINT_BASE_URL || 'http://127.0.0.1:8080';
    const iopaintUrl = new URL('/api/v1/health', iopaintBaseUrl);

    try {
      const healthRes = await fetch(iopaintUrl.toString(), {
        signal: AbortSignal.timeout(3000),
      });
      if (healthRes.ok) {
        results.iopaint = { started: false }; // Already running
      } else {
        throw new Error('Health check failed');
      }
    } catch {
      // IOPaint is not running, try to start it
      if (process.env.LOCAL_AI_ENABLED !== 'false') {
        const port = new URL(iopaintBaseUrl).port || '8080';
        const modelDir = process.env.IOPAINT_MODEL_DIR || IOPAINT_MODELS_DIR;

        // Ensure model directory exists
        const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
        const fullModelDir = path.isAbsolute(modelDir) ? modelDir : path.join(workspacePath, modelDir);
        if (!fs.existsSync(fullModelDir)) {
          fs.mkdirSync(fullModelDir, { recursive: true });
        }

        // Try to start IOPaint in background
        try {
          const proc = spawn('iopaint', [
            'start',
            '--model=lama',
            '--device=cpu',
            `--port=${port}`,
            `--model-dir=${fullModelDir}`,
          ], {
            detached: true,
            stdio: 'ignore',
            cwd: workspacePath,
          });

          // Handle spawn errors (e.g. command not found)
          proc.on('error', () => {
            // spawn error - command not found
          });

          proc.unref();

          // Wait a bit and check if it started
          await new Promise(resolve => setTimeout(resolve, 3000));
          try {
            const checkRes = await fetch(iopaintUrl.toString(), {
              signal: AbortSignal.timeout(5000),
            });
            results.iopaint = { started: checkRes.ok };
          } catch {
            results.iopaint = {
              started: false,
              error: 'IOPaint 启动中，请稍后再试。如果持续失败，请检查 iopaint 是否已安装: pip install iopaint',
            };
          }
        } catch {
          results.iopaint = {
            started: false,
            error: '无法启动 IOPaint，请确认已安装: pip install iopaint',
          };
        }
      } else {
        results.iopaint = { started: false, error: '本地 AI 工具已禁用 (LOCAL_AI_ENABLED=false)' };
      }
    }
  } catch (err) {
    results.iopaint = { started: false, error: String(err) };
  }

  // 2. Check Upscayl (ONNX) availability
  try {
    const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
    const modelsDir = process.env.UPSCAYL_MODELS_DIR || path.join(workspacePath, 'upscayl-models');
    const onnxModelsDir = process.env.ONNX_MODELS_DIR || path.join(workspacePath, 'onnx-models');

    // Check for ONNX model files
    let onnxModelsFound = false;
    for (const dir of [onnxModelsDir, modelsDir]) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        if (files.some(f => f.endsWith('.onnx'))) {
          onnxModelsFound = true;
          break;
        }
      }
    }

    // Check for Python + onnxruntime
    let onnxReady = false;
    try {
      const { execSync } = await import('child_process');
      execSync('python3 -c "import onnxruntime"', { timeout: 5000, stdio: 'ignore' });
      onnxReady = true;
    } catch {
      onnxReady = false;
    }

    // Check for upscale script
    const scriptPath = path.join(workspacePath, 'scripts', 'upscale_onnx.py');
    const scriptFound = fs.existsSync(scriptPath);

    if (onnxModelsFound && onnxReady && scriptFound) {
      results.upscayl = { started: true };
    } else {
      const errors: string[] = [];
      if (!onnxModelsFound) errors.push('ONNX 模型文件未找到');
      if (!onnxReady) errors.push('Python onnxruntime 未安装');
      if (!scriptFound) errors.push('upscale_onnx.py 脚本未找到');
      results.upscayl = { started: false, error: errors.join('，') };
    }
  } catch (err) {
    results.upscayl = { started: false, error: String(err) };
  }

  return NextResponse.json({
    success: true,
    services: results,
  });
}
