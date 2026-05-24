import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { IOPAINT_MODELS_DIR } from '@/lib/image-tools/config';

export const dynamic = 'force-dynamic';

// Auto-start IOPaint and Upscayl services
export async function POST(request: NextRequest) {
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
        } catch (startErr) {
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

  // 2. Check Upscayl availability
  try {
    const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
    const modelsDir = process.env.UPSCAYL_MODELS_DIR || path.join(workspacePath, 'upscayl-models');

    // Check for upscayl binary
    let binFound = false;
    const binCandidates = [
      path.join(workspacePath, 'bin', 'upscayl-bin'),
    ];

    // Also check in node_modules
    const nodeModulesPath = path.join(workspacePath, 'node_modules', '.pnpm');
    if (fs.existsSync(nodeModulesPath)) {
      const dirs = fs.readdirSync(nodeModulesPath).filter(d => d.startsWith('upscayl-node'));
      for (const dir of dirs) {
        binCandidates.push(
          path.join(nodeModulesPath, dir, 'node_modules', 'upscayl-node',
            'dist', 'upscaler', 'sub-classes', 'driver', 'command-upscayl',
            'resources', 'linux', 'bin', 'upscayl-bin')
        );
      }
    }

    for (const binPath of binCandidates) {
      if (fs.existsSync(binPath)) {
        binFound = true;
        break;
      }
    }

    // Check for models
    let modelsFound = false;
    const modelCandidates = [modelsDir];
    if (fs.existsSync(nodeModulesPath)) {
      const dirs = fs.readdirSync(nodeModulesPath).filter(d => d.startsWith('upscayl-node'));
      for (const dir of dirs) {
        modelCandidates.push(
          path.join(nodeModulesPath, dir, 'node_modules', 'upscayl-node',
            'dist', 'upscaler', 'sub-classes', 'model-manager', 'models')
        );
      }
    }

    for (const modelPath of modelCandidates) {
      if (fs.existsSync(modelPath)) {
        const files = fs.readdirSync(modelPath);
        if (files.some(f => f.endsWith('.param'))) {
          modelsFound = true;
          break;
        }
      }
    }

    if (binFound && modelsFound) {
      results.upscayl = { started: true };
    } else {
      const errors: string[] = [];
      if (!binFound) errors.push('upscayl 二进制文件未找到');
      if (!modelsFound) errors.push('模型文件未找到');
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
